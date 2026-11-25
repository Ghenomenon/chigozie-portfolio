// Shared logic for the daily job fetch. No network calls here, so it is easy to test.

export function normCompany(name = '') {
  return String(name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(limited|ltd|plc|llp|llc|inc|uk|group|holdings|the)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function titleOk(title, cfg) {
  const t = ` ${String(title).toLowerCase()} `;
  if (cfg.titleExclude.some((w) => t.includes(w))) return false;
  return cfg.titleMustMatch.some((w) => t.includes(w));
}

export function companyOk(company, cfg) {
  const c = String(company).toLowerCase();
  return !cfg.companyExclude.some((w) => c.includes(w));
}

// Returns 'refused' | 'offered' | 'unknown'. Refusal always wins.
export function sponsorshipFromText(text, cfg) {
  const t = String(text || '').toLowerCase().replace(/\s+/g, ' ');
  if (cfg.sponsorRefusal.some((p) => t.includes(p))) return 'refused';
  if (cfg.sponsorOffered.some((p) => t.includes(p))) return 'offered';
  return 'unknown';
}

export function detectWorkMode(...parts) {
  const t = parts.join(' ').toLowerCase();
  if (/\bhybrid\b/.test(t)) return 'hybrid';
  if (/\bremote\b|work from home|home[- ]based|\bwfh\b/.test(t)) return 'remote';
  return 'onsite';
}

export function isHome(location, cfg) {
  const l = String(location || '').toLowerCase();
  return cfg.homeRegionWords.some((w) => l.includes(w));
}

// Fit score from 0 to 5. Every part is visible in `reasons` so the app can show it.
export function scoreJob(job, cfg) {
  const reasons = [];
  let s = 2.5;
  const t = job.title.toLowerCase();

  if (/\b(data|reporting|excel|bi|business intelligence)\b/.test(t)) { s += 1; reasons.push('Core analyst title'); }
  else if (/\b(business|operations|supply chain|logistics|inventory|insight)\b/.test(t)) { s += 0.6; reasons.push('Adjacent analyst title'); }
  if (/\bjunior|graduate|entry|associate\b/.test(t)) { s += 0.4; reasons.push('Entry-level title'); }

  const [lo, hi] = cfg.salary.target;
  const min = job.salaryMin, max = job.salaryMax;
  if (min || max) {
    const a = min || max, b = max || min;
    if (b < cfg.salary.min) { s -= 2; reasons.push('Pay below your floor'); }
    else if (a <= hi && b >= lo) { s += 0.7; reasons.push('Pay in your range'); }
    else if (a > hi) { s -= 0.3; reasons.push('Pay above range, likely more senior'); }
  }

  if (job.workMode === 'remote') { s += 0.5; reasons.push('Remote'); }
  else if (isHome(job.location, cfg)) { s += 0.5; reasons.push('North East'); }

  if (job.sponsorship === 'refused') { s -= 3; reasons.push('Says no sponsorship'); }
  else if (job.sponsorship === 'offered') { s += 0.6; reasons.push('Advert mentions sponsorship'); }
  if (job.sponsorLicence === 'licensed') { s += 0.6; reasons.push('Employer holds a sponsor licence'); }

  s = Math.max(0, Math.min(5, s));
  return { score: Math.round(s * 10) / 10, reasons };
}

// Build the stored record. `raw` is a source-neutral object.
export function buildJob(raw, cfg, sponsorMap, today) {
  const text = `${raw.title} ${raw.description || ''}`;
  const job = {
    id: raw.id,
    title: raw.title.trim(),
    company: raw.company.trim(),
    location: raw.location || '',
    url: raw.url,
    source: raw.source,
    posted: raw.posted || today,
    salaryMin: raw.salaryMin || null,
    salaryMax: raw.salaryMax || null,
    salaryText: raw.salaryText || '',
    workMode: detectWorkMode(raw.title, raw.location, raw.description || ''),
    sponsorship: sponsorshipFromText(text, cfg),
    sponsorLicence: sponsorMap ? (sponsorMap.has(normCompany(raw.company)) ? 'licensed' : 'not-found') : 'unchecked',
  };
  const { score, reasons } = scoreJob(job, cfg);
  job.score = score;
  job.reasons = reasons;
  return job;
}

// Returns a reason string if the job must be dropped, otherwise null.
export function dropReason(job, cfg, today) {
  if (!titleOk(job.title, cfg)) return 'title';
  if (!companyOk(job.company, cfg)) return 'company';
  if (job.sponsorship === 'refused') return 'no-sponsorship';
  const max = job.salaryMax || job.salaryMin;
  if (max && max < cfg.salary.min) return 'below-floor';
  if (job.salaryMin && job.salaryMin > cfg.salary.dropIfMinAbove) return 'above-range';
  const ageDays = (Date.parse(today) - Date.parse(job.posted)) / 86400000;
  if (ageDays > cfg.maxAgeDays) return 'too-old';
  return null;
}

// Merge today's jobs into the stored list. Keeps first_seen so "new" survives reruns on the same day.
export function mergeJobs(existing, fresh, today, keepDays) {
  const byId = new Map(existing.map((j) => [j.id, j]));
  for (const j of fresh) {
    const old = byId.get(j.id);
    byId.set(j.id, { ...j, firstSeen: old?.firstSeen || today });
  }
  const cutoff = Date.parse(today) - keepDays * 86400000;
  return [...byId.values()]
    .filter((j) => Date.parse(j.posted) >= cutoff)
    .sort((a, b) => b.score - a.score || (b.posted > a.posted ? 1 : -1));
}

// Minimal CSV parser that handles quoted fields.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Home Office register: keep employers licensed for the Skilled Worker route.
export function sponsorMapFromCsv(text) {
  const rows = parseCsv(text);
  const head = rows[0].map((h) => h.toLowerCase());
  const iName = head.findIndex((h) => h.includes('organisation'));
  const iType = head.findIndex((h) => h.includes('type'));
  const iRoute = head.findIndex((h) => h.includes('route'));
  const map = new Map();
  for (const r of rows.slice(1)) {
    if (!r[iName]) continue;
    const route = (r[iRoute] || '').toLowerCase();
    const type = (r[iType] || '').toLowerCase();
    if (route.includes('skilled worker') && type.includes('a rating')) map.set(normCompany(r[iName]), true);
  }
  return map;
}

export function parseReedDate(s) {
  // Reed uses dd/mm/yyyy
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

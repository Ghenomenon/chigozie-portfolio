// Shared logic. Runs in Node (daily fetch) and in the browser (per-user filtering and scoring).
// Nothing here touches the network or the file system.

// ---------- text helpers ----------

export function normCompany(name = '') {
  return String(name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(limited|ltd|plc|llp|llc|inc|uk|group|holdings|the)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function cleanText(html = '') {
  return String(html)
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
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

// Reed sometimes returns a bare postcode such as "NN72QA". Show the outward code instead.
export function formatLocation(loc = '') {
  const s = String(loc).trim();
  const m = /^([A-Z]{1,2}\d[A-Z\d]?)\s?\d[A-Z]{2}$/i.exec(s);
  return m ? `Near ${m[1].toUpperCase()}` : s;
}

// ---------- role families ----------

// The feed holds several kinds of work. Most sponsorship rules apply to graduate-level jobs, so the app
// treats everything except analyst roles as hard to sponsor. This is a guess from the title.
const FAMILIES = [
  ['support-care', /\b(support worker|care assistant|care worker|carer|healthcare assistant|health care assistant|care home)\b/i],
  ['service-admin', /\b(customer service|customer support|administrator|receptionist|data entry)\b/i],
  ['warehouse', /\b(warehouse|operative|driver|picker|packer|logistics coordinator)\b/i],
  ['hospitality-retail', /\b(kitchen|chef|retail assistant|sales assistant|waiter|waitress|team member)\b/i],
];

export function jobFamily(title = '') {
  if (/\b(analyst|analytics|insight|reporting|bi developer)\b/i.test(title)) return 'analyst';
  for (const [name, re] of FAMILIES) if (re.test(title)) return name;
  return 'other';
}

// Old stored records have no family, so work it out from the title.
export const familyOf = (job) => job.family ?? jobFamily(job.title);
export const isHardToSponsor = (job) => familyOf(job) !== 'analyst';

// ---------- recruiters ----------

// Recruitment agencies advertise roles for clients. The sponsor register lists the agency, not the client,
// so a licence or a missing licence says little about the real employer. This is a best guess from the
// company name and the advert wording, and it can be wrong either way.
const AGENCY_WORDS = /\b(recruit\w*|staffing|resourcing|headhunt\w*|personnel|appointments|executive search|search (and|&) selection|interim)\b/i;
const AGENCY_KNOWN = /^(hays|adecco|randstad|harnham|michael page|page personnel|robert half|manpower|manpowergroup|kelly services|hudson|morgan mckinley|spencer ogden|nigel frank|jefferson frank|la fosse|venn group|reed(\s+(specialist|recruitment|in partnership|talent|business|contracts?)|$)|totaljobs|cv-library|search consultancy|walters people|hunter bond|lorien|computer futures|experis|jobsgopublic)/i;
const AGENCY_TEXT = /\bon behalf of (our|a|one of our|the) client|\bour client\b|\b(acting as|is) an? employment (agency|business)|\brecruitment (agency|consultancy|business)\b/i;

export function isAgency(job) {
  const name = String(job.company || '').trim();
  if (AGENCY_KNOWN.test(name) || AGENCY_WORDS.test(name)) return true;
  return AGENCY_TEXT.test(String(job.summary || job.description || '').slice(0, 1800));
}

// ---------- the shared feed (same for every user) ----------

export function buildJob(raw, feedCfg, sponsorMap) {
  const text = `${raw.title} ${raw.description || ''}`;
  const job = {
    id: raw.id,
    title: raw.title.trim(),
    company: raw.company.trim(),
    location: formatLocation(raw.location || ''),
    locations: [formatLocation(raw.location || '')].filter(Boolean),
    url: raw.url,
    source: raw.source,
    posted: raw.posted,
    salaryMin: raw.salaryMin || null,
    salaryMax: raw.salaryMax || null,
    workMode: detectWorkMode(raw.title, raw.location, raw.description || ''),
    sponsorship: sponsorshipFromText(text, feedCfg),
    sponsorLicence: sponsorMap ? (sponsorMap.has(normCompany(raw.company)) ? 'licensed' : 'not-found') : 'unchecked',
    summary: cleanText(raw.description).slice(0, 1800),
  };
  job.agency = isAgency(job);
  job.family = jobFamily(job.title);
  return job;
}

// Feed-level drops only: things no user would want. Everything personal is decided on the phone.
export function dropReason(job, feedCfg, today) {
  const t = ` ${job.title.toLowerCase()} `;
  if (feedCfg.titleExclude.some((w) => t.includes(w))) return 'title-excluded';
  if (!feedCfg.titleMustMatch.some((w) => t.includes(w))) return 'title';
  const c = job.company.toLowerCase();
  if (feedCfg.companyExclude.some((w) => c.includes(w))) return 'company';
  const ageDays = (Date.parse(today) - Date.parse(job.posted)) / 86400000;
  if (ageDays > feedCfg.maxAgeDays) return 'too-old';
  return null;
}

// One advert posted for many locations becomes one entry with a list of places.
export function collapseDuplicates(jobs) {
  const groups = new Map();
  for (const j of jobs) {
    const key = `${normCompany(j.company)}|${j.title.toLowerCase().replace(/\s+/g, ' ').trim()}`;
    const locations = (j.locations && j.locations.length ? j.locations : [j.location]).filter(Boolean).map(formatLocation);
    const g = groups.get(key);
    if (!g) { groups.set(key, { ...j, locations: [...new Set(locations)], copies: 1 }); continue; }
    g.locations = [...new Set([...g.locations, ...locations])];
    g.copies += 1;
    if (j.posted > g.posted) { g.posted = j.posted; g.url = j.url; g.id = j.id; }
    if (j.firstSeen && (!g.firstSeen || j.firstSeen > g.firstSeen)) g.firstSeen = j.firstSeen;
  }
  return [...groups.values()].map((g) => ({
    ...g,
    location: g.locations.length > 1 ? `${g.locations[0]} and ${g.locations.length - 1} more` : (g.locations[0] || g.location || 'UK'),
  }));
}

// Merge today's jobs into the stored list. Keeps firstSeen so "new" survives reruns on the same day.
export function mergeJobs(existing, fresh, today, keepDays) {
  const byId = new Map(existing.map((j) => [j.id, j]));
  for (const j of fresh) {
    const old = byId.get(j.id);
    byId.set(j.id, { ...j, firstSeen: old?.firstSeen || today });
  }
  const cutoff = Date.parse(today) - keepDays * 86400000;
  const kept = [...byId.values()].filter((j) => Date.parse(j.posted) >= cutoff);
  return collapseDuplicates(kept).sort((a, b) => (b.posted > a.posted ? 1 : b.posted < a.posted ? -1 : 0));
}

// ---------- the personal profile (lives on each user's phone) ----------

export const DEFAULT_PROFILE = {
  roles: [],                 // title keywords. Empty means any title in the feed.
  exclude: ['senior', 'lead', 'principal', 'head of', 'manager', 'director'],
  salaryFloor: 0,            // hide roles whose stated top pay is below this
  salaryTarget: null,        // [low, high]
  regions: [],               // place words. Empty means UK-wide.
  includeRemote: true,
  needsSponsorship: false,
  licensedOnly: false,
  hideAgencies: false,
};

const lc = (s) => String(s || '').toLowerCase();

export function titleMatchesRoles(job, p) {
  return !p.roles.length || p.roles.some((k) => lc(job.title).includes(lc(k)));
}

export function inRegion(job, p) {
  if (!p.regions.length) return true;
  if (p.includeRemote && job.workMode === 'remote') return true;
  const places = (job.locations && job.locations.length ? job.locations : [job.location]).map(lc);
  return p.regions.some((r) => places.some((l) => l.includes(lc(r))));
}

export function matchesProfile(job, p) {
  if (!titleMatchesRoles(job, p)) return false;
  if (p.exclude.some((w) => lc(job.title).includes(lc(w)))) return false;
  if (p.needsSponsorship && job.sponsorship === 'refused') return false;
  const top = job.salaryMax || job.salaryMin;
  if (p.salaryFloor && top && top < p.salaryFloor) return false;
  if (!inRegion(job, p)) return false;
  if (p.licensedOnly && job.sponsorLicence !== 'licensed') return false;
  if (p.hideAgencies && isRecruiter(job)) return false;
  return true;
}

// Old stored records have no flag, so work it out from the name and advert.
export function isRecruiter(job) {
  return job.agency ?? isAgency(job);
}

// Indicative only. The real threshold depends on the job's occupation code.
export function belowSponsorThreshold(job, thresholds) {
  const top = job.salaryMax || job.salaryMin;
  return Boolean(thresholds && top && top < thresholds.newEntrant);
}

// Fit score from 0 to 5. Every part is listed in `reasons` so the app can show it.
export function scoreJob(job, p, thresholds) {
  const reasons = [];
  let s = 2.5;

  if (p.roles.length && titleMatchesRoles(job, p)) { s += 1; reasons.push('Matches your roles'); }
  if (/\b(junior|graduate|entry|associate|trainee)\b/.test(lc(job.title))) { s += 0.4; reasons.push('Entry-level title'); }

  const min = job.salaryMin, max = job.salaryMax;
  if ((min || max) && p.salaryTarget) {
    const [lo, hi] = p.salaryTarget;
    const a = min || max, b = max || min;
    if (p.salaryFloor && b < p.salaryFloor) { s -= 2; reasons.push('Pay below your floor'); }
    else if (a <= hi && b >= lo) { s += 0.7; reasons.push('Pay in your range'); }
    else if (a > hi) { s -= 0.3; reasons.push('Pay above your range'); }
  }

  if (job.workMode === 'remote' && p.includeRemote) { s += 0.5; reasons.push('Remote'); }
  else if (p.regions.length && inRegion(job, p)) { s += 0.5; reasons.push('In your region'); }

  if (job.sponsorship === 'refused') { s -= 3; reasons.push('Says no sponsorship'); }
  else if (job.sponsorship === 'offered') { s += 0.6; reasons.push('Advert mentions sponsorship'); }
  if (p.needsSponsorship) {
    if (isHardToSponsor(job) && job.sponsorship !== 'offered') { s -= 0.8; reasons.push('This type of role is rarely sponsored'); }
    if (isRecruiter(job)) reasons.push('Recruiter: ask who the employer is');
    else if (job.sponsorLicence === 'licensed') { s += 0.6; reasons.push('Employer holds a sponsor licence'); }
    if (belowSponsorThreshold(job, thresholds)) { s -= 0.5; reasons.push('Pay may be below the visa threshold'); }
  }

  s = Math.max(0, Math.min(5, s));
  return { score: Math.round(s * 10) / 10, reasons };
}

// ---------- CSV and dates ----------

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

// Home Office register: keep employers licensed for the Skilled Worker route with an A rating.
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
    if ((route.includes('skilled worker') || route.includes('health and care')) && type.includes('a rating')) map.set(normCompany(r[iName]), true);
  }
  return map;
}

export function parseReedDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

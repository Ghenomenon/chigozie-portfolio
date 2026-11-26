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
const AGENCY_KNOWN = /^(hays|adecco|randstad|harnham|michael page|page personnel|robert half|manpower|manpowergroup|kelly services|hudson|morgan mckinley|spencer ogden|nigel frank|jefferson frank|la fosse|venn group|reed(\s+(specialist|recruitment|in partnership|talent|business|contracts?)|$)|totaljobs|cv-library|search consultancy|walters people|hunter bond|lorien|computer futures|experis|jobsgopublic|harvey nash|goodman masson|oliver james|robert walters|investigo|sthree|huxley|gattaca|matchtech|sanderson|pertemps|blue arrow|office angels|hackajob)/i;
const AGENCY_TEXT = /\bon behalf of (our|a|one of our|the) client|\bour client\b|\b(acting as|is) an? employment (agency|business)|\brecruitment (agency|consultancy|business)\b/i;

export function isAgency(job) {
  const name = String(job.company || '').trim();
  if (AGENCY_KNOWN.test(name) || AGENCY_WORDS.test(name)) return true;
  return AGENCY_TEXT.test(String(job.summary || job.description || '').slice(0, 1800));
}

// ---------- pay ----------

// Reed gives hourly, daily and weekly rates in the same fields as yearly pay. Work out which one it is,
// from a money figure followed by a unit in the advert when there is one, and from the size of the number
// when there is not. Yearly figures are then stored in salaryMin and salaryMax so filtering and scoring
// compare like with like. The original rate is kept in rateMin and rateMax for display.
const ANNUALISE = { hour: 1950, day: 260, week: 52 };   // 37.5 hours a week, 52 weeks

function unitFromText(text) {
  const t = String(text || '').slice(0, 1800);
  const money = String.raw`£\s?[\d][\d,.]*(?:\s?(?:k|-|to|–)\s?£?\s?[\d][\d,.]*)?`;
  if (new RegExp(`${money}\\s*(?:per|an|a|/)\\s*(?:hour|hr)\\b`, 'i').test(t)) return 'hour';
  if (new RegExp(`${money}\\s*(?:per|a|/)\\s*day\\b`, 'i').test(t)) return 'day';
  if (new RegExp(`${money}\\s*(?:per|a|/)\\s*week\\b`, 'i').test(t)) return 'week';
  return null;
}

export function normalisePay(job) {
  if (job.salaryUnit !== undefined) return job;           // already done
  const top = job.salaryMax || job.salaryMin;
  if (!top) return { ...job, salaryUnit: null };
  const unit = top >= 1000 ? 'year' : (unitFromText(job.summary) || (top < 100 ? 'hour' : 'day'));
  if (unit === 'year') return { ...job, salaryUnit: 'year' };
  const f = ANNUALISE[unit];
  return {
    ...job,
    salaryUnit: unit,
    rateMin: job.salaryMin || null,
    rateMax: job.salaryMax || null,
    salaryMin: job.salaryMin ? Math.round(job.salaryMin * f) : null,
    salaryMax: job.salaryMax ? Math.round(job.salaryMax * f) : null,
  };
}

// ---------- pay as advertised ----------

// An advert quotes pay in one unit. Roles quoted by the hour, day or week are compared by the hour, and
// roles quoted by the year are compared by the year. The other form is worked out for display only.
export function payBasis(job) {
  const unit = normalisePay(job).salaryUnit;
  return unit === 'year' ? 'year' : (unit ? 'hour' : null);
}

// The top of the advertised range, as pounds an hour. Days are 7.5 hours, weeks 37.5, years 1,950.
export function hourlyEquivalent(job) {
  const j = normalisePay(job);
  if (!j.salaryUnit) return null;
  const top = j.salaryUnit === 'year' ? (j.salaryMax || j.salaryMin) : (j.rateMax || j.rateMin);
  if (!top) return null;
  return { hour: top, day: top / 7.5, week: top / 37.5, year: top / 1950 }[j.salaryUnit];
}

export function belowPayFloor(job, p) {
  const j = normalisePay(job);
  const basis = payBasis(j);
  if (basis === 'year') {
    const top = j.salaryMax || j.salaryMin;
    return Boolean(p.salaryFloor && top && top < p.salaryFloor);
  }
  if (basis === 'hour') {
    const h = hourlyEquivalent(j);
    return Boolean(p.hourlyFloor && h && h < p.hourlyFloor);
  }
  return false;
}

// The legal minimum for over-21s. Part-time and unstated hours can make this wrong, so it is a flag only.
export function belowMinimumWage(job, thresholds) {
  const h = hourlyEquivalent(job);
  const nmw = thresholds?.minimumWage?.over21;
  return Boolean(h && nmw && h < nmw);
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
    expires: raw.expires || null,
    salaryMin: raw.salaryMin || null,
    salaryMax: raw.salaryMax || null,
    workMode: detectWorkMode(raw.title, raw.location, raw.description || ''),
    sponsorship: sponsorshipFromText(text, feedCfg),
    sponsorLicence: sponsorMap ? (sponsorMap.has(normCompany(raw.company)) ? 'licensed' : 'not-found') : 'unchecked',
    summary: cleanText(raw.description).slice(0, 1000),
  };
  job.agency = isAgency(job);
  job.family = jobFamily(job.title);
  return normalisePay(job);
}

// Feed-level drops only: things no user would want. Everything personal is decided on the phone.
export function dropReason(job, feedCfg, today) {
  const t = ` ${job.title.toLowerCase()} `;
  if (feedCfg.titleExclude.some((w) => t.includes(w))) return 'title-excluded';
  if (!feedCfg.titleMustMatch.some((w) => t.includes(w))) return 'title';
  const c = job.company.toLowerCase();
  if (feedCfg.companyExclude.some((w) => c.includes(w))) return 'company';
  if (job.expires && job.expires < today) return 'expired';
  const ageDays = (Date.parse(today) - Date.parse(job.posted)) / 86400000;
  if (ageDays > feedCfg.maxAgeDays) return 'too-old';
  return null;
}

// One advert posted for many places becomes one entry with a list of places. The entry remembers every
// advert id it holds, so the next run recognises those adverts instead of treating them as new.
// It counts as new from the earliest day any of its adverts was first seen.
export function collapseDuplicates(jobs) {
  const groups = new Map();
  const earlier = (a, b) => (!a ? b : !b ? a : a < b ? a : b);
  for (const j of jobs) {
    const key = `${normCompany(j.company)}|${j.title.toLowerCase().replace(/\s+/g, ' ').trim()}`;
    const locations = (j.locations && j.locations.length ? j.locations : [j.location]).filter(Boolean).map(formatLocation);
    const ids = j.ids && j.ids.length ? j.ids : [j.id];
    const g = groups.get(key);
    if (!g) { groups.set(key, { ...j, locations: [...new Set(locations)], ids: [...new Set(ids)] }); continue; }
    g.locations = [...new Set([...g.locations, ...locations])];
    g.ids = [...new Set([...g.ids, ...ids])];
    if (j.posted > g.posted) { g.posted = j.posted; g.url = j.url; g.id = j.id; }
    g.firstSeen = earlier(g.firstSeen, j.firstSeen);
    if (j.lastSeen && (!g.lastSeen || j.lastSeen > g.lastSeen)) g.lastSeen = j.lastSeen;
    if (j.expires && (!g.expires || j.expires > g.expires)) g.expires = j.expires;
    // The advert read in full gives the text and the sponsorship reading for the whole entry.
    if (j.detail && !g.detail) { g.detail = true; g.summary = j.summary; g.sponsorship = j.sponsorship; }
  }
  return [...groups.values()].map((g) => ({
    ...g,
    copies: g.ids.length,
    location: g.locations.length > 1 ? `${g.locations[0]} and ${g.locations.length - 1} more` : (g.locations[0] || g.location || 'UK'),
  }));
}

// Every advert id an entry stands for.
export const idsOf = (job) => (job.ids && job.ids.length ? job.ids : [job.id]);

const daysBetween = (laterIso, earlierIso) => (Date.parse(laterIso) - Date.parse(earlierIso)) / 86400000;

// Is this entry still worth showing? An advert past its closing date is closed. One that Reed has stopped
// returning is probably closed too, or has fallen out of the pages we read. `lastSeen` is the last day a
// search returned it. Older entries have none, so they count from the day they were first seen.
export function isStale(job, today, staleAfterDays = Infinity) {
  if (job.expires && job.expires < today) return true;
  const seen = job.lastSeen || job.firstSeen || job.posted;
  return daysBetween(today, seen) > staleAfterDays;
}

// Merge today's jobs into the stored list. An advert already seen under any stored entry keeps that
// entry's first-seen date, so "new" means new to the feed and not new to this run. Entries that are
// closed or have not been returned for `staleAfterDays` days are dropped.
export function mergeJobs(existing, fresh, today, keepDays, staleAfterDays = Infinity) {
  const firstSeenById = new Map();
  for (const e of existing) for (const id of idsOf(e)) firstSeenById.set(id, e.firstSeen);
  const byId = new Map(existing.map((j) => [j.id, j]));
  for (const j of fresh) byId.set(j.id, { ...j, firstSeen: firstSeenById.get(j.id) || today, lastSeen: today });
  const cutoff = Date.parse(today) - keepDays * 86400000;
  const kept = [...byId.values()]
    .filter((j) => Date.parse(j.posted) >= cutoff)
    .map(normalisePay);
  // Fold first, so one returned copy keeps a whole entry alive, then drop what is stale.
  return collapseDuplicates(kept)
    .filter((j) => !isStale(j, today, staleAfterDays))
    .sort((a, b) => (b.posted > a.posted ? 1 : b.posted < a.posted ? -1 : 0));
}

// ---------- distance from you ----------
// `places` is data/places.json: rough coordinates for postcode districts ("LE67") and towns ("milton keynes").
// Adverts give a town, a county or "Near LE67", so distances are rough, good to a few miles.

const PLACE_STOP = new Set(['near', 'and', 'more', 'the', 'of', 'north', 'south', 'east', 'west', 'central', 'greater', 'upon', 'on', 'in', 'uk', 'united', 'kingdom', 'england', 'scotland', 'wales']);
const DISTRICT = /^[a-z]{1,2}\d[a-z\d]?$/i;

export function placeCoords(text, places) {
  if (!places || !text) return null;
  const clean = lc(text).replace(/\band \d+ more\b/, '').replace(/\bnear\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const district = (w) => (DISTRICT.test(w) ? places.d[w.toUpperCase()] : null);
  const whole = district(clean) || places.t[clean];
  if (whole) return whole;
  const parts = clean.split(/\s*[,\/|-]\s*|\s+/).filter(Boolean);
  for (const chunk of clean.split(/\s*[,|]\s*/)) if (places.t[chunk]) return places.t[chunk];
  // the longest run of words that names a place, so "South West London" finds London
  for (let n = Math.min(4, parts.length); n >= 1; n -= 1) {
    for (let i = 0; i + n <= parts.length; i += 1) {
      const gram = parts.slice(i, i + n).join(' ');
      if (n === 1 && (PLACE_STOP.has(gram) || gram.length < 3)) continue;
      const hit = places.t[gram] || (n === 1 ? district(gram) : null);
      if (hit) return hit;
    }
  }
  return null;
}

export function milesBetween(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const coordCache = new WeakMap();
// Miles from `origin` ([lat, lon]) to the nearest place the advert names. Null when no place can be measured.
export function distanceMiles(job, origin, places) {
  if (!origin || !places) return null;
  let spots = coordCache.get(job);
  if (!spots || spots.places !== places) {
    const names = job.locations && job.locations.length ? job.locations : [job.location];
    spots = { places, coords: names.map((n) => placeCoords(n, places)).filter(Boolean) };
    coordCache.set(job, spots);
  }
  if (!spots.coords.length) return null;
  return Math.min(...spots.coords.map((c) => milesBetween(origin, c)));
}

// ---------- the personal profile (lives on each user's phone) ----------

export const DEFAULT_PROFILE = {
  roles: [],                 // title keywords. Empty means any title in the feed.
  exclude: ['senior', 'lead', 'principal', 'head of', 'manager', 'director'],
  salaryFloor: 0,            // hide yearly-pay roles whose top pay is below this
  hourlyFloor: 0,            // hide hourly, daily and weekly roles whose hourly equivalent is below this
  salaryTarget: null,        // [low, high]
  regions: [],               // place words. Empty means UK-wide.
  includeRemote: true,
  needsSponsorship: false,
  licensedOnly: false,
  hideAgencies: false,
  similarTitles: true,       // a search for support worker also finds care assistant and similar titles
};

const lc = (s) => String(s || '').toLowerCase();

// Groups of titles that mean much the same job. A search for any word in a group finds the others too.
const SIMILAR_TITLES = [
  ['support worker', 'care worker', 'care assistant', 'carer', 'healthcare assistant', 'health care assistant', 'support assistant', 'residential support', 'enabler'],
  ['customer service', 'customer support', 'customer advisor', 'contact centre', 'call centre'],
  ['administrator', 'admin assistant', 'receptionist', 'data entry', 'office assistant'],
  ['warehouse operative', 'warehouse assistant', 'picker', 'packer', 'forklift'],
  ['kitchen assistant', 'kitchen porter', 'chef', 'cook'],
  ['retail assistant', 'sales assistant', 'shop assistant', 'team member'],
  ['data analyst', 'reporting analyst', 'bi analyst', 'business intelligence analyst', 'insight analyst'],
];

export function expandRoles(roles, similar = true) {
  const out = new Set(roles.map(lc));
  if (similar) {
    for (const r of [...out]) {
      for (const group of SIMILAR_TITLES) if (group.includes(r)) group.forEach((g) => out.add(g));
    }
  }
  return [...out];
}

export function titleMatchesRoles(job, p) {
  if (!p.roles.length) return true;
  const title = lc(job.title);
  return expandRoles(p.roles, p.similarTitles !== false).some((k) => title.includes(k));
}

export function inRegion(job, p) {
  if (!p.regions.length) return true;
  if (p.includeRemote && job.workMode === 'remote') return true;
  const places = (job.locations && job.locations.length ? job.locations : [job.location]).map(lc);
  return p.regions.some((r) => places.some((l) => l.includes(lc(r))));
}

// "Senior" means a management level in analyst work but an ordinary job grade in care and service work,
// so the default "senior" filter only applies to analyst roles.
function hiddenWord(job, p) {
  const title = lc(job.title);
  const analyst = familyOf(job) === 'analyst';
  return p.exclude.some((w) => title.includes(lc(w)) && !(lc(w) === 'senior' && !analyst));
}

// The first reason a job is hidden for this person, or null when it is shown. The order is the order
// the "Why are roles hidden?" panel reports.
export const FILTER_STEPS = ['roles', 'words', 'sponsorship', 'pay', 'place', 'licence', 'recruiter'];

export function filterReason(job, p) {
  if (!titleMatchesRoles(job, p)) return 'roles';
  if (hiddenWord(job, p)) return 'words';
  if (p.needsSponsorship && job.sponsorship === 'refused') return 'sponsorship';
  if (belowPayFloor(job, p)) return 'pay';
  if (!inRegion(job, p)) return 'place';
  if (p.licensedOnly && job.sponsorLicence !== 'licensed') return 'licence';
  if (p.hideAgencies && isRecruiter(job)) return 'recruiter';
  return null;
}

export const matchesProfile = (job, p) => filterReason(job, p) === null;

// Counts for the panel: how many roles each setting removes, and how many are left.
export function explainFilters(jobs, p) {
  const hidden = Object.fromEntries(FILTER_STEPS.map((s) => [s, 0]));
  let shown = 0;
  for (const j of jobs) {
    const r = filterReason(j, p);
    if (r) hidden[r] += 1; else shown += 1;
  }
  return { total: jobs.length, hidden, shown };
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
  if (belowPayFloor(job, p)) { s -= 2; reasons.push('Pay below your floor'); }
  else if ((min || max) && p.salaryTarget) {
    const [lo, hi] = p.salaryTarget;
    const a = min || max, b = max || min;
    if (a <= hi && b >= lo) { s += 0.7; reasons.push('Pay in your range'); }
    else if (a > hi) { s -= 0.3; reasons.push('Pay above your range'); }
  }
  if (belowMinimumWage(job, thresholds)) { s -= 0.5; reasons.push('Pay looks below the minimum wage'); }

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
  const iTown = head.findIndex((h) => h.includes('town'));
  const map = new Map();
  for (const r of rows.slice(1)) {
    if (!r[iName]) continue;
    const route = (r[iRoute] || '').toLowerCase();
    const type = (r[iType] || '').toLowerCase();
    // the value is the registered town, used to confirm an employer's job board. `true` when the register gives none.
    if ((route.includes('skilled worker') || route.includes('health and care')) && type.includes('a rating')) map.set(normCompany(r[iName]), (iTown >= 0 && r[iTown] ? r[iTown].trim() : '') || true);
  }
  return map;
}

// ---------- the register on the phone, and roles added by link ----------

// 32-bit FNV-1a of the normalised company name. 121,000 names fit in about 480 KB as sorted numbers.
export function nameHash(name) {
  const t = normCompany(name);
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i += 1) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

// The register as sorted little-endian 32-bit hashes, one per licensed employer.
export function packRegister(names) {
  const hashes = [...new Set([...names].map((n) => nameHash(n)))].sort((a, b) => a - b);
  const view = new DataView(new ArrayBuffer(hashes.length * 4));
  hashes.forEach((h, i) => view.setUint32(i * 4, h, true));
  return new Uint8Array(view.buffer);
}

// `bytes` is the packed register as an ArrayBuffer or Uint8Array. A 32-bit hash can collide, but only about once in 35,000 lookups.
export function registerHas(bytes, name) {
  if (!bytes || !normCompany(name)) return false;
  const buf = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const view = new DataView(buf);
  const want = nameHash(name);
  let lo = 0, hi = view.byteLength / 4 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = view.getUint32(mid * 4, true);
    if (v === want) return true;
    if (v < want) lo = mid + 1; else hi = mid - 1;
  }
  return false;
}

const titleCase = (slug) => slug.split('-').filter(Boolean).map((w) => (w.length > 2 || /^[a-z]$/i.test(w) ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

// What a job link reveals without opening it. LinkedIn links carry the title and employer. Most others carry nothing.
export function guessFromUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\./, '').replace(/^[a-z]{2}\./, (m) => (m === 'uk.' ? '' : m));
  const names = { 'indeed.com': 'Indeed', 'indeed.co.uk': 'Indeed', 'linkedin.com': 'LinkedIn', 'reed.co.uk': 'Reed', 'adzuna.co.uk': 'Adzuna', 'glassdoor.co.uk': 'Glassdoor', 'glassdoor.com': 'Glassdoor', 'totaljobs.com': 'Totaljobs', 'cv-library.co.uk': 'CV-Library', 'to.indeed.com': 'Indeed' };
  const source = names[host] || host;
  const out = { source, url: u.href };
  if (source === 'LinkedIn') {
    const m = /\/jobs\/view\/(?:([a-z0-9-]*[a-z])-)?(\d{6,})\/?$/i.exec(u.pathname);
    if (m && m[1]) {
      const at = m[1].lastIndexOf('-at-');
      if (at > 0) { out.title = titleCase(m[1].slice(0, at)); out.company = titleCase(m[1].slice(at + 4)); }
      else out.title = titleCase(m[1]);
    }
  } else if (source === 'Reed') {
    const m = /\/jobs\/([a-z0-9-]+)\/\d+/i.exec(u.pathname);
    if (m) out.title = titleCase(m[1]);
  }
  return out;
}

// A role the person added by hand. `register` is the packed register, or null when it could not be loaded.
export function manualJob({ url, title, company, location = '' }, today, register = null) {
  const g = guessFromUrl(url) || {};
  const named = cleanText(company || g.company || '');
  const job = {
    id: `manual-${nameHash(g.url || url).toString(36)}`,
    title: cleanText(title || g.title || 'Role added by link'),
    company: named || 'Employer not given',
    location: formatLocation(location),
    locations: [formatLocation(location)].filter(Boolean),
    url: g.url || url,
    source: g.source || 'Added by you',
    posted: today,
    workMode: detectWorkMode(title, location),
    sponsorship: 'unknown',
    sponsorLicence: !register || !named ? 'unknown' : registerHas(register, named) ? 'licensed' : 'not-found',
    manual: true,
  };
  job.agency = isAgency(job);
  job.family = jobFamily(job.title);
  return job;
}

export function parseReedDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

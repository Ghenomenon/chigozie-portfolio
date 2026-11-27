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

// ---------- tailored CV and cover letter ----------

export const DOC_MARKERS = { keywords: '===KEYWORDS===', cv: '===CV===', letter: '===COVER LETTER===', check: '===CHECK===' };

// The instruction both apps send to Claude, by API or by copy and paste. The reply comes back in three marked parts.
export function docsPrompt({ job, advert = '', screenshots = 0, cv = '' }) {
  const text = advert.trim();
  let advertPart;
  if (text && screenshots) advertPart = `${text}\n\n(A screenshot of the advert is also attached. Use it where the text above is missing or unclear.)`;
  else if (text) advertPart = text;
  else if (screenshots) advertPart = `(The advert is in the attached screenshot${screenshots > 1 ? 's' : ''}. Read it from there.)`;
  else advertPart = '(Not available. Work from the job title and say what you could not check.)';
  return [
    'Tailor my CV and write a cover letter for this job.',
    '',
    'RULES',
    '- Keywords come first. Find the 10 to 15 most important keywords and phrases in the advert: skills, tools, qualifications, duties and the words in the job title. Use the advert\'s exact wording in my CV and letter wherever my CV supports it, in the profile, the skills section and the first bullet points of the most relevant roles. Recruiters and screening software look for these exact words.',
    '- Use only facts that appear in MY CV. Never invent employers, dates, tools, qualifications or numbers. Never add a keyword my CV does not support.',
    '- Reword and reorder to match the advert. Keep my skill levels as written.',
    '- If the advert asks for something my CV does not support, do not cover the gap. List it under CHECK.',
    '- Do not mention my right to work, visa status or sponsorship.',
    '- Plain, direct British English. No filler phrases.',
    '',
    'JOB',
    `Title: ${job.title}`,
    `Company: ${job.company}${job.recruiter ? ' (a recruiter, so the real employer may differ)' : ''}`,
    `Location: ${job.location || 'UK'}`,
    job.pay ? `Pay: ${job.pay}` : null,
    job.url ? `Advert link: ${job.url}` : null,
    '',
    'ADVERT',
    advertPart,
    '',
    'MY CV',
    cv.trim(),
    '',
    'REPLY IN EXACTLY THIS FORMAT, WITH THESE FOUR MARKER LINES AND NOTHING BEFORE THE FIRST ONE',
    DOC_MARKERS.keywords,
    '(the advert\'s keywords, most important first, one per line as "- keyword: used" or "- keyword: not in my CV", using the advert\'s exact wording)',
    DOC_MARKERS.cv,
    '(my tailored CV in markdown, at most two pages, the most relevant results first)',
    DOC_MARKERS.letter,
    '(a cover letter under 250 words that names the company and the role, ready to send, with [square brackets] only where I must fill something in)',
    DOC_MARKERS.check,
    '(a short bullet list: requirements my CV does not support, and anything you were unsure about)',
  ].filter((l) => l !== null).join('\n');
}

// Splits Claude's reply into the CV, the cover letter and the notes to check. It accepts the exact markers and the
// headings people tend to leave when they copy a reply ("## CV", "**Cover letter**"). Returns null when no CV is found.
export function splitDocs(reply) {
  const text = String(reply || '').replace(/\r\n/g, '\n');
  const marker = (name) => new RegExp(`^[ \\t>*#_]*(?:={3,}\\s*${name}\\s*={3,}|${name}\\s*:?)[ \\t*_#]*$`, 'im');
  const find = (names) => {
    for (const n of names) { const m = marker(n).exec(text); if (m) return { start: m.index, end: m.index + m[0].length }; }
    return null;
  };
  const cv = find(['cv', 'tailored cv', 'curriculum vitae', 'resume']);
  const keywords = find(['keywords', 'key words', 'advert keywords']);
  const letter = find(['cover letter', 'covering letter']);
  const check = find(['check', 'things to check', 'gaps and checks']);
  if (!cv) return null;
  const parts = [keywords && { key: 'keywords', ...keywords }, { key: 'cv', ...cv }, letter && { key: 'letter', ...letter }, check && { key: 'check', ...check }].filter(Boolean).sort((a, b) => a.start - b.start);
  const out = { cv: '', letter: '', check: '', keywords: [] };
  parts.forEach((p, i) => { out[p.key] = text.slice(p.end, i + 1 < parts.length ? parts[i + 1].start : text.length).trim(); });
  // a closing code fence left over from a copied reply
  for (const k of ['cv', 'letter', 'check']) out[k] = out[k].replace(/^```\w*\n?|\n?```$/g, '').trim();
  out.keywords = parseKeywords(typeof out.keywords === 'string' ? out.keywords : '');
  return out.cv ? out : null;
}

// "- SQL: used", "- Power BI (not in my CV)", "1. Stakeholder management - used" become { word, supported }.
export function parseKeywords(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/[*_`]/g, '').trim();
    if (!line) continue;
    const m = /^(.*?)(?:\s*[:\u2013\u2014]\s*|\s+-\s+|\s*\()\s*(used|in (?:my |your )?cv|supported|yes|not in (?:my |your )?cv|not supported|missing|no)\b.*$/i.exec(line);
    const word = (m ? m[1] : line).replace(/[\s:(\u2013\u2014-]+$/, '').trim();
    if (!word || word.length > 60) continue;
    const supported = m ? !/^(not|missing|no)\b/i.test(m[2]) : true;
    if (!out.some((k) => k.word.toLowerCase() === word.toLowerCase())) out.push({ word, supported });
  }
  return out.slice(0, 20);
}

// Which keywords appear in a text, ignoring case and spacing ("Power BI" matches "power  bi").
export function keywordsIn(text, keywords) {
  const t = String(text || '').toLowerCase().replace(/\s+/g, ' ');
  return keywords.map((k) => ({ ...k, found: t.includes(k.word.toLowerCase().replace(/\s+/g, ' ')) }));
}

// Adds keywords to the CV's skills section, or adds a "Key skills" section under the first heading when there is
// none. Keywords already in the CV are left alone. Returns the new text and the words it added.
export function addToSkills(cv, words) {
  const text = String(cv || '').replace(/\r\n/g, '\n');
  const lower = text.toLowerCase().replace(/\s+/g, ' ');
  const missing = [...new Set(words.map((w) => String(w).trim()).filter(Boolean))].filter((w) => !lower.includes(w.toLowerCase().replace(/\s+/g, ' ')));
  if (!missing.length) return { text, added: [] };
  const lines = text.split('\n');
  const head = lines.findIndex((l) => /^\s*(#{1,4}\s*|\*\*)?[^#\n]*\b(skills|key skills|technical skills|core skills|competencies)\b/i.test(l) && /^\s*(#{1,4}|\*\*)/.test(l));
  if (head >= 0) {
    // the end of that section: the next heading, or the end of the CV
    let end = lines.findIndex((l, i) => i > head && /^\s*#{1,4}\s/.test(l));
    if (end < 0) end = lines.length;
    while (end > head + 1 && !lines[end - 1].trim()) end -= 1;
    const bullets = lines.slice(head + 1, end).some((l) => /^\s*[-*•]\s/.test(l));
    if (bullets) lines.splice(end, 0, ...missing.map((w) => `- ${w}`));
    else if (end > head + 1) lines[end - 1] = `${lines[end - 1].replace(/[.\s]+$/, '')}, ${missing.join(', ')}`;   // a comma list: add to it
    else lines.splice(end, 0, missing.join(', '));
    return { text: lines.join('\n'), added: missing };
  }
  const first = lines.findIndex((l) => /^\s*#{1,4}\s/.test(l));
  const section = ['', '## Key skills', ...missing.map((w) => `- ${w}`), ''];
  if (first < 0) return { text: `${text.trim()}\n${section.join('\n')}`.trim(), added: missing };
  // after the name heading and any short block under it (contact line, profile)
  let at = first + 1;
  while (at < lines.length && !/^\s*#{1,4}\s/.test(lines[at])) at += 1;
  lines.splice(at, 0, ...section);
  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n'), added: missing };
}

// Asks Claude to work the chosen keywords into the CV and letter it already wrote. `confirmed` keywords are ones the
// person says are true even though their CV does not show them.
export function keywordsPrompt({ job, cv = '', tailoredCv = '', letter = '', keywords = [] }) {
  const backed = keywords.filter((k) => !k.confirmed).map((k) => k.word);
  const confirmed = keywords.filter((k) => k.confirmed).map((k) => k.word);
  return [
    `Revise my tailored CV and cover letter for ${job.title} at ${job.company}.`,
    '',
    'USE THESE KEYWORDS, WITH THIS EXACT WORDING',
    backed.length ? `Supported by my CV: ${backed.join(', ')}` : null,
    confirmed.length ? `I confirm these are true for me, though my CV does not show them yet: ${confirmed.join(', ')}. Add them to the skills section, and to a role only where my CV already describes related work.` : null,
    '',
    'RULES',
    '- Work each keyword in where it fits naturally: the profile, the skills section, and the first bullet points of the most relevant roles.',
    '- Do not invent employers, dates, results, numbers or qualifications. Keep everything else as it is unless a keyword needs it.',
    '- Plain, direct British English.',
    '',
    'MY ORIGINAL CV, FOR THE FACTS',
    cv.trim(),
    '',
    'THE TAILORED CV TO REVISE',
    tailoredCv.trim(),
    '',
    'THE COVER LETTER TO REVISE',
    letter.trim(),
    '',
    'REPLY IN EXACTLY THIS FORMAT',
    DOC_MARKERS.keywords,
    '(each keyword, one per line, as "- keyword: used")',
    DOC_MARKERS.cv,
    '(the revised CV in markdown)',
    DOC_MARKERS.letter,
    '(the revised cover letter)',
    DOC_MARKERS.check,
    '(anything I should check, as bullets)',
  ].filter((l) => l !== null).join('\n');
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Enough markdown for a CV: headings, bullet lists, bold, italic and paragraphs. Everything is escaped first.
export function mdToHtml(md) {
  const inline = (s) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>');
  const out = [];
  let list = false, para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const close = () => { if (list) { out.push('</ul>'); list = false; } };
  for (const raw of String(md || '').replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (!line.trim()) { flush(); close(); continue; }
    if (h) { flush(); close(); const n = Math.min(h[1].length + 1, 4); out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }
    if (li) { flush(); if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    if (/^-{3,}$/.test(line.trim())) { flush(); close(); out.push('<hr>'); continue; }
    close(); para.push(line.trim());
  }
  flush(); close();
  return out.join('\n');
}

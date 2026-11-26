// Employer job boards. Greenhouse, Lever, Ashby, SmartRecruiters and Workable publish each employer's own adverts as open JSON.
// The daily job looks for a board for every licensed sponsor it sees in Reed and Adzuna, remembers what it
// finds, and reads those boards each day. Adverts come with their full text and no middleman.

import { normCompany, cleanText } from './lib.mjs';

export const ATS = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable'];

export const boardUrl = {
  greenhouse: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
  lever: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
  ashby: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
  // UK adverts only, 100 to a page
  smartrecruiters: (slug, offset = 0) => `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100&country=gb&offset=${offset}`,
  workable: (slug) => `https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`,
};

// Reads one board. Most boards are one call. SmartRecruiters lists adverts without their text, so it pages
// through the UK list (up to 300) and reads the full text of recent adverts (up to `detailCap`, 25 by default).
export async function fetchBoard(ats, slug, getJson, { today = new Date().toISOString().slice(0, 10), freshDays = 30, detailCap = 25 } = {}) {
  if (ats !== 'smartrecruiters') return getJson(boardUrl[ats](slug));
  const content = [];
  for (let offset = 0; offset < 300; offset += 100) {
    const page = await getJson(boardUrl.smartrecruiters(slug, offset));
    content.push(...(page.content || []));
    if (!page.content || page.content.length < 100 || content.length >= (page.totalFound || 0)) break;
  }
  const fresh = content.filter((p) => (Date.parse(today) - Date.parse(p.releasedDate || 0)) / 86400000 <= freshDays).slice(0, detailCap);
  for (const p of fresh) {
    try { p._detail = await getJson(`https://api.smartrecruiters.com/v1/companies/${slug}/postings/${p.id}`); } catch { /* listed without its text */ }
  }
  return { content };
}

// ---------- places ----------

const UK_WORD = /\b(uk|u\.k\.|united kingdom|great britain|england|scotland|wales|northern ireland)\b/i;
const FOREIGN = /\b(usa|u\.s\.a?\.?|united states|canada|india|germany|france|spain|ireland|australia|singapore|netherlands|poland|portugal|brazil|mexico|japan|china|dubai|uae|israel|sweden|norway|denmark|italy|switzerland|belgium|romania|argentina|colombia|philippines|nigeria|kenya|egypt|turkey|ukraine|lithuania|estonia|latvia|czech|hungary|bulgaria|greece|austria|finland|new zealand|south africa)\b/i;
// Big cities abroad. Some share a name with a small UK place (there is a New York in Lincolnshire).
const FOREIGN_CITY = /\b(new york|nyc|san francisco|los angeles|boston|chicago|seattle|austin|denver|atlanta|miami|washington|philadelphia|houston|dallas|san diego|san jose|palo alto|menlo park|mountain view|toronto|vancouver|montreal|ottawa|paris|berlin|munich|hamburg|frankfurt|amsterdam|dublin|cork|madrid|barcelona|lisbon|milan|rome|stockholm|copenhagen|oslo|helsinki|zurich|geneva|vienna|warsaw|krakow|prague|budapest|bucharest|athens|tel aviv|bangalore|bengaluru|hyderabad|mumbai|delhi|gurgaon|gurugram|pune|chennai|sydney|melbourne|brisbane|perth|tokyo|seoul|hong kong|shanghai|beijing|shenzhen|taipei|sao paulo|são paulo|mexico city|cape town|johannesburg|lagos|nairobi|cairo|manila|kuala lumpur|jakarta|bangkok|ho chi minh|auckland|buenos aires|bogota|bogotá|lima|santiago)\b/i;
const BARE_US = /(^|[\s,(/-])US($|[\s,)/-])/;
const US_STATE = /(^|[\s,])(AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY|ON|BC|QC|AB)(\s|,|$)/;

// True when a location string, or an explicit country code, puts the advert in the UK.
export function isUkLocation(text, { country = '', places = null } = {}) {
  const c = String(country).trim().toUpperCase();
  if (c === 'GB' || c === 'UK' || c === 'UNITED KINGDOM') return true;
  if (c && c !== 'GB') return false;
  const t = String(text || '').trim();
  if (!t) return false;
  if (UK_WORD.test(t)) return true;
  if (FOREIGN.test(t) || FOREIGN_CITY.test(t) || BARE_US.test(t) || US_STATE.test(t)) return false;
  if (!places) return false;
  // a bare place such as "London", or "London, Greater London", with no other country named
  // words such as "office" or "hybrid" are left off, so "London office" counts as London
  const bare = (part) => part.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\b(office|offices|hq|area|hub|based|campus|hybrid|remote|on-?site|or)\b/g, ' ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.split(/\s*[,;/|]\s*|\s+-\s+/).some((part) => Boolean(places.t[bare(part)]));
}

// ---------- reading one board ----------

const decode = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const day = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(typeof v === 'number' ? v : String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

// Turns one board's JSON into the shape the daily job uses for Reed and Adzuna adverts.
// Only UK adverts are kept. `company` is the name on the sponsor register.
export function readBoard(ats, slug, data, company, { places = null, today } = {}) {
  const out = [];
  const add = (j) => {
    if (!j.title || !j.url || !j.id) return;
    out.push({
      id: `${ats}-${slug}-${j.id}`,
      title: String(j.title).trim(),
      company,
      location: j.location || '',
      url: j.url,
      source: 'Employer site',
      posted: j.posted || today,
      salaryMin: null,
      salaryMax: null,
      description: j.description || '',
      _full: true,                       // the whole advert, so no second read is needed
    });
  };
  if (ats === 'greenhouse') {
    for (const j of data.jobs || []) {
      const loc = j.location?.name || '';
      if (!isUkLocation(loc, { places })) continue;
      add({ id: j.id, title: j.title, url: j.absolute_url, location: loc, posted: day(j.first_published || j.updated_at), description: cleanText(decode(j.content)) });
    }
  } else if (ats === 'lever') {
    for (const j of Array.isArray(data) ? data : []) {
      const loc = j.categories?.location || '';
      if (!isUkLocation(loc, { country: j.country || '', places })) continue;
      const remote = j.workplaceType === 'remote' ? ' Remote.' : '';
      add({ id: j.id, title: j.text, url: j.hostedUrl, location: loc, posted: day(j.createdAt), description: `${j.descriptionPlain || ''}\n${(j.lists || []).map((l) => `${l.text} ${cleanText(l.content)}`).join('\n')}\n${j.additionalPlain || ''}${remote}` });
    }
  } else if (ats === 'ashby') {
    for (const j of data.jobs || []) {
      if (j.isListed === false) continue;
      const country = j.address?.postalAddress?.addressCountry || '';
      const loc = j.location || '';
      const here = isUkLocation(loc, { country, places })
        || (j.secondaryLocations || []).some((s) => isUkLocation(s.location, { places }));
      if (!here) continue;
      add({ id: j.id, title: j.title, url: j.jobUrl, location: loc, posted: day(j.publishedAt), description: `${j.descriptionPlain || ''}${j.isRemote ? ' Remote.' : ''}${j.workplaceType === 'Hybrid' ? ' Hybrid.' : ''}` });
    }
  } else if (ats === 'smartrecruiters') {
    for (const j of data.content || []) {
      const l = j.location || {};
      const loc = (l.fullLocation || [l.city, l.region].filter(Boolean).join(', ')).replace(/(\s*,\s*)+/g, ', ').replace(/^, |, $/g, '');
      if (!isUkLocation(loc, { country: l.country === 'gb' ? 'GB' : (l.country || ''), places })) continue;
      const sections = j._detail?.jobAd?.sections || {};
      const text = ['jobDescription', 'qualifications', 'additionalInformation'].map((k) => cleanText(sections[k]?.text || '')).filter(Boolean).join('\n');
      const company = j.company?.identifier || slug;
      add({ id: j.id, title: j.name, url: j._detail?.postingUrl || `https://jobs.smartrecruiters.com/${company}/${j.id}`, location: loc, posted: day(j.releasedDate), description: `${text}${l.remote ? ' Remote.' : ''}${l.hybrid ? ' Hybrid.' : ''}` });
    }
  } else if (ats === 'workable') {
    for (const j of data.jobs || []) {
      const first = (j.locations || []).find((x) => !x.hidden) || {};
      const country = first.countryCode || '';
      const loc = [j.city || first.city, j.state || first.region, j.country || first.country].filter(Boolean).join(', ');
      const here = isUkLocation(loc, { country, places }) || (j.locations || []).some((x) => !x.hidden && (x.countryCode || '').toUpperCase() === 'GB');
      if (!here) continue;
      const text = [j.description, j.requirements, j.benefits].map((t) => cleanText(t || '')).filter(Boolean).join('\n');
      add({ id: j.shortcode || j.code || j.id, title: j.title, url: j.url || j.shortlink || j.application_url, location: loc, posted: day(j.published_on || j.created_at), description: `${text}${j.telecommuting ? ' Remote.' : ''}` });
    }
  }
  return out;
}

// ---------- finding a board ----------

const GENERIC = new Set(['british', 'national', 'first', 'global', 'north', 'south', 'east', 'west', 'central', 'london', 'the', 'new', 'royal', 'general', 'united', 'city', 'county', 'international', 'group', 'health', 'care', 'support', 'services', 'solutions', 'systems', 'digital', 'online', 'technology', 'technologies']);

// Words that often follow a company's short name ("Monzo Bank", "Ripple Labs"). A board named after the
// first word only counts when every other word of the employer's name is one of these.
const CORPORATE = new Set(['bank', 'global', 'technologies', 'technology', 'tech', 'software', 'labs', 'lab', 'capital', 'financial', 'finance', 'digital', 'systems', 'solutions', 'studios', 'studio', 'energy', 'payments', 'pay', 'networks', 'network', 'international', 'europe', 'ventures', 'media', 'games', 'ai', 'analytics', 'data', 'security', 'cloud', 'partners', 'consulting', 'engineering', 'research', 'therapeutics', 'biosciences', 'markets', 'trading', 'investments', 'platforms', 'platform', 'online', 'app', 'apps', 'io', 'hq', 'co', 'company', 'corporation', 'corp']);

const wordsOf = (name) => normCompany(name).split(' ').filter(Boolean);
const restIsCorporate = (words) => words.slice(1).every((w) => CORPORATE.has(w));

export function slugGuesses(name) {
  const words = wordsOf(name);
  if (!words.length) return [];
  const out = new Set([words.join(''), words.join('-')]);
  // the short name alone, only for names like "Monzo Bank", never for "Atlas Care Homes"
  if (words.length > 1 && words[0].length >= 4 && !GENERIC.has(words[0]) && restIsCorporate(words)) out.add(words[0]);
  return [...out].filter((s) => s.length >= 3 && s.length <= 40);
}

const textOf = (ats, j) => {
  if (ats === 'greenhouse') return `${j.title || ''} ${cleanText(decode(j.content))}`;
  if (ats === 'smartrecruiters') return `${j.name || ''} ${Object.values(j._detail?.jobAd?.sections || {}).map((x) => cleanText(x.text || '')).join(' ')}`;
  if (ats === 'workable') return `${j.title || ''} ${cleanText(j.description || '')}`;
  return `${j.title || j.text || ''} ${j.descriptionPlain || ''}`;
};
const sampleOf = (ats, data) => {
  if (ats === 'lever') return Array.isArray(data) ? data : [];
  if (ats === 'smartrecruiters') return data.content || [];
  return data.jobs || [];
};
// The company name the board itself gives, where it gives one.
const companyNameOf = (ats, data) => {
  if (ats === 'greenhouse') return data.jobs?.[0]?.company_name || '';
  if (ats === 'smartrecruiters') return data.content?.[0]?.company?.name || '';
  if (ats === 'workable') return data.name || '';
  return '';
};
const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A board with the right name may still belong to another company.
// - Greenhouse, SmartRecruiters and Workable name the company, and that name has to be the employer's (or its
//   short name, when the rest is a word such as Bank or Labs).
// - Lever and Ashby do not, so the employer's name has to appear, with a capital letter, in most adverts.
//   The link is left out: it holds the guessed name, so it would always match.
export function boardBelongsTo(name, ats, data) {
  const words = wordsOf(name);
  if (!words.length) return false;
  const full = words.join(' ');
  if (companyNameOf(ats, data)) {
    const given = wordsOf(companyNameOf(ats, data));
    const g = given.join(' ');
    if (g === full) return true;
    if (given.length === 1 && g === words[0] && restIsCorporate(words)) return true;
    if (words.length === 1 && given[0] === full && restIsCorporate(given)) return true;
    return false;
  }
  const sample = sampleOf(ats, data).slice(0, 6);
  if (!sample.length) return false;
  // the employer's name as written in an advert: each word capitalised, any spacing or punctuation between
  const phrase = restIsCorporate(words) ? [words[0]] : words;
  const re = new RegExp(`\\b${phrase.map((w) => (/^\d/.test(w) ? escape(w) : `[${w[0].toUpperCase()}]${escape(w.slice(1))}`)).join('[\\s.,&-]+')}\\b`, 'i');
  const capital = new RegExp(`\\b${escape(phrase[0][0].toUpperCase())}`);
  const hits = sample.filter((j) => { const t = textOf(ats, j); const m = re.exec(t); return m && capital.test(m[0]); }).length;
  return hits >= Math.ceil(sample.length / 2);
}

// The checks a board must pass, besides belonging to the employer: it has UK adverts, and when only the short
// name matched, at least one of them is in the town the register gives for the employer.
export function boardFits(name, ats, slug, data, { places = null, town = '' } = {}) {
  if (!boardBelongsTo(name, ats, data)) return false;
  const uk = readBoard(ats, slug, data, name, { places, today: '2000-01-01' });
  if (!uk.length) return false;
  const words = wordsOf(name);
  const shortMatch = words.length === 1 || slug === words[0];
  if (shortMatch && town && typeof town === 'string') {
    const t = town.toLowerCase();
    return uk.some((a) => a.location.toLowerCase().includes(t));
  }
  return true;
}

// A board service that answers "too many requests" is left alone for the rest of the run.
const limited = (e) => /\b429\b|gave up after retries/.test(String(e?.message || e));

async function probeOne(name, getJson, opts) {
  for (const ats of ATS) {
    if (opts.paused?.has(ats)) continue;
    for (const slug of slugGuesses(name)) {
      let data;
      try { data = await fetchBoard(ats, slug, getJson, opts); } catch (e) { if (limited(e)) { opts.paused?.add(ats); break; } continue; }   // no such board
      const jobs = sampleOf(ats, data);
      if (Array.isArray(jobs) && jobs.length && boardFits(name, ats, slug, data, opts)) return { ats, slug };
    }
  }
  return null;
}

// Boards found under earlier, looser rules are checked again once. RULES goes up when the rules change.
export const RULES = 2;

// Looks for boards for employers not tried recently. `cache` is { found, missed }, keyed by normalised name.
// Returns counts. `limit` caps how many employers are tried in one run.
export async function discoverBoards(names, cache, { today, getJson, limit = 150, recheckDays = 30, concurrency = 6, places = null, townOf = () => '', paused = new Set() }) {
  const daysSince = (d) => (Date.parse(today) - Date.parse(d)) / 86400000;
  const boardKey = (b) => `${b.ats}/${b.slug}`;
  const opts = { places, today, paused };

  // 0. When a board service is added, employers missed before are tried again.
  let retried = 0;
  if (cache.services !== ATS.join(',')) {
    retried = Object.keys(cache.missed).length;
    cache.missed = {};
    cache.services = ATS.join(',');
  }

  // 1. Boards kept under older rules are checked again. Two employers cannot share one board.
  let dropped = 0;
  const claimed = new Map();
  for (const [key, b] of Object.entries(cache.found).sort(([a], [c]) => (a < c ? -1 : 1))) {
    if (b.rules === RULES) { claimed.set(boardKey(b), key); continue; }
    let ok = false;
    try { ok = !claimed.has(boardKey(b)) && boardFits(b.name, b.ats, b.slug, await fetchBoard(b.ats, b.slug, getJson, opts), { places, town: townOf(key) }); } catch { ok = false; }
    if (ok) { b.rules = RULES; claimed.set(boardKey(b), key); } else { delete cache.found[key]; cache.missed[key] = today; dropped++; }
  }
  for (const [key, b] of Object.entries(cache.found)) if (!claimed.has(boardKey(b))) claimed.set(boardKey(b), key);

  // 2. New employers.
  const todo = [];
  for (const name of names) {
    const key = normCompany(name);
    if (!key || cache.found[key]) continue;
    if (cache.missed[key] && daysSince(cache.missed[key]) < recheckDays) continue;
    todo.push({ name, key });
  }
  const batch = todo.slice(0, limit);
  let next = 0, hits = 0;
  const worker = async () => {
    while (next < batch.length) {
      const item = batch[next++];
      const hit = await probeOne(item.name, getJson, { ...opts, town: townOf(item.key) });
      if (hit && !claimed.has(boardKey(hit))) {
        claimed.set(boardKey(hit), item.key);
        cache.found[item.key] = { name: item.name, ...hit, found: today, rules: RULES };
        delete cache.missed[item.key];
        hits++;
      } else cache.missed[item.key] = today;
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { tried: batch.length, found: hits, waiting: todo.length - batch.length, dropped, retried, paused: [...paused] };
}

// Reads every known board. A board that has gone (404) is dropped from the cache and tried again later.
export async function readBoards(cache, { today, getJson, places = null, concurrency = 6, paused = new Set() }) {
  const entries = Object.entries(cache.found);
  const out = [];
  let failed = 0, gone = 0, next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const [key, b] = entries[next++];
      if (paused.has(b.ats)) { failed++; continue; }
      try {
        const data = await fetchBoard(b.ats, b.slug, getJson, { today, paused });
        out.push(...readBoard(b.ats, b.slug, data, b.name, { places, today }));
      } catch (e) {
        if (limited(e)) { paused.add(b.ats); failed++; }
        else if (/^404 /.test(e.message)) { delete cache.found[key]; cache.missed[key] = today; gone++; } else failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { raw: out, boards: entries.length, failed, gone };
}

// Names that suggest an employer with its own recruiting system. These are tried first.
const LIKELY = /\b(technolog\w*|software|data|analytic\w*|digital|labs?|ai|cloud|cyber|fintech|bank|banking|capital|financ\w*|pay\w*|insur\w*|assurance|consult\w*|engineering|research|pharma\w*|therapeutic\w*|bio\w*|energy|media|games?|networks?|systems|robotics|semiconductor\w*|ventures|health ?tech|medtech|logistics|mobility)\b/;

// A rotating slice of the sponsor register, so that every run tries employers it has not tried before.
// `keys` are normalised names. Four in five come from names that suggest a tech or finance employer.
// The slice moves on each day and wraps round.
export function registerSlice(keys, today, size) {
  const sorted = [...new Set(keys)].sort();
  if (!sorted.length || size <= 0) return [];
  const likely = sorted.filter((k) => LIKELY.test(k)), rest = sorted.filter((k) => !LIKELY.test(k));
  const dayNumber = Math.floor(Date.parse(today) / 86400000);
  const take = (list, n) => (list.length ? Array.from({ length: Math.min(n, list.length) }, (_, i) => list[(dayNumber * n + i) % list.length]) : []);
  const nLikely = likely.length ? Math.min(Math.ceil(size * 0.8), likely.length) : 0;
  const out = [...take(likely, nLikely), ...take(rest, size - nLikely)];
  return [...new Set(out)].slice(0, size);
}

export const displayName = (key) => key.replace(/\b[a-z]/g, (c) => c.toUpperCase());

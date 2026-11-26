// Employer job boards. Greenhouse, Lever and Ashby publish each employer's own adverts as open JSON.
// The daily job looks for a board for every licensed sponsor it sees in Reed and Adzuna, remembers what it
// finds, and reads those boards each day. Adverts come with their full text and no middleman.

import { normCompany, cleanText } from './lib.mjs';

export const ATS = ['greenhouse', 'lever', 'ashby'];

export const boardUrl = {
  greenhouse: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
  lever: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
  ashby: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
};

// ---------- places ----------

const UK_WORD = /\b(uk|u\.k\.|united kingdom|great britain|england|scotland|wales|northern ireland)\b/i;
const FOREIGN = /\b(usa|u\.s\.a?\.?|united states|canada|india|germany|france|spain|ireland|australia|singapore|netherlands|poland|portugal|brazil|mexico|japan|china|dubai|uae|israel|sweden|norway|denmark|italy|switzerland|belgium|romania|argentina|colombia|philippines|nigeria|kenya|egypt|turkey|ukraine|lithuania|estonia|latvia|czech|hungary|bulgaria|greece|austria|finland|new zealand|south africa)\b/i;
const US_STATE = /(^|[\s,])(AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY|ON|BC|QC|AB)(\s|,|$)/;

// True when a location string, or an explicit country code, puts the advert in the UK.
export function isUkLocation(text, { country = '', places = null } = {}) {
  const c = String(country).trim().toUpperCase();
  if (c === 'GB' || c === 'UK' || c === 'UNITED KINGDOM') return true;
  if (c && c !== 'GB') return false;
  const t = String(text || '').trim();
  if (!t) return false;
  if (UK_WORD.test(t)) return true;
  if (FOREIGN.test(t) || US_STATE.test(t)) return false;
  if (!places) return false;
  // a bare place such as "London", or "London, Greater London", with no other country named
  return t.split(/\s*[,;/|]\s*|\s+-\s+/).some((part) => Boolean(places.t[part.toLowerCase()]));
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
  }
  return out;
}

// ---------- finding a board ----------

const GENERIC = new Set(['british', 'national', 'first', 'global', 'north', 'south', 'east', 'west', 'central', 'london', 'the', 'new', 'royal', 'general', 'united', 'city', 'county', 'international', 'group', 'health', 'care', 'support', 'services', 'solutions', 'systems', 'digital', 'online', 'technology', 'technologies']);

export function slugGuesses(name) {
  const words = normCompany(name).split(' ').filter(Boolean);
  if (!words.length) return [];
  const out = new Set([words.join(''), words.join('-')]);
  if (words.length > 1 && words[0].length >= 4 && !GENERIC.has(words[0])) out.add(words[0]);
  return [...out].filter((s) => s.length >= 3 && s.length <= 40);
}

// A board with the right name may still belong to another company. The first word of the employer's name
// has to appear in most of the adverts, or Greenhouse has to name the same company.
export function boardBelongsTo(name, ats, data) {
  const words = normCompany(name).split(' ').filter(Boolean);
  if (!words.length) return false;
  if (ats === 'greenhouse') {
    const given = normCompany(data.jobs?.[0]?.company_name || '');
    if (given && (given === words.join(' ') || given.startsWith(words[0]) || words.join(' ').startsWith(given))) return true;
  }
  const sample = ats === 'greenhouse' ? (data.jobs || []) : ats === 'lever' ? (Array.isArray(data) ? data : []) : (data.jobs || []);
  if (!sample.length) return false;
  const head = words[0];
  // the link is left out of the text: it holds the guessed name, so it would always match
  const text = (j) => `${j.title || j.text || ''} ${j.content || j.descriptionPlain || ''}`.toLowerCase();
  const hits = sample.slice(0, 6).filter((j) => text(j).includes(head)).length;
  return hits >= Math.ceil(Math.min(sample.length, 6) / 2);
}

async function probeOne(name, getJson) {
  for (const ats of ATS) {
    for (const slug of slugGuesses(name)) {
      let data;
      try { data = await getJson(boardUrl[ats](slug)); } catch { continue; }   // no such board
      const jobs = ats === 'lever' ? data : data.jobs;
      if (Array.isArray(jobs) && jobs.length && boardBelongsTo(name, ats, data)) return { ats, slug };
    }
  }
  return null;
}

// Looks for boards for employers not tried recently. `cache` is { found, missed }, keyed by normalised name.
// Returns counts. `limit` caps how many employers are tried in one run.
export async function discoverBoards(names, cache, { today, getJson, limit = 150, recheckDays = 30, concurrency = 6 }) {
  const daysSince = (d) => (Date.parse(today) - Date.parse(d)) / 86400000;
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
      const hit = await probeOne(item.name, getJson);
      if (hit) { cache.found[item.key] = { name: item.name, ...hit, found: today }; delete cache.missed[item.key]; hits++; }
      else cache.missed[item.key] = today;
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { tried: batch.length, found: hits, waiting: todo.length - batch.length };
}

// Reads every known board. A board that has gone (404) is dropped from the cache and tried again later.
export async function readBoards(cache, { today, getJson, places = null, concurrency = 6 }) {
  const entries = Object.entries(cache.found);
  const out = [];
  let failed = 0, gone = 0, next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const [key, b] = entries[next++];
      try {
        const data = await getJson(boardUrl[b.ats](b.slug));
        out.push(...readBoard(b.ats, b.slug, data, b.name, { places, today }));
      } catch (e) {
        if (/^404 /.test(e.message)) { delete cache.found[key]; cache.missed[key] = today; gone++; } else failed++;
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

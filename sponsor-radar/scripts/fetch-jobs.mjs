// Daily job fetch. Run by GitHub Actions, or locally with: node jobs/scripts/fetch-jobs.mjs
// Sources: Reed (REED_API_KEY) and Adzuna (ADZUNA_APP_ID + ADZUNA_APP_KEY). A source with no key is skipped.
// Sponsor licences come from the Home Office register of licensed sponsors.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildJob, dropReason, mergeJobs, sponsorMapFromCsv, parseReedDate, idsOf, normCompany,
} from './lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
const dataPath = process.env.FEED_PATH || join(root, 'data', 'jobs.json');
const today = new Date().toISOString().slice(0, 10);

// FETCH_DELAY_MS lets tests run without waiting. Real runs keep the polite gaps.
const sleep = (ms) => new Promise((r) => setTimeout(r, process.env.FETCH_DELAY_MS !== undefined ? Number(process.env.FETCH_DELAY_MS) : ms));

async function getJson(url, headers = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'sponsor-radar/1.0', ...headers } });
    if (res.status === 429 || res.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`${res.status} ${url.split('?')[0]}`);
    return res.json();
  }
  throw new Error(`gave up after retries ${url.split('?')[0]}`);
}

async function loadSponsorMap() {
  try {
    const page = await (await fetch('https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers')).text();
    const m = /href="(https:\/\/assets\.publishing\.service\.gov\.uk\/[^"]+\.csv)"/.exec(page);
    if (!m) throw new Error('register link not found');
    const csv = await (await fetch(m[1])).text();
    const map = sponsorMapFromCsv(csv);
    console.log(`Sponsor register: ${map.size} Skilled Worker employers`);
    return map.size > 1000 ? map : null;
  } catch (e) {
    console.warn(`Sponsor register unavailable: ${e.message}`);
    return null;
  }
}

const errors = [];

async function fromReed(query) {
  const key = process.env.REED_API_KEY;
  if (!key) return [];
  const auth = { Authorization: 'Basic ' + Buffer.from(`${key}:`).toString('base64') };
  const out = [];
  for (let page = 0; page < cfg.pagesPerQuery; page++) {
    const url = `https://www.reed.co.uk/api/1.0/search?keywords=${encodeURIComponent(query)}&resultsToTake=100&resultsToSkip=${page * 100}`;
    let data;
    try { data = await getJson(url, auth); } catch (e) {
      if (page === 0) throw e;                       // nothing for this search at all
      errors.push(`fromReed "${query}" page ${page + 1}: ${e.message}`);
      break;                                         // keep the pages already read
    }
    const results = data.results || [];
    for (const r of results) {
      out.push({
        id: `reed-${r.jobId}`,
        title: r.jobTitle,
        company: r.employerName,
        location: r.locationName,
        url: r.jobUrl,
        source: 'Reed',
        posted: parseReedDate(r.date),
        salaryMin: r.minimumSalary || null,
        salaryMax: r.maximumSalary || null,
        description: r.jobDescription || '',
        _detailAuth: auth,
        _detailUrl: `https://www.reed.co.uk/api/1.0/jobs/${r.jobId}`,
      });
    }
    if (results.length < 100) break;                 // last page
    await sleep(250);
  }
  return out;
}

async function fromAdzuna(query) {
  const id = process.env.ADZUNA_APP_ID, key = process.env.ADZUNA_APP_KEY;
  if (!id || !key) return [];
  const out = [];
  const pages = cfg.pagesPerQuery * 2;               // Adzuna pages hold 50, Reed pages hold 100
  for (let page = 1; page <= pages; page++) {
    const url = `https://api.adzuna.com/v1/api/jobs/gb/search/${page}?app_id=${id}&app_key=${key}&results_per_page=50`
      + `&what=${encodeURIComponent(query)}&sort_by=date&max_days_old=${cfg.maxAgeDays}`;
    let data;
    try { data = await getJson(url); } catch (e) {
      if (page === 1) throw e;
      errors.push(`fromAdzuna "${query}" page ${page}: ${e.message}`);
      break;
    }
    const results = data.results || [];
    for (const r of results) {
      out.push({
        id: `adzuna-${r.id}`,
        title: r.title.replace(/<[^>]+>/g, ''),
        company: r.company?.display_name || 'Unknown',
        location: r.location?.display_name || '',
        url: r.redirect_url,
        source: 'Adzuna',
        posted: (r.created || '').slice(0, 10) || today,
        salaryMin: r.salary_min ? Math.round(r.salary_min) : null,
        salaryMax: r.salary_max ? Math.round(r.salary_max) : null,
        description: r.description || '',
      });
    }
    if (results.length < 50) break;
    await sleep(250);
  }
  return out;
}

async function main() {
  const existing = (() => {
    try { return JSON.parse(readFileSync(dataPath, 'utf8')).jobs || []; } catch { return []; }
  })();
  // Every advert id a stored entry stands for, so adverts folded into one entry are still recognised.
  const known = new Map(existing.flatMap((j) => idsOf(j).map((id) => [id, j])));

  const sponsorMap = await loadSponsorMap();
  const raw = [];
  for (const q of cfg.queries) {
    for (const src of [fromReed, fromAdzuna]) {
      try { raw.push(...await src(q)); } catch (e) { errors.push(`${src.name} "${q}": ${e.message}`); }
      await sleep(250);
    }
  }
  if (!process.env.REED_API_KEY && !(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY)) {
    console.warn('No API keys set. Add REED_API_KEY or ADZUNA_APP_ID and ADZUNA_APP_KEY as repository secrets.');
  }

  // De-duplicate across sources and queries by id.
  const seen = new Set();
  const unique = raw.filter((r) => {
    if (!r.posted || !r.id || !r.title || !r.company) return false;
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  // The feed only drops what no user would want. Pay, region and seniority are decided on each phone.
  const stats = {};
  const candidates = [];
  for (const r of unique) {
    const job = buildJob(r, cfg, sponsorMap);
    const reason = dropReason(job, cfg, today);
    if (reason) { stats[reason] = (stats[reason] || 0) + 1; continue; }
    candidates.push({ r, job });
  }

  // Full text. Reed's search gives only a short snippet, so sponsorship wording is read from a second
  // call per advert. Copies of one advert (same employer and title) share one read. An entry is marked
  // `detail` once its full text has been read, so a run that hits the cap does not lose the rest: new
  // adverts are read first, then the unread backlog, and a failed read is retried on the next run.
  const groupKey = (j) => `${normCompany(j.company)}|${j.title.toLowerCase().replace(/\s+/g, ' ').trim()}`;
  const storedByKey = new Map(existing.map((e) => [groupKey(e), e]));
  const groups = new Map();
  for (const c of candidates) {
    const k = groupKey(c.job);
    let g = groups.get(k);
    if (!g) { g = { members: [], stored: storedByKey.get(k) || null, readNow: false }; groups.set(k, g); }
    g.members.push(c);
  }
  const cap = Number(process.env.MAX_DETAIL_FETCHES ?? cfg.maxDetailFetches);
  const newestFirst = (a, b) => (b.job.posted > a.job.posted ? 1 : b.job.posted < a.job.posted ? -1 : 0);
  const needsRead = [...groups.values()]
    .filter((g) => !g.stored?.detail && g.members.some((m) => m.r._detailUrl))
    .map((g) => ({ g, rep: [...g.members].filter((m) => m.r._detailUrl).sort(newestFirst)[0] }));
  const isNewGroup = (x) => !x.g.stored && !x.g.members.some((m) => known.has(m.r.id));
  needsRead.sort((a, b) => (isNewGroup(b) - isNewGroup(a)) || newestFirst(a.rep, b.rep));

  let detailCalls = 0, readNew = 0, readBacklog = 0, failed = 0;
  for (const x of needsRead) {
    if (detailCalls >= cap) break;
    detailCalls++;
    try {
      const d = await getJson(x.rep.r._detailUrl, x.rep.r._detailAuth);
      if (!d.jobDescription) throw new Error('empty advert');
      for (const m of x.g.members) m.r.description = d.jobDescription;
      x.g.readNow = true;
      if (isNewGroup(x)) readNew++; else readBacklog++;
    } catch { failed++; }                            // left unread, so the next run tries again
    await sleep(150);
  }
  const unreadLeft = needsRead.length - readNew - readBacklog;

  const kept = [];
  for (const g of groups.values()) {
    for (const m of g.members) {
      let job = m.job;
      if (g.readNow) { job = buildJob(m.r, cfg, sponsorMap); job.detail = true; }
      else if (g.stored?.detail) { job.summary = g.stored.summary; job.sponsorship = g.stored.sponsorship; job.detail = true; }
      kept.push(job);
    }
  }

  const merged = mergeJobs(existing, kept, today, cfg.keepDays);
  const newToday = merged.filter((j) => j.firstSeen === today).length;

  mkdirSync(dirname(dataPath), { recursive: true });
  writeFileSync(dataPath, JSON.stringify({
    updated: new Date().toISOString(),
    sponsorRegisterChecked: Boolean(sponsorMap),
    jobs: merged,
  }) + '\n');

  console.log(`Fetched ${raw.length}, unique ${unique.length}, kept ${kept.length}, new today ${newToday}, stored ${merged.length}`);
  console.log(`Full text: ${detailCalls} reads (${readNew} new, ${readBacklog} backlog, ${failed} failed), ${unreadLeft} still unread, ${merged.filter((j) => j.detail).length} of ${merged.length} entries read in full`);
  console.log('Dropped:', JSON.stringify(stats));
  if (errors.length) console.warn('Errors:\n' + errors.join('\n'));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `new_count=${newToday}\n`);
  if (errors.length && !kept.length && !existing.length) process.exitCode = 1;
}

main();

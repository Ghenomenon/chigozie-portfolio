// Daily job fetch. Run by GitHub Actions, or locally with: node jobs/scripts/fetch-jobs.mjs
// Sources: Reed (REED_API_KEY) and Adzuna (ADZUNA_APP_ID + ADZUNA_APP_KEY). A source with no key is skipped.
// Sponsor licences come from the Home Office register of licensed sponsors.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readBoards } from '../../sponsor-radar/scripts/boards.mjs';
import {
  buildJob, dropReason, mergeJobs, sponsorMapFromCsv, parseReedDate, inboxToRaw,
} from './lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
const dataPath = process.env.FEED_PATH || join(root, 'data', 'jobs.json');
// Employer boards are found by Sponsor Radar's daily job. This one only reads them.
const inboxPath = process.env.INBOX_PATH || join(root, 'data', 'inbox.json');
const boardsPath = process.env.BOARDS_PATH || join(root, '..', 'sponsor-radar', 'data', 'boards.json');
const today = new Date().toISOString().slice(0, 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': 'job-radar/1.0', ...headers }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${url.split('?')[0]}`);
  return res.json();
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

async function fromReed(query) {
  const key = process.env.REED_API_KEY;
  if (!key) return [];
  const auth = { Authorization: 'Basic ' + Buffer.from(`${key}:`).toString('base64') };
  const url = `https://www.reed.co.uk/api/1.0/search?keywords=${encodeURIComponent(query)}&minimumSalary=${cfg.salary.min}&resultsToTake=100`;
  const data = await getJson(url, auth);
  const out = [];
  for (const r of data.results || []) {
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
  return out;
}

async function fromAdzuna(query) {
  const id = process.env.ADZUNA_APP_ID, key = process.env.ADZUNA_APP_KEY;
  if (!id || !key) return [];
  const url = `https://api.adzuna.com/v1/api/jobs/gb/search/1?app_id=${id}&app_key=${key}&results_per_page=50`
    + `&what=${encodeURIComponent(query)}&salary_min=${cfg.salary.min}&sort_by=date&max_days_old=${cfg.maxAgeDays}`;
  const data = await getJson(url);
  return (data.results || []).map((r) => ({
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
  }));
}


// Adverts from employer job boards (Greenhouse, Lever, Ashby, SmartRecruiters, Workable) that Sponsor Radar has found. They arrive in full.
// The usual title filter then keeps the analyst roles.
async function fromBoards() {
  let found;
  try { found = JSON.parse(readFileSync(boardsPath, 'utf8')).found || {}; } catch { return { raw: [], note: 'no boards file yet' }; }
  const places = (() => { try { return JSON.parse(readFileSync(join(root, 'data', 'places.json'), 'utf8')); } catch { return null; } })();
  const res = await readBoards({ found, missed: {} }, { today, getJson, places });
  return { raw: res.raw, note: `${res.boards} employer boards read, ${res.raw.length} UK adverts${res.failed ? `, ${res.failed} failed` : ''}` };
}

async function main() {
  const existing = (() => {
    try { return JSON.parse(readFileSync(dataPath, 'utf8')).jobs || []; } catch { return []; }
  })();

  const sponsorMap = await loadSponsorMap();
  const raw = [];
  const errors = [];
  for (const q of cfg.queries) {
    for (const src of [fromReed, fromAdzuna]) {
      try { raw.push(...await src(q)); } catch (e) { errors.push(`${src.name} "${q}": ${e.message}`); }
      await sleep(250);
    }
  }
  try {
    const items = JSON.parse(readFileSync(inboxPath, 'utf8')).jobs;
    const fromInbox = inboxToRaw(items, today);
    raw.push(...fromInbox);
    console.log(`Inbox: ${fromInbox.length} adverts from alerts and searches`);
  } catch { /* no inbox yet */ }
  try { const b = await fromBoards(); raw.push(...b.raw); console.log(`Employer boards: ${b.note}`); } catch (e) { errors.push(`employer boards: ${e.message}`); }

  if (!process.env.REED_API_KEY && !(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY)) {
    console.warn('No API keys set. Add REED_API_KEY or ADZUNA_APP_ID and ADZUNA_APP_KEY as repository secrets.');
  }

  // De-duplicate across sources by company + title.
  const seen = new Set();
  const unique = raw.filter((r) => {
    if (!r.posted || !r.id || !r.title || !r.company) return false;
    const k = `${r.company.toLowerCase()}|${r.title.toLowerCase()}|${r.location.toLowerCase()}`;
    if (seen.has(r.id) || seen.has(k)) return false;
    seen.add(r.id); seen.add(k);
    return true;
  });

  // Cheap title filter first, then fetch the full Reed advert so sponsorship wording is read in full.
  const stats = {};
  const kept = [];
  for (const r of unique) {
    const probe = buildJob(r, cfg, sponsorMap, today);
    let reason = dropReason(probe, cfg, today);
    if (!reason && r._detailUrl) {
      try {
        const d = await getJson(r._detailUrl, r._detailAuth);
        r.description = d.jobDescription || r.description;
        await sleep(150);
      } catch { /* keep the snippet */ }
    }
    const job = reason ? probe : buildJob(r, cfg, sponsorMap, today);
    reason = reason || dropReason(job, cfg, today);
    if (reason) { stats[reason] = (stats[reason] || 0) + 1; continue; }
    kept.push(job);
  }

  const merged = mergeJobs(existing, kept, today, cfg.keepDays);
  const newToday = merged.filter((j) => j.firstSeen === today).length;

  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(dataPath, JSON.stringify({
    updated: new Date().toISOString(),
    sponsorRegisterChecked: Boolean(sponsorMap),
    jobs: merged,
  }, null, 1) + '\n');

  console.log(`Fetched ${raw.length}, unique ${unique.length}, kept ${kept.length}, new today ${newToday}, stored ${merged.length}`);
  console.log('Dropped:', JSON.stringify(stats));
  if (errors.length) console.warn('Errors:\n' + errors.join('\n'));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `new_count=${newToday}\n`);
  if (errors.length && !kept.length && !existing.length) process.exitCode = 1;
}

main();

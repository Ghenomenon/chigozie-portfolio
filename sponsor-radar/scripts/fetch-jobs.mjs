// Daily job fetch. Run by GitHub Actions, or locally with: node jobs/scripts/fetch-jobs.mjs
// Sources: Reed (REED_API_KEY) and Adzuna (ADZUNA_APP_ID + ADZUNA_APP_KEY). A source with no key is skipped.
// Sponsor licences come from the Home Office register of licensed sponsors.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildJob, dropReason, mergeJobs, sponsorMapFromCsv, parseReedDate,
} from './lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
const dataPath = join(root, 'data', 'jobs.json');
const today = new Date().toISOString().slice(0, 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': 'sponsor-radar/1.0', ...headers } });
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
  const url = `https://www.reed.co.uk/api/1.0/search?keywords=${encodeURIComponent(query)}&resultsToTake=100`;
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
    + `&what=${encodeURIComponent(query)}&sort_by=date&max_days_old=${cfg.maxAgeDays}`;
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

async function main() {
  const existing = (() => {
    try { return JSON.parse(readFileSync(dataPath, 'utf8')).jobs || []; } catch { return []; }
  })();
  const known = new Map(existing.map((j) => [j.id, j]));

  const sponsorMap = await loadSponsorMap();
  const raw = [];
  const errors = [];
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
  // New Reed adverts get a second call for the full text so sponsorship wording is read in full.
  const stats = {};
  const kept = [];
  let detailCalls = 0;
  for (const r of unique) {
    const probe = buildJob(r, cfg, sponsorMap);
    let reason = dropReason(probe, cfg, today);
    if (!reason && r._detailUrl && !known.has(r.id) && detailCalls < cfg.maxDetailFetches) {
      detailCalls++;
      try {
        const d = await getJson(r._detailUrl, r._detailAuth);
        r.description = d.jobDescription || r.description;
        await sleep(150);
      } catch { /* keep the snippet */ }
    }
    const job = reason ? probe : buildJob(r, cfg, sponsorMap);
    // Adverts we already read in full keep their saved text and sponsorship reading.
    const old = known.get(r.id);
    if (old && old.summary && old.summary.length > job.summary.length) { job.summary = old.summary; job.sponsorship = old.sponsorship; }
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
  }) + '\n');

  console.log(`Fetched ${raw.length}, unique ${unique.length}, kept ${kept.length}, detail calls ${detailCalls}, new today ${newToday}, stored ${merged.length}`);
  console.log('Dropped:', JSON.stringify(stats));
  if (errors.length) console.warn('Errors:\n' + errors.join('\n'));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `new_count=${newToday}\n`);
  if (errors.length && !kept.length && !existing.length) process.exitCode = 1;
}

main();

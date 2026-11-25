import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function run() {
  const dir = mkdtempSync(join(tmpdir(), 'sr-feed-'));
  const feed = join(dir, 'jobs.json');
  const calls = join(dir, 'calls.log');
  writeFileSync(calls, '');
  const r = spawnSync(process.execPath, ['--import', join(here, 'testing', 'mock-fetch.mjs'), join(here, 'fetch-jobs.mjs')], {
    env: { ...process.env, REED_API_KEY: 'test-key', FEED_PATH: feed, CALLS_PATH: calls, FETCH_DELAY_MS: '0', GITHUB_OUTPUT: '' },
    encoding: 'utf8',
  });
  const urls = readFileSync(calls, 'utf8').split('\n').filter(Boolean);
  const data = existsSync(feed) ? JSON.parse(readFileSync(feed, 'utf8')) : null;
  return { r, urls, data };
}

const skipsFor = (urls, keyword) => urls
  .filter((u) => u.includes('/api/1.0/search') && new URL(u).searchParams.get('keywords') === keyword)
  .map((u) => Number(new URL(u).searchParams.get('resultsToSkip')));

test('the daily job reads up to three pages of each search and stops at the last page', () => {
  const { r, urls } = run();
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(skipsFor(urls, 'support worker'), [0, 100, 200], '250 adverts means three pages, the last one short');
  assert.deepEqual(skipsFor(urls, 'care assistant'), [0, 100, 200], 'never more than three pages');
  assert.deepEqual(skipsFor(urls, 'data analyst'), [0], 'an empty search stops after one call');
});

test('a failing later page keeps the pages already read and does not fail the run', () => {
  const { r, urls, data } = run();
  assert.equal(r.status, 0);
  assert.ok(skipsFor(urls, 'chef').length >= 2, 'page 2 was tried');
  assert.match(r.stderr, /fromReed "chef" page 2/);
  assert.ok(data.jobs.some((j) => j.title === 'Chef'), 'page 1 of chef is kept');
});

test('adverts from every page reach the feed, collapsed by employer and title', () => {
  const { data } = run();
  const support = data.jobs.filter((j) => j.title === 'Support Worker');
  const adverts = support.reduce((n, j) => n + (j.locations ? j.locations.length : 1), 0);
  assert.equal(support.length, 40, '250 adverts from 40 employers collapse to 40 entries');
  assert.equal(adverts, 250, 'no advert is lost, the places are listed');
  assert.ok(data.sponsorRegisterChecked);
});

test('new adverts get a second call for the full text and keep their pay unit', () => {
  const { urls, data } = run();
  assert.ok(urls.some((u) => u.includes('/api/1.0/jobs/')), 'detail calls happen');
  const j = data.jobs.find((x) => x.title === 'Support Worker');
  assert.equal(j.sponsorship, 'offered', 'wording read from the full text');
  assert.equal(j.salaryUnit, 'hour');
  assert.equal(j.rateMax, 13.5);
  assert.ok(j.summary.length <= 1000);
});

test('a second run reuses stored adverts and makes no repeat detail calls for them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sr-feed2-'));
  const feed = join(dir, 'jobs.json');
  const calls = join(dir, 'calls.log');
  const env = { ...process.env, REED_API_KEY: 'test-key', FEED_PATH: feed, CALLS_PATH: calls, FETCH_DELAY_MS: '0', GITHUB_OUTPUT: '' };
  const args = ['--import', join(here, 'testing', 'mock-fetch.mjs'), join(here, 'fetch-jobs.mjs')];
  writeFileSync(calls, '');
  spawnSync(process.execPath, args, { env, encoding: 'utf8' });
  const first = readFileSync(calls, 'utf8').split('\n').filter((u) => u.includes('/api/1.0/jobs/')).length;
  writeFileSync(calls, '');
  const r = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
  const second = readFileSync(calls, 'utf8').split('\n').filter((u) => u.includes('/api/1.0/jobs/')).length;
  assert.equal(r.status, 0);
  assert.ok(first > 100, `first run read ${first} adverts in full`);
  assert.equal(second, 0, 'the second run found nothing new to read');
});

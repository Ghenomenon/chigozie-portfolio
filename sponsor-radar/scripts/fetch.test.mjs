import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function run(extraEnv = {}, dirIn = null) {
  const dir = dirIn || mkdtempSync(join(tmpdir(), 'sr-feed-'));
  const feed = join(dir, 'jobs.json');
  const calls = join(dir, 'calls.log');
  writeFileSync(calls, '');
  const r = spawnSync(process.execPath, ['--import', join(here, 'testing', 'mock-fetch.mjs'), join(here, 'fetch-jobs.mjs')], {
    env: { ...process.env, REED_API_KEY: 'test-key', FEED_PATH: feed, REGISTER_PATH: join(dir, 'register.bin'), BOARDS_PATH: join(dir, 'boards.json'), BOARDS_PROBES: '0', BOARDS_SLICE: '0', ...extraEnv, CALLS_PATH: calls, FETCH_DELAY_MS: '0', GITHUB_OUTPUT: '' },
    encoding: 'utf8',
  });
  const urls = readFileSync(calls, 'utf8').split('\n').filter(Boolean);
  const data = existsSync(feed) ? JSON.parse(readFileSync(feed, 'utf8')) : null;
  const boards = existsSync(join(dir, 'boards.json')) ? JSON.parse(readFileSync(join(dir, 'boards.json'), 'utf8')) : null;
  return { r, urls, data, boards, dir };
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
  const env = { ...process.env, REED_API_KEY: 'test-key', FEED_PATH: feed, REGISTER_PATH: join(dirname(feed), 'register.bin'), BOARDS_PATH: join(dirname(feed), 'boards.json'), BOARDS_PROBES: '0', BOARDS_SLICE: '0', CALLS_PATH: calls, FETCH_DELAY_MS: '0', GITHUB_OUTPUT: '' };
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

// A session keeps one feed file across runs, like the real daily job.
function session() {
  const dir = mkdtempSync(join(tmpdir(), 'sr-sess-'));
  const feed = join(dir, 'jobs.json');
  const calls = join(dir, 'calls.log');
  return {
    run(extra = {}) {
      writeFileSync(calls, '');
      const r = spawnSync(process.execPath, ['--import', join(here, 'testing', 'mock-fetch.mjs'), join(here, 'fetch-jobs.mjs')], {
        env: { ...process.env, REED_API_KEY: 'test-key', FEED_PATH: feed, REGISTER_PATH: join(dirname(feed), 'register.bin'), BOARDS_PATH: join(dirname(feed), 'boards.json'), BOARDS_PROBES: '0', BOARDS_SLICE: '0', CALLS_PATH: calls, FETCH_DELAY_MS: '0', GITHUB_OUTPUT: '', ...extra },
        encoding: 'utf8',
      });
      const urls = readFileSync(calls, 'utf8').split('\n').filter(Boolean);
      const reads = urls.filter((u) => u.includes('/api/1.0/jobs/'));
      const data = existsSync(feed) ? JSON.parse(readFileSync(feed, 'utf8')) : null;
      return { r, urls, reads, data, unread: data ? data.jobs.filter((j) => !j.detail).length : null };
    },
  };
}

test('copies of one advert share a single full-text read, and every entry is marked read', () => {
  const { r, reads, data } = session().run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(reads.length, data.jobs.length, 'one read per entry, not one per advert');
  assert.ok(data.jobs.length < 300, 'many adverts folded into few entries');
  assert.ok(data.jobs.every((j) => j.detail === true));
  assert.match(r.stdout, /Full text: \d+ reads \(\d+ new, 0 backlog, 0 failed\), 0 still unread/);
});

test('a run that hits the cap leaves a backlog that later runs work through without repeats', () => {
  const s = session();
  const seen = new Set();
  const first = s.run({ MAX_DETAIL_FETCHES: '30' });
  const total = first.data.jobs.length;
  assert.equal(first.reads.length, 30, 'stops at the cap');
  assert.equal(first.unread, total - 30, 'the rest is saved but marked unread');
  first.reads.forEach((u) => seen.add(u));
  let unread = first.unread, runs = 1;
  while (unread > 0 && runs < 20) {
    const next = s.run({ MAX_DETAIL_FETCHES: '30' });
    assert.ok(next.reads.length > 0 && next.reads.length <= 30);
    for (const u of next.reads) assert.ok(!seen.has(u), `never reads the same advert twice: ${u}`);
    next.reads.forEach((u) => seen.add(u));
    assert.ok(next.unread < unread, 'the backlog shrinks every run');
    unread = next.unread; runs++;
  }
  assert.equal(unread, 0, `everything read in full after ${runs} runs`);
  assert.equal(runs, Math.ceil(total / 30));
  const idle = s.run({ MAX_DETAIL_FETCHES: '30' });
  assert.equal(idle.reads.length, 0, 'nothing left to read');
});

test('new adverts are read before the backlog', () => {
  const s = session();
  const first = s.run({ MAX_DETAIL_FETCHES: '30' });
  assert.ok(first.unread > 30, 'a backlog exists');
  const second = s.run({ MAX_DETAIL_FETCHES: '30', MOCK_NEW: '1' });
  const fresh = second.data.jobs.filter((j) => /^Newco/.test(j.company));
  assert.equal(fresh.length, 20);
  assert.ok(fresh.every((j) => j.detail), 'all 20 new adverts were read in full');
  assert.ok(second.unread > 0, 'and the backlog is still there');
  assert.match(second.r.stdout, /\(20 new, 10 backlog, 0 failed\)/);
});

test('a failed read leaves the advert unread and the next run retries it', () => {
  const s = session();
  const down = s.run({ MOCK_DETAIL_FAIL: '1' });
  assert.equal(down.r.status, 0, 'the run still succeeds');
  assert.ok(down.data.jobs.length > 100, 'the adverts are still saved from their snippets');
  assert.equal(down.unread, down.data.jobs.length, 'none marked read');
  assert.match(down.r.stdout, /0 new, 0 backlog, \d+ failed/);
  const up = s.run();
  assert.equal(up.unread, 0, 'all read once Reed answers');
  assert.equal(up.reads.length, up.data.jobs.length);
});

test('adverts read in full keep their sponsorship reading on later runs', () => {
  const s = session();
  const a = s.run();
  assert.ok(a.data.jobs.every((j) => j.sponsorship === 'offered'));
  const b = s.run();
  assert.equal(b.reads.length, 0);
  assert.ok(b.data.jobs.every((j) => j.sponsorship === 'offered' && j.detail === true));
  assert.deepEqual(b.data.jobs.map((j) => j.summary), a.data.jobs.map((j) => j.summary));
});

test('entries Reed stops returning are kept for three days and then removed, while the rest stay', () => {
  const s = session();
  const day = (iso, extra = {}) => s.run({ FEED_TODAY: iso, ...extra });
  const first = day('2026-11-20');
  const total = first.data.jobs.length;
  const chefs = first.data.jobs.filter((j) => j.title === 'Chef').length;
  assert.ok(chefs > 10, `chef entries exist (${chefs})`);

  const two = day('2026-11-22', { MOCK_NO_CHEF: '1' });
  assert.equal(two.data.jobs.length, total, 'two days unseen: nothing removed yet');
  assert.match(two.r.stdout, /Removed 0 stored entries/);

  const three = day('2026-11-23', { MOCK_NO_CHEF: '1' });
  assert.equal(three.data.jobs.length, total, 'three days unseen: still inside the grace');

  const five = day('2026-11-24', { MOCK_NO_CHEF: '1' });
  assert.equal(five.data.jobs.filter((j) => j.title === 'Chef').length, 0, 'four days unseen: chefs removed');
  assert.equal(five.data.jobs.length, total - chefs, 'and nothing else');
  assert.match(five.r.stdout, new RegExp(`Removed ${chefs} stored entries`));
});

test('a closed advert never enters the feed', () => {
  const s = session();
  const open = s.run();
  assert.ok(open.data.jobs.some((j) => j.title === 'Care Assistant'));
  const closed = session().run({ MOCK_EXPIRED: '1' });
  assert.equal(closed.r.status, 0);
  assert.ok(!closed.data.jobs.some((j) => j.title === 'Care Assistant'), 'adverts past their closing date are dropped on arrival');
  assert.match(closed.r.stdout, /"expired":\d+/);
  assert.ok(closed.data.jobs.some((j) => j.title === 'Support Worker'), 'the rest of the feed is untouched');
});

test('an entry returned every day is never removed', () => {
  const s = session();
  s.run({ FEED_TODAY: '2026-11-20' });
  let last;
  for (const d of ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26']) last = s.run({ FEED_TODAY: d });
  assert.ok(last.data.jobs.some((j) => j.title === 'Support Worker'));
  assert.ok(last.data.jobs.every((j) => j.lastSeen === '2026-11-26'));
});

// ---------- employer boards ----------

const ON = { BOARDS_PROBES: '4', BOARDS_SLICE: '4' };   // the other tests keep boards off by trying no employers

const boardCalls = (urls) => urls.filter((u) => /boards-api\.greenhouse\.io|api\.lever\.co|api\.ashbyhq\.com/.test(u));

test('the daily job finds employer boards for licensed sponsors and adds their UK adverts in full', () => {
  const { r, data, boards } = run(ON);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const found = Object.entries(boards.found);
  assert.ok(found.length >= 1 && found.length <= 4, `found ${found.length} boards`);
  assert.ok(found.every(([, b]) => b.ats === 'greenhouse' && /^sponsor\d+$/.test(b.slug)));
  const fromBoards = data.jobs.filter((j) => j.source === 'Employer site');
  assert.equal(fromBoards.length, found.length, 'one UK advert per board, and the Texas advert is left out');
  for (const j of fromBoards) {
    assert.equal(j.title, 'Data Analyst');
    assert.equal(j.sponsorLicence, 'licensed', 'named as on the register');
    assert.equal(j.detail, true, 'the whole advert came with it');
    assert.equal(j.sponsorship, 'refused', 'the advert says it does not sponsor');
    assert.match(j.location, /London/);
  }
  assert.match(r.stdout, /Employer boards: \d+ known, tried 4 employers and found \d+/);
});

test('boards already found are read again without being searched for twice', () => {
  const first = run(ON);
  assert.equal(first.r.status, 0);
  const second = run(ON, first.dir);
  const probes = boardCalls(second.urls);
  const foundSlugs = Object.values(first.boards.found).map((b) => b.slug);
  for (const slug of foundSlugs) assert.ok(probes.some((u) => u.includes(`/boards/${slug}/jobs`)), `${slug} was read again`);
  const triedBefore = new Set([...Object.keys(first.boards.found), ...Object.keys(first.boards.missed)]);
  const triedNow = new Set([...Object.keys(second.boards.found), ...Object.keys(second.boards.missed)]);
  assert.ok(triedNow.size > triedBefore.size || triedBefore.size >= 4, 'a second run moves on to employers it has not tried');
  assert.ok(second.data.jobs.filter((j) => j.source === 'Employer site').length >= foundSlugs.length);
});

test('with no boards behind the guesses, nothing is added and the run does not fail', () => {
  const { r, data, boards } = run({ ...ON, MOCK_NO_BOARDS: '1' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(Object.keys(boards.found).length, 0);
  assert.ok(Object.keys(boards.missed).length >= 1, 'misses are remembered so they are not tried every day');
  assert.equal(data.jobs.filter((j) => j.source === 'Employer site').length, 0);
});

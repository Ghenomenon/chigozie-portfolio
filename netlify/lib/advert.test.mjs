import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPrivateIp, assertPublicHost, checkUrl, fetchPage, extractAdvert, readAdvert, cleanText,
} from './advert.mjs';

const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];
const longText = 'Build weekly KPI reports in Excel and SQL for the operations team. '.repeat(8);

const page = (body, head = '') => `<html><head><title>Data Analyst - Acme</title>${head}</head><body><nav>Menu</nav>${body}<footer>Cookies</footer></body></html>`;
const html = (status, body, headers = {}) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

test('private and reserved addresses are recognised', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
    assert.ok(isPrivateIp(ip), ip);
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) assert.ok(!isPrivateIp(ip), ip);
});

test('hosts that resolve to private addresses are refused', async () => {
  await assert.rejects(assertPublicHost('10.0.0.1'), /ip-literal/);
  await assert.rejects(assertPublicHost('localhost'), /private-host/);
  await assert.rejects(assertPublicHost('evil.example', async () => [{ address: '127.0.0.1' }]), /private-address/);
  await assert.rejects(assertPublicHost('mixed.example', async () => [{ address: '8.8.8.8' }, { address: '10.0.0.5' }]), /private-address/);
  await assert.doesNotReject(assertPublicHost('www.reed.co.uk', publicDns));
});

test('only https job-site links are accepted as the first hop', () => {
  assert.ok(checkUrl('https://www.reed.co.uk/jobs/data-analyst/123', { first: true }));
  assert.ok(checkUrl('https://boards.greenhouse.io/acme/jobs/1', { first: true }));
  for (const bad of ['http://www.reed.co.uk/jobs/1', 'ftp://reed.co.uk/x', 'https://user:pw@www.reed.co.uk/x', 'https://www.reed.co.uk:8443/x', 'not a url']) {
    assert.throws(() => checkUrl(bad, { first: true }), /bad-url/, bad);
  }
  assert.throws(() => checkUrl('https://example.com/jobs/1', { first: true }), /not-allowed/);
  assert.throws(() => checkUrl('https://reed.co.uk.evil.example/x', { first: true }), /not-allowed/);
  assert.ok(checkUrl('https://careers.acme.example/job/1', { first: false }), 'later hops may be any public site');
});

test('extracts the description from a JobPosting block', () => {
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Data Analyst', hiringOrganization: { name: 'Acme Ltd' }, description: `<p>${longText}</p><ul><li>SQL</li><li>Excel</li></ul>` });
  const r = extractAdvert(page('<main>ignored</main>', `<script type="application/ld+json">${ld}</script>`));
  assert.equal(r.ok, true);
  assert.equal(r.source, 'json-ld');
  assert.equal(r.company, 'Acme Ltd');
  assert.match(r.text, /weekly KPI reports/);
  assert.match(r.text, /SQL\nExcel/);
});

test('finds a JobPosting inside an @graph array', () => {
  const ld = JSON.stringify({ '@graph': [{ '@type': 'WebSite' }, { '@type': ['JobPosting'], title: 'BI Analyst', description: longText }] });
  const r = extractAdvert(page('', `<script type="application/ld+json">${ld}</script>`));
  assert.equal(r.ok, true);
  assert.equal(r.title, 'BI Analyst');
});

test('falls back to the page text and drops scripts, menus and footers', () => {
  const r = extractAdvert(page(`<main><h1>Data Analyst</h1><p>${longText}</p><script>alert(1)</script></main>`));
  assert.equal(r.ok, true);
  assert.equal(r.source, 'page');
  assert.ok(!/alert|Menu|Cookies/.test(r.text));
});

test('login walls, captchas and empty pages are reported, not returned as adverts', () => {
  assert.deepEqual(extractAdvert(page('<p>Just a moment... verify you are human. Captcha.</p>')), { ok: false, reason: 'blocked' });
  assert.deepEqual(extractAdvert(page('<p>Hello</p>')), { ok: false, reason: 'empty' });
});

test('text is capped', () => {
  const r = extractAdvert(page(`<main><p>${'word '.repeat(5000)}</p></main>`));
  assert.ok(r.ok && r.text.length <= 6000);
});

test('fetchPage follows a redirect but refuses one that lands on a private address', async () => {
  const calls = [];
  const ok = async (url) => {
    calls.push(url);
    if (url.startsWith('https://www.adzuna.co.uk')) return new Response(null, { status: 302, headers: { location: 'https://careers.acme.example/job/9' } });
    return html(200, page(`<main><p>${longText}</p></main>`));
  };
  const good = await fetchPage('https://www.adzuna.co.uk/land/ad/1', { fetchImpl: ok, resolver: publicDns });
  assert.match(good.html, /weekly KPI/);
  assert.equal(calls.length, 2);

  const toPrivate = async () => new Response(null, { status: 302, headers: { location: 'https://internal.acme.example/x' } });
  const resolver = async (h) => (h.startsWith('internal') ? [{ address: '10.0.0.8' }] : [{ address: '93.184.216.34' }]);
  await assert.rejects(fetchPage('https://www.reed.co.uk/jobs/1', { fetchImpl: toPrivate, resolver }), /private-address/);

  const toHttp = async () => new Response(null, { status: 302, headers: { location: 'http://careers.acme.example/x' } });
  await assert.rejects(fetchPage('https://www.reed.co.uk/jobs/1', { fetchImpl: toHttp, resolver: publicDns }), /bad-url/);
});

test('redirect loops stop after three hops', async () => {
  const loop = async () => new Response(null, { status: 302, headers: { location: 'https://www.reed.co.uk/loop' } });
  await assert.rejects(fetchPage('https://www.reed.co.uk/loop', { fetchImpl: loop, resolver: publicDns }), /too-many-redirects/);
});

test('oversized and non-html responses are refused', async () => {
  const big = async () => new Response('x'.repeat(2_000_000), { status: 200, headers: { 'content-type': 'text/html' } });
  await assert.rejects(fetchPage('https://www.reed.co.uk/jobs/1', { fetchImpl: big, resolver: publicDns }), /too-large/);
  const pdf = async () => new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } });
  await assert.rejects(fetchPage('https://www.reed.co.uk/jobs/1', { fetchImpl: pdf, resolver: publicDns }), /not-html/);
});

test('readAdvert turns failures into reasons the app can show', async () => {
  const ok = async () => html(200, page(`<main><p>${longText}</p></main>`));
  assert.equal((await readAdvert('https://www.reed.co.uk/jobs/1', { fetchImpl: ok, resolver: publicDns })).ok, true);
  assert.deepEqual(await readAdvert('https://example.com/x', { fetchImpl: ok, resolver: publicDns }), { ok: false, reason: 'not-allowed' });
  assert.deepEqual(await readAdvert('nope'), { ok: false, reason: 'bad-url' });
  const denied = async () => html(403, 'no');
  assert.deepEqual(await readAdvert('https://www.reed.co.uk/jobs/1', { fetchImpl: denied, resolver: publicDns }), { ok: false, reason: 'blocked' });
  const boom = async () => { throw new Error('network down'); };
  assert.deepEqual(await readAdvert('https://www.reed.co.uk/jobs/1', { fetchImpl: boom, resolver: publicDns }), { ok: false, reason: 'fetch-failed' });
});

test('cleanText decodes common entities', () => {
  assert.equal(cleanText('<p>Pay &pound;30k &amp; bonus</p>'), 'Pay £30k & bonus');
});

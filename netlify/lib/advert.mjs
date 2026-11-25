// Reads the advert text from a job posting page. Used by the Netlify function in
// netlify/functions/advert.mjs. Everything that touches the network is injectable so it can be tested.
//
// Safety rules, because this fetches a URL on a visitor's behalf:
//  - https only, no credentials, standard port
//  - the first URL must be on a known job site
//  - every hop must resolve to a public address (no localhost, no private ranges)
//  - redirects are followed by hand, at most three
//  - response size and time are capped

import dns from 'node:dns/promises';
import net from 'node:net';

export const ALLOWED_FIRST_HOPS = [
  /(^|\.)reed\.co\.uk$/,
  /(^|\.)adzuna\.co\.uk$/,
  /(^|\.)indeed\.com$/,
  /(^|\.)greenhouse\.io$/,
  /(^|\.)lever\.co$/,
  /(^|\.)ashbyhq\.com$/,
  /(^|\.)workable\.com$/,
  /(^|\.)smartrecruiters\.com$/,
  /(^|\.)myworkdayjobs\.com$/,
];

const MAX_REDIRECTS = 3;
const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 8000;
const MAX_TEXT = 6000;

// ---------- address checks ----------

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
      || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
    return v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9')
      || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
  }
  return true;
}

export async function assertPublicHost(hostname, resolver = dns.lookup) {
  if (net.isIP(hostname)) throw new Error('ip-literal');
  if (/^localhost$|\.local$|\.internal$/i.test(hostname)) throw new Error('private-host');
  const records = await resolver(hostname, { all: true });
  if (!records.length || records.some((r) => isPrivateIp(r.address))) throw new Error('private-address');
}

export function checkUrl(raw, { first }) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('bad-url'); }
  if (u.protocol !== 'https:') throw new Error('bad-url');
  if (u.username || u.password) throw new Error('bad-url');
  if (u.port && u.port !== '443') throw new Error('bad-url');
  if (first && !ALLOWED_FIRST_HOPS.some((re) => re.test(u.hostname))) throw new Error('not-allowed');
  return u;
}

// ---------- fetching ----------

async function readCapped(res, maxBytes) {
  const reader = res.body?.getReader?.();
  if (!reader) return (await res.text()).slice(0, maxBytes);
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) { await reader.cancel(); throw new Error('too-large'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function fetchPage(rawUrl, { fetchImpl = fetch, resolver = dns.lookup } = {}) {
  let url = checkUrl(rawUrl, { first: true }).toString();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = checkUrl(url, { first: hop === 0 });
    await assertPublicHost(u.hostname, resolver);
    const res = await fetchImpl(u.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AdvertReader/1.0)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('fetch-failed');
      url = new URL(loc, u).toString();
      continue;
    }
    if (!res.ok) throw new Error(res.status === 403 || res.status === 401 || res.status === 429 ? 'blocked' : 'fetch-failed');
    const type = res.headers.get('content-type') || '';
    if (!/html|xml/i.test(type)) throw new Error('not-html');
    return { html: await readCapped(res, MAX_BYTES), finalUrl: u.toString() };
  }
  throw new Error('too-many-redirects');
}

// ---------- extraction ----------

export function cleanText(html = '') {
  return String(html)
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h[1-6]>|<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&apos;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&pound;/g, '£').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function* walk(node) {
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return; }
  if (node && typeof node === 'object') {
    yield node;
    if (node['@graph']) yield* walk(node['@graph']);
  }
}

function fromJsonLd(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    for (const n of walk(data)) {
      const type = [].concat(n['@type'] || []);
      if (type.includes('JobPosting') && typeof n.description === 'string') {
        const org = n.hiringOrganization;
        return {
          text: cleanText(n.description),
          title: typeof n.title === 'string' ? n.title : '',
          company: typeof org === 'string' ? org : (org?.name || ''),
          source: 'json-ld',
        };
      }
    }
  }
  return null;
}

function fromPage(html) {
  let h = html
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const pick = /<main[\s\S]*?<\/main>/i.exec(h) || /<article[\s\S]*?<\/article>/i.exec(h) || /<body[\s\S]*<\/body>/i.exec(h);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return { text: cleanText(pick ? pick[0] : h), title: title ? cleanText(title[1]) : '', company: '', source: 'page' };
}

export function looksBlocked(text) {
  return text.length < 1500
    && /captcha|verify (that )?you are (a )?human|access denied|enable javascript|unusual traffic|are you a robot|just a moment|sign in to continue|log in to continue/i.test(text);
}

export function extractAdvert(html) {
  const found = fromJsonLd(html) || fromPage(html);
  const text = found.text.slice(0, MAX_TEXT);
  if (text.length < 200) return { ok: false, reason: looksBlocked(text) ? 'blocked' : 'empty' };
  if (looksBlocked(text)) return { ok: false, reason: 'blocked' };
  return { ok: true, text, title: found.title, company: found.company, source: found.source };
}

// ---------- one call ----------

export async function readAdvert(rawUrl, deps = {}) {
  try {
    const { html } = await fetchPage(rawUrl, deps);
    return extractAdvert(html);
  } catch (e) {
    const reason = ['bad-url', 'not-allowed', 'blocked', 'not-html', 'too-large'].includes(e.message) ? e.message : 'fetch-failed';
    return { ok: false, reason };
  }
}

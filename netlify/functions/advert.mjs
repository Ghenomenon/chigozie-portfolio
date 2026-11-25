// GET /.netlify/functions/advert?url=<job advert link>
// Returns { ok: true, text, title, company, source } or { ok: false, reason }.
import { readAdvert } from '../lib/advert.mjs';

const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

export default async (req) => {
  if (req.method !== 'GET') return new Response(JSON.stringify({ ok: false, reason: 'method' }), { status: 405, headers });
  const url = new URL(req.url).searchParams.get('url') || '';
  if (!url || url.length > 2000) return new Response(JSON.stringify({ ok: false, reason: 'bad-url' }), { status: 400, headers });
  const result = await readAdvert(url);
  return new Response(JSON.stringify(result), { status: 200, headers });
};

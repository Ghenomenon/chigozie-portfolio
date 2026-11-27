// Writes the tailored CV and cover letter by calling Claude straight from the phone.
// The API key is the person's own, saved on this phone and sent only to Anthropic. There is no server in between,
// so no time limit and no key on the website. Loaded only when Write with Claude is tapped.

import { Anthropic } from '../vendor/anthropic-sdk.min.mjs';

const SYSTEM = 'You tailor CVs and cover letters for UK job applications. You use only facts from the CV you are given and never invent anything. You follow the reply format exactly.';

const toBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

const fail = (userMessage) => Object.assign(new Error(userMessage), { userMessage });

export async function writeDocs({ key, prompt, images = [] }) {
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 180000 });
  const content = [];
  for (const f of images.slice(0, 4)) {
    const media = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(f.type) ? f.type : 'image/jpeg';
    content.push({ type: 'image', source: { type: 'base64', media_type: media, data: await toBase64(f) } });
  }
  content.push({ type: 'text', text: prompt });
  let msg;
  try {
    msg = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',                 // if a safety check declines, the API retries on a fallback model
      output_config: { effort: 'medium' },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw fail('Anthropic did not accept your API key. Check it in Settings.');
    if (e instanceof Anthropic.PermissionDeniedError) throw fail('Your API key is not allowed to use this model. Check your Anthropic account.');
    if (e instanceof Anthropic.RateLimitError) throw fail('Too many requests, or your account has run out of credit. Wait a minute, or check your Anthropic billing.');
    if (e instanceof Anthropic.BadRequestError) throw fail(`Anthropic refused the request: ${e.message}`);
    if (e instanceof Anthropic.APIConnectionError) throw fail('Could not reach Anthropic. Check your connection and try again.');
    if (e instanceof Anthropic.APIError) throw fail(`Anthropic returned an error (${e.status}). Try again in a minute.`);
    throw fail('Writing failed. Try again.');
  }
  if (msg.stop_reason === 'refusal') throw fail('Claude declined to write this one. Try the copy and paste route instead.');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!text.trim()) throw fail('Claude returned nothing. Try again.');
  return text;
}

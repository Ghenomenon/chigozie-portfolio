import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const apps = { 'Sponsor Radar': '../styles.css', 'Job Radar': '../../jobs/styles.css' };
const css = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// Pull the token lines out of a block that starts at `start` and ends at the matching closing brace.
function tokensAfter(text, start, from = 0) {
  const open = text.indexOf('{', text.indexOf(start, from));
  let depth = 0, i = open;
  for (; i < text.length; i++) { if (text[i] === '{') depth++; if (text[i] === '}' && --depth === 0) break; }
  return [...text.slice(open + 1, i).matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => `${m[1]}:${m[2].trim().replace(/\s+/g, ' ')}`).sort();
}

for (const [name, rel] of Object.entries(apps)) {
  const text = css(rel);

  test(`${name}: the two dark blocks hold the same colours`, () => {
    const from = text.indexOf('Dark colours');
    const forced = tokensAfter(text, ':root[data-theme="dark"]', from);
    const automatic = tokensAfter(text, ':root:not([data-theme="light"])', from);
    assert.ok(forced.length > 15, `found ${forced.length} dark tokens`);
    assert.deepEqual(automatic, forced, 'the chosen-dark and phone-dark blocks have drifted apart');
  });

  test(`${name}: every colour used in light has a dark counterpart`, () => {
    const lightOnly = tokensAfter(text, ':root {').map((t) => t.split(':')[0]);
    const dark = new Set(tokensAfter(text, ':root[data-theme="dark"]', text.indexOf('Dark colours')).map((t) => t.split(':')[0]));
    // brand colours that are the same in both themes need no dark copy
    const sameInBoth = new Set(['--brand', '--on-brand', '--display', '--text', '--ease', '--paint-1', '--paint-2', '--paint-3', '--paint-4']);
    const missing = lightOnly.filter((t) => !dark.has(t) && !sameInBoth.has(t));
    assert.deepEqual(missing, [], `no dark value for ${missing.join(', ')}`);
  });

  test(`${name}: native controls follow the theme`, () => {
    assert.match(text, /color-scheme:\s*light dark/);
    assert.match(text, /:root\[data-theme="light"\]\s*\{\s*color-scheme:\s*light/);
    assert.match(text, /:root\[data-theme="dark"\]\s*\{\s*color-scheme:\s*dark/);
  });

  test(`${name}: the page applies a saved choice before it paints`, () => {
    const html = readFileSync(new URL(rel.replace('styles.css', 'index.html'), import.meta.url), 'utf8');
    assert.match(html, /name="color-scheme" content="light dark"/);
    assert.match(html, /<script>try\{var t=localStorage\.getItem\("(sr|jr)\.theme"\)/);
    assert.match(html, /name="theme" value="auto" checked/);
    assert.match(html, /name="theme" value="light"/);
    assert.match(html, /name="theme" value="dark"/);
  });
}

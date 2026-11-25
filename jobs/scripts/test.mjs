import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normCompany, titleOk, sponsorshipFromText, buildJob, dropReason, mergeJobs,
  sponsorMapFromCsv, parseCsv, parseReedDate, scoreJob, cleanText, isAgency,
} from './lib.mjs';

const cfg = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const today = '2026-11-25';

test('company names match across suffixes', () => {
  assert.equal(normCompany('Barbour Ltd'), normCompany('BARBOUR'));
  assert.equal(normCompany('Ashley & McDonough Ltd'), 'ashley and mcdonough');
});

test('title filter keeps target roles and drops senior ones', () => {
  assert.ok(titleOk('Junior Data Analyst', cfg));
  assert.ok(titleOk('Supply Chain Analyst', cfg));
  assert.ok(!titleOk('Senior Data Analyst', cfg));
  assert.ok(!titleOk('Data Analyst Apprenticeship', cfg));
  assert.ok(!titleOk('Fraud Analyst', cfg));
  assert.ok(!titleOk('Warehouse Operative', cfg));
});

test('explicit refusal wins over offered wording', () => {
  assert.equal(sponsorshipFromText('We are unable to sponsor visas.', cfg), 'refused');
  assert.equal(sponsorshipFromText('We do not offer sponsorship, but offer sponsorship for senior roles', cfg), 'refused');
  assert.equal(sponsorshipFromText('Skilled Worker visa sponsorship available', cfg), 'offered');
  assert.equal(sponsorshipFromText('Great team and benefits', cfg), 'unknown');
});

test('jobs that refuse sponsorship are dropped', () => {
  const j = buildJob({ id: 'a', title: 'Data Analyst', company: 'X', url: 'u', source: 's',
    description: 'No sponsorship available.', posted: today }, cfg, null, today);
  assert.equal(dropReason(j, cfg, today), 'no-sponsorship');
});

test('pay rules', () => {
  const low = buildJob({ id: 'b', title: 'Data Analyst', company: 'X', url: 'u', source: 's', salaryMin: 20000, salaryMax: 24000, posted: today }, cfg, null, today);
  assert.equal(dropReason(low, cfg, today), 'below-floor');
  const high = buildJob({ id: 'c', title: 'Data Analyst', company: 'X', url: 'u', source: 's', salaryMin: 67000, salaryMax: 83000, posted: today }, cfg, null, today);
  assert.equal(dropReason(high, cfg, today), 'above-range');
  const ok = buildJob({ id: 'd', title: 'Data Analyst', company: 'X', url: 'u', source: 's', salaryMin: 28000, salaryMax: 32000, posted: today }, cfg, null, today);
  assert.equal(dropReason(ok, cfg, today), null);
  assert.ok(ok.score > low.score);
});

test('old postings are dropped', () => {
  const j = buildJob({ id: 'e', title: 'Data Analyst', company: 'X', url: 'u', source: 's', posted: '2026-10-01' }, cfg, null, today);
  assert.equal(dropReason(j, cfg, today), 'too-old');
});

test('sponsor register parsing and lookup', () => {
  const csv = [
    'Organisation Name,Town/City,County,Type & Rating,Route',
    '"Barbour Limited",South Shields,Tyne and Wear,Worker (A rating),Skilled Worker',
    '"Old Co Ltd",Leeds,,Worker (B rating),Skilled Worker',
    '"Creative Co",London,,Worker (A rating),Creative Worker',
  ].join('\n');
  const map = sponsorMapFromCsv(csv);
  assert.ok(map.has(normCompany('Barbour')));
  assert.ok(!map.has(normCompany('Old Co')));
  assert.ok(!map.has(normCompany('Creative Co')));
  const j = buildJob({ id: 'f', title: 'Business Intelligence Analyst', company: 'Barbour', location: 'South Shields', url: 'u', source: 's', posted: today }, cfg, map, today);
  assert.equal(j.sponsorLicence, 'licensed');
  assert.ok(j.reasons.includes('North East'));
});

test('csv quotes and Reed dates', () => {
  assert.deepEqual(parseCsv('a,"b,c","d ""e"""\n1,2,3'), [['a', 'b,c', 'd "e"'], ['1', '2', '3']]);
  assert.equal(parseReedDate('24/11/2026'), '2026-11-24');
});

test('merge keeps first seen and drops stale jobs', () => {
  const a = { id: '1', title: 'A', posted: '2026-11-20', score: 3 };
  const b = { id: '2', title: 'B', posted: '2026-11-24', score: 4 };
  const stale = { id: '3', title: 'C', posted: '2026-09-01', score: 5 };
  const first = mergeJobs([], [a, b], '2026-11-24', 45);
  const second = mergeJobs([...first, stale], [{ ...a, score: 3.5 }], '2026-11-25', 45);
  assert.equal(second.find((j) => j.id === '1').firstSeen, '2026-11-24');
  assert.ok(!second.find((j) => j.id === '3'));
  assert.ok(second.find((j) => j.id === '2'));
});

test('score stays between 0 and 5', () => {
  const j = { title: 'Junior Data Analyst', salaryMin: 28000, salaryMax: 32000, workMode: 'remote', location: 'Newcastle', sponsorship: 'offered', sponsorLicence: 'licensed' };
  const { score } = scoreJob(j, cfg);
  assert.ok(score >= 0 && score <= 5);
});

test('advert text is cleaned and capped for the apply prompt', () => {
  assert.equal(cleanText('<p>Build <b>reports</b>&nbsp;in Excel</p><ul><li>SQL</li></ul>'), 'Build reports in Excel\nSQL');
  const j = buildJob({ id: 'g', title: 'Data Analyst', company: 'X', url: 'u', source: 's', posted: today, description: 'a'.repeat(5000) }, cfg, null, today);
  assert.equal(j.summary.length, 1800);
});

test('recruiters are flagged from the name and the advert wording', () => {
  for (const c of ['Harnham - Data & Analytics Recruitment', 'Hays Specialist Recruitment Limited', 'Adecco', 'ITOL Recruit', 'Reed']) assert.ok(isAgency({ company: c }), c);
  for (const c of ['Barbour', 'Reed Smith LLP', 'Aviva']) assert.ok(!isAgency({ company: c }), c);
  assert.ok(isAgency({ company: 'Northern Analytics', summary: 'We are recruiting on behalf of our client.' }));
});

test('a recruiter licence earns no bonus in the score', () => {
  const map = new Map([[normCompany('Adecco'), true], [normCompany('Barbour'), true]]);
  const mk = (company) => buildJob({ id: company, title: 'Data Analyst', company, url: 'u', source: 's', posted: today }, cfg, map, today);
  const rec = mk('Adecco'), emp = mk('Barbour');
  assert.equal(rec.agency, true);
  assert.equal(emp.agency, false);
  assert.ok(rec.reasons.includes('Recruiter: ask who the employer is'));
  assert.ok(emp.reasons.includes('Employer holds a sponsor licence'));
});

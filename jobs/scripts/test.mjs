import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normCompany, sponsorshipFromText, buildJob, dropReason, mergeJobs, collapseDuplicates,
  sponsorMapFromCsv, parseCsv, parseReedDate, scoreJob, cleanText, formatLocation,
  DEFAULT_PROFILE, matchesProfile, belowSponsorThreshold,
} from './lib.mjs';

const feed = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const thr = JSON.parse(readFileSync(new URL('../data/thresholds.json', import.meta.url), 'utf8'));
const today = '2026-11-25';
const mk = (o = {}) => buildJob({ id: 'x', title: 'Data Analyst', company: 'Acme', location: 'Leeds', url: 'https://e.co', source: 'Reed', posted: today, ...o }, feed, null);
const profile = (o = {}) => ({ ...DEFAULT_PROFILE, ...o });

test('company names match across suffixes', () => {
  assert.equal(normCompany('Barbour Ltd'), normCompany('BARBOUR'));
  assert.equal(normCompany('Ashley & McDonough Ltd'), 'ashley and mcdonough');
});

test('feed keeps analyst titles and drops noise, but not seniority', () => {
  assert.equal(dropReason(mk(), feed, today), null);
  assert.equal(dropReason(mk({ title: 'Senior Data Analyst' }), feed, today), null);
  assert.equal(dropReason(mk({ title: 'AI Trainer analyst' }), feed, today), 'title-excluded');
  assert.equal(dropReason(mk({ title: 'Warehouse Operative' }), feed, today), 'title');
  assert.equal(dropReason(mk({ company: 'DataAnnotation' }), feed, today), 'company');
  assert.equal(dropReason(mk({ posted: '2026-10-01' }), feed, today), 'too-old');
});

test('explicit refusal wins over offered wording', () => {
  assert.equal(sponsorshipFromText('We are unable to sponsor visas.', feed), 'refused');
  assert.equal(sponsorshipFromText('We do not offer sponsorship, but offer sponsorship for senior roles', feed), 'refused');
  assert.equal(sponsorshipFromText('Skilled Worker visa sponsorship available', feed), 'offered');
  assert.equal(sponsorshipFromText('Great team and benefits', feed), 'unknown');
});

test('profile: sponsorship need hides refusals, otherwise they show', () => {
  const j = mk({ description: 'No sponsorship available.' });
  assert.equal(matchesProfile(j, profile({ needsSponsorship: true })), false);
  assert.equal(matchesProfile(j, profile({ needsSponsorship: false })), true);
});

test('profile: roles, seniority and pay floor', () => {
  const p = profile({ roles: ['data', 'business'], salaryFloor: 26000 });
  assert.ok(matchesProfile(mk(), p));
  assert.ok(!matchesProfile(mk({ title: 'Finance Analyst' }), p));
  assert.ok(!matchesProfile(mk({ title: 'Senior Data Analyst' }), p));
  assert.ok(!matchesProfile(mk({ salaryMin: 20000, salaryMax: 24000 }), p));
  assert.ok(matchesProfile(mk({ salaryMin: 28000, salaryMax: 32000 }), p));
  assert.ok(matchesProfile(mk(), p), 'unstated pay is kept');
});

test('profile: regions and remote', () => {
  const p = profile({ regions: ['newcastle', 'durham'] });
  assert.ok(matchesProfile(mk({ location: 'Newcastle upon Tyne' }), p));
  assert.ok(!matchesProfile(mk({ location: 'Leeds' }), p));
  assert.ok(matchesProfile(mk({ location: 'Leeds', title: 'Data Analyst (Remote)' }), p));
  assert.ok(!matchesProfile(mk({ location: 'Leeds', title: 'Data Analyst (Remote)' }), profile({ regions: ['newcastle'], includeRemote: false })));
});

test('profile: licensed only', () => {
  const map = new Map([[normCompany('Acme'), true]]);
  const licensed = buildJob({ id: 'a', title: 'Data Analyst', company: 'Acme', url: 'u', source: 's', posted: today }, feed, map);
  assert.equal(licensed.sponsorLicence, 'licensed');
  assert.ok(matchesProfile(licensed, profile({ licensedOnly: true })));
  assert.ok(!matchesProfile(mk({ company: 'Other' }), profile({ licensedOnly: true })));
});

test('scoring uses the profile and shows its reasons', () => {
  const p = profile({ roles: ['data'], salaryFloor: 26000, salaryTarget: [28000, 35000], needsSponsorship: true });
  const good = scoreJob({ ...mk({ title: 'Junior Data Analyst', salaryMin: 28000, salaryMax: 34000 }), sponsorLicence: 'licensed', sponsorship: 'offered' }, p, thr);
  const poor = scoreJob({ ...mk({ salaryMin: 20000, salaryMax: 22000 }), sponsorLicence: 'not-found' }, p, thr);
  assert.ok(good.score > poor.score);
  assert.ok(good.reasons.includes('Employer holds a sponsor licence'));
  assert.ok(poor.reasons.includes('Pay below your floor'));
  for (const r of [good, poor]) assert.ok(r.score >= 0 && r.score <= 5);
});

test('visa threshold flag is indicative and only counts stated pay', () => {
  assert.ok(belowSponsorThreshold(mk({ salaryMin: 28000, salaryMax: 32000 }), thr));
  assert.ok(!belowSponsorThreshold(mk({ salaryMin: 36000, salaryMax: 40000 }), thr));
  assert.ok(!belowSponsorThreshold(mk(), thr));
  const r = scoreJob(mk({ salaryMin: 28000, salaryMax: 32000 }), profile({ needsSponsorship: true, salaryTarget: [28000, 35000] }), thr);
  assert.ok(r.reasons.includes('Pay may be below the visa threshold'));
  const r2 = scoreJob(mk({ salaryMin: 28000, salaryMax: 32000 }), profile({ needsSponsorship: false, salaryTarget: [28000, 35000] }), thr);
  assert.ok(!r2.reasons.includes('Pay may be below the visa threshold'));
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
});

test('csv quotes and Reed dates', () => {
  assert.deepEqual(parseCsv('a,"b,c","d ""e"""\n1,2,3'), [['a', 'b,c', 'd "e"'], ['1', '2', '3']]);
  assert.equal(parseReedDate('24/11/2026'), '2026-11-24');
});

test('postcodes become outward codes', () => {
  assert.equal(formatLocation('NN72QA'), 'Near NN7');
  assert.equal(formatLocation('S60 2TH'), 'Near S60');
  assert.equal(formatLocation('Leeds'), 'Leeds');
});

test('one advert posted for many places collapses to one entry', () => {
  const a = { ...mk({ id: '1', company: 'ITOL Recruit', title: 'Data Analyst Trainee', location: 'NN72QA' }) };
  const b = { ...mk({ id: '2', company: 'ITOL Recruit Ltd', title: 'Data Analyst Trainee', location: 'CH72JB' }) };
  const c = { ...mk({ id: '3', company: 'Other', title: 'Data Analyst Trainee', location: 'Leeds' }) };
  const out = collapseDuplicates([a, b, c]);
  assert.equal(out.length, 2);
  const itol = out.find((j) => j.company.startsWith('ITOL'));
  assert.deepEqual(itol.locations.sort(), ['Near CH7', 'Near NN7']);
  assert.match(itol.location, /and 1 more/);
});

test('merge keeps first seen, drops stale jobs and collapses repeats', () => {
  const a = mk({ id: '1', posted: '2026-11-20' });
  const b = mk({ id: '2', title: 'Business Analyst', posted: '2026-11-24' });
  const stale = mk({ id: '3', title: 'Reporting Analyst', posted: '2026-09-01' });
  const first = mergeJobs([], [a, b], '2026-11-24', 45);
  const second = mergeJobs([...first, stale], [a], '2026-11-25', 45);
  assert.equal(second.find((j) => j.id === '1').firstSeen, '2026-11-24');
  assert.ok(!second.find((j) => j.id === '3'));
  assert.ok(second.find((j) => j.id === '2'));
});

test('advert text is cleaned and capped', () => {
  assert.equal(cleanText('<p>Build <b>reports</b>&nbsp;in Excel</p><ul><li>SQL</li></ul>'), 'Build reports in Excel\nSQL');
  assert.equal(mk({ description: 'a'.repeat(5000) }).summary.length, 1800);
});

test('old records with raw postcodes are cleaned when collapsed', () => {
  const old = { ...mk({ id: 'o', location: 'G11AB' }), locations: undefined, location: 'G11AB' };
  const [j] = collapseDuplicates([old]);
  assert.equal(j.location, 'Near G1');
});

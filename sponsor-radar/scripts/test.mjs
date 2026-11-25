import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normCompany, sponsorshipFromText, buildJob, dropReason, mergeJobs, collapseDuplicates,
  sponsorMapFromCsv, parseCsv, parseReedDate, scoreJob, cleanText, formatLocation,
  DEFAULT_PROFILE, matchesProfile, belowSponsorThreshold, isAgency, isRecruiter, jobFamily, isHardToSponsor, normalisePay,
  payBasis, hourlyEquivalent, belowPayFloor, belowMinimumWage,
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
  assert.equal(dropReason(mk({ title: 'Project Manager' }), feed, today), 'title');
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

test('recruiters are recognised from the company name', () => {
  for (const c of ['Harnham - Data & Analytics Recruitment', 'Hays Specialist Recruitment Limited', 'Adecco', 'ITOL Recruit', 'Reed', 'Reed Specialist Recruitment', 'Robert Half', 'Spencer Ogden', 'Acme Staffing Ltd', 'Pinnacle Personnel']) {
    assert.ok(isAgency({ company: c }), c);
  }
  for (const c of ['Barbour', 'Jackson Hogg', 'Reed Smith LLP', 'Reed Exhibitions', 'British Heart Foundation', 'Yusen Logistics', 'Aviva']) {
    assert.ok(!isAgency({ company: c }), c);
  }
});

test('recruiters are recognised from the advert wording', () => {
  assert.ok(isAgency({ company: 'Northern Analytics', summary: 'We are recruiting on behalf of our client, a retailer in Leeds.' }));
  assert.ok(isAgency({ company: 'Northern Analytics', summary: 'Acme is an employment agency for permanent roles.' }));
  assert.ok(!isAgency({ company: 'Northern Analytics', summary: 'Join our analytics team in Leeds. We value clients and teamwork.' }));
});

test('the feed stores the recruiter flag, and old records fall back to a guess', () => {
  assert.equal(mk({ company: 'Hays Specialist Recruitment Limited' }).agency, true);
  assert.equal(mk({ company: 'Barbour' }).agency, false);
  assert.equal(isRecruiter({ company: 'Adecco' }), true, 'no stored flag');
  assert.equal(isRecruiter({ company: 'Adecco', agency: false }), false, 'stored flag wins');
});

test('profile can hide recruiters', () => {
  const agency = mk({ company: 'Harnham Recruitment' });
  assert.ok(matchesProfile(agency, profile()));
  assert.ok(!matchesProfile(agency, profile({ hideAgencies: true })));
  assert.ok(matchesProfile(mk({ company: 'Barbour' }), profile({ hideAgencies: true })));
});

test('a recruiter licence earns no score bonus and says to ask who the employer is', () => {
  const map = new Map([[normCompany('Hays Specialist Recruitment Limited'), true], [normCompany('Barbour'), true]]);
  const mkl = (company) => buildJob({ id: company, title: 'Data Analyst', company, url: 'u', source: 's', posted: today }, feed, map);
  const p = profile({ needsSponsorship: true });
  const rec = scoreJob(mkl('Hays Specialist Recruitment Limited'), p, thr);
  const emp = scoreJob(mkl('Barbour'), p, thr);
  assert.ok(rec.reasons.includes('Recruiter: ask who the employer is'));
  assert.ok(!rec.reasons.includes('Employer holds a sponsor licence'));
  assert.ok(emp.reasons.includes('Employer holds a sponsor licence'));
  assert.ok(emp.score > rec.score);
});

test('the feed accepts non-analyst role families', () => {
  for (const title of ['Support Worker', 'Healthcare Assistant', 'Customer Service Advisor', 'Warehouse Operative', 'Kitchen Assistant', 'Delivery Driver', 'Senior Carer']) {
    assert.equal(dropReason(mk({ title }), feed, today), null, title);
  }
  assert.equal(dropReason(mk({ title: 'Project Manager' }), feed, today), 'title');
  assert.ok(feed.queries.includes('support worker') && feed.queries.includes('data analyst'));
});

test('titles are grouped into role families', () => {
  const cases = { 'Data Analyst': 'analyst', 'Support Worker': 'support-care', 'Senior Carer': 'support-care', 'Healthcare Assistant': 'support-care', 'Customer Service Advisor': 'service-admin', 'Receptionist': 'service-admin', 'Warehouse Operative': 'warehouse', 'Delivery Driver': 'warehouse', 'Kitchen Assistant': 'hospitality-retail', 'Chef': 'hospitality-retail', 'Project Manager': 'other' };
  for (const [t, f] of Object.entries(cases)) assert.equal(jobFamily(t), f, t);
  assert.equal(mk({ title: 'Support Worker' }).family, 'support-care');
  assert.ok(isHardToSponsor({ title: 'Support Worker' }));
  assert.ok(!isHardToSponsor({ title: 'Data Analyst' }));
  assert.equal(isHardToSponsor({ title: 'Support Worker', family: 'analyst' }), false, 'stored family wins');
});

test('hard-to-sponsor roles score lower for people who need sponsorship, unless the advert offers it', () => {
  const p = profile({ needsSponsorship: true });
  const support = scoreJob(mk({ title: 'Support Worker' }), p, thr);
  const analyst = scoreJob(mk({ title: 'Data Analyst' }), p, thr);
  assert.ok(support.reasons.includes('This type of role is rarely sponsored'));
  assert.ok(!analyst.reasons.includes('This type of role is rarely sponsored'));
  assert.ok(analyst.score > support.score);
  const offered = scoreJob({ ...mk({ title: 'Support Worker' }), sponsorship: 'offered' }, p, thr);
  assert.ok(!offered.reasons.includes('This type of role is rarely sponsored'));
  const noNeed = scoreJob(mk({ title: 'Support Worker' }), profile({ needsSponsorship: false }), thr);
  assert.ok(!noNeed.reasons.includes('This type of role is rarely sponsored'));
});

test('searching support worker finds support roles and nothing else', () => {
  const p = profile({ roles: ['support worker'] });
  assert.ok(matchesProfile(mk({ title: 'Support Worker - Supported Living' }), p));
  assert.ok(!matchesProfile(mk({ title: 'Data Analyst' }), p));
});

test('health and care register entries count as licensed', () => {
  const csv = ['Organisation Name,Town/City,County,Type & Rating,Route', '"Kind Care Ltd",Leeds,,Worker (A rating),Health and Care Worker'].join('\n');
  assert.ok(sponsorMapFromCsv(csv).has(normCompany('Kind Care')));
});

test('hourly, daily and weekly rates become yearly figures, and yearly pay is left alone', () => {
  const hourly = normalisePay({ salaryMin: 13.5, salaryMax: 13.5, summary: '' });
  assert.equal(hourly.salaryUnit, 'hour');
  assert.equal(hourly.salaryMin, 26325);
  assert.equal(hourly.rateMin, 13.5);
  const range = normalisePay({ salaryMin: 14, salaryMax: 17, summary: '' });
  assert.deepEqual([range.salaryMin, range.salaryMax, range.rateMin, range.rateMax], [27300, 33150, 14, 17]);
  const day = normalisePay({ salaryMin: 350, salaryMax: 400, summary: '' });
  assert.equal(day.salaryUnit, 'day');
  assert.equal(day.salaryMax, 104000);
  const year = normalisePay({ salaryMin: 28000, salaryMax: 32000, summary: '' });
  assert.equal(year.salaryUnit, 'year');
  assert.equal(year.salaryMin, 28000);
  assert.equal(normalisePay({ salaryMin: null, salaryMax: null }).salaryUnit, null);
});

test('the advert wording decides the unit when the number could be a day or a week', () => {
  assert.equal(normalisePay({ salaryMin: 450, salaryMax: 450, summary: 'Pay: £450 per week plus bonus' }).salaryUnit, 'week');
  assert.equal(normalisePay({ salaryMin: 450, salaryMax: 450, summary: 'Rate of £450 a day inside IR35' }).salaryUnit, 'day');
  assert.equal(normalisePay({ salaryMin: 45, salaryMax: 45, summary: 'We pay £45 per hour' }).salaryUnit, 'hour');
  const weekly = normalisePay({ salaryMin: 450, salaryMax: 450, summary: '£450 per week' });
  assert.equal(weekly.salaryMin, 23400);
  assert.equal(normalisePay({ salaryMin: 450, salaryMax: 450, summary: 'Hours: 37.5 per week' }).salaryUnit, 'day', 'hours per week is not a pay rate');
});

test('normalising twice changes nothing', () => {
  const once = normalisePay({ salaryMin: 14, salaryMax: 17, summary: '' });
  assert.deepEqual(normalisePay(once), once);
});

test('the feed keeps the advertised rate and a yearly figure for hourly roles', () => {
  const job = mk({ title: 'Care Assistant', salaryMin: 14.75, salaryMax: 14.75 });
  assert.equal(job.salaryUnit, 'hour');
  assert.equal(job.rateMax, 14.75);
  assert.equal(job.salaryMax, 28763);
});

test('stored records from before the fix are repaired when merged', () => {
  const old = { ...mk({ id: 'old1', title: 'Care Assistant' }), salaryMin: 13.21, salaryMax: 13.21, salaryUnit: undefined };
  delete old.salaryUnit;
  const [fixed] = mergeJobs([old], [], today, 45);
  assert.equal(fixed.salaryUnit, 'hour');
  assert.equal(fixed.salaryMax, 25760);
});

test('each advert is judged in the unit it was quoted in', () => {
  const yearly = mk({ salaryMin: 28000, salaryMax: 30000 });
  const hourly = mk({ title: 'Care Assistant', salaryMin: 12, salaryMax: 12 });
  const daily = mk({ title: 'Business Analyst', salaryMin: 350, salaryMax: 400 });
  const none = mk({ title: 'Receptionist' });
  assert.deepEqual([payBasis(yearly), payBasis(hourly), payBasis(daily), payBasis(none)], ['year', 'hour', 'hour', null]);
  assert.equal(Math.round(hourlyEquivalent(yearly) * 100) / 100, 15.38);
  assert.equal(hourlyEquivalent(hourly), 12);
  assert.equal(Math.round(hourlyEquivalent(daily) * 100) / 100, 53.33);
  assert.equal(hourlyEquivalent(none), null);
});

test('the yearly floor applies to yearly adverts and the hourly floor to hourly adverts', () => {
  const p = profile({ salaryFloor: 26000, hourlyFloor: 12.71 });
  assert.ok(belowPayFloor(mk({ salaryMin: 22000, salaryMax: 24000 }), p), 'yearly below the yearly floor');
  assert.ok(!belowPayFloor(mk({ salaryMin: 27000, salaryMax: 30000 }), p));
  assert.ok(belowPayFloor(mk({ title: 'Care Assistant', salaryMin: 11, salaryMax: 11 }), p), 'hourly below the hourly floor');
  assert.ok(!belowPayFloor(mk({ title: 'Care Assistant', salaryMin: 13.5, salaryMax: 13.5 }), p));
  assert.ok(!belowPayFloor(mk({ title: 'Care Assistant', salaryMin: 13.5, salaryMax: 13.5 }), profile({ salaryFloor: 40000 })), 'the yearly floor does not judge an hourly advert');
  assert.ok(!belowPayFloor(mk({ salaryMin: 22000, salaryMax: 24000 }), profile({ hourlyFloor: 30 })), 'the hourly floor does not judge a yearly advert');
  assert.ok(!belowPayFloor(mk({ title: 'Receptionist' }), p), 'no pay stated means no pay filter');
});

test('filtering and scoring use the advertised unit', () => {
  const p = profile({ salaryFloor: 26000, hourlyFloor: 12.71 });
  assert.ok(matchesProfile(mk({ title: 'Care Assistant', salaryMin: 13.5, salaryMax: 13.5 }), p));
  assert.ok(!matchesProfile(mk({ title: 'Care Assistant', salaryMin: 11, salaryMax: 11 }), p));
  assert.ok(!matchesProfile(mk({ salaryMin: 22000, salaryMax: 24000 }), p));
  const low = scoreJob(mk({ title: 'Care Assistant', salaryMin: 11, salaryMax: 11 }), p, thr);
  assert.ok(low.reasons.includes('Pay below your floor'));
});

test('minimum wage flag compares the hourly equivalent with the over-21 rate', () => {
  assert.ok(thr.minimumWage.over21 > 10 && thr.minimumWage.asOf && thr.minimumWage.source);
  assert.ok(belowMinimumWage(mk({ title: 'Care Assistant', salaryMin: 11, salaryMax: 11 }), thr));
  assert.ok(!belowMinimumWage(mk({ title: 'Care Assistant', salaryMin: 13, salaryMax: 13 }), thr));
  assert.ok(belowMinimumWage(mk({ salaryMin: 20000, salaryMax: 20000 }), thr), 'about £10.26 an hour as a full-time salary');
  assert.ok(!belowMinimumWage(mk({ salaryMin: 26000, salaryMax: 26000 }), thr));
  assert.ok(!belowMinimumWage(mk({ title: 'Receptionist' }), thr));
  const r = scoreJob(mk({ title: 'Care Assistant', salaryMin: 11, salaryMax: 11 }), profile(), thr);
  assert.ok(r.reasons.includes('Pay looks below the minimum wage'));
});

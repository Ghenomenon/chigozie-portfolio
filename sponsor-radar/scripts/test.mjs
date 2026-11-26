import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isUkLocation, readBoard, slugGuesses, boardBelongsTo, boardFits, discoverBoards, readBoards, fetchBoard, registerSlice, displayName, RULES, ATS } from './boards.mjs';
import {
  normCompany, sponsorshipFromText, buildJob, dropReason, mergeJobs, collapseDuplicates,
  sponsorMapFromCsv, parseCsv, parseReedDate, scoreJob, cleanText, formatLocation,
  DEFAULT_PROFILE, matchesProfile, belowSponsorThreshold, isAgency, isRecruiter, jobFamily, isHardToSponsor, normalisePay,
  payBasis, hourlyEquivalent, belowPayFloor, belowMinimumWage,
  expandRoles, filterReason, explainFilters, FILTER_STEPS, titleMatchesRoles, idsOf, isStale,
  placeCoords, milesBetween, distanceMiles,
  nameHash, packRegister, registerHas, guessFromUrl, manualJob,
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
  assert.equal(mk({ description: 'a'.repeat(5000) }).summary.length, 1000);
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

test('a search for support worker also finds similar titles, and can be switched to exact', () => {
  const p = profile({ roles: ['support worker'] });
  for (const t of ['Support Worker', 'Care Assistant - Care Home', 'Live In Care Worker', 'Healthcare Assistant', 'Domiciliary Carer']) {
    assert.ok(titleMatchesRoles(mk({ title: t }), p), t);
  }
  assert.ok(!titleMatchesRoles(mk({ title: 'Data Analyst' }), p));
  assert.ok(!titleMatchesRoles(mk({ title: 'Warehouse Operative' }), p));
  const exact = profile({ roles: ['support worker'], similarTitles: false });
  assert.ok(titleMatchesRoles(mk({ title: 'Support Worker' }), exact));
  assert.ok(!titleMatchesRoles(mk({ title: 'Care Assistant' }), exact));
  assert.deepEqual(expandRoles(['sales'], true), ['sales'], 'a word in no group is left alone');
});

test('the senior filter hides senior analysts but not senior carers', () => {
  const p = profile({ roles: [] });
  assert.equal(filterReason(mk({ title: 'Senior Data Analyst' }), p), 'words');
  assert.equal(filterReason(mk({ title: 'Senior Care Worker' }), p), null);
  assert.equal(filterReason(mk({ title: 'Senior Healthcare Assistant' }), p), null);
  assert.equal(filterReason(mk({ title: 'Care Home Manager' }), p), 'words', 'manager still hides');
  assert.equal(filterReason(mk({ title: 'Lead Support Worker' }), p), 'words', 'lead still hides');
});

test('every hidden role is explained by exactly one setting', () => {
  const jobs = [
    mk({ id: 'a', title: 'Support Worker' }),
    mk({ id: 'b', title: 'Data Analyst' }),
    mk({ id: 'c', title: 'Support Worker Manager' }),
    mk({ id: 'd', title: 'Care Assistant', description: 'No sponsorship available.' }),
    mk({ id: 'e', title: 'Care Worker', salaryMin: 10, salaryMax: 10 }),
    mk({ id: 'f', title: 'Support Worker', location: 'London' }),
    mk({ id: 'g', title: 'Care Worker', company: 'Pinnacle Recruitment' }),
  ];
  const p = profile({ roles: ['support worker'], needsSponsorship: true, hourlyFloor: 12.71, regions: ['leeds'], hideAgencies: true });
  const x = explainFilters(jobs, p);
  assert.equal(x.total, 7);
  assert.deepEqual(x.hidden, { roles: 1, words: 1, sponsorship: 1, pay: 1, place: 1, licence: 0, recruiter: 1 });
  assert.equal(x.shown, 1);
  assert.equal(Object.values(x.hidden).reduce((a, b) => a + b, 0) + x.shown, x.total);
  assert.deepEqual(Object.keys(x.hidden), FILTER_STEPS);
  assert.equal(jobs.filter((j) => matchesProfile(j, p)).length, x.shown, 'matchesProfile agrees');
});

test('a folded entry remembers every advert id, so the next run does not see them as new', () => {
  const a = mk({ id: 'r1', company: 'ITOL Recruit', title: 'Data Analyst Trainee', location: 'Leeds' });
  const b = mk({ id: 'r2', company: 'ITOL Recruit', title: 'Data Analyst Trainee', location: 'York' });
  const day1 = mergeJobs([], [a, b], '2026-11-24', 45);
  assert.equal(day1.length, 1);
  assert.deepEqual(idsOf(day1[0]).sort(), ['r1', 'r2']);
  assert.equal(day1[0].copies, 2);
  // day 2: both adverts are still live
  const day2 = mergeJobs(day1, [a, b], '2026-11-25', 45);
  assert.equal(day2.length, 1);
  assert.equal(day2[0].firstSeen, '2026-11-24', 'still first seen on day 1, not new again');
});

test('a new place for an old advert does not make the role new', () => {
  const a = mk({ id: 'r1', company: 'ITOL Recruit', title: 'Data Analyst Trainee', location: 'Leeds' });
  const day1 = mergeJobs([], [a], '2026-11-24', 45);
  const c = mk({ id: 'r3', company: 'ITOL Recruit', title: 'Data Analyst Trainee', location: 'Hull' });
  const day2 = mergeJobs(day1, [a, c], '2026-11-25', 45);
  assert.equal(day2.length, 1);
  assert.equal(day2[0].firstSeen, '2026-11-24');
  assert.equal(day2[0].locations.length, 2);
  assert.deepEqual(idsOf(day2[0]).sort(), ['r1', 'r3']);
});

test('a genuinely new role is marked new', () => {
  const a = mk({ id: 'r1', title: 'Data Analyst' });
  const day1 = mergeJobs([], [a], '2026-11-24', 45);
  const day2 = mergeJobs(day1, [a, mk({ id: 'r9', title: 'Business Analyst' })], '2026-11-25', 45);
  assert.equal(day2.find((j) => j.title === 'Business Analyst').firstSeen, '2026-11-25');
  assert.equal(day2.find((j) => j.title === 'Data Analyst').firstSeen, '2026-11-24');
});

test('folding keeps the full text when only one copy of an advert was read', () => {
  const unread = { ...mk({ id: 'u1', company: 'Acme', title: 'Care Assistant', location: 'Leeds' }), summary: 'Short snippet', sponsorship: 'unknown', detail: false };
  const read = { ...mk({ id: 'u2', company: 'Acme', title: 'Care Assistant', location: 'York' }), summary: 'The full advert text, visa sponsorship available.', sponsorship: 'offered', detail: true };
  for (const order of [[unread, read], [read, unread]]) {
    const [one] = collapseDuplicates(order);
    assert.equal(one.detail, true);
    assert.equal(one.sponsorship, 'offered');
    assert.match(one.summary, /full advert text/);
    assert.equal(one.locations.length, 2);
  }
  const [still] = collapseDuplicates([unread, { ...unread, id: 'u3', location: 'Hull' }]);
  assert.ok(!still.detail, 'two unread copies stay unread');
});

test('an entry that stops being returned is kept for a few days, then dropped', () => {
  const a = mk({ id: 'a', title: 'Data Analyst' });
  const b = mk({ id: 'b', title: 'Business Analyst' });
  const day1 = mergeJobs([], [a, b], '2026-11-20', 45, 3);
  assert.equal(day1.length, 2);
  assert.ok(day1.every((j) => j.lastSeen === '2026-11-20'));
  // b is no longer returned
  const day3 = mergeJobs(day1, [a], '2026-11-22', 45, 3);
  assert.equal(day3.length, 2, 'two days unseen is still within the 3 day grace');
  assert.equal(day3.find((j) => j.id === 'a').lastSeen, '2026-11-22');
  assert.equal(day3.find((j) => j.id === 'b').lastSeen, '2026-11-20');
  const day4 = mergeJobs(day3, [a], '2026-11-23', 45, 3);
  assert.equal(day4.length, 2, 'three days unseen is the last day it stays');
  const day5 = mergeJobs(day4, [a], '2026-11-24', 45, 3);
  assert.deepEqual(day5.map((j) => j.id), ['a'], 'four days unseen is dropped');
  const back = mergeJobs(day4, [a, b], '2026-11-23', 45, 3);
  assert.equal(back.length, 2, 'an entry that comes back is refreshed');
});

test('one returned copy keeps a folded entry alive', () => {
  const a = mk({ id: 'c1', company: 'Acme', title: 'Care Assistant', location: 'Leeds' });
  const b = mk({ id: 'c2', company: 'Acme', title: 'Care Assistant', location: 'York' });
  const day1 = mergeJobs([], [a, b], '2026-11-20', 45, 3);
  const later = mergeJobs(day1, [b], '2026-11-30', 45, 3);
  assert.equal(later.length, 1, 'only copy c2 is returned, and the entry survives');
  assert.equal(later[0].lastSeen, '2026-11-30');
});

test('entries from before last-seen existed count from the day they were first seen', () => {
  const old = { ...mk({ id: 'o', title: 'Data Analyst' }), firstSeen: '2026-11-20' };
  delete old.lastSeen;
  assert.ok(!isStale(old, '2026-11-23', 3));
  assert.ok(isStale(old, '2026-11-24', 3));
  assert.equal(mergeJobs([old], [], '2026-11-24', 45, 3).length, 0);
});

test('a closed advert is dropped at once, by closing date', () => {
  const closed = mk({ id: 'x', title: 'Data Analyst', expires: '2026-11-24' });
  assert.equal(dropReason(closed, feed, '2026-11-25'), 'expired');
  const open = mk({ id: 'y', title: 'Data Analyst', expires: '2026-11-25' });
  assert.equal(dropReason(open, feed, '2026-11-25'), null, 'closing today is still open');
  assert.equal(dropReason(mk({ id: 'z', title: 'Data Analyst' }), feed, '2026-11-25'), null, 'no closing date is fine');
  const stored = { ...mk({ id: 's', title: 'Data Analyst', expires: '2026-11-24' }), lastSeen: '2026-11-24' };
  assert.equal(mergeJobs([stored], [], '2026-11-25', 45, 3).length, 0, 'a stored entry past its closing date goes too');
});

test('folding keeps the latest last-seen and closing dates', () => {
  const a = { ...mk({ id: 'f1', company: 'Acme', title: 'Chef', location: 'Leeds', expires: '2026-12-01' }), lastSeen: '2026-11-20' };
  const b = { ...mk({ id: 'f2', company: 'Acme', title: 'Chef', location: 'York', expires: '2026-12-10' }), lastSeen: '2026-11-22' };
  const [one] = collapseDuplicates([a, b]);
  assert.equal(one.lastSeen, '2026-11-22');
  assert.equal(one.expires, '2026-12-10');
});

// ---------- distance from you ----------
const places = JSON.parse(readFileSync(new URL('../data/places.json', import.meta.url), 'utf8'));
const LONDON = [51.51, -0.12], MANCHESTER = [53.48, -2.24];

test('miles between London and Manchester is about 163', () => {
  const m = milesBetween(LONDON, MANCHESTER);
  assert.ok(m > 155 && m < 170, String(m));
  assert.equal(milesBetween(LONDON, LONDON), 0);
});

test('place names, postcode districts, counties and sub-areas all resolve', () => {
  const near = (text, [lat, lon], within = 12) => {
    const c = placeCoords(text, places);
    assert.ok(c, `no coordinates for ${text}`);
    assert.ok(milesBetween(c, [lat, lon]) < within, `${text} landed ${Math.round(milesBetween(c, [lat, lon]))} miles off`);
  };
  near('London', [51.51, -0.12]);
  near('Milton Keynes', [52.04, -0.76]);
  near('Near LE67', [52.72, -1.37]);
  near('Near SE1', [51.5, -0.09], 4);
  near('South West London', [51.51, -0.12], 15);
  near('Hampshire', [51.06, -1.31], 5);
  near('Belfast', [54.6, -5.93], 5);
  near('Cardiff', [51.48, -3.18], 5);
  near('Leeds, West Yorkshire', [53.8, -1.55], 8);
});

test('places that cannot be measured give null, not a wrong guess', () => {
  for (const t of ['United Kingdom', 'County Galway', 'Dublin', '', 'Remote']) assert.equal(placeCoords(t, places), null, t);
  assert.equal(placeCoords('London', null), null);
});

test('the distance to a folded advert is the nearest of its places', () => {
  const job = { locations: ['Newcastle upon Tyne', 'Birmingham', 'Plymouth'], location: 'Newcastle upon Tyne and 2 more' };
  const fromBirmingham = distanceMiles(job, [52.48, -1.9], places);
  assert.ok(fromBirmingham < 5, String(fromBirmingham));
  assert.equal(distanceMiles({ locations: ['United Kingdom'] }, LONDON, places), null);
  assert.equal(distanceMiles(job, null, places), null);
});

test('the place formats Reed and Adzuna use can be measured, and country-wide ones cannot', () => {
  // A fixed sample, so a change in the live feed can never fail the daily job.
  const named = ['London', 'Manchester', 'Milton Keynes', 'Near LE67', 'Near SW11', 'Leeds, West Yorkshire', 'Birmingham, West Midlands', 'South West London', 'Hampshire',
    'Cardiff', 'Belfast', 'Greater Manchester', 'Stratford-upon-Avon', 'Bicester, Oxfordshire', 'Warwick', 'Tamworth, Staffordshire', 'Exeter, Devon', 'Preston, Lancashire', 'Leicester', 'Swindon, Wiltshire'];
  const placed = named.filter((t) => distanceMiles({ locations: [t] }, LONDON, places) !== null).length;
  assert.equal(placed, named.length, 'every named place in the sample is measured');
  for (const t of ['UK', 'United Kingdom', 'Dublin', 'County Galway']) assert.equal(distanceMiles({ locations: [t] }, LONDON, places), null, t);
});

// ---------- roles added by link ----------

test('the packed register finds licensed employers and nobody else', () => {
  const bytes = packRegister(['Acme Care Ltd', 'Northern Data Services Limited', 'Zed Hospitals PLC']);
  assert.equal(bytes.byteLength, 12);
  assert.ok(registerHas(bytes, 'ACME CARE LIMITED'), 'the same company in a different form of its name');
  assert.ok(registerHas(bytes, 'Northern Data Services'));
  assert.ok(!registerHas(bytes, 'Acme Care Homes'));
  assert.ok(!registerHas(bytes, ''));
  assert.ok(!registerHas(null, 'Acme'));
  assert.ok(registerHas(bytes.buffer, 'Zed Hospitals'), 'works on a plain ArrayBuffer too');
});

test('the packed register is small enough for a phone', () => {
  const names = Array.from({ length: 121177 }, (_, i) => `Employer number ${i} Limited`);
  const bytes = packRegister(names);
  assert.ok(bytes.byteLength > 460000 && bytes.byteLength <= 121177 * 4, String(bytes.byteLength));
  assert.ok(registerHas(bytes, 'Employer number 77777'));
  assert.ok(!registerHas(bytes, 'Employer number 999999'));
  assert.equal(nameHash('Acme Ltd'), nameHash('ACME LIMITED'));
});

test('a LinkedIn link carries the title and the employer', () => {
  const g = guessFromUrl('https://www.linkedin.com/jobs/view/senior-data-analyst-at-acme-analytics-ltd-3912345678');
  assert.equal(g.source, 'LinkedIn');
  assert.equal(g.title, 'Senior Data Analyst');
  assert.equal(g.company, 'Acme Analytics Ltd');
  assert.equal(guessFromUrl('https://uk.linkedin.com/jobs/view/3912345678').title, undefined);
});

test('other links give a site name, and a Reed link gives a title', () => {
  assert.equal(guessFromUrl('https://uk.indeed.com/viewjob?jk=abc123').source, 'Indeed');
  assert.equal(guessFromUrl('https://to.indeed.com/aaa').source, 'Indeed');
  assert.equal(guessFromUrl('https://www.reed.co.uk/jobs/care-assistant/54321').title, 'Care Assistant');
  assert.equal(guessFromUrl('https://boards.greenhouse.io/acme/jobs/1').source, 'boards.greenhouse.io');
});

test('links that are not https, or not links, are refused', () => {
  assert.equal(guessFromUrl('http://example.com/job'), null);
  assert.equal(guessFromUrl('javascript:alert(1)'), null);
  assert.equal(guessFromUrl('not a link'), null);
});

test('a role added by link gets a stable id, a sponsor check and the agency tag', () => {
  const reg = packRegister(['Acme Care Ltd']);
  const a = manualJob({ url: 'https://uk.indeed.com/viewjob?jk=abc', title: 'Care Assistant', company: 'Acme Care Limited', location: 'Leeds' }, '2026-11-26', reg);
  assert.equal(a.sponsorLicence, 'licensed');
  assert.equal(a.source, 'Indeed');
  assert.equal(a.manual, true);
  assert.equal(a.family, 'support-care');
  assert.equal(a.id, manualJob({ url: 'https://uk.indeed.com/viewjob?jk=abc', title: 'x', company: 'y' }, '2026-11-27', reg).id, 'same link, same id');
  assert.notEqual(a.id, manualJob({ url: 'https://uk.indeed.com/viewjob?jk=def', title: 'x', company: 'y' }, '2026-11-26', reg).id);
  assert.equal(manualJob({ url: 'https://uk.indeed.com/viewjob?jk=abc', title: 'Chef', company: 'Other Cafe' }, '2026-11-26', reg).sponsorLicence, 'not-found');
  assert.equal(manualJob({ url: 'https://uk.indeed.com/viewjob?jk=abc', title: 'Chef', company: 'Other Cafe' }, '2026-11-26', null).sponsorLicence, 'unknown', 'register not loaded');
  assert.equal(manualJob({ url: 'https://uk.indeed.com/viewjob?jk=abc', title: 'Recruiter', company: 'Hays Recruitment' }, '2026-11-26', reg).agency, true);
  const li = manualJob({ url: 'https://www.linkedin.com/jobs/view/support-worker-at-acme-care-ltd-3912345678' }, '2026-11-26', reg);
  assert.equal(li.title, 'Support Worker');
  assert.equal(li.sponsorLicence, 'licensed', 'title and employer filled from the link');
});

// ---------- employer boards ----------

const placesForBoards = JSON.parse(readFileSync(new URL('../data/places.json', import.meta.url), 'utf8'));

test('UK locations are told apart from the same place names abroad', () => {
  const uk = (t, o = {}) => isUkLocation(t, { places: placesForBoards, ...o });
  for (const t of ['London, UK', 'Remote (UK)', 'Cardiff, London or Remote (UK)', 'London', 'Leeds, England', 'Edinburgh', 'Belfast, Northern Ireland', 'United Kingdom']) assert.ok(uk(t), t);
  for (const t of ['Austin, TX', 'Cambridge, MA', 'New York, NY (HQ)', 'Dublin, Ireland', 'Barcelona', 'Remote (Canada)', 'Toronto, ON', 'Sydney, Australia', '']) assert.ok(!uk(t), t);
  assert.ok(uk('', { country: 'GB' }), 'an explicit country code wins');
  assert.ok(!uk('London', { country: 'US' }), 'London, Ontario is not here');
});

test('a Greenhouse board gives UK adverts with their full text', () => {
  const data = { jobs: [
    { id: 1, title: 'Data Analyst', company_name: 'Acme', absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/1', location: { name: 'London, UK' }, first_published: '2026-11-20T10:00:00-05:00', content: '&lt;p&gt;Build reports &amp;amp; dashboards.&lt;/p&gt;&lt;p&gt;No sponsorship.&lt;/p&gt;' },
    { id: 2, title: 'Data Analyst', company_name: 'Acme', absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/2', location: { name: 'Austin, TX' }, first_published: '2026-11-20T10:00:00-05:00', content: 'x' },
  ] };
  const out = readBoard('greenhouse', 'acme', data, 'Acme Ltd', { places: placesForBoards, today: '2026-11-26' });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'greenhouse-acme-1');
  assert.equal(out[0].company, 'Acme Ltd');
  assert.equal(out[0].posted, '2026-11-20');
  assert.ok(out[0].description.includes('Build reports & dashboards.'), out[0].description);
  assert.ok(!out[0].description.includes('<'), 'no markup left');
  assert.equal(out[0]._full, true);
});

test('a Lever board uses its country code, and an Ashby board checks secondary places', () => {
  const lever = [
    { id: 'a', text: 'Analyst', hostedUrl: 'https://jobs.lever.co/acme/a', categories: { location: 'London' }, country: 'GB', createdAt: 1790000000000, descriptionPlain: 'Do analysis.', lists: [{ text: 'You will', content: '<li>Write SQL</li>' }], additionalPlain: 'Right to work required.' },
    { id: 'b', text: 'Analyst', hostedUrl: 'https://jobs.lever.co/acme/b', categories: { location: 'London' }, country: 'CA', createdAt: 1790000000000, descriptionPlain: 'Canada.' },
  ];
  const l = readBoard('lever', 'acme', lever, 'Acme', { places: placesForBoards, today: '2026-11-26' });
  assert.deepEqual(l.map((x) => x.id), ['lever-acme-a']);
  assert.ok(l[0].description.includes('Write SQL') && l[0].description.includes('Right to work'));
  const ashby = { jobs: [
    { id: 'x', title: 'Analyst', location: 'New York, NY', secondaryLocations: [{ location: 'Remote (UK)' }], jobUrl: 'https://jobs.ashbyhq.com/acme/x', publishedAt: '2026-11-01T00:00:00Z', descriptionPlain: 'Hello', isListed: true },
    { id: 'y', title: 'Analyst', location: 'New York, NY', secondaryLocations: [], jobUrl: 'https://jobs.ashbyhq.com/acme/y', publishedAt: '2026-11-01T00:00:00Z', descriptionPlain: 'Hello', isListed: true },
    { id: 'z', title: 'Analyst', location: 'London', jobUrl: 'https://jobs.ashbyhq.com/acme/z', publishedAt: '2026-11-01T00:00:00Z', descriptionPlain: 'Hidden', isListed: false },
  ] };
  assert.deepEqual(readBoard('ashby', 'acme', ashby, 'Acme', { places: placesForBoards, today: '2026-11-26' }).map((x) => x.id), ['ashby-acme-x']);
});

test('slug guesses come from the employer name, and generic first words are not guessed', () => {
  assert.deepEqual(slugGuesses('Monzo Bank Limited'), ['monzobank', 'monzo-bank', 'monzo']);
  assert.deepEqual(slugGuesses('GoCardless Ltd'), ['gocardless']);
  assert.ok(!slugGuesses('British Care Services Ltd').includes('british'));
  assert.deepEqual(slugGuesses(''), []);
});

test('a board only counts when it belongs to the employer', () => {
  const gh = { jobs: [{ company_name: 'Monzo', title: 'Engineer', content: 'Join Monzo' }] };
  assert.ok(boardBelongsTo('Monzo Bank Limited', 'greenhouse', gh));
  assert.ok(!boardBelongsTo('Monzo Bank Limited', 'greenhouse', { jobs: [{ company_name: 'Other Co', title: 'Engineer', content: 'Join us' }] }));
  const lever = [{ text: 'Engineer', descriptionPlain: 'At Palantir we build', hostedUrl: 'https://jobs.lever.co/palantir/1' }];
  assert.ok(boardBelongsTo('Palantir Technologies UK Ltd', 'lever', lever));
  assert.ok(!boardBelongsTo('Palantir Technologies UK Ltd', 'lever', [{ text: 'Cook', descriptionPlain: 'Kitchen work', hostedUrl: 'https://jobs.lever.co/palantir/2' }]));
  assert.ok(!boardBelongsTo('Acme', 'ashby', { jobs: [] }));
});

test('the register slice moves on each day and wraps round', () => {
  const keys = Array.from({ length: 10 }, (_, i) => `employer ${i}`);
  const a = registerSlice(keys, '2026-11-26', 4), b = registerSlice(keys, '2026-11-27', 4);
  assert.equal(a.length, 4);
  assert.notDeepEqual(a, b);
  assert.deepEqual(registerSlice(keys, '2026-11-26', 4), a, 'same day, same slice');
  assert.equal(registerSlice(keys, '2026-11-26', 50).length, 10, 'never more than the register holds');
  const mixed = [...Array.from({ length: 20 }, (_, i) => `acme software ${i}`), ...Array.from({ length: 20 }, (_, i) => `care home ${i}`)];
  const slice = registerSlice(mixed, '2026-11-26', 10);
  assert.equal(slice.length, 10);
  assert.equal(slice.filter((k) => k.includes('software')).length, 8, 'four in five are tech or finance names');
  assert.deepEqual(registerSlice([], '2026-11-26', 4), []);
  assert.equal(displayName('monzo bank'), 'Monzo Bank');
});

// ---------- employer boards: the second set of rules ----------

test('big cities abroad are not taken for the small UK places that share their name', () => {
  const uk = (t) => isUkLocation(t, { places: placesForBoards });
  for (const t of ['New York, New York', 'US - San Francisco', 'Remote (US)', 'NY office', 'Durham office or Remote - US', 'Dublin office']) assert.ok(!uk(t), t);
  for (const t of ['London office', 'Manchester (M1)', 'Leeds (Hybrid)', 'London Hybrid']) assert.ok(uk(t), t);
});

test('the short name is only guessed when the rest of the name is a word like Bank or Labs', () => {
  assert.deepEqual(slugGuesses('Atlas Care Homes Ltd'), ['atlascarehomes', 'atlas-care-homes']);
  assert.deepEqual(slugGuesses('Axiom Home Care Limited'), ['axiomhomecare', 'axiom-home-care']);
  assert.ok(slugGuesses('Ripple Labs Ltd').includes('ripple'));
});

test('Greenhouse has to name the same company', () => {
  const gh = (company) => ({ jobs: [{ company_name: company, title: 'Analyst', content: 'x' }] });
  assert.ok(boardBelongsTo('Monzo Bank Limited', 'greenhouse', gh('Monzo')));
  assert.ok(boardBelongsTo('Ripple', 'greenhouse', gh('Ripple Labs')));
  assert.ok(!boardBelongsTo('Axiom Home Care Limited', 'greenhouse', gh('Axiom')), 'Axiom Global is not a home care company');
  assert.ok(!boardBelongsTo('Wise', 'greenhouse', gh('Wise Worksite Field Sales')));
  assert.ok(!boardBelongsTo('Convene', 'greenhouse', gh('Convene Hospitality Group')), 'unclear, so left out');
});

test('on Lever and Ashby the employer has to be named, with a capital letter, in most adverts', () => {
  assert.ok(boardBelongsTo('Enable Scotland', 'lever', [{ text: 'Support Worker', descriptionPlain: 'Enable Scotland supports people' }]));
  assert.ok(!boardBelongsTo('Enable Scotland', 'lever', [{ text: 'Developer', descriptionPlain: 'We enable teams across Scotland' }]), 'the word enable is not the employer');
  assert.ok(!boardBelongsTo('Palantir Technologies UK Ltd', 'lever', [{ text: 'Engineer', descriptionPlain: 'at palantir we build' }]));
  assert.ok(boardBelongsTo('Thought Machine', 'ashby', { jobs: [{ title: 'Engineer', descriptionPlain: 'Thought Machine is building' }] }));
});

test('a board needs a UK advert, and a short-name match needs one in the registered town', () => {
  const board = (loc) => ({ jobs: [{ id: 1, company_name: 'Monzo', title: 'Analyst', absolute_url: 'https://x.example/1', location: { name: loc }, content: 'x' }] });
  assert.ok(boardFits('Monzo Bank Limited', 'greenhouse', 'monzo', board('London, UK'), { places: placesForBoards, town: 'London' }));
  assert.ok(!boardFits('Monzo Bank Limited', 'greenhouse', 'monzo', board('Austin, TX'), { places: placesForBoards, town: 'London' }), 'no UK advert');
  assert.ok(!boardFits('Monzo Bank Limited', 'greenhouse', 'monzo', board('Leeds, UK'), { places: placesForBoards, town: 'Cardiff' }), 'short name, wrong town');
  assert.ok(boardFits('Monzo Bank Limited', 'greenhouse', 'monzo', board('Leeds, UK'), { places: placesForBoards, town: '' }), 'no town known: any UK advert');
  assert.ok(boardFits('Monzo Bank', 'greenhouse', 'monzobank', { jobs: [{ id: 1, company_name: 'Monzo Bank', title: 'Analyst', absolute_url: 'https://x.example/1', location: { name: 'Leeds, UK' }, content: 'x' }] }, { places: placesForBoards, town: 'Cardiff' }), 'a full-name match needs no town');
});

test('boards found under the old rules are checked again, and two employers cannot share one board', async () => {
  const boards = {
    'https://boards-api.greenhouse.io/v1/boards/axiom/jobs?content=true': { jobs: [{ id: 1, company_name: 'Axiom', title: 'Lawyer', absolute_url: 'https://x.example/1', location: { name: 'London, UK' }, content: 'Axiom' }] },
    'https://boards-api.greenhouse.io/v1/boards/monzo/jobs?content=true': { jobs: [{ id: 2, company_name: 'Monzo', title: 'Analyst', absolute_url: 'https://x.example/2', location: { name: 'London, UK' }, content: 'Monzo' }] },
  };
  const getJson = async (u) => { if (boards[u]) return boards[u]; throw new Error(`404 ${u}`); };
  const cache = { found: {
    'axiom global': { name: 'Axiom Global Limited', ats: 'greenhouse', slug: 'axiom', found: '2026-11-26' },
    'axiom home care': { name: 'Axiom Home Care Limited', ats: 'greenhouse', slug: 'axiom', found: '2026-11-26' },
    'monzo bank': { name: 'Monzo Bank Limited', ats: 'greenhouse', slug: 'monzo', found: '2026-11-26', rules: RULES },
  }, missed: {} };
  const res = await discoverBoards([], cache, { today: '2026-11-27', getJson, limit: 0, places: placesForBoards, townOf: () => 'London' });
  assert.equal(res.dropped, 1);
  assert.deepEqual(Object.keys(cache.found).sort(), ['axiom global', 'monzo bank']);
  assert.equal(cache.found['axiom global'].rules, RULES);
  assert.equal(cache.missed['axiom home care'], '2026-11-27');
});

test('well-known UK recruiters are tagged as agencies', () => {
  for (const c of ['Harvey Nash', 'Goodman Masson', 'Oliver James Associates', 'Robert Walters', 'Hackajob Ltd', 'hackajob']) assert.ok(isAgency({ company: c, title: '' }), c);
  assert.ok(!isAgency({ company: 'Monzo Bank', title: '' }));
});

test('the register keeps each employer\'s town', () => {
  const map = sponsorMapFromCsv('Organisation Name,Town/City,County,Type & Rating,Route\n"Monzo Bank Limited",London,,Worker (A rating),Skilled Worker\n"No Town Ltd",,,Worker (A rating),Skilled Worker');
  assert.equal(map.get('monzo bank'), 'London');
  assert.equal(map.get('no town'), true);
});

// ---------- SmartRecruiters and Workable ----------

const srPosting = (id, extra = {}) => ({
  id: String(id), name: 'Data Analyst', releasedDate: '2026-11-25T10:00:00Z',
  company: { identifier: 'Wise', name: 'Wise' },
  location: { city: 'London', region: '', country: 'gb', fullLocation: 'London, , United Kingdom', remote: false, hybrid: true },
  ...extra,
});

test('a SmartRecruiters board pages through UK adverts and reads the text of recent ones', async () => {
  const calls = [];
  const page1 = Array.from({ length: 100 }, (_, i) => srPosting(i));
  const page2 = [srPosting(100, { releasedDate: '2026-01-01T00:00:00Z' })];
  const getJson = async (u) => {
    calls.push(u);
    if (u.includes('offset=0')) return { totalFound: 101, content: page1 };
    if (u.includes('offset=100')) return { totalFound: 101, content: page2 };
    if (/\/postings\/\d+$/.test(u)) return { postingUrl: `https://jobs.smartrecruiters.com/Wise/${u.split('/').pop()}-data-analyst`, jobAd: { sections: { jobDescription: { text: '<p>Build reports. Visa sponsorship available.</p>' } } } };
    throw new Error(`404 ${u}`);
  };
  const data = await fetchBoard('smartrecruiters', 'wise', getJson, { today: '2026-11-26', detailCap: 3 });
  assert.equal(data.content.length, 101, 'both pages');
  assert.equal(calls.filter((u) => /\/postings\/\d+$/.test(u)).length, 3, 'text read for recent adverts only, up to the cap');
  const out = readBoard('smartrecruiters', 'wise', data, 'Wise Payments Limited', { places: placesForBoards, today: '2026-11-26' });
  assert.equal(out.length, 101);
  assert.equal(out[0].location, 'London, United Kingdom', 'the empty region is tidied away');
  assert.match(out[0].url, /^https:\/\/jobs\.smartrecruiters\.com\/Wise\/0-data-analyst$/);
  assert.match(out[0].description, /Visa sponsorship available\. Hybrid\.$/);
  assert.equal(out[100].url, 'https://jobs.smartrecruiters.com/Wise/100', 'an advert without its text still gets a link');
  assert.ok(boardBelongsTo('Wise Payments Limited', 'smartrecruiters', data), 'SmartRecruiters names the company');
  assert.ok(!boardBelongsTo('Wise Care Ltd', 'smartrecruiters', data));
});

test('a Workable board gives UK adverts and names the company', () => {
  const data = { name: 'Acme Analytics', jobs: [
    { title: 'Data Analyst', shortcode: 'AB12', url: 'https://apply.workable.com/j/AB12', city: 'Leeds', state: 'England', country: 'United Kingdom', published_on: '2026-11-24', telecommuting: false, description: '<p>SQL and Power BI.</p>', requirements: '<p>Right to work in the UK.</p>', locations: [{ city: 'Leeds', countryCode: 'GB', country: 'United Kingdom' }] },
    { title: 'Data Analyst', shortcode: 'CD34', url: 'https://apply.workable.com/j/CD34', city: 'Austin', state: 'Texas', country: 'United States', published_on: '2026-11-24', locations: [{ city: 'Austin', countryCode: 'US' }] },
    { title: 'Remote Analyst', shortcode: 'EF56', url: 'https://apply.workable.com/j/EF56', published_on: '2026-11-24', telecommuting: true, locations: [{ countryCode: 'GB', country: 'United Kingdom' }] },
  ] };
  const out = readBoard('workable', 'acme', data, 'Acme Analytics Ltd', { places: placesForBoards, today: '2026-11-26' });
  assert.deepEqual(out.map((x) => x.id), ['workable-acme-AB12', 'workable-acme-EF56']);
  assert.equal(out[0].location, 'Leeds, England, United Kingdom');
  assert.match(out[0].description, /Power BI\.\nRight to work/);
  assert.match(out[1].description, /Remote\.$/);
  assert.ok(boardBelongsTo('Acme Analytics Ltd', 'workable', data));
  assert.ok(!boardBelongsTo('Acme Care Homes', 'workable', data));
});

test('a board service that answers too many requests is paused for the rest of the run', async () => {
  const calls = [];
  const getJson = async (u) => { calls.push(u); if (u.includes('workable')) throw new Error('429 https://apply.workable.com'); throw new Error(`404 ${u}`); };
  const paused = new Set();
  const cache = { found: {}, missed: {}, services: ATS.join(',') };
  await discoverBoards(['Alpha Labs', 'Beta Labs', 'Gamma Labs'], cache, { today: '2026-11-26', getJson, limit: 3, concurrency: 1, places: placesForBoards, paused });
  assert.ok(paused.has('workable'));
  assert.equal(calls.filter((u) => u.includes('workable')).length, 1, 'asked once, then left alone');
  const read = await readBoards({ found: { x: { name: 'X', ats: 'workable', slug: 'x' } }, missed: {} }, { today: '2026-11-26', getJson, places: placesForBoards, paused });
  assert.equal(read.failed, 1);
  assert.equal(calls.filter((u) => u.includes('workable')).length, 1, 'known Workable boards wait for the next run');
});

test('when a board service is added, earlier misses are tried again', async () => {
  const getJson = async (u) => { throw new Error(`404 ${u}`); };
  const cache = { found: {}, missed: { 'old miss': '2026-11-26' }, services: 'greenhouse,lever,ashby' };
  const res = await discoverBoards([], cache, { today: '2026-11-26', getJson, limit: 0, places: placesForBoards });
  assert.equal(res.retried, 1);
  assert.deepEqual(cache.missed, {});
  assert.equal(cache.services, ATS.join(','));
  const again = await discoverBoards([], cache, { today: '2026-11-26', getJson, limit: 0, places: placesForBoards });
  assert.equal(again.retried, 0, 'only once');
});

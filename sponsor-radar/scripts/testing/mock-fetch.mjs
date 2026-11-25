// Preloaded with `node --import` so the daily job can run end to end with no network.
// It fakes the Home Office register page, Reed search and Reed detail calls, and logs every URL.
import { appendFileSync } from 'node:fs';

const log = (u) => process.env.CALLS_PATH && appendFileSync(process.env.CALLS_PATH, u + '\n');
const now = new Date();
const reedDate = `${String(now.getUTCDate()).padStart(2, '0')}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${now.getUTCFullYear()}`;

// How many adverts each fake search holds, so the paging can be checked.
const HOLDINGS = { 'support worker': 250, 'care assistant': 100000, chef: 150 };
const titleFor = (k) => k.replace(/\b\w/g, (c) => c.toUpperCase());

const csv = ['Organisation Name,Town/City,County,Type & Rating,Route']
  .concat(Array.from({ length: 1100 }, (_, i) => `"Sponsor ${i} Ltd",Leeds,,Worker (A rating),Skilled Worker`))
  .join('\n');

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (input) => {
  const url = String(input);
  log(url);
  if (url.includes('gov.uk/government/publications')) {
    return new Response('<a href="https://assets.publishing.service.gov.uk/x/register.csv">csv</a>', { headers: { 'content-type': 'text/html' } });
  }
  if (url.endsWith('register.csv')) return new Response(csv);
  if (url.includes('reed.co.uk/api/1.0/search')) {
    const u = new URL(url);
    const keyword = u.searchParams.get('keywords');
    const skip = Number(u.searchParams.get('resultsToSkip') || 0);
    if (keyword === 'chef' && skip >= 100) return json({ error: 'boom' }, 500);   // page 2 always fails
    const held = HOLDINGS[keyword] ?? 0;
    const n = Math.max(0, Math.min(100, held - skip));
    const results = Array.from({ length: n }, (_, i) => {
      const idx = skip + i;
      return {
        jobId: `${keyword.replace(/\W/g, '')}-${idx}`,
        employerName: `Employer ${idx % 40}`,
        jobTitle: titleFor(keyword),
        locationName: `Town ${idx}`,
        jobUrl: `https://www.reed.co.uk/jobs/${keyword.replace(/\W/g, '')}/${idx}`,
        date: reedDate,
        minimumSalary: 13.5,
        maximumSalary: 13.5,
        jobDescription: 'Short snippet.',
      };
    });
    return json({ results, totalResults: held });
  }
  if (url.includes('reed.co.uk/api/1.0/jobs/')) {
    return json({ jobDescription: '<p>Full advert text. Visa sponsorship available for the right candidate.</p>' });
  }
  return json({ results: [] });
};

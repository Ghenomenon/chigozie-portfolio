# Sponsor Radar

A phone app that lists new UK analyst roles every morning, with a Home Office sponsor-licence check on every employer. Built for people who need visa sponsorship, and useful for anyone searching UK analyst roles.

## How it works

- A GitHub Actions workflow (`.github/workflows/daily-sponsor-radar.yml`) runs at 07:15 UTC each day.
- It searches Reed and Adzuna, checks each employer against the Home Office register of licensed sponsors, flags adverts that mention or refuse sponsorship, and saves a shared feed to `sponsor-radar/data/jobs.json`.
- The daily job reads three pages (300 adverts) of each search, so the feed is a deeper sample of Reed than one page. It is still a sample, not every advert. Change `pagesPerQuery` in `sponsor-radar/config.json`.
- A search for support worker also finds care assistant, care worker and healthcare assistant. People can turn this off in their search settings. The groups are in `SIMILAR_TITLES` in `sponsor-radar/scripts/lib.mjs`. The default "senior" filter applies to analyst roles only, because senior carer is an ordinary care grade.
- The All tab has a "Why are roles hidden?" panel that explains the gap between the feed size and the roles shown.
- **Full text.** Reed's search returns only a short snippet, so sponsorship wording is read from a second call per advert. Copies of one advert (same employer and title) share one read. An entry is marked `detail` once it has been read in full. A run reads at most `maxDetailFetches` (in `config.json`); new adverts go first, then the unread backlog, newest first, so a capped run never loses the rest. A failed read leaves the entry unread and the next run retries it. The run log reports reads, backlog and entries still unread.
- Folded adverts remember every advert id, so a role is new only the first day it appears and adverts are not read in full twice.
- The feed covers analyst roles plus four other families: support and care, customer service and admin, warehouse and logistics, and hospitality and retail. Edit `queries` and `titleMustMatch` in `sponsor-radar/config.json` to change this.
- For people who need sponsorship, non-analyst roles carry a "Rarely sponsored" warning and a lower score. Most such roles no longer qualify for a Skilled Worker visa. The wording and date are in `sponsor-radar/data/thresholds.json`. Check gov.uk and keep it current.
- Reed gives hourly, daily and weekly rates in the same field as yearly pay. The feed works out which unit the advert used, from the advert wording or the size of the number, and keeps both the quoted rate and a yearly figure. Cards show pay as advertised with the other form beside it, for example "£14.75 an hour (about £28,763 a year)" or "£28,000 a year (about £14.36 an hour)".
- Each advert is judged in its own unit. The yearly floor applies to adverts that quote a yearly salary. The hourly floor applies to adverts that quote an hourly, daily or weekly rate (a day counts as 7.5 hours and a week as 37.5). The hourly floor starts at the National Living Wage, set in `sponsor-radar/data/thresholds.json`.
- A role whose pay works out below the National Living Wage for over-21s gets a "Below the minimum wage" flag and a lower score. It is a flag only, because part-time or unstated hours can make it wrong. Keep the figures in `thresholds.json` current from gov.uk.
- The same advert posted for many places becomes one entry.
- Recruitment agencies are tagged, because the sponsor register lists the recruiter and not the employer behind the advert. The tag is a best guess from the company name and the advert wording. People can hide recruiters in their search settings.
- Each person sets their own search on first launch: roles, places, pay floor, remote and sponsorship need. Filtering and fit scoring run on their phone.
- Each person's search, CV and tracker stay on their own phone. Nothing about them is sent to a server.

Feed settings (search terms, noise filters, sponsorship wording) are in `sponsor-radar/config.json`. Visa pay thresholds are in `sponsor-radar/data/thresholds.json`. Update them when gov.uk changes the figures.

## Apply button

Each role has an Apply button with five steps:

1. Get the advert. Read it from its link, or add a screenshot. See Advert reader below.
2. Copy the prompt. It holds the advert, the person's CV and strict rules: no invented facts, and no answers about right to work or visa status.
3. Paste it into Claude. It returns a tailored CV, a cover letter and draft answers to common form questions.
4. Submit the application on the employer's form. The app never sends anything.
5. Tick the box and mark the role as Applied. The date is saved in the tracker.

The person pastes their CV once in Settings. It is stored on their phone only.

## Advert reader

The Apply sheet gets the advert in one of two ways:

1. **Read the advert from its link.** A small Netlify function (`netlify/functions/advert.mjs`) opens the job page and returns the advert text. It uses the job's structured data when the page has it, and the page text otherwise. Sites that block automated readers, such as Indeed and LinkedIn, fail with a clear message.
2. **Add a screenshot.** Up to four images. They stay in memory and are never stored. On an iPhone the Share button sends the prompt and the images to Claude together. Elsewhere, paste the prompt into Claude and attach the images. Claude reads the advert from the image.

The function only opens known job sites at first (Reed, Adzuna, Indeed, Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday). It follows at most three redirects, refuses private and local addresses, caps the size and time of each page, and never caches a result. Edit `ALLOWED_FIRST_HOPS` in `netlify/lib/advert.mjs` to change the list.

After the first deploy, check it works: open `/.netlify/functions/advert?url=` followed by a Reed job link. You should see `"ok":true`. If you see a 404, Netlify has not picked up the `functions` line in `netlify.toml`.

Test it with `node --test netlify/lib/advert.test.mjs`.

## Set up your own copy

1. Fork this repository, or copy the `sponsor-radar` folder and `.github/workflows/daily-sponsor-radar.yml` into a site you control.
2. Publish the site (Netlify, GitHub Pages or any static host). The app lives at `/sponsor-radar/`.
3. Get a free Reed key at reed.co.uk/developers. Optional second source: Adzuna at developer.adzuna.com.
4. In the repo, open Settings, Secrets and variables, Actions. Add:
   - `REED_API_KEY`
   - `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` (optional)
   - `SPONSOR_NTFY_TOPIC` (optional, for a morning notification). Pick a long random name.
5. In the Actions tab, run Daily Sponsor Radar once. Check that `sponsor-radar/data/jobs.json` fills.
6. On an iPhone, open the page in Safari, tap Share, then Add to Home Screen.

## Before you charge for it

- **Job data licence.** Free Reed and Adzuna keys are usually for personal use. Read both sets of terms. Get commercial permission before you take money.
- **Immigration advice.** In the UK, giving immigration advice is regulated. The app says it is information only. Keep that wording on every sponsorship screen.
- **Visa thresholds.** The figures in `thresholds.json` are indicative and dated. The real threshold depends on the job. Keep them current.
- **Sponsor register.** It is published under the Open Government Licence. Credit the source.
- **Privacy.** The app stores nothing about users on a server. If you add accounts, alerts or payments, you will hold personal data and need a privacy notice.

## Design

Both apps share one design system. Only the brand colour differs: warm orange for Sponsor Radar and cobalt blue for Job Radar.

- **Type.** Archivo (a variable font with weight and width axes) for headings and numbers, and Bricolage Grotesque for text. Both are self-hosted in `fonts/` under the SIL Open Font Licence, so the apps make no request to a font service.
- **Shape.** Pill buttons and filter pills, large rounded cards, a floating tab bar with line icons, and a painted header band behind a very large title.
- **Colour.** Set in the variables at the top of `styles.css`. The block between the `BRAND-START` and `BRAND-END` markers, and the matching dark-mode block, are the only parts that differ between the two apps. Every text and background pairing was checked against WCAG AA contrast, in light and dark.
- **Motion.** A soft blur that clears as things settle: cards on first load and after a deliberate change (a filter pill or saved settings), tab views, and the Apply sheet. It does not replay while typing. The header paint drifts slowly. All of it switches off when the phone asks for reduced motion.

## Limits

- Without a Reed or Adzuna key the workflow finds nothing.
- iPhone web apps cannot receive scheduled push alerts without a push server. The icon badge shows new roles when the app opens. ntfy gives a morning alert.
- "Not on register" means the legal name did not match the Home Office list. It does not prove the employer refuses sponsorship.
- The data file is public when the site is public. It holds job adverts only.

## Test

```
node --test sponsor-radar/scripts/test.mjs
```

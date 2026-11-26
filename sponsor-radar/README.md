# Sponsor Radar

A phone app that lists new UK analyst roles every morning, with a Home Office sponsor-licence check on every employer. Built for people who need visa sponsorship, and useful for anyone searching UK analyst roles.

## How it works

- A GitHub Actions workflow (`.github/workflows/daily-sponsor-radar.yml`) runs at 07:15 UTC each day.
- It searches Reed and Adzuna, checks each employer against the Home Office register of licensed sponsors, flags adverts that mention or refuse sponsorship, and saves a shared feed to `sponsor-radar/data/jobs.json`.
- The daily job reads three pages (300 adverts) of each search, so the feed is a deeper sample of Reed than one page. It is still a sample, not every advert. Change `pagesPerQuery` in `sponsor-radar/config.json`.
- A search for support worker also finds care assistant, care worker and healthcare assistant. People can turn this off in their search settings. The groups are in `SIMILAR_TITLES` in `sponsor-radar/scripts/lib.mjs`. The default "senior" filter applies to analyst roles only, because senior carer is an ordinary care grade.
- The All tab has a "Why are roles hidden?" panel that explains the gap between the feed size and the roles shown.
- **Full text.** Reed's search returns only a short snippet, so sponsorship wording is read from a second call per advert. Copies of one advert (same employer and title) share one read. An entry is marked `detail` once it has been read in full. A run reads at most `maxDetailFetches` (in `config.json`); new adverts go first, then the unread backlog, newest first, so a capped run never loses the rest. A failed read leaves the entry unread and the next run retries it. The run log reports reads, backlog and entries still unread.
- **Closed and missing adverts.** Each entry records `lastSeen`, the last day a search returned it, and Reed's closing date (`expires`). An advert past its closing date is dropped on arrival. A stored entry that Reed has not returned for `staleAfterDays` (3, in `config.json`) is removed. The grace period means a bad run cannot empty the feed. An entry that comes back is refreshed. Older entries without `lastSeen` count from the day they were first seen. The run log reports how many entries were removed.
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
- **Light and dark.** Settings has an Appearance option: match the phone (the default), light, or dark. The choice is saved on the phone and applied before the page paints, so there is no flash. The colour scheme is declared, so native controls such as the status menu follow the theme, and the browser bar takes its colour from the header paint. The dark colours live in two blocks in `styles.css` (one for a chosen dark, one for a dark phone). They must stay identical, and `scripts/design.test.mjs` checks it.
- **Motion.** A soft blur that clears as things settle: cards on first load and after a deliberate change (a filter pill or saved settings), tab views, and the Apply sheet. It does not replay while typing. The header paint drifts slowly. It switches off when the phone asks for reduced motion. Settings has a Motion option: Match my phone (default) or Always on, which plays the motion even with Reduce Motion turned on.

## Employer job boards

Many licensed sponsors publish their own adverts on Greenhouse, Lever, Ashby, SmartRecruiters or Workable. Those boards are open JSON, so the daily job reads them directly. No middleman and no API key.

- `scripts/boards.mjs` looks for a board for every licensed sponsor it sees in Reed and Adzuna, plus a slice of the register that moves on each day. Recruitment agencies are skipped. It tries the employer's name as a board name. The short name alone ("monzo" for Monzo Bank) is only tried when the rest of the name is a word like Bank, Labs or Technologies.
- A board is kept only when it clearly belongs to the employer. On Greenhouse the board's company name has to match. On Lever and Ashby the employer's name has to appear, with a capital letter, in most adverts. The board also needs at least one UK advert, and when only the short name matched, one in the town the register gives for the employer. Two employers can never share a board.
- Boards found under earlier, looser rules are checked again once (the `rules` number in `data/boards.json`). Of the first 63, 27 failed the new checks and were dropped.
- What it finds is saved in `data/boards.json`, so a board is searched for once. A miss is retried after 30 days. `config.json` sets how many employers are tried each run (`probesPerRun`, `registerSlicePerRun`) and can list known boards under `seeds`, for example `{ "name": "Monzo Bank Limited", "ats": "greenhouse", "slug": "monzo" }`.
- Each day it reads every known board and keeps the UK adverts. They come with their full text, so the sponsorship wording is read straight away. They show as "Employer site".
- They go through the same title, age and pay rules as Reed and Adzuna adverts. A role older than `maxAgeDays` is dropped.
- It finds boards slowly at first, because the register is large. The count in the run log (`Employer boards: N known`) grows over the first weeks.
- SmartRecruiters lists adverts without their text. The job reads the UK list (up to 300 adverts per employer) and the full text of the 25 most recent from the last 30 days.
- Workable limits how often its board API can be called. If it answers "too many requests", Workable is paused for the rest of that run and tried again the next day. The run log says so.
- When a board service is added, employers missed before are tried again once (the `services` list in `data/boards.json`).
- Workday is not read. Each employer's Workday site has its own address, so there is no name to guess.

## Add a role by link

Indeed and LinkedIn do not let apps read their adverts. The plus button in the header lets you save a role from any site yourself.

1. In the Indeed or LinkedIn app, open the job, tap Share, then Copy link.
2. In this app, tap the plus button, then Paste the copied link.
3. A LinkedIn link fills in the job title and the employer. For other sites, type them in.
4. Tap Save to my tracker. The role appears in your Tracker as Saved, with a Home Office sponsor check on the employer.

- The check uses `data/register.bin`, a compact copy of the register that the daily job writes (about 480 KB). If it cannot be loaded, the role is saved with Sponsor unchecked.
- On Android, the app also appears in the Share menu. On iPhone you can send a link to the app with an address like `/sponsor-radar/?add=<link>`, from a Shortcut.
- The link and details stay on your phone. The Apply button works on saved roles as it does on any other. If the site blocks the advert reader, add a screenshot.

## Near me

The Today and All tabs have a Near me filter. It is one control that moves with the tab you are on, and it applies to both lists. Switch it on, allow location when the phone asks, then pick a distance from 5 to 250 miles.

- The list shows roles within that distance, nearest first. Each card shows how far away it is. Remote roles stay in when your search includes remote, and follow the nearby ones.
- Distance is a straight line from you to the place named in the advert. Roads are longer. Adverts name a town, a county or a postcode district, so treat it as good to a few miles.
- A role that names no place we can measure ("United Kingdom", or a place outside Great Britain and Northern Ireland) is hidden while the filter is on. The note under the filter says how many.
- Your position is rounded to about 1 km and kept only on your phone. It is never sent to the site, the feed or any service.
- On iPhone, if you said no to location, allow it in Settings, Privacy and Security, Location Services, Safari Websites.
- Coordinates for towns and postcode districts are in `data/places.json`. `scripts/build-places.py` rebuilds it from the ONS Postcode Directory and OS Open Names (Open Government Licence v3.0). Contains OS data, Royal Mail data and National Statistics data, all Crown copyright and database right.

## Limits

- Without a Reed or Adzuna key the workflow finds nothing.
- iPhone web apps cannot receive scheduled push alerts without a push server. The icon badge shows new roles when the app opens. ntfy gives a morning alert.
- "Not on register" means the legal name did not match the Home Office list. It does not prove the employer refuses sponsorship.
- The data file is public when the site is public. It holds job adverts only.

## Test

```
node --test sponsor-radar/scripts/test.mjs
```

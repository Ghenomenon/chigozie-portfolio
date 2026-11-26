# Job Radar

A phone app that lists new UK analyst roles every morning. It lives at `/jobs/` on the portfolio site.

## How it works

- A GitHub Actions workflow (`.github/workflows/daily-jobs.yml`) runs at 06:30 UTC each day.
- It tags recruitment agencies, because the sponsor register lists the recruiter and not the employer behind the advert. It searches Reed and Adzuna for your role types, drops roles that say no sponsorship or pay below £26,000, checks each employer against the Home Office sponsor register, and scores fit from 0 to 5.
- It saves the result to `jobs/data/jobs.json`. The app reads that file.
- Your tracker (Saved, Applied, Interview and so on) stays on your phone. Export a copy from Settings.

Search terms, pay floor and filter words are in `jobs/config.json`.

## Apply button

Each role has an Apply button. It opens a sheet that guides you through five steps:

1. Get the advert. Read it from its link, or add a screenshot. See Advert reader below.
2. Copy the prompt. It holds the advert, your CV from `jobs/cv.md` (or your edited copy in Settings) and strict rules: no invented facts, and no answers about right to work or visa status.
3. Paste it into Claude. You get a tailored CV, a cover letter and draft answers to common form questions.
4. Submit the application yourself on the employer's form. The app never sends anything.
5. Tick the box and mark the role as Applied. The date is saved in your tracker.

`jobs/cv.md` is public because the site is public. Edit your private version in Settings. It stays on your phone.

## Advert reader

The Apply sheet gets the advert in one of two ways:

1. **Read the advert from its link.** A small Netlify function (`netlify/functions/advert.mjs`) opens the job page and returns the advert text. It uses the job's structured data when the page has it, and the page text otherwise. Sites that block automated readers, such as Indeed and LinkedIn, fail with a clear message.
2. **Add a screenshot.** Up to four images. They stay in memory and are never stored. On an iPhone the Share button sends the prompt and the images to Claude together. Elsewhere, paste the prompt into Claude and attach the images. Claude reads the advert from the image.

The function only opens known job sites at first (Reed, Adzuna, Indeed, Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday). It follows at most three redirects, refuses private and local addresses, caps the size and time of each page, and never caches a result. Edit `ALLOWED_FIRST_HOPS` in `netlify/lib/advert.mjs` to change the list.

After the first deploy, check it works: open `/.netlify/functions/advert?url=` followed by a Reed job link. You should see `"ok":true`. If you see a 404, Netlify has not picked up the `functions` line in `netlify.toml`.

Test it with `node --test netlify/lib/advert.test.mjs`.

## Set up once

1. Merge this branch into `main`. Scheduled workflows only run from the default branch.
2. Get a free Reed key at reed.co.uk/developers. Optional second source: a free Adzuna key at developer.adzuna.com.
3. In the repo, open Settings, Secrets and variables, Actions. Add:
   - `REED_API_KEY`
   - `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` (optional)
   - `NTFY_TOPIC` (optional, for a morning notification). Pick a long random name, for example `jobradar-k29x7qpm4t`.
4. Open the Actions tab, choose Daily job radar, then Run workflow. Check that `jobs/data/jobs.json` updates.
5. On your iPhone, open `https://chigozie-nkwopara.netlify.app/jobs/` in Safari. Tap Share, then Add to Home Screen.
6. For the morning notification, install the free ntfy app and subscribe to your topic.

## Design

Both apps share one design system. Only the brand colour differs: warm orange for Sponsor Radar and cobalt blue for Job Radar.

- **Type.** Archivo (a variable font with weight and width axes) for headings and numbers, and Bricolage Grotesque for text. Both are self-hosted in `fonts/` under the SIL Open Font Licence, so the apps make no request to a font service.
- **Shape.** Pill buttons and filter pills, large rounded cards, a floating tab bar with line icons, and a painted header band behind a very large title.
- **Colour.** Set in the variables at the top of `styles.css`. The block between the `BRAND-START` and `BRAND-END` markers, and the matching dark-mode block, are the only parts that differ between the two apps. Every text and background pairing was checked against WCAG AA contrast, in light and dark.
- **Motion.** A soft blur that clears as things settle: cards on first load and after a deliberate change (a filter pill or saved settings), tab views, and the Apply sheet. It does not replay while typing. The header paint drifts slowly. All of it switches off when the phone asks for reduced motion.

## Limits

- Without a Reed or Adzuna key the workflow finds nothing. The list currently holds 9 roles from a manual Indeed search.
- iPhone web apps cannot receive scheduled push alerts without a push server. The icon badge shows new roles when you open the app. ntfy gives you the morning alert.
- "Not on register" means the legal name did not match the Home Office list. It does not prove the employer refuses sponsorship.
- The data file is public because the site is public. It holds job adverts only, not your tracker.

## Test

```
node --test jobs/scripts/test.mjs
```

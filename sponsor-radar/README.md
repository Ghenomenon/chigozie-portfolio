# Sponsor Radar

A phone app that lists new UK analyst roles every morning, with a Home Office sponsor-licence check on every employer. Built for people who need visa sponsorship, and useful for anyone searching UK analyst roles.

## How it works

- A GitHub Actions workflow (`.github/workflows/daily-sponsor-radar.yml`) runs at 07:15 UTC each day.
- It searches Reed and Adzuna, checks each employer against the Home Office register of licensed sponsors, flags adverts that mention or refuse sponsorship, and saves a shared feed to `sponsor-radar/data/jobs.json`.
- The same advert posted for many places becomes one entry.
- Each person sets their own search on first launch: roles, places, pay floor, remote and sponsorship need. Filtering and fit scoring run on their phone.
- Each person's search, CV and tracker stay on their own phone. Nothing about them is sent to a server.

Feed settings (search terms, noise filters, sponsorship wording) are in `sponsor-radar/config.json`. Visa pay thresholds are in `sponsor-radar/data/thresholds.json`. Update them when gov.uk changes the figures.

## Apply button

Each role has an Apply button with five steps:

1. Paste the advert text. Reed and Adzuna adverts are saved, so this can be skipped for them.
2. Copy the prompt. It holds the advert, the person's CV and strict rules: no invented facts, and no answers about right to work or visa status.
3. Paste it into Claude. It returns a tailored CV, a cover letter and draft answers to common form questions.
4. Submit the application on the employer's form. The app never sends anything.
5. Tick the box and mark the role as Applied. The date is saved in the tracker.

The person pastes their CV once in Settings. It is stored on their phone only.

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

## Limits

- Without a Reed or Adzuna key the workflow finds nothing.
- iPhone web apps cannot receive scheduled push alerts without a push server. The icon badge shows new roles when the app opens. ntfy gives a morning alert.
- "Not on register" means the legal name did not match the Home Office list. It does not prove the employer refuses sponsorship.
- The data file is public when the site is public. It holds job adverts only.

## Test

```
node --test sponsor-radar/scripts/test.mjs
```

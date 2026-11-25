# Job Radar

A phone app that lists new UK analyst roles every morning. It lives at `/jobs/` on the portfolio site.

## How it works

- A GitHub Actions workflow (`.github/workflows/daily-jobs.yml`) runs at 06:30 UTC each day.
- It searches Reed and Adzuna for your role types, drops roles that say no sponsorship or pay below £26,000, checks each employer against the Home Office sponsor register, and scores fit from 0 to 5.
- It saves the result to `jobs/data/jobs.json`. The app reads that file.
- Your tracker (Saved, Applied, Interview and so on) stays on your phone. Export a copy from Settings.

Search terms, pay floor and filter words are in `jobs/config.json`.

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

## Limits

- Without a Reed or Adzuna key the workflow finds nothing. The list currently holds 9 roles from a manual Indeed search.
- iPhone web apps cannot receive scheduled push alerts without a push server. The icon badge shows new roles when you open the app. ntfy gives you the morning alert.
- "Not on register" means the legal name did not match the Home Office list. It does not prove the employer refuses sponsorship.
- The data file is public because the site is public. It holds job adverts only, not your tracker.

## Test

```
node --test jobs/scripts/test.mjs
```

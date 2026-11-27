# Job Radar

A phone app that lists new UK analyst roles every morning. It lives at `/jobs/` on the portfolio site.

## How it works

- A GitHub Actions workflow (`.github/workflows/daily-jobs.yml`) runs at 06:30 UTC each day.
- It tags recruitment agencies, because the sponsor register lists the recruiter and not the employer behind the advert. It searches Reed and Adzuna for your role types, drops roles that say no sponsorship or pay below £26,000, checks each employer against the Home Office sponsor register, and scores fit from 0 to 5.
- It saves the result to `jobs/data/jobs.json`. The app reads that file.
- Your tracker (Saved, Applied, Interview and so on) stays on your phone. Export a copy from Settings.

Search terms, pay floor and filter words are in `jobs/config.json`.

## Apply button

Each role has an Apply button. It opens a sheet with three steps. Tap a step to move between them.

1. **Advert.** The advert text, read from its link when you open the sheet. Edit it, read it again, or add up to four screenshots.
2. **Documents.** Your tailored CV and cover letter.
   - With your Claude API key saved in Settings, tap Write with Claude. Claude Opus 5.5 writes both in under a minute, from your CV and the advert only. Screenshots go with the request. Each one costs a few pence on your Anthropic account.
   - Without a key, copy the prompt, open Claude, then paste Claude's whole reply back. The app splits it into the CV and the letter.
   - Edit either one in the app. Copy it, or save it as a PDF through the phone's print menu.
   - **Keywords come first.** Claude lists the advert's 10 to 15 most important keywords, then uses the advert's exact wording in your CV and letter wherever your CV supports it, in the profile, the skills and the first bullet points. It never adds a keyword your CV does not support.
   - The Advert keywords panel lets you choose. Keywords your CV supports start chosen. The rest start left out, and you can switch any of them on, or add your own. Use one your CV does not show only if it is true.
   - Each chip shows ✓ (chosen and in your tailored CV), + (chosen, not in it yet) or – (left out). The count and the list of missing keywords update as you edit.
   - **Add to skills** puts the missing chosen keywords into the CV's skills section at once, or adds a Key skills section if there is none.
   - **Rewrite with Claude** works the chosen keywords into the CV and letter properly, keeping every fact from your CV. Keywords you switched on yourself are passed as ones you confirm are true. Without an API key, this button copies the rewrite prompt for Claude, and Paste reply brings the result back with your choices kept.
   - "Check before you send" lists what your CV does not cover and anything Claude was unsure about.
   - The documents are saved on your phone with the role. Opening Apply again goes straight to them.
3. **Apply.** Open the advert and send the application on the employer's site. The app never sends anything. Then tap I have applied. The date goes into your tracker.

Your CV comes from `jobs/cv.md`, or your edited copy in Settings, which stays on your phone.

**The API key.** It is saved on your phone and sent only to Anthropic, straight from the phone. There is no server in between, so nothing on the website holds it. Set a monthly spend limit in the Anthropic console. The app uses the Anthropic SDK (`vendor/anthropic-sdk.min.mjs`, version 1.14.0, MIT licence), bundled into one file and loaded only when you tap Write with Claude. With `server-side-fallback`, a request a safety check declines is retried on a fallback model.

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
- **Light and dark.** Settings has an Appearance option: match the phone (the default), light, or dark. The choice is saved on the phone and applied before the page paints. Native controls follow the theme, and the browser bar takes its colour from the header paint. The dark colours live in two blocks in `styles.css` that must stay identical. `sponsor-radar/scripts/design.test.mjs` checks both apps.
- **Motion.** A soft blur that clears as things settle: cards on first load and after a deliberate change (a filter pill or saved settings), tab views, and the Apply sheet. It does not replay while typing. The header paint drifts slowly. It switches off when the phone asks for reduced motion. Settings has a Motion option: Match my phone (default) or Always on, which plays the motion even with Reduce Motion turned on.

## Job alerts and Indeed searches

Indeed and LinkedIn have no open feed, so a scheduled Claude task collects their adverts for you: from your alert emails in Gmail, and from Indeed searches. It saves them to `data/inbox.json`, and the daily job adds them to your list with the usual filters and sponsor check. See `inbox-task.md` for the file format and the task prompt.

## Employer job boards

The daily job also reads the employer job boards that Sponsor Radar has found (Greenhouse, Lever, Ashby, SmartRecruiters and Workable). It keeps the UK adverts, and your usual title filter then keeps the analyst roles. Boards come from `sponsor-radar/data/boards.json`. See the Sponsor Radar README for how they are found.

## Add a role by link

Indeed and LinkedIn do not let apps read their adverts. The plus button in the header lets you save a role from any site yourself.

1. In the Indeed or LinkedIn app, open the job, tap Share, then Copy link.
2. In this app, tap the plus button, then Paste the copied link.
3. A LinkedIn link fills in the job title and the employer. For other sites, type them in.
4. Tap Save to my tracker. The role appears in your Tracker as Saved, with a Home Office sponsor check on the employer.

- The check uses `sponsor-radar/data/register.bin`, a compact copy of the register that the daily job writes (about 480 KB). If it cannot be loaded, the role is saved with Sponsor unchecked.
- On Android, the app also appears in the Share menu. On iPhone you can send a link to the app with an address like `/jobs/?add=<link>`, from a Shortcut.
- The link and details stay on your phone. The Apply button works on saved roles as it does on any other. If the site blocks the advert reader, add a screenshot.

Job Radar reads the register copy and the link helpers from Sponsor Radar, so both apps check employers the same way.

## Near me

The Today and All tabs have a Near me filter. It is one control that moves with the tab you are on, and it applies to both lists. Switch it on, allow location when the phone asks, then pick a distance from 5 to 250 miles.

- The list shows roles within that distance, nearest first. Each card shows how far away it is. Remote roles stay in and follow the nearby ones.
- Distance is a straight line from you to the place in the advert (a town, or the district of its postcode). Roads are longer, so treat it as good to a few miles.
- A role with no place that can be measured is hidden while the filter is on. The note under the filter says how many.
- Your position is rounded to about 1 km and kept only on your phone. It is never sent anywhere.
- On iPhone, if you said no to location, allow it in Settings, Privacy and Security, Location Services, Safari Websites.
- `data/places.json` holds the coordinates and `scripts/geo.mjs` does the maths. Both are copies of Sponsor Radar's, so the apps stay independent. `sponsor-radar/scripts/build-places.py` rebuilds both. Contains OS data, Royal Mail data and National Statistics data, all Crown copyright and database right, under the Open Government Licence v3.0.

## Limits

- Without a Reed or Adzuna key the workflow finds nothing. The list currently holds 9 roles from a manual Indeed search.
- iPhone web apps cannot receive scheduled push alerts without a push server. The icon badge shows new roles when you open the app. ntfy gives you the morning alert.
- "Not on register" means the legal name did not match the Home Office list. It does not prove the employer refuses sponsorship.
- The data file is public because the site is public. It holds job adverts only, not your tracker.

## Test

```
node --test jobs/scripts/test.mjs
```

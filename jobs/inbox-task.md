# The inbox task

A scheduled Claude task fills `jobs/data/inbox.json` each morning. Job Radar's daily job (06:30 UTC) reads that file and treats the adverts like any others: same title filter, sponsor check, pay floor and fit score.

The task runs at about 05:30 UTC, so its adverts are in the file before the daily job reads them.

## What goes in the file

```json
{
  "updated": "2026-11-26",
  "jobs": [
    { "title": "Data Analyst", "company": "Acme Ltd", "location": "Leeds", "url": "https://uk.indeed.com/viewjob?jk=abc",
      "source": "Indeed", "posted": "2026-11-25", "snippet": "A short line from the alert or search result." }
  ]
}
```

- `source` is `Indeed` or `LinkedIn`. Anything else shows as `Job alert`.
- `url` must start with https. Items without a title, an employer and a safe link are skipped.
- The task replaces the whole file each run, with the last 14 days of adverts. Job Radar keeps its own history.
- Nothing else from your mailbox is written down. No sender, no subject, no email text beyond the advert's own details.

## The task prompt

> Update Job Radar's inbox. Work in the repo Ghenomenon/chigozie-portfolio.
>
> 1. In Gmail, search the last 2 days for job alert emails from Indeed and LinkedIn (for example from:indeed.com OR from:linkedin.com subject:job OR alert). For each alert, read the listed adverts. For each advert, note the job title, employer, place, link and the date of the email.
> 2. With the Indeed connector, search for each of these roles in the UK posted in the last 3 days: data analyst, business analyst, reporting analyst, BI analyst, insight analyst, operations analyst. Note the same details for each result.
> 3. Drop repeats (same link). Keep only adverts in the UK. Keep links that start with https.
> 4. Write jobs/data/inbox.json in the format described in jobs/inbox-task.md, with the adverts from the last 14 days (merge with what the file already holds, then drop older ones).
> 5. Commit with the message "Update job inbox" and push to main. Change no other file.
> 6. Reply with how many adverts came from alert emails, how many from searches, and how many are in the file now.
> Never copy email text beyond each advert's own details. If Gmail or Indeed cannot be reached, say so, keep the file as it is and stop.

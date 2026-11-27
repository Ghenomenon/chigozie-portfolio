# Work with me page: design

Date: 2026-11-27. Status: approved by Chigozie in conversation.

## Intent

Chigozie is starting a small reporting and dashboard service for small UK businesses. The goal is £100k revenue by December 2027. A client who finds the portfolio must be able to learn what is offered, what it costs, how it works, why to trust it, and how to start, all from one page.

## Goals

- One page, /work-with-me, that holds everything a client needs.
- A clear call to action: book a free 15-minute call by email.
- Prices shown as "from" prices, easy to edit later.
- The existing job-seeking message stays on the homepage.

## Non-goals

- No payment, booking system or backend form.
- No invented testimonials or client work.
- No change to the case study pages other than the nav link.

## Anti-goals

- A page that reads like generic agency copy.
- Claims the evidence cannot back, such as results for clients who do not exist yet.

## Approaches considered

1. A long section on the homepage. Quick, but buries the case studies.
2. A dedicated page plus a short homepage band that links to it. Matches how case studies work and gives one link to send clients. Chosen.

## Design

Page order:

1. Headline, one-line offer, button "Book a free 15-minute call", link to examples.
2. Who it is for: online sellers, stock and delivery firms, clinics. Each links to the matching case study.
3. Packages: Starter from £1,500 (one data source, 5 to 8 charts, about 1 week). Standard from £3,000 (several sources, cleaning, automatic refresh, about 2 weeks). Full from £5,000 (SQL data model, dashboard, training). Monthly support from £500, £800 or £1,200.
4. How it works in four steps: call, fixed quote, build with a draft in week 1, handover and training.
5. Examples: the case studies, labelled as independent projects on public data. An empty testimonial slot for later.
6. Working terms: fixed price, 50% upfront and 50% on delivery, client owns the dashboard, data statement (aggregate data only, files deleted after handover).
7. Six to eight questions and answers.
8. Short credentials note: MSc Business Analytics with Commendation, nearly four years of logistics analytics.
9. Contact: mailto link with the subject and prompts filled in, plus LinkedIn.

Site changes:

- New file work-with-me.html, built on the existing pages and site.css, with canonical and Open Graph tags.
- A "Work with me" link in the nav of every HTML page.
- A band on the homepage, between the projects and about sections, linking to the page.
- A redirect line in _redirects and an entry in sitemap.xml.
- New CSS appended to assets/site.css, covering light and dark themes.

## Constraints

- Plain HTML, CSS and JavaScript. No build step.
- Works at phone width and in dark mode.
- British English.

## Left to the builder

- Exact wording, within the order above.
- Layout details, reusing existing classes where they fit.

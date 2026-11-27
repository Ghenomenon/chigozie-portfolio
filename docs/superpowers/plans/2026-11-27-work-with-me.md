# Work with me page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a /work-with-me page that tells a small-business client everything they need to hire Chigozie for reporting work, and link it from every page.

**Architecture:** One new static page, `work-with-me.html`, built from the existing page shell (head, nav, footer) and `assets/site.css`. New styles go at the end of `site.css` under a `wm-` prefix. The nav link, homepage band, redirect and sitemap entry wire it in.

**Tech Stack:** Plain HTML, CSS and JavaScript on Netlify. No build step, no test framework. Checks are `grep` commands and Playwright screenshots (Playwright is pre-installed: `require('playwright')`).

**Spec:** `docs/superpowers/specs/2026-11-27-work-with-me-design.md`

## Global Constraints

- Plain HTML, CSS and JavaScript. No build step, no new dependencies.
- Must work at 360px width and in dark mode (`:root[data-theme=dark]`). Use the existing CSS variables, never hard-coded colours.
- British English.
- Prices, shown as "from": Starter £1,500, Standard £3,000, Full £5,000. Monthly support £500, £800 or £1,200.
- Package contents: Starter is one data source, 5 to 8 charts, about 1 week. Standard is several sources, cleaning, automatic refresh, about 2 weeks. Full is a SQL data model, a dashboard and training.
- Terms: fixed price, 50% upfront and 50% on delivery, client owns the dashboard, aggregate data only, files deleted after handover.
- Contact is `mailto:nkwoparachigozie@gmail.com` with a prefilled subject and body, plus the existing LinkedIn link.
- Copy: short sentences, active voice, no hype words, no invented clients or results. Case studies are labelled as independent projects on public data.
- The homepage line "Open to UK Business, Commercial, Reporting / MI and Data / BI Analyst roles" stays.

## Review Focus

- A 360px viewport: no horizontal scroll, packages stack in one column. Test: Playwright reports `document.documentElement.scrollWidth <= 360`.
- Dark mode: new cards use only `var(--surface)`, `var(--ink)`, `var(--muted)`, `var(--line)`. Test: `grep` finds no `#` colour literals in the new CSS block.
- The mailto link: spaces and the pound sign are percent-encoded, so the subject arrives intact. Test: the href contains `subject=Free%2015-minute%20call`.
- No visible empty testimonial box or "TBD". Test: `grep -ci "tbd\|lorem\|testimonial" work-with-me.html` returns only the HTML comment.
- Every page links to the new page and the mobile menu still opens. Test: all 7 pages contain `href="/work-with-me"`, and the menu toggle test below passes.

---

### Task 1: The page and its styles

**Files:**
- Create: `work-with-me.html`
- Modify: `assets/site.css` (append at end)

**Interfaces:**
- Produces: a page at `/work-with-me.html`. CSS classes `wm-hero`, `wm-grid` (three-column card grid, one column under 700px), `wm-card`, `wm-price` (the "from £X" line), `wm-steps` (ordered list of four steps), `wm-faq` (details/summary list). Task 2 reuses `wm-band` for the homepage band, so define it here too.

- [ ] **Step 1: Create `work-with-me.html`** by copying the head, skip link, header nav, footer and closing tags from `pricing-cost-case-study.html`. Set the title to `Work with me | Chigozie Nkwopara`, the canonical and `og:url` to `https://chigozie-nkwopara.netlify.app/work-with-me`, a one-sentence description, and drop the page-specific `<style>` block. Use `<main id="main"><div class="wrap">` as the homepage does. Add `href="/work-with-me"` to the nav, placed before Contact, with `aria-current="page"`.

- [ ] **Step 2: Write the body as nine sections in the spec's order.** One `<section class="section">` each, with `eyebrow`, `h2` and the existing `section-title` pattern. Hero button text "Book a free 15-minute call". Link each audience card to its case study: online sellers to `/pricing-cost-case-study`, stock and delivery firms to `/fulfilment-case-study`, clinics to `/readmissions-case-study`. Write the FAQ as `<details class="wm-faq">` with eight questions: technical knowledge needed, data needed and its safety, project length, what if the first draft misses, Power BI licences, who owns the dashboard, which tools I can connect to, whether I work outside Newcastle. Put the testimonial slot in an HTML comment only.

- [ ] **Step 3: Append the `wm-` styles to `assets/site.css`.** Reuse `.eyebrow`, `.btn`, `.tag` and the `--surface`, `--line`, `--ink`, `--muted` variables. Add one `@media(max-width:700px)` rule that sets `.wm-grid` to one column.

- [ ] **Step 4: Check the copy and CSS rules.**
Run: `grep -c 'subject=Free%2015-minute%20call' work-with-me.html && grep -ci "tbd\|lorem" work-with-me.html; grep -c "From £1,500" work-with-me.html`
Expected: `1`, `0`, `1` (or more for the last).

- [ ] **Step 5: Check at phone width and in dark mode.** Write a Playwright script in the scratchpad that loads `file:///home/user/chigozie-portfolio/work-with-me.html` at 360x800, asserts `document.documentElement.scrollWidth <= 360`, then sets `document.documentElement.dataset.theme='dark'` and takes a full-page screenshot at `deviceScaleFactor: 2`. Read the screenshot and confirm the cards are legible.
Expected: assertion passes, screenshot shows readable text on every card.

- [ ] **Step 6: Commit**

```bash
git add work-with-me.html assets/site.css
git commit -m "feat: add work with me page"
```

### Task 2: Wire the page into the site

**Files:**
- Modify: `cv.html`, `fulfilment-case-study.html`, `index.html`, `pricing-cost-case-study.html`, `readmissions-case-study.html`, `usaid-case-study.html`, `warehouse-case-study.html` (nav link, and the band on `index.html`)
- Modify: `_redirects`, `sitemap.xml`, `README.md`

**Interfaces:**
- Consumes: `wm-band` from Task 1.

- [ ] **Step 1: Add the nav link to the 7 existing pages.** Insert `<a href="/work-with-me">Work with me</a>` immediately before `<a href="/#contact">Contact</a>` in each. Use `sed -i`.
Run: `grep -c 'href="/work-with-me"' cv.html fulfilment-case-study.html index.html pricing-cost-case-study.html readmissions-case-study.html usaid-case-study.html warehouse-case-study.html`
Expected: `1` for every file.

- [ ] **Step 2: Add the homepage band to `index.html`,** between the closing `</section>` of `#projects` and `<section class="section" id="about">`. A `<section class="wm-band">` with the eyebrow "Work with me", the line "I also build reporting dashboards for small businesses.", the prices as "From £1,500", and a button to `/work-with-me`. Do not touch the hero or the availability line.
Run: `grep -c "Open to UK Business, Commercial, Reporting" index.html && grep -c 'class="wm-band"' index.html`
Expected: `1` and `1`.

- [ ] **Step 3: Add the redirect and sitemap entry.** Append `/work-with-me /work-with-me.html 200` to `_redirects` and a `<url>` entry with today's date, 2026-11-27, to `sitemap.xml`. Add one line to the Pages list in `README.md`.
Run: `grep -c "work-with-me" _redirects sitemap.xml README.md`
Expected: `1` or more in each.

- [ ] **Step 4: Test the menu and the link at phone width.** With Playwright at 390x844, open `index.html`, click `.menu-toggle`, assert the "Work with me" link is visible, click it, and assert the browser navigates to a URL ending in `work-with-me.html`.
Expected: both assertions pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: link work with me from nav, homepage, sitemap and redirects"
```

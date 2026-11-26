import {
  DEFAULT_PROFILE, collapseDuplicates, matchesProfile, scoreJob, belowSponsorThreshold, isRecruiter, isHardToSponsor, normalisePay, belowMinimumWage, explainFilters, familyOf,
} from './scripts/lib.mjs';

const STATUSES = ['Saved', 'Applied', 'Interview', 'Offer', 'Rejected', 'Not interested'];
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  },
  remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

let allJobs = [];          // the shared feed
let view = [];             // jobs that match this user's profile, scored
let thresholds = null;
let profile = store.get('sr.profile', null);
let tracker = store.get('sr.tracker', {});   // id -> { status, job, applied? }
let seen = new Set(store.get('sr.seen', []));
let tab = 'today';
let defaultCv = '';
let applyJob = null;
let fam = 'all';                       // kind-of-work pill on the All tab
let didFirstRender = false;
let animateUntil = 0;                  // cards settle in only for a moment after a deliberate change
const replay = () => { animateUntil = performance.now() + 900; };

const $ = (id) => document.getElementById(id);
const list = (s) => String(s || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
const num = (s) => { const n = Number(String(s).replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : 0; };

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids) if (kid) n.append(kid);
  return n;
}

const safeUrl = (u) => (/^https:\/\//i.test(u) ? u : '#');
const gbp = (n) => '£' + Math.round(n).toLocaleString('en-GB');

const RATE_WORDS = { hour: 'an hour', day: 'a day', week: 'a week' };
const money = (n) => '£' + (Math.round(n * 100) % 100 === 0 ? Math.round(n).toLocaleString('en-GB') : n.toFixed(2));
const range = (lo, hi, f) => (lo && hi && lo !== hi ? `${f(lo)} to ${f(hi)}` : f(lo || hi));

// Pay as the advert quoted it (main), with the other form beside it (alt).
function salaryParts(j) {
  const unit = j.salaryUnit;
  if (unit && unit !== 'year') {
    const top = j.salaryMax || j.salaryMin;
    return { main: `${range(j.rateMin, j.rateMax, money)} ${RATE_WORDS[unit]}`, alt: `(about ${gbp(top)} a year)` };
  }
  if (j.salaryMin || j.salaryMax) {
    return {
      main: `${range(j.salaryMin, j.salaryMax, gbp)} a year`,
      alt: `(about ${range(j.salaryMin && j.salaryMin / 1950, j.salaryMax && j.salaryMax / 1950, money)} an hour)`,
    };
  }
  return { main: 'Pay not stated', alt: '' };
}
const salaryText = (j) => { const { main, alt } = salaryParts(j); return alt ? `${main} ${alt}` : main; };
const shortDate = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

// ---------- profile and filtering ----------

function recompute() {
  const p = { ...DEFAULT_PROFILE, ...(profile || {}) };
  view = allJobs
    .filter((j) => matchesProfile(j, p))
    .map((j) => ({ ...j, ...scoreJob(j, p, thresholds) }))
    .sort((a, b) => b.score - a.score || (b.posted > a.posted ? 1 : -1));
}

const latestFirstSeen = () => allJobs.reduce((m, j) => (j.firstSeen && j.firstSeen > m ? j.firstSeen : m), '');
const isHidden = (j) => tracker[j.id]?.status === 'Not interested';
const todayJobs = () => {
  const d = latestFirstSeen();
  return view.filter((j) => j.firstSeen === d && !isHidden(j));
};

function setStatus(job, status) {
  if (!status) delete tracker[job.id];
  else {
    const applied = status === 'Applied' ? (tracker[job.id]?.applied || new Date().toISOString().slice(0, 10)) : tracker[job.id]?.applied;
    tracker[job.id] = { status, job, ...(applied ? { applied } : {}) };
  }
  store.set('sr.tracker', tracker);
  render();
}

// ---------- cards ----------

function card(j, { fresh = false } = {}) {
  const t = tracker[j.id];
  const p = profile || DEFAULT_PROFILE;
  const fitClass = j.score >= 3.8 ? 'hi' : j.score < 2.5 ? 'lo' : '';
  const chips = el('div', { class: 'chips' });
  if (j.workMode !== 'onsite') chips.append(el('span', { class: 'chip good', text: j.workMode === 'remote' ? 'Remote' : 'Hybrid' }));
  if (isRecruiter(j)) chips.append(el('span', { class: 'chip warn', title: 'A recruiter advertises for clients. Its licence says little about the real employer.', text: 'Recruiter · ask who the employer is' }));
  else if (j.sponsorLicence === 'licensed') chips.append(el('span', { class: 'chip good', text: 'Licensed sponsor' }));
  else if (j.sponsorLicence === 'not-found') chips.append(el('span', { class: 'chip warn', text: 'Not on register' }));
  else chips.append(el('span', { class: 'chip warn', text: 'Sponsor unchecked' }));
  if (j.sponsorship === 'offered') chips.append(el('span', { class: 'chip good', text: 'Advert mentions sponsorship' }));
  if (p.needsSponsorship && isHardToSponsor(j) && j.sponsorship !== 'offered') chips.append(el('span', { class: 'chip warn', title: thresholds?.lowSkill?.text || 'Check the occupation code on gov.uk.', text: 'Rarely sponsored · check gov.uk' }));
  if (belowMinimumWage(j, thresholds)) chips.append(el('span', { class: 'chip warn', title: 'Compared with the over-21 rate. Part-time or unstated hours can make this wrong.', text: `Below the minimum wage (${money(thresholds.minimumWage.over21)} an hour)` }));
  if (p.needsSponsorship && belowSponsorThreshold(j, thresholds)) chips.append(el('span', { class: 'chip warn', text: 'Pay may be below visa threshold' }));
  if (t?.applied) chips.append(el('span', { class: 'chip done', text: `Applied ${t.applied}` }));
  const isNew = fresh && j.firstSeen === latestFirstSeen() && !t;
  if (isNew) chips.append(el('span', { class: 'chip new', text: 'New' }));

  const select = el('select', { 'aria-label': 'Status', onchange: (e) => setStatus(j, e.target.value) },
    el('option', { value: '', text: 'Not tracked' }),
    ...STATUSES.map((s) => el('option', { value: s, text: s })));
  select.value = t?.status || '';

  const { main, alt } = salaryParts(j);
  const payClass = 'pay' + (j.salaryMin || j.salaryMax ? '' : ' none');

  return el('article', { class: 'card job' + (isNew ? ' is-new' : '') },
    el('div', { class: 'head' },
      el('div', {},
        el('h2', { text: j.title }),
        el('p', { class: 'co', text: j.company }),
        el('p', { class: 'where', text: j.location || 'UK' })),
      j.score === undefined ? null : el('div', { class: 'fit ' + fitClass, title: 'Fit out of 5', text: j.score.toFixed(1) })),
    el('p', { class: payClass }, el('strong', { text: main }), alt ? document.createTextNode(' ') : null, alt ? el('span', { class: 'alt', text: alt }) : null),
    chips,
    el('p', { class: 'why', text: (j.reasons || []).join(' · ') }),
    el('p', { class: 'src', text: `${j.source}, posted ${shortDate(j.posted)}` }),
    el('div', { class: 'actions' },
      el('button', { class: 'btn primary', type: 'button', onclick: () => openApply(j), text: 'Apply' }),
      el('a', { class: 'adv', href: safeUrl(j.url), target: '_blank', rel: 'noopener noreferrer', text: 'Advert' }),
      select));
}

function fill(container, items, emptyText, opts = {}) {
  container.replaceChildren();
  if (!items.length) { container.append(el('p', { class: 'empty', text: emptyText })); return; }
  items.forEach((j, i) => {
    const c = card(j, opts);
    c.style.setProperty('--i', Math.min(i, 7));
    container.append(c);
  });
  if (performance.now() < animateUntil) {
    container.classList.add('enter');
    setTimeout(() => container.classList.remove('enter'), 1100);
  }
}

function renderToday() {
  const c = $('view-today');
  c.replaceChildren();
  const items = todayJobs();
  c.append(el('h3', { text: `New today (${items.length})` }));
  const holder = el('div');
  fill(holder, items, profile
    ? 'Nothing new that matches your search. Check back after the morning update, or widen your search in Settings.'
    : 'Set up your search to see roles.', { fresh: true });
  c.append(holder);
}

const FAMILY_LABELS = [
  ['all', 'All'],
  ['analyst', 'Analyst'],
  ['support-care', 'Care'],
  ['service-admin', 'Service and admin'],
  ['warehouse', 'Warehouse'],
  ['hospitality-retail', 'Hospitality and retail'],
];

function renderFchips() {
  const box = $('fchips');
  const counts = { all: view.filter((j) => !isHidden(j)).length };
  for (const j of view) if (!isHidden(j)) counts[familyOf(j)] = (counts[familyOf(j)] || 0) + 1;
  box.replaceChildren();
  for (const [key, label] of FAMILY_LABELS) {
    if (key !== 'all' && !counts[key]) continue;
    const b = el('button', { type: 'button', class: 'fchip' + (fam === key ? ' on' : ''), 'aria-pressed': String(fam === key), onclick: () => { fam = key; replay(); renderAll(); } }, document.createTextNode(label), el('small', { text: String(counts[key] || 0) }));
    box.append(b);
  }
  if (fam !== 'all' && !counts[fam]) fam = 'all';
}

function renderAll() {
  const q = $('q').value.trim().toLowerCase();
  const minScore = Number($('f-score').value);
  $('f-score-out').textContent = minScore.toFixed(1);
  const items = view.filter((j) => {
    if (isHidden(j)) return false;
    if (q && !(`${j.title} ${j.company}`.toLowerCase().includes(q))) return false;
    if ($('f-remote').checked && j.workMode === 'onsite') return false;
    if ($('f-pay').checked && !(j.salaryMin || j.salaryMax)) return false;
    if (fam !== 'all' && familyOf(j) !== fam) return false;
    return j.score >= minScore;
  });
  renderFchips();
  $('all-count').textContent = `${items.length} of ${view.length} matching roles`;
  renderWhy();
  fill($('list-all'), items, 'No roles match these filters.');
}

const WHY_LABELS = {
  words: (n) => `${n} hidden by your words to hide`,
  sponsorship: (n) => `${n} hidden because the advert says it will not sponsor`,
  pay: (n) => `${n} hidden by your pay floor`,
  place: (n) => `${n} are outside your places`,
  licence: (n) => `${n} are not on the sponsor list`,
  recruiter: (n) => `${n} are from recruiters`,
};

// Explains the gap between the feed size in the header and the roles shown.
function renderWhy() {
  const p = { ...DEFAULT_PROFILE, ...(profile || {}) };
  const x = explainFilters(allJobs, p);
  const matching = x.total - x.hidden.roles;
  const lines = [`${x.total} roles in the feed, across all kinds of work`];
  lines.push(p.roles.length
    ? `${matching} have a title that matches ${p.roles.join(', ')}${p.similarTitles !== false ? ' or similar titles' : ''}`
    : `${matching} match, because you set no roles`);
  for (const step of Object.keys(WHY_LABELS)) if (x.hidden[step]) lines.push(WHY_LABELS[step](x.hidden[step]));
  lines.push(`${x.shown} shown`);
  $('why-list').replaceChildren(...lines.map((t) => el('li', { text: t })));
  $('why-summary').textContent = `Why ${x.total - x.shown} of ${x.total} roles are hidden`;
}

function renderTracker() {
  const c = $('view-tracker');
  c.replaceChildren();
  const entries = Object.values(tracker).filter((t) => t.status !== 'Not interested');
  if (!entries.length) { c.append(el('p', { class: 'empty', text: 'Nothing tracked yet. Choose a status on any role.' })); return; }
  for (const s of STATUSES.filter((x) => x !== 'Not interested')) {
    const group = entries.filter((t) => t.status === s);
    if (!group.length) continue;
    c.append(el('h3', { text: `${s} (${group.length})` }));
    for (const t of group) c.append(card(view.find((j) => j.id === t.job.id) || t.job));
  }
}

function renderSummary() {
  const p = profile;
  $('search-summary').textContent = p
    ? [
      p.roles.length ? `Roles: ${p.roles.join(', ')}` : 'Roles: any analyst title',
      p.salaryFloor || p.hourlyFloor ? `Pay floor ${[p.salaryFloor && `${gbp(p.salaryFloor)} a year`, p.hourlyFloor && `${money(p.hourlyFloor)} an hour`].filter(Boolean).join(' or ')}` : 'No pay floor',
      p.regions.length ? `Places: ${p.regions.join(', ')}${p.includeRemote ? ' and remote' : ''}` : 'UK-wide',
      p.needsSponsorship ? 'Needs sponsorship' : 'No sponsorship needed',
      p.hideAgencies ? 'Recruiters hidden' : null,
    ].filter(Boolean).join(' · ')
    : 'Not set up yet.';
  $('threshold-note').textContent = thresholds
    ? `Visa pay thresholds used for the warning chip: new entrant ${gbp(thresholds.newEntrant)}, general ${gbp(thresholds.general)}. Figures from ${thresholds.asOf}. The real threshold depends on the job. Check gov.uk.${thresholds.lowSkill ? ' ' + thresholds.lowSkill.text : ''}${thresholds.minimumWage ? ` Minimum wage used for the flag: ${money(thresholds.minimumWage.over21)} an hour for over-21s, as of ${thresholds.minimumWage.asOf}.` : ''}`
    : '';
}

function updateBadges() {
  const fresh = todayJobs().filter((j) => !seen.has(j.id)).length;
  const n = $('n-today');
  n.hidden = !fresh || tab === 'today';
  n.textContent = fresh;
  const active = Object.values(tracker).filter((t) => ['Applied', 'Interview', 'Offer'].includes(t.status)).length;
  $('n-tracker').hidden = !active;
  $('n-tracker').textContent = active;
  if ('setAppBadge' in navigator) {
    (fresh ? navigator.setAppBadge(fresh) : navigator.clearAppBadge()).catch(() => {});
  }
}

function render() {
  recompute();
  renderToday();
  renderAll();
  renderTracker();
  renderSummary();
  updateBadges();
}

const PAGE_TITLES = { today: 'Today', all: 'All roles', tracker: 'Tracker', settings: 'Settings' };

function show(name) {
  tab = name;
  for (const b of document.querySelectorAll('.tabs button')) {
    b.classList.toggle('on', b.dataset.tab === name);
    if (b.dataset.tab === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  for (const v of document.querySelectorAll('.view')) {
    const on = v.id === `view-${name}`;
    v.hidden = !on;
    v.classList.remove('fade-in');
    if (on) { void v.offsetWidth; v.classList.add('fade-in'); }
  }
  $('page-title').textContent = PAGE_TITLES[name] || name;
  if (name === 'today') {
    todayJobs().forEach((j) => seen.add(j.id));
    store.set('sr.seen', [...seen].slice(-500));
  }
  updateBadges();
  window.scrollTo(0, 0);
}

async function load() {
  $('updated').textContent = 'Loading';
  try {
    const [jobsRes, thrRes] = await Promise.all([
      fetch('data/jobs.json', { cache: 'no-cache' }),
      fetch('data/thresholds.json', { cache: 'no-cache' }).catch(() => null),
    ]);
    if (!jobsRes.ok) throw new Error(jobsRes.status);
    const data = await jobsRes.json();
    allJobs = collapseDuplicates(data.jobs || []).map(normalisePay);
    if (thrRes && thrRes.ok) thresholds = await thrRes.json();
    const when = new Date(data.updated).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    $('updated').textContent = `Updated ${when} · ${allJobs.length} roles in feed`
      + (data.sponsorRegisterChecked ? '' : ' · sponsor check pending');
  } catch {
    $('updated').textContent = 'Offline. Showing saved data if any.';
  }
  if (!didFirstRender) { didFirstRender = true; replay(); }
  render();
}

// ---------- first-run setup and "Your search" ----------

function openSetup() {
  const p = { ...DEFAULT_PROFILE, ...(profile || {}) };
  $('s-roles').value = p.roles.join(', ');
  $('s-exclude').value = p.exclude.join(', ');
  $('s-floor').value = p.salaryFloor || '';
  $('s-hfloor').value = p.hourlyFloor || thresholds?.minimumWage?.over21 || '';
  $('wage-hint').textContent = thresholds?.minimumWage
    ? `Minimum wage from ${thresholds.minimumWage.asOf}: ${money(thresholds.minimumWage.over21)} for 21 and over, ${money(thresholds.minimumWage.age18to20)} for 18 to 20, ${money(thresholds.minimumWage.under18)} for under 18. Check gov.uk.`
    : '';
  $('s-lo').value = p.salaryTarget?.[0] || '';
  $('s-hi').value = p.salaryTarget?.[1] || '';
  $('s-regions').value = p.regions.join(', ');
  $('s-remote').checked = p.includeRemote;
  $('s-sponsor').checked = p.needsSponsorship;
  $('s-licensed').checked = p.licensedOnly;
  $('s-similar').checked = p.similarTitles !== false;
  $('s-agencies').checked = p.hideAgencies;
  const d = $('setup');
  if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
}

$('setup-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const lo = num($('s-lo').value), hi = num($('s-hi').value);
  profile = {
    roles: list($('s-roles').value).map((x) => x.toLowerCase()),
    exclude: list($('s-exclude').value).map((x) => x.toLowerCase()),
    salaryFloor: num($('s-floor').value),
    hourlyFloor: num($('s-hfloor').value),
    salaryTarget: lo && hi && lo <= hi ? [lo, hi] : null,
    regions: list($('s-regions').value).map((x) => x.toLowerCase()),
    includeRemote: $('s-remote').checked,
    needsSponsorship: $('s-sponsor').checked,
    licensedOnly: $('s-licensed').checked,
    hideAgencies: $('s-agencies').checked,
    similarTitles: $('s-similar').checked,
  };
  store.set('sr.profile', profile);
  $('setup').close();
  replay();
  render();
  show('today');
});
$('edit-search').addEventListener('click', openSetup);

// ---------- Apply flow ----------

const getCv = () => store.get('sr.cv', '') || '';
let advertText = '';       // from the saved summary, the link, or the person's edits
let shots = [];            // screenshot files, kept in memory only
let shotUrls = [];

const READ_REASONS = {
  'bad-url': 'That link is not valid.',
  'not-allowed': 'This site is not on the list the reader can open. Add a screenshot instead.',
  blocked: 'The site blocked the reader, which is common for Indeed and LinkedIn. Add a screenshot instead.',
  empty: 'The page had no advert text I could read. Add a screenshot instead.',
  'not-html': 'The link did not open a web page. Add a screenshot instead.',
  'too-large': 'The page was too large to read. Add a screenshot instead.',
  'fetch-failed': 'The reader could not open that page. Try again, or add a screenshot.',
};

function buildPrompt(j) {
  const hasText = advertText.trim().length > 0;
  let advert;
  if (hasText && shots.length) advert = `${advertText.trim()}\n\n(A screenshot of the advert is also attached. Use it where the text above is missing or unclear.)`;
  else if (hasText) advert = advertText.trim();
  else if (shots.length) advert = `(The advert is in the attached screenshot${shots.length > 1 ? 's' : ''}. Read it from there.)`;
  else advert = '(Not available. Open the advert link. If you cannot read it, tell me and I will add a screenshot.)';
  return [
    'Help me apply for this job. Follow these rules.',
    '- Use only facts that appear in MY CV below. Do not invent employers, dates, tools, qualifications or numbers.',
    '- Reword and reorder to match the advert. Keep my skill levels as written in my CV.',
    '- If the advert asks for something my CV does not support, say so. Do not cover the gap.',
    '- Do not answer questions about my right to work, visa status or sponsorship. Leave those for me.',
    '- Write in plain, direct British English. No filler phrases.',
    '',
    'JOB',
    `Title: ${j.title}`,
    `Company: ${j.company}${isRecruiter(j) ? ' (a recruiter, so the real employer may differ)' : ''}`,
    `Location: ${j.location || 'UK'}${j.workMode !== 'onsite' ? ` (${j.workMode})` : ''}`,
    `Pay: ${salaryText(j)}`,
    `Advert link: ${j.url}`,
    '',
    'ADVERT TEXT',
    advert,
    '',
    'MY CV',
    getCv().trim(),
    '',
    'DO THIS, IN ORDER',
    '1. List the 5 to 8 keywords from the advert that my CV should reflect. Then list any requirement my CV cannot support.',
    '2. Write my tailored CV in markdown. Keep it to two pages. Put the most relevant results first.',
    '3. Write a cover letter under 250 words. Name the company and role.',
    '4. Draft answers under 100 words each for: Why this role? Why this company? Describe a time you improved a process with data. What is your experience with Excel and SQL?',
    '5. List anything you were unsure about so I can check it. Leave salary expectations, notice period and start date blank for me.',
  ].join('\n');
}

function refreshPrompt() {
  if (applyJob) $('prompt-preview').value = buildPrompt(applyJob);
  const canShare = shots.length && typeof navigator.canShare === 'function' && navigator.canShare({ files: shots });
  $('share').hidden = !canShare;
  $('claude-note').textContent = shots.length
    ? (canShare
      ? 'Tap Share, then choose Claude. If the screenshot does not arrive, open Claude, paste the prompt and attach it yourself.'
      : 'Open Claude, paste the prompt, then attach your screenshot. Check every line of the result.')
    : 'You get a tailored CV, a cover letter and draft answers. Check every line before you use it.';
}

function showAdvertText() {
  $('advert').value = advertText;
  $('advert-details').hidden = !advertText;
}

function renderShots() {
  shotUrls.forEach((u) => URL.revokeObjectURL(u));
  shotUrls = shots.map((f) => URL.createObjectURL(f));
  const box = $('shot-list');
  box.replaceChildren();
  shots.forEach((f, i) => {
    box.append(el('div', { class: 'thumb' },
      el('img', { src: shotUrls[i], alt: `Screenshot ${i + 1}` }),
      el('button', { type: 'button', 'aria-label': `Remove screenshot ${i + 1}`, onclick: () => { shots.splice(i, 1); renderShots(); }, text: '×' })));
  });
  refreshPrompt();
}

async function readFromLink() {
  if (!applyJob) return;
  const note = $('read-note');
  const btn = $('read-link');
  btn.disabled = true;
  note.textContent = 'Reading the advert';
  try {
    const res = await fetch(`/.netlify/functions/advert?url=${encodeURIComponent(applyJob.url)}`, { cache: 'no-store' });
    const data = await res.json();
    if (data.ok && data.text) {
      advertText = data.text;
      showAdvertText();
      note.textContent = `Read ${data.text.length.toLocaleString('en-GB')} characters from the advert. Check them below.`;
    } else {
      note.textContent = READ_REASONS[data.reason] || READ_REASONS['fetch-failed'];
    }
  } catch {
    note.textContent = READ_REASONS['fetch-failed'];
  }
  btn.disabled = false;
  refreshPrompt();
}

function openApply(j) {
  applyJob = j;
  const noCv = !getCv().trim();
  shots = [];
  advertText = j.summary || '';
  renderShots();
  showAdvertText();
  $('apply-title').textContent = j.title;
  $('apply-sub').textContent = `${j.company} · ${j.location || 'UK'}`;
  $('advert-note').textContent = j.summary
    ? 'The advert text is already saved. Read it again from the link, or add a screenshot.'
    : 'Read the advert from its link, or add a screenshot of it.';
  $('read-note').textContent = '';
  $('open-advert').href = safeUrl(j.url);
  $('copy-note').textContent = noCv ? 'Add your CV in Settings first. The prompt needs it.' : '';
  $('copy').disabled = noCv;
  $('did-apply').checked = false;
  $('mark-applied').disabled = true;
  refreshPrompt();
  const d = $('apply');
  if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  if (!j.summary) readFromLink();
}

async function copyPrompt() {
  refreshPrompt();
  const text = $('prompt-preview').value;
  try {
    await navigator.clipboard.writeText(text);
    $('copy-note').textContent = shots.length ? 'Copied. Open Claude, paste it and attach your screenshot.' : 'Copied. Now open Claude and paste it.';
  } catch {
    const area = $('prompt-preview');
    area.closest('details').open = true;
    area.focus(); area.select();
    $('copy-note').textContent = 'Copy blocked. The text is selected below. Use Copy from the menu.';
  }
}

async function sharePrompt() {
  refreshPrompt();
  try {
    await navigator.share({ files: shots, text: $('prompt-preview').value, title: applyJob ? applyJob.title : 'Job advert' });
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    $('copy-note').textContent = 'Sharing did not work. Copy the prompt, open Claude and attach the screenshot.';
  }
}

$('read-link').addEventListener('click', readFromLink);
$('shots').addEventListener('change', (e) => {
  const picked = [...e.target.files].filter((f) => f.type.startsWith('image/')).slice(0, 4 - shots.length);
  shots.push(...picked);
  e.target.value = '';
  renderShots();
});
$('advert').addEventListener('input', () => { advertText = $('advert').value; refreshPrompt(); });
$('copy').addEventListener('click', copyPrompt);
$('share').addEventListener('click', sharePrompt);
$('did-apply').addEventListener('change', (e) => { $('mark-applied').disabled = !e.target.checked; });
$('mark-applied').addEventListener('click', () => {
  if (applyJob) setStatus(applyJob, 'Applied');
  $('apply').close();
});
$('apply').addEventListener('close', () => {
  shotUrls.forEach((u) => URL.revokeObjectURL(u));
  shotUrls = []; shots = [];
});

// ---------- CV editor, tracker export, tabs ----------

async function loadCvTemplate() {
  try { const r = await fetch('cv.md', { cache: 'no-cache' }); if (r.ok) defaultCv = await r.text(); } catch { /* offline */ }
  $('cv-text').value = getCv();
  $('cv-text').placeholder = defaultCv || 'Paste your CV here';
}
$('cv-save').addEventListener('click', () => {
  store.set('sr.cv', $('cv-text').value);
  $('cv-note').textContent = 'Saved on this phone only.';
});
$('cv-clear').addEventListener('click', () => {
  store.remove('sr.cv');
  $('cv-text').value = '';
  $('cv-note').textContent = 'CV removed from this phone.';
});

function exportTracker() {
  const blob = new Blob([JSON.stringify(tracker, null, 1)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'sponsor-radar-tracker.json' });
  document.body.append(a); a.click(); a.remove();
}

function importTracker(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      for (const [id, t] of Object.entries(data)) {
        if (t && STATUSES.includes(t.status) && t.job && typeof t.job.title === 'string') tracker[id] = t;
      }
      store.set('sr.tracker', tracker);
      render();
    } catch { alert('That file is not a valid tracker export.'); }
  };
  reader.readAsText(file);
}

// ---------- appearance: match the phone, or choose light or dark ----------
// The saved value is a plain string, because the script in the page head reads it before anything else runs.

const rootEl = document.documentElement;
const phoneDark = window.matchMedia('(prefers-color-scheme: dark)');
const readTheme = () => { try { const t = localStorage.getItem('sr.theme'); return t === 'light' || t === 'dark' ? t : 'auto'; } catch { return 'auto'; } };

// The browser bar takes its colour from the header paint, so it follows whichever theme is showing.
function syncThemeColour() {
  const meta = document.querySelector('meta[name="theme-color"]');
  const colour = getComputedStyle(rootEl).getPropertyValue('--paint-4').trim();
  if (meta && colour) meta.setAttribute('content', colour);
}

function applyTheme(choice) {
  if (choice === 'light' || choice === 'dark') rootEl.setAttribute('data-theme', choice); else rootEl.removeAttribute('data-theme');
  syncThemeColour();
}

applyTheme(readTheme());
document.querySelectorAll('input[name="theme"]').forEach((r) => {
  r.checked = r.value === readTheme();
  r.addEventListener('change', () => {
    if (!r.checked) return;
    try { if (r.value === 'auto') localStorage.removeItem('sr.theme'); else localStorage.setItem('sr.theme', r.value); } catch { /* private mode */ }
    applyTheme(r.value);
  });
});
phoneDark.addEventListener('change', syncThemeColour);   // matters when the choice is "match my phone"
// Motion: plays when the phone allows it, or always when chosen here.
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const readMotion = () => { try { return localStorage.getItem('sr.motion') === 'on' ? 'on' : 'auto'; } catch { return 'auto'; } };
function applyMotion() {
  if (readMotion() === 'on' || !reduceMotion.matches) rootEl.setAttribute('data-motion', 'on'); else rootEl.removeAttribute('data-motion');
}
applyMotion();
reduceMotion.addEventListener('change', applyMotion);
document.querySelectorAll('input[name="motion"]').forEach((r) => {
  r.checked = r.value === readMotion();
  r.addEventListener('change', () => {
    if (!r.checked) return;
    try { if (r.value === 'auto') localStorage.removeItem('sr.motion'); else localStorage.setItem('sr.motion', r.value); } catch { /* private mode */ }
    applyMotion();
    replay();
  });
});

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
['q', 'f-remote', 'f-pay', 'f-score'].forEach((id) => $(id).addEventListener('input', renderAll));
$('refresh').addEventListener('click', load);
$('export').addEventListener('click', exportTracker);
$('import').addEventListener('change', (e) => e.target.files[0] && importTracker(e.target.files[0]));
$('badge-btn').addEventListener('click', () => {
  if ('setAppBadge' in navigator && 'Notification' in window) Notification.requestPermission().then(updateBadges);
  else alert('Icon badges need iOS 16.4 or later, with the app added to your Home Screen.');
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

loadCvTemplate();
load().then(() => {
  show('today');
  if (!profile) openSetup();
});

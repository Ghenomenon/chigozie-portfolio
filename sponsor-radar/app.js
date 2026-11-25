import {
  DEFAULT_PROFILE, collapseDuplicates, matchesProfile, scoreJob, belowSponsorThreshold,
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

function salaryText(j) {
  if (j.salaryMin && j.salaryMax && j.salaryMin !== j.salaryMax) return `${gbp(j.salaryMin)} to ${gbp(j.salaryMax)}`;
  if (j.salaryMin || j.salaryMax) return gbp(j.salaryMin || j.salaryMax);
  return 'Pay not stated';
}

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

function card(j) {
  const t = tracker[j.id];
  const p = profile || DEFAULT_PROFILE;
  const fitClass = j.score >= 3.8 ? 'hi' : j.score < 2.5 ? 'lo' : '';
  const chips = el('div', { class: 'chips' });
  chips.append(el('span', { class: 'chip', text: j.location || 'UK' }));
  if (j.workMode !== 'onsite') chips.append(el('span', { class: 'chip good', text: j.workMode === 'remote' ? 'Remote' : 'Hybrid' }));
  chips.append(el('span', { class: 'chip' + (j.salaryMin || j.salaryMax ? '' : ' warn'), text: salaryText(j) }));
  if (j.sponsorLicence === 'licensed') chips.append(el('span', { class: 'chip good', text: 'Licensed sponsor' }));
  else if (j.sponsorLicence === 'not-found') chips.append(el('span', { class: 'chip warn', text: 'Not on register' }));
  else chips.append(el('span', { class: 'chip warn', text: 'Sponsor unchecked' }));
  if (j.sponsorship === 'offered') chips.append(el('span', { class: 'chip good', text: 'Advert mentions sponsorship' }));
  if (p.needsSponsorship && belowSponsorThreshold(j, thresholds)) chips.append(el('span', { class: 'chip warn', text: 'Pay may be below visa threshold' }));
  chips.append(el('span', { class: 'chip', text: `${j.source} · ${j.posted}` }));
  if (t?.applied) chips.append(el('span', { class: 'chip done', text: `Applied ${t.applied}` }));
  if (j.firstSeen === latestFirstSeen() && !t) chips.append(el('span', { class: 'chip new', text: 'New' }));

  const select = el('select', { 'aria-label': 'Status', onchange: (e) => setStatus(j, e.target.value) },
    el('option', { value: '', text: 'Not tracked' }),
    ...STATUSES.map((s) => el('option', { value: s, text: s })));
  select.value = t?.status || '';

  return el('article', { class: 'card job' },
    el('div', { class: 'head' },
      el('div', {}, el('h2', { text: j.title }), el('p', { class: 'co', text: j.company })),
      j.score === undefined ? null : el('div', { class: 'fit ' + fitClass, title: 'Fit out of 5', text: j.score.toFixed(1) })),
    chips,
    el('p', { class: 'why', text: (j.reasons || []).join(' · ') }),
    el('div', { class: 'actions' },
      el('button', { class: 'btn primary', type: 'button', onclick: () => openApply(j), text: 'Apply' }),
      el('a', { class: 'adv', href: safeUrl(j.url), target: '_blank', rel: 'noopener noreferrer', text: 'Advert' }),
      select));
}

function fill(container, items, emptyText) {
  container.replaceChildren();
  if (!items.length) { container.append(el('p', { class: 'empty', text: emptyText })); return; }
  for (const j of items) container.append(card(j));
}

function renderToday() {
  const c = $('view-today');
  c.replaceChildren();
  const items = todayJobs();
  c.append(el('h3', { text: `New today (${items.length})` }));
  const holder = el('div');
  fill(holder, items, profile
    ? 'Nothing new that matches your search. Check back after the morning update, or widen your search in Settings.'
    : 'Set up your search to see roles.');
  c.append(holder);
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
    return j.score >= minScore;
  });
  $('all-count').textContent = `${items.length} of ${view.length} matching roles`;
  fill($('list-all'), items, 'No roles match these filters.');
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
      p.salaryFloor ? `Pay floor ${gbp(p.salaryFloor)}` : 'No pay floor',
      p.regions.length ? `Places: ${p.regions.join(', ')}${p.includeRemote ? ' and remote' : ''}` : 'UK-wide',
      p.needsSponsorship ? 'Needs sponsorship' : 'No sponsorship needed',
    ].join(' · ')
    : 'Not set up yet.';
  $('threshold-note').textContent = thresholds
    ? `Visa pay thresholds used for the warning chip: new entrant ${gbp(thresholds.newEntrant)}, general ${gbp(thresholds.general)}. Figures from ${thresholds.asOf}. The real threshold depends on the job. Check gov.uk.`
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

function show(name) {
  tab = name;
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === name);
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${name}`;
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
    allJobs = collapseDuplicates(data.jobs || []);
    if (thrRes && thrRes.ok) thresholds = await thrRes.json();
    const when = new Date(data.updated).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    $('updated').textContent = `Updated ${when} · ${allJobs.length} roles in feed`
      + (data.sponsorRegisterChecked ? '' : ' · sponsor check pending');
  } catch {
    $('updated').textContent = 'Offline. Showing saved data if any.';
  }
  render();
}

// ---------- first-run setup and "Your search" ----------

function openSetup() {
  const p = { ...DEFAULT_PROFILE, ...(profile || {}) };
  $('s-roles').value = p.roles.join(', ');
  $('s-exclude').value = p.exclude.join(', ');
  $('s-floor').value = p.salaryFloor || '';
  $('s-lo').value = p.salaryTarget?.[0] || '';
  $('s-hi').value = p.salaryTarget?.[1] || '';
  $('s-regions').value = p.regions.join(', ');
  $('s-remote').checked = p.includeRemote;
  $('s-sponsor').checked = p.needsSponsorship;
  $('s-licensed').checked = p.licensedOnly;
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
    salaryTarget: lo && hi && lo <= hi ? [lo, hi] : null,
    regions: list($('s-regions').value).map((x) => x.toLowerCase()),
    includeRemote: $('s-remote').checked,
    needsSponsorship: $('s-sponsor').checked,
    licensedOnly: $('s-licensed').checked,
  };
  store.set('sr.profile', profile);
  $('setup').close();
  render();
  show('today');
});
$('edit-search').addEventListener('click', openSetup);

// ---------- Apply flow ----------

const getCv = () => store.get('sr.cv', '') || '';

function buildPrompt(j, advertText) {
  const advert = advertText.trim()
    || j.summary
    || '(Not saved. Open the advert link. If you cannot read it, tell me and I will paste the text.)';
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
    `Company: ${j.company}`,
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
  if (applyJob) $('prompt-preview').value = buildPrompt(applyJob, $('advert').value);
}

function openApply(j) {
  applyJob = j;
  const noCv = !getCv().trim();
  $('apply-title').textContent = j.title;
  $('apply-sub').textContent = `${j.company} · ${j.location || 'UK'}`;
  $('advert').value = '';
  $('advert-note').textContent = j.summary
    ? 'The saved advert text is included. Paste the full text to replace it.'
    : 'No advert text is saved for this role. Open the advert, copy the text and paste it here.';
  $('open-advert').href = safeUrl(j.url);
  $('copy-note').textContent = noCv ? 'Add your CV in Settings first. The prompt needs it.' : '';
  $('copy').disabled = noCv;
  $('did-apply').checked = false;
  $('mark-applied').disabled = true;
  refreshPrompt();
  const d = $('apply');
  if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
}

async function copyPrompt() {
  refreshPrompt();
  const text = $('prompt-preview').value;
  try {
    await navigator.clipboard.writeText(text);
    $('copy-note').textContent = 'Copied. Now open Claude and paste it.';
  } catch {
    const area = $('prompt-preview');
    area.closest('details').open = true;
    area.focus(); area.select();
    $('copy-note').textContent = 'Copy blocked. The text is selected below. Use Copy from the menu.';
  }
}

$('advert').addEventListener('input', refreshPrompt);
$('copy').addEventListener('click', copyPrompt);
$('did-apply').addEventListener('change', (e) => { $('mark-applied').disabled = !e.target.checked; });
$('mark-applied').addEventListener('click', () => {
  if (applyJob) setStatus(applyJob, 'Applied');
  $('apply').close();
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

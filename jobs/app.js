(() => {
  'use strict';

  const STATUSES = ['Saved', 'Applied', 'Interview', 'Offer', 'Rejected', 'Not interested'];
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
    },
  };

  let jobs = [];
  let meta = {};
  let tracker = store.get('jr.tracker', {});   // id -> { status, note, job snapshot }
  let seen = new Set(store.get('jr.seen', []));
  let tab = 'today';
  let geo = null;                       // scripts/geo.mjs, loaded when Near me is first used
  let places = null;                    // rough coordinates for postcode districts and towns (data/places.json)
  let near = store.get('jr.near', { on: false, miles: 25 });   // the Near me filter
  let where = store.get('jr.where', null);                     // [lat, lon] of this phone, rounded to about 1 km. Never leaves the phone.

  const $ = (id) => document.getElementById(id);

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

  // Same guess as the feed makes (jobs/scripts/lib.mjs). Older saved records have no flag, so work it out from the name.
  const AGENCY_WORDS = /\b(recruit\w*|staffing|resourcing|headhunt\w*|personnel|appointments|executive search|search (and|&) selection|interim)\b/i;
  const AGENCY_KNOWN = /^(hays|adecco|randstad|harnham|michael page|page personnel|robert half|manpower|manpowergroup|kelly services|hudson|morgan mckinley|spencer ogden|nigel frank|jefferson frank|la fosse|venn group|reed(\s+(specialist|recruitment|in partnership|talent|business|contracts?)|$)|totaljobs|cv-library|walters people|hunter bond|lorien|computer futures|experis|jobsgopublic)/i;
  const isRecruiter = (j) => j.agency ?? (AGENCY_KNOWN.test(j.company || '') || AGENCY_WORDS.test(j.company || ''));

  const safeUrl = (u) => (/^https:\/\//i.test(u) ? u : '#');
  const gbp = (n) => '£' + Math.round(n).toLocaleString('en-GB');

  const money = (n) => '£' + (Math.round(n * 100) % 100 === 0 ? Math.round(n).toLocaleString('en-GB') : n.toFixed(2));
  const range = (lo, hi, f) => (lo && hi && lo !== hi ? `${f(lo)} to ${f(hi)}` : f(lo || hi));

  // Pay as the advert quoted it (main), with the other form beside it (alt). This feed holds yearly pay.
  function salaryParts(j) {
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

  function latestFirstSeen() {
    return jobs.reduce((m, j) => (j.firstSeen && j.firstSeen > m ? j.firstSeen : m), '');
  }
  const todayJobs = () => {
    const d = latestFirstSeen();
    return jobs.filter((j) => j.firstSeen === d && !isHidden(j));
  };
  const isHidden = (j) => tracker[j.id]?.status === 'Not interested';

  function setStatus(job, status) {
    if (!status) delete tracker[job.id];
    else {
      const applied = status === 'Applied' ? (tracker[job.id]?.applied || new Date().toISOString().slice(0, 10)) : tracker[job.id]?.applied;
      tracker[job.id] = { status, job, ...(applied ? { applied } : {}) };
    }
    store.set('jr.tracker', tracker);
    render();
  }

  function card(j, { fresh = false } = {}) {
    const t = tracker[j.id];
    const fitClass = j.score >= 3.8 ? 'hi' : j.score < 2.5 ? 'lo' : '';
    const chips = el('div', { class: 'chips' });
    const miles = nearActive() && j.workMode !== 'remote' ? geo.distanceMiles(j, where, places) : null;
    if (miles !== null) chips.append(el('span', { class: 'chip', title: 'Straight-line distance from you to the place in the advert. Roads are longer.', text: miles < 1 ? 'Under a mile away' : `${Math.round(miles)} mi away` }));
    if (j.workMode !== 'onsite') chips.append(el('span', { class: 'chip good', text: j.workMode === 'remote' ? 'Remote' : 'Hybrid' }));
    if (isRecruiter(j)) chips.append(el('span', { class: 'chip warn', title: 'A recruiter advertises for clients. Its licence says little about the real employer.', text: 'Recruiter · ask who the employer is' }));
    else if (j.sponsorLicence === 'licensed') chips.append(el('span', { class: 'chip good', text: 'Licensed sponsor' }));
    else if (j.sponsorLicence === 'not-found') chips.append(el('span', { class: 'chip warn', text: 'Not on register' }));
    else chips.append(el('span', { class: 'chip warn', text: 'Sponsor unchecked' }));
    if (j.sponsorship === 'offered') chips.append(el('span', { class: 'chip good', text: 'Advert mentions sponsorship' }));
    if (t?.applied) chips.append(el('span', { class: 'chip done', text: `Applied ${t.applied}` }));
    const isNew = fresh && j.firstSeen === latestFirstSeen() && !t;
    if (isNew) chips.append(el('span', { class: 'chip new', text: 'New' }));

    const select = el('select', { 'aria-label': 'Status', onchange: (e) => setStatus(j, e.target.value) },
      el('option', { value: '', text: 'Not tracked' }),
      ...STATUSES.map((s) => el('option', { value: s, text: s })));
    select.value = t?.status || '';

    const { main, alt } = salaryParts(j);
    return el('article', { class: 'card job' + (isNew ? ' is-new' : '') },
      el('div', { class: 'head' },
        el('div', {},
          el('h2', { text: j.title }),
          el('p', { class: 'co', text: j.company }),
          el('p', { class: 'where', text: j.location || 'UK' })),
        j.score === undefined ? null : el('div', { class: 'fit ' + fitClass, title: 'Fit out of 5', text: j.score.toFixed(1) })),
      el('p', { class: 'pay' + (j.salaryMin || j.salaryMax ? '' : ' none') }, el('strong', { text: main }), alt ? document.createTextNode(' ') : null, alt ? el('span', { class: 'alt', text: alt }) : null),
      chips,
      el('p', { class: 'why', text: (j.reasons || []).join(' · ') }),
      el('p', { class: 'src', text: `${j.source}, posted ${shortDate(j.posted)}` }),
      el('div', { class: 'actions' },
        el('button', { class: 'btn primary', type: 'button', onclick: () => openApply(j), text: 'Apply' }),
        el('a', { class: 'adv', href: safeUrl(j.url), target: '_blank', rel: 'noopener noreferrer', text: 'Advert' }),
        select));
  }

  // Cards settle in only for a moment after a deliberate change, not while typing in a search box.
  let animateUntil = 0;
  let didFirstRender = false;
  const replay = () => { animateUntil = performance.now() + 900; };

  function fill(container, list, emptyText, opts = {}) {
    container.replaceChildren();
    if (!list.length) { container.append(el('p', { class: 'empty', text: emptyText })); return; }
    list.forEach((j, i) => {
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
    const c = $('today-list');
    c.replaceChildren();
    const found = applyNear(todayJobs());
    const list = found.list;
    if (tab === 'today') renderNearNote(found);
    c.append(el('h3', { text: `New today (${list.length})${nearActive() ? ', nearest first' : ''}` }));
    const holder = el('div');
    fill(holder, list, 'Nothing new yet. Check back after the morning update.', { fresh: true });
    c.append(holder);
  }

  const nearActive = () => Boolean(near.on && where && places && geo);
  const distanceOf = (j) => {
    if (j.workMode === 'remote') return 1e6;               // remote roles have no distance, so they follow the nearby ones
    const d = geo.distanceMiles(j, where, places);
    return d === null ? Infinity : d;
  };

  // Applies Near me to a list: drops what is too far or cannot be placed, then sorts nearest first.
  function applyNear(list) {
    if (!nearActive()) return { list, tooFar: 0, unplaced: 0 };
    let tooFar = 0, unplaced = 0;
    const kept = list.filter((j) => {
      if (j.workMode === 'remote') return true;
      const d = geo.distanceMiles(j, where, places);
      if (d === null) { unplaced += 1; return false; }
      if (d > near.miles) { tooFar += 1; return false; }
      return true;
    });
    const sorted = kept.map((j, i) => [j, i]).sort((a, b) => distanceOf(a[0]) - distanceOf(b[0]) || a[1] - b[1]).map((x) => x[0]);
    return { list: sorted, tooFar, unplaced };
  }

  function renderNearNote(counts = {}) {
    $('near-row').hidden = !near.on && !nearNote;           // a refusal stays visible even though the filter is off
    $('f-near').checked = near.on;
    $('f-miles').value = String(near.miles);
    $('f-miles').parentElement.hidden = $('near-update').hidden = !near.on;
    if (nearNote) { $('near-note').textContent = nearNote; return; }
    if (!near.on) { $('near-note').textContent = ''; return; }
    if (!where) { $('near-note').textContent = 'Waiting for your location.'; return; }
    const bits = [`Measured from where you are now, as a straight line. Your location stays on this phone.`];
    if (counts.tooFar) bits.push(`${counts.tooFar} are further away.`);
    if (counts.unplaced) bits.push(`${counts.unplaced} name a place we cannot measure, so they are hidden.`);
    $('near-note').textContent = bits.join(' ');
  }
  let nearNote = '';

  async function loadPlaces() {
    if (places) return places;
    try {
      geo = await import('./scripts/geo.mjs');
      const r = await fetch('data/places.json');
      if (r.ok) places = await r.json();
    } catch { /* offline */ }
    return places;
  }

  // Asks the phone where it is. The answer is rounded to about 1 km and kept only on this phone.
  function locate({ quiet = false } = {}) {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) { nearNote = 'This browser cannot share a location.'; resolve(false); return; }
      if (!quiet || !where) { nearNote = 'Finding your location…'; renderNearNote(); }
      navigator.geolocation.getCurrentPosition((pos) => {
        where = [Math.round(pos.coords.latitude * 100) / 100, Math.round(pos.coords.longitude * 100) / 100];
        store.set('jr.where', where);
        nearNote = '';
        resolve(true);
      }, (err) => {
        if (quiet && where) { nearNote = ''; resolve(false); return; }   // keep the last position
        nearNote = err.code === 1
          ? 'Location is off for this app. On iPhone, open Settings, Privacy and Security, Location Services, then allow it for Safari Websites.'
          : 'Could not find your location. Try again outdoors or with Wi-Fi on.';
        resolve(false);
      }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 });
    });
  }

  async function setNear(on) {
    near = { ...near, on };
    store.set('jr.near', near);
    if (on) {
      await loadPlaces();
      if (!places) { near.on = false; store.set('jr.near', near); nearNote = 'The place list did not load. Check your connection.'; renderNearNote(); return; }
      if (!(await locate()) && !where) { near.on = false; store.set('jr.near', near); renderNearNote(); return; }
    } else nearNote = '';
    replay();
    render();
  }

  function renderAll() {
    const q = $('q').value.trim().toLowerCase();
    const minScore = Number($('f-score').value);
    $('f-score-out').textContent = minScore.toFixed(1);
    let list = jobs.filter((j) => {
      if (isHidden(j)) return false;
      if (q && !(`${j.title} ${j.company}`.toLowerCase().includes(q))) return false;
      if ($('f-sponsor').checked && j.sponsorLicence !== 'licensed') return false;
      if ($('f-remote').checked && j.workMode === 'onsite') return false;
      if ($('f-pay').checked && !(j.salaryMin || j.salaryMax)) return false;
      return j.score >= minScore;
    });
    const near2 = applyNear(list);
    list = near2.list;
    if (tab !== 'today') renderNearNote(near2);
    $('all-count').textContent = `${list.length} of ${jobs.length} roles${nearActive() ? ', nearest first' : ''}`;
    fill($('list-all'), list, 'No roles match these filters.');
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
      // Prefer the live job so scores refresh, fall back to the saved snapshot if it has expired.
      for (const t of group) c.append(card(jobs.find((j) => j.id === t.job.id) || t.job));
    }
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
    renderToday();
    renderAll();
    renderTracker();
    updateBadges();
  }

  // ---------- add a role by link ----------
  // Shares its helpers with Sponsor Radar, so the two apps read links and check the sponsor register the same way.

  let lib = null;
  const loadLib = async () => { if (!lib) lib = await import('../sponsor-radar/scripts/lib.mjs'); return lib; };
  let register;   // the packed sponsor register: an ArrayBuffer, null when it cannot be loaded, undefined until tried
  async function loadRegister() {
    if (register !== undefined) return register;
    try { const r = await fetch('../sponsor-radar/data/register.bin'); register = r.ok ? await r.arrayBuffer() : null; } catch { register = null; }
    return register;
  }

  async function openAdd(prefill = {}) {
    await loadLib();
    $('a-url').value = prefill.url || '';
    $('a-title').value = prefill.title || '';
    $('a-company').value = '';
    $('a-place').value = '';
    $('a-note').textContent = '';
    if (prefill.url) fillFromLink();
    const d = $('add-dialog');
    if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
  }

  // A LinkedIn link names the job and the employer. Other links name only the site.
  function fillFromLink() {
    const g = lib && lib.guessFromUrl($('a-url').value);
    if (!g) { $('a-note').textContent = $('a-url').value.trim() ? 'This needs to be a link that starts with https.' : ''; return; }
    const said = [];
    if (g.title && !$('a-title').value) { $('a-title').value = g.title; said.push('title'); }
    if (g.company && !$('a-company').value) { $('a-company').value = g.company; said.push('employer'); }
    $('a-note').textContent = said.length ? `The link gave the ${said.join(' and ')}. Check ${said.length > 1 ? 'them' : 'it'} against the advert.` : `${g.source} does not share the job details in its links. Add the title and employer.`;
  }

  $('add-role').addEventListener('click', () => openAdd());
  $('add-close').addEventListener('click', () => $('add-dialog').close());
  $('a-url').addEventListener('input', async () => { await loadLib(); fillFromLink(); });
  $('a-paste').addEventListener('click', async () => {
    try {
      await loadLib();
      const text = (await navigator.clipboard.readText()).trim();
      const url = /https:\/\/\S+/.exec(text)?.[0];
      if (!url) { $('a-note').textContent = 'The clipboard holds no link. Copy the job link first.'; return; }
      $('a-url').value = url;
      fillFromLink();
    } catch { $('a-note').textContent = 'The phone did not allow pasting. Press and hold in the link box instead.'; }
  });

  $('add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await loadLib();
    const today = new Date().toISOString().slice(0, 10);
    const job = lib.manualJob({ url: $('a-url').value.trim(), title: $('a-title').value, company: $('a-company').value, location: $('a-place').value }, today, await loadRegister());
    if (!/^https:\/\//.test(job.url)) { $('a-note').textContent = 'This needs to be a link that starts with https.'; return; }
    if (!tracker[job.id]) {
      tracker[job.id] = { status: 'Saved', job };
      store.set('jr.tracker', tracker);
    }
    $('add-dialog').close();
    render();
    show('tracker');
  });

  // A link handed to the app: ?add=<link>, or what the Android share sheet sends (url, text and title).
  function takeSharedLink() {
    const q = new URLSearchParams(location.search);
    const fromText = (t) => /https:\/\/\S+/.exec(t || '')?.[0];
    const url = fromText(q.get('add')) || fromText(q.get('url')) || fromText(q.get('text'));
    if (!url) return false;
    history.replaceState(null, '', location.pathname);
    openAdd({ url, title: q.get('title') || '' });
    return true;
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
    const slot = name === 'today' ? $('today-slot') : name === 'all' ? $('all-slot') : null;
    if (slot && $('near-box').parentElement !== slot) slot.append($('near-box'));   // one Near me control, shown in whichever tab is open
    $('page-title').textContent = PAGE_TITLES[name] || name;
    if (name === 'today') {
      todayJobs().forEach((j) => seen.add(j.id));
      store.set('jr.seen', [...seen].slice(-500));
    }
    updateBadges();
    window.scrollTo(0, 0);
  }

  async function load() {
    $('updated').textContent = 'Loading';
    try {
      const res = await fetch('data/jobs.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      jobs = data.jobs || [];
      meta = data;
      const when = new Date(data.updated).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
      $('updated').textContent = `Updated ${when} · ${jobs.length} roles`
        + (data.sponsorRegisterChecked ? '' : ' · sponsor check pending');
    } catch {
      $('updated').textContent = 'Offline. Showing saved data if any.';
    }
    if (!didFirstRender) { didFirstRender = true; replay(); }
    render();
  }

  function exportTracker() {
    const blob = new Blob([JSON.stringify(tracker, null, 1)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'job-radar-tracker.json' });
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
        store.set('jr.tracker', tracker);
        render();
      } catch { alert('That file is not a valid tracker export.'); }
    };
    reader.readAsText(file);
  }

  // ---------- Apply flow ----------
  let defaultCv = '';
  const getCv = () => store.get('jr.cv', '') || defaultCv;

  // The sheet lives in sponsor-radar/scripts/apply-sheet.mjs, shared with Sponsor Radar. With an API key saved in
  // Settings, Claude writes the CV and letter in the app. Without one, the sheet uses copy and paste.
  const getKey = () => { try { return localStorage.getItem('jr.apikey') || ''; } catch { return ''; } };
  let openSheet = null;
  async function openApply(j) {
    if (!openSheet) {
      const { initApplySheet } = await import('../sponsor-radar/scripts/apply-sheet.mjs');
      openSheet = initApplySheet({
        prefix: 'jr',
        getCv,
        describe: (x) => ({ title: x.title, company: x.company, location: `${x.location || 'UK'}${x.workMode && x.workMode !== 'onsite' ? ` (${x.workMode})` : ''}`, pay: salaryText(x), url: x.url, recruiter: isRecruiter(x) }),
        markApplied: (x) => setStatus(x, 'Applied'),
        appliedOn: (x) => tracker[x.id]?.applied || null,
        writer: async ({ prompt, images }) => (await import('./scripts/write.mjs')).writeDocs({ key: getKey(), prompt, images }),
        writerReady: () => Boolean(getKey()),
        onNeedKey: () => { show('settings'); $('api-key').focus(); },
      });
    }
    openSheet(j);
  }

  // Claude API key, for writing in the app. Kept on this phone and sent only to Anthropic.
  function showKey() {
    const k = getKey();
    $('api-key').value = '';
    $('api-key').placeholder = k ? `Saved, ending ${k.slice(-4)}` : 'sk-ant-...';
    $('key-remove').hidden = !k;
  }
  $('key-save').addEventListener('click', () => {
    const k = $('api-key').value.trim();
    if (!/^sk-ant-[\w-]{20,}$/.test(k)) { $('key-note').textContent = 'That does not look like an Anthropic API key. It starts with sk-ant-.'; return; }
    try { localStorage.setItem('jr.apikey', k); } catch { /* private mode */ }
    $('key-note').textContent = 'Saved on this phone. Apply now writes your CV and letter in the app.';
    showKey();
  });
  $('key-remove').addEventListener('click', () => {
    try { localStorage.removeItem('jr.apikey'); } catch { /* ignore */ }
    $('key-note').textContent = 'Removed. Apply goes back to copy and paste.';
    showKey();
  });
  showKey();

  // CV editor in Settings
  async function loadDefaultCv() {
    try { const r = await fetch('cv.md', { cache: 'no-cache' }); if (r.ok) defaultCv = await r.text(); } catch { /* offline */ }
    $('cv-text').value = getCv();
  }
  $('cv-save').addEventListener('click', () => {
    store.set('jr.cv', $('cv-text').value);
    $('cv-note').textContent = 'Saved on this phone.';
  });
  $('cv-reset').addEventListener('click', () => {
    try { localStorage.removeItem('jr.cv'); } catch { /* ignore */ }
    $('cv-text').value = defaultCv;
    $('cv-note').textContent = 'Reset to the default CV.';
  });

  // ---------- appearance: match the phone, or choose light or dark ----------
  // The saved value is a plain string, because the script in the page head reads it before anything else runs.

  const rootEl = document.documentElement;
  const phoneDark = window.matchMedia('(prefers-color-scheme: dark)');
  const readTheme = () => { try { const t = localStorage.getItem('jr.theme'); return t === 'light' || t === 'dark' ? t : 'auto'; } catch { return 'auto'; } };

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
      try { if (r.value === 'auto') localStorage.removeItem('jr.theme'); else localStorage.setItem('jr.theme', r.value); } catch { /* private mode */ }
      applyTheme(r.value);
    });
  });
  phoneDark.addEventListener('change', syncThemeColour);   // matters when the choice is "match my phone"
  // Motion: plays when the phone allows it, or always when chosen here.
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const readMotion = () => { try { return localStorage.getItem('jr.motion') === 'on' ? 'on' : 'auto'; } catch { return 'auto'; } };
  function applyMotion() {
    if (readMotion() === 'on' || !reduceMotion.matches) rootEl.setAttribute('data-motion', 'on'); else rootEl.removeAttribute('data-motion');
  }
  applyMotion();
  reduceMotion.addEventListener('change', applyMotion);
  document.querySelectorAll('input[name="motion"]').forEach((r) => {
    r.checked = r.value === readMotion();
    r.addEventListener('change', () => {
      if (!r.checked) return;
      try { if (r.value === 'auto') localStorage.removeItem('jr.motion'); else localStorage.setItem('jr.motion', r.value); } catch { /* private mode */ }
      applyMotion();
      replay();
    });
  });

  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  ['q', 'f-sponsor', 'f-remote', 'f-pay', 'f-score'].forEach((id) => $(id).addEventListener('input', renderAll));
  $('f-near').addEventListener('change', (e) => setNear(e.target.checked));
  $('f-miles').addEventListener('change', (e) => { near = { ...near, miles: Number(e.target.value) }; store.set('jr.near', near); replay(); render(); });
  $('near-update').addEventListener('click', async () => { await locate(); replay(); render(); });
  $('refresh').addEventListener('click', load);
  $('export').addEventListener('click', exportTracker);
  $('import').addEventListener('change', (e) => e.target.files[0] && importTracker(e.target.files[0]));
  $('badge-btn').addEventListener('click', () => {
    if ('setAppBadge' in navigator && 'Notification' in window) Notification.requestPermission().then(updateBadges);
    else alert('Icon badges need iOS 16.4 or later, with the app added to your Home Screen.');
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  loadDefaultCv();
  if (near.on) loadPlaces().then(() => locate({ quiet: true })).then(() => render());   // refreshes the position quietly on each open
  load().then(() => { show('today'); takeSharedLink(); });
})();

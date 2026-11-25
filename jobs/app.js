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

  const safeUrl = (u) => (/^https:\/\//i.test(u) ? u : '#');
  const gbp = (n) => '£' + Math.round(n).toLocaleString('en-GB');

  function salaryText(j) {
    if (j.salaryMin && j.salaryMax && j.salaryMin !== j.salaryMax) return `${gbp(j.salaryMin)} to ${gbp(j.salaryMax)}`;
    if (j.salaryMin || j.salaryMax) return gbp(j.salaryMin || j.salaryMax);
    return 'Pay not stated';
  }

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
    else tracker[job.id] = { status, job };
    store.set('jr.tracker', tracker);
    render();
  }

  function card(j) {
    const t = tracker[j.id];
    const fitClass = j.score >= 3.8 ? 'hi' : j.score < 2.5 ? 'lo' : '';
    const chips = el('div', { class: 'chips' });
    chips.append(el('span', { class: 'chip', text: j.location || 'UK' }));
    if (j.workMode !== 'onsite') chips.append(el('span', { class: 'chip good', text: j.workMode === 'remote' ? 'Remote' : 'Hybrid' }));
    chips.append(el('span', { class: 'chip' + (j.salaryMin || j.salaryMax ? '' : ' warn'), text: salaryText(j) }));
    if (j.sponsorLicence === 'licensed') chips.append(el('span', { class: 'chip good', text: 'Licensed sponsor' }));
    else if (j.sponsorLicence === 'not-found') chips.append(el('span', { class: 'chip warn', text: 'Not on register' }));
    else chips.append(el('span', { class: 'chip warn', text: 'Sponsor unchecked' }));
    if (j.sponsorship === 'offered') chips.append(el('span', { class: 'chip good', text: 'Advert mentions sponsorship' }));
    chips.append(el('span', { class: 'chip', text: `${j.source} · ${j.posted}` }));
    if (j.firstSeen === latestFirstSeen() && !t) chips.append(el('span', { class: 'chip new', text: 'New' }));

    const select = el('select', { 'aria-label': 'Status', onchange: (e) => setStatus(j, e.target.value) },
      el('option', { value: '', text: 'Not tracked' }),
      ...STATUSES.map((s) => el('option', { value: s, text: s })));
    select.value = t?.status || '';

    return el('article', { class: 'card job' },
      el('div', { class: 'head' },
        el('div', {}, el('h2', { text: j.title }), el('p', { class: 'co', text: j.company })),
        el('div', { class: 'fit ' + fitClass, title: 'Fit out of 5', text: j.score.toFixed(1) })),
      chips,
      el('p', { class: 'why', text: (j.reasons || []).join(' · ') }),
      el('div', { class: 'actions' },
        el('a', { class: 'primary', href: safeUrl(j.url), target: '_blank', rel: 'noopener noreferrer', text: 'Open advert' }),
        select));
  }

  function fill(container, list, emptyText) {
    container.replaceChildren();
    if (!list.length) { container.append(el('p', { class: 'empty', text: emptyText })); return; }
    for (const j of list) container.append(card(j));
  }

  function renderToday() {
    const c = $('view-today');
    c.replaceChildren();
    const list = todayJobs();
    c.append(el('h3', { text: `New today (${list.length})` }));
    const holder = el('div');
    fill(holder, list, 'Nothing new yet. Check back after the morning update.');
    c.append(holder);
  }

  function renderAll() {
    const q = $('q').value.trim().toLowerCase();
    const minScore = Number($('f-score').value);
    $('f-score-out').textContent = minScore.toFixed(1);
    const list = jobs.filter((j) => {
      if (isHidden(j)) return false;
      if (q && !(`${j.title} ${j.company}`.toLowerCase().includes(q))) return false;
      if ($('f-sponsor').checked && j.sponsorLicence !== 'licensed') return false;
      if ($('f-remote').checked && j.workMode === 'onsite') return false;
      if ($('f-pay').checked && !(j.salaryMin || j.salaryMax)) return false;
      return j.score >= minScore;
    });
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

  function show(name) {
    tab = name;
    for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === name);
    for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${name}`;
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

  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  ['q', 'f-sponsor', 'f-remote', 'f-pay', 'f-score'].forEach((id) => $(id).addEventListener('input', renderAll));
  $('refresh').addEventListener('click', load);
  $('export').addEventListener('click', exportTracker);
  $('import').addEventListener('change', (e) => e.target.files[0] && importTracker(e.target.files[0]));
  $('badge-btn').addEventListener('click', () => {
    if ('setAppBadge' in navigator && 'Notification' in window) Notification.requestPermission().then(updateBadges);
    else alert('Icon badges need iOS 16.4 or later, with the app added to your Home Screen.');
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  load().then(() => show('today'));
})();

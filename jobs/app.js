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
        el('div', { class: 'fit ' + fitClass, title: 'Fit out of 5', text: j.score.toFixed(1) })),
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
    const c = $('view-today');
    c.replaceChildren();
    const list = todayJobs();
    c.append(el('h3', { text: `New today (${list.length})` }));
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
    renderAll();
  }

  function renderAll() {
    const q = $('q').value.trim().toLowerCase();
    const minScore = Number($('f-score').value);
    $('f-score-out').textContent = minScore.toFixed(1);
    const gate = nearActive();
    let tooFar = 0, unplaced = 0;
    let list = jobs.filter((j) => {
      if (isHidden(j)) return false;
      if (gate && j.workMode !== 'remote') {
        const d = geo.distanceMiles(j, where, places);
        if (d === null) { unplaced += 1; return false; }
        if (d > near.miles) { tooFar += 1; return false; }
      }
      if (q && !(`${j.title} ${j.company}`.toLowerCase().includes(q))) return false;
      if ($('f-sponsor').checked && j.sponsorLicence !== 'licensed') return false;
      if ($('f-remote').checked && j.workMode === 'onsite') return false;
      if ($('f-pay').checked && !(j.salaryMin || j.salaryMax)) return false;
      return j.score >= minScore;
    });
    if (gate) list = list.map((j, i) => [j, i]).sort((a, b) => distanceOf(a[0]) - distanceOf(b[0]) || a[1] - b[1]).map((x) => x[0]);
    renderNearNote({ tooFar, unplaced });
    $('all-count').textContent = `${list.length} of ${jobs.length} roles${gate ? ', nearest first' : ''}`;
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
  let applyJob = null;

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
    const pay = salaryText(j);
    const hasText = advertText.trim().length > 0;
    let advert;
    if (hasText && shots.length) advert = `${advertText.trim()}\n\n(A screenshot of the advert is also attached. Use it where the text above is missing or unclear.)`;
    else if (hasText) advert = advertText.trim();
    else if (shots.length) advert = `(The advert is in the attached screenshot${shots.length > 1 ? 's' : ''}. Read it from there.)`;
    else advert = '(Not available. Open the advert link. If you cannot read it, tell me and I will add a screenshot.)';
    return [
      'Help me apply for this job. Follow these rules.',
      '- Use only facts that appear in MY CV below. Do not invent employers, dates, tools, qualifications or numbers.',
      '- Reword and reorder to match the advert. Keep my skill levels as written, for example Power BI is working knowledge and Python is foundational.',
      '- If the advert asks for something my CV does not support, say so. Do not cover the gap.',
      '- Do not answer questions about my right to work, visa status or sponsorship. Leave those for me.',
      '- Write in plain, direct British English. No filler phrases.',
      '',
      'JOB',
      `Title: ${j.title}`,
      `Company: ${j.company}${isRecruiter(j) ? ' (a recruiter, so the real employer may differ)' : ''}`,
      `Location: ${j.location || 'UK'}${j.workMode !== 'onsite' ? ` (${j.workMode})` : ''}`,
      `Pay: ${pay}`,
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
    $('copy-note').textContent = '';
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
  $('f-miles').addEventListener('change', (e) => { near = { ...near, miles: Number(e.target.value) }; store.set('jr.near', near); replay(); renderAll(); });
  $('near-update').addEventListener('click', async () => { await locate(); replay(); renderAll(); });
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
  if (near.on) loadPlaces().then(() => locate({ quiet: true })).then(() => renderAll());   // refreshes the position quietly on each open
  load().then(() => show('today'));
})();

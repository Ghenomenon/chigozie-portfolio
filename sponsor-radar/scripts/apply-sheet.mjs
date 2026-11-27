// The Apply sheet, shared by Sponsor Radar and Job Radar. Three steps:
//   1. Advert     the advert text, read from its link or added as screenshots
//   2. Documents  a tailored CV and cover letter, written by Claude and edited here
//   3. Apply      open the advert, send it, mark it as applied
// The app passes in what differs: where things are stored, how a job is described, and (Job Radar) a writer that
// calls Claude directly. Without a writer, the sheet uses copy and paste with claude.ai.

import { docsPrompt, splitDocs, mdToHtml, keywordsIn, addToSkills, keywordsPrompt } from './lib.mjs';

const READ_REASONS = {
  'bad-url': 'That link is not valid. Add a screenshot instead.',
  'not-allowed': 'This site is not on the list the reader can open. Add a screenshot instead.',
  blocked: 'The site blocked the reader, which is common for Indeed and LinkedIn. Add a screenshot instead.',
  empty: 'The page had no advert text to read. Add a screenshot instead.',
  'not-html': 'The link did not open a web page. Add a screenshot instead.',
  'too-large': 'The page was too large to read. Add a screenshot instead.',
  'fetch-failed': 'The reader could not open that page. Try again, or add a screenshot.',
};

const STEPS = ['advert', 'docs', 'send'];

export function initApplySheet(hooks) {
  const {
    prefix,                       // 'sr' or 'jr', for stored documents
    getCv,                        // () => the person's CV text
    describe,                     // (job) => { title, company, location, pay, url, recruiter }
    markApplied,                  // (job) => void
    appliedOn = () => null,       // (job) => date string when already applied
    writer = null,                // optional async ({ prompt, images }) => reply text
    writerReady = () => Boolean(writer),
    onNeedKey = null,             // optional () => void, when the writer has no key yet
  } = hooks;
  const $ = (id) => document.getElementById(id);
  const docsKey = `${prefix}.docs`;
  const load = () => { try { return JSON.parse(localStorage.getItem(docsKey) || '{}'); } catch { return {}; } };
  const save = (all) => { try { localStorage.setItem(docsKey, JSON.stringify(all)); } catch { /* private mode */ } };

  let job = null;
  let advertText = '';
  let shots = [];
  let shotUrls = [];
  let docs = { cv: '', letter: '', check: '', keywords: [], chosen: null };
  let rewriting = false;   // a keyword rewrite prompt was copied, so the next pasted reply keeps the keyword choices
  let docTab = 'cv';
  let saveTimer = null;

  // ---------- steps ----------
  function go(step) {
    for (const s of STEPS) {
      $(`step-${s}`).hidden = s !== step;
      const b = document.querySelector(`.stepper [data-step="${s}"]`);
      b.classList.toggle('on', s === step);
      if (s === step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    }
    if (step === 'docs') refreshDocs();
    $('apply').querySelector('.sheet').scrollTop = 0;
  }

  // ---------- step 1: the advert ----------
  const prompt = () => docsPrompt({ job: describe(job), advert: advertText, screenshots: shots.length, cv: getCv() });

  function renderShots() {
    shotUrls.forEach((u) => URL.revokeObjectURL(u));
    shotUrls = shots.map((f) => URL.createObjectURL(f));
    const box = $('shot-list');
    box.replaceChildren();
    shots.forEach((f, i) => {
      const wrap = document.createElement('div'); wrap.className = 'thumb';
      const img = document.createElement('img'); img.src = shotUrls[i]; img.alt = `Screenshot ${i + 1}`;
      const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', `Remove screenshot ${i + 1}`);
      x.addEventListener('click', () => { shots.splice(i, 1); renderShots(); });
      wrap.append(img, x); box.append(wrap);
    });
    advertStatus();
  }

  function advertStatus(text) {
    if (text) { $('read-note').textContent = text; return; }
    const parts = [];
    if (advertText.trim()) parts.push(`Advert text: ${advertText.trim().length.toLocaleString('en-GB')} characters.`);
    if (shots.length) parts.push(`${shots.length} screenshot${shots.length > 1 ? 's' : ''} added.`);
    $('read-note').textContent = parts.length ? parts.join(' ') : 'No advert yet. Read it from its link, or add a screenshot.';
  }

  async function readFromLink() {
    if (!job) return;
    const btn = $('read-link');
    btn.disabled = true;
    advertStatus('Reading the advert…');
    try {
      const res = await fetch(`/.netlify/functions/advert?url=${encodeURIComponent(job.url)}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.ok && data.text) {
        advertText = data.text;
        $('advert').value = advertText;
        advertStatus();
      } else advertStatus(READ_REASONS[data.reason] || READ_REASONS['fetch-failed']);
    } catch { advertStatus(READ_REASONS['fetch-failed']); }
    btn.disabled = false;
  }

  // ---------- step 2: the documents ----------
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const all = load();
      if (docs.cv || docs.letter) all[job.id] = { ...docs, updated: new Date().toISOString().slice(0, 10) };
      else delete all[job.id];
      save(all);
    }, 300);
  }

  // The advert's keywords, checked live against the tailored CV. The person chooses which to use: those the CV
  // supports start chosen, the others start left out, and any of them can be switched on or off, or added.
  const chosenSet = () => new Set(docs.chosen || (docs.keywords || []).filter((k) => k.supported).map((k) => k.word));

  function showKeywords() {
    const list = keywordsIn(docs.cv, docs.keywords || []);
    $('kw-box').hidden = !list.length;
    if (!list.length) return;
    const chosen = chosenSet();
    const picked = list.filter((k) => chosen.has(k.word));
    const inCv = picked.filter((k) => k.found).length;
    $('kw-count').textContent = `${picked.length} chosen, ${inCv} in your CV`;
    $('kw-list').replaceChildren(...list.map((k) => {
      const on = chosen.has(k.word);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `chip kw ${on ? (k.found ? 'good' : 'warn') : 'off'}`;
      chip.setAttribute('aria-pressed', String(on));
      chip.textContent = `${on ? (k.found ? '✓' : '+') : '–'} ${k.word}`;
      chip.title = !on ? 'Left out. Tap to use it' : k.found ? 'In your tailored CV' : 'Chosen, not in the tailored CV yet';
      chip.addEventListener('click', () => {
        const c = chosenSet();
        if (c.has(k.word)) c.delete(k.word); else c.add(k.word);
        docs.chosen = [...c];
        persist();
        showKeywords();
      });
      return chip;
    }));
    const missing = picked.filter((k) => !k.found).map((k) => k.word);
    const unbacked = picked.filter((k) => !k.supported).map((k) => k.word);
    const notes = [];
    if (missing.length) notes.push(`Not in the CV yet: ${missing.join(', ')}.`);
    else notes.push('Every chosen keyword is in your CV.');
    if (unbacked.length) notes.push(`Your CV does not show ${unbacked.join(', ')}. Use ${unbacked.length > 1 ? 'them' : 'it'} only if true.`);
    $('kw-note').textContent = notes.join(' ');
    $('kw-skills').disabled = !missing.length;
    $('kw-rewrite').disabled = !picked.length || !getCv().trim();
    $('kw-rewrite').textContent = writer && writerReady() ? 'Rewrite with Claude' : 'Copy rewrite prompt';
  }

  function chosenKeywords() {
    const chosen = chosenSet();
    return (docs.keywords || []).filter((k) => chosen.has(k.word)).map((k) => ({ word: k.word, confirmed: !k.supported }));
  }

  function addKeyword() {
    const word = $('kw-new').value.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!word) return;
    if (!(docs.keywords || []).some((k) => k.word.toLowerCase() === word.toLowerCase())) docs.keywords = [...(docs.keywords || []), { word, supported: false, own: true }];
    const c = chosenSet(); c.add((docs.keywords.find((k) => k.word.toLowerCase() === word.toLowerCase()) || { word }).word);
    docs.chosen = [...c];
    $('kw-new').value = '';
    persist();
    showKeywords();
  }

  function keywordsToSkills() {
    const { text, added } = addToSkills(docs.cv, chosenKeywords().map((k) => k.word));
    if (!added.length) return;
    docs.cv = text;
    persist();
    docTab = 'cv';
    showDoc();
    $('kw-action-note').textContent = `Added to your skills: ${added.join(', ')}. Read the CV to check they sit well.`;
  }

  async function rewriteWithKeywords() {
    const d = describe(job);
    const text = keywordsPrompt({ job: d, cv: getCv(), tailoredCv: docs.cv, letter: docs.letter, keywords: chosenKeywords() });
    if (writer && writerReady()) {
      const btn = $('kw-rewrite');
      btn.disabled = true; btn.textContent = 'Rewriting…';
      $('kw-action-note').textContent = 'Claude is working your keywords into the CV and letter.';
      try { useReply(await writer({ prompt: text, images: [] }), 'kw-action-note', { keepKeywords: true }); }
      catch (e) { $('kw-action-note').textContent = e && e.userMessage ? e.userMessage : 'Rewriting failed. Try again.'; }
      showKeywords();
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      rewriting = true;
      $('kw-action-note').textContent = 'Copied. Paste it into Claude, then copy the whole reply and tap Paste reply below.';
    } catch {
      $('prompt-preview').value = text;
      $('prompt-preview').closest('details').open = true;
      $('prompt-preview').select();
      rewriting = true;
      $('kw-action-note').textContent = 'Copy was blocked. The prompt is selected under See the prompt. Copy it from the menu.';
    }
  }

  function showDoc() {
    for (const b of document.querySelectorAll('.doc-tabs [data-doc]')) {
      const on = b.dataset.doc === docTab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    $('doc').value = docs[docTab] || '';
    $('doc').placeholder = docTab === 'cv' ? 'Your tailored CV appears here. You can edit it.' : 'Your cover letter appears here. You can edit it.';
    showKeywords();
    const has = Boolean(docs.cv || docs.letter);
    $('doc-area').hidden = !has;
    $('rewrite-head').hidden = !has;
    const lines = (docs.check || '').split('\n').map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
    $('check-box').hidden = !lines.length;
    $('check-count').textContent = String(lines.length);
    $('check-list').replaceChildren(...lines.map((l) => { const li = document.createElement('li'); li.textContent = l; return li; }));
  }

  function refreshDocs() {
    const noCv = !getCv().trim();
    const api = Boolean(writer) && writerReady();
    $('write-api').hidden = !api;
    $('write-paste').hidden = api;
    $('need-cv').hidden = !noCv;
    $('write').disabled = noCv;
    $('copy').disabled = noCv;
    $('key-hint').hidden = !(writer && !writerReady());
    $('prompt-preview').value = job ? prompt() : '';
    const canShare = shots.length && typeof navigator.canShare === 'function' && navigator.canShare({ files: shots });
    $('share').hidden = !canShare;
    showDoc();
  }

  function useReply(reply, noteId, { keepKeywords = rewriting } = {}) {
    const parts = splitDocs(reply);
    if (!parts) { $(noteId).textContent = 'I could not find the CV in that reply. Copy the whole reply from Claude and try again.'; return false; }
    docs = keepKeywords
      ? { ...parts, keywords: docs.keywords, chosen: docs.chosen, check: parts.check || docs.check }
      : { ...parts, chosen: null };
    rewriting = false;
    docTab = 'cv';
    persist();
    showDoc();
    $(noteId).textContent = parts.letter ? 'Done. Read both, edit anything, then go on to Apply.' : 'I found the CV but no cover letter. Ask Claude for the letter, then paste again.';
    return true;
  }

  async function write() {
    if (!job) return;
    const btn = $('write');
    btn.disabled = true;
    btn.textContent = 'Writing…';
    $('write-note').textContent = 'Claude is writing your CV and cover letter. This usually takes under a minute.';
    try {
      const reply = await writer({ prompt: prompt(), images: shots });
      useReply(reply, 'write-note');
    } catch (e) {
      $('write-note').textContent = e && e.userMessage ? e.userMessage : 'Writing failed. Check your connection and try again.';
    }
    btn.disabled = !getCv().trim();
    btn.textContent = docs.cv ? 'Write again with Claude' : 'Write with Claude';
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt());
      $('paste-note').textContent = shots.length ? 'Copied. Open Claude, paste it and attach your screenshot.' : 'Copied. Open Claude and paste it.';
    } catch {
      const area = $('prompt-preview');
      area.closest('details').open = true;
      area.focus(); area.select();
      $('paste-note').textContent = 'Copy was blocked. The prompt is selected below. Copy it from the menu.';
    }
  }

  async function pasteReply() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) { $('paste-note').textContent = 'The clipboard is empty. Copy Claude\'s whole reply first.'; return; }
      useReply(text, 'paste-note');
    } catch {
      $('reply-box').open = true;
      $('reply').focus();
      $('paste-note').textContent = 'The phone did not allow pasting. Press and hold in the box below and choose Paste.';
    }
  }

  async function copyDoc() {
    try { await navigator.clipboard.writeText($('doc').value); $('doc-note').textContent = docTab === 'cv' ? 'CV copied.' : 'Cover letter copied.'; } catch { $('doc').select(); $('doc-note').textContent = 'Copy was blocked. The text is selected.'; }
  }

  function printDoc() {
    const box = $('print-doc');
    const d = describe(job);
    box.innerHTML = mdToHtml($('doc').value);
    box.setAttribute('aria-label', `${docTab === 'cv' ? 'CV' : 'Cover letter'} for ${d.title} at ${d.company}`);
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 1500);   // some browsers never send afterprint
  }

  // ---------- step 3: apply ----------
  function refreshSend() {
    const when = job ? appliedOn(job) : null;
    $('mark-applied').textContent = when ? `Applied on ${when}` : 'I have applied';
    $('mark-applied').disabled = Boolean(when);
  }

  // ---------- wiring ----------
  for (const b of document.querySelectorAll('.stepper [data-step]')) b.addEventListener('click', () => go(b.dataset.step));
  $('to-docs').addEventListener('click', () => go('docs'));
  $('to-send').addEventListener('click', () => go('send'));
  $('read-link').addEventListener('click', readFromLink);
  $('shots').addEventListener('change', (e) => {
    shots.push(...[...e.target.files].filter((f) => f.type.startsWith('image/')).slice(0, 4 - shots.length));
    e.target.value = '';
    renderShots();
  });
  $('advert').addEventListener('input', () => { advertText = $('advert').value; advertStatus(); });
  $('write').addEventListener('click', write);
  $('copy').addEventListener('click', copyPrompt);
  $('paste').addEventListener('click', pasteReply);
  $('reply').addEventListener('input', () => { if ($('reply').value.trim().length > 40 && useReply($('reply').value, 'paste-note')) $('reply').value = ''; });
  $('share').addEventListener('click', async () => {
    try { await navigator.share({ files: shots, text: prompt(), title: job ? job.title : 'Job advert' }); }
    catch (e) { if (!e || e.name !== 'AbortError') $('paste-note').textContent = 'Sharing did not work. Copy the prompt, open Claude and attach the screenshot.'; }
  });
  if (onNeedKey) $('key-hint').addEventListener('click', (e) => { e.preventDefault(); $('apply').close(); onNeedKey(); });
  for (const b of document.querySelectorAll('.doc-tabs [data-doc]')) b.addEventListener('click', () => { docTab = b.dataset.doc; showDoc(); });
  $('doc').addEventListener('input', () => { docs[docTab] = $('doc').value; persist(); if (docTab === 'cv') showKeywords(); });
  $('doc-copy').addEventListener('click', copyDoc);
  $('kw-new-btn').addEventListener('click', addKeyword);
  $('kw-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } });
  $('kw-skills').addEventListener('click', keywordsToSkills);
  $('kw-rewrite').addEventListener('click', rewriteWithKeywords);
  $('doc-pdf').addEventListener('click', printDoc);
  $('mark-applied').addEventListener('click', () => { if (job) { markApplied(job); refreshSend(); $('applied-note').textContent = 'Marked as Applied. It is in your Tracker.'; } });
  $('apply').addEventListener('close', () => {
    clearTimeout(saveTimer);
    if (job && (docs.cv || docs.letter)) { const all = load(); all[job.id] = { ...docs, updated: new Date().toISOString().slice(0, 10) }; save(all); }
    shotUrls.forEach((u) => URL.revokeObjectURL(u));
    shotUrls = []; shots = [];
  });

  return function open(j) {
    job = j;
    shots = [];
    advertText = j.summary || '';
    docs = { cv: '', letter: '', check: '', keywords: [], chosen: null, ...(load()[j.id] || {}) };
    rewriting = false;
    docTab = 'cv';
    const d = describe(j);
    $('apply-title').textContent = d.title;
    $('apply-sub').textContent = `${d.company} · ${d.location || 'UK'}`;
    $('advert').value = advertText;
    $('open-advert').href = /^https:\/\//i.test(j.url) ? j.url : '#';
    $('write').textContent = docs.cv ? 'Write again with Claude' : 'Write with Claude';
    for (const id of ['write-note', 'paste-note', 'doc-note', 'applied-note']) $(id).textContent = '';
    $('reply').value = '';
    renderShots();
    refreshSend();
    go(docs.cv ? 'docs' : 'advert');
    const dlg = $('apply');
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
    if (!advertText) readFromLink();
  };
}

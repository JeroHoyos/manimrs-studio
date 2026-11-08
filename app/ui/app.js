// ManimRS Studio: the slide browser, the viewer with its review, and the chat with Claude.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const load = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
// A remembered choice, only if it still has the expected shape (otherwise, the default).
const stored = (k, shape) => { const v = load(k, ''); return shape.test(v) ? v : ''; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const icon = (n, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
// Same as to_name in studio.py: “Git stash, how” → git_stash_how
const toName = t => t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const QUALITIES = ['480p', '720p', '1080p'];
const PENDING = new Set(['new', 'changed', 'transition', 'resolution']);
const LABEL = {
  up_to_date: 'up to date', new: 'not rendered', changed: 'changed', transition: 'previous slide changed',
  shared: 'shared code changed', resolution: 'different resolution', out: 'commented out',
};
const EXPLAIN = {
  new: () => 'Not rendered yet',
  changed: () => 'Changed since the last render',
  transition: s => `The previous slide (${s.previous || 'none'}) changed, so its entrance is outdated`,
  shared: () => 'Shared code (style, components…) changed since its render, it may look different',
  resolution: s => `It is at ${s.quality} and you want it at ${s.resolution}`,
  up_to_date: () => 'The video is up to date',
};
const REVIEW = {
  approved: {icon: 'check', cls: 'approved', text: 'Approved'},
  changes: {icon: 'pencil', cls: 'changes', text: 'Changes requested'},
  to_review: {icon: null, cls: '', text: 'To review'},
};
const toReview = s => s.active && s.status !== 'new' && !['approved', 'changes'].includes(s.review.status);
const FILTERS = [
  {id: 'all', name: 'All', test: () => true, count: false,
   empty: ['This talk has no slides', 'Use “New” or ask Claude to create the first one']},
  {id: 'pending', name: 'Pending', test: s => s.active && PENDING.has(s.status), count: true,
   empty: ['Everything is rendered and up to date', 'When a slide changes, it shows up here']},
  {id: 'review', name: 'To review', test: toReview, count: true,
   empty: ['No slides are waiting for your review', 'The ones rendered again show up here until you approve them']},
];

let base = '', root = '', home = '';
let talks = [];
let talk = load('studio.talk', '');
// The talk's resolution, from its talk.manimrs; while a change is being saved, the old one that a
// refresh brings is not shown.
let quality = '1080p', qualitySaving = 0;
let filter = 'all';
let data = null, jobs = [], listSig = '', sel = null, part = 0, openedByClaude = null;
let mode = 'view';            // view, new, rename, talk (the new talk form) or details (the talk's)
let newTalkDraft = null;      // {place, folder}: the new talk form opened from an empty folder
// The images of each note (“talk/slide” → attachments) until they go to Claude.
// shortcut: they live in memory, so closing the app loses the ones not sent; save them in diapos/ if that hurts
const noteImages = new Map();
const statusBefore = {};

// Each slide is identified by its name; the commented-out ones, by their line.
const key = s => s.active ? s.name : `#${s.line}`;
const byKey = k => data?.slides.find(s => key(s) === k);
const current = () => byKey(sel);
const actives = () => data.slides.filter(s => s.active);
const talkId = t => talks.find(x => x.id === t)?.id || talks.find(x => x.id === 'charla-' + t)?.id;
const currentFilter = () => FILTERS.find(f => f.id === filter);
// Windows paths, for the place of a talk.
const parentOf = p => String(p).replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '');
const baseName = p => String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop();
// A long path keeps its drive and its last folders, which say the most: C:\…\charlas\charla-git
const shortPath = p => {
  const parts = String(p).split(/[\\/]+/).filter(Boolean);
  return parts.length > 5 ? [parts[0], '…', ...parts.slice(-3)].join('\\') : parts.join('\\') || String(p);
};
const inside = (dir, p) => {
  const norm = s => String(s).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return !!dir && (norm(p) + '/').startsWith(norm(dir) + '/');
};
// Same as talk_folder in studio.py: “Docker from scratch” → charla-docker-from-scratch
const folderName = t => {
  let s = t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').replace(/^charla-/, '');
  if (s.length > 40) s = s.slice(0, 40).replace(/-[^-]*$/, '');
  return s ? 'charla-' + s : '';
};

// ───────────── startup ─────────────
async function start() {
  paintSkeleton();
  await listen('jobs', e => { jobs = e.payload; paintJobs(); });
  await listen('show', e => show(e.payload));
  await listen('claude-event', e => onClaudeEvent(e.payload));
  await listen('claude-stderr', e => onClaudeStderr(e.payload));
  await listen('claude-exit', e => onClaudeExit(e.payload));
  const info = await invoke('info');
  base = `http://127.0.0.1:${info.port}`;
  root = String(info.root || '');
  home = String(info.home || '');
  chatStart(info);
  talks = await invoke('talks');
  talk = talkId(talk) || talks[0]?.id || '';
  paintTalks();
  paintQuality();
  jobs = await invoke('jobs');
  paintJobs();
  await refresh();
  schedule();
}

function paintSkeleton() {
  $('#list').innerHTML = Array.from({length: 9}, () =>
    '<div class="skeleton" aria-hidden="true"><span class="sk-line" style="width:12px"></span><span class="sk-thumb"></span><span class="sk-line"></span></div>').join('');
  $('#viewer').innerHTML = '';
}

// The status is checked every few seconds while the window is visible (it only costs something
// when a file changed), and once more as soon as it comes back into view.
let clock = null;
function schedule() {
  clearTimeout(clock);
  if (document.hidden) return;
  const busy = jobs.some(j => j.status === 'running' || j.status === 'queued');
  clock = setTimeout(async () => { await refresh().catch(() => {}); schedule(); }, busy ? 2000 : 5000);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(clock); return; }
  // Claude or the web panel may have made or added a talk meanwhile.
  reloadTalks().then(() => refresh()).catch(() => {});
  schedule();
});

// While a job runs its progress arrives many times per second: the list follows it at most once
// a second.
let soonClock = null;
function refreshSoon() {
  if (soonClock) return;
  soonClock = setTimeout(() => { soonClock = null; listSig = ''; refresh().catch(() => {}); }, 800);
}

let turn = 0;
async function refresh() {
  const mine = ++turn, asked = talk;
  if (!asked) { paintNoTalks(); return; }
  let d;
  try {
    d = await invoke('status', {talk: asked});
  } catch (e) {
    // Its folder may be gone (moved, or on a drive that was unplugged): go to another talk.
    if (mine !== turn || asked !== talk) return;
    await reloadTalks();
    if (talk !== asked) return refresh();
    throw e;
  }
  if (mine !== turn || asked !== talk) return;  // an old answer arrived
  data = d;
  ['#new', '#present', '#export', '#talk-details'].forEach(b => { $(b).disabled = false; });
  document.querySelectorAll('#quality button').forEach(b => { b.disabled = false; });
  if (QUALITIES.includes(d.resolution) && !qualitySaving) quality = d.resolution;
  paintQuality();
  if (!sel || !current()) {
    const stored = load('studio.sel.' + talk, '');
    const chosen = byKey(stored) || actives()[0] || data.slides[0];
    sel = chosen ? key(chosen) : null;
    part = 0;
    paintViewer(true);
  } else {
    paintViewer(false);
  }
  const sig = JSON.stringify([data.slides.map(x => [key(x), x.status, x.thumbnail, x.review.status, x.quality]),
    filter, sel, [...rendering()]]);
  if (sig !== listSig) { listSig = sig; paintList(); }
  paintHeader();
}

// Claude (through MCP) asks to show a slide: it opens and is flagged for a moment.
async function show({talk: t, slide}) {
  if (!talkId(t)) await reloadTalks().catch(() => {});  // one Claude just made
  const id = talkId(t);
  if (!id) return;
  if (id !== talk) changeTalk(id);
  await refresh();
  const s = data.slides.find(x => x.active && [x.name, String(x.pos), x.method, x.method.replace(/^slide_/, '')].includes(String(slide)));
  if (!s) return;
  if (!currentFilter().test(s)) { filter = 'all'; listSig = ''; paintList(); }
  openedByClaude = s.name;
  select(key(s));
  const row = document.querySelector(`.row[data-k="${CSS.escape(s.name)}"]`);
  row?.classList.remove('flash'); void row?.offsetWidth; row?.classList.add('flash');
}

function changeTalk(id) {
  talk = id; save('studio.talk', id);
  $('#talk').value = id;
  sel = null; listSig = ''; filter = 'all'; mode = 'view';
}

// The talk picker, with “New talk” and “Open a talk” at the end.
function paintTalks() {
  $('#talk').innerHTML = (talks.length ? '' : '<option value="" hidden>No talks</option>')
    + talks.map(t => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join('')
    + (talks.length ? '<hr>' : '')
    + '<option value="__new">+ New talk</option><option value="__open">Open a talk…</option>';
  $('#talk').value = talk;
}

// The list again; if the open talk left it, the first one opens.
async function reloadTalks() {
  talks = await invoke('talks');
  if (!talkId(talk)) {
    changeTalk(talks[0]?.id || '');
    paintSkeleton();
  }
  paintTalks();
}

// Opens a talk that was just created or added.
async function enterTalk(r) {
  talks = await invoke('talks');
  changeTalk(r.id);
  paintTalks();
  paintSkeleton();
  letClaudeIn(r.path);
  await refresh();
}

// Claude works in the talks folder; for a talk kept somewhere else its session must know that
// folder. A conversation that hasn't started yet starts again knowing it, a started one asks
// before touching it.
function letClaudeIn(path) {
  if (!path || inside(root, path)) return;
  if (chat.alive && !chat.running && !chat.sessionId && !chat.timeline.length) startSession({}).catch(() => {});
}

// Without talks: a way to make the first one or to open one.
function paintNoTalks() {
  data = null; sel = null; listSig = '';
  ['#new', '#present', '#export', '#pending', '#talk-details'].forEach(b => { $(b).disabled = true; });
  document.querySelectorAll('#quality button').forEach(b => {
    b.disabled = true; b.classList.remove('on'); b.setAttribute('aria-pressed', 'false');
  });
  $('#pending').innerHTML = `${icon('layers')}Render pending`;
  $('#send-all').hidden = true;
  $('#summary').innerHTML = '';
  $('#filters').innerHTML = '';
  $('#list').innerHTML = '';
  if (mode === 'talk') { if (!$('#f-talk')) paintNewTalk(); return; }
  mode = 'view';
  if ($('#viewer .no-talks')) return;  // already there: repainting it every few seconds would flicker
  releaseVideos();
  $('#viewer').innerHTML = `<div class="empty-state no-talks"><b>No talks yet</b>Make a new one, or open one you already have from any folder
    <span class="actions"><button class="btn primary" id="e-new">${icon('plus')}New talk</button><button class="btn" id="e-open">Open a talk</button></span></div>`;
  $('#e-new').onclick = () => { mode = 'talk'; newTalkDraft = null; paintViewer(true); };
  $('#e-open').onclick = () => openTalk();
}

// The Windows folder picker. Returns {path, empty}, or null if it was closed.
async function pickFolder(title, start) {
  try { return await invoke('pick_folder', {title, start: start || null}); }
  catch (e) { toast(String(e)); return null; }
}

// “Open a talk”: the folder of a talk, its presentacion folder or its talk.manimrs. An empty folder
// becomes the place of a new talk.
async function openTalk() {
  const picked = await pickFolder('Open a talk: choose its folder', load('studio.place', '') || root);
  if (!picked) return;
  save('studio.place', parentOf(picked.path));
  if (picked.empty) {
    newTalkDraft = {place: parentOf(picked.path), folder: baseName(picked.path)};
    mode = 'talk';
    paintViewer(true);
    toast('That folder is empty, the new talk can go there');
    return;
  }
  try {
    const r = await invoke('open_talk', {path: picked.path});
    await enterTalk(r);
    toast(`${r.title} is on the list`);
  } catch (e) {
    toast(String(e));
  }
}

// ───────────── header ─────────────
function paintQuality() {
  document.querySelectorAll('#quality button').forEach(b => {
    b.classList.toggle('on', b.dataset.q === quality);
    b.setAttribute('aria-pressed', b.dataset.q === quality);
  });
}

function paintHeader() {
  const a = actives();
  const count = f => a.filter(f).length;
  const pend = count(s => PENDING.has(s.status));
  const changes = count(s => s.review.status === 'changes');
  const upToDate = count(s => s.status === 'up_to_date');
  $('#summary').innerHTML = `<span class="progress" aria-hidden="true"><i style="width:${a.length ? upToDate / a.length * 100 : 0}%"></i></span>${upToDate} of ${a.length} up to date`;
  const bp = $('#pending');
  bp.innerHTML = pend ? `${icon('layers')}Render ${pend} pending` : `${icon('check')}All up to date`;
  bp.disabled = !pend;
  const bs = $('#send-all');
  bs.hidden = !changes;
  bs.innerHTML = `${icon('send')}Send ${changes} change${changes === 1 ? '' : 's'} to Claude`;
}

// ───────────── slide browser ─────────────
function paintList() {
  $('#filters').innerHTML = FILTERS.map(f => {
    const n = data.slides.filter(f.test).length;
    return `<button role="tab" aria-selected="${f.id === filter}" data-f="${f.id}" class="${f.id === filter ? 'on' : ''}">${f.name}${f.count && n ? `<b>${n}</b>` : ''}</button>`;
  }).join('');
  const f = currentFilter();
  const busy = rendering();
  let html = '', group = null;
  for (const s of data.slides.filter(f.test)) {
    if (s.group !== group) {
      group = s.group;
      if (group) html += `<div class="group">${esc(group)}</div>`;
    }
    html += row(s, busy.has(s.name));
  }
  $('#list').innerHTML = html || `<div class="empty-state"><b>${esc(f.empty[0])}</b>${esc(f.empty[1])}</div>`;
  $('#list .row.active')?.scrollIntoView({block: 'nearest'});
}

function row(s, inRender) {
  const rev = REVIEW[s.review.status];
  const meta = esc(inRender ? 'rendering…' : LABEL[s.status])
    + (!inRender && s.quality && s.active && s.status !== 'new' ? `<span class="tag">${esc(s.quality)}</span>` : '');
  const img = s.thumbnail ? `<img src="${esc(base + s.thumbnail)}" loading="lazy" alt="">` : '';
  const k = key(s);
  return `<button class="row ${k === sel ? 'active' : ''} ${s.active ? '' : 'out'}" data-k="${esc(k)}"
      role="option" aria-selected="${k === sel}" ${s.active && filter === 'all' ? 'draggable="true"' : ''}>
    <span class="num">${esc(s.pos ?? '–')}</span>
    <span class="thumb ${img ? '' : 'empty'}">${img}${inRender ? '<span class="spinner"></span>' : ''}</span>
    <span class="row-text">
      <span class="name">${esc(s.name)}</span>
      <span class="row-meta"><span class="dot s-${esc(s.status)}"></span>${meta}${rev?.icon
        ? `<span class="rev ${rev.cls}" title="${rev.text}">${icon(rev.icon)}</span>` : ''}</span>
    </span>
  </button>`;
}

// The slides of this talk with a render queued or running: the one the title names
// (“render of x”) and the one being drawn (“drawing x (1/3)”).
function rendering() {
  const names = new Set();
  for (const j of jobs) {
    if (!['running', 'queued'].includes(j.status) || talkId(j.talk) !== talk) continue;
    const title = j.title.match(/[Rr]ender of (\S+) \(/);
    if (title) names.add(title[1]);
    const line = [...j.log].reverse().find(l => l.startsWith('drawing '));
    if (line && j.status === 'running') names.add(line.split(' ')[1]);
  }
  return names;
}

function select(k) {
  if (!k) return;
  if (k !== sel) {
    sel = k; part = 0; save('studio.sel.' + talk, sel);
    if (k !== openedByClaude) openedByClaude = null;
  }
  mode = 'view';
  document.querySelectorAll('.row').forEach(r => {
    const is = r.dataset.k === sel;
    r.classList.toggle('active', is);
    r.setAttribute('aria-selected', is);
  });
  $('#list .row.active')?.scrollIntoView({block: 'nearest'});
  listSig = '';
  paintViewer(true);
}

// ───────────── viewer ─────────────
function paintViewer(fresh) {
  if (mode === 'new') { if (fresh) paintNew(); return; }
  if (mode === 'talk') { if (fresh && !$('#f-talk')) paintNewTalk(); return; }
  if (mode === 'details') { if (fresh && !$('#f-details')) paintDetails(); return; }
  const s = current();
  if (!s) {
    releaseVideos();
    $('#viewer').innerHTML = data ? '<div class="empty-state"><b>Pick a slide</b>They are on the left, in the order of the talk</div>' : '';
    return;
  }
  if (!s.active) { if (fresh || !$('#o-restore')) paintOut(s); return; }
  if (fresh || !$('#screen')) {
    mode = 'view';
    $('#viewer').innerHTML = `<div class="column">
      <div class="viewer-head">
        <h1><span class="pos">${esc(s.pos)}</span><span id="v-name"></span></h1>
        <span class="chips" id="v-chips"></span>
        <span class="spacer"></span>
        <button class="btn icon subtle" id="b-actions" aria-label="More actions" aria-haspopup="menu" title="More actions">${icon('more')}</button>
      </div>
      <div class="viewer-meta" id="v-group"></div>
      <div class="screen" id="screen"><div class="stack" id="stack"></div><div class="video-note" id="v-note" hidden></div></div>
      <div class="timeline empty" id="timeline" role="slider" tabindex="0" aria-label="Position in the slide" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">
        <div class="segments" id="segments"></div>
        <div class="playhead" id="playhead"><i></i></div>
        <div class="tl-tip" id="tl-tip" hidden></div>
      </div>
      <div class="controls">
        <button class="btn icon" id="p-play" aria-label="Play">${icon('play')}</button>
        <button class="btn icon subtle" id="p-prev" aria-label="Previous pause" title="Previous pause (←)">${icon('skip-back')}</button>
        <button class="btn icon subtle" id="p-next" aria-label="Next pause" title="Next pause (→)">${icon('skip-fwd')}</button>
        <span class="time" id="v-time"></span>
        <span class="pauses" id="v-pauses" aria-live="polite"></span>
        <span class="spacer"></span>
        <button class="btn" id="b-render"></button>
        <button class="btn" id="b-present" title="Present the talk from this slide">${icon('play')}Present from here</button>
      </div>
      <p class="status-line"><span class="dot" id="v-dot"></span><span id="v-status"></span><span class="hint" id="v-rendered"></span>
        <span class="spacer"></span>
        <select id="v-resolution" aria-label="Resolution of this slide" title="Resolution of this slide"></select></p>
      <section class="review" aria-labelledby="t-review">
        <div class="review-head"><h2 id="t-review">Review</h2><span class="hint" id="v-review"></span></div>
        <textarea id="note" aria-labelledby="t-review" placeholder="What would you change? Write it as you would tell Claude: “make the title bigger”, “remove the second sentence”…"></textarea>
        <div class="c-attachments" id="r-images" hidden></div>
        <input type="file" id="r-file" accept="image/*" multiple hidden>
        <div class="review-actions">
          <button class="btn" id="b-approve">${icon('check')}Approve</button>
          <button class="btn subtle" id="b-image" title="Attach images to the note, you can also paste or drop them">${icon('image')}Attach image</button>
          <span class="spacer"></span>
          <button class="btn subtle" id="b-save-note" title="Save the note to send it later together with others">${icon('pencil')}Save note</button>
          <button class="btn primary" id="b-send" title="Send the request to Claude">${icon('send')}Send to Claude</button>
        </div>
      </section></div>`;
    $('#note').value = s.review.note || '';
    wireNoteImages();
    wirePlayer();
    $('#v-resolution').onchange = e => setResolution(current(), e.target.value);
  }
  if (mode !== 'rename') $('#v-name').textContent = s.name;
  const rev = REVIEW[s.review.status];
  $('#v-chips').innerHTML = [
    `<span class="chip ${esc(s.status)}"><span class="dot s-${esc(s.status)}"></span>${esc(LABEL[s.status])}</span>`,
    s.quality && s.status !== 'new' ? `<span class="chip">${esc(s.quality)}</span>` : '',
    rev ? `<span class="chip ${rev.cls}">${rev.icon ? icon(rev.icon) : ''}${rev.text}</span>` : '',
    openedByClaude === s.name ? '<span class="chip claude">Claude opened it</span>' : '',
  ].join('');
  $('#v-group').textContent = s.group;
  $('#v-dot').className = `dot s-${s.status}`;
  $('#v-status').textContent = EXPLAIN[s.status](s);
  $('#v-rendered').textContent = s.rendered_at ? `Rendered ${new Date(s.rendered_at).toLocaleString('en', {dateStyle: 'medium', timeStyle: 'short'})}` : '';
  $('#v-review').textContent = s.review.date ? `${rev?.text ?? 'Note'} on ${new Date(s.review.date).toLocaleDateString('en', {dateStyle: 'medium'})}` : '';
  const sr = $('#v-resolution');
  if (document.activeElement !== sr) {
    sr.innerHTML = `<option value="">The talk's resolution (${quality})</option>` +
      QUALITIES.map(r => `<option value="${r}">This one at ${r}</option>`).join('');
    sr.value = s.resolution || '';
  }
  // “Render” is the main action only when something is pending.
  const br = $('#b-render');
  br.className = 'btn' + (s.status !== 'up_to_date' ? ' primary' : '');
  br.innerHTML = `${icon('layers')}Render`;
  br.disabled = rendering().has(s.name);
  $('#b-present').disabled = !s.parts.length;
  loadVideo();
}

function paintOut(s) {
  releaseVideos();
  $('#viewer').innerHTML = `<div class="out-view">
    <div class="viewer-head"><h1>${esc(s.name)}</h1><span class="chip">commented out</span></div>
    <p>This slide is commented out in the talk, put it back or delete it</p>
    <div class="actions">
      <button class="btn primary" id="o-restore">${icon('again')}Put it back</button>
      <button class="btn danger" id="o-delete">${icon('trash')}Delete…</button>
    </div></div>`;
}

function paintNew() {
  releaseVideos();
  const a = actives();
  const ref = current()?.active ? current() : a[a.length - 1];
  $('#viewer').innerHTML = `<form class="form" id="f-new" autocomplete="off">
    <h1>New slide</h1>
    <div class="field"><label for="n-name">Name</label>
      <input type="text" id="n-name" required placeholder="For example: git stash">
      <span class="hint" id="n-preview">This is how it will show up in the list</span></div>
    <div class="field"><label for="n-after">Goes after</label>
      <select id="n-after">${a.map(x => `<option value="${esc(x.name)}" ${x === ref ? 'selected' : ''}>${esc(x.pos)} ${esc(x.name)}</option>`).join('')}</select></div>
    <div class="field"><label for="n-what">What it should show <span class="optional">optional</span></label>
      <textarea id="n-what" placeholder="Claude makes it with this, for example: “the three areas of git with an arrow for each command”"></textarea>
      <span class="hint">If you leave it empty, it is created with a placeholder title and you fill it in later</span></div>
    <div class="actions">
      <button type="button" class="btn subtle" id="n-cancel">Cancel</button>
      <button type="submit" class="btn primary" id="n-create">${icon('plus')}Create slide</button>
    </div></form>`;
  const name = $('#n-name');
  name.focus();
  name.oninput = () => {
    const n = toName(name.value);
    $('#n-preview').textContent = n ? `It will show up as ${n}` : 'This is how it will show up in the list';
  };
  $('#n-cancel').onclick = () => { mode = 'view'; paintViewer(true); };
  $('#f-new').onsubmit = async e => {
    e.preventDefault();
    if (!/^[a-z]/.test(toName(name.value))) { name.focus(); toast('The name has to start with a letter'); return; }
    const after = $('#n-after').value;
    const what = $('#n-what').value.trim();
    $('#n-create').disabled = true;
    try {
      const r = JSON.parse(await invoke('edit', {talk, args: ['new', '--json', ...(after ? ['--after', after] : []), '--', name.value.trim()]}));
      mode = 'view'; filter = 'all';
      await refresh();
      select(r.name);
      if (what) sendToClaude(`/slides ${talk} ${r.name}: it is a new slide, already created and placed in the talk, make it with this: ${what}`);
      else toast(`Created ${r.name} at position ${r.pos}`);
    } catch (err) {
      $('#n-create').disabled = false;
      toast(String(err));
    }
  };
}

const LANGUAGES = [['es', 'Spanish'], ['en', 'English']];
const languageOptions = chosen => (LANGUAGES.some(([c]) => c === chosen) ? LANGUAGES : [...LANGUAGES, [chosen, chosen]])
  .map(([c, n]) => `<option value="${esc(c)}" ${c === chosen ? 'selected' : ''}>${esc(n)}</option>`).join('');
const leaveForm = () => { mode = 'view'; newTalkDraft = null; if (talk) paintViewer(true); else paintNoTalks(); };

// A new talk goes in a folder of its own, wherever the user wants: everything of the talk lives
// there (its slides, their code, its videos and its talk.manimrs).
function paintNewTalk() {
  releaseVideos();
  const draft = newTalkDraft || {};
  let place = draft.place || load('studio.place', '') || root;
  let named = !!draft.folder;  // the folder name was written by hand: the title no longer changes it
  $('#viewer').innerHTML = `<form class="form" id="f-talk" autocomplete="off">
    <div><h1>New talk</h1>
      <p class="hint">It starts with a title slide and a closing slide, then you add slides here or with Claude</p></div>
    <div class="field"><label for="t-title">Title</label>
      <input type="text" id="t-title" required placeholder="For example: Docker from scratch"></div>
    <div class="field"><label for="t-topic">What it is about <span class="optional">optional</span></label>
      <textarea id="t-topic" placeholder="Who it is for and what it covers, for example: “for beginners, what a container is, images, volumes and docker compose”"></textarea>
      <span class="hint">It is saved with the talk; if you write it, Claude proposes the slides and waits for your approval before making them</span></div>
    <div class="field"><label for="t-language">Language of the slides</label>
      <select id="t-language">${languageOptions('es')}</select></div>
    <div class="field"><span class="field-name" id="t-where">Where</span>
      <div class="place" role="group" aria-labelledby="t-where"><span class="place-path" id="t-place"></span>
        <button type="button" class="btn" id="t-choose">Choose folder</button></div></div>
    <div class="field"><label for="t-folder">Folder of the talk</label>
      <input type="text" id="t-folder" required spellcheck="false" placeholder="For example: charla-docker">
      <span class="hint" id="t-folder-hint"></span></div>
    <div class="actions">
      <button type="button" class="btn subtle" id="t-cancel">Cancel</button>
      <button type="submit" class="btn primary" id="t-create">${icon('plus')}Create talk</button>
    </div></form>`;
  const title = $('#t-title'), folder = $('#t-folder');
  const paintPlace = () => {
    $('#t-place').textContent = shortPath(place);
    $('#t-place').title = place;
    $('#t-folder-hint').textContent = draft.folder && folder.value === draft.folder && place === draft.place
      ? 'That folder is empty, the talk goes in it'
      : 'A new folder inside the one above, with everything of the talk';
  };
  folder.value = draft.folder || '';
  paintPlace();
  title.focus();
  title.oninput = () => { if (!named) { folder.value = folderName(title.value); paintPlace(); } };
  folder.oninput = () => { named = !!folder.value.trim(); paintPlace(); };
  $('#t-choose').onclick = async () => {
    const picked = await pickFolder('Choose where the new talk goes', place);
    if (picked) { place = picked.path; paintPlace(); }
  };
  $('#t-cancel').onclick = leaveForm;
  $('#f-talk').onsubmit = async e => {
    e.preventDefault();
    const t = title.value.trim(), topic = $('#t-topic').value.trim();
    if (!/[a-z0-9]/i.test(t.normalize('NFKD'))) { title.focus(); toast('The title needs at least one letter or number'); return; }
    if (!folder.value.trim()) { folder.focus(); toast('The talk needs a folder name'); return; }
    $('#t-create').disabled = true;
    try {
      const r = await invoke('new_talk', {
        title: t, about: topic, language: $('#t-language').value,
        place, folder: folder.value.trim(),
      });
      save('studio.place', place);
      newTalkDraft = null;
      await enterTalk(r);
      if (topic) sendToClaude(`/slides ${r.id}: it is a new talk, “${t}”, already created with a title slide and a closing slide. What it is about is in its talk.manimrs: ${topic}. Propose the list of slides first and wait for my approval before creating them`);
      else toast('Talk created, render its pending slides to see it');
    } catch (err) {
      $('#t-create').disabled = false;
      toast(String(err));
    }
  };
}

// What the talk is, from its talk.manimrs: Claude reads the same file.
function paintDetails() {
  releaseVideos();
  const p = data?.project;
  if (!p) { mode = 'view'; paintViewer(true); return; }
  $('#viewer').innerHTML = `<form class="form" id="f-details" autocomplete="off">
    <div><h1>Talk details</h1>
      <p class="hint">They are saved with the talk, in its own file, and Claude reads them before making slides</p></div>
    <div class="field"><label for="d-title">Title</label>
      <input type="text" id="d-title" required>
      <span class="hint">How the talk shows up here, the title slide keeps its own text</span></div>
    <div class="field"><label for="d-about">What it is about <span class="optional">optional</span></label>
      <textarea id="d-about" placeholder="Who it is for and what it covers"></textarea></div>
    <div class="field"><label for="d-author">Who gives it <span class="optional">optional</span></label>
      <input type="text" id="d-author"></div>
    <div class="field"><label for="d-language">Language of the slides</label>
      <select id="d-language">${languageOptions(p.language || 'es')}</select></div>
    <div class="field"><span class="field-name" id="d-where">Folder</span>
      <div class="place" role="group" aria-labelledby="d-where"><span class="place-path" id="d-place"></span>
        <button type="button" class="btn" id="d-show">Show in folder</button></div></div>
    <div class="actions">
      <button type="button" class="btn danger" id="d-forget">Remove from the list…</button>
      <span class="spacer"></span>
      <button type="button" class="btn subtle" id="d-cancel">Cancel</button>
      <button type="submit" class="btn primary" id="d-save">${icon('check')}Save</button>
    </div></form>`;
  const fields = ['title', 'about', 'author', 'language'];
  for (const f of fields) $(`#d-${f}`).value = p[f] || '';
  $('#d-language').value = p.language || 'es';
  $('#d-place').textContent = shortPath(data.path);
  $('#d-place').title = data.path;
  $('#d-title').focus();
  $('#d-show').onclick = () => act(invoke('show_talk_folder', {talk}));
  $('#d-cancel').onclick = leaveForm;
  $('#d-forget').onclick = async () => {
    if (!confirm(`Remove “${p.title}” from the list? Its folder, its slides and its videos stay where they are, and you can open it again whenever you want`)) return;
    try {
      toast(await invoke('forget_talk', {talk}));
      mode = 'view';
      await reloadTalks();
      await refresh();
    } catch (e) { toast(String(e)); }
  };
  $('#f-details').onsubmit = async e => {
    e.preventDefault();
    const changed = {};
    for (const f of fields) {
      const v = $(`#d-${f}`).value.trim();
      if (v !== (p[f] || '')) changed[f] = v;
    }
    if (changed.title === '') { $('#d-title').focus(); toast('The talk needs a title'); return; }
    $('#d-save').disabled = true;
    try {
      if (Object.keys(changed).length) await invoke('save_talk', {talk, fields: changed});
      mode = 'view';
      if (changed.title) { talks = await invoke('talks'); paintTalks(); }
      await refresh();
      paintViewer(true);
      toast('Saved');
    } catch (err) {
      $('#d-save').disabled = false;
      toast(String(err));
    }
  };
}

// ───────────── player ─────────────
// A rendered slide is one video per pause. The player keeps one <video> per pause, all loaded,
// and only changes which one is visible: going to another pause, while playing or scrubbing,
// never waits for a video to load. One timeline joins them: it plays straight through like a
// single video, can be scrubbed, and the marks between pieces are the pauses.
const player = {
  playing: true, sig: '', videos: [], segs: [], fills: [], geometry: [], rects: null,
  frame: null, drag: null, ariaAt: 0,
};
const wanted = new WeakMap();  // video → the moment it has to show once its current seek ends

const pieces = () => current()?.parts || [];
const urlOf = p => base + p.url;
const vid = () => player.videos[part] || null;
const lengthOf = v => (isFinite(v.duration) && v.duration > 0 ? v.duration : 1);
// Where each pause starts and how long it lasts (one second while its length is still unknown).
function layout() {
  let t = 0;
  return player.videos.map(v => { const dur = lengthOf(v); const seg = {start: t, dur}; t += dur; return seg; });
}
const totalTime = segs => (segs.length ? segs.at(-1).start + segs.at(-1).dur : 0);
const known = () => player.videos.length > 0 && player.videos.every(v => isFinite(v.duration) && v.duration > 0);
const timecode = t => {
  const s = Math.round(Math.max(0, t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Stops and frees the videos of the slide that was open (their decoders and memory).
function releaseVideos() {
  for (const v of player.videos) { v.pause(); v.removeAttribute('src'); v.load(); }
  player.videos = [];
  player.sig = '';
}

// Keeps the videos in step with the slide's pieces: it runs on every refresh, so it only touches
// them when the pieces changed (a new render) or none is loaded yet.
function loadVideo() {
  const s = current(), stack = $('#stack'), note = $('#v-note');
  if (!s || !stack) return;
  const list = s.parts, sig = list.map(urlOf).join('|');
  if (sig !== player.sig) {
    const again = !!player.sig;  // rendered again while open: from the start
    releaseVideos();
    player.sig = sig;
    player.videos = list.map((p, i) => {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.addEventListener('loadedmetadata', () => { const w = wanted.get(v); wanted.delete(v); if (w != null) seekVideo(v, w); paintTimeline(); });
      v.addEventListener('seeked', () => { const w = wanted.get(v); if (w != null) { wanted.delete(v); seekVideo(v, w); } if (v === vid()) paintPosition(); });
      v.addEventListener('ended', () => onEnded(i));
      v.addEventListener('play', paintPlayer);
      v.addEventListener('pause', paintPlayer);
      v.addEventListener('timeupdate', () => { if (v === vid()) paintPosition(); });
      v.src = urlOf(p);
      return v;
    });
    stack.replaceChildren(...player.videos);
    $('#segments').innerHTML = list.map((p, i) => `<div class="seg${p.loop ? ' loop' : ''}" data-i="${i}"><i></i></div>`).join('');
    player.segs = [...$('#segments').children];
    player.fills = player.segs.map(el => el.firstChild);
    $('#timeline').classList.toggle('empty', !list.length);
    if (again) { part = 0; player.playing = true; }
    part = Math.min(part, Math.max(0, list.length - 1));
    if (list.length) goTo(part, 0, player.playing);
  }
  if (!list.length) {
    note.hidden = false;
    note.innerHTML = rendering().has(s.name)
      ? '<span class="spinner"></span>Rendering…'
      : 'No video yet<br>Press “Render” or ask Claude';
    paintTimeline();
    return;
  }
  note.hidden = true;
  paintTimeline();
}

// Moves a video to a moment. While it is still finding a frame, the newest request waits and
// replaces any older one, so scrubbing never piles up seeks.
function seekVideo(v, t) {
  if (!v) return;
  if (v.readyState < 1 || v.seeking) { wanted.set(v, t); return; }
  t = Math.max(0, Math.min(t, lengthOf(v) - 0.03));
  if (Math.abs(v.currentTime - t) > 0.004) v.currentTime = t;
}

// Goes to a moment of a pause, playing or not.
function goTo(i, offset = 0, play = player.playing) {
  const list = player.videos;
  if (!list.length) return;
  const next = Math.max(0, Math.min(i, list.length - 1));
  if (next !== part || !list[next].classList.contains('on')) {
    list[part]?.pause();
    list.forEach((x, j) => x.classList.toggle('on', j === next));
  }
  part = next;
  player.playing = play;
  const v = list[part];
  // A looping pause repeats only at the end of the slide, as when presenting; in the middle the
  // slide goes on.
  v.loop = !!pieces()[part]?.loop && part === list.length - 1;
  seekVideo(v, offset);
  if (play) v.play().catch(() => {}); else v.pause();
  // The next pause waits at its start, so the change is seamless.
  const after = list[part + 1];
  if (after && !after.seeking && after.currentTime > 0.004 && after.readyState >= 1) after.currentTime = 0;
  paintPlayer();
}

function seek(t, play = player.playing) {
  const segs = layout();
  if (!segs.length) return;
  t = Math.max(0, Math.min(t, totalTime(segs)));
  let i = segs.findIndex(s => t < s.start + s.dur);
  if (i < 0) i = segs.length - 1;
  goTo(i, t - segs[i].start, play);
}

function onEnded(i) {
  if (i !== part) return;
  if (player.playing && part < player.videos.length - 1) goTo(part + 1, 0, true);
  else { player.playing = false; paintPlayer(); }
}

function togglePlay() {
  const v = vid();
  if (!v) return;
  if (!v.paused && !v.ended) { player.playing = false; v.pause(); }
  else if (v.ended || v.currentTime >= lengthOf(v) - 0.05) {
    // Stopped at the end of a pause: on to the next one, or from the start after the last.
    goTo(part < player.videos.length - 1 ? part + 1 : 0, 0, true);
  } else { player.playing = true; v.play().catch(() => {}); }
  paintPlayer();
}

// Like a music player: “previous” goes back to the start of this pause, or to the one before if
// it has just started.
function prevPause() {
  const v = vid();
  if (v) goTo(v.currentTime > 0.6 ? part : part - 1, 0, true);
}
function nextPause() {
  if (part < player.videos.length - 1) goTo(part + 1, 0, true);
}

function wirePlayer() {
  const tl = $('#timeline'), tip = $('#tl-tip');
  releaseVideos();
  player.drag = null;
  player.playing = true;
  new ResizeObserver(() => { player.rects = null; measureTimeline(); paintPosition(); }).observe(tl);

  // The pieces' places on screen, read once when the pointer arrives instead of on every move.
  const rects = () => (player.rects ||= {tl: tl.getBoundingClientRect(), segs: player.segs.map(el => el.getBoundingClientRect())});
  // The moment under the pointer: in a mark between two pieces, the start of the next one.
  const at = e => {
    const r = rects().segs, segs = layout();
    for (let i = 0; i < r.length; i++) {
      if (e.clientX < r[i].right || i === r.length - 1) {
        const f = Math.max(0, Math.min(1, (e.clientX - r[i].left) / r[i].width));
        return {i, f, offset: f * segs[i].dur, t: segs[i].start + f * segs[i].dur};
      }
    }
    return null;
  };
  const scrub = p => {
    player.drag.at = p;
    if (p.i !== part) goTo(p.i, p.offset, false);
    else seekVideo(vid(), p.offset);
    paintPosition();
  };
  tl.addEventListener('pointerenter', () => { player.rects = null; });
  tl.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !player.videos.length) return;
    e.preventDefault();
    player.rects = null;
    tl.focus({preventScroll: true});
    tl.setPointerCapture(e.pointerId);
    const v = vid();
    player.drag = {wasPlaying: !!v && !v.paused && !v.ended, at: null};
    v?.pause();
    tl.classList.add('dragging');
    const p = at(e);
    if (p) scrub(p);
  });
  tl.addEventListener('pointermove', e => {
    const p = player.videos.length && at(e);
    if (!p) return;
    tip.hidden = false;
    tip.innerHTML = `<b>Pause ${p.i + 1}</b>${timecode(p.t)}`;
    tip.style.transform = `translateX(${e.clientX - rects().tl.left}px) translateX(-50%)`;
    if (player.drag) scrub(p);
  });
  const release = () => {
    if (!player.drag) return;
    const resume = player.drag.wasPlaying;
    player.drag = null;
    tl.classList.remove('dragging');
    if (resume) { player.playing = true; vid()?.play().catch(() => {}); }
    paintPlayer();
  };
  tl.addEventListener('pointerup', release);
  tl.addEventListener('lostpointercapture', release);
  tl.addEventListener('pointerleave', () => { if (!player.drag) tip.hidden = true; });
  // With the timeline focused: ← → move a second (with Shift, a tenth), Home and End.
  tl.addEventListener('keydown', e => {
    const segs = layout(), now = (segs[part]?.start || 0) + (vid()?.currentTime || 0);
    const step = {ArrowLeft: -1, ArrowRight: 1}[e.key];
    if (step) seek(now + step * (e.shiftKey ? 0.1 : 1));
    else if (e.key === 'Home') seek(0);
    else if (e.key === 'End') seek(totalTime(segs) - 0.05);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
}

// The pieces' widths follow their lengths; their positions are measured here, not every frame.
function measureTimeline() {
  player.geometry = player.segs.map(el => ({left: el.offsetLeft, width: el.offsetWidth}));
}

function paintTimeline() {
  const segs = layout();
  player.segs.forEach((el, i) => { el.style.flexGrow = segs[i]?.dur ?? 1; });
  player.rects = null;
  measureTimeline();
  paintPlayer();
}

function paintPlayer() {
  const b = $('#p-play');
  if (!b) return;
  const v = vid(), n = player.videos.length;
  const playing = !!v && !v.paused && !v.ended;
  const atEnd = !!v && v.ended && part >= n - 1;
  const label = playing ? 'Pause' : atEnd ? 'Play again' : 'Play';
  if (b.dataset.label !== label) {
    b.dataset.label = label;
    b.innerHTML = icon(playing ? 'pause' : atEnd ? 'again' : 'play');
    b.setAttribute('aria-label', label);
    b.title = `${label} (Space)`;
  }
  b.disabled = !n;
  $('#p-prev').disabled = !n;
  $('#p-next').disabled = !n || part >= n - 1;
  $('#v-pauses').innerHTML = n
    ? `Pause ${part + 1} of ${n}${pieces()[part]?.loop ? '<span class="tag" title="This pause loops when presenting">loops</span>' : ''}`
    : '';
  paintPosition(true);
}

// While it plays, the playhead follows every frame instead of the four updates per second of
// the video. Only transforms change, so the page is not laid out again.
function tick() {
  player.frame = null;
  const v = vid();
  if (!v || v.paused || v.ended || document.hidden || !v.isConnected) return;
  // paintPosition asks for the next frame: asking here too doubled the callbacks on every frame.
  paintPosition();
}

function paintPosition(full = false) {
  const tl = $('#timeline');
  if (!tl) return;
  const v = vid(), segs = layout(), g = player.geometry;
  // While dragging, the playhead stays under the pointer even before the frame is found.
  const drag = player.drag?.at;
  const i = drag ? drag.i : part;
  const inside = drag ? drag.f : v ? Math.min(1, v.currentTime / (segs[i]?.dur || 1)) : 0;
  player.fills.forEach((el, j) => { el.style.transform = `scaleX(${j < i ? 1 : j > i ? 0 : inside})`; });
  const head = $('#playhead');
  head.hidden = !g[i];
  if (g[i]) head.style.transform = `translateX(${g[i].left + inside * g[i].width}px)`;
  const t = (segs[i]?.start || 0) + inside * (segs[i]?.dur || 0), all = totalTime(segs);
  const text = segs.length ? `${timecode(t)} / ${known() ? timecode(all) : '…'}` : '';
  const time = $('#v-time');
  if (time.textContent !== text) time.textContent = text;
  // Screen readers get the position a few times per second, not every frame.
  const now = performance.now();
  if (full || now - player.ariaAt > 250) {
    player.ariaAt = now;
    player.segs.forEach((el, j) => el.classList.toggle('current', j === i));
    tl.setAttribute('aria-valuemax', all.toFixed(1));
    tl.setAttribute('aria-valuenow', t.toFixed(1));
    tl.setAttribute('aria-valuetext', segs.length ? `${timecode(t)} of ${timecode(all)}, pause ${i + 1} of ${segs.length}` : 'No video');
  }
  if (v && !v.paused && !v.ended && !player.frame && !document.hidden) player.frame = requestAnimationFrame(tick);
}

// ───────────── editing the talk ─────────────
// Runs a studio.py order, refreshes and leaves selected the slide that `then` says.
async function edit(args, then) {
  const r = await invoke('edit', {talk, args});
  await refresh();
  const s = then ? data.slides.find(then) : null;
  if (s) select(key(s));
  return r;
}
const attempt = promise => promise.then(r => r && toast(r)).catch(e => toast(String(e)));

function moveSlide(s, after) {
  const args = ['move', '--line', String(s.line), ...(after ? ['--after', after.name] : ['--first'])];
  attempt(edit(args, x => x.active && x.name === s.name));
}

function moveBy(s, step) {
  const a = actives(), i = a.indexOf(s), j = i + step;
  if (i < 0 || j < 0 || j >= a.length) return;
  moveSlide(s, step < 0 ? a[j - 1] ?? null : a[j]);
}

function startRename() {
  const s = current();
  if (!s?.active || !$('#v-name')) return;
  mode = 'rename';
  const before = s.method.replace(/^slide_/, '');
  $('#v-name').innerHTML = `<input type="text" id="v-new-name" value="${esc(before)}" aria-label="New name">`;
  const field = $('#v-new-name');
  field.focus(); field.select();
  const finish = () => { mode = 'view'; paintViewer(false); };
  field.onkeydown = e => {
    if (e.key === 'Escape') { e.preventDefault(); finish(); }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const fresh = field.value.trim();
    if (!toName(fresh) || toName(fresh) === before) { finish(); return; }
    const repeated = actives().filter(x => x.method === s.method).length > 1;
    mode = 'view';
    attempt(edit(['rename', '--line', String(s.line), '--', fresh], x => x.line === s.line)
      .then(r => repeated ? `${r}, together with its repetitions` : r));
  };
  field.onblur = () => setTimeout(() => { if (mode === 'rename') finish(); }, 120);
}

function deleteSlide(s) {
  if (!confirm(`Delete ${s.name}? It leaves the talk, its videos are deleted, and its file goes to the recycle bin if nothing else uses it`)) return;
  const pos = s.pos;
  attempt(edit(['delete', '--line', String(s.line)], x => x.active && pos && (x.pos === pos || x.pos === pos - 1)));
}

function setResolution(s, value) {
  if (!s) return;
  attempt(edit(['resolution', '--line', String(s.line), '--', value || 'default'], x => x.line === s.line));
}

// The menu of a slide: with the “⋯” button of the viewer or right click in the list.
function openSlideMenu(s, x, y) {
  const m = $('#slide-menu');
  const a = actives(), i = a.indexOf(s);
  const items = s.active ? [
    ['rename', 'pencil', 'Rename'],
    ['up', 'up', 'Move up', i <= 0],
    ['down', 'down', 'Move down', i >= a.length - 1],
    null,
    ['new', 'plus', 'New slide after this one'],
    ['delete', 'trash', 'Delete…', false, 'danger'],
  ] : [
    ['restore', 'again', 'Put it back'],
    ['delete', 'trash', 'Delete…', false, 'danger'],
  ];
  m.innerHTML = items.map(it => it
    ? `<button role="menuitem" data-a="${it[0]}" class="${it[4] || ''}" ${it[3] ? 'disabled' : ''}>${icon(it[1])}${it[2]}</button>`
    : '<hr>').join('');
  m.dataset.k = key(s);
  placeMenu(m, x, y);
  m.querySelector('button:not(:disabled)')?.focus();
}
const closeSlideMenu = () => { $('#slide-menu').hidden = true; };

function placeMenu(m, x, y) {
  m.hidden = false;
  m.style.left = Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - m.offsetHeight - 8)) + 'px';
}

function slideAction(action, s) {
  const actions = {
    rename: () => { if (sel !== key(s)) select(key(s)); startRename(); },
    up: () => moveBy(s, -1),
    down: () => moveBy(s, 1),
    new: () => { if (sel !== key(s)) select(key(s)); mode = 'new'; paintViewer(true); },
    restore: () => attempt(edit(['restore', '--line', String(s.line)], x => x.line === s.line)),
    delete: () => deleteSlide(s),
  };
  actions[action]?.();
}

// ───────────── jobs ─────────────
// The engine names the slide it draws; the bar shows its number in the list and how far the render
// is: “Slide 41” and a small progress bar with “3 of 93”.
function jobDetail(j) {
  const last = j.log.at(-1) || 'Starting…';
  const m = /^(drawing|saved) /.test(last) && [...j.log].reverse().map(l => /^drawing (\S+) \((\d+)\/(\d+)\)/.exec(l)).find(Boolean);
  if (!m) return `<span class="detail">${esc(last)}</span>`;
  const pos = j.talk === talk ? data?.slides.find(x => x.active && x.name === m[1])?.pos : null;
  return `${pos ? `<span class="detail">Slide ${pos}</span>` : ''}<span class="detail steps"><span class="progress" aria-hidden="true"><i style="width:${m[2] / m[3] * 100}%"></i></span>${m[2]} of ${m[3]}</span>`;
}

function paintJobs() {
  const live = jobs.find(j => j.status === 'running');
  const queued = jobs.filter(j => j.status === 'queued').length;
  const last = [...jobs].reverse().find(j => ['ok', 'error', 'cancelled'].includes(j.status));
  let html;
  if (live) {
    html = `<span class="spinner"></span><span class="text"><b>${esc(live.title)}</b>${jobDetail(live)}${queued ? `<span class="detail">${queued} queued</span>` : ''}</span>
      <button class="btn subtle" data-cancel="${live.id}">${icon('x')}Cancel</button>`;
  } else if (last) {
    const mark = {ok: `<span class="ok">${icon('check')}</span>`, error: `<span class="fail">${icon('x')}</span>`, cancelled: `<span class="detail">${icon('x')}</span>`}[last.status];
    html = `${mark}<span class="text"><b>${esc(last.title)}</b><span class="detail">${esc([...last.log].reverse()[0] || '')}</span></span>`;
  } else {
    html = '<span class="detail">No jobs running, renders and exports show up here</span>';
  }
  $('#job').innerHTML = html;
  if ($('#log').classList.contains('open')) paintLog();
  let ended = false;
  for (const j of jobs) {
    const before = statusBefore[j.id];
    if (before && before !== j.status && ['ok', 'error'].includes(j.status)) {
      ended = true;
      if (j.status === 'error') toast(`Failed: ${j.title}, the details are in the log`, ['Open log', openLog]);
      else if (j.title.includes('xport')) toast(`Done: ${j.title}`, ['Open folder', () => invoke('open_exported', {talk: j.talk})]);
      else if (!j.title.startsWith('Claude')) toast(`Done: ${j.title}`);
    }
    statusBefore[j.id] = j.status;
  }
  if (data && ended) { listSig = ''; refresh().catch(() => {}); }
  else if (data && live) refreshSoon();
  schedule();
}

function paintLog() {
  $('#log').innerHTML = jobs.length
    ? [...jobs].reverse().map(j => `<h3>${esc(j.title)}<span class="tag">${esc(j.status)}</span></h3>${esc(j.log.join('\n'))}`).join('')
    : 'No jobs yet';
}

function openLog(open = true) {
  $('#log').classList.toggle('open', open);
  $('#show-log').setAttribute('aria-expanded', open);
  if (open) paintLog();
}

let toastClock = null;
function toast(text, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(String(text).replace(/^Error: /, ''))}</span>${action ? `<button>${esc(action[0])}</button>` : ''}`;
  if (action) t.querySelector('button').onclick = () => { t.classList.remove('visible'); action[1](); };
  t.classList.add('visible');
  clearTimeout(toastClock);
  toastClock = setTimeout(() => t.classList.remove('visible'), action ? 9000 : 3500);
}

async function act(promise, text) {
  try { await promise; if (text) toast(text); await refresh(); }
  catch (e) { toast(String(e)); }
}

// ───────────── Claude ─────────────
// Claude Code runs headless behind this chat (stream-json in and out). Every line it prints
// arrives as a “claude-event”; the chat draws it, and answers permission requests and questions
// with control responses. Claude always works in auto mode: there is no mode picker.
const chat = {
  generation: 0, alive: false, running: false, starting: null,
  sessionId: null, title: '', init: null, modelId: '',
  model: stored('studio.model', /^[A-Za-z0-9._:\[\]][A-Za-z0-9._:\[\]-]{0,79}$/),
  effort: stored('studio.effort', /^(low|medium|high|xhigh|max)$/),
  requests: new Map(), nextRequest: 0,
  live: new Map(), streamed: new Set(), msgId: null,
  tools: new Map(), cards: new Map(), attachments: [],
  startedAt: 0, ticker: null, interrupted: false, stderr: [],
  // Every message of the conversation in order, with its id: “rewind” goes back to one of them.
  timeline: [], sentBubbles: [], msgEls: new Map(),
  fast: false, switchOnFlag: true, outputStyle: 'default',
  focus: load('studio.focus', '0') === '1',
  times: load('studio.times', '1') === '1',
  ctrlEnter: load('studio.ctrlEnter', '0') === '1',
  claudeInstalled: true,
};
const chatEl = $('#chat');
const input = $('#c-input');

function chatStart(info) {
  chat.claudeInstalled = !!info.claude;
  chatEl.classList.toggle('focus', chat.focus);
  chatEl.classList.toggle('no-times', !chat.times);
  paintToolbar();
  paintEmpty();
  if (!chat.claudeInstalled) {
    notice('Claude Code is not installed. Install it in PowerShell with: irm https://claude.ai/install.ps1 | iex', 'error');
    return;
  }
  startSession({}).catch(e => notice(String(e), 'error'));
}

async function startSession({resume = null, resumeSessionAt = null, forkSession = false} = {}) {
  chat.alive = false;
  chat.requests.forEach(r => r.reject(new Error('Claude restarted')));
  chat.requests.clear();
  const options = {resume, resumeSessionAt, forkSession, model: chat.model || null, permissionMode: 'auto', effort: chat.effort || null};
  const r = await invoke('claude_start', {options});
  chat.generation = r.generation;
  chat.alive = true;
  chat.sessionId = forkSession ? null : resume;
  chat.stderr = [];
  chat.starting = request('initialize').then(init => {
    chat.init = init;
    if (init.output_style) chat.outputStyle = init.output_style;
    chat.fast = init.fast_mode_state === 'on';
    paintToolbar();
    request('get_settings').then(s => { chat.switchOnFlag = s.effective?.switchModelsOnFlag ?? true; }).catch(() => {});
    return init;
  }).catch(e => { notice(`Claude did not start: ${e.message || e}`, 'error'); });
  return chat.starting;
}

function send(message) {
  return invoke('claude_send', {message});
}

function request(subtype, extra = {}) {
  const id = `studio-${++chat.nextRequest}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chat.requests.delete(id); reject(new Error('Claude did not answer')); }, 60000);
    chat.requests.set(id, {
      resolve: v => { clearTimeout(timer); resolve(v); },
      reject: e => { clearTimeout(timer); reject(e); },
    });
    send({type: 'control_request', request_id: id, request: {subtype, ...extra}}).catch(e => {
      clearTimeout(timer); chat.requests.delete(id); reject(e);
    });
  });
}

function respond(requestId, response) {
  return send({type: 'control_response', response: {subtype: 'success', request_id: requestId, response}});
}

// ── events from Claude ──
function onClaudeEvent({g, m}) {
  if (g !== chat.generation) return;
  switch (m.type) {
    case 'control_response': {
      const r = m.response || {}, waiting = chat.requests.get(r.request_id);
      if (!waiting) return;
      chat.requests.delete(r.request_id);
      r.subtype === 'error' ? waiting.reject(new Error(r.error || 'error')) : waiting.resolve(r.response || {});
      return;
    }
    case 'control_request': return onControlRequest(m);
    case 'control_cancel_request': return cancelCard(m.request_id);
    case 'system': return onSystem(m);
    case 'stream_event': return onStream(m);
    case 'assistant': return onAssistant(m);
    case 'user': return onUser(m);
    case 'result': return onResult(m);
    case 'rate_limit_event': return onRateLimit(m);
    case 'raw': chat.stderr.push(m.text); return;
  }
}

function onClaudeStderr({g, line}) {
  if (g !== chat.generation) return;
  chat.stderr.push(line);
  if (chat.stderr.length > 60) chat.stderr.shift();
}

function onClaudeExit({g, code}) {
  if (g !== chat.generation) return;
  chat.alive = false;
  setRunning(false);
  for (const [id] of chat.cards) cancelCard(id);
  const detail = chat.stderr.slice(-6).join('\n');
  const el = notice(`Claude stopped${code ? ` (code ${code})` : ''}${detail ? `\n${detail}` : ''}`, code ? 'error' : '');
  const b = document.createElement('button');
  b.className = 'btn small';
  b.innerHTML = `${icon('again')}Start again`;
  b.onclick = () => { b.disabled = true; startSession({resume: chat.sessionId}).catch(e => notice(String(e), 'error')); };
  el.append(b);
}

function onSystem(m) {
  if (m.subtype === 'init') {
    chat.sessionId = m.session_id || chat.sessionId;
    chat.modelId = m.model || chat.modelId;
    if (m.output_style) chat.outputStyle = m.output_style;
    if (m.fast_mode_state) chat.fast = m.fast_mode_state === 'on';
    if (m.plugins) chat.plugins = m.plugins;
    paintToolbar();
  } else if (m.subtype === 'status') {
    if (m.status === 'compacting') working('Compacting the conversation');
  } else if (m.subtype === 'compact_boundary') {
    notice('The conversation was compacted to free up context');
  } else if (m.subtype === 'thinking_tokens') {
    for (const l of chat.live.values()) if (l.kind === 'thinking') l.tokens = m.estimated_tokens;
  }
}

function onStream(m) {
  if (m.parent_tool_use_id) return subagentActivity(m.parent_tool_use_id);
  const ev = m.event || {};
  if (ev.type === 'message_start') {
    chat.msgId = ev.message?.id;
    if (chat.msgId) chat.streamed.add(chat.msgId);
    return;
  }
  const k = `${chat.msgId}:${ev.index}`;
  if (ev.type === 'content_block_start') {
    const b = ev.content_block || {};
    if (b.type === 'text') {
      const el = add(textBlock());
      chat.live.set(k, {kind: 'text', el, text: ''});
      if (!chat.msgEls.has(chat.msgId)) chat.msgEls.set(chat.msgId, []);
      chat.msgEls.get(chat.msgId).push(el);
    }
    else if (b.type === 'thinking') chat.live.set(k, {kind: 'thinking', el: addStep(thinkingRow()), text: '', started: Date.now()});
    else if (b.type === 'tool_use') { toolRow(b.id, b.name, null); chat.live.set(k, {kind: 'tool', id: b.id}); }
    return;
  }
  const l = chat.live.get(k);
  if (!l) return;
  if (ev.type === 'content_block_delta') {
    const d = ev.delta || {};
    if (d.type === 'text_delta') { l.text += d.text; paintText(l); }
    else if (d.type === 'thinking_delta') l.text += d.thinking || '';
  } else if (ev.type === 'content_block_stop') {
    if (l.kind === 'text') paintText(l, true);
    if (l.kind === 'thinking') finishThinking(l.el, l.text, Date.now() - l.started);
    chat.live.delete(k);
  }
}

function onAssistant(m) {
  if (m.parent_tool_use_id) return subagentActivity(m.parent_tool_use_id);
  const msg = m.message || {};
  if (m.uuid) chat.timeline.push({uuid: m.uuid, kind: 'assistant'});
  const streamed = !m.from_transcript && chat.streamed.has(msg.id);
  const blocks = typeof msg.content === 'string' ? [{type: 'text', text: msg.content}] : msg.content || [];
  for (const b of blocks) {
    if (b.type === 'tool_use') toolRow(b.id, b.name, b.input);
    else if (streamed) {
      // The text was already drawn while it streamed: it only gets its id, for bookmarks.
      if (b.type === 'text') for (const el of chat.msgEls.get(msg.id) || []) if (!el.dataset.uuid) { el.dataset.uuid = m.uuid; bookmarkButton(el); break; }
    } else if (b.type === 'text' && b.text?.trim()) {
      const el = add(textBlock());
      el.innerHTML = markdown(b.text);
      if (m.uuid) { el.dataset.uuid = m.uuid; bookmarkButton(el); }
    } else if (b.type === 'thinking' && b.thinking?.trim()) finishThinking(addStep(thinkingRow()), b.thinking, 0);
  }
}

// Messages without text blocks that we sent come back with their id (--replay-user-messages);
// tool results also arrive as user messages.
function onUser(m) {
  if (m.parent_tool_use_id) return;
  const content = m.message?.content;
  const blocks = typeof content === 'string' ? [{type: 'text', text: content}] : content || [];
  const results = blocks.filter(b => b.type === 'tool_result');
  for (const b of results) toolResult(b.tool_use_id, b.content, b.is_error);
  const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const typed = !results.length && !text.trim().startsWith('<');
  if (m.from_transcript) {
    const images = blocks.filter(b => b.type === 'image' && b.source?.data).map(b => ({kind: 'image', type: b.source.media_type, data: b.source.data}));
    const bubble = typed ? userText(text, images, m.timestamp) : null;
    if (m.uuid) chat.timeline.push({uuid: m.uuid, kind: bubble ? 'user' : 'tool', el: bubble});
    return;
  }
  if (typed && chat.sentBubbles.length) {
    const bubble = chat.sentBubbles.shift();
    bubble.dataset.uuid = m.uuid || '';
    chat.timeline.push({uuid: m.uuid, kind: 'user', el: bubble});
    return;
  }
  if (m.uuid) chat.timeline.push({uuid: m.uuid, kind: 'tool'});
  const local = text.match(/<local-command-(?:stdout|stderr)>([\s\S]*?)<\/local-command-(?:stdout|stderr)>/);
  if (local && local[1].trim()) notice(local[1].trim().replace(/`/g, ''));
}

function userText(text, images, timestamp) {
  const clean = String(text || '').split('\n').filter(l => !l.trim().startsWith('<')).join('\n').trim();
  if (!clean && !images.length) return null;
  const bubble = add(userBubble(clean, images));
  bubble.dataset.text = clean;
  if (timestamp) stamp(timestamp);
  return bubble;
}

function onResult(m) {
  setRunning(false);
  for (const t of chat.tools.values()) if (t.el.dataset.state === 'running') setToolState(t, 'stopped');
  if (chat.interrupted) notice('Interrupted');
  else if (m.is_error || (m.subtype && m.subtype !== 'success')) {
    const why = m.result || (m.errors || []).join('\n') || m.subtype;
    notice(String(why), 'error');
  }
  chat.interrupted = false;
  if (chat.times) stamp(new Date().toISOString(), 'left', m.duration_ms);
  refreshContext();
}

function onRateLimit(m) {
  const info = m.rate_limit_info || {};
  if (info.status === 'allowed') return;
  const when = info.resetsAt ? new Date(info.resetsAt * 1000).toLocaleTimeString('en', {hour: 'numeric', minute: '2-digit'}) : '';
  if (info.status === 'rejected') notice(`You reached your usage limit${when ? `, it resets at ${when}` : ''}`, 'error');
  else if (!chat.warnedLimit) { chat.warnedLimit = true; notice(`You are close to your usage limit${when ? `, it resets at ${when}` : ''}`, 'warn'); }
}

// ── permission requests, questions and plans ──
function onControlRequest(m) {
  const req = m.request || {};
  if (req.subtype !== 'can_use_tool') {
    send({type: 'control_response', response: {subtype: 'error', request_id: m.request_id, error: 'Not supported by ManimRS Studio'}});
    return;
  }
  if (req.tool_name === 'AskUserQuestion') return questionCard(m.request_id, req);
  if (req.tool_name === 'ExitPlanMode') return planCard(m.request_id, req);
  permissionCard(m.request_id, req);
}

function card(requestId, html) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = html;
  chat.cards.set(requestId, el);
  add(el, true);
  working('Waiting for your answer');
  return el;
}

function answered(requestId, text) {
  const el = chat.cards.get(requestId);
  chat.cards.delete(requestId);
  if (!el) return;
  el.className = 'card answered';
  el.textContent = text;
}

function cancelCard(requestId) {
  if (chat.cards.has(requestId)) answered(requestId, 'Not needed anymore');
}

function permissionCard(requestId, req) {
  const d = describe(req.tool_name, req.input);
  // A “setMode” suggestion would take Claude out of auto mode.
  const suggestions = (req.permission_suggestions || []).filter(s => s.type !== 'setMode');
  const always = suggestions.length ? 'Allow and don\'t ask again' : null;
  const why = req.decision_reason || (req.description !== req.input?.description ? req.description : '');
  const el = card(requestId, `
    <h4>${icon(d.icon)}Claude wants to ${esc(d.ask)}</h4>
    <div class="preview"></div>
    ${why ? `<div class="why">${esc(why)}</div>` : ''}
    <div class="actions">
      <button class="btn primary" data-a="allow">${icon('check')}Allow</button>
      ${always ? `<button class="btn" data-a="always">${esc(always)}</button>` : ''}
      <span class="spacer"></span>
      <button class="btn subtle" data-a="deny">${icon('x')}Deny</button>
    </div>
    <div class="feedback" hidden>
      <input type="text" placeholder="Tell Claude what to do instead (optional)">
      <button class="btn" data-a="deny-send">Deny</button>
    </div>`);
  el.querySelector('.preview').append(toolDetails(req.tool_name, req.input, null, true));
  el.onclick = async e => {
    const a = e.target.closest('button')?.dataset.a;
    if (!a) return;
    if (a === 'deny') { el.querySelector('.feedback').hidden = false; el.querySelector('.feedback input').focus(); return; }
    if (a === 'allow' || a === 'always') {
      const response = {behavior: 'allow', updatedInput: req.input};
      if (a === 'always') response.updatedPermissions = suggestions;
      await respond(requestId, response);
      answered(requestId, `Allowed: ${d.verb} ${d.target || ''}`.trim());
    } else if (a === 'deny-send') {
      const why = el.querySelector('.feedback input').value.trim();
      await respond(requestId, {behavior: 'deny', message: why || 'The user denied this action'});
      answered(requestId, `Denied: ${d.verb} ${d.target || ''}`.trim());
    }
  };
  el.querySelector('.feedback input').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); el.querySelector('[data-a="deny-send"]').click(); } };
  el.querySelector('[data-a="allow"]').focus({preventScroll: true});
}

function questionCard(requestId, req) {
  const questions = req.input?.questions || [];
  const chosen = questions.map(() => new Set());
  const el = card(requestId, `<h4>${icon('question')}Claude has ${questions.length === 1 ? 'a question' : 'some questions'}</h4>
    ${questions.map((q, i) => `<div class="question" data-q="${i}">
      ${q.header ? `<div class="q-head">${esc(q.header)}</div>` : ''}
      <div class="q-text">${esc(q.question)}</div>
      <div class="options">${(q.options || []).map((o, j) => `<button class="option" data-o="${j}"><span>${esc(o.label)}</span>${o.description ? `<small>${esc(o.description)}</small>` : ''}</button>`).join('')}</div>
      <input type="text" class="other" placeholder="Other answer (optional)">
    </div>`).join('')}
    <div class="actions"><button class="btn primary" data-a="send">${icon('send')}Send answers</button><span class="spacer"></span><button class="btn subtle" data-a="skip">Skip</button></div>`);
  el.onclick = async e => {
    const option = e.target.closest('.option');
    if (option) {
      const qi = Number(option.closest('.question').dataset.q), oi = Number(option.dataset.o);
      const set = chosen[qi];
      if (questions[qi].multiSelect) set.has(oi) ? set.delete(oi) : set.add(oi);
      else { set.clear(); set.add(oi); }
      option.closest('.options').querySelectorAll('.option').forEach((b, j) => b.classList.toggle('on', set.has(j)));
      if (questions.length === 1 && !questions[0].multiSelect) el.querySelector('[data-a="send"]').click();
      return;
    }
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'skip') {
      await respond(requestId, {behavior: 'deny', message: 'The user skipped the question'});
      answered(requestId, 'Question skipped');
    } else if (a === 'send') {
      const answers = {};
      questions.forEach((q, i) => {
        const other = el.querySelectorAll('.other')[i].value.trim();
        const labels = [...chosen[i]].map(j => q.options[j].label);
        if (other) labels.push(other);
        if (labels.length) answers[q.question] = labels.join(', ');
      });
      if (Object.keys(answers).length < questions.length) { toast('Answer every question, or skip'); return; }
      await respond(requestId, {behavior: 'allow', updatedInput: {...req.input, answers}});
      answered(requestId, Object.entries(answers).map(([q, a]) => `${q} ${a}`).join('\n'));
    }
  };
}

function planCard(requestId, req) {
  const el = card(requestId, `<h4>${icon('plan')}Claude's plan</h4>
    <div class="plan-body msg-text">${markdown(req.input?.plan || '')}</div>
    <div class="actions">
      <button class="btn primary" data-a="approve">${icon('check')}Approve</button>
      <span class="spacer"></span>
      <button class="btn subtle" data-a="keep">Keep planning</button>
    </div>
    <div class="feedback" hidden>
      <input type="text" placeholder="What should Claude change in the plan?">
      <button class="btn" data-a="keep-send">Send</button>
    </div>`);
  el.onclick = async e => {
    const a = e.target.closest('button')?.dataset.a;
    if (!a) return;
    if (a === 'keep') { el.querySelector('.feedback').hidden = false; el.querySelector('.feedback input').focus(); return; }
    if (a === 'approve') {
      await respond(requestId, {behavior: 'allow', updatedInput: req.input});
      answered(requestId, 'Plan approved');
      // Claude entered plan mode by itself: bring it back to auto mode.
      request('set_permission_mode', {mode: 'auto'}).catch(e => toast(`Could not go back to auto mode: ${e.message || e}`));
    } else if (a === 'keep-send') {
      const why = el.querySelector('.feedback input').value.trim();
      await respond(requestId, {behavior: 'deny', message: why || 'Keep planning'});
      answered(requestId, why ? `Keep planning: ${why}` : 'Keep planning');
    }
  };
}

// ── drawing the conversation ──
function nearBottom() {
  return chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 120;
}

// Adds an element at the end of the chat (before the “working” line) and follows it if the
// user was at the bottom.
function add(el, force = false) {
  $('#chat .c-empty')?.remove();
  const follow = force || nearBottom();
  const w = $('#working');
  w ? chatEl.insertBefore(el, w) : chatEl.append(el);
  if (follow) chatEl.scrollTop = chatEl.scrollHeight;
  return el;
}

// Claude's answers are Markdown. Whatever HTML they carry is cleaned: no forms or buttons that
// could pass for the app's own, no ids or classes that could take the place of its elements, no
// styles, and no images from the internet (an image link could carry data out without a click).
const MARKDOWN = {
  FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'option', 'iframe', 'object', 'embed', 'video', 'audio', 'source', 'svg', 'math'],
  FORBID_ATTR: ['id', 'class', 'style', 'name', 'srcset', 'action', 'formaction'],
  ALLOW_DATA_ATTR: false,
};
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'IMG' && !/^data:image\/(png|jpe?g|gif|webp);/i.test(node.getAttribute('src') || '')) {
    node.replaceWith(document.createTextNode(node.getAttribute('alt') || ''));
  } else if (node.tagName === 'INPUT') {
    node.setAttribute('disabled', '');
  } else if (node.tagName === 'A') {
    node.removeAttribute('target');
  }
});
function markdown(text) {
  try { return DOMPurify.sanitize(marked.parse(String(text || ''), {gfm: true, breaks: false, async: false}), MARKDOWN); }
  catch { return esc(text); }
}

function textBlock() {
  const el = document.createElement('div');
  el.className = 'msg-text';
  return el;
}

function paintText(l, final = false) {
  if (l.frame && !final) return;
  const draw = () => {
    l.frame = null;
    const follow = nearBottom();
    l.el.innerHTML = markdown(l.text);
    if (l.el.dataset.uuid) bookmarkButton(l.el);
    if (follow) chatEl.scrollTop = chatEl.scrollHeight;
  };
  if (final) { cancelAnimationFrame(l.frame); draw(); }
  else l.frame = requestAnimationFrame(draw);
}

// ── steps: thinking, tools and the short notes between them ──
// One stretch of work becomes one row that opens and closes, like in the Claude app:
// “Read 2 files, ran a command, and 3 more steps”, with the images Claude looked at.
const secs = ms => `${Math.max(1, Math.round(ms / 1000))} s`;

// What each kind of step says in the summary, for one and for several, most telling first.
const STEP_KINDS = [
  ['edit', 'edited a file', n => `edited ${n} files`],
  ['write', 'wrote a file', n => `wrote ${n} files`],
  ['render', 'rendered a slide', n => `rendered ${n} slides`],
  ['place', 'added a slide to the talk', n => `added ${n} slides to the talk`],
  ['view', 'looked at a slide', n => `looked at ${n} slides`],
  ['show', 'showed you a slide', n => `showed you ${n} slides`],
  ['export', 'exported the talk', n => `exported the talk ${n} times`],
  ['present', 'opened the presenter', n => `opened the presenter ${n} times`],
  ['talk', 'checked the talk', n => `checked the talk ${n} times`],
  ['run', 'ran a command', n => `ran ${n} commands`],
  ['read', 'read a file', n => `read ${n} files`],
  ['search', 'searched the files', n => `searched the files ${n} times`],
  ['web', 'searched the web', n => `searched the web ${n} times`],
  ['fetch', 'opened a web page', n => `opened ${n} web pages`],
  ['agent', 'started an agent', n => `started ${n} agents`],
  ['skill', 'used a skill', n => `used ${n} skills`],
  ['ask', 'asked you a question', n => `asked you ${n} questions`],
  ['plan', 'made a plan', n => `made ${n} plans`],
  ['tasks', 'updated the task list', n => `updated the task list ${n} times`],
  ['tool', 'used a tool', n => `used ${n} tools`],
];

function stepKind(name) {
  if (name.startsWith('mcp__studio__')) {
    const tool = name.slice(13);
    return ['render', 'place', 'view', 'show', 'export', 'present'].includes(tool) ? tool : 'talk';
  }
  return {Read: 'read', Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', Write: 'write', Bash: 'run', PowerShell: 'run',
    Glob: 'search', Grep: 'search', WebSearch: 'web', WebFetch: 'fetch', Task: 'agent', Agent: 'agent', Skill: 'skill',
    AskUserQuestion: 'ask', ExitPlanMode: 'plan', TodoWrite: 'tasks'}[name] || 'tool';
}

function addStep(el) {
  const g = stepGroup();
  const follow = nearBottom();
  g.querySelector('.steps-list').append(el);
  paintGroup(g);
  if (follow) chatEl.scrollTop = chatEl.scrollHeight;
  return el;
}

// The group at the end of the chat. A text between that group and the new step was a note
// between steps, so it goes inside; anything else (your message, a card) starts a new group.
function stepGroup() {
  const w = $('#working');
  let last = w ? w.previousElementSibling : chatEl.lastElementChild;
  const notes = [];
  while (last?.classList.contains('msg-text')) { notes.unshift(last); last = last.previousElementSibling; }
  if (!last?.classList.contains('steps')) {
    const g = document.createElement('details');
    g.className = 'steps';
    g.innerHTML = `<summary><span class="what"></span>${icon('right', 'chev')}<span class="thumbs"></span></summary><div class="steps-list"></div>`;
    return add(g);
  }
  const list = last.querySelector('.steps-list');
  for (const n of notes) {
    if (!n.textContent.trim()) { n.remove(); continue; }
    const row = document.createElement('div');
    row.className = 'step note';
    row.append(n);
    list.append(row);
  }
  return last;
}

function paintGroup(g) {
  const counts = new Map();
  let thought = 0;
  for (const r of g.querySelectorAll(':scope > .steps-list > .step[data-kind]')) {
    if (r.classList.contains('thinking-now')) continue;
    const c = counts.get(r.dataset.kind) || {steps: 0, units: 0};
    c.steps++;
    c.units += Number(r.dataset.n || 1);
    counts.set(r.dataset.kind, c);
    thought += Number(r.dataset.ms || 0);
  }
  const phrases = STEP_KINDS.filter(([k]) => counts.has(k)).map(([k, one, many]) => {
    const c = counts.get(k);
    return {steps: c.steps, text: c.units === 1 ? one : many(c.units)};
  });
  if (counts.has('think')) phrases.push({steps: counts.get('think').steps, text: thought ? `thought for ${secs(thought)}` : 'thought'});
  let text;
  if (!phrases.length) text = 'Thinking…';
  else if (phrases.length <= 3) text = phrases.length === 1 ? phrases[0].text
    : phrases.slice(0, -1).map(p => p.text).join(', ') + (phrases.length === 3 ? ', and ' : ' and ') + phrases.at(-1).text;
  else {
    const more = phrases.slice(2).reduce((n, p) => n + p.steps, 0);
    text = `${phrases[0].text}, ${phrases[1].text}, and ${more} more ${more === 1 ? 'step' : 'steps'}`;
  }
  g.querySelector(':scope > summary > .what').textContent = text[0].toUpperCase() + text.slice(1);
  const thumbs = [...g.querySelectorAll('.steps-list .step-thumb')].slice(-3).map(i => i.cloneNode());
  g.querySelector(':scope > summary > .thumbs').replaceChildren(...thumbs);
}

function repaintGroupOf(el) {
  const g = el.closest('.steps');
  if (g) paintGroup(g);
}

function thinkingRow() {
  const el = document.createElement('details');
  el.className = 'step plain thinking-now';
  el.dataset.kind = 'think';
  el.innerHTML = '<summary tabindex="-1"><span class="verb">Thinking…</span><span class="state"><span class="spinner"></span></span></summary>';
  return el;
}

function finishThinking(el, text, ms) {
  const has = !!text?.trim();
  el.classList.remove('thinking-now');
  el.classList.toggle('plain', !has);
  el.dataset.ms = ms || 0;
  el.innerHTML = `<summary${has ? '' : ' tabindex="-1"'}><span class="verb">${ms ? `Thought for ${secs(ms)}` : 'Thought'}</span>${has ? icon('right', 'chev') : ''}</summary>`
    + (has ? `<div class="thought">${esc(text)}</div>` : '');
  repaintGroupOf(el);
}

function userBubble(text, attachments) {
  const el = document.createElement('div');
  el.className = 'msg-user';
  const images = (attachments || []).filter(a => a.kind === 'image');
  const files = (attachments || []).filter(a => a.kind !== 'image');
  if (images.length) {
    const box = document.createElement('div');
    box.className = 'imgs';
    for (const im of images) {
      const img = document.createElement('img');
      img.src = `data:${im.type};base64,${im.data}`;
      img.alt = '';
      box.append(img);
    }
    el.append(box);
  }
  if (files.length) {
    const box = document.createElement('div');
    box.className = 'files';
    box.innerHTML = files.map(f => `<span>${icon('file')} ${esc(f.name)}</span>`).join('');
    el.append(box);
  }
  el.append(document.createTextNode(text));
  return el;
}

function stamp(iso, side = '', ms = 0) {
  const d = new Date(iso);
  if (isNaN(d)) return;
  const el = document.createElement('div');
  el.className = 'msg-time ' + side;
  el.textContent = d.toLocaleTimeString('en', {hour: 'numeric', minute: '2-digit'}) + (ms ? `, ${Math.max(1, Math.round(ms / 1000))} s` : '');
  add(el);
}

function notice(text, kind = '') {
  const el = document.createElement('div');
  el.className = 'notice ' + kind;
  el.textContent = text;
  return add(el, true);
}

function paintEmpty() {
  if (chatEl.children.length) return;
  chatEl.innerHTML = `<div class="c-empty">
    <h3>What should we change?</h3>
    <p class="c-lead">Pick a slide and tell Claude</p>
    <div class="suggestions">
      <button data-s="changes">Apply my review notes</button>
      <button data-s="look">Improve this slide</button>
      <button data-s="new">Add a slide after this one</button>
    </div></div>`;
}

// Relative path inside the talks folder, for showing tools.
function rel(p) {
  if (!p) return '';
  let s = String(p).replace(/\\/g, '/');
  const r = root.replace(/\\/g, '/').toLowerCase().replace(/\/$/, '');
  if (r && s.toLowerCase().startsWith(r + '/')) s = s.slice(r.length + 1);
  return s;
}
const firstLine = t => String(t || '').split('\n')[0].slice(0, 160);
const countLines = t => t ? String(t).split('\n').length : 0;

function describe(name, input) {
  const i = input || {};
  if (name.startsWith('mcp__studio__')) {
    const tool = name.slice(13);
    const what = [].concat(i.slides || i.slide || i.method || i.format || []).join(', ');
    const verb = {talks: 'List the talks', slides: 'List the slides', notes: 'Read your review notes', render: 'Render',
      view: 'Look at', show: 'Show you', place: 'Add to the talk', export: 'Export', present: 'Present'}[tool] || `Studio ${tool}`;
    return {icon: 'brand', verb, target: what, ask: `use the studio tool ${tool}${what ? ` on ${what}` : ''}`};
  }
  const file = rel(i.file_path || i.notebook_path);
  switch (name) {
    case 'Read': return {icon: 'file', verb: 'Read', target: file, ask: `read ${file}`};
    case 'Write': return {icon: 'pencil', verb: 'Write', target: file, ask: `write ${file}`};
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': {
      const edits = i.edits || [i];
      const plus = edits.reduce((n, e) => n + countLines(e.new_string ?? e.new_source), 0);
      const minus = edits.reduce((n, e) => n + countLines(e.old_string), 0);
      return {icon: 'pencil', verb: 'Edit', target: file, extra: `+${plus} −${minus}`, ask: `edit ${file}`};
    }
    case 'Bash': case 'PowerShell': return {icon: 'terminal', verb: 'Run', target: firstLine(i.command), ask: 'run a command'};
    case 'Glob': return {icon: 'search', verb: 'Find files', target: i.pattern, ask: `find files matching ${i.pattern}`};
    case 'Grep': return {icon: 'search', verb: 'Search', target: i.pattern, ask: `search for ${i.pattern}`};
    case 'WebFetch': return {icon: 'globe', verb: 'Fetch', target: i.url, ask: `fetch ${i.url}`};
    case 'WebSearch': return {icon: 'globe', verb: 'Search the web', target: i.query, ask: `search the web for ${i.query}`};
    case 'Task': case 'Agent': return {icon: 'agent', verb: 'Agent', target: i.description || i.subagent_type, ask: 'start an agent'};
    case 'Skill': return {icon: 'puzzle', verb: 'Skill', target: i.skill || i.command, ask: `use the skill ${i.skill || ''}`};
    case 'ToolSearch': return {icon: 'tool', verb: 'Load tools', target: i.query, ask: 'load more tools'};
    case 'TodoWrite': return {icon: 'log', verb: 'Update tasks', target: '', ask: 'update its task list'};
    case 'AskUserQuestion': return {icon: 'question', verb: 'Question', target: i.questions?.[0]?.question, ask: 'ask you something'};
    case 'ExitPlanMode': return {icon: 'plan', verb: 'Plan', target: 'ready for review', ask: 'start working on the plan'};
    default: {
      const short = name.replace(/^mcp__/, '').replace(/__/g, ' ');
      return {icon: 'tool', verb: short, target: '', ask: `use ${short}`};
    }
  }
}

function toolRow(id, name, input) {
  let t = chat.tools.get(id);
  if (!t) {
    const el = document.createElement('details');
    el.className = 'step tool';
    el.dataset.state = 'running';
    t = {el, name, input: input || {}, result: null, error: false, sub: 0};
    chat.tools.set(id, t);
    el.addEventListener('toggle', () => { if (el.open) paintToolBody(t); });
    addStep(el);
  } else if (input) {
    t.input = input;
  }
  const d = describe(name, t.input);
  // A command says what it is for when Claude wrote that down.
  const said = ['Bash', 'PowerShell'].includes(name) && t.input.description;
  const verb = said || d.verb, target = said ? '' : d.target || '';
  const code = ['Bash', 'PowerShell', 'Grep', 'Glob'].includes(name);
  t.el.dataset.kind = stepKind(name);
  t.el.dataset.n = name === 'mcp__studio__render' ? t.input.slides?.length || 1 : 1;
  t.el.innerHTML = `<summary><span class="verb">${esc(verb)}</span>${target ? `<span class="target${code ? ' code' : ''}">${esc(target)}</span>` : ''}${d.extra ? `<span class="extra">${esc(d.extra)}</span>` : ''}${icon('right', 'chev')}<span class="state"></span></summary><div class="tool-body"></div>`;
  setToolState(t, t.el.dataset.state);
  paintThumb(t);
  if (t.el.open) paintToolBody(t);
  repaintGroupOf(t.el);
  if (chat.running) working(`${verb}${target ? ' ' + target : ''}`);
  return t;
}

function setToolState(t, state) {
  t.el.dataset.state = state;
  t.el.classList.toggle('done', state === 'done');
  t.el.classList.toggle('failed', state === 'failed');
  const s = t.el.querySelector('.state');
  if (!s) return;
  const sub = t.sub ? `<span>${t.sub} steps</span>` : '';
  s.innerHTML = sub + ({running: '<span class="spinner"></span>', failed: icon('x'), stopped: '<span>stopped</span>'}[state] || '');
}

// The first image a tool answered with (a slide Claude looked at, a picture it read), small,
// at the end of its row and of its group.
function paintThumb(t) {
  const head = t.el.querySelector(':scope > summary');
  head.querySelector('.step-thumb')?.remove();
  const im = Array.isArray(t.result) && t.result.find(p => p.type === 'image' && p.source?.data);
  if (!im) return;
  const img = document.createElement('img');
  img.className = 'step-thumb';
  img.alt = '';
  img.src = `data:${im.source.media_type};base64,${im.source.data}`;
  head.append(img);
}

function toolResult(id, content, isError) {
  const t = chat.tools.get(id);
  if (!t) return;
  t.result = content;
  t.error = !!isError;
  setToolState(t, isError ? 'failed' : 'done');
  paintThumb(t);
  repaintGroupOf(t.el);
  if (t.el.open) paintToolBody(t);
}

function subagentActivity(parentId) {
  const t = chat.tools.get(parentId);
  if (!t) return;
  t.sub++;
  if (t.sub % 3 === 1) setToolState(t, t.el.dataset.state);
}

function paintToolBody(t) {
  const body = t.el.querySelector('.tool-body');
  body.replaceChildren(toolDetails(t.name, t.input, t.result, false, t.error));
}

// What a tool does and what it answered: a diff for edits, the command for commands, the text
// for the rest.
function toolDetails(name, input, result, preview = false, isError = false) {
  const frag = document.createDocumentFragment();
  const i = input || {};
  const block = (label, text) => {
    if (text == null || text === '') return;
    if (label) { const l = document.createElement('div'); l.className = 'label'; l.textContent = label; frag.append(l); }
    const pre = document.createElement('pre');
    const lines = String(text).split('\n');
    pre.textContent = lines.length > 80 ? lines.slice(0, 80).join('\n') + `\n… ${lines.length - 80} more lines` : String(text);
    frag.append(pre);
  };
  if (['Edit', 'MultiEdit'].includes(name)) {
    const diff = document.createElement('div');
    diff.className = 'diff';
    diff.innerHTML = `<div class="file">${esc(rel(i.file_path))}</div>` + (i.edits || [i]).map(e =>
      String(e.old_string ?? '').split('\n').map(l => `<div class="del">- ${esc(l)}</div>`).join('') +
      String(e.new_string ?? '').split('\n').map(l => `<div class="add">+ ${esc(l)}</div>`).join('')).join('<div>⋯</div>');
    frag.append(diff);
  } else if (name === 'Write') {
    block(rel(i.file_path), i.content);
  } else if (name === 'Bash' || name === 'PowerShell') {
    block(i.description || 'Command', i.command);
  } else if (!preview || Object.keys(i).length) {
    const shown = Object.keys(i).length ? JSON.stringify(i, null, 2) : '';
    if (shown && shown.length < 4000) block('Input', shown);
  }
  if (result != null && !preview) {
    const parts = typeof result === 'string' ? [{type: 'text', text: result}] : result;
    const text = parts.filter(p => p.type === 'text').map(p => p.text).join('\n');
    block(isError ? 'Error' : 'Result', text);
    for (const p of parts.filter(p => p.type === 'image' && p.source?.data)) {
      const img = document.createElement('img');
      img.src = `data:${p.source.media_type};base64,${p.source.data}`;
      img.alt = '';
      frag.append(img);
    }
  }
  return frag;
}

// ── turn state ──
function setRunning(on) {
  chat.running = on;
  clearInterval(chat.ticker);
  $('#working')?.remove();
  if (on) {
    chat.startedAt = Date.now();
    working('Working');
    chat.ticker = setInterval(() => {
      const w = $('#working .elapsed');
      if (w) w.textContent = `${Math.round((Date.now() - chat.startedAt) / 1000)} s`;
    }, 1000);
  }
  paintSend();
}

function working(text) {
  if (!chat.running) return;
  let w = $('#working');
  if (!w) {
    w = document.createElement('div');
    w.id = 'working';
    w.className = 'working';
    w.innerHTML = `<span class="spinner"></span><span class="what"></span><span class="hint elapsed"></span>`;
    const follow = nearBottom();
    chatEl.append(w);
    if (follow) chatEl.scrollTop = chatEl.scrollHeight;
  }
  w.querySelector('.what').textContent = text + '…';
}

function paintSend() {
  const b = $('#c-send');
  const stop = chat.running && !input.value.trim() && !chat.attachments.length;
  b.classList.toggle('stop', stop);
  b.innerHTML = icon(stop ? 'stop' : 'arrow-up');
  b.setAttribute('aria-label', stop ? 'Stop' : 'Send');
  b.title = stop ? 'Stop (Esc)' : 'Send';
  b.disabled = !stop && !input.value.trim() && !chat.attachments.length;
}

// An attachment becomes the block the API understands: an image, a PDF document, or the text of
// the file.
function attachmentBlock(a) {
  if (a.kind === 'image') return {type: 'image', source: {type: 'base64', media_type: a.type, data: a.data}};
  if (a.kind === 'pdf') return {type: 'document', source: {type: 'base64', media_type: 'application/pdf', data: a.data}, title: a.name};
  return {type: 'text', text: `Attached file ${a.name}:\n\`\`\`\n${a.text}\n\`\`\``};
}

async function sendMessage(text = input.value.trim()) {
  const attachments = chat.attachments;
  if (!text && !attachments.length) return;
  if (!chat.alive) {
    try { await startSession({resume: chat.sessionId}); } catch (e) { notice(String(e), 'error'); return; }
  }
  await chat.starting;
  const content = attachments.map(attachmentBlock);
  if (text) content.push({type: 'text', text});
  const bubble = add(userBubble(text, attachments), true);
  bubble.dataset.text = text;
  chat.sentBubbles.push(bubble);
  if (chat.times) stamp(new Date().toISOString());
  chat.attachments = [];
  paintAttachments();
  input.value = '';
  autosize();
  hidePopover();
  if (!chat.title && text) {
    setTitle(text);
    request('generate_session_title', {description: text})
      .then(r => { const t = r.title || r.sessionTitle; if (t) setTitle(t); }).catch(() => {});
  }
  setRunning(true);
  try {
    await send({type: 'user', message: {role: 'user', content}});
  } catch (e) {
    setRunning(false);
    notice(String(e), 'error');
  }
}

function interrupt() {
  if (!chat.running) return;
  chat.interrupted = true;
  request('interrupt').catch(() => {});
}

function setTitle(text) {
  chat.title = String(text || '').replace(/\s+/g, ' ').slice(0, 80);
  $('#c-title').textContent = chat.title || 'New conversation';
}

async function refreshContext() {
  if (!chat.alive) return;
  try {
    const u = await request('get_context_usage');
    const pct = Math.min(100, Math.max(0, Math.round(u.percentage ?? (u.totalTokens / u.maxTokens * 100))));
    const c = $('#c-context');
    const r = 6, len = 2 * Math.PI * r;
    c.hidden = false;
    c.title = `${(u.totalTokens || 0).toLocaleString('en')} of ${(u.maxTokens || 0).toLocaleString('en')} tokens of context used`;
    c.innerHTML = `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="${r}" fill="none" stroke="var(--border-strong)" stroke-width="2.4"/><circle cx="8" cy="8" r="${r}" fill="none" stroke="${pct > 80 ? 'var(--warn)' : 'var(--accent)'}" stroke-width="2.4" stroke-dasharray="${len * pct / 100} ${len}" stroke-linecap="round"/></svg>${pct}%`;
  } catch {}
}

// ── toolbar: model and effort ──
function models() { return chat.init?.models || []; }
function currentModel() {
  const list = models();
  return list.find(m => m.value === chat.model) || list.find(m => m.resolvedModel === chat.modelId) || list[0];
}

function paintToolbar() {
  const model = currentModel();
  $('#c-model').innerHTML = `${esc(model ? (model.value === 'default' ? 'Default model' : model.displayName) : 'Model')}${icon('down', 'i-small')}`;
  const be = $('#c-effort');
  be.hidden = !(model?.supportsEffort);
  be.innerHTML = `${icon('gauge')}${esc(chat.effort ? `Effort ${chat.effort}` : 'Default effort')}`;
  paintSend();
}

function choiceMenu(anchor, items, onPick) {
  const m = $('#c-choice-menu');
  m.innerHTML = items.map((it, i) => it.head
    ? `<div class="menu-head">${esc(it.head)}</div>`
    : `<button role="menuitemradio" data-i="${i}" aria-checked="${!!it.on}"><span class="two-lines">${esc(it.label)}${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</span>${it.on ? `<span class="check">${icon('check')}</span>` : ''}</button>`).join('');
  m.onclick = e => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    m.hidden = true;
    onPick(items[Number(b.dataset.i)]);
  };
  const r = anchor.getBoundingClientRect();
  m.hidden = false;
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8)) + 'px';
  m.style.top = Math.max(8, r.top - m.offsetHeight - 6) + 'px';
}

$('#c-model').onclick = e => {
  e.stopPropagation();
  if (!models().length) { toast('Claude is still starting'); return; }
  const cur = currentModel();
  choiceMenu(e.currentTarget, [{head: 'Model'}, ...models().map(m => ({label: m.displayName, hint: m.description, value: m.value, on: m === cur}))],
    async it => {
      chat.model = it.value; save('studio.model', it.value);
      paintToolbar();
      if (chat.alive) {
        try { const r = await request('set_model', {model: it.value}); chat.modelId = r.model || chat.modelId; }
        catch (err) { toast(`Could not change the model: ${err.message || err}`); }
      }
      paintToolbar();
    });
};
$('#c-effort').onclick = e => {
  e.stopPropagation();
  const levels = currentModel()?.supportedEffortLevels || ['low', 'medium', 'high'];
  const hints = {low: 'Fastest, for simple tasks', medium: 'Balanced', high: 'More thorough', xhigh: 'Very thorough', max: 'The most thinking, slowest'};
  choiceMenu(e.currentTarget, [{head: 'Effort'}, ...levels.map(l => ({label: l, hint: hints[l], value: l, on: l === chat.effort}))],
    async it => {
      chat.effort = it.value; save('studio.effort', it.value);
      paintToolbar();
      if (chat.alive) {
        try { await request('apply_flag_settings', {settings: {effortLevel: it.value}}); }
        catch (err) { toast(`Could not change the effort: ${err.message || err}`); }
      }
    });
};

// ── composer: slash commands, @ mentions and images ──
let popover = {kind: null, items: [], index: 0, start: 0};

function autosize() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 220) + 'px';
  paintSend();
}

function hidePopover() { $('#c-popover').hidden = true; popover.kind = null; }

function paintPopover() {
  const p = $('#c-popover');
  if (!popover.items.length) {
    p.innerHTML = `<div class="none">${popover.kind === 'slash' ? 'No commands match' : 'No files match'}</div>`;
  } else {
    p.innerHTML = popover.items.map((it, i) => popover.kind === 'slash'
      ? `<button type="button" data-i="${i}" class="${i === popover.index ? 'on' : ''}"><span class="cmd">/${esc(it.name)}${it.argumentHint ? `<em>${esc(it.argumentHint)}</em>` : ''}</span>${it.description ? `<small>${esc(it.description)}</small>` : ''}</button>`
      : `<button type="button" data-i="${i}" class="${i === popover.index ? 'on' : ''}"><span class="cmd">${esc(it)}</span></button>`).join('');
  }
  p.hidden = false;
  p.querySelector('.on')?.scrollIntoView({block: 'nearest'});
}

let mentionClock = null;
function updatePopover() {
  const before = input.value.slice(0, input.selectionStart);
  const slash = input.value.match(/^\/(\S*)$/);
  if (slash && before.length === input.value.length) {
    const q = slash[1].toLowerCase();
    const commands = chat.init?.commands || [];
    popover = {kind: 'slash', start: 0, index: 0,
      items: commands.filter(c => c.name.toLowerCase().includes(q))
        .sort((a, b) => (b.name.toLowerCase().startsWith(q)) - (a.name.toLowerCase().startsWith(q))).slice(0, 40)};
    paintPopover();
    return;
  }
  const mention = before.match(/(^|\s)@([^\s@]*)$/);
  if (mention) {
    const start = before.length - mention[2].length - 1;
    clearTimeout(mentionClock);
    mentionClock = setTimeout(async () => {
      const items = await invoke('find_files', {query: mention[2], talk: talk || null}).catch(() => []);
      popover = {kind: 'mention', start, index: 0, items};
      paintPopover();
    }, 120);
    return;
  }
  hidePopover();
}

function pickPopover(i = popover.index) {
  const it = popover.items[i];
  if (!it) return;
  if (popover.kind === 'slash') {
    input.value = `/${it.name} `;
  } else {
    const end = input.selectionStart;
    const path = /\s/.test(it) ? `"${it}"` : it;
    input.value = input.value.slice(0, popover.start) + `@${path} ` + input.value.slice(end);
    const caret = popover.start + path.length + 2;
    input.setSelectionRange(caret, caret);
  }
  hidePopover();
  input.focus();
  autosize();
}

$('#c-popover').onmousedown = e => {
  const b = e.target.closest('button[data-i]');
  if (b) { e.preventDefault(); pickPopover(Number(b.dataset.i)); }
};

input.addEventListener('input', () => { autosize(); updatePopover(); });
input.addEventListener('click', updatePopover);
input.addEventListener('blur', () => setTimeout(hidePopover, 150));
input.addEventListener('keydown', e => {
  if (!$('#c-popover').hidden && popover.items.length) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      popover.index = (popover.index + (e.key === 'ArrowDown' ? 1 : -1) + popover.items.length) % popover.items.length;
      paintPopover();
      return;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); pickPopover(); return; }
  }
  if (e.key === 'Escape') {
    if (!$('#c-popover').hidden) { hidePopover(); return; }
    if (chat.running) { e.preventDefault(); interrupt(); }
    return;
  }
  if (e.key === '/' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openPalette(); return; }
  if (e.key === 'Enter') {
    const sendKey = chat.ctrlEnter ? (e.ctrlKey || e.metaKey) : !e.shiftKey && !e.ctrlKey;
    if (sendKey) { e.preventDefault(); $('#composer').requestSubmit(); }
  }
});

$('#composer').onsubmit = e => {
  e.preventDefault();
  if (chat.running && !input.value.trim() && !chat.attachments.length) { interrupt(); return; }
  sendMessage();
};

function paintAttachments() {
  const box = $('#c-attachments');
  box.hidden = !chat.attachments.length;
  box.innerHTML = chat.attachments.map((a, i) => a.kind === 'image'
    ? `<span class="att"><img src="data:${a.type};base64,${a.data}" alt=""><button type="button" data-i="${i}" aria-label="Remove">${icon('x')}</button></span>`
    : `<span class="att file">${icon('file')}<span>${esc(a.name)}</span><button type="button" data-i="${i}" aria-label="Remove">${icon('x')}</button></span>`).join('');
  paintSend();
}
$('#c-attachments').onclick = e => {
  const b = e.target.closest('button[data-i]');
  if (b) { chat.attachments.splice(Number(b.dataset.i), 1); paintAttachments(); }
};

// An image or a PDF as an attachment in base64.
function readBase64(f, done) {
  if (f.size > 20e6) { toast(`${f.name || 'The file'} is too big, the limit is 20 MB`); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const [, type, data] = String(reader.result).match(/^data:([^;]+);base64,(.*)$/) || [];
    if (data) done({kind: type === 'application/pdf' ? 'pdf' : 'image', type, data, name: f.name || 'image'});
  };
  reader.readAsDataURL(f);
}

const TEXT_FILE = /\.(txt|md|py|js|ts|json|toml|yaml|yml|csv|html|css|rs|xml|ini|cfg|log|tex|sh|ps1|bat|cmd)$/i;
function addFiles(files) {
  for (const f of files) {
    const reader = new FileReader();
    if (f.type.startsWith('image/') || f.type === 'application/pdf') {
      readBase64(f, a => { chat.attachments.push(a); paintAttachments(); });
    } else if (f.type.startsWith('text/') || TEXT_FILE.test(f.name)) {
      if (f.size > 400e3) { toast(`${f.name} is too big to attach as text, mention it with @ instead`); continue; }
      reader.onload = () => { chat.attachments.push({kind: 'text', name: f.name, text: String(reader.result)}); paintAttachments(); };
      reader.readAsText(f);
    } else {
      toast(`${f.name} can't be attached, images, PDFs and text files can`);
    }
  }
}
// The review box takes images too: they go to Claude with the note.
function imagesOf(s) {
  const k = `${talk}/${s.name}`;
  if (!noteImages.has(k)) noteImages.set(k, []);
  return noteImages.get(k);
}
function paintNoteImages() {
  const s = current(), box = $('#r-images');
  if (!s || !box) return;
  const list = imagesOf(s);
  box.hidden = !list.length;
  box.innerHTML = list.map((a, i) => `<span class="att"><img src="data:${a.type};base64,${a.data}" alt=""><button type="button" data-i="${i}" aria-label="Remove image">${icon('x')}</button></span>`).join('');
}
function addNoteImages(files) {
  const s = current();
  if (!s || !files.length) return;
  const images = files.filter(f => f.type.startsWith('image/'));
  if (images.length < files.length) toast('Only images can go with a note');
  for (const f of images) readBase64(f, a => { imagesOf(s).push(a); paintNoteImages(); });
}
function wireNoteImages() {
  paintNoteImages();
  const review = $('#viewer .review');
  $('#r-file').onchange = e => { addNoteImages([...e.target.files]); e.target.value = ''; };
  $('#r-images').onclick = e => {
    const b = e.target.closest('button[data-i]');
    if (b) { imagesOf(current()).splice(Number(b.dataset.i), 1); paintNoteImages(); }
  };
  $('#note').onpaste = e => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addNoteImages(files); }
  };
  review.ondragover = e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); review.classList.add('drop'); } };
  review.ondragleave = () => review.classList.remove('drop');
  review.ondrop = e => { review.classList.remove('drop'); if (e.dataTransfer.files.length) { e.preventDefault(); addNoteImages([...e.dataTransfer.files]); } };
}

$('#c-attach').onclick = () => $('#c-file').click();
$('#c-file').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
input.addEventListener('paste', e => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addFiles(files); }
});
const box = $('.c-box');
box.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); box.classList.add('drop'); } });
box.addEventListener('dragleave', () => box.classList.remove('drop'));
box.addEventListener('drop', e => { box.classList.remove('drop'); if (e.dataTransfer.files.length) { e.preventDefault(); addFiles([...e.dataTransfer.files]); } });

// ── conversations: new, history and settings ──
async function newConversation() {
  if (chat.running && !confirm('Claude is still working, start a new conversation anyway?')) return;
  resetChat();
  try { await startSession({}); } catch (e) { notice(String(e), 'error'); }
}

function resetChat() {
  chat.live.clear(); chat.streamed.clear(); chat.tools.clear(); chat.cards.clear(); chat.msgEls.clear();
  chat.timeline = []; chat.sentBubbles = [];
  closeSheet();
  chat.sessionId = null; chat.interrupted = false; chat.warnedLimit = false;
  setRunning(false);
  setTitle('');
  chatEl.innerHTML = '';
  $('#c-context').hidden = true;
  paintEmpty();
}

async function resumeConversation(s) {
  if (chat.running && !confirm('Claude is still working, switch conversations anyway?')) return;
  resetChat();
  setTitle(s.title);
  chatEl.innerHTML = '';
  try {
    const entries = await invoke('claude_transcript', {id: s.id});
    for (const m of entries) (m.type === 'assistant' ? onAssistant : onUser)(m);
    for (const t of chat.tools.values()) if (t.el.dataset.state === 'running') setToolState(t, t.result ? 'done' : 'stopped');
  } catch (e) { notice(String(e), 'error'); }
  notice('Conversation resumed, Claude remembers everything above');
  chatEl.scrollTop = chatEl.scrollHeight;
  try { await startSession({resume: s.id}); refreshContext(); } catch (e) { notice(String(e), 'error'); }
}

function ago(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(ms).toLocaleDateString('en', {dateStyle: 'medium'});
}

$('#c-history').onclick = async e => {
  e.stopPropagation();
  const m = $('#c-history-menu');
  if (!m.hidden) { m.hidden = true; return; }
  m.innerHTML = '<div class="menu-foot">Loading…</div>';
  const r = e.currentTarget.getBoundingClientRect();
  m.hidden = false;
  m.style.top = r.bottom + 6 + 'px';
  m.style.left = Math.max(8, r.right - 380) + 'px';
  const list = await invoke('claude_sessions').catch(() => []);
  m.innerHTML = '<div class="menu-head">Past conversations</div>' + (list.length
    ? list.map((s, i) => `<button role="menuitem" data-i="${i}"><span class="two-lines">${esc(s.title)}<small>${ago(s.date)}</small></span>${s.id === chat.sessionId ? `<span class="check">${icon('check')}</span>` : ''}</button>`).join('')
    : '<div class="menu-foot">No conversations yet</div>');
  m.onclick = ev => {
    const b = ev.target.closest('button[data-i]');
    if (!b) return;
    m.hidden = true;
    const s = list[Number(b.dataset.i)];
    if (s.id !== chat.sessionId) resumeConversation(s);
  };
};

$('#c-new').onclick = () => newConversation();

$('#c-settings').onclick = e => {
  e.stopPropagation();
  const m = $('#c-settings-menu');
  if (!m.hidden) { m.hidden = true; return; }
  const acct = chat.init?.account;
  const items = [
    ['focus', 'Focus view', 'Hide tool calls and thinking, only messages', chat.focus],
    ['times', 'Show timestamps', 'When each message was sent', chat.times],
    ['ctrlEnter', 'Ctrl+Enter sends', 'Enter makes a new line instead', chat.ctrlEnter],
  ];
  m.innerHTML = '<div class="menu-head">Chat</div>' + items.map(([k, l, h, on]) =>
    `<button role="menuitemcheckbox" aria-checked="${on}" data-k="${k}"><span class="two-lines">${l}<small>${h}</small></span>${on ? `<span class="check">${icon('check')}</span>` : ''}</button>`).join('')
    + (acct || chat.init ? `<hr><div class="menu-foot">${acct ? `${esc(acct.subscriptionType || '')} ${esc(acct.email || '')}<br>` : ''}Claude Code ${esc(chat.init?.claude_code_version || '')}</div>` : '');
  const r = e.currentTarget.getBoundingClientRect();
  m.hidden = false;
  m.style.top = r.bottom + 6 + 'px';
  m.style.left = Math.max(8, r.right - m.offsetWidth) + 'px';
  m.onclick = ev => {
    const b = ev.target.closest('button[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    chat[k] = !chat[k];
    save(`studio.${k}`, chat[k] ? '1' : '0');
    chatEl.classList.toggle('focus', chat.focus);
    chatEl.classList.toggle('no-times', !chat.times);
    m.hidden = true;
  };
};

chatEl.addEventListener('click', e => {
  const a = e.target.closest('a[href]');
  if (a) {
    e.preventDefault();
    const url = a.getAttribute('href');
    if (/^https?:\/\//i.test(url)) invoke('open_link', {url}).catch(err => toast(String(err)));
    else toast('Only web links open from here');
    return;
  }
  const s = e.target.closest('.c-empty button[data-s]')?.dataset.s;
  if (!s) return;
  const slide = current()?.active ? current().name : '';
  if (s === 'changes') sendToClaude(`/slides ${talk}: apply the changes requested in the review panel (notes tool), one slide at a time`);
  else if (s === 'look') sendToClaude(`/slides ${talk} ${slide}: look at it with “view” and tell me what you would improve, don't change anything yet`);
  else if (s === 'new') { input.value = `/slides ${talk}: a new slide after ${slide} that explains `; autosize(); input.focus(); }
});

// ── actions palette (the “/” button): the same options as the Claude Code extension ──
async function ready() {
  if (!chat.alive) await startSession({resume: chat.sessionId});
  await chat.starting;
}
const openLink = url => invoke('open_link', {url}).catch(e => toast(String(e)));
const clean = v => String(v ?? '').replace(/ · /g, ', ');
const when = iso => new Date(iso).toLocaleString('en', {weekday: 'short', hour: 'numeric', minute: '2-digit'});
const duration = ms => !ms ? '0 s' : ms < 60000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60000)} min`;

function actions() {
  const model = currentModel();
  const list = [
    {section: 'Context', icon: 'clip', label: 'Attach file…', hint: 'Upload a file to include in the conversation', run: () => $('#c-file').click()},
    {section: 'Context', icon: 'file', label: 'Mention file from this project…', hint: 'Insert an @ reference to a file', run: () => insertAtCaret('@')},
    {section: 'Context', icon: 'plus', label: 'Clear conversation', hint: 'Start a new conversation', run: newConversation},
    {section: 'Context', icon: 'history', label: 'Resume conversation', hint: 'Continue a previous conversation', run: () => $('#c-history').click()},
    {section: 'Context', icon: 'rewind', label: 'Rewind', hint: 'Restore code and conversation to an earlier point', run: showRewind},
    {section: 'Context', icon: 'bookmark', label: 'Bookmarks', hint: 'Show your bookmarked answers', run: showBookmarks},
    {section: 'Context', icon: 'export', label: 'Export conversation', hint: 'Copy the conversation as plain text or save it to a file', run: showExport},
    {section: 'Context', icon: 'chat', label: 'Side question…', hint: 'Ask a quick question without interrupting the conversation', run: showSideQuestion},
    {section: 'Model', icon: 'switch', label: 'Switch model…', hint: 'Change the AI model', trailing: model?.displayName, run: () => $('#c-model').click()},
    {section: 'Model', icon: 'gauge', label: 'Effort', hint: 'How much Claude thinks before answering', trailing: chat.effort || 'default', run: () => $('#c-effort').click(), hidden: !model?.supportsEffort},
    {section: 'Model', icon: 'auto', label: 'Fast mode', hint: 'Faster answers from the same model', toggle: chat.fast, run: toggleFast, hidden: model && model.supportsFastMode === false},
    {section: 'Model', icon: 'switch', label: 'Switch models when a message is flagged', hint: 'When safeguards flag a message, switch to another model to keep chatting, when off the conversation pauses', toggle: chat.switchOnFlag, run: toggleSwitchOnFlag},
    {section: 'Model', icon: 'user', label: 'Account and usage…', hint: 'View account info and usage limits', run: showUsage},
    {section: 'Customize', icon: 'palette', label: 'Output styles', hint: 'Change how Claude formats its answers', trailing: chat.outputStyle, run: chooseOutputStyle},
    {section: 'Customize', icon: 'server', label: 'MCP servers', hint: 'See, reconnect, enable or disable MCP servers', run: showMcp},
    {section: 'Customize', icon: 'hook', label: 'Hooks', hint: 'View and edit hooks', run: showHooks},
    {section: 'Customize', icon: 'shield', label: 'Permissions', hint: 'View and edit permission rules', run: showPermissions},
    {section: 'Customize', icon: 'brain', label: 'Memory', hint: 'What Claude remembers about this folder', run: showMemory},
    {section: 'Customize', icon: 'doc', label: 'Instructions', hint: 'Edit CLAUDE.md files', run: showInstructions},
    {section: 'Customize', icon: 'puzzle', label: 'Plugins', hint: 'Install, enable or disable plugins', run: showPlugins},
    {section: 'Customize', icon: 'box', label: 'Sandbox', hint: 'How commands are sandboxed', run: showSandbox},
    {section: 'Settings', icon: 'info', label: 'Status', hint: 'Version, session, account, model and server details', run: showStatus},
    {section: 'Settings', icon: 'gear', label: 'Chat settings…', hint: 'Focus view, timestamps and how to send', run: () => $('#c-settings').click()},
    {section: 'Support', icon: 'help', label: 'View help docs', hint: 'Open the Claude Code documentation', run: () => openLink('https://code.claude.com/docs')},
    {section: 'Support', icon: 'bug', label: 'Report a problem', hint: 'Open the Claude Code issue tracker', run: () => openLink('https://github.com/anthropics/claude-code/issues')},
    {section: 'Support', icon: 'terminal', label: 'Open Claude in Terminal', hint: 'Continue this conversation in a terminal window', run: () => invoke('open_terminal', {session: chat.sessionId}).catch(e => toast(String(e)))},
  ];
  for (const c of chat.init?.commands || []) {
    list.push({section: 'Slash commands', label: `/${c.name}`, hint: c.description, mono: true,
      run: () => { input.value = `/${c.name} `; autosize(); input.focus(); }});
  }
  return list.filter(a => !a.hidden);
}

let palette = {items: [], index: 0};
function openPalette() {
  hidePopover();
  palette.index = 0;
  $('#c-palette').hidden = false;
  $('#c-palette-filter').value = '';
  paintPalette();
  $('#c-palette-filter').focus();
}
function closePalette() { $('#c-palette').hidden = true; }

function paintPalette() {
  const q = $('#c-palette-filter').value.trim().toLowerCase();
  palette.items = actions().filter(a => !q || `${a.label} ${a.hint || ''} ${a.section}`.toLowerCase().includes(q));
  palette.index = Math.min(palette.index, Math.max(0, palette.items.length - 1));
  let html = '', section = null;
  palette.items.forEach((a, i) => {
    if (a.section !== section) { section = a.section; html += `<div class="p-head">${esc(section)}</div>`; }
    const end = a.toggle !== undefined ? `<span class="switch ${a.toggle ? 'on' : ''}"></span>`
      : a.trailing ? `<span class="p-trailing">${esc(a.trailing)}</span>` : '';
    html += `<button type="button" class="p-item ${a.mono ? 'mono' : ''} ${i === palette.index ? 'on' : ''}" data-i="${i}">${a.icon ? icon(a.icon) : ''}<span class="p-text"><span class="p-label">${esc(a.label)}</span>${a.hint ? `<small>${esc(a.hint)}</small>` : ''}</span>${end}</button>`;
  });
  $('#c-palette-list').innerHTML = html || '<div class="p-head">No matching actions</div>';
  $('#c-palette-list .p-item.on')?.scrollIntoView({block: 'nearest'});
}

async function runAction(i) {
  const a = palette.items[i];
  if (!a) return;
  if (a.toggle !== undefined) { await a.run(); paintPalette(); return; }
  closePalette();
  a.run();
}

$('#c-actions').onclick = e => { e.stopPropagation(); $('#c-palette').hidden ? openPalette() : closePalette(); };
$('#c-palette-filter').oninput = () => { palette.index = 0; paintPalette(); };
$('#c-palette-filter').onkeydown = e => {
  const n = palette.items.length;
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) {
    e.preventDefault();
    palette.index = (palette.index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    paintPalette();
  } else if (e.key === 'Enter') { e.preventDefault(); runAction(palette.index); }
  else if (e.key === 'Escape') { e.preventDefault(); closePalette(); input.focus(); }
};
$('#c-palette-list').onmousedown = e => {
  const b = e.target.closest('.p-item');
  if (b) { e.preventDefault(); runAction(Number(b.dataset.i)); }
};

function insertAtCaret(text) {
  input.focus();
  const s = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? s;
  const t = s > 0 && !/\s/.test(input.value[s - 1]) ? ' ' + text : text;
  input.value = input.value.slice(0, s) + t + input.value.slice(end);
  input.setSelectionRange(s + t.length, s + t.length);
  autosize();
  updatePopover();
}

// The views of the actions open in a sheet over the conversation.
function openSheet(title, paint) {
  closePalette();
  $('#c-sheet-title').textContent = title;
  const body = $('#c-sheet-body');
  body.onclick = null;
  body.innerHTML = '<div class="hint">Loading…</div>';
  $('#c-sheet').hidden = false;
  Promise.resolve().then(() => paint(body)).catch(e => { body.innerHTML = `<div class="notice error">${esc(e.message || e)}</div>`; });
}
function closeSheet() { $('#c-sheet').hidden = true; }
$('#c-sheet-back').onclick = closeSheet;

async function toggleFast() {
  const on = !chat.fast;
  try { await ready(); await request('apply_flag_settings', {settings: {fastMode: on}}); chat.fast = on; toast(on ? 'Fast mode on' : 'Fast mode off'); }
  catch (e) { toast(`Could not change fast mode: ${e.message || e}`); }
}

async function toggleSwitchOnFlag() {
  const on = !chat.switchOnFlag;
  try { await ready(); await request('update_settings', {source: 'userSettings', settings: {switchModelsOnFlag: on}}); chat.switchOnFlag = on; }
  catch (e) { toast(String(e.message || e)); }
}

function chooseOutputStyle() {
  const styles = chat.init?.available_output_styles || ['default'];
  choiceMenu($('#c-actions'), [{head: 'Output style'}, ...styles.map(s => ({label: s === 'default' ? 'Default' : s, value: s, on: s === chat.outputStyle}))],
    async it => {
      try { await ready(); await request('apply_flag_settings', {settings: {outputStyle: it.value}}); chat.outputStyle = it.value; toast(`Output style: ${it.label}`); }
      catch (e) { toast(String(e.message || e)); }
    });
}

function showUsage() {
  openSheet('Account and usage', async body => {
    await ready();
    const u = await request('get_usage');
    const acct = chat.init?.account || {};
    const names = {five_hour: 'Current session, 5 hours', seven_day: 'This week', seven_day_opus: 'This week, Opus', seven_day_sonnet: 'This week, Sonnet'};
    const limits = Object.entries(u.rate_limits || {}).filter(([, v]) => v && typeof v === 'object' && v.utilization != null);
    const s = u.session || {};
    body.innerHTML = `<h5>Account</h5><dl class="kv"><dt>Email</dt><dd>${esc(acct.email || '')}</dd><dt>Plan</dt><dd>${esc(acct.subscriptionType || u.subscription_type || '')}</dd><dt>Organization</dt><dd>${esc(acct.organization || '')}</dd></dl>
      <h5>Usage limits</h5>${limits.length ? limits.map(([k, v]) => `<div><div class="row-between"><span>${esc(names[k] || k.replace(/_/g, ' '))}</span><span class="hint">${Math.round(v.utilization)}% used${v.resets_at ? `, resets ${esc(when(v.resets_at))}` : ''}</span></div><div class="meter ${v.utilization > 80 ? 'high' : ''}"><i style="width:${Math.min(100, v.utilization)}%"></i></div></div>`).join('') : '<div class="hint">No limits reported</div>'}
      <h5>This conversation</h5><dl class="kv"><dt>Time working</dt><dd>${duration(s.total_api_duration_ms)}</dd><dt>Lines changed</dt><dd>+${s.total_lines_added || 0} −${s.total_lines_removed || 0}</dd><dt>API equivalent cost</dt><dd>$${(s.total_cost_usd || 0).toFixed(2)}</dd></dl>`;
  });
}

function showStatus() {
  openSheet('Status', async body => {
    await ready();
    const st = await request('get_status');
    body.innerHTML = (st.sections || []).map(sec => `<h5>${esc(sec.title)}</h5><dl class="kv">${(sec.rows || []).map(r => `<dt>${esc(r.label)}</dt><dd>${esc(clean(r.value))}</dd>`).join('')}</dl>`).join('') || '<div class="hint">No status</div>';
  });
}

function showMcp() {
  openSheet('MCP servers', async body => {
    await ready();
    const paint = async () => {
      const servers = (await request('mcp_status')).mcpServers || [];
      body.innerHTML = '<div class="hint">The servers Claude can use in this conversation, “studio” is this app</div>' + servers.map((s, i) => `<div class="item"><span class="grow"><b>${esc(s.name)}</b><small>${esc([s.scope || s.source, s.config?.url || s.config?.command].filter(Boolean).join(', '))}</small>${s.error ? `<small>${esc(s.error)}</small>` : ''}</span><span class="status-chip ${esc(s.status)}">${esc(String(s.status).replace('-', ' '))}</span>
        ${s.status === 'needs-auth' ? `<button class="btn small" data-a="auth" data-i="${i}">Sign in</button>` : `<button class="btn small" data-a="reconnect" data-i="${i}">Reconnect</button>`}
        ${s.name === 'studio' ? '' : `<button class="btn small subtle" data-a="toggle" data-i="${i}">${s.status === 'disabled' ? 'Enable' : 'Disable'}</button>`}</div>`).join('');
      body.onclick = async e => {
        const b = e.target.closest('button[data-a]');
        if (!b) return;
        const s = servers[Number(b.dataset.i)];
        b.disabled = true;
        try {
          if (b.dataset.a === 'reconnect') await request('mcp_reconnect', {serverName: s.name});
          else if (b.dataset.a === 'toggle') await request('mcp_toggle', {serverName: s.name, enabled: s.status === 'disabled'});
          else {
            const r = await request('mcp_authenticate', {serverName: s.name});
            const url = r.authUrl || r.auth_url || r.url;
            if (url) openLink(url);
          }
        } catch (err) { toast(String(err.message || err)); }
        paint().catch(() => {});
      };
    };
    await paint();
  });
}

function settingsPath(kind) {
  return kind === 'user' ? `${home}\\.claude\\settings.json` : `${root}\\.claude\\settings.json`;
}

function showHooks() {
  openSheet('Hooks', async body => {
    await ready();
    const h = await request('get_hooks_listing');
    const hooks = h.hooks || [];
    const text = x => x.command || x.hook?.command || x.prompt || JSON.stringify(x.hook || x);
    body.innerHTML = '<div class="hint">Commands Claude Code runs on its own at certain moments, like before a tool runs</div>'
      + (hooks.length ? hooks.map(x => `<div class="item"><span class="grow"><b>${esc(x.event || x.hookEventName || '')}${x.matcher ? ` ${esc(x.matcher)}` : ''}</b><small>${esc(text(x))}</small>${x.source ? `<small>${esc(x.source)}</small>` : ''}</span></div>`).join('') : '<div class="hint">There are no hooks</div>')
      + `<h5>Edit them in</h5><div class="actions"><button class="btn" data-f="user">${icon('doc')}Your settings</button><button class="btn" data-f="project">${icon('doc')}This folder's settings</button></div>`;
    body.onclick = e => {
      const f = e.target.closest('button[data-f]')?.dataset.f;
      if (f) invoke('open_path', {path: settingsPath(f), create: true}).catch(err => toast(String(err)));
    };
  });
}

function ruleText(r) {
  if (typeof r === 'string') return r;
  if (r.rule || r.ruleString) return r.rule || r.ruleString;
  const v = r.ruleValue || r;
  return v.toolName ? `${v.toolName}${v.ruleContent ? `(${v.ruleContent})` : ''}` : JSON.stringify(r);
}

function showPermissions() {
  openSheet('Permissions', async body => {
    await ready();
    const SOURCES = {localSettings: 'This folder, only you', projectSettings: 'This folder, shared', userSettings: 'All folders'};
    const paint = async () => {
      const [p, s] = await Promise.all([request('list_permission_rules'), request('get_settings')]);
      const rules = p.state?.rules || [];
      const perms = src => s.sources?.find(x => x.source === src)?.settings?.permissions || {};
      body.innerHTML = '<div class="hint">Rules that let Claude use a tool without asking, make it ask first, or never let it</div>'
        + (rules.length ? rules.map((r, i) => {
          const b = r.behavior || r.ruleBehavior || '';
          return `<div class="item"><span class="status-chip ${b === 'allow' ? 'ok' : b === 'deny' ? 'failed' : 'pending'}">${esc(b)}</span><span class="grow"><b>${esc(ruleText(r))}</b><small>${esc(SOURCES[r.source] || r.source || '')}</small></span>${SOURCES[r.source] ? `<button class="btn small subtle" data-del="${i}" title="Remove rule">${icon('trash')}</button>` : ''}</div>`;
        }).join('') : '<div class="hint">There are no rules yet</div>')
        + `<h5>Add a rule</h5><div class="add-rule"><select id="pr-behavior"><option value="allow">Allow</option><option value="ask">Ask</option><option value="deny">Deny</option></select><input type="text" id="pr-rule" placeholder="For example: Bash(uv run *) or WebFetch"><select id="pr-source">${Object.entries(SOURCES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><button class="btn" id="pr-add">Add</button></div>`;
      const write = async (src, change) => {
        const current = perms(src);
        const next = {...current};
        change(next);
        await request('update_settings', {source: src, settings: {permissions: next}});
        await paint();
      };
      body.onclick = async e => {
        const del = e.target.closest('[data-del]')?.dataset.del;
        if (del !== undefined) {
          const r = rules[Number(del)], b = r.behavior || r.ruleBehavior, text = ruleText(r);
          try { await write(r.source, next => { next[b] = (next[b] || []).filter(x => x !== text); }); } catch (err) { toast(String(err.message || err)); }
        } else if (e.target.closest('#pr-add')) {
          const rule = $('#pr-rule').value.trim(), b = $('#pr-behavior').value;
          if (!rule) { $('#pr-rule').focus(); return; }
          try { await write($('#pr-source').value, next => { next[b] = [...new Set([...(next[b] || []), rule])]; }); } catch (err) { toast(String(err.message || err)); }
        }
      };
    };
    await paint();
  });
}

function showMemory() {
  openSheet('Memory', async body => {
    await ready();
    const m = await request('get_memory_dialog');
    const memories = m.memories || [];
    body.innerHTML = '<div class="hint">What Claude remembers about this folder from one conversation to the next</div>'
      + `<div class="item"><span class="grow"><b>Auto memory</b><small>${m.auto_memory?.status === 'on' ? 'On, Claude saves useful facts as it works' : 'Off'}</small></span></div>`
      + (memories.length ? memories.map(x => `<button class="item" data-open="${esc(x.path || '')}"><span class="grow"><b>${esc(x.name || x.title || x.path || '')}</b><small>${esc(x.description || x.type || '')}</small></span></button>`).join('') : '<div class="hint">No memories yet</div>')
      + `<div class="actions">${(m.folders || []).map(f => `<button class="btn" data-open="${esc(f.path)}">${icon('export')}${esc(f.label || 'Open folder')}</button>`).join('')}</div>`;
    body.onclick = e => {
      const p = e.target.closest('[data-open]')?.dataset.open;
      if (p) invoke('open_path', {path: p}).catch(err => toast(String(err)));
    };
  });
}

function showInstructions() {
  openSheet('Instructions', async body => {
    await ready();
    const m = await request('get_memory_dialog');
    body.innerHTML = '<div class="hint">CLAUDE.md files: instructions Claude reads at the start of every conversation</div>'
      + (m.files || []).map(f => `<div class="item"><span class="grow"><b>${esc(f.label)}</b><small>${esc(f.description || f.path)}</small></span><button class="btn small" data-path="${esc(f.path)}" data-exists="${!!f.exists}">${f.exists ? 'Open' : 'Create'}</button></div>`).join('');
    body.onclick = e => {
      const b = e.target.closest('button[data-path]');
      if (b) invoke('open_path', {path: b.dataset.path, create: b.dataset.exists !== 'true'}).catch(err => toast(String(err)));
    };
  });
}

function showPlugins() {
  openSheet('Plugins', async body => {
    await ready();
    const plugins = chat.plugins || [];
    body.innerHTML = '<div class="hint">Plugins add commands, agents, skills and servers to Claude Code</div>'
      + (plugins.length ? plugins.map(p => `<div class="item"><span class="grow"><b>${esc(p.name)}</b><small>${esc(p.source || p.path || '')}</small></span></div>`).join('') : '<div class="hint">The list shows up after your first message in this conversation</div>')
      + `<div class="actions"><button class="btn" id="pl-reload">${icon('again')}Reload plugins</button><button class="btn" id="pl-manage">${icon('terminal')}Install or remove in Terminal</button></div>
      <div class="hint">To install or remove plugins, type /plugin in the terminal that opens, then reload them here</div>`;
    $('#pl-reload').onclick = async () => { try { await request('reload_plugins'); toast('Plugins reloaded'); } catch (e) { toast(String(e.message || e)); } };
    $('#pl-manage').onclick = () => invoke('open_terminal', {session: null}).catch(e => toast(String(e)));
  });
}

function showSandbox() {
  openSheet('Sandbox', async body => {
    await ready();
    const s = await request('get_sandbox_dialog');
    body.innerHTML = s.supported === false
      ? `<div class="hint">Sandboxing isn't available ${s.unsupported_reason === 'platform' ? 'on Windows' : 'on this computer'}, so commands run under your permission rules instead</div>`
      : `<dl class="kv"><dt>Status</dt><dd>${s.enabled ? 'On' : 'Off'}</dd><dt>Mode</dt><dd>${esc(s.mode || '')}</dd></dl>`;
  });
}

function showExport() {
  openSheet('Export conversation', async body => {
    await ready();
    const r = await request('export_conversation');
    body.innerHTML = `<div class="actions"><button class="btn primary" id="ex-copy">${icon('copy')}Copy</button><button class="btn" id="ex-save">${icon('download')}Save to Downloads</button></div><pre></pre>`;
    body.querySelector('pre').textContent = r.text || 'The conversation is empty';
    $('#ex-copy').onclick = () => navigator.clipboard.writeText(r.text || '').then(() => toast('Copied')).catch(e => toast(String(e)));
    $('#ex-save').onclick = async () => {
      try { toast(`Saved in ${await invoke('save_export', {name: r.default_filename || 'conversation.txt', text: r.text || ''})}`); }
      catch (e) { toast(String(e)); }
    };
  });
}

function showSideQuestion() {
  openSheet('Side question', body => {
    body.innerHTML = `<div class="hint">Ask something quick about the conversation without interrupting it, the answer stays out of the conversation</div>
      <textarea id="sq-text" placeholder="For example: which file has the title colors?"></textarea>
      <div class="actions"><button class="btn primary" id="sq-ask">${icon('send')}Ask</button></div>
      <div id="sq-answer" class="msg-text"></div>`;
    $('#sq-text').focus();
    const ask = async () => {
      const q = $('#sq-text').value.trim();
      if (!q) return;
      $('#sq-ask').disabled = true;
      $('#sq-answer').innerHTML = '<span class="spinner"></span>';
      try { await ready(); const r = await request('side_question', {question: q}); $('#sq-answer').innerHTML = markdown(r.response || 'No answer'); }
      catch (e) { $('#sq-answer').textContent = String(e.message || e); }
      $('#sq-ask').disabled = false;
    };
    $('#sq-ask').onclick = ask;
    $('#sq-text').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } };
  });
}

function showRewind() {
  const points = chat.timeline.filter(t => t.kind === 'user' && t.uuid && t.el?.isConnected);
  openSheet('Rewind', body => {
    if (!points.length) { body.innerHTML = '<div class="hint">There is nothing to rewind yet</div>'; return; }
    body.innerHTML = '<div class="hint">Pick a message to go back to the moment before you sent it</div>'
      + points.slice().reverse().map(p => `<button class="item" data-u="${esc(p.uuid)}"><span class="grow"><b>${esc((p.el.dataset.text || p.el.innerText).slice(0, 140))}</b></span></button>`).join('');
    body.onclick = async e => {
      const u = e.target.closest('[data-u]')?.dataset.u;
      if (!u) return;
      const point = points.find(p => p.uuid === u);
      let files = null;
      try { await ready(); files = await request('rewind_files', {user_message_id: u, dry_run: true}); } catch {}
      const code = files?.canRewind && files.filesChanged?.length;
      body.innerHTML = `<div class="item"><span class="grow"><b>${esc((point.el.dataset.text || '').slice(0, 160))}</b><small>${code ? `${files.filesChanged.length} file(s) changed since then, +${files.insertions || 0} −${files.deletions || 0}` : 'No file changes to restore'}</small></span></div>
        <div class="actions">
          ${code ? '<button class="btn primary" data-r="both">Restore code and conversation</button>' : ''}
          <button class="btn ${code ? '' : 'primary'}" data-r="conversation">Restore conversation</button>
          ${code ? '<button class="btn" data-r="code">Restore code only</button>' : ''}
          <button class="btn subtle" data-r="cancel">Cancel</button></div>
        ${code ? `<pre>${esc(files.filesChanged.map(rel).join('\n'))}</pre>` : ''}`;
      body.onclick = async ev => {
        const r = ev.target.closest('button[data-r]')?.dataset.r;
        if (!r) return;
        if (r === 'cancel') { showRewind(); return; }
        if (chat.running) interrupt();
        try {
          if (r === 'both' || r === 'code') await request('rewind_files', {user_message_id: u});
          if (r === 'both' || r === 'conversation') await rewindConversation(point);
          closeSheet();
          toast({code: 'Code restored', conversation: 'Conversation rewound', both: 'Code and conversation restored'}[r]);
          refresh().catch(() => {});
        } catch (err) { toast(String(err.message || err)); }
      };
    };
  });
}

// Goes back to just before a message: the conversation continues, in a copy, from the message
// before it, and the text of that message returns to the box to edit it.
async function rewindConversation(point) {
  const i = chat.timeline.indexOf(point);
  const before = chat.timeline.slice(0, i).reverse().find(t => t.uuid);
  const text = point.el.dataset.text || '';
  let el = point.el;
  while (el) { const next = el.nextSibling; el.remove(); el = next; }
  chat.timeline = chat.timeline.slice(0, i);
  chat.sentBubbles = [];
  setRunning(false);
  const session = chat.sessionId;
  if (before && session) await startSession({resume: session, resumeSessionAt: before.uuid, forkSession: true});
  else { resetChat(); await startSession({}); }
  paintEmpty();
  input.value = text;
  autosize();
  input.focus();
}

const BOOKMARKS = 'studio.bookmarks';
function bookmarks() { try { return JSON.parse(load(BOOKMARKS, '[]')); } catch { return []; } }

function bookmarkButton(el) {
  if (!el.dataset.uuid || el.querySelector(':scope > .bm')) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'bm';
  b.title = 'Bookmark this answer';
  b.setAttribute('aria-label', 'Bookmark this answer');
  b.innerHTML = icon('bookmark');
  b.classList.toggle('on', bookmarks().some(x => x.uuid === el.dataset.uuid));
  b.onclick = e => {
    e.stopPropagation();
    const list = bookmarks(), on = list.some(x => x.uuid === el.dataset.uuid);
    const next = on ? list.filter(x => x.uuid !== el.dataset.uuid)
      : [{uuid: el.dataset.uuid, session: chat.sessionId, title: chat.title, text: el.innerText.trim().slice(0, 280), date: Date.now()}, ...list].slice(0, 200);
    save(BOOKMARKS, JSON.stringify(next));
    b.classList.toggle('on', !on);
    toast(on ? 'Bookmark removed' : 'Bookmarked');
  };
  el.prepend(b);
}

function showBookmarks() {
  openSheet('Bookmarks', body => {
    const list = bookmarks();
    if (!list.length) { body.innerHTML = '<div class="hint">Bookmark an answer with the button that shows up when you point at it</div>'; return; }
    body.innerHTML = list.map((b, i) => `<button class="item" data-i="${i}"><span class="grow"><b>${esc(b.title || 'Conversation')}</b><small>${esc(b.text)}</small><small>${ago(b.date)}</small></span></button>`).join('');
    body.onclick = async e => {
      const b = list[Number(e.target.closest('[data-i]')?.dataset.i)];
      if (!b) return;
      const find = () => chatEl.querySelector(`.msg-text[data-uuid="${CSS.escape(b.uuid)}"]`);
      if (!find() && b.session && b.session !== chat.sessionId) await resumeConversation({id: b.session, title: b.title});
      const el = find();
      closeSheet();
      const group = el?.closest('details.steps');
      if (group) group.open = true;
      if (el) { el.scrollIntoView({block: 'center', behavior: 'smooth'}); el.animate([{background: 'rgb(220 228 255)'}, {background: 'transparent'}], 1800); }
      else toast('That answer is no longer in this conversation');
    };
  });
}

// The panel sends requests to Claude as if you had typed them in the chat.
async function sendToClaude(text, images = []) {
  if (!chat.claudeInstalled) { toast('Claude Code is not installed'); return; }
  chat.attachments.push(...images);
  await sendMessage(text);
  input.focus();
}

// ───────────── events ─────────────
const exportMenu = $('#export-menu');
const closeExport = () => { exportMenu.classList.remove('open'); $('#export').setAttribute('aria-expanded', 'false'); };

$('#talk').onchange = e => {
  const v = e.target.value;
  if (v === '__new') { e.target.value = talk; mode = 'talk'; newTalkDraft = null; paintViewer(true); return; }
  if (v === '__open') { e.target.value = talk; openTalk(); return; }
  changeTalk(v); paintSkeleton(); act(Promise.resolve());
};
$('#talk-details').onclick = () => { if (!data) return; mode = 'details'; paintViewer(true); };
// The talk's resolution is saved in its talk.manimrs, so the commands and Claude use it too.
$('#quality').onclick = async e => {
  const q = e.target.closest('button')?.dataset.q;
  if (!q || !talk || q === quality) return;
  const before = quality, asked = talk;
  quality = q; paintQuality(); paintViewer(false);
  qualitySaving++;
  try {
    await invoke('save_talk', {talk: asked, fields: {resolution: q}});
  } catch (err) {
    if (talk === asked) { quality = before; paintQuality(); paintViewer(false); }
    toast(String(err));
  } finally {
    qualitySaving--;
  }
};
$('#filters').onclick = e => {
  const f = e.target.closest('button')?.dataset.f; if (!f) return;
  filter = f; listSig = ''; refresh();
};
$('#new').onclick = () => { mode = 'new'; paintViewer(true); };
$('#pending').onclick = () => act(invoke('render', {talk, what: 'pending', quality}), 'Queued: render the pending slides');
$('#present').onclick = () => act(invoke('present', {talk, start: null}), 'Opening the presenter…');
$('#send-all').onclick = () => {
  const withImages = actives().filter(s => s.review.status === 'changes' && imagesOf(s).length);
  const owners = withImages.map(s => `${s.name} (${imagesOf(s).length})`).join(', ');
  sendToClaude(`/slides ${talk}: apply the changes requested in the review panel (notes tool), one slide at a time` +
    (owners ? `. The attached images go with the notes of ${owners}, in that order` : ''),
  withImages.flatMap(s => imagesOf(s).splice(0)));
  paintNoteImages();
};
$('#export').onclick = e => {
  e.stopPropagation();
  const open = exportMenu.classList.toggle('open');
  $('#export').setAttribute('aria-expanded', open);
};
exportMenu.querySelector('.menu-list').onclick = e => {
  const f = e.target.closest('button')?.dataset.f; if (!f) return;
  closeExport();
  if (f === 'folder') return act(invoke('open_exported', {talk}));
  if (f === 'all') {
    if (!confirm(`Render all ${actives().length} slides? The ones without a resolution of their own come out at ${quality}, and it can take a long time`)) return;
    return act(invoke('render', {talk, what: 'all', quality}), 'Queued: the whole talk');
  }
  act(invoke('export', {talk, format: f}), 'Queued: export');
};

// Browser: select, right-click menu and drag to reorder.
const list = $('#list');
list.onclick = e => select(e.target.closest('.row')?.dataset.k);
list.oncontextmenu = e => {
  const r = e.target.closest('.row[data-k]');
  if (!r) return;
  e.preventDefault();
  select(r.dataset.k);
  openSlideMenu(byKey(r.dataset.k), e.clientX, e.clientY);
};
let dragged = null;
const clearDrop = () => document.querySelectorAll('.drop-before, .drop-after')
  .forEach(r => r.classList.remove('drop-before', 'drop-after'));
list.addEventListener('dragstart', e => {
  const r = e.target.closest('.row[draggable="true"]');
  if (!r) return;
  dragged = r.dataset.k;
  r.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragged);
});
list.addEventListener('dragend', () => {
  clearDrop();
  document.querySelector('.row.dragging')?.classList.remove('dragging');
  dragged = null;
});
list.addEventListener('dragover', e => {
  const r = e.target.closest('.row[draggable="true"]');
  if (!dragged || !r) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const box = r.getBoundingClientRect();
  clearDrop();
  r.classList.add(e.clientY < box.top + box.height / 2 ? 'drop-before' : 'drop-after');
});
list.addEventListener('drop', e => {
  e.preventDefault();
  const r = e.target.closest('.row[draggable="true"]');
  const before = r?.classList.contains('drop-before');
  clearDrop();
  const s = byKey(dragged), target = r && byKey(r.dataset.k);
  if (!s || !target || s === target) return;
  const a = actives(), i = a.indexOf(target);
  const after = before ? a[i - 1] ?? null : target;
  if (after === s || (after && a[a.indexOf(after) + 1] === s) || (!after && a[0] === s)) return;
  moveSlide(s, after);
});

$('#slide-menu').onclick = e => {
  const action = e.target.closest('button:not(:disabled)')?.dataset.a;
  const s = byKey($('#slide-menu').dataset.k);
  closeSlideMenu();
  if (action && s) slideAction(action, s);
};
document.addEventListener('click', e => {
  if (!e.target.closest('#slide-menu, #b-actions')) closeSlideMenu();
  if (!e.target.closest('#export-menu')) closeExport();
  if (!e.target.closest('#c-history-menu, #c-history')) $('#c-history-menu').hidden = true;
  if (!e.target.closest('#c-settings-menu, #c-settings')) $('#c-settings-menu').hidden = true;
  if (!e.target.closest('#c-choice-menu')) $('#c-choice-menu').hidden = true;
  if (!e.target.closest('#c-palette, #c-actions')) closePalette();
});

$('#viewer').onclick = e => {
  const id = e.target.closest('button')?.id, s = current();
  if (!id || !s) return;
  const note = $('#note')?.value.trim() ?? '';
  const askNote = () => { $('#note').focus(); toast('First write what you want to change'); };
  const actions = {
    'b-actions': () => {
      const r = $('#b-actions').getBoundingClientRect();
      $('#slide-menu').hidden ? openSlideMenu(s, r.right - 220, r.bottom + 6) : closeSlideMenu();
    },
    'o-restore': () => slideAction('restore', s),
    'o-delete': () => deleteSlide(s),
    'p-play': togglePlay,
    'p-prev': prevPause,
    'p-next': nextPause,
    'b-render': () => act(invoke('render', {talk, what: [s.name], quality: s.resolution || quality}), `Queued: ${s.name}`),
    'b-present': () => act(invoke('present', {talk, start: s.name}), 'Opening the presenter…'),
    'b-approve': () => act(invoke('review', {talk, name: s.name, status: 'approved', note}), `${s.name} approved`),
    'b-save-note': () => note
      ? act(invoke('review', {talk, name: s.name, status: 'changes', note}), 'Note saved, send it whenever you want')
      : askNote(),
    'b-image': () => $('#r-file').click(),
    'b-send': async () => {
      if (!note) return askNote();
      await invoke('review', {talk, name: s.name, status: 'changes', note}).catch(() => {});
      sendToClaude(`/slides ${talk} ${s.name}: ${note}`, imagesOf(s).splice(0));
      paintNoteImages();
    },
  };
  actions[id]?.();
};
$('#viewer').ondblclick = e => { if (e.target.closest('#v-name') && mode === 'view') startRename(); };
$('#job').onclick = e => {
  const id = e.target.closest('[data-cancel]')?.dataset.cancel;
  if (id) act(invoke('cancel', {id: Number(id)}), 'Cancelling…');
};
$('#show-log').onclick = e => { e.stopPropagation(); openLog(!$('#log').classList.contains('open')); };

// Divider between the viewer and the Claude panel.
const divider = $('#divider');
const storedWidth = load('studio.chatWidth', '');
if (storedWidth) document.documentElement.style.setProperty('--chat-width', storedWidth);
divider.onpointerdown = e => {
  divider.setPointerCapture(e.pointerId);
  divider.classList.add('dragging');
  divider.onpointermove = ev => {
    const width = Math.min(Math.max(window.innerWidth - ev.clientX, 340), window.innerWidth - 680);
    document.documentElement.style.setProperty('--chat-width', width + 'px');
  };
  divider.onpointerup = () => {
    divider.onpointermove = null;
    divider.classList.remove('dragging');
    save('studio.chatWidth', getComputedStyle(document.documentElement).getPropertyValue('--chat-width').trim());
  };
};

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeSlideMenu(); closeExport(); openLog(false);
    ['#c-history-menu', '#c-settings-menu', '#c-choice-menu'].forEach(s => { $(s).hidden = true; });
    if (!$('#c-palette').hidden) closePalette();
    else if (!$('#c-sheet').hidden && !e.target.matches('textarea, input')) closeSheet();
    return;
  }
  if (e.target.closest('#claude') || e.target.matches('textarea, select, input')) return;
  if (e.key === 'F2') { e.preventDefault(); startRename(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!$('#slide-menu').hidden) return;
    e.preventDefault();
    const rows = [...document.querySelectorAll('.row[data-k]')];
    const i = rows.findIndex(r => r.dataset.k === sel);
    select(rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.dataset.k);
  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && vid()) {
    if (!$('#slide-menu').hidden) return;
    e.preventDefault();
    e.key === 'ArrowLeft' ? prevPause() : nextPause();
  } else if (e.key === ' ' && !e.target.matches('button')) {
    if (!vid()) return;
    e.preventDefault();
    togglePlay();
  }
});

start().catch(e => { $('#viewer').innerHTML = `<div class="empty-state"><b>The panel could not load</b>${esc(String(e))}</div>`; });

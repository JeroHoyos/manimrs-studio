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
  if (info.version) $('#version').textContent = `Pre-release ${info.version}`;
  home = String(info.home || '');
  chatStart(info);
  if (info.uv === false) return paintNoUv();
  talks = await invoke('talks');
  talk = talkId(talk) || talks[0]?.id || '';
  paintTalks();
  paintQuality();
  jobs = await invoke('jobs');
  paintJobs();
  await refresh();
  schedule();
}

// Without uv nothing can be read or rendered: say what is missing instead of a Python error.
function paintNoUv() {
  ['#new', '#present', '#export', '#pending', '#talk-details', '#talk'].forEach(b => { $(b).disabled = true; });
  $('#list').innerHTML = '';
  $('#viewer').innerHTML = `<div class="empty-state no-talks"><b>uv is not installed</b>The app reads and renders the talks with uv, install it and open the app again
    <span class="actions"><button class="btn primary" id="e-uv">Get uv</button></span></div>`;
  $('#e-uv').onclick = () => openLink('https://docs.astral.sh/uv/getting-started/installation/');
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
  if (d.ffmpeg === false && !warnedFfmpeg) {
    warnedFfmpeg = true;
    toast('FFmpeg is not installed, the thumbnails, the PDF export and the images Claude examines need it',
      ['Get FFmpeg', () => openLink('https://ffmpeg.org/download.html')]);
  }
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

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
  const q = (e.target as Element).closest('button')?.dataset.q;
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
  const f = (e.target as Element).closest('button')?.dataset.f; if (!f) return;
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
  const f = (e.target as Element).closest('button')?.dataset.f; if (!f) return;
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
list.onclick = e => select((e.target as Element).closest('.row')?.dataset.k);
list.oncontextmenu = e => {
  const r = (e.target as Element).closest('.row[data-k]');
  if (!r) return;
  e.preventDefault();
  select(r.dataset.k);
  openSlideMenu(byKey(r.dataset.k), e.clientX, e.clientY);
};
let dragged = null;
const clearDrop = () => document.querySelectorAll('.drop-before, .drop-after')
  .forEach(r => r.classList.remove('drop-before', 'drop-after'));
list.addEventListener('dragstart', e => {
  const r = (e.target as Element).closest('.row[draggable="true"]');
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
  const r = (e.target as Element).closest('.row[draggable="true"]');
  if (!dragged || !r) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const box = r.getBoundingClientRect();
  clearDrop();
  r.classList.add(e.clientY < box.top + box.height / 2 ? 'drop-before' : 'drop-after');
});
list.addEventListener('drop', e => {
  e.preventDefault();
  const r = (e.target as Element).closest('.row[draggable="true"]');
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
  const action = (e.target as Element).closest('button:not(:disabled)')?.dataset.a;
  const s = byKey($('#slide-menu').dataset.k);
  closeSlideMenu();
  if (action && s) slideAction(action, s);
};
document.addEventListener('click', e => {
  if (!(e.target as Element).closest('#slide-menu, #b-actions')) closeSlideMenu();
  if (!(e.target as Element).closest('#export-menu')) closeExport();
  if (!(e.target as Element).closest('#c-history-menu, #c-history')) $('#c-history-menu').hidden = true;
  if (!(e.target as Element).closest('#c-settings-menu, #c-settings')) $('#c-settings-menu').hidden = true;
  if (!(e.target as Element).closest('#c-choice-menu')) $('#c-choice-menu').hidden = true;
  if (!(e.target as Element).closest('#c-palette, #c-actions')) closePalette();
});

$('#viewer').onclick = e => {
  const id = (e.target as Element).closest('button')?.id, s = current();
  if (!id || !s) return;
  const note = $('#note')?.value.trim() ?? '';
  const askNote = () => { $('#note').focus(); toast('First write what you want to change'); };
  // Approved, saved or sent: the note is in the review now, it is not a draft anymore.
  if (['b-approve', 'b-save-note', 'b-send'].includes(id) && s.active) noteDrafts.delete(noteKey(s));
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
    'b-mark': startMark,
    'b-send': async () => {
      if (!note) return askNote();
      await invoke('review', {talk, name: s.name, status: 'changes', note}).catch(() => {});
      sendToClaude(`/slides ${talk} ${s.name}: ${note}`, imagesOf(s).splice(0));
      paintNoteImages();
    },
  };
  actions[id]?.();
};
$('#viewer').ondblclick = e => { if ((e.target as Element).closest('#v-name') && mode === 'view') startRename(); };
$('#job').onclick = e => {
  const id = (e.target as Element).closest('[data-cancel]')?.dataset.cancel;
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
    const width = Math.max(Math.min(window.innerWidth - ev.clientX, window.innerWidth - 680), 300);
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
    if (mark) { endMark(); return; }
    closeSlideMenu(); closeExport(); openLog(false);
    ['#c-history-menu', '#c-settings-menu', '#c-choice-menu'].forEach(s => { $(s).hidden = true; });
    if (!$('#c-palette').hidden) closePalette();
    else if (!$('#c-sheet').hidden && !(e.target as Element).matches('textarea, input')) closeSheet();
    return;
  }
  if ((e.target as Element).closest('#claude') || (e.target as Element).matches('textarea, select, input')) return;
  if (mark) { if (e.key === 'z' && e.ctrlKey) { e.preventDefault(); undoMark(); } return; }
  if (e.key === 'F2') { e.preventDefault(); startRename(); return; }
  // In the list: ↑ ↓ one slide, Page Up and Page Down ten, Home and End the first and the last.
  const jump = {ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10, End: Infinity, Home: -Infinity}[e.key];
  if (jump) {
    if (!$('#slide-menu').hidden) return;
    e.preventDefault();
    const rows = [...document.querySelectorAll('.row[data-k]')];
    const i = rows.findIndex(r => r.dataset.k === sel);
    select(rows[Math.max(0, Math.min(rows.length - 1, i + jump))]?.dataset.k);
  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && vid()) {
    if (!$('#slide-menu').hidden) return;
    e.preventDefault();
    e.key === 'ArrowLeft' ? prevPause() : nextPause();
  } else if (e.key === ' ' && !(e.target as Element).matches('button')) {
    if (!vid()) return;
    e.preventDefault();
    togglePlay();
  }
});

start().catch(e => { $('#viewer').innerHTML = `<div class="empty-state"><b>The panel could not load</b>${esc(String(e))}</div>`; });

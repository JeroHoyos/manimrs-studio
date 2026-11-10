// ───────────── marking on the slide ─────────────
// Point at something, draw over it or show where to move it, on the frame the video is showing.
// What is marked becomes an image of the note, so Claude sees exactly what is meant; what is
// written for each point goes into the note with its number.
let mark = null;  // {tool, items, canvas, selected}: while the slide is being marked
const MARK_TOOLS = [['pin', 'Point'], ['draw', 'Draw'], ['move', 'Move']];
const MARK_HINT = {
  pin: 'Click what you mean, then write what to change there',
  draw: 'Draw over the slide',
  move: 'Drag from the thing to where it should go',
};

function startMark() {
  const v = vid(), screen = $('#screen');
  if (mark || !screen) return;
  if (!v || v.readyState < 2) { toast('Render the slide first, then mark on it'); return; }
  player.playing = false;
  v.pause();
  const canvas = document.createElement('canvas');
  canvas.id = 'mark-canvas';
  const bar = document.createElement('div');
  bar.id = 'mark-bar';
  bar.innerHTML = `<span class="segment" role="group" aria-label="What to mark">${MARK_TOOLS.map(([t, n]) => `<button type="button" data-tool="${t}">${n}</button>`).join('')}</span>
    <input type="text" id="mark-text" aria-label="What to change at the point">
    <button type="button" class="btn small" data-do="undo">Undo</button>
    <button type="button" class="btn small" data-do="cancel">Cancel</button>
    <button type="button" class="btn small primary" data-do="done">Add to the note</button>`;
  screen.append(canvas);
  screen.after(bar);  // below the frame: over it, it would hide what is being marked
  screen.classList.add('marking');
  mark = {tool: 'pin', items: [], canvas, selected: null};
  const at = e => {
    const r = canvas.getBoundingClientRect();
    return {x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))};
  };
  let live = null;
  canvas.onpointerdown = e => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    const p = at(e);
    if (mark.tool === 'pin') {
      const pin = {kind: 'pin', ...p, n: mark.items.filter(i => i.kind === 'pin').length + 1, text: ''};
      mark.items.push(pin);
      mark.selected = pin;
    } else {
      live = mark.tool === 'draw' ? {kind: 'draw', pts: [p]} : {kind: 'move', a: p, b: p};
      mark.items.push(live);
    }
    paintMark();
  };
  canvas.onpointermove = e => {
    if (!live) return;
    const p = at(e);
    if (live.kind === 'draw') live.pts.push(p); else live.b = p;
    paintMark();
  };
  canvas.onpointerup = canvas.onlostpointercapture = () => {
    // A click without a drag draws nothing: it is not kept.
    const short = live && (live.kind === 'draw' ? live.pts.length < 3 : Math.hypot(live.a.x - live.b.x, live.a.y - live.b.y) < 0.02);
    if (short) mark.items.splice(mark.items.indexOf(live), 1);
    live = null;
    paintMark();
  };
  bar.onclick = e => {
    const b = (e.target as Element).closest('button');
    if (!b) return;
    if (b.dataset.tool) { mark.tool = b.dataset.tool; mark.selected = null; paintMark(); return; }
    ({undo: undoMark, cancel: endMark, done: finishMark})[b.dataset.do]?.();
  };
  $('#mark-text').oninput = e => { if (mark.selected) { mark.selected.text = e.target.value; paintMark(); } };
  $('#mark-text').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); mark.selected = null; paintMark(); } };
  new ResizeObserver(() => { if (mark?.canvas === canvas) paintMark(); }).observe(canvas);
  paintMark();
}

function undoMark() {
  const gone = mark.items.pop();
  if (gone === mark.selected) mark.selected = null;
  paintMark();
}

function endMark() {
  if (!mark) return;
  mark = null;
  $('#mark-canvas')?.remove();
  $('#mark-bar')?.remove();
  $('#screen')?.classList.remove('marking');
}

// The marks over the frame and the state of the bar.
function paintMark() {
  const c = mark.canvas, scale = window.devicePixelRatio || 1;
  const w = Math.round(c.clientWidth * scale), h = Math.round(c.clientHeight * scale);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  drawMarks(ctx, w, h, mark.items);
  document.querySelectorAll('#mark-bar [data-tool]').forEach(b => {
    b.classList.toggle('on', b.dataset.tool === mark.tool);
    b.setAttribute('aria-pressed', String(b.dataset.tool === mark.tool));
  });
  const text = $('#mark-text');
  text.disabled = !mark.selected;
  text.placeholder = mark.selected ? `What to change at point ${mark.selected.n}` : MARK_HINT[mark.tool];
  if (mark.selected) { if (text.value !== mark.selected.text) text.value = mark.selected.text; text.focus(); }
  else text.value = '';
  $('#mark-bar [data-do="undo"]').disabled = !mark.items.length;
  $('#mark-bar [data-do="done"]').disabled = !mark.items.length;
}

// Every mark twice: a wide white line under the blue one, so it reads on any slide.
function drawMarks(ctx, w, h, items) {
  const u = w / 640;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [color, width] of [['#ffffff', 6 * u], ['#2b59ff', 3 * u]]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    for (const it of items) {
      ctx.beginPath();
      if (it.kind === 'draw') it.pts.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)));
      else if (it.kind === 'move') arrowPath(ctx, it.a.x * w, it.a.y * h, it.b.x * w, it.b.y * h, 12 * u);
      else ctx.arc(it.x * w, it.y * h, 11 * u, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const it of items.filter(i => i.kind === 'pin')) {
    ctx.fillStyle = '#2b59ff';
    ctx.beginPath();
    ctx.arc(it.x * w, it.y * h, 10 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${12 * u}px "Space Grotesk", sans-serif`;
    ctx.fillText(String(it.n), it.x * w, it.y * h + u);
  }
}

function arrowPath(ctx, x1, y1, x2, y2, head) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  for (const turn of [-0.5, 0.5]) {
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(angle + turn), y2 - head * Math.sin(angle + turn));
  }
}

// The frame with its marks becomes an image of the note; what was written for each point goes
// into the note with its number.
function finishMark() {
  const v = vid(), s = current(), note = $('#note');
  if (!v || !s || !mark.items.length) return;
  const w = Math.min(1280, v.videoWidth || 1280), h = Math.round(w * (v.videoHeight || 720) / (v.videoWidth || 1280));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  let data;
  try {
    const ctx = out.getContext('2d');
    ctx.drawImage(v, 0, 0, w, h);
    drawMarks(ctx, w, h, mark.items);
    data = out.toDataURL('image/png').split(',')[1];
  } catch {
    toast('Could not take the frame of the video');
    return;
  }
  imagesOf(s).push({kind: 'image', type: 'image/png', data, name: `${s.name} marked.png`});
  const pins = mark.items.filter(i => i.kind === 'pin' && i.text.trim()).map(i => `(${i.n}) ${i.text.trim()}`);
  if (pins.length) {
    note.value = [note.value.trim(), ...pins].filter(Boolean).join('\n');
    note.dispatchEvent(new Event('input'));
  }
  endMark();
  paintNoteImages();
  toast('The marked image is in the note, send it to Claude');
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

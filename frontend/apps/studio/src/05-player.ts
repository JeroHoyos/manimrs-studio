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
      v.crossOrigin = 'anonymous';  // so a frame can be taken to mark on it
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
  mark = null;
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

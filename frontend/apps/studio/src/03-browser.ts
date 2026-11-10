// ───────────── header ─────────────
function paintQuality() {
  document.querySelectorAll('#quality button').forEach(b => {
    b.classList.toggle('on', b.dataset.q === quality);
    b.setAttribute('aria-pressed', String(b.dataset.q === quality));
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
  const what = esc(inRender ? 'rendering…' : LABEL[s.status]);
  const meta = `<span class="what" title="${what}">${what}</span>`
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

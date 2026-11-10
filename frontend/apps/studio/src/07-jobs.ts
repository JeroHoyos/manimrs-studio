// ───────────── jobs ─────────────
// The engine names the slide it draws; the bar shows its number in the list and how far the render
// is: “Slide 41” and a small progress bar with “3 of 93”.
function jobDetail(j) {
  const last = j.log.at(-1) || 'Starting…';
  const m = /^(drawing|saved) /.test(last) && [...j.log].reverse().map(l => /^drawing (\S+) \((\d+)\/(\d+)\)/.exec(l)).find(Boolean);
  if (!m) return `<span class="detail">${esc(last)}</span>`;
  const pos = j.talk === talk ? data?.slides.find(x => x.active && x.name === m[1])?.pos : null;
  return `${pos ? `<span class="detail">Slide ${pos}</span>` : ''}<span class="detail steps"><span class="progress" aria-hidden="true"><i style="width:${Number(m[2]) / Number(m[3]) * 100}%"></i></span>${m[2]} of ${m[3]}</span>`;
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
function toast(text: string, action?: any) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(String(text).replace(/^Error: /, ''))}</span>${action ? `<button>${esc(action[0])}</button>` : ''}`;
  if (action) t.querySelector('button').onclick = () => { t.classList.remove('visible'); action[1](); };
  t.classList.add('visible');
  clearTimeout(toastClock);
  toastClock = setTimeout(() => t.classList.remove('visible'), action ? 9000 : 3500);
}

async function act(promise: Promise<unknown>, text?: string) {
  try { await promise; if (text) toast(text); await refresh(); }
  catch (e) { toast(String(e)); }
}

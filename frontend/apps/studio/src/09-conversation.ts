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
  const phrases = STEP_KINDS.filter(([k]) => counts.has(k)).map(([k, one, many]: [string, string, (n: number) => string]) => {
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
  if (isNaN(d.getTime())) return;
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

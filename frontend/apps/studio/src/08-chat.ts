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
  plugins: null as any, warnedLimit: false,
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
    notice(`Claude Code is not installed, ${info.install || 'install it and open the app again'}`, 'error');
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

function request(subtype: string, extra: Record<string, unknown> = {}): Promise<any> {
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
    const a = (e.target as Element).closest('button')?.dataset.a;
    if (!a) return;
    if (a === 'deny') { el.querySelector('.feedback').hidden = false; el.querySelector('.feedback input').focus(); return; }
    if (a === 'allow' || a === 'always') {
      const response: Record<string, unknown> = {behavior: 'allow', updatedInput: req.input};
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
    const option = (e.target as Element).closest('.option');
    if (option) {
      const qi = Number(option.closest('.question').dataset.q), oi = Number(option.dataset.o);
      const set = chosen[qi];
      if (questions[qi].multiSelect) set.has(oi) ? set.delete(oi) : set.add(oi);
      else { set.clear(); set.add(oi); }
      option.closest('.options').querySelectorAll('.option').forEach((b, j) => b.classList.toggle('on', set.has(j)));
      if (questions.length === 1 && !questions[0].multiSelect) el.querySelector('[data-a="send"]').click();
      return;
    }
    const a = (e.target as Element).closest('button')?.dataset.a;
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
    const a = (e.target as Element).closest('button')?.dataset.a;
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

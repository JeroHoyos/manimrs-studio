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
  const list: any[] = [
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
  const b = (e.target as Element).closest('.p-item');
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
    const limits = Object.entries(u.rate_limits || {}).filter(([, v]) => v && typeof v === 'object' && (v as any).utilization != null) as [string, any][];
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
        const b = (e.target as Element).closest('button[data-a]');
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
      const f = (e.target as Element).closest('button[data-f]')?.dataset.f;
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
        const del = (e.target as Element).closest('[data-del]')?.dataset.del;
        if (del !== undefined) {
          const r = rules[Number(del)], b = r.behavior || r.ruleBehavior, text = ruleText(r);
          try { await write(r.source, next => { next[b] = (next[b] || []).filter(x => x !== text); }); } catch (err) { toast(String(err.message || err)); }
        } else if ((e.target as Element).closest('#pr-add')) {
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
      const p = (e.target as Element).closest('[data-open]')?.dataset.open;
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
      const b = (e.target as Element).closest('button[data-path]');
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
      const u = (e.target as Element).closest('[data-u]')?.dataset.u;
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
      const b = list[Number((e.target as Element).closest('[data-i]')?.dataset.i)];
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

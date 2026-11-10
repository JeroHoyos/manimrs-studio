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

// A link never loads inside the window, nor in a new one (the middle button asks for that): web
// links go to the browser, anything else stays where it is.
function onLink(e) {
  const a = e.target.closest?.('a[href]');
  if (!a) return;
  e.preventDefault();
  const url = a.getAttribute('href');
  if (/^https?:\/\//i.test(url)) invoke('open_link', {url}).catch(err => toast(String(err)));
  else toast('Only web links open from here');
}
document.addEventListener('click', onLink);
document.addEventListener('auxclick', onLink);

chatEl.addEventListener('click', e => {
  if ((e.target as Element).closest('a[href]')) return;
  const s = (e.target as Element).closest('.c-empty button[data-s]')?.dataset.s;
  if (!s) return;
  const slide = current()?.active ? current().name : '';
  if (s === 'changes') sendToClaude(`/slides ${talk}: apply the changes requested in the review panel (notes tool), one slide at a time`);
  else if (s === 'look') sendToClaude(`/slides ${talk} ${slide}: look at it with “view” and tell me what you would improve, don't change anything yet`);
  else if (s === 'new') { input.value = `/slides ${talk}: a new slide after ${slide} that explains `; autosize(); input.focus(); }
});

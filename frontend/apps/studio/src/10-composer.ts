// ── toolbar: model and effort ──
function models() { return chat.init?.models || []; }
function currentModel() {
  const list = models();
  return list.find(m => m.value === chat.model) || list.find(m => m.resolvedModel === chat.modelId) || list[0];
}

function paintToolbar() {
  const model = currentModel();
  $('#c-model').innerHTML = `${esc(model ? (model.value === 'default' ? 'Default model' : model.displayName) : 'Model')}${icon('down', 'i-small')}`;
  const be = $('#c-effort');
  be.hidden = !(model?.supportsEffort);
  be.innerHTML = `${icon('gauge')}${esc(chat.effort ? `Effort ${chat.effort}` : 'Default effort')}`;
  paintSend();
}

function choiceMenu(anchor, items, onPick) {
  const m = $('#c-choice-menu');
  m.innerHTML = items.map((it, i) => it.head
    ? `<div class="menu-head">${esc(it.head)}</div>`
    : `<button role="menuitemradio" data-i="${i}" aria-checked="${!!it.on}"><span class="two-lines">${esc(it.label)}${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</span>${it.on ? `<span class="check">${icon('check')}</span>` : ''}</button>`).join('');
  m.onclick = e => {
    const b = (e.target as Element).closest('button[data-i]');
    if (!b) return;
    m.hidden = true;
    onPick(items[Number(b.dataset.i)]);
  };
  const r = anchor.getBoundingClientRect();
  m.hidden = false;
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8)) + 'px';
  m.style.top = Math.max(8, r.top - m.offsetHeight - 6) + 'px';
}

$('#c-model').onclick = e => {
  e.stopPropagation();
  if (!models().length) { toast('Claude is still starting'); return; }
  const cur = currentModel();
  choiceMenu(e.currentTarget, [{head: 'Model'}, ...models().map(m => ({label: m.displayName, hint: m.description, value: m.value, on: m === cur}))],
    async it => {
      chat.model = it.value; save('studio.model', it.value);
      paintToolbar();
      if (chat.alive) {
        try { const r = await request('set_model', {model: it.value}); chat.modelId = r.model || chat.modelId; }
        catch (err) { toast(`Could not change the model: ${err.message || err}`); }
      }
      paintToolbar();
    });
};
$('#c-effort').onclick = e => {
  e.stopPropagation();
  const levels = currentModel()?.supportedEffortLevels || ['low', 'medium', 'high'];
  const hints = {low: 'Fastest, for simple tasks', medium: 'Balanced', high: 'More thorough', xhigh: 'Very thorough', max: 'The most thinking, slowest'};
  choiceMenu(e.currentTarget, [{head: 'Effort'}, ...levels.map(l => ({label: l, hint: hints[l], value: l, on: l === chat.effort}))],
    async it => {
      chat.effort = it.value; save('studio.effort', it.value);
      paintToolbar();
      if (chat.alive) {
        try { await request('apply_flag_settings', {settings: {effortLevel: it.value}}); }
        catch (err) { toast(`Could not change the effort: ${err.message || err}`); }
      }
    });
};

// ── composer: slash commands, @ mentions and images ──
let popover = {kind: null, items: [], index: 0, start: 0};

function autosize() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 220) + 'px';
  paintSend();
}

function hidePopover() { $('#c-popover').hidden = true; popover.kind = null; }

function paintPopover() {
  const p = $('#c-popover');
  if (!popover.items.length) {
    p.innerHTML = `<div class="none">${popover.kind === 'slash' ? 'No commands match' : 'No files match'}</div>`;
  } else {
    p.innerHTML = popover.items.map((it, i) => popover.kind === 'slash'
      ? `<button type="button" data-i="${i}" class="${i === popover.index ? 'on' : ''}"><span class="cmd">/${esc(it.name)}${it.argumentHint ? `<em>${esc(it.argumentHint)}</em>` : ''}</span>${it.description ? `<small>${esc(it.description)}</small>` : ''}</button>`
      : `<button type="button" data-i="${i}" class="${i === popover.index ? 'on' : ''}"><span class="cmd">${esc(it)}</span></button>`).join('');
  }
  p.hidden = false;
  p.querySelector('.on')?.scrollIntoView({block: 'nearest'});
}

let mentionClock = null;
function updatePopover() {
  const before = input.value.slice(0, input.selectionStart);
  const slash = input.value.match(/^\/(\S*)$/);
  if (slash && before.length === input.value.length) {
    const q = slash[1].toLowerCase();
    const commands = chat.init?.commands || [];
    popover = {kind: 'slash', start: 0, index: 0,
      items: commands.filter(c => c.name.toLowerCase().includes(q))
        .sort((a, b) => (b.name.toLowerCase().startsWith(q)) - (a.name.toLowerCase().startsWith(q))).slice(0, 40)};
    paintPopover();
    return;
  }
  const mention = before.match(/(^|\s)@([^\s@]*)$/);
  if (mention) {
    const start = before.length - mention[2].length - 1;
    clearTimeout(mentionClock);
    mentionClock = setTimeout(async () => {
      const items = await invoke('find_files', {query: mention[2], talk: talk || null}).catch(() => []);
      popover = {kind: 'mention', start, index: 0, items};
      paintPopover();
    }, 120);
    return;
  }
  hidePopover();
}

function pickPopover(i = popover.index) {
  const it = popover.items[i];
  if (!it) return;
  if (popover.kind === 'slash') {
    input.value = `/${it.name} `;
  } else {
    const end = input.selectionStart;
    const path = /\s/.test(it) ? `"${it}"` : it;
    input.value = input.value.slice(0, popover.start) + `@${path} ` + input.value.slice(end);
    const caret = popover.start + path.length + 2;
    input.setSelectionRange(caret, caret);
  }
  hidePopover();
  input.focus();
  autosize();
}

$('#c-popover').onmousedown = e => {
  const b = (e.target as Element).closest('button[data-i]');
  if (b) { e.preventDefault(); pickPopover(Number(b.dataset.i)); }
};

input.addEventListener('input', () => { autosize(); updatePopover(); });
input.addEventListener('click', updatePopover);
input.addEventListener('blur', () => setTimeout(hidePopover, 150));
input.addEventListener('keydown', e => {
  if (!$('#c-popover').hidden && popover.items.length) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      popover.index = (popover.index + (e.key === 'ArrowDown' ? 1 : -1) + popover.items.length) % popover.items.length;
      paintPopover();
      return;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); pickPopover(); return; }
  }
  if (e.key === 'Escape') {
    if (!$('#c-popover').hidden) { hidePopover(); return; }
    if (chat.running) { e.preventDefault(); interrupt(); }
    return;
  }
  if (e.key === '/' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openPalette(); return; }
  if (e.key === 'Enter') {
    const sendKey = chat.ctrlEnter ? (e.ctrlKey || e.metaKey) : !e.shiftKey && !e.ctrlKey;
    if (sendKey) { e.preventDefault(); $('#composer').requestSubmit(); }
  }
});

$('#composer').onsubmit = e => {
  e.preventDefault();
  if (chat.running && !input.value.trim() && !chat.attachments.length) { interrupt(); return; }
  sendMessage();
};

function paintAttachments() {
  const box = $('#c-attachments');
  box.hidden = !chat.attachments.length;
  box.innerHTML = chat.attachments.map((a, i) => a.kind === 'image'
    ? `<span class="att"><img src="data:${a.type};base64,${a.data}" alt=""><button type="button" data-i="${i}" aria-label="Remove">${icon('x')}</button></span>`
    : `<span class="att file">${icon('file')}<span>${esc(a.name)}</span><button type="button" data-i="${i}" aria-label="Remove">${icon('x')}</button></span>`).join('');
  paintSend();
}
$('#c-attachments').onclick = e => {
  const b = (e.target as Element).closest('button[data-i]');
  if (b) { chat.attachments.splice(Number(b.dataset.i), 1); paintAttachments(); }
};

// An image or a PDF as an attachment in base64.
function readBase64(f, done) {
  if (f.size > 20e6) { toast(`${f.name || 'The file'} is too big, the limit is 20 MB`); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const [, type, data] = String(reader.result).match(/^data:([^;]+);base64,(.*)$/) || [];
    if (data) done({kind: type === 'application/pdf' ? 'pdf' : 'image', type, data, name: f.name || 'image'});
  };
  reader.readAsDataURL(f);
}

const TEXT_FILE = /\.(txt|md|py|js|ts|json|toml|yaml|yml|csv|html|css|rs|xml|ini|cfg|log|tex|sh|ps1|bat|cmd)$/i;
function addFiles(files) {
  for (const f of files) {
    const reader = new FileReader();
    if (f.type.startsWith('image/') || f.type === 'application/pdf') {
      readBase64(f, a => { chat.attachments.push(a); paintAttachments(); });
    } else if (f.type.startsWith('text/') || TEXT_FILE.test(f.name)) {
      if (f.size > 400e3) { toast(`${f.name} is too big to attach as text, mention it with @ instead`); continue; }
      reader.onload = () => { chat.attachments.push({kind: 'text', name: f.name, text: String(reader.result)}); paintAttachments(); };
      reader.readAsText(f);
    } else {
      toast(`${f.name} can't be attached, images, PDFs and text files can`);
    }
  }
}
// The review box takes images too: they go to Claude with the note.
function imagesOf(s) {
  const k = `${talk}/${s.name}`;
  if (!noteImages.has(k)) noteImages.set(k, []);
  return noteImages.get(k);
}
function paintNoteImages() {
  const s = current(), box = $('#r-images');
  if (!s || !box) return;
  const list = imagesOf(s);
  box.hidden = !list.length;
  box.innerHTML = list.map((a, i) => `<span class="att"><img src="data:${a.type};base64,${a.data}" alt=""><button type="button" data-i="${i}" aria-label="Remove image">${icon('x')}</button></span>`).join('');
}
function addNoteImages(files) {
  const s = current();
  if (!s || !files.length) return;
  const images = files.filter(f => f.type.startsWith('image/'));
  if (images.length < files.length) toast('Only images can go with a note');
  for (const f of images) readBase64(f, a => { imagesOf(s).push(a); paintNoteImages(); });
}
function wireNoteImages() {
  paintNoteImages();
  const review = $('#viewer .review');
  $('#r-file').onchange = e => { addNoteImages([...e.target.files]); e.target.value = ''; };
  $('#r-images').onclick = e => {
    const b = (e.target as Element).closest('button[data-i]');
    if (b) { imagesOf(current()).splice(Number(b.dataset.i), 1); paintNoteImages(); }
  };
  $('#note').onpaste = e => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addNoteImages(files); }
  };
  review.ondragover = e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); review.classList.add('drop'); } };
  review.ondragleave = () => review.classList.remove('drop');
  review.ondrop = e => { review.classList.remove('drop'); if (e.dataTransfer.files.length) { e.preventDefault(); addNoteImages([...e.dataTransfer.files]); } };
}

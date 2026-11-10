// ManimRS Studio: the slide browser, the viewer with its review, and the chat with Claude.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// An element of index.html by its selector. The type is loose: the element can be an input, a
// video or a canvas. Typed access to the page is on the roadmap.
const $ = (s: string): any => document.querySelector(s);
const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const load = (k: string, d: string): string => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const save = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch {} };
// A remembered choice, only if it still has the expected shape (otherwise, the default).
const stored = (k, shape) => { const v = load(k, ''); return shape.test(v) ? v : ''; };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const icon = (n, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
// Same as to_name in studio.py: “Git stash, how” → git_stash_how
const toName = t => t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const QUALITIES = ['480p', '720p', '1080p'];
const PENDING = new Set(['new', 'changed', 'transition', 'resolution']);
const LABEL = {
  up_to_date: 'up to date', new: 'not rendered', changed: 'changed', transition: 'previous slide changed',
  shared: 'shared code changed', resolution: 'different resolution', out: 'commented out',
};
const EXPLAIN = {
  new: () => 'Not rendered yet',
  changed: () => 'Changed since the last render',
  transition: s => `The previous slide (${s.previous || 'none'}) changed, so its entrance is outdated`,
  shared: () => 'Shared code (style, components…) changed since its render, it may look different',
  resolution: s => `It is at ${s.quality} and you want it at ${s.resolution}`,
  up_to_date: () => 'The video is up to date',
};
const REVIEW = {
  approved: {icon: 'check', cls: 'approved', text: 'Approved'},
  changes: {icon: 'pencil', cls: 'changes', text: 'Changes requested'},
  to_review: {icon: null, cls: '', text: 'To review'},
};
const toReview = s => s.active && s.status !== 'new' && !['approved', 'changes'].includes(s.review.status);
const FILTERS = [
  {id: 'all', name: 'All', test: () => true, count: false,
   empty: ['This talk has no slides', 'Use “New” or ask Claude to create the first one']},
  {id: 'pending', name: 'Pending', test: s => s.active && PENDING.has(s.status), count: true,
   empty: ['Everything is rendered and up to date', 'When a slide changes, it shows up here']},
  {id: 'review', name: 'To review', test: toReview, count: true,
   empty: ['No slides are waiting for your review', 'The ones rendered again show up here until you approve them']},
];

let base = '', root = '', home = '';
let talks = [];
let talk = load('studio.talk', '');
// The talk's resolution, from its talk.manimrs; while a change is being saved, the old one that a
// refresh brings is not shown.
let quality = '1080p', qualitySaving = 0;
let filter = 'all';
let data = null, jobs = [], listSig = '', sel = null, part = 0, openedByClaude = null;
let mode = 'view';            // view, new, rename, talk (the new talk form) or details (the talk's)
let newTalkDraft = null;      // {place, folder}: the new talk form opened from an empty folder
// The images of each note (“talk/slide” → attachments) until they go to Claude.
// shortcut: they live in memory, so closing the app loses the ones not sent; save them in diapos/ if that hurts
const noteImages = new Map();
// What is being written in each note (“talk/slide” → text) and was not saved or sent yet: going to
// another slide, or to a form, and back keeps it.
const noteDrafts = new Map();
const noteKey = s => `${talk}/${s.name}`;
let warnedFfmpeg = false;
const statusBefore = {};

// Each slide is identified by its name; the commented-out ones, by their line.
const key = s => s.active ? s.name : `#${s.line}`;
const byKey = k => data?.slides.find(s => key(s) === k);
const current = () => byKey(sel);
const actives = () => data.slides.filter(s => s.active);
const talkId = t => talks.find(x => x.id === t)?.id || talks.find(x => x.id === 'charla-' + t)?.id;
const currentFilter = () => FILTERS.find(f => f.id === filter);
// Windows paths, for the place of a talk.
const parentOf = p => String(p).replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '');
const baseName = p => String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop();
// A long path keeps its drive and its last folders, which say the most: C:\…\charlas\charla-git
const shortPath = p => {
  const text = String(p), sep = text.includes('\\') ? '\\' : '/', lead = text.startsWith('/') ? '/' : '';
  const parts = text.split(/[\\/]+/).filter(Boolean);
  return lead + (parts.length > 5 ? [parts[0], '…', ...parts.slice(-3)] : parts).join(sep) || text;
};
const inside = (dir, p) => {
  const norm = s => String(s).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return !!dir && (norm(p) + '/').startsWith(norm(dir) + '/');
};
// Same as talk_folder in studio.py: “Docker from scratch” → charla-docker-from-scratch
const folderName = t => {
  let s = t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').replace(/^charla-/, '');
  if (s.length > 40) s = s.slice(0, 40).replace(/-[^-]*$/, '');
  return s ? 'charla-' + s : '';
};

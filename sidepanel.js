// Annotated.com: the chat, in Chrome's side panel. Everyone with the extension shares one room: write,
// or paste/drop an annotation picture or video (or send it from the bar's Annotated.com button), and
// everyone sees it live, in threads (each reply right under the post it answers). Right-click a post to
// reply, delete it (yours), like it, download it, or copy the source link of an annotation. Search the
// whole chat from the box. Posts live in Supabase (see supabase/setup.sql): anyone can read, you post
// as yourself (an anonymous sign-in kept in this Chrome profile), and you can delete only yours.
// (Signing in with X is switched off for now.)
import { createClient } from './vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_KEY, BUCKET } from './chat-config.js';
import { countX } from './xcount.js';
import { glassify } from './glass.js';

const PAGE = 40; // posts per load
const MAX_BYTES = 50 * 1024 * 1024; // the bucket's limit (Supabase Free plan)
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' };
const MEDIA_MAX_H = 360;
const PATH_OK = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp|gif|mp4|webm)$/;
// What Annotated.com puts on the clipboard beside a copied picture or video: where it's from.
const CLIP_META = 'web application/x-annotated+json';
const CLIP_VIDEO = 'web video/mp4';
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const X_PHOTO = /^https:\/\/pbs\.twimg\.com\//;

const $ = (s) => document.querySelector(s);
const el = {
  online: $('#online'),
  onlineN: $('#onlineN'),
  feed: $('#feed'),
  older: $('#older'),
  list: $('#list'),
  results: $('#results'),
  noResults: $('#noResults'),
  empty: $('#empty'),
  loading: $('#loading'),
  newer: $('#newer'),
  menu: $('#menu'),
  claim: $('#claim'),
  claimForm: $('#claimForm'),
  claimWhat: $('#claimWhat'),
  claimWho: $('#claimWho'),
  claimOk: $('#claimOk'),
  claimErr: $('#claimErr'),
  claimSend: $('#claimSend'),
  claimCancel: $('#claimCancel'),
  banner: $('#banner'),
  bannerText: $('#bannerText'),
  bannerBtn: $('#bannerBtn'),
  composer: $('#composer'),
  replying: $('#replying'),
  unreply: $('#unreply'),
  attach: $('#attach'),
  unattach: $('#unattach'),
  text: $('#text'),
  q: $('#q'),
  find: $('#find'),
  pick: $('#pick'),
  me: $('#me'),
  meName: $('#meName'),
  meX: $('#meX'),
  meXLink: $('#meXLink'),
  meEdit: $('#meEdit'),
  left: $('#left'),
  send: $('#send'),
  file: $('#file'),
  drop: $('#drop'),
};

const state = {
  uid: null,
  name: '',
  me: null, // signed in with X: { handle, photo }
  posts: new Map(), // id -> row
  likes: new Map(), // post id -> Map(user id -> { name, handle, photo })
  oldest: null, // created_at of the oldest post loaded
  newest: null,
  atStart: false,
  loaded: false,
  olderLoad: null, // the load of earlier posts under way
  pending: null, // what you're about to post: { file, kind, ext, url, width, height, seconds, source }
  replyTo: null, // the post you're replying to
  search: null, // searching: { seq, term, rows: Map(id -> row) }
  windowId: null,
  sending: false,
  live: null,
  presence: null,
  seen: new Set(), // posts counted as seen by you (this time the chat is open)
  seenQueue: new Set(), // ... and those still to tell the server about
  viewsOff: false, // the project has no views yet (setup.sql not run again since they came in)
};
window.__chat = { state }; // handy when debugging the panel

// Closing Annotated.com (the bar's ✕, Esc, the icon) closes the chat in that window. Chrome 141 and
// later do it themselves; before that, this page closes itself when asked.
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'chat:close') return;
  const here = msg.windowId == null || state.windowId == null || msg.windowId === state.windowId;
  if (here) window.close();
});

// Your sign-in is kept in the extension's storage, so the chat knows you next time.
const store = {
  getItem: async (k) => {
    const v = (await chrome.storage.local.get(k))[k];
    return v == null ? null : v;
  },
  setItem: (k, v) => chrome.storage.local.set({ [k]: v }),
  removeItem: (k) => chrome.storage.local.remove(k),
};
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storage: store, storageKey: 'chat-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
});

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const dayYearFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function dayLabel(d) {
  const now = new Date();
  if (dayKey(d) === dayKey(now)) return 'Today';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(y)) return 'Yesterday';
  return (d.getFullYear() === now.getFullYear() ? dayFmt : dayYearFmt).format(d);
}
// "Today at 12:15 AM", "Yesterday at 9:05 PM", "Mon, Oct 12 at 9:05 PM".
function whenLabel(d) {
  return `${dayLabel(d)} at ${timeFmt.format(d)}`;
}

// When it was posted and how many people have seen it, like X: "Oct 13, 2026 · 5:04 AM · 212 Views"
// (the number in bold). Without views in the project yet, just the date and time.
const countFmt = new Intl.NumberFormat(undefined);
const bigFmt = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
function viewCount(n) {
  return n < 10000 ? countFmt.format(n) : bigFmt.format(n);
}
function makeWhen(p) {
  const d = new Date(p.created_at);
  const w = node('span', 'when');
  const t = node('time', '', `${dayYearFmt.format(d)} · ${timeFmt.format(d)}`);
  t.dateTime = p.created_at;
  t.title = fullFmt.format(d);
  w.append(t);
  if (Number.isFinite(p.views)) w.append(makeViews(p.views));
  return w;
}
function makeViews(n) {
  const v = node('span', 'views');
  v.append(' · ', node('b', '', viewCount(n)), n === 1 ? ' View' : ' Views');
  return v;
}

function hueOf(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
function initial(name) {
  const c = [...String(name || '?').replace(/^@/, '').trim()][0] || '?';
  return c.toUpperCase();
}
function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
function fmtDur(s) {
  s = Math.max(0, Math.round(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function publicUrl(path) {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}
function icon(id) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'i');
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', '#' + id);
  s.append(u);
  return s;
}
function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function isWebLink(s) {
  return typeof s === 'string' && /^https?:\/\//i.test(s) && s.length <= 2048;
}

// Text with its web links clickable (only http and https).
function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /\bhttps?:\/\/[^\s<>"']+/gi;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    let url = m[0].replace(/[),.;:!?\]]+$/, '');
    if (m.index > last) frag.append(text.slice(last, m.index));
    const a = node('a', '', url);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    frag.append(a);
    last = m.index + url.length;
    re.lastIndex = last;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

// Marks what you searched for, in the text of a result.
function mark(root, term) {
  const needle = term.toLowerCase();
  if (!needle) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) hits.push(n);
  for (const n of hits) {
    const t = n.nodeValue;
    const low = t.toLowerCase();
    let i = low.indexOf(needle);
    if (i < 0) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    while (i >= 0) {
      frag.append(t.slice(last, i), node('mark', '', t.slice(i, i + needle.length)));
      last = i + needle.length;
      i = low.indexOf(needle, last);
    }
    frag.append(t.slice(last));
    n.replaceWith(frag);
  }
}

// A post in a few words: its text, or "Picture"/"Video".
function gist(text, media) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t) return t;
  return media === 'video' ? 'Video' : media === 'image' ? 'Picture' : '';
}

function friendly(e) {
  const msg = String((e && (e.message || e.error_description || e.error)) || e || 'Something went wrong.');
  if (/failed to fetch|network|load failed/i.test(msg)) return 'Couldn’t reach the chat. Check your connection and try again.';
  if (e && e.status === 429) return 'Too many new sign-ins from your network right now. Try again in a little while.';
  return msg;
}

/* ------------------------------------------------------------------ */
/* Who's who: a name, or an X account                                  */
/* ------------------------------------------------------------------ */

// A post's (or a like's) X handle and photo, as the server put them on (never typed by anyone).
function xOf(p) {
  const handle = p && X_HANDLE.test(p.x_handle || '') ? p.x_handle : null;
  const photo = handle && X_PHOTO.test(p.x_avatar || '') ? p.x_avatar.replace(/_normal(\.\w+)$/, '_bigger$1') : null;
  return { handle, photo };
}
function displayName(p) {
  const { handle } = xOf(p);
  return handle ? '@' + handle : p.name;
}

// The round picture beside a post: their X photo, or their initial on their colour.
function makeAvatar(p, cls = 'avatar') {
  const { photo } = xOf(p);
  const letter = () => {
    const d = node('span', cls, initial(displayName(p)));
    d.style.setProperty('--h', hueOf(p.user_id || p.name || ''));
    d.setAttribute('aria-hidden', 'true');
    return d;
  };
  if (!photo) return letter();
  const img = document.createElement('img');
  img.className = cls;
  img.alt = '';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.src = photo;
  img.addEventListener('error', () => img.replaceWith(letter()), { once: true });
  return img;
}

// Their name: "@handle" (underlined; opens their X profile) when they signed in with X.
function makeName(p) {
  const { handle } = xOf(p);
  if (!handle) return node('span', 'name', p.name);
  const a = node('a', 'name', '@' + handle);
  a.href = 'https://x.com/' + handle;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.title = `@${handle} on X`;
  return a;
}

const ADJ = ['Brisk', 'Calm', 'Clever', 'Bold', 'Bright', 'Curious', 'Gentle', 'Glad', 'Keen', 'Kind', 'Lucky', 'Merry', 'Nimble', 'Quiet', 'Quick', 'Sunny', 'Swift', 'Witty', 'Wise', 'Steady', 'Plucky', 'Mellow', 'Breezy', 'Sharp'];
const ANIMALS = ['Heron', 'Otter', 'Fox', 'Lynx', 'Robin', 'Badger', 'Falcon', 'Panda', 'Koala', 'Marten', 'Puffin', 'Raven', 'Seal', 'Swan', 'Tiger', 'Whale', 'Wren', 'Yak', 'Bison', 'Crane', 'Dingo', 'Gecko', 'Ibis', 'Moose'];
function randomName() {
  const r = crypto.getRandomValues(new Uint32Array(2));
  return `${ADJ[r[0] % ADJ.length]} ${ANIMALS[r[1] % ANIMALS.length]}`;
}
// A name can't pass for an @handle (the server checks too).
function cleanName(s) {
  return String(s || '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[@＠﹫\s]+/, '')
    .trim()
    .slice(0, 40);
}

async function loadName() {
  let { chatName } = await chrome.storage.local.get('chatName');
  chatName = cleanName(chatName);
  if (!chatName) {
    chatName = randomName();
    await chrome.storage.local.set({ chatName });
  }
  setName(chatName);
}
function setName(n) {
  state.name = n;
  el.meName.textContent = n;
  el.me.setAttribute('aria-label', `Posting as ${n}. Change your name`);
}

function editName() {
  el.me.hidden = true;
  el.meEdit.hidden = false;
  el.meEdit.value = state.name;
  el.meEdit.focus();
  el.meEdit.select();
}
async function endEditName(save) {
  if (el.meEdit.hidden) return;
  const n = cleanName(el.meEdit.value);
  el.meEdit.hidden = true;
  showMe();
  if (save && n && n !== state.name) {
    setName(n);
    await chrome.storage.local.set({ chatName: n });
  }
  el.text.focus();
}

async function ensureSignedIn() {
  if (state.uid) return state.uid;
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (session && session.user) {
    state.uid = session.user.id;
    setMe(session.user);
    return state.uid;
  }
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  state.uid = data.user.id;
  setMe(data.user);
  return state.uid;
}

// The X account you're signed in with, from your sign-in (Supabase's own record of it).
function xProfile(user) {
  const id = user && (user.identities || []).find((i) => i.provider === 'x' || i.provider === 'twitter');
  const d = (id && id.identity_data) || {};
  const handle = d.user_name || d.preferred_username;
  if (!X_HANDLE.test(handle || '')) return null;
  const photo = d.avatar_url || d.picture || '';
  return { handle, photo: X_PHOTO.test(photo) ? photo.replace(/_normal(\.\w+)$/, '_bigger$1') : '' };
}

function setMe(user) {
  state.me = xProfile(user);
  showMe();
}

// "Posting as Keen Fox ✎" (click to change it), or, for an account linked to X, "Posting as @KeenFox"
// (opens the X profile). (Signing in with X is switched off for now.)
function showMe() {
  const x = state.me;
  el.me.hidden = !!x || !el.meEdit.hidden;
  el.meX.hidden = !x;
  if (x) {
    el.meXLink.textContent = '@' + x.handle;
    el.meXLink.href = 'https://x.com/' + x.handle;
    el.meXLink.title = `@${x.handle} on X`;
  }
}

/* ------------------------------------------------------------------ */
/* The feed                                                            */
/* ------------------------------------------------------------------ */

const nodes = new Map(); // post id -> <li> in the feed
const dayNodes = new Map(); // day -> <li class="day">

function byTime(a, b) {
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1;
}

function nearBottom() {
  const f = el.feed;
  return f.scrollHeight - f.scrollTop - f.clientHeight < 80;
}
function toBottom() {
  el.feed.scrollTop = el.feed.scrollHeight;
  el.newer.hidden = true;
}

// Size a picture or video box before it loads (so the feed doesn't jump): as wide as the panel allows,
// never wider than the file, never taller than MEDIA_MAX_H.
function sizeBox(box, w, h) {
  if (!(w > 0 && h > 0)) return false;
  const r = Math.min(10, Math.max(0.1, w / h)); // (the sizes come with the post: a sane shape only)
  box.style.aspectRatio = `${w} / ${h}`;
  box.style.width = `min(100%, ${Math.round(MEDIA_MAX_H * r)}px, ${w}px)`;
  return true;
}

function makeMedia(p) {
  if (!PATH_OK.test(p.media_path || '')) return node('div', 'media missing', 'This attachment can’t be shown.');
  const url = publicUrl(p.media_path);
  const gone = (box) => {
    box.replaceWith(node('div', 'media missing', p.media_type === 'video' ? 'This video is no longer available.' : 'This picture is no longer available.'));
  };
  if (p.media_type === 'video') {
    const box = node('div', 'media');
    const v = document.createElement('video');
    v.controls = true;
    v.preload = 'metadata';
    v.playsInline = true;
    v.src = url;
    if (sizeBox(box, p.media_width, p.media_height)) {
      v.style.width = '100%';
      v.style.height = '100%';
    }
    v.addEventListener('error', () => gone(box), { once: true });
    box.append(v);
    return box;
  }
  const a = node('a', 'media');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.title = 'Open full size';
  const img = document.createElement('img');
  img.alt = p.body ? '' : `Picture posted by ${displayName(p)}`;
  img.decoding = 'async';
  img.loading = 'lazy';
  img.src = url;
  if (sizeBox(a, p.media_width, p.media_height)) {
    a.style.display = 'block';
    img.style.width = '100%';
    img.style.height = '100%';
  }
  img.addEventListener('error', () => gone(a), { once: true });
  a.append(img);
  return a;
}


// The quote at the top of a reply: who, their picture or video (small), their first words. Click it
// to go to the post it answers.
// On a reply that stands on its own (its post isn't in the feed), whom it answers: click to go there.
function makeReplyTo(p) {
  if (!p.reply_to && !p.reply_name && !p.reply_gone) return null;
  const r = node('button', 'replyto');
  r.type = 'button';
  r.append(icon('i-reply'), node('span', '', p.reply_gone ? 'Reply to a deleted post' : `Reply to ${p.reply_name || 'a post'}`));
  if (p.reply_gone) r.disabled = true;
  else {
    r.title = 'Go to the post it answers';
    r.addEventListener('click', (e) => {
      e.stopPropagation();
      jumpTo(p.reply_to);
    });
  }
  return r;
}

function likesOf(id) {
  let m = state.likes.get(id);
  if (!m) state.likes.set(id, (m = new Map()));
  return m;
}
function likeFrom(l) {
  const { handle, photo } = xOf(l);
  return { name: l.name, handle, photo };
}

// 👍 under a post: who liked it (up to three faces, then a number); yours is blue. Click it to like or
// unlike.
function makeLikes(p) {
  const m = state.likes.get(p.id);
  if (!m || !m.size) return null;
  const b = node('button', 'likes');
  b.type = 'button';
  const mine = !!state.uid && m.has(state.uid);
  b.classList.toggle('mine', mine);
  b.append(node('span', 'emo', '👍'));
  const who = [...m.entries()];
  if (who.length <= 3) {
    const faces = node('span', 'faces');
    for (const [uid, l] of who) faces.append(makeAvatar({ user_id: uid, name: l.name, x_handle: l.handle, x_avatar: l.photo }, 'face'));
    b.append(faces);
  } else {
    b.append(node('span', 'n', String(who.length)));
  }
  const names = who.map(([uid, l]) => (uid === state.uid ? 'you' : l.handle ? '@' + l.handle : l.name));
  const list = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  b.title = `Liked by ${list}. ${mine ? 'Click to take your like back.' : 'Click to like.'}`;
  b.setAttribute('aria-label', `${who.length} ${who.length === 1 ? 'like' : 'likes'}: ${list}`);
  b.setAttribute('aria-pressed', String(mine));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleLike(p);
  });
  return b;
}

// A picture or video made with Annotated.com (it carries its source link).
const isAnnotation = (p) => !!(p.media_path && p.source && p.media_type);
// Only annotations go to everyone (from the bar, or pasted or dropped in); everything else is a reply to
// one, right under it. A reply can't be replied to.
const canReply = (p) => !!p && isAnnotation(p) && !p.reply_to && !p.reply_gone;

// One post. In the feed it's remembered by id (so it's never rebuilt while a video plays); a search
// result is a copy with what you searched for marked.
function makePost(p, { hit = null } = {}) {
  const li = node('li', 'post');
  li.dataset.id = p.id;
  li.tabIndex = 0;
  const mine = !!state.uid && p.user_id === state.uid;
  if (mine) li.classList.add('mine');
  if (isAnnotation(p)) return makeAnnotationPost(li, p, { hit, mine });

  const body = node('div', 'body');
  const meta = node('div', 'meta');
  meta.append(makeName(p));
  if (mine) meta.append(node('span', 'you', 'you'));
  const d = new Date(p.created_at);
  meta.append(makeWhen(p));
  body.append(meta);
  const rt = makeReplyTo(p);
  if (rt) body.append(rt);
  if (p.body) {
    const tx = node('p', 'text');
    tx.append(linkify(p.body));
    if (hit) mark(tx, hit);
    body.append(tx);
  }
  if (p.media_path) body.append(makeMedia(p));
  const lk = makeLikes(p);
  if (lk) body.append(lk);
  li.append(makeAvatar(p), body);
  li.setAttribute('aria-label', `${displayName(p)}${mine ? ' (you)' : ''}, ${whenLabel(d)}: ${gist(p.body, p.media_type)}`);
  if (!hit) keepNode(p.id, li);
  return li;
}

// An annotation takes the whole post: the picture or video edge to edge, with who posted it, when, and
// how many have seen it on a small white label at its top left, on the picture (their face, then their
// name over the date, time and views). Whom it answers and any words they added go under it.
function makeAnnotationPost(li, p, { hit, mine }) {
  li.classList.add('annot');
  const body = node('div', 'body');
  const card = node('div', 'card');
  const meta = node('div', 'meta');
  const who = node('span', 'who');
  who.append(makeName(p));
  if (mine) who.append(node('span', 'you', 'you'));
  meta.append(makeAvatar(p), who, makeWhen(p));
  card.append(meta, makeMedia(p));
  const head = node('div', 'head');
  const rt = makeReplyTo(p);
  if (rt) head.append(rt);
  if (p.body) {
    const tx = node('p', 'text');
    tx.append(linkify(p.body));
    if (hit) mark(tx, hit);
    head.append(tx);
  }
  if (head.firstChild) card.append(head);
  body.append(card);
  const lk = makeLikes(p);
  if (lk) body.append(lk);
  li.append(body);
  const d = new Date(p.created_at);
  li.setAttribute('aria-label', `${displayName(p)}${mine ? ' (you)' : ''}, ${whenLabel(d)}: ${gist(p.body, p.media_type)}`);
  if (!hit) keepNode(p.id, li);
  return li;
}

// A post in the feed, remembered by id; it counts as seen by you once it has been on screen.
function keepNode(id, li) {
  nodes.set(id, li);
  if (!state.seen.has(id)) seenWatch.observe(li);
}

/* ------------------------------------------------------------------ */
/* Views: how many people have seen each post, like X                  */
/* ------------------------------------------------------------------ */

// A post is seen once at least half of it (or half the feed, for a tall one) has been in view. The
// server counts each person once per post; only the count is public.
const seenWatch = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const box = e.rootBounds;
      if (e.intersectionRatio < 0.5 && !(box && e.intersectionRect.height >= box.height * 0.5)) continue;
      const id = e.target.dataset.id;
      seenWatch.unobserve(e.target);
      if (!id || state.seen.has(id)) continue;
      state.seen.add(id);
      state.seenQueue.add(id);
    }
    if (state.seenQueue.size) tellSeen();
  },
  { root: el.feed, threshold: [0, 0.25, 0.5, 0.75, 1] },
);

// What you've seen goes to the server in small batches.
let seenTimer = 0;
function tellSeen() {
  if (seenTimer || state.viewsOff) return;
  seenTimer = setTimeout(async () => {
    seenTimer = 0;
    if (!state.uid || state.viewsOff) return;
    const ids = [...state.seenQueue].slice(0, 100);
    ids.forEach((id) => state.seenQueue.delete(id));
    const { error } = await sb.rpc('chat_seen', { ids });
    if (error && (error.code === 'PGRST202' || error.code === '42883')) state.viewsOff = true; // (not set up)
    if (state.seenQueue.size) tellSeen();
  }, 700);
}

// Someone saw a post: its count goes up in place (a playing video keeps playing).
function showViews(id) {
  const p = state.posts.get(id) || (state.search && state.search.rows.get(id));
  if (!p || !Number.isFinite(p.views)) return;
  for (const li of [nodes.get(id), el.results.querySelector(`.post[data-id="${CSS.escape(id)}"]`)]) {
    const w = li && li.querySelector('.when');
    if (!w) continue;
    const old = w.querySelector('.views');
    const fresh = makeViews(p.views);
    if (old) old.replaceWith(fresh);
    else w.append(fresh);
  }
}

// Redraw one post's likes in place (a playing video keeps playing), in the feed and in search results.
function renderLikes(id) {
  const p = state.posts.get(id) || (state.search && state.search.rows.get(id));
  if (!p) return;
  const stick = nearBottom();
  for (const li of [nodes.get(id), el.results.querySelector(`.post[data-id="${CSS.escape(id)}"]`)]) {
    if (!li) continue;
    const body = li.querySelector('.body');
    const old = body.querySelector(':scope > .likes');
    const fresh = makeLikes(p);
    if (old && fresh) old.replaceWith(fresh);
    else if (old) old.remove();
    else if (fresh) body.append(fresh);
  }
  if (stick && !state.search) toBottom();
}

function dayNode(d) {
  const k = dayKey(d);
  let n = dayNodes.get(k);
  if (!n) {
    n = node('li', 'day');
    n.setAttribute('role', 'separator');
    dayNodes.set(k, n);
  }
  const label = dayLabel(d); // (kept up to date: after midnight, "Today" becomes "Yesterday")
  if (n.textContent !== label) n.textContent = label;
  return n;
}

// Threads, like on X, one post below another: the posts in order (the newest at the bottom, by the box),
// each followed by the replies to it, a reply to a reply right under that one, and so on (oldest first
// at each level). A reply whose post isn't here (deleted, or further back than what's loaded) stands on
// its own, saying whom it answers.
const MAX_DEPTH = 4; // (how deep a reply is, kept on it as --depth; the layout doesn't indent)
function threadOrder() {
  const all = [...state.posts.values()].sort(byTime);
  const kids = new Map();
  const roots = [];
  for (const p of all) {
    const parent = p.reply_to ? state.posts.get(p.reply_to) : null;
    if (parent && parent.id !== p.id) {
      if (!kids.has(parent.id)) kids.set(parent.id, []);
      kids.get(parent.id).push(p);
    } else roots.push(p);
  }
  const out = [];
  const seen = new Set();
  const walk = (p, depth) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    out.push({ p, depth, kids: (kids.get(p.id) || []).length });
    for (const c of kids.get(p.id) || []) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  for (const p of all) walk(p, 0); // (only if replies ever went round in a circle)
  return out;
}

// Put the feed in order without rebuilding it (a playing video keeps playing).
function render({ arrive = null } = {}) {
  const items = threadOrder();
  const want = [];
  let prevDay = null;
  for (const { p, depth, kids } of items) {
    const d = new Date(p.created_at);
    const k = dayKey(d);
    if (depth === 0 && k !== prevDay) {
      want.push(dayNode(d));
      prevDay = k;
    }
    const li = nodes.get(p.id) || makePost(p);
    // Every post has its own name line, with its date, time and views, like X.
    li.classList.toggle('reply', depth > 0);
    li.classList.toggle('has-kids', kids > 0);
    li.classList.toggle('orphan', depth === 0 && !!(p.reply_to || p.reply_name || p.reply_gone));
    li.style.setProperty('--depth', String(Math.min(depth, MAX_DEPTH)));
    if (arrive && arrive.has(p.id)) li.classList.add('arrive');
    want.push(li);
  }
  let cur = el.list.firstChild;
  for (const n of want) {
    if (n === cur) {
      cur = cur.nextSibling;
      continue;
    }
    el.list.insertBefore(n, cur);
  }
  while (cur) {
    const next = cur.nextSibling;
    cur.remove();
    cur = next;
  }
  for (const [id, n] of nodes) {
    if (state.posts.has(id)) continue;
    seenWatch.unobserve(n);
    nodes.delete(id);
  }
  for (const [k, n] of dayNodes) if (!n.isConnected) dayNodes.delete(k);
  el.empty.hidden = !state.loaded || items.length > 0 || !!(state.search && state.search.term);
}

// A post changed (its quote's post was deleted, or its poster signed in with X): draw it again.
function redraw(id) {
  const li = nodes.get(id);
  if (!li) return;
  seenWatch.unobserve(li);
  nodes.delete(id);
  const fresh = makePost(state.posts.get(id));
  fresh.className = li.className.replace(/\barrive\b/, '');
  fresh.style.cssText = li.style.cssText; // its place in the thread
  const focused = li.contains(document.activeElement);
  li.replaceWith(fresh);
  if (menu.li === li) menu.li = fresh;
  if (menu.prev === li) menu.prev = fresh;
  if (focused) fresh.focus({ preventScroll: true });
}

function addPosts(rows, { live = false, mine = false } = {}) {
  const fresh = new Set();
  for (const p of rows) {
    if (!p || !p.id || state.posts.has(p.id)) continue;
    state.posts.set(p.id, p);
    fresh.add(p.id);
    if (!state.oldest || p.created_at < state.oldest) state.oldest = p.created_at;
    if (!state.newest || p.created_at > state.newest) state.newest = p.created_at;
  }
  if (!fresh.size) return;
  const stick = mine || nearBottom();
  render({ arrive: live || mine ? fresh : null });
  if (state.search) return loadLikes([...fresh]);
  // A reply goes under the post it answers, which may be further up: yours is brought into view there;
  // someone else's leaves you where you are (with "New posts" if it's out of sight).
  const last = [...fresh].pop();
  const lp = state.posts.get(last);
  const inThread = !!(lp && lp.reply_to && state.posts.has(lp.reply_to));
  if (live || mine) state.lastArrived = last;
  if (mine && inThread) revealPost(last);
  else if (stick && !inThread) toBottom();
  else if (live && !inView(nodes.get(last))) el.newer.hidden = false;
  loadLikes([...fresh]);
}

function inView(li) {
  if (!li) return true;
  const r = li.getBoundingClientRect();
  const f = el.feed.getBoundingClientRect();
  return r.bottom > f.top && r.top < f.bottom;
}

// Bring a post into view (centred if it was out of sight) and flash it.
function revealPost(id) {
  const li = nodes.get(id);
  if (!li) return;
  if (!inView(li)) li.scrollIntoView({ block: 'center' });
  li.classList.remove('flash');
  void li.offsetWidth;
  li.classList.add('flash');
}

// "New posts": to the newest arrival (in its thread, or at the bottom).
function toNewest() {
  el.newer.hidden = true;
  const id = state.lastArrived;
  const p = id && state.posts.get(id);
  if (p && p.reply_to && state.posts.has(p.reply_to)) return revealPost(id);
  toBottom();
}

function dropPost(id) {
  state.likes.delete(id);
  if (state.replyTo && state.replyTo.id === id) setReply(null);
  if (menu.post && menu.post.id === id) closeMenu();
  if (claimFor && claimFor.id === id && el.claim.open) claimError('That post has just been deleted.');
  if (state.search && state.search.rows.delete(id)) {
    const li = el.results.querySelector(`.post[data-id="${CSS.escape(id)}"]`);
    if (li) li.remove();
  }
  if (!state.posts.delete(id)) return;
  render();
}

// Who liked the posts on screen (in batches of 100). What the server has replaces what's here, so
// likes taken back while the chat wasn't listening go too.
async function loadLikes(ids) {
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await sb.from('likes').select('*').in('message_id', chunk);
    if (error) return;
    const fresh = new Map(chunk.map((id) => [id, new Map()]));
    for (const l of data) if (fresh.has(l.message_id)) fresh.get(l.message_id).set(l.user_id, likeFrom(l));
    for (const [id, m] of fresh) {
      const old = state.likes.get(id);
      if (old ? old.size === m.size && [...m.keys()].every((u) => old.has(u)) : !m.size) continue;
      if (m.size) state.likes.set(id, m);
      else state.likes.delete(id);
      renderLikes(id);
    }
  }
}

async function loadLatest() {
  const { data, error } = await sb.from('messages').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE);
  if (error) throw error;
  if (data.length) state.viewsOff = !('views' in data[0]); // (the project counts views once setup.sql has been run again)
  if (data.length < PAGE) state.atStart = true;
  addPosts(data.reverse());
}

// Earlier posts (one load at a time: asking again while one is under way waits for that one).
function loadOlder() {
  if (state.atStart || !state.oldest) return Promise.resolve();
  if (!state.olderLoad) state.olderLoad = loadOlderNow().finally(() => (state.olderLoad = null));
  return state.olderLoad;
}

async function loadOlderNow() {
  el.older.hidden = false;
  const fromBottom = el.feed.scrollHeight - el.feed.scrollTop;
  try {
    const { data, error } = await sb.from('messages').select('*').lt('created_at', state.oldest).order('created_at', { ascending: false }).limit(PAGE);
    if (error) throw error;
    if (data.length < PAGE) state.atStart = true;
    const keep = nearBottom();
    const fresh = [];
    for (const p of data) {
      if (state.posts.has(p.id)) continue;
      state.posts.set(p.id, p);
      fresh.push(p.id);
      if (p.created_at < state.oldest) state.oldest = p.created_at;
    }
    render();
    if (!keep && !state.search) el.feed.scrollTop = el.feed.scrollHeight - fromBottom;
    loadLikes(fresh);
  } catch (e) {
    setBanner(friendly(e));
  } finally {
    el.older.hidden = true;
  }
}

// After (re)connecting, pick up anything posted while the connection was down.
async function catchUp() {
  if (!state.loaded) return;
  if (!state.newest) return loadLatest().catch(() => {});
  for (let page = 0; page < 10; page++) {
    const { data, error } = await sb.from('messages').select('*').gte('created_at', state.newest).order('created_at', { ascending: true }).limit(100);
    if (error) break;
    const before = state.newest;
    addPosts(data, { live: true });
    if (data.length < 100 || state.newest === before) break;
  }
  await dropGone();
  loadLikes([...state.posts.values()].sort(byTime).slice(-PAGE).map((p) => p.id));
}

// Posts deleted while the chat wasn't listening go from here too.
async function dropGone() {
  const ids = [...state.posts.keys()];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await sb.from('messages').select('id').in('id', chunk);
    if (error) return;
    const there = new Set(data.map((r) => r.id));
    for (const id of chunk) if (!there.has(id) && state.posts.has(id)) dropPost(id);
  }
}

// Go to a post (the one a reply quotes, a search result), loading earlier posts until it's there.
async function jumpTo(id) {
  if (!id) return;
  if (state.search) closeSearch({ keepScroll: true });
  for (let i = 0; i < 40 && !nodes.get(id) && !state.atStart; i++) await loadOlder();
  const li = nodes.get(id);
  if (!li) return setBanner('That post isn’t in the chat anymore.', { ms: 3000 });
  li.scrollIntoView({ block: 'center', behavior: 'smooth' });
  li.classList.remove('flash');
  void li.offsetWidth;
  li.classList.add('flash');
}

/* ------------------------------------------------------------------ */
/* Live: new, changed and deleted posts, likes, and who's here         */
/* ------------------------------------------------------------------ */

function goLive() {
  state.live = sb
    .channel('chat-feed')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: p }) => addPosts([p], { live: true }))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, ({ new: row }) => {
      if (!row || !row.id) return;
      const was = state.posts.get(row.id) || (state.search && state.search.rows.get(row.id));
      const p = { ...(was || {}), ...row };
      if (state.search && state.search.rows.has(p.id)) state.search.rows.set(p.id, p);
      if (state.posts.has(p.id)) state.posts.set(p.id, p);
      // Just seen by someone: the count goes up in place. Anything else: the post is drawn again.
      const onlyViews = !!was && Object.keys(row).every((k) => k === 'views' || k === 'created_at' || String(row[k]) === String(was[k]));
      if (onlyViews) return showViews(p.id);
      if (state.posts.has(p.id)) redraw(p.id);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, ({ old }) => old && dropPost(old.id))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'likes' }, ({ new: l }) => onLike(l))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'likes' }, ({ new: l }) => onLike(l))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'likes' }, ({ old: l }) => {
      if (!l || !state.likes.has(l.message_id)) return;
      state.likes.get(l.message_id).delete(l.user_id);
      renderLikes(l.message_id);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (el.banner.dataset.kind === 'live') setBanner(null);
        catchUp();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setBanner('Reconnecting to the chat…', { kind: 'live' });
      }
    });

  const key = crypto.randomUUID(); // (not your account's id, which is on your posts)
  state.presence = sb.channel('chat-online', { config: { presence: { key } } });
  state.presence
    .on('presence', { event: 'sync' }, () => {
      const n = Object.keys(state.presence.presenceState()).length;
      el.onlineN.textContent = `${n} online`;
      el.online.hidden = n < 1;
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') await state.presence.track({ at: Date.now() }).catch(() => {});
    });
}

function onLike(l) {
  if (!l || !(state.posts.has(l.message_id) || (state.search && state.search.rows.has(l.message_id)))) return;
  likesOf(l.message_id).set(l.user_id, likeFrom(l));
  renderLikes(l.message_id);
}

/* ------------------------------------------------------------------ */
/* Reply, like, delete, copy the source link                           */
/* ------------------------------------------------------------------ */

// Reply (right-click a post → Reply): above the box, only the caption of what you're answering (cut
// from their annotation: the white part under its thin black line), or the words of a text post; the
// post itself is outlined in the chat. Your post goes under theirs. ✕ or Esc stops replying.
function setReply(p) {
  if (p && !canReply(p)) return; // (only an annotation can be replied to)
  for (const li of el.list.querySelectorAll('.post.target')) li.classList.remove('target');
  if (p && nodes.get(p.id)) nodes.get(p.id).classList.add('target');
  state.replyTo = p;
  updateSend(); // the box opens for the reply (and closes again without one)
  if (!p) {
    el.replying.hidden = true;
    setDockHeight();
    return;
  }
  el.replying.style.setProperty('--h', hueOf(p.user_id || p.name || ''));
  el.replying.setAttribute('aria-label', `Replying to ${displayName(p)}${p.body ? ': ' + gist(p.body, p.media_type) : ''}`);
  const cap = el.replying.querySelector('.qcapbox');
  const txt = el.replying.querySelector('.qtext');
  cap.hidden = true;
  txt.textContent = p.body || '';
  txt.hidden = !p.body;
  el.replying.hidden = false;
  setDockHeight();
  el.text.focus();
  if (p.media_path && PATH_OK.test(p.media_path)) {
    captionOf(p).then((c) => {
      if (state.replyTo !== p || !c) return;
      showCaption(cap, c);
      txt.hidden = true; // only the caption
      setDockHeight();
    });
  }
}

// The caption of an annotation, cut from its picture (or a video's first frame): the white part under
// the thin black line at the bottom, trimmed to what's written there. null if it hasn't got one.
const captions = new Map(); // post id -> canvas | null
function captionOf(p) {
  if (!captions.has(p.id)) captions.set(p.id, frameOf(p).then(cutCaption).catch(() => null));
  return captions.get(p.id);
}

async function frameOf(p) {
  const url = publicUrl(p.media_path);
  if (p.media_type !== 'video') {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    const blob = await r.blob();
    // (A picture's size is checked before it's decoded: a small file can still be a huge picture.)
    const size = await pictureSize(blob);
    if (!size || !(size.w * size.h <= 40e6)) throw new Error('too big');
    return createImageBitmap(blob);
  }
  const v = document.createElement('video');
  v.crossOrigin = 'anonymous';
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url + '#t=0.05';
  try {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('slow')), 15000);
      v.addEventListener('loadeddata', () => (clearTimeout(t), res()), { once: true });
      v.addEventListener('error', () => (clearTimeout(t), rej(new Error('video'))), { once: true });
    });
    const c = new OffscreenCanvas(v.videoWidth, v.videoHeight);
    c.getContext('2d').drawImage(v, 0, 0);
    return c;
  } finally {
    v.removeAttribute('src');
    v.load();
  }
}

// A picture's size from its first bytes (PNG, GIF, JPEG, WebP), without decoding it.
async function pictureSize(blob) {
  const b = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
  const u16 = (i) => (b[i] << 8) | b[i + 1];
  const u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  if (b.length < 30) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { w: u32(16), h: u32(20) };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff || b[i + 1] === 0xff) {
        i++;
        continue;
      }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u16(i + 7), h: u16(i + 5) };
      i += 2 + u16(i + 2);
    }
    return null;
  }
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (kind === 'VP8 ') return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
    if (kind === 'VP8L') {
      const v = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
      return { w: (v & 0x3fff) + 1, h: ((v >>> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

function cutCaption(src) {
  const W = src.width;
  const H = src.height;
  if (!(W > 20 && H > 20)) return null;
  const c = new OffscreenCanvas(W, H);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, 0, 0);
  const d = x.getImageData(0, 0, W, H).data;
  const N = Math.min(W, 240);
  const cols = Array.from({ length: N }, (_, i) => Math.floor(((i + 0.5) * W) / N));
  const lum = (px, py) => {
    const i = (py * W + px) * 4;
    return (d[i] + d[i + 1] + d[i + 2]) / 3;
  };
  // A row of the line: a long run of near-black across the picture (at least 60% of it).
  const lineRun = (py) => {
    let run = 0;
    let best = null;
    let start = 0;
    for (let i = 0; i < N; i++) {
      if (lum(cols[i], py) < 100) {
        if (!run) start = i;
        run++;
        if (!best || run > best.n) best = { n: run, a: start, b: i };
      } else run = 0;
    }
    return best && best.n >= N * 0.6 ? best : null;
  };
  // From the bottom up, the first such row is the line between the picture and its caption.
  let ruleBottom = -1;
  let span = null;
  for (let py = H - 1; py > H * 0.2; py--) {
    span = lineRun(py);
    if (span) {
      ruleBottom = py;
      break;
    }
  }
  if (ruleBottom < 0 || ruleBottom > H - 8) return null;
  const left = cols[span.a];
  const right = Math.min(W, cols[span.b] + Math.ceil(W / N));
  // Under it: the caption, white with dark writing. Where the writing ends (margins below it go).
  let white = 0;
  let total = 0;
  let last = ruleBottom;
  for (let py = ruleBottom + 1; py < H; py++) {
    let ink = false;
    for (let i = span.a; i <= span.b; i++) {
      const v = lum(cols[i], py);
      total++;
      if (v > 215) white++;
      else if (v < 170) ink = true;
    }
    if (ink) last = py;
  }
  if (!total || white / total < 0.8 || last <= ruleBottom + 2) return null;
  const top = ruleBottom + 1;
  const pad = Math.round((last - top) * 0.12);
  const bottom = Math.min(H, last + 1 + pad);
  const out = document.createElement('canvas');
  out.width = right - left;
  out.height = bottom - top;
  out.getContext('2d').drawImage(src, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

// As wide as the box (never enlarged); taller than 72 px, its start shows and the rest fades out.
function showCaption(box, c) {
  const canvas = box.querySelector('canvas');
  canvas.width = c.width;
  canvas.height = c.height;
  canvas.getContext('2d').drawImage(c, 0, 0);
  box.hidden = false;
  const avail = Math.max(60, el.replying.querySelector('.q').clientWidth || 240);
  const s = Math.min(avail / c.width, 1);
  canvas.style.width = Math.round(c.width * s) + 'px';
  canvas.style.height = Math.round(c.height * s) + 'px';
  box.style.width = canvas.style.width;
  box.classList.toggle('clip', c.height * s > 72);
}

async function toggleLike(p) {
  let uid;
  try {
    uid = await ensureSignedIn();
  } catch (e) {
    return setBanner(friendly(e));
  }
  const m = likesOf(p.id);
  const had = m.has(uid);
  // Show it at once; put it back if the server says no.
  const mineNow = { name: state.name, handle: state.me ? state.me.handle : null, photo: state.me ? state.me.photo : null };
  if (had) m.delete(uid);
  else m.set(uid, mineNow);
  renderLikes(p.id);
  const { error } = had
    ? await sb.from('likes').delete().eq('message_id', p.id).eq('user_id', uid)
    : await sb.from('likes').insert({ message_id: p.id, name: state.name });
  if (error && !/duplicate/i.test(error.message || '')) {
    if (had) m.set(uid, mineNow);
    else m.delete(uid);
    renderLikes(p.id);
    setBanner(friendly(error), { ms: 5000 });
  }
}

// The post goes first (so nobody sees it without its picture), then its file.
async function deletePost(p) {
  const li = nodes.get(p.id);
  if (li) li.classList.add('sending');
  try {
    const { data, error } = await sb.from('messages').delete().eq('id', p.id).select('id');
    if (error) throw error;
    if (!data.length && state.posts.has(p.id)) throw new Error('Only the person who posted it can delete it.');
    dropPost(p.id);
  } catch (e) {
    if (li) li.classList.remove('sending');
    return setBanner('Couldn’t delete: ' + friendly(e));
  }
  if (p.media_path) sb.storage.from(BUCKET).remove([p.media_path]).catch(() => {});
}

// Download: the picture or video as it was posted, named like a saved snip: "Annotated.com꞉ <the first
// words of the post, or who posted it> <when>.png". (Fetched first, then saved, so the name sticks.)
async function downloadMedia(p) {
  if (!p.media_path || !PATH_OK.test(p.media_path)) return;
  setBanner('Downloading…');
  try {
    const r = await fetch(publicUrl(p.media_path));
    if (!r.ok) throw new Error(r.status === 404 || r.status === 400 ? 'it isn’t there any more.' : `the server said ${r.status}.`);
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName(p);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setBanner(null);
  } catch (e) {
    setBanner('Couldn’t download it: ' + friendly(e), { ms: 5000 });
  }
}

function downloadName(p) {
  const d = new Date(p.created_at);
  const z = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
  const words = (t) =>
    String(t || '')
      .replace(/:/g, '\uA789')
      .replace(/[\\/*?"<>|\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .slice(0, 6)
      .join(' ')
      .replace(/^([\s\S]{50})[\s\S]+$/u, '$1') // at most 50 characters (whole ones)
      .replace(/[.\s]+$/, '');
  const ext = TYPES[p.media_mime] || ((p.media_path || '').match(/\.(\w+)$/) || [])[1] || (p.media_type === 'video' ? 'mp4' : 'png');
  return `Annotated.com\uA789 ${words(p.body) || words(displayName(p)) || 'Download'} ${stamp}.${ext}`;
}

// Copy (right-click): the picture, ready to paste anywhere; an MP4 video, in the format only this chat
// reads (like ⧉ in the bar); or the words of a post with neither. Where it's from goes along, so pasting
// it back in here keeps it.
function copyKind(p) {
  if (p.media_path) {
    if (!PATH_OK.test(p.media_path)) return null;
    if (p.media_type === 'image') return 'image';
    return /\.mp4$/.test(p.media_path) ? 'video' : null;
  }
  return p.body ? 'text' : null;
}

async function toPng(blob) {
  if (blob.type === 'image/png') return blob;
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close();
  return c.convertToBlob({ type: 'image/png' });
}

async function copyPost(p) {
  const kind = copyKind(p);
  if (!kind) return;
  try {
    if (kind === 'text') {
      await navigator.clipboard.writeText(p.body);
    } else {
      // (Written right in your click; the file arrives a moment later.)
      const got = fetch(publicUrl(p.media_path)).then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 || r.status === 400 ? 'it isn’t there any more.' : `the server said ${r.status}.`);
        return r.blob();
      });
      const meta = new Blob([JSON.stringify({ app: 'Annotated.com', source: isWebLink(p.source) ? p.source : '', name: downloadName(p) })], { type: 'application/x-annotated+json' });
      const file = kind === 'image' ? { 'image/png': got.then(toPng) } : { [CLIP_VIDEO]: got.then((b) => new Blob([b], { type: 'video/mp4' })) };
      await navigator.clipboard.write([new ClipboardItem({ ...file, [CLIP_META]: meta })]);
    }
    setBanner(kind === 'image' ? 'Picture copied.' : kind === 'video' ? 'Video copied: paste it into the chat.' : 'Copied.', { ms: 2200, kind: 'ok' });
  } catch (e) {
    setBanner('Couldn’t copy it: ' + friendly(e), { ms: 5000 });
  }
}

// File a claim: someone says a post uses their work beyond fair use. A short form; the claim goes
// privately to the people who run this chat (the server keeps a copy of the post with it). One claim
// per person per post.
let claimFor = null;
function openClaim(p) {
  claimFor = p;
  el.claimForm.reset();
  el.claimErr.hidden = true;
  el.claimSend.disabled = false;
  el.claimSend.textContent = 'Send claim';
  el.claim.showModal();
  el.claimWhat.focus();
}

function claimError(text) {
  el.claimErr.textContent = text;
  el.claimErr.hidden = false;
}

async function sendClaim() {
  const p = claimFor;
  if (!p || el.claimSend.disabled) return;
  const reason = el.claimWhat.value.trim();
  const contact = el.claimWho.value.trim();
  if (reason.length < 10) return claimError('Say what’s yours and why this isn’t fair use (at least a sentence).'), el.claimWhat.focus();
  if (contact.length < 3) return claimError('Say how to reach you.'), el.claimWho.focus();
  if (!el.claimOk.checked) return claimError('Tick the box to confirm it’s your work (or you act for its owner).'), el.claimOk.focus();
  el.claimErr.hidden = true;
  el.claimSend.disabled = true;
  el.claimSend.textContent = 'Sending…';
  try {
    await ensureSignedIn();
    const { error } = await sb.from('claims').insert({ message_id: p.id, reason, contact });
    if (error) throw error;
    claimFor = null;
    el.claim.close();
    setBanner('Claim sent. Thanks: the people who run this chat will look at it.', { ms: 5000, kind: 'ok' });
  } catch (e) {
    const code = e && e.code;
    claimError(
      code === '23505'
        ? 'You’ve already filed a claim on this post.'
        : code === '42P01' || code === 'PGRST205'
          ? 'Claims can’t be sent yet: this chat’s database needs updating.'
          : 'Couldn’t send the claim: ' + friendly(e),
    );
    el.claimSend.disabled = false;
    el.claimSend.textContent = 'Send claim';
  }
}

// Go to source link: where an annotation is from, in a new tab (only ever a web address).
function openSource(p) {
  if (!isWebLink(p.source)) return;
  chrome.tabs.create({ url: p.source, active: true }).catch((e) => setBanner('Couldn’t open the link: ' + friendly(e), { ms: 5000 }));
}

// The right-click menu: Reply, Delete (your own posts: press it twice), Like (or
// Unlike), Download (a picture or video), Copy (the picture, the video or the words), and on an
// annotation made with Annotated.com, Go to source link (opens it in a new tab), and File a claim (on
// someone else's post). (When it was posted is on the post itself.)
const menu = { post: null, li: null, prev: null, byKeyboard: false, openedAt: 0, armTimer: 0 };

function postOf(li) {
  const id = li && li.dataset.id;
  return id ? state.posts.get(id) || (state.search && state.search.rows.get(id)) || null : null;
}

function openMenu(li, x, y, { keyboard = false } = {}) {
  const p = postOf(li);
  if (!p) return;
  closeMenu();
  menu.post = p;
  menu.li = li;
  menu.prev = document.activeElement;
  menu.byKeyboard = keyboard;
  menu.openedAt = performance.now();
  menu.scrollTop = el.feed.scrollTop;
  li.classList.add('menu-on');
  const m = el.menu;
  const liked = !!state.uid && likesOf(p.id).has(state.uid);
  const like = m.querySelector('[data-act="like"]');
  like.querySelector('.lbl').textContent = liked ? 'Unlike' : 'Like';
  like.classList.toggle('on', liked);
  m.querySelector('[data-act="reply"]').hidden = !canReply(p);
  m.querySelector('[data-act="delete"]').hidden = !(state.uid && p.user_id === state.uid);
  m.querySelector('[data-act="download"]').hidden = !(p.media_path && PATH_OK.test(p.media_path));
  const copy = m.querySelector('[data-act="copy"]');
  const kind = copyKind(p);
  copy.hidden = !kind;
  copy.querySelector('.lbl').textContent = kind === 'video' ? 'Copy video' : kind === 'text' ? 'Copy text' : 'Copy image';
  m.querySelector('[data-act="source"]').hidden = !(p.media_path && isWebLink(p.source));
  m.querySelector('[data-act="claim"]').hidden = !!(state.uid && p.user_id === state.uid);
  disarmDelete();
  m.hidden = false;
  // Keep it inside the panel, opening away from the edges.
  const w = m.offsetWidth;
  const h = m.offsetHeight;
  const left = x + w > innerWidth - 6 ? Math.max(6, x - w) : x;
  const top = y + h > innerHeight - 6 ? Math.max(6, y - h) : y;
  m.style.left = left + 'px';
  m.style.top = top + 'px';
  m.style.setProperty('--ox', left < x ? '100%' : '0');
  m.style.setProperty('--oy', top < y ? '100%' : '0');
  // Keys go to the menu while it's open (arrows move, Enter picks, Esc closes).
  if (keyboard) m.querySelector('button:not([hidden])').focus();
  else m.focus({ preventScroll: true });
}

// Closing gives the keys back to where they were (the post, if you opened it from the keyboard; the box
// you write in, usually).
function closeMenu() {
  if (el.menu.hidden) return;
  const hadFocus = el.menu.contains(document.activeElement);
  el.menu.hidden = true;
  disarmDelete();
  if (menu.li) menu.li.classList.remove('menu-on');
  if (hadFocus) {
    const back = menu.prev && menu.prev.isConnected && menu.prev !== document.body ? menu.prev : state.search ? el.q : el.text;
    back.focus({ preventScroll: true });
  }
  menu.post = null;
  menu.li = null;
  menu.prev = null;
}

function disarmDelete() {
  clearTimeout(menu.armTimer);
  const del = el.menu.querySelector('[data-act="delete"]');
  del.classList.remove('armed');
  del.querySelector('.lbl').textContent = 'Delete';
}

function onMenu(act) {
  const p = menu.post;
  if (!p) return;
  if (act === 'reply') {
    if (!canReply(p)) return;
    closeMenu();
    if (state.search) closeSearch({ keepScroll: true });
    return setReply(p);
  }
  if (act === 'like') {
    closeMenu();
    return toggleLike(p);
  }
  if (act === 'source') {
    closeMenu();
    return openSource(p);
  }
  if (act === 'download') {
    closeMenu();
    return downloadMedia(p);
  }
  if (act === 'copy') {
    closeMenu();
    return copyPost(p);
  }
  if (act === 'claim') {
    closeMenu();
    return openClaim(p);
  }
  if (act === 'delete') {
    const del = el.menu.querySelector('[data-act="delete"]');
    if (!del.classList.contains('armed')) {
      del.classList.add('armed');
      del.querySelector('.lbl').textContent = 'Press again to delete';
      menu.armTimer = setTimeout(disarmDelete, 3000);
      return;
    }
    closeMenu();
    return deletePost(p);
  }
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

// The search button (under the box, right of +) turns the box into a search box for the whole chat
// (the text of posts, names, @handles and source links). What matches fills the chat as you type; click one to go to it. Esc, or the
// button again, brings the chat and your message back.
function openSearch() {
  if (state.search) return;
  closeMenu();
  state.search = { seq: 0, term: '', rows: new Map() };
  document.body.classList.add('searching');
  el.find.setAttribute('aria-pressed', 'true');
  el.find.title = 'Back to the chat';
  el.find.setAttribute('aria-label', 'Back to the chat');
  el.text.hidden = true;
  el.q.hidden = false;
  el.q.value = '';
  el.q.focus();
  setDockHeight();
}

function closeSearch({ keepScroll = false } = {}) {
  if (!state.search) return;
  clearTimeout(searchTimer);
  state.search = null;
  document.body.classList.remove('searching');
  el.find.setAttribute('aria-pressed', 'false');
  el.find.title = 'Search the chat';
  el.find.setAttribute('aria-label', 'Search the chat');
  el.q.hidden = true;
  el.text.hidden = false;
  el.results.hidden = true;
  el.results.replaceChildren();
  el.noResults.hidden = true;
  el.list.hidden = false;
  render();
  if (!keepScroll) toBottom();
  el.text.focus({ preventScroll: true });
  setDockHeight();
}

let searchTimer = 0;
function onSearchInput() {
  clearTimeout(searchTimer);
  if (state.search) state.search.seq++; // (an answer still on its way is for something else now)
  const term = el.q.value.trim();
  if (!term) return showResults('', []);
  searchTimer = setTimeout(() => runSearch(term), 180);
}

async function runSearch(term) {
  const s = state.search;
  if (!s) return;
  const seq = ++s.seq;
  // ilike, with what you typed taken literally (%, _ and \ escaped), and quoted for the "or" list.
  const pattern = '%' + term.replace(/[\\%_]/g, (c) => '\\' + c).replace(/\*/g, ' ') + '%';
  const quoted = '"' + pattern.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const query = (cols) =>
    sb
      .from('messages')
      .select('*')
      .or(cols.map((c) => `${c}.ilike.${quoted}`).join(','))
      .order('created_at', { ascending: false })
      .limit(60);
  let { data, error } = await query(['body', 'name', 'source', 'x_handle']);
  if (error && /x_handle/.test(error.message || '')) ({ data, error } = await query(['body', 'name', 'source']));
  if (state.search !== s || seq !== s.seq) return; // you've typed more since (or closed the search)
  if (error) return setBanner('Couldn’t search: ' + friendly(error), { ms: 5000 });
  showResults(term, data.reverse());
}

function showResults(term, rows) {
  const s = state.search;
  if (!s) return;
  s.term = term;
  if (!term) {
    s.rows = new Map();
    el.results.hidden = true;
    el.results.replaceChildren();
    el.noResults.hidden = true;
    el.list.hidden = false;
    render();
    return toBottom();
  }
  s.rows = new Map(rows.map((p) => [p.id, p]));
  el.list.hidden = true;
  el.empty.hidden = true;
  el.results.replaceChildren(...rows.map((p) => makePost(p, { hit: term })));
  el.results.hidden = !rows.length;
  el.noResults.hidden = rows.length > 0;
  toBottom();
  loadLikes(rows.map((p) => p.id).filter((id) => !state.likes.has(id)));
}

/* ------------------------------------------------------------------ */
/* Writing and attaching                                               */
/* ------------------------------------------------------------------ */

// One 46 px line (a 48 px box), growing with what you write up to seven lines. (An empty box stays one
// line, whatever the placeholder would need.)
function autosize() {
  if (!el.text.value) {
    el.text.style.height = '';
    return;
  }
  el.text.style.height = 'auto';
  el.text.style.height = Math.min(Math.max(el.text.scrollHeight, 46), 168) + 'px';
}

// Like the typing line on the page: up to 280 characters, counted the way X counts them (a link is 23,
// an emoji or a CJK character 2). The last 20 count down beside your name; past 280 it shows how many to
// cut, and ↑ waits.
// Nobody can message everyone: the box is for a reply to an annotation (right-click it → Reply), or a
// few words with an annotation you're posting. Otherwise it's closed, and says how to reply.
function updateSend() {
  const annotation = !!(state.pending && state.pending.source);
  const open = !!state.replyTo || annotation;
  if (el.text.disabled === open) el.text.disabled = !open;
  const hint = state.replyTo ? 'Write a reply' : annotation ? 'Add some words (if you like)' : state.pending ? 'Only annotations go to everyone: reply to one with this' : 'Right-click an annotation to reply';
  if (el.text.placeholder !== hint) el.text.placeholder = hint;
  const has = el.text.value.trim().length > 0 || !!state.pending;
  const c = countX(el.text.value.trim());
  el.send.disabled = state.sending || !has || c.over || !open;
  el.left.textContent = c.left <= 20 ? String(c.left) : '';
  el.left.classList.toggle('over', c.over);
  el.left.title = c.over ? `${-c.left} over X's 280 characters` : '';
  return c;
}

let bannerTimer = 0;
function setBanner(text, { kind = 'note', ms = 0, action = null } = {}) {
  clearTimeout(bannerTimer);
  if (!text) {
    el.banner.hidden = true;
    delete el.banner.dataset.kind;
    setDockHeight();
    return;
  }
  el.bannerText.textContent = text;
  el.banner.dataset.kind = kind;
  el.bannerBtn.hidden = !action;
  if (action) {
    el.bannerBtn.textContent = action.label;
    el.bannerBtn.onclick = action.run;
  }
  el.banner.hidden = false;
  if (ms) bannerTimer = setTimeout(() => setBanner(null), ms);
  setDockHeight();
}

function imageInfo(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
}
function videoInfo(url) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const done = (r) => {
      v.removeAttribute('src');
      v.load();
      resolve(r);
    };
    v.onloadedmetadata = () => done({ width: v.videoWidth, height: v.videoHeight, seconds: Number.isFinite(v.duration) ? v.duration : null });
    v.onerror = () => done({ width: 0, height: 0, seconds: null });
    v.src = url;
  });
}

// Where a saved Annotated.com picture is from: it's written into the file (a PNG text chunk, or a JPEG
// comment), so a saved snip dragged or added here still offers "Go to source link". Other files: none.
async function sourceInFile(f) {
  try {
    const b = new Uint8Array(await f.slice(0, 512 * 1024).arrayBuffer());
    const dec = new TextDecoder('latin1');
    if (f.type === 'image/png' && b[0] === 0x89 && b[1] === 0x50) {
      for (let i = 8; i + 8 <= b.length; ) {
        const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
        const type = dec.decode(b.subarray(i + 4, i + 8));
        if (type === 'IDAT' || type === 'IEND') break;
        if (type === 'tEXt' && i + 8 + len <= b.length) {
          const data = dec.decode(b.subarray(i + 8, i + 8 + len));
          const nul = data.indexOf('\0');
          if (data.slice(0, nul) === 'Source') return checkSource(data.slice(nul + 1));
        }
        i += 12 + len;
      }
    } else if (f.type === 'image/jpeg' && b[0] === 0xff && b[1] === 0xd8) {
      for (let i = 2; i + 4 <= b.length && b[i] === 0xff; ) {
        const m = b[i + 1];
        const len = (b[i + 2] << 8) | b[i + 3];
        if (m === 0xda) break; // the picture itself starts
        if (m === 0xfe) {
          const c = new TextDecoder().decode(b.subarray(i + 4, i + 2 + len));
          const hit = c.match(/^Annotated\.com source: (\S+)$/);
          if (hit) return checkSource(hit[1]);
        }
        i += 2 + len;
      }
    }
  } catch {}
  return '';
}
function checkSource(s) {
  return isWebLink(s) ? s : '';
}

let attachSeq = 0;
function clearPending() {
  attachSeq++; // (an attachment still loading is dropped)
  if (state.pending) URL.revokeObjectURL(state.pending.url);
  state.pending = null;
  el.attach.hidden = true;
  el.attach.querySelector('.thumb').replaceChildren();
  setProgress(null);
  updateSend();
  setDockHeight();
}

// A picture or video into the box (not sent until you press Enter). `source`: where an annotation is
// from (Annotated.com tells the chat, beside what it copies; a saved snip has it written in).
async function attachFile(f, { source = null, name = '' } = {}) {
  if (!f || state.sending) return;
  const ext = TYPES[f.type];
  if (!ext) return setBanner('Only pictures (PNG, JPEG, WebP, GIF) and videos (MP4, WebM) can be posted.', { ms: 6000 });
  if (f.size > MAX_BYTES) return setBanner(`That file is ${fmtBytes(f.size)}. The limit is 50 MB.`, { ms: 6000 });
  if (state.search) closeSearch();
  setBanner(null);
  clearPending();
  const seq = attachSeq;
  const kind = f.type.startsWith('video/') ? 'video' : 'image';
  const url = URL.createObjectURL(f);
  const [info, found] = await Promise.all([kind === 'video' ? videoInfo(url) : imageInfo(url), source == null ? sourceInFile(f) : Promise.resolve(checkSource(source))]);
  if (seq !== attachSeq || state.sending) {
    URL.revokeObjectURL(url); // another one came in meanwhile (or it's being sent)
    return null;
  }
  const pending = { file: f, kind, ext, url, ...info, source: found };
  state.pending = pending;

  const thumb = el.attach.querySelector('.thumb');
  if (kind === 'video') {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    v.src = url + '#t=0.1';
    thumb.replaceChildren(v, icon('i-play'));
  } else {
    const img = document.createElement('img');
    img.alt = '';
    img.src = url;
    thumb.replaceChildren(img);
  }
  const shown = name || (/^image\.(png|jpe?g|gif|webp)$/i.test(f.name) ? (kind === 'video' ? 'Pasted video' : 'Pasted picture') : f.name || (kind === 'video' ? 'Video' : 'Picture'));
  el.attach.querySelector('.fname').textContent = shown;
  const bits = [fmtBytes(f.size)];
  if (info.width && info.height) bits.push(`${info.width} × ${info.height}`);
  if (kind === 'video' && info.seconds) bits.push(fmtDur(info.seconds));
  el.attach.querySelector('.fsize').textContent = bits.join(' · ');
  el.attach.hidden = false;
  updateSend();
  setDockHeight();
  el.text.focus();
  return pending;
}

// What Annotated.com put on the clipboard beside a picture, or a video (a format only this chat reads:
// the clipboard has no standard place for a video).
async function readClipboard() {
  try {
    const items = await navigator.clipboard.read();
    const out = { meta: null, video: null };
    for (const it of items) {
      if (it.types.includes(CLIP_META)) {
        try {
          out.meta = JSON.parse(await (await it.getType(CLIP_META)).text());
        } catch {}
      }
      if (it.types.includes(CLIP_VIDEO)) out.video = await it.getType(CLIP_VIDEO);
    }
    return out;
  } catch {
    return { meta: null, video: null };
  }
}

async function onPaste(e) {
  if (e.target === el.meEdit || e.target === el.q || el.claim.open) return;
  const dt = e.clipboardData;
  const f = firstFile(dt && dt.files);
  if (f) {
    e.preventDefault();
    const p = await attachFile(f, { source: '' });
    // A picture copied in Annotated.com: where it's from, and its name.
    const { meta } = await readClipboard();
    if (p && meta && meta.app === 'Annotated.com' && state.pending === p) {
      p.source = checkSource(meta.source);
      if (meta.name) el.attach.querySelector('.fname').textContent = String(meta.name).slice(0, 120);
      updateSend(); // (an annotation: it can go to everyone)
    }
    return;
  }
  // Nothing a page understands on the clipboard: maybe a video copied in Annotated.com.
  if (dt && !dt.types.length) {
    e.preventDefault();
    const { meta, video } = await readClipboard();
    if (!video) return;
    const name = (meta && meta.name) || 'Screen Recording.mp4';
    const file = new File([video], name, { type: 'video/mp4' });
    attachFile(file, { source: meta && meta.app === 'Annotated.com' ? meta.source || '' : '', name });
  }
}

function setProgress(p) {
  const bar = el.attach.querySelector('.progress');
  if (p == null) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.style.setProperty('--p', String(Math.max(0, Math.min(1, p))));
}

// Upload straight to storage (so we can show progress), into your own folder.
async function upload(path, file, onProgress) {
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) throw new Error('Not signed in.');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`);
    xhr.setRequestHeader('authorization', `Bearer ${session.access_token}`);
    xhr.setRequestHeader('apikey', SUPABASE_KEY);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('cache-control', 'max-age=3600'); // (a deleted post's file doesn't linger in caches)
    xhr.setRequestHeader('content-type', file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = `The upload failed (${xhr.status}).`;
      try {
        const j = JSON.parse(xhr.responseText);
        msg = j.message || j.error || msg;
      } catch {}
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error('The upload failed. Check your connection and try again.'));
    xhr.send(file);
  });
}

async function send() {
  if (state.sending || state.search) return;
  const body = el.text.value.trim();
  const att = state.pending;
  if (!body && !att) return;
  if (!state.replyTo && !(att && att.source)) return setBanner('To say something, right-click an annotation and reply.', { ms: 4000 });
  if (countX(body).over) return updateSend(); // over 280: trim it first
  state.sending = true;
  el.composer.classList.add('busy');
  updateSend();
  setBanner(null);
  let path = null;
  try {
    const uid = await ensureSignedIn();
    const row = { name: state.name, body };
    if (state.replyTo) row.reply_to = state.replyTo.id;
    if (att && att.source) row.source = att.source;
    if (att) {
      path = `${uid}/${crypto.randomUUID()}.${att.ext}`;
      setProgress(0);
      await upload(path, att.file, setProgress);
      Object.assign(row, mediaRow(path, att.file, att.kind, att));
    }
    const { data, error } = await sb.from('messages').insert(row).select().single();
    if (error) throw error;
    path = null;
    // (Anything typed, or another post picked to answer, while it uploaded stays.)
    if (el.text.value.trim() === body) {
      el.text.value = '';
      autosize();
    }
    if (state.pending === att) clearPending();
    if (!state.replyTo || state.replyTo.id === row.reply_to) setReply(null);
    refreshMine();
    addPosts([data], { mine: true });
  } catch (e) {
    if (path) sb.storage.from(BUCKET).remove([path]).catch(() => {});
    setProgress(null);
    setBanner(friendly(e));
  } finally {
    state.sending = false;
    el.composer.classList.remove('busy');
    updateSend();
    el.text.focus();
  }
}

/* ------------------------------------------------------------------ */
/* From the bar: send to the chat, close                               */
/* ------------------------------------------------------------------ */

// The bar's Annotated.com button hands over what you made (a picture or a video, and where it's from),
// and it's posted as you straight away. What you're writing in the box here stays as it is.
const CHAT_CHANNEL = 'annotated-chat';
const fromBar = new Set();
let chatLoaded;
const chatReady = new Promise((resolve) => (chatLoaded = resolve));

function listenToBar() {
  const bc = new BroadcastChannel(CHAT_CHANNEL);
  bc.onmessage = async (e) => {
    const m = e.data;
    if (!m || m.type !== 'post' || !m.id || m.windowId !== state.windowId || fromBar.has(m.id)) return;
    fromBar.add(m.id);
    const say = (type, extra = {}) => bc.postMessage({ type, id: m.id, ...extra });
    say('accepted');
    try {
      await chatReady;
      const row = await postNow(m, (p) => say('progress', { p }));
      say('posted', { postId: row.id });
    } catch (err) {
      say('failed', { error: friendly(err) });
    }
  };
}

// A post's picture or video: its sizes are only hints for the layout, so ones the database wouldn't
// take (over 20000 px, over 2 hours) are left out rather than failing the post after the upload.
function mediaRow(path, file, kind, { width, height, seconds } = {}) {
  const px = (n) => (n >= 1 && n <= 20000 ? Math.round(n) : null);
  return {
    media_path: path,
    media_type: kind,
    media_mime: file.type,
    media_width: px(width),
    media_height: px(height),
    media_bytes: file.size,
    media_seconds: seconds != null && seconds >= 0 && seconds <= 7200 ? Math.round(seconds * 10) / 10 : null,
  };
}

async function postNow({ file, kind, source, width, height, seconds }, onProgress) {
  if (!(file instanceof Blob)) throw new Error('There was nothing to post.');
  if (!checkSource(source || '')) throw new Error('Only annotations with a source link can be posted to the chat.');
  const ext = TYPES[file.type];
  if (!ext) throw new Error('Only pictures (PNG, JPEG, WebP, GIF) and videos (MP4, WebM) can be posted.');
  if (file.size > MAX_BYTES) throw new Error(`That file is ${fmtBytes(file.size)}. The limit is 50 MB.`);
  const uid = await ensureSignedIn();
  const path = `${uid}/${crypto.randomUUID()}.${ext}`;
  const row = { name: state.name, body: '' };
  const src = checkSource(source || '');
  if (src) row.source = src;
  await upload(path, file, onProgress);
  Object.assign(row, mediaRow(path, file, kind === 'video' ? 'video' : 'image', { width, height, seconds }));
  const { data, error } = await sb.from('messages').insert(row).select().single();
  if (error) {
    sb.storage.from(BUCKET).remove([path]).catch(() => {});
    throw error;
  }
  if (state.search) closeSearch();
  refreshMine();
  addPosts([data], { mine: true });
  toBottom();
  return data;
}

// Esc here (when it isn't closing something in the chat) is the bar's ✕: the chat closes, and the bar
// goes with it.
function closeAnnotated() {
  try {
    if (chrome.sidePanel && chrome.sidePanel.close && state.windowId != null) {
      chrome.sidePanel.close({ windowId: state.windowId }).catch(() => window.close());
      return;
    }
  } catch {}
  window.close();
}

// The chat opened by itself (Chrome's side panel button, say) on a page Chrome hasn't let Annotated.com
// onto yet: a press of the icon there brings the bar.
async function watchNoBar() {
  let key = '';
  try {
    const cmd = (await chrome.commands.getAll()).find((c) => c.name === '_execute_action');
    key = (cmd && cmd.shortcut) || '';
  } catch {}
  const show = (v) => {
    if (!v || v.windowId !== state.windowId || Date.now() - v.at > 15000) return;
    setBanner(`To bring the bar to this page, press Annotated.com in the toolbar${key ? ` (or ${key})` : ''}.`, { ms: 9000 });
  };
  chrome.storage.onChanged.addListener((ch, area) => area === 'session' && ch.noBar && show(ch.noBar.newValue));
  try {
    show((await chrome.storage.session.get('noBar')).noBar);
  } catch {}
}

// Once we know who you are, your posts get their "you" (and your X photo and handle).
function refreshMine() {
  if (!state.uid) return;
  let changed = false;
  for (const [id, li] of nodes) {
    const p = state.posts.get(id);
    if (p && p.user_id === state.uid && !li.classList.contains('mine')) {
      seenWatch.unobserve(li);
      nodes.delete(id);
      li.remove();
      changed = true;
    }
  }
  if (changed) render();
}

// Keep "New posts" just above the box at the bottom.
function setDockHeight() {
  const dock = document.querySelector('.dock');
  document.documentElement.style.setProperty('--dock-h', dock.offsetHeight + 'px');
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

function firstFile(list) {
  const files = [...(list || [])];
  return files.find((f) => TYPES[f.type]) || files[0] || null;
}

// Scrollbars (the feed's, the message box's): they show while you scroll or point at them, and fade
// away a second after.
function autoHideScrollbars() {
  const SCROLLERS = '.feed, #text';
  const state = new WeakMap(); // element -> { timer, near }
  const st = (el) => state.get(el) || (state.set(el, { timer: 0, near: false }), state.get(el));
  const show = (el) => {
    const s = st(el);
    el.classList.add('sb-on');
    clearTimeout(s.timer);
    s.timer = setTimeout(() => !s.near && el.classList.remove('sb-on'), 1000);
  };
  document.addEventListener('scroll', (e) => e.target && e.target.matches && e.target.matches(SCROLLERS) && show(e.target), true);
  let over = null;
  document.addEventListener(
    'pointermove',
    (e) => {
      const el = e.target && e.target.closest && e.target.closest(SCROLLERS);
      // Over the scrollbar itself (the strip at the right edge, where there's something to scroll).
      const near = !!el && el.scrollHeight > el.clientHeight + 1 && e.clientX >= el.getBoundingClientRect().left + el.clientWidth - 2;
      if (over && over !== el) {
        st(over).near = false;
        show(over);
      }
      over = el;
      if (!el) return;
      const s = st(el);
      if (near === s.near) return;
      s.near = near;
      if (near) {
        clearTimeout(s.timer);
        el.classList.add('sb-on');
      } else show(el);
    },
    { passive: true }
  );
}

function wire() {
  autoHideScrollbars();
  glassify(el.newer); // "New posts": glass, like the bar (it condenses in each time it appears)
  glassify(el.menu, { auto: false, rim: 14, blur: 2.6, veilMid: 0.5, lens: 26 }); // the right-click menu too
  el.composer.addEventListener('submit', (e) => {
    e.preventDefault();
    send();
  });
  el.text.addEventListener('input', () => {
    autosize();
    updateSend();
    setDockHeight();
  });
  el.text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape' && state.replyTo) {
      e.preventDefault();
      setReply(null);
    }
  });
  // Search: the button, typing (it fills as you type), Esc to go back.
  el.find.addEventListener('click', () => (state.search ? closeSearch() : openSearch()));
  el.q.addEventListener('input', onSearchInput);
  el.q.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearch();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(searchTimer);
      const term = el.q.value.trim();
      if (term) runSearch(term);
    }
  });
  el.results.addEventListener('click', (e) => {
    if (e.target.closest('a, button, video, .likes')) return;
    const li = e.target.closest('.post');
    if (li) jumpTo(li.dataset.id);
  });

  // Paste a picture (Annotated.com's Copy puts one on the clipboard, with where it's from), a video
  // copied in Annotated.com, or a file.
  document.addEventListener('paste', onPaste);
  el.pick.addEventListener('click', () => el.file.click());
  el.file.addEventListener('change', () => {
    const f = firstFile(el.file.files);
    el.file.value = '';
    if (f) attachFile(f);
  });
  el.unattach.addEventListener('click', () => {
    clearPending();
    el.text.focus();
  });
  el.replying.querySelector('.q').addEventListener('click', () => state.replyTo && jumpTo(state.replyTo.id));
  el.unreply.addEventListener('click', () => {
    setReply(null);
    el.text.focus();
  });

  // Right-click a post (or press the menu key, or Shift+F10, on it): reply, delete, like, download,
  // copy the source link. Chrome's own menu still comes up with Shift held, or on text you've selected (to copy
  // it).
  const onContext = (e) => {
    const li = e.target.closest('.post');
    if (!li || e.shiftKey) return;
    // (Chrome's own follow-up to the menu key, if any: the menu is already open.)
    if (!el.menu.hidden && menu.li === li && menu.byKeyboard && performance.now() - menu.openedAt < 500) return e.preventDefault();
    const sel = getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim() && sel.containsNode(li, true)) return;
    e.preventDefault();
    openMenu(li, e.clientX, e.clientY);
  };
  el.list.addEventListener('contextmenu', onContext);
  el.results.addEventListener('contextmenu', onContext);
  el.menu.addEventListener('contextmenu', (e) => e.preventDefault());
  const onPostKey = (e) => {
    const li = e.target.closest('.post');
    if (!li || e.target !== li) return;
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const r = li.getBoundingClientRect();
      openMenu(li, r.left + 40, r.top + 24, { keyboard: true });
    }
  };
  el.list.addEventListener('keydown', onPostKey);
  el.results.addEventListener('keydown', onPostKey);
  el.menu.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (b) onMenu(b.dataset.act);
  });
  el.menu.addEventListener('keydown', (e) => {
    const items = [...el.menu.querySelectorAll('button:not([hidden])')];
    const i = items.indexOf(document.activeElement);
    const n = items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const down = e.key === 'ArrowDown';
      items[i < 0 ? (down ? 0 : n - 1) : (i + (down ? 1 : n - 1)) % n].focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : n - 1].focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      closeMenu();
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!el.menu.hidden && !el.menu.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (el.claim.open) return; // the claim form has the keys (Esc closes just it)
    if (e.key === 'Escape' && !el.menu.hidden) return closeMenu();
    // Esc (when it isn't closing something in here) is the bar's ✕: the chat and the bar close.
    if (e.key === 'Escape' && !e.defaultPrevented && !e.isComposing) {
      e.preventDefault();
      return closeAnnotated();
    }
    // Typing while you're looking at the feed (after clicking a post, say) goes into the box.
    const t = document.activeElement;
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || !el.menu.hidden) return;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
    if (e.key === ' ' && t && t !== document.body && !t.classList.contains('post')) return; // Space presses buttons
    (state.search ? el.q : el.text).focus();
  });
  // A click anywhere in the chat (not on a link, a button, a picture or a video, and not to select
  // text) puts the cursor in the box, ready to type.
  document.addEventListener('click', (e) => {
    if (e.button !== 0 || e.defaultPrevented || !el.meEdit.hidden) return;
    if (e.target.closest('a, button, input, textarea, video, dialog, .menu, .media, .drop')) return;
    const sel = getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return;
    (state.search ? el.q : el.text).focus({ preventScroll: true });
  });
  window.addEventListener('blur', () => closeMenu());
  window.addEventListener('resize', () => closeMenu());

  // Drag a file anywhere onto the panel.
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  document.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    el.drop.hidden = false;
  });
  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) el.drop.hidden = true;
  });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    el.drop.hidden = true;
    if (!el.claim.open) attachFile(firstFile(e.dataTransfer.files));
  });
  el.claimForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendClaim();
  });
  el.claimCancel.addEventListener('click', () => el.claim.close());
  el.claim.addEventListener('close', () => {
    claimFor = null;
    el.text.focus({ preventScroll: true });
  });

  el.me.addEventListener('click', editName);
  el.meEdit.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      endEditName(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      endEditName(false);
    }
  });
  el.meEdit.addEventListener('blur', () => endEditName(true));

  el.feed.addEventListener('scroll', () => {
    // Scrolling away closes the menu (not a scroll that was still finishing as it opened).
    if (!el.menu.hidden && Math.abs(el.feed.scrollTop - menu.scrollTop) > 24) closeMenu();
    if (state.search) return;
    if (nearBottom()) el.newer.hidden = true;
    if (el.feed.scrollTop < 300) loadOlder();
  });
  el.newer.addEventListener('click', toNewest);

  window.addEventListener('offline', () => setBanner('You’re offline. The chat will catch up when you’re back.', { kind: 'live' }));
  window.addEventListener('online', () => {
    if (el.banner.dataset.kind === 'live') setBanner(null);
    catchUp();
  });
  new ResizeObserver(setDockHeight).observe(document.querySelector('.dock'));
}

async function start() {
  try {
    state.windowId = (await chrome.windows.getCurrent()).id;
  } catch {}
  listenToBar();
  watchNoBar();
  wire();
  updateSend();
  setDockHeight();
  el.loading.hidden = false;
  await loadName();
  try {
    await ensureSignedIn();
  } catch (e) {
    setBanner('You can read the chat, but posting isn’t available yet: ' + friendly(e));
  }
  try {
    await loadLatest();
  } catch (e) {
    setBanner('Couldn’t load the chat. ' + friendly(e), { kind: 'load', action: { label: 'Try again', run: () => location.reload() } });
  }
  state.loaded = true;
  el.loading.hidden = true;
  render();
  toBottom();
  goLive();
  chatLoaded();
  el.text.focus();
  // Short posts may not fill the panel yet: load earlier ones until it can scroll (or there are none).
  for (let i = 0; i < 5 && !state.atStart && el.feed.scrollHeight <= el.feed.clientHeight + 40; i++) {
    await loadOlder();
    toBottom();
  }
}

start();

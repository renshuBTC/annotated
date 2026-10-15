// Annotated.com overlay. Runs inside an extension frame laid over the page.
// Flow: (from the icon: the bar on the page as it is, the chat open beside it; 📷 or 🎥 starts) dark
// screen -> pick an area -> type in big white text at the bottom -> Enter drops the text into the box
// under the snip, with the source link and the Annotated.com logo under it -> save PNG / MP4 (X-ready),
// copy it (⧉, Ctrl+C or right-click the box), or send it to the chat (the Annotated.com button). One
// bar at the top centre, in light glass, icons only; every button keeps one job in one place.
import { layoutCaption, renderCaptionCanvas } from './caption.js';
import { Recorder } from './recorder.js';
import { exportImage, exportPng, exportVideo, previewMp4, X, INKS, inkFor, HIGHLIGHT } from './exporter.js';
import { clamp, fmtTime, sleep } from './media.js';
import { glassify, prefers } from './glass.js';
import { countX, X_POST_LIMIT } from './xcount.js';
import './cleanurl.js'; // (globalThis.annotatedCleanUrl: the page's link, cleaned as the page script does)

const $ = (s) => document.querySelector(s);
const el = {
  frozen: $('#frozen'),
  dim: $('#dim'),
  sel: $('#sel'),
  card: $('#card'),
  media: $('#card .media'),
  hls: $('#card .hls'),
  hlcatch: $('#card .hlcatch'),
  cap: $('#card .cap'),
  region: $('#region'),
  handles: $('#handles'),
  liveCap: $('#liveCap'),
  bar: $('#bar'),
  bClose: $('#bClose'),
  bSnip: $('#bSnip'),
  bVideo: $('#bVideo'),
  bArea: $('#bArea'),
  bPick: $('#bPick'),
  bTime: $('#bTime .t'),
  bRec: $('#bRec'),
  bStop: $('#bStop'),
  bPause: $('#bPause'),
  bRecCount: $('#bRec .count'),
  bSave: $('#bSave'),
  bCopy: $('#bCopy'),
  bPost: $('#bPost'),
  bInk: $('#bInk'),
  bUndo: $('#bUndo'),
  inks: $('#inks'),
  saveRing: $('#bSave .ring .val'),
  composer: $('#composer'),
  editorBox: $('#editorBox'),
  editor: $('#editor'),
  mirror: $('#mirror'),
  hilite: $('#hilite'),
  caret: $('#caret'),
  counter: $('#counter'),
  counterVal: $('#counter .val'),
  counterLeft: $('#counter .left'),
  tip: $('#tip'),
  tipText: $('#tip .tt'),
  tipKey: $('#tip .tk'),
  boxMenu: $('#boxMenu'),
  mSave: $('#mSave'),
  mSaveLbl: $('#mSave .lbl'),
  mCopy: $('#mCopy'),
  mCopyLbl: $('#mCopy .lbl'),
  mPost: $('#mPost'),
  toast: $('#toast'),
  tIcon: $('#toast .ticon'),
  tIcon2: $('#toast .ticon2'),
  tText: $('#toast .ttext'),
  tSr: $('#toast .tsr'),
};

// Shortcut names for the hover labels (Chrome on a Mac uses Option for "Alt").
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const KEY = {
  esc: 'Esc',
  space: 'Space',
  undo: IS_MAC ? '⌘Z' : 'Ctrl+Z',
  enter: IS_MAC ? 'Return' : 'Enter',
  copy: IS_MAC ? '⌘C' : 'Ctrl+C',
  record: IS_MAC ? '⌥⇧V' : 'Alt+Shift+V',
};

const [tokenPart, kindPart] = location.hash.slice(1).split('|');
const TOKEN = decodeURIComponent(tokenPart || '');
const START = decodeURIComponent(kindPart || '');
const START_KIND = START === 'record' ? 'record' : 'snip';
// From the toolbar icon (or the chat opening): the chat opens beside the page and just the bar comes up,
// on the page as it is. 📷 or 🎥 (or ▭, ▤) brings the dark screen; pressing the chosen one again takes
// it away (the bar and the chat stay).
const START_BAR = START === 'bar';
const OPENED_AT = Date.now();

const app = {
  state: 'boot',
  kind: START_KIND, // 'snip' | 'record'
  shape: 'rect', // 'rect' (drag a box; a click takes the thing under it) | 'window' (point at a post, image or video)
  session: null,
  info: null,
  shot: null, // { bitmap, scale }
  region: null, // CSS px of this frame (= page viewport)
  source: '',
  videoHere: false, // the snip has a video in it (the video button gets a red dot)
  caption: '',
  hasCaption: false, // Enter pressed at least once: the box shows the text + source
  layout: null,
  editing: false,
  cardPos: null,
  drag: null,
  hover: null,
  pickDepth: 0,
  pointer: { x: 0, y: 0 },
  rec: null,
  recResult: null,
  previewUrl: null,
  player: null,
  attempt: 0,
  startedAt: 0,
  stream: null,
  cancelExport: false,
  tickTimer: 0,
  pick: null, // your area, as you chose it (pictures always use all of it)
  adjust: null, // pulling an edge or corner of your area
  zoom: 1, // the page's zoom (Chrome's); the bar undoes it so it keeps its size on screen
  k: 1, // the bar's scale: 1 / zoom, smaller only if the window is too narrow for it
  repick: null,
  home: START_BAR, // the bar on the page as it is is where Esc from the dark screen goes back to
  barPos: null, // where you dragged the bar (its top-left), or null: top centre
  copied: null, // the last video made for copying: { key, blob, meta }
  highlights: [], // marked on your snip: [{ rects: [{ x, y, w, h }] (page CSS px), dark, ink }]
  edits: [], // what Ctrl+Z undoes, last first: 'h' (a highlight) or { from } (typing, from that text)
  ink: 'yellow', // the highlighter's colour (exporter.js INKS; the marker in the bar), kept for next time
  paused: false, // the recording is paused (❚❚ or Space)
  gen: 0, // which snip this is: a new one (a new area, a recording) bumps it, so a save, copy or send of
  // the one before doesn't put the new one away when it finishes
  followUp: false, // Save or Send is waiting for a copy to finish (the copy doesn't end the snip then)
};
window.__snip = app; // handy when debugging the overlay
let sending = false; // the Annotated.com button is sending your snip to the chat

/* ------------------------------------------------------------------ */
/* Channel to the page helper (content.js)                             */
/* ------------------------------------------------------------------ */

let port = null;
let rpcSeq = 0;
const rpcWaiting = new Map();
const portReady = new Promise((resolve) => {
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (port || e.source !== window.parent || !d || d.type !== 'annotated-snip:hello' || d.token !== TOKEN || !e.ports || !e.ports[0]) return;
    port = e.ports[0];
    port.onmessage = (ev) => onPageMessage(ev.data);
    resolve();
  });
});

function page(type, data = {}) {
  if (!port) return Promise.reject(new Error('Not connected to the page.'));
  return new Promise((resolve, reject) => {
    const id = ++rpcSeq;
    rpcWaiting.set(id, { resolve, reject });
    port.postMessage({ id, type, ...data });
  });
}

function onPageMessage(m) {
  if (!m) return;
  if (m.id != null) {
    const w = rpcWaiting.get(m.id);
    if (!w) return;
    rpcWaiting.delete(m.id);
    if (m.error) w.reject(new Error(m.error));
    else w.resolve(m.result);
    return;
  }
  if (m.type === 'toggle') {
    if (port) port.postMessage({ type: 'ack', ackId: m.ackId });
    onToggle(m.mode);
  } else if (m.type === 'window') {
    // The tab moved to another window: the chat you send to is that window's.
    if (app.session && m.windowId != null) app.session.windowId = m.windowId;
  } else if (m.type === 'focusEditor') {
    if (app.editing) el.editor.focus({ preventScroll: true });
  } else if (m.type === 'key') {
    onForwardedKey(m);
  }
}

// A key pressed while the page had the keyboard (recording): treat it as typed here.
function onForwardedKey(m) {
  const st = app.state;
  if (m.key === 'Escape') return m.repeat ? undefined : escapeKey();
  if (m.key === ' ' && spacePauses(m)) return m.repeat ? undefined : togglePause();
  if (m.key === 'Enter' && m.repeat) return;
  if (!['armed', 'countdown', 'recording', 'stopping', 'review', 'compose'].includes(st)) return;
  if (!app.editing) openEditor(app.caption);
  const t = el.editor;
  t.focus({ preventScroll: true });
  if (m.key === 'Enter') {
    if (m.shiftKey) t.setRangeText('\n', t.selectionStart, t.selectionEnd, 'end');
    else return commit();
  } else if (m.key === 'Backspace') {
    const a = t.selectionStart;
    const b = t.selectionEnd;
    if (a !== b) t.setRangeText('', a, b, 'end');
    else if (a > 0) t.setRangeText('', a - lastCharLength(t.value.slice(0, a)), a, 'end');
  } else if (m.key.length === 1) {
    t.setRangeText(m.key, t.selectionStart, t.selectionEnd, 'end');
  }
  autosize();
  updateCounter();
  updateCaret(true);
}

// The length of the last character of some text (an emoji with its joiners and skin tone counts as one).
function lastCharLength(text) {
  try {
    const parts = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)];
    return parts.length ? parts[parts.length - 1].segment.length : 1;
  } catch {
    return /[\uDC00-\uDFFF]$/.test(text) && text.length > 1 ? 2 : 1;
  }
}

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

boot().catch((e) => fatal(e));

async function boot() {
  await Promise.race([portReady, sleep(6000).then(() => Promise.reject(new Error('The page did not answer.')))]);
  const sess = await send({ type: 'snip:session', token: TOKEN });
  if (!sess || sess.error) throw new Error((sess && sess.error) || 'Could not start.');
  app.session = sess;
  app.source = webAddress(sess.url); // (until the page says which link: a moment)
  if (sess.zoom > 0) app.zoom = sess.zoom;
  app.info = await page('info', { uiWidth: innerWidth });
  sizeEditorFont();
  await loadFonts();
  if (sess.shot) {
    try {
      await loadShot(sess.shot);
    } catch {
      app.shot = null;
    }
  }
  wireUi();
  await loadInk();
  keepAlive();
  if (START_BAR) enterIdle();
  else {
    enterSelect();
    if (app.shot) app.shotWords = takeWords();
  }
}

// The open bar checks in now and then, so the icon knows (right in your click) that it's open here.
function keepAlive() {
  setInterval(() => send({ type: 'snip:alive' }).catch(() => {}), 20000);
}

function fatal(e) {
  console.error('[Annotated.com]', e);
  if (port) page('hole', { rect: null, only: null }).catch(() => {}); // the whole overlay, so this shows
  if (port) page('focus').catch(() => {}); // (so Esc reaches it, as the message says)
  document.body.className = '';
  dim(true);
  toast('Annotated.com: ' + ((e && e.message) || e) + ' (Esc to close)', { ms: 8000 });
  app.state = 'fatal';
  document.addEventListener('keydown', (ev) => ev.key === 'Escape' && close());
  document.addEventListener('pointerdown', () => setTimeout(close, 50));
}

async function loadFonts(text = '') {
  const sample = text || 'Aa';
  await Promise.all(
    ['600 40px "Newsreader Snip"', '500 16px "Newsreader Snip"', '700 16px "Newsreader Snip"'].map((f) => document.fonts.load(f, sample).catch(() => null))
  );
}

async function loadShot(dataUrl) {
  el.frozen.src = dataUrl;
  await el.frozen.decode();
  const bitmap = await createImageBitmap(el.frozen);
  const old = app.shot;
  const shot = { bitmap, scale: bitmap.width / innerWidth, vw: innerWidth, vh: innerHeight };
  // Your highlights mark words in the picture: if the page looks different under them now (it scrolled,
  // say, while 🎥 showed it live), they'd sit on other words, so they go. (Each line on its own: a video
  // playing between two highlights doesn't count.)
  if (app.highlights.length && old && old.bitmap && app.highlights.some((h) => h.rects.some((q) => looksDifferent(old, shot, q)))) {
    app.highlights = [];
    app.edits = app.edits.filter((x) => x !== 'h');
    el.hls.replaceChildren();
  }
  if (old && old.bitmap) old.bitmap.close();
  app.shot = shot;
  app.shotStale = false;
  app.shotWords = null; // (the words with it: see takeWords)
  // The page as it was, at its size then: if the window narrows later (the chat opening beside it),
  // it's cropped, not squeezed.
  el.frozen.style.width = innerWidth + 'px';
  el.frozen.style.height = innerHeight + 'px';
}

// Whether two pictures of the page differ in an area: both shrunk to a few dozen pixels and compared.
function looksDifferent(a, b, r) {
  if (!r) return false;
  const W = 64;
  const H = Math.max(8, Math.min(64, Math.round((W * r.h) / r.w)));
  const grab = (shot) => {
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext('2d', { willReadFrequently: true });
    const s = shot.scale;
    g.drawImage(shot.bitmap, r.x * s, r.y * s, Math.max(1, r.w * s), Math.max(1, r.h * s), 0, 0, W, H);
    return g.getImageData(0, 0, W, H).data;
  };
  try {
    const p = grab(a);
    const q = grab(b);
    let sum = 0;
    for (let i = 0; i < p.length; i += 4) sum += Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]);
    return sum / (W * H * 3) > 3;
  } catch {
    return true;
  }
}

// The words on the page as it's pictured, where they are (your area is chosen from the picture afterwards,
// and the page may have changed by the time you save). Asked right after the picture, once the overlay is
// back (the page takes a moment to give them on a big page, and nothing else waits for them).
function takeWords() {
  return page('wordList', { uiWidth: innerWidth }).catch(() => null);
}

// The words in your area, as text: a new line for a new block lower down, a space where the page has
// one. (As the page joins them: see joinWords there.)
function joinWords(list, area, max = 4000) {
  let out = '';
  let last = null;
  for (const [t, x, y, bottom, block, spaceAfter, mid] of list) {
    if (area && (x < area.x || x > area.x + area.w || y < area.y || y > area.y + area.h)) continue;
    if (last) {
      if (block !== last.block && y > last.bottom - 1) out += '\n';
      else if (last.spaceAfter || mid || block !== last.block) out += ' ';
    }
    out += t;
    last = { bottom, block, spaceAfter };
    if (out.length >= max) break;
  }
  return out.replace(/[ \t]+\n/g, '\n').trim().slice(0, max);
}

// Take a fresh picture of the page (hide the overlay for a moment).
let shotJob = null;
function refreshShot() {
  // (One at a time: a second ask while one is under way gets that one.)
  if (!shotJob) shotJob = refreshShotNow().finally(() => (shotJob = null));
  return shotJob;
}
async function refreshShotNow() {
  const hadKeys = document.hasFocus(); // (hidden for the picture, the overlay loses the keyboard)
  await page('visible', { visible: false });
  await sleep(120);
  try {
    const r = await send({ type: 'snip:capture' });
    if (!r || r.error || !r.shot) throw new Error((r && r.error) || 'Could not capture the page.');
    await loadShot(r.shot);
    app.shotFresh = true;
  } finally {
    await page('visible', { visible: true });
    if (hadKeys) page('focus').catch(() => {}); // Esc and the arrows keep working
  }
  app.shotWords = takeWords(); // (as pictured; asked once the overlay is back, so it isn't kept hidden)
}

/* ------------------------------------------------------------------ */
/* State helpers                                                       */
/* ------------------------------------------------------------------ */

function setState(s) {
  closeBoxMenu();
  closeInks();
  app.state = s;
  bodyState();
  syncBar();
  // Leaving the page (a link clicked in your area while recording, say) asks first while a video is
  // being made or one is waiting: it would be lost.
  const guard = ['recording', 'stopping', 'review', 'exporting'].includes(s);
  if (guard !== app.guarded) {
    app.guarded = guard;
    page('guard', { on: guard }).catch(() => {});
  }
}

// The body's st-/kind-/shape- classes (others, like busy, stay as they are).
function bodyState() {
  const b = document.body.classList;
  for (const c of [...b]) if (/^(st|kind|shape)-/.test(c)) b.remove(c);
  b.add(`st-${app.state}`, `kind-${app.kind}`, `shape-${app.shape}`);
}

// The dark screen. It fades in and out only as a whole (from the bar on the page, and back); swapping
// it with the selection's own shadow (same darkness) while you choose or pull an edge is instant, so
// nothing flashes.
function dim(on, { fade = false } = {}) {
  el.dim.classList.toggle('instant', !fade);
  el.dim.classList.toggle('on', !!on);
}

function showFrozen(on) {
  el.frozen.classList.toggle('on', !!on && !!app.shot);
}

function hideAll() {
  for (const k of ['composer', 'card', 'region', 'liveCap', 'sel', 'handles']) el[k].hidden = true;
  if (flying) flying.clear();
  el.bar.classList.remove('exporting', 'finished');
}

let toastTimer = 0;
let toastGlass = null;
// Words only for real problems (something failed) and "press again" notes. Everything else is an
// icon: ping().
function toast(msg, { ms = 5200, icon = 'warn' } = {}) {
  showToast({ icon, text: String(msg), ms });
}

// What each icon-only notice says, for screen readers.
const PING_SAYS = { copy: 'Copied', logo: 'Sent to the chat', muted: 'The sound can’t be played back while recording', timer: 'The recording stopped at its time limit', resize: 'Stopped: the window changed size' };
function ping(icon, { icon2 = null, text = '', ms = 1600 } = {}) {
  showToast({ icon, icon2, text, ms, say: PING_SAYS[icon] || '' });
}

function showToast({ icon, icon2 = null, text = '', ms, say = '' }) {
  const t = el.toast;
  el.tSr.textContent = say;
  el.tIcon.querySelector('use').setAttribute('href', icon ? '#i-' + icon : '');
  el.tIcon.classList.toggle('show', !!icon);
  el.tIcon2.querySelector('use').setAttribute('href', icon2 ? '#i-' + icon2 : '');
  el.tIcon2.classList.toggle('show', !!icon2);
  el.tText.textContent = text;
  const longText = !!text && text.length > 6;
  t.classList.toggle('text', longText);
  t.classList.toggle('icon-only', !longText);
  t.classList.toggle('two', !longText && (!!icon2 || !!text));
  placeToast();
  if (!t.classList.contains('on') && toastGlass) toastGlass.materialize();
  t.classList.add('on');
  updateHole();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('on');
    updateHole();
  }, ms);
}

// Where to put a box of layout size w×h, drawn at the bar's scale (k) around its centre, so that its
// visible top-left lands on (x, y).
function placeScaled(node, x, y, w, h) {
  const k = app.k;
  node.style.left = Math.round(x - (w - w * k) / 2) + 'px';
  node.style.top = Math.round(y - (h - h * k) / 2) + 'px';
}

// Under the bar, centred. While recording it goes beside the bar instead, so it never covers (or ends
// up in) the recorded area.
function placeToast() {
  const t = el.toast;
  const k = app.k;
  const w = t.offsetWidth || 48;
  const h = t.offsetHeight || 48;
  const tw = Math.min(w * k, innerWidth - 16);
  const th = h * k;
  const bar = el.bar.hidden ? null : el.bar;
  const br = bar ? bar.getBoundingClientRect() : { left: innerWidth / 2, right: innerWidth / 2, top: 12, bottom: 60, height: 48 };
  let x = bar ? br.left + br.width / 2 - tw / 2 : (innerWidth - tw) / 2;
  let y = br.bottom + 10;
  if (y + th > innerHeight - 8) y = br.top - 10 - th; // the bar is low on the screen: above it
  const r = app.region;
  if (r && ['armed', 'countdown', 'recording', 'stopping'].includes(app.state) && intersects({ x, y, w: tw, h: th }, { x: r.x - 10, y: r.y - 10, w: r.w + 20, h: r.h + 20 })) {
    y = br.top + (br.height - th) / 2;
    x = br.left - 10 - tw;
    if (x < 8) x = br.right + 10;
    if (x + tw > innerWidth - 8) {
      x = 8;
      y = innerHeight - th - 8;
    }
  }
  x = clamp(x, 8, Math.max(8, innerWidth - tw - 8));
  y = clamp(y, 8, Math.max(8, innerHeight - th - 8));
  placeScaled(t, x, y, w, h);
}

// "Press again": a button that would throw work away stays pressed (blue) for a moment and says so;
// pressing it again within that time goes ahead.
function armConfirm(btn, text, ms = 2600) {
  disarmConfirm();
  btn.classList.add('on');
  armConfirm.btn = btn;
  armConfirm.until = Date.now() + ms;
  toast(text, { ms, icon: null });
  armConfirm.t = setTimeout(disarmConfirm, ms);
}

function confirmed(btn) {
  return armConfirm.btn === btn && Date.now() < armConfirm.until;
}

function disarmConfirm() {
  clearTimeout(armConfirm.t);
  const b = armConfirm.btn;
  armConfirm.btn = null;
  armConfirm.until = 0;
  if (b) b.classList.remove('on');
  syncBar();
}

function dpr() {
  return window.devicePixelRatio || 1;
}

function snapRect(r) {
  // Snap to whole device pixels so the saved image is pixel-exact.
  const s = app.shot ? app.shot.scale : dpr();
  const x = Math.round(r.x * s) / s;
  const y = Math.round(r.y * s) / s;
  const x2 = Math.round((r.x + r.w) * s) / s;
  const y2 = Math.round((r.y + r.h) * s) / s;
  return { x, y, w: x2 - x, h: y2 - y };
}

function clampRect(r) {
  const x = clamp(r.x, 0, innerWidth);
  const y = clamp(r.y, 0, innerHeight);
  const x2 = clamp(r.x + r.w, 0, innerWidth);
  const y2 = clamp(r.y + r.h, 0, innerHeight);
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}

function normRect(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

// A box dragged (or an edge pulled) to within a few pixels of the screen's edge goes right to it, so the
// whole screen is in reach even where the pointer stops at the last pixel (a maximised window).
const EDGE_SNAP = 6;
function toEdge(v, max) {
  if (v <= EDGE_SNAP) return 0;
  if (v >= max - EDGE_SNAP) return max;
  return v;
}
function boxToEdges(a, b) {
  return normRect({ x: toEdge(a.x, innerWidth), y: toEdge(a.y, innerHeight) }, { x: toEdge(b.x, innerWidth), y: toEdge(b.y, innerHeight) });
}

function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function intersects(a, b) {
  return overlapArea(a, b) > 0;
}

// The bar keeps its size on the screen (48 px tall at 100% display scaling): it undoes the page's
// zoom, so zooming a page in or out doesn't resize it.
// Only a window too narrow for it makes it smaller.
function applyScale() {
  const natural = el.bar.offsetWidth || 560; // layout width, before scaling
  let k = 1 / (app.zoom || 1);
  const room = innerWidth - 16;
  if (natural * k > room) k = room / natural;
  k = Math.round(k * 1000) / 1000;
  if (k === app.k && document.documentElement.style.getPropertyValue('--k')) return;
  app.k = k;
  document.documentElement.style.setProperty('--k', String(k));
  if (clipped()) updateHole();
}

async function refreshZoom() {
  try {
    const r = await send({ type: 'snip:zoom' });
    if (r && r.zoom > 0) app.zoom = r.zoom;
  } catch {}
  applyScale();
}

function sizeEditorFont() {
  const fs = Math.round(clamp(innerWidth * 0.034, 26, 54));
  document.documentElement.style.setProperty('--edfs', fs + 'px');
}

/* ------------------------------------------------------------------ */
/* The live area (recording): a hole in the overlay                    */
/* ------------------------------------------------------------------ */

const LIVE = ['armed', 'countdown', 'recording', 'stopping'];

// States where only part of the overlay is there: the live area's hole (recording), or just the bar on
// the page as it is (from the icon).
function clipped() {
  return LIVE.includes(app.state) || app.state === 'idle';
}

// What of the overlay stays in front of the live area: the bar, the typing line, a tip or bubble
// that's showing, and the handles. (In a recording, whatever is in front of the area is recorded.)
function keepRects() {
  const out = [];
  const add = (node) => {
    if (!node || node.hidden) return;
    const r = node.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) out.push({ x: r.left, y: r.top, w: r.width, h: r.height });
  };
  add(el.bar);
  if (!el.composer.hidden) {
    add(el.editorBox);
    add(el.counter);
  }
  if (el.toast.classList.contains('on')) add(el.toast);
  if (el.tip.classList.contains('on')) add(el.tip);
  add(el.inks);
  if (!el.handles.hidden) for (const h of el.handles.children) add(h);
  return out;
}

// With the bar on the page as it is, only the bar shows and takes clicks (the page is yours): the bar,
// with room for its shadow, and a label or bubble that's showing. (The bar's own box, worked out from
// its layout, so a bounce or the glass condensing in doesn't shrink it.)
function barRects() {
  const out = [];
  const pad = (r, side, below) => out.push({ x: r.x - side, y: Math.max(0, r.y - side), w: r.w + side * 2, h: r.h + side + below });
  if (!el.bar.hidden) {
    const k = app.k;
    const w = el.bar.offsetWidth * k;
    const h = el.bar.offsetHeight * k;
    const x = app.barPos ? app.barPos.x : (innerWidth - w) / 2;
    const y = app.barPos ? app.barPos.y : parseFloat(getComputedStyle(el.bar).top) || 0;
    pad({ x, y, w, h }, 14, 26);
  }
  for (const node of [el.toast, el.tip, el.inks]) {
    if (node === el.inks ? node.hidden : !node.classList.contains('on')) continue;
    // (The toast and the label, from where they're placed, not as they look mid-animation, when they're
    // still smaller.)
    let r = node.getBoundingClientRect();
    if (node !== el.inks && node.style.left) {
      const k = app.k;
      const w = node.offsetWidth;
      const h = node.offsetHeight;
      r = { left: parseFloat(node.style.left) + (w - w * k) / 2, top: parseFloat(node.style.top) + (h - h * k) / 2, width: w * k, height: h * k };
    }
    if (r.width > 0 && r.height > 0) pad({ x: r.left, y: r.top, w: r.width, h: r.height }, 12, 22);
  }
  return out;
}

// The still picture of the page stays behind the bar (its glass needs something to frost) but not
// over the live area.
function maskFrozen(r) {
  if (!r) {
    el.frozen.style.clipPath = '';
    return;
  }
  const W = innerWidth;
  const H = innerHeight;
  let d = `M0 0H${W}V${H}H0Z M${r.x} ${r.y}V${r.y + r.h}H${r.x + r.w}V${r.y}Z`;
  if (!el.bar.hidden) {
    const b = el.bar.getBoundingClientRect();
    d += ` M${b.left} ${b.top}H${b.right}V${b.bottom}H${b.left}Z`;
  }
  el.frozen.style.clipPath = `path(nonzero, "${d}")`;
}

// Bring the hole up to date with the state, the area and what's in front of it (once per frame).
// now: straight away. Needed when the overlay is all clipped away (just opened): Chrome then pauses
// this frame's animation frames, so a frame-timed update would never come and the bar never show.
let holeRaf = 0;
function updateHole({ now = false } = {}) {
  if (now) {
    cancelAnimationFrame(holeRaf);
    holeRaf = 0;
    return sendHole();
  }
  if (holeRaf) return;
  holeRaf = requestAnimationFrame(() => {
    holeRaf = 0;
    sendHole();
  });
}
function sendHole() {
  const r = LIVE.includes(app.state) && app.region ? app.region : null;
  maskFrozen(r);
  // On the page as it is, only the bar takes clicks, except while you press on it: then the whole
  // see-through overlay does, so a drag can go anywhere.
  const only = app.state === 'idle' && !barDrag ? barRects() : null;
  page('hole', { rect: r, keep: r ? keepRects() : [], only }).catch(() => {});
}

// No hole (now, not on the next frame): before taking a fresh picture of the page, say.
function clearHole() {
  cancelAnimationFrame(holeRaf);
  holeRaf = 0;
  maskFrozen(null);
  return page('hole', { rect: null, only: null }).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* The bar on the page as it is (from the icon)                        */
/* ------------------------------------------------------------------ */

// Nothing frozen, nothing dimmed: the page stays live and yours (only the bar takes clicks), and the
// chat beside it. This is where the icon opens. 📷 or 🎥 (or ▭, ▤) takes a new picture of the page and
// starts choosing.
function enterIdle() {
  closeBoxMenu();
  app.home = true;
  resetSnip();
  setState('idle');
  hideAll();
  el.bar.hidden = false;
  applyScale();
  showFrozen(false);
  dim(false, { fade: true });
  app.drag = null;
  app.hover = null;
  app.pickDepth = null;
  el.bTime.textContent = '0:00';
  syncBar();
  updateHole({ now: true });
  page('blur').catch(() => {}); // the keyboard goes back to the page (if the overlay had it)
}

// Back on the page: what you were making is put away (once it's saved or sent, or you stepped back),
// so the next one starts afresh.
function resetSnip() {
  app.gen++;
  if (app.editing) closeEditor();
  el.editor.value = '';
  app.caption = '';
  app.hasCaption = false;
  app.region = null;
  app.pick = null;
  app.layout = null;
  app.cardPos = null;
  app.adjust = null;
  app.repick = null;
  app.copied = null;
  app.highlights = [];
  app.edits = [];
  el.hls.replaceChildren();
  app.videoHere = false;
  app.cancelExport = false;
  if (app.rec) {
    try {
      app.rec.abort();
    } catch {}
    app.rec = null;
    send({ type: 'snip:recording', on: false }).catch(() => {}); // (the icon's REC badge goes)
  }
  discardClip();
  if (app.stream || app.player) releaseStream();
}

// 📷, 🎥, ▭ or ▤ (or Alt+Shift+V) from there: a picture of the page as it is now, then the dark screen.
let starting = false;
async function startSelecting(shape, kind = app.kind) {
  if (starting || !['idle', 'boot'].includes(app.state)) return;
  starting = true;
  setBusy(true);
  hideTip();
  app.kind = kind;
  app.shape = shape;
  try {
    await page('visible', { visible: false });
    if (Date.now() - OPENED_AT < 3000) await settleViewport(); // the chat may still be opening beside the page
    await sleep(120); // the page shows without the bar before its picture is taken
    const r = await send({ type: 'snip:capture' });
    if (!r || r.error || !r.shot) throw new Error((r && r.error) || 'Could not capture the page.');
    await loadShot(r.shot);
    app.info = await page('info', { uiWidth: innerWidth }).catch(() => app.info); // its videos, as pictured
    app.shotFresh = false;
    // Back on screen, and the whole overlay takes the pointer, before it says it's choosing (so a
    // quick drag can't land on the page).
    await page('visible', { visible: true });
    await clearHole();
    await page('settle').catch(() => {}); // until Chrome sends the pointer to the whole overlay
    enterSelect();
    setShape(shape, { fade: true });
  } catch (e) {
    enterIdle();
    toast('Could not take a picture of the page: ' + ((e && e.message) || e), { ms: 6000 });
  } finally {
    await page('visible', { visible: true }).catch(() => {});
    if (app.state === 'select') page('focus').catch(() => {}); // Esc and the arrows work right away
    setBusy(false);
    starting = false;
  }
  // The page's words, as pictured a moment ago (asked once the bar is back up and has the keyboard).
  if (app.state === 'select' && app.shot && !app.shotWords) app.shotWords = takeWords();
}

// Wait until the page has kept its size for a moment (at most about a second).
async function settleViewport() {
  let w = innerWidth;
  let h = innerHeight;
  let still = 0;
  for (let i = 0; i < 24 && still < 4; i++) {
    await sleep(50);
    if (innerWidth === w && innerHeight === h) still++;
    else {
      still = 0;
      w = innerWidth;
      h = innerHeight;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Select: the dark screen, toolbar, dragging                          */
/* ------------------------------------------------------------------ */

function enterSelect({ fresh = false } = {}) {
  const prevState = app.state;
  app.gen++;
  closeBoxMenu();
  setState('select');
  hideAll();
  clearHole();
  el.bar.hidden = false;
  applyScale();
  showFrozen(true);
  dim(true, { fade: ['idle', 'boot'].includes(prevState) });
  app.drag = null;
  app.hover = null;
  app.pickDepth = null;
  el.bTime.textContent = '0:00';
  syncBar();
  if (fresh && app.shotStale) retakeForSelect();
}

// Choosing again after 🎥 showed the page live (it may have scrolled), or after the window changed: a new
// picture of the page as it is now, and where its posts and videos are now.
async function retakeForSelect() {
  const gen = app.gen;
  el.sel.hidden = true;
  app.hover = null;
  try {
    await refreshShot();
  } catch {}
  if (app.state !== 'select' || gen !== app.gen) return;
  try {
    app.info = await page('info', { uiWidth: innerWidth });
  } catch {}
  app.shotFresh = false; // (as when you started choosing: the picture is the moment you chose)
  showFrozen(true);
}

// One bar, the same all the way through: this only dims what can't be used right now, and shows
// which choices are made and what is on (in blue). No button ever changes what it does.
function syncBar() {
  const st = app.state;
  const before = st === 'boot' || st === 'fatal' || st === 'closing';
  const idle = st === 'idle';
  // (While a save, copy or send is under way, and the moment after it, nothing new can be started.)
  const locked = busy || sending || el.bar.classList.contains('finished');
  const choosing = ['idle', 'select', 'compose', 'armed'].includes(st) && !(locked && st !== 'idle' && st !== 'select');
  const on = (b, v) => b.classList.toggle('on', !!v);

  // What to make, how to choose: open while choosing; afterwards the choice stays shown (blue). With the
  // bar on the page as it is, nothing is chosen: pressing any of the four starts choosing again.
  const groups = [
    ['[data-kind]', (b) => !idle && b.dataset.kind === app.kind],
    ['[data-shape]', (b) => !idle && b.dataset.shape === app.shape],
  ];
  for (const [q, chosen] of groups) {
    for (const b of el.bar.querySelectorAll(q)) {
      const c = chosen(b);
      b.setAttribute('aria-pressed', String(c));
      b.disabled = before || (!choosing && !c);
      b.classList.toggle('held', !choosing && c);
    }
  }
  el.bVideo.classList.toggle('has-dot', st === 'compose' && app.videoHere);
  label(el.bSnip, 'Screenshot');
  label(el.bVideo, 'Screen recording', KEY.record);
  label(el.bArea, 'Select an area');
  label(el.bPick, 'Select a post, image or video');

  // Record: starts a recording of the chosen area; stays on (blue) while it runs.
  const rec = el.bRec;
  const recOn = ['countdown', 'recording', 'stopping'].includes(st);
  rec.disabled = !(recOn || (['compose', 'armed', 'review'].includes(st) && !locked));
  rec.classList.toggle('held', recOn);
  if (armConfirm.btn !== rec) on(rec, recOn);
  rec.classList.toggle('counting', st === 'countdown');
  rec.setAttribute('aria-pressed', String(recOn));
  label(rec, 'Start recording');

  // Pause: while recording; on (black) while paused, and pressed again (or Space) it goes on.
  const paused = st === 'recording' && app.paused;
  el.bPause.disabled = st !== 'recording';
  on(el.bPause, paused);
  el.bPause.setAttribute('aria-pressed', String(paused));
  label(el.bPause, paused ? 'Resume recording' : 'Pause recording', KEY.space);
  document.body.classList.toggle('rec-paused', paused);
  el.region.classList.toggle('paused', paused);

  // Stop: only while counting down or recording.
  el.bStop.disabled = !['countdown', 'recording'].includes(st);
  label(el.bStop, 'Stop recording', KEY.record);


  // Save: the picture or the video; stays on (blue) while the video is made.
  const saving = st === 'exporting' || el.bar.classList.contains('finished');
  el.bSave.disabled = !(saving || ['compose', 'review'].includes(st));
  el.bSave.classList.toggle('held', saving);
  on(el.bSave, saving);
  label(el.bSave, ['review', 'exporting'].includes(st) || app.kind === 'record' ? 'Save video' : 'Save image', KEY.enter);

  // Copy: the picture, or the video (made first; the ring on Save fills up). Only when you ask: ⧉,
  // right-click the box, or Ctrl+C.
  el.bCopy.disabled = !['compose', 'review'].includes(st);
  label(el.bCopy, st === 'review' ? 'Copy video' : 'Copy image', KEY.copy);

  // Send to the chat (the Annotated.com logo): posts the picture or the video as you, right away; stays
  // on (blue) while it goes.
  el.bPost.disabled = !(sending || ['compose', 'review'].includes(st));
  el.bPost.classList.toggle('held', sending);
  el.bPost.classList.toggle('sending', sending);
  on(el.bPost, sending);
  label(el.bPost, 'Send to the chat');

  // The highlighter's colour: once you've pressed 📷, 🎥, ▭ or ▤ (not with the bar on the page as it
  // is), and not while recording (nothing then may cover the area). On (black) while its colours are open.
  el.bInk.disabled = before || idle || ['countdown', 'recording', 'stopping'].includes(st);
  on(el.bInk, !el.inks.hidden);
  label(el.bInk, 'Highlighter colour');

  // Undo: takes away the last highlight (like Ctrl+Z); dimmed when there's none.
  el.bUndo.disabled = !(['compose', 'review'].includes(st) && app.highlights.length > 0);
  label(el.bUndo, 'Undo highlight', KEY.undo);

  el.bClose.disabled = before && st !== 'fatal';
  label(el.bClose, 'Close', KEY.esc);
  if (tipBtn && (tipBtn.disabled || el.bar.hidden)) hideTip();
  else if (tipBtn && el.tip.classList.contains('on')) showTip(tipBtn);
  placeLozenges();
  placeHandles();
  if (clipped()) updateHole();
}

// Drag the bar anywhere: press and hold anywhere on it (even on a button) and move. A press that moves
// more than a few pixels moves the bar instead of pressing the button. Double-click its empty space to
// put it back at the top centre.
let barDrag = null;
let barDragged = false;
function wireBarDrag() {
  el.bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const r = el.bar.getBoundingClientRect();
    barDrag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, left: r.left, top: r.top, w: r.width, h: r.height, moving: false };
    if (app.state === 'idle') updateHole({ now: true }); // the whole overlay takes the pointer while you press
  });
  window.addEventListener('pointermove', (e) => {
    const d = barDrag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.moving) {
      if (Math.hypot(dx, dy) < 5) return;
      d.moving = true;
      try {
        el.bar.setPointerCapture(e.pointerId);
      } catch {}
      el.bar.classList.add('dragging');
      document.body.classList.add('bar-dragging');
      hideTip();
      closeInks();
    }
    moveBarTo(d.left + dx, d.top + dy);
  });
  const end = (e) => {
    const d = barDrag;
    if (!d || (e.pointerId != null && e.pointerId !== d.id)) return;
    barDrag = null;
    if (app.state === 'idle') updateHole({ now: true });
    if (!d.moving) return;
    el.bar.classList.remove('dragging');
    document.body.classList.remove('bar-dragging');
    barDragged = true; // the click this press makes isn't a button press
    setTimeout(() => (barDragged = false), 0);
  };
  window.addEventListener('pointerup', end, true);
  window.addEventListener('pointercancel', end, true);
  el.bar.addEventListener('lostpointercapture', end);
  el.bar.addEventListener('dblclick', (e) => {
    if (e.target.closest('button')) return;
    // (Dimmed and busy buttons let clicks through to the bar: is there a button under the pointer?)
    const onButton = [...el.bar.querySelectorAll('button')].some((b) => {
      const r = b.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    });
    if (onButton) return;
    app.barPos = null;
    el.bar.classList.remove('moved');
    el.bar.style.left = '';
    el.bar.style.top = '';
    afterBarMoved();
  });
}

// Keep it on the screen (all of it).
function moveBarTo(x, y) {
  const k = app.k;
  const w = el.bar.offsetWidth * k;
  const h = el.bar.offsetHeight * k;
  x = Math.round(clamp(x, 4, Math.max(4, innerWidth - w - 4)));
  y = Math.round(clamp(y, 4, Math.max(4, innerHeight - h - 4)));
  app.barPos = { x, y };
  el.bar.classList.add('moved');
  el.bar.style.left = x + 'px';
  el.bar.style.top = y + 'px';
  afterBarMoved();
}

function afterBarMoved() {
  if (el.toast.classList.contains('on')) placeToast();
  maskFrozen(LIVE.includes(app.state) && app.region ? app.region : null);
  if (clipped()) updateHole();
}

// A quick click still shows the pressed blue for a moment (as does Enter or Space on a focused button).
function flashPress(b) {
  b.classList.add('flash');
  clearTimeout(b._flashT);
  b._flashT = setTimeout(() => b.classList.remove('flash'), 220);
}

// A button's hover label (and its name for screen readers).
function label(btn, text, key = '') {
  btn.dataset.tip = text;
  btn.dataset.key = key;
  btn.setAttribute('aria-label', key ? `${text} (${key})` : text);
}

// Hover labels: a small capsule under the button. While recording it sits beside the bar instead,
// so it never covers (or ends up in) the recorded area.
let tipBtn = null;
let tipTimer = 0;
let tipHideTimer = 0;
function showTip(btn) {
  const text = btn && btn.dataset.tip;
  if (!text || btn.disabled || el.bar.hidden) return hideTip();
  if (btn === el.bInk && !el.inks.hidden) return hideTip(); // its colours are showing there
  tipBtn = btn;
  el.tipText.textContent = text;
  el.tipKey.textContent = btn.dataset.key || '';
  const t = el.tip;
  const k = app.k;
  const r = btn.getBoundingClientRect();
  const bar = el.bar.getBoundingClientRect();
  const w = t.offsetWidth;
  const h = t.offsetHeight;
  const tw = w * k;
  const th = h * k;
  let x = r.left + r.width / 2 - tw / 2;
  let y = bar.bottom + 8 * k;
  if (y + th > innerHeight - 8) y = bar.top - 8 * k - th; // the bar is low on the screen: above it
  const reg = app.region;
  if (reg && ['armed', 'countdown', 'recording', 'stopping'].includes(app.state) && intersects({ x, y, w: tw, h: th }, { x: reg.x - 6, y: reg.y - 6, w: reg.w + 12, h: reg.h + 12 })) {
    y = bar.top + (bar.height - th) / 2;
    x = bar.left - 10 - tw;
    if (x < 8) x = bar.right + 10;
  }
  placeScaled(t, clamp(x, 8, Math.max(8, innerWidth - tw - 8)), clamp(y, 4, Math.max(4, innerHeight - th - 8)), w, h);
  t.classList.add('on');
  if (clipped()) updateHole();
}

function hideTip() {
  clearTimeout(tipTimer);
  clearTimeout(tipHideTimer);
  tipBtn = null;
  el.tip.classList.remove('on');
  if (clipped()) updateHole();
}

// Slide each group's blue lozenge under its chosen button (it lifts while it moves, and bounces with
// the button when you hover it).
function placeLozenges() {
  for (const seg of el.bar.querySelectorAll('.seg')) {
    const loz = seg.querySelector('.lozenge');
    const on = seg.querySelector('button[aria-pressed="true"]');
    loz.classList.toggle('none', !on);
    if (!on || el.bar.hidden) continue;
    const x = `${on.offsetLeft - loz.offsetLeft}px`;
    const was = loz.style.getPropertyValue('--x');
    if (was && was !== x) {
      loz.classList.add('moving');
      clearTimeout(loz._t);
      loz._t = setTimeout(() => loz.classList.remove('moving'), 320);
    }
    loz.style.setProperty('--x', x);
  }
}

function setKind(kind) {
  app.kind = kind;
  if (app.state === 'select' || app.state === 'idle') {
    bodyState();
    syncBar();
  }
}

function setShape(shape, { fade = false } = {}) {
  app.shape = shape;
  el.sel.hidden = true;
  dim(true, { fade }); // (fading in from the bar on the page, it keeps fading)
  app.hover = null;
  bodyState();
  syncBar();
}

// Screenshot / Screen recording. Before choosing: what you'll make. After choosing an area: make the
// other one of the same area (your text stays).
async function onKind(kind) {
  const st = app.state;
  if ((busy || sending) && st !== 'idle' && st !== 'select') return; // a save, copy or send is under way
  if (st === 'idle') return startSelecting(app.shape, kind);
  if (st === 'select') {
    // The chosen one again: the dark screen goes; the bar (and the chat) stay, nothing chosen.
    if (kind === app.kind && !app.drag) return enterIdle();
    return setKind(kind);
  }
  if (st === 'compose' && kind === 'record') {
    keepTextForRepick();
    return enterArmed();
  }
  if (st === 'armed' && kind === 'snip') {
    keepTextForRepick();
    app.kind = 'snip';
    await clearHole();
    try {
      await refreshShot();
    } catch (e) {
      app.kind = 'record';
      updateHole();
      if (!el.composer.hidden) openEditor(app.caption); // (your text, as it was, still being written)
      toast('Could not capture the page: ' + e.message);
      return;
    }
    return enterCompose({ videoHere: !!videoIn(app.pick || app.region) });
  }
}

// Area / post, image or video. Before choosing: how you'll choose. After: choose again that way (your
// text stays). There's no full-screen button: drag a box, or pull its edges out to the screen's edges.
function onShape(shape, btn = null) {
  if ((busy || sending) && !['idle', 'select'].includes(app.state)) return; // a save, copy or send is under way
  if (app.state === 'idle') return startSelecting(shape);
  if (app.state === 'select') {
    // The chosen one again: the dark screen goes; the bar (and the chat) stay, nothing chosen. (Choosing
    // again, with the text you wrote kept: a second press lets that go too.)
    if (shape === app.shape && !app.drag) {
      if (btn && (app.caption || '').trim() && !confirmed(btn)) return armConfirm(btn, 'Press again to put this away, with your text');
      disarmConfirm();
      return enterIdle();
    }
    return setShape(shape);
  }
  if (!['compose', 'armed'].includes(app.state)) return;
  keepTextForRepick();
  enterSelect({ fresh: true });
  setShape(shape);
}

function keepTextForRepick() {
  if (app.editing) {
    app.caption = editorText();
    app.editing = false;
  }
}

// Record: start recording the chosen area. After a take, it records a new one (press twice: the take
// you have is replaced).
async function onRec() {
  const st = app.state;
  if (busy || sending) return; // a save, copy or send is under way
  if (st === 'compose') {
    keepTextForRepick();
    await enterArmed();
    return startRecording();
  }
  if (st === 'armed') return startRecording();
  if (st === 'review') {
    if (!confirmed(el.bRec)) return armConfirm(el.bRec, 'Press again to record over this video');
    disarmConfirm();
    keepTextForRepick();
    discardClip();
    await enterArmed();
    return startRecording();
  }
}

// Stop: end the recording (or the countdown before it).
function onStop() {
  if (app.state === 'countdown') return cancelCountdown();
  if (app.state === 'recording') return stopRecording('button');
}

// Pause (❚❚ or Space): nothing is recorded until you press it again; the video simply goes on from
// where it stopped, so you can scroll or move on to the next part in between. The time stands still.
function togglePause() {
  if (app.state !== 'recording' || !app.rec) return;
  if (app.rec.paused) app.rec.resume();
  else app.rec.pause();
  app.paused = app.rec.paused;
  syncBar();
}

// Space pauses or goes on while recording, except while you're writing your text (then it's a space).
function spacePauses(e) {
  return app.state === 'recording' && !e.ctrlKey && !e.metaKey && !e.altKey && !(app.editing && el.editor.value.trim());
}

function discardClip() {
  const old = el.media.querySelector('video');
  if (old) {
    old.pause();
    old.removeAttribute('src');
    old.load();
  }
  el.media.replaceChildren();
  if (app.previewUrl) URL.revokeObjectURL(app.previewUrl);
  app.previewUrl = null;
  app.recResult = null;
  app.copied = null; // (the video made of it for copying or the chat goes too)
}

function drawSel(r, { window: isWindow = false } = {}) {
  if (!r || r.w < 1 || r.h < 1) {
    el.sel.hidden = true;
    dim(true);
    return;
  }
  el.sel.hidden = false;
  dim(false);
  el.sel.classList.toggle('window', isWindow);
  el.sel.style.transform = `translate(${r.x}px, ${r.y}px)`;
  el.sel.style.width = r.w + 'px';
  el.sel.style.height = r.h + 'px';
}

let pickBusy = false;
let pickNext = null;
function requestPick(x, y) {
  pickNext = { x, y };
  if (!pickBusy) runPick();
}
async function runPick() {
  pickBusy = true;
  while (pickNext) {
    const p = pickNext;
    pickNext = null;
    let r = null;
    try {
      r = await page('pick', { x: p.x, y: p.y, depth: app.pickDepth });
    } catch {}
    if (app.state === 'select' && app.shape === 'window' && !app.drag) {
      app.hover = r;
      drawSel(r, { window: true });
    }
  }
  pickBusy = false;
}

async function finishSelection(r) {
  if (app.state !== 'select') return;
  r = snapRect(clampRect(r));
  if (r.w < 12 || r.h < 12) return; // too small: just keep choosing
  el.sel.hidden = true;
  app.pick = r; // your area, exactly as you chose it
  app.region = r;
  const v = videoIn(r);
  // What you make is what you chose: 📷 makes a picture even of a playing video.
  if (app.kind === 'record') return enterArmed();
  return enterCompose({ videoHere: !!v });
}

// The video (if any) in an area: `mostly` when the area is basically that video.
function videoIn(r) {
  const vids = (app.info && app.info.videos) || [];
  let best = null;
  for (const v of vids) {
    const a = overlapArea(v, r);
    if (!a) continue;
    const ofArea = a / (r.w * r.h);
    const ofVideo = a / (v.w * v.h);
    if (ofArea < 0.3 && ofVideo < 0.5) continue;
    if (!best || ofArea > best.ofArea) best = { ...v, ofArea, ofVideo, mostly: ofArea >= 0.6 };
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* The typing line                                                     */
/* ------------------------------------------------------------------ */

function editorText() {
  return el.editor.value.replace(/\r/g, '');
}

function openEditor(text = app.caption, { focus = true } = {}) {
  // Already typing (e.g. started before the box finished opening): keep what's there.
  const already = app.editing;
  app.editing = true;
  if (!already) el.editor.value = text;
  el.composer.hidden = false;
  el.cap.classList.add('editing');
  el.liveCap.classList.add('editing');
  const recordish = ['armed', 'countdown', 'recording'].includes(app.state);
  const fs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--edfs')) || 44;
  document.documentElement.style.setProperty('--edmax', recordish ? Math.round(fs * 1.22 * 2 + 4) + 'px' : '38vh');
  autosize();
  updateCounter();
  if (focus) {
    el.editor.focus({ preventScroll: true });
    const n = el.editor.value.length;
    el.editor.setSelectionRange(n, n);
  }
  updateCaret(true);
  relayout();
}

function closeEditor() {
  app.editing = false;
  el.composer.hidden = true;
  if (LIVE.includes(app.state)) updateHole();
  el.cap.classList.remove('editing');
  el.liveCap.classList.remove('editing');
  try {
    el.editor.blur();
  } catch {}
  relayout();
}

function autosize() {
  const t = el.editor;
  t.style.height = 'auto';
  const max = parseFloat(getComputedStyle(t).maxHeight) || Infinity;
  const h = Math.min(t.scrollHeight, max);
  t.style.height = h + 'px';
  t.classList.toggle('scroll', t.scrollHeight > max + 1);
  el.hilite.style.height = h + 'px';
  el.hilite.scrollTop = t.scrollTop;
  if (LIVE.includes(app.state)) updateHole();
}

// X's limit: the ring fills up to 280, shows what's left from 20, and goes red past it, with the
// extra characters marked red (like X's own composer). Counted the way X counts (xcount.js).
function editorBody() {
  return editorText().replace(/\s+$/, '');
}

function updateCounter() {
  const body = editorBody();
  const c = countX(body);
  el.counter.hidden = !body;
  el.hilite.textContent = '';
  if (!body) return c;
  el.counterVal.style.strokeDashoffset = String(75.4 * (1 - Math.min(1, c.length / X_POST_LIMIT)));
  const near = c.left <= 20;
  el.counter.classList.toggle('near', near && !c.over);
  el.counter.classList.toggle('over', c.over);
  el.counterLeft.textContent = near ? String(c.left) : '';
  el.counter.setAttribute('aria-label', `${c.left} characters left`);
  placeCounter();
  if (c.over) {
    const v = editorText();
    const mark = document.createElement('mark');
    mark.textContent = v.slice(c.fitEnd, body.length);
    el.hilite.append(document.createTextNode(v.slice(0, c.fitEnd)), mark, document.createTextNode(v.slice(body.length)));
    el.hilite.scrollTop = el.editor.scrollTop;
  }
  return c;
}

// Text that runs right to left (Hebrew, Arabic...), as its first letter says; and whether a character
// does (a space or a mark: as the text around it).
const RTL_LETTER = /[\p{sc=Hebrew}\p{sc=Arabic}\p{sc=Syriac}\p{sc=Thaana}\p{sc=Nko}]/u;
function rtlText(v) {
  const m = /\p{L}/u.exec(v || '');
  return !!m && RTL_LETTER.test(m[0]);
}
function rtlAt(ch, base) {
  if (!ch) return base;
  if (RTL_LETTER.test(ch)) return true;
  return /[\p{L}\p{N}]/u.test(ch) ? false : base;
}

// X's ring sits just before the first line of your text (on its left; on its right when the text runs right
// to left), centred on that line.
function placeCounter() {
  const c = el.counter;
  if (c.hidden || !app.editing) return;
  const t = el.editor;
  const m = el.mirror;
  const v = t.value;
  m.style.width = t.clientWidth + 'px';
  m.textContent = v || ' ';
  const node = m.firstChild;
  let i = 0;
  while (i < v.length - 1 && v[i] === '\n') i++;
  const range = document.createRange();
  range.setStart(node, Math.min(i, node.length));
  range.setEnd(node, Math.min(i + 1, node.length));
  const rects = range.getClientRects();
  const mr = m.getBoundingClientRect();
  const box = el.composer.getBoundingClientRect();
  const size = c.offsetHeight || 30;
  // (Before the first character: on its left, or on its right when the text runs right to left.)
  const rtl = rtlText(v);
  const x = rects.length ? (rtl ? rects[0].right : rects[0].left) : mr.left + mr.width / 2;
  const mid = rects.length ? rects[0].top + rects[0].height / 2 : mr.top + mr.height / 2;
  const left = rtl ? Math.min(box.right - size - 4, x + 14) : Math.max(4, x - 14 - size);
  const top = Math.max(box.top, mid - t.scrollTop - size / 2);
  c.style.left = Math.round(left - box.left) + 'px';
  c.style.top = Math.round(top - box.top) + 'px';
  if (LIVE.includes(app.state)) updateHole();
}

function nudgeCounter() {
  el.counter.classList.remove('shake');
  void el.counter.offsetWidth;
  el.counter.classList.add('shake');
}

// Position the big custom caret using a hidden copy of the text (same font, same wrapping).
function updateCaret(solid = false) {
  if (!app.editing) return;
  const t = el.editor;
  const caret = el.caret;
  if (document.activeElement !== t || t.selectionStart !== t.selectionEnd) {
    caret.classList.add('off');
    t.classList.toggle('native-caret', false);
    return;
  }
  const m = el.mirror;
  m.style.width = t.clientWidth + 'px';
  const pos = t.selectionEnd;
  const v = t.value;
  m.textContent = v.slice(0, pos);
  const mark = document.createElement('span');
  mark.textContent = v.slice(pos) || '​';
  m.append(mark);
  // A marker on the caret's own line: measure the first character after the caret.
  const range = document.createRange();
  const node = mark.firstChild;
  range.setStart(node, 0);
  range.setEnd(node, Math.min(1, node.length));
  const rects = range.getClientRects();
  const mr = m.getBoundingClientRect();
  let x;
  let y;
  if (rects.length) {
    // (Right to left: the caret is on the right of the character after it.)
    x = (rtlAt(node.data[0], rtlText(v)) ? rects[0].right : rects[0].left) - mr.left;
    y = rects[0].top - mr.top;
  } else {
    const r = mark.getBoundingClientRect();
    x = r.left - mr.left;
    y = r.top - mr.top;
  }
  if (!v.length) {
    // Empty: sit just before the (centered) placeholder text, not in the middle of it.
    m.textContent = '';
    const ph = document.createElement('span');
    ph.textContent = t.placeholder || '';
    m.append(ph);
    const pw = ph.getBoundingClientRect().width;
    x = Math.max(4, (t.clientWidth - pw) / 2 - Math.max(6, parseFloat(getComputedStyle(t).fontSize) * 0.12));
  }
  const fs = parseFloat(getComputedStyle(t).fontSize);
  const lh = fs * 1.22;
  caret.style.height = Math.round(fs * 1.06) + 'px';
  caret.style.transform = `translate(${Math.round(x - 1)}px, ${Math.round(y + (lh - fs * 1.06) / 2 - t.scrollTop + 2)}px)`;
  caret.classList.remove('off');
  if (solid) {
    caret.classList.add('solid');
    clearTimeout(updateCaret.t);
    updateCaret.t = setTimeout(() => caret.classList.remove('solid'), 550);
  }
}

// Enter: the text drops into the box, under the snip, with the source under it.
// Returns false (and stays in the typing line) when the text is over X's 280.
async function commit() {
  if (countX(editorBody()).over) {
    if (!app.editing) openEditor(app.caption);
    updateCounter();
    nudgeCounter();
    return false;
  }
  const text = editorText().replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
  const from = el.editor.getBoundingClientRect();
  const fromFont = parseFloat(getComputedStyle(el.editor).fontSize) || 44;
  await loadFonts(text);
  app.caption = text;
  app.hasCaption = true;
  updateLayout();
  closeEditor();
  const to = captionTarget();
  await flyText(from, fromFont, to);
  return true;
}

function updateLayout() {
  if (!app.region) return;
  app.layout = layoutCaption({
    text: app.hasCaption ? app.caption : '',
    source: app.hasCaption ? app.source : '',
    width: app.region.w,
  });
  renderCaptionCanvas(app.layout, dpr(), el.cap);
  el.cap.classList.toggle('empty', !app.layout.height);
  if (['armed', 'countdown', 'recording', 'stopping'].includes(app.state)) layoutLive();
}

function captionTarget() {
  if (!app.layout || !app.layout.height) return null;
  if (['compose', 'review'].includes(app.state) && app.cardPos) {
    const p = app.cardPos; // the picture: your text goes under it
    return { x: p.x, y: p.y + app.region.h * p.scale, scale: p.scale };
  }
  if (['armed', 'countdown', 'recording'].includes(app.state) && app.livePos) return app.livePos;
  return null;
}

async function flyText(from, fromFont, to) {
  const L = app.layout;
  if (!L || !L.height || !to || prefers.lessMotion) return; // (Reduce Motion: it's simply there)
  let s0 = fromFont / L.metrics.size;
  s0 = Math.max(0.5, Math.min(s0, (innerWidth * 0.94) / L.width, (innerHeight * 0.5) / L.height));
  const fly = renderCaptionCanvas(L, dpr() * Math.max(1, s0, to.scale));
  fly.className = 'flyer';
  const sx = from.left + from.width / 2 - (L.width * s0) / 2;
  const sy = from.top + from.height / 2 - (L.height * s0) / 2;
  document.body.append(fly);
  const targets = [el.cap, el.liveCap];
  for (const t of targets) t.style.opacity = '0';
  try {
    const anim = fly.animate(
      [
        { transform: `translate(${sx}px, ${sy}px) scale(${s0})`, opacity: 0.9 },
        { transform: `translate(${sx}px, ${sy}px) scale(${s0})`, opacity: 1, offset: 0.08 },
        { transform: `translate(${to.x}px, ${to.y}px) scale(${to.scale})`, opacity: 1 },
      ],
      { duration: 520, easing: 'cubic-bezier(.25,.8,.25,1)' }
    );
    await anim.finished;
  } catch {
    // animation interrupted: fine
  } finally {
    fly.remove();
    for (const t of targets) t.style.opacity = '';
  }
}

/* ------------------------------------------------------------------ */
/* Compose (still image)                                               */
/* ------------------------------------------------------------------ */

async function enterCompose({ videoHere = false } = {}) {
  const gen = ++app.gen;
  if (app.pick) app.region = app.pick; // a picture is always of your whole selection
  if (shotJob) await shotJob.catch(() => {}); // (a new picture being taken: that one)
  if (gen !== app.gen) return; // (something else started meanwhile: that goes on)
  if (!app.shot || app.shotStale) {
    try {
      await refreshShot();
    } catch (e) {
      if (gen !== app.gen) return;
      toast('Could not capture the page: ' + e.message);
      return enterSelect();
    }
    if (gen !== app.gen) return;
  }
  if (!app.region) return enterSelect();
  setState('compose');
  hideAll();
  showFrozen(true);
  dim(true);
  clearHole();
  app.videoHere = !!videoHere;
  syncBar();
  drawMediaFromShot();
  el.bTime.textContent = '0:00';
  el.card.hidden = false;
  updateLayout();
  openEditor(app.caption);
  layoutCard(true);
  refreshSource({ frozen: app.shotFresh !== true });
}

// The page's address, cleaned the same way (no logins, keys, codes or email addresses in it), as a
// stand-in until the page gives its best link: a file on your computer (or anything else not on the web)
// has no source link.
function webAddress(href) {
  try {
    return globalThis.annotatedCleanUrl(href) || '';
  } catch {
    return '';
  }
}

// Saving or sending waits a moment for the page's best link (a post's own address, a video's time) if
// it's still on its way.
function sourceSettled() {
  return Promise.race([app.sourceWait || Promise.resolve(), sleep(1200)]);
}

// Ask the page for the best link (a post's own URL on X, the video time on YouTube...).
function refreshSource({ frozen = false } = {}) {
  const region = app.region;
  const opts = { rect: region };
  if (frozen) {
    opts.frozen = true; // (a picture taken earlier: its video's time then, or none, never the time now)
    const v = videoIn(region);
    if (v && typeof v.t === 'number') opts.time = v.t;
  }
  const wait = page('source', opts)
    .then((r) => {
      if (!r || typeof r.url !== 'string' || region !== app.region) return; // ('' : no public source)
      const changed = r.url !== app.source;
      app.source = r.url;
      if (changed && app.hasCaption) {
        updateLayout();
        relayout();
      }
    })
    .catch(() => {});
  app.sourceWait = wait;
  return wait;
}

function drawMediaFromShot() {
  const r = app.region;
  const s = app.shot.scale;
  const sx = Math.round(r.x * s);
  const sy = Math.round(r.y * s);
  const sw = Math.max(1, Math.min(app.shot.bitmap.width - sx, Math.round(r.w * s)));
  const sh = Math.max(1, Math.min(app.shot.bitmap.height - sy, Math.round(r.h * s)));
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  c.getContext('2d').drawImage(app.shot.bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  el.media.replaceChildren(c);
  el.media.style.width = r.w + 'px';
  el.media.style.height = r.h + 'px';
  drawHighlights();
}

/* ------------------------------------------------------------------ */
/* Highlighting your snip                                              */
/* ------------------------------------------------------------------ */

// Press at the start of some text in your picture (or video) and drag: the text from there to the
// pointer turns the highlighter's colour (yellow, or the one picked with the marker in the bar), line by
// line, like selecting it. Only text: a drag that doesn't start on a letter marks nothing. Highlighting
// the same words again doesn't make them darker (all the highlights are one layer of colour). A click on
// a highlight takes it away again; ↶ or Ctrl+Z takes away the last one. The colour goes into everything
// you save, copy or send.
let hlDrag = null;
let hlDrags = 0; // (each drag's number, so the page never mixes up one drag's answers with the next)

// The point on the page under the pointer (the box may be lifted or shrunk to fit).
function hlPoint(e) {
  const p = app.cardPos;
  const r = app.region;
  if (!p || !r) return null;
  return { x: r.x + (e.clientX - p.x) / p.scale, y: r.y + (e.clientY - p.y) / p.scale };
}

function clipToRegion(q) {
  const r = app.region;
  if (!q || !r) return null;
  const x1 = Math.max(q.x, r.x);
  const y1 = Math.max(q.y, r.y);
  const x2 = Math.min(q.x + q.w, r.x + r.w);
  const y2 = Math.min(q.y + q.h, r.y + r.h);
  return x2 - x1 >= 1 && y2 - y1 >= 1 ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
}

function highlightAt(pt) {
  for (let i = app.highlights.length - 1; i >= 0; i--) {
    if (app.highlights[i].rects.some((q) => pt.x >= q.x && pt.x <= q.x + q.w && pt.y >= q.y && pt.y <= q.y + q.h)) return i;
  }
  return -1;
}

// Dark under there? (Then the yellow is laid over, see-through, rather than inked in.)
function hlDark(rects) {
  const shot = app.shot;
  if (!shot || !rects.length) return false;
  try {
    const x1 = Math.min(...rects.map((q) => q.x));
    const y1 = Math.min(...rects.map((q) => q.y));
    const x2 = Math.max(...rects.map((q) => q.x + q.w));
    const y2 = Math.max(...rects.map((q) => q.y + q.h));
    const s = shot.scale;
    const sx = clamp(Math.round(x1 * s), 0, shot.bitmap.width - 1);
    const sy = clamp(Math.round(y1 * s), 0, shot.bitmap.height - 1);
    const sw = Math.max(1, Math.min(shot.bitmap.width - sx, Math.round((x2 - x1) * s)));
    const sh = Math.max(1, Math.min(shot.bitmap.height - sy, Math.round((y2 - y1) * s)));
    const c = new OffscreenCanvas(Math.min(64, sw), Math.min(64, sh));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(shot.bitmap, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4) / 255 < 0.45;
  } catch {
    return false;
  }
}

function drawHighlights(preview = null) {
  const r = app.region;
  if (!r) return el.hls.replaceChildren();
  const review = app.state === 'review' || app.state === 'exporting';
  for (const node of [el.hls, el.hlcatch]) node.style.width = r.w + 'px';
  el.hls.style.height = r.h + 'px';
  el.hlcatch.style.height = Math.max(0, r.h - (review ? 48 : 0)) + 'px'; // a video keeps its controls
  // One layer for the ink (multiplied in as a whole) and one for the glow (see-through as a whole): the
  // same words highlighted twice are no darker.
  const ink = document.createElement('div');
  ink.className = 'ink';
  const glow = document.createElement('div');
  glow.className = 'glow';
  glow.style.opacity = String(HIGHLIGHT.glowAlpha);
  const add = (q, dark, id) => {
    const c = clipToRegion(q);
    if (!c) return;
    const i = document.createElement('i');
    const colour = inkFor(id);
    if (dark) i.className = 'dark';
    i.style.background = dark ? colour.glow : colour.ink;
    i.style.left = c.x - r.x + 'px';
    i.style.top = c.y - r.y + 'px';
    i.style.width = c.w + 'px';
    i.style.height = c.h + 'px';
    (dark ? glow : ink).append(i);
  };
  for (const h of app.highlights) for (const q of h.rects) add(q, h.dark, h.ink);
  if (preview) for (const q of preview.rects) add(q, preview.dark, preview.ink);
  el.hls.replaceChildren(ink, glow);
}

function onHighlightDown(e) {
  if (e.button !== 0 || busy || sending || !['compose', 'review'].includes(app.state)) return;
  const pt = hlPoint(e);
  if (!pt) return;
  e.preventDefault();
  e.stopPropagation();
  // The page has moved since its picture (the window or the chat beside it changed its size): its words
  // aren't where the picture shows them any more.
  const s = app.shot;
  if (app.state === 'compose' && s && s.vw && (Math.abs(innerWidth - s.vw) > 2 || Math.abs(innerHeight - s.vh) > 2)) {
    return toast('The page changed size since its picture. To highlight, choose the area again (▭).', { ms: 4500 });
  }
  closeBoxMenu();
  try {
    el.hlcatch.setPointerCapture(e.pointerId);
  } catch {}
  const d = { id: e.pointerId, drag: ++hlDrags, cx: e.clientX, cy: e.clientY, from: pt, to: pt, moved: false, mode: null, rects: [], hit: highlightAt(pt), asking: null, ink: app.ink };
  d.dark = hlDark([{ x: pt.x - 30, y: pt.y - 10, w: 60, h: 20 }]);
  d.ready = page('hlStart', { x: pt.x, y: pt.y, drag: d.drag })
    .then((res) => (d.mode = res && res.text ? 'text' : null)) // not on a letter: nothing to mark
    .catch(() => (d.mode = null))
    .then(() => hlDrag === d && hlUpdate(d));
  hlDrag = d;
}

function onHighlightMove(e) {
  const d = hlDrag;
  if (!d || e.pointerId !== d.id) return;
  if (!d.moved && Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < 4) return;
  d.moved = true;
  d.to = hlPoint(e) || d.to;
  hlUpdate(d);
}

// The lines of text from where you pressed to where you are; one question to the page at a time.
function hlUpdate(d) {
  if (!d.moved || d.mode !== 'text') return;
  if (d.asking) return (d.again = true);
  const to = d.to;
  d.asking = page('hlTo', { x: to.x, y: to.y, drag: d.drag })
    .then((rects) => {
      if (Array.isArray(rects)) d.rects = rects.map(clipToRegion).filter(Boolean);
      if (hlDrag === d) drawHighlights(d);
    })
    .catch(() => {})
    .then(() => {
      d.asking = null;
      if (d.again && hlDrag === d) {
        d.again = false;
        hlUpdate(d);
      }
    });
}

async function onHighlightUp(e) {
  const d = hlDrag;
  if (!d || (e.pointerId != null && e.pointerId !== d.id)) return;
  hlDrag = null;
  try {
    await d.ready;
    if (d.moved && d.mode === 'text') {
      // Where you let go, exactly.
      while (d.asking) await d.asking;
      const rects = await page('hlTo', { x: d.to.x, y: d.to.y, drag: d.drag }).catch(() => null);
      if (Array.isArray(rects)) d.rects = rects.map(clipToRegion).filter(Boolean);
    }
  } finally {
    page('hlEnd', { drag: d.drag }).catch(() => {});
  }
  if (!['compose', 'review'].includes(app.state)) return;
  if (d.moved) {
    if (d.rects.length) {
      app.highlights.push({ rects: d.rects, dark: hlDark(d.rects), ink: d.ink });
      app.edits.push('h');
      // (Your typing before it and after it are two undo steps, with the highlight between them.)
      if (app.editing) {
        const t = el.editor;
        t.setSelectionRange(t.selectionStart, t.selectionEnd, t.selectionDirection);
      }
      app.copied = null;
    }
    drawHighlights();
    return syncBar();
  }
  // A click: on a highlight, it goes; on the video, it plays or pauses.
  if (d.hit >= 0) {
    app.highlights.splice(d.hit, 1);
    // (and its place in what Ctrl+Z undoes: the highlights' marks are in the order they were made)
    for (let i = 0, n = -1; i < app.edits.length; i++) {
      if (app.edits[i] === 'h' && ++n === d.hit) {
        app.edits.splice(i, 1);
        break;
      }
    }
    app.copied = null;
    drawHighlights();
    return syncBar();
  }
  const v = app.state === 'review' && el.media.querySelector('video');
  if (v) v.paused ? v.play().catch(() => {}) : v.pause();
}

function undoHighlight() {
  if (!app.highlights.length) return false;
  app.highlights.pop();
  const i = app.edits.lastIndexOf('h');
  if (i >= 0) app.edits.splice(i, 1);
  app.copied = null;
  drawHighlights();
  syncBar(); // (the undo button dims when there's nothing left)
  return true;
}

/* The highlighter's colour: the marker in the bar opens nine colours, small squares 3 × 3 and nothing
   else. The one you pick draws your next highlights (those already there keep theirs), and it's kept
   for next time. */
function buildInks() {
  el.inks.replaceChildren(
    ...INKS.map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-label', c.name);
      b.dataset.ink = c.id;
      b.style.setProperty('--c', c.ink);
      return b;
    })
  );
  setInk(app.ink, { save: false });
}

function setInk(id, { save = true } = {}) {
  const c = inkFor(id);
  app.ink = c.id;
  el.bInk.style.setProperty('--hl', c.ink);
  for (const b of el.inks.children) b.setAttribute('aria-checked', String(b.dataset.ink === c.id));
  if (!save) return;
  try {
    chrome.storage.local.set({ ink: c.id }).catch(() => {});
  } catch {}
}

async function loadInk() {
  try {
    const got = await Promise.race([chrome.storage.local.get('ink'), sleep(800).then(() => ({}))]);
    if (got && got.ink) setInk(got.ink, { save: false });
  } catch {}
}

function toggleInks(fromKeyboard = false) {
  if (!el.inks.hidden) return closeInks({ back: fromKeyboard });
  openInks(fromKeyboard);
}

function openInks(fromKeyboard = false) {
  if (el.bInk.disabled) return;
  closeBoxMenu();
  hideTip();
  el.inks.hidden = false;
  el.bInk.classList.add('on');
  el.bInk.setAttribute('aria-expanded', 'true');
  placeInks();
  // From the keyboard: onto the colour in use, to move with the arrows. And when the page or the chat
  // has the keyboard (the bar on the page as it is), the menu takes it, so a click away closes it.
  if (fromKeyboard || !document.hasFocus()) {
    const cur = el.inks.querySelector('[aria-checked="true"]') || el.inks.firstElementChild;
    if (cur) cur.focus({ preventScroll: true });
  }
  if (clipped()) updateHole({ now: true });
}

function closeInks({ back = false } = {}) {
  if (el.inks.hidden) return;
  const had = el.inks.contains(document.activeElement);
  el.inks.hidden = true;
  el.bInk.classList.remove('on');
  el.bInk.setAttribute('aria-expanded', 'false');
  if (had && app.editing) el.editor.focus({ preventScroll: true });
  else if (had && back) el.bInk.focus({ preventScroll: true });
  if (clipped()) updateHole({ now: true });
}

// Under the marker (above the bar when the bar is low on the screen), the bar's size.
function placeInks() {
  const m = el.inks;
  const k = app.k;
  const b = el.bInk.getBoundingClientRect();
  const bar = el.bar.getBoundingClientRect();
  const w = m.offsetWidth * k;
  const h = m.offsetHeight * k;
  let y = bar.bottom + 8 * k;
  if (y + h > innerHeight - 8) y = bar.top - 8 * k - h;
  m.style.left = Math.round(clamp(b.left + b.width / 2 - w / 2, 8, Math.max(8, innerWidth - w - 8))) + 'px';
  m.style.top = Math.round(clamp(y, 4, Math.max(4, innerHeight - h - 4))) + 'px';
}

function wireInks() {
  buildInks();
  // Picking a colour leaves the keyboard where it was (your text, say).
  el.inks.addEventListener('pointerdown', (e) => e.preventDefault());
  el.inks.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-ink]');
    if (!b) return;
    setInk(b.dataset.ink);
    closeInks({ back: e.detail === 0 });
  });
  // Arrows move between the squares (three to a row); Enter or Space picks; Esc or Tab closes.
  el.inks.addEventListener('keydown', (e) => {
    const items = [...el.inks.children];
    const i = Math.max(0, items.indexOf(document.activeElement));
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[e.key];
    if (step != null || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : clamp(i + step, 0, items.length - 1);
      items[j].focus({ preventScroll: true });
    } else if (e.key === 'Tab') {
      e.preventDefault();
      closeInks({ back: true });
    }
  });
  // A press anywhere else closes it, and so does the keyboard going to the page or the chat. The press
  // only closes it (it doesn't also pick an area or start a highlight), except on the bar's buttons.
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (el.inks.hidden || el.inks.contains(e.target) || el.bInk.contains(e.target)) return;
      closeInks();
      if (!el.bar.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );
  window.addEventListener('blur', () => closeInks());
}

// Place the box (the picture, your text under it): where you snipped it if it fits, otherwise
// lifted/shrunk to stay fully visible between the bar at the top and the typing line at the bottom.
// app.cardPos is where the picture is (the box's top-left).
function layoutCard(instant = false) {
  if (el.card.hidden || !app.region) return;
  const r = app.region;
  const capH = app.layout ? app.layout.height : 0;
  const w = r.w;
  const h = r.h + capH;
  el.card.style.width = w + 'px';
  el.card.style.height = h + 'px';
  // Where you snipped it, even under the bar or the typing line (they stay in front); lifted or shrunk
  // only if the box wouldn't fit on screen.
  const reserveBottom = 8;
  const top = 0;
  const availH = Math.max(80, innerHeight - reserveBottom - top);
  const availW = innerWidth - 28;
  const scale = Math.min(1, availH / h, availW / w);
  let x = r.x;
  let y = r.y;
  if (scale < 1) {
    x = r.x + (w - w * scale) / 2;
    y = Math.min(r.y, innerHeight - reserveBottom - h * scale);
  } else if (y + h > innerHeight - reserveBottom) {
    y = innerHeight - reserveBottom - h;
  }
  x = clamp(x, 14, Math.max(14, innerWidth - 14 - w * scale));
  y = Math.max(top, y);
  app.cardPos = { x, y, scale };
  placeHandles(instant);
  el.card.classList.toggle('instant', !!instant);
  el.card.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  if (instant) {
    void el.card.offsetWidth;
    el.card.classList.remove('instant');
  }
}

function relayout() {
  if (['compose', 'review'].includes(app.state)) layoutCard();
  else if (['armed', 'countdown', 'recording'].includes(app.state)) layoutLive();
}

/* ------------------------------------------------------------------ */
/* Saving / copying a still                                            */
/* ------------------------------------------------------------------ */

// "Annotated.com꞉ <the first few words of your text>.png" (or .jpg / .mp4). Windows doesn't allow ":"
// in file names, so the colon is the look-alike "꞉" (U+A789). With no text: "Annotated.com꞉ Screenshot
// 2026-10-12 183015.png".
function fileName(base, ext) {
  const words = firstWords(app.caption, 6, 50);
  if (words) return `Annotated.com\uA789 ${words}.${ext}`;
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `Annotated.com\uA789 ${base} ${stamp}.${ext}`;
}

// Up to `maxWords` words (and `maxChars` characters) of the text, safe for a file name on any system.
function firstWords(text, maxWords, maxChars) {
  const clean = String(text || '')
    .replace(/:/g, '\uA789')
    .replace(/[\\/*?"<>|\u0000-\u001f\u007f\u200b\u200c\u200e\u200f\u2028\u2029\u202a-\u202e\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  let out = '';
  for (const w of clean.split(' ').slice(0, maxWords)) {
    const next = out ? `${out} ${w}` : w;
    if (Array.from(next).length > maxChars) {
      if (!out) out = Array.from(w).slice(0, maxChars).join('');
      break;
    }
    out = next;
  }
  // Windows also refuses names that end in a dot or a space.
  return out.replace(/[.\s]+$/, '');
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

let busy = false;
function setBusy(on) {
  busy = on;
  document.body.classList.toggle('busy', on);
}

// Drop the text in (if it isn't yet) before saving. False when it's over X's 280.
async function ensureCommitted() {
  if (app.editing || !app.hasCaption) {
    if (!app.editing) el.editor.value = app.caption;
    return commit();
  }
  return true;
}

async function save() {
  if (!['compose', 'review'].includes(app.state)) return;
  openChatNow(); // right in your click or key: afterwards the bar and the chat stay
  if (copying) app.followUp = true; // a copy under way finishes first (and doesn't end the snip)
  await copied();
  app.followUp = false;
  if (busy) return;
  if (app.state === 'compose') return saveImage();
  if (app.state === 'review') return saveVideo();
}

async function saveImage() {
  const gen = app.gen;
  setBusy(true);
  try {
    if (!(await ensureCommitted())) return;
    await sourceSettled();
    const text = await snipText();
    const out = await exportImage({ shot: app.shot.bitmap, shotScale: app.shot.scale, region: app.region, layout: app.layout, highlights: app.highlights, source: app.source, ...text });
    const name = fileName('Screenshot', out.ext);
    download(out.blob, name);
    el.bar.classList.add('finished');
    syncBar();
    await sleep(1100);
    done(gen);
  } catch (e) {
    toast('Could not save: ' + ((e && e.message) || e));
  } finally {
    setBusy(false);
  }
}

// Saved, copied or sent: the dark screen goes, the bar stays on the page with the chat open beside it,
// and the page scrolls again, ready for the next one. (Unless something new was started meanwhile: then
// that stays.)
function done(gen = app.gen) {
  if (closing || gen !== app.gen) return;
  enterIdle();
}

// Copy (⧉, Ctrl+C, or right-click the box): the picture or the video, ready to paste into a post or
// the chat.
function copy() {
  if (!['compose', 'review'].includes(app.state)) return;
  openChatNow(); // right in your click or key: afterwards the bar and the chat stay
  // One copy at a time: pressing again (or holding Ctrl+C) while one is under way does nothing more, and
  // Save or Send pressed meanwhile waits for it (see copied()).
  if (copying) return copying;
  const p = app.state === 'compose' ? copyImageNow() : copyVideo();
  copying = p;
  p.finally(() => copying === p && (copying = null)).catch(() => {});
  return p;
}

// Alongside what's copied, for the chat (a web format other apps ignore): where it's from, so the
// chat can offer "Copy source link" on it.
const CLIP_META = 'web application/x-annotated+json';
function clipMeta(extra) {
  const meta = { app: 'Annotated.com', source: app.source || '', ...extra };
  return new Blob([JSON.stringify(meta)], { type: 'application/x-annotated+json' });
}

// A copy under way (⧉, right-click or Ctrl+C): Save and the send button wait for it rather than
// ignoring you.
let copying = null;
function copied() {
  return copying ? copying.catch(() => {}) : Promise.resolve();
}

async function copyImageNow() {
  if (busy || app.state !== 'compose') return;
  const gen = app.gen;
  let ok = false;
  setBusy(true);
  try {
    if (!(await ensureCommitted())) return;
    const made = exportPng({ shot: app.shot.bitmap, shotScale: app.shot.scale, region: app.region, layout: app.layout, highlights: app.highlights });
    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': made.then((out) => out.blob),
        [CLIP_META]: made.then((out) => clipMeta({ kind: 'image', name: fileName('Screenshot', 'png'), width: out.width, height: out.height })),
      }),
    ]);
    ok = true;
    ping('copy', { icon2: 'check' });
  } catch (e) {
    toast('Copy was blocked here. Use Save instead. (' + ((e && e.message) || e) + ')', { ms: 5000 });
  } finally {
    setBusy(false);
  }
  if (ok && !app.followUp) done(gen);
}

// A video can't go on the clipboard the way a picture does (there's no standard place for one), so it
// goes as a web format the chat reads: paste it there with Ctrl+V. It's made to fit the chat's 50 MB;
// the ring on Save fills up meanwhile. Copied again unchanged, it isn't made twice.
const CHAT_MAX_BYTES = 50 * 1024 * 1024;
async function copyVideo() {
  if (busy || app.state !== 'review') return;
  const gen = app.gen;
  let copiedOk = false;
  setBusy(true);
  // The clipboard is asked right in your click; the video follows when it's made.
  let give;
  let fail;
  const blobP = new Promise((res, rej) => {
    give = res;
    fail = rej;
  });
  const metaP = blobP.then(() => clipMeta(app.copied.meta));
  metaP.catch(() => {});
  let wrote = null;
  try {
    wrote = navigator.clipboard.write([new ClipboardItem({ 'web video/mp4': blobP, [CLIP_META]: metaP })]);
  } catch (e) {
    wrote = Promise.reject(e);
  }
  wrote.catch(() => {});
  // (Chrome refused the clipboard straight away: there's no need to make the video first to find out.)
  const refused = wrote.then(
    () => new Promise(() => {}),
    (e) => Promise.reject(e)
  );
  refused.catch(() => {});
  try {
    if (!(await Promise.race([committedForVideo(), refused]))) throw Object.assign(new Error('Your text is over 280 characters.'), { quiet: true });
    const made = await Promise.race([videoMade(), refused]);
    give(made.blob);
    await wrote;
    pingWithNotes('copy', made.notes);
    copiedOk = true;
  } catch (e) {
    fail(e);
    if (!e || !e.quiet) toast('Could not copy the video: ' + ((e && e.message) || e), { ms: 6000 });
  } finally {
    setBusy(false);
    if (!closing) syncBar();
  }
  if (copiedOk && !app.followUp) done(gen);
}

// The video for copying or the chat, made to fit the chat's 50 MB (the ring on Save fills up meanwhile).
// Made once for the same clip and text.
async function videoMade() {
  const key = JSON.stringify([app.region, app.caption, app.highlights, app.recResult && app.recResult.durationUs]);
  if (app.copied && app.copied.key === key) return app.copied;
  const made = await makeVideo({ maxBytes: CHAT_MAX_BYTES });
  if (!made) throw Object.assign(new Error('cancelled'), { quiet: true });
  const { out, v } = made;
  el.bar.classList.remove('exporting', 'finished');
  setRing(0);
  setState('review');
  if (v) v.play().catch(() => {});
  let fit = out;
  if (fit.blob.size > CHAT_MAX_BYTES) {
    // A little over the chat's limit: made once more, a little smaller.
    const again = await makeVideo({ maxBytes: Math.floor((CHAT_MAX_BYTES * 0.9 * CHAT_MAX_BYTES) / fit.blob.size) });
    if (!again) throw Object.assign(new Error('cancelled'), { quiet: true });
    el.bar.classList.remove('exporting', 'finished');
    setRing(0);
    setState('review');
    if (again.v) again.v.play().catch(() => {});
    fit = again.out;
  }
  if (fit.blob.size > CHAT_MAX_BYTES) {
    throw new Error(`The video came out at ${Math.round(fit.blob.size / 1048576)} MB, over the chat's 50 MB. Save it instead, or record a shorter clip.`);
  }
  app.copied = { key, blob: fit.blob, notes: fit.notes || [], meta: { kind: 'video', name: fileName('Screen Recording', 'mp4'), width: fit.width, height: fit.height, seconds: fit.seconds } };
  return app.copied;
}

// "Copied" or "Sent", with anything to know about the video in words next to it (no sound, say).
function pingWithNotes(icon, notes) {
  if (notes && notes.length) ping(icon, { icon2: 'check', text: notes.join(' '), ms: 7000 });
  else ping(icon, { icon2: 'check' });
}

// Right-click the box (your picture or video): Save, Copy and Send to the chat, like ⤓ ⧉ and the logo
// in the bar (just the words: no shortcuts shown). The menu takes the keys (↑ ↓ to choose, Enter, Esc);
// nothing in it is lit until you point at it or press ↓.
function openBoxMenu(x, y) {
  const m = el.boxMenu;
  const video = app.state === 'review';
  el.mSaveLbl.textContent = video ? 'Save video' : 'Save image';
  el.mCopyLbl.textContent = video ? 'Copy video' : 'Copy image';
  el.mPost.disabled = sending; // (already on its way)
  m.hidden = false;
  const k = app.k;
  const w = m.offsetWidth * k;
  const h = m.offsetHeight * k;
  m.style.left = Math.round(x + w > innerWidth - 8 ? Math.max(8, x - w) : x) + 'px';
  m.style.top = Math.round(y + h > innerHeight - 8 ? Math.max(8, y - h) : y) + 'px';
  m.focus({ preventScroll: true });
}

// ↑ ↓ (and Home, End) go through the menu's choices; the pointer lights the one it's on.
function moveInBoxMenu(key) {
  const items = [...el.boxMenu.querySelectorAll('button:not(:disabled)')];
  if (!items.length) return false;
  const i = items.indexOf(document.activeElement);
  const n = items.length;
  const to = key === 'ArrowDown' ? (i + 1) % n : key === 'ArrowUp' ? (i < 0 ? n - 1 : (i - 1 + n) % n) : key === 'Home' ? 0 : key === 'End' ? n - 1 : -1;
  if (to < 0) return false;
  items[to].focus({ preventScroll: true });
  return true;
}

function closeBoxMenu() {
  if (el.boxMenu.hidden) return;
  const had = el.boxMenu.contains(document.activeElement);
  el.boxMenu.hidden = true;
  if (had && app.editing) el.editor.focus({ preventScroll: true });
}

/* ------------------------------------------------------------------ */
/* Recording                                                           */
/* ------------------------------------------------------------------ */

async function enterArmed({ auto = false } = {}) {
  app.gen++;
  app.kind = 'record';
  app.shotStale = true; // (the page shows live in your area from now on: it may change)
  setState('armed');
  hideAll();
  showFrozen(true);
  dim(false);
  // Your whole area, even under the bar or the typing line (they stay in front).
  app.region = app.pick || app.region;
  el.region.hidden = false;
  el.region.classList.remove('live');
  el.bRecCount.textContent = '';
  el.bTime.textContent = '0:00';
  updateLayout();
  layoutLive();
  openEditor(app.caption);
  updateHole();
  refreshSource();
  if (auto) {
    el.bRec.classList.remove('attention');
    void el.bRec.offsetWidth;
    el.bRec.classList.add('attention');
  }
}

// The box while recording: the live area (a hole in the overlay) with your text under it.
function layoutLive() {
  const r = app.region;
  if (!r) return;
  const L = app.layout;
  const capH = L ? L.height : 0;
  let s = 1;
  if (capH) {
    const room = innerHeight - 6 - (r.y + r.h);
    if (capH > room) s = clamp(room / capH, 0.35, 1);
    el.liveCap.hidden = false;
    renderCaptionCanvas(L, dpr(), el.liveCap);
    el.liveCap.style.transformOrigin = '0 0';
    el.liveCap.style.transform = `translate(${r.x}px, ${r.y + r.h}px) scale(${s})`;
  } else {
    el.liveCap.hidden = true;
  }
  app.livePos = { x: r.x, y: r.y + r.h, scale: s };
  placeHandles(true);
  updateHole();
  el.region.style.transform = `translate(${r.x}px, ${r.y}px)`;
  el.region.style.width = r.w + 'px';
  el.region.style.height = r.h + capH * s + 'px';
}

async function getTabStream() {
  const want = () =>
    send({ type: 'snip:streamId' }).then((r) => {
      if (!r || r.error || !r.id) throw new Error((r && r.error) || 'Chrome did not allow recording this tab.');
      return r.id;
    });
  let W = Math.round(innerWidth * dpr());
  let H = Math.round(innerHeight * dpr());
  if (W > 3840) {
    H = Math.round((H * 3840) / W);
    W = 3840;
  }
  const video = (id) => ({ mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: id, minWidth: W, maxWidth: W, minHeight: H, maxHeight: H, maxFrameRate: 30 } });
  const id = await want();
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: id } }, video: video(id) });
  } catch {
    const id2 = await want();
    return navigator.mediaDevices.getUserMedia({ video: video(id2) });
  }
}

async function startRecording() {
  if (app.state !== 'armed') return;
  const attempt = ++app.attempt;
  const current = () => attempt === app.attempt && app.state === 'countdown';
  app.startedAt = performance.now();
  setState('countdown');
  el.bRecCount.textContent = '';
  const backToArmed = (msg) => {
    if (attempt !== app.attempt) return;
    setState('armed');
    el.bRecCount.textContent = '';
    if (msg) toast(msg, { ms: 6000 });
  };
  let stream = null;
  try {
    stream = await getTabStream();
  } catch (e) {
    return backToArmed('Chrome blocked recording here: ' + ((e && e.message) || e));
  }
  if (!current()) {
    // Cancelled while Chrome was getting the tab ready.
    for (const t of stream.getTracks()) t.stop();
    return;
  }
  app.stream = stream;
  if (stream.getAudioTracks().length) await startPlayback(false, current);
  if (!current()) {
    // Called off meanwhile (that let go of the tab and its sound): nothing is left running.
    for (const t of stream.getTracks()) t.stop();
    if (app.stream === stream) releaseStream();
    return;
  }
  const rec = new Recorder(stream, {
    cropCss: app.region,
    viewCss: { w: innerWidth, h: innerHeight },
    maxUs: (X.videoMaxSeconds - 0.4) * 1e6,
    onAudio: forwardAudio,
    onLimit: () => stopRecording('limit'),
    onError: (e) => {
      if (app.state === 'recording' && app.rec === rec) stopRecording('error');
      else if (current() && app.rec === rec) {
        // During the countdown: it ends, with what went wrong.
        app.attempt++;
        rec.abort();
        app.rec = null;
        releaseStream();
        setState('armed');
        el.bRecCount.textContent = '';
        toast('Recording could not start: ' + ((e && e.message) || e), { ms: 6000 });
      } else if (attempt === app.attempt) toast('Recording problem: ' + ((e && e.message) || e));
    },
  });
  app.rec = rec;
  try {
    await rec.prepare();
  } catch (e) {
    rec.abort();
    if (attempt !== app.attempt) return;
    app.rec = null;
    releaseStream();
    return backToArmed('Recording could not start: ' + ((e && e.message) || e));
  }
  for (const n of [2, 1]) {
    if (!current()) return;
    el.bRecCount.textContent = String(n);
    await sleep(1000);
  }
  if (!current()) return;
  // Link to the moment the recording starts (YouTube gets &t=).
  refreshSource();
  try {
    app.rec.begin();
  } catch (e) {
    rec.abort();
    app.rec = null;
    releaseStream();
    return backToArmed('Recording could not start: ' + ((e && e.message) || e));
  }
  app.paused = false;
  setState('recording');
  el.region.classList.add('live');
  el.bRecCount.textContent = '';
  send({ type: 'snip:recording', on: true }).catch(() => {});
  clearInterval(app.tickTimer);
  app.tickTimer = setInterval(() => {
    if (app.state !== 'recording') return clearInterval(app.tickTimer);
    const s = app.rec.elapsedUs() / 1e6;
    el.bTime.textContent = fmtTime(s);
    if (s >= X.videoMaxSeconds) stopRecording('limit');
  }, 200);
}

function cancelCountdown() {
  if (app.state !== 'countdown') return;
  app.attempt++; // anything still starting up for the old attempt cleans itself up
  if (app.rec) app.rec.abort();
  app.rec = null;
  releaseStream();
  setState('armed');
  el.bRecCount.textContent = '';
}

function releaseStream() {
  if (app.stream) for (const t of app.stream.getTracks()) t.stop();
  app.stream = null;
  stopPlayback();
}

// Capturing a tab mutes it for you. Send its sound to a hidden extension page that plays it
// (outside the tab, so it isn't captured again).
async function startPlayback(quiet = false, wanted = () => !!app.stream) {
  try {
    const r = await send({ type: 'snip:audioOn' });
    if (!r || r.error) throw new Error((r && r.error) || 'no player');
    if (!wanted()) {
      // (No longer wanted by the time the sound page was ready: it's let go again.)
      if (!app.player) send({ type: 'snip:audioOff' }).catch(() => {});
      return;
    }
    if (app.player) {
      try {
        app.player.disconnect();
      } catch {}
    }
    const p = chrome.runtime.connect({ name: 'snip-audio' });
    app.player = p;
    p.onDisconnect.addListener(() => {
      if (app.player !== p) return;
      app.player = null;
      // Chrome closes a silent audio page after ~30 s: open it again while still capturing.
      if (app.stream && ['countdown', 'recording'].includes(app.state)) setTimeout(() => app.stream && !app.player && startPlayback(true), 300);
    });
  } catch {
    app.player = null;
    if (!quiet) ping('muted', { ms: 2600 });
  }
}

function stopPlayback() {
  const p = app.player;
  app.player = null;
  if (p) {
    try {
      p.disconnect();
    } catch {}
  }
  send({ type: 'snip:audioOff' }).catch(() => {});
}

let pcmScratch = null;
function forwardAudio(ad) {
  const port = app.player;
  if (!port) return;
  const n = ad.numberOfFrames;
  const ch = Math.min(2, ad.numberOfChannels);
  if (!pcmScratch || pcmScratch.length < n) pcmScratch = new Float32Array(n);
  const out = new Int16Array(n * ch);
  for (let c = 0; c < ch; c++) {
    ad.copyTo(pcmScratch.subarray(0, n), { planeIndex: c, format: 'f32-planar' });
    for (let i = 0; i < n; i++) {
      const v = pcmScratch[i];
      out[i * ch + c] = v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767);
    }
  }
  const bytes = new Uint8Array(out.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  try {
    port.postMessage({ type: 'pcm', sr: ad.sampleRate, ch, n, b64: btoa(bin) });
  } catch {
    app.player = null;
  }
}

async function stopRecording(reason) {
  if (app.state !== 'recording' || !app.rec) return;
  app.paused = false;
  setState('stopping');
  clearInterval(app.tickTimer);
  send({ type: 'snip:recording', on: false }).catch(() => {});
  let result = null;
  try {
    result = await app.rec.stop();
  } catch (e) {
    releaseStream();
    app.rec = null;
    toast('Recording failed: ' + ((e && e.message) || e), { ms: 6000 });
    return enterArmed();
  }
  releaseStream();
  app.recResult = result;
  app.rec = null;
  await clearHole();
  enterReview(result.partial ? 'error' : reason);
}

async function enterReview(reason) {
  const wasEditing = app.editing;
  setState('review');
  hideAll();
  showFrozen(true);
  dim(true);
  if (app.previewUrl) URL.revokeObjectURL(app.previewUrl);
  app.previewUrl = null;
  const v = document.createElement('video');
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.autoplay = true;
  v.controls = true;
  v.disablePictureInPicture = true;
  v.setAttribute('controlslist', 'nodownload noplaybackrate noremoteplayback');
  try {
    const blob = previewMp4(app.recResult);
    if (blob) {
      app.previewUrl = URL.createObjectURL(blob);
      v.src = app.previewUrl;
    }
  } catch (e) {
    console.warn('[Annotated.com] preview', e);
  }
  el.media.replaceChildren(v);
  el.media.style.width = app.region.w + 'px';
  el.media.style.height = app.region.h + 'px';
  drawHighlights();
  el.bTime.textContent = fmtTime(app.recResult.durationUs / 1e6);
  el.card.hidden = false;
  updateLayout();
  page('focus').catch(() => {}); // (you may have clicked into the page while recording)
  if (wasEditing) openEditor();
  layoutCard(true);
  v.play().catch(() => {});
  if (reason === 'limit') ping('timer', { text: fmtTime(Math.round(app.recResult.durationUs / 1e6)), ms: 2600 });
  else if (reason === 'resize') ping('resize', { ms: 2600 });
  else if (reason === 'error') toast('Recording stopped because of an error. What was recorded before it is kept.');
}

// Saving a video: the Save button turns into a ring that fills up (the other tools step aside).
function setRing(p) {
  const C = 2 * Math.PI * 14;
  el.saveRing.style.strokeDashoffset = String(C * (1 - Math.max(0, Math.min(1, p))));
  el.bSave.setAttribute('aria-label', `Saving, ${Math.round(p * 100)}%`);
}

// Makes the MP4 (the Save button turns into a ring that fills up, the other tools step aside).
// Returns { out, prev, v }, or null if it was cancelled or failed (the clip is back as it was).
async function makeVideo({ maxBytes = 0, onProgress = null } = {}) {
  const prev = app.state;
  disarmConfirm();
  setState('exporting');
  const v = el.media.querySelector('video');
  if (v) v.pause();
  el.bar.classList.add('exporting');
  el.bar.classList.remove('finished');
  setRing(0);
  app.cancelExport = false;
  try {
    const out = await exportVideo({
      rec: app.recResult,
      region: app.region,
      layout: app.layout,
      highlights: app.highlights,
      maxBytes,
      isCancelled: () => app.cancelExport,
      onProgress: (p) => {
        setRing(p);
        if (onProgress) onProgress(p);
      },
    });
    return { out, prev, v };
  } catch (e) {
    el.bar.classList.remove('exporting', 'finished');
    if (closing) return null;
    setState(prev === 'exporting' ? 'review' : prev);
    if (v) v.play().catch(() => {});
    if (!e || e.name !== 'AbortError') toast('Could not make the video: ' + ((e && e.message) || e), { ms: 7000 });
    return null;
  }
}

async function committedForVideo() {
  try {
    return await ensureCommitted();
  } catch {
    return true; // the caption animation failing must not stop the video
  }
}

async function saveVideo() {
  const gen = app.gen;
  setBusy(true);
  try {
    if (!(await committedForVideo())) return;
    const made = await makeVideo();
    if (!made) return;
    const { out } = made;
    const name = fileName('Screen Recording', 'mp4');
    download(out.blob, name);
    setRing(1);
    el.bar.classList.add('finished');
    syncBar();
    el.bSave.setAttribute('aria-label', 'Saved');
    app.lastExport = { width: out.width, height: out.height, seconds: out.seconds, bytes: out.blob.size, codec: out.codec, audio: out.hasAudio };
    if (out.notes.length) toast(out.notes.join(' '), { ms: 7000 });
    await sleep(out.notes.length ? 4000 : 1300);
    done(gen);
  } finally {
    setBusy(false);
    if (!closing) syncBar();
  }
}

/* ------------------------------------------------------------------ */
/* Close / cancel / toggle                                             */
/* ------------------------------------------------------------------ */

let closing = false;
// withChat: you closed Annotated.com (✕, Esc, the icon), so the chat closes too.
function close({ withChat = false } = {}) {
  if (closing) return;
  closing = true;
  app.state = 'closing';
  try {
    if (app.rec) app.rec.abort();
  } catch {}
  releaseStream();
  // The page helper takes the overlay away and tells the worker (so the chat closes too, and the icon
  // knows it's closed).
  if (port) port.postMessage({ type: 'close', token: TOKEN, closeChat: withChat });
  else send({ type: 'snip:closed', token: TOKEN, closeChat: withChat }).catch(() => {});
}

// Esc is ✕ (the bar and the chat close), except while a video is being made: then it stops the
// recording (or calls off the countdown), and while the video is being finished it waits. So one Esc
// (meant for the page, say, while recording) never throws a recording away: it stops, and the video is
// there to save (closing then takes a second press).
function escapeKey() {
  const st = app.state;
  if (st === 'countdown') return cancelCountdown();
  if (st === 'recording') return stopRecording('esc');
  if (st === 'stopping' || st === 'exporting') return;
  return closePressed();
}

// ✕ (or Esc): with a video you haven't saved yet, it asks for a second press first.
function closePressed() {
  if (app.state === 'review' && !confirmed(el.bClose)) return armConfirm(el.bClose, 'Press ✕ or Esc again to close without saving this video');
  disarmConfirm();
  return requestClose();
}

// Close (✕, Esc, the icon) closes the bar and the chat with it, at once, whatever you were making.
// When the chat itself was closed (its ×, Chrome's side panel button), the bar goes with it.
function requestClose({ chatClosed = false } = {}) {
  app.cancelExport = true;
  close({ withChat: !chatClosed });
}

// The icon (or Alt+Shift+S) or Alt+Shift+V again, or the chat closing, while Annotated.com is open on
// this page. The icon closes the bar and the chat, and the chat closing takes the bar with it (at once,
// like ✕). Alt+Shift+V stops a recording (or calls off a countdown), starts choosing an area for a
// video from the bar on the page, and backs out of the dark screen.
function onToggle(mode) {
  const st = app.state;
  // The chat closed while your post was on its way to it: the post comes back to you (with why), and the
  // bar stays so you can send it again.
  if (mode === 'chat-closed' && chatWait) return chatWait(new Error('The chat closed while it was sending. Open the chat to see if it went in, or send again.'));
  // The chat closed: the bar goes too, but never in the middle of a recording, a video not yet saved,
  // or a picture you've started on in another tab (that would be lost); close it yourself then.
  if (mode === 'chat-closed' && ['countdown', 'recording', 'stopping', 'exporting', 'review'].includes(st)) return;
  if (mode === 'chat-closed' && document.hidden && st === 'compose' && (app.hasCaption || app.highlights.length || (app.editing && editorText().trim()))) return;
  if (mode === 'chat-closed') return requestClose({ chatClosed: true });
  if (mode === 'bar') return requestClose();
  if (st === 'recording') return stopRecording('toggle');
  if (st === 'countdown') return cancelCountdown();
  if (st === 'idle') return startSelecting(app.shape, mode === 'snip' ? 'snip' : 'record'); // Alt+Shift+V: a video
  if (st === 'select') return app.home ? enterIdle() : close();
}

/* ------------------------------------------------------------------ */
/* Pulling the edges or corners of your area                           */
/* ------------------------------------------------------------------ */

// Where your area is on screen: the picture in the box (which may be lifted or shrunk to fit), or the
// live area before a recording starts.
function selectionView() {
  const st = app.state;
  if (st === 'compose' && app.cardPos && app.region && !el.card.hidden) {
    const p = app.cardPos;
    return { x: p.x, y: p.y, w: app.region.w * p.scale, h: app.region.h * p.scale };
  }
  if (st === 'armed' && app.region) return { ...app.region };
  return null;
}

function placeHandles(instant = false) {
  const h = el.handles;
  const v = app.adjust && app.adjust.view ? app.adjust.view : selectionView();
  if (!v) {
    h.hidden = true;
    return;
  }
  h.hidden = false;
  h.classList.toggle('instant', !!instant);
  h.style.transform = `translate(${v.x}px, ${v.y}px)`;
  h.style.width = v.w + 'px';
  h.style.height = v.h + 'px';
  if (instant) {
    void h.offsetWidth;
    h.classList.remove('instant');
  }
}

function startAdjust(e, which) {
  if (!['compose', 'armed'].includes(app.state) || e.button !== 0 || busy || sending) return;
  e.preventDefault();
  e.stopPropagation();
  app.adjust = { which, x0: e.clientX, y0: e.clientY, r0: { ...app.region }, st: app.state, view: null, rect: null, moved: false, knob: e.target };
  document.body.style.setProperty('--adjust-cursor', getComputedStyle(e.target).cursor);
  document.body.classList.add('adjusting');
  e.target.classList.add('on');
  try {
    e.target.setPointerCapture(e.pointerId);
  } catch {}
}

function moveAdjust(e) {
  const a = app.adjust;
  if (!a) return false;
  const dx = e.clientX - a.x0;
  const dy = e.clientY - a.y0;
  if (!a.moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return true;
  if (!a.moved && a.st === 'compose') {
    // While you pull, the real area shows on the page (the box may have been lifted or shrunk to fit).
    el.card.hidden = true;
  }
  a.moved = true;
  let x1 = a.r0.x;
  let y1 = a.r0.y;
  let x2 = a.r0.x + a.r0.w;
  let y2 = a.r0.y + a.r0.h;
  // The handles sit on the box as it's shown (it may be lifted or shrunk to fit), so an edge moves by
  // as much as you pull; and pulling it to the screen's edge takes it all the way there.
  const W = innerWidth;
  const H = innerHeight;
  if (a.which.includes('w')) x1 = e.clientX <= EDGE_SNAP ? 0 : toEdge(x1 + dx, W);
  if (a.which.includes('e')) x2 = e.clientX >= W - EDGE_SNAP ? W : toEdge(x2 + dx, W);
  if (a.which.includes('n')) y1 = e.clientY <= EDGE_SNAP ? 0 : toEdge(y1 + dy, H);
  if (a.which.includes('s')) y2 = e.clientY >= H - EDGE_SNAP ? H : toEdge(y2 + dy, H);
  const r = snapRect(clampRect(normRect({ x: x1, y: y1 }, { x: x2, y: y2 })));
  if (r.w < 12 || r.h < 12) return true;
  a.rect = r;
  a.view = { ...r };
  if (a.st === 'compose') {
    drawSel(r);
  } else {
    app.region = r;
    app.pick = r;
    layoutLive();
  }
  placeHandles(true);
  return true;
}

function endAdjust() {
  const a = app.adjust;
  if (!a) return false;
  app.adjust = null;
  document.body.classList.remove('adjusting');
  if (a.knob) a.knob.classList.remove('on');
  if (a.st !== app.state) return true;
  if (!a.moved || !a.rect) {
    if (a.moved && a.st === 'compose') {
      el.sel.hidden = true;
      el.card.hidden = false;
      dim(true);
    }
    placeHandles();
    return true;
  }
  const r = a.rect;
  app.pick = r;
  app.region = r;
  if (a.st === 'compose') {
    el.sel.hidden = true;
    dim(true);
    app.videoHere = !!videoIn(r);
    drawMediaFromShot();
    el.card.hidden = false;
    updateLayout();
    layoutCard(true);
    syncBar();
    refreshSource({ frozen: app.shotFresh !== true });
  } else {
    updateLayout();
    layoutLive();
    refreshSource();
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Input wiring                                                        */
/* ------------------------------------------------------------------ */

function inPanel(t) {
  return t && t.closest && t.closest('.bar, #composer, #card, #liveCap, #toast, #handles, #inks, #boxMenu');
}

/* ------------------------------------------------------------------ */
/* Send to the chat (the Annotated.com button)                         */
/* ------------------------------------------------------------------ */

// The bar hands what you made to the chat beside the page, and the chat posts it as you, straight away
// (a draft in the chat's own box stays as it was). Both are this extension's own pages, so the picture
// or video goes across as it is. Then the dark screen goes, and the bar stays on the page.
const CHAT_CHANNEL = 'annotated-chat';

async function sendToChat() {
  if (sending || !['compose', 'review'].includes(app.state)) return;
  openChatNow(); // right in the click: Chrome only opens the side panel as your direct action
  if (copying) app.followUp = true; // a copy under way finishes first (and doesn't end the snip)
  await copied();
  app.followUp = false;
  if (busy || sending || !['compose', 'review'].includes(app.state)) return;
  const gen = app.gen;
  const video = app.state === 'review';
  sending = true;
  setBusy(true);
  syncBar();
  let sent = false;
  let flight = null;
  try {
    // Your text goes in first (as Enter would put it); over X's 280, it stays where you can cut it.
    if (!(video ? await committedForVideo() : await ensureCommitted())) {
      if (video) throw Object.assign(new Error('Your text is over 280 characters.'), { quiet: true });
      return;
    }
    // Then your post flies off to the chat beside the page while it's made and sent (it comes back if
    // the chat can't take it).
    flight = flyToChat();
    const post = video ? await videoForChat() : await pictureForChat();
    await handToChat(post);
    sent = true;
    await flight.landed;
  } catch (e) {
    if (flight) flight.back();
    if (!e || !e.quiet) toast('Couldn’t send it to the chat: ' + ((e && e.message) || e), { ms: 6000 });
  } finally {
    sending = false;
    setBusy(false);
    if (!closing) syncBar();
  }
  if (!sent || closing) return;
  flight.end();
  pingWithNotes('logo', video && app.copied ? app.copied.notes : null);
  done(gen);
}

// Send: the box, your snip with your text under it, flies off the page to the right, into the chat beside
// it (getting about as small as a post there), as your text flies into the box on Enter; the dark screen
// goes as it leaves. With Reduce Motion it just fades.
let flying = null;
function flyToChat() {
  const card = el.card;
  const p = app.cardPos;
  const flight = { landed: Promise.resolve(), back() {}, end() {} };
  if (card.hidden || !p) return flight;
  closeBoxMenu();
  el.handles.hidden = true;
  card.classList.add('leaving');
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  const s = p.scale;
  const s1 = s * Math.min(1, Math.max(0.3, 300 / Math.max(1, w * s)));
  const x1 = innerWidth + 24; // all the way past the page's right edge, where the chat is
  const y1 = p.y + (h * s - h * s1) / 2; // (level with where it was)
  const anims = [];
  try {
    anims.push(
      prefers.lessMotion
        ? card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' })
        : card.animate(
            [{ transform: `translate(${p.x}px, ${p.y}px) scale(${s})` }, { transform: `translate(${x1}px, ${y1}px) scale(${s1})` }],
            { duration: 640, easing: 'cubic-bezier(.55,0,.3,1)', fill: 'forwards' }
          )
    );
    anims.push(el.dim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 460, easing: 'ease-out', fill: 'forwards' }));
  } catch {
    // no animations here: it simply goes when it's sent
  }
  const clear = () => {
    for (const a of anims) a.cancel();
    card.classList.remove('leaving');
    if (flying === flight) flying = null;
  };
  flight.landed = Promise.all(anims.map((a) => a.finished.catch(() => {})));
  // The chat couldn't take it: it comes back, as it was.
  flight.back = () => {
    clear();
    if (['compose', 'review'].includes(app.state)) placeHandles(true);
  };
  // It's in the chat: the box and the dark screen are put away for real (so nothing comes back for a moment).
  flight.end = () => {
    card.hidden = true;
    dim(false);
    clear();
  };
  flight.clear = clear;
  flying = flight;
  return flight;
}

async function pictureForChat() {
  await sourceSettled();
  const text = await snipText();
  const out = await exportImage({ shot: app.shot.bitmap, shotScale: app.shot.scale, region: app.region, layout: app.layout, highlights: app.highlights, source: app.source, ...text });
  const name = fileName('Screenshot', out.ext);
  return { file: new File([out.blob], name, { type: out.blob.type }), kind: 'image', width: out.width, height: out.height };
}

// The words your snip shows (asked of the page, briefly: it never holds up a save) and what you wrote about
// them. They go into the picture's file, where the chat's Ask AI reads them.
async function snipText() {
  const note = app.hasCaption && app.layout ? app.layout.text || '' : '';
  let words = '';
  try {
    // The words as pictured; if the page didn't give them then, as it is now.
    const list = app.shotWords ? await Promise.race([app.shotWords, sleep(1500).then(() => null)]) : null;
    if (Array.isArray(list)) words = joinWords(list, app.region);
    else {
      const r = await Promise.race([page('words', { rect: app.region }), sleep(800).then(() => '')]);
      words = typeof r === 'string' ? r : '';
    }
  } catch {}
  return { words, note };
}

async function videoForChat() {
  const made = await videoMade();
  return { file: new File([made.blob], made.meta.name, { type: 'video/mp4' }), kind: 'video', width: made.meta.width, height: made.meta.height, seconds: made.meta.seconds };
}

// Gives the chat in this window what you made and waits until it's posted. The chat may still be
// opening: it's asked again until it answers, and it says how the upload is going meanwhile.
let chatWait = null; // (the post on its way to the chat: called if the chat closes meanwhile)
function handToChat(post) {
  return new Promise((resolve, reject) => {
    const bc = new BroadcastChannel(CHAT_CHANNEL);
    const id = crypto.randomUUID();
    const msg = { type: 'post', id, windowId: app.session.windowId, source: app.source || '', ...post };
    let answered = false;
    let quiet = 0;
    let again = 0;
    let watch = 0;
    const done = (err) => {
      if (chatWait === done) chatWait = null;
      clearInterval(again);
      clearInterval(watch);
      bc.close();
      if (err) reject(err);
      else resolve();
    };
    chatWait = done;
    bc.onmessage = (e) => {
      const m = e.data;
      if (!m || m.id !== id) return;
      answered = true;
      quiet = 0;
      if (m.type === 'posted') done();
      else if (m.type === 'failed') done(new Error(m.error || 'The chat couldn’t post it.'));
    };
    bc.postMessage(msg);
    again = setInterval(() => answered || bc.postMessage(msg), 600);
    watch = setInterval(() => {
      quiet++;
      if (!answered && quiet >= 20) {
        // (Not the icon: that closes the bar, and what you made with it.)
        clearInterval(watch);
        clearInterval(again);
        chatShortcut().then((k) => done(new Error(k ? `The chat didn’t open. Press ${k} to open it, then send again.` : 'The chat didn’t open. Open it from Chrome’s side panel, then send again.')));
      } else if (answered && quiet >= 120) done(new Error('The chat stopped answering.'));
    }, 1000);
  });
}

// The chat's own shortcut (Alt+Shift+L, unless you changed it or Chrome gave it to something else).
async function chatShortcut() {
  try {
    const c = (await chrome.commands.getAll()).find((x) => x.name === 'open-annotations');
    return (c && c.shortcut) || '';
  } catch {
    return '';
  }
}

// Opens the chat in Chrome's side panel if it isn't open, right in the click (Chrome only lets the
// panel open as a direct result of your action).
function openChatNow() {
  const windowId = app.session && app.session.windowId;
  const viaWorker = () => send({ type: 'snip:openChat' }).catch(() => {});
  try {
    if (windowId != null && chrome.sidePanel && chrome.sidePanel.open) {
      chrome.sidePanel.open({ windowId }).catch(viaWorker);
      return;
    }
  } catch {}
  viaWorker();
}

function wireUi() {
  for (const g of document.querySelectorAll('.bar.glass')) glassify(g);
  toastGlass = glassify(el.toast, { auto: false });
  glassify(el.boxMenu, { auto: false, rim: 14, blur: 2.6, veilMid: 0.5, lens: 26 }); // right-click the box: glass too
  // Clicking a button must not take the keyboard away from the typing line. (If the keyboard had gone
  // to the page meanwhile, the click brings it back: copying needs it here.)
  for (const b of document.querySelectorAll('.bar button'))
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (app.state !== 'idle' && !document.hasFocus()) window.focus();
    });
  // While the dark screen is up, Tab goes round the typing line and the bar's buttons; it never takes the
  // keyboard to the page under it (or out of the window) by surprise.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (['boot', 'closing', 'fatal', 'idle'].includes(app.state)) return;
      if (el.boxMenu.contains(e.target) || el.inks.contains(e.target)) return; // (Tab closes those)
      e.preventDefault();
      const list = [];
      if (app.editing && !el.composer.hidden) list.push(el.editor);
      for (const b of document.querySelectorAll('.bar button')) if (!b.disabled && b.getClientRects().length && getComputedStyle(b).visibility === 'visible') list.push(b);
      if (!list.length) return;
      const i = list.indexOf(document.activeElement);
      const next = i < 0 ? list[e.shiftKey ? list.length - 1 : 0] : list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length];
      next.focus({ preventScroll: true });
    },
    true
  );
  document.addEventListener(
    'click',
    (e) => {
      if (app.editing && e.target.closest && e.target.closest('.bar button')) el.editor.focus({ preventScroll: true });
    },
    true
  );
  el.bar.addEventListener('pointerover', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    clearTimeout(tipHideTimer);
    clearTimeout(tipTimer);
    // Once one label is showing, the next appears at once as you move along the bar.
    if (el.tip.classList.contains('on')) showTip(b);
    else tipTimer = setTimeout(() => showTip(b), 350);
  });
  el.bar.addEventListener('pointerout', (e) => {
    const to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('#bar button');
    if (to && !to.disabled) return;
    clearTimeout(tipTimer);
    tipHideTimer = setTimeout(hideTip, 80);
  });
  el.bar.addEventListener('focusin', (e) => {
    const b = e.target.closest('button');
    if (b && b.matches(':focus-visible')) showTip(b);
  });
  el.bar.addEventListener('focusout', () => hideTip());
  wireBarDrag();
  el.bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    hideTip();
    if (barDragged || !b || b.disabled) return;
    flashPress(b);
    if (b.dataset.kind) return onKind(b.dataset.kind);
    if (b.dataset.shape) return e.detail > 1 ? undefined : onShape(b.dataset.shape, b); // (a double-click is one press)
    if (b === el.bClose) return closePressed();
    if (b === el.bRec) return onRec();
    if (b === el.bStop) return onStop();
    if (b === el.bPause) return togglePause();
    if (b === el.bSave) return save();
    if (b === el.bCopy) return copy();
    if (b === el.bPost) return sendToChat();
    if (b === el.bInk) return toggleInks(e.detail === 0);
    if (b === el.bUndo) return undoHighlight();
  });
  wireInks();

  el.hlcatch.addEventListener('pointerdown', onHighlightDown);
  el.hlcatch.addEventListener('pointermove', onHighlightMove);
  el.hlcatch.addEventListener('pointerup', onHighlightUp);
  el.hlcatch.addEventListener('pointercancel', onHighlightUp);
  el.hlcatch.addEventListener('lostpointercapture', (e) => hlDrag && onHighlightUp(e));

  el.cap.addEventListener('click', () => {
    if (['compose', 'review'].includes(app.state)) openEditor(app.caption);
  });
  el.liveCap.addEventListener('click', () => openEditor(app.caption));

  // Ctrl+Z in the typing line undoes whatever you did last: your typing (the line's own undo), or a
  // highlight you've made since you typed.
  el.editor.addEventListener('beforeinput', (e) => {
    if (/^history/.test(e.inputType || '')) return;
    const last = app.edits[app.edits.length - 1];
    if (!last || last === 'h') app.edits.push({ from: el.editor.value });
  });
  el.editor.addEventListener('input', (e) => {
    if (e.inputType === 'historyUndo') {
      const last = app.edits[app.edits.length - 1];
      const v = el.editor.value;
      if (last && last !== 'h' && (v === last.from || v.length < last.from.length)) app.edits.pop(); // that typing is all undone
    }
    autosize();
    updateCounter();
    updateCaret(true);
    if (['compose', 'review'].includes(app.state)) layoutCard();
  });
  el.editor.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return; // (typing with an input method: its keys are its own)
    if (e.key === ' ' && spacePauses(e)) {
      e.preventDefault();
      if (!e.repeat) togglePause(); // (held down, it doesn't flicker on and off)
      return;
    }
    // Save with Ctrl+S (or ⌘S), from the typing line too, rather than Chrome saving the web page (and
    // never that, while there's nothing to save yet).
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (!e.repeat && !e.shiftKey && ['compose', 'review'].includes(app.state)) commit().then((ok) => ok && save());
      return;
    }
    // Copy with nothing selected in the text: copy the picture (like the Copy button).
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'c' && el.editor.selectionStart === el.editor.selectionEnd && ['compose', 'review'].includes(app.state)) {
      e.preventDefault();
      if (!e.repeat) copy();
      return;
    }
    // Undo: a highlight you've made since you last typed goes first (then your typing, the line's own).
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z' && ['compose', 'review'].includes(app.state)) {
      // (Typing that's all undone already, or that changed nothing, has nothing left to undo.)
      for (let top = app.edits[app.edits.length - 1]; top && top !== 'h' && top.from === el.editor.value; top = app.edits[app.edits.length - 1]) app.edits.pop();
      if (app.edits[app.edits.length - 1] === 'h' && app.highlights.length) {
        e.preventDefault();
        undoHighlight();
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (e.repeat) return; // (held down: it drops your text in once, and doesn't go on to save)
      // Enter drops your text in (nothing is copied: ⧉, right-click or Ctrl+C copies). Ctrl+Enter also
      // saves.
      if (e.ctrlKey || e.metaKey) commit().then((ok) => ok && save());
      else commit();
      return;
    }
    if (e.key === 'Escape') {
      // Esc is ✕: the bar and the chat close (the highlighter's colours, if open, close first).
      e.preventDefault();
      e.stopPropagation();
      if (!el.inks.hidden) return closeInks();
      if (!e.repeat) escapeKey();
    }
  });
  el.editor.addEventListener('blur', () => el.caret.classList.add('off'));
  el.editor.addEventListener('focus', () => updateCaret(true));
  el.editor.addEventListener('scroll', () => {
    el.hilite.scrollTop = el.editor.scrollTop;
    placeCounter();
    updateCaret();
  });
  document.addEventListener('selectionchange', () => app.editing && updateCaret(true));
  el.composer.addEventListener('pointerdown', (e) => {
    if (e.target !== el.editor) {
      e.preventDefault();
      el.editor.focus({ preventScroll: true });
    }
  });

  el.handles.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('[data-h]');
    if (h) startAdjust(e, h.dataset.h);
  });
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', () => {
    app.drag = null;
    endAdjust();
  });
  document.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);
  // Right-click the box (your picture or video) to save, copy or send it; nowhere else has a menu.
  document.addEventListener('contextmenu', (e) => {
    if (e.target === el.editor) return closeBoxMenu(); // (the typing line's own menu: paste, spelling)
    e.preventDefault();
    const onBox = e.target.closest && e.target.closest('#card');
    if (onBox && ['compose', 'review'].includes(app.state) && !app.adjust) openBoxMenu(e.clientX, e.clientY);
    else closeBoxMenu();
  });
  // (Each one right in your click: Chrome opens the chat beside the page only then.)
  el.mSave.addEventListener('click', () => {
    closeBoxMenu();
    save();
  });
  el.mCopy.addEventListener('click', () => {
    closeBoxMenu();
    copy();
  });
  el.mPost.addEventListener('click', () => {
    closeBoxMenu();
    sendToChat();
  });
  el.boxMenu.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.boxMenu.addEventListener('pointermove', (e) => {
    const b = e.target.closest('button');
    if (b && !b.disabled && document.activeElement !== b) b.focus({ preventScroll: true });
  });
  el.boxMenu.addEventListener('pointerleave', () => {
    if (!el.boxMenu.hidden && document.activeElement !== el.boxMenu) el.boxMenu.focus({ preventScroll: true });
  });
  el.boxMenu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      closeBoxMenu();
      return;
    }
    if (moveInBoxMenu(e.key)) e.preventDefault();
  });
}

function onPointerDown(e) {
  app.pointer = { x: e.clientX, y: e.clientY };
  closeBoxMenu();
  if (e.button === 0 && !inPanel(e.target) && ['compose', 'armed'].includes(app.state) && !busy && !sending) {
    // Dragging on the dark area picks a different area (your text stays); a plain click does nothing.
    app.repick = { x0: e.clientX, y0: e.clientY };
    return;
  }
  if (app.state !== 'select' || e.button !== 0 || inPanel(e.target)) return;
  e.preventDefault();
  try {
    document.body.setPointerCapture(e.pointerId);
  } catch {}
  app.drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, moved: false, window: app.shape === 'window' };
}

function onPointerMove(e) {
  app.pointer = { x: e.clientX, y: e.clientY };
  if (moveAdjust(e)) return;
  const rp = app.repick;
  if (rp && ['compose', 'armed'].includes(app.state)) {
    if (Math.abs(e.clientX - rp.x0) < 6 && Math.abs(e.clientY - rp.y0) < 6) return;
    app.repick = null;
    keepTextForRepick();
    if (app.shape !== 'rect') app.shape = 'rect';
    // (After 🎥 showed the page live, it may have moved: you choose again on a new picture of it.)
    if (app.shotStale) return enterSelect({ fresh: true });
    enterSelect();
    try {
      document.body.setPointerCapture(e.pointerId);
    } catch {}
    app.drag = { x0: rp.x0, y0: rp.y0, x1: e.clientX, y1: e.clientY, moved: false, window: false };
  }
  if (app.state !== 'select') return;
  const d = app.drag;
  if (d && !d.window) {
    d.x1 = clamp(e.clientX, 0, innerWidth);
    d.y1 = clamp(e.clientY, 0, innerHeight);
    if (Math.abs(d.x1 - d.x0) > 4 || Math.abs(d.y1 - d.y0) > 4) d.moved = true;
    if (d.moved) drawSel(boxToEdges({ x: d.x0, y: d.y0 }, { x: d.x1, y: d.y1 }));
    return;
  }
  if (app.shape === 'window' && !d && !inPanel(e.target)) {
    // A new spot: go back to the best guess (the wheel picks bigger/smaller from there).
    if (app.hover && !(e.clientX >= app.hover.x && e.clientX <= app.hover.x + app.hover.w && e.clientY >= app.hover.y && e.clientY <= app.hover.y + app.hover.h)) app.pickDepth = null;
    requestPick(e.clientX, e.clientY);
  }
}

async function onPointerUp(e) {
  app.repick = null;
  if (endAdjust()) return;
  const d = app.drag;
  app.drag = null;
  if (app.state !== 'select' || !d) return;
  if (d.window) {
    const r = app.hover || (await page('pick', { x: e.clientX, y: e.clientY, depth: app.pickDepth }).catch(() => null));
    if (r) finishSelection(r);
    return;
  }
  if (!d.moved) {
    // A click (no drag): grab the thing under the pointer, like Window mode.
    const r = await page('pick', { x: d.x0, y: d.y0, depth: null }).catch(() => null);
    if (r) {
      drawSel(r, { window: true });
      await sleep(140);
      finishSelection(r);
    }
    return;
  }
  finishSelection(boxToEdges({ x: d.x0, y: d.y0 }, { x: d.x1, y: d.y1 }));
}

function onWheel(e) {
  if (['armed', 'countdown', 'recording', 'stopping'].includes(app.state)) return; // let the page scroll
  if (app.editing && e.target === el.editor) return;
  e.preventDefault();
  if (app.state === 'select' && app.shape === 'window') {
    const base = app.hover ? app.hover.depth : 0;
    const max = app.hover ? app.hover.max : 0;
    app.pickDepth = clamp(base + (e.deltaY < 0 ? 1 : -1), 0, max);
    requestPick(app.pointer.x, app.pointer.y);
  }
}

function isPrintable(e) {
  // (AltGr, as on many European keyboards, comes with Ctrl and Alt: its characters, @ say, are typing too.)
  const altGr = !!(e.getModifierState && e.getModifierState('AltGraph'));
  return !!e.key && e.key.length === 1 && !e.metaKey && (altGr || (!e.ctrlKey && !e.altKey));
}

function onKeyDown(e) {
  if (app.state === 'boot' || app.state === 'closing' || app.state === 'fatal') return;
  if (e.target === el.editor) return; // the editor handles its own keys
  if (el.boxMenu.contains(e.target) && e.key !== 'Escape') return; // the menu's own button
  if (el.inks.contains(e.target) && e.key !== 'Escape') return; // the colours handle their own keys
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('#bar button')) return; // presses the focused button
  const k = e.key;
  if (k === 'Escape') {
    // Esc is ✕: the bar and the chat close (an open right-click menu, or the highlighter's colours,
    // close first).
    e.preventDefault();
    if (!el.boxMenu.hidden) return closeBoxMenu();
    if (!el.inks.hidden) return closeInks({ back: el.inks.contains(e.target) });
    return e.repeat ? undefined : escapeKey();
  }
  const st = app.state;
  if (st !== 'idle' && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(k) && !isPrintable(e)) e.preventDefault();
  // (Ctrl+S saves what you made, when there's something to save; it never opens Chrome's Save page.)
  if (st !== 'idle' && (e.ctrlKey || e.metaKey) && !e.altKey && k.toLowerCase() === 's' && !['compose', 'review'].includes(st)) return e.preventDefault();
  if (k === ' ' && spacePauses(e)) {
    e.preventDefault();
    return e.repeat ? undefined : togglePause();
  }
  if (st === 'compose' || st === 'review') {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && k.toLowerCase() === 'z') {
      e.preventDefault();
      return undoHighlight();
    }
    if (k === 'Enter' || ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 's')) {
      e.preventDefault();
      return e.repeat ? undefined : save();
    }
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'c') {
      e.preventDefault();
      return e.repeat ? undefined : copy();
    }
  }
  if (['compose', 'review', 'armed', 'countdown', 'recording'].includes(st) && isPrintable(e)) {
    // Typing anywhere goes to the big text line.
    if (!app.editing) openEditor(app.caption);
    else el.editor.focus({ preventScroll: true });
    // The key itself lands in the editor (focus moved before the default action).
  }
}

let lastSize = { w: innerWidth, h: innerHeight };
let resizeTimer = 0;
function onResize() {
  const changed = Math.abs(innerWidth - lastSize.w) > 2 || Math.abs(innerHeight - lastSize.h) > 2;
  lastSize = { w: innerWidth, h: innerHeight };
  refreshZoom(); // zooming the page resizes this frame: the bar keeps its size on screen
  sizeEditorFont();
  if (app.editing) autosize();
  closeBoxMenu();
  if (app.barPos) moveBarTo(app.barPos.x, app.barPos.y); // still all on the screen
  if (!el.inks.hidden) placeInks();
  if (app.state === 'idle') return updateHole();
  if (!changed) return relayout();
  if (app.state === 'select') {
    // The frozen picture no longer matches the window (resize, zoom, DevTools): take a new one.
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (app.state !== 'select' || !app.shot) return;
      app.shotStale = true;
      retakeForSelect();
    }, 450);
    return;
  }
  if (app.state === 'recording') return stopRecording('resize');
  if (app.state === 'compose') app.shotStale = true; // (choosing again takes a new picture: this one no longer fits)
  if (app.state === 'armed' || app.state === 'countdown') {
    if (app.state === 'countdown') cancelCountdown();
    enterSelect({ fresh: true });
    return ping('resize', { ms: 2000 });
  }
  relayout();
  updateCaret();
}

// Annotated.com: a picture from the chat, full size, with who posted it, when, and how many have seen it on
// its top left (the same label as on its card in the chat). The chat opens this tab when you press a
// picture and closes it when you press the picture again (or another one); Esc closes it too. What to show
// comes in the address (after #), from the chat: the picture's place in storage and the post's label.
import { SUPABASE_URL, BUCKET } from './chat-config.js';

const PATH_OK = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp|gif)$/;
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const X_PHOTO = /^https:\/\/pbs\.twimg\.com\//;
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayYearFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });
const countFmt = new Intl.NumberFormat(undefined);
const bigFmt = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

const $ = (s) => document.querySelector(s);
const node = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// (the same as the chat's)
function hueOf(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
function initial(name) {
  const c = [...String(name || '?').replace(/^@/, '').trim()][0] || '?';
  return c.toUpperCase();
}
const viewCount = (n) => (n < 10000 ? countFmt.format(n) : bigFmt.format(n));

function read() {
  try {
    const p = JSON.parse(decodeURIComponent(location.hash.slice(1)));
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

function show() {
  const p = read();
  const pic = $('#pic');
  const img = $('#img');
  if (!PATH_OK.test(p.path || '')) {
    pic.hidden = true;
    $('#gone').hidden = false;
    return;
  }
  const handle = X_HANDLE.test(p.handle || '') ? p.handle : null;
  const photo = handle && X_PHOTO.test(p.photo || '') ? p.photo.replace(/_normal(\.\w+)$/, '_bigger$1') : null;
  const name = handle ? '@' + handle : String(p.name || '').slice(0, 60);
  const at = new Date(p.at);
  const when = Number.isNaN(at.getTime()) ? null : at;

  // Their face (their X photo, or their initial on their colour), their name, when, views.
  const meta = $('#meta');
  meta.replaceChildren();
  const letter = () => {
    const d = node('span', 'avatar', initial(name));
    d.style.setProperty('--h', hueOf(String(p.uid || p.name || '')));
    d.setAttribute('aria-hidden', 'true');
    return d;
  };
  if (photo) {
    const a = document.createElement('img');
    a.className = 'avatar';
    a.alt = '';
    a.referrerPolicy = 'no-referrer';
    a.src = photo;
    a.addEventListener('error', () => a.replaceWith(letter()), { once: true });
    meta.append(a);
  } else {
    meta.append(letter());
  }
  if (handle) {
    const a = node('a', 'name', name);
    a.href = 'https://x.com/' + handle;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    meta.append(a);
  } else {
    meta.append(node('span', 'name', name));
  }
  if (when) {
    const w = node('span', 'when');
    const t = node('time', '', `${dayYearFmt.format(when)} · ${timeFmt.format(when)}`);
    t.dateTime = when.toISOString();
    t.title = fullFmt.format(when);
    w.append(t);
    const v = typeof p.views === 'number' ? p.views : NaN; // (not known: nothing shown, as on its card)
    if (Number.isFinite(v) && v >= 0) w.append(' · ', node('b', '', viewCount(v)), v === 1 ? ' View' : ' Views');
    meta.append(w);
  }
  meta.hidden = !name;

  img.alt = name ? `Picture posted by ${name}` : 'Picture';
  // A picture you've just posted comes from the chat's own copy (this extension's blob: URL, while the chat
  // is open), so it shows at once; otherwise, or if that copy is gone, from storage.
  const remote = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${p.path}`;
  const local = typeof p.local === 'string' && p.local.startsWith(`blob:${location.origin}/`) ? p.local : '';
  img.onerror = () => {
    if (local && img.src === local) {
      img.src = remote;
      return;
    }
    pic.hidden = true;
    $('#gone').hidden = false;
  };
  img.src = local || remote;
  pic.hidden = false;
  document.title = name ? `${name}${when ? ' · ' + dayYearFmt.format(when) : ''} · Annotated.com` : 'Annotated.com';
}

show();
addEventListener('hashchange', show);
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  try {
    chrome.tabs.getCurrent((t) => t && chrome.tabs.remove(t.id));
  } catch {
    window.close();
  }
});

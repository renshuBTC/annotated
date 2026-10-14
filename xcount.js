// Counts your text the way X counts a post, so the caption never goes over what a post allows.
// Rules from X's "Counting characters" page (docs.x.com) and its twitter-text config (v3):
// up to 280; most characters count 1, the rest (CJK and others) count 2; every emoji counts 2;
// every link counts 23 (t.co); the text is NFC-normalized first.
import {
  EXTRACT_URL_SOURCE,
  VALID_ASCII_DOMAIN_SOURCE,
  VALID_TCO_URL,
  INVALID_URL_WITHOUT_PROTOCOL_PRECEDING_CHARS,
} from './vendor/twitter-text-urls.mjs';

export const X_POST_LIMIT = 280;

const SCALE = 100;
const DEFAULT_WEIGHT = 200;
const URL_WEIGHT = 23 * SCALE;
// twitter-text v3 "ranges" with weight 100 (one character); everything else weighs 200.
const LIGHT = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];

function weightOf(cp) {
  for (const [a, b] of LIGHT) if (cp >= a && cp <= b) return SCALE;
  return DEFAULT_WEIGHT;
}

let EMOJI;
try {
  // (Also an emoji that is one already with the "as an emoji" mark after it, ⚡️ ☕️ ⭐️ as phones type them:
  // still one emoji.)
  EMOJI = new RegExp(
    '[\\u231A\\u231B\\u25FD\\u25FE\\u2614\\u2615\\u2648-\\u2653\\u267F\\u2693\\u26A1\\u26AA\\u26AB\\u26BD\\u26BE\\u26C4\\u26C5\\u26D4\\u26EA\\u26F2\\u26F3\\u26F5\\u26FA\\u26FD\\u2757\\u2B1B\\u2B1C\\u2B50\\u2B55\\u{1F004}\\u{1F21A}\\u{1F22F}]\\uFE0F|\\p{RGI_Emoji}',
    'gv'
  );
} catch {
  EMOJI = /(?:[\u{1F1E6}-\u{1F1FF}]{2}|[#*0-9]️?⃣|\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])?(?:‍\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])?)*)/gu;
}

// Links are found with X's own patterns (twitter-text), so "x.com" or "bit.ly/abc" count as 23 too.
const MAX_URL_LENGTH = 4096;
const MAX_TCO_SLUG_LENGTH = 40;

// twitter-text's light IDNA check: every label must be 1-63 characters once punycode-encoded.
function punycodeLength(label) {
  // RFC 3492 encoder (only the output length matters here).
  const cps = [];
  for (let i = 0; i < label.length; i++) {
    const c = label.charCodeAt(i);
    const d = label.charCodeAt(i + 1);
    if (c >= 0xd800 && c <= 0xdbff && d >= 0xdc00 && d <= 0xdfff) {
      cps.push(((c - 0xd800) << 10) + (d - 0xdc00) + 0x10000);
      i++;
    } else cps.push(c);
  }
  const basic = cps.filter((c) => c < 0x80).length;
  if (basic === cps.length) return cps.length;
  const base = 36;
  const adapt = (delta, points, first) => {
    let k = 0;
    delta = first ? Math.floor(delta / 700) : delta >> 1;
    delta += Math.floor(delta / points);
    for (; delta > 455; k += base) delta = Math.floor(delta / 35);
    return Math.floor(k + (36 * delta) / (delta + 38));
  };
  let out = basic ? basic + 1 : 0;
  let n = 128;
  let delta = 0;
  let bias = 72;
  let handled = basic;
  while (handled < cps.length) {
    let m = Infinity;
    for (const c of cps) if (c >= n && c < m) m = c;
    delta += (m - n) * (handled + 1);
    n = m;
    for (const c of cps) {
      if (c < n) delta++;
      if (c === n) {
        let q = delta;
        for (let k = base; ; k += base) {
          const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
          if (q < t) break;
          out++;
          q = Math.floor((q - t) / (base - t));
        }
        out++;
        bias = adapt(delta, handled + 1, handled === basic);
        delta = 0;
        handled++;
      }
    }
    delta++;
    n++;
  }
  return 4 + out; // "xn--" + encoded
}

function toAsciiLength(label) {
  // punycode.toASCII: an "@" keeps its left part; 。．｡ also separate labels.
  let prefix = 0;
  const at = label.split('@');
  if (at.length > 1) {
    prefix = at[0].length + 1;
    label = at[1];
  }
  const parts = label.replace(/[\u3002\uFF0E\uFF61]/g, '.').split('.');
  return prefix + parts.reduce((n, p) => n + (/[^\0-\x7F]/.test(p) ? punycodeLength(p) : p.length), 0) + parts.length - 1;
}

function domainOk(domain) {
  if (domain.slice(0, 4) === 'xn--' && !new RegExp(VALID_ASCII_DOMAIN_SOURCE, 'gi').test(domain)) return false;
  for (const label of domain.split('.')) {
    if ([...label].length > 63) return false; // (too long whatever its encoding: no need to work it out)
    const n = toAsciiLength(label);
    if (n < 1 || n > 63) return false;
  }
  return true;
}

// Port of twitter-text's extractUrlsWithIndices: [start, end) of every link in `text`.
function urlSpans(text) {
  if (!text || !text.includes('.')) return [];
  const out = [];
  const re = new RegExp(EXTRACT_URL_SOURCE, 'gi');
  let m;
  while ((m = re.exec(text))) {
    const before = m[2];
    const url = m[3];
    const protocol = m[4];
    const domain = m[5];
    const path = m[7];
    let end = re.lastIndex;
    const start = end - url.length;
    if (!domainOk(domain) || (protocol || 'https://').length + url.length > MAX_URL_LENGTH) continue;
    if (!protocol) {
      if (INVALID_URL_WITHOUT_PROTOCOL_PRECEDING_CHARS.test(before)) continue;
      let last = null;
      let asciiEnd = 0;
      const domains = new RegExp(VALID_ASCII_DOMAIN_SOURCE, 'gi');
      let d;
      while ((d = domains.exec(domain))) {
        const s0 = domain.indexOf(d[0], asciiEnd);
        asciiEnd = s0 + d[0].length;
        last = [start + s0, start + asciiEnd];
        out.push(last);
      }
      if (last && path) last[1] = end;
    } else {
      const t = url.match(VALID_TCO_URL);
      if (t) {
        if (t[1] && t[1].length > MAX_TCO_SLUG_LENGTH) continue;
        end = start + t[0].length;
      }
      out.push([start, end]);
    }
  }
  return out;
}

// (Links are looked for in the first 6000 characters only: past that, a text is far over the limit
// anyway, and finding links in a very long text without spaces gets slow.)
const URL_SCAN = 6000;
function tally(s) {
  const ents = new Map();
  const urls = urlSpans(s.length > URL_SCAN ? s.slice(0, URL_SCAN) : s);
  for (const [a, b] of urls) ents.set(a, { end: b, w: URL_WEIGHT });
  const inUrl = (i) => urls.some(([a, b]) => i >= a && i < b);
  for (const m of s.matchAll(EMOJI)) if (!inUrl(m.index) && !ents.has(m.index)) ents.set(m.index, { end: m.index + m[0].length, w: DEFAULT_WEIGHT });
  let total = 0;
  let fitEnd = 0;
  for (let i = 0; i < s.length; ) {
    let w;
    let next;
    const e = ents.get(i);
    if (e) {
      w = e.w;
      next = e.end;
    } else {
      const cp = s.codePointAt(i);
      next = i + (cp > 0xffff ? 2 : 1);
      w = weightOf(cp);
    }
    total += w;
    if (total <= X_POST_LIMIT * SCALE) fitEnd = next;
    i = next;
  }
  return { weighted: total / SCALE, fitEnd };
}

/**
 * { length, left, over, fitEnd }: `length` as X counts it; `fitEnd` is where the text stops fitting
 * (an index into `text`), for showing the overflow.
 */
export function countX(text) {
  const raw = text || '';
  const nfc = raw.normalize('NFC');
  const t = tally(nfc);
  // Back to the text as typed the way X does it: shift by the length change from normalizing.
  // Where that is in the text as typed: the longest start of it that is no longer once normalized (an
  // accent typed as its own mark stays with its letter).
  let fitEnd = t.fitEnd;
  if (raw !== nfc) {
    let lo = 0;
    let hi = raw.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (raw.slice(0, mid).normalize('NFC').length <= t.fitEnd) lo = mid;
      else hi = mid - 1;
    }
    fitEnd = lo;
  }
  // (Never between the two halves of one character, an emoji say.)
  if (fitEnd > 0 && fitEnd < raw.length && /[\uD800-\uDBFF]/.test(raw[fitEnd - 1]) && /[\uDC00-\uDFFF]/.test(raw[fitEnd])) fitEnd--;
  return { length: t.weighted, left: X_POST_LIMIT - t.weighted, over: t.weighted > X_POST_LIMIT, fitEnd };
}

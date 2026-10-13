// Builds the files you save: PNG for snips, MP4 (H.264 + AAC) for recordings, sized for X.
import { Muxer, ArrayBufferTarget, StreamTarget } from './vendor/mp4-muxer.mjs';
import { drawCaption, COLORS } from './caption.js';
import { avcCodec, clamp, even, firstSupportedVideoConfig, waitQueue } from './media.js';

// X's rules for images (X Developers, "Upcoming changes to PNG image support", last updated Jan 2020):
// - a PNG that fits in 900x900 is kept as it is;
// - a bigger PNG is kept only if it is smaller than X's own JPEG of it; otherwise X turns it into an
//   85% JPEG with 4:2:0 chroma (half the colour detail);
// - on X for web, a JPEG is kept exactly as uploaded if it is 4096x4096 or smaller, 5 MB or less, has
//   no rotation set, and has at least 1 pixel per byte.
export const X = {
  imageMaxBytes: 5 * 1024 * 1024,
  imageMaxEdge: 4096,
  imageKeepPngEdge: 900,
  xJpegQuality: 0.85,
  // X shows a single image uncropped in the timeline between 2:1 (wide) and 3:4 (tall).
  imageMaxWide: 2,
  imageMaxTall: 3 / 4,
  videoMaxSeconds: 140,
  videoFps: 30,
  // X video uploads: aspect ratio between 1:2.39 and 2.39:1, up to 1920x1200 (or 1200x1900).
  videoMaxAspect: 2.39,
  videoLandscape: [1920, 1200],
  videoPortrait: [1200, 1900],
  // X makes its own copies (720p, or 1080p with Premium): give it as much detail as it takes.
  videoMaxUpscale: 3,
  videoBitrate: [8e6, 24e6], // X recommends at least 5 Mbps and takes up to 25 Mbps
};

function canvasEl(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image.'))), type, quality)
  );
}

/* ------------------------------- images ------------------------------- */

// Where a saved picture is from, written into the file (a PNG text chunk "Source", or a JPEG comment),
// so the chat can still offer "Copy source link" when the saved file is dragged into it. And the words the
// snip shows, with what you wrote about them (a PNG iTXt chunk "Annotated.com", or a JPEG comment
// "Annotated.com text: " with them as JSON), so the chat's Ask AI can read them exactly.
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// The words and your text, as they go into the file (whole characters; at most WORDS_MAX and NOTE_MAX).
export const WORDS_MAX = 4000;
const NOTE_MAX = 1000;
export function textInfo({ words = '', note = '' } = {}) {
  const cut = (s, n) => {
    const a = Array.from(String(s || '').replace(/\r/g, '').trim());
    return a.length > n ? a.slice(0, n).join('') : a.join('');
  };
  const w = cut(words, WORDS_MAX);
  const t = cut(note, NOTE_MAX);
  return w || t ? JSON.stringify({ words: w, note: t }) : '';
}

function pngChunk(type, data) {
  const body = new Uint8Array(4 + data.length);
  body.set(new TextEncoder().encode(type), 0);
  body.set(data, 4);
  const chunk = new Uint8Array(body.length + 8);
  const len = data.length;
  chunk.set([len >>> 24, (len >>> 16) & 255, (len >>> 8) & 255, len & 255], 0);
  chunk.set(body, 4);
  const crc = crc32(body);
  chunk.set([crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255], 4 + body.length);
  return chunk;
}

function jpegComment(text) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 65533) return null;
  const seg = new Uint8Array(bytes.length + 4);
  seg.set([0xff, 0xfe, (bytes.length + 2) >>> 8, (bytes.length + 2) & 255], 0);
  seg.set(bytes, 4);
  return seg;
}

export async function withSource(out, source, text = {}) {
  let ascii = '';
  if (source && /^https?:\/\//i.test(source) && source.length <= 2048) {
    try {
      ascii = source.replace(/[^\x20-\x7e]/gu, (ch) => encodeURIComponent(ch)); // (whole characters, emoji too)
    } catch {
      ascii = '';
    }
  }
  const info = textInfo(text);
  if (!ascii && !info) return out;
  const buf = new Uint8Array(await out.blob.arrayBuffer());
  let parts = null;
  if (out.blob.type === 'image/png' && buf[12] === 0x49 && buf[13] === 0x48) {
    // Right after IHDR (8-byte signature, then IHDR: length, type, 13 bytes, CRC): tEXt "Source", then
    // iTXt "Annotated.com" (keyword, 0, not compressed, method 0, no language, no translated keyword, UTF-8).
    const at = 8 + 12 + ((buf[8] << 24) | (buf[9] << 16) | (buf[10] << 8) | buf[11]);
    const add = [];
    if (ascii) add.push(pngChunk('tEXt', new TextEncoder().encode('Source\0' + ascii)));
    if (info) {
      const head = new TextEncoder().encode('Annotated.com\0\0\0\0\0');
      const body = new TextEncoder().encode(info);
      const data = new Uint8Array(head.length + body.length);
      data.set(head, 0);
      data.set(body, head.length);
      add.push(pngChunk('iTXt', data));
    }
    parts = [buf.subarray(0, at), ...add, buf.subarray(at)];
  } else if (out.blob.type === 'image/jpeg' && buf[0] === 0xff && buf[1] === 0xd8) {
    // Comment segments right after the start.
    const add = [];
    if (ascii) add.push(jpegComment('Annotated.com source: ' + ascii));
    if (info) add.push(jpegComment('Annotated.com text: ' + info));
    parts = [buf.subarray(0, 2), ...add.filter(Boolean), buf.subarray(2)];
  }
  return parts ? { ...out, blob: new Blob(parts, { type: out.blob.type }) } : out;
}

function imagePad(w, h) {
  const r = w / h;
  if (r > X.imageMaxWide) return { x: 0, y: (w / X.imageMaxWide - h) / 2 };
  if (r < X.imageMaxTall) return { x: (h * X.imageMaxTall - w) / 2, y: 0 };
  return { x: 0, y: 0 };
}

// Highlights you drew on your snip, in the highlighter's colour (the bar's marker button: nine
// colours in three rows, around the colour wheel, with yellow, the default, in the middle of the top
// row). Each is inked into the picture
// (multiplied), so dark text stays crisp and white paper turns exactly that colour; on a dark picture,
// where ink wouldn't show, a brighter version of it is laid over, see-through (glow, at glowAlpha). All
// nine keep black text easy to read. All the highlights are one layer of colour: highlighting the same
// words twice (or overlapping ones) never makes them darker; where two colours overlap, the later one
// shows.
export const INKS = [
  { id: 'orange', name: 'Orange', ink: '#ffb54a', glow: 'rgb(255, 150, 20)' },
  { id: 'yellow', name: 'Yellow', ink: '#ffe24d', glow: 'rgb(255, 214, 10)' },
  { id: 'red', name: 'Red', ink: '#ff7f75', glow: 'rgb(255, 70, 60)' },
  { id: 'pink', name: 'Pink', ink: '#ff8ad6', glow: 'rgb(255, 80, 200)' },
  { id: 'purple', name: 'Purple', ink: '#c4a0ff', glow: 'rgb(165, 115, 255)' },
  { id: 'blue', name: 'Blue', ink: '#86c5ff', glow: 'rgb(70, 160, 255)' },
  { id: 'turquoise', name: 'Turquoise', ink: '#5ee6e0', glow: 'rgb(30, 215, 205)' },
  { id: 'green', name: 'Green', ink: '#8eeb7a', glow: 'rgb(80, 220, 60)' },
  { id: 'grey', name: 'Grey', ink: '#c9ccd1', glow: 'rgb(205, 210, 218)' },
];
export const inkFor = (id) => INKS.find((c) => c.id === id) || INKS.find((c) => c.id === 'yellow');
export const HIGHLIGHT = { radius: 2, glowAlpha: 0.43 };

// Draws highlights (each { rects: [{x, y, w, h}] in the page's CSS px, dark, ink }) onto the picture of
// `region`, which sits at (ox, oy) at s output pixels per CSS px: first each kind on a layer of its own
// (filled flat, so overlaps don't add up), then the ink layer multiplied in and the glow laid over.
// (A video draws the same layers on every frame: they're made once.)
const hlLayers = new WeakMap(); // the highlights -> { key, ink, glow } (they go when the snip does)
function paintHighlights(ctx, highlights, region, ox, oy, s) {
  if (!highlights || !highlights.length) return;
  const fx = ox - Math.floor(ox);
  const fy = oy - Math.floor(oy);
  const key = JSON.stringify([highlights, region, s, fx, fy]);
  let L = hlLayers.get(highlights);
  if (!L || L.key !== key) {
    const W = Math.ceil(region.w * s + fx) + 1;
    const H = Math.ceil(region.h * s + fy) + 1;
    const layer = (dark) => {
      const hs = highlights.filter((h) => !!h.dark === dark);
      if (!hs.length) return null;
      const c = canvasEl(W, H);
      const g = c.getContext('2d');
      g.beginPath();
      g.rect(fx, fy, region.w * s, region.h * s);
      g.clip();
      for (const h of hs) {
        const colour = inkFor(h.ink);
        g.fillStyle = dark ? colour.glow : colour.ink;
        g.beginPath();
        for (const q of h.rects || []) {
          const x = fx + (q.x - region.x) * s;
          const y = fy + (q.y - region.y) * s;
          if (g.roundRect) g.roundRect(x, y, q.w * s, q.h * s, HIGHLIGHT.radius * s);
          else g.rect(x, y, q.w * s, q.h * s);
        }
        g.fill();
      }
      return c;
    };
    L = { key, ink: layer(false), glow: layer(true) };
    hlLayers.set(highlights, L);
  }
  ctx.save();
  if (L.ink) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(L.ink, Math.floor(ox), Math.floor(oy));
  }
  if (L.glow) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = HIGHLIGHT.glowAlpha;
    ctx.drawImage(L.glow, Math.floor(ox), Math.floor(oy));
  }
  ctx.restore();
}

// shot: ImageBitmap of the frozen page; shotScale: its pixels per CSS px; region: CSS px (pixel-snapped).
function composeImage(shot, shotScale, k, region, layout, highlights) {
  const capH = layout.height;
  const pad = imagePad(region.w, region.h + capH);
  const totalW = region.w + pad.x * 2;
  const totalH = region.h + capH + pad.y * 2;
  let E = shotScale * k; // output pixels per CSS px
  let smooth = k !== Math.round(k);
  if (Math.max(totalW, totalH) * E > X.imageMaxEdge) {
    E = X.imageMaxEdge / Math.max(totalW, totalH);
    smooth = true;
  }
  const W = Math.round(totalW * E);
  const H = Math.round(totalH * E);
  const c = canvasEl(W, H);
  const ctx = c.getContext('2d');
  // Margins (to fit X's shapes) take the caption's white.
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  const sx = Math.round(region.x * shotScale);
  const sy = Math.round(region.y * shotScale);
  const sw = Math.max(1, Math.min(shot.width - sx, Math.round(region.w * shotScale)));
  const sh = Math.max(1, Math.min(shot.height - sy, Math.round(region.h * shotScale)));
  // Doubled pixels start on even rows and columns, so each one fills exactly one 2x2 colour block of a
  // JPEG (X's 4:2:0 JPEGs then lose no colour detail).
  const al = !smooth && k % 2 === 0 ? 2 : 1;
  const dx = Math.round((pad.x * E) / al) * al;
  const dy = Math.round((pad.y * E) / al) * al;
  const dw = smooth ? Math.round(region.w * E) : sw * k;
  const dh = smooth ? Math.round(region.h * E) : sh * k;
  // Whole-number enlargement with nearest-neighbour keeps every pixel sharp (no blur).
  ctx.imageSmoothingEnabled = smooth;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(shot, sx, sy, sw, sh, dx, dy, dw, dh);
  paintHighlights(ctx, highlights, region, dx, dy, dw / region.w);

  // Your text under the picture.
  const cs = dw / region.w;
  ctx.save();
  ctx.translate(dx, dy + dh);
  ctx.scale(cs, cs);
  drawCaption(ctx, layout, 0, 0);
  ctx.restore();
  return c;
}

// Pixel-doubling (2x) keeps every pixel sharp and survives X's JPEG colour halving; it's used when the
// result still fits X's 4096 px.
function scales(shotScale, region, layout) {
  const pad = imagePad(region.w, region.h + layout.height);
  const longCss = Math.max(region.w + pad.x * 2, region.h + layout.height + pad.y * 2);
  return longCss * shotScale * 2 <= X.imageMaxEdge ? [2, 1] : [1];
}

/**
 * The file to save, in whichever format ends up best on X:
 * - PNG (lossless) when X will keep it as PNG: it fits in 900x900, or it's clearly smaller than
 *   X's own JPEG of it (sharp text and flat colours usually are);
 * - otherwise a 97% JPEG, which X for web keeps exactly as uploaded (instead of X turning a PNG into
 *   its own 85% JPEG with half the colour detail).
 */
export async function exportImage({ shot, shotScale, region, layout, highlights = [], source = '', words = '', note = '' }) {
  const room = SOURCE_ROOM + new TextEncoder().encode(textInfo({ words, note })).length + 64;
  return withSource(await bestImage({ shot, shotScale, region, layout, highlights, room }), source, { words, note });
}

// Room left in a saved picture for its source link (up to a few KB) and its words, written in after it's made.
const SOURCE_ROOM = 8192;

async function bestImage({ shot, shotScale, region, layout, highlights, room = SOURCE_ROOM }) {
  let canvas = null;
  for (const k of scales(shotScale, region, layout)) {
    canvas = composeImage(shot, shotScale, k, region, layout, highlights);
    const W = canvas.width;
    const H = canvas.height;
    const out = (blob, ext) => ({ blob, ext, width: W, height: H, scale: k });
    const png = await toBlob(canvas, 'image/png');
    if (png.size + room <= X.imageMaxBytes) {
      if (Math.max(W, H) <= X.imageKeepPngEdge) return out(png, 'png');
      const xJpeg = await toBlob(canvas, 'image/jpeg', X.xJpegQuality);
      // A margin, so a near tie goes to the JPEG made here rather than X's own.
      if (png.size <= xJpeg.size * 0.9) return out(png, 'png');
    }
    for (const q of [0.97, 0.95, 0.93, 0.9]) {
      const jpg = await toBlob(canvas, 'image/jpeg', q);
      if (jpg.size + room <= X.imageMaxBytes && jpg.size + room <= W * H) return out(jpg, 'jpg');
    }
  }
  return shrinkToFit(canvas, room);
}

// The picture for the clipboard (pasting into a post), which can only hold PNG: the sharpest PNG
// that is within X's 5 MB.
export async function exportPng({ shot, shotScale, region, layout, highlights = [] }) {
  let canvas = null;
  for (const k of scales(shotScale, region, layout)) {
    canvas = composeImage(shot, shotScale, k, region, layout, highlights);
    const png = await toBlob(canvas, 'image/png');
    if (png.size <= X.imageMaxBytes) return { blob: png, ext: 'png', width: canvas.width, height: canvas.height, scale: k };
  }
  let c2 = canvas;
  while (c2.width > 400) {
    c2 = smaller(c2);
    const png = await toBlob(c2, 'image/png');
    if (png.size <= X.imageMaxBytes) return { blob: png, ext: 'png', width: c2.width, height: c2.height, scale: 0 };
  }
  throw new Error('The image is too large to copy under 5 MB.');
}

function smaller(c) {
  const s = canvasEl(Math.round(c.width * 0.8), Math.round(c.height * 0.8));
  const sctx = s.getContext('2d');
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(c, 0, 0, s.width, s.height);
  return s;
}

// Last resort for a huge, detailed snip: shrink until a high-quality JPEG fits X's limits.
async function shrinkToFit(canvas, room = SOURCE_ROOM) {
  let c2 = canvas;
  while (c2.width > 400) {
    c2 = smaller(c2);
    for (const q of [0.95, 0.9]) {
      const blob = await toBlob(c2, 'image/jpeg', q);
      if (blob.size + room <= X.imageMaxBytes && blob.size + room <= c2.width * c2.height) return { blob, ext: 'jpg', width: c2.width, height: c2.height, scale: 0 };
    }
  }
  throw new Error('The image is too large to save under 5 MB.');
}

/* ------------------------------- video ------------------------------- */

function videoPad(w, h) {
  const r = w / h;
  const m = X.videoMaxAspect - 0.01;
  if (r > m) return { x: 0, y: (w / m - h) / 2 };
  if (r < 1 / m) return { x: (h / m - w) / 2, y: 0 };
  return { x: 0, y: 0 };
}

// Work out the output size: as big as X takes (1920x1200, or 1200x1900 upright), enlarging the
// recording up to 3x, so X's own 720p/1080p copies are made from as much detail as possible.
export function planVideo(region, capH, nativeScale) {
  const contentW = region.w;
  const contentH = region.h + capH;
  const pad = videoPad(contentW, contentH);
  const totalW = contentW + pad.x * 2;
  const totalH = contentH + pad.y * 2;
  const [maxW, maxH] = totalW >= totalH ? X.videoLandscape : X.videoPortrait;
  const S = Math.min(maxW / totalW, maxH / totalH, nativeScale * X.videoMaxUpscale);
  const W = Math.max(32, even(totalW * S));
  const H = Math.max(32, even(totalH * S));
  const sx = W / totalW;
  const sy = H / totalH;
  // The video, your text under it.
  const vx = Math.round(pad.x * sx);
  const vy = Math.round(pad.y * sy);
  const vw = Math.round(region.w * sx);
  const vh = Math.round(region.h * sy);
  return { W, H, vx, vy, vw, vh, capX: vx, capY: vy + vh, capW: vw, capH: Math.round(capH * sy), capScale: vw / region.w };
}

async function pickFinalEncoder(W, H, fps, cap = Infinity) {
  const bitrate = Math.round(Math.min(cap, clamp(W * H * fps * 0.25, X.videoBitrate[0], X.videoBitrate[1])));
  const base = { width: W, height: H, bitrate, framerate: fps, latencyMode: 'quality', bitrateMode: 'variable' };
  const avc = await firstSupportedVideoConfig([
    { ...base, codec: avcCodec('6400', W, H, fps, bitrate), avc: { format: 'avc' } },
    { ...base, codec: avcCodec('4d00', W, H, fps, bitrate), avc: { format: 'avc' } },
    { ...base, codec: avcCodec('4200', W, H, fps, bitrate), avc: { format: 'avc' } },
  ]);
  if (avc) return { config: avc, muxCodec: 'avc', bitrate };
  const vp9 = await firstSupportedVideoConfig([{ ...base, codec: 'vp09.00.51.08' }]);
  if (vp9) return { config: vp9, muxCodec: 'vp9', bitrate, warning: 'This browser cannot make H.264 video, so the file uses VP9. X may not accept it.' };
  throw new Error('This browser cannot encode video.');
}

function chunkOf(c) {
  return new EncodedVideoChunk({ type: c.type, timestamp: c.timestamp, data: c.data });
}

/**
 * Re-encode the recording with your text under it.
 * rec: Recorder result; region: CSS px; layout: caption layout; captionCanvas: rendered at plan.capScale.
 */
export async function exportVideo({ rec, region, layout, highlights = [], onProgress, isCancelled, maxBytes = 0 }) {
  const fps = X.videoFps;
  const durationUs = Math.min(rec.durationUs, X.videoMaxSeconds * 1e6);
  const nativeScale = rec.video.width / region.w;
  const plan = planVideo(region, layout.height, nativeScale);
  const { W, H } = plan;
  // A size cap (the chat's file limit): a lower bitrate, so the whole file fits with its sound.
  const cap = maxBytes ? Math.max(4e5, (maxBytes * 8 * 0.85) / Math.max(1, durationUs / 1e6) - 1.6e5) : Infinity;
  const enc = await pickFinalEncoder(W, H, fps, cap);

  // Caption layer, drawn once.
  const capCanvas = canvasEl(Math.max(1, plan.capW), Math.max(1, plan.capH));
  if (layout.height) {
    const cctx = capCanvas.getContext('2d');
    cctx.setTransform(plan.capScale, 0, 0, plan.capW ? plan.capH / layout.height : 1, 0, 0);
    drawCaption(cctx, layout, 0, 0);
  }

  const useAudio = rec.audio && rec.audio.codec === 'aac' && rec.audio.chunks.length;
  const notes = [];
  if (enc.warning) notes.push(enc.warning);
  if (rec.audio && rec.audio.codec !== 'aac') notes.push('This browser cannot make AAC audio, so the video was saved without sound.');

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: enc.muxCodec, width: W, height: H, frameRate: fps },
    audio: useAudio ? { codec: 'aac', numberOfChannels: rec.audio.numberOfChannels, sampleRate: rec.audio.sampleRate } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'cross-track-offset',
  });

  // Audio is copied as-is (no re-encode), interleaved with the video as it is written.
  // Whole audio frames only, all ending before the video does (so the file never runs past 2:20).
  const audioChunks = useAudio ? rec.audio.chunks.filter((c) => c.timestamp >= 0 && c.timestamp + (c.duration || 0) <= durationUs) : [];
  let ai = 0;
  let audioMetaSent = false;
  const pumpAudio = (untilUs) => {
    while (ai < audioChunks.length && audioChunks[ai].timestamp <= untilUs) {
      const c = audioChunks[ai++];
      const meta = !audioMetaSent && rec.audio.decoderConfig ? { decoderConfig: rec.audio.decoderConfig } : undefined;
      audioMetaSent = audioMetaSent || !!meta;
      muxer.addAudioChunkRaw(c.data, c.type, c.timestamp, c.duration || Math.round((1024 / rec.audio.sampleRate) * 1e6), meta);
    }
  };

  let encError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
      pumpAudio(chunk.timestamp + 500000);
    },
    error: (e) => (encError = e),
  });
  encoder.configure(enc.config);

  let decError = null;
  const decoded = [];
  const decoder = new VideoDecoder({ output: (f) => decoded.push(f), error: (e) => (decError = e) });
  decoder.configure(rec.video.decoderConfig ? { ...rec.video.decoderConfig } : { codec: rec.video.codec, codedWidth: rec.video.width, codedHeight: rec.video.height });

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { alpha: false });
  const margin = COLORS.bg;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const total = Math.max(1, Math.round((durationUs / 1e6) * fps));
  let out = 0;
  let cur = null;

  const check = () => {
    if (encError) throw encError;
    if (decError) throw decError;
    if (isCancelled && isCancelled()) throw new DOMException('Cancelled', 'AbortError');
  };

  const emitUntil = async (limitUs, frame) => {
    while (out < total && (out * 1e6) / fps < limitUs) {
      check();
      ctx.fillStyle = margin;
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(frame, plan.vx, plan.vy, plan.vw, plan.vh);
      paintHighlights(ctx, highlights, region, plan.vx, plan.vy, plan.vw / region.w);
      if (layout.height) ctx.drawImage(capCanvas, plan.capX, plan.capY);
      const vf = new VideoFrame(canvas, { timestamp: Math.round((out * 1e6) / fps), duration: Math.round(1e6 / fps) });
      try {
        encoder.encode(vf, { keyFrame: out % (fps * 2) === 0 });
      } finally {
        vf.close();
      }
      out++;
      if (onProgress) onProgress(out / total);
      await waitQueue(encoder, 'encodeQueueSize', 4);
    }
  };

  const drain = async () => {
    while (decoded.length) {
      const f = decoded.shift();
      if (!cur) {
        cur = f;
        continue;
      }
      try {
        await emitUntil(f.timestamp, cur);
      } catch (e) {
        f.close();
        throw e;
      }
      cur.close();
      cur = f;
    }
  };

  try {
    for (const c of rec.video.chunks) {
      check();
      if (c.timestamp > durationUs) break;
      decoder.decode(chunkOf(c));
      await waitQueue(decoder, 'decodeQueueSize', 2);
      await drain();
    }
    await decoder.flush();
    await drain();
    if (cur) {
      await emitUntil(Infinity, cur);
      cur.close();
      cur = null;
    }
    check();
    await encoder.flush();
    check();
    pumpAudio(Infinity);
    muxer.finalize();
  } finally {
    for (const f of decoded) f.close();
    if (cur) cur.close();
    try {
      decoder.state !== 'closed' && decoder.close();
    } catch {}
    try {
      encoder.state !== 'closed' && encoder.close();
    } catch {}
  }
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  return { blob, width: W, height: H, seconds: total / fps, hasAudio: !!useAudio, notes, codec: enc.config.codec, bitrate: enc.bitrate };
}

/* --------------------------- quick preview --------------------------- */

// Wrap the recorded chunks in an MP4 without re-encoding, so the clip can be played right away.
export function previewMp4(rec) {
  const v = rec.video;
  const vCodec = v.codec.startsWith('avc') ? 'avc' : v.codec.startsWith('vp09') ? 'vp9' : null;
  if (!vCodec) return null; // VP8 cannot go in MP4; the box shows the last frame instead
  const a = rec.audio;
  // Fragmented MP4 is written strictly in order, so it can be collected in pieces (less memory).
  const parts = [];
  let size = 0;
  const muxer = new Muxer({
    target: new StreamTarget({
      onData: (data, position) => {
        if (position !== size) throw new Error('Unexpected write position in preview.');
        parts.push(data.slice());
        size += data.byteLength;
      },
    }),
    video: { codec: vCodec, width: v.width, height: v.height },
    audio: a ? { codec: a.codec, numberOfChannels: a.numberOfChannels, sampleRate: a.sampleRate } : undefined,
    fastStart: 'fragmented',
    firstTimestampBehavior: 'cross-track-offset',
  });
  // Add video and sound in time order (interleaved), as the fragments are written.
  const vc = v.chunks;
  const ac = a ? a.chunks.filter((c) => c.timestamp >= 0) : [];
  let ai = 0;
  const addAudioUpTo = (t) => {
    while (ai < ac.length && ac[ai].timestamp <= t) {
      const c = ac[ai];
      muxer.addAudioChunkRaw(c.data, c.type, c.timestamp, c.duration || 21333, ai === 0 && a.decoderConfig ? { decoderConfig: a.decoderConfig } : undefined);
      ai++;
    }
  };
  for (let i = 0; i < vc.length; i++) {
    const c = vc[i];
    addAudioUpTo(c.timestamp);
    const next = i + 1 < vc.length ? vc[i + 1].timestamp : Math.max(c.timestamp + 33333, rec.durationUs);
    muxer.addVideoChunkRaw(c.data, c.type, c.timestamp, Math.max(1, next - c.timestamp), i === 0 && v.decoderConfig ? { decoderConfig: v.decoderConfig } : undefined);
  }
  addAudioUpTo(Infinity);
  muxer.finalize();
  return new Blob(parts, { type: 'video/mp4' });
}

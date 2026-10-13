// Shared media helpers: H.264 levels, encoder selection, queue back-pressure.

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const even = (v) => Math.max(2, Math.round(v / 2) * 2);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// [level_idc, max macroblocks per frame, max macroblocks per second, max High-profile bitrate (bps)]
const AVC_LEVELS = [
  [0x1e, 1620, 40500, 12.5e6],
  [0x1f, 3600, 108000, 17.5e6],
  [0x20, 5120, 216000, 25e6],
  [0x28, 8192, 245760, 25e6],
  [0x29, 8192, 245760, 62.5e6],
  [0x2a, 8704, 522240, 62.5e6],
  [0x32, 22080, 589824, 168.75e6],
  [0x33, 36864, 983040, 300e6],
  [0x34, 36864, 2073600, 300e6],
  [0x3c, 139264, 4177920, 300e6],
];

export function avcLevel(w, h, fps, bitrate) {
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);
  const maxSideMbs = Math.max(Math.ceil(w / 16), Math.ceil(h / 16));
  for (const [lvl, maxFs, maxMbps, maxBr] of AVC_LEVELS) {
    if (mbs <= maxFs && mbs * fps <= maxMbps && bitrate <= maxBr && maxSideMbs <= Math.sqrt(8 * maxFs)) return lvl;
  }
  return 0x3c;
}

export function avcCodec(profile, w, h, fps, bitrate) {
  // profile: '6400' High, '4d00' Main, '4200' Constrained Baseline-ish
  return 'avc1.' + profile + avcLevel(w, h, fps, bitrate).toString(16).padStart(2, '0');
}

export async function firstSupportedVideoConfig(candidates) {
  for (const c of candidates) {
    try {
      const r = await VideoEncoder.isConfigSupported(c);
      if (r && r.supported) return c;
    } catch {
      // try the next one
    }
  }
  return null;
}

// Wait until a WebCodecs encoder/decoder queue has room.
export async function waitQueue(codec, key, max) {
  while (codec.state === 'configured' && codec[key] > max) {
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 25);
      codec.addEventListener(
        'dequeue',
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true }
      );
    });
  }
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

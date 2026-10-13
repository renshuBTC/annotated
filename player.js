// Plays the recorded tab's sound back to you while it is captured (capturing a tab mutes it).
// Runs in an offscreen extension page, outside the tab, so the sound isn't recorded twice.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'snip-audio') return;
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  let next = 0;
  port.onMessage.addListener((m) => {
    if (!m || m.type !== 'pcm') return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const { sr, ch, n, b64 } = m;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const pcm = new Int16Array(bytes.buffer);
    const buf = ctx.createBuffer(ch, n, sr);
    for (let c = 0; c < ch; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = pcm[i * ch + c] / 32768;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const now = ctx.currentTime;
    // Keep a small cushion; restart it after a gap or if we fell too far behind.
    if (next < now + 0.01 || next > now + 0.5) next = now + 0.06;
    src.start(next);
    next += n / sr;
  });
  port.onDisconnect.addListener(() => {
    ctx.close().catch(() => {});
  });
  port.postMessage({ type: 'ready', state: ctx.state });
});

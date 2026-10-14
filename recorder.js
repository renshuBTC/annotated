// Records one area of the tab: crops every captured frame to the chosen area and encodes it right
// away (WebCodecs), so quality isn't spent on the rest of the page. Tab audio is encoded alongside.
import { avcCodec, clamp, firstSupportedVideoConfig } from './media.js';

// Video frames and audio data can carry timestamps from different clocks. Map both onto
// performance.now() (in microseconds) so they line up.
function mapTime(state, ts, arrivalUs, calibrating) {
  if (state.mode === null) {
    state.mode = Math.abs(ts - arrivalUs) < 2e6 ? 'same' : 'offset';
    state.off = ts - arrivalUs;
  }
  if (state.mode === 'same') return ts;
  if (calibrating) state.off = Math.max(state.off, ts - arrivalUs); // lowest observed delivery delay
  return ts - state.off;
}

export class Recorder {
  /**
   * @param {MediaStream} stream  tab capture stream
   * @param {{cropCss:{x,y,w,h}, viewCss:{w,h}, maxUs:number, onLimit?:Function, onError?:Function}} opts
   */
  constructor(stream, opts) {
    this.stream = stream;
    this.opts = opts;
    this.vTrack = stream.getVideoTracks()[0];
    this.aTrack = stream.getAudioTracks()[0] || null;
    this.recording = false;
    this.stopped = false;
    this.video = { chunks: [], decoderConfig: null, codec: '', width: 0, height: 0 };
    this.audio = null;
    this.vMap = { mode: null, off: 0 };
    this.aMap = { mode: null, off: 0 };
    this.preroll = null;
    this.t0 = null;
    this.lastTs = -Infinity;
    this.lastKeyTs = -Infinity;
    this.vCount = 0;
    this.dropped = 0;
    this.aNext = null;
    this.aTried = false;
    this.failed = null;
    this.rawTs = [];
    this.captureTimes = [];
    this.pauses = []; // [{ from, to }] on the performance.now() clock (µs); to: null while paused
    this.held = null; // while paused: the newest frame, to go on with
  }

  // Frame timestamps and sound timestamps use different clocks. A hidden <video> showing the same
  // track reports each frame's capture time on the performance.now() clock; pairing those with the
  // frame timestamps gives the exact offset, so picture and sound line up.
  startClock() {
    try {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.srcObject = new MediaStream([this.vTrack]);
      v.setAttribute('aria-hidden', 'true');
      v.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;';
      document.body.append(v);
      this.clockVideo = v;
      const cb = (_now, md) => {
        if (md && typeof md.captureTime === 'number') {
          this.captureTimes.push(md.captureTime * 1000);
          if (this.captureTimes.length > 120) this.captureTimes.shift();
        }
        if (!this.recording && !this.stopped) v.requestVideoFrameCallback(cb);
      };
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(cb);
      v.play().catch(() => {});
    } catch {
      // Fall back to the estimate from arrival times.
    }
  }

  calibrate() {
    const ct = this.captureTimes;
    const ts = this.rawTs;
    if (this.vMap.mode !== 'offset' || ct.length < 4 || ts.length < 4) return false;
    const rough = this.vMap.off; // = frame time - arrival; the true offset is a bit larger (delivery delay)
    const offs = [];
    for (const a of ts) {
      for (const c of ct) {
        const o = a - c;
        if (o >= rough - 2000 && o <= rough + 400000) offs.push(o);
      }
    }
    offs.sort((x, y) => x - y);
    let best = null;
    for (let i = 0, j = 0; i < offs.length; i++) {
      while (offs[i] - offs[j] > 400) j++;
      const n = i - j + 1;
      if (!best || n > best.n) best = { n, mid: (offs[i] + offs[j]) / 2 };
    }
    // The real offset pairs (almost) every reported capture time with a frame.
    if (best && best.n >= 4 && best.n >= 0.6 * Math.min(ct.length, ts.length)) {
      this.vMap.off = best.mid;
      this.vMap.exact = true;
      return true;
    }
    return false;
  }

  stopClock() {
    if (!this.clockVideo) return;
    try {
      this.clockVideo.pause();
      this.clockVideo.srcObject = null;
      this.clockVideo.remove();
    } catch {}
    this.clockVideo = null;
  }

  async prepare() {
    if (!this.vTrack) throw new Error('No video in the tab capture.');
    this.vReader = new MediaStreamTrackProcessor({ track: this.vTrack }).readable.getReader();
    if (this.aTrack) this.aReader = new MediaStreamTrackProcessor({ track: this.aTrack }).readable.getReader();
    let resolveFirst;
    let rejectFirst;
    this.firstFrame = new Promise((res, rej) => {
      resolveFirst = res;
      rejectFirst = rej;
    });
    this._first = { resolveFirst, rejectFirst };
    this.startClock();
    this.videoLoop().catch((e) => this.fail(e));
    if (this.aReader) this.audioLoop().catch(() => {}); // audio problems never stop the video
    const timer = setTimeout(() => rejectFirst(new Error('Chrome sent no picture from this tab.')), 5000);
    try {
      await this.firstFrame;
    } finally {
      clearTimeout(timer);
    }
  }

  fail(e) {
    if (this.failed) return;
    this.failed = e;
    if (this._first) this._first.rejectFirst(e);
    if (this.opts.onError) this.opts.onError(e);
  }

  async videoLoop() {
    for (;;) {
      const { value: frame, done } = await this.vReader.read();
      if (done || !frame) break;
      const arrival = performance.now() * 1000;
      if (this.stopped || this.failed) {
        frame.close();
        continue;
      }
      if (!this.vEnc) {
        try {
          await this.setupVideo(frame);
        } catch (e) {
          frame.close();
          throw e;
        }
        if (this.stopped || !this.vEnc) {
          frame.close(); // stopped while it was being set up
          continue;
        }
        this._first.resolveFirst();
      }
      const t = mapTime(this.vMap, frame.timestamp, arrival, !this.recording);
      if (!this.recording) {
        this.rawTs.push(frame.timestamp);
        if (this.rawTs.length > 150) this.rawTs.shift();
        // Not recording yet (countdown): keep only the newest frame so the clip can start with it.
        if (this.preroll) this.preroll.frame.close();
        this.preroll = { frame, t };
        continue;
      }
      const ct = this.clipTime(t);
      if (ct == null) {
        // Paused: keep only the newest frame, so the clip goes on with what's there when you resume.
        const cur = this.pauses[this.pauses.length - 1];
        if (this.paused && t >= cur.from) {
          if (this.held) this.held.frame.close();
          this.held = { frame, t };
        } else frame.close();
        continue;
      }
      try {
        this.encodeFrame(frame, ct);
      } finally {
        frame.close();
      }
    }
  }

  async setupVideo(frame) {
    const fw = frame.displayWidth;
    const fh = frame.displayHeight;
    const k = fw / this.opts.viewCss.w; // captured pixels per CSS pixel
    const c = this.opts.cropCss;
    // Even-aligned crop that stays inside the area (never picks up the dimmed edge around it).
    let x = Math.min(fw - 2, Math.max(0, Math.ceil((c.x * k - 1e-6) / 2) * 2));
    let y = Math.min(fh - 2, Math.max(0, Math.ceil((c.y * k - 1e-6) / 2) * 2));
    let w = Math.min(fw, Math.floor((c.x + c.w) * k + 1e-6)) - x;
    let h = Math.min(fh, Math.floor((c.y + c.h) * k + 1e-6)) - y;
    w -= w % 2;
    h -= h % 2;
    if (w < 16 || h < 16) throw new Error('The recording area is too small.');
    this.k = k;
    this.frameSize = { w: fw, h: fh };
    this.crop = { x, y, width: w, height: h };

    // Generous bitrate: this is an intermediate copy, so keep it close to lossless
    // (but bounded: a 2:20 clip is held in memory until it's saved).
    const bitrate = Math.round(clamp(w * h * 30 * 0.15, 3e6, 16e6)); // (a long, big recording fits in memory)
    const base = { width: w, height: h, displayWidth: w, displayHeight: h, bitrate, framerate: 30, latencyMode: 'realtime', bitrateMode: 'variable' };
    const cfg = await firstSupportedVideoConfig([
      { ...base, codec: avcCodec('6400', w, h, 30, bitrate), avc: { format: 'avc' } },
      { ...base, codec: avcCodec('4d00', w, h, 30, bitrate), avc: { format: 'avc' } },
      { ...base, codec: 'vp09.00.51.08' },
      { ...base, codec: 'vp8' },
    ]);
    if (!cfg) throw new Error('This browser cannot encode video.');
    if (this.stopped) return; // stopped meanwhile: no encoder
    this.video.codec = cfg.codec;
    this.video.width = w;
    this.video.height = h;
    this.vEnc = new VideoEncoder({
      output: (chunk, meta) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        if (meta && meta.decoderConfig && !this.video.decoderConfig) this.video.decoderConfig = { ...meta.decoderConfig };
        this.video.chunks.push({ data, type: chunk.type, timestamp: chunk.timestamp });
      },
      error: (e) => this.fail(e),
    });
    this.vEnc.configure(cfg);
  }

  encodeFrame(frame, ts) {
    if (ts < this.lastTs + 1000) return; // keep timestamps strictly increasing
    if (ts > this.opts.maxUs) {
      if (this.opts.onLimit) this.opts.onLimit();
      return;
    }
    if (this.vEnc.encodeQueueSize > 6) {
      this.dropped++;
      return;
    }
    let vf;
    try {
      vf = new VideoFrame(frame, {
        visibleRect: this.crop,
        displayWidth: this.crop.width,
        displayHeight: this.crop.height,
        timestamp: Math.round(ts),
      });
    } catch {
      vf = this.cropOnCanvas(frame, ts);
    }
    const key = this.vCount === 0 || ts - this.lastKeyTs >= 2e6;
    try {
      this.vEnc.encode(vf, { keyFrame: key });
    } finally {
      vf.close();
    }
    if (key) this.lastKeyTs = ts;
    this.vCount++;
    this.lastTs = ts;
  }

  cropOnCanvas(frame, ts) {
    const { x, y, width, height } = this.crop;
    if (!this.cropCanvas) this.cropCanvas = new OffscreenCanvas(width, height);
    const ctx = this.cropCanvas.getContext('2d');
    ctx.drawImage(frame, x, y, width, height, 0, 0, width, height);
    return new VideoFrame(this.cropCanvas, { timestamp: Math.round(ts) });
  }

  async audioLoop() {
    for (;;) {
      const { value: ad, done } = await this.aReader.read();
      if (done || !ad) break;
      const arrival = performance.now() * 1000;
      try {
        if (this.stopped) continue;
        const t = mapTime(this.aMap, ad.timestamp, arrival, !this.recording);
        if (this.opts.onAudio) {
          try {
            this.opts.onAudio(ad);
          } catch {}
        }
        if (!this.aTried) await this.setupAudio(ad);
        const ct = this.recording ? this.clipTime(t) : null; // (none while paused)
        if (ct != null && this.aEnc) this.encodeAudio(ad, ct);
      } catch {
        // Ignore a bad audio buffer.
      } finally {
        ad.close();
      }
    }
  }

  async setupAudio(ad) {
    this.aTried = true;
    const sampleRate = ad.sampleRate;
    const numberOfChannels = Math.min(2, ad.numberOfChannels);
    for (const [codec, kind, bitrate] of [
      ['mp4a.40.2', 'aac', 192000],
      ['opus', 'opus', 160000],
    ]) {
      const cfg = { codec, sampleRate, numberOfChannels, bitrate };
      try {
        const r = await AudioEncoder.isConfigSupported(cfg);
        if (!r || !r.supported) continue;
      } catch {
        continue;
      }
      if (this.stopped) return; // stopped meanwhile: no encoder
      this.audio = { chunks: [], decoderConfig: null, codec: kind, sampleRate, numberOfChannels };
      this.aEnc = new AudioEncoder({
        output: (chunk, meta) => {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          if (meta && meta.decoderConfig && !this.audio.decoderConfig) this.audio.decoderConfig = { ...meta.decoderConfig };
          this.audio.chunks.push({ data, type: chunk.type, timestamp: chunk.timestamp, duration: chunk.duration });
        },
        error: () => {
          this.aEnc = null; // keep recording video without sound
        },
      });
      this.aEnc.configure(cfg);
      return;
    }
  }

  encodeAudio(ad, ts) {
    const sr = this.audio.sampleRate;
    const ch = this.audio.numberOfChannels;
    const n = ad.numberOfFrames;
    const dur = (n / sr) * 1e6;
    if (ts + dur <= 0 || ts > this.opts.maxUs) return;
    if (this.aNext == null) this.aNext = 0;
    if (ts - this.aNext > 40000) this.encodeSilence(this.aNext, ts); // fill a gap with silence
    else if (this.aNext - ts > 250000) return; // far behind: a duplicate, skip it
    const data = new Float32Array(n * ch);
    for (let c = 0; c < ch; c++) {
      ad.copyTo(data.subarray(c * n, (c + 1) * n), { planeIndex: Math.min(c, ad.numberOfChannels - 1), format: 'f32-planar' });
    }
    const out = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round(this.aNext), data });
    try {
      this.aEnc.encode(out);
    } finally {
      out.close();
    }
    this.aNext += dur;
    this.gotAudio = true;
  }

  encodeSilence(fromUs, toUs) {
    if (!this.aEnc) return;
    const sr = this.audio.sampleRate;
    const ch = this.audio.numberOfChannels;
    let total = Math.round(((toUs - fromUs) / 1e6) * sr);
    let t = fromUs;
    while (total > 0) {
      const n = Math.min(total, 4800);
      const out = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round(t), data: new Float32Array(n * ch) });
      try {
        this.aEnc.encode(out);
      } finally {
        out.close();
      }
      t += (n / sr) * 1e6;
      total -= n;
    }
    this.aNext = t;
  }

  // Start recording now. The newest frame from the countdown becomes the first frame of the clip.
  begin() {
    if (this.failed) throw this.failed;
    if (this.vEnc && this.vEnc.state !== 'configured') throw new Error('The video encoder stopped.');
    this.calibrated = this.calibrate();
    this.stopClock();
    this.t0 = performance.now() * 1000;
    this.recording = true;
    if (this.preroll) {
      const { frame } = this.preroll;
      this.preroll = null;
      try {
        this.encodeFrame(frame, 0);
      } finally {
        frame.close();
      }
    }
  }

  // Pause: nothing is recorded until resume(); the clip simply goes on from where it stopped (the
  // pause isn't in it, and doesn't count towards its length).
  get paused() {
    const p = this.pauses[this.pauses.length - 1];
    return !!p && p.to == null;
  }

  pause() {
    if (!this.recording || this.stopped || this.paused) return;
    this.pauses.push({ from: performance.now() * 1000, to: null });
  }

  resume() {
    const p = this.pauses[this.pauses.length - 1];
    if (!p || p.to != null) return;
    p.to = performance.now() * 1000;
    // The newest frame from the pause starts the clip again (the page may not change for a while).
    if (this.held) {
      const { frame } = this.held;
      this.held = null;
      try {
        if (!this.stopped && !this.failed) this.encodeFrame(frame, this.clipTime(p.to));
      } finally {
        frame.close();
      }
    }
  }

  // Where a moment (performance.now() clock, µs) falls in the clip: the time since begin(), less the
  // pauses before it. null: during a pause (not recorded).
  clipTime(t) {
    let off = 0;
    for (const p of this.pauses) {
      if (t < p.from) break;
      if (p.to == null || t < p.to) return null;
      off += p.to - p.from;
    }
    return t - this.t0 - off;
  }

  // How long the clip is so far (pauses left out).
  elapsedUs() {
    if (this.t0 == null) return 0;
    const now = performance.now() * 1000;
    let off = 0;
    for (const p of this.pauses) off += (p.to == null ? now : p.to) - p.from;
    return now - this.t0 - off;
  }

  async stop() {
    if (this.stopped) return this.result;
    const durationUs = Math.min(this.opts.maxUs, Math.max(this.elapsedUs(), this.lastTs + 33333));
    this.recording = false;
    this.stopped = true;
    try {
      if (this.aEnc && this.audio) {
        if (this.aNext == null) this.aNext = 0;
        if (durationUs - this.aNext > 10000) this.encodeSilence(this.aNext, durationUs);
      }
      if (this.vEnc && this.vEnc.state === 'configured') await this.vEnc.flush().catch((e) => this.fail(e));
      if (this.aEnc && this.aEnc.state === 'configured') await this.aEnc.flush().catch(() => {});
    } finally {
      this.release();
    }
    // Keep whatever was recorded, even if the encoder failed part-way.
    if (!this.video.chunks.length || !this.video.decoderConfig) throw this.failed || new Error('Nothing was recorded.');
    const lastVideo = this.video.chunks[this.video.chunks.length - 1].timestamp;
    const keptUs = this.failed ? Math.min(durationUs, lastVideo + 33333) : durationUs;
    const audio = this.audio && this.gotAudio && this.audio.chunks.length ? this.audio : null;
    this.result = {
      video: this.video,
      audio,
      durationUs: keptUs,
      dropped: this.dropped,
      crop: this.crop,
      k: this.k,
      partial: !!this.failed,
      clock: this.vMap.mode + (this.calibrated ? ' (exact)' : ''),
    };
    return this.result;
  }

  release() {
    this.stopClock();
    for (const t of this.stream.getTracks()) t.stop();
    try {
      this.vReader && this.vReader.cancel();
    } catch {}
    try {
      this.aReader && this.aReader.cancel();
    } catch {}
    if (this.preroll) {
      this.preroll.frame.close();
      this.preroll = null;
    }
    if (this.held) {
      this.held.frame.close();
      this.held = null;
    }
    try {
      this.vEnc && this.vEnc.state !== 'closed' && this.vEnc.close();
    } catch {}
    try {
      this.aEnc && this.aEnc.state !== 'closed' && this.aEnc.close();
    } catch {}
  }

  abort() {
    this.stopped = true;
    this.recording = false;
    this.release();
  }
}

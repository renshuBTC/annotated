// Light glass for the overlay's controls. Chrome can use an SVG filter as a backdrop-filter, so each
// capsule gets a filter made for its exact size. How it looks:
// - clear glass: what's behind stays visible, only lightly softened, and is lifted towards white so
//   dark symbols read over anything (even the dimmed page), with its detail kept;
// - refraction through a convex "squircle" rim, worked out with Snell's law (glass index 1.5): light
//   bends hard right at the edge and not at all in the middle, so the page shows up bent around the
//   rim;
// - a specular rim light, brightest where the edge faces the light (top left) and again on the
//   opposite edge;
// - capsules materialize in by ramping up the bending, not just by fading;
// - Reduce Transparency, Increase Contrast and Reduce Motion are honoured (ui.css + here).

const NS = 'http://www.w3.org/2000/svg';
const media = (q) => (window.matchMedia ? window.matchMedia(q) : { matches: false });
export const prefers = {
  get lessTransparency() {
    return media('(prefers-reduced-transparency: reduce)').matches;
  },
  get moreContrast() {
    return media('(prefers-contrast: more)').matches;
  },
  get lessMotion() {
    return media('(prefers-reduced-motion: reduce)').matches;
  },
};

const DEFAULTS = {
  blur: 0.8, // softens what's behind just enough for the symbols (px, standard deviation)
  lens: 34, // how far light bends at the very edge (px, feDisplacementMap scale)
  ior: 1.5, // the glass's refractive index
  depth: 0.7, // how tall the rim's curve is, relative to its width
  saturate: 1.9, // vibrancy (lifting towards white washes colours out; this brings them back)
  // Luminosity: what's behind is lifted towards white along a curve (0.55 + 0.45 × √v), so black shows
  // as mid grey, the dimmed page as light grey with its detail kept, and text on white stays visible.
  lift: { amplitude: 0.45, exponent: 0.5, offset: 0.55 },
  veil: [255, 255, 255], // a thin milky tint...
  veilMid: 0.24, // ...in the middle, behind the symbols (0-1)
  veilRim: 0, // ...and none at the rim, where the bent page shows through
  spec: 0.85, // rim light strength (0-1)
  specAngle: -135, // where the light comes from (degrees; -135 = top left)
  rim: 0, // the rim's width at most (px); 0: about a third of the height (a menu sets a thin one)
};

// Convex squircle rim: height over the rim, x = 0 at the edge to 1 where the flat middle starts.
const squircle = (x) => Math.pow(1 - Math.pow(1 - x, 4), 0.25);

// How far light is bent across the rim (0-1 of the most), traced with Snell's law: a ray straight down
// through the curved top surface turns towards the normal, then travels down through the glass.
function bendProfile(ior, depth, n = 256) {
  const out = new Float32Array(n + 1);
  const base = 0.12; // glass under the rim, relative to the rim's width
  let max = 0;
  for (let i = 0; i <= n; i++) {
    const x = Math.min(0.9995, Math.max(0.0005, i / n));
    const d = 1e-3;
    const slope = (depth * (squircle(Math.min(1, x + d)) - squircle(Math.max(0, x - d)))) / (2 * d);
    const t1 = Math.atan(slope);
    const t2 = Math.asin(Math.sin(t1) / ior);
    const bend = Math.tan(t1 - t2) * (base + depth * squircle(x));
    out[i] = bend;
    max = Math.max(max, bend);
  }
  for (let i = 0; i <= n; i++) out[i] /= max || 1;
  return out;
}

let seq = 0;

// Signed distance from a point to a rounded rectangle centred in w×h (negative inside).
function sdf(px, py, w, h, r) {
  const qx = Math.abs(px - w / 2) - (w / 2 - r);
  const qy = Math.abs(py - h / 2) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Three images for a w×h capsule with corner radius r:
// - the lens: red/green say where each pixel looks (128 = straight through). Over the rim it looks
//   inwards, by the Snell's-law profile; the middle looks straight through;
// - the veil: a thin milky tint in the middle, none at the rim;
// - the rim light: white along the edge, strongest where the edge faces the light.
const profiles = new Map();
function glassMaps(w, h, r, o, dpr) {
  const W = Math.max(1, Math.round(w * dpr));
  const H = Math.max(1, Math.round(h * dpr));
  const key = `${o.ior}|${o.depth}`;
  let prof = profiles.get(key);
  if (!prof) profiles.set(key, (prof = bendProfile(o.ior, o.depth)));
  const N = prof.length - 1;
  const canvases = [0, 1, 2].map(() => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    return { c, ctx, img: ctx.createImageData(W, H) };
  });
  const L = canvases[0].img.data;
  const S = canvases[1].img.data;
  const P = canvases[2].img.data;
  // The rim: about a third of the height (it's where the page shows up bent), or at most o.rim.
  const bezel = Math.max(4, Math.min(Math.max(r, h * 0.3), o.rim > 0 ? Math.max(r, o.rim) : Infinity, w / 2, h / 2));
  const [sr, sg, sb] = o.veil;
  const la = (o.specAngle * Math.PI) / 180;
  const lx = Math.cos(la);
  const ly = Math.sin(la);
  for (let y = 0; y < H; y++) {
    const py = (y + 0.5) / dpr;
    for (let x = 0; x < W; x++) {
      const px = (x + 0.5) / dpr;
      const i = (y * W + x) * 4;
      let dx = 0;
      let dy = 0;
      let spec = 0;
      const depth = -sdf(px, py, w, h, r);
      if (depth > -1 && depth < bezel) {
        const e = 0.5;
        const gx = sdf(px + e, py, w, h, r) - sdf(px - e, py, w, h, r);
        const gy = sdf(px, py + e, w, h, r) - sdf(px, py - e, w, h, r);
        const gl = Math.hypot(gx, gy) || 1;
        const nx = gx / gl; // outward normal
        const ny = gy / gl;
        const m = prof[Math.round(Math.min(1, Math.max(0, depth / bezel)) * N)];
        dx = -nx * m;
        dy = -ny * m;
        const facing = nx * lx + ny * ly;
        const lit = Math.pow(Math.max(0, facing), 1.5) + 0.55 * Math.pow(Math.max(0, -facing), 1.5);
        const d = Math.max(0, depth);
        const line = Math.exp(-d / 1.1); // a thin bright line right at the edge...
        const glow = 0.35 * Math.exp(-d / (bezel * 0.35)); // ...fading into the glass
        spec = o.spec * lit * Math.min(1, line + glow);
      }
      L[i] = Math.round(128 + dx * 127);
      L[i + 1] = Math.round(128 + dy * 127);
      L[i + 2] = 128;
      L[i + 3] = 255;
      const a = o.veilRim + (o.veilMid - o.veilRim) * smoothstep(bezel * 0.5, bezel * 1.2, depth);
      S[i] = sr;
      S[i + 1] = sg;
      S[i + 2] = sb;
      S[i + 3] = Math.round(255 * Math.max(0, Math.min(1, a)));
      P[i] = 255;
      P[i + 1] = 255;
      P[i + 2] = 255;
      P[i + 3] = Math.round(255 * Math.max(0, Math.min(1, spec)));
    }
  }
  const urls = canvases.map(({ c, ctx, img }) => {
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  });
  return { lens: urls[0], veil: urls[1], spec: urls[2] };
}

function set(node, attrs) {
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function el(name, attrs) {
  return set(document.createElementNS(NS, name), attrs);
}

// One filter per capsule, so each can materialize on its own.
function makeFilter() {
  const id = `lg${++seq}`;
  const f = el('filter', { id, x: 0, y: 0, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
  const blur = el('feGaussianBlur', { in: 'SourceGraphic', result: 'blur' });
  const lens = el('feImage', { x: 0, y: 0, preserveAspectRatio: 'none', result: 'lens' });
  const bend = el('feDisplacementMap', { in: 'blur', in2: 'lens', xChannelSelector: 'R', yChannelSelector: 'G', result: 'bent' });
  const sat = el('feColorMatrix', { in: 'bent', type: 'saturate', result: 'vivid' });
  const lift = el('feComponentTransfer', { in: 'vivid', result: 'lit' });
  const funcs = ['feFuncR', 'feFuncG', 'feFuncB'].map((n) => lift.appendChild(el(n, { type: 'gamma' })));
  const veil = el('feImage', { x: 0, y: 0, preserveAspectRatio: 'none', result: 'veil' });
  const tint = el('feComposite', { in: 'veil', in2: 'lit', operator: 'over', result: 'tinted' });
  const spec = el('feImage', { x: 0, y: 0, preserveAspectRatio: 'none', result: 'spec' });
  const shine = el('feComposite', { in: 'spec', in2: 'tinted', operator: 'over' });
  f.append(blur, lens, bend, sat, lift, veil, tint, spec, shine);
  document.getElementById('glassDefs').append(f);
  return { id, f, blur, lens, bend, sat, funcs, veil, spec };
}

const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

/**
 * Turn `el` into a light glass capsule (its CSS gives the rim and shadow).
 * Returns { materialize() } — also run automatically whenever the capsule appears.
 */
export function glassify(node, options = {}) {
  const opts = { auto: true, ...DEFAULTS, ...options };
  const fx = makeFilter();
  let size = ''; // the size the maps were made for
  let boxSize = ''; // the size the filter is set to
  let anim = 0;
  let raf = 0;
  let visible = false;
  let lastMaps = 0;
  let trail = 0;

  // k: 0 = flat, 1 = full lensing (overshoots a little while materializing).
  const setLens = (k) => {
    fx.bend.setAttribute('scale', String(Math.round(opts.lens * k * 10) / 10));
    fx.blur.setAttribute('stdDeviation', String(Math.round(opts.blur * (0.35 + 0.65 * Math.min(1, k)) * 100) / 100));
  };
  fx.sat.setAttribute('values', String(opts.saturate));
  for (const fn of fx.funcs) set(fn, opts.lift);

  const apply = () => {
    raf = 0;
    const w = Math.round(node.offsetWidth);
    const h = Math.round(node.offsetHeight);
    const shown = w > 0 && h > 0;
    if (shown && !visible && opts.auto) materialize();
    visible = shown;
    if (!shown) return;
    // Glass off (Reduce Transparency, Increase Contrast): the CSS stand-in, and no maps to make.
    if (prefers.lessTransparency || prefers.moreContrast) {
      node.style.backdropFilter = '';
      node.classList.remove('lg');
      return;
    }
    const radius = parseFloat(getComputedStyle(node).borderTopLeftRadius) || h / 2;
    const r = Math.round(Math.min(radius, w / 2, h / 2));
    const key = `${w}x${h}x${r}`;
    // The filter always has the capsule's size now (even while its maps are being caught up).
    if (`${w}x${h}` !== boxSize) {
      set(fx.f, { width: w, height: h });
      set(fx.lens, { width: w, height: h });
      set(fx.veil, { width: w, height: h });
      set(fx.spec, { width: w, height: h });
      boxSize = `${w}x${h}`;
    }
    if (key !== size) {
      // While a capsule is morphing, stretch the last maps and redraw them a few times a second.
      clearTimeout(trail);
      if (!size || performance.now() - lastMaps > 70) {
        const k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--k')) || 1;
        const maps = glassMaps(w, h, r, opts, Math.min(2, (window.devicePixelRatio || 1) * k));
        fx.lens.setAttribute('href', maps.lens);
        fx.veil.setAttribute('href', maps.veil);
        fx.spec.setAttribute('href', maps.spec);
        size = key;
        lastMaps = performance.now(); // (after making them: slow ones aren't made back to back)
      } else {
        trail = setTimeout(later, 80);
      }
    }
    try {
      node.style.backdropFilter = `url(#${fx.id})`;
      // "lg": the clear glass is on, so ui.css drops the frosted stand-in's white tint.
      node.classList.toggle('lg', node.style.backdropFilter.includes('url('));
    } catch {
      node.classList.remove('lg'); // keep the CSS frosted fallback
    }
  };

  // Appear by condensing the lensing (and a small spring in size, unless motion is reduced).
  function materialize() {
    cancelAnimationFrame(anim);
    node.classList.remove('materialize');
    void node.offsetWidth;
    node.classList.add('materialize');
    if (prefers.lessMotion) {
      setLens(1);
      return;
    }
    const t0 = performance.now();
    const dur = 420;
    setLens(0);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      setLens(easeOutBack(t));
      if (t < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  node.addEventListener('animationend', (e) => {
    if (e.animationName === 'glass-materialize') node.classList.remove('materialize');
  });

  const later = () => {
    if (!raf) raf = requestAnimationFrame(apply);
  };
  new ResizeObserver(later).observe(node);
  // Settings can change while the overlay is open.
  for (const q of ['(prefers-reduced-transparency: reduce)', '(prefers-contrast: more)']) {
    try {
      window.matchMedia(q).addEventListener('change', later);
    } catch {}
  }
  setLens(1);
  apply();
  return { materialize };
}

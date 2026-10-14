// One caption layout + renderer, shared by the box you see on screen and the files you save,
// so what you see is exactly what you get.
//
// One look: white with black text, always, and a thin black line between the snip and the text (so a
// white snip and the caption still read as two parts). The source line is black too, and the credit is
// the Annotated.com logo (its "a" on the highlighter-yellow square) and the name.

// Newsreader (bundled, see ui.css); emoji from the system's emoji font; other scripts from a system serif.
export const FONT_STACK =
  '"Newsreader Snip", Georgia, "Times New Roman", "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", serif';
export const COLORS = { bg: '#ffffff', fg: '#000000', rule: '#000000' };
export const CREDIT = 'Annotated.com';
// The logo, in a 24 x 24 square: the yellow square (as on the icon) and Newsreader's "a" (icons/icon.svg).
// Beside the name it's 1.5 times as tall as the name's capitals and centred on them, a quarter of its own
// size away: how most product logos sit beside their name (the website's logo is set the same way).
export const LOGO_CAPS = 1.5;
const LOGO = { yellow: '#ffe24d', radius: 5.4, a: 'M13.24 10.15 13.27 10.77Q11.9 11.23 11.05 11.66Q10.2 12.09 9.75 12.54Q9.3 12.98 9.14 13.5Q8.97 14.01 8.97 14.64Q8.97 15.72 9.47 16.22Q9.97 16.72 10.74 16.72Q11.29 16.72 11.69 16.5Q12.09 16.28 12.32 15.83Q12.55 15.39 12.55 14.69V8.61Q12.55 7.46 11.96 6.84Q11.36 6.22 10.15 6.22Q9.55 6.22 9.01 6.28Q8.46 6.35 8.12 6.48L8.72 5.79Q8.64 6.54 8.54 7.11Q8.45 7.67 8.33 8.05Q8.21 8.43 8.04 8.64Q7.85 8.9 7.46 9.06Q7.06 9.22 6.6 9.22Q5.99 9.22 5.69 9.01Q5.38 8.79 5.38 8.4Q5.38 7.82 5.95 7.24Q6.52 6.65 7.45 6.15Q8.39 5.65 9.53 5.34Q10.66 5.04 11.8 5.04Q13.45 5.04 14.45 5.52Q15.44 6 15.89 6.87Q16.33 7.74 16.33 8.93V16.15Q16.33 16.52 16.45 16.74Q16.56 16.97 16.78 17.07Q17 17.18 17.28 17.18Q17.64 17.18 18 17.07Q18.36 16.97 18.74 16.74V17.28Q17.75 18.29 16.92 18.63Q16.09 18.96 15.09 18.96Q14.17 18.96 13.62 18.6Q13.07 18.23 12.83 17.5Q12.58 16.76 12.54 15.64L12.67 15.72Q12.42 16.76 11.92 17.48Q11.41 18.2 10.7 18.57Q9.99 18.94 9.11 18.94Q7.32 18.94 6.29 18.04Q5.26 17.14 5.26 15.53Q5.26 14.71 5.54 14.06Q5.83 13.42 6.65 12.83Q7.47 12.24 9.06 11.6Q10.64 10.96 13.24 10.15Z' };
let logoPath = null;
function drawLogo(ctx, x, y, size) {
  if (!logoPath) logoPath = new Path2D(LOGO.a);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = LOGO.yellow;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(0, 0, 24, 24, LOGO.radius);
  else ctx.rect(0, 0, 24, 24);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.fill(logoPath);
  ctx.restore();
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

let measureCtx = null;
function mctx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

// Sizes (in CSS px of the box) for a caption that is `width` wide.
export function captionMetrics(width) {
  const size = clamp(Math.round(width * 0.046), 15, 44);
  const pad = clamp(Math.round(size * 0.72), 10, 30);
  const srcSize = clamp(Math.round(size * 0.5), 11, 20);
  return {
    size,
    pad,
    srcSize,
    lineH: Math.round(size * 1.3),
    srcLineH: Math.round(srcSize * 1.45),
    // From the annotation's last baseline to the top of the link-and-logo row: half the annotation's text
    // size, so the row reads as part of the annotation (nearer to it than to the box's edges).
    gap: Math.round(size * 0.5),
    padTop: Math.round(pad * 0.8),
    padBottom: Math.round(pad * 0.85),
  };
}

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
function graphemes(s) {
  return segmenter ? Array.from(segmenter.segment(s), (x) => x.segment) : Array.from(s);
}

// Chinese and Japanese break between characters (they don't put spaces between words); a closing mark
// (、。」 …) never starts a line.
const CJK = '\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}\\u3000-\\u303F\\uFF00-\\uFFEF';
const WORDS = new RegExp(`\\s*(?:[${CJK}]|[^\\s${CJK}]+)`, 'gu');
const CLOSING = /^[、。，．：；！？）」』】〉》〕］｝ー…‥・％]/u;

// Greedy word wrap with the browser's own text measurement. Words longer than a line are split
// between characters; URLs prefer to break after / ? & = . - _ #.
function wrap(ctx, text, maxW, isUrl) {
  const out = [];
  const fits = (s) => ctx.measureText(s).width <= maxW;
  for (const para of text.split('\n')) {
    if (!para.trim()) {
      out.push('');
      continue;
    }
    const tokens = isUrl ? para.match(/[^/?&=.\-_#]*[/?&=.\-_#]?/g).filter(Boolean) : para.match(WORDS) || [para];
    let line = '';
    const pushLong = (tok) => {
      // Split a token that doesn't fit on a line of its own.
      for (const g of graphemes(tok)) {
        if (line && !fits(line + g)) {
          out.push(line);
          line = g.trimStart();
        } else {
          line += g;
        }
      }
    };
    for (const tok of tokens) {
      if (!line) {
        const t = tok.trimStart();
        if (fits(t)) line = t;
        else pushLong(t);
        continue;
      }
      if (fits(line + tok)) {
        line += tok;
      } else {
        let carry = '';
        if (!isUrl && CLOSING.test(tok)) {
          // (The character before a closing mark goes to the next line with it.)
          const gs = graphemes(line);
          if (gs.length > 1) carry = gs.pop();
          line = gs.join('');
        }
        out.push(line);
        line = '';
        const t = (carry + tok).trimStart();
        if (fits(t)) line = t;
        else pushLong(t);
      }
    }
    out.push(line);
  }
  // Drop trailing empty lines.
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

function fontBox(ctx, font) {
  ctx.font = font;
  const m = ctx.measureText('Hgjy');
  const asc = m.fontBoundingBoxAscent || m.actualBoundingBoxAscent || 0;
  const desc = m.fontBoundingBoxDescent || m.actualBoundingBoxDescent || 0;
  return { asc, desc };
}

export function captionFont(size, weight = 600) {
  return `${weight} ${size}px ${FONT_STACK}`;
}

// Lay out `text`, then one row with the source link on the left (just the link) and the credit on the right,
// for a box `width` CSS px wide.
export function layoutCaption({ text, source, width }) {
  const ctx = mctx();
  const m = captionMetrics(width);
  const colors = COLORS;
  const inner = Math.max(20, width - m.pad * 2);
  const capFont = captionFont(m.size, 600);
  const srcFont = captionFont(m.srcSize, 500);
  const clean = (text || '').replace(/\r/g, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

  ctx.font = capFont;
  const lines = clean ? wrap(ctx, clean, inner, false) : [];
  // Written right to left (Hebrew, Arabic...): read that way, from the right (as its first letter says).
  const rtl = /^[^\p{L}]*[\p{sc=Hebrew}\p{sc=Arabic}\p{sc=Syriac}\p{sc=Thaana}\p{sc=Nko}]/u.test(clean);
  const footer = !!source;
  ctx.font = srcFont;
  // The credit: the logo, a gap, then the name, on one line (see LOGO_CAPS): the logo centred on the
  // name's capitals, so it reaches as far above them as below the baseline.
  const capH = ctx.measureText('H').actualBoundingBoxAscent || m.srcSize * 0.66;
  const logoSize = capH * LOGO_CAPS;
  const logoGap = logoSize / 4;
  const logoAbove = (capH + logoSize) / 2; // (from the baseline up to the logo's top)
  const creditText = ctx.measureText(CREDIT).width;
  const creditW = logoSize + logoGap + creditText;
  const gapW = m.srcSize * 1.5;
  // The link wraps in the space left of the credit; if that gets too narrow (a thin snip),
  // the credit takes its own row under the link instead.
  const besideW = inner - creditW - gapW;
  const beside = besideW >= Math.max(90, inner * 0.38);
  const srcLines = footer ? wrap(ctx, source, beside ? besideW : inner, true) : [];
  // On its own row, on a snip too thin for it, the credit is made smaller to fit. (Measured again at
  // the smaller size: small text isn't exactly narrower in proportion.)
  let fitK = 1;
  let creditFont = srcFont;
  if (!beside && creditW > inner) {
    let w = creditW;
    for (let i = 0; i < 4 && w > inner; i++) {
      fitK *= inner / w;
      creditFont = captionFont(m.srcSize * fitK, 500);
      ctx.font = creditFont;
      w = (logoSize + logoGap) * fitK + ctx.measureText(CREDIT).width;
    }
    ctx.font = srcFont;
  }

  const cb = fontBox(ctx, capFont);
  const sb = fontBox(ctx, srcFont);
  let y = m.padTop;
  const placed = [];
  let lastBase = null;
  for (const t of lines) {
    lastBase = y + (m.lineH - (cb.asc + cb.desc)) / 2 + cb.asc;
    placed.push(rtl ? { t, x: inner, align: 'right', dir: 'rtl', y: lastBase, font: capFont, color: colors.fg } : { t, x: 0, y: lastBase, font: capFont, color: colors.fg });
    y += m.lineH;
  }
  if (footer) {
    const base = (m.srcLineH - (sb.asc + sb.desc)) / 2 + sb.asc;
    // The row goes right under the annotation: its tallest mark (the logo, or the link's tall letters when
    // the logo is on a row of its own) starts `gap` below the annotation's last baseline.
    if (lastBase != null) {
      ctx.font = srcFont;
      const tall = ctx.measureText('Hhdl/').actualBoundingBoxAscent || m.srcSize * 0.72;
      y = lastBase + m.gap + (beside ? Math.max(logoAbove, tall) : tall) - base;
    }
    srcLines.forEach((t, i) => placed.push({ t, x: 0, y: y + i * m.srcLineH + base, font: srcFont, color: colors.fg }));
    // Beside the link: at the right end of its first row. Stacked (thin snips): its own row, left.
    const row = beside ? y : y + srcLines.length * m.srcLineH; // the top of the credit's row
    const lx = beside ? inner - creditText - logoGap - logoSize : 0;
    placed.push({ logo: true, x: lx, y: row + base - logoAbove * fitK, size: logoSize * fitK }); // centred on the capitals
    if (beside) placed.push({ t: CREDIT, x: inner, align: 'right', y: row + base, font: srcFont, color: colors.fg });
    else placed.push({ t: CREDIT, x: (logoSize + logoGap) * fitK, y: row + base, font: creditFont, color: colors.fg });
    y += (srcLines.length + (beside ? 0 : 1)) * m.srcLineH;
  }
  y += m.padBottom;
  const height = lines.length || footer ? Math.ceil(y) : 0;
  return { width, height, metrics: m, lines: placed, text: clean, source: source || '', textLines: lines.length, colors };
}

// Draw a laid-out caption with its top-left at (x, y), in the context's current units (CSS px).
export function drawCaption(ctx, layout, x = 0, y = 0) {
  if (!layout.height) return;
  const colors = layout.colors || COLORS;
  ctx.save();
  ctx.fillStyle = colors.bg;
  ctx.fillRect(x, y, layout.width, layout.height);
  // A thin black line between the snip and the text.
  ctx.fillStyle = colors.rule;
  ctx.fillRect(x, y, layout.width, ruleWidth(layout.width));
  ctx.textBaseline = 'alphabetic';
  ctx.direction = 'ltr';
  for (const l of layout.lines) {
    if (l.logo) {
      drawLogo(ctx, x + layout.metrics.pad + l.x, y + l.y, l.size);
      continue;
    }
    ctx.font = l.font;
    ctx.fillStyle = l.color;
    ctx.direction = l.dir || 'ltr';
    ctx.textAlign = l.align || 'left';
    ctx.fillText(l.t, x + layout.metrics.pad + (l.x || 0), y + l.y);
  }
  ctx.restore();
}

// The line between the snip and the text: thin (1 CSS px, a little more on very wide snips).
export function ruleWidth(width) {
  return Math.max(1, width / 900);
}

// A canvas showing the caption at `scale` device pixels per CSS px (for the on-screen box).
export function renderCaptionCanvas(layout, scale, canvas = document.createElement('canvas')) {
  const w = Math.max(1, Math.round(layout.width * scale));
  const h = Math.max(1, Math.round(layout.height * scale));
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = layout.width + 'px';
  canvas.style.height = layout.height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, layout.width, layout.height);
  drawCaption(ctx, layout, 0, 0);
  return canvas;
}

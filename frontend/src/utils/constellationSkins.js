// Constellation-sky styles for the Comic, Bento and Journal visual themes.
// Classic and Toy (Kids) are drawn inline in AmbientAuraBackground.

export function getActiveSkySkin() {
  if (typeof document === 'undefined') return null;
  const cl = document.documentElement.classList;
  if (cl.contains('theme-toy')) return null;
  if (cl.contains('theme-comic')) return 'comic';
  if (cl.contains('theme-bento')) return 'bento';
  if (cl.contains('theme-journal')) return 'journal';
  return null;
}

const COMIC_COLORS = ['#ffd23f', '#e63946', '#1d6fd8', '#0f9d8a'];
const COMIC_NIGHT_COLORS = ['#ffd23f', '#ff6875', '#5aa8ff', '#42d6bd'];
const COMIC_INK = '#111111';

const BENTO_COLORS = [[139, 92, 246], [14, 165, 233], [245, 158, 11], [16, 185, 129]];

// Journal sky is drawn like a monochrome pencil/charcoal sketch: graphite and charcoal by day,
// chalk at night.
const GRAPHITE = [74, 74, 80];
const CHARCOAL = [28, 26, 28];
const CHALK = [228, 220, 204];
const CHALK_DIM = [178, 172, 162];

const rgba = ([r, g, b], a) => `rgba(${r}, ${g}, ${b}, ${a})`;

// A tiling speckle texture so strokes look like graphite dragged over paper grain.
const pencilPatternCache = new Map();
function pencilPattern(ctx, color) {
  const key = color.join(',');
  let pattern = pencilPatternCache.get(key);
  if (pattern) return pattern;
  const size = 64;
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const tctx = tile.getContext('2d');
  const img = tctx.createImageData(size, size);
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let p = 0; p < size * size; p++) {
    const n = rand();
    img.data[p * 4] = color[0];
    img.data[p * 4 + 1] = color[1];
    img.data[p * 4 + 2] = color[2];
    img.data[p * 4 + 3] = n < 0.14 ? 0 : Math.round(255 * (0.3 + 0.7 * rand()));
  }
  tctx.putImageData(img, 0, 0);
  pattern = ctx.createPattern(tile, 'repeat');
  pencilPatternCache.set(key, pattern);
  return pattern;
}

// Strokes the current shape a few times with small offsets, like a sketcher going over a line.
function sketchStroke(ctx, trace, color, width, passes, seed, spread = 0.7) {
  for (let p = 0; p < passes; p++) {
    const dx = (jitter(seed + p * 3.1) - 0.5) * spread * 2;
    const dy = (jitter(seed + p * 5.7) - 0.5) * spread * 2;
    ctx.save();
    ctx.translate(dx, dy);
    trace();
    ctx.strokeStyle = pencilPattern(ctx, color);
    ctx.lineWidth = width * (p === 0 ? 1 : 0.7);
    ctx.globalAlpha *= p === 0 ? 1 : 0.6;
    ctx.stroke();
    ctx.restore();
  }
}

function charcoalSmudge(ctx, cx, cy, r, color, alpha) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function traceBurst(ctx, cx, cy, outerR, innerR, points, rotation = 0) {
  ctx.beginPath();
  for (let p = 0; p < points * 2; p++) {
    const r = p % 2 === 0 ? outerR : innerR;
    const angle = rotation - Math.PI / 2 + (p * Math.PI) / points;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (p === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function traceSparkle(ctx, cx, cy, r) {
  const w = r * 0.28;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + w, cy - w, cx + r, cy);
  ctx.quadraticCurveTo(cx + w, cy + w, cx, cy + r);
  ctx.quadraticCurveTo(cx - w, cy + w, cx - r, cy);
  ctx.quadraticCurveTo(cx - w, cy - w, cx, cy - r);
  ctx.closePath();
}

// Deterministic per-star jitter so hand-drawn marks don't flicker between frames.
function jitter(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// A hand-drawn four-point "twinkle" diamond: one continuous stroke with concave sides,
// uneven tips, and an end that overshoots the starting tip.
function traceDoodleSparkle(ctx, cx, cy, R, rot, seed) {
  const tips = [];
  for (let k = 0; k < 4; k++) {
    const ang = rot - Math.PI / 2 + (k * Math.PI) / 2 + (jitter(seed + k * 1.3) - 0.5) * 0.12;
    // Vertical tips a bit longer than horizontal ones, like a classic twinkle
    const len = R * (k % 2 === 0 ? 1 : 0.78) * (0.9 + jitter(seed + k * 2.7) * 0.2);
    tips.push([cx + Math.cos(ang) * len, cy + Math.sin(ang) * len]);
  }
  ctx.beginPath();
  ctx.moveTo(tips[0][0] + (jitter(seed + 9) - 0.5) * R * 0.1, tips[0][1]);
  for (let k = 1; k <= 4; k++) {
    const [ax, ay] = tips[k - 1];
    let [bx, by] = tips[k % 4];
    if (k === 4) {
      const over = 0.1 + jitter(seed + 13) * 0.12;
      bx += (bx - ax) * over;
      by += (by - ay) * over;
    }
    // Control point pulled toward the center gives the pinched, concave sides
    const pull = 0.12 + jitter(seed + k * 4.1) * 0.12;
    const mx = cx + ((ax + bx) / 2 - cx) * pull;
    const my = cy + ((ay + by) / 2 - cy) * pull;
    ctx.quadraticCurveTo(mx, my, bx, by);
  }
}

// Colours in the current path like a pencil: grainy graphite shading plus a few diagonal
// hatch strokes clipped to the shape. Replaces the current path, so re-trace before outlining.
function pencilFill(ctx, cx, cy, R, color, seed) {
  ctx.save();
  ctx.fillStyle = pencilPattern(ctx, color);
  ctx.fill();
  ctx.clip();
  ctx.beginPath();
  const step = Math.max(1.6, R * 0.32);
  for (let d = -R * 1.2; d <= R * 1.2; d += step) {
    const off = (jitter(seed + d) - 0.5) * step * 0.35;
    ctx.moveTo(cx + d + off - R, cy + R);
    ctx.lineTo(cx + d + off + R, cy - R);
  }
  ctx.strokeStyle = pencilPattern(ctx, color);
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.restore();
}

function bentoColorFor(star, s, i) {
  if (star.color === 'blue') return BENTO_COLORS[1];
  if (star.color === 'warm') return BENTO_COLORS[2];
  return (s + i) % 3 === 1 ? BENTO_COLORS[3] : BENTO_COLORS[0];
}

/* ---------------------------------------------------------------- background */

export function drawSkinBackgroundStar(ctx, skin, isDark, star, bIdx, sx, sy, shimmer) {
  ctx.save();
  if (skin === 'comic') {
    const color = isDark ? COMIC_NIGHT_COLORS[bIdx % COMIC_NIGHT_COLORS.length] : COMIC_COLORS[bIdx % COMIC_COLORS.length];
    ctx.globalAlpha = Math.min(isDark ? 0.8 : 0.75, Math.max(0.35, star.alpha * (0.85 + shimmer * 0.4)));
    const r = Math.max(1.6, star.radius * 1.6);
    if (bIdx % 3 === 0) {
      traceSparkle(ctx, sx, sy, r * 2.1);
      ctx.fillStyle = color;
      ctx.fill();
      if (!isDark) {
        ctx.strokeStyle = COMIC_INK;
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.arc(sx, sy, r * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = isDark ? color : COMIC_INK;
      ctx.globalAlpha *= isDark ? 0.45 : 0.35;
      ctx.fill();
    }
  } else if (skin === 'bento') {
    const color = BENTO_COLORS[bIdx % BENTO_COLORS.length];
    const a = Math.min(isDark ? 0.75 : 0.6, star.alpha * (0.7 + shimmer * 0.5));
    const r = Math.max(1.1, star.radius * 1.2);
    const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 4);
    halo.addColorStop(0, rgba(color, a * 0.55));
    halo.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = rgba(isDark ? [255, 255, 255] : color, a);
    ctx.fill();
  } else if (skin === 'journal') {
    const base = isDark
      ? (bIdx % 3 === 0 ? CHALK : CHALK_DIM)
      : (bIdx % 3 === 0 ? CHARCOAL : GRAPHITE);
    const a = Math.min(isDark ? 0.6 : 0.55, Math.max(0.22, star.alpha * (0.75 + shimmer * 0.3)));
    const r = Math.max(1.8, star.radius * 2);
    ctx.globalAlpha = a;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const kind = bIdx % 6;
    const tilt = jitter(bIdx) * Math.PI;
    if (kind === 5 && star.radius > 0.9) {
      traceDoodleSparkle(ctx, sx, sy, r * 1.25, (jitter(bIdx + 3) - 0.5) * 0.2, bIdx);
      ctx.save();
      ctx.globalAlpha = a * 0.6;
      pencilFill(ctx, sx, sy, r * 1.25, base, bIdx);
      ctx.restore();
      traceDoodleSparkle(ctx, sx, sy, r * 1.25, (jitter(bIdx + 3) - 0.5) * 0.2, bIdx);
      ctx.strokeStyle = pencilPattern(ctx, base);
      ctx.lineWidth = 0.9;
      ctx.stroke();
    } else if (kind === 0 || kind === 3) {
      // Quick pencil asterisk: three short strokes that don't quite meet in the middle
      const trace = () => {
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const ang = tilt + (k * Math.PI) / 3 + (jitter(bIdx + k) - 0.5) * 0.25;
          const off = (jitter(bIdx * 2 + k) - 0.5) * r * 0.3;
          ctx.moveTo(sx - Math.cos(ang) * r + off, sy - Math.sin(ang) * r);
          ctx.lineTo(sx + Math.cos(ang) * r * 0.9 + off, sy + Math.sin(ang) * r * 0.9);
        }
      };
      sketchStroke(ctx, trace, base, 1.1, 1, bIdx);
    } else if (kind === 1) {
      // Small tick cross
      const trace = () => {
        ctx.beginPath();
        ctx.moveTo(sx - r * 0.7, sy - r * 0.6);
        ctx.lineTo(sx + r * 0.7, sy + r * 0.6);
        ctx.moveTo(sx + r * 0.6, sy - r * 0.7);
        ctx.lineTo(sx - r * 0.6, sy + r * 0.7);
      };
      sketchStroke(ctx, trace, base, 1, 1, bIdx);
    } else {
      // Graphite speck with a faint smudge
      charcoalSmudge(ctx, sx, sy, Math.max(2.2, star.radius * 2.6), base, 0.18);
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(0.7, star.radius * 0.7), 0, Math.PI * 2);
      ctx.fillStyle = pencilPattern(ctx, base);
      ctx.fill();
    }
  }
  ctx.restore();
}

/* ------------------------------------------------------- constellation lines */

export function drawSkinConstellationLines(ctx, skin, isDark, alignment, traceLines, bounds) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (skin === 'comic') {
    ctx.globalAlpha = Math.min(1, alignment * 0.95);
    traceLines();
    ctx.strokeStyle = COMIC_INK;
    ctx.lineWidth = 4.4;
    ctx.stroke();
    ctx.strokeStyle = isDark ? '#ece8da' : '#e63946';
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (skin === 'bento') {
    const grad = ctx.createLinearGradient(bounds.left, bounds.top, bounds.right, bounds.bottom);
    grad.addColorStop(0, rgba(BENTO_COLORS[2], 1));
    grad.addColorStop(0.5, rgba(BENTO_COLORS[0], 1));
    grad.addColorStop(1, rgba(BENTO_COLORS[1], 1));
    traceLines();
    ctx.globalAlpha = Math.min(1, alignment) * (isDark ? 0.22 : 0.16);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.globalAlpha = Math.min(1, alignment * (isDark ? 0.9 : 0.85));
    ctx.lineWidth = 1.8;
    ctx.stroke();
  } else if (skin === 'journal') {
    // Charcoal smear under a sketched graphite line drawn in two passes
    const ink = isDark ? CHALK : GRAPHITE;
    const strength = Math.min(1, alignment);
    ctx.globalAlpha = strength * (isDark ? 0.1 : 0.08);
    traceLines();
    ctx.strokeStyle = rgba(ink, 1);
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.globalAlpha = strength * 0.95;
    sketchStroke(ctx, traceLines, ink, 1.7, 2, 11, 0.8);
  }
  ctx.restore();
}

/* ------------------------------------------------------- constellation stars */

export function drawSkinStar(ctx, skin, isDark, star, s, i, alignment, baseAlpha, pulse) {
  const base = star.projectedRadius;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (skin === 'comic') {
    const ink = isDark ? '#4a4a56' : COMIC_INK;
    const shadow = ink;
    let fill = '#ffd23f';
    if (isDark) {
      if (star.mag >= 2.2 && alignment <= 0.35) fill = '#f6f5f0';
      else if (star.color === 'blue') fill = COMIC_NIGHT_COLORS[2];
      else if (star.color === 'warm') fill = '#ff9b54';
      else if ((s + i) % 4 === 1) fill = COMIC_NIGHT_COLORS[1];
    } else if (star.color === 'blue') fill = '#1d6fd8';
    else if (star.color === 'warm') fill = '#f26b1d';
    else if ((s + i) % 4 === 1) fill = '#e63946';
    if (alignment > 0.35) fill = '#ffd23f';
    const outerR = Math.max(3, base * 2.3 * pulse * (1 + alignment * 0.25));
    ctx.globalAlpha = Math.min(1, Math.max(0.7, baseAlpha + 0.25));
    if (star.mag < 2.2) {
      // "POW" burst with a hard offset shadow
      const rot = jitter(s + i * 7) * 0.6;
      traceBurst(ctx, star.sx + 1.6, star.sy + 1.6, outerR * 1.25, outerR * 0.6, 8, rot);
      ctx.fillStyle = shadow;
      ctx.fill();
      traceBurst(ctx, star.sx, star.sy, outerR * 1.25, outerR * 0.6, 8, rot);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    } else if ((s * 7 + i * 3) % 5 < 2) {
      // Diamond sparkle, the same glyph as the static background stars
      const r = outerR * 1.2;
      traceSparkle(ctx, star.sx + 1.3, star.sy + 1.3, r);
      ctx.fillStyle = shadow;
      ctx.fill();
      traceSparkle(ctx, star.sx, star.sy, r);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(star.sx + 1.2, star.sy + 1.2, outerR * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = shadow;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(star.sx, star.sy, outerR * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  } else if (skin === 'bento') {
    const color = bentoColorFor(star, s, i);
    const r = Math.max(1.4, base * 1.15 * pulse * (1 + alignment * 0.3));
    const haloR = r * (3.6 + alignment * 1.6);
    const halo = ctx.createRadialGradient(star.sx, star.sy, 0, star.sx, star.sy, haloR);
    const haloA = (isDark ? 0.42 : 0.3) + alignment * 0.2;
    halo.addColorStop(0, rgba(color, haloA));
    halo.addColorStop(0.5, rgba(color, haloA * 0.35));
    halo.addColorStop(1, rgba(color, 0));
    ctx.globalAlpha = Math.min(1, baseAlpha + 0.15);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(star.sx, star.sy, haloR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(star.sx, star.sy, r, 0, Math.PI * 2);
    ctx.fillStyle = rgba(color, 1);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(star.sx, star.sy, r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  } else if (skin === 'journal') {
    const bright = star.mag < 2.2;
    let ink;
    if (isDark) ink = bright || alignment > 0.35 ? CHALK : CHALK_DIM;
    else ink = bright || alignment > 0.35 ? CHARCOAL : GRAPHITE;
    const a = Math.min(1, Math.max(0.6, baseAlpha * 0.9 + alignment * 0.25));
    const outerR = Math.max(2.6, base * 2.2 * (1 + alignment * 0.2));
    const seed = s * 13 + i * 7;
    const cx = star.sx;
    const cy = star.sy;
    if (bright) {
      const rot = (jitter(seed) - 0.5) * 0.2;
      const R = outerR * 1.35;
      const traceStar = () => traceDoodleSparkle(ctx, cx, cy, R, rot, seed);
      const found = Math.min(1, alignment);
      if (alignment > 0.15) {
        ctx.globalAlpha = found;
        charcoalSmudge(ctx, cx, cy, R * 1.3, ink, isDark ? 0.16 : 0.13);
      }
      ctx.globalAlpha = a * (0.45 + found * 0.35);
      traceStar();
      pencilFill(ctx, cx, cy, R, ink, seed);
      ctx.globalAlpha = a;
      traceStar();
      ctx.strokeStyle = pencilPattern(ctx, ink);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else if (star.mag < 3.2) {
      // Little hand-drawn twinkle: two uneven crossed strokes with a dot
      ctx.globalAlpha = a;
      const r = outerR * 0.95;
      const tilt = (jitter(seed) - 0.5) * 0.35;
      ctx.beginPath();
      for (let k = 0; k < 2; k++) {
        const ang = tilt + (k * Math.PI) / 2;
        const r1 = r * (0.8 + jitter(seed + k * 3.3) * 0.35);
        const r2 = r * (0.75 + jitter(seed + k * 5.1) * 0.35);
        ctx.moveTo(cx - Math.cos(ang) * r1, cy - Math.sin(ang) * r1);
        ctx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
      }
      ctx.strokeStyle = pencilPattern(ctx, ink);
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0.9, base * 0.75), 0, Math.PI * 2);
      ctx.fillStyle = pencilPattern(ctx, ink);
      ctx.fill();
    } else {
      ctx.globalAlpha = a;
      const r = Math.max(1.2, base * 1.05);
      charcoalSmudge(ctx, cx, cy, r * 2.6, ink, 0.2);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = pencilPattern(ctx, ink);
      ctx.fill();
    }
  }
  ctx.restore();
}

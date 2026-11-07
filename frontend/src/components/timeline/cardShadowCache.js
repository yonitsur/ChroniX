// Cached drop shadows for rounded timeline cards.
//
// A canvas `shadowBlur` is re-blurred by the GPU on every fill, and the timeline redraws
// every card on every animation frame while zooming or panning. With a few dozen cards in
// view that blur was the largest single cost of a frame (about half of the GPU time on an
// integrated GPU). The shadow of a card only depends on its size, corner radius, blur,
// offset and colour, so it is rendered once into a small offscreen canvas and then stamped
// with drawImage, which is nearly free.
//
// Two forms:
// - 9-slice: for cards that are large compared to the blur, one template per
//   (radius, blur, offset, colour, scale) is drawn and stretched along the straight edges.
//   Along a straight edge the blurred profile of a rounded rectangle is constant, so the
//   stretch reproduces the native shadow exactly.
// - Whole sprite: for small cards (where the blur from opposite edges overlaps), one
//   sprite per exact size. Those cards come in a handful of sizes.
//
// Shadows are specified in device pixels (shadowBlur / shadowOffset ignore the canvas
// transform), so sprites are built in device pixels too and match on HiDPI screens and
// in exports rendered at other scales.

const MAX_SPRITES = 96;
const sprites = new Map();

function createCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

// Paints only the shadow of a w x h rounded rect whose top-left sits at (pad, pad): the
// shape itself is drawn far outside the canvas and its shadow is offset back inside.
function paintShadow(ctx, w, h, r, pad, blur, offsetY, color, canvasWidth) {
  const far = canvasWidth + 64;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = far;
  ctx.shadowOffsetY = offsetY;
  ctx.fillStyle = '#000';
  roundRectPath(ctx, pad - far, pad, w, h, r);
  ctx.fill();
}

function remember(key, sprite) {
  if (sprites.size >= MAX_SPRITES) sprites.delete(sprites.keys().next().value);
  sprites.set(key, sprite);
  return sprite;
}

function recall(key) {
  const sprite = sprites.get(key);
  if (sprite) {
    // Least recently used goes first when the cache is full.
    sprites.delete(key);
    sprites.set(key, sprite);
  }
  return sprite;
}

// Fallback: the original shadowed fill, in the card's own colour.
function nativeShadowFill(ctx, left, top, width, height, radius, blur, offsetY, color, fill) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = offsetY;
  ctx.fillStyle = fill;
  roundRectPath(ctx, left, top, width, height, radius);
  ctx.fill();
  ctx.restore();
}

/**
 * Draws the drop shadow of a rounded card at (left, top) in the context's current
 * coordinate space. Paint the card body over it afterwards (the body hides the part of
 * the shadow under the card, exactly like a shadowed fill). `fill` is the card body colour,
 * used only by the fallback for transformed contexts.
 */
export function drawCardShadow(ctx, { left, top, width, height, radius, blur, offsetY = 0, color, fill = '#ffffff' }) {
  if (!(width > 0) || !(height > 0)) return;
  if (!(blur > 0) || !color) return;
  const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  // Rotated / skewed / flipped contexts: let the browser draw it.
  if (!m || m.b !== 0 || m.c !== 0 || !(m.a > 0) || !(m.d > 0)) {
    nativeShadowFill(ctx, left, top, width, height, radius, blur, offsetY, color, fill);
    return;
  }
  const sx = m.a;
  const sy = m.d;
  // Device-pixel geometry of the card.
  const w = width * sx;
  const h = height * sy;
  const r = Math.max(0, Math.min(radius * Math.min(sx, sy), w / 2, h / 2));
  const ext = Math.ceil(blur * 1.5);
  const oy = Math.abs(offsetY);
  const pad = ext + Math.ceil(oy) + 2;
  // Whole device pixels so slices abut without seams.
  const originX = Math.round(left * sx + m.e - pad);
  const originY = Math.round(top * sy + m.f - pad);
  const totalW = Math.round(w + pad * 2);
  const totalH = Math.round(h + pad * 2);
  // Corner slice: far enough in that the blurred profile is constant beyond it.
  const corner = pad + Math.ceil(r + ext + oy) + 1;
  const styleKey = `${r.toFixed(2)}|${blur}|${offsetY}|${color}`;

  ctx.save();
  // Blit in device space (identity transform) so sprite pixels map 1:1.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.shadowColor = 'rgba(0, 0, 0, 0)';
  ctx.shadowBlur = 0;

  if (totalW >= corner * 2 + 1 && totalH >= corner * 2 + 1) {
    const key = `9|${styleKey}`;
    const side = corner * 2 + 1;
    let template = recall(key);
    if (!template) {
      const canvas = createCanvas(side, side);
      const c = canvas && canvas.getContext('2d');
      if (!c) { ctx.restore(); nativeShadowFill(ctx, left, top, width, height, radius, blur, offsetY, color, fill); return; }
      paintShadow(c, side - pad * 2, side - pad * 2, r, pad, blur, offsetY, color, side);
      template = remember(key, canvas);
    }
    const mid = side - corner * 2;
    const innerW = totalW - corner * 2;
    const innerH = totalH - corner * 2;
    const cols = [[0, corner, 0, corner], [corner, mid, corner, innerW], [corner + mid, corner, corner + innerW, corner]];
    const rows = [[0, corner, 0, corner], [corner, mid, corner, innerH], [corner + mid, corner, corner + innerH, corner]];
    for (const [srcY, srcH, dstY, dstH] of rows) {
      if (dstH <= 0) continue;
      for (const [srcX, srcW, dstX, dstW] of cols) {
        if (dstW <= 0) continue;
        ctx.drawImage(template, srcX, srcY, srcW, srcH, originX + dstX, originY + dstY, dstW, dstH);
      }
    }
  } else {
    const key = `s|${styleKey}|${w.toFixed(1)}x${h.toFixed(1)}`;
    let sprite = recall(key);
    if (!sprite) {
      const canvas = createCanvas(totalW, totalH);
      const c = canvas && canvas.getContext('2d');
      if (!c) { ctx.restore(); nativeShadowFill(ctx, left, top, width, height, radius, blur, offsetY, color, fill); return; }
      paintShadow(c, w, h, r, pad, blur, offsetY, color, totalW);
      sprite = remember(key, canvas);
    }
    ctx.drawImage(sprite, originX, originY);
  }
  ctx.restore();
}

export function clearCardShadowCache() {
  sprites.clear();
}

export function getCardShadowCacheSize() {
  return sprites.size;
}

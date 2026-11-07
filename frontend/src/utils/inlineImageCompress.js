// Canvas side of the inline-image budget (P-10); the pure rules are in inlineImageBudget.js.
import {
  INLINE_IMAGE_MAX_CHARS,
  INLINE_IMAGE_MAX_DIM,
  fitEncodedImageToBudget,
  isCompactJpegOrWebp,
} from './inlineImageBudget.js';

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('decode-failed'));
  img.src = src;
});

const fitDims = (width, height, maxDim) => {
  if (width <= maxDim && height <= maxDim) return { width, height };
  const scale = Math.min(maxDim / width, maxDim / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
};

/**
 * Encodes a decoded image to a data URL of at most `maxChars`: first as `mime` (PNG keeps
 * transparency when it fits), then as JPEG on white, lowering quality and then size.
 */
export async function encodeImageToBudget(img, {
  maxDim = INLINE_IMAGE_MAX_DIM,
  maxChars = INLINE_IMAGE_MAX_CHARS,
  mime = 'image/jpeg',
  quality = 0.82,
} = {}) {
  const base = fitDims(img.naturalWidth || img.width, img.naturalHeight || img.height, maxDim);
  if (!base.width || !base.height) throw new Error('decode-failed');
  const draw = (scale, type, q, opaque) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(base.width * scale));
    canvas.height = Math.max(1, Math.round(base.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no-canvas');
    if (opaque) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(type, q);
  };
  const first = draw(1, mime, quality, mime === 'image/jpeg');
  if (first.length <= maxChars) return first;
  const fitted = await fitEncodedImageToBudget(({ scale, quality: q }) => draw(scale, 'image/jpeg', q, true), { maxChars });
  return fitted && fitted.length < first.length ? fitted : first;
}

/**
 * Compresses an inline image to the budget once, e.g. an AI image entering the timeline. With
 * `skipCompact` (save-time passes), an already compact JPEG / WebP is left untouched.
 * Never throws: on any failure the original URL comes back.
 */
export async function compressDataUrlToBudget(url, {
  maxChars = INLINE_IMAGE_MAX_CHARS,
  maxDim = INLINE_IMAGE_MAX_DIM,
  skipCompact = false,
} = {}) {
  if (typeof url !== 'string' || url.length <= maxChars || !url.startsWith('data:image/')) return url;
  if (url.slice(0, 30).toLowerCase().includes('image/gif') || typeof document === 'undefined') return url;
  if (skipCompact && isCompactJpegOrWebp(url, { maxDim })) return url;
  try {
    const img = await loadImage(url);
    const out = await encodeImageToBudget(img, { maxDim, maxChars });
    return out && out.length < url.length ? out : url;
  } catch {
    return url;
  }
}

// Inline (data URL) images live inside the timeline document, so every save sends them again (P-10).
// They are compressed ONCE, when they enter the timeline (upload, AI image), to at most
// INLINE_IMAGE_MAX_CHARS, and the compressed URL is what the app keeps. A JPEG / WebP already within
// the dimension limit is never re-encoded on later saves (each pass loses quality); the server
// applies the same rule (storage._is_compact_jpeg_or_webp).
//
// Pure helpers: no DOM, so node tests drive them. The canvas encoder lives in inlineImageCompress.js.

export const INLINE_IMAGE_MAX_CHARS = 80000;
export const INLINE_IMAGE_MAX_DIM = 1024;
// Above this a compact JPEG / WebP is re-encoded anyway, so one photo can't bloat the document.
export const INLINE_IMAGE_REENCODE_SKIP_MAX_CHARS = 240000;
// Enough base64 to cover a JPEG's EXIF block before its frame header.
const SNIFF_BASE64_CHARS = 96000;

const decodeBase64Prefix = (b64) => {
  const clean = b64.slice(0, SNIFF_BASE64_CHARS - (SNIFF_BASE64_CHARS % 4)).replace(/[^A-Za-z0-9+/=]/g, '');
  const usable = clean.slice(0, clean.length - (clean.length % 4));
  let binary;
  try {
    binary = typeof atob === 'function' ? atob(usable) : Buffer.from(usable, 'base64').toString('binary');
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const sniffJpeg = (b) => {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    while (i < b.length && b[i] === 0xff) i += 1;
    if (i >= b.length) break;
    const marker = b[i];
    i += 1;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xda || i + 2 > b.length) break;
    const segLen = (b[i] << 8) | b[i + 1];
    if (segLen < 2) break;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 7 > b.length) break;
      return { mime: 'image/jpeg', height: (b[i + 3] << 8) | b[i + 4], width: (b[i + 5] << 8) | b[i + 6] };
    }
    i += segLen;
  }
  return null;
};

const ascii = (b, start, end) => String.fromCharCode(...b.slice(start, end));

const sniffWebp = (b) => {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 12) !== 'WEBP') return null;
  const chunk = ascii(b, 12, 16);
  if (chunk === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return { mime: 'image/webp', width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
  }
  if (chunk === 'VP8L' && b[20] === 0x2f) {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    return {
      mime: 'image/webp',
      width: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1,
      height: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1,
    };
  }
  return null;
};

/** { mime, width, height } of a JPEG / WebP data URL read from its header bytes, else null. */
export function sniffDataUrlImage(url) {
  if (typeof url !== 'string' || !url.startsWith('data:image/')) return null;
  const comma = url.indexOf(',');
  if (comma < 0 || !url.slice(0, comma).includes(';base64')) return null;
  const bytes = decodeBase64Prefix(url.slice(comma + 1));
  if (!bytes) return null;
  return sniffJpeg(bytes) || sniffWebp(bytes);
}

/** True for a JPEG / WebP data URL within `maxDim` on both sides and `maxChars` long. */
export function isCompactJpegOrWebp(url, { maxDim = INLINE_IMAGE_MAX_DIM, maxChars = INLINE_IMAGE_REENCODE_SKIP_MAX_CHARS } = {}) {
  if (typeof url !== 'string' || url.length > maxChars) return false;
  const info = sniffDataUrlImage(url);
  return Boolean(info && info.width > 0 && info.height > 0 && info.width <= maxDim && info.height <= maxDim);
}

/** Should a save-time pass re-encode this inline image? Only oversized, non-compact, non-GIF ones. */
export function needsSaveTimeCompression(url, maxChars = INLINE_IMAGE_MAX_CHARS) {
  if (typeof url !== 'string' || url.length <= maxChars || !url.startsWith('data:image/')) return false;
  if (url.slice(0, 30).toLowerCase().includes('image/gif')) return false;
  return !isCompactJpegOrWebp(url);
}

// Quality first, then size: the gentlest step that fits wins.
export const BUDGET_LADDER = [
  { scale: 1, quality: 0.82 },
  { scale: 1, quality: 0.72 },
  { scale: 1, quality: 0.62 },
  { scale: 0.8, quality: 0.62 },
  { scale: 0.65, quality: 0.6 },
  { scale: 0.5, quality: 0.55 },
  { scale: 0.4, quality: 0.5 },
];

/**
 * Runs `encode({ scale, quality })` (-> data URL string) down the ladder until the result fits
 * `maxChars`. Returns the first fitting result, else the smallest one produced.
 */
export async function fitEncodedImageToBudget(encode, { maxChars = INLINE_IMAGE_MAX_CHARS, ladder = BUDGET_LADDER } = {}) {
  let smallest = null;
  for (const step of ladder) {
    let out;
    try {
      out = await encode(step);
    } catch {
      continue;
    }
    if (typeof out !== 'string' || !out) continue;
    if (out.length <= maxChars) return out;
    if (!smallest || out.length < smallest.length) smallest = out;
  }
  return smallest;
}

/**
 * Applies `compress(url) -> Promise<url>` to every inline image of a timeline that a save-time pass
 * would re-encode (see needsSaveTimeCompression). Returns the same object when nothing changed.
 */
export async function compressTimelineInlineImages(timeline, compress, maxChars = INLINE_IMAGE_MAX_CHARS) {
  if (!timeline || typeof timeline !== 'object' || !Array.isArray(timeline.articles)) return timeline;
  const needs = (u) => needsSaveTimeCompression(u, maxChars);
  const anyNeeds = timeline.articles.some((art) => art && typeof art === 'object' && (
    needs(art.imageUrl)
    || (Array.isArray(art.additionalImages) && art.additionalImages.some((im) => needs(typeof im === 'string' ? im : im?.url)))
  ));
  if (!anyNeeds) return timeline;
  const articles = await Promise.all(timeline.articles.map(async (art) => {
    if (!art || typeof art !== 'object') return art;
    let next = art;
    if (needs(art.imageUrl)) {
      const url = await compress(art.imageUrl);
      if (url && url !== art.imageUrl) next = { ...next, imageUrl: url };
    }
    if (Array.isArray(art.additionalImages) && art.additionalImages.some((im) => needs(typeof im === 'string' ? im : im?.url))) {
      const additionalImages = await Promise.all(art.additionalImages.map(async (im) => {
        if (typeof im === 'string') return needs(im) ? ((await compress(im)) || im) : im;
        if (im && typeof im === 'object' && needs(im.url)) {
          const url = await compress(im.url);
          return url && url !== im.url ? { ...im, url } : im;
        }
        return im;
      }));
      next = { ...next, additionalImages };
    }
    return next;
  }));
  return { ...timeline, articles };
}

// Multi-tier resolution helpers for Wikimedia Commons / Wikipedia thumbnail URLs.
// - Timeline canvas, list & map pins use lightweight 500px thumbnails for instant loading and low memory.
// - Event drawer uses crisp 1280px thumbnails.
// - Full-screen lightbox / zoom viewer uses 1920px (or original unscaled media) for detailed maps and charts.

export const CANVAS_THUMB_WIDTH = 500;
export const DRAWER_IMAGE_WIDTH = 1280;
export const LIGHTBOX_IMAGE_WIDTH = 1920;

const WEB_SAFE_IMAGE_EXT_RE = /\.(?:jpe?g|png|webp|gif|svg|avif)$/i;
const THUMB_SEGMENT_WIDTH_RE = /\/((?:[a-z0-9]+-)*?)(\d+)px-([^/?#]+)(\?.*)?$/i;

export function isWikimediaThumbUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return url.includes('/thumb/') && (url.includes('wikimedia.org') || url.includes('wikipedia.org'));
}

export function normalizeAnimatedMediaUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (isWikimediaThumbUrl(url) && url.toLowerCase().includes('.gif')) {
    return url
      .replace('thumb.wikimedia.org', 'upload.wikimedia.org')
      .replace(/\/thumb\/([^/]+\/[^/]+\/[^/]+)\/.*$/, '/$1')
      .split('?')[0];
  }
  return url;
}

export function extractWikimediaThumbFilename(url) {
  if (!isWikimediaThumbUrl(url)) return '';
  try {
    const cleanPath = url.split('?')[0].split('#')[0];
    const segs = cleanPath.split('/').filter(Boolean);
    const thumbIdx = segs.indexOf('thumb');
    if (thumbIdx !== -1 && segs.length > thumbIdx + 3) {
      return decodeURIComponent(segs[thumbIdx + 3]);
    }
  } catch {
    // ignore malformed percent-encoding
  }
  return '';
}

export function getWikimediaOriginalUrl(url) {
  if (!isWikimediaThumbUrl(url)) return null;
  const filename = extractWikimediaThumbFilename(url);
  if (!filename || !WEB_SAFE_IMAGE_EXT_RE.test(filename)) {
    return null;
  }
  return url
    .replace('thumb.wikimedia.org', 'upload.wikimedia.org')
    .replace(/\/thumb\/([^/]+\/[^/]+\/[^/]+)\/[^/?#]+(\?.*)?$/, '/$1');
}

export function resizeWikimediaThumbUrl(url, targetWidth, { direction = 'both' } = {}) {
  if (!url || typeof url !== 'string') return url;
  const normalized = normalizeAnimatedMediaUrl(url);
  if (!isWikimediaThumbUrl(normalized) || normalized.toLowerCase().includes('.gif')) {
    return normalized;
  }
  const match = normalized.match(THUMB_SEGMENT_WIDTH_RE);
  if (!match) return normalized;

  const prefix = match[1] || '';
  const currentWidth = Number(match[2]);
  const suffix = match[3];
  const query = match[4] || '';

  if (!Number.isFinite(currentWidth) || currentWidth <= 0 || !Number.isFinite(targetWidth) || targetWidth <= 0) {
    return normalized;
  }
  if (direction === 'downscale' && currentWidth <= targetWidth) {
    return normalized;
  }
  if (direction === 'upscale' && currentWidth >= targetWidth) {
    return normalized;
  }

  return normalized.replace(
    THUMB_SEGMENT_WIDTH_RE,
    `/${prefix}${Math.round(targetWidth)}px-${suffix}${query}`
  );
}

export function getCanvasImageUrl(url) {
  if (!url || typeof url !== 'string') return url;
  return resizeWikimediaThumbUrl(url, CANVAS_THUMB_WIDTH, { direction: 'downscale' });
}

export function getDrawerImageUrl(url) {
  if (!url || typeof url !== 'string') return url;
  return resizeWikimediaThumbUrl(url, DRAWER_IMAGE_WIDTH, { direction: 'upscale' });
}

export function getLightboxImageUrl(url) {
  if (!url || typeof url !== 'string') return url;
  return resizeWikimediaThumbUrl(url, LIGHTBOX_IMAGE_WIDTH, { direction: 'upscale' });
}

function uniqueUrls(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (typeof item === 'string' && item && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

export function getDrawerImageCandidates(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return [];
  const normalized = normalizeAnimatedMediaUrl(rawUrl);
  const drawerUrl = getDrawerImageUrl(normalized);
  const originalUrl = getWikimediaOriginalUrl(normalized);
  return uniqueUrls([drawerUrl, originalUrl, normalized]);
}

export function getLightboxImageCandidates(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return [];
  const normalized = normalizeAnimatedMediaUrl(rawUrl);
  const lightboxUrl = getLightboxImageUrl(normalized);
  const originalUrl = getWikimediaOriginalUrl(normalized);
  const drawerUrl = getDrawerImageUrl(normalized);
  return uniqueUrls([lightboxUrl, originalUrl, drawerUrl, normalized]);
}

/**
 * Pure helpers for the Photo Tray: bulk-uploading images and assigning them to events.
 *
 * Photos are downscaled client-side and kept as inline data URLs (same as the event editor),
 * so assigning one is just a normal event image update with `imageSource: 'upload'`.
 */

export const PHOTO_TRAY_MIME = 'application/x-chronix-photo';
export const TRAY_MAX_IMAGE_DIM = 900;
export const TRAY_MAX_SOURCE_BYTES = 12 * 1024 * 1024;
export const TRAY_MAX_PHOTOS = 100;
export const TRAY_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** @param {{type?: string, size?: number}} file @returns {'ok'|'type'|'size'} */
export function classifyTrayFile(file) {
  if (!file || !ACCEPTED_TYPES.has(String(file.type || '').toLowerCase())) return 'type';
  if ((file.size || 0) > TRAY_MAX_SOURCE_BYTES) return 'size';
  return 'ok';
}

/** Lower-cases, strips diacritics and collapses whitespace so Latin/Hebrew search is forgiving. */
export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f\u0591-\u05c7]/g, '')
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "grandma_wedding-1998.JPG" -> "grandma wedding 1998" */
export function filenameToLabel(name) {
  return normalizeSearchText(String(name || '').replace(/\.[^./\\]+$/, ''));
}

function articleYearText(article) {
  const from = article?.from;
  if (from && typeof from === 'object' && from.year != null) return String(from.year);
  return '';
}

/**
 * Filters events by title / subtitle / year. Empty query returns everything.
 * @param {Array<object>} articles
 * @param {string} query
 */
export function filterEventsByQuery(articles, query) {
  const list = Array.isArray(articles) ? articles : [];
  const q = normalizeSearchText(query);
  if (!q) return list;
  const terms = q.split(' ');
  return list.filter((a) => {
    const hay = normalizeSearchText(`${a?.title || ''} ${a?.subtitle || ''} ${articleYearText(a)}`);
    return terms.every((term) => hay.includes(term));
  });
}

/**
 * How well an event's date matches the day a photo was taken ({year, month, day}):
 * same day 6, within its span 6, +-1 day 4, same month 2, same year 1, else 0.
 */
export function dateMatchScore(article, taken) {
  const f = article?.from;
  if (!taken || !f || !Number.isInteger(f.year)) return 0;
  const toMs = (d) => Date.UTC(d.year, (d.month || 1) - 1, d.day || 1);
  const takenMs = Date.UTC(taken.year, taken.month - 1, taken.day);
  if (f.month && f.day) {
    const start = toMs(f);
    const t = article.to && article.to.month && article.to.day ? article.to : f;
    const end = toMs(t);
    if (takenMs >= start && takenMs <= end) return 6;
    const DAY = 24 * 3600 * 1000;
    if (takenMs >= start - DAY && takenMs <= end + DAY) return 4;
  }
  if (f.year === taken.year && f.month && f.month === taken.month) return 2;
  if (f.year === taken.year) return 1;
  return 0;
}

/**
 * Events to suggest for a photo, best first: title words shared with the filename (3+ chars),
 * plus how well the event's date matches the day the photo was taken (when its EXIF has one).
 */
export function suggestEventsForPhoto(photoName, articles, limit = 3, taken = null) {
  const words = filenameToLabel(photoName).split(' ').filter((w) => w.length >= 3);
  if (!words.length && !taken) return [];
  return (Array.isArray(articles) ? articles : [])
    .map((a) => {
      const title = normalizeSearchText(a?.title || '');
      const wordScore = words.reduce((n, w) => n + (title.includes(w) ? 1 : 0), 0);
      const dateScore = dateMatchScore(a, taken);
      // A year-only match alone is too weak to suggest anything.
      const score = wordScore * 3 + (dateScore >= 2 || wordScore ? dateScore : 0);
      return { a, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((x) => x.a);
}

/** Capture day of an image file from its EXIF (browser; exifr loaded on demand), or null. */
export async function readPhotoTakenDay(file) {
  try {
    const [{ default: exifr }, { EXIF_PARSE_OPTIONS }, { buildPhotoMeta }] = await Promise.all([
      import('exifr/dist/lite.esm.mjs'),
      import('./photoImport/photoFiles.js'),
      import('./photoImport/photoMeta.js'),
    ]);
    const tags = await exifr.parse(file, EXIF_PARSE_OPTIONS).catch(() => null);
    const meta = buildPhotoMeta({ id: 'x', name: file.name, tags });
    if (!meta.time) return null;
    const { year, month, day } = meta.time.wall;
    return { year, month, day };
  } catch {
    return null;
  }
}

/** Snapshot of the event fields touched by an image assignment (used for Undo). */
export function snapshotImageFields(article) {
  const a = article || {};
  return {
    imageUrl: a.imageUrl,
    imageSource: a.imageSource,
    imageModel: a.imageModel,
    imageCostUsd: a.imageCostUsd,
    mediaType: a.mediaType,
    imagePositionX: a.imagePositionX,
    imagePositionY: a.imagePositionY,
    additionalImages: a.additionalImages,
  };
}

/** Reads, downscales and encodes an image file as a data URL (PNG/GIF keep their type). */
export function fileToTrayDataUrl(file, maxDim = TRAY_MAX_IMAGE_DIM, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read-failed'));
    reader.onload = () => {
      if (file.type === 'image/gif') {
        resolve(reader.result);
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error('decode-failed'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        try {
          resolve(canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality));
        } catch (err) {
          reject(err);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

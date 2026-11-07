// Browser-only side of the photo import: reads EXIF (exifr, loaded on demand), makes review
// thumbnails, and encodes the photos that are kept / sent to the AI. Photos never leave the
// browser except as the small re-encoded JPEGs the user chose to keep or have described -
// re-encoding through a canvas also strips their EXIF (including GPS).

import { buildPhotoMeta } from './photoMeta.js';
import { isSidecarName, matchTakeoutSidecars, parseTakeoutSidecar, mergeSidecarIntoTags } from './takeout.js';

export const PHOTO_IMPORT_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,.jpg,.jpeg,.png,.webp';
export const PHOTO_IMPORT_MAX_FILE_BYTES = 60 * 1024 * 1024;
export const THUMB_MAX_DIM = 320;
export const COVER_MAX_DIM = 800;
export const GALLERY_MAX_DIM = 640;
export const COVER_MAX_CHARS = 140_000;
export const GALLERY_MAX_CHARS = 95_000;

// exifr's lite build has no tag dictionaries, so `pick` by name doesn't work there: parse just the
// small TIFF/EXIF/GPS segments instead (still only the first KBs of the file).
export const EXIF_PARSE_OPTIONS = Object.freeze({
  tiff: true,
  exif: true,
  gps: true,
  ifd1: false,
  interop: false,
  xmp: false,
  icc: false,
  iptc: false,
  jfif: false,
  ihdr: false,
  makerNote: false,
  userComment: false,
  reviveValues: false,
  translateValues: false,
});
const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;

let exifrPromise = null;
const loadExifr = () => {
  if (!exifrPromise) exifrPromise = import('exifr/dist/lite.esm.mjs').then((m) => m.default || m);
  return exifrPromise;
};

let heicPromise = null;
const loadHeic = () => {
  // CSP-safe build (no eval); ~3 MB, fetched only when a HEIC photo needs decoding.
  if (!heicPromise) heicPromise = import('heic-to/csp');
  return heicPromise;
};

/** Google Photos items are lazy "remote sources" ({ remote: true, load(maxDim) -> Blob }). */
export const isRemoteSource = (file) => Boolean(file && file.remote && typeof file.load === 'function');

export function isHeicFile(file) {
  if (isRemoteSource(file)) return false;
  const type = String(file?.type || '').toLowerCase();
  return type === 'image/heic' || type === 'image/heif' || /\.(heic|heif)$/i.test(String(file?.name || ''));
}

/** 'ok' | 'type' | 'size' */
export function classifyPhotoFile(file) {
  if (!file) return 'type';
  const type = String(file.type || '').toLowerCase();
  if (!(type.startsWith('image/') || IMAGE_EXT.test(String(file.name || '')))) return 'type';
  if (type === 'image/gif' || type === 'image/svg+xml') return 'type';
  if ((file.size || 0) > PHOTO_IMPORT_MAX_FILE_BYTES) return 'size';
  return 'ok';
}

let idSeq = 0;
const nextId = () => {
  idSeq += 1;
  return `ph${Date.now().toString(36)}${idSeq.toString(36)}`;
};

const SIDECAR_MAX_BYTES = 2 * 1024 * 1024;

/** A dropped/picked item's path inside its folder ("Takeout/Google Photos/Trip/IMG_1.jpg"). */
export const filePath = (file, path = null) => path || file?.webkitRelativePath || file?.name || '';

/**
 * Reads metadata from many files with a small worker pool. EXIF lives in the first few KB, so
 * this is fast even for thousands of photos; pixels are not decoded here.
 * Google Takeout folders work too: each photo's JSON sidecar (same folder) fills in the capture
 * time and place when the photo's own EXIF lacks them, and adds tagged people and captions.
 *
 * @param {Iterable<File|{file: File, path: string}>} fileList
 * @returns {Promise<{metas: object[], files: Map<string, File>, skipped: {type: number, size: number, limit: number}, sidecars: number}>}
 */
export async function readPhotoFiles(fileList, { maxPhotos = null, already = 0, onProgress, signal } = {}) {
  const exifr = await loadExifr();
  const all = Array.from(fileList || []).map((x) => (x && x.file ? { file: x.file, path: filePath(x.file, x.path) } : { file: x, path: filePath(x) }));
  const skipped = { type: 0, size: 0, limit: 0 };
  const queue = [];
  const sidecarEntries = [];
  for (const entry of all) {
    if (isSidecarName(entry.file?.name)) {
      if ((entry.file.size || 0) <= SIDECAR_MAX_BYTES) sidecarEntries.push(entry);
      continue; // Sidecars (and other JSON) are never counted as skipped photos.
    }
    const kind = classifyPhotoFile(entry.file);
    if (kind !== 'ok') {
      skipped[kind] += 1;
      continue;
    }
    if (maxPhotos != null && already + queue.length >= maxPhotos) {
      skipped.limit += 1;
      continue;
    }
    queue.push(entry);
  }
  const sidecarFor = sidecarEntries.length ? matchTakeoutSidecars(queue, sidecarEntries) : new Map();
  const sidecarByPath = new Map(sidecarEntries.map((e) => [e.path, e.file]));
  let sidecarsUsed = 0;

  const metas = new Array(queue.length);
  const files = new Map();
  let done = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      if (signal?.aborted) return;
      const i = cursor;
      cursor += 1;
      const { file, path } = queue[i];
      let tags = null;
      try {
        tags = await exifr.parse(file, EXIF_PARSE_OPTIONS);
      } catch {
        tags = null;
      }
      let sidecar = null;
      const scPath = sidecarFor.get(path);
      if (scPath) {
        try {
          sidecar = parseTakeoutSidecar(JSON.parse(await sidecarByPath.get(scPath).text()));
        } catch {
          sidecar = null;
        }
      }
      const hadExifTime = Boolean(tags && (tags.DateTimeOriginal || tags.CreateDate || tags.DateTimeDigitized));
      const merged = mergeSidecarIntoTags(tags, sidecar);
      if (sidecar) sidecarsUsed += 1;
      const id = nextId();
      metas[i] = buildPhotoMeta({
        id,
        name: file.name,
        size: file.size,
        type: file.type,
        tags: merged,
        timeSource: sidecar && !hadExifTime && sidecar.utcMs ? 'takeout' : null,
        people: sidecar?.people,
        description: sidecar?.description,
      });
      files.set(id, file);
      done += 1;
      if (onProgress && (done % 10 === 0 || done === queue.length)) onProgress(done, queue.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { metas: metas.filter(Boolean), files, skipped, sidecars: sidecarsUsed };
}

/**
 * Files from a drop that may contain folders (Takeout exports are folders of folders).
 * Returns [{file, path}] for every file inside, depth-first; plain file drops pass through.
 */
export async function filesFromDataTransfer(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []);
  const entries = items.map((it) => (typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null)).filter(Boolean);
  if (!entries.length) return Array.from(dataTransfer?.files || []).map((f) => ({ file: f, path: filePath(f) }));
  const out = [];
  const readAll = (reader) => new Promise((resolve) => {
    const acc = [];
    const next = () => reader.readEntries((batch) => {
      if (!batch.length) resolve(acc);
      else {
        acc.push(...batch);
        next();
      }
    }, () => resolve(acc));
    next();
  });
  const walk = async (entry) => {
    if (entry.isFile) {
      const file = await new Promise((resolve) => entry.file(resolve, () => resolve(null)));
      if (file) out.push({ file, path: entry.fullPath.replace(/^\//, '') });
    } else if (entry.isDirectory) {
      for (const child of await readAll(entry.createReader())) await walk(child);
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

// ---- Decoding ---------------------------------------------------------------------------------

async function decodeToBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // HEIC on most non-Apple browsers lands here.
    }
  }
  if (isHeicFile(file)) {
    const { heicTo } = await loadHeic();
    return heicTo({ blob: file, type: 'bitmap' });
  }
  // Last resort: <img> decoding (older browsers without createImageBitmap(File)).
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode-failed'));
      el.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawScaled(source, maxDim) {
  const w = source.width || source.naturalWidth;
  const h = source.height || source.naturalHeight;
  if (!w || !h) throw new Error('decode-failed');
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Decodes, downsizes and JPEG-encodes a photo as a data URL, lowering quality until it fits
 * `maxChars`. Throws 'decode-failed' when the browser can't read the photo.
 */
let webpSupport = null;
/** True when this browser's canvas really encodes WebP (Safari < 17 returns PNG instead). */
export function canEncodeWebp() {
  if (webpSupport !== null) return webpSupport;
  try {
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 2;
    webpSupport = c.toDataURL('image/webp', 0.8).startsWith('data:image/webp');
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

/**
 * Decodes, downsizes and encodes a photo as a data URL, lowering quality (then size) until it
 * fits `maxChars`. `format: 'auto'` uses WebP where the browser can encode it (about a third
 * smaller than JPEG at the same quality), else JPEG. Throws 'decode-failed' when unreadable.
 */
export async function encodePhoto(file, { maxDim = COVER_MAX_DIM, maxChars = COVER_MAX_CHARS, quality = 0.8, format = 'auto' } = {}) {
  // Remote photos are fetched already resized to (about) the size this step needs.
  const source = isRemoteSource(file) ? await file.load(maxDim) : file;
  const bitmap = await decodeToBitmap(source);
  const mime = format === 'auto' ? (canEncodeWebp() ? 'image/webp' : 'image/jpeg') : format;
  try {
    let dim = maxDim;
    let q = quality;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const canvas = drawScaled(bitmap, dim);
      const url = canvas.toDataURL(mime, q);
      if (url.length <= maxChars || attempt === 5) return url;
      if (q > 0.6) q -= 0.1; else dim = Math.round(dim * 0.8);
    }
    return null;
  } finally {
    bitmap.close?.();
  }
}

/**
 * Decodes (HEIC included), orients and re-encodes a photo as a Blob, at most `maxDim` px on its long
 * side. Canvas re-encoding drops EXIF/GPS metadata. Used for photographed book pages, which need far
 * more pixels than timeline photos so the AI can read small captions.
 */
export async function encodePhotoBlob(file, { maxDim = 3200, quality = 0.92, mime = 'image/jpeg' } = {}) {
  const bitmap = await decodeToBitmap(file);
  try {
    const canvas = drawScaled(bitmap, maxDim);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
    if (!blob) throw new Error('encode-failed');
    return blob;
  } finally {
    bitmap.close?.();
  }
}

/** A data URL -> Blob (for uploading encoded photos to storage). */
export async function dataUrlToBlob(url) {
  return (await fetch(url)).blob();
}

/** Raw base64 (no data: prefix) of a small JPEG for the AI. */
export async function encodeForAi(file, maxPx) {
  // JPEG: the server only accepts JPEG thumbnails for the AI.
  const url = await encodePhoto(file, { maxDim: maxPx, maxChars: maxPx > 500 ? 260_000 : 90_000, quality: 0.75, format: 'image/jpeg' });
  return url ? url.slice(url.indexOf(',') + 1) : null;
}

// ---- Thumbnails --------------------------------------------------------------------------------

/**
 * Lazily creates object-URL thumbnails, two at a time, cached per photo id. Uses the JPEG's
 * embedded EXIF thumbnail when there is one (instant), else decodes the photo.
 * Thumbnails from EXIF ignore the photo's orientation, so callers rotate them via CSS
 * (see orientationStyle).
 */
export function createThumbnailStore() {
  const cache = new Map(); // id -> { url, embedded } | Promise
  const failed = new Set();
  const waiting = [];
  let active = 0;
  const listeners = new Set();
  const notify = (id) => listeners.forEach((fn) => fn(id));

  const run = async () => {
    if (active >= 2 || !waiting.length) return;
    active += 1;
    const { id, file } = waiting.shift();
    try {
      let url = null;
      let embedded = false;
      if (!isHeicFile(file) && !isRemoteSource(file)) {
        try {
          const exifr = await loadExifr();
          const buf = await exifr.thumbnail(file);
          if (buf && buf.byteLength > 1000) {
            url = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
            embedded = true;
          }
        } catch {
          // no embedded thumbnail
        }
      }
      if (!url) {
        const dataUrl = await encodePhoto(file, { maxDim: THUMB_MAX_DIM, maxChars: 60_000, quality: 0.72 });
        const blob = await (await fetch(dataUrl)).blob();
        url = URL.createObjectURL(blob);
      }
      cache.set(id, { url, embedded });
    } catch {
      cache.delete(id);
      failed.add(id);
    } finally {
      active -= 1;
      notify(id);
      run();
    }
  };

  return {
    get(id) {
      const v = cache.get(id);
      return v && !(v instanceof Promise) ? v : null;
    },
    hasFailed: (id) => failed.has(id),
    request(id, file) {
      if (!file || cache.has(id) || failed.has(id)) return;
      cache.set(id, Promise.resolve());
      waiting.push({ id, file });
      run();
      run();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    clear() {
      for (const v of cache.values()) if (v && v.url) URL.revokeObjectURL(v.url);
      cache.clear();
      failed.clear();
      waiting.length = 0;
    },
  };
}

/** CSS transform that shows an EXIF-oriented embedded thumbnail upright. */
export function orientationStyle(orientation, embedded) {
  if (!embedded) return undefined;
  switch (orientation) {
    case 3: return { transform: 'rotate(180deg)' };
    case 6: return { transform: 'rotate(90deg)' };
    case 8: return { transform: 'rotate(270deg)' };
    default: return undefined;
  }
}

/** Runs async jobs with a concurrency limit, preserving order of results. */
export async function mapLimit(items, limit, fn, { signal } = {}) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const i = cursor;
      cursor += 1;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/**
 * 'ios' | 'android' | null - which phone's photo-sharing rules apply (they decide whether photo
 * locations survive a web upload). iPadOS reports itself as a Mac, hence the touch check.
 */
export function detectPhonePlatform(ua = (typeof navigator !== 'undefined' ? navigator.userAgent : ''), maxTouchPoints = (typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0)) {
  const s = String(ua || '');
  if (/android/i.test(s)) return 'android';
  if (/iphone|ipad|ipod/i.test(s) || (/macintosh/i.test(s) && Number(maxTouchPoints) > 1)) return 'ios';
  return null;
}

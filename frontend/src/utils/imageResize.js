/**
 * Client-side image downscaling before multipart upload.
 *
 * Resizes large camera/gallery photos (JPEG, PNG, WebP) on an offscreen `<canvas>`
 * so the longest side is at most `MAX_UPLOAD_IMAGE_DIMENSION` (1536 px) and encodes
 * as high-clarity JPEG (`0.86`). This cuts mobile upload latency, server RAM buffering,
 * and Gemini multimodal vision tile tokens while preserving OCR / document legibility.
 *
 * Non-image uploads (PDF, TXT, MD) and formats without universal Canvas decode/encode
 * guarantees (HEIC/HEIF) pass through untouched. Whenever an image is re-encoded as
 * `image/jpeg`, its filename extension is normalized to `.jpg` so strict backend
 * extension + magic-byte validation (`upload_security.py`) always matches.
 */

export const MAX_UPLOAD_IMAGE_DIMENSION = 1536;
export const UPLOAD_JPEG_QUALITY = 0.86;
export const UPLOAD_COMPRESS_MIN_BYTES = 900 * 1024; // 900 KB

const RESIZABLE_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const RESIZABLE_IMAGE_EXT_RE = /\.(jpe?g|png|webp)$/i;

/**
 * Normalizes a filename so its extension is `.jpg` (matching `image/jpeg` magic bytes).
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeJpegFileName(name) {
  const raw = String(name || '').trim() || 'image';
  const stripped = raw.replace(/\.[^./\\]+$/, '');
  return `${stripped || 'image'}.jpg`;
}

function loadImageFromUrl(ImgCtor, objectUrl) {
  return new Promise((resolve, reject) => {
    const img = new ImgCtor();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err || new Error('Image decode failed'));
    img.src = objectUrl;
  });
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob || null), mimeType, quality);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Downscales a single `File` if it is a JPEG/PNG/WebP image exceeding `maxDimension`
 * or `minBytesToCompress`. Safely returns the original `file` on non-images, SSR/Node
 * environments without DOM Canvas, or any decode error.
 *
 * @param {File} file
 * @param {object} [options]
 * @param {number} [options.maxDimension=MAX_UPLOAD_IMAGE_DIMENSION]
 * @param {number} [options.quality=UPLOAD_JPEG_QUALITY]
 * @param {number} [options.minBytesToCompress=UPLOAD_COMPRESS_MIN_BYTES]
 * @param {object|null} [options.env=null] Optional injected globals for unit tests
 * @returns {Promise<File>}
 */
export async function downscaleImageFile(file, options = {}) {
  if (!file || typeof file !== 'object') return file;

  const {
    maxDimension = MAX_UPLOAD_IMAGE_DIMENSION,
    quality = UPLOAD_JPEG_QUALITY,
    minBytesToCompress = UPLOAD_COMPRESS_MIN_BYTES,
    env = null,
  } = options;

  const mime = String(file.type || '').trim().toLowerCase();
  const fileName = String(file.name || 'image.jpg');
  const isResizable =
    RESIZABLE_IMAGE_MIMES.has(mime) || (!mime && RESIZABLE_IMAGE_EXT_RE.test(fileName));
  if (!isResizable) return file;

  const doc = env?.document ?? (typeof document !== 'undefined' ? document : null);
  const ImgCtor = env?.Image ?? (typeof Image !== 'undefined' ? Image : null);
  const urlApi = env?.URL ?? (typeof URL !== 'undefined' ? URL : null);
  const FileCtor = env?.File ?? (typeof File !== 'undefined' ? File : null);

  if (!doc?.createElement || !ImgCtor || !urlApi?.createObjectURL || !FileCtor) {
    return file;
  }

  let objectUrl = null;
  try {
    objectUrl = urlApi.createObjectURL(file);
    const img = await loadImageFromUrl(ImgCtor, objectUrl);
    const srcWidth = Number(img.naturalWidth || img.width || 0);
    const srcHeight = Number(img.naturalHeight || img.height || 0);
    if (!(srcWidth > 0 && srcHeight > 0)) {
      return file;
    }

    const needsDimensionScale = srcWidth > maxDimension || srcHeight > maxDimension;
    const needsByteCompression = Number(file.size || 0) > minBytesToCompress;
    if (!needsDimensionScale && !needsByteCompression) {
      return file;
    }

    let targetWidth = srcWidth;
    let targetHeight = srcHeight;
    if (needsDimensionScale) {
      if (srcWidth >= srcHeight) {
        targetWidth = maxDimension;
        targetHeight = Math.max(1, Math.round((srcHeight * maxDimension) / srcWidth));
      } else {
        targetHeight = maxDimension;
        targetWidth = Math.max(1, Math.round((srcWidth * maxDimension) / srcHeight));
      }
    }

    const canvas = doc.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    // Fill solid white first so transparent PNG/WebP backgrounds remain legible in JPEG
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    if (!blob || !(blob.size > 0)) {
      return file;
    }

    if (!needsDimensionScale && blob.size >= Number(file.size || 0)) {
      return file;
    }

    return new FileCtor([blob], normalizeJpegFileName(fileName), {
      type: 'image/jpeg',
      lastModified: file.lastModified || Date.now(),
    });
  } catch {
    return file;
  } finally {
    if (objectUrl && urlApi?.revokeObjectURL) {
      try {
        urlApi.revokeObjectURL(objectUrl);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Prepares an array / FileList of upload files sequentially (avoiding concurrent
 * multi-canvas memory spikes on mobile browsers).
 *
 * @param {Iterable<File>|ArrayLike<File>|null|undefined} files
 * @param {object} [options]
 * @returns {Promise<File[]>}
 */
export async function prepareUploadFiles(files, options = {}) {
  if (!files) return [];
  const list = Array.from(files);
  const prepared = [];
  for (const file of list) {
    prepared.push(await downscaleImageFile(file, options));
  }
  return prepared;
}

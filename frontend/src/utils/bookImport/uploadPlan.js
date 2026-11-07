/**
 * Book import uploads: which files are accepted, their order, and what is actually sent. PDFs, Word
 * files and text go as they are; photographed / scanned pages are decoded (HEIC too), oriented and
 * re-encoded as JPEG (at most 3200 px, metadata stripped) so the AI can still read small captions.
 */

export const BOOK_IMPORT_ACCEPT = [
  'application/pdf', '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx',
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif',
  'text/plain', 'text/markdown', '.txt', '.md', '.markdown',
].join(',');

export const PAGE_IMAGE_MAX_DIM = 3200;
export const PAGE_IMAGE_QUALITY = 0.92;

const EXT_KIND = {
  pdf: 'pdf', docx: 'docx', jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', heic: 'image', heif: 'image',
  txt: 'text', md: 'text', markdown: 'text',
};
const MIME_KIND = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/heic': 'image', 'image/heif': 'image',
  'text/plain': 'text', 'text/markdown': 'text',
};
const SEND_MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', text: 'text/plain' };

export function classifyBookFile(file) {
  const name = String(file?.name || '').toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  if (['docm', 'doc', 'exe', 'zip', 'js', 'html', 'htm', 'svg'].includes(ext)) return 'unsupported';
  return MIME_KIND[String(file?.type || '').toLowerCase()] || EXT_KIND[ext] || 'unsupported';
}

/** "page 2.jpg" before "page 10.jpg" (numbers compared as numbers). */
export function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/** Documents keep the order they were added in; page photos are sorted by name (camera order). */
export function sortBookFiles(files) {
  const docs = files.filter((f) => classifyBookFile(f) !== 'image');
  const pages = files.filter((f) => classifyBookFile(f) === 'image').sort((a, b) => naturalCompare(a.name, b.name));
  return [...docs, ...pages];
}

/** Validates a selection against the server's limits. Returns { accepted, rejected: [{file, reason}], error }. */
export function planBookFiles(files, limits = {}) {
  const maxFiles = limits.maxFiles || 600;
  const maxFileBytes = limits.maxFileBytes || 200 * 1024 * 1024;
  const maxTotalBytes = limits.maxTotalBytes || 600 * 1024 * 1024;
  const accepted = [];
  const rejected = [];
  for (const f of files) {
    const kind = classifyBookFile(f);
    if (kind === 'unsupported') rejected.push({ file: f, reason: 'type' });
    else if (!f.size) rejected.push({ file: f, reason: 'empty' });
    else if (kind !== 'image' && f.size > maxFileBytes) rejected.push({ file: f, reason: 'size' });
    else accepted.push(f);
  }
  let error = null;
  if (accepted.length > maxFiles) error = 'tooMany';
  // Page photos are re-encoded smaller before upload, so they don't count at full size.
  const total = accepted.reduce((s, f) => s + (classifyBookFile(f) === 'image' ? Math.min(f.size, 3 * 1024 * 1024) : f.size), 0);
  if (total > maxTotalBytes) error = 'tooLarge';
  return { accepted, rejected, error };
}

/**
 * The bytes to upload for one file: { blob, name, mime, size }. `encodeImage(file)` turns a page photo
 * into a JPEG Blob (injected so tests don't need a canvas).
 */
export async function prepareBookFile(file, { encodeImage } = {}) {
  const kind = classifyBookFile(file);
  if (kind === 'image') {
    const blob = await encodeImage(file, { maxDim: PAGE_IMAGE_MAX_DIM, quality: PAGE_IMAGE_QUALITY, mime: 'image/jpeg' });
    const base = String(file.name || 'page').replace(/\.[^.]+$/, '');
    return { blob, name: `${base}.jpg`, mime: 'image/jpeg', size: blob.size, kind };
  }
  const mime = SEND_MIME[kind] || file.type || 'application/octet-stream';
  return { blob: file, name: file.name, mime, size: file.size, kind };
}

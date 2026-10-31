/**
 * Client-side validation & classification helpers for file attachments on the
 * Home Screen PromptBar (and Timeline Chat). Mirrors the backend's tier-aware
 * limits in `backend/services/upload_security.py` so invalid or oversized files
 * are caught immediately with clear localized feedback before uploading bytes.
 */

export const PROMPT_FILE_ACCEPT = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  '.pdf',
  '.txt',
  '.md',
  '.markdown',
].join(',');

export const PROMPT_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
]);

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown']);

const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.dll', '.bat', '.cmd', '.com', '.scr', '.msi', '.ps1', '.vbs',
  '.sh', '.bash', '.zsh', '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx',
  '.html', '.htm', '.xhtml', '.svg', '.svgz', '.xml', '.php', '.py', '.rb',
  '.pl', '.jar', '.war', '.apk', '.ipa', '.dmg', '.iso', '.zip', '.rar',
  '.7z', '.tar', '.gz', '.bz2', '.xz', '.docm', '.xlsm', '.pptm', '.lnk',
  '.reg', '.inf', '.hta', '.wasm', '.elf', '.bin',
]);

export function getFileExtension(name = '') {
  const clean = String(name || '').trim().toLowerCase();
  const lastDot = clean.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === clean.length - 1) return '';
  return clean.slice(lastDot);
}

/**
 * Classifies a File/Blob-like object `{ name, type, size }`.
 * Handles OS/browser quirks where `.md` or `.heic` files report empty or generic MIME types.
 */
export function classifyAttachmentFile(file) {
  if (!file) {
    return { kind: 'unsupported', ext: '', badgeLabel: '' };
  }
  const name = String(file.name || '');
  const ext = getFileExtension(name);
  const mime = String(file.type || '').split(';')[0].trim().toLowerCase();

  if (ext && BLOCKED_EXTENSIONS.has(ext)) {
    return { kind: 'unsupported', ext, badgeLabel: '' };
  }

  // Reject extension/MIME cross-spoofing upfront (e.g., foo.pdf with image/png or foo.txt with application/pdf)
  if (ext === '.pdf') {
    if (!mime || mime === 'application/pdf' || mime === 'application/octet-stream') {
      return { kind: 'pdf', ext: '.pdf', badgeLabel: 'PDF' };
    }
    return { kind: 'unsupported', ext, badgeLabel: '' };
  }

  if (TEXT_EXTENSIONS.has(ext)) {
    if (!mime || TEXT_MIME_TYPES.has(mime) || mime === 'application/octet-stream') {
      return {
        kind: 'text',
        ext,
        badgeLabel: ext === '.txt' ? 'TXT' : 'MD',
      };
    }
    return { kind: 'unsupported', ext, badgeLabel: '' };
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    if (!mime || IMAGE_MIME_TYPES.has(mime) || mime === 'application/octet-stream') {
      return {
        kind: 'image',
        ext,
        badgeLabel: ext.slice(1).toUpperCase(),
      };
    }
    return { kind: 'unsupported', ext, badgeLabel: '' };
  }

  // Extensionless files (e.g., pasted clipboard screenshots or camera captures) or unrecognized extension
  if (ext && ext !== '') {
    return { kind: 'unsupported', ext, badgeLabel: '' };
  }

  if (IMAGE_MIME_TYPES.has(mime)) {
    return { kind: 'image', ext: '', badgeLabel: 'IMG' };
  }
  if (mime === 'application/pdf') {
    return { kind: 'pdf', ext: '.pdf', badgeLabel: 'PDF' };
  }
  if (TEXT_MIME_TYPES.has(mime)) {
    return { kind: 'text', ext: '.txt', badgeLabel: 'TXT' };
  }

  return { kind: 'unsupported', ext, badgeLabel: '' };
}

export function getPromptUploadLimits({ isGuest = false, hasCustomKey = false, isAdmin = false } = {}) {
  if (isAdmin || hasCustomKey) {
    return {
      maxFiles: 8,
      maxBinaryBytes: 10 * 1024 * 1024,
      maxTextBytes: 256 * 1024,
      maxTotalBytes: 30 * 1024 * 1024,
    };
  }
  if (isGuest) {
    return {
      maxFiles: 3,
      maxBinaryBytes: 5 * 1024 * 1024,
      maxTextBytes: 128 * 1024,
      maxTotalBytes: 10 * 1024 * 1024,
    };
  }
  return {
    maxFiles: 5,
    maxBinaryBytes: 8 * 1024 * 1024,
    maxTextBytes: 256 * 1024,
    maxTotalBytes: 24 * 1024 * 1024,
  };
}

export function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fileFingerprint(file) {
  return `${file.name || ''}:${file.size || 0}:${file.lastModified || 0}`;
}

/**
 * Validates incoming files against current attachments and tier limits.
 * Returns `{ accepted, firstError }` where `accepted` is an array of
 * `{ file, kind, badgeLabel }` and `firstError` is `{ reason, maxFiles, maxMb, maxKb } | null`.
 */
export function validateIncomingPromptFiles(existingItems = [], incomingFiles = [], limits = getPromptUploadLimits()) {
  const incoming = Array.from(incomingFiles || []);
  if (!incoming.length) {
    return { accepted: [], firstError: null };
  }

  const seenFingerprints = new Set(
    existingItems.map((item) => fileFingerprint(item.file || item))
  );
  let currentCount = existingItems.length;
  let currentBytes = existingItems.reduce((sum, item) => sum + ((item.file || item)?.size || 0), 0);

  const accepted = [];
  let firstError = null;
  const recordError = (reason, extra = {}) => {
    if (!firstError) {
      firstError = {
        reason,
        maxFiles: limits.maxFiles,
        maxMb: Math.round(limits.maxBinaryBytes / (1024 * 1024)),
        maxTotalMb: Math.round(limits.maxTotalBytes / (1024 * 1024)),
        maxTextKb: Math.round(limits.maxTextBytes / 1024),
        ...extra,
      };
    }
  };

  for (const file of incoming) {
    const info = classifyAttachmentFile(file);
    if (info.kind === 'unsupported') {
      recordError('unsupported');
      continue;
    }

    const size = Number(file.size) || 0;
    if (size <= 0) {
      recordError('empty');
      continue;
    }

    const fp = fileFingerprint(file);
    if (seenFingerprints.has(fp)) {
      // Silently skip exact duplicate already attached in the strip
      continue;
    }

    const maxPerFile = info.kind === 'text' ? limits.maxTextBytes : limits.maxBinaryBytes;
    if (size > maxPerFile) {
      recordError(info.kind === 'text' ? 'text_too_large' : 'too_large');
      continue;
    }

    if (currentCount >= limits.maxFiles) {
      recordError('max_files');
      continue;
    }

    if (currentBytes + size > limits.maxTotalBytes) {
      recordError('total_size');
      continue;
    }

    seenFingerprints.add(fp);
    currentCount += 1;
    currentBytes += size;
    accepted.push({
      file,
      kind: info.kind,
      badgeLabel: info.badgeLabel,
    });
  }

  return { accepted, firstError };
}

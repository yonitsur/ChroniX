import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyAttachmentFile,
  formatFileSize,
  getPromptUploadLimits,
  validateIncomingPromptFiles,
} from '../src/utils/fileUploadValidation.js';

test('classifyAttachmentFile recognizes images, PDFs, and TXT/MD even when OS omits MIME', () => {
  assert.deepEqual(
    classifyAttachmentFile({ name: 'lecture.pdf', type: 'application/pdf' }),
    { kind: 'pdf', ext: '.pdf', badgeLabel: 'PDF' }
  );
  // Windows browsers often omit type for .md files
  assert.deepEqual(
    classifyAttachmentFile({ name: 'notes.md', type: '' }),
    { kind: 'text', ext: '.md', badgeLabel: 'MD' }
  );
  // Desktop browsers sometimes report application/octet-stream for iPhone .heic photos
  assert.deepEqual(
    classifyAttachmentFile({ name: 'IMG_1024.HEIC', type: 'application/octet-stream' }),
    { kind: 'image', ext: '.heic', badgeLabel: 'HEIC' }
  );
  // Extensionless clipboard image paste
  assert.deepEqual(
    classifyAttachmentFile({ name: '', type: 'image/png' }),
    { kind: 'image', ext: '', badgeLabel: 'IMG' }
  );
});

test('classifyAttachmentFile rejects dangerous extensions and cross-MIME spoofing', () => {
  for (const name of ['malware.exe', 'xss.svg', 'page.html', 'archive.zip', 'script.js']) {
    assert.equal(classifyAttachmentFile({ name, type: 'application/pdf' }).kind, 'unsupported');
  }
  // Spoofed extension vs MIME (e.g. .pdf claiming image/png)
  assert.equal(
    classifyAttachmentFile({ name: 'fake.pdf', type: 'image/png' }).kind,
    'unsupported'
  );
});

test('validateIncomingPromptFiles enforces empty-file, per-file, total-size, max-files, and dedup rules', () => {
  const guestLimits = getPromptUploadLimits({ isGuest: true, hasCustomKey: false });
  assert.equal(guestLimits.maxFiles, 3);
  assert.equal(guestLimits.maxBinaryBytes, 5 * 1024 * 1024);

  // Empty 0-byte file rejected
  const emptyRes = validateIncomingPromptFiles(
    [],
    [{ name: 'empty.pdf', type: 'application/pdf', size: 0, lastModified: 1 }],
    guestLimits
  );
  assert.equal(emptyRes.accepted.length, 0);
  assert.equal(emptyRes.firstError?.reason, 'empty');

  // Oversized text file (>128 KB for guest) rejected with text_too_large
  const bigTxtRes = validateIncomingPromptFiles(
    [],
    [{ name: 'huge.txt', type: 'text/plain', size: 200 * 1024, lastModified: 2 }],
    guestLimits
  );
  assert.equal(bigTxtRes.accepted.length, 0);
  assert.equal(bigTxtRes.firstError?.reason, 'text_too_large');

  // Deduplicates identical files and caps at maxFiles
  const validPdf = { name: 'a.pdf', type: 'application/pdf', size: 1024 * 1024, lastModified: 10 };
  const batchRes = validateIncomingPromptFiles(
    [],
    [
      validPdf,
      { ...validPdf }, // duplicate -> silently skipped
      { name: 'b.png', type: 'image/png', size: 500 * 1024, lastModified: 11 },
      { name: 'c.md', type: '', size: 4 * 1024, lastModified: 12 },
      { name: 'd.jpg', type: 'image/jpeg', size: 500 * 1024, lastModified: 13 }, // 4th unique -> exceeds guest maxFiles=3
    ],
    guestLimits
  );
  assert.equal(batchRes.accepted.length, 3);
  assert.equal(batchRes.firstError?.reason, 'max_files');
});

test('formatFileSize formats bytes, KB, and MB cleanly', () => {
  assert.equal(formatFileSize(512), '512 B');
  assert.equal(formatFileSize(14 * 1024), '14 KB');
  assert.equal(formatFileSize(2.5 * 1024 * 1024), '2.5 MB');
});

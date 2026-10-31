import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_UPLOAD_IMAGE_DIMENSION,
  UPLOAD_COMPRESS_MIN_BYTES,
  normalizeJpegFileName,
  downscaleImageFile,
  prepareUploadFiles,
} from '../src/utils/imageResize.js';

function createMockCanvasEnv({ width = 4000, height = 3000, blobBytes = 120_000, shouldFailDecode = false } = {}) {
  const drawCalls = [];
  let createdUrls = 0;
  let revokedUrls = 0;

  class MockImage {
    set src(_val) {
      queueMicrotask(() => {
        if (shouldFailDecode) {
          this.onerror?.(new Error('corrupt image'));
        } else {
          this.naturalWidth = width;
          this.naturalHeight = height;
          this.onload?.();
        }
      });
    }
  }

  class MockFile {
    constructor(parts, name, opts = {}) {
      this.name = name;
      this.type = opts.type || '';
      this.lastModified = opts.lastModified || 0;
      this.size = parts.reduce((sum, p) => sum + (p?.size ?? p?.byteLength ?? p?.length ?? 0), 0);
    }
  }

  const document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = {
        width: 0,
        height: 0,
        getContext(type) {
          assert.equal(type, '2d');
          return {
            fillStyle: '',
            imageSmoothingEnabled: false,
            imageSmoothingQuality: 'low',
            fillRect(x, y, w, h) {
              drawCalls.push({ op: 'fillRect', fillStyle: this.fillStyle, x, y, w, h });
            },
            drawImage(_img, x, y, w, h) {
              drawCalls.push({ op: 'drawImage', x, y, w, h });
            },
          };
        },
        toBlob(cb, mimeType, quality) {
          drawCalls.push({ op: 'toBlob', mimeType, quality, canvasWidth: canvas.width, canvasHeight: canvas.height });
          cb({ size: blobBytes, type: mimeType });
        },
      };
      return canvas;
    },
  };

  const URL = {
    createObjectURL() {
      createdUrls += 1;
      return `blob:mock-${createdUrls}`;
    },
    revokeObjectURL() {
      revokedUrls += 1;
    },
  };

  return {
    env: { document, Image: MockImage, URL, File: MockFile },
    drawCalls,
    getUrlStats: () => ({ createdUrls, revokedUrls }),
  };
}

describe('imageResize utilities', () => {
  it('normalizes image extensions to .jpg so backend magic-byte validation always matches', () => {
    assert.equal(normalizeJpegFileName('scan.PNG'), 'scan.jpg');
    assert.equal(normalizeJpegFileName('diagram.webp'), 'diagram.jpg');
    assert.equal(normalizeJpegFileName('photo.jpeg'), 'photo.jpg');
    assert.equal(normalizeJpegFileName('camera.jpg'), 'camera.jpg');
    assert.equal(normalizeJpegFileName('untitled'), 'untitled.jpg');
  });

  it('passes non-resizable files (PDF, TXT, MD, HEIC) through untouched without touching DOM', async () => {
    const pdf = { name: 'doc.pdf', type: 'application/pdf', size: 3_000_000 };
    const txt = { name: 'notes.txt', type: 'text/plain', size: 20_000 };
    const heic = { name: 'iphone.heic', type: 'image/heic', size: 4_000_000 };

    const { env, getUrlStats } = createMockCanvasEnv();
    assert.equal(await downscaleImageFile(pdf, { env }), pdf);
    assert.equal(await downscaleImageFile(txt, { env }), txt);
    assert.equal(await downscaleImageFile(heic, { env }), heic);
    assert.deepEqual(getUrlStats(), { createdUrls: 0, revokedUrls: 0 });
  });

  it('safely returns original file in Node/SSR when DOM Canvas globals are absent', async () => {
    const photo = { name: 'big.png', type: 'image/png', size: 5_000_000 };
    const result = await downscaleImageFile(photo, { env: {} });
    assert.equal(result, photo);
  });

  it('skips Canvas re-encoding when image is already <= 1536px and <= 900 KB', async () => {
    const smallPhoto = { name: 'small.png', type: 'image/png', size: 300_000 };
    const { env, drawCalls, getUrlStats } = createMockCanvasEnv({ width: 1200, height: 900 });

    const out = await downscaleImageFile(smallPhoto, { env });
    assert.equal(out, smallPhoto);
    assert.equal(drawCalls.length, 0);
    assert.deepEqual(getUrlStats(), { createdUrls: 1, revokedUrls: 1 });
  });

  it('downscales oversized 4000x3000 PNG to 1536x1152 JPEG with white fill and .jpg extension', async () => {
    assert.equal(MAX_UPLOAD_IMAGE_DIMENSION, 1536);
    assert.equal(UPLOAD_COMPRESS_MIN_BYTES, 900 * 1024);

    const hugePng = { name: 'page-scan.PNG', type: 'image/png', size: 4_800_000, lastModified: 12345 };
    const { env, drawCalls, getUrlStats } = createMockCanvasEnv({
      width: 4000,
      height: 3000,
      blobBytes: 210_000,
    });

    const out = await downscaleImageFile(hugePng, { env });
    assert.notEqual(out, hugePng);
    assert.equal(out.name, 'page-scan.jpg');
    assert.equal(out.type, 'image/jpeg');
    assert.equal(out.size, 210_000);
    assert.equal(out.lastModified, 12345);
    assert.deepEqual(getUrlStats(), { createdUrls: 1, revokedUrls: 1 });

    const fillOp = drawCalls.find((c) => c.op === 'fillRect');
    assert.deepEqual(fillOp, { op: 'fillRect', fillStyle: '#ffffff', x: 0, y: 0, w: 1536, h: 1152 });

    const blobOp = drawCalls.find((c) => c.op === 'toBlob');
    assert.equal(blobOp.mimeType, 'image/jpeg');
    assert.equal(blobOp.canvasWidth, 1536);
    assert.equal(blobOp.canvasHeight, 1152);
  });

  it('falls back to original file and revokes object URL when image decode fails', async () => {
    const broken = { name: 'corrupt.jpg', type: 'image/jpeg', size: 2_000_000 };
    const { env, getUrlStats } = createMockCanvasEnv({ shouldFailDecode: true });

    const out = await downscaleImageFile(broken, { env });
    assert.equal(out, broken);
    assert.deepEqual(getUrlStats(), { createdUrls: 1, revokedUrls: 1 });
  });

  it('prepareUploadFiles processes mixed batches sequentially in order', async () => {
    const { env } = createMockCanvasEnv({ width: 3000, height: 1500, blobBytes: 150_000 });
    const files = [
      { name: 'photo1.webp', type: 'image/webp', size: 2_500_000 },
      { name: 'chapter.pdf', type: 'application/pdf', size: 1_200_000 },
    ];
    const prepared = await prepareUploadFiles(files, { env });
    assert.equal(prepared.length, 2);
    assert.equal(prepared[0].name, 'photo1.jpg');
    assert.equal(prepared[0].type, 'image/jpeg');
    assert.equal(prepared[1], files[1]);
  });
});

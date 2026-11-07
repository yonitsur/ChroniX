import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  decodeDataUrlToBlob,
  disposeHistropediaTimeline,
  isDataSvgUrl,
  isDataUrl,
  isUsableCanvasImage,
  scrubDetachedEntryFromArticles,
} from '../src/utils/canvasImageUtils.js';
import {
  CHUNK_RELOAD_COOLDOWN_MS,
  CHUNK_RELOAD_STORAGE_KEY,
  installVitePreloadErrorHandler,
  isDynamicImportError,
  resetChunkReloadGuardForTests,
  tryRecoverFromChunkError,
} from '../src/utils/chunkLoadRecovery.js';
import { getWikiLang, toEmbeddableWikiUrl } from '../src/utils/wikiEmbedUrl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, '..');

test('vercel.json allows data:/blob: in connect-src, allows embedded frames in frame-src, and excludes /assets/ from SPA HTML rewrite', () => {
  const vercelConfig = JSON.parse(
    fs.readFileSync(path.join(FRONTEND_DIR, 'vercel.json'), 'utf8')
  );

  const cspHeader = vercelConfig.headers
    ?.flatMap((h) => h.headers || [])
    ?.find((h) => h.key === 'Content-Security-Policy');
  assert.ok(cspHeader, 'Expected Content-Security-Policy header in vercel.json');

  const directives = cspHeader.value.split(';').map((part) => part.trim());
  const connectSrcDirective = directives.find((part) => part.startsWith('connect-src '));
  assert.ok(connectSrcDirective, 'Expected connect-src directive in CSP');
  assert.ok(connectSrcDirective.includes('data:'), 'connect-src must allow data: URLs');
  assert.ok(connectSrcDirective.includes('blob:'), 'connect-src must allow blob: URLs');

  const frameSrcDirective = directives.find((part) => part.startsWith('frame-src '));
  assert.ok(frameSrcDirective, 'Expected explicit frame-src directive in CSP (otherwise default-src blocks iframes)');
  for (const requiredOrigin of [
    'https://*.wikipedia.org',
    'https://*.wikimedia.org',
    'https://www.youtube-nocookie.com',
    'https://www.youtube.com',
    'https://accounts.google.com',
  ]) {
    assert.ok(
      frameSrcDirective.includes(requiredOrigin),
      `frame-src must allow ${requiredOrigin}`
    );
  }

  const spaRewrite = (vercelConfig.rewrites || []).find((r) => r.destination === '/index.html');
  assert.ok(spaRewrite, 'Expected SPA fallback rewrite to /index.html');
  assert.equal(spaRewrite.source, '/((?!api/|assets/).*)');
});

test('toEmbeddableWikiUrl normalizes Wikipedia URLs onto *.wikipedia.org with useformat=mobile and theme param', () => {
  assert.equal(
    toEmbeddableWikiUrl('https://he.wikipedia.org/wiki/Apollo_11', { isDark: false }),
    'https://he.wikipedia.org/wiki/Apollo_11?useformat=mobile&minervanightmode=0'
  );
  assert.equal(
    toEmbeddableWikiUrl('http://HE.m.wikipedia.org/wiki/Apollo_11', { isDark: true }),
    'https://he.wikipedia.org/wiki/Apollo_11?useformat=mobile&minervanightmode=1'
  );
  assert.equal(getWikiLang('https://he.m.wikipedia.org/wiki/Apollo_11'), 'he');
  assert.equal(getWikiLang('https://zh-yue.wikipedia.org/wiki/Test'), 'zh-yue');
  assert.equal(toEmbeddableWikiUrl('https://example.com/wiki/Apollo_11'), null);
  assert.equal(toEmbeddableWikiUrl('https://he.wikipedia.org/w/index.php?title=Apollo_11'), null);
  assert.equal(toEmbeddableWikiUrl('javascript:alert(1)'), null);
});

test('decodeDataUrlToBlob decodes base64 and percent-encoded data URLs without fetch()', async () => {
  const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const b64 = Buffer.from(pngBytes).toString('base64');
  const dataUrl = `data:image/png;base64,${b64}`;

  assert.equal(isDataUrl(dataUrl), true);
  assert.equal(isDataSvgUrl(dataUrl), false);
  assert.equal(isDataUrl('https://upload.wikimedia.org/test.jpg'), false);

  const blob = decodeDataUrlToBlob(dataUrl);
  assert.equal(blob.type, 'image/png');
  assert.equal(blob.size, pngBytes.byteLength);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), pngBytes);

  const svgText = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';
  const svgDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgText)}`;
  assert.equal(isDataUrl(svgDataUrl), true);
  assert.equal(isDataSvgUrl(svgDataUrl), true);

  const svgBlob = decodeDataUrlToBlob(svgDataUrl);
  assert.equal(svgBlob.type, 'image/svg+xml');
  assert.equal(await svgBlob.text(), svgText);
});

test('isUsableCanvasImage rejects detached 0x0 ImageBitmaps and broken HTMLImageElements', () => {
  assert.equal(isUsableCanvasImage(null), false);
  assert.equal(isUsableCanvasImage(undefined), false);
  // Detached ImageBitmap after bitmap.close() reports width=0, height=0
  assert.equal(isUsableCanvasImage({ width: 0, height: 0 }), false);
  // Valid live ImageBitmap or HTMLCanvasElement
  assert.equal(isUsableCanvasImage({ width: 108, height: 108 }), true);
  // Incomplete or broken HTMLImageElement
  assert.equal(isUsableCanvasImage({ complete: false, naturalWidth: 200, naturalHeight: 150, width: 200, height: 150 }), false);
  assert.equal(isUsableCanvasImage({ complete: true, naturalWidth: 0, naturalHeight: 0, width: 100, height: 100 }), false);
  assert.equal(isUsableCanvasImage({ complete: true, naturalWidth: 320, naturalHeight: 240, width: 100, height: 100 }), true);
});

test('disposeHistropediaTimeline destroys PointerTracker, scrubs detached bitmaps, and avoids synchronous redraws', () => {
  let pointerTrackerDestroyed = 0;
  let animationsStopped = 0;
  let bitmapClosed = 0;
  const releaseArgs = [];

  const bitmap = {
    width: 108,
    height: 108,
    close() {
      bitmapClosed += 1;
      this.width = 0;
      this.height = 0;
    },
  };

  // Simulate an article where _releaseImageResource failed to clear art.image (e.g. keepState: true)
  const art = {
    id: 'evt-1',
    image: bitmap,
    imageLoaded: true,
    _loadedImageKey: 'img:key-1',
    _pendingImageKey: 'img:key-2',
    _imageCancel() {},
    _releaseImageResource(opts) {
      releaseArgs.push(opts);
      // Intentionally leave this.image attached to verify disposeHistropediaTimeline scrubs it
    },
    invalidateCaches() {},
  };

  const cacheEntry = {
    image: bitmap,
    articles: new Set([art]),
    close() {
      bitmap.close();
    },
  };

  const cache = new Map([['img:key-1', cacheEntry]]);
  const tl = {
    articles: [art],
    _dragPointerTracker: {
      destroy() {
        pointerTrackerDestroyed += 1;
      },
    },
    stopAnimation() { animationsStopped += 1; },
    stopPanAnimation() { animationsStopped += 1; },
    stopZoomAnimation() { animationsStopped += 1; },
    imageLoader: {
      queue: [{ cancelled: false }],
      inflight: new Map(),
      cache,
      _evictEntry(key, entry) {
        scrubDetachedEntryFromArticles(key, entry);
        cache.delete(key);
        entry.close();
      },
    },
  };

  disposeHistropediaTimeline(tl);

  assert.equal(tl._chronixDisposed, true);
  assert.equal(tl._chronixDeferImageEnqueue, true);
  assert.equal(pointerTrackerDestroyed, 1);
  assert.equal(tl._dragPointerTracker, null);
  assert.equal(animationsStopped, 3);
  assert.deepEqual(releaseArgs, [{ keepState: false, skipRedraw: true }]);
  assert.equal(bitmapClosed, 1);
  assert.equal(bitmap.width, 0);
  assert.equal(art.image, null);
  assert.equal(art.imageLoaded, false);
  assert.equal(art._loadedImageKey, null);
  assert.equal(art._pendingImageKey, null);
});

test('chunkLoadRecovery detects dynamic import failures and enforces single-reload cooldown guard', () => {
  resetChunkReloadGuardForTests();

  const geoErr = new TypeError(
    'Failed to fetch dynamically imported module: https://chronix-ai.com/assets/GeoMapView-obcvtuNW.js'
  );
  const safariErr = new TypeError('Importing a module script failed.');
  const mimeErr = new Error(
    'Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".'
  );
  const regularErr = new Error('Cannot read properties of undefined');

  assert.equal(isDynamicImportError(geoErr), true);
  assert.equal(isDynamicImportError(safariErr), true);
  assert.equal(isDynamicImportError(mimeErr), true);
  assert.equal(isDynamicImportError(regularErr), false);

  const store = new Map();
  const fakeStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  let reloadCount = 0;
  const reload = () => { reloadCount += 1; };

  // Non-chunk error never reloads
  assert.equal(tryRecoverFromChunkError(regularErr, { storage: fakeStorage, reload, now: 100_000 }), false);
  assert.equal(reloadCount, 0);

  // First stale-chunk failure triggers reload and records timestamp
  assert.equal(tryRecoverFromChunkError(geoErr, { storage: fakeStorage, reload, now: 100_000 }), true);
  assert.equal(reloadCount, 1);
  assert.equal(store.get(CHUNK_RELOAD_STORAGE_KEY), '100000');

  // Repeated failure inside cooldown window does NOT loop
  assert.equal(tryRecoverFromChunkError(geoErr, { storage: fakeStorage, reload, now: 100_000 + 2_000 }), false);
  assert.equal(reloadCount, 1);

  // After cooldown expires (e.g. a later deployment), recovery is permitted again
  assert.equal(
    tryRecoverFromChunkError(geoErr, {
      storage: fakeStorage,
      reload,
      now: 100_000 + CHUNK_RELOAD_COOLDOWN_MS + 1,
    }),
    true
  );
  assert.equal(reloadCount, 2);

  // vite:preloadError listener prevents default when triggering guarded reload
  resetChunkReloadGuardForTests();
  store.clear();
  const listeners = new Map();
  const fakeWindow = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  const uninstall = installVitePreloadErrorHandler(fakeWindow, {
    storage: fakeStorage,
    reload,
    now: 200_000,
  });
  let prevented = false;
  listeners.get('vite:preloadError')({
    payload: geoErr,
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.equal(reloadCount, 3);
  uninstall();
});

test('TimelineView.jsx wires data URL decoding, detached-bitmap guards, and disposal safeguards', () => {
  const timelineViewSource = fs.readFileSync(
    path.join(FRONTEND_DIR, 'src', 'components', 'TimelineView.jsx'),
    'utf8'
  );
  assert.ok(timelineViewSource.includes('isDataUrl(url)'));
  assert.ok(timelineViewSource.includes('decodeDataUrlToBlob(url)'));
  assert.ok(timelineViewSource.includes('isUsableCanvasImage(this.image)'));
  assert.ok(timelineViewSource.includes('disposeHistropediaTimeline(tl)'));
  assert.ok(timelineViewSource.includes('if (this._chronixDisposed) return;'));
});

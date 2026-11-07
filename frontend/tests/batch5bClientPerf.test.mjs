// Batch 5B (P-07, P-09, P-10, P-14): compress-once inline images, minimal save responses, debounced
// Videos-tab saves, header-less shared-link reads, photo upload concurrency, link-preview meta.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  INLINE_IMAGE_MAX_CHARS,
  compressTimelineInlineImages,
  fitEncodedImageToBudget,
  isCompactJpegOrWebp,
  needsSaveTimeCompression,
  sniffDataUrlImage,
} from '../src/utils/inlineImageBudget.js';
import { createTimelineSaveQueue, mergeMinimalSaveResponse, MINIMAL_SAVE_QUERY } from '../src/utils/saveQueue.js';
import { createDebouncedTimelineSaver, videosChanged } from '../src/utils/videoPersistence.js';
import { createPublicFirstFetcher } from '../src/utils/publicFirstFetch.js';
import { HOSTED_PHOTO_UPLOAD_CONCURRENCY } from '../src/utils/photoImport/importModel.js';
import { stripTimelineForChatOrRefine } from '../src/utils/timelinePayload.js';
import { createShareHandler } from '../api/share.js';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel) => fs.readFileSync(path.join(srcDir, rel), 'utf8');

// A minimal JPEG header (SOI, APP0, SOF0 with the given size), padded to `totalChars`.
function jpegDataUrl(width, height, totalChars = 1000) {
  const head = [
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x03,
  ];
  const b64 = Buffer.from(head).toString('base64');
  const prefix = 'data:image/jpeg;base64,';
  const padLen = Math.max(0, totalChars - prefix.length - b64.length);
  return prefix + b64 + 'A'.repeat(padLen - (padLen % 4));
}

// ---- P-10: compress once, never re-encode compact images ----------------------------------------

test('sniffs JPEG dimensions from the header bytes only', () => {
  assert.deepEqual(sniffDataUrlImage(jpegDataUrl(800, 600)), { mime: 'image/jpeg', width: 800, height: 600 });
  assert.equal(sniffDataUrlImage('data:image/png;base64,iVBORw0KGgo='), null);
  assert.equal(sniffDataUrlImage('https://example.com/a.jpg'), null);
});

test('a compact JPEG is never re-encoded on save; oversized or PNG ones are', () => {
  const compact = jpegDataUrl(900, 700, 150000);
  assert.ok(compact.length > INLINE_IMAGE_MAX_CHARS);
  assert.equal(isCompactJpegOrWebp(compact), true);
  assert.equal(needsSaveTimeCompression(compact), false);
  assert.equal(needsSaveTimeCompression(jpegDataUrl(2000, 1500, 150000)), true);
  assert.equal(needsSaveTimeCompression('data:image/png;base64,' + 'A'.repeat(90000)), true);
  assert.equal(needsSaveTimeCompression('data:image/gif;base64,' + 'A'.repeat(90000)), false);
  assert.equal(needsSaveTimeCompression(jpegDataUrl(900, 700, 300000)), true); // above the skip cap
});

test('save-time pass leaves compact images and already-small timelines untouched', async () => {
  const compact = jpegDataUrl(900, 700, 150000);
  const png = 'data:image/png;base64,' + 'A'.repeat(90000);
  const calls = [];
  const compress = async (url) => { calls.push(url.slice(11, 15)); return 'data:image/jpeg;base64,small'; };
  const tl = { id: 't', articles: [{ id: 'a', imageUrl: compact }, { id: 'b', imageUrl: 'https://x/y.jpg' }] };
  assert.equal(await compressTimelineInlineImages(tl, compress), tl);
  assert.deepEqual(calls, []);
  const withPng = { ...tl, articles: [...tl.articles, { id: 'c', imageUrl: png, additionalImages: [{ url: png }, compact] }] };
  const out = await compressTimelineInlineImages(withPng, compress);
  assert.equal(out.articles[0], withPng.articles[0]);
  assert.equal(out.articles[2].imageUrl, 'data:image/jpeg;base64,small');
  assert.equal(out.articles[2].additionalImages[0].url, 'data:image/jpeg;base64,small');
  assert.equal(out.articles[2].additionalImages[1], compact);
  assert.equal(calls.length, 2);
});

test('the budget ladder lowers quality, then size, until the image fits', async () => {
  const steps = [];
  const encode = async ({ scale, quality }) => {
    steps.push([scale, quality]);
    return 'x'.repeat(Math.round(200000 * scale * scale * quality));
  };
  const out = await fitEncodedImageToBudget(encode, { maxChars: 80000 });
  assert.ok(out.length <= 80000);
  assert.deepEqual(steps[0], [1, 0.82]);
  assert.ok(steps.length > 1 && steps.length <= 7);
  assert.equal(await fitEncodedImageToBudget(async () => 'y'.repeat(100), { maxChars: 50 }), 'y'.repeat(100));
});

test('uploads and AI images are compressed once and that URL is what the app stores', () => {
  const editor = read('components/eventEditor/eventEditorUtils.js');
  assert.match(editor, /encodeImageToBudget\(img, \{ maxDim, maxChars: INLINE_IMAGE_MAX_CHARS, mime, quality \}\)/);
  const api = read('api.js');
  const gen = api.slice(api.indexOf('export async function generateEventImage'), api.indexOf('export async function searchWikiCandidates'));
  assert.match(gen, /data\.imageUrl = await compressDataUrlToBudget\(data\.imageUrl\)/);
  assert.match(api, /compressDataUrlToBudget\(url, \{ skipCompact: true \}\)/);
});

// ---- P-09: minimal save responses ------------------------------------------------------------------

test('a minimal save response is merged into what was sent', () => {
  const sent = { id: 't', title: 'T', articles: [{ id: 'a' }] };
  const merged = mergeMinimalSaveResponse(sent, { id: 't', updatedAt: 'v2', createdAt: 'v1', isLibrary: false, minimal: true });
  assert.deepEqual(merged, { ...sent, updatedAt: 'v2', createdAt: 'v1', isLibrary: false });
  const full = { id: 't', title: 'Server', updatedAt: 'v3' };
  assert.equal(mergeMinimalSaveResponse(sent, full), full); // an older backend's full echo is used as is
});

test('the save queue gets its new version from a minimal response', async () => {
  const sentBases = [];
  const send = async (tl, { baseUpdatedAt }) => {
    sentBases.push(baseUpdatedAt);
    return mergeMinimalSaveResponse(tl, { id: tl.id, updatedAt: `v${sentBases.length + 1}`, minimal: true });
  };
  const queue = createTimelineSaveQueue({ send, fetchLatest: async () => null, merge: (b, l) => l });
  queue.noteServerState({ id: 't', updatedAt: 'v1' });
  const first = await queue.enqueue({ id: 't', title: 'A', updatedAt: 'v1' });
  assert.equal(first.updatedAt, 'v2');
  assert.equal(first.title, 'A');
  await queue.enqueue({ ...first, title: 'B' });
  assert.deepEqual(sentBases, ['v1', 'v2']);
  assert.match(read('api.js'), /`\$\{API_BASE\}\/timelines\?\$\{MINIMAL_SAVE_QUERY\}`/);
  assert.equal(MINIMAL_SAVE_QUERY, 'return=minimal');
});

test('refine / chat payloads strip only inline images, not hosted URLs', () => {
  const tl = {
    id: 't',
    articles: [
      { id: 'a', imageUrl: 'https://upload.wikimedia.org/x.jpg', videos: [{ videoId: 'v' }] },
      { id: 'b', imageUrl: 'data:image/jpeg;base64,AAAA', additionalImages: ['https://x/1.jpg'] },
    ],
  };
  const { timeline, mediaStripped } = stripTimelineForChatOrRefine(tl);
  assert.equal(mediaStripped, true);
  assert.equal(timeline.articles[0], tl.articles[0]);
  assert.deepEqual(timeline.articles[1]._strippedMediaFields, ['imageUrl']);
  assert.deepEqual(timeline.articles[1].additionalImages, ['https://x/1.jpg']);
});

// ---- P-10: Videos tab saves --------------------------------------------------------------------------

test('videos are stored only when the list differs from the stored one', () => {
  const art = { id: 'a', videosQuery: 'moon', videos: [{ videoId: '1' }, { videoId: '2' }] };
  assert.equal(videosChanged(art, 'moon', [{ videoId: '1' }, { videoId: '2' }]), false);
  assert.equal(videosChanged(art, 'moon', [{ videoId: '2' }, { videoId: '1' }]), true);
  assert.equal(videosChanged(art, 'mars', art.videos), true);
  assert.equal(videosChanged({ id: 'b' }, 'moon', []), true);
  assert.equal(videosChanged(null, 'moon', []), false);
});

test('video saves are debounced per timeline and skip a timeline the user left', () => {
  const timers = [];
  const saved = [];
  const saver = createDebouncedTimelineSaver((tl) => saved.push(tl.id), {
    delayMs: 1500,
    setTimer: (fn) => { timers.push({ fn, cleared: false }); return timers.length - 1; },
    clearTimer: (h) => { timers[h].cleared = true; },
  });
  let current = { id: 't1' };
  saver.schedule('t1', () => current);
  saver.schedule('t1', () => current);
  saver.schedule('t1', () => current);
  assert.equal(timers.filter((t) => !t.cleared).length, 1);
  timers.filter((t) => !t.cleared).forEach((t) => t.fn());
  assert.deepEqual(saved, ['t1']);
  saver.schedule('t1', () => current);
  current = { id: 't2' };
  timers[timers.length - 1].fn();
  assert.deepEqual(saved, ['t1']);
  const app = read('App.jsx');
  assert.match(app, /videosChanged\(articleToUpdate, query, items\)/);
  assert.match(app, /videoSaveDebouncerRef\.current\.schedule\(/);
});

// ---- P-07: shared links ------------------------------------------------------------------------------

test('a shared link with no session is read without auth, falling back to an authenticated read', async () => {
  const calls = [];
  const fetcher = (hasSession, publicStatus) => createPublicFirstFetcher({
    hasSession: async () => hasSession,
    publicGet: async (id) => {
      calls.push(['public', id]);
      return { ok: publicStatus === 200, status: publicStatus, json: async () => ({ id, via: 'public' }) };
    },
    authGet: async (id) => { calls.push(['auth', id]); return { id, via: 'auth' }; },
  });
  assert.deepEqual(await fetcher(false, 200)('t1'), { id: 't1', via: 'public' });
  assert.deepEqual(calls, [['public', 't1']]);
  calls.length = 0;
  assert.deepEqual(await fetcher(false, 404)('t2'), { id: 't2', via: 'auth' });
  assert.deepEqual(calls, [['public', 't2'], ['auth', 't2']]);
  calls.length = 0;
  assert.deepEqual(await fetcher(true, 200)('t3'), { id: 't3', via: 'auth' });
  assert.deepEqual(calls, [['auth', 't3']]);

  const api = read('api.js');
  assert.match(api, /publicGet: \(id\) => fetch\(`\$\{API_BASE\}\/timelines\/\$\{encodeURIComponent\(id\)\}`\)/);
  assert.match(read('App.jsx'), /await fetchSharedTimeline\(sharedRouteId\)/);
});

const INDEX_HTML = '<html><head><title>ChroniX</title></head><body></body></html>';
const okJson = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

async function runShare(fetchImpl) {
  const prev = process.env.VITE_API_URL;
  process.env.VITE_API_URL = 'https://backend.example';
  const res = { headers: {}, statusCode: 200, body: '' };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.send = (b) => { res.body = b; return res; };
  try {
    await createShareHandler({ fetchImpl, timeoutMs: 1000 })({ query: { id: 'tl-1' }, headers: { host: 'chronix.app' } }, res);
  } finally {
    process.env.VITE_API_URL = prev;
  }
  return res;
}

test('share previews use /meta and its cover image', async () => {
  const urls = [];
  const res = await runShare(async (url) => {
    urls.push(url);
    if (url.endsWith('/index.html')) return { ok: true, status: 200, text: async () => INDEX_HTML };
    return okJson({ id: 'tl-1', title: 'Rome', description: 'd', coverImageUrl: 'https://img/rome.jpg' });
  });
  assert.ok(urls.includes('https://backend.example/api/timelines/tl-1/meta'));
  assert.ok(!urls.includes('https://backend.example/api/timelines/tl-1'));
  assert.match(res.body, /og:image" content="https:\/\/img\/rome\.jpg"/);
});

test('share previews fall back to the full timeline on a backend without /meta', async () => {
  const urls = [];
  const res = await runShare(async (url) => {
    urls.push(url);
    if (url.endsWith('/index.html')) return { ok: true, status: 200, text: async () => INDEX_HTML };
    if (url.endsWith('/meta')) return { ok: false, status: 404, json: async () => ({ detail: 'Not Found' }) };
    return okJson({ title: 'Old backend', articles: [] });
  });
  assert.ok(urls.includes('https://backend.example/api/timelines/tl-1'));
  assert.match(res.body, /Old backend \| ChroniX/);

  // The meta endpoint's own 404 (private / missing timeline) is final: no second request.
  urls.length = 0;
  const miss = await runShare(async (url) => {
    urls.push(url);
    if (url.endsWith('/index.html')) return { ok: true, status: 200, text: async () => INDEX_HTML };
    return { ok: false, status: 404, json: async () => ({ detail: 'Timeline not found' }) };
  });
  assert.ok(!urls.includes('https://backend.example/api/timelines/tl-1'));
  assert.equal(miss.headers['cache-control'], 'no-store');
});

// ---- P-14: photo uploads -----------------------------------------------------------------------------

test('hosted photo uploads run 5 at a time', () => {
  assert.equal(HOSTED_PHOTO_UPLOAD_CONCURRENCY, 5);
  assert.match(read('components/storyStudio/PhotoImportPanel.jsx'), /mapLimit\(jobs, useHosted \? HOSTED_PHOTO_UPLOAD_CONCURRENCY : INLINE_PHOTO_ENCODE_CONCURRENCY/);
});

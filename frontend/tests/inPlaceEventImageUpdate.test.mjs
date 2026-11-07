import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeTimelineCanvasArticlesSignature,
  updateCanvasArticleImageInPlace,
} from '../src/utils/timelineArticles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, '..');

test('computeTimelineCanvasArticlesSignature stays stable across AI image generation and non-structural edits', () => {
  const baseArticles = [
    {
      id: 'evt-1',
      title: 'Moon Landing',
      subtitle: 'Apollo 11 touches down',
      from: { year: 1969, month: 7, day: 20, precision: 'day' },
      lane: 'space',
      category: 'Exploration',
      imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Aldrin.jpg/1280px-Aldrin.jpg',
    },
    {
      id: 'evt-2',
      title: 'Voyager 1 Launch',
      subtitle: 'Deep space probe',
      from: { year: 1977, month: 9, day: 5, precision: 'day' },
      lane: 'space',
      category: 'Exploration',
      imageUrl: undefined,
    },
  ];

  const initialSig = computeTimelineCanvasArticlesSignature(baseArticles);

  // Simulate AI image generation + focal point + gallery update + custom extract + edit badge
  const afterAiImage = [
    baseArticles[0],
    {
      ...baseArticles[1],
      imageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ',
      imageSource: 'ai',
      imageModel: 'gemini-2.5-flash-image',
      imageCostUsd: 0.039,
      mediaType: 'image',
      imagePositionX: 42,
      imagePositionY: 28,
      additionalImages: [{ url: 'https://example.com/old.jpg', caption: 'Old' }],
      extract: 'Updated rich narrative text',
      isEdited: true,
      editedAt: '2026-11-01T19:45:00.000Z',
    },
  ];

  assert.equal(
    computeTimelineCanvasArticlesSignature(afterAiImage),
    initialSig,
    'AI image generation and detail-only edits must not invalidate canvas articles signature'
  );

  // Structural changes (title, date, lane, category, rank) DO update the signature
  const afterTitleEdit = [
    baseArticles[0],
    { ...afterAiImage[1], title: 'Voyager 1 Interstellar Launch' },
  ];
  assert.notEqual(computeTimelineCanvasArticlesSignature(afterTitleEdit), initialSig);

  const afterDateEdit = [
    baseArticles[0],
    { ...afterAiImage[1], from: { year: 1977, month: 9, day: 6, precision: 'day' } },
  ];
  assert.notEqual(computeTimelineCanvasArticlesSignature(afterDateEdit), initialSig);
});

test('updateCanvasArticleImageInPlace updates only the target canvas article without touching sibling images', () => {
  const callOrder = [];
  let siblingSetImageCalls = 0;
  let targetSetImageCalls = 0;
  let cancelledOldLoad = false;
  let releasedOldBitmap = false;
  let defaultRedrawCalls = 0;

  const siblingBitmap = { width: 500, height: 350 };
  const siblingArt = {
    id: 'evt-1',
    image: siblingBitmap,
    imageLoaded: true,
    _loadedImageKey: 'img:sibling:portrait',
    data: { id: 'evt-1', imageUrl: 'https://example.com/sibling.jpg' },
    setImage() {
      siblingSetImageCalls += 1;
    },
  };

  const targetArt = {
    id: 'evt-2',
    image: { width: 400, height: 400 },
    imageLoaded: true,
    _loadedImageKey: 'img:old:portrait',
    _pendingImageKey: 'img:pending:portrait',
    _chronixFailedImageUrl: 'https://example.com/broken.jpg',
    _chronixRetryAfter: Date.now() + 30_000,
    _lensMeasure: { cached: true },
    _imageCancel() {
      cancelledOldLoad = true;
    },
    _releaseImageResource(opts) {
      releasedOldBitmap = Boolean(opts?.skipRedraw);
    },
    data: {
      id: 'evt-2',
      imageUrl: 'https://example.com/old.jpg',
      imagePositionX: 20,
      imagePositionY: 80,
    },
    initialiseStyles() {
      callOrder.push('initialiseStyles');
    },
    invalidateCaches() {
      callOrder.push('invalidateCaches');
    },
    updateCachedSize() {
      callOrder.push('updateCachedSize');
    },
    setImage() {
      targetSetImageCalls += 1;
      callOrder.push('setImage');
    },
  };

  const tl = {
    articles: [siblingArt, targetArt],
    defaultRedraw() {
      defaultRedrawCalls += 1;
      callOrder.push('defaultRedraw');
    },
  };

  const memoizedTimelineData = {
    id: 'tl-1',
    articles: [
      { id: 'evt-1', title: 'Event 1', imageUrl: 'https://example.com/sibling.jpg' },
      { id: 'evt-2', title: 'Event 2', imageUrl: 'https://example.com/old.jpg', imagePositionX: 20, imagePositionY: 80 },
    ],
  };

  const firstAiFields = {
    imageUrl: 'https://example.com/ai-gen-1.png',
    imageSource: 'ai',
    imageModel: 'flux',
    mediaType: 'image',
    imagePositionX: undefined,
    imagePositionY: undefined,
    additionalImages: [{ url: 'https://example.com/old.jpg', caption: 'Event 2' }],
  };

  const updated = updateCanvasArticleImageInPlace(tl, memoizedTimelineData, 'evt-2', firstAiFields, {
    syncLayouts: () => {
      callOrder.push('syncLayouts');
    },
  });

  assert.equal(updated, true);
  assert.equal(cancelledOldLoad, true);
  assert.equal(releasedOldBitmap, true);
  assert.equal(targetArt._chronixFailedImageUrl, null);
  assert.equal(targetArt._chronixRetryAfter, 0);
  assert.equal(targetArt._lensMeasure, null);
  assert.equal(targetArt.data.imageUrl, 'https://example.com/ai-gen-1.png');
  assert.equal(targetArt.rawImageUrl, 'https://example.com/ai-gen-1.png');
  assert.equal(targetArt.data.imagePositionX, undefined);
  assert.equal(targetArt.data.imagePositionY, undefined);
  assert.equal(targetSetImageCalls, 1);
  assert.equal(defaultRedrawCalls, 1);
  assert.equal(tl._chronixPendingRestackIds.has('evt-2'), true);

  // Layout sync runs BEFORE setImage so _getArticleImageTargetSpec uses the updated card layout
  assert.ok(callOrder.indexOf('syncLayouts') < callOrder.indexOf('setImage'));
  assert.ok(callOrder.indexOf('setImage') < callOrder.indexOf('defaultRedraw'));

  // Sibling article bitmap and state remain 100% untouched
  assert.equal(siblingSetImageCalls, 0);
  assert.equal(siblingArt.image, siblingBitmap);
  assert.equal(siblingArt.imageLoaded, true);
  assert.equal(siblingArt._loadedImageKey, 'img:sibling:portrait');

  // Consecutive AI generation keeps memoizedTimelineData.articles in sync too
  const secondAiFields = {
    imageUrl: 'https://example.com/ai-gen-2.png',
    imageSource: 'ai',
    mediaType: 'image',
  };
  updateCanvasArticleImageInPlace(tl, memoizedTimelineData, 'evt-2', secondAiFields);
  assert.equal(memoizedTimelineData.articles[1].imageUrl, 'https://example.com/ai-gen-2.png');
  assert.equal(targetArt.data.imageUrl, 'https://example.com/ai-gen-2.png');

  // Clearing image removes pending restack marker and clears URLs cleanly
  updateCanvasArticleImageInPlace(tl, memoizedTimelineData, 'evt-2', { imageUrl: undefined });
  assert.equal(targetArt.data.imageUrl, undefined);
  assert.equal(targetArt.imageUrl, undefined);
  assert.equal(tl._chronixPendingRestackIds.has('evt-2'), false);
});

test('App.jsx and TimelineView.jsx wire imperative setArticleImage updates without rebuilding canvas', () => {
  const appSource = fs.readFileSync(path.join(FRONTEND_DIR, 'src', 'App.jsx'), 'utf8');
  const timelineViewSource = fs.readFileSync(
    path.join(FRONTEND_DIR, 'src', 'components', 'TimelineView.jsx'),
    'utf8'
  );

  // Batch 6C: App hands TimelineView the visible timeline itself; TimelineView decides between a
  // rebuild and an in-place update (canvasArticleSync), and images still go through setArticleImage.
  assert.ok(
    appSource.includes('timelineData={visibleTimeline}'),
    'App.jsx should pass the visible timeline straight to TimelineView'
  );
  const setArticleImageCalls = appSource.match(/timelineRef\.current\?\.setArticleImage\?\./g) || [];
  assert.ok(
    setArticleImageCalls.length >= 3,
    'App.jsx should push in-place image updates in handleSaveEvent, handleSaveEventImage, and handleSetEventCoverImage'
  );
  assert.ok(
    timelineViewSource.includes('setArticleImage:'),
    'TimelineView.jsx should expose setArticleImage on its imperative ref handle'
  );
  assert.ok(
    timelineViewSource.includes('_chronixPendingRestackIds'),
    'TimelineView.jsx should restack once async image decode completes'
  );
});

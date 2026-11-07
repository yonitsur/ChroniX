// Regression: the enriched AI result replaces the media-less preview (P-03) with the same
// structure, so TimelineView updates the canvas in place (P-18). Images must reach the live
// canvas articles on that path, not only after leaving and re-entering the timeline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canvasArticleImageChanged, computeCanvasStructureKey } from '../src/components/timeline/canvasArticleSync.js';

const preview = {
  id: 'tl-1',
  lanes: [{ id: 'l1', title: 'Main' }],
  articles: [
    { id: 'a1', lane: 'l1', title: 'One', isPartial: true },
    { id: 'a2', lane: 'l1', title: 'Two' },
  ],
};
const enriched = {
  ...preview,
  articles: [
    { id: 'a1', lane: 'l1', title: 'One', imageUrl: 'https://upload.wikimedia.org/a.jpg', wikiUrl: 'https://en.wikipedia.org/wiki/One' },
    { id: 'a2', lane: 'l1', title: 'Two', imageUrl: 'https://upload.wikimedia.org/b.jpg' },
  ],
};

test('preview -> enriched result keeps the canvas structure (in-place path)', () => {
  assert.equal(computeCanvasStructureKey(preview), computeCanvasStructureKey(enriched));
});

test('an image arriving with new data is detected', () => {
  const live = { data: { rawImageUrl: undefined } };
  assert.equal(canvasArticleImageChanged(live, { rawImageUrl: 'https://x/a.jpg' }), true);
});

test('an image removed with new data is detected', () => {
  const live = { data: { rawImageUrl: 'https://x/a.jpg' } };
  assert.equal(canvasArticleImageChanged(live, { rawImageUrl: undefined }), true);
});

test('an unchanged image (or one already pushed via setArticleImage) is not reloaded', () => {
  assert.equal(canvasArticleImageChanged({ data: { rawImageUrl: 'https://x/a.jpg' } }, { rawImageUrl: 'https://x/a.jpg' }), false);
  assert.equal(canvasArticleImageChanged({ data: { rawImageUrl: 'https://x/a.jpg' } }, { rawImageUrl: ' https://x/a.jpg ' }), false);
  assert.equal(canvasArticleImageChanged({ data: {} }, { rawImageUrl: '' }), false);
  assert.equal(canvasArticleImageChanged(null, { rawImageUrl: 'x' }), false);
});

test('TimelineView loads changed images in place inside applyCanvasArticleEdits', () => {
  const src = readFileSync(new URL('../src/components/TimelineView.jsx', import.meta.url), 'utf8');
  const start = src.indexOf('function applyCanvasArticleEdits');
  const end = src.indexOf('function updateTimelineTheme', start);
  const body = src.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(body, /canvasArticleImageChanged\(art, next\)/);
  assert.match(body, /edits\.length === 0 && imageEdits\.length === 0/);
  assert.match(body, /updateCanvasArticleImageInPlace\(/);
});

// TimelineView.jsx cannot be imported under node (JSX + canvas), so, like the other
// TimelineView tests in this folder, these checks pin the wiring of the Batch 6A fixes in the
// source. The algorithms themselves are tested directly (stackRows, canvasArticleSync,
// urlKeyedLru, canvasMath).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'TimelineView.jsx'), 'utf8');

const effectBody = (marker) => {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing: ${marker}`);
  return source.slice(start, source.indexOf('}, [', start));
};

test('P-18: redraws are batched on mount and on in-place edits, flushed by the last effect', () => {
  assert.ok(source.includes('if (this._chronixRedrawBatch) {'), 'patched redraw defers inside a batch');
  assert.ok(source.includes('beginCanvasRedrawBatch(timeline);'), 'mount opens a batch');
  const lastEffect = source.lastIndexOf('useEffect(');
  assert.ok(
    source.slice(lastEffect, lastEffect + 200).includes('endCanvasRedrawBatch(timelineInstanceRef.current)'),
    'the last effect of the component flushes the batch'
  );
});

test('P-18: the canvas is rebuilt only for structural changes, text edits apply in place', () => {
  assert.ok(source.includes('}, [canvasStructureKey, canvasRebuildNonce]);'), 'main effect keyed on structure');
  assert.ok(!/\n {2}\}, \[timelineData\]\);\n\n {2}const canEditImage/.test(source), 'main effect no longer keyed on the data object');
  const inPlace = effectBody('if (tl._chronixSourceData === timelineData) return;');
  assert.ok(inPlace.includes('applyCanvasArticleEdits('));
  // Declared before the filter sync so filters see updated categories.
  assert.ok(source.indexOf('applyCanvasArticleEdits(tl, timelineData') < source.indexOf('// Restore selections supplied by App'));
  // Handlers created at mount read the latest data, not the mount-time closure.
  assert.ok(!source.includes('const original = timelineData.articles?.find('));
  assert.ok(!source.includes('const original = timelineData?.articles?.find('));
});

test('P-18: RTL and density effects skip work the canvas already reflects', () => {
  assert.ok(source.includes('if (timeline._chronixAppliedRtl === Boolean(isRtl)) return;'));
  assert.ok(source.includes('if (timeline._chronixAppliedDensity === densityMode) return;'));
  const themeFn = source.slice(source.indexOf('function updateTimelineTheme('), source.indexOf('// Horizontal camera state'));
  assert.ok(!themeFn.includes('.find((a) => isSameArticleId(a.id, art.id))'), 'no O(n^2) find');
  assert.ok(themeFn.includes('rawById.get(String(art.id))'));
});

test('P-19: wrapped lines use per-article slots and a bounded LRU instead of clear()', () => {
  assert.ok(source.includes('const WRAPPED_LINES_LRU_LIMIT = 20000;'));
  const clears = source.match(/_titleLinesCache\.clear\(\)/g) || [];
  assert.equal(clears.length, 1, 'only the font-load listener clears the shared cache');
  assert.ok(source.includes("getCachedWrappedLines(title, COMPACT_TEXT_WIDTH, font, article, 'ct')"));
});

test('P-20: stack() packs rows with the width-once packer', () => {
  assert.ok(source.includes("import { createStackRowPacker } from './timeline/stackRows';"));
  assert.ok(source.includes('packer.place(article, getStackLeft(article), getStackWidth(article));'));
});

test('P-21: the canvas renders at the native device pixel ratio, capped at 2', () => {
  assert.ok(source.includes("canvas: { dprMode: 'native', maxDpr: 2 },"));
});

test('P-22: lens measures are version-keyed, the sequence is cached, bubble shadows are sprites', () => {
  const measure = source.slice(source.indexOf('function measureLensArticle('), source.indexOf('// Positions every visible article'));
  assert.ok(!measure.includes('const key = `'), 'no per-frame key string');
  assert.ok(measure.includes('cached.textVersion === textVersion'));
  assert.ok(source.includes('lens.position = getLensSequencePosition(tl, String(lens.focusId));'));
  const bubble = source.slice(source.indexOf('function drawLensBubble('), source.indexOf('function drawLensBubble(') + 2000);
  assert.ok(!bubble.includes('ctx.shadowBlur'), 'no live shadowBlur on bubbles');
  assert.ok(bubble.includes('drawCardShadow(ctx, {'));
});

test('P-25: URL caches are bounded and the lens store releases disposed timelines', () => {
  assert.ok(source.includes('const imageAspectByUrl = createUrlKeyedLru(2000);'));
  assert.ok(source.includes('const lensPhotoStore = createUrlKeyedLru(LENS_PHOTO_CACHE_LIMIT);'));
  assert.ok(source.includes('const LENS_PHOTO_CACHE_LIMIT_MOBILE = 8;'));
  const dispose = source.slice(source.indexOf('function disposeTimelineResources('), source.indexOf('function disposeTimelineResources(') + 200);
  assert.ok(dispose.includes('releaseLensPhotoOwner(tl);'));
});

test('P-27: no per-card drawImage closure, cached glow gradients, cached landscape thumbnails', () => {
  assert.ok(!source.includes('ctx.drawImage = function (img, ...args)'));
  assert.ok(source.includes('ctx.drawImage = guardedCardDrawImage;'));
  const frame = source.slice(source.indexOf('function drawClassicCardFrame('), source.indexOf('function getCardGlowGradient('));
  assert.ok(!frame.includes('createRadialGradient'), 'glow gradient is cached, not created per card');
  assert.ok(source.includes("getCachedRoundedThumbnail(ctx, this, this.image, thumbSize, thumbRadius, 'landscape')"));
});

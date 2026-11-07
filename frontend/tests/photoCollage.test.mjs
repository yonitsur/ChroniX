// Event photo collage: layout math and the ordered photo picker.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collageRowCounts, computeCollageCells, coverCrop, toggleCollageSelection,
  COLLAGE_LAYOUTS, COLLAGE_MAX_PHOTOS,
} from '../src/utils/photoCollage.js';

const W = 1440;
const H = 900;
const inside = (c, gap = 0) => c.x >= gap - 1e-6 && c.y >= gap - 1e-6
  && c.x + c.w <= W - gap + 1e-6 && c.y + c.h <= H - gap + 1e-6;
const overlaps = (a, b) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6
  && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;

test('rows are balanced with the larger rows last', () => {
  assert.deepEqual(collageRowCounts(1), [1]);
  assert.deepEqual(collageRowCounts(3), [3]);
  assert.deepEqual(collageRowCounts(4), [2, 2]);
  assert.deepEqual(collageRowCounts(5), [2, 3]);
  assert.deepEqual(collageRowCounts(7), [2, 2, 3]);
  assert.deepEqual(collageRowCounts(9), [3, 3, 3]);
  for (let n = 1; n <= 9; n += 1) {
    assert.equal(collageRowCounts(n).reduce((a, b) => a + b, 0), n);
  }
});

test('grid and featured cells tile the canvas without overlapping', () => {
  for (const layout of ['grid', 'featured']) {
    for (let n = 1; n <= COLLAGE_MAX_PHOTOS; n += 1) {
      const cells = computeCollageCells(layout, n, W, H, 12);
      assert.equal(cells.length, n, `${layout} ${n}`);
      cells.forEach((c) => assert.ok(inside(c, 12), `${layout} ${n} out of bounds`));
      for (let i = 0; i < cells.length; i += 1) {
        for (let j = i + 1; j < cells.length; j += 1) {
          assert.ok(!overlaps(cells[i], cells[j]), `${layout} ${n}: cells ${i} and ${j} overlap`);
        }
      }
      const area = cells.reduce((sum, c) => sum + c.w * c.h, 0);
      assert.ok(area > W * H * 0.85, `${layout} ${n} leaves too much empty space`);
    }
  }
});

test('featured makes the first photo the largest', () => {
  const cells = computeCollageCells('featured', 5, W, H);
  const areas = cells.map((c) => c.w * c.h);
  assert.equal(Math.max(...areas), areas[0]);
});

test('polaroid layout is tilted, stable and capped', () => {
  const a = computeCollageCells('polaroid', 6, W, H, 28);
  const b = computeCollageCells('polaroid', 6, W, H, 28);
  assert.deepEqual(a, b);
  assert.ok(a.some((c) => c.rotation !== 0));
  a.forEach((c) => assert.ok(Math.abs(c.rotation) < 0.1));
  assert.equal(computeCollageCells('polaroid', 20).length, COLLAGE_MAX_PHOTOS);
  assert.deepEqual(computeCollageCells('grid', 0), []);
  assert.ok(COLLAGE_LAYOUTS.includes('polaroid'));
});

test('coverCrop centre-crops to the target aspect ratio', () => {
  const wide = coverCrop(2000, 1000, 500, 500);
  assert.deepEqual(wide, { sx: 500, sy: 0, sw: 1000, sh: 1000 });
  const tall = coverCrop(1000, 2000, 1000, 500);
  assert.equal(tall.sw, 1000);
  assert.equal(tall.sh, 500);
  assert.equal(tall.sy, 750);
});

test('picking photos keeps click order and respects the cap', () => {
  let sel = [0, 1, 2];
  sel = toggleCollageSelection(sel, 0);
  assert.deepEqual(sel, [1, 2]);
  sel = toggleCollageSelection(sel, 0);
  assert.deepEqual(sel, [1, 2, 0]);
  const full = Array.from({ length: COLLAGE_MAX_PHOTOS }, (_, i) => i);
  assert.equal(toggleCollageSelection(full, 42), full);
});

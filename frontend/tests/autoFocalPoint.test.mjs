import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInterestMap, computeFocalPoint } from '../src/utils/autoFocalPoint.js';

// Plain grey image with a detailed, coloured block at the given rectangle.
function makeImage(width, height, subject) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inSubject = subject
        && x >= subject.x && x < subject.x + subject.w
        && y >= subject.y && y < subject.y + subject.h;
      const v = inSubject ? ((x + y) % 2 ? 200 : 60) : 120;
      data[i] = inSubject ? v : 120;
      data[i + 1] = inSubject ? v / 2 : 120;
      data[i + 2] = inSubject ? 40 : 120;
      data[i + 3] = 255;
    }
  }
  return buildInterestMap(data, width, height);
}

test('tall photo: crop window moves up to a subject near the top', () => {
  const map = makeImage(40, 90, { x: 10, y: 4, w: 20, h: 18 });
  const point = computeFocalPoint(map, 16 / 10);
  assert.equal(point.x, 50);
  assert.ok(point.y < 15, `expected y near the top, got ${point.y}`);
});

test('tall photo: crop window moves down to a subject near the bottom', () => {
  const map = makeImage(40, 90, { x: 10, y: 70, w: 20, h: 16 });
  const point = computeFocalPoint(map, 16 / 10);
  assert.ok(point.y > 85, `expected y near the bottom, got ${point.y}`);
});

test('wide photo: crop window follows a subject on the right', () => {
  const map = makeImage(96, 30, { x: 75, y: 8, w: 15, h: 14 });
  const point = computeFocalPoint(map, 16 / 10);
  assert.equal(point.y, 50);
  assert.ok(point.x > 80, `expected x near the right, got ${point.x}`);
});

test('photos without a clear subject keep a neutral crop', () => {
  assert.deepEqual(computeFocalPoint(makeImage(96, 30, null), 16 / 10), { x: 50, y: 50 });
  const tall = computeFocalPoint(makeImage(40, 90, null), 16 / 10);
  assert.equal(tall.x, 50);
  assert.ok(tall.y > 25 && tall.y < 45, `expected upper-third bias, got ${tall.y}`);
});

test('photo already matching the frame is not shifted', () => {
  assert.deepEqual(computeFocalPoint(makeImage(64, 40, { x: 0, y: 0, w: 10, h: 10 }), 16 / 10), { x: 50, y: 50 });
});

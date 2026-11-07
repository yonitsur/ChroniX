import test from 'node:test';
import assert from 'node:assert/strict';
import { createStackRowPacker, packStackRows } from '../src/components/timeline/stackRows.js';

// The pairwise loop the patched stack() used before (Histropedia's headerOverlapsWith:
// closed intervals, other.right >= this.left && this.right >= other.left).
function legacyPack(items, getLeft, getWidth) {
  let widthCalls = 0;
  const width = (item) => {
    widthCalls += 1;
    return getWidth(item);
  };
  const overlaps = (a, b) => {
    const aLeft = getLeft(a);
    const bLeft = getLeft(b);
    const aRight = aLeft + width(a);
    const bRight = bLeft + width(b);
    return bRight >= aLeft && aRight >= bLeft;
  };
  const rows = [];
  for (const item of items) {
    let target = rows.length;
    for (let r = 0; r < rows.length; r++) {
      if (!rows[r].some((other) => overlaps(item, other))) {
        target = r;
        break;
      }
    }
    if (target >= rows.length) rows[target] = [];
    rows[target].push(item);
  }
  return { rows, widthCalls };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomItems(rand, n, { degenerate = false, integerGrid = false } = {}) {
  const widths = [150, 168, 198, 240, 46];
  const items = [];
  for (let i = 0; i < n; i++) {
    let left = integerGrid ? Math.round(rand() * 40) * 6 : rand() * 4000 - 500;
    let width = widths[Math.floor(rand() * widths.length)];
    if (degenerate) {
      const roll = rand();
      if (roll < 0.04) left = NaN;
      else if (roll < 0.08) width = NaN;
      else if (roll < 0.12) width = -rand() * 80;
      else if (roll < 0.14) width = 0;
      else if (roll < 0.15) left = Infinity;
      else if (roll < 0.16) left = -Infinity;
    }
    items.push({ id: i, left, width });
  }
  // Priority order like stack(): a few "selected/starred" first, then chronological.
  const head = items.filter(() => rand() < 0.1);
  const rest = items.filter((item) => !head.includes(item)).sort((a, b) => a.left - b.left || a.id - b.id);
  return [...head, ...rest];
}

const ids = (rows) => rows.map((row) => row.map((item) => item.id));

test('row packer matches the legacy pairwise stack loop on randomized inputs', () => {
  const rand = mulberry32(6061);
  for (let round = 0; round < 400; round++) {
    const n = 1 + Math.floor(rand() * 120);
    const items = randomItems(rand, n, { degenerate: round % 3 === 0, integerGrid: round % 5 === 0 });
    const getLeft = (item) => item.left;
    const getWidth = (item) => item.width;
    const expected = legacyPack(items, getLeft, getWidth).rows;
    assert.deepEqual(ids(packStackRows(items, getLeft, getWidth)), ids(expected), `round ${round}`);
  }
});

test('row packer keeps touching edges in separate rows (closed intervals)', () => {
  const items = [
    { id: 'a', left: 0, width: 100 },
    { id: 'b', left: 100, width: 50 }, // touches a's right edge -> overlap
    { id: 'c', left: 100.0001, width: 10 },
    { id: 'd', left: -10, width: 9.9999 },
  ];
  const rows = packStackRows(items, (i) => i.left, (i) => i.width);
  assert.deepEqual(ids(rows), ids(legacyPack(items, (i) => i.left, (i) => i.width).rows));
  assert.deepEqual(ids(rows), [['a', 'c', 'd'], ['b']]);
});

test('row packer fills gaps between earlier, out-of-order cards', () => {
  // A selected card far right, then chronological cards: the third fits between the first two.
  const items = [
    { id: 'sel', left: 1000, width: 150 },
    { id: 'e1', left: 0, width: 150 },
    { id: 'e2', left: 400, width: 150 },
    { id: 'e3', left: 1100, width: 150 },
  ];
  const rows = packStackRows(items, (i) => i.left, (i) => i.width);
  assert.deepEqual(ids(rows), [['sel', 'e1', 'e2'], ['e3']]);
});

test('row packer reads each width once (legacy loop was quadratic)', (t) => {
  const rand = mulberry32(42);
  const items = randomItems(rand, 500);
  let calls = 0;
  const getWidth = (item) => {
    calls += 1;
    return item.width;
  };
  const l0 = performance.now();
  const legacy = legacyPack(items, (i) => i.left, (i) => i.width);
  const legacyMs = performance.now() - l0;
  const t0 = performance.now();
  const rows = packStackRows(items, (i) => i.left, getWidth);
  const packMs = performance.now() - t0;
  assert.deepEqual(ids(rows), ids(legacy.rows));
  assert.equal(calls, 500);
  assert.ok(legacy.widthCalls > 500 * 10, `legacy width calls: ${legacy.widthCalls}`);
  // Informational (node, no canvas): visible with `node --test --test-reporter=spec`.
  t.diagnostic(`N=500: legacy getWidth calls=${legacy.widthCalls} (${legacyMs.toFixed(2)}ms), packer=${calls} (${packMs.toFixed(2)}ms)`);
});

test('createStackRowPacker exposes the same row arrays it fills', () => {
  const packer = createStackRowPacker();
  assert.equal(packer.place('x', 0, 10), 0);
  assert.equal(packer.place('y', 5, 10), 1);
  assert.equal(packer.place('z', 20, 10), 0);
  assert.deepEqual(packer.rows, [['x', 'z'], ['y']]);
});

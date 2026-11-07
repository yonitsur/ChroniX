import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLensSwipe,
  findAdjacentItem,
  findNearestItem,
  pickFocus,
  placeHorizontally,
  planFocusLens,
} from './focusLens.js';

const SIZES = {
  focus: { width: 300, height: 260 },
  focusRow: { width: 300, height: 72 },
  chip: { width: 120, height: 30 },
  bubble: { width: 30, height: 30 },
  dot: { width: 9, height: 9 },
};
const measure = (_item, tier) => SIZES[tier];
const SIDES = {
  above: { minOffset: 14, maxExtent: 480 },
  below: { minOffset: 34, maxExtent: 300 },
};

function items(xs) {
  return xs.map((x, i) => ({ id: `e${i}`, x, priority: 0, chronoIndex: i }));
}

function overlaps(a, b) {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
}

test('pickFocus chooses the event nearest the centre within the radius', () => {
  const focus = pickFocus(items([10, 180, 230, 380]), { width: 400, centerX: 200 });
  assert.equal(focus.id, 'e1');
});

test('pickFocus returns null when nothing is near the centre', () => {
  assert.equal(pickFocus(items([0, 400]), { width: 400, centerX: 200 }), null);
});

test('pickFocus keeps the previous focus within the hysteresis band', () => {
  const list = items([190, 215]);
  assert.equal(pickFocus(list, { width: 400, centerX: 200, previousFocusId: 'e1' }).id, 'e1');
  assert.equal(pickFocus(items([190, 250]), { width: 400, centerX: 200, previousFocusId: 'e1' }).id, 'e0');
});

test('pickFocus breaks distance ties by priority', () => {
  const list = [
    { id: 'a', x: 190, priority: 1 },
    { id: 'b', x: 210, priority: 5 },
  ];
  assert.equal(pickFocus(list, { width: 400, centerX: 200 }).id, 'b');
});

test('placeHorizontally keeps the card on screen and the anchor inside the card', () => {
  assert.equal(placeHorizontally(200, 100, 400), 150);
  assert.equal(placeHorizontally(5, 100, 400), -5);
  const left = placeHorizontally(390, 100, 400);
  assert.equal(left, 300);
  assert.ok(390 >= left && 390 <= left + 100);
});

test('planFocusLens places the focus card above the axis', () => {
  const { focusId, placements } = planFocusLens({ items: items([100, 200, 300]), width: 400, sides: SIDES, measure });
  assert.equal(focusId, 'e1');
  const focus = placements.get('e1');
  assert.equal(focus.tier, 'focus');
  assert.equal(focus.side, 'above');
  assert.equal(focus.top + focus.height, -14);
});

test('planFocusLens falls back to the row focus card when space is short', () => {
  const { placements } = planFocusLens({
    items: items([200]),
    width: 400,
    sides: { above: { minOffset: 10, maxExtent: 120 }, below: null },
    measure,
  });
  assert.equal(placements.get('e0').tier, 'focusRow');
});

test('planFocusLens never overlaps card rectangles and alternates sides', () => {
  const xs = Array.from({ length: 40 }, (_, i) => i * 11);
  const { placements } = planFocusLens({ items: items(xs), width: 400, sides: SIDES, measure });
  const cards = [...placements.values()].filter((p) => p.tier !== 'dot');
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      assert.ok(!overlaps(cards[i], cards[j]), `cards ${i} and ${j} overlap`);
    }
  }
  const sides = new Set(cards.map((c) => c.side));
  assert.ok(sides.has('above') && sides.has('below'));
  for (const [id, p] of placements) {
    if (p.tier === 'focus' || p.tier === 'dot') continue;
    const index = Number(id.slice(1));
    assert.equal(p.side, index % 2 === 0 ? 'above' : 'below');
  }
});

test('planFocusLens keeps stems clear of other cards', () => {
  const xs = Array.from({ length: 30 }, (_, i) => 20 + i * 12);
  const { placements } = planFocusLens({ items: items(xs), width: 400, sides: SIDES, measure });
  const list = items(xs);
  for (const item of list) {
    const p = placements.get(item.id);
    if (!p || p.tier === 'dot') continue;
    const y1 = p.side === 'above' ? p.top + p.height : 0;
    const y2 = p.side === 'above' ? 0 : p.top;
    for (const other of list) {
      if (other === item) continue;
      const o = placements.get(other.id);
      if (!o || o.tier === 'dot' || o.side !== p.side) continue;
      const crossesX = item.x > o.left && item.x < o.left + o.width;
      const crossesY = Math.max(y1, y2) > o.top && Math.min(y1, y2) < o.top + o.height;
      assert.ok(!(crossesX && crossesY), `stem of ${item.id} crosses ${other.id}`);
    }
  }
});

test('planFocusLens caps chips and turns far events into dots', () => {
  const xs = [...Array.from({ length: 20 }, (_, i) => i * 20), -2000, 3000];
  const { placements } = planFocusLens({ items: items(xs), width: 400, sides: SIDES, measure });
  const chips = [...placements.values()].filter((p) => p.tier === 'chip');
  assert.ok(chips.length <= 6);
  assert.equal(placements.get('e20').tier, 'dot');
  assert.equal(placements.get('e21').tier, 'dot');
});

test('planFocusLens honours a forced focus id', () => {
  const { focusId } = planFocusLens({ items: items([100, 200]), width: 400, sides: SIDES, measure, forcedFocusId: 'e0' });
  assert.equal(focusId, 'e0');
});

test('planFocusLens without a lower side keeps everything above the axis', () => {
  const { placements } = planFocusLens({
    items: items([50, 120, 200, 260, 330]),
    width: 400,
    sides: { above: SIDES.above, below: null },
    measure,
  });
  for (const p of placements.values()) assert.ok(p.side === 'above' || p.side === 'axis');
});

test('planFocusLens honours a custom side assignment', () => {
  const { placements } = planFocusLens({
    items: items([60, 120, 200, 280, 340]),
    width: 400,
    sides: SIDES,
    measure,
    assignSide: () => 'below',
  });
  for (const [id, p] of placements) {
    if (id === 'e2') assert.equal(p.side, 'above');
    else assert.ok(p.side === 'below' || p.side === 'axis');
  }
});

test('findNearestItem respects the max distance', () => {
  const list = items([50, 260]);
  assert.equal(findNearestItem(list, 200).id, 'e1');
  assert.equal(findNearestItem(list, 200, 40), null);
});

test('findAdjacentItem steps chronologically', () => {
  const list = items([50, 150, 250]);
  assert.equal(findAdjacentItem(list, 'e1', 1).id, 'e2');
  assert.equal(findAdjacentItem(list, 'e1', -1).id, 'e0');
  assert.equal(findAdjacentItem(list, 'e2', 1), null);
  assert.equal(findAdjacentItem(list, null, 1, 200).id, 'e2');
  assert.equal(findAdjacentItem(list, null, -1, 200).id, 'e1');
});

test('classifyLensSwipe: short swipe steps one event in the drag direction', () => {
  assert.deepEqual(classifyLensSwipe({ dx: 60, velocity: 1.5, width: 390 }), { kind: 'step', direction: 1 });
  assert.deepEqual(classifyLensSwipe({ dx: -40, velocity: 0.05, width: 390 }), { kind: 'step', direction: -1 });
});

test('classifyLensSwipe: a quick tiny flick still steps, a tiny slow nudge settles', () => {
  assert.deepEqual(classifyLensSwipe({ dx: 8, velocity: -0.6, width: 390 }), { kind: 'step', direction: -1 });
  assert.deepEqual(classifyLensSwipe({ dx: 8, velocity: 0.05, width: 390 }), { kind: 'settle' });
});

test('classifyLensSwipe: a long drag scrolls freely, threshold scales with width', () => {
  assert.deepEqual(classifyLensSwipe({ dx: 200, velocity: 2, width: 390 }), { kind: 'scroll' });
  assert.equal(classifyLensSwipe({ dx: 130, width: 390 }).kind, 'step');
  assert.equal(classifyLensSwipe({ dx: 130, width: 300 }).kind, 'scroll');
  assert.equal(classifyLensSwipe({ dx: -170, width: 0 }).kind, 'step');
});

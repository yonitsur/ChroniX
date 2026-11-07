import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISTANCE_HYSTERESIS,
  LAYOUT_HYSTERESIS,
  SPACING_HYSTERESIS,
  LAYOUT_METRICS,
  allocateLaneHeights,
  chooseCardLayout,
  countStackRows,
  holdPlanValue,
  measureLayoutDemand,
  planSlot,
  resolveRowSpacing,
} from './cardLayoutPlanner.js';

const LAYOUTS = {
  portrait: { width: 150, height: 271 },
  landscape: { width: 240, height: 68 },
  compact: { width: 198, height: 36 },
};

function demandsFor(xs, { band = 0, topGap = 6 } = {}) {
  const demands = {};
  for (const [layout, size] of Object.entries(LAYOUTS)) {
    const cards = xs.map((left) => ({ left, width: size.width, height: size.height }));
    demands[layout] = measureLayoutDemand({ cards, layout, periodBandHeight: band, topGap });
  }
  return demands;
}

test('countStackRows mirrors first-fit stacking with inclusive edges', () => {
  assert.equal(countStackRows([]), 0);
  assert.equal(countStackRows([{ left: 0, width: 100 }, { left: 101, width: 100 }]), 1);
  assert.equal(countStackRows([{ left: 0, width: 100 }, { left: 100, width: 100 }]), 2);
  assert.equal(countStackRows([
    { left: 0, width: 100 }, { left: 50, width: 100 }, { left: 120, width: 100 },
  ]), 2);
});

test('sparse events get large cards when the slot is deep enough', () => {
  const demands = demandsFor([0, 400, 800]);
  assert.equal(demands.portrait.rows, 1);
  const plan = planSlot({ availableHeight: 420, demands });
  assert.equal(plan.layout, 'portrait');
  assert.ok(plan.distance >= 271 + 56, 'tallest card keeps its axis clearance');
  assert.ok(plan.distance <= 420 - 6, 'first row stays below the slot ceiling');
});

test('dense events step down to smaller cards instead of squeezing rows', () => {
  const xs = Array.from({ length: 10 }, (_, i) => i * 40);
  const demands = demandsFor(xs);
  assert.ok(demands.portrait.rows > 1);
  assert.equal(planSlot({ availableHeight: 420, demands }).layout, 'landscape');
  assert.equal(planSlot({ availableHeight: 240, demands }).layout, 'compact');
});

test('a tall card in a raised row does not inflate the band above the axis', () => {
  const cards = [
    { left: 0, width: 150, height: 120 },
    { left: 50, width: 150, height: 271 },
  ];
  const demand = measureLayoutDemand({ cards, layout: 'portrait', topGap: 6 });
  assert.equal(demand.rows, 2);
  assert.equal(demand.tallest, 271);
  assert.equal(demand.baseHeight, 271 - LAYOUT_METRICS.portrait.minReveal);
});

test('a tall period-line band pushes the cards up to keep clear of it', () => {
  const plain = demandsFor([0]);
  const banded = demandsFor([0], { band: 60 });
  assert.equal(plain.compact.clearance, 32);
  assert.equal(banded.compact.clearance, 78);
  assert.ok(banded.compact.need > plain.compact.need);
});

test('hysteresis keeps a layout until it clearly overflows and upgrades only with room to spare', () => {
  const demands = demandsFor([0, 400]);
  const need = demands.portrait.need;
  assert.equal(chooseCardLayout({ availableHeight: need + 5, demands, previous: 'landscape' }), 'landscape');
  assert.equal(chooseCardLayout({ availableHeight: need + LAYOUT_HYSTERESIS, demands, previous: 'landscape' }), 'portrait');
  assert.equal(chooseCardLayout({ availableHeight: need - 5, demands, previous: 'portrait' }), 'portrait');
  assert.equal(chooseCardLayout({ availableHeight: need - LAYOUT_HYSTERESIS, demands, previous: 'portrait' }), 'landscape');
});

test('an empty viewport keeps the previous layout', () => {
  const demands = demandsFor([]);
  assert.equal(chooseCardLayout({ availableHeight: 900, demands, previous: 'compact' }), 'compact');
  assert.equal(chooseCardLayout({ availableHeight: 900, demands }), 'portrait');
});

test('fixed modes only ever return their own layout', () => {
  const demands = demandsFor(Array.from({ length: 12 }, (_, i) => i * 30));
  assert.equal(planSlot({ availableHeight: 200, demands, candidates: ['portrait'] }).layout, 'portrait');
});

test('row spacing spreads rows into free space but never beyond full reveal', () => {
  assert.equal(resolveRowSpacing({ availableHeight: 600, distance: 114, topGap: 6, rows: 3, layout: 'landscape', tallest: 68 }), 78);
  assert.equal(resolveRowSpacing({ availableHeight: 300, distance: 114, topGap: 6, rows: 6, layout: 'landscape', tallest: 68 }), 36);
  assert.equal(resolveRowSpacing({ availableHeight: 150, distance: 114, topGap: 6, rows: 6, layout: 'landscape', tallest: 68 }), 12);
});

test('spare height lifts a sparse slot off the axis, capped', () => {
  const demands = demandsFor([0, 500]);
  const low = planSlot({ availableHeight: demands.portrait.need, demands });
  const high = planSlot({ availableHeight: 900, demands });
  assert.equal(high.layout, 'portrait');
  assert.equal(high.distance - low.distance, 110);
});

test('lane heights stay equal unless redistribution yields richer cards', () => {
  const sparse = { demands: demandsFor([0, 600]) };
  const busy = { demands: demandsFor(Array.from({ length: 14 }, (_, i) => i * 45)) };
  assert.equal(allocateLaneHeights({ totalHeight: 900, lanes: [sparse, sparse] }), null);
  // Equal halves already give the best result: no reshuffle.
  assert.equal(allocateLaneHeights({ totalHeight: 740, lanes: [sparse, busy] }), null);

  // Equal halves are just short of large cards for the sparse lane; the busy lane can spare it.
  const upgraded = allocateLaneHeights({ totalHeight: 660, lanes: [sparse, busy] });
  assert.ok(upgraded);
  assert.deepEqual(upgraded.layouts, ['portrait', 'landscape']);
  assert.ok(Math.abs(upgraded.heights[0] + upgraded.heights[1] - 660) <= 1);
  assert.equal(planSlot({ availableHeight: upgraded.heights[0], demands: sparse.demands, previous: 'landscape' }).layout, 'portrait');
  assert.equal(planSlot({ availableHeight: upgraded.heights[1], demands: busy.demands, previous: 'landscape' }).layout, 'landscape');

  // A lane that would overflow at an equal share receives the room it needs.
  const crowded = { demands: demandsFor(Array.from({ length: 24 }, (_, i) => i * 20)) };
  const rescued = allocateLaneHeights({ totalHeight: 500, lanes: [sparse, crowded] });
  assert.ok(rescued);
  assert.ok(rescued.heights[1] > rescued.heights[0], 'the crowded lane receives more room');
  assert.equal(planSlot({ availableHeight: rescued.heights[1], demands: crowded.demands }).overflow, false);

  // Nothing fits anywhere: height follows need so no single lane piles up.
  const squeezed = allocateLaneHeights({ totalHeight: 300, lanes: [sparse, crowded] });
  assert.ok(squeezed);
  assert.deepEqual(squeezed.layouts, ['compact', 'compact']);
  assert.ok(squeezed.heights[1] > 2 * squeezed.heights[0]);
});

test('holdPlanValue keeps a still-valid value until the change is worth it', () => {
  assert.equal(holdPlanValue(null, 80, { hysteresis: 16 }), 80);
  assert.equal(holdPlanValue(80, 90, { hysteresis: 16 }), 80);
  assert.equal(holdPlanValue(80, 96, { hysteresis: 16 }), 96);
  assert.equal(holdPlanValue(80, 70, { hysteresis: 16, max: 75 }), 70, 'a value that no longer fits is dropped');
  assert.equal(holdPlanValue(80, 90, { hysteresis: 16, min: 85 }), 90, 'a value below the minimum is dropped');
});

test('row spacing holds while zooming changes the rows in view only a little', () => {
  const base = { availableHeight: 600, distance: 114, topGap: 6, layout: 'landscape', tallest: 68 };
  // 3 rows -> ideal 78 (full reveal); 4 rows would squeeze to 160.
  assert.equal(resolveRowSpacing({ ...base, rows: 3 }), 78);
  // A slightly taller card comes into view: ideal grows by less than the hysteresis.
  const grown = resolveRowSpacing({ ...base, rows: 3, tallest: 68 + SPACING_HYSTERESIS - 6 });
  assert.equal(resolveRowSpacing({ ...base, rows: 3, tallest: 68 + SPACING_HYSTERESIS - 6, previous: 78 }), 78);
  assert.ok(grown > 78);
  // Much taller: the spacing follows.
  assert.equal(resolveRowSpacing({ ...base, rows: 3, tallest: 120, previous: 78 }), 130);
  // More rows than the held spacing can fit: shrinks at once, regardless of hysteresis.
  const crowded = { ...base, availableHeight: 300, rows: 6 };
  assert.equal(resolveRowSpacing({ ...crowded, previous: 40 }), 36);
});

test('the lift above the axis holds within the hysteresis but needed clearance always wins', () => {
  const demands = demandsFor([0, 400, 800]);
  const fresh = planSlot({ availableHeight: 900, demands });
  // Previous distance a little different: kept.
  const near = planSlot({ availableHeight: 900, demands, previous: fresh.layout, previousDistance: fresh.distance - (DISTANCE_HYSTERESIS - 5) });
  assert.equal(near.distance, fresh.distance - (DISTANCE_HYSTERESIS - 5));
  // Far off: the ideal distance is used.
  const far = planSlot({ availableHeight: 900, demands, previous: fresh.layout, previousDistance: fresh.distance - (DISTANCE_HYSTERESIS + 5) });
  assert.equal(far.distance, fresh.distance);
  // Below the clearance the cards need: never kept, even when close.
  const tooLow = planSlot({ availableHeight: demands.portrait.need, demands });
  const held = planSlot({ availableHeight: demands.portrait.need, demands, previous: tooLow.layout, previousDistance: tooLow.distance - 4 });
  assert.equal(held.distance, tooLow.distance);
  // A distance planned for another layout is ignored.
  const other = planSlot({ availableHeight: 900, demands, previous: 'compact', previousDistance: fresh.distance - 5 });
  assert.equal(other.distance, fresh.distance);
});

test('while a gesture is active a slot never upgrades, but still downgrades to fit', () => {
  const sparse = demandsFor([0, 400, 800]);
  // Room for portrait, currently compact: normally upgrades at once.
  assert.equal(chooseCardLayout({ availableHeight: 900, demands: sparse, previous: 'compact' }), 'portrait');
  // During a gesture the upgrade waits, and the plan says so.
  assert.equal(chooseCardLayout({ availableHeight: 900, demands: sparse, previous: 'compact', holdUpgrades: true }), 'compact');
  const held = planSlot({ availableHeight: 900, demands: sparse, previous: 'compact', holdUpgrades: true });
  assert.equal(held.layout, 'compact');
  assert.equal(held.heldUpgrade, true);
  assert.equal(planSlot({ availableHeight: 900, demands: sparse, previous: 'compact' }).heldUpgrade, false);
  // A crowded slot that no longer fits portrait downgrades even mid-gesture.
  const crowded = demandsFor(Array.from({ length: 12 }, (_, i) => i * 40));
  const down = chooseCardLayout({ availableHeight: 300, demands: crowded, previous: 'portrait', holdUpgrades: true });
  assert.notEqual(down, 'portrait');
  assert.equal(down, chooseCardLayout({ availableHeight: 300, demands: crowded, previous: 'portrait' }));
});

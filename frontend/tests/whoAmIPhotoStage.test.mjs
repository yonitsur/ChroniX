import test from 'node:test';
import assert from 'node:assert/strict';
import { getMysteryPhotoStage } from '../src/components/games/gameUtils.js';

test('5-clue round sharpens monotonically from clue 1 to clue 5', () => {
  const stages = [1, 2, 3, 4, 5].map((clue) => getMysteryPhotoStage(clue, 5, false));

  assert.equal(stages[0].blurPx, 24);
  assert.equal(stages[0].clarityPct, 20);
  assert.ok(stages[4].blurPx > 0 && stages[4].blurPx < 4);
  assert.ok(stages[4].clarityPct >= 90 && stages[4].clarityPct < 100);

  for (let i = 1; i < stages.length; i += 1) {
    assert.ok(stages[i].blurPx < stages[i - 1].blurPx, `blur should decrease at step ${i}`);
    assert.ok(stages[i].scale < stages[i - 1].scale, `scale should decrease at step ${i}`);
    assert.ok(stages[i].clarityPct > stages[i - 1].clarityPct, `clarity should increase at step ${i}`);
  }
});

test('resolved round immediately drops blur to 0px and 100% clarity', () => {
  assert.deepEqual(getMysteryPhotoStage(1, 5, true), {
    blurPx: 0,
    scale: 1,
    clarityPct: 100,
  });
  assert.deepEqual(getMysteryPhotoStage(5, 5, true), {
    blurPx: 0,
    scale: 1,
    clarityPct: 100,
  });
});

test('interpolates cleanly for non-5 clue counts and clamps out-of-range inputs', () => {
  const first3 = getMysteryPhotoStage(1, 3, false);
  const mid3 = getMysteryPhotoStage(2, 3, false);
  const last3 = getMysteryPhotoStage(3, 3, false);

  assert.equal(first3.blurPx, 24);
  assert.equal(mid3.blurPx, 10);
  assert.equal(last3.blurPx, 2.2);

  // Clamping out-of-bounds revealedCount
  assert.deepEqual(getMysteryPhotoStage(0, 5, false), getMysteryPhotoStage(1, 5, false));
  assert.deepEqual(getMysteryPhotoStage(99, 5, false), getMysteryPhotoStage(5, 5, false));
});

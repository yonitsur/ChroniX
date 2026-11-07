import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LAYOUT_SPRING_MAX_DT,
  clampSpringStep,
  stepCriticalSpring,
} from '../src/components/timeline/layoutSpring.js';

const FRAME = 1 / 60;

function run(state, target, seconds, onFrame) {
  let done = false;
  for (let t = 0; t < seconds && !done; t += FRAME) {
    done = stepCriticalSpring(state, target, FRAME);
    onFrame?.(state);
  }
  return done;
}

test('spring glides onto its target in well under the engine move duration, without overshoot', () => {
  const state = { value: 0, velocity: 0 };
  let max = 0;
  let frames = 0;
  const done = run(state, -109, 3, (s) => { frames += 1; max = Math.min(max, s.value); });
  assert.equal(done, true);
  assert.equal(state.value, -109);
  assert.equal(state.velocity, 0);
  assert.ok(max >= -109 - 1e-9, 'critically damped: never overshoots the target');
  // The engine's default move is a 1.5s ease; the spring rests well before that.
  assert.ok(frames * FRAME < 1.4, `settles (${(frames * FRAME).toFixed(2)}s)`);
  // ~95% of the way after ~0.7s, and clearly still gliding at 0.35s (no snap).
  const probe = { value: 0, velocity: 0 };
  for (let t = 0; t < 0.35; t += FRAME) stepCriticalSpring(probe, 100, FRAME);
  assert.ok(probe.value > 55 && probe.value < 85, `midway point (${probe.value.toFixed(1)})`);
  for (let t = 0.35; t < 0.7; t += FRAME) stepCriticalSpring(probe, 100, FRAME);
  assert.ok(probe.value > 90 && probe.value < 100, `95% point (${probe.value.toFixed(1)})`);
});

test('a long move never jumps more than ~20px in a single frame', () => {
  // A card dropping four portrait rows. At the old 0.35s spring this peaked at ~35px per
  // frame, which read as cards snapping into place while zooming.
  const state = { value: 0, velocity: 0 };
  let prev = 0;
  let maxStep = 0;
  run(state, 400, 3, (s) => {
    maxStep = Math.max(maxStep, Math.abs(s.value - prev));
    prev = s.value;
  });
  assert.ok(maxStep <= 20, `largest per-frame step ${maxStep.toFixed(1)}px`);
});

test('re-targeting mid-flight keeps the velocity (no stop-and-restart stall)', () => {
  const state = { value: 0, velocity: 0 };
  for (let t = 0; t < 0.12; t += FRAME) stepCriticalSpring(state, -200, FRAME);
  const speedBefore = state.velocity;
  assert.ok(speedBefore < -100, 'moving fast towards the first target');
  // New target further along the same direction: motion continues without dropping to zero.
  let minSpeed = Infinity;
  for (let i = 0; i < 6; i++) {
    stepCriticalSpring(state, -320, FRAME);
    minSpeed = Math.min(minSpeed, Math.abs(state.velocity));
  }
  assert.ok(minSpeed > Math.abs(speedBefore) * 0.5, 'never stalls after the re-target');
});

test('reversing the target brakes over several frames instead of stopping dead', () => {
  const state = { value: 0, velocity: 0 };
  for (let t = 0; t < 0.1; t += FRAME) stepCriticalSpring(state, -150, FRAME);
  const speedBefore = state.velocity;
  assert.ok(speedBefore < -300);
  // A restarted swing tween drops the speed to exactly 0 on the next frame; the spring
  // keeps moving the old way for a moment and then turns.
  stepCriticalSpring(state, 0, FRAME);
  assert.ok(state.velocity < 0, 'still moving in the original direction right after the reversal');
  assert.ok(Math.abs(state.velocity) > Math.abs(speedBefore) * 0.2, 'no instant stop');
  let turned = false;
  for (let i = 0; i < 30; i++) {
    stepCriticalSpring(state, 0, FRAME);
    if (state.velocity > 0) turned = true;
  }
  assert.ok(turned, 'then heads to the new target');
});

test('steps are frame-rate independent and clamped', () => {
  const a = { value: 0, velocity: 0 };
  const b = { value: 0, velocity: 0 };
  for (let i = 0; i < 12; i++) stepCriticalSpring(a, 50, 1 / 120);
  for (let i = 0; i < 6; i++) stepCriticalSpring(b, 50, 1 / 60);
  assert.ok(Math.abs(a.value - b.value) < 1e-9);
  assert.equal(clampSpringStep(5), LAYOUT_SPRING_MAX_DT);
  assert.equal(clampSpringStep(-1), 0);
  assert.equal(clampSpringStep(NaN), 0);
});

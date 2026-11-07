// Batch 6D (P-26): home-screen ambient animations — 30 fps idle cap, cached halo sprites,
// pause when hidden / off-screen, and a marquee that no longer reads scrollWidth every frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AMBIENT_IDLE_FPS,
  createAnimationGate,
  frameElapsedSeconds,
  observeAnimationGate,
  shouldSkipFrame,
} from '../src/utils/frameThrottle.js';
import {
  HALO_PROFILES,
  HALO_SPRITE_RADIUS_CSS,
  createHaloSpriteCache,
  drawHaloSprite,
  haloSpriteKey,
  haloSpriteRadiusPx,
} from '../src/utils/haloSprites.js';
import {
  MARQUEE_SPEED_PX_PER_SECOND,
  advanceMarquee,
  marqueeSegmentWidth,
  wrapMarqueePosition,
} from '../src/utils/marqueeMotion.js';
import { getZone, projectConstellation, findNearestConstellation } from '../src/utils/constellationLayout.js';
import { CONSTELLATIONS } from '../src/data/constellations.js';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel) => fs.readFileSync(path.join(srcDir, rel), 'utf8');

// Drive a throttled render loop like AmbientAuraBackground: rAF at `hz`, skip frames per the cap,
// advance a clock by clamped real elapsed time.
function simulate({ hz, seconds, fps = AMBIENT_IDLE_FPS, maxSeconds = 0.1 }) {
  let lastFrame = 0;
  let clock = 0;
  let renders = 0;
  const startAt = 1000;
  for (let tick = 0; tick <= Math.round(hz * seconds); tick++) {
    const now = startAt + (tick * 1000) / hz;
    if (fps && shouldSkipFrame(now, lastFrame, fps)) continue;
    clock += frameElapsedSeconds(now, lastFrame, { maxSeconds, firstFrameSeconds: 0 });
    lastFrame = now;
    renders++;
  }
  return { clock, renders };
}

test('idle cap renders ~30 fps on 60, 120 and 144 Hz displays', () => {
  for (const hz of [60, 120, 144]) {
    const { renders } = simulate({ hz, seconds: 2 });
    assert.ok(renders >= 56 && renders <= 62, `${hz} Hz rendered ${renders} frames in 2 s`);
  }
  // 60 Hz renders exactly every other vsync (slack absorbs timestamp jitter).
  assert.equal(shouldSkipFrame(1000 + 16.4, 1000, 30), true);
  assert.equal(shouldSkipFrame(1000 + 33.0, 1000, 30), false);
  assert.equal(shouldSkipFrame(1000, 0, 30), false, 'first frame after reset always renders');
  assert.equal(shouldSkipFrame(1001, 1000, 0), false, 'fps 0 means uncapped');
});

test('animation clock advances by real time regardless of frame rate', () => {
  const uncapped = simulate({ hz: 60, seconds: 3, fps: 0 });
  for (const hz of [60, 120, 144]) {
    const capped = simulate({ hz, seconds: 3 });
    assert.ok(Math.abs(capped.clock - uncapped.clock) < 0.05, `${hz} Hz: ${capped.clock} vs ${uncapped.clock}`);
  }
  // A janky 15 fps cadence still keeps real time thanks to the 0.1 s clamp (the old 0.05 s clamp
  // would have run the sky at 75% speed).
  const janky = simulate({ hz: 15, seconds: 3, fps: 0 });
  assert.ok(Math.abs(janky.clock - 3) < 0.01);
  assert.equal(frameElapsedSeconds(5000, 1000), 0.1, 'long stalls are clamped');
  assert.equal(frameElapsedSeconds(1000, 0, { firstFrameSeconds: 1 / 60 }), 1 / 60);
  assert.equal(frameElapsedSeconds(900, 1000), 0, 'never negative');
});

test('animation gate pauses when hidden or off-screen and resumes once', () => {
  const events = [];
  const gate = createAnimationGate({ onPause: () => events.push('pause'), onResume: () => events.push('resume') });
  assert.equal(gate.isActive(), true);
  gate.setOffscreen(true);
  gate.setHidden(true);
  assert.equal(gate.isActive(), false);
  gate.setOffscreen(false);
  assert.equal(gate.isActive(), false, 'still hidden');
  gate.setHidden(false);
  assert.equal(gate.isActive(), true);
  assert.deepEqual(events, ['pause', 'resume']);
});

test('observeAnimationGate wires visibilitychange and IntersectionObserver, and cleans up', () => {
  const listeners = new Map();
  const fakeDocument = {
    hidden: false,
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); },
  };
  let observerCallback = null;
  let disconnected = false;
  class FakeIntersectionObserver {
    constructor(callback) { observerCallback = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  }
  const saved = { document: globalThis.document, IntersectionObserver: globalThis.IntersectionObserver };
  globalThis.document = fakeDocument;
  globalThis.IntersectionObserver = FakeIntersectionObserver;
  try {
    const gate = createAnimationGate();
    const cleanup = observeAnimationGate(gate, {});
    observerCallback([{ isIntersecting: false }]);
    assert.equal(gate.isActive(), false);
    observerCallback([{ isIntersecting: true }]);
    assert.equal(gate.isActive(), true);
    fakeDocument.hidden = true;
    listeners.get('visibilitychange')();
    assert.equal(gate.isActive(), false);
    cleanup();
    assert.equal(listeners.has('visibilitychange'), false);
    assert.equal(disconnected, true);
  } finally {
    globalThis.document = saved.document;
    globalThis.IntersectionObserver = saved.IntersectionObserver;
  }
});

function fakeCanvasFactory(log) {
  return () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        createRadialGradient: (...args) => {
          const gradient = { args, stops: [], addColorStop: (offset, color) => gradient.stops.push([offset, color]) };
          log.gradients.push(gradient);
          return gradient;
        },
        fillRect: (...args) => log.fills.push(args),
        set fillStyle(value) { log.fillStyle = value; },
      }),
    };
    log.canvases.push(canvas);
    return canvas;
  };
}

test('halo sprites are rendered once per colour/profile and invalidated on reset', () => {
  const log = { canvases: [], gradients: [], fills: [] };
  const cache = createHaloSpriteCache({ createCanvas: fakeCanvasFactory(log) });
  cache.reset(2);
  const a = cache.get(210, 230, 255, 'night');
  const b = cache.get(210, 230, 255, 'night');
  assert.equal(a, b, 'same key reuses the sprite');
  assert.equal(log.canvases.length, 1);
  const c = cache.get(210, 230, 255, 'day');
  const d = cache.get(165, 215, 255, 'night');
  assert.notEqual(a, c);
  assert.notEqual(a, d);
  assert.equal(cache.size, 3);
  assert.equal(a.width, haloSpriteRadiusPx(2) * 2);

  // Gradient is centred, spans the sprite radius and uses the unit-opacity profile.
  const [x0, y0, r0, x1, y1, r1] = log.gradients[0].args;
  assert.deepEqual([x0, y0, r0, x1, y1], [r1, r1, 0, r1, r1]);
  assert.deepEqual(log.gradients[0].stops, [
    [0, 'rgba(210, 230, 255, 1)'],
    [0.45, 'rgba(210, 230, 255, 0.45)'],
    [1, 'rgba(210, 230, 255, 0)'],
  ]);

  cache.reset(1);
  assert.equal(cache.size, 0, 'resize / DPR change drops sprites');
  const e = cache.get(210, 230, 255, 'night');
  assert.notEqual(e, a);
  assert.equal(e.width, haloSpriteRadiusPx(1) * 2);
  assert.equal(cache.get(1, 2, 3, 'unknown'), null);
  assert.notEqual(haloSpriteKey(1, 2, 3, 'day'), haloSpriteKey(1, 2, 3, 'night'));
  assert.notEqual(haloSpriteKey(12, 3, 4, 'day'), haloSpriteKey(1, 23, 4, 'day'));
});

test('stamping a sprite at alpha A matches the old per-frame gradient stops', () => {
  // Old night gradient: stops [min(.85,h), min(.4,.45h), 0] for h = base + alignment * .25.
  for (const base of [0.5, 0.3]) {
    for (let alignment = 0; alignment <= 1; alignment += 0.05) {
      const h = base + alignment * 0.25;
      const old = [Math.min(0.85, h), Math.min(0.4, h * 0.45), 0];
      const viaSprite = HALO_PROFILES.night.map(([, k]) => h * k);
      old.forEach((value, i) => assert.ok(Math.abs(value - viaSprite[i]) < 1e-12));
    }
  }
  assert.deepEqual(HALO_PROFILES.day.map(([o]) => o), [0, 0.45, 1]);
  assert.equal(HALO_PROFILES.day[1][1], 0.42);
  assert.deepEqual(HALO_PROFILES.speck, [[0, 1], [1, 0]]);

  const calls = [];
  const ctx = { globalAlpha: 0.6, drawImage: (...args) => calls.push({ args, alpha: ctx.globalAlpha }) };
  const sprite = {};
  drawHaloSprite(ctx, sprite, 100, 50, 10, 0.5);
  assert.deepEqual(calls[0].args, [sprite, 90, 40, 20, 20]);
  assert.ok(Math.abs(calls[0].alpha - 0.3) < 1e-12, 'multiplies the constellation alpha');
  assert.equal(ctx.globalAlpha, 0.6, 'restores globalAlpha');
  drawHaloSprite(ctx, null, 0, 0, 10, 1);
  drawHaloSprite(ctx, sprite, 0, 0, 10, 0);
  assert.equal(calls.length, 1);
});

test('sprite radius covers the largest halo the sky draws', () => {
  // Night, magnitude < 0, fully aligned, max pulse: 3.2 * 1.3 * 1.0 * 1.18 radius, x3.6 x1.35 halo.
  const largest = 3.2 * 1.3 * 1.0 * 1.18 * 3.6 * 1.35;
  assert.ok(largest < HALO_SPRITE_RADIUS_CSS);
});

test('AmbientAuraBackground no longer builds gradients per frame and pauses off-screen', () => {
  const source = read('components/AmbientAuraBackground.jsx');
  assert.equal(source.includes('createRadialGradient'), false);
  assert.match(source, /observeAnimationGate\(gate, canvas\)/);
  assert.match(source, /shouldSkipFrame\(now, lastFrame, AMBIENT_IDLE_FPS\)/);
  assert.match(source, /haloSprites\.reset\(pixelRatio\)/);
  assert.match(source, /prefers-reduced-motion/);
});

// The pre-change inline marquee step, kept here as the reference behaviour.
function legacyStep(position, scrollWidth, deltaTime) {
  const segmentWidth = scrollWidth / 3;
  if (position === 0 && segmentWidth > 0) position = segmentWidth;
  position += 45 * deltaTime;
  if (position >= segmentWidth * 2) position -= segmentWidth;
  else if (position <= segmentWidth * 0.1) position += segmentWidth;
  return position;
}

test('marquee advance matches the previous inline algorithm', () => {
  let seed = 7;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (const scrollWidth of [3 * 2400, 3 * 1820.5, 900]) {
    let legacy = 0;
    let next = 0;
    for (let i = 0; i < 5000; i++) {
      const dt = Math.min(random() * 0.12, 0.1);
      legacy = legacyStep(legacy, scrollWidth, dt);
      next = advanceMarquee(next, marqueeSegmentWidth(scrollWidth), dt);
      assert.ok(Math.abs(legacy - next) < 1e-9, `diverged at ${i}`);
    }
  }
  assert.equal(advanceMarquee(123, 0, 0.016), 123, 'no movement before layout');
  assert.equal(marqueeSegmentWidth(0), 0);
  assert.equal(wrapMarqueePosition(2000, 1000), 1000);
  assert.equal(wrapMarqueePosition(50, 1000), 1050);
});

test('marquee speed is frame-rate independent', () => {
  for (const hz of [30, 60, 120]) {
    let position = 1000;
    for (let i = 0; i < hz; i++) position = advanceMarquee(position, 1000, 1 / hz);
    assert.ok(Math.abs(position - (1000 + MARQUEE_SPEED_PX_PER_SECOND) ) < 1e-6, `${hz} Hz`);
  }
});

test('PromptExamples measures on resize instead of every frame and pauses off-screen', () => {
  const source = read('components/PromptExamples.jsx');
  const step = source.slice(source.indexOf('const step = (timestamp)'), source.indexOf('const start = () =>'));
  assert.ok(step.length > 0);
  assert.equal(step.includes('el.scrollWidth'), false, 'step must use the cached segment width');
  assert.match(source, /new ResizeObserver\(measure\)/);
  assert.match(source, /observeAnimationGate\(gate, el\)/);
  assert.match(source, /resizeObserver\?\.disconnect\(\)/);
});

test('constellation layout caches zones and computes bounds without extra arrays', () => {
  assert.equal(getZone(3, 1440), getZone(3, 1600), 'same cached desktop zone');
  assert.notEqual(getZone(3, 1440), getZone(3, 390));
  assert.ok(Object.isFrozen(getZone(3, 1440)));
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    CONSTELLATIONS.forEach((data, index) => {
      if (!getZone(index, width).visible) return;
      const pose = projectConstellation(data, index, width, height, 42.5);
      const xs = pose.stars.map(star => star.sx);
      const ys = pose.stars.map(star => star.sy);
      assert.equal(pose.bounds.left, Math.min(...xs));
      assert.equal(pose.bounds.right, Math.max(...xs));
      assert.equal(pose.bounds.top, Math.min(...ys));
      assert.equal(pose.bounds.bottom, Math.max(...ys));
    });
  }
  const poses = CONSTELLATIONS.map((data, index) => getZone(index, 1440).visible
    ? projectConstellation(data, index, 1440, 900, 10) : null);
  const target = poses.find(Boolean).stars[0];
  const nearest = findNearestConstellation(poses, target.sx + 3, target.sy + 4);
  assert.ok(nearest.index >= 0);
  assert.ok(Math.abs(nearest.distance - 5) < 1e-9 || nearest.distance < 5);
  assert.deepEqual(findNearestConstellation(poses, -5000, -5000), { index: -1, distance: Infinity });
});

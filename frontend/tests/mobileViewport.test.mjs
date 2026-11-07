import test from 'node:test';
import assert from 'node:assert/strict';
import { checkIsMobileViewport, WIDE_OR_LANDSCAPE_MEDIA_QUERY } from '../src/hooks/useIsMobileViewport.js';

function withViewport(width, height, fn) {
  const prevWindow = globalThis.window;
  globalThis.window = {
    innerWidth: width,
    innerHeight: height,
    matchMedia(query) {
      assert.equal(query, WIDE_OR_LANDSCAPE_MEDIA_QUERY);
      const isWide = width >= 768;
      const isLandscape = width > height;
      const matches = isWide || (width >= 500 && isLandscape);
      return { matches };
    },
  };
  try {
    return fn();
  } finally {
    globalThis.window = prevWindow;
  }
}

test('mobile portrait viewports stay in mobile mode (including when soft keyboard opens)', () => {
  for (const [w, h] of [
    [320, 568],
    [360, 740],
    [375, 667],
    [390, 844],
    [430, 932],
    // Android portrait with virtual keyboard shrinking height below width
    [412, 360],
    [390, 340],
    // Narrow tall split-screen browser window
    [650, 800],
  ]) {
    assert.equal(
      withViewport(w, h, () => checkIsMobileViewport()),
      true,
      `expected ${w}x${h} to be mobile viewport`
    );
  }
});

test('phone landscape and desktop/tablet viewports use compact wide/desktop layout without mobile mish-mash', () => {
  for (const [w, h] of [
    // Standard modern phones in landscape
    [844, 390],
    [915, 412],
    [932, 430],
    [800, 360],
    // Compact phones in landscape (< 768px wide, e.g. iPhone SE / 360x740 Android / taller foldables)
    [740, 360],
    [667, 375],
    [568, 320],
    [533, 320],
    [720, 540],
    // Tablets and desktops
    [768, 1024],
    [1024, 768],
    [1440, 900],
  ]) {
    assert.equal(
      withViewport(w, h, () => checkIsMobileViewport()),
      false,
      `expected ${w}x${h} to use wide/landscape layout`
    );
  }
});

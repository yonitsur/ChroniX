import { test, expect } from '@playwright/test';
import { mockBackend } from './podcastMocks.js';

// A fading card must fade as one object (group opacity): at opacity 0.5 every pixel of the
// card should be the average of the card fully drawn and the card absent. Previously the
// ChroniX frame (shadow, body, outline) stayed opaque while only the text and photo faded,
// leaving an empty bordered card behind for the rest of the fade.
test('timeline cards fade uniformly as a single layer', async ({ page }) => {
  await mockBackend(page, { timelineId: 'tl-fade', isOwner: false, episodes: [], articleCount: 5 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/t/tl-fade');
  await page.waitForFunction(() => window.__timeline?.articles?.length > 0);
  // Let the initial fit, fades and card glides settle.
  await expect.poll(async () => page.evaluate(() => {
    const tl = window.__timeline;
    return Boolean(tl?.articles?.length) && !tl.articles.some((a) => a.isMoving || a.isFading) && !tl.isAnimating;
  }), { timeout: 15000 }).toBe(true);

  const result = await page.evaluate(() => {
    const tl = window.__timeline;
    const art = tl.articles.find((a) => a.isVisible && !a.isActive && a.position && a.position.left > 60 && a.position.left < tl.width - 300);
    if (!art) return null;
    const ctx = tl.canvasContext;
    const m = ctx.getTransform();
    const x0 = Math.max(0, Math.floor((art.position.left - 4) * m.a));
    const y0 = Math.max(0, Math.floor((art.position.top - 4) * m.d));
    const w = Math.ceil((art.getWidth() + 8) * m.a);
    const h = Math.ceil((art.getHeight() + 8) * m.d);
    const grab = (opacity) => {
      art.opacity = opacity;
      tl.redraw();
      return ctx.getImageData(x0, y0, w, h).data;
    };
    const full = grab(1);
    const half = grab(0.5);
    const none = grab(0);
    art.opacity = 1;
    tl.redraw();
    let off = 0;
    let differs = 0;
    // The canvas is transparent (the page background shows through), so compare
    // premultiplied colour: channel * alpha.
    const pre = (data, i, c) => (c === 3 ? data[i + 3] : (data[i + c] * data[i + 3]) / 255);
    for (let i = 0; i < full.length; i += 4) {
      let pixelDiff = 0;
      for (let c = 0; c < 4; c++) {
        const expected = (pre(full, i, c) + pre(none, i, c)) / 2;
        pixelDiff = Math.max(pixelDiff, Math.abs(pre(half, i, c) - expected));
        if (pre(full, i, c) !== pre(none, i, c)) differs++;
      }
      if (pixelDiff > 3) off++;
    }
    return { pixels: full.length / 4, off, differs };
  });
  expect(result, 'a resting card to test').not.toBeNull();
  expect(result.differs, 'the card is actually drawn in the sampled area').toBeGreaterThan(100);
  // The fade layer may be rasterised on the CPU while the timeline canvas is on the GPU,
  // which anti-aliases glyph edges slightly differently (a few percent of pixels, all on
  // text edges). The bug this guards against - an opaque card shell while only the text
  // fades - puts most of the card's pixels off.
  expect(result.off / result.pixels).toBeLessThan(0.06);
});

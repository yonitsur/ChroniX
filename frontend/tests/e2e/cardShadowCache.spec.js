import { test, expect } from '@playwright/test';

// The timeline stamps pre-rendered card shadows instead of using a live `shadowBlur` on
// every frame (see src/components/timeline/cardShadowCache.js). They must be visually
// indistinguishable from the browser's own shadow at every card size, theme and scale.
test('cached card shadows match native canvas shadows', async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost).*/, (route) => route.abort());
  await page.goto('/tests/perf/vanilla.html').catch(() => {});
  const results = await page.evaluate(async () => {
    const { drawCardShadow } = await import('/src/components/timeline/cardShadowCache.js');
    const shapes = [[150, 330], [240, 72], [198, 36], [226, 44]];
    const styles = [
      { blur: 10, offsetY: 3, color: 'rgba(17, 17, 24, 0.07)', fill: '#ffffff', bg: '#fafafa' },
      { blur: 22, offsetY: 8, color: 'rgba(17, 17, 24, 0.14)', fill: '#ffffff', bg: '#fafafa' },
      { blur: 10, offsetY: 3, color: 'rgba(0, 0, 0, 0.55)', fill: '#15151d', bg: '#0b0b10' },
    ];
    const out = [];
    for (const dpr of [1, 2]) for (const [w, h] of shapes) for (const st of styles) for (const [x, alpha] of [[60, 1], [61.3, 0.5]]) {
      const W = Math.ceil((w + 140) * dpr);
      const H = Math.ceil((h + 120) * dpr);
      const draw = (cached) => {
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = st.bg;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = alpha;
        if (cached) {
          drawCardShadow(ctx, { left: x, top: 50, width: w, height: h, radius: 12, blur: st.blur, offsetY: st.offsetY, color: st.color, fill: st.fill });
          ctx.beginPath();
          ctx.roundRect(x, 50, w, h, 12);
          ctx.fillStyle = st.fill;
          ctx.fill();
        } else {
          ctx.save();
          ctx.shadowColor = st.color;
          ctx.shadowBlur = st.blur;
          ctx.shadowOffsetY = st.offsetY;
          ctx.beginPath();
          ctx.roundRect(x, 50, w, h, 12);
          ctx.fillStyle = st.fill;
          ctx.fill();
          ctx.restore();
        }
        return ctx.getImageData(0, 0, W, H).data;
      };
      const a = draw(false);
      const c = draw(true);
      let max = 0;
      for (let i = 0; i < a.length; i += 4) {
        max = Math.max(max, Math.abs(a[i] - c[i]), Math.abs(a[i + 1] - c[i + 1]), Math.abs(a[i + 2] - c[i + 2]));
      }
      out.push({ dpr, w, h, blur: st.blur, x, alpha, max });
    }
    return out;
  });
  expect(results.length).toBeGreaterThan(0);
  for (const r of results) {
    expect(r.max, `max channel difference for ${JSON.stringify(r)}`).toBeLessThanOrEqual(4);
  }
});

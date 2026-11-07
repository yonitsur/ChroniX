import { test, expect } from '@playwright/test';
import { mockBackend } from './podcastMocks.js';

// Regression: a generation first shows the media-less preview (P-03), then the enriched result
// with the same structure replaces it in place (P-18). The canvas cards must pick up the images
// without leaving and re-entering the timeline.
for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  // Phone portrait: cards are drawn by the Focus Lens, which reads art.data.imageUrl.
  { name: 'mobile', width: 390, height: 844 },
]) test(`enriched result images reach the canvas cards in place (${viewport.name})`, async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await mockBackend(page, { timelineId: 'tl-unused', isOwner: true, episodes: [] });

  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  await page.route('**/enriched-*.png', (route) => route.fulfill({
    status: 200,
    headers: { 'access-control-allow-origin': '*' },
    contentType: 'image/png',
    body: PNG,
  }));

  const now = new Date().toISOString();
  const base = {
    id: 'tl-gen',
    title: 'Generated',
    timeScale: 'calendar',
    lanes: [{ id: 'main', title: 'Main' }],
    timeBands: [],
    createdAt: now,
    updatedAt: now,
  };
  const article = (n, extra = {}) => ({
    id: `evt-${n}`,
    title: `Event number ${n}`,
    subtitle: 'Subtitle',
    lane: 'main',
    from: { year: 1900 + n * 10 },
    rank: 8,
    ...extra,
  });
  const preview = { ...base, isPartial: true, articles: [1, 2, 3].map((n) => article(n)) };
  const enriched = {
    ...base,
    isOwner: true,
    articles: [1, 2, 3].map((n) => article(n, {
      imageUrl: `https://upload.wikimedia.org/enriched-${n}.png`,
      wikiUrl: `https://en.wikipedia.org/wiki/Event_${n}`,
    })),
  };

  let statusCalls = 0;
  let releaseDone = false;
  await page.route('**/api/timeline/generate/start', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ job_id: 'job-gen', status: 'pending' }),
  }));
  await page.route('**/api/timeline/job/status/job-gen*', async (route) => {
    statusCalls += 1;
    const url = new URL(route.request().url());
    const seen = Number(url.searchParams.get('partial_rev') || 0);
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (releaseDone) return json({ status: 'done', result: enriched, timeline_id: 'tl-gen', persisted: true });
    if (seen < 1) return json({ status: 'pending', partial_rev: 1, partial: preview });
    await new Promise((r) => setTimeout(r, 300));
    return json({ status: 'pending', partial_rev: 1 });
  });
  await page.route('**/api/timelines/tl-gen*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(releaseDone ? enriched : preview),
  }));

  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto('/?prompt=' + encodeURIComponent('history of something'));

  // The preview is on the canvas, without images.
  await expect.poll(async () => page.evaluate(() => {
    const art = window.__timeline?.getArticleById?.('evt-1');
    return art ? { hasImage: Boolean(art.data?.rawImageUrl) } : null;
  }), { timeout: 20_000 }).toEqual({ hasImage: false });
  const instanceBefore = await page.evaluate(() => {
    window.__previewTimelineInstance = window.__timeline;
    return Boolean(window.__timeline);
  });
  expect(instanceBefore).toBe(true);

  releaseDone = true;

  // The enriched images arrive on the same canvas instance and load.
  await expect.poll(async () => page.evaluate(() => {
    const tl = window.__timeline;
    const ids = ['evt-1', 'evt-2', 'evt-3'];
    return {
      sameInstance: tl === window.__previewTimelineInstance,
      urls: ids.map((id) => tl?.getArticleById?.(id)?.data?.rawImageUrl || null),
      canvasUrls: ids.map((id) => Boolean(tl?.getArticleById?.(id)?.data?.imageUrl)),
      loaded: ids.map((id) => Boolean(tl?.getArticleById?.(id)?.imageLoaded)),
      wiki: tl?.getArticleById?.('evt-1')?.data?.wikiUrl || null,
    };
  }), { timeout: 20_000 }).toEqual({
    sameInstance: true,
    urls: [1, 2, 3].map((n) => `https://upload.wikimedia.org/enriched-${n}.png`),
    canvasUrls: [true, true, true],
    loaded: [true, true, true],
    wiki: 'https://en.wikipedia.org/wiki/Event_1',
  });
  expect(statusCalls).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});

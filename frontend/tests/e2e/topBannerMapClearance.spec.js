import { test, expect } from '@playwright/test';
import { mockBackend } from './podcastMocks.js';

function boxesOverlap(a, b) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

test('partial timeline banner and floating map capsule never overlap (teaser, hover, and post-enrichment)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  await page.addInitScript(() => {
    localStorage.setItem('chronix_lang', 'en');
    localStorage.setItem('chronix_lang_manual', 'true');
    localStorage.setItem('chronix_tour_seen', '1');
    localStorage.setItem('chronix_mode_onboarded', '1');
  });

  await mockBackend(page, { timelineId: 'tl-unused', isOwner: true, episodes: [] });

  const now = new Date().toISOString();
  const base = {
    id: 'tl-knights',
    title: 'Knights and Samurai: Parallel Evolutions of Medieval Warrior Elites',
    description: 'A comparative chronological study of European feudal knighthood and Japanese bushi.',
    overview: 'During the Middle Ages, both Western Europe and Japan developed sophisticated warrior aristocracies.',
    detectedLanguage: 'en',
    timeScale: 'calendar',
    lanes: [
      { id: 'samurai', title: 'JAPANESE SAMURAI & BUSHI' },
      { id: 'knights', title: 'EUROPEAN FEUDAL KNIGHTS' },
    ],
    timeBands: [],
    createdAt: now,
    updatedAt: now,
  };
  const articles = Array.from({ length: 12 }, (_, i) => ({
    id: `evt-${i + 1}`,
    title: i % 2 === 0 ? 'Establishment of the Kamakura Shogunate' : 'Battle of Agincourt',
    subtitle: 'Warrior elites clash in pivotal medieval engagement',
    lane: i % 2 === 0 ? 'samurai' : 'knights',
    from: { year: 1000 + i * 50 },
    lat: 35.0 + (i % 5),
    lng: 135.0 + (i % 5),
    rank: 9,
  }));

  const preview = { ...base, isPartial: true, articles };
  const enriched = { ...base, isOwner: true, articles };
  let releaseDone = false;

  await page.route('**/api/timeline/generate/start', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ job_id: 'job-knights', status: 'pending' }),
  }));
  await page.route('**/api/timeline/job/status/job-knights*', async (route) => {
    const url = new URL(route.request().url());
    const seen = Number(url.searchParams.get('partial_rev') || 0);
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (releaseDone) return json({ status: 'done', result: enriched, timeline_id: 'tl-knights', persisted: true });
    if (seen < 1) return json({ status: 'pending', partial_rev: 1, partial: preview });
    await new Promise((r) => setTimeout(r, 250));
    return json({ status: 'pending', partial_rev: 1 });
  });
  await page.route('**/api/timelines/tl-knights*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(releaseDone ? enriched : preview),
  }));

  await page.goto('/?prompt=' + encodeURIComponent('Knights and Samurai'));

  const drawer = page.locator('aside.chronix-side-drawer:not([inert])');
  const banner = page.locator('[data-partial-timeline-banner]');
  const mapCapsule = page.locator('.chronix-map-capsule');

  await expect(drawer).toBeVisible({ timeout: 15_000 });
  await expect(banner).toBeVisible();
  await expect(mapCapsule).toBeVisible();

  // 1) With Geo Teaser visible right after load: zero overlap
  const bBox1 = await banner.boundingBox();
  const mBox1 = await mapCapsule.boundingBox();
  expect(bBox1).not.toBeNull();
  expect(mBox1).not.toBeNull();
  expect(boxesOverlap(bBox1, mBox1)).toBe(false);
  expect(mBox1.y).toBeGreaterThanOrEqual(bBox1.y + bBox1.height + 4);

  // 2) Hovering the map capsule so PiP | Split | Full expand: anchor stays pinned on right, zero overlap
  const mapBtn = mapCapsule.locator('button').first();
  const mapBtnBefore = await mapBtn.boundingBox();
  await mapCapsule.hover();
  await page.waitForTimeout(350);

  const bBox2 = await banner.boundingBox();
  const mBox2 = await mapCapsule.boundingBox();
  const mapBtnAfter = await mapBtn.boundingBox();
  expect(boxesOverlap(bBox2, mBox2)).toBe(false);
  expect(mBox2.y).toBeGreaterThanOrEqual(bBox2.y + bBox2.height + 4);
  expect(Math.abs(mapBtnAfter.x - mapBtnBefore.x)).toBeLessThanOrEqual(2);

  // 3) Release enrichment: banner disappears and map capsule smoothly returns to its resting top (~38px)
  releaseDone = true;
  await expect(banner).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(async () => {
    const box = await mapCapsule.boundingBox();
    return box ? Math.round(box.y) : null;
  }).toBeLessThanOrEqual(42);

  await context.close();
});

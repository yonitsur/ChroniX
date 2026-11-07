// The AI-first photo import, end to end in a real browser: photos -> ready card (what they are
// about, who's in them, the cost) -> AI writes every moment, shapes the story and the overview ->
// one review -> "Create my timeline" saves a finished, AI-assisted timeline.
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const PHOTOS = ['lisbon-1.jpg', 'lisbon-2.jpg', 'lisbon-3.jpg', 'porto-1.jpg', 'porto-2.jpg', 'scan-no-date.jpg']
  .map((f) => fileURLToPath(new URL(`./fixtures/photos/${f}`, import.meta.url)));
// A 1x1 PNG saved like an Android screenshot (dated by its name, no camera, no location).
const SCREENSHOT = {
  name: 'Screenshot_20230512-101500.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
};

const REGISTERED_PLAN = {
  tier: 'registered', unlimited: false, draft_events_per_call: 12, draft_images_per_event: 3,
  draft_image_max_px: 384, draft_parallel_calls: 2, geocode_points_per_call: 10,
  max_photos: 2000, max_places: 80, events_per_credit: 12, full_events_per_credit: 8,
  story_events_per_credit: 120, story_max_events: 250,
};
const UNLIMITED_PLAN = {
  ...REGISTERED_PLAN, tier: 'unlimited', unlimited: true, draft_events_per_call: 40, draft_images_per_event: 6,
  draft_image_max_px: 768, draft_parallel_calls: 3, max_photos: null, max_places: null, story_max_events: 600,
};

const draftFor = (e) => {
  const lisbon = e.place === 'Lisbon';
  return {
    id: e.id,
    title: lisbon ? 'Tiles and trams of Alfama' : 'Evening by the Douro',
    caption: lisbon ? 'A morning climbing the hills of Alfama.' : 'Port cellars and the river at dusk.',
    description: lisbon ? 'A morning climbing the hills of Alfama.' : 'Port cellars and the river at dusk.',
    story: lisbon
      ? 'We started early in Alfama, where tiled facades line the narrow lanes. The photos follow the climb past yellow trams to a viewpoint over the river.'
      : 'In Porto the day ended by the Douro: wine cellars on one bank, the old town glowing on the other as the light went down.',
    cover_index: lisbon ? 1 : 0,
    kind: 'moment',
    category: 'Travel',
    importance: lisbon ? 6 : 8,
    occasion: lisbon ? '' : 'Anniversary',
  };
};

async function mockApp(page, { plan = REGISTERED_PLAN, failDrafts = 0, draftDelayMs = 0, mergeAll = false } = {}) {
  const calls = { geocode: [], drafts: [], story: [], overview: [], saved: [] };
  let draftFailures = failDrafts;
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost).*/, (route) => route.abort());
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: '00000000-0000-4000-8000-000000000010', aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {} };
  const accessToken = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, exp, role: 'authenticated', is_anonymous: true })}.sig`;
  await page.route(/\/auth\/v1\/(signup|token)/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ access_token: accessToken, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'refresh', user }),
  }));
  await page.route(/\/auth\/v1\/user/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) }));
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, '');
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/story/photo-import/limits') return json(plan);
    if (path === '/user/quota') {
      return json({ is_admin: false, daily_paid_limit: 25, used_today: 0, remaining_paid: 25, tier: 'paid', mode: 'limited', credit_costs: { text: 1 } });
    }
    if (path === '/timeline/reverse-geocode') {
      const { points } = req.postDataJSON();
      calls.geocode.push(points);
      return json({
        results: points.map((p) => ({
          id: p.id,
          place: p.lat > 40 ? { city: 'Porto', country: 'Portugal', countryCode: 'PT' } : { city: 'Lisbon', country: 'Portugal', countryCode: 'PT' },
        })),
      });
    }
    if (path === '/story/photo-drafts') {
      const body = req.postDataJSON();
      calls.drafts.push(body);
      if (draftDelayMs) await new Promise((r) => setTimeout(r, draftDelayMs));
      if (draftFailures > 0) {
        draftFailures -= 1;
        return json({ detail: 'The model is busy' }, 500);
      }
      return json({ drafts: body.events.map(draftFor), credits: plan.unlimited ? 0 : 1, tier: plan.unlimited ? 'custom' : 'paid' });
    }
    if (path === '/story/photo-story') {
      const body = req.postDataJSON();
      calls.story.push(body);
      return json({
        timeline_title: body.mode === 'add' ? body.existing_title : 'Three days in Portugal',
        story_type: body.mode === 'add' ? 'custom' : 'trip',
        subject_names: body.mode === 'add' ? [] : ['Portugal'],
        lane_title: '',
        chapters: [],
        merges: mergeAll ? [{ event_ids: body.events.map((e) => e.id), title: 'Lisbon to Porto', caption: 'Two cities in three days.' }] : [],
        titles: [],
        highlights: body.events.slice(-1).map((e) => e.id),
        credits: plan.unlimited ? 0 : 1,
      });
    }
    if (path === '/story/overview') {
      const body = req.postDataJSON();
      calls.overview.push(body);
      return json({ overview: '# Three days in Portugal\n\nFrom the hills of Alfama to the banks of the Douro.', credits: 1 });
    }
    if (path === '/timeline/geocode-search') return json({ results: [] });
    if (path === '/timelines' && req.method() === 'POST') {
      const body = req.postDataJSON();
      calls.saved.push(body);
      return json({ ...body, isOwner: true });
    }
    if (path === '/timelines') return json([]);
    if (path === '/library') return json({ items: [], total: 0 });
    return json({});
  });
  return calls;
}

async function openPhotoImport(page) {
  await page.goto('/?ff_story_studio=1');
  await page.getByRole('button', { name: 'Tell Your Story' }).first().click();
  await page.getByTestId('studio-start-photos').click();
  await expect(page.getByTestId('photo-import')).toBeVisible();
}


// The Studio's frame is a guided sequence of sections; each progress segment jumps to one.
const studioSection = (page, label) => page.getByRole('button', { name: label, exact: true }).click();

test('photos in, finished timeline out: ready card, AI build, one review, create', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const calls = await mockApp(page);
  await openPhotoImport(page);
  await expect(page.getByTestId('studio-start-photos')).toHaveCount(0);

  await page.getByTestId('photo-import-input').setInputFiles(PHOTOS);
  const ready = page.getByTestId('photo-ai-ready');
  await expect(ready).toBeVisible();
  await expect(page.getByTestId('photo-ai-found')).toContainText('2 moments in 6 photos');
  // 2 events: 1 look credit + 1 story + 1 overview.
  await expect(page.getByTestId('photo-ai-build-cost')).toContainText('About 3 credits.');
  await expect(page.getByTestId('photo-ai-countdown')).toHaveCount(0); // limited plans confirm first
  await page.getByTestId('photo-ai-context').fill('Our anniversary trip to Portugal');
  await page.getByTestId('photo-ai-people').fill('Dana, Yoni');
  await page.getByTestId('photo-ai-build').click();

  // The review: title, overview, every moment written.
  await expect(page.getByTestId('photo-ai-summary')).toBeVisible();
  await expect(page.getByTestId('photo-ai-title')).toHaveValue('Three days in Portugal');
  await expect(page.getByTestId('photo-ai-overview')).toHaveValue(/hills of Alfama/);
  const cards = page.getByTestId('photo-event');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).getByTestId('photo-event-title')).toHaveValue('Tiles and trams of Alfama');
  await expect(cards.nth(0).getByTestId('photo-event-caption')).toHaveValue('A morning climbing the hills of Alfama.');
  await expect(cards.nth(0).getByTestId('photo-event-story')).toHaveValue(/tiled facades/);
  await expect(cards.nth(1).getByTestId('photo-event-occasion')).toContainText('Anniversary');
  await expect(cards.nth(1).getByTestId('photo-event-highlight')).toBeVisible();

  // What went to the AI: full drafts with the user's words and photos (no coordinates), then
  // the story pass over the drafts, then the overview over the stories.
  expect(calls.drafts).toHaveLength(1);
  const sent = calls.drafts[0];
  expect(sent.detail).toBe('full');
  expect(sent.story_context).toBe('Our anniversary trip to Portugal');
  expect(sent.people).toEqual(['Dana', 'Yoni']);
  expect(sent.events[0].place).toBe('Lisbon');
  expect(sent.events[0].time_text).toMatch(/^\d{2}:\d{2}/);
  expect(sent.events[0].sequence).toContain('trip');
  expect(sent.events[0].images.length).toBeGreaterThan(0);
  expect(sent.events[0]).not.toHaveProperty('lat');
  expect(calls.story).toHaveLength(1);
  expect(calls.story[0].mode).toBe('new');
  expect(calls.story[0].events.map((e) => e.title)).toEqual(['Tiles and trams of Alfama', 'Evening by the Douro']);
  expect(calls.overview).toHaveLength(1);
  expect(calls.overview[0].title).toBe('Three days in Portugal');
  expect(calls.overview[0].moments[0].story).toContain('tiled facades');

  // The user edits a story; it survives.
  await cards.nth(1).getByTestId('photo-event-story').fill('Our anniversary dinner by the Douro.');
  await page.getByTestId('photo-ai-create').click();

  await expect.poll(() => calls.saved.length).toBe(1);
  const saved = calls.saved[0];
  expect(saved.title).toBe('Three days in Portugal');
  expect(saved.overview).toContain('hills of Alfama');
  expect(saved.isManual).toBe(false);
  expect(saved.storyStudio.blueprint).toBe('trip');
  expect(saved.storyStudio.people.p1).toBe('Portugal');
  expect(saved.storyStudio.aiAssisted).toBe(true);
  const lisbon = saved.articles.find((a) => a.title === 'Tiles and trams of Alfama');
  const porto = saved.articles.find((a) => a.title === 'Evening by the Douro');
  expect(lisbon.subtitle).toBe('A morning climbing the hills of Alfama.');
  expect(lisbon.extract).toContain('tiled facades');
  expect(lisbon.extractIsCustom).toBe(true);
  expect(lisbon.category).toBe('Travel');
  expect(lisbon.rank).toBe(6);
  expect(lisbon.aiWritten).toBe(true);
  expect(lisbon.imageUrl).toMatch(/^data:image\/(jpeg|webp);base64,/);
  expect(porto.extract).toBe('Our anniversary dinner by the Douro.');
  expect(porto.rank).toBe(8); // highlight
  expect(errors).toEqual([]);
});

test('admins and own-key users: free, and the build starts by itself', async ({ page }) => {
  const calls = await mockApp(page, { plan: UNLIMITED_PLAN });
  await openPhotoImport(page);
  await page.getByTestId('photo-import-input').setInputFiles(PHOTOS.slice(0, 5));
  await expect(page.getByTestId('photo-ai-build-cost')).toContainText('Free with your plan.');
  await expect(page.getByTestId('photo-ai-countdown')).toBeVisible();
  // Nobody clicks: the countdown runs out and AI builds the timeline.
  await expect(page.getByTestId('photo-ai-summary')).toBeVisible({ timeout: 20_000 });
  expect(calls.drafts).toHaveLength(1);
  expect(calls.drafts[0].events.find((e) => e.place === 'Lisbon').images).toHaveLength(3);
});

test('typing what the photos are about pauses the automatic start', async ({ page }) => {
  const calls = await mockApp(page, { plan: UNLIMITED_PLAN });
  await openPhotoImport(page);
  await page.getByTestId('photo-import-input').setInputFiles(PHOTOS.slice(0, 5));
  await expect(page.getByTestId('photo-ai-countdown')).toBeVisible();
  await page.getByTestId('photo-ai-context').fill('A weekend away');
  await expect(page.getByTestId('photo-ai-countdown')).toHaveCount(0);
  await page.waitForTimeout(7500);
  expect(calls.drafts).toHaveLength(0);
  await page.getByTestId('photo-ai-build').click();
  await expect(page.getByTestId('photo-ai-summary')).toBeVisible();
  expect(calls.drafts[0].story_context).toBe('A weekend away');
});

test('"I\'ll do it myself" opens the classic review with no AI call', async ({ page }) => {
  const calls = await mockApp(page);
  await openPhotoImport(page);
  await page.getByTestId('photo-import-input').setInputFiles(PHOTOS.slice(0, 5));
  await page.getByTestId('photo-ai-manual').click();
  await expect(page.getByTestId('photo-event')).toHaveCount(2);
  await expect(page.getByTestId('photo-ai')).toBeVisible(); // the optional AI button
  await expect(page.getByTestId('photo-preset-more')).toBeVisible();
  await page.getByTestId('photo-import-apply').click();
  await expect(page.getByTestId('photo-import')).toHaveCount(0);
  expect(calls.drafts).toHaveLength(0);
  expect(calls.story).toHaveLength(0);
});

test('screenshots are set aside before anything goes to the AI', async ({ page }) => {
  const calls = await mockApp(page);
  await openPhotoImport(page);
  // Playwright can't mix paths and buffers: send the photos as buffers too.
  const asBuffers = PHOTOS.slice(0, 5).map((p) => ({ name: basename(p), mimeType: 'image/jpeg', buffer: readFileSync(p) }));
  await page.getByTestId('photo-import-input').setInputFiles([...asBuffers, SCREENSHOT]);
  await expect(page.getByTestId('photo-ai-ready')).toContainText('1 screenshots set aside');
  await expect(page.getByTestId('photo-ai-found')).toContainText('2 moments in 6 photos');
  await page.getByTestId('photo-ai-build').click();
  await expect(page.getByTestId('photo-ai-summary')).toBeVisible();
  await expect(page.getByTestId('photo-unassigned')).toContainText(SCREENSHOT.name);
  const sentPhotos = calls.drafts[0].events.reduce((n, e) => n + e.photo_count, 0);
  expect(sentPhotos).toBe(5);
});

test('a failed AI call is reported with a retry, and Create still works', async ({ page }) => {
  const calls = await mockApp(page, { failDrafts: 1 });
  await openPhotoImport(page);
  await page.getByTestId('photo-import-input').setInputFiles(PHOTOS.slice(0, 5));
  await page.getByTestId('photo-ai-build').click();
  await expect(page.getByTestId('photo-ai-retry-note')).toContainText("2 moments weren't written.");
  await page.getByTestId('photo-ai-retry').click();
  await expect(page.getByTestId('photo-ai-retry-note')).toHaveCount(0);
  await expect(page.getByTestId('photo-event').nth(0).getByTestId('photo-event-title')).toHaveValue('Tiles and trams of Alfama');
  // The retry only re-drafts; the story pass and overview ran once.
  expect(calls.drafts).toHaveLength(2);
  expect(calls.story).toHaveLength(1);
  await page.getByTestId('photo-ai-create').click();
  await expect.poll(() => calls.saved.length).toBe(1);
});

test('stopping the build keeps what is done and goes to the review', async ({ page }) => {
  const calls = await mockApp(page, { draftDelayMs: 4000 });
  await openPhotoImport(page);
  await page.getByTestId('photo-import-input').setInputFiles(PHOTOS.slice(0, 5));
  await page.getByTestId('photo-ai-build').click();
  await expect(page.getByTestId('photo-ai-progress')).toBeVisible();
  await expect(page.getByTestId('photo-ai-stage-moments')).toBeVisible();
  await expect.poll(() => calls.drafts.length).toBe(1);
  await page.getByTestId('photo-ai-stop').click();
  await expect(page.getByTestId('photo-ai-summary')).toContainText('Stopped');
  expect(calls.story).toHaveLength(0);
  // "Fine-tune in Story Studio" still hands the moments to the Studio form.
  await page.getByTestId('photo-import-apply').click();
  await expect(page.getByRole('textbox', { name: 'What happened?' })).toHaveCount(2);
});

test('edit mode: photos added to an existing story are written by AI, without touching its title', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const calls = await mockApp(page);
  const existing = {
    id: 'tl-ai-photo',
    title: 'Our Trip to Portugal',
    description: '',
    detectedLanguage: 'en',
    timeScale: 'calendar',
    isPersonal: true,
    isManual: true,
    isOwner: true,
    lanes: [{ id: 'journey', title: 'The journey', order: 1 }],
    timeBands: [],
    storyStudio: { blueprint: 'trip', version: 2, people: { p1: 'Portugal' }, hiddenAutoChapters: [], autoWritten: [] },
    articles: [
      { id: 'flight', title: 'Flying out', lane: 'journey', from: { year: 2023, month: 5, day: 1, precision: 'day' }, rank: 6 },
    ],
  };
  await page.route('**/api/timelines/tl-ai-photo', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(existing) }));
  await page.goto('/t/tl-ai-photo?ff_story_studio=1');
  await page.getByRole('button', { name: 'Edit Timeline' }).first().click();
  await page.getByRole('button', { name: /Continue in Story Studio/ }).click();
  await studioSection(page, 'More moments');
  await page.getByTestId('studio-add-photos').click();
  await page.getByTestId('photo-import-input').setInputFiles(PHOTOS.filter((p) => p.includes('lisbon')));
  // Adding to a story: no overview in the price.
  await expect(page.getByTestId('photo-ai-build-cost')).toContainText('About 2 credits.');
  await page.getByTestId('photo-ai-build').click();
  await expect(page.getByTestId('photo-ai-summary')).toBeVisible();
  await expect(page.getByTestId('photo-ai-title')).toHaveCount(0);
  expect(calls.story[0].mode).toBe('add');
  expect(calls.story[0].existing_title).toBe('Our Trip to Portugal');
  expect(calls.overview).toHaveLength(0);
  await expect(page.getByTestId('photo-ai-create')).toHaveCount(0);
  await page.getByTestId('photo-import-apply').click();
  await expect(page.getByRole('textbox', { name: 'What happened?' })).toHaveCount(2);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => calls.saved.length).toBeGreaterThan(0);
  const saved = calls.saved[calls.saved.length - 1];
  expect(saved.title).toBe('Our Trip to Portugal');
  expect(saved.isManual).toBe(false);
  const added = saved.articles.find((a) => a.title === 'Tiles and trams of Alfama');
  expect(added.extract).toContain('tiled facades');
  expect(added.aiWritten).toBe(true);
  expect(errors).toEqual([]);
});

test('moments the AI joined can be split back with Undo, keeping their drafts', async ({ page }) => {
  await mockApp(page, { mergeAll: true });
  await openPhotoImport(page);
  await page.getByTestId('photo-import-input').setInputFiles(PHOTOS.slice(0, 5));
  await page.getByTestId('photo-ai-build').click();
  const cards = page.getByTestId('photo-event');
  await expect(cards).toHaveCount(1);
  await expect(cards.nth(0).getByTestId('photo-event-title')).toHaveValue('Lisbon to Porto');
  await expect(cards.nth(0)).toContainText('5 photos');
  await expect(page.getByTestId('photo-ai-merged')).toContainText('Joined 1 moments');
  await page.getByTestId('photo-ai-undo-merges').click();
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).getByTestId('photo-event-title')).toHaveValue('Tiles and trams of Alfama');
  await expect(cards.nth(1).getByTestId('photo-event-story')).toHaveValue(/Douro/);
  await expect(page.getByTestId('photo-ai-merged')).toHaveCount(0);
});

// Story Studio photo import, end to end in a real browser: EXIF read by exifr -> grouping ->
// place names -> undated photo dated by hand -> AI drafts -> create -> saved timeline payload.
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const PHOTOS = ['lisbon-1.jpg', 'lisbon-2.jpg', 'lisbon-3.jpg', 'porto-1.jpg', 'porto-2.jpg', 'scan-no-date.jpg']
  .map((f) => fileURLToPath(new URL(`./fixtures/photos/${f}`, import.meta.url)));

const REGISTERED_PLAN = {
  tier: 'registered', unlimited: false, draft_events_per_call: 12, draft_images_per_event: 3,
  draft_image_max_px: 384, draft_parallel_calls: 1, geocode_points_per_call: 10,
  max_photos: 2000, max_places: 80, events_per_credit: 12,
};
const UNLIMITED_PLAN = {
  tier: 'unlimited', unlimited: true, draft_events_per_call: 40, draft_images_per_event: 6,
  draft_image_max_px: 768, draft_parallel_calls: 3, geocode_points_per_call: 25,
  max_photos: null, max_places: null, events_per_credit: 12,
};

async function mockApp(page, { plan = REGISTERED_PLAN } = {}) {
  const calls = { geocode: [], drafts: [], saved: [] };
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost).*/, (route) => route.abort());
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: '00000000-0000-4000-8000-000000000009', aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {} };
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
      return json({ is_admin: false, daily_paid_limit: 10, used_today: 0, remaining_paid: 10, tier: 'paid', mode: 'limited', credit_costs: { text: 1 } });
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
      return json({
        drafts: body.events.map((e) => ({ id: e.id, title: `Golden hour in ${e.place}`, description: `Streets and tiles of ${e.place}.` })),
        credits: plan.unlimited ? 0 : 1,
        tier: plan.unlimited ? 'custom' : 'paid',
      });
    }
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
  await page.goto('/?ff_story_studio=1&ff_photo_ai_first=0');
  await page.getByRole('button', { name: 'Tell Your Story' }).first().click();
  await page.getByTestId('studio-start-photos').click();
  await expect(page.getByTestId('photo-import')).toBeVisible();
}


// The Studio's frame is a guided sequence of sections; each progress segment jumps to one.
const studioSection = (page, label) => page.getByRole('button', { name: label, exact: true }).click();

test('builds a trip timeline from photos: dates, places, undated photo, AI drafts, saved media', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const calls = await mockApp(page);
  await openPhotoImport(page);

  await page.getByTestId('photo-import-input').setInputFiles(PHOTOS);
  await expect(page.getByTestId('photo-import-summary')).toContainText('6 photos · 5 with a date · 5 with a place');
  await expect(page.getByTestId('photo-import-summary')).toContainText('1 without a date');

  const cards = page.getByTestId('photo-event');
  await expect(cards).toHaveCount(2);
  // Places are named: one lookup per event location (sent rounded, never per photo).
  await expect(cards.nth(0).getByTestId('photo-event-title')).toHaveAttribute('placeholder', 'Lisbon');
  await expect(cards.nth(1).getByTestId('photo-event-title')).toHaveAttribute('placeholder', 'Porto');
  expect(calls.geocode.flat().length).toBe(2);
  await expect(cards.nth(0)).toContainText('12 May 2023');
  await expect(cards.nth(0)).toContainText('3 photos');

  // The undated scan waits in the tray; giving it a date moves it into the Porto day.
  const tray = page.getByTestId('photo-unassigned');
  await expect(tray).toContainText('scan-no-date.jpg');
  await tray.getByRole('textbox').fill('14 May 2023');
  await tray.getByRole('textbox').press('Enter');
  await expect(tray).toHaveCount(0);
  await expect(cards.nth(1)).toContainText('3 photos');

  // AI drafts: registered plan -> one batch, one credit.
  await expect(page.getByTestId('photo-ai-cost')).toContainText('2 events · about 1 credit ');
  await page.getByTestId('photo-ai-run').click();
  await expect(cards.nth(0).getByTestId('photo-event-title')).toHaveValue('Golden hour in Lisbon');
  await expect(cards.nth(1).getByTestId('photo-event-title')).toHaveValue('Golden hour in Porto');
  expect(calls.drafts).toHaveLength(1);
  const sent = calls.drafts[0].events;
  expect(sent).toHaveLength(2);
  expect(sent[0].images.length).toBeGreaterThan(0);
  expect(sent[0].images.length).toBeLessThanOrEqual(3);
  expect(sent[0]).not.toHaveProperty('lat');
  expect(sent[0].place).toBe('Lisbon');

  // The user renames one; it must survive.
  await cards.nth(1).getByTestId('photo-event-title').fill('Dinner by the Douro');

  await page.getByTestId('photo-import-apply').click();

  // Back in the frame of the suggested "trip" story, destination filled in.
  await expect(page.getByTestId('photo-import')).toHaveCount(0);
  await studioSection(page, "Who it's about");
  await expect(page.getByRole('textbox', { name: 'Where did you go?' })).toHaveValue('Portugal');
  await studioSection(page, 'More moments');
  const momentTitles = page.getByRole('textbox', { name: 'What happened?' });
  await expect(momentTitles).toHaveCount(2);
  await expect(momentTitles.nth(0)).toHaveValue('Golden hour in Lisbon');
  await expect(momentTitles.nth(1)).toHaveValue('Dinner by the Douro');

  await page.getByRole('button', { name: 'Create my timeline' }).click();
  await expect.poll(() => calls.saved.length).toBe(1);
  const saved = calls.saved[0];
  expect(saved.title).toContain('Portugal');
  expect(saved.storyStudio.blueprint).toBe('trip');
  const lisbon = saved.articles.find((a) => a.title === 'Golden hour in Lisbon');
  const porto = saved.articles.find((a) => a.title === 'Dinner by the Douro');
  expect(lisbon.from).toEqual({ year: 2023, month: 5, day: 12, precision: 'day' });
  expect(lisbon.imageUrl).toMatch(/^data:image\/(jpeg|webp);base64,/);
  expect(lisbon.additionalImages.length).toBe(2);
  expect(lisbon.provenance).toBe('photo');
  expect(lisbon.lat).toBeCloseTo(38.71, 1);
  expect(lisbon.subtitle).toBe('Streets and tiles of Lisbon.');
  expect(porto.from).toEqual({ year: 2023, month: 5, day: 14, precision: 'day' });
  expect(porto.photoSource.count).toBe(3);
  // Stored photos are re-encoded: no EXIF/GPS left inside them.
  const jpeg = Buffer.from(lisbon.imageUrl.split(',')[1], 'base64');
  expect(jpeg.includes(Buffer.from('Exif'))).toBe(false);
  expect(errors).toEqual([]);
});

test('the unlimited plan (admin / own key) shows no credit cost and sends sharper, bigger batches', async ({ page }) => {
  const calls = await mockApp(page, { plan: UNLIMITED_PLAN });
  await openPhotoImport(page);
  await page.getByTestId('photo-import-input').setInputFiles(PHOTOS.slice(0, 5));
  await expect(page.getByTestId('photo-event')).toHaveCount(2);
  await expect(page.getByTestId('photo-ai-cost')).toContainText('unlimited with your plan');
  await page.getByTestId('photo-ai-run').click();
  await expect.poll(() => calls.drafts.length).toBe(1);
  const lisbon = calls.drafts[0].events.find((e) => e.place === 'Lisbon');
  // All 3 Lisbon photos (plan allows 6), at up to 768px.
  expect(lisbon.images).toHaveLength(3);
});

test('regrouping and merging events', async ({ page }) => {
  await mockApp(page);
  await openPhotoImport(page);
  await page.getByTestId('photo-import-input').setInputFiles(PHOTOS.slice(0, 5));
  const cards = page.getByTestId('photo-event');
  await expect(cards).toHaveCount(2);
  await page.getByTestId('photo-preset-more').click();
  // "More" splits after 2-hour pauses; the Lisbon photos are at most 1h35 apart, so they stay together.
  await expect(cards).toHaveCount(2);
  await cards.nth(0).getByRole('button', { name: 'Merge with next' }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.nth(0)).toContainText('5 photos');
  await expect(cards.nth(0)).toContainText('12–14 May 2023');
});

test('edit mode: photos of an existing day attach to that event and are saved', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const calls = await mockApp(page);
  const existing = {
    id: 'tl-photo',
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
      { id: 'wedding', title: 'The wedding', lane: 'journey', from: { year: 2023, month: 5, day: 14, precision: 'day' }, locationName: 'Porto', lat: 41.15, lng: -8.61, imageUrl: 'https://example.org/wedding.jpg', rank: 8 },
    ],
  };
  await page.route('**/api/timelines/tl-photo', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(existing) }));

  await page.goto('/t/tl-photo?ff_story_studio=1&ff_photo_ai_first=0');
  await page.getByRole('button', { name: 'Edit Timeline' }).first().click();
  await page.getByRole('button', { name: /Continue in Story Studio/ }).click();
  await studioSection(page, 'More moments');
  await page.getByTestId('studio-add-photos').click();
  // Only the two Porto photos from the wedding day.
  await page.getByTestId('photo-import-input').setInputFiles(PHOTOS.filter((p) => p.includes('porto')));
  const card = page.getByTestId('photo-event');
  await expect(card).toHaveCount(1);
  await expect(card.getByRole('combobox')).toHaveValue('wedding');
  await page.getByTestId('photo-import-apply').click();
  await expect(page.getByTestId('photo-import')).toHaveCount(0);
  // No new moment rows (only the existing wedding), but the Studio must still save the photos.
  await expect(page.getByRole('textbox', { name: 'What happened?' })).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'What happened?' })).toHaveValue('The wedding');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => calls.saved.length).toBeGreaterThan(0);
  const saved = calls.saved[calls.saved.length - 1];
  const wedding = saved.articles.find((a) => a.id === 'wedding');
  expect(wedding.imageUrl).toBe('https://example.org/wedding.jpg');
  expect(wedding.additionalImages).toHaveLength(2);
  expect(wedding.additionalImages[0].url).toMatch(/^data:image\/(jpeg|webp);base64,/);
  expect(wedding.photoSource.count).toBe(2);
  expect(saved.articles).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('Google Takeout folder: sidecars give dates, places, tagged people and captions to EXIF-less photos', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const calls = await mockApp(page);
  await openPhotoImport(page);
  const folder = fileURLToPath(new URL('./fixtures/takeout', import.meta.url));
  await page.getByTestId('photo-import-folder-input').setInputFiles(folder);
  // 4 photos (metadata.json and sidecars are not counted or "skipped").
  await expect(page.getByTestId('photo-import-summary')).toContainText('4 photos · 4 with a date · 4 with a place');
  await expect(page.getByTestId('photo-import')).toContainText('4 photos matched with their Google Takeout details');
  await expect(page.getByTestId('photo-import')).not.toContainText('skipped');
  const cards = page.getByTestId('photo-event');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('18 Sep 2021');
  await expect(cards.first()).toContainText('Dana, Avi');
  await expect(cards.first().getByTestId('photo-event-title')).toHaveAttribute('placeholder', 'Porto');

  await page.getByTestId('photo-ai-run').click();
  await expect.poll(() => calls.drafts.length).toBe(1);
  const ev = calls.drafts[0].events[0];
  expect(ev.people_tagged).toEqual(['Dana', 'Avi']);
  expect(ev.hint).toBe('Ribeira at last!');
  expect(errors).toEqual([]);
});

test('typed places: photos without location can still be placed (and are geocoded on create)', async ({ page }) => {
  const calls = await mockApp(page);
  await page.route('**/api/timeline/geocode-search**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([{ name: 'Porto', displayName: 'Porto, Portugal', lat: 41.15, lng: -8.61 }]),
  }));
  await openPhotoImport(page);
  // The undated scan has neither date nor place; give it a date, then a place.
  await page.getByTestId('photo-import-input').setInputFiles(PHOTOS.slice(5));
  const tray = page.getByTestId('photo-unassigned');
  await tray.getByRole('textbox').fill('3 March 1998');
  await tray.getByRole('textbox').press('Enter');
  const card = page.getByTestId('photo-event');
  await expect(card).toHaveCount(1);
  await card.getByTestId('photo-event-place').fill('Porto');
  await expect(card.getByTestId('photo-event-title')).toHaveAttribute('placeholder', 'Porto');
  await page.getByTestId('photo-import-apply').click();
  await page.getByRole('button', { name: 'Create my timeline' }).click();
  await expect.poll(() => calls.saved.length).toBe(1);
  const art = calls.saved[0].articles[0];
  expect(art.locationName).toBe('Porto');
  expect(art.from).toEqual({ year: 1998, month: 3, day: 3, precision: 'day' });
  expect(art.lat).toBeCloseTo(41.15, 2);
});

// Google Identity Services and our Google Photos endpoints, mocked: consent succeeds with a
// token, and the picking session reports a pick on its `pickAfterPolls`-th poll (never if null).
async function mockGoogle(page, { pickAfterPolls = 2 } = {}) {
  await page.addInitScript(() => {
    const oauth2 = {
      initTokenClient: ({ callback }) => ({ requestAccessToken: () => setTimeout(() => callback({ access_token: 'GTOKEN', expires_in: 3600 }), 20) }),
      hasGrantedAllScopes: () => true,
    };
    window.google = { accounts: { oauth2, id: { initialize() {}, prompt() {}, renderButton() {}, cancel() {}, disableAutoSelect() {} } } };
  });
  const jpeg = readFileSync(fileURLToPath(new URL('./fixtures/photos/porto-1.jpg', import.meta.url)));
  const gp = { sessionPolls: 0, mediaSizes: [], tokens: new Set(), deleted: 0 };
  await page.route('**/api/google-photos/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    gp.tokens.add(req.headers()['x-google-photos-token']);
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/google-photos/sessions') && req.method() === 'POST') {
      return json({ id: 's1', pickerUri: 'https://photos.google.com/picker/s1', mediaItemsSet: false, pollInterval: '1s', timeoutIn: '60s' });
    }
    if (url.pathname.endsWith('/sessions/s1') && req.method() === 'GET') {
      gp.sessionPolls += 1;
      return json({ id: 's1', mediaItemsSet: pickAfterPolls != null && gp.sessionPolls >= pickAfterPolls, pollInterval: '1s' });
    }
    if (url.pathname.endsWith('/sessions/s1') && req.method() === 'DELETE') {
      gp.deleted += 1;
      return json({ ok: true });
    }
    if (url.pathname.endsWith('/sessions/s1/items')) {
      const second = url.searchParams.get('page_token') === 'p2';
      return json(second
        ? { items: [{ id: 'm2', createTime: '2023-05-14T18:40:00Z', baseUrl: 'https://lh3.googleusercontent.com/ppa/m2', mimeType: 'image/heic', filename: 'IMG_0002.HEIC' }], skipped: 1, nextPageToken: null }
        : { items: [{ id: 'm1', createTime: '2023-05-14T17:20:00Z', baseUrl: 'https://lh3.googleusercontent.com/ppa/m1', mimeType: 'image/jpeg', filename: 'IMG_0001.JPG' }], skipped: 0, nextPageToken: 'p2' });
    }
    if (url.pathname.endsWith('/google-photos/media')) {
      gp.mediaSizes.push(Number(url.searchParams.get('size')));
      return route.fulfill({ status: 200, contentType: 'image/jpeg', body: jpeg });
    }
    return route.fulfill({ status: 404, body: '{}' });
  });
  return gp;
}

test.describe('Google Photos', () => {
  test.use({ timezoneId: 'Europe/Lisbon' });

  test('one click signs in and opens the picker, imports dates (no places), and saves resized photos', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    const calls = await mockApp(page);
    const gp = await mockGoogle(page);

    await openPhotoImport(page);
    const popupPromise = page.waitForEvent('popup');
    await page.getByTestId('photo-import-google-btn').click(); // sign-in, then straight to the picker
    const popup = await popupPromise;
    await expect.poll(() => popup.url()).toContain('photos.google.com/picker/s1/autoclose');

    await expect(page.getByTestId('photo-import-summary')).toContainText('2 photos · 2 with a date · 0 with a place');
    await expect(page.getByTestId('photo-import')).toContainText('2 photos added from Google Photos');
    await expect(page.getByTestId('photo-import')).toContainText('1 videos skipped');
    await expect(page.getByTestId('photo-import-no-places')).toContainText('Google Photos never shares');
    const card = page.getByTestId('photo-event');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('14 May 2023');
    await expect.poll(() => gp.mediaSizes.includes(320)).toBe(true); // thumbnails, not originals

    await card.getByTestId('photo-event-place').fill('Porto');
    await page.getByTestId('photo-import-apply').click();
    await page.getByRole('button', { name: 'Create my timeline' }).click();
    await expect.poll(() => calls.saved.length).toBe(1);
    const art = calls.saved[0].articles[0];
    expect(art.imageUrl).toMatch(/^data:image\/(jpeg|webp);base64,/);
    expect(art.additionalImages).toHaveLength(1);
    expect(art.locationName).toBe('Porto');
    expect(gp.mediaSizes).toContain(800);  // cover
    expect(gp.mediaSizes).toContain(640);  // gallery
    expect(Math.max(...gp.mediaSizes)).toBeLessThanOrEqual(800);
    expect([...gp.tokens]).toEqual(['GTOKEN']);
    expect(errors).toEqual([]);
  });

  test('offers the picker as a button when the browser blocks its window', async ({ page }) => {
    await mockApp(page);
    await mockGoogle(page);
    // A popup blocker: only windows opened while a click is being handled get through (Google's
    // sign-in popup uses up the click in real browsers, so the picker window opened after it is blocked).
    await page.addInitScript(() => {
      const open = window.open.bind(window);
      let inClick = false;
      document.addEventListener('click', () => {
        inClick = true;
        setTimeout(() => { inClick = false; }, 0);
      }, true);
      window.open = (...args) => (inClick ? open(...args) : null);
    });
    await openPhotoImport(page);
    await page.getByTestId('photo-import-google-btn').click();
    const openBtn = page.getByTestId('photo-import-google-open');
    await expect(openBtn).toBeVisible();
    const popupPromise = page.waitForEvent('popup');
    await openBtn.click();
    const popup = await popupPromise;
    await expect.poll(() => popup.url()).toContain('photos.google.com/picker/s1/autoclose');
    await expect(page.getByTestId('photo-import-summary')).toContainText('2 photos');
  });

  test('closing the Google Photos window ends the wait without another click', async ({ page }) => {
    await mockApp(page);
    const gp = await mockGoogle(page, { pickAfterPolls: null });
    await openPhotoImport(page);
    const popupPromise = page.waitForEvent('popup');
    await page.getByTestId('photo-import-google-btn').click();
    const popup = await popupPromise;
    await expect(page.getByTestId('photo-import-google-stop')).toBeVisible();
    // The user closes the picker: our page loses focus to it, then gets it back.
    await popup.close();
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
    });
    await expect(page.getByTestId('photo-import-google')).toContainText('Google Photos was closed', { timeout: 15_000 });
    await expect(page.getByTestId('photo-import-google-btn')).toBeEnabled();
    await expect.poll(() => gp.deleted).toBe(1);
  });
});

test.describe('on an iPhone', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', viewport: { width: 1280, height: 800 } });
  test('explains how to keep locations before picking, and why they are missing after', async ({ page }) => {
    await mockApp(page);
    await openPhotoImport(page);
    await expect(page.getByTestId('photo-import-phone-tip')).toContainText('tap "Options"');
    // A dated photo with no location, as iOS uploads it by default.
    await page.getByTestId('photo-import-input').setInputFiles(PHOTOS.slice(5));
    await page.getByTestId('photo-unassigned').getByRole('textbox').fill('3 March 1998');
    await page.getByTestId('photo-unassigned').getByRole('textbox').press('Enter');
    await expect(page.getByTestId('photo-import-no-places')).toContainText('tap "Options"');
  });
});

test('the Google Photos guide explains both options, links out, and closes with Escape', async ({ page }) => {
  await mockApp(page);
  await openPhotoImport(page);
  await page.getByTestId('photo-import-guide-link').click();
  const guide = page.getByTestId('google-photos-guide');
  await expect(guide).toBeVisible();
  await expect(guide.getByTestId('guide-takeout').locator('li')).toHaveCount(10);
  await expect(guide.getByTestId('guide-album').locator('li')).toHaveCount(4);
  await expect(guide).toContainText('Deselect all');
  await expect(guide).toContainText('Extract All');
  for (const [id, href] of [['guide-takeout-link', 'https://takeout.google.com'], ['guide-photos-link', 'https://photos.google.com']]) {
    await expect(guide.getByTestId(id)).toHaveAttribute('href', href);
    await expect(guide.getByTestId(id)).toHaveAttribute('target', '_blank');
    await expect(guide.getByTestId(id)).toHaveAttribute('rel', /noopener/);
  }
  // Escape closes only the guide; the photo panel stays open.
  await page.keyboard.press('Escape');
  await expect(guide).toHaveCount(0);
  await expect(page.getByTestId('photo-import')).toBeVisible();
});

test('importing the same photos again adds no duplicates', async ({ page }) => {
  await mockApp(page);
  await openPhotoImport(page);
  await page.getByTestId('photo-import-input').setInputFiles(PHOTOS.slice(0, 5));
  await expect(page.getByTestId('photo-event')).toHaveCount(2);
  await page.getByTestId('photo-import-input').setInputFiles(PHOTOS.slice(0, 5));
  await expect(page.getByTestId('photo-import')).toContainText('5 duplicate photos skipped');
  await expect(page.getByTestId('photo-import-summary')).toContainText('5 photos');
  await expect(page.getByTestId('photo-event')).toHaveCount(2);
});

test('date detail: "Day & time" saves the photos\' times', async ({ page }) => {
  const calls = await mockApp(page);
  await openPhotoImport(page);
  await page.getByTestId('photo-import-input').setInputFiles(PHOTOS.slice(0, 5));
  const cards = page.getByTestId('photo-event');
  await expect(cards).toHaveCount(2);
  await page.getByTestId('photo-date-detail').selectOption('time');
  await expect(cards.nth(0)).toContainText('09:10–11:40');
  await page.getByTestId('photo-import-apply').click();
  await page.getByRole('button', { name: 'Create my timeline' }).click();
  await expect.poll(() => calls.saved.length).toBe(1);
  const lisbon = calls.saved[0].articles.find((a) => a.from.day === 12);
  expect(lisbon.from).toEqual({ year: 2023, month: 5, day: 12, hour: 9, minute: 10, precision: 'minute' });
  expect(lisbon.to).toEqual({ year: 2023, month: 5, day: 12, hour: 11, minute: 40, precision: 'minute' });
});

test('AI place guesses for photos without a location: badge, suggestion, geocoded on create', async ({ page }) => {
  const calls = await mockApp(page);
  // Override the draft mock: recognise the places (only for events that asked).
  await page.route('**/api/story/photo-drafts', async (route) => {
    const body = route.request().postDataJSON();
    calls.drafts.push(body);
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      credits: 1,
      drafts: body.events.map((e, i) => ({
        id: e.id, title: `Moment ${i + 1}`, description: '',
        ...(e.needs_place ? (i === 0 ? { place_guess: 'Belém Tower, Lisbon, Portugal', place_confidence: 'high' } : { place_guess: 'Ribeira, Porto, Portugal', place_confidence: 'medium' }) : {}),
      })),
    }) });
  });
  await page.route('**/api/timeline/geocode-search**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([{ name: 'Belém Tower', lat: 38.6916, lng: -9.216 }]),
  }));
  await openPhotoImport(page);
  // Two undated scans, dated by hand on two days: no GPS at all.
  await page.getByTestId('photo-import-input').setInputFiles([PHOTOS[5]]);
  await page.getByTestId('photo-unassigned').getByRole('textbox').fill('3 March 1998');
  await page.getByTestId('photo-unassigned').getByRole('textbox').press('Enter');
  const cards = page.getByTestId('photo-event');
  await expect(cards).toHaveCount(1);
  await page.getByTestId('photo-ai-run').click();
  await expect.poll(() => calls.drafts.length).toBe(1);
  expect(calls.drafts[0].events[0].needs_place).toBe(true);
  await expect(cards.first().getByTestId('photo-event-place')).toHaveValue('Belém Tower, Lisbon, Portugal');
  await expect(cards.first().getByTestId('photo-place-ai')).toBeVisible();

  await page.getByTestId('photo-import-apply').click();
  await page.getByRole('button', { name: 'Create my timeline' }).click();
  await expect.poll(() => calls.saved.length).toBe(1);
  const art = calls.saved[0].articles[0];
  expect(art.locationName).toBe('Belém Tower, Lisbon, Portugal');
  expect(art.lat).toBeCloseTo(38.69, 1);
});

test('signed-in users keep every photo in their hosted library (links, not inline); a failed upload keeps a small cover', async ({ page }) => {
  const calls = await mockApp(page, { plan: { ...REGISTERED_PLAN, hosted_photos: { enabled: true, quota: 2000, used: 10 } } });
  const uploads = [];
  await page.route('**/api/photos', async (route) => {
    const n = uploads.length + 1;
    uploads.push(route.request().headers()['content-type']);
    if (n === 4) return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ detail: 'storage down' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: `https://proj.supabase.co/storage/v1/object/public/timeline-photos/u/${'a'.repeat(20)}/${String(n).padStart(32, '0')}.webp`, used: 10 + n, quota: 2000 }) });
  });
  await openPhotoImport(page);
  await page.getByTestId('photo-import-input').setInputFiles(PHOTOS.slice(0, 5));
  await expect(page.getByTestId('photo-event')).toHaveCount(2);
  await expect(page.getByTestId('photo-storage')).toContainText('5 of 5 photos kept · your photo library: 15 of 2000');
  await page.getByTestId('photo-import-apply').click();
  await page.getByRole('button', { name: 'Create my timeline' }).click();
  await expect.poll(() => calls.saved.length).toBe(1);
  expect(uploads).toHaveLength(5);
  expect(uploads.every((c) => c.startsWith('multipart/form-data'))).toBe(true);
  const arts = calls.saved[0].articles;
  const urls = arts.flatMap((a) => [a.imageUrl, ...(a.additionalImages || []).map((g) => g.url)]);
  // The 4 successful uploads are stored as links; the failed one never leaves an event without a cover.
  expect(urls.filter((u) => u.startsWith('https://proj.supabase.co/')).length).toBe(4);
  expect(urls.every((u) => u.startsWith('https://proj.supabase.co/') || u.startsWith('data:image/'))).toBe(true);
  expect(arts.every((a) => a.imageUrl)).toBe(true);
});

test('the Studio canvas shows imported photos and refreshes on Apply, not per keystroke', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApp(page);
  await openPhotoImport(page);
  await page.getByTestId('photo-import-input').setInputFiles(PHOTOS.slice(0, 3));
  await expect(page.getByTestId('photo-event')).toHaveCount(1);
  await page.getByTestId('photo-import-apply').click();

  // Landing in the frame applies automatically: the real canvas is beside the form, photos included.
  const pane = page.getByTestId('studio-canvas-pane');
  await expect(pane).toBeVisible();
  await expect(page.getByTestId('studio-canvas-apply')).toHaveCount(0);
  await expect(pane.locator('canvas').first()).toBeVisible();

  // Typing only marks the canvas out of date; Apply (or Ctrl+Enter) refreshes it.
  await page.getByRole('textbox', { name: 'What happened?' }).first().fill('Tiles of Lisbon');
  await expect(page.getByTestId('studio-canvas-apply')).toBeVisible();
  await page.getByTestId('studio-canvas-apply').click();
  await expect(page.getByTestId('studio-canvas-apply')).toHaveCount(0);
  // Ctrl+Enter applies too.
  await page.getByRole('textbox', { name: 'What happened?' }).first().fill('Tiles of old Lisbon');
  await expect(page.getByTestId('studio-canvas-apply')).toBeVisible();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('studio-canvas-apply')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the Studio preview opens editable event details and an optional map', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApp(page);
  await openPhotoImport(page);
  await page.getByTestId('photo-import-input').setInputFiles(PHOTOS.slice(0, 3));
  await expect(page.getByTestId('photo-event')).toHaveCount(1);
  await page.getByTestId('photo-import-apply').click();

  const pane = page.getByTestId('studio-canvas-pane');
  await expect(pane.locator('canvas').first()).toBeVisible();
  await expect(page.getByTestId('studio-preview-map')).toHaveCount(0);

  // The map is opt-in; the photos' GPS puts the event on it.
  await page.getByTestId('studio-preview-map-toggle').click();
  const map = page.getByTestId('studio-preview-map');
  await expect(map).toBeVisible();
  const pin = map.locator('.chronix-custom-pin').first();
  await expect(pin).toBeVisible();

  // Clicking the pin opens the real details drawer inside the preview pane, editable (edits go
  // back into the Studio form - see storyStudioDetails.spec.js). No Videos tab on a personal story.
  await pin.click();
  const drawer = pane.locator('.chronix-side-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('Lisbon');
  await expect(drawer.getByRole('button', { name: 'Edit Event' })).toBeVisible();
  await expect(drawer.getByRole('tab', { name: /Videos/ })).toHaveCount(0);

  // Escape closes the details first and leaves the Studio open.
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(pane).toBeVisible();

  // Hiding the map is remembered for the next preview.
  await page.getByTestId('studio-preview-map-toggle').click();
  await expect(map).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('chronix_studio_preview_map_v1'))).toBe('0');
  expect(errors).toEqual([]);
});

test('the Studio preview map looks up typed places once and reuses them on create', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const calls = await mockApp(page);
  const lookups = [];
  await page.route('**/api/timeline/geocode-search**', (route) => {
    lookups.push(route.request().url());
    return route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([{ name: 'Porto', displayName: 'Porto, Portugal', lat: 41.15, lng: -8.61 }]),
    });
  });
  await openPhotoImport(page);
  await page.getByTestId('photo-import-input').setInputFiles(PHOTOS.slice(5));
  const tray = page.getByTestId('photo-unassigned');
  await tray.getByRole('textbox').fill('3 March 1998');
  await tray.getByRole('textbox').press('Enter');
  await page.getByTestId('photo-event').getByTestId('photo-event-place').fill('Porto');
  await page.getByTestId('photo-import-apply').click();

  await page.getByTestId('studio-preview-map-toggle').click();
  await expect(page.getByTestId('studio-preview-map').locator('.chronix-custom-pin').first()).toBeVisible();
  expect(lookups.length).toBe(1);

  await page.getByRole('button', { name: 'Create my timeline' }).click();
  await expect.poll(() => calls.saved.length).toBe(1);
  expect(calls.saved[0].articles[0].lat).toBeCloseTo(41.15, 2);
  expect(lookups.length).toBe(1);
});

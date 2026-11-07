// Story Studio's ways to start, end to end in a real browser: documents first, then photos, then a
// blank canvas; leaving the photo panel; and a timeline drafted by AI from pasted text that is
// reviewed in the Studio (with the canvas preview) before it is created.
import { test, expect } from '@playwright/test';

const EXTRACTED = {
  id: 'tl-docs-1',
  version: 1,
  title: 'Grandma Rosa',
  overview: '',
  isPersonal: false,
  creationSource: 'files',
  lanes: [{ id: 'life', title: 'Life' }],
  timeBands: [],
  articles: [
    { id: 'a1', title: 'Born in Naples', lane: 'life', from: { year: 1931, month: 4, day: 2, precision: 'day' }, locationName: 'Naples', extract: 'Rosa was born in Naples.' },
    { id: 'a2', title: 'Sailed to New York', lane: 'life', from: { year: 1952, precision: 'year' }, extract: 'She left by ship.' },
  ],
};

async function mockApp(page) {
  const calls = { generate: [], saved: [], cancelled: [] };
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost).*/, (route) => route.abort());
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: '00000000-0000-4000-8000-000000000012', aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {} };
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
    if (path === '/user/quota') {
      return json({ is_admin: false, daily_paid_limit: 10, used_today: 0, remaining_paid: 10, tier: 'paid', mode: 'limited', credit_costs: { text: 1 } });
    }
    if (path === '/timeline/generate-from-files/start') {
      calls.generate.push(req.postData() || '');
      return json({ job_id: 'job-docs' });
    }
    if (path.startsWith('/timeline/job/status/job-docs')) return json({ status: 'done', result: EXTRACTED });
    if (path.startsWith('/timeline/job/cancel')) {
      calls.cancelled.push(path);
      return json({ status: 'cancelled' });
    }
    if (path.startsWith('/timeline/geocode-search')) return json([]);
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

async function openStudio(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Tell Your Story' }).first().click();
  await expect(page.getByTestId('studio-start-options')).toBeVisible();
}

test.use({ viewport: { width: 1440, height: 900 } });

test('documents and photos lead at the top; guided story templates and a blank canvas follow below, all inside the Studio', async ({ page }) => {
  await mockApp(page);
  await openStudio(page);
  await expect(page.getByRole('heading', { name: 'Whose story would you like to tell?' })).toBeVisible();
  await expect(page.getByTestId('studio-blueprints').locator('button')).toHaveCount(7);
  const options = page.getByTestId('studio-start-options').locator('> button');
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toHaveAttribute('data-testid', 'studio-start-docs');
  await expect(options.nth(1)).toHaveAttribute('data-testid', 'studio-start-photos');
  const optionsBox = await page.getByTestId('studio-start-options').boundingBox();
  const blueprintsBox = await page.getByTestId('studio-blueprints').boundingBox();
  expect(optionsBox.y).toBeLessThan(blueprintsBox.y);
  await expect(page.getByTestId('studio-start-blank')).toBeVisible();

  // Photos: the panel has a clear way back to the ways to start.
  await page.getByTestId('studio-start-photos').click();
  await expect(page.getByTestId('photo-import')).toBeVisible();
  await page.getByTestId('photo-import-back').click();
  await expect(page.getByTestId('studio-start-options')).toBeVisible();

  // Documents: the same, full width (nothing to preview until the AI has drafted the timeline).
  await page.getByTestId('studio-start-docs').click();
  await expect(page.getByTestId('doc-import')).toBeVisible();
  await expect(page.getByTestId('studio-canvas-pane')).toHaveCount(0);
  await page.getByTestId('doc-import-back').click();
  await expect(page.getByTestId('studio-start-options')).toBeVisible();

  // Blank canvas: the free-form frame (it starts by naming its lanes), in the Studio, with the same top back button.
  await page.getByTestId('studio-start-blank').click();
  await expect(page.getByRole('heading', { name: 'What are the threads of your story?' })).toBeVisible();
  await expect(page.getByTestId('story-spine')).toBeVisible();
  await expect(page.getByTestId('studio-canvas-pane')).toBeVisible();
  await page.getByTestId('studio-frame-back').click();
  await expect(page.getByTestId('studio-start-options')).toBeVisible();
});

test('pasted text is drafted by AI, reviewed with a preview in the Studio, then created', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const calls = await mockApp(page);
  await openStudio(page);

  await page.getByTestId('studio-start-docs').click();
  await page.getByTestId('doc-import-tab-paste').click();
  await page.getByTestId('doc-import-text').fill('Rosa was born in Naples in 1931 and sailed to New York in 1952.');
  await page.getByTestId('doc-import-generate').click();

  await expect(page.getByRole('heading', { name: 'Review your timeline' })).toBeVisible();
  expect(calls.generate).toHaveLength(1);
  expect(calls.generate[0]).toContain('sailed to New York');
  await expect(page.locator('input[value="Born in Naples"]')).toBeVisible();
  await expect(page.locator('input[value="Sailed to New York"]')).toBeVisible();
  await expect(page.getByTestId('studio-canvas-pane')).toBeVisible();
  expect(calls.saved).toHaveLength(0); // nothing is created before the review

  // Fix a title in the review, then create.
  await page.locator('input[value="Sailed to New York"]').fill('Sailed to America');
  await page.getByRole('button', { name: 'Create my timeline' }).click();
  await expect.poll(() => calls.saved.length).toBe(1);
  const saved = calls.saved[0];
  expect(saved.id).toBe('tl-docs-1');
  expect(saved.isPersonal).toBe(true);
  expect(saved.articles.map((a) => a.title)).toEqual(expect.arrayContaining(['Born in Naples', 'Sailed to America']));
  expect(saved.articles.find((a) => a.title === 'Born in Naples').extract).toBe('Rosa was born in Naples.');
  await expect(page.getByTestId('studio-start-options')).toBeHidden();
  expect(errors).toEqual([]);
});

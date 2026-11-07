// Story Studio, end to end in a real browser: notes on a moment written up by AI, an AI-drafted
// overview, editing an event and the overview inside the canvas preview, and the saved payload.
import { test, expect } from '@playwright/test';

async function mockApp(page) {
  const calls = { polish: [], overview: [], saved: [] };
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost).*/, (route) => route.abort());
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: '00000000-0000-4000-8000-000000000011', aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {} };
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
    if (path.startsWith('/timeline/geocode-search')) {
      return json([{ name: 'Lisbon', displayName: 'Lisbon, Portugal', lat: 38.72, lng: -9.14 }]);
    }
    if (path === '/text/polish') {
      const body = req.postDataJSON();
      calls.polish.push(body);
      return json({ text: 'We met at a friend\'s wedding in Lisbon and danced until the band packed up.', credits: 1 });
    }
    if (path === '/story/overview') {
      const body = req.postDataJSON();
      calls.overview.push(body);
      return json({ overview: '## How it began\n\nClaire and Ethan met in Lisbon in October 2019.', credits: 1 });
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

test.use({ viewport: { width: 1440, height: 900 } });

// The Studio's frame is a guided sequence of sections; each progress segment jumps to one.
const studioSection = (page, label) => page.getByRole('button', { name: label, exact: true }).click();

test('notes, AI write-up, AI overview and editing inside the preview all reach the saved timeline', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const calls = await mockApp(page);
  await page.goto('/?ff_story_studio=1');
  await page.getByRole('button', { name: 'Tell Your Story' }).first().click();
  await page.getByRole('button', { name: /Couple & wedding/ }).click();

  await page.getByPlaceholder('e.g. Claire').fill('Claire');
  await page.getByPlaceholder('e.g. Ethan').fill('Ethan');
  await studioSection(page, 'Key moments');
  const met = page.locator('[data-studio-row="a-met"]');
  await met.getByPlaceholder('When?').fill('October 2019');
  await met.getByPlaceholder('Where? (optional)').fill('Lisbon');

  // Notes on the moment, written out by AI.
  await met.getByTestId('studio-notes-toggle').click();
  await met.getByPlaceholder(/What do you remember/).fill('friend wedding, danced till the band left');
  await met.getByTestId('ai-polish-moment_story').click();
  await expect(met.getByPlaceholder(/What do you remember/)).toHaveValue(/danced until the band packed up/);
  expect(calls.polish[0].field).toBe('moment_story');
  expect(calls.polish[0].context).toContain('October 2019');

  // The overview, drafted from the story's facts.
  await studioSection(page, 'Finish');
  const overviewSection = page.getByTestId('studio-overview-section');
  await overviewSection.getByTestId('studio-overview-draft').click();
  await expect(overviewSection.locator('textarea')).toHaveValue(/## How it began/);
  const facts = calls.overview[0];
  expect(facts.people).toEqual(['Claire', 'Ethan']);
  const metFact = facts.moments.find((m) => m.title === 'Claire & Ethan meet');
  expect(metFact.place).toBe('Lisbon');
  expect(metFact.story).toContain('danced until the band packed up');

  // Open the event from the preview map and edit it in the drawer.
  await page.getByTestId('studio-canvas-apply').click().catch(() => {});
  await page.getByTestId('studio-preview-map-toggle').click();
  const marker = page.locator('[data-testid="studio-preview-map"] .leaflet-marker-icon').first();
  await expect(marker).toBeVisible({ timeout: 15_000 });
  await marker.click();
  await page.getByRole('button', { name: 'Edit Event' }).click();
  await page.getByRole('textbox', { name: 'Subtitle / Short Summary' }).fill('The night we met');
  await page.getByRole('button', { name: 'Save changes' }).click();
  // The edit lands in the form row.
  await studioSection(page, 'Key moments');
  await expect(met.getByPlaceholder('One line under the title (optional)')).toHaveValue('The night we met');

  // The Overview panel in the preview shows the draft and can edit it.
  await page.getByTestId('studio-preview-overview-toggle').click();
  const panel = page.locator('aside.chronix-side-drawer').filter({ hasText: 'How it began' });
  await expect(panel).toBeVisible();
  await panel.getByTestId('overview-edit').click();
  await panel.getByTestId('overview-editor').locator('textarea').fill('## How it began\n\nThey met in Lisbon, at a friend\'s wedding.');
  await panel.getByRole('button', { name: 'Save' }).click();
  await studioSection(page, 'Finish');
  await expect(overviewSection.locator('textarea')).toHaveValue(/at a friend's wedding/);

  await page.getByRole('button', { name: 'Create my timeline' }).click();
  await expect.poll(() => calls.saved.length).toBe(1);
  const saved = calls.saved[0];
  expect(saved.overview).toBe('## How it began\n\nThey met in Lisbon, at a friend\'s wedding.');
  const meetArticle = saved.articles.find((a) => a.storyAnchor === 'met');
  expect(meetArticle.subtitle).toBe('The night we met');
  expect(meetArticle.extract).toContain('danced until the band packed up');
  expect(meetArticle.from).toEqual({ year: 2019, month: 10, precision: 'month' });
  expect(meetArticle.locationName).toBe('Lisbon');
  expect(errors).toEqual([]);
});

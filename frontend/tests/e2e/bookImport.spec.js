// Book import end to end in a real browser against a stateful fake server: upload a PDF straight to
// (signed) storage, follow the progress, review the draft (date edit, reject, assign a tray photo),
// create the timeline and land on it. Also checks the flag-off path stays the classic documents flow.
import { test, expect } from '@playwright/test';

const IMPORT_ID = '11111111-2222-4333-8444-555555555555';
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

const DRAFT = {
  v: 1,
  importId: IMPORT_ID,
  title: 'The Singer Family',
  description: '',
  overview: '',
  language: 'en',
  instructionsApplied: 'Focused on Mom as asked.',
  lanes: [{ id: 'mom', title: 'Judy', color: '#2563a2' }, { id: 'dad', title: 'Meir', color: '#2e6b56' }],
  chapters: [{ id: 'ch1', title: 'Life story', firstUnit: 0, lastUnit: 2, include: true, status: 'accepted' }],
  cast: [{ id: 'p1', name: 'Judy Lieber', aliases: ['Mom'] }, { id: 'p2', name: 'Meir Singer', aliases: ['Dad'] }],
  units: [{ index: 0, label: 'p.1', printedPages: ['24', '25'], kind: 'born_digital', sourceId: 's0000' }],
  places: [],
  events: [
    {
      id: 'bk-0001', status: 'accepted', needsReview: true, flags: ['date_inferred'], title: 'Judy is born in Monthey',
      summary: 'Born in a refugee camp.', narrative: 'Judy was born in Monthey, Switzerland.', dateText: 'ו׳ באב תש״ד, 26.07.1944',
      dateBasis: 'explicit', from: { year: 1944, month: 7, day: 26, precision: 'day' }, to: null, circa: false,
      people: ['p1'], unresolvedPeople: [], place: { name: 'Monthey', lat: 46.25, lng: 6.95, source: 'nominatim' },
      category: 'birth', lane: 'mom', rank: 10, chapterId: 'ch1',
      sourceRefs: [{ sourceId: 's0000', unit: 0, printedPage: '24', snippet: 'Judy was born' }],
      photos: [{ photoId: 'u0000-p1', role: 'cover', confidence: 'high' }], mergedFrom: [],
    },
    {
      id: 'bk-0002', status: 'accepted', needsReview: false, flags: [], title: 'Emigration to the USA', summary: '', narrative: '',
      dateText: '7 June 1949', dateBasis: 'explicit', from: { year: 1949, month: 6, day: 7, precision: 'day' }, to: null,
      people: ['p1'], category: 'immigration', lane: 'mom', rank: 9, chapterId: 'ch1',
      sourceRefs: [{ sourceId: 's0000', unit: 0, snippet: 'emigrated' }], photos: [], mergedFrom: [],
    },
    {
      id: 'bk-0003', status: 'accepted', needsReview: true, flags: ['possible_duplicate'], title: 'Moved to America', summary: '', narrative: '',
      dateText: '1949', dateBasis: 'explicit', from: { year: 1949, precision: 'year' }, to: null,
      people: ['p1'], category: 'immigration', lane: 'mom', rank: 5, chapterId: 'ch1',
      sourceRefs: [], photos: [], mergedFrom: [],
    },
  ],
  photos: [
    { id: 'u0000-p1', unit: 0, status: 'linked', eventId: 'bk-0001', caption: 'Judy as a baby', kind: 'photo' },
    { id: 'u0000-p2', unit: 0, status: 'tray', eventId: null, caption: 'Brooklyn, 1950', suggestedEventId: 'bk-0002', kind: 'photo' },
  ],
  stats: { events: 3 },
};

async function mockBookServer(page) {
  const state = { status: 'awaiting_upload', polls: 0, rev: 1, ops: [], uploads: [], created: [], finalized: 0, timelineFetched: 0 };
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost).*/, (route) => route.abort());
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: '00000000-0000-4000-8000-000000000044', aud: 'authenticated', role: 'authenticated', is_anonymous: false, email: 'admin@example.com', app_metadata: { role: 'admin' }, user_metadata: {} };
  const accessToken = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, exp, role: 'authenticated' })}.sig`;
  await page.route(/\/auth\/v1\/(signup|token)/, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ access_token: accessToken, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'refresh', user }),
  }));
  await page.route(/\/auth\/v1\/user/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) }));

  const importStatus = () => {
    const done = (k) => ({ key: k, status: 'done', done: 3, total: 3 });
    let stages;
    if (state.status === 'running') stages = [done('parse'), { key: 'read', status: 'active', done: 1, total: 3 }, { key: 'map', status: 'pending', done: 0, total: 0 }, { key: 'extract', status: 'pending', done: 0, total: 0 }, { key: 'reconcile', status: 'pending', done: 0, total: 0 }];
    else if (state.status === 'finalizing' || state.status === 'completed') stages = [{ key: 'finalize', status: state.status === 'completed' ? 'done' : 'active', done: 1, total: 2 }];
    else stages = ['parse', 'read', 'map', 'extract', 'reconcile'].map(done);
    return {
      id: IMPORT_ID, status: state.status, pausedReason: null, stage: null, lane: 'full', stages,
      counts: { units: 3, photos: 2 }, draftRev: state.rev, timelineId: state.status === 'completed' ? 'tl-book-1' : null,
      error: null, keyTier: 'admin_paid', keyHeld: false, title: 'family.pdf', sources: [],
    };
  };

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api/, '');
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/user/quota') return json({ is_admin: true, daily_paid_limit: 25, used_today: 0, remaining_paid: 25, tier: 'paid', mode: 'limited', credit_costs: { text: 1 } });
    if (path === '/book-imports/limits') {
      return json({ enabled: true, entitled: true, reason: null, keyTier: 'admin_paid', maxFiles: 600, maxFileBytes: 200 * 1024 * 1024, maxTotalBytes: 600 * 1024 * 1024, maxUnits: 900, pasteMaxChars: 200000, instructionsMaxChars: 10000, active: [] });
    }
    if (path === '/book-imports' && req.method() === 'POST') {
      const body = req.postDataJSON();
      state.created.push(body);
      return json({
        import: importStatus(),
        uploads: body.files.map((f, i) => ({ clientId: f.clientId, sourceId: `s${i}`, method: 'PUT', url: `/api/book-import-uploads/b/x/${IMPORT_ID}/sources/s${i}.pdf?e=1&s=sig&m=${f.size}`, headers: { 'content-type': f.mime }, auth: 'none' })),
      });
    }
    if (path.startsWith('/book-import-uploads/')) {
      state.uploads.push({ path, size: (req.postDataBuffer() || Buffer.alloc(0)).length });
      return route.fulfill({ status: 200, body: '' });
    }
    if (path === `/book-imports/${IMPORT_ID}/start`) {
      state.status = 'running';
      return json({ import: importStatus() });
    }
    if (path === `/book-imports/${IMPORT_ID}` && req.method() === 'GET') {
      state.polls += 1;
      if (state.status === 'running' && state.polls >= 2) state.status = 'review';
      if (state.status === 'finalizing') state.status = 'completed';
      return json({ import: importStatus() });
    }
    if (path === `/book-imports/${IMPORT_ID}/draft`) {
      return json({ rev: state.rev, draft: DRAFT, status: state.status, assets: { photos: { 'u0000-p1': { thumb: PIXEL, full: PIXEL }, 'u0000-p2': { thumb: PIXEL, full: PIXEL } }, units: { 0: PIXEL }, expiresIn: 21600 } });
    }
    if (path === `/book-imports/${IMPORT_ID}/draft/ops`) {
      const body = req.postDataJSON();
      if (body.baseRev !== state.rev) return json({ detail: { code: 'stale_draft', rev: state.rev } }, 409);
      state.ops.push(...body.ops);
      state.rev += 1;
      return json({ rev: state.rev });
    }
    if (path === `/book-imports/${IMPORT_ID}/units/0`) {
      return json({ index: 0, reviewUrl: null, pageType: 'mixed', printedPages: ['24', '25'], blocks: [{ kind: 'paragraph', text: 'Judy was born in Monthey on 26.07.1944.' }], photos: [{ ref: 'P1', box2d: [100, 100, 400, 400], kind: 'photo' }] });
    }
    if (path === `/book-imports/${IMPORT_ID}/finalize`) {
      const body = req.postDataJSON();
      state.finalized += 1;
      state.finalizeRev = body.baseRev;
      state.status = 'finalizing';
      return json({ import: importStatus() }, 202);
    }
    if (path === '/timelines/tl-book-1') {
      state.timelineFetched += 1;
      return json({ id: 'tl-book-1', title: 'The Singer Family', isOwner: true, isPersonal: true, lanes: [{ id: 'mom', title: 'Judy' }], timeBands: [], articles: [{ id: 'bk-0001', title: 'Judy is born in Monthey', lane: 'mom', from: { year: 1944, precision: 'year' } }] });
    }
    if (path === '/timelines') return json([]);
    if (path === '/library') return json({ items: [], total: 0 });
    return json({});
  });
  return state;
}

test.use({ viewport: { width: 1440, height: 900 } });

test('a book is uploaded, followed, reviewed and created', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const state = await mockBookServer(page);
  await page.goto('/?ff_book_import=1');
  await page.getByRole('button', { name: 'Tell Your Story' }).first().click();
  await page.getByTestId('studio-start-docs').click();
  await expect(page.getByTestId('doc-import')).toHaveAttribute('data-book-mode', 'true');

  await page.getByTestId('doc-import-input').setInputFiles({ name: 'family.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 fake book') });
  await page.getByTestId('doc-import-context').fill('Focus on Mom');
  await page.getByTestId('doc-import-generate').click();

  // Progress, then the review workspace.
  await expect(page.getByTestId('book-import-progress')).toBeVisible();
  await expect(page.getByTestId('book-stage-read')).toHaveAttribute('data-status', 'active');
  expect(state.created[0].instructions).toBe('Focus on Mom');
  expect(state.created[0].files[0]).toMatchObject({ name: 'family.pdf', mime: 'application/pdf' });
  expect(state.uploads).toHaveLength(1);
  await expect(page.getByTestId('book-review')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('book-event')).toHaveCount(3);

  // Filters
  await page.getByTestId('book-filter-duplicates').click();
  await expect(page.getByTestId('book-event')).toHaveCount(1);
  await page.getByTestId('book-filter-all').click();

  // Open the first event: the source page shows; mark it right and fix the title.
  const first = page.locator('[data-event-id="bk-0001"]');
  await first.getByTestId('book-event-toggle').click();
  await expect(page.getByTestId('book-source')).toContainText('Judy was born in Monthey');
  await first.getByTestId('book-event-title').fill('Judy is born');
  await first.getByTestId('book-event-title').blur();
  await first.getByTestId('book-event-reviewed').click();

  // Remove the duplicate.
  const dup = page.locator('[data-event-id="bk-0003"]');
  await dup.getByTestId('book-event-toggle').click();
  await dup.getByTestId('book-event-reject').click();

  // Assign the tray photo to the emigration event.
  await page.getByTestId('book-side-photos').click();
  await expect(page.getByTestId('book-tray-photo')).toHaveCount(1);
  await page.getByTestId('book-tray-assign').selectOption('bk-0002');
  await expect(page.getByTestId('book-tray-photo')).toHaveCount(0);

  await expect.poll(() => state.ops.map((o) => o.op), { timeout: 10000 }).toEqual(['event.update', 'event.markReviewed', 'event.setStatus', 'photo.assign']);
  expect(state.ops[0]).toMatchObject({ id: 'bk-0001', patch: { title: 'Judy is born' } });
  expect(state.ops[3]).toMatchObject({ photoId: 'u0000-p2', eventId: 'bk-0002' });

  // Create: 2 events (one removed), 2 photos.
  await page.getByTestId('book-review-create').click();
  await expect(page.getByTestId('book-finalize')).toContainText('2 events');
  await expect(page.getByTestId('book-finalize')).toContainText('2 photos');
  await page.getByTestId('book-finalize-confirm').click();
  await expect.poll(() => state.finalized).toBe(1);
  expect(state.finalizeRev).toBe(state.rev);
  await expect.poll(() => state.timelineFetched, { timeout: 15000 }).toBeGreaterThan(0);
  await expect(page.getByRole('dialog', { name: /Story Studio/i })).toBeHidden();
  expect(errors).toEqual([]);
});

test('with the flag off, documents keep the classic single-call flow', async ({ page }) => {
  const state = await mockBookServer(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Tell Your Story' }).first().click();
  await page.getByTestId('studio-start-docs').click();
  await expect(page.getByTestId('doc-import')).toHaveAttribute('data-book-mode', 'false');
  expect(state.created).toHaveLength(0);
});

test('Hebrew layout: the review workspace renders right-to-left', async ({ page }) => {
  await mockBookServer(page);
  await page.addInitScript(() => { localStorage.setItem('chronix_lang', 'he'); localStorage.setItem('chronix_lang_manual', 'true'); });
  await page.goto('/?ff_book_import=1');
  const studioBtn = page.getByRole('button', { name: /ספרו את הסיפור שלכם|Tell Your Story/ }).first();
  await studioBtn.click();
  await page.getByTestId('studio-start-docs').click();
  await page.getByTestId('doc-import-input').setInputFiles({ name: 'ספר.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 fake') });
  await page.getByTestId('doc-import-generate').click();
  await expect(page.getByTestId('book-review')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('book-review')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('book-review-create')).toContainText('3');
});

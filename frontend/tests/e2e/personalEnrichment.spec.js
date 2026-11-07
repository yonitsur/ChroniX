import { test, expect } from '@playwright/test';
import { mockBackend } from './podcastMocks.js';

// A personal timeline's Wikipedia links in the real app: "About <place>" and historical-context
// chips in the event drawer, the illustrative badge on a Wikimedia cover, "Not related" removing a
// link, and "Learn more" in the Overview finding links through the enrichment endpoint.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PINSK = { kind: 'place', name: 'Pinsk', title: 'Pinsk', url: 'https://en.wikipedia.org/wiki/Pinsk', lang: 'en', description: 'city in Brest Region, Belarus' };
const ALIYAH = { kind: 'event', name: 'Third Aliyah', title: 'Third Aliyah', url: 'https://en.wikipedia.org/wiki/Third_Aliyah', lang: 'en' };
const BRIGADE = { kind: 'event', name: 'Jewish Brigade', title: 'Jewish Brigade', url: 'https://en.wikipedia.org/wiki/Jewish_Brigade', lang: 'en' };
const COVER = 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Pinsk.png/1280px-Pinsk.png';

const personal = () => ({
  id: 'tl-family',
  title: 'Our family',
  detectedLanguage: 'en',
  timeScale: 'calendar',
  isOwner: true,
  isPersonal: true,
  isManual: true,
  lanes: [{ id: 'main', title: 'Family' }],
  timeBands: [],
  articles: [
    {
      id: 'evt-born', title: 'Grandpa is born in Pinsk', lane: 'main', from: { year: 1901 }, rank: 8,
      locationName: 'Pinsk', lat: 52.11, lng: 26.1, contextLinks: [PINSK], enrichV: 1,
      imageUrl: COVER, imageSource: 'wikimedia',
      imageIllustrative: { url: COVER, place: 'Pinsk', file: 'Pinsk.png', fileUrl: 'https://commons.wikimedia.org/wiki/File:Pinsk.png' },
    },
    {
      id: 'evt-aliyah', title: 'Emigrates to Palestine', lane: 'main', from: { year: 1921 }, rank: 8,
      locationName: 'Haifa', lat: 32.79, lng: 34.99, contextLinks: [ALIYAH, BRIGADE], enrichV: 1,
    },
    { id: 'evt-wedding', title: 'Wedding in Tel Aviv', lane: 'main', from: { year: 1926 }, rank: 6 },
  ],
});

test('personal timeline: place and history links, illustrative cover, Learn more', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await mockBackend(page, { timelineId: 'tl-unused', isOwner: true, episodes: [] });
  await page.route('**/upload.wikimedia.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(/wikipedia\.org/, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>article</body></html>' }));

  let tl = personal();
  const saves = [];
  const enrichCalls = [];
  await page.route('**/api/timelines/tl-family*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tl) }));
  await page.route(/\/api\/timelines(\?|$)/, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    saves.push(body);
    tl = { ...body, isOwner: true };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tl) });
  });
  await page.route('**/api/timeline/personal-enrichment', async (route) => {
    const body = route.request().postDataJSON();
    enrichCalls.push(body);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        links: { 'evt-wedding': [{ kind: 'place', name: 'Tel Aviv', title: 'Tel Aviv', url: 'https://en.wikipedia.org/wiki/Tel_Aviv', lang: 'en' }] },
        images: {},
        stats: {},
        historySkipped: null,
        credits: 0,
      }),
    });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/t/tl-family');
  await expect(page.locator('#histropedia-container canvas')).toBeVisible();

  // Open the birth event from the cards list.
  await page.locator('#guide-dock-cards').click();
  await page.getByText('Grandpa is born in Pinsk').first().click();
  const drawer = page.locator('.chronix-side-drawer').filter({ hasText: 'Grandpa is born in Pinsk' }).last();
  await expect(drawer.getByText('About Pinsk')).toBeVisible();
  await expect(drawer.getByText('Illustrative · Wikimedia')).toBeVisible();

  // "About Pinsk" opens the Wikipedia tab on the place's article.
  await drawer.getByText('About Pinsk').click();
  await expect(drawer.locator('iframe[title="Pinsk"]')).toHaveAttribute('src', /en\.wikipedia\.org\/wiki\/Pinsk/);
  await expect(drawer.getByText('city in Brest Region, Belarus')).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Not this place' })).toBeVisible();

  // The emigration: historical context chips; "Not related" removes one link from this event.
  await page.locator('#guide-dock-cards').click();
  await page.getByText('Emigrates to Palestine').first().click();
  const drawer2 = page.locator('.chronix-side-drawer').filter({ hasText: 'Emigrates to Palestine' }).last();
  await drawer2.getByRole('tab', { name: 'Details' }).click();
  await expect(drawer2.getByText('Historical context')).toBeVisible();
  await drawer2.getByRole('button', { name: 'Jewish Brigade' }).click();
  await expect(drawer2.locator('iframe[title="Jewish Brigade"]')).toBeAttached();
  await drawer2.getByRole('button', { name: 'Not related' }).click();
  await expect.poll(() => saves.length).toBeGreaterThan(0);
  const saved = saves[saves.length - 1];
  const aliyah = saved.articles.find((a) => a.id === 'evt-aliyah');
  expect(aliyah.contextLinks.map((l) => l.title)).toEqual(['Third Aliyah']);
  expect(saved.dismissedLinks).toEqual([`evt-aliyah|${BRIGADE.url}`]);
  await expect(drawer2.getByRole('button', { name: 'Jewish Brigade' })).toHaveCount(0);

  // Overview -> Learn more: the timeline's history, and "Find Wikipedia links" for every event.
  await page.locator('#guide-dock-overview').first().click();
  const learnMore = page.getByTestId('learn-more');
  await expect(learnMore).toBeVisible();
  await expect(learnMore.getByText('Third Aliyah')).toBeVisible();
  await expect(learnMore.getByTestId('learn-more-world')).toBeVisible();
  await learnMore.getByTestId('learn-more-find').click();
  await expect(learnMore.getByText('New links: 1')).toBeVisible();
  expect(enrichCalls).toHaveLength(1);
  expect(enrichCalls[0].events.map((e) => e.id)).toEqual(['evt-born', 'evt-aliyah', 'evt-wedding']);
  expect(enrichCalls[0].events[0].place_link.url).toBe(PINSK.url);
  const afterFind = saves[saves.length - 1];
  expect(afterFind.articles.find((a) => a.id === 'evt-wedding').contextLinks[0].title).toBe('Tel Aviv');

  expect(errors).toEqual([]);
});

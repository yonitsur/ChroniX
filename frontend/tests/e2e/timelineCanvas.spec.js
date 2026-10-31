import { test, expect } from '@playwright/test';
import { mockBackend } from './podcastMocks.js';

test('HistropediaJS v1.7 canvas renders multi-lane, RTL/LTR, multi-line portrait/landscape/compact cards and themes without errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && msg.text().includes('Histropedia')) {
      errors.push(msg.text());
    }
  });

  await mockBackend(page, { timelineId: 'tl-canvas', isOwner: false, episodes: [] });

  const ONE_PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  let thumb500Attempts = 0;
  let thumb1280Attempts = 0;

  await page.route('**/500px-Recoverable.png', (route) => {
    thumb500Attempts += 1;
    return route.fulfill({
      status: 429,
      headers: { 'access-control-allow-origin': '*' },
      contentType: 'text/plain',
      body: 'Too Many Requests',
    });
  });

  await page.route('**/1280px-Recoverable.png', (route) => {
    thumb1280Attempts += 1;
    return route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*' },
      contentType: 'image/png',
      body: ONE_PIXEL_PNG,
    });
  });

  await page.route('**/broken-event-image.jpg', (route) => route.fulfill({
    status: 404,
    headers: { 'access-control-allow-origin': '*' },
    contentType: 'text/plain',
    body: 'Not Found',
  }));

  // Override timeline payload with rich multi-lane, multi-line, RTL+LTR, and time-band data
  await page.route('**/api/timelines/tl-canvas', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id: 'tl-canvas',
      title: 'Space & Science Milestones',
      description: 'Multi-lane canvas smoke test',
      detectedLanguage: 'he',
      timeScale: 'calendar',
      isOwner: false,
      isShared: true,
      lanes: [
        { id: 'lane-space', title: 'חקר החלל' },
        { id: 'lane-tech', title: 'Computing & AI' },
      ],
      timeBands: [
        { id: 'tb-1', title: 'עידן החלל', from: { year: 1957 }, to: { year: 1975 }, color: '#6366f1' },
      ],
      articles: [
        {
          id: 'evt-1',
          title: 'שיגור הלוויין ספוטניק 1 למסלול סביב כדור הארץ',
          subtitle: 'תחילת עידן החלל המודרני והמרוץ הטכנולוגי בין המעצמות במאה העשרים',
          lane: 'lane-space',
          category: 'Space',
          from: { year: 1957, month: 10, day: 4, precision: 'day' },
          rank: 9,
          starred: true,
        },
        {
          id: 'evt-2',
          title: 'Apollo 11 Lunar Landing on the Sea of Tranquility',
          subtitle: 'Neil Armstrong and Buzz Aldrin walk on the Moon while Michael Collins orbits above',
          lane: 'lane-space',
          category: 'Space',
          from: { year: 1969, month: 7, day: 20, precision: 'day' },
          to: { year: 1969, month: 7, day: 24, precision: 'day' },
          imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Recoverable.png/1280px-Recoverable.png',
          rank: 10,
        },
        {
          id: 'evt-3',
          title: 'ARPANET First Message Sent Between UCLA and Stanford',
          subtitle: 'Packet-switching network foundation that evolved into the modern Internet',
          lane: 'lane-tech',
          category: 'Computing',
          from: { year: 1969, month: 10, day: 29, precision: 'day' },
          imageUrl: 'https://upload.wikimedia.org/broken-event-image.jpg',
          rank: 8,
        },
      ],
    }),
  }));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/t/tl-canvas');

  const canvas = page.locator('#histropedia-container canvas');
  await expect(canvas).toBeVisible();

  const box = await canvas.boundingBox();
  expect(box && box.width > 400 && box.height > 300).toBe(true);

  await expect.poll(async () => page.evaluate(() => {
    const tl = window.__timeline;
    const art = tl?.getArticleById?.('evt-3');
    if (!art || !art._chronixFailedImageUrl) return null;
    const layout = art._getCurrentCardLayout?.();
    const connectorEnd = layout?.getConnectorEnd?.call(art);
    const style = art._getCurrentStyle?.();
    return {
      failedUrl: art._chronixFailedImageUrl,
      height: art.getHeight(),
      cachedHeight: art._cachedHeight,
      connectorDelta: connectorEnd ? Math.abs(connectorEnd.top - (art.position.top + art._cachedHeight + (style?.connectorLine?.offsetY || 0))) : null,
    };
  })).toMatchObject({
    failedUrl: 'https://upload.wikimedia.org/broken-event-image.jpg',
  });

  const brokenCardMetrics = await page.evaluate(() => {
    const art = window.__timeline.getArticleById('evt-3');
    const layout = art._getCurrentCardLayout();
    const connectorEnd = layout.getConnectorEnd.call(art);
    const style = art._getCurrentStyle();
    return {
      height: art.getHeight(),
      cachedHeight: art._cachedHeight,
      connectorDelta: Math.abs(connectorEnd.top - (art.position.top + art._cachedHeight + (style?.connectorLine?.offsetY || 0))),
    };
  });
  expect(brokenCardMetrics.height).toBe(brokenCardMetrics.cachedHeight);
  expect(brokenCardMetrics.height).toBeLessThan(200);
  expect(brokenCardMetrics.connectorDelta).toBeLessThanOrEqual(2);

  // Verify 500px 429 automatically recovers via the warm 1280px fallback without tainting the canvas
  await expect.poll(async () => page.evaluate(() => {
    const art = window.__timeline?.getArticleById?.('evt-2');
    if (!art || !art.imageLoaded || !art.image) return null;
    const canvasEl = document.querySelector('#histropedia-container canvas');
    const dataUrl = canvasEl?.toDataURL?.('image/png') || '';
    return {
      imageLoaded: Boolean(art.imageLoaded && art.image),
      failedUrl: art._chronixFailedImageUrl || null,
      exportUntainted: dataUrl.startsWith('data:image/png'),
    };
  })).toEqual({
    imageLoaded: true,
    failedUrl: null,
    exportUntainted: true,
  });
  expect(thumb500Attempts).toBe(1);
  expect(thumb1280Attempts).toBe(1);

  // Exercise multi-frame redraws: hover, wheel zoom, drag pan, and theme class switch
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(250);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  await page.evaluate(() => {
    document.documentElement.classList.add('theme-toy', 'dark');
    window.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(300);

  // Exercise shallow height (forces landscape / compact layout tiers)
  await page.setViewportSize({ width: 1280, height: 420 });
  await page.waitForTimeout(300);

  expect(errors).toEqual([]);
});

test('rotating mobile from portrait to landscape exits mobile mode completely (desktop layout + regular desktop timeline)', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();

  await mockBackend(page, { timelineId: 'tl-rotate', isOwner: true, episodes: [] });
  await page.route('**/api/timelines/tl-rotate', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id: 'tl-rotate',
      title: 'Mobile Rotation Test',
      overview: 'Overview text for testing landscape side panel.',
      detectedLanguage: 'he',
      timeScale: 'calendar',
      isOwner: true,
      lanes: [{ id: 'lane-1', title: 'ראשי' }],
      articles: [
        {
          id: 'evt-1',
          title: 'אירוע ראשון',
          subtitle: 'תיאור קצר ראשון',
          lane: 'lane-1',
          category: 'History',
          lat: 31.7683,
          lng: 35.2137,
          from: { year: 1948, month: 5, day: 14, precision: 'day' },
          rank: 9,
        },
        {
          id: 'evt-2',
          title: 'אירוע שני',
          subtitle: 'תיאור קצר שני',
          lane: 'lane-1',
          category: 'History',
          from: { year: 1956, month: 10, day: 29, precision: 'day' },
          rank: 8,
        },
        {
          id: 'evt-3',
          title: 'אירוע שלישי',
          subtitle: 'תיאור קצר שלישי',
          lane: 'lane-1',
          category: 'History',
          from: { year: 1967, month: 6, day: 5, precision: 'day' },
          rank: 9,
        },
      ],
    }),
  }));

  await page.goto('/t/tl-rotate');
  await expect(page.locator('#histropedia-container canvas')).toBeVisible();

  // 1. Portrait (390x844): Mobile top bar + mobile bottom dock + Focus Lens are active; desktop left rail is hidden
  await expect(page.locator('#chronix-mobile-top-bar')).toBeVisible();
  await expect(page.locator('#chronix-mobile-bottom-dock')).toBeVisible();
  await expect(page.locator('#chronix-left-dock')).toBeHidden();
  await expect.poll(async () => page.evaluate(() => Boolean(window.__timeline?._chronixLens?.active))).toBe(true);

  // Switch to Feed in portrait before rotating to verify landscape exits mobile Feed too
  await page.locator('#chronix-mobile-top-bar [data-mobile-view="feed"]').click();

  // 2. Rotate to standard phone landscape (844x390): exits mobile mode completely (desktop layout + regular desktop timeline, NO Focus Lens)
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('#chronix-mobile-top-bar')).toHaveCount(0);
  await expect(page.locator('#chronix-mobile-bottom-dock')).toBeHidden();
  await expect(page.locator('#chronix-left-dock')).toBeVisible();
  await expect(page.locator('#histropedia-container canvas')).toBeVisible();

  await expect.poll(async () => page.evaluate(() => {
    const tl = window.__timeline;
    if (!tl) return null;
    return {
      lensActive: Boolean(tl._chronixLens?.active),
      lensDisabled: Boolean(tl._chronixLensDisabled),
      narrowFlag: Boolean(tl._isNarrowViewport),
      rulerAtBottom: Math.abs((tl.options?.height || 0) - (tl.top || 0) - 42) <= 2,
      allLensCleared: (tl.articles || []).every((a) => !a._lens),
    };
  })).toEqual({
    lensActive: false,
    lensDisabled: true,
    narrowFlag: false,
    rulerAtBottom: true,
    allLensCleared: true,
  });

  const canvasBox = await page.locator('#histropedia-container canvas').boundingBox();
  expect(canvasBox.y).toBe(0);
  expect(canvasBox.height).toBeGreaterThanOrEqual(385);

  // Open Cards List drawer from the left dock and verify it opens on the left (at x=52) rather than bottom sheet
  await page.locator('#guide-dock-cards').click();
  const drawer = page.locator('aside.chronix-side-drawer:not([inert])');
  await expect(drawer).toBeVisible();
  await expect.poll(async () => Math.round((await drawer.boundingBox())?.x ?? -999)).toBe(52);
  expect(Math.round((await drawer.boundingBox()).height)).toBe(390);

  // 3. Compact phone landscape (667x375, < 768px wide and canvas < 640px wide) ALSO stays cleanly in desktop layout + regular desktop timeline
  await page.setViewportSize({ width: 667, height: 375 });
  await expect(page.locator('#chronix-mobile-top-bar')).toHaveCount(0);
  await expect(page.locator('#chronix-mobile-bottom-dock')).toBeHidden();
  await expect(page.locator('#chronix-left-dock')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => Boolean(window.__timeline?._chronixLens?.active))).toBe(false);
  await expect.poll(async () => Math.round((await drawer.boundingBox())?.height ?? 0)).toBe(375);
  expect(Math.round((await drawer.boundingBox()).x)).toBe(52);

  // 4. Rotate back to portrait (390x844): mobile mode and Focus Lens cleanly return
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#chronix-mobile-top-bar')).toBeVisible();
  await expect(page.locator('#chronix-mobile-bottom-dock')).toBeVisible();
  await expect(page.locator('#chronix-left-dock')).toBeHidden();
  await expect.poll(async () => page.evaluate(() => Boolean(window.__timeline?._chronixLens?.active))).toBe(true);

  await context.close();
});

test('mobile portrait 3-mode switcher renders regular desktop timeline in Classic mode while keeping all surrounding UI mobile-adapted', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();

  await mockBackend(page, { timelineId: 'tl-classic-mobile', isOwner: true, episodes: [] });
  await page.route('**/api/timelines/tl-classic-mobile', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id: 'tl-classic-mobile',
      title: 'Classic Timeline in Mobile Portrait',
      overview: 'Overview text for mobile bottom sheet check.',
      detectedLanguage: 'he',
      timeScale: 'calendar',
      isOwner: true,
      lanes: [{ id: 'lane-1', title: 'היסטוריה' }],
      articles: [
        {
          id: 'evt-1',
          title: 'אירוע ראשון בציר',
          subtitle: 'תיאור האירוע הראשון',
          lane: 'lane-1',
          category: 'History',
          from: { year: 1905, month: 6, day: 30, precision: 'day' },
          rank: 9,
        },
        {
          id: 'evt-2',
          title: 'אירוע שני בציר',
          subtitle: 'תיאור האירוע השני',
          lane: 'lane-1',
          category: 'History',
          from: { year: 1915, month: 11, day: 25, precision: 'day' },
          rank: 10,
        },
        {
          id: 'evt-3',
          title: 'אירוע שלישי בציר',
          subtitle: 'תיאור האירוע השלישי',
          lane: 'lane-1',
          category: 'History',
          from: { year: 1929, month: 10, day: 24, precision: 'day' },
          rank: 8,
        },
        {
          id: 'evt-4',
          title: 'אירוע רביעי בציר',
          subtitle: 'תיאור האירוע הרביעי',
          lane: 'lane-1',
          category: 'History',
          from: { year: 1945, month: 5, day: 8, precision: 'day' },
          rank: 8,
        },
      ],
    }),
  }));

  await page.goto('/t/tl-classic-mobile');
  await expect(page.locator('#histropedia-container canvas')).toBeVisible();

  const feedBtn = page.locator('#chronix-mobile-top-bar [data-mobile-view="feed"]');
  const focusBtn = page.locator('#chronix-mobile-top-bar [data-mobile-view="canvas"]');
  const classicBtn = page.locator('#chronix-mobile-top-bar [data-mobile-view="classic"]');

  await expect(feedBtn).toBeVisible();
  await expect(focusBtn).toBeVisible();
  await expect(classicBtn).toBeVisible();
  await expect(focusBtn).toHaveAttribute('aria-checked', 'true');

  // Verify default Focus mode activates mobile Focus Lens
  await expect.poll(async () => page.evaluate(() => Boolean(window.__timeline?._chronixLens?.active))).toBe(true);

  // Switch to Classic (regular desktop timeline) mode in mobile portrait
  await classicBtn.click();
  await expect(classicBtn).toHaveAttribute('aria-checked', 'true');

  // Verify Focus Lens is disabled and standard desktop timeline + bottom year ruler are rendered
  await expect.poll(async () => page.evaluate(() => {
    const tl = window.__timeline;
    if (!tl) return null;
    return {
      lensActive: Boolean(tl._chronixLens?.active),
      lensDisabled: Boolean(tl._chronixLensDisabled),
      narrowFlag: Boolean(tl._isNarrowViewport),
      rulerAtBottom: Math.abs((tl.options?.height || 0) - (tl.top || 0) - 42) <= 2,
      allLensCleared: (tl.articles || []).every((a) => !a._lens),
    };
  })).toEqual({
    lensActive: false,
    lensDisabled: true,
    narrowFlag: false,
    rulerAtBottom: true,
    allLensCleared: true,
  });

  // Verify top bar & bottom dock remain strictly mobile-adapted (no desktop rail, no horizontal overflow even on 360px phones)
  await page.setViewportSize({ width: 360, height: 740 });
  await expect(page.locator('#chronix-mobile-top-bar')).toBeVisible();
  await expect(page.locator('#chronix-mobile-bottom-dock')).toBeVisible();
  await expect(page.locator('#chronix-left-dock')).toBeHidden();
  await expect.poll(async () => page.evaluate(() => Math.round(window.__timeline?.options?.width || 0))).toBe(360);
  await page.waitForTimeout(150);

  const topBarOverflow = await page.evaluate(() => {
    const bar = document.getElementById('chronix-mobile-top-bar');
    return bar ? bar.scrollWidth > bar.clientWidth : true;
  });
  expect(topBarOverflow).toBe(false);

  const getCardCenter = async (targetId) => page.evaluate((id) => {
    const tl = window.__timeline;
    const canvas = tl?.canvas;
    if (!tl || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const art = (tl.articles || []).find((a) => String(a.id) === String(id) && a.isVisible && a.position && typeof a.getWidth === 'function');
    if (!art) return null;
    const w = art.getWidth();
    const h = art.getHeight();
    const star = art.isActive || art.isStarred ? (typeof art.getIconBox === 'function' ? art.getIconBox() : null) : null;
    const topHitAt = (lx, ly) => {
      for (let i = tl.articles.length - 1; i >= 0; i--) {
        const cand = tl.articles[i];
        if (cand && cand.isVisible && typeof cand.isInside === 'function' && cand.isInside({ left: lx, top: ly })) {
          return String(cand.id);
        }
      }
      return null;
    };
    for (const fy of [0.3, 0.45, 0.2, 0.6]) {
      for (const fx of [0.2, 0.5, 0.35, 0.65, 0.8, 0.12]) {
        const lx = art.position.left + w * fx;
        const ly = art.position.top + h * fy;
        if (star && lx >= star.left - 4 && lx <= star.left + star.width + 4 && ly >= star.top - 4 && ly <= star.top + star.height + 4) {
          continue;
        }
        const cx = Math.round(rect.left + lx);
        const cy = Math.round(rect.top + ly);
        if (document.elementFromPoint(cx, cy) !== canvas) continue;
        if (lx >= 8 && lx <= rect.width - 8 && ly >= 8 && ly <= rect.height - 8 && topHitAt(lx, ly) === String(id)) {
          return { x: cx, y: cy };
        }
      }
    }
    return null;
  }, targetId);

  const eventSheet = page.locator('div.chronix-side-drawer');

  // 1) First tap on evt-1 puts it in focus (isActive = true) WITHOUT opening EventDrawer
  const evt1Pt = await getCardCenter('evt-1');
  expect(evt1Pt).not.toBeNull();
  await page.touchscreen.tap(evt1Pt.x, evt1Pt.y);

  await expect.poll(async () => page.evaluate(() => {
    const a = window.__timeline?.getArticleById?.('evt-1');
    return Boolean(a?.isActive);
  })).toBe(true);
  await expect(eventSheet).toHaveCount(0);

  // 2) Single tap on a DIFFERENT exposed card moves focus to that card WITHOUT opening EventDrawer
  let secondId = null;
  let secondPtFirst = null;
  for (const candId of ['evt-3', 'evt-4', 'evt-2']) {
    const pt = await getCardCenter(candId);
    if (pt) {
      secondId = candId;
      secondPtFirst = pt;
      break;
    }
  }
  expect(secondPtFirst).not.toBeNull();
  await page.touchscreen.tap(secondPtFirst.x, secondPtFirst.y);

  await expect.poll(async () => page.evaluate((id) => ({
    evt1Active: Boolean(window.__timeline?.getArticleById?.('evt-1')?.isActive),
    secondActive: Boolean(window.__timeline?.getArticleById?.(id)?.isActive),
  }), secondId)).toEqual({ evt1Active: false, secondActive: true });
  await expect(eventSheet).toHaveCount(0);

  // 3) Second tap on the already-focused card opens EventDrawer from the bottom (mobile bottom sheet)
  const secondPtSecond = await getCardCenter(secondId);
  expect(secondPtSecond).not.toBeNull();
  await page.touchscreen.tap(secondPtSecond.x, secondPtSecond.y);

  await expect(eventSheet).toBeVisible();
  await expect.poll(async () => {
    const b = await eventSheet.boundingBox();
    return b ? { x: Math.round(b.x), width: Math.round(b.width), bottom: Math.round(b.y + b.height) } : null;
  }).toEqual({
    x: 0,
    width: 360,
    bottom: 740,
  });

  // 4) Close EventDrawer (clears focus), then long-press (~560ms) on evt-1 to open details directly in 1 press
  await eventSheet.getByRole('button', { name: /^(Close|סגור)$/ }).click();
  await expect(eventSheet).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => (window.__timeline?.articles || []).every((a) => !a.isActive))).toBe(true);

  const evt1LongPressPt = await getCardCenter('evt-1');
  expect(evt1LongPressPt).not.toBeNull();
  await page.evaluate(async ({ x, y }) => {
    const canvas = window.__timeline?.canvas;
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, clientX: x, clientY: y, pointerId: 11, pointerType: 'touch', button: 0, isPrimary: true,
    }));
    await new Promise((r) => setTimeout(r, 560));
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, clientX: x, clientY: y, pointerId: 11, pointerType: 'touch', button: 0, isPrimary: true,
    }));
  }, evt1LongPressPt);

  await expect(eventSheet).toBeVisible();

  // Switch Feed -> Classic -> Focus and verify clean state transitions
  await eventSheet.getByRole('button', { name: /^(Close|סגור)$/ }).click();
  await expect(eventSheet).toHaveCount(0);
  await feedBtn.click();
  await expect(feedBtn).toHaveAttribute('aria-checked', 'true');

  await classicBtn.click();
  await expect(classicBtn).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => page.evaluate(() => Boolean(window.__timeline?._chronixLens?.active))).toBe(false);

  await focusBtn.click();
  await expect(focusBtn).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => page.evaluate(() => Boolean(window.__timeline?._chronixLens?.active))).toBe(true);

  await context.close();
});

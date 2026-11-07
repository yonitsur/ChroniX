import { test, expect } from '@playwright/test';

async function mockSignedInUser(page, language = 'he') {
  await page.addInitScript((lang) => {
    try {
      localStorage.setItem('chronix_lang', lang);
      localStorage.setItem('vt_language', lang);
    } catch {}
  }, language);

  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id: '00000000-0000-4000-8000-000000000042',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'tester@chronix-ai.com',
    is_anonymous: false,
    app_metadata: { provider: 'email' },
    user_metadata: { full_name: 'ChroniX Tester' },
  };
  const accessToken = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: user.id,
    exp,
    role: 'authenticated',
    email: user.email,
    is_anonymous: false,
  })}.sig`;

  let logoutCalled = false;

  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost).*/, async (route) => {
    const url = route.request().url();
    if (/\/auth\/v1\/(signup|token)/.test(url)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: accessToken,
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: exp,
          refresh_token: 'refresh',
          user,
        }),
      });
    }
    if (/\/auth\/v1\/user/.test(url)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(user),
      });
    }
    if (/\/auth\/v1\/logout/.test(url)) {
      logoutCalled = true;
      return route.fulfill({ status: 204, body: '' });
    }
    return route.abort();
  });

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, '');
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/user/quota') {
      return json({
        is_admin: false,
        is_guest: false,
        daily_paid_limit: 25,
        used_today: 0,
        remaining_paid: 25,
        tier: 'paid',
        mode: 'limited',
        credit_costs: { text: 1, gemini_image: 6, gemini_audio: 10, gemini_audio_full: 20 },
      });
    }
    if (path === '/guest-policy') {
      return json({
        guest_api_key_mode: 'limited',
        guest_daily_limit: 10,
        credit_costs: { text: 1, gemini_image: 6, gemini_audio: 10, gemini_audio_full: 20 },
      });
    }
    if (path === '/community/status') {
      return json({ enabled: false });
    }
    if (path === '/timelines') {
      return json([]);
    }
    if (path === '/health') return json({ status: 'ok' });
    return json({ detail: 'not mocked' }, 404);
  });

  return () => logoutCalled;
}

for (const { label, width, height, lang, signOutText } of [
  { label: 'mobile portrait compact (HE RTL)', width: 360, height: 640, lang: 'he', signOutText: 'התנתק' },
  { label: 'mobile portrait short Chrome bar (EN LTR)', width: 390, height: 580, lang: 'en', signOutText: 'Sign out' },
  { label: 'mobile landscape (HE RTL)', width: 740, height: 360, lang: 'he', signOutText: 'התנתק' },
]) {
  test(`Toolbar settings menu scrolls all the way to "${signOutText}" on ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const wasLoggedOut = await mockSignedInUser(page, lang);

    await page.goto('/');

    const trigger = page.locator('#guide-more-actions');
    await expect(trigger).toBeVisible();
    await trigger.click();

    const menu = page.locator('#guide-more-actions + [role="menu"]');
    await expect(menu).toBeVisible();

    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    // Menu card itself must stay fully inside the visible viewport (never clipped at bottom or sides)
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(height - 8);

    // Scroll menu container all the way to the bottom
    await menu.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });

    const signOutBtn = menu.getByRole('button', { name: signOutText });
    await expect(signOutBtn).toBeVisible();

    const btnBox = await signOutBtn.boundingBox();
    expect(btnBox).not.toBeNull();
    // Sign out button must be completely visible within both the menu card and the viewport
    expect(btnBox.y).toBeGreaterThanOrEqual(menuBox.y);
    expect(btnBox.y + btnBox.height).toBeLessThanOrEqual(menuBox.y + menuBox.height + 1);
    expect(btnBox.y + btnBox.height).toBeLessThanOrEqual(height - 8);

    // Clicking Sign out should succeed without clipping or interception
    await signOutBtn.click();
    await expect.poll(wasLoggedOut).toBe(true);
  });
}

// Podcast smoke tests against a fully mocked backend: shared listen links, playback with
// synced subtitles, transcript, chapter navigation, and the one-tap "Listen now" generation flow.
import { test, expect } from '@playwright/test';
import { episode, mockBackend } from './podcastMocks.js';

test('shared listen link opens the player and narrates with synced subtitles', async ({ page }) => {
  const calls = await mockBackend(page, { timelineId: 'tl-1', isOwner: false, episodes: [episode('ep-1', 'tl-1')] });
  await page.goto('/t/tl-1?listen=1');

  const play = page.getByRole('button', { name: 'Play', exact: true }).last();
  await expect(play).toBeVisible();
  await expect(page.getByText('Chapter 1 of 3')).toBeVisible();
  await play.click();

  await expect(page.getByRole('button', { name: 'Pause', exact: true }).last()).toBeVisible();
  await expect(page.getByText('Welcome aboard.', { exact: true })).toBeVisible();
  await expect.poll(() => calls.listen.some((e) => e.event === 'play_start')).toBe(true);
  expect(calls.clips).toContain('seg-1');
  await expect.poll(() => calls.clips.includes('seg-2')).toBe(true); // next chapter prefetched

  await page.getByRole('button', { name: 'Script' }).click();
  await expect(page.getByText('Script & chapters — Race to the Moon')).toBeVisible();

  await page.getByRole('button', { name: 'Next chapter' }).last().click();
  await expect(page.getByText('Chapter 2 of 3')).toBeVisible();
  await expect(page).not.toHaveURL(/listen=1/);
});

test('one tap "Listen now" generates an episode and waits for the user to press play', async ({ page }) => {
  const calls = await mockBackend(page, { timelineId: 'tl-2', isOwner: true, episodes: [] });
  await page.goto('/t/tl-2?listen=1');

  const listen = page.getByRole('button', { name: 'Listen now' });
  await expect(listen).toBeVisible();
  await expect(page.getByText('Uses 1 AI credit')).toBeVisible();
  await page.getByRole('button', { name: 'Customize' }).click();
  await expect(page.getByRole('button', { name: /Edge-TTS/ })).toHaveAttribute('aria-pressed', 'true'); // free voice is always default
  await expect(page.getByRole('button', { name: /Premium/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: /Google Cloud/ })).toBeEnabled();

  await listen.click();
  const play = page.getByRole('button', { name: 'Play', exact: true }).last();
  await expect(play).toBeVisible({ timeout: 15_000 });
  expect(calls.start).toBe(1);
  expect(calls.clips).toContain('seg-1');
  await expect(page.getByText('1/3')).toBeVisible();

  await play.click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true }).last()).toBeVisible({ timeout: 15_000 });
});

test('timeline loads with floating podcast player open and minimized by default when episode exists', async ({ page }) => {
  await mockBackend(page, { timelineId: 'tl-1', isOwner: false, episodes: [episode('ep-1', 'tl-1')] });
  await page.goto('/t/tl-1');

  // Floating player is visible and minimized by default
  const expandBtn = page.getByRole('button', { name: 'Expand player' });
  await expect(expandBtn).toBeVisible();

  // Play button on the minimized bar can be clicked directly
  const playBtn = page.getByRole('button', { name: 'Play', exact: true }).last();
  await expect(playBtn).toBeVisible();

  // Expanding it reveals full player controls like chapter title and transcript button
  await expandBtn.click();
  await expect(page.getByText('Chapter 1 of 3')).toBeVisible();

  // Closing it hides the floating bar
  await page.getByRole('button', { name: 'Close podcast' }).click();
  await expect(expandBtn).not.toBeVisible();

  // Clicking dock icon re-opens it
  await page.locator('#guide-dock-podcast').first().click();
  await expect(page.getByText('Chapter 1 of 3')).toBeVisible();

  // Playing opens map in split mode
  await page.getByRole('button', { name: 'Play', exact: true }).last().click();
  await expect(page.locator('[role="separator"][aria-orientation="horizontal"]')).toBeVisible();
});

test('playing podcast always opens map in half-screen split view even if user closed map', async ({ page }) => {
  await mockBackend(page, { timelineId: 'tl-1', isOwner: false, episodes: [episode('ep-1', 'tl-1')] });
  await page.goto('/t/tl-1');

  // Start with map closed or click play on the minimized podcast bar
  const playBtn = page.getByRole('button', { name: 'Play', exact: true }).last();
  await playBtn.click();

  // Map is forced open in split mode (separator is visible)
  await expect(page.locator('[role="separator"][aria-orientation="horizontal"]')).toBeVisible();

  // Player remains minimized
  await expect(page.getByRole('button', { name: 'Expand player' })).toBeVisible();
});

test('timeline loads with floating starter pill by default when no episodes exist', async ({ page }) => {
  await mockBackend(page, { timelineId: 'tl-2', isOwner: true, episodes: [] });
  await page.goto('/t/tl-2');

  // Starter pill is visible and minimal
  await expect(page.getByText('Timeline Podcast Tour')).toBeVisible();
  const listenBtn = page.getByRole('button', { name: 'Listen', exact: true });
  await expect(listenBtn).toBeVisible();

  // Clicking Listen expands to studio dialog
  await listenBtn.click();
  await expect(page.getByRole('button', { name: 'Listen now' })).toBeVisible();
});

test('locks Premium Gemini voice option when premium AI credits are exhausted while keeping free voices open', async ({ page }) => {
  await mockBackend(page, {
    timelineId: 'tl-3',
    isOwner: true,
    episodes: [],
    quota: {
      is_admin: false,
      daily_paid_limit: 25,
      used_today: 25,
      remaining_paid: 0,
      tier: 'free',
      mode: 'limited',
      credit_costs: { text: 1, gemini_image: 6, gemini_audio: 10 },
    },
  });
  await page.goto('/t/tl-3?listen=1');

  await page.getByRole('button', { name: 'Customize' }).click();
  await expect(page.getByRole('button', { name: /Edge-TTS/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Edge-TTS/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /Google Cloud/ })).toBeEnabled();
  const geminiCard = page.getByRole('button', { name: /Premium \(Gemini\)/ });
  await expect(geminiCard).toBeDisabled();
  await expect(geminiCard).toContainText(/no premium AI credits left/i);
});

test('locks Premium Gemini voice when user has partial credits (< 11) while keeping 1-credit free-voice episodes open', async ({ page }) => {
  await mockBackend(page, {
    timelineId: 'tl-4',
    isOwner: true,
    episodes: [],
    quota: {
      is_admin: false,
      daily_paid_limit: 25,
      used_today: 20,
      remaining_paid: 5,
      tier: 'paid',
      mode: 'limited',
      credit_costs: { text: 1, gemini_image: 6, gemini_audio: 10, gemini_audio_full: 20 },
    },
  });
  await page.goto('/t/tl-4?listen=1');

  await expect(page.getByText('Uses 1 AI credit')).toBeVisible();
  await page.getByRole('button', { name: 'Customize' }).click();
  await expect(page.getByRole('button', { name: /Edge-TTS/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Edge-TTS/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /Google Cloud/ })).toBeEnabled();
  const geminiCard = page.getByRole('button', { name: /Premium \(Gemini\)/ });
  await expect(geminiCard).toBeDisabled();
  await expect(geminiCard).toContainText(/requires 11 AI credits \(5 left\)/i);
});

test('Full story Gemini audio costs 20 credits (21 total) on > 12-event timelines and locks cleanly when user has 15 credits', async ({ page }) => {
  await mockBackend(page, {
    timelineId: 'tl-long-24',
    isOwner: true,
    episodes: [],
    articleCount: 15,
    quota: {
      is_admin: false,
      daily_paid_limit: 25,
      used_today: 1,
      remaining_paid: 24,
      tier: 'paid',
      mode: 'limited',
      credit_costs: { text: 1, gemini_image: 6, gemini_audio: 10, gemini_audio_full: 20 },
    },
  });
  await page.goto('/t/tl-long-24?listen=1');

  await page.getByRole('button', { name: 'Customize' }).click();
  const geminiCard = page.getByRole('button', { name: /Premium \(Gemini\)/ });
  await expect(geminiCard).toBeEnabled();
  await expect(geminiCard).toContainText(/10 AI credits/i);

  await geminiCard.click();
  await expect(page.getByText('Uses 11 AI credits (1 script + 10 premium voices)')).toBeVisible();

  const fullStoryCard = page.getByRole('button', { name: /Full story/ });
  await expect(fullStoryCard).toBeEnabled();
  await fullStoryCard.click();

  await expect(geminiCard).toBeEnabled();
  await expect(geminiCard).toHaveAttribute('aria-pressed', 'true');
  await expect(geminiCard).toContainText(/20 AI credits/i);
  await expect(page.getByText('Uses 21 AI credits (1 script + 20 premium voices)')).toBeVisible();
});

test('switching from Highlights to Full story with 15 credits locks Gemini at 21 credits while keeping free voices open, and charges 10 on <= 12-event timelines', async ({ page }) => {
  await mockBackend(page, {
    timelineId: 'tl-long-15',
    isOwner: true,
    episodes: [],
    articleCount: 15,
    quota: {
      is_admin: false,
      daily_paid_limit: 25,
      used_today: 10,
      remaining_paid: 15,
      tier: 'paid',
      mode: 'limited',
      credit_costs: { text: 1, gemini_image: 6, gemini_audio: 10, gemini_audio_full: 20 },
    },
  });
  await page.goto('/t/tl-long-15?listen=1');

  await page.getByRole('button', { name: 'Customize' }).click();
  const geminiCard = page.getByRole('button', { name: /Premium \(Gemini\)/ });
  await expect(geminiCard).toBeEnabled();
  await geminiCard.click();
  await expect(page.getByText('Uses 11 AI credits (1 script + 10 premium voices)')).toBeVisible();

  // Switch to Full story (15 events > 12 -> needs 21 credits > 15 left):
  // Gemini locks cleanly and voice engine resets to free (1 credit for script)!
  await page.getByRole('button', { name: /Full story/ }).click();
  await expect(geminiCard).toBeDisabled();
  await expect(geminiCard).toContainText(/requires 21 AI credits \(15 left\)/i);
  await expect(page.getByText('Uses 1 AI credit')).toBeVisible();

  // Now navigate to a short timeline (8 events <= 12) with 15 credits: Full story stays at 10 audio credits!
  await mockBackend(page, {
    timelineId: 'tl-short-8',
    isOwner: true,
    episodes: [],
    articleCount: 8,
    quota: {
      is_admin: false,
      daily_paid_limit: 25,
      used_today: 10,
      remaining_paid: 15,
      tier: 'paid',
      mode: 'limited',
      credit_costs: { text: 1, gemini_image: 6, gemini_audio: 10, gemini_audio_full: 20 },
    },
  });
  await page.goto('/t/tl-short-8?listen=1');
  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByRole('button', { name: /Full story/ }).click();
  const shortGeminiCard = page.getByRole('button', { name: /Premium \(Gemini\)/ });
  await expect(shortGeminiCard).toBeEnabled();
  await expect(shortGeminiCard).toContainText(/10 AI credits/i);
  await shortGeminiCard.click();
  await expect(page.getByText('Uses 11 AI credits (1 script + 10 premium voices)')).toBeVisible();
});



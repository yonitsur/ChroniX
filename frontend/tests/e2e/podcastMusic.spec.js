// Background music: live synthesis under the voice, the volume/mute panel, and downloads mixed in the browser.
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { episode, mockBackend } from './podcastMocks.js';

const countOscillators = () => {
  window.__oscillators = 0;
  const original = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function createOscillator() {
    window.__oscillators += 1;
    return original.call(this);
  };
};

test('music plays under the voice and can be adjusted or muted with the slider and switch', async ({ page }) => {
  await page.addInitScript(countOscillators);
  await mockBackend(page, { timelineId: 'tl-1', isOwner: false, episodes: [episode('ep-1', 'tl-1')] });
  await page.goto('/t/tl-1?listen=1');

  await page.getByRole('button', { name: 'Play', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true }).last()).toBeVisible();
  // Chapter chimes use 2 oscillators; the music bed schedules dozens.
  await expect.poll(() => page.evaluate(() => window.__oscillators)).toBeGreaterThan(20);

  await page.getByRole('button', { name: 'Background music: on' }).click();
  const panel = page.getByRole('dialog', { name: 'Background music' });
  await expect(panel).toBeVisible();

  // Music style is exclusively AI-picked: no manual mood picker in the UI.
  await expect(panel.getByText('Mood')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /Auto/ })).toHaveCount(0);

  const slider = panel.getByRole('slider');
  await expect(slider).toBeEnabled();
  await expect(slider).toHaveValue('0.5');

  // Sliding all the way down to 0% mutes the music while keeping the slider interactive.
  await slider.fill('0');
  await expect(page.getByRole('button', { name: 'Background music: off' })).toBeVisible();
  await expect(slider).toBeEnabled();
  await expect(panel.getByRole('switch', { name: 'Background music' })).toHaveAttribute('aria-checked', 'false');

  // Sliding back up re-enables music at the chosen volume.
  await slider.fill('0.65');
  await expect(page.getByRole('button', { name: 'Background music: on' })).toBeVisible();
  await expect(panel.getByText('65%')).toBeVisible();

  // Toggling the switch mutes while remembering the slider volume.
  await panel.getByRole('switch', { name: 'Background music' }).click();
  await expect(page.getByRole('button', { name: 'Background music: off' })).toBeVisible();

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('chronix_podcast_music')));
  expect(saved).toEqual({ enabled: false, volume: 0.65 });
});

test('download with music is mixed in the browser and ducks the music under speech', async ({ page }) => {
  const calls = await mockBackend(page, { timelineId: 'tl-1', isOwner: false, episodes: [episode('ep-1', 'tl-1')] });
  await page.goto('/t/tl-1?listen=1');
  await expect(page.getByText('Chapter 1 of 3')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('button', { name: 'Download MP3' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Race to the Moon.mp3');
  expect(calls.download).toBe(0); // no server round-trip for the mix

  const bytes = readFileSync(await download.path());
  expect(bytes.subarray(0, 3).toString('latin1')).toBe('ID3');
  expect(bytes.includes(Buffer.from('Race to the Moon', 'utf16le'))).toBe(true);

  // The voice fixture is silence, so every bit of energy in the file is music.
  const levels = await page.evaluate(async (b64) => {
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const buf = await new OfflineAudioContext(2, 1, 24000).decodeAudioData(data.buffer);
    const rms = (from, to) => {
      let sum = 0;
      let n = 0;
      for (let ch = 0; ch < buf.numberOfChannels; ch += 1) {
        const d = buf.getChannelData(ch);
        for (let i = Math.floor(from * buf.sampleRate); i < Math.floor(to * buf.sampleRate); i += 1) {
          sum += d[i] * d[i];
          n += 1;
        }
      }
      return Math.sqrt(sum / n);
    };
    // Layout: 2.5 s lead-in, three 3 s chapters with 1.5 s gaps, 6 s tail.
    return {
      duration: buf.duration,
      channels: buf.numberOfChannels,
      bed: (rms(1.4, 2.0) + rms(15.3, 15.9)) / 2,
      ducked: (rms(3.2, 5.2) + rms(7.7, 9.7)) / 2,
    };
  }, bytes.toString('base64'));

  expect(levels.channels).toBe(2);
  expect(levels.duration).toBeGreaterThan(19);
  expect(levels.duration).toBeLessThan(22);
  expect(levels.bed).toBeGreaterThan(0.01); // around -25 dBFS
  expect(levels.bed / levels.ducked).toBeGreaterThan(3); // > ~10 dB of ducking
});

test('with music off, downloads come straight from the server', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('chronix_podcast_music', JSON.stringify({ enabled: false })));
  const calls = await mockBackend(page, { timelineId: 'tl-1', isOwner: false, episodes: [episode('ep-1', 'tl-1')] });
  await page.goto('/t/tl-1?listen=1');
  await expect(page.getByRole('button', { name: 'Background music: off' })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download MP3' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Race to the Moon.mp3');
  expect(calls.download).toBe(1);
});

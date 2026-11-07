// Renders each music mood offline in headless Chromium and reports loudness stats.
// Usage: node music_probe.mjs [seconds] [outDir]
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

const seconds = Number(process.argv[2] || 40);
const outDir = process.argv[3] || null;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5181/');
const results = await page.evaluate(async ({ seconds, wantWav }) => {
  const m = await import('/src/utils/podcastMusic.js');
  const out = {};
  for (const mood of m.MUSIC_MOODS) {
    const sr = 24000;
    const ctx = new OfflineAudioContext(2, seconds * sr, sr);
    const bed = m.createMusicBed(ctx, { mood, seed: 'episode-123', startTime: 0 });
    bed.output.gain.value = 1;
    const vol = ctx.createGain();
    vol.gain.value = m.musicVolumeGain(m.DEFAULT_MUSIC_VOLUME);
    bed.output.connect(vol);
    vol.connect(ctx.destination);
    bed.scheduleUntil(seconds);
    const t0 = performance.now();
    const buf = await ctx.startRendering();
    const ms = performance.now() - t0;
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    let sum = 0, peak = 0, nan = 0;
    const skip = 4 * sr; // ignore the fade-in of the first chord
    for (let i = skip; i < L.length; i++) {
      const a = L[i], b = R[i];
      if (!Number.isFinite(a) || !Number.isFinite(b)) { nan++; continue; }
      sum += a * a + b * b;
      peak = Math.max(peak, Math.abs(a), Math.abs(b));
    }
    const rms = Math.sqrt(sum / (2 * (L.length - skip)));
    // windowed RMS (1 s) min/max to see dynamics
    let wmin = 1, wmax = 0;
    for (let w = skip; w + sr <= L.length; w += sr) {
      let s = 0; for (let i = w; i < w + sr; i++) s += L[i] * L[i] + R[i] * R[i];
      const r = Math.sqrt(s / (2 * sr)); wmin = Math.min(wmin, r); wmax = Math.max(wmax, r);
    }
    const db = (x) => +(20 * Math.log10(Math.max(x, 1e-9))).toFixed(1);
    let wav = null;
    if (wantWav) {
      const n = L.length; const bytes = new Uint8Array(44 + n * 4); const dv = new DataView(bytes.buffer);
      const w = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
      w(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true);
      dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true);
      dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 4, true);
      for (let i = 0; i < n; i++) {
        dv.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
        dv.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
      }
      let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      wav = btoa(bin);
    }
    out[mood] = { rmsDb: db(rms), peakDb: db(peak), winMinDb: db(wmin), winMaxDb: db(wmax), nan, renderMs: Math.round(ms), level: bed.preset.level, wav };
  }
  return out;
}, { seconds, wantWav: Boolean(outDir) });
await browser.close();
for (const [mood, r] of Object.entries(results)) {
  if (outDir && r.wav) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(`${outDir}/${mood}.wav`, Buffer.from(r.wav, 'base64'));
  }
  delete r.wav;
  console.log(mood.padEnd(20), JSON.stringify(r));
}

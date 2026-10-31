// Client-side episode mixdown: voice chapters + the procedural music bed rendered offline with
// the exact same synth the live player uses, encoded to MP3 (LAME compiled to WebAssembly).
import {
  applyEnvelope,
  buildId3Tag,
  buildMixLayout,
  createMusicBed,
  mixEnvelope,
  musicVolumeGain,
} from './podcastMusic';

const SAMPLE_RATE = 24000; // the chapters' native rate; keeps memory low on phones
const BITRATE = 96; // stereo
const ENCODE_CHUNK = 1152 * 48;
const SCHEDULE_STEP = 4; // seconds between offline-render suspend points
const SCHEDULE_AHEAD = 2;

function offlineContextClass() {
  if (typeof window === 'undefined') return null;
  return window.OfflineAudioContext || window.webkitOfflineAudioContext || null;
}

export function supportsMusicMixdown() {
  return Boolean(offlineContextClass()) && typeof WebAssembly !== 'undefined';
}

function decode(ctx, data) {
  return new Promise((resolve, reject) => {
    const maybe = ctx.decodeAudioData(data, resolve, reject);
    if (maybe && typeof maybe.then === 'function') maybe.then(resolve, reject);
  });
}

function render(ctx) {
  return new Promise((resolve, reject) => {
    ctx.oncomplete = (e) => resolve(e.renderedBuffer);
    const maybe = ctx.startRendering();
    if (maybe && typeof maybe.then === 'function') maybe.then(resolve, reject);
  });
}

async function mapLimit(count, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < count) {
      const i = next;
      next += 1;
      await fn(i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, count) }, worker));
}

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

async function encodeMp3(buffer, onProgress) {
  // Separate awaited imports so the bundler can tree-shake the package's inlined WASM blobs.
  const { createEncoder } = await import('wasm-media-encoders');
  const { default: wasmUrl } = await import('wasm-media-encoders/wasm/mp3?url');
  const encoder = await createEncoder('audio/mpeg', wasmUrl);
  encoder.configure({ sampleRate: buffer.sampleRate, channels: 2, bitrate: BITRATE });
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const parts = [];
  for (let i = 0; i < left.length; i += ENCODE_CHUNK) {
    const out = encoder.encode([left.subarray(i, i + ENCODE_CHUNK), right.subarray(i, i + ENCODE_CHUNK)]);
    // The encoder reuses its output buffer, so copy every chunk.
    if (out.length) parts.push(out.slice());
    onProgress?.(i / left.length);
    if ((i / ENCODE_CHUNK) % 6 === 5) await yieldToUi();
  }
  const tail = encoder.finalize();
  if (tail.length) parts.push(tail.slice());
  onProgress?.(1);
  return parts;
}

/**
 * Builds the whole episode as one MP3 with background music.
 * `loadClip(i)` must resolve to the i-th chapter's MP3 bytes (ArrayBuffer).
 */
export async function mixdownEpisodeWithMusic({
  chapterCount,
  loadClip,
  mood,
  seed,
  musicVolume,
  title,
  artist,
  onProgress,
}) {
  const Offline = offlineContextClass();
  if (!Offline) throw new Error('Offline audio rendering is not supported in this browser.');
  const report = (f) => onProgress?.(Math.min(1, Math.max(0, f)));

  const decoder = new Offline(1, 1, SAMPLE_RATE);
  const chapters = new Array(chapterCount);
  let loaded = 0;
  await mapLimit(chapterCount, 3, async (i) => {
    chapters[i] = await decode(decoder, await loadClip(i));
    loaded += 1;
    report(0.45 * (loaded / chapterCount));
  });

  const layout = buildMixLayout(chapters.map((b) => b.duration));
  const ctx = new Offline(2, Math.ceil(layout.total * SAMPLE_RATE), SAMPLE_RATE);
  // Safety limiter so voice peaks + music never clip.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  limiter.connect(ctx.destination);

  chapters.forEach((buf, i) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(limiter);
    src.start(layout.starts[i]);
  });

  const bed = createMusicBed(ctx, { mood, seed, startTime: 0 });
  const volume = ctx.createGain();
  volume.gain.value = musicVolumeGain(musicVolume);
  bed.output.connect(volume);
  volume.connect(limiter);
  applyEnvelope(bed.output.gain, mixEnvelope(layout));
  // Queue notes a few seconds ahead of the render position (via suspend points) rather than all
  // up front: a fully pre-scheduled graph makes rendering time grow quadratically with length.
  if (typeof ctx.suspend === 'function') {
    bed.scheduleUntil(SCHEDULE_STEP + SCHEDULE_AHEAD);
    for (let t = SCHEDULE_STEP; t < layout.total; t += SCHEDULE_STEP) {
      ctx.suspend(t).then(() => {
        bed.scheduleUntil(t + SCHEDULE_STEP + SCHEDULE_AHEAD);
        report(0.45 + 0.17 * (t / layout.total));
        ctx.resume();
      });
    }
  } else {
    bed.scheduleUntil(layout.total);
  }
  report(0.45);

  const mixed = await render(ctx);
  report(0.62);
  const mp3 = await encodeMp3(mixed, (f) => report(0.62 + 0.38 * f));
  return new Blob([buildId3Tag(title || 'ChroniX Podcast', artist || 'ChroniX'), ...mp3], { type: 'audio/mpeg' });
}

export function downloadFilename(title) {
  const clean = String(title || '').replace(/[\x00-\x1f\\/:*?"<>|]+/g, '').trim();
  return `${clean || 'ChroniX podcast'}.mp3`;
}

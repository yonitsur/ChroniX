// Client-side episode mixdown: voice chapters + the procedural music bed rendered offline with
// the exact same synth the live player uses, encoded to MP3 (LAME compiled to WebAssembly).
//
// The episode is rendered and encoded in ~60 s windows (see podcastMixdownPlan.js), and chapters
// are decoded only while a window overlaps them, so peak memory follows the window size instead of
// the episode length (a single full-length render of a 30-minute episode needed ~0.5-0.7 GB).
import {
  MUSIC_PRESETS,
  applyEnvelope,
  barDuration,
  buildId3Tag,
  createMusicBed,
  mixEnvelope,
  musicVolumeGain,
  normalizeMusicMood,
} from './podcastMusic.js';
import {
  MIX_CROSSFADE_SECONDS,
  MIX_WINDOW_SECONDS,
  chaptersInRange,
  createChapterCache,
  frameLayout,
  musicPrerollSeconds,
  planMixWindows,
  runWindowedMixdown,
  shiftEnvelope,
  throwIfAborted,
} from './podcastMixdownPlan.js';

const SAMPLE_RATE = 24000; // the chapters' native rate; keeps memory low on phones
const BITRATE = 96; // stereo
const ENCODE_CHUNK = 1152 * 48;
const SCHEDULE_STEP = 4; // seconds between offline-render suspend points
const SCHEDULE_AHEAD = 2;
const MEASURE_SHARE = 0.2; // progress share of the first pass (fetch + measure every chapter)

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

// Compressed clips are kept between the measuring pass and the windowed pass (they are ~30x
// smaller than decoded PCM); a Blob lets the browser hold them outside the JS heap.
function stashClip(bytes) {
  return typeof Blob !== 'undefined' ? new Blob([bytes]) : bytes.slice(0);
}

function unstashClip(stash) {
  return typeof Blob !== 'undefined' && stash instanceof Blob ? stash.arrayBuffer() : stash.slice(0);
}

async function createMp3Encoder(sampleRate) {
  // Separate awaited imports so the bundler can tree-shake the package's inlined WASM blobs.
  const { createEncoder } = await import('wasm-media-encoders');
  const { default: wasmUrl } = await import('wasm-media-encoders/wasm/mp3?url');
  const encoder = await createEncoder('audio/mpeg', wasmUrl);
  encoder.configure({ sampleRate, channels: 2, bitrate: BITRATE });
  return encoder;
}

/** Renders one window: the chapters overlapping it plus the music bars [firstBar, endBar). */
async function renderMixWindow(Offline, win, mix) {
  const { cache, startFrames, chapterFrames, envelope, mood, seed, musicGain, barSeconds } = mix;
  const frames = win.renderEnd - win.renderStart;
  const origin = win.renderStart / SAMPLE_RATE;
  const ctx = new Offline(2, frames, SAMPLE_RATE);
  // Safety limiter so voice peaks + music never clip.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  limiter.connect(ctx.destination);

  for (const i of chaptersInRange(startFrames, chapterFrames, win.renderStart, win.renderEnd)) {
    const src = ctx.createBufferSource();
    src.buffer = cache.get(i);
    src.connect(limiter);
    // Whole-frame offsets keep every chapter sample-aligned with the episode timeline.
    const lead = startFrames[i] - win.renderStart;
    if (lead >= 0) src.start(lead / SAMPLE_RATE);
    else src.start(0, -lead / SAMPLE_RATE);
  }

  const bed = createMusicBed(ctx, {
    mood,
    seed,
    startBar: win.firstBar,
    startTime: Math.max(0, win.firstBar * barSeconds - origin),
  });
  const volume = ctx.createGain();
  volume.gain.value = musicGain;
  bed.output.connect(volume);
  volume.connect(limiter);
  applyEnvelope(bed.output.gain, shiftEnvelope(envelope, origin));

  // Queue notes a few seconds ahead of the render position (via suspend points) rather than all
  // up front: a fully pre-scheduled graph makes rendering time grow quadratically with length.
  const end = frames / SAMPLE_RATE;
  if (typeof ctx.suspend === 'function') {
    bed.scheduleUntil(Math.min(end, SCHEDULE_STEP + SCHEDULE_AHEAD));
    for (let t = SCHEDULE_STEP; t < end; t += SCHEDULE_STEP) {
      ctx.suspend(t).then(() => {
        bed.scheduleUntil(Math.min(end, t + SCHEDULE_STEP + SCHEDULE_AHEAD));
        ctx.resume();
      });
    }
  } else {
    bed.scheduleUntil(end);
  }

  const rendered = await render(ctx);
  const left = rendered.getChannelData(0);
  return { left, right: rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left };
}

/**
 * Implementation behind mixdownEpisodeWithMusic with the browser dependencies injected, so it can
 * be exercised with fakes. Resolves to { blob, stats }.
 */
export async function mixdownWithDeps({
  Offline,
  createEncoder = createMp3Encoder,
  chapterCount,
  loadClip,
  mood,
  seed,
  musicVolume,
  title,
  artist,
  onProgress,
  signal,
  windowSeconds = MIX_WINDOW_SECONDS,
}) {
  const report = (f) => onProgress?.(Math.min(1, Math.max(0, f)));
  throwIfAborted(signal);

  // Pass 1: fetch every chapter once to learn its decoded length (needed for the layout), keeping
  // only the compressed bytes. Each decoded buffer is dropped right after it is measured.
  const decoder = new Offline(1, 1, SAMPLE_RATE);
  const clips = new Array(chapterCount);
  const chapterFrames = new Array(chapterCount);
  let measured = 0;
  await mapLimit(chapterCount, 3, async (i) => {
    throwIfAborted(signal);
    const bytes = await loadClip(i);
    clips[i] = stashClip(bytes);
    chapterFrames[i] = (await decode(decoder, bytes)).length;
    measured += 1;
    report(MEASURE_SHARE * (measured / chapterCount));
  });
  throwIfAborted(signal);

  const preset = MUSIC_PRESETS[normalizeMusicMood(mood, null, seed)];
  const barSeconds = barDuration(preset);
  const { layout, startFrames, totalFrames } = frameLayout(chapterFrames, SAMPLE_RATE);
  const windows = planMixWindows({
    totalFrames,
    sampleRate: SAMPLE_RATE,
    barSeconds,
    prerollSeconds: musicPrerollSeconds(preset),
    windowSeconds,
    crossfadeFrames: Math.round(MIX_CROSSFADE_SECONDS * SAMPLE_RATE),
  });
  const cache = createChapterCache(async (i) => decode(decoder, await unstashClip(clips[i])));
  const mix = {
    cache,
    startFrames,
    chapterFrames,
    envelope: mixEnvelope(layout),
    mood,
    seed,
    musicGain: musicVolumeGain(musicVolume),
    barSeconds,
  };
  report(MEASURE_SHARE);

  // Pass 2: render, crossfade and encode window by window.
  const encoder = await createEncoder(SAMPLE_RATE);
  let parts;
  try {
    parts = await runWindowedMixdown({
      windows,
      encoder,
      chunkFrames: ENCODE_CHUNK,
      signal,
      onProgress: (f) => report(MEASURE_SHARE + (1 - MEASURE_SHARE) * f),
      renderWindow: async (win) => {
        await cache.retain(chaptersInRange(startFrames, chapterFrames, win.renderStart, win.renderEnd), signal);
        return renderMixWindow(Offline, win, mix);
      },
    });
  } finally {
    cache.clear();
  }
  const blob = new Blob([buildId3Tag(title || 'ChroniX Podcast', artist || 'ChroniX'), ...parts], { type: 'audio/mpeg' });
  return { blob, stats: { totalFrames, windows: windows.length, peakLiveChapters: cache.peak } };
}

/**
 * Builds the whole episode as one MP3 with background music.
 * `loadClip(i)` must resolve to the i-th chapter's MP3 bytes (ArrayBuffer). An optional AbortSignal
 * (`signal`) stops the mixdown between chapters and windows.
 */
export async function mixdownEpisodeWithMusic(options) {
  const Offline = offlineContextClass();
  if (!Offline) throw new Error('Offline audio rendering is not supported in this browser.');
  const { blob } = await mixdownWithDeps({ ...options, Offline });
  return blob;
}

export function downloadFilename(title) {
  const clean = String(title || '').replace(/[\x00-\x1f\\/:*?"<>|]+/g, '').trim();
  return `${clean || 'ChroniX podcast'}.mp3`;
}

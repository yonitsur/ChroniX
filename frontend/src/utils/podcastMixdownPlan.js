// Pure planning helpers for the windowed podcast mixdown. Nothing here touches Web Audio, so the
// sample-boundary math, chapter selection and the incremental encode loop are testable in Node.
//
// The episode is rendered in windows of ~60 s instead of one OfflineAudioContext spanning the whole
// episode. Each window renders from a sample-aligned `renderStart` (a "preroll" before the samples
// it keeps) so that long pad notes, the reverb tail and both compressors are in the same state they
// would be in a single full-length render. Only [keepStart, keepEnd) is kept; consecutive keep
// ranges tile the episode exactly. A short linear crossfade into the next window hides any
// residual difference left by the compressors.
import { barDuration, buildMixLayout } from './podcastMusic.js';

export const MIX_WINDOW_SECONDS = 60;
export const MIX_CROSSFADE_SECONDS = 0.02;
// Time the music bed's compressor and the safety limiter need to converge once their input is
// identical to the full-length render.
export const DYNAMICS_SETTLE_SECONDS = 3;
// Margin for filter ring-down after a source has stopped.
const RING_DOWN_SECONDS = 0.25;

export function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException('The mixdown was aborted.', 'AbortError');
}

/**
 * Longest time any note of `preset` keeps sounding after its scheduled start, mirroring the stop
 * times used by createMusicBed's renderers (pad/bass hold for a whole chord, plus releases).
 */
export function maxMusicEventSeconds(preset) {
  const beat = 60 / preset.bpm;
  const chord = barDuration(preset) * (preset.barsPerChord || 1);
  const spans = [0.9]; // pulse
  if (preset.pad) spans.push(chord + (preset.pad.release || 0) + 0.05);
  if (preset.bass) spans.push(chord + 0.85, beat * 0.68 + 0.35);
  if (preset.arp) spans.push((preset.arp.decay || 0) + 0.15);
  if (preset.motif) spans.push(beat * 2.8 + 0.9);
  return Math.max(...spans);
}

/** Seconds a window must render before its first kept sample to match a full-length render. */
export function musicPrerollSeconds(preset) {
  return maxMusicEventSeconds(preset) + RING_DOWN_SECONDS + (preset.reverb?.seconds || 0) + DYNAMICS_SETTLE_SECONDS;
}

/**
 * Episode layout in whole sample frames. Chapter durations come from decoded frame counts, so
 * chapter starts already sit on sample boundaries (rounding only removes float noise).
 */
export function frameLayout(chapterFrames, sampleRate) {
  const layout = buildMixLayout(chapterFrames.map((n) => n / sampleRate));
  const startFrames = layout.starts.map((s) => Math.round(s * sampleRate));
  const totalFrames = Math.max(1, Math.ceil(layout.total * sampleRate - 1e-6));
  return { layout, startFrames, totalFrames };
}

/**
 * Splits [0, totalFrames) into render windows. Keep ranges tile the episode with no gaps or
 * overlaps; `renderStart` is sample-aligned at (or just before) the start of `firstBar`, the first
 * music bar whose notes can still be heard in the keep range; `renderEnd` adds the crossfade tail.
 * Music bars [firstBar, endBar) are the only ones scheduled into the window.
 */
export function planMixWindows({
  totalFrames,
  sampleRate,
  barSeconds,
  prerollSeconds = 0,
  windowSeconds = MIX_WINDOW_SECONDS,
  crossfadeFrames = Math.round(MIX_CROSSFADE_SECONDS * sampleRate),
}) {
  const windowFrames = Math.max(1, Math.round(windowSeconds * sampleRate));
  const fade = Math.max(0, Math.floor(crossfadeFrames));
  const windows = [];
  for (let keepStart = 0; keepStart < totalFrames; keepStart += windowFrames) {
    const keepEnd = Math.min(totalFrames, keepStart + windowFrames);
    const renderEnd = Math.min(totalFrames, keepEnd + fade);
    let firstBar = 0;
    let renderStart = 0;
    if (keepStart > 0) {
      const needFrom = keepStart / sampleRate - prerollSeconds;
      firstBar = Math.max(0, Math.floor(needFrom / barSeconds));
      renderStart = Math.max(0, Math.min(keepStart, Math.floor(firstBar * barSeconds * sampleRate)));
    }
    const endBar = Math.max(firstBar, Math.ceil(renderEnd / sampleRate / barSeconds));
    windows.push({ index: windows.length, keepStart, keepEnd, renderStart, renderEnd, firstBar, endBar });
  }
  return windows;
}

/** Indices of chapters that overlap the frame range [from, to). */
export function chaptersInRange(startFrames, chapterFrames, from, to) {
  const out = [];
  for (let i = 0; i < startFrames.length; i += 1) {
    const start = startFrames[i];
    const end = start + (chapterFrames[i] || 0);
    if (end > start && start < to && end > from) out.push(i);
  }
  return out;
}

/**
 * Keeps decoded chapters only while a window needs them. `retain(indices)` releases every chapter
 * not listed *before* decoding the missing ones, so at most `indices.length` buffers are live.
 */
export function createChapterCache(load, { onRelease } = {}) {
  const live = new Map();
  let peak = 0;
  const release = (i) => {
    const buf = live.get(i);
    live.delete(i);
    onRelease?.(i, buf);
  };
  return {
    async retain(indices, signal) {
      const wanted = new Set(indices);
      for (const i of [...live.keys()]) if (!wanted.has(i)) release(i);
      for (const i of indices) {
        if (live.has(i)) continue;
        throwIfAborted(signal);
        live.set(i, await load(i));
        peak = Math.max(peak, live.size);
      }
    },
    get: (i) => live.get(i),
    clear() {
      for (const i of [...live.keys()]) release(i);
    },
    get size() {
      return live.size;
    },
    get peak() {
      return peak;
    },
  };
}

/** Value of a mixEnvelope() automation (setValueAtTime / linearRampToValueAtTime points) at `t`. */
export function envelopeValueAt(points, t) {
  let prevT = 0;
  let prevV = 0;
  for (const p of points) {
    if (p.t > t) {
      if (!p.ramp) return prevV;
      return prevV + ((p.v - prevV) * (t - prevT)) / (p.t - prevT);
    }
    prevT = p.t;
    prevV = p.v;
  }
  return prevV;
}

/**
 * The same automation as seen by a window whose local time 0 is `origin` seconds into the episode:
 * AudioParam events can't be scheduled at negative times, so everything before the origin collapses
 * into one starting value and later ramps continue along the same lines.
 */
export function shiftEnvelope(points, origin) {
  const shifted = [{ t: 0, v: envelopeValueAt(points, origin) }];
  for (const p of points) {
    if (p.t > origin) shifted.push({ ...p, t: p.t - origin });
  }
  return shifted;
}

const defaultPause = () => new Promise((resolve) => setTimeout(resolve, 0));

function crossfadeInto(dest, tail, frames) {
  for (let j = 0; j < frames; j += 1) {
    const w = (j + 0.5) / frames;
    dest[j] = tail[j] * (1 - w) + dest[j] * w;
  }
}

/**
 * Renders each window, crossfades it into the previous window's tail, and streams the kept frames
 * into `encoder` ({ encode([left, right]) -> Uint8Array, finalize() -> Uint8Array }) in chunks.
 * `renderWindow(win)` resolves to { left, right } covering [renderStart, renderEnd); only the
 * crossfade tail is copied out, so a window's PCM can be dropped as soon as it is encoded.
 */
export async function runWindowedMixdown({
  windows,
  renderWindow,
  encoder,
  chunkFrames,
  onProgress,
  signal,
  yieldEvery = 6,
  pause = defaultPause,
}) {
  const total = windows.length ? windows[windows.length - 1].keepEnd : 0;
  const parts = [];
  let tail = null;
  let done = 0;
  let chunks = 0;
  for (const win of windows) {
    throwIfAborted(signal);
    const rendered = await renderWindow(win);
    throwIfAborted(signal);
    const length = win.renderEnd - win.renderStart;
    if (!rendered?.left || rendered.left.length < length || rendered.right.length < length) {
      throw new Error('Rendered window is shorter than planned.');
    }
    const mono = rendered.right === rendered.left;
    const from = win.keepStart - win.renderStart;
    const to = win.keepEnd - win.renderStart;
    const left = rendered.left.subarray(from, to);
    const right = mono ? left : rendered.right.subarray(from, to);
    if (tail) {
      const frames = Math.min(tail.left.length, left.length);
      crossfadeInto(left, tail.left, frames);
      if (!mono) crossfadeInto(right, tail.right, frames);
    }
    tail = null;
    if (win.renderEnd > win.keepEnd) {
      const tailLeft = rendered.left.slice(to, length);
      tail = { left: tailLeft, right: mono ? tailLeft : rendered.right.slice(to, length) };
    }
    for (let i = 0; i < left.length; i += chunkFrames) {
      const out = encoder.encode([left.subarray(i, i + chunkFrames), right.subarray(i, i + chunkFrames)]);
      // The encoder reuses its output buffer, so copy every chunk.
      if (out.length) parts.push(out.slice());
      chunks += 1;
      onProgress?.(Math.min(1, (done + Math.min(left.length, i + chunkFrames)) / total));
      if (chunks % yieldEvery === 0) await pause();
    }
    done += left.length;
  }
  const last = encoder.finalize();
  if (last.length) parts.push(last.slice());
  onProgress?.(1);
  return parts;
}

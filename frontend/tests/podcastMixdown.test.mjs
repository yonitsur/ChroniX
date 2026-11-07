import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MUSIC_MOODS,
  MUSIC_PRESETS,
  barDuration,
  buildMixLayout,
  hashSeed,
  mixEnvelope,
  planBar,
} from '../src/utils/podcastMusic.js';
import {
  DYNAMICS_SETTLE_SECONDS,
  chaptersInRange,
  createChapterCache,
  envelopeValueAt,
  frameLayout,
  maxMusicEventSeconds,
  musicPrerollSeconds,
  planMixWindows,
  runWindowedMixdown,
  shiftEnvelope,
} from '../src/utils/podcastMixdownPlan.js';
import { mixdownWithDeps } from '../src/utils/podcastMixdown.js';

const SR = 24000;
const XF = Math.round(0.02 * SR);
const W = 60 * SR;

function assertTiles(windows, totalFrames, { sampleRate, barSeconds, prerollSeconds, crossfadeFrames }) {
  assert.equal(windows.length, Math.ceil(totalFrames / Math.round(60 * sampleRate)));
  assert.equal(windows[0].keepStart, 0);
  assert.equal(windows.at(-1).keepEnd, totalFrames);
  windows.forEach((w, k) => {
    for (const key of ['keepStart', 'keepEnd', 'renderStart', 'renderEnd', 'firstBar', 'endBar']) {
      assert.ok(Number.isInteger(w[key]), `${key} is a whole number`);
    }
    if (k > 0) assert.equal(w.keepStart, windows[k - 1].keepEnd, 'no gap or overlap between kept ranges');
    assert.ok(w.keepEnd > w.keepStart);
    assert.ok(w.keepEnd - w.keepStart <= Math.round(60 * sampleRate));
    assert.ok(w.renderStart >= 0 && w.renderStart <= w.keepStart);
    assert.equal(w.renderEnd, Math.min(totalFrames, w.keepEnd + crossfadeFrames));
    // Render origin sits on the sample at (or just before) the first scheduled bar.
    const barFrame = w.firstBar * barSeconds * sampleRate;
    assert.ok(w.renderStart <= barFrame + 1e-6 && barFrame - w.renderStart < 1);
    if (w.keepStart > 0 && w.firstBar > 0) {
      assert.ok(w.keepStart - w.renderStart >= prerollSeconds * sampleRate - 1, 'enough preroll');
    }
    // Rendered length is bounded by the window size, not the episode.
    assert.ok(w.renderEnd - w.renderStart <= Math.round(60 * sampleRate) + crossfadeFrames + (prerollSeconds + barSeconds) * sampleRate + 1);
  });
}

test('window plans tile episodes of any length exactly on sample boundaries', () => {
  for (const mood of ['cello_elegy', 'indie_groove', 'sunrise_piano']) {
    const preset = MUSIC_PRESETS[mood];
    const opts = { sampleRate: SR, barSeconds: barDuration(preset), prerollSeconds: musicPrerollSeconds(preset), crossfadeFrames: XF };
    for (const totalFrames of [1, XF, W - 1, W, W + 1, W + XF - 1, 2 * W + 7, 30 * 60 * SR, 2 * 3600 * SR + 17]) {
      const windows = planMixWindows({ totalFrames, ...opts });
      assertTiles(windows, totalFrames, opts);
      const kept = windows.reduce((sum, w) => sum + (w.keepEnd - w.keepStart), 0);
      assert.equal(kept, totalFrames, `${mood}: ${totalFrames} frames kept exactly once`);
    }
  }
  // Other sample rates keep integral boundaries too.
  const preset = MUSIC_PRESETS.cinematic_orchestra;
  const opts = { sampleRate: 44100, barSeconds: barDuration(preset), prerollSeconds: musicPrerollSeconds(preset), crossfadeFrames: 882 };
  assertTiles(planMixWindows({ totalFrames: 44100 * 1234 + 5, ...opts }), 44100 * 1234 + 5, opts);
});

test('frame layout matches the mix layout with whole-frame chapter starts', () => {
  const frames = [SR * 12 + 7, 1, SR * 95 + 11999, 0, SR * 30];
  const { layout, startFrames, totalFrames } = frameLayout(frames, SR);
  const reference = buildMixLayout(frames.map((n) => n / SR));
  assert.deepEqual(layout, reference);
  startFrames.forEach((s, i) => {
    assert.ok(Number.isInteger(s));
    assert.ok(Math.abs(s - reference.starts[i] * SR) < 1e-6);
  });
  assert.equal(totalFrames, Math.ceil(reference.total * SR - 1e-6));
  assert.ok(totalFrames >= reference.total * SR - 1e-6);
});

test('chapter selection returns exactly the chapters overlapping a window', () => {
  const starts = [100, 300, 300, 1000];
  const lengths = [200, 0, 50, 10];
  assert.deepEqual(chaptersInRange(starts, lengths, 0, 100), []);
  assert.deepEqual(chaptersInRange(starts, lengths, 0, 101), [0]);
  assert.deepEqual(chaptersInRange(starts, lengths, 299, 301), [0, 2], 'empty chapters are skipped');
  assert.deepEqual(chaptersInRange(starts, lengths, 300, 350), [2]);
  assert.deepEqual(chaptersInRange(starts, lengths, 350, 1000), []);
  assert.deepEqual(chaptersInRange(starts, lengths, 1009, 5000), [3]);
  assert.deepEqual(chaptersInRange(starts, lengths, 1010, 5000), []);

  // Brute force over a realistic episode.
  const frames = [45, 90, 30, 120, 75, 20, 200].map((s) => s * SR + 13);
  const { startFrames, totalFrames } = frameLayout(frames, SR);
  const preset = MUSIC_PRESETS.cello_elegy;
  for (const w of planMixWindows({ totalFrames, sampleRate: SR, barSeconds: barDuration(preset), prerollSeconds: musicPrerollSeconds(preset), crossfadeFrames: XF })) {
    const expected = frames.map((_, i) => i).filter((i) => startFrames[i] < w.renderEnd && startFrames[i] + frames[i] > w.renderStart);
    assert.deepEqual(chaptersInRange(startFrames, frames, w.renderStart, w.renderEnd), expected);
  }
});

test('chapter buffers are decoded lazily, once each, and released when no longer needed', async () => {
  const frames = [95, 140, 60, 180, 75, 110, 65, 150].map((s) => s * SR + 101);
  const { startFrames, totalFrames } = frameLayout(frames, SR);
  const preset = MUSIC_PRESETS.cello_elegy; // slowest score => longest preroll
  const windows = planMixWindows({ totalFrames, sampleRate: SR, barSeconds: barDuration(preset), prerollSeconds: musicPrerollSeconds(preset), crossfadeFrames: XF });
  let live = 0;
  let maxLive = 0;
  const decodes = new Map();
  const cache = createChapterCache(
    async (i) => {
      decodes.set(i, (decodes.get(i) || 0) + 1);
      live += 1;
      maxLive = Math.max(maxLive, live);
      await new Promise((r) => setImmediate(r));
      return { chapter: i };
    },
    { onRelease: () => { live -= 1; } },
  );
  for (const w of windows) {
    const needed = chaptersInRange(startFrames, frames, w.renderStart, w.renderEnd);
    await cache.retain(needed);
    for (const i of needed) assert.deepEqual(cache.get(i), { chapter: i });
    assert.equal(cache.size, needed.length, 'only the chapters overlapping this window are live');
  }
  cache.clear();
  assert.equal(live, 0, 'all buffers released');
  assert.ok(maxLive <= 3, `at most 3 live chapter buffers (saw ${maxLive})`);
  assert.equal(cache.peak, maxLive);
  assert.deepEqual([...decodes.keys()].sort((a, b) => a - b), frames.map((_, i) => i));
  assert.ok([...decodes.values()].every((n) => n === 1), 'no chapter is decoded twice');
});

test('music: each window schedules only the bars that can be heard in it', () => {
  const seed = hashSeed('episode-42');
  const totalFrames = 10 * 60 * SR + 333;
  for (const mood of MUSIC_MOODS) {
    const preset = MUSIC_PRESETS[mood];
    const bar = barDuration(preset);
    const maxEvent = maxMusicEventSeconds(preset);
    const audible = maxEvent + preset.reverb.seconds;
    const windows = planMixWindows({ totalFrames, sampleRate: SR, barSeconds: bar, prerollSeconds: musicPrerollSeconds(preset), crossfadeFrames: XF });
    const totalBars = Math.ceil(totalFrames / SR / bar) + 1;
    for (const w of windows) {
      const origin = w.renderStart / SR;
      const keepStart = w.keepStart / SR;
      const renderEnd = w.renderEnd / SR;
      for (let b = 0; b < totalBars; b += 1) {
        const events = planBar(preset, seed, b).map((ev) => ({ ...ev, start: b * bar + ev.at }));
        for (const ev of events) {
          // Sanity: the preroll model covers every note's real length.
          const dur = ev.dur + (ev.kind === 'pad' ? preset.pad.release : 0);
          assert.ok(dur <= maxEvent, `${mood} ${ev.kind} fits the max event span`);
        }
        const scheduled = b >= w.firstBar && b < w.endBar;
        if (scheduled) {
          for (const ev of events) assert.ok(ev.start >= origin - 1e-9, `${mood}: scheduled note never precedes the window origin`);
          assert.ok(b * bar < renderEnd + 1e-9, `${mood}: scheduled bar starts inside the window`);
        } else if (b < w.firstBar) {
          for (const ev of events) {
            assert.ok(ev.start + audible + DYNAMICS_SETTLE_SECONDS <= keepStart + 1e-9, `${mood}: skipped earlier note is silent and settled before keepStart`);
          }
        } else {
          assert.ok(b * bar >= renderEnd - 1e-9, `${mood}: skipped later bar starts after the window`);
        }
      }
    }
  }
});

test('shifted envelopes reproduce ducking and swells exactly from any window origin', () => {
  const layout = buildMixLayout([30, 0.2, 75, 12]);
  const points = mixEnvelope(layout);
  const evalAll = (pts, t) => envelopeValueAt(pts, t);
  // Reference checks of the evaluator against the known envelope shape.
  assert.equal(evalAll(points, 0), 0);
  assert.equal(evalAll(points, layout.regions[0].start + 1), 0.2, 'ducked under the voice');
  assert.equal(evalAll(points, layout.regions[0].end + 0.7), 1, 'swells back between chapters');
  assert.ok(Math.abs(evalAll(points, layout.regions[0].end + 0.35) - 0.6) < 1e-9, 'linear swell');
  assert.equal(evalAll(points, layout.total), 0);
  for (const origin of [0, 0.6, 5.05, 5.5, 20, layout.regions[0].end + 0.2, layout.regions[2].start - 0.1, layout.total - 2]) {
    const shifted = shiftEnvelope(points, origin);
    assert.ok(shifted.every((p) => p.t >= 0), 'no negative automation times');
    for (let k = 0; k < 400; k += 1) {
      const t = origin + (k / 400) * (layout.total - origin + 1);
      assert.ok(Math.abs(evalAll(shifted, t - origin) - evalAll(points, t)) < 1e-9, `origin ${origin}, t ${t}`);
    }
  }
});

// ---- incremental encode loop ---------------------------------------------------------------

function streamingEncoder(check) {
  let frames = 0;
  let finalized = 0;
  return {
    encode([l, r]) {
      assert.equal(l.length, r.length);
      for (let j = 0; j < l.length; j += 1) check(frames + j, l[j], r[j]);
      frames += l.length;
      return new Uint8Array(l.length ? 1 : 0);
    },
    finalize() {
      finalized += 1;
      return new Uint8Array([7]);
    },
    get frames() { return frames; },
    get finalized() { return finalized; },
  };
}

function fakeRender(signalAt) {
  return async (win) => {
    const n = win.renderEnd - win.renderStart;
    const left = new Float64Array(n);
    const right = new Float64Array(n);
    for (let j = 0; j < n; j += 1) {
      left[j] = signalAt(win, win.renderStart + j);
      right[j] = -left[j];
    }
    return { left, right };
  };
}

test('windows are encoded incrementally with every frame exactly once and in order', async () => {
  for (const totalFrames of [1, XF + 3, W, W + 1, 3 * W + XF + 5, 31 * 60 * SR + 9]) {
    const windows = planMixWindows({ totalFrames, sampleRate: SR, barSeconds: 2.5, prerollSeconds: 15, crossfadeFrames: XF });
    const encoder = streamingEncoder((f, l, r) => {
      if (Math.abs(l - f) > 1e-6 || Math.abs(r + f) > 1e-6) assert.fail(`frame ${f} got ${l}/${r}`);
    });
    const progress = [];
    let pauses = 0;
    const parts = await runWindowedMixdown({
      windows,
      renderWindow: fakeRender((_, f) => f),
      encoder,
      chunkFrames: 1152 * 48,
      onProgress: (p) => progress.push(p),
      pause: async () => { pauses += 1; },
    });
    assert.equal(encoder.frames, totalFrames);
    assert.equal(encoder.finalized, 1);
    assert.equal(parts.at(-1)[0], 7);
    assert.equal(progress.at(-1), 1);
    assert.ok(progress.every((p, i) => p >= 0 && p <= 1 && (i === 0 || p >= progress[i - 1])), 'progress is monotonic');
    if (totalFrames > 6 * 1152 * 48) assert.ok(pauses > 0, 'yields to the UI');
  }
});

test('window boundaries crossfade instead of clicking when renders differ slightly', async () => {
  const totalFrames = 4 * W + 1234;
  const windows = planMixWindows({ totalFrames, sampleRate: SR, barSeconds: 2.5, prerollSeconds: 15, crossfadeFrames: XF });
  const tone = (f) => Math.sin(f * 0.01) * 0.5;
  let prev = null;
  let maxStep = 0;
  const encoder = streamingEncoder((f, l) => {
    if (prev !== null) maxStep = Math.max(maxStep, Math.abs(l - prev));
    prev = l;
    // Far from any boundary the samples are untouched.
    if (f % W > XF && Math.abs(l - (tone(f) + 0.01 * Math.floor(f / W))) > 1e-9) assert.fail(`frame ${f}`);
  });
  // Each window carries its own DC offset: a hard cut would jump by 0.01 at every boundary.
  await runWindowedMixdown({
    windows,
    renderWindow: fakeRender((win, f) => tone(f) + 0.01 * win.index),
    encoder,
    chunkFrames: 4096,
    pause: async () => {},
  });
  assert.equal(encoder.frames, totalFrames);
  assert.ok(maxStep < 0.0051 + 0.01 / XF * 2, `no click at window boundaries (max step ${maxStep})`);
});

test('the encode loop stops at the next window when aborted', async () => {
  const windows = planMixWindows({ totalFrames: 5 * W, sampleRate: SR, barSeconds: 2.5, prerollSeconds: 15, crossfadeFrames: XF });
  const controller = new AbortController();
  let rendered = 0;
  const encoder = streamingEncoder(() => {});
  await assert.rejects(
    runWindowedMixdown({
      windows,
      renderWindow: async (win) => {
        rendered += 1;
        if (win.index === 1) controller.abort();
        return fakeRender(() => 0)(win);
      },
      encoder,
      chunkFrames: 1152 * 48,
      signal: controller.signal,
      pause: async () => {},
    }),
    (err) => err.name === 'AbortError',
  );
  assert.equal(rendered, 2);
  assert.equal(encoder.finalized, 0);
});

// ---- end-to-end wiring with a fake OfflineAudioContext -------------------------------------

class FakeParam {
  constructor(ctx, value = 0) {
    this.ctx = ctx;
    this.value = value;
    this.events = [];
  }
  record(kind, v, t) {
    if (!(t >= 0)) throw new RangeError(`negative automation time ${t}`);
    this.events.push([kind, v, t]);
  }
  setValueAtTime(v, t) { this.record('set', v, t); }
  linearRampToValueAtTime(v, t) { this.record('ramp', v, t); }
  exponentialRampToValueAtTime(v, t) { this.record('exp', v, t); }
  setTargetAtTime(v, t) { this.record('target', v, t); }
}

class FakeNode {
  constructor(ctx, params = []) {
    this.ctx = ctx;
    params.forEach((k) => { this[k] = new FakeParam(ctx, 1); });
  }
  connect(node) { return node; }
  disconnect() {}
}

class FakeScheduled extends FakeNode {
  constructor(ctx, params) {
    super(ctx, params);
    ctx.scheduled.push(this);
  }
  start(when = 0, offset = 0) {
    if (!(when >= 0) || !(offset >= 0)) throw new RangeError('negative start');
    this.when = when;
    this.offset = offset;
  }
  stop() {}
}

function makeFakeOffline(log) {
  return class FakeOffline {
    constructor(channels, length, sampleRate) {
      this.channels = channels;
      this.length = length;
      this.sampleRate = sampleRate;
      this.currentTime = 0;
      this.scheduled = [];
      this.suspends = [];
      this.destination = new FakeNode(this);
      if (length > 1) log.contexts.push(this);
    }
    decodeAudioData(data, ok) {
      const [chapter, frames] = new Int32Array(data);
      log.decodes += 1;
      const channel = new Float32Array(frames);
      for (let j = 0; j < frames; j += 1) channel[j] = voiceSample(chapter, j);
      const buf = { voice: true, chapter, length: frames, duration: frames / this.sampleRate, sampleRate: this.sampleRate, numberOfChannels: 1, getChannelData: () => channel };
      ok(buf);
    }
    createGain() { return new FakeNode(this, ['gain']); }
    createDynamicsCompressor() { return new FakeNode(this, ['threshold', 'knee', 'ratio', 'attack', 'release']); }
    createBiquadFilter() { return new FakeNode(this, ['frequency', 'Q', 'gain']); }
    createStereoPanner() { return new FakeNode(this, ['pan']); }
    createConvolver() { return new FakeNode(this); }
    createOscillator() { return new FakeScheduled(this, ['frequency', 'detune']); }
    createBufferSource() { return new FakeScheduled(this, ['playbackRate']); }
    createBuffer(channels, length) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { getChannelData: (ch) => data[ch] };
    }
    suspend(t) {
      if (!(t < this.length / this.sampleRate)) return Promise.reject(new Error('suspend past end'));
      return new Promise((resolve) => this.suspends.push({ t, resolve }));
    }
    resume() { this.resumed = (this.resumed || 0) + 1; }
    async startRendering() {
      for (const s of this.suspends.sort((a, b) => a.t - b.t)) {
        s.resolve();
        await new Promise((r) => setImmediate(r));
      }
      const left = new Float32Array(this.length);
      for (const node of this.scheduled) {
        if (!node.buffer?.voice) continue;
        const at = node.when * this.sampleRate;
        const off = node.offset * this.sampleRate;
        assert.ok(Math.abs(at - Math.round(at)) < 1e-6 && Math.abs(off - Math.round(off)) < 1e-6, 'voice is sample aligned');
        const data = node.buffer.getChannelData(0);
        const startFrame = Math.round(at);
        const from = Math.round(off);
        for (let j = 0; from + j < data.length && startFrame + j < this.length; j += 1) left[startFrame + j] += data[from + j];
      }
      return { numberOfChannels: 2, length: this.length, getChannelData: () => left };
    }
  };
}

const voiceSample = (chapter, j) => (chapter + 1) * 0.1 + (j % 997) / 1e4;

test('end-to-end windowed mixdown keeps chapters aligned and buffers bounded', async () => {
  const chapterSeconds = [45, 90, 30, 120, 75];
  const chapterFrames = chapterSeconds.map((s, i) => s * SR + i * 37);
  const { startFrames, totalFrames } = frameLayout(chapterFrames, SR);
  const expectedAt = (f) => {
    for (let i = 0; i < startFrames.length; i += 1) {
      if (f >= startFrames[i] && f < startFrames[i] + chapterFrames[i]) return voiceSample(i, f - startFrames[i]);
    }
    return 0;
  };
  const log = { decodes: 0, contexts: [] };
  const Offline = makeFakeOffline(log);
  let checked = 0;
  const encoder = streamingEncoder((f, l, r) => {
    checked += 1;
    if (Math.abs(l - expectedAt(f)) > 1e-6 || l !== r) assert.fail(`frame ${f}: ${l} vs ${expectedAt(f)}`);
  });
  const progress = [];
  const mood = 'cello_elegy';
  const { blob, stats } = await mixdownWithDeps({
    Offline,
    createEncoder: async (sampleRate) => { assert.equal(sampleRate, SR); return encoder; },
    chapterCount: chapterFrames.length,
    loadClip: async (i) => new Int32Array([i, chapterFrames[i]]).buffer,
    mood,
    seed: 'ep-1',
    musicVolume: 0.5,
    title: 'T',
    onProgress: (p) => progress.push(p),
  });

  assert.equal(blob.type, 'audio/mpeg');
  assert.equal(checked, totalFrames, 'every frame encoded exactly once');
  assert.equal(stats.totalFrames, totalFrames);
  assert.equal(log.contexts.length, stats.windows);
  assert.equal(log.decodes, 2 * chapterFrames.length, 'measured once, decoded once more lazily');
  assert.ok(stats.peakLiveChapters <= 3, `peak live chapters ${stats.peakLiveChapters}`);
  assert.equal(progress.at(-1), 1);
  assert.ok(progress.every((p, i) => i === 0 || p >= progress[i - 1]));

  // Every window is bounded in size and only schedules music inside itself.
  const preset = MUSIC_PRESETS[mood];
  const bar = barDuration(preset);
  for (const ctx of log.contexts) {
    assert.ok(ctx.length <= W + XF + (musicPrerollSeconds(preset) + bar) * SR + 1);
    const end = ctx.length / SR;
    const oscillators = ctx.scheduled.filter((n) => !n.buffer);
    assert.ok(oscillators.length > 0);
    for (const o of oscillators) assert.ok(o.when >= 0 && o.when < end + bar, 'music note inside window');
    assert.ok(ctx.suspends.length > 0 && ctx.suspends.every((s) => s.t < end));
  }
});

test('mixdown aborts while fetching chapters', async () => {
  const controller = new AbortController();
  const log = { decodes: 0, contexts: [] };
  await assert.rejects(
    mixdownWithDeps({
      Offline: makeFakeOffline(log),
      createEncoder: async () => streamingEncoder(() => {}),
      chapterCount: 6,
      loadClip: async (i) => {
        controller.abort();
        return new Int32Array([i, SR]).buffer;
      },
      mood: 'indie_groove',
      seed: 'x',
      signal: controller.signal,
    }),
    (err) => err.name === 'AbortError',
  );
  assert.equal(log.contexts.length, 0, 'no window was rendered');
});

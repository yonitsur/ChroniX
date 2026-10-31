import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_MUSIC_MOODS,
  LiveMusic,
  MUSIC_LEVELS,
  MUSIC_MOODS,
  MUSIC_PRESETS,
  buildId3Tag,
  buildMixLayout,
  chordForBar,
  createMusicBed,
  hashSeed,
  mixEnvelope,
  musicVolumeGain,
  normalizeMusicMood,
  planBar,
} from '../src/utils/podcastMusic.js';

// ---- Minimal Web Audio fake -------------------------------------------------------------------
class FakeParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }
  setValueAtTime(v, t) { this.events.push(['set', v, t]); this.value = v; }
  linearRampToValueAtTime(v, t) { this.events.push(['ramp', v, t]); this.value = v; }
  exponentialRampToValueAtTime(v, t) { this.events.push(['exp', v, t]); }
  setTargetAtTime(v, t, c) { this.events.push(['target', v, t, c]); }
  cancelScheduledValues(t) { this.events.push(['cancel', t]); }
}

class FakeNode {
  constructor(ctx, params = {}) {
    this.ctx = ctx;
    this.outputs = new Set();
    Object.entries(params).forEach(([k, v]) => { this[k] = new FakeParam(v); });
  }
  connect(node) { this.outputs.add(node); return node; }
  disconnect() { this.outputs.clear(); }
}

class FakeSource extends FakeNode {
  constructor(ctx) {
    super(ctx, { frequency: 440, detune: 0 });
    this.type = 'sine';
    ctx.sources.push(this);
  }
  start(t) { this.startAt = t; }
  stop(t) { this.stopAt = t ?? this.ctx.currentTime; }
}

class FakeBufferSource extends FakeNode {
  constructor(ctx) {
    super(ctx, { playbackRate: 1 });
    this.buffer = null;
    ctx.sources.push(this);
  }
  start(t) { this.startAt = t; }
  stop(t) { this.stopAt = t ?? this.ctx.currentTime; }
}

class FakeContext {
  constructor(sampleRate = 8000) {
    this.sampleRate = sampleRate;
    this.currentTime = 0;
    this.sources = [];
    this.destination = new FakeNode(this);
  }
  createGain() { return new FakeNode(this, { gain: 1 }); }
  createOscillator() { return new FakeSource(this); }
  createBufferSource() { return new FakeBufferSource(this); }
  createBiquadFilter() { return new FakeNode(this, { frequency: 350, Q: 1, gain: 0 }); }
  createStereoPanner() { return new FakeNode(this, { pan: 0 }); }
  createConvolver() { return new FakeNode(this); }
  createDynamicsCompressor() { return new FakeNode(this, { threshold: 0, knee: 0, ratio: 1, attack: 0, release: 0 }); }
  createBuffer(channels, length) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (ch) => data[ch] };
  }
}

const lastValue = (param) => param.events.filter((e) => e[0] === 'ramp' || e[0] === 'set').at(-1)?.[1];

// ---- Tests -----------------------------------------------------------------------------------
test('all 9 curated scores exist and legacy/unknown moods normalize safely', () => {
  assert.equal(MUSIC_MOODS.length, 9);
  assert.deepEqual(Object.keys(MUSIC_PRESETS).sort(), [...MUSIC_MOODS].sort());
  assert.equal(MUSIC_MOODS.includes('reflective'), false);

  assert.equal(normalizeMusicMood(' CINEMATIC_ORCHESTRA '), 'cinematic_orchestra');
  assert.equal(normalizeMusicMood('dubstep'), 'sunrise_piano');
  assert.equal(normalizeMusicMood(null, 'kids'), 'indie_groove');

  // Legacy stored episodes map deterministically into the approved scores for their category.
  for (const [legacy, pool] of Object.entries(LEGACY_MUSIC_MOODS)) {
    assert.ok(pool.every((id) => MUSIC_MOODS.includes(id)), `legacy ${legacy} maps to valid moods`);
    assert.equal(normalizeMusicMood(legacy), pool[0]);
    const seeded = normalizeMusicMood(legacy, 'classic', 'ep-42');
    assert.ok(pool.includes(seeded));
    assert.equal(seeded, normalizeMusicMood(legacy, 'classic', 'ep-42'));
  }

  assert.equal(musicVolumeGain(0.5), 1);
  assert.equal(musicVolumeGain(7), 2);
  assert.equal(musicVolumeGain(-1), 0);
});

test('bar plans are deterministic per seed and stay in key across all 9 scores', () => {
  for (const mood of MUSIC_MOODS) {
    const preset = MUSIC_PRESETS[mood];
    const seed = hashSeed('episode-1');
    for (let bar = 0; bar < 32; bar += 1) {
      const events = planBar(preset, seed, bar);
      assert.deepEqual(events, planBar(preset, seed, bar), `${mood} bar ${bar} is deterministic`);
      const chordPcs = new Set(chordForBar(preset, bar).pad.map((n) => (((preset.root + n) % 12) + 12) % 12));
      for (const ev of events) {
        assert.ok(ev.at >= 0 && ev.at < (preset.beatsPerBar * 60) / preset.bpm, `${mood} event inside its bar`);
        if (ev.kind === 'arp' || ev.kind === 'motif') {
          assert.ok(chordPcs.has(((ev.note % 12) + 12) % 12), `${mood} ${ev.kind} note is a chord tone`);
        }
        if (ev.kind === 'pad') assert.equal(bar % preset.barsPerChord, 0);
      }
    }
  }
  const a = JSON.stringify(Array.from({ length: 16 }, (_, b) => planBar(MUSIC_PRESETS.sunrise_piano, hashSeed('a'), b)));
  const b = JSON.stringify(Array.from({ length: 16 }, (_, b2) => planBar(MUSIC_PRESETS.sunrise_piano, hashSeed('b'), b2)));
  assert.notEqual(a, b, 'different episodes get different melodies');
});

test('percussion stays out of the opening chord so episodes start gently', () => {
  const preset = MUSIC_PRESETS.cinematic_orchestra;
  assert.equal(planBar(preset, 1, 0).some((e) => e.kind === 'pulse'), false);
  assert.equal(planBar(preset, 1, preset.barsPerChord).some((e) => e.kind === 'pulse'), true);
});

test('mixdown layout and envelope duck the music under every chapter', () => {
  const layout = buildMixLayout([10, 5, 8], { leadIn: 2.5, gap: 1.5, tail: 6 });
  assert.deepEqual(layout.starts, [2.5, 14, 20.5]);
  assert.equal(layout.speechEnd, 28.5);
  assert.equal(layout.total, 34.5);

  const points = mixEnvelope(layout);
  for (let i = 1; i < points.length; i += 1) assert.ok(points[i].t >= points[i - 1].t, 'times never go backwards');
  const valueAt = (t) => {
    let v = 0;
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      if (p.t > t) {
        if (!p.ramp) return v;
        const prev = points[i - 1];
        return prev.v + ((p.v - prev.v) * (t - prev.t)) / Math.max(1e-9, p.t - prev.t);
      }
      v = p.v;
    }
    return v;
  };
  for (const r of layout.regions) {
    assert.equal(valueAt(r.start + 0.1), MUSIC_LEVELS.duck);
    assert.equal(valueAt(r.end - 0.1), MUSIC_LEVELS.duck);
  }
  assert.equal(valueAt(1.5), MUSIC_LEVELS.bed, 'lead-in plays at full bed level');
  assert.equal(valueAt(13.5), MUSIC_LEVELS.bed, 'music swells between chapters');
  assert.equal(points.at(-1).v, 0);
  assert.equal(points.at(-1).t, layout.total);
});

test('ID3 tag matches the server format and keeps non-Latin titles', () => {
  const tag = buildId3Tag('מרוץ לחלל', 'Daniel');
  assert.equal(String.fromCharCode(...tag.slice(0, 3)), 'ID3');
  assert.equal(tag[3], 3);
  const size = (tag[6] << 21) | (tag[7] << 14) | (tag[8] << 7) | tag[9];
  assert.equal(size, tag.length - 10);
  assert.equal(String.fromCharCode(...tag.slice(10, 14)), 'TIT2');
  const frameSize = new DataView(tag.buffer, 14, 4).getUint32(0);
  const body = tag.slice(20, 20 + frameSize);
  assert.deepEqual([...body.slice(0, 3)], [1, 0xff, 0xfe]);
  assert.equal(new TextDecoder('utf-16le').decode(body.slice(3)), 'מרוץ לחלל');
});

test('music bed schedules bars ahead across all 9 scores and stops everything on dispose', () => {
  for (const mood of MUSIC_MOODS) {
    const ctx = new FakeContext();
    const bed = createMusicBed(ctx, { mood, seed: 'ep', startTime: 1 });
    bed.scheduleUntil(1 + bed.barDuration * 4 - 0.01);
    assert.equal(bed.scheduledBars, 4, `${mood} schedules 4 bars`);
    assert.ok(ctx.sources.length > 0, `${mood} schedules audio sources`);
    assert.ok(ctx.sources.every((s) => s.startAt >= 1 && s.stopAt > s.startAt), `${mood} source bounds`);
    bed.scheduleUntil(1 + bed.barDuration * 4 - 0.01);
    assert.equal(bed.scheduledBars, 4, 'already-scheduled bars are not duplicated');
    bed.dispose();
    assert.equal(bed.activeSources, 0);
  }
});

test('live music swells, ducks, resumes on the next chord and crossfades moods', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const ctx = new FakeContext();
  const music = new LiveMusic(() => ctx);
  music.configure({ mood: 'sunrise_piano', seed: 'ep-1', gain: 1 });

  music.start('bed');
  assert.ok(music.isRunning);
  assert.equal(lastValue(music.bed.output.gain), MUSIC_LEVELS.bed);
  music.setLevel('duck');
  assert.equal(lastValue(music.bed.output.gain), MUSIC_LEVELS.duck);

  ctx.currentTime = music.bed.barDuration * 3.5;
  music.pause();
  assert.equal(music.isRunning, false);
  assert.equal(music.nextBar % MUSIC_PRESETS.sunrise_piano.barsPerChord, 0, 'resumes on a chord boundary');
  assert.ok(music.nextBar >= 4);

  music.start('duck');
  const first = music.bed;
  music.configure({ mood: 'cinematic_orchestra' });
  assert.notEqual(music.bed, first, 'mood change spawns a new bed');
  assert.equal(music.bed.mood, 'cinematic_orchestra');
  assert.equal(lastValue(first.output.gain), 0, 'old bed fades out');

  music.outro();
  assert.equal(music.isRunning, false);
  t.mock.timers.tick(20000);
  assert.equal(music.retiring.size, 0, 'faded beds are disposed');
  music.dispose();
});

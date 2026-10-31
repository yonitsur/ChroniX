// Procedural background music for podcast episodes, synthesized with Web Audio.
//
// Every bar is planned deterministically from (mood, seed, bar index), so the live player and the
// offline download mix (OfflineAudioContext) produce the same score with no audio files, no
// licensing and no bandwidth. Planning is pure (unit-testable); rendering only touches Web Audio.

export const MUSIC_MOODS = [
  'sunrise_piano',
  'acoustic_horizon',
  'breezy_jazz',
  'indie_groove',
  'ancient_sands',
  'cinematic_orchestra',
  'modern_tension',
  'cello_elegy',
  'solemn_chorale',
];

export const LEGACY_MUSIC_MOODS = {
  hopeful: ['sunrise_piano', 'acoustic_horizon'],
  epic: ['cinematic_orchestra', 'modern_tension'],
  mysterious: ['ancient_sands', 'modern_tension'],
  playful: ['breezy_jazz', 'indie_groove'],
  somber: ['cello_elegy', 'solemn_chorale'],
  reflective: ['sunrise_piano', 'breezy_jazz'],
};

export const DEFAULT_MUSIC_VOLUME = 0.5;
// Bed gain relative to the score's calibrated level: full between chapters, ducked under speech.
export const MUSIC_LEVELS = { off: 0, bed: 1, duck: 0.2 };
export const MUSIC_LEAD_IN_MS = 2200;
export const MUSIC_CHAPTER_GAP_MS = 1500;

export function hashSeed(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value >>> 0;
  const str = String(value ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function defaultMusicMood(contentMode) {
  return contentMode === 'kids' ? 'indie_groove' : 'sunrise_piano';
}

export function normalizeMusicMood(mood, contentMode, seed) {
  const value = String(mood || '').trim().toLowerCase();
  if (MUSIC_MOODS.includes(value)) return value;
  const legacy = LEGACY_MUSIC_MOODS[value];
  if (legacy) {
    const hasSeed = seed !== undefined && seed !== null && seed !== '';
    const idx = hasSeed ? hashSeed(seed) % legacy.length : 0;
    return legacy[idx];
  }
  return defaultMusicMood(contentMode);
}

// Slider 0..1 -> gain 0..2 (0.5 = the calibrated level).
export function musicVolumeGain(volume) {
  const v = Number(volume);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) * 2 : DEFAULT_MUSIC_VOLUME * 2;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const midiToHz = (note) => 440 * 2 ** ((note - 69) / 12);

// Chords are voiced as semitone offsets from `root` (MIDI); `bass` is the bass note offset.
// `level` is a loudness trim calibrated so every score sits around -25 dBFS RMS at default volume
// (voices average about -20 dBFS; ducked music lands ~19 dB under speech).
export const MUSIC_PRESETS = {
  // ---- Hopeful / Uplifting ----
  sunrise_piano: {
    bpm: 76,
    beatsPerBar: 4,
    barsPerChord: 2,
    root: 44, // Ab major
    chords: [
      { pad: [12, 16, 19, 26], bass: 0 }, // Abadd9
      { pad: [14, 19, 23, 26], bass: -1 }, // Eb/G
      { pad: [12, 16, 19, 26], bass: -3 }, // Fm11
      { pad: [16, 17, 21, 26], bass: -7 }, // Dbmaj13
      { pad: [16, 19, 24, 26], bass: 4 }, // Ab/C
      { pad: [14, 17, 21, 24], bass: 2 }, // Bbm7
      { pad: [16, 17, 21, 24], bass: -7 }, // Dbmaj7
      { pad: [14, 17, 19, 24], bass: -5 }, // Eb9sus4
    ],
    pad: { waves: ['sawtooth', 'triangle'], detune: 7, subGain: 0.14, cutoff: 1350, sweep: true, chorus: true, attack: 1.8, release: 2.6, gain: 0.125 },
    arp: { mode: 'updown', step: 0.5, density: 0.84, octave: 0, voice: 'feltPiano', decay: 1.5, gain: 0.075 },
    bass: { style: 'hold', gain: 0.105 },
    pulse: null,
    motif: { voice: 'cello', octave: 0, chance: 0.65, gain: 0.068 },
    reverb: { seconds: 3.6, wet: 0.5 },
    level: 0.336,
  },
  acoustic_horizon: {
    bpm: 94,
    beatsPerBar: 4,
    barsPerChord: 2,
    root: 43, // G major
    chords: [
      { pad: [12, 16, 19, 26], bass: 0 }, // Gadd9
      { pad: [14, 19, 23, 24], bass: -1 }, // Dadd4/F#
      { pad: [12, 16, 19, 24], bass: -3 }, // Em7
      { pad: [17, 19, 21, 24], bass: -7 }, // Cadd9
    ],
    pad: { waves: ['triangle', 'sine'], detune: 6, cutoff: 1600, attack: 1.3, release: 2.0, gain: 0.105 },
    arp: { mode: 'ostinato', pattern: [0, 2, 1, 3, 2, 0, 3, 1], step: 0.5, density: 0.92, octave: 0, voice: 'nylon', decay: 0.95, gain: 0.082 },
    bass: { style: 'bounce', beats: [0, 2], accents: [1, 0.72], gain: 0.12 },
    pulse: { kind: 'shaker', beats: [0.5, 1.5, 2.5, 3.5], accents: [0.45, 0.3, 0.45, 0.3], gain: 0.042 },
    motif: { voice: 'flute', octave: 12, chance: 0.55, gain: 0.055 },
    reverb: { seconds: 2.8, wet: 0.42 },
    level: 0.507,
  },

  // ---- Playful / Light ----
  breezy_jazz: {
    bpm: 98,
    beatsPerBar: 4,
    barsPerChord: 1,
    root: 46, // Bb major
    chords: [
      { pad: [16, 19, 23, 26], bass: 0 }, // Bbmaj9
      { pad: [13, 17, 19, 21], bass: -3 }, // G7b13
      { pad: [12, 16, 17, 21], bass: -10 }, // Cm9
      { pad: [11, 17, 21, 26], bass: -5 }, // F9
      { pad: [16, 19, 23, 26], bass: -8 }, // Dm7
      { pad: [13, 16, 19, 23], bass: -3 }, // G9
      { pad: [12, 16, 17, 21], bass: -10 }, // Cm9
      { pad: [12, 17, 19, 21], bass: -5 }, // F9sus4
    ],
    pad: { waves: ['sine', 'triangle'], detune: 5, cutoff: 1450, attack: 0.35, release: 0.9, gain: 0.085 },
    arp: { mode: 'broken', step: 0.5, density: 0.72, octave: 0, voice: 'vibraphone', decay: 0.95, gain: 0.085 },
    bass: { style: 'bounce', beats: [0, 1.5, 2, 3.5], accents: [1, 0.55, 0.85, 0.6], gain: 0.13 },
    pulse: { kind: 'shaker', beats: [1, 2.5, 3], accents: [0.55, 0.35, 0.55], gain: 0.048 },
    motif: null,
    reverb: { seconds: 2.2, wet: 0.35 },
    level: 0.607,
  },
  indie_groove: {
    bpm: 110,
    beatsPerBar: 4,
    barsPerChord: 1,
    root: 45, // A major
    chords: [
      { pad: [12, 16, 19, 26], bass: 0 }, // Aadd9
      { pad: [14, 16, 19, 23], bass: -8 }, // C#m7
      { pad: [12, 16, 19, 21], bass: -3 }, // F#m7
      { pad: [12, 16, 19, 21], bass: -7 }, // Dmaj9
      { pad: [12, 16, 19, 24], bass: -5 }, // A/E
      { pad: [12, 16, 19, 26], bass: -3 }, // F#m11
      { pad: [14, 17, 21, 24], bass: 2 }, // Bm9
      { pad: [14, 17, 21, 24], bass: -5 }, // E9sus4
    ],
    pad: { waves: ['triangle', 'sine'], detune: 6, cutoff: 1700, attack: 0.4, release: 0.9, gain: 0.085 },
    arp: { mode: 'ostinato', pattern: [0, 2, 3, 1, 2, 3, 1, 2], accents: [1, 0.6, 0.9, 0.55, 0.85, 0.6, 0.8, 0.55], step: 0.5, density: 0.92, octave: 0, voice: 'nylon', decay: 0.65, gain: 0.09 },
    bass: { style: 'bounce', beats: [0, 1.5, 2, 3], accents: [1, 0.65, 0.85, 0.7], gain: 0.125 },
    pulse: { kind: 'indie', beats: [0, 1, 2, 3], accents: [0.85, 0.45, 0.8, 0.45], freq: 62, gain: 0.16 },
    motif: null,
    reverb: { seconds: 2.1, wet: 0.34 },
    level: 0.585,
  },

  // ---- Mysterious ----
  ancient_sands: {
    bpm: 62,
    beatsPerBar: 4,
    barsPerChord: 2,
    root: 50, // D modal
    chords: [
      { pad: [7, 12, 15, 19], bass: -12 }, // Dm
      { pad: [8, 12, 13, 17], bass: -12 }, // Ebmaj7/D
      { pad: [5, 10, 13, 17], bass: -14 }, // Cm7
      { pad: [7, 12, 17, 19], bass: -12 }, // Dsus4
    ],
    pad: { waves: ['triangle', 'sine'], detune: 8, subGain: 0.16, cutoff: 980, sweep: true, attack: 2.4, release: 3.0, gain: 0.12 },
    arp: { mode: 'broken', step: 0.5, density: 0.55, octave: 0, voice: 'oud', decay: 1.4, gain: 0.075 },
    bass: { style: 'hold', gain: 0.11 },
    pulse: { kind: 'frameDrum', beats: [0, 3], accents: [0.75, 0.35], freq: 56, gain: 0.16 },
    motif: { voice: 'flute', octave: 12, chance: 0.65, gain: 0.062 },
    reverb: { seconds: 4.2, wet: 0.56 },
    level: 0.316,
  },

  // ---- Epic ----
  cinematic_orchestra: {
    bpm: 80,
    beatsPerBar: 4,
    barsPerChord: 2,
    root: 48, // C minor
    chords: [
      { pad: [12, 15, 19, 24], bass: -12 }, // Cm
      { pad: [8, 12, 15, 19], bass: -4 }, // Abmaj7
      { pad: [10, 15, 19, 22], bass: -5 }, // Eb/G
      { pad: [10, 14, 17, 22], bass: -2 }, // Bb
      { pad: [8, 12, 15, 19], bass: -7 }, // Fm9
      { pad: [8, 12, 17, 20], bass: -11 }, // Dbmaj7
      { pad: [7, 12, 14, 19], bass: -5 }, // Gsus4
      { pad: [7, 11, 14, 17], bass: -5 }, // G7
    ],
    pad: { waves: ['sawtooth', 'triangle'], detune: 8, subGain: 0.2, cutoff: 1100, sweep: true, chorus: true, attack: 1.5, release: 2.4, gain: 0.13 },
    arp: { mode: 'ostinato', pattern: [0, 1, 2, 1, 0, 2, 3, 2], accents: [1, 0.65, 0.8, 0.65, 0.9, 0.65, 0.85, 0.65], step: 0.5, density: 0.96, octave: 0, voice: 'spiccato', decay: 0.26, gain: 0.068 },
    bass: { style: 'bowed', gain: 0.12 },
    pulse: { kind: 'cinematic', beats: [0, 2.5, 3.5], accents: [1, 0.55, 0.4], freq: 50, gain: 0.26 },
    motif: { voice: 'horn', octave: 0, chance: 0.65, gain: 0.075 },
    reverb: { seconds: 3.9, wet: 0.52 },
    level: 0.29,
  },
  modern_tension: {
    bpm: 88,
    beatsPerBar: 4,
    barsPerChord: 2,
    root: 42, // F# minor
    chords: [
      { pad: [15, 19, 24, 26], bass: 0 }, // F#m(add9)
      { pad: [15, 19, 20, 27], bass: -4 }, // Dmaj7
      { pad: [17, 20, 24, 27], bass: -7 }, // Bm7
      { pad: [17, 19, 24, 26], bass: -5 }, // C#7sus4
    ],
    pad: { waves: ['sawtooth', 'sine'], detune: 8, cutoff: 920, sweep: true, attack: 1.4, release: 2.0, gain: 0.11 },
    arp: { mode: 'ostinato', pattern: [0, 3, 1, 2, 0, 3, 2, 1], accents: [1, 0.5, 0.85, 0.55, 0.9, 0.5, 0.8, 0.5], step: 0.5, density: 0.85, octave: 0, voice: 'feltPiano', decay: 0.85, gain: 0.068 },
    bass: { style: 'pulse8', gain: 0.115 },
    pulse: { kind: 'heartbeat', beats: [0, 0.75, 2], accents: [0.95, 0.55, 0.65], freq: 52, gain: 0.24 },
    motif: null,
    reverb: { seconds: 3.3, wet: 0.45 },
    level: 0.439,
  },

  // ---- Somber ----
  cello_elegy: {
    bpm: 50,
    beatsPerBar: 4,
    barsPerChord: 2,
    root: 43, // G minor
    chords: [
      { pad: [12, 15, 19, 24], bass: 0 }, // Gm
      { pad: [12, 15, 19, 26], bass: -2 }, // Gm(add9)/F
      { pad: [15, 19, 20, 24], bass: -4 }, // Ebmaj7
      { pad: [15, 17, 20, 24], bass: -7 }, // Cm7
      { pad: [14, 17, 20, 24], bass: -5 }, // Am7b5/D
      { pad: [11, 17, 19, 26], bass: -5 }, // D7
      { pad: [15, 19, 22, 24], bass: -4 }, // Ebmaj9
      { pad: [14, 17, 19, 24], bass: -5 }, // D7sus4
    ],
    pad: { waves: ['sawtooth', 'triangle'], detune: 8, subGain: 0.18, cutoff: 880, sweep: true, chorus: true, attack: 2.6, release: 3.4, gain: 0.135 },
    arp: { mode: 'up', step: 2, density: 0.36, octave: 0, voice: 'harp', decay: 2.6, gain: 0.048 },
    bass: { style: 'bowed', gain: 0.11 },
    pulse: null,
    motif: { voice: 'cello', octave: 0, chance: 0.8, gain: 0.085 },
    reverb: { seconds: 4.5, wet: 0.58 },
    level: 0.319,
  },
  solemn_chorale: {
    bpm: 52,
    beatsPerBar: 4,
    barsPerChord: 2,
    root: 41, // F minor
    chords: [
      { pad: [12, 15, 19, 24], bass: 0 }, // Fm
      { pad: [12, 15, 20, 24], bass: 0 }, // Db/F
      { pad: [15, 17, 20, 24], bass: 5 }, // Bbm7
      { pad: [14, 19, 24, 26], bass: -5 }, // Csus4
      { pad: [12, 15, 19, 24], bass: -2 }, // Fm/Eb
      { pad: [15, 19, 20, 24], bass: -4 }, // Dbmaj7
      { pad: [13, 17, 20, 24], bass: 1 }, // Gbmaj7
      { pad: [11, 14, 19, 23], bass: -5 }, // C
    ],
    pad: { waves: ['sawtooth', 'triangle'], detune: 7, subGain: 0.22, cutoff: 820, sweep: true, chorus: true, attack: 2.5, release: 3.2, gain: 0.145 },
    arp: { mode: 'ostinato', pattern: [0, 2], step: 2, density: 0.55, octave: 0, voice: 'feltPiano', decay: 2.5, gain: 0.058 },
    bass: { style: 'bowed', gain: 0.115 },
    pulse: null,
    motif: { voice: 'horn', octave: 0, chance: 0.55, gain: 0.068 },
    reverb: { seconds: 4.6, wet: 0.6 },
    level: 0.304,
  },
};

// Arpeggio intensity over each pass through the progression: gentler start, fuller later.
const SECTION_SHAPE = [0.65, 1, 0.85, 1.1];
const BROKEN_PATTERN = [0, 2, 1, 3, 2, 3, 1, 2];
const UPDOWN_PATTERN = [0, 1, 2, 3, 2, 1];

export function barDuration(preset) {
  return (preset.beatsPerBar * 60) / preset.bpm;
}

export function chordForBar(preset, bar) {
  const idx = Math.floor(Math.max(0, bar) / preset.barsPerChord) % preset.chords.length;
  return preset.chords[idx];
}

function barRandom(seed, bar) {
  return mulberry32((seed ^ Math.imul(bar + 1, 0x9e3779b1)) >>> 0);
}

/**
 * Pure note plan for one bar: [{kind, at, dur, note|notes, vel, pan}] with `at` relative to the
 * bar start (seconds) and MIDI note numbers.
 */
export function planBar(preset, seed, bar) {
  const rng = barRandom(seed, bar);
  const beat = 60 / preset.bpm;
  const barDur = barDuration(preset);
  const chord = chordForBar(preset, bar);
  const section = Math.floor(bar / (preset.barsPerChord * preset.chords.length));
  const shape = SECTION_SHAPE[section % SECTION_SHAPE.length];
  const events = [];

  if (bar % preset.barsPerChord === 0) {
    const dur = barDur * preset.barsPerChord;
    events.push({ kind: 'pad', at: 0, dur, notes: chord.pad.map((n) => preset.root + n), vel: 0.88 + rng() * 0.12 });
    if (preset.bass?.style === 'hold' || preset.bass?.style === 'bowed') {
      events.push({ kind: 'bass', at: 0, dur, note: preset.root + chord.bass, vel: 1 });
    }
  }

  if (preset.bass?.style === 'bounce') {
    preset.bass.beats.forEach((b, i) => {
      const vel = preset.bass.accents ? (preset.bass.accents[i] ?? 0.75) : (b === 0 ? 1 : 0.75);
      events.push({ kind: 'bass', at: b * beat, dur: beat * 0.68, note: preset.root + chord.bass, vel });
    });
  } else if (preset.bass?.style === 'pulse8') {
    for (let s = 0; s < preset.beatsPerBar * 2; s += 1) {
      const accent = s % 4 === 0 ? 1 : s % 2 === 0 ? 0.78 : 0.58;
      events.push({ kind: 'bass', at: s * 0.5 * beat, dur: beat * 0.42, note: preset.root + chord.bass, vel: accent });
    }
  }

  const arp = preset.arp;
  if (arp) {
    const tones = [...chord.pad].sort((a, b) => a - b).map((n) => preset.root + n + (arp.octave || 0));
    const steps = Math.max(1, Math.round(preset.beatsPerBar / arp.step));
    let last = null;
    for (let s = 0; s < steps; s += 1) {
      const roll = rng();
      const pick = rng();
      const velRoll = rng();
      const panRoll = rng();
      if (roll >= Math.min(0.98, arp.density * shape)) continue;
      let note;
      if (arp.mode === 'up') {
        note = tones[s % tones.length] + (Math.floor(s / tones.length) % 2) * 12;
      } else if (arp.mode === 'updown') {
        note = tones[UPDOWN_PATTERN[s % UPDOWN_PATTERN.length] % tones.length];
      } else if (arp.mode === 'broken') {
        note = tones[BROKEN_PATTERN[s % BROKEN_PATTERN.length] % tones.length];
      } else if (arp.mode === 'ostinato') {
        note = tones[arp.pattern[s % arp.pattern.length] % tones.length];
      } else {
        note = tones[Math.floor(pick * tones.length)];
        if (note === last) note = tones[(tones.indexOf(note) + 1) % tones.length];
      }
      last = note;
      const baseVel = arp.accents ? (arp.accents[s % arp.accents.length] ?? 0.75) : (0.58 + velRoll * 0.42);
      events.push({
        kind: 'arp',
        at: s * arp.step * beat,
        dur: arp.decay,
        note,
        vel: baseVel,
        pan: (panRoll - 0.5) * 0.75,
      });
    }
  }

  // Sparse lyrical solo motif on selected chord pairs.
  if (preset.motif && bar % preset.barsPerChord === 0) {
    const mRng = barRandom(seed ^ 0x27d4eb2f, bar);
    if (mRng() < (preset.motif.chance ?? 0.65)) {
      const tones = [...chord.pad].sort((a, b) => a - b).map((n) => preset.root + n + (preset.motif.octave || 0));
      const idx1 = Math.min(tones.length - 1, 1 + Math.floor(mRng() * (tones.length - 1)));
      const idx2 = Math.max(0, Math.min(tones.length - 1, idx1 + (mRng() < 0.55 ? -1 : 1)));
      const startBeat = 1.5 + Math.floor(mRng() * 2) * 0.5;
      events.push({ kind: 'motif', at: startBeat * beat, dur: beat * 2.2, note: tones[idx1], vel: 0.85, pan: -0.12 });
      if (preset.barsPerChord > 1 && mRng() < 0.75) {
        const totalBeats = startBeat + 2.5;
        const targetBarOffset = Math.floor(totalBeats / preset.beatsPerBar);
        if (targetBarOffset === 0) {
          events.push({
            kind: 'motif',
            at: totalBeats * beat,
            dur: beat * 2.8,
            note: tones[idx2],
            vel: 0.72,
            pan: 0.12,
          });
        }
      }
    }
  } else if (preset.motif && preset.barsPerChord > 1 && bar % preset.barsPerChord === 1) {
    const prevBar = bar - 1;
    const mRng = barRandom(seed ^ 0x27d4eb2f, prevBar);
    if (mRng() < (preset.motif.chance ?? 0.65)) {
      const tones = [...chord.pad].sort((a, b) => a - b).map((n) => preset.root + n + (preset.motif.octave || 0));
      const idx1 = Math.min(tones.length - 1, 1 + Math.floor(mRng() * (tones.length - 1)));
      const idx2 = Math.max(0, Math.min(tones.length - 1, idx1 + (mRng() < 0.55 ? -1 : 1)));
      const startBeat = 1.5 + Math.floor(mRng() * 2) * 0.5;
      if (mRng() < 0.75) {
        const totalBeats = startBeat + 2.5;
        if (Math.floor(totalBeats / preset.beatsPerBar) === 1) {
          events.push({
            kind: 'motif',
            at: (totalBeats - preset.beatsPerBar) * beat,
            dur: beat * 2.8,
            note: tones[idx2],
            vel: 0.72,
            pan: 0.12,
          });
        }
      }
    }
  }

  // Percussion stays out of the opening chord so episodes start gently during the lead-in.
  if (preset.pulse && bar >= preset.barsPerChord) {
    preset.pulse.beats.forEach((b, i) => {
      events.push({ kind: 'pulse', at: b * beat, dur: 0.9, vel: preset.pulse.accents?.[i] ?? 1 });
    });
  }
  return events;
}

// ---- Download mix layout ----------------------------------------------------------------------

/** Where each chapter sits in a mixed-down episode: music lead-in, gaps between chapters, tail. */
export function buildMixLayout(durations, { leadIn = 2.5, gap = MUSIC_CHAPTER_GAP_MS / 1000, tail = 6 } = {}) {
  const starts = [];
  let t = leadIn;
  durations.forEach((d, i) => {
    starts.push(t);
    t += Math.max(0, Number(d) || 0) + (i < durations.length - 1 ? gap : 0);
  });
  const regions = starts.map((start, i) => ({ start, end: start + Math.max(0, Number(durations[i]) || 0) }));
  return { starts, regions, speechEnd: t, total: t + tail };
}

/** Gain automation points for the music bed in a mixdown: fade in, duck under every chapter, fade out. */
export function mixEnvelope(layout, { bed = MUSIC_LEVELS.bed, duck = MUSIC_LEVELS.duck, fadeIn = 1.2, duckLead = 0.45, release = 0.7, fadeOut = 4.5 } = {}) {
  const points = [{ t: 0, v: 0 }];
  const first = layout.regions[0]?.start ?? fadeIn;
  points.push({ t: Math.min(fadeIn, Math.max(0.05, first - duckLead)), v: bed, ramp: true });
  for (const r of layout.regions) {
    const prevT = points[points.length - 1].t;
    points.push({ t: Math.max(prevT, r.start - duckLead), v: bed });
    points.push({ t: Math.max(prevT, r.start), v: duck, ramp: true });
    points.push({ t: r.end, v: duck });
    points.push({ t: r.end + release, v: bed, ramp: true });
  }
  const prevT = points[points.length - 1].t;
  points.push({ t: Math.max(prevT, layout.total - fadeOut), v: bed });
  points.push({ t: Math.max(prevT, layout.total), v: 0, ramp: true });
  return points;
}

export function applyEnvelope(param, points) {
  for (const p of points) {
    if (p.ramp) param.linearRampToValueAtTime(p.v, p.t);
    else param.setValueAtTime(p.v, p.t);
  }
}

// ---- ID3 tag for downloads --------------------------------------------------------------------

/** Minimal ID3v2.3 tag (UTF-16 text frames), matching the server's download tag. */
export function buildId3Tag(title, artist = 'ChroniX', album = 'ChroniX Podcasts') {
  const frames = [['TIT2', title], ['TPE1', artist], ['TALB', album]]
    .filter(([, text]) => text)
    .map(([id, text]) => {
      const str = String(text);
      const body = new Uint8Array(3 + str.length * 2);
      body[0] = 1;
      body[1] = 0xff;
      body[2] = 0xfe;
      for (let i = 0; i < str.length; i += 1) {
        const c = str.charCodeAt(i);
        body[3 + i * 2] = c & 0xff;
        body[4 + i * 2] = c >> 8;
      }
      const frame = new Uint8Array(10 + body.length);
      for (let i = 0; i < 4; i += 1) frame[i] = id.charCodeAt(i);
      new DataView(frame.buffer).setUint32(4, body.length);
      frame.set(body, 10);
      return frame;
    });
  const size = frames.reduce((a, f) => a + f.length, 0);
  const tag = new Uint8Array(10 + size);
  tag.set([0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
  let offset = 10;
  for (const f of frames) {
    tag.set(f, offset);
    offset += f.length;
  }
  return tag;
}

// ---- Web Audio rendering ----------------------------------------------------------------------

const PAD_PANS = [-0.38, 0.38, -0.18, 0.18, 0];

function makeNoiseBuffer(ctx, seconds = 0.25, seed = 1) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  const rng = mulberry32(seed ^ 0x1b873593);
  for (let i = 0; i < len; i += 1) data[i] = rng() * 2 - 1;
  return buf;
}

function makeImpulse(ctx, seconds, seed) {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(seconds * rate));
  const buffer = ctx.createBuffer(2, length, rate);
  const rng = mulberry32(seed ^ 0x5bd1e995);
  const fadeIn = Math.max(1, Math.floor(rate * 0.022));
  for (let ch = 0; ch < 2; ch += 1) {
    const data = buffer.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < length; i += 1) {
      const progress = i / length;
      const env = (1 - progress) ** 2.5 * (i < fadeIn ? i / fadeIn : 1);
      const white = rng() * 2 - 1;
      // Progressive high-frequency air absorption like a warm wooden hall.
      const alpha = 0.58 * (1 - progress * 0.78);
      lp += alpha * (white - lp);
      data[i] = lp * env * 1.65;
    }
    const taps = ch === 0 ? [0.019, 0.041, 0.067] : [0.023, 0.047, 0.073];
    taps.forEach((sec, idx) => {
      const pos = Math.floor(sec * rate);
      if (pos < length) data[pos] += (0.26 - idx * 0.06) * (idx % 2 === 0 ? 1 : -1);
    });
  }
  return buffer;
}

function panner(ctx, pan, dest) {
  if (typeof ctx.createStereoPanner !== 'function' || !pan) return dest;
  const node = ctx.createStereoPanner();
  node.pan.value = Math.max(-1, Math.min(1, pan));
  node.connect(dest);
  return node;
}

/**
 * A running music bed on `ctx`: call `scheduleUntil(time)` to keep notes queued ahead of time
 * (live: every few hundred ms; offline: once for the whole episode). Connect `output` (a gain
 * starting at 0) to wherever the music should go and automate it for fades and ducking.
 */
export function createMusicBed(ctx, { mood, seed = 0, startBar = 0, startTime } = {}) {
  const resolvedMood = normalizeMusicMood(mood, null, seed);
  const preset = MUSIC_PRESETS[resolvedMood];
  const seedNum = hashSeed(seed);
  const barDur = barDuration(preset);
  const t0 = startTime ?? ctx.currentTime + 0.06;
  const sources = new Set();
  const noiseBuf = typeof ctx.createBufferSource === 'function' ? makeNoiseBuffer(ctx, 0.3, seedNum) : null;

  const output = ctx.createGain();
  output.gain.value = 0;
  const trim = ctx.createGain();
  trim.gain.value = preset.level;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.05;
  comp.release.value = 0.4;

  // Gentle midrange pocket around 1.85 kHz leaves space for spoken narration.
  const midStage = ctx.createBiquadFilter();
  midStage.type = 'peaking';
  midStage.frequency.value = 1850;
  midStage.Q.value = 0.85;
  if (midStage.gain) midStage.gain.value = -2.4;

  const wetBus = ctx.createGain();
  const dryBus = ctx.createGain();
  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx, preset.reverb.seconds, seedNum);
  const wet = ctx.createGain();
  wet.gain.value = preset.reverb.wet;
  wetBus.connect(comp);
  wetBus.connect(reverb);
  reverb.connect(wet);
  wet.connect(comp);
  dryBus.connect(comp);
  comp.connect(midStage);
  midStage.connect(trim);
  trim.connect(output);

  const track = (node, stopAt) => {
    sources.add(node);
    node.onended = () => sources.delete(node);
    node.stop(stopAt);
  };

  const osc = (type, freq, detune = 0) => {
    const node = ctx.createOscillator();
    node.type = type;
    node.frequency.value = freq;
    if (detune) node.detune.value = detune;
    return node;
  };

  const playTransient = (t, dest, { dur = 0.025, freq = 950, q = 1.6, gain = 0.025 } = {}) => {
    if (!noiseBuf || typeof ctx.createBufferSource !== 'function') return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(dest);
    src.start(t);
    track(src, t + dur + 0.02);
  };

  function renderPad(ev, t) {
    const p = preset.pad;
    const end = t + ev.dur + p.release;
    const voices = ev.notes.length * p.waves.length;
    const peak = (p.gain * ev.vel) / Math.sqrt(voices);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + p.attack);
    env.gain.setValueAtTime(peak, t + ev.dur);
    env.gain.linearRampToValueAtTime(0, end);
    env.connect(wetBus);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = p.chorus ? 0.65 : 0.4;
    if (p.sweep) {
      filter.frequency.setValueAtTime(p.cutoff * 0.58, t);
      filter.frequency.linearRampToValueAtTime(p.cutoff, t + ev.dur * 0.52);
      filter.frequency.linearRampToValueAtTime(p.cutoff * 0.55, end);
    } else {
      filter.frequency.value = p.cutoff;
    }
    filter.connect(env);
    ev.notes.forEach((note, ni) => {
      const dest = panner(ctx, PAD_PANS[ni % PAD_PANS.length], filter);
      const hz = midiToHz(note);
      p.waves.forEach((type, wi) => {
        const det = (wi % 2 ? -1 : 1) * p.detune + (ni % 2 ? 1.5 : -1.5);
        const o = osc(type, hz, det);
        if (p.chorus) {
          const lfo = osc('sine', 0.22 + (ni % 3) * 0.07);
          const lfoGain = ctx.createGain();
          lfoGain.gain.value = 3.5;
          lfo.connect(lfoGain);
          lfoGain.connect(o.detune);
          lfo.start(t);
          track(lfo, end + 0.05);
        }
        o.connect(dest);
        o.start(t);
        track(o, end + 0.05);
      });
      if (p.subGain && ni === 0) {
        const sub = osc('sine', hz * 0.5);
        const sg = ctx.createGain();
        sg.gain.value = p.subGain;
        sub.connect(sg);
        sg.connect(filter);
        sub.start(t);
        track(sub, end + 0.05);
      }
    });
  }

  function renderArp(ev, t) {
    const a = preset.arp;
    const peak = a.gain * ev.vel;
    const dest = panner(ctx, ev.pan, wetBus);
    const hz = midiToHz(ev.note);
    const v = a.voice;

    if (v === 'feltPiano') {
      playTransient(t, dest, { dur: 0.022, freq: 850, q: 1.4, gain: peak * 0.22 });
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.setValueAtTime(Math.min(3400, hz * 5.2), t);
      flt.frequency.exponentialRampToValueAtTime(Math.max(480, hz * 1.6), t + Math.min(0.9, a.decay * 0.6));
      flt.connect(dest);
      const partials = [
        { type: 'triangle', ratio: 1, detune: -2.2, g: 0.72, d: 1 },
        { type: 'sine', ratio: 1, detune: 2.2, g: 0.55, d: 1 },
        { type: 'sine', ratio: 2, detune: 0, g: 0.2, d: 0.45 },
        { type: 'sine', ratio: 3, detune: 0, g: 0.05, d: 0.25 },
      ];
      partials.forEach((pt) => {
        const dur = a.decay * pt.d;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(peak * pt.g, t + 0.01);
        env.gain.setTargetAtTime(0, t + 0.01, dur / 4.5);
        env.connect(flt);
        const o = osc(pt.type, hz * pt.ratio, pt.detune);
        o.connect(env);
        o.start(t);
        track(o, t + dur + 0.15);
      });
      return;
    }

    if (v === 'harp' || v === 'nylon' || v === 'oud') {
      const isOud = v === 'oud';
      const isNylon = v === 'nylon';
      playTransient(t, dest, {
        dur: 0.016,
        freq: isOud ? 1450 : isNylon ? 1200 : 1650,
        q: 1.8,
        gain: peak * (isOud ? 0.3 : 0.22),
      });
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.Q.value = isOud ? 2.1 : 1.1;
      flt.frequency.setValueAtTime(Math.min(4800, hz * (isOud ? 6.5 : 5)), t);
      flt.frequency.exponentialRampToValueAtTime(Math.max(450, hz * (isNylon ? 1.8 : 2.1)), t + 0.16);
      flt.connect(dest);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak, t + 0.006);
      env.gain.setTargetAtTime(0, t + 0.008, a.decay / 4.4);
      env.connect(flt);
      const o1 = osc(isOud ? 'sawtooth' : 'triangle', hz, isOud ? -3.5 : -1.5);
      const o2 = osc(isNylon ? 'sawtooth' : 'sine', hz * (v === 'harp' ? 2 : 1), isOud ? 3.5 : 1.5);
      const g2 = ctx.createGain();
      g2.gain.value = isNylon ? 0.24 : isOud ? 0.55 : 0.22;
      o1.connect(env);
      o2.connect(g2);
      g2.connect(env);
      o1.start(t);
      o2.start(t);
      const stopAt = t + a.decay + 0.15;
      track(o1, stopAt);
      track(o2, stopAt);
      return;
    }

    if (v === 'spiccato') {
      playTransient(t, dest, { dur: 0.018, freq: 1100, q: 1.5, gain: peak * 0.25 });
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.Q.value = 1.2;
      flt.frequency.setValueAtTime(1900, t);
      flt.frequency.exponentialRampToValueAtTime(520, t + 0.18);
      flt.connect(dest);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak, t + 0.024);
      env.gain.setTargetAtTime(0, t + 0.03, a.decay / 3.8);
      env.connect(flt);
      [-5, 5].forEach((det) => {
        const o = osc('sawtooth', hz, det);
        o.connect(env);
        o.start(t);
        track(o, t + a.decay + 0.12);
      });
      return;
    }

    // vibraphone
    const partials = [{ r: 1, g: 1, d: 1 }, { r: 4, g: 0.24, d: 0.45 }];
    partials.forEach((pt) => {
      const dur = a.decay * pt.d;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak * pt.g, t + 0.006);
      env.gain.setTargetAtTime(0, t + 0.008, dur / 4.5);
      if (pt.r === 1) {
        const trem = osc('sine', 5.2);
        const tg = ctx.createGain();
        tg.gain.value = peak * 0.16;
        trem.connect(tg);
        tg.connect(env.gain);
        trem.start(t);
        track(trem, t + dur + 0.12);
      }
      env.connect(dest);
      const o = osc('sine', hz * pt.r);
      o.connect(env);
      o.start(t);
      track(o, t + dur + 0.12);
    });
  }

  function renderMotif(ev, t) {
    const m = preset.motif;
    const v = m.voice;
    const peak = m.gain * ev.vel;
    const hz = midiToHz(ev.note);
    const dest = panner(ctx, ev.pan || 0, wetBus);

    const isHorn = v === 'horn';
    const isFlute = v === 'flute';
    const attack = Math.min(0.45, ev.dur * 0.32);
    const release = 0.85;
    const end = t + ev.dur + release;

    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = isHorn ? 640 : isFlute ? 1600 : 880;
    flt.Q.value = isHorn ? 1.5 : 0.7;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + attack);
    env.gain.setValueAtTime(peak * 0.88, t + ev.dur);
    env.gain.linearRampToValueAtTime(0, end);
    flt.connect(env);
    env.connect(dest);

    const o1 = osc(isFlute ? 'sine' : 'sawtooth', hz, -2);
    const o2 = osc('triangle', hz * (isFlute ? 2 : 1), 2);
    const g2 = ctx.createGain();
    g2.gain.value = isFlute ? 0.18 : 0.55;

    const vib = osc('sine', 4.8);
    const vibGain = ctx.createGain();
    vibGain.gain.setValueAtTime(0, t);
    vibGain.gain.linearRampToValueAtTime(isFlute ? 6 : 4.5, t + attack + 0.25);
    vib.connect(vibGain);
    vibGain.connect(o1.detune);
    vibGain.connect(o2.detune);

    o1.connect(flt);
    o2.connect(g2);
    g2.connect(flt);
    if (isFlute) playTransient(t, flt, { dur: 0.08, freq: 1800, q: 1.0, gain: peak * 0.14 });

    o1.start(t);
    o2.start(t);
    vib.start(t);
    track(o1, end + 0.05);
    track(o2, end + 0.05);
    track(vib, end + 0.05);
  }

  function renderBass(ev, t) {
    const b = preset.bass;
    const peak = b.gain * ev.vel;
    const env = ctx.createGain();
    const isLong = b.style === 'hold' || b.style === 'bowed';
    const end = isLong ? t + ev.dur + 0.8 : t + ev.dur + 0.3;
    env.gain.setValueAtTime(0, t);
    if (isLong) {
      env.gain.linearRampToValueAtTime(peak, t + (b.style === 'bowed' ? 0.35 : 0.15));
      env.gain.setValueAtTime(peak, t + ev.dur);
      env.gain.linearRampToValueAtTime(0, end);
    } else {
      env.gain.linearRampToValueAtTime(peak, t + 0.012);
      env.gain.setTargetAtTime(0, t + 0.012, ev.dur / 3);
    }
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = b.style === 'bowed' ? 340 : 420;
    filter.connect(env);
    env.connect(dryBus);
    const freq = midiToHz(ev.note);
    const fundamental = osc('sine', freq);
    fundamental.connect(filter);
    // A quiet octave harmonic keeps the bass audible on phone and laptop speakers.
    const harmonic = osc(b.style === 'bowed' ? 'sawtooth' : 'triangle', freq * 2);
    const hGain = ctx.createGain();
    hGain.gain.value = b.style === 'bowed' ? 0.26 : 0.22;
    harmonic.connect(hGain);
    hGain.connect(filter);
    fundamental.start(t);
    harmonic.start(t);
    track(fundamental, end + 0.05);
    track(harmonic, end + 0.05);
  }

  function renderPulse(ev, t) {
    const p = preset.pulse;
    const kind = p.kind || 'sine';

    if (kind === 'shaker') {
      playTransient(t, wetBus, { dur: 0.055, freq: 5200, q: 1.8, gain: p.gain * ev.vel });
      return;
    }
    if (kind === 'indie') {
      if (ev.vel >= 0.7) {
        const o = osc('sine', 120);
        o.frequency.setValueAtTime(120, t);
        o.frequency.exponentialRampToValueAtTime(p.freq || 58, t + 0.09);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(p.gain * ev.vel, t + 0.005);
        g.gain.setTargetAtTime(0, t + 0.008, 0.09);
        o.connect(g);
        g.connect(dryBus);
        o.start(t);
        track(o, t + 0.5);
      } else {
        playTransient(t, wetBus, { dur: 0.045, freq: 4800, q: 1.5, gain: p.gain * ev.vel * 0.35 });
      }
      return;
    }

    const baseFreq = p.freq || 52;
    const startRatio = kind === 'cinematic' ? 2.6 : kind === 'frameDrum' ? 1.85 : 2.2;
    const o = osc('sine', baseFreq * startRatio);
    o.frequency.setValueAtTime(baseFreq * startRatio, t);
    o.frequency.exponentialRampToValueAtTime(baseFreq, t + 0.14);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(p.gain * ev.vel, t + 0.007);
    env.gain.setTargetAtTime(0, t + 0.008, kind === 'cinematic' ? 0.22 : 0.17);
    o.connect(env);
    env.connect(kind === 'cinematic' || kind === 'frameDrum' ? wetBus : dryBus);
    o.start(t);
    track(o, t + ev.dur);

    if (kind === 'cinematic' || kind === 'frameDrum') {
      playTransient(t, wetBus, {
        dur: 0.035,
        freq: kind === 'frameDrum' ? 320 : 190,
        q: 1.1,
        gain: p.gain * ev.vel * 0.28,
      });
    }
  }

  const renderers = { pad: renderPad, arp: renderArp, motif: renderMotif, bass: renderBass, pulse: renderPulse };
  let nextBar = startBar;
  const barStart = (bar) => t0 + (bar - startBar) * barDur;

  return {
    mood: resolvedMood,
    preset,
    output,
    barDuration: barDur,
    startTime: t0,
    scheduleUntil(time) {
      while (barStart(nextBar) < time) {
        const start = barStart(nextBar);
        for (const ev of planBar(preset, seedNum, nextBar)) renderers[ev.kind](ev, start + ev.at);
        nextBar += 1;
      }
    },
    barAt(time) {
      return startBar + Math.max(0, Math.floor((time - t0) / barDur));
    },
    get scheduledBars() {
      return nextBar - startBar;
    },
    get activeSources() {
      return sources.size;
    },
    dispose() {
      for (const node of sources) {
        try {
          node.stop();
        } catch {
          // already stopped
        }
      }
      sources.clear();
      try {
        output.disconnect();
      } catch {
        // already disconnected
      }
    },
  };
}

function rampParam(ctx, param, value, seconds) {
  const now = ctx.currentTime;
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(now);
  } else {
    const current = param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
  }
  param.linearRampToValueAtTime(value, now + Math.max(0.01, seconds));
}

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Live music bed driven by the podcast player: swells while a chapter loads or between chapters,
 * ducks under the voice, fades out on pause and continues the progression on resume.
 */
export class LiveMusic {
  constructor(getContext, { lookahead = 4, tickMs = 500 } = {}) {
    this.getContext = getContext;
    this.lookahead = lookahead;
    this.tickMs = tickMs;
    this.mood = 'sunrise_piano';
    this.seed = 0;
    this.gain = musicVolumeGain(DEFAULT_MUSIC_VOLUME);
    this.ctx = null;
    this.volumeNode = null;
    this.bed = null;
    this.level = 'off';
    this.nextBar = 0;
    this.startedAt = 0;
    this.timer = null;
    this.retiring = new Set();
  }

  get isRunning() {
    return Boolean(this.bed);
  }

  configure({ mood, seed, gain } = {}) {
    if (gain != null && gain !== this.gain) {
      this.gain = gain;
      if (this.volumeNode && this.ctx) rampParam(this.ctx, this.volumeNode.gain, gain, 0.08);
    }
    const nextSeed = seed === undefined ? this.seed : hashSeed(seed);
    const nextMood = mood === undefined ? this.mood : normalizeMusicMood(mood, null, seed ?? nextSeed);
    if (nextMood === this.mood && nextSeed === this.seed) return;
    this.mood = nextMood;
    this.seed = nextSeed;
    this.nextBar = 0;
    if (this.bed && this.ctx) {
      const level = this.level;
      this._retire(this.bed, 2);
      this.bed = null;
      this._spawn();
      rampParam(this.ctx, this.bed.output.gain, MUSIC_LEVELS[level] ?? 0, 2);
    }
  }

  _context() {
    const ctx = this.getContext?.();
    if (!ctx) return null;
    if (ctx !== this.ctx) {
      this.dispose();
      this.ctx = ctx;
      this.volumeNode = ctx.createGain();
      this.volumeNode.gain.value = this.gain;
      this.volumeNode.connect(ctx.destination);
    }
    return ctx;
  }

  _spawn() {
    this.bed = createMusicBed(this.ctx, {
      mood: this.mood,
      seed: this.seed,
      startBar: this.nextBar,
      startTime: this.ctx.currentTime + 0.06,
    });
    this.bed.output.connect(this.volumeNode);
    this.startedAt = nowMs();
    this._tick();
    if (!this.timer) this.timer = setInterval(() => this._tick(), this.tickMs);
  }

  _tick() {
    if (this.bed && this.ctx) this.bed.scheduleUntil(this.ctx.currentTime + this.lookahead);
  }

  _stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  _retire(bed, seconds, { hold = 0 } = {}) {
    const ctx = this.ctx;
    const total = hold + seconds;
    bed.scheduleUntil(ctx.currentTime + total + 0.5);
    if (hold > 0) {
      const g = bed.output.gain;
      rampParam(ctx, g, MUSIC_LEVELS.bed, Math.min(1, hold));
      g.setValueAtTime(MUSIC_LEVELS.bed, ctx.currentTime + hold);
      g.linearRampToValueAtTime(0, ctx.currentTime + total);
    } else {
      rampParam(ctx, bed.output.gain, 0, seconds);
    }
    this.retiring.add(bed);
    setTimeout(() => {
      bed.dispose();
      this.retiring.delete(bed);
    }, total * 1000 + 200);
  }

  /** Start (or keep) the bed at `level` ('bed' between chapters, 'duck' under the voice). */
  start(level = 'bed') {
    const ctx = this._context();
    if (!ctx) return;
    if (!this.bed) {
      this._spawn();
      rampParam(ctx, this.bed.output.gain, MUSIC_LEVELS[level] ?? 0, 1.4);
      this.level = level;
      return;
    }
    this.setLevel(level);
  }

  setLevel(level, seconds) {
    if (!this.bed || !this.ctx) return;
    if (level === this.level && seconds == null) return;
    rampParam(this.ctx, this.bed.output.gain, MUSIC_LEVELS[level] ?? 0, seconds ?? (level === 'duck' ? 0.45 : 0.9));
    this.level = level;
  }

  /** Resolves once the bed has played for `ms` (a short musical intro before the first chapter). */
  leadIn(ms = MUSIC_LEAD_IN_MS) {
    if (!this.bed) return Promise.resolve();
    const wait = this.startedAt + ms - nowMs();
    return wait > 0 ? new Promise((resolve) => setTimeout(resolve, wait)) : Promise.resolve();
  }

  /** Fade out; a later start() continues from the next chord. */
  pause(seconds = 0.6) {
    if (!this.bed) return;
    const bed = this.bed;
    this.bed = null;
    this.level = 'off';
    this._stopTimer();
    const bar = bed.barAt(this.ctx.currentTime) + 1;
    this.nextBar = Math.ceil(bar / bed.preset.barsPerChord) * bed.preset.barsPerChord;
    this._retire(bed, seconds);
  }

  stop(seconds = 0.8) {
    this.pause(seconds);
    this.nextBar = 0;
  }

  /** End of episode: swell, hold briefly, then fade out. */
  outro({ hold = 3, fade = 6 } = {}) {
    if (!this.bed) return;
    const bed = this.bed;
    this.bed = null;
    this.level = 'off';
    this.nextBar = 0;
    this._stopTimer();
    this._retire(bed, fade, { hold });
  }

  dispose() {
    this._stopTimer();
    this.bed?.dispose();
    this.bed = null;
    this.retiring.forEach((bed) => bed.dispose());
    this.retiring.clear();
    try {
      this.volumeNode?.disconnect();
    } catch {
      // already disconnected
    }
    this.volumeNode = null;
    this.ctx = null;
    this.level = 'off';
  }
}

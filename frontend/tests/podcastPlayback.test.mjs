import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEpisodeStream,
  buildListenLink,
  chapterAtTime,
  chapterElapsed,
  computeTimeMetrics,
  defaultPodcastEngineForLanguage,
  estimateActiveTurn,
  estimateSegmentDurationSec,
  findActiveCue,
  formatTimeSec,
  initialPlaybackState,
  isChapterClipRendered,
  isTypingTarget,
  nextSpeed,
  playbackReducer,
  resolveNextIndex,
  resolvePrevAction,
  segmentDurations,
  shouldSkipStreamLookup,
} from '../src/utils/podcastPlayback.js';

test('formatTimeSec formats minutes and hours', () => {
  assert.equal(formatTimeSec(0), '0:00');
  assert.equal(formatTimeSec(65.4), '1:05');
  assert.equal(formatTimeSec(3725), '1:02:05');
  assert.equal(formatTimeSec(NaN), '0:00');
});

test('segment durations prefer loaded clips, then server records, then estimates', () => {
  const episode = {
    segments: [
      { id: 'a', turns: [{ text: 'one two three four five six seven eight nine ten eleven twelve' }] },
      { id: 'b', turns: [{ text: 'hi' }] },
      { id: 'c', turns: [] },
    ],
    audio: { edge: { clips: { b: { duration: 12.5 } } } },
  };
  assert.deepEqual(segmentDurations(episode, 'edge', { a: 30 }), [30, 12.5, 8]);
  assert.equal(segmentDurations(episode, 'gemini', {})[1], estimateSegmentDurationSec(episode.segments[1]));
});

test('computeTimeMetrics sums prior chapters and clamps elapsed', () => {
  const m = computeTimeMetrics([10, 20, 30], 1, 25);
  assert.equal(m.chapterElapsed, 20);
  assert.equal(m.totalElapsed, 30);
  assert.equal(m.totalRemaining, 30);
  assert.equal(computeTimeMetrics([], 0, 0).totalDuration, 0);
});

test('findActiveCue uses sentence timings, then turn starts, then a proportional estimate', () => {
  const clip = {
    sentences: [
      { start: 0, end: 2, turn: 0, text: 'First.' },
      { start: 2.1, end: 4, turn: 0, text: 'Second.' },
      { start: 4.2, end: 6, turn: 1, text: 'Third.' },
    ],
  };
  assert.equal(findActiveCue(clip, 3).sentenceIndex, 1);
  assert.equal(findActiveCue(clip, 5).turnIndex, 1);
  assert.equal(findActiveCue({ turn_starts: [0, 5] }, 6).turnIndex, 1);
  assert.equal(findActiveCue(null, 9, [{ text: 'aaaa' }, { text: 'aaaa' }], 10).turnIndex, 1);
  assert.equal(estimateActiveTurn([{ text: 'aaaa' }, { text: 'aaaa' }], 0.25), 0);
});

test('playback reducer follows the load → play → pause → end lifecycle', () => {
  let s = playbackReducer(initialPlaybackState, { type: 'load', index: 2 });
  assert.equal(s.status, 'loading');
  assert.equal(s.index, 2);
  const loadId = s.requestId;
  s = playbackReducer(s, { type: 'paused' });
  assert.equal(s.status, 'loading', 'pause events during loading are ignored');
  s = playbackReducer(s, { type: 'playing', requestId: loadId - 1 });
  assert.equal(s.status, 'loading', 'stale requests cannot flip state');
  s = playbackReducer(s, { type: 'playing' });
  assert.equal(s.status, 'playing');
  s = playbackReducer(s, { type: 'time', elapsed: 4, duration: 10 });
  assert.equal(s.elapsed, 4);
  s = playbackReducer(s, { type: 'paused' });
  assert.equal(s.status, 'paused');
  s = playbackReducer(s, { type: 'ended' });
  assert.equal(s.status, 'ended');
  assert.equal(s.elapsed, 10);
});

test('blocked autoplay waits for a tap instead of erroring', () => {
  let s = playbackReducer(initialPlaybackState, { type: 'load', index: 0 });
  s = playbackReducer(s, { type: 'blocked' });
  assert.equal(s.status, 'paused');
  assert.equal(s.needsGesture, true);
  s = playbackReducer(s, { type: 'playing' });
  assert.equal(s.needsGesture, false);
});

test('misc helpers', () => {
  assert.equal(nextSpeed(1), 1.25);
  assert.equal(nextSpeed(2), 1);
  assert.equal(buildListenLink('https://chronix.app/t/abc'), 'https://chronix.app/t/abc?listen=1');
  assert.equal(buildListenLink('https://chronix.app/t/abc?x=1'), 'https://chronix.app/t/abc?x=1&listen=1');
  assert.equal(isTypingTarget({ tagName: 'INPUT' }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false);
});

const STREAM_SEGMENTS = [{ id: 'seg-1' }, { id: 'seg-2' }, { id: 'seg-3' }];
const STREAM_MANIFEST = {
  src: '/api/podcast-audio/abc.mp3',
  key: 'abc',
  duration: 31.2,
  chapters: [
    { id: 'seg-2', start: 10.6, duration: 12, turn_starts: [0], sentences: [{ start: 0, end: 12, turn: 0 }] },
    { id: 'seg-1', start: 0, duration: 10 },
    { id: 'seg-3', start: 23.2, duration: 8 },
  ],
};

test('buildEpisodeStream aligns chapters to the episode order with end offsets', () => {
  const stream = buildEpisodeStream(STREAM_MANIFEST, STREAM_SEGMENTS);
  assert.equal(stream.src, STREAM_MANIFEST.src);
  assert.deepEqual(stream.chapters.map((c) => [c.id, c.start, c.end]), [['seg-1', 0, 10], ['seg-2', 10.6, 22.6], ['seg-3', 23.2, 31.2]]);
  assert.deepEqual(stream.chapters[1].sentences, [{ start: 0, end: 12, turn: 0 }]);
  assert.deepEqual(stream.chapters[0].turn_starts, []);
  assert.equal(stream.duration, 31.2);
});

test('buildEpisodeStream rejects incomplete or inconsistent manifests', () => {
  assert.equal(buildEpisodeStream(null, STREAM_SEGMENTS), null);
  assert.equal(buildEpisodeStream({ ...STREAM_MANIFEST, src: '' }, STREAM_SEGMENTS), null);
  assert.equal(buildEpisodeStream(STREAM_MANIFEST, [...STREAM_SEGMENTS, { id: 'seg-4' }]), null);
  const overlapping = { ...STREAM_MANIFEST, chapters: STREAM_MANIFEST.chapters.map((c) => (c.id === 'seg-2' ? { ...c, start: 5 } : c)) };
  assert.equal(buildEpisodeStream(overlapping, STREAM_SEGMENTS), null);
  const zero = { ...STREAM_MANIFEST, chapters: STREAM_MANIFEST.chapters.map((c) => (c.id === 'seg-3' ? { ...c, duration: 0 } : c)) };
  assert.equal(buildEpisodeStream(zero, STREAM_SEGMENTS), null);
});

test('chapterAtTime gives the pause before a chapter to that chapter', () => {
  const { chapters } = buildEpisodeStream(STREAM_MANIFEST, STREAM_SEGMENTS);
  assert.equal(chapterAtTime(chapters, 0), 0);
  assert.equal(chapterAtTime(chapters, 9.99), 0);
  assert.equal(chapterAtTime(chapters, 10.2), 1); // inside the pause after chapter 1
  assert.equal(chapterAtTime(chapters, 10.6), 1);
  assert.equal(chapterAtTime(chapters, 23.2), 2);
  assert.equal(chapterAtTime(chapters, 999), 2);
  assert.equal(chapterAtTime(chapters, NaN), 0);
  assert.equal(chapterAtTime([], 5), 0);
});

test('chapterElapsed is chapter-relative and clamped', () => {
  const chapter = { start: 10.6, duration: 12 };
  assert.equal(chapterElapsed(chapter, 10.2), 0);
  assert.ok(Math.abs(chapterElapsed(chapter, 15.6) - 5) < 1e-9);
  assert.equal(chapterElapsed(chapter, 40), 12);
  assert.equal(chapterElapsed(null, 5), 0);
});

test('chapter action moves to the next chapter without changing playback status', () => {
  const playing = { ...initialPlaybackState, status: 'playing', index: 0, elapsed: 9.9, duration: 10 };
  const next = playbackReducer(playing, { type: 'chapter', index: 1, elapsed: 0, duration: 12 });
  assert.equal(next.status, 'playing');
  assert.equal(next.index, 1);
  assert.equal(next.elapsed, 0);
  assert.equal(next.duration, 12);
  assert.equal(next.requestId, playing.requestId);
});

test('defaultPodcastEngineForLanguage picks Google Cloud for Hebrew and Edge-TTS for English', () => {
  assert.equal(defaultPodcastEngineForLanguage('he'), 'gcloud');
  assert.equal(defaultPodcastEngineForLanguage('he-IL'), 'gcloud');
  assert.equal(defaultPodcastEngineForLanguage('en'), 'edge');
  assert.equal(defaultPodcastEngineForLanguage('fr'), 'edge');
  assert.equal(defaultPodcastEngineForLanguage(''), 'edge');
  assert.equal(
    defaultPodcastEngineForLanguage('he', [{ id: 'gcloud', available: true }, { id: 'edge', available: true }]),
    'gcloud',
  );
  assert.equal(
    defaultPodcastEngineForLanguage('he', [{ id: 'gcloud', available: false }, { id: 'edge', available: true }]),
    'edge',
  );
  assert.equal(
    defaultPodcastEngineForLanguage('en', [{ id: 'gcloud', available: true }, { id: 'edge', available: true }]),
    'edge',
  );
});

test('resolveNextIndex advances synchronously and stops at the last chapter', () => {
  assert.equal(resolveNextIndex(0, 5), 1);
  assert.equal(resolveNextIndex(3, 5), 4);
  assert.equal(resolveNextIndex(4, 5), null);
  assert.equal(resolveNextIndex(0, 0), null);
});

test('resolvePrevAction steps back a chapter while loading instead of rewinding stale audio', () => {
  // While loading (even if elapsed were non-zero), Prev always goes to the previous chapter
  assert.deepEqual(resolvePrevAction({ index: 4, status: 'loading', elapsed: 12 }), { action: 'chapter', index: 3 });
  assert.deepEqual(resolvePrevAction({ index: 0, status: 'loading', elapsed: 12 }), { action: 'none' });
  // While playing/paused past 3 s, Prev rewinds the current chapter
  assert.deepEqual(resolvePrevAction({ index: 2, status: 'playing', elapsed: 5.2 }), { action: 'seek', time: 0 });
  assert.deepEqual(resolvePrevAction({ index: 2, status: 'paused', elapsed: 4.1 }), { action: 'seek', time: 0 });
  // Within the first 3 s, Prev jumps to the previous chapter
  assert.deepEqual(resolvePrevAction({ index: 2, status: 'playing', elapsed: 1.8 }), { action: 'chapter', index: 1 });
  assert.deepEqual(resolvePrevAction({ index: 0, status: 'playing', elapsed: 1.8 }), { action: 'seek', time: 0 });
});

test('shouldSkipStreamLookup skips only locked Gemini variants while allowing background stream upgrades', () => {
  const lockedEp = {
    audio: {},
  };
  const explicitlyLockedEp = {
    audio: {
      gemini: {
        unlocked: false,
        status: 'pending',
        clips: {},
      },
    },
  };
  const renderingEp = {
    audio: {
      gemini: {
        unlocked: true,
        status: 'rendering',
        clips: { 'seg-1': { key: 'abc123', duration: 15 } },
      },
    },
  };
  const readyEp = {
    audio: {
      gemini: {
        unlocked: true,
        status: 'ready',
        clips: { 'seg-1': { key: 'abc123', duration: 15 }, 'seg-2': { key: 'def456', duration: 20 } },
      },
    },
  };
  assert.equal(shouldSkipStreamLookup(lockedEp, 'gemini'), true);
  assert.equal(shouldSkipStreamLookup(explicitlyLockedEp, 'gemini'), true);
  assert.equal(shouldSkipStreamLookup(renderingEp, 'gemini'), false);
  assert.equal(shouldSkipStreamLookup(readyEp, 'gemini'), false);
  assert.equal(shouldSkipStreamLookup(lockedEp, 'edge'), false);
  assert.equal(isChapterClipRendered(renderingEp, 'gemini', 'seg-1'), true);
  assert.equal(isChapterClipRendered(renderingEp, 'gemini', 'seg-2'), false);
});

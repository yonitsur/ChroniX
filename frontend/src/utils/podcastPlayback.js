// Pure helpers for the podcast player (no React / DOM), unit-tested with `node --test`.

export const SPEED_OPTIONS = [1, 1.25, 1.5, 1.75, 2];
export const PODCAST_ENGINE_TIERS = { edge: 'standard', gcloud: 'cloud', gemini: 'premium' };
const NARRATION_WORDS_PER_SEC = 2.35;

export function defaultPodcastEngineForLanguage(lang, engines = []) {
  const normLang = String(lang || 'en').trim().toLowerCase().slice(0, 2) || 'en';
  if (normLang === 'he') {
    const gcloudEntry = Array.isArray(engines) ? engines.find((e) => e?.id === 'gcloud') : null;
    if (!gcloudEntry || gcloudEntry.available !== false) {
      return 'gcloud';
    }
  }
  return 'edge';
}

export function formatTimeSec(sec) {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.round(sec);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function estimateSegmentDurationSec(seg) {
  const text = (seg?.turns || []).map((t) => (t?.text || '').trim()).filter(Boolean).join(' ');
  if (!text) return 8;
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(5, Math.round(words / NARRATION_WORDS_PER_SEC));
}

export function estimateEpisodeDurationSec(episode) {
  return (episode?.segments || []).reduce((acc, seg) => acc + estimateSegmentDurationSec(seg), 0);
}

// Best known duration per segment: a loaded clip, then the server's render record, then an estimate.
export function segmentDurations(episode, engine, clipDurations = {}) {
  const rendered = episode?.audio?.[engine]?.clips || {};
  return (episode?.segments || []).map((seg) => {
    const exact = clipDurations[seg.id] ?? rendered[seg.id]?.duration;
    return Number.isFinite(exact) && exact > 0 ? exact : estimateSegmentDurationSec(seg);
  });
}

export function computeTimeMetrics(durations, index, elapsed) {
  if (!durations?.length) {
    return { chapterElapsed: 0, chapterDuration: 0, chapterRemaining: 0, totalDuration: 0, totalElapsed: 0, totalRemaining: 0 };
  }
  const chapterDuration = durations[index] || 0;
  const chapterElapsed = Math.min(chapterDuration, Math.max(0, elapsed || 0));
  const totalDuration = durations.reduce((a, d) => a + d, 0);
  const prior = durations.slice(0, index).reduce((a, d) => a + d, 0);
  const totalElapsed = Math.min(totalDuration, prior + chapterElapsed);
  return {
    chapterElapsed,
    chapterDuration,
    chapterRemaining: Math.max(0, chapterDuration - chapterElapsed),
    totalDuration,
    totalElapsed,
    totalRemaining: Math.max(0, totalDuration - totalElapsed),
  };
}

// Character-proportional guess of the active turn when no timing data is available.
export function estimateActiveTurn(turns, progress) {
  if (!turns?.length) return 0;
  const lengths = turns.map((t) => Math.max(1, (t?.text || '').length));
  const target = Math.min(1, Math.max(0, progress || 0)) * lengths.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < lengths.length; i += 1) {
    acc += lengths[i];
    if (target <= acc) return i;
  }
  return turns.length - 1;
}

// Active turn + sentence at `time` from server timings ({turn_starts, sentences}).
export function findActiveCue(clip, time, turns = [], duration = 0) {
  const sentences = clip?.sentences || [];
  if (sentences.length) {
    let idx = 0;
    for (let i = 0; i < sentences.length; i += 1) {
      if (sentences[i].start <= time + 0.05) idx = i;
      else break;
    }
    return { turnIndex: sentences[idx].turn ?? 0, sentenceIndex: idx, sentence: sentences[idx] };
  }
  const starts = clip?.turn_starts || [];
  if (starts.length) {
    let turnIndex = 0;
    for (let i = 0; i < starts.length; i += 1) {
      if (starts[i] <= time + 0.05) turnIndex = i;
    }
    return { turnIndex, sentenceIndex: -1, sentence: null };
  }
  const progress = duration > 0 ? time / duration : 0;
  return { turnIndex: estimateActiveTurn(turns, progress), sentenceIndex: -1, sentence: null };
}

export function nextSpeed(current) {
  const idx = SPEED_OPTIONS.indexOf(current);
  return SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
}

// ---- Continuous episode stream ---------------------------------------------------------------
// The whole episode as one MP3: each chapter is the span [start, end) inside it. The short pause
// between chapters belongs to the upcoming chapter, so the index flips the moment speech ends.

export function buildEpisodeStream(manifest, segments) {
  if (!manifest?.src || !segments?.length) return null;
  const byId = new Map((manifest.chapters || []).map((c) => [c.id, c]));
  const chapters = [];
  for (const seg of segments) {
    const ch = byId.get(seg.id);
    const start = Number(ch?.start);
    const duration = Number(ch?.duration);
    if (!ch || !Number.isFinite(start) || !Number.isFinite(duration) || start < 0 || duration <= 0) return null;
    const prev = chapters[chapters.length - 1];
    if (prev && start < prev.end - 0.01) return null;
    chapters.push({
      id: seg.id,
      start,
      duration,
      end: start + duration,
      turn_starts: ch.turn_starts || [],
      sentences: ch.sentences || [],
    });
  }
  const last = chapters[chapters.length - 1];
  const duration = Number(manifest.duration);
  return {
    src: manifest.src,
    key: manifest.key,
    duration: Number.isFinite(duration) && duration >= last.end - 0.01 ? duration : last.end,
    chapters,
  };
}

export function chapterAtTime(chapters, time) {
  if (!chapters?.length) return 0;
  const t = Number.isFinite(time) ? time : 0;
  for (let i = 0; i < chapters.length; i += 1) {
    if (t < chapters[i].end) return i;
  }
  return chapters.length - 1;
}

// Chapter-relative position inside the continuous stream (0 during the pause before a chapter).
export function chapterElapsed(chapter, time) {
  if (!chapter) return 0;
  return Math.min(chapter.duration, Math.max(0, (Number.isFinite(time) ? time : 0) - chapter.start));
}

export function buildListenLink(shareUrl) {
  if (!shareUrl) return '';
  try {
    const url = new URL(shareUrl);
    url.searchParams.set('listen', '1');
    return url.toString();
  } catch {
    return `${shareUrl}${shareUrl.includes('?') ? '&' : '?'}listen=1`;
  }
}

export function isTypingTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(el.isContentEditable);
}

export function resolveNextIndex(currentIndex, segmentCount) {
  const idx = Number.isInteger(currentIndex) && currentIndex >= 0 ? currentIndex : 0;
  const total = Number.isInteger(segmentCount) && segmentCount > 0 ? segmentCount : 0;
  return idx + 1 < total ? idx + 1 : null;
}

export function resolvePrevAction({ index = 0, status = 'idle', elapsed = 0, rewindThresholdSec = 3 } = {}) {
  const idx = Number.isInteger(index) && index >= 0 ? index : 0;
  const isActiveClip = status === 'playing' || status === 'paused';
  if (isActiveClip && Number(elapsed) > rewindThresholdSec) {
    return { action: 'seek', time: 0 };
  }
  if (idx > 0) {
    return { action: 'chapter', index: idx - 1 };
  }
  if (isActiveClip) {
    return { action: 'seek', time: 0 };
  }
  return { action: 'none' };
}

export function isChapterClipRendered(episode, engine, segmentId) {
  if (!episode || !engine || !segmentId) return false;
  return Boolean(episode?.audio?.[engine]?.clips?.[segmentId]?.key);
}

export function shouldSkipStreamLookup(episode, engine) {
  if (!episode || engine !== 'gemini') return false;
  const gemini = episode?.audio?.gemini;
  if (!gemini) return true;
  return gemini.unlocked === false;
}

// ---- Playback state machine ----------------------------------------------------------------
// idle → loading (fetching/rendering a chapter) → playing ⇄ paused → ended; any → error.

export const initialPlaybackState = {
  status: 'idle',
  index: 0,
  elapsed: 0,
  duration: 0,
  error: null,
  needsGesture: false,
  requestId: 0,
};

export function playbackReducer(state, action) {
  switch (action.type) {
    case 'load':
      return {
        ...state,
        status: 'loading',
        index: action.index,
        elapsed: 0,
        duration: 0,
        error: null,
        requestId: state.requestId + 1,
      };
    case 'playing':
      if (action.requestId != null && action.requestId !== state.requestId) return state;
      return { ...state, status: 'playing', error: null, needsGesture: false };
    case 'paused':
      return state.status === 'playing' ? { ...state, status: 'paused' } : state;
    case 'blocked':
      // Autoplay was refused by the browser: wait for a tap instead of showing an error.
      return { ...state, status: 'paused', needsGesture: true };
    case 'time':
      return {
        ...state,
        elapsed: Number.isFinite(action.elapsed) ? action.elapsed : state.elapsed,
        duration: Number.isFinite(action.duration) && action.duration > 0 ? action.duration : state.duration,
      };
    case 'ended':
      return { ...state, status: 'ended', elapsed: state.duration || state.elapsed };
    case 'chapter':
      // Next chapter inside the continuous episode stream: no loading, playback status unchanged.
      return {
        ...state,
        index: action.index,
        elapsed: Number.isFinite(action.elapsed) ? action.elapsed : 0,
        duration: Number.isFinite(action.duration) && action.duration > 0 ? action.duration : 0,
      };
    case 'error':
      if (action.requestId != null && action.requestId !== state.requestId) return state;
      return { ...state, status: 'error', error: action.message || 'Playback failed' };
    case 'select':
      return { ...state, status: 'idle', index: action.index, elapsed: 0, duration: 0, error: null, requestId: state.requestId + 1 };
    case 'reset':
      return { ...initialPlaybackState, requestId: state.requestId + 1 };
    default:
      return state;
  }
}

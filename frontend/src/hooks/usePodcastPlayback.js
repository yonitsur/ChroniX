import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { fetchPodcastClip, fetchPodcastEpisodeAudio, reportPodcastListen } from '../api';
import {
  buildEpisodeStream,
  chapterAtTime,
  chapterElapsed,
  computeTimeMetrics,
  findActiveCue,
  initialPlaybackState,
  isChapterClipRendered,
  isTypingTarget,
  nextSpeed,
  playbackReducer,
  resolveNextIndex,
  resolvePrevAction,
  segmentDurations,
  shouldSkipStreamLookup,
} from '../utils/podcastPlayback';
import {
  DEFAULT_MUSIC_VOLUME,
  LiveMusic,
  MUSIC_CHAPTER_GAP_MS,
  MUSIC_LEAD_IN_MS,
  musicVolumeGain,
} from '../utils/podcastMusic';

// 50 ms of silence in the same 24 kHz MP3 format as chapter clips. Playing it inside a tap
// "unlocks" the audio element on iOS Safari so later chapters can start without a new gesture.
const SILENT_MP3 =
  'data:audio/mpeg;base64,//NkxAAAAANIAAAAAExBTUVVVVVMQU1FNC4wVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV';

const CHIME_MS = 420;
const SEEK_STEP_SEC = 10;
// While the continuous episode file isn't ready yet, re-check at most this often.
const STREAM_RETRY_MS = 15000;
// How long a user-initiated play waits for an in-flight continuous-file lookup before using chapter clips.
const STREAM_WAIT_MS = 1200;
// Coalesce window for rapid chapter skips on unrendered chapters so intermediate clicks never hit the server.
const SKIP_SETTLE_MS = 160;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function waitForMetadata(audio) {
  if (audio.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener('loadedmetadata', onReady);
      audio.removeEventListener('error', onFail);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onFail = () => {
      cleanup();
      reject(new Error('audio'));
    };
    audio.addEventListener('loadedmetadata', onReady);
    audio.addEventListener('error', onFail);
  });
}

function newSession() {
  return {
    firstRequestAt: 0,
    playReported: false,
    listened: 0,
    lastTime: null,
    chapters: new Set(),
    maxChapter: 0,
    bufferingMs: 0,
    bufferingSince: 0,
    fallbacks: 0,
    sent: false,
  };
}

/**
 * Plays a server-rendered podcast episode.
 * Once every chapter is rendered, the whole episode streams as one continuous file (chapters are
 * time offsets inside it), so chapter transitions are gapless even with the screen off. Until then
 * it plays chapter clips one by one and switches to the continuous file at the next chapter boundary.
 * Owns one long-lived <audio> element, a de-duplicated clip manifest cache with prefetch,
 * Media Session (lock-screen) controls, keyboard shortcuts, chapter chimes, a procedural
 * background-music bed that ducks under the voice, and listening analytics.
 */
export default function usePodcastPlayback({
  timelineId,
  episode,
  engine = 'edge',
  enabled = true,
  contentMode = null,
  isSharedView = false,
  chimeEnabled = true,
  musicEnabled = false,
  musicVolume = DEFAULT_MUSIC_VOLUME,
  musicMood = 'sunrise_piano',
  musicSeed = '',
  onChapterStart,
  onFallback,
  getArtworkUrl,
}) {
  const [state, rawDispatch] = useReducer(playbackReducer, initialPlaybackState);
  const [clipDurations, setClipDurations] = useState({});
  const [currentClip, setCurrentClip] = useState(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);

  const audioRef = useRef(null);
  const preloadRef = useRef(null);
  const audioCtxRef = useRef(null);
  const musicRef = useRef(null);
  const switchingRef = useRef(0); // load sequence currently swapping the audio source
  const gapRef = useRef(null); // next chapter index while the between-chapter pause runs
  const unmountedRef = useRef(false);
  const clipsRef = useRef(new Map());
  const resolvedClipsRef = useRef(new Map()); // synchronous mirror of resolved clips for 0-tick lock-screen handoffs
  const streamRef = useRef(null); // continuous episode file: { variant, src, duration, chapters }
  const streamFetchRef = useRef(null); // { variant, at, promise } of the latest lookup
  const modeRef = useRef('clips'); // which source the <audio> element holds: 'clips' | 'stream'
  const streamIndexRef = useRef(0); // chapter the stream position is in
  const transitionRef = useRef(false); // stream deliberately paused for a between-chapter music swell
  const loadSeqRef = useRef(0);
  const targetIndexRef = useRef(0); // synchronously tracks selected chapter across rapid clicks
  const clipAbortRef = useRef(null);
  const skipSettleTimerRef = useRef(null);
  const stateRef = useRef(initialPlaybackState);
  const dispatch = useCallback((action) => {
    stateRef.current = playbackReducer(stateRef.current, action);
    rawDispatch(action);
  }, []);
  const sessionRef = useRef(newSession());
  const handlersRef = useRef({});
  const latest = useRef({});

  const segments = useMemo(() => episode?.segments || [], [episode]);
  const episodeId = episode?.id || null;
  const voiceGender = episode?.voice_gender === 'female' ? 'female' : 'male';
  const musicGain = muted ? 0 : musicVolumeGain(musicVolume) * volume;
  latest.current = {
    timelineId, episode, engine, voiceGender, segments, playbackRate, volume, muted, chimeEnabled,
    contentMode, isSharedView, onChapterStart, onFallback, getArtworkUrl,
    musicEnabled, musicMood, musicSeed, musicGain,
  };

  // ---- Background music -------------------------------------------------------------------
  const ensureAudioContext = useCallback(() => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx && !audioCtxRef.current) audioCtxRef.current = new Ctx();
      if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume().catch(() => {});
    } catch {
      // Web Audio unavailable: no chimes or music
    }
    return audioCtxRef.current;
  }, []);

  const getMusic = useCallback(() => {
    if (!musicRef.current) {
      musicRef.current = new LiveMusic(() => (unmountedRef.current ? null : audioCtxRef.current));
    }
    const { musicMood: mood, musicSeed: seed, musicGain: gain } = latest.current;
    musicRef.current.configure({ mood, seed, gain });
    return musicRef.current;
  }, []);

  useEffect(() => {
    musicRef.current?.configure({ mood: musicMood, seed: musicSeed, gain: musicGain });
  }, [musicMood, musicSeed, musicGain]);

  useEffect(() => {
    if (!musicEnabled) {
      musicRef.current?.stop(0.6);
      return;
    }
    if (stateRef.current.status === 'playing') {
      ensureAudioContext();
      getMusic().start('duck');
    }
  }, [musicEnabled, ensureAudioContext, getMusic]);

  // ---- Analytics --------------------------------------------------------------------------
  const durations = useMemo(
    () => segmentDurations(episode, engine, clipDurations),
    [episode, engine, clipDurations],
  );
  const durationsRef = useRef(durations);
  durationsRef.current = durations;

  const flushSession = useCallback((event = 'session_end') => {
    const s = sessionRef.current;
    const { episode: ep, timelineId: tid, engine: eng, contentMode: cm, isSharedView: shared } = latest.current;
    if (!ep || s.sent || s.listened < 1) return;
    s.sent = true;
    reportPodcastListen({
      event,
      timelineId: tid,
      episodeId: ep.id,
      engine: eng,
      contentMode: cm,
      chaptersTotal: ep.segments?.length || 0,
      chaptersCompleted: s.chapters.size,
      maxChapterReached: s.maxChapter + 1,
      listenedSeconds: s.listened,
      episodeSeconds: durationsRef.current.reduce((a, d) => a + d, 0),
      bufferingMs: s.bufferingMs,
      fallbackCount: s.fallbacks,
      isSharedView: shared,
      musicEnabled: latest.current.musicEnabled,
      musicMood: latest.current.musicMood,
    });
  }, []);

  // ---- Audio elements -----------------------------------------------------------------------
  const cancelPendingLoad = useCallback(() => {
    if (skipSettleTimerRef.current) {
      clearTimeout(skipSettleTimerRef.current);
      skipSettleTimerRef.current = null;
    }
    if (clipAbortRef.current) {
      clipAbortRef.current.abort();
      clipAbortRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (typeof Audio === 'undefined') return undefined;
    const audio = new Audio();
    audio.preload = 'auto';
    const preload = new Audio();
    preload.preload = 'auto';
    preload.muted = true;
    audioRef.current = audio;
    preloadRef.current = preload;
    unmountedRef.current = false;

    const onTime = () => {
      if (switchingRef.current || stateRef.current.status === 'loading') return;
      if (modeRef.current === 'stream') handlersRef.current.onStreamTime(audio);
      else dispatch({ type: 'time', elapsed: audio.currentTime, duration: audio.duration });
      const s = sessionRef.current;
      if (!audio.paused && s.lastTime != null) {
        const delta = audio.currentTime - s.lastTime;
        if (delta > 0 && delta < 2.5) s.listened += delta;
      }
      s.lastTime = audio.currentTime;
      if ('mediaSession' in navigator && Number.isFinite(audio.duration) && audio.duration > 0) {
        try {
          navigator.mediaSession.setPositionState({
            duration: audio.duration,
            position: Math.min(audio.currentTime, audio.duration),
            playbackRate: audio.playbackRate || 1,
          });
        } catch {
          // ignore unsupported position state
        }
      }
    };
    const onPlaying = () => {
      const s = sessionRef.current;
      if (s.bufferingSince) {
        s.bufferingMs += Date.now() - s.bufferingSince;
        s.bufferingSince = 0;
      }
      s.lastTime = audio.currentTime;
      dispatch({ type: 'playing' });
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      if (latest.current.musicEnabled && !hidden) handlersRef.current.music().start('duck');
      if (!s.playReported && s.firstRequestAt) {
        s.playReported = true;
        const { episode: ep, timelineId: tid, engine: eng, contentMode: cm, isSharedView: shared } = latest.current;
        reportPodcastListen({
          event: 'play_start',
          timelineId: tid,
          episodeId: ep?.id,
          engine: eng,
          contentMode: cm,
          chaptersTotal: ep?.segments?.length || 0,
          timeToFirstAudioMs: Date.now() - s.firstRequestAt,
          isSharedView: shared,
          musicEnabled: latest.current.musicEnabled,
          musicMood: latest.current.musicMood,
        });
      }
    };
    const onPause = () => {
      // A chapter ending fires 'pause' right before 'ended', the stream is paused on purpose for a
      // between-chapter music swell, and source switches pause the previous clip before loading the next.
      if (audio.ended || transitionRef.current || switchingRef.current) return;
      dispatch({ type: 'paused' });
      musicRef.current?.pause();
    };
    const onWaiting = () => {
      if (!sessionRef.current.bufferingSince) sessionRef.current.bufferingSince = Date.now();
    };
    const onEnded = () => {
      if (switchingRef.current) return;
      handlersRef.current.onEnded();
    };
    const onError = () => {
      if (!audio.src || audio.src.startsWith('data:')) return;
      if (modeRef.current === 'stream') {
        handlersRef.current.onStreamError();
        return;
      }
      dispatch({ type: 'error', message: 'audio' });
      musicRef.current?.pause();
    };

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    const onPageHide = () => flushSession();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      flushSession();
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      window.removeEventListener('pagehide', onPageHide);
      // Invalidate pending lead-ins and between-chapter timers so nothing plays after unmount.
      unmountedRef.current = true;
      cancelPendingLoad();
      loadSeqRef.current += 1;
      switchingRef.current = 0;
      gapRef.current = null;
      transitionRef.current = false;
      musicRef.current?.dispose();
      musicRef.current = null;
      audio.pause();
      audio.removeAttribute('src');
      preload.removeAttribute('src');
      audioCtxRef.current?.close?.().catch(() => {});
    };
  }, [flushSession, cancelPendingLoad]);

  // New episode, voice engine, or voice gender: drop cached manifests from other variants and start a fresh analytics session.
  useEffect(() => {
    const prefix = `${episodeId || ''}:${engine || ''}:${voiceGender}:`;
    for (const key of clipsRef.current.keys()) {
      if (!key.startsWith(prefix)) clipsRef.current.delete(key);
    }
    for (const key of resolvedClipsRef.current.keys()) {
      if (!key.startsWith(prefix)) resolvedClipsRef.current.delete(key);
    }
    cancelPendingLoad();
    setCurrentClip(null);
    setClipDurations({});
    loadSeqRef.current += 1;
    switchingRef.current = 0;
    gapRef.current = null;
    transitionRef.current = false;
    streamRef.current = null;
    streamFetchRef.current = null;
    streamIndexRef.current = 0;
    modeRef.current = 'clips';
    audioRef.current?.pause();
    audioRef.current?.removeAttribute('src');
    preloadRef.current?.removeAttribute('src');
    return () => {
      flushSession();
      sessionRef.current = newSession();
    };
  }, [episodeId, engine, voiceGender, flushSession, cancelPendingLoad]);

  useEffect(() => {
    cancelPendingLoad();
    loadSeqRef.current += 1;
    switchingRef.current = 0;
    targetIndexRef.current = 0;
    audioRef.current?.pause();
    musicRef.current?.stop(0.4);
    dispatch({ type: 'reset' });
  }, [episodeId, cancelPendingLoad]);

  // ---- Clip manifests -------------------------------------------------------------------------
  const seedClip = useCallback((epId, eng, segId, clip, gender = null) => {
    if (!epId || !eng || !segId || !clip) return;
    const effGender = (gender || latest.current.voiceGender) === 'female' ? 'female' : 'male';
    const key = `${epId}:${eng}:${effGender}:${segId}`;
    clipsRef.current.set(key, Promise.resolve(clip));
    resolvedClipsRef.current.set(key, clip);
    setClipDurations((prev) => (prev[segId] === clip.duration ? prev : { ...prev, [segId]: clip.duration }));
    if (preloadRef.current && clip.src && preloadRef.current.src !== clip.src) {
      preloadRef.current.src = clip.src;
    }
  }, []);

  const getClip = useCallback((index, signal = null) => {
    const { timelineId: tid, episode: ep, engine: eng, voiceGender: gender, segments: segs } = latest.current;
    const seg = segs[index];
    if (!ep || !seg) return Promise.reject(new Error('No chapter'));
    const key = `${ep.id}:${eng}:${gender}:${seg.id}`;
    if (!clipsRef.current.has(key)) {
      const promise = fetchPodcastClip(tid, ep.id, seg.id, eng, signal, gender)
        .then((clip) => {
          resolvedClipsRef.current.set(key, clip);
          setClipDurations((prev) => (prev[seg.id] === clip.duration ? prev : { ...prev, [seg.id]: clip.duration }));
          if (clip.fallback_from) {
            sessionRef.current.fallbacks += 1;
            latest.current.onFallback?.(clip);
          }
          return clip;
        })
        .catch((err) => {
          clipsRef.current.delete(key);
          resolvedClipsRef.current.delete(key);
          throw err;
        });
      clipsRef.current.set(key, promise);
    }
    return clipsRef.current.get(key);
  }, []);

  const prefetch = useCallback((index) => {
    const { engine: eng, segments: segs } = latest.current;
    if (index + 1 < segs.length) {
      getClip(index + 1)
        .then((clip) => {
          if (preloadRef.current && clip.src && preloadRef.current.src !== clip.src) preloadRef.current.src = clip.src;
        })
        .catch(() => {});
    }
    if (index + 2 < segs.length && eng !== 'gemini') {
      getClip(index + 2).catch(() => {});
    }
  }, [getClip]);

  // ---- Continuous episode stream ---------------------------------------------------------------
  const currentVariant = useCallback(() => {
    const { episode: ep, engine: eng, voiceGender: gender } = latest.current;
    return ep?.id ? `${ep.id}:${eng}:${gender}` : null;
  }, []);

  const readyStream = useCallback(() => {
    const stream = streamRef.current;
    return stream && stream.variant === currentVariant() ? stream : null;
  }, [currentVariant]);

  // Look up (once per STREAM_RETRY_MS while not ready) whether the whole episode is available as one file.
  const ensureStream = useCallback(() => {
    const { timelineId: tid, episode: ep, engine: eng, voiceGender: gender, segments: segs } = latest.current;
    const variant = currentVariant();
    if (!tid || !variant || !segs.length) return Promise.resolve(null);
    const ready = readyStream();
    if (ready) return Promise.resolve(ready);
    if (shouldSkipStreamLookup(ep, eng)) return Promise.resolve(null);
    const pending = streamFetchRef.current;
    if (pending?.variant === variant) {
      if (pending.promise) return pending.promise;
      if (Date.now() - pending.at < STREAM_RETRY_MS) return Promise.resolve(null);
    }
    const entry = { variant, at: Date.now(), promise: null };
    streamFetchRef.current = entry;
    entry.promise = fetchPodcastEpisodeAudio(tid, ep.id, eng, gender)
      .then((res) => {
        const stream = res?.ready ? buildEpisodeStream(res, segs) : null;
        if (!stream || streamFetchRef.current !== entry) return null;
        streamRef.current = { ...stream, variant };
        setClipDurations((prev) => {
          const next = { ...prev };
          stream.chapters.forEach((c) => { next[c.id] = c.duration; });
          return next;
        });
        return streamRef.current;
      })
      .catch(() => null)
      .finally(() => {
        entry.promise = null;
        entry.at = Date.now();
      });
    return entry.promise;
  }, [readyStream, currentVariant]);

  const variantAudioStatus = episode?.audio?.[engine]?.status || null;
  useEffect(() => {
    if (enabled && episodeId) ensureStream();
  }, [enabled, episodeId, engine, voiceGender, variantAudioStatus, ensureStream]);

  // ---- Transport ------------------------------------------------------------------------------
  const unlock = useCallback(() => {
    const audio = audioRef.current;
    if (audio && !audio.src) {
      audio.src = SILENT_MP3;
      audio.play().then(() => audio.pause()).catch(() => {});
    }
    ensureAudioContext();
  }, [ensureAudioContext]);

  // `chained`: called from a chapter ending (never waits on the continuous-file lookup).
  const play = useCallback(async (index = targetIndexRef.current, { chained = false } = {}) => {
    const audio = audioRef.current;
    const segs = latest.current.segments;
    if (!audio || !segs[index]) return;
    cancelPendingLoad();
    loadSeqRef.current += 1;
    gapRef.current = null;
    transitionRef.current = false;
    const seq = loadSeqRef.current;
    targetIndexRef.current = index;
    switchingRef.current = seq;
    // Silence any previously playing clip immediately so old audio never bleeds over a slow load.
    if (!audio.paused && (!readyStream() || modeRef.current !== 'stream')) {
      audio.pause();
    }
    const s = sessionRef.current;
    if (!s.firstRequestAt) s.firstRequestAt = Date.now();
    s.sent = false;
    s.maxChapter = Math.max(s.maxChapter, index);
    s.bufferingSince = s.bufferingSince || Date.now();
    dispatch({ type: 'load', index });
    latest.current.onChapterStart?.(segs[index], index);
    const hiddenOnStart = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    // Runs synchronously inside the user's tap, so the AudioContext may start on iOS/Safari.
    if (!hiddenOnStart) ensureAudioContext();

    const handlePlayError = (err) => {
      if (seq !== loadSeqRef.current) return;
      if (err?.name === 'NotAllowedError') dispatch({ type: 'blocked' });
      // AbortError: paused (e.g. from the lock screen) while the chapter was still buffering.
      else if (err?.name === 'AbortError') dispatch({ type: 'select', index });
      else dispatch({ type: 'error', message: err?.message || 'audio' });
      musicRef.current?.pause();
    };

    try {
      let stream = readyStream();
      if (!stream) {
        const lookup = ensureStream();
        const statusNow = latest.current.episode?.audio?.[latest.current.engine]?.status;
        if (!chained && (!statusNow || statusNow === 'ready')) {
          stream = await Promise.race([lookup, sleep(STREAM_WAIT_MS).then(() => null)]);
          if (seq !== loadSeqRef.current) return;
        }
      }

      if (stream) {
        const hiddenNow = typeof document !== 'undefined' && document.visibilityState === 'hidden';
        const chapter = stream.chapters[index];
        const music = latest.current.musicEnabled && !hiddenNow ? getMusic() : null;
        if (music && index === 0 && !chained) {
          music.start('bed');
          await music.leadIn(MUSIC_LEAD_IN_MS);
          if (seq !== loadSeqRef.current) return;
        }
        setCurrentClip(chapter);
        streamIndexRef.current = index;
        if (modeRef.current !== 'stream') {
          modeRef.current = 'stream';
          // The media fragment is the initial position, so loading starts right at the chapter.
          audio.src = chapter.start > 0 ? `${stream.src}#t=${chapter.start.toFixed(3)}` : stream.src;
        }
        audio.playbackRate = latest.current.playbackRate;
        audio.volume = latest.current.volume;
        audio.muted = latest.current.muted;
        s.lastTime = null;
        const seekToChapter = () => {
          if (seq !== loadSeqRef.current) return;
          if (Math.abs(audio.currentTime - chapter.start) > 0.25) audio.currentTime = chapter.start;
          s.lastTime = chapter.start;
        };
        // play() is called right away (no waiting on metadata): iOS loads nothing until it is called,
        // and with the screen off the hand-off must not wait a network round-trip.
        if (audio.readyState >= 1) seekToChapter();
        else waitForMetadata(audio).then(seekToChapter, () => {});
        dispatch({ type: 'chapter', index, elapsed: 0, duration: chapter.duration });
        if (latest.current.musicEnabled && !hiddenNow) getMusic().start('duck');
        try {
          await audio.play();
          // Seeking inside an already-playing, buffered stream doesn't always fire 'playing'.
          if (seq === loadSeqRef.current && !audio.paused) {
            if (s.bufferingSince) {
              s.bufferingMs += Date.now() - s.bufferingSince;
              s.bufferingSince = 0;
            }
            dispatch({ type: 'playing' });
          }
        } catch (err) {
          handlePlayError(err);
        }
        return;
      }

      const { episode: ep, engine: eng, voiceGender: gender } = latest.current;
      const cacheKey = ep ? `${ep.id}:${eng}:${gender}:${segs[index].id}` : '';
      let clip = cacheKey ? resolvedClipsRef.current.get(cacheKey) || null : null;
      if (!clip) {
        const alreadyCached = Boolean(cacheKey && clipsRef.current.has(cacheKey));
        const alreadyRendered = isChapterClipRendered(ep, eng, segs[index].id);
        if (!chained && !alreadyCached && !alreadyRendered) {
          await new Promise((resolve) => {
            skipSettleTimerRef.current = setTimeout(() => {
              skipSettleTimerRef.current = null;
              resolve();
            }, SKIP_SETTLE_MS);
          });
          if (seq !== loadSeqRef.current) return;
        }

        const controller = !alreadyCached ? new AbortController() : null;
        if (controller) clipAbortRef.current = controller;
        try {
          clip = await getClip(index, controller?.signal || null);
        } catch (err) {
          if (clipAbortRef.current === controller) clipAbortRef.current = null;
          if (seq === loadSeqRef.current && err?.name !== 'AbortError') {
            dispatch({ type: 'error', message: err?.message || 'audio' });
            musicRef.current?.pause();
          }
          return;
        }
        if (clipAbortRef.current === controller) clipAbortRef.current = null;
        if (seq !== loadSeqRef.current) return;
      }

      const hiddenNow = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      const music = latest.current.musicEnabled && !hiddenNow ? getMusic() : null;
      if (music && index === 0 && !chained) {
        music.start('bed');
        await music.leadIn(MUSIC_LEAD_IN_MS);
        if (seq !== loadSeqRef.current) return;
      }

      setCurrentClip(clip);
      modeRef.current = 'clips';
      audio.src = clip.src;
      audio.playbackRate = latest.current.playbackRate;
      audio.volume = latest.current.volume;
      audio.muted = latest.current.muted;
      s.lastTime = 0;
      if (latest.current.musicEnabled && !hiddenNow) getMusic().start('duck');
      try {
        await audio.play();
        if (seq === loadSeqRef.current && !audio.paused) {
          if (s.bufferingSince) {
            s.bufferingMs += Date.now() - s.bufferingSince;
            s.bufferingSince = 0;
          }
          dispatch({ type: 'playing' });
        }
        if (seq === loadSeqRef.current) {
          prefetch(index);
        }
      } catch (err) {
        handlePlayError(err);
      }
    } finally {
      if (switchingRef.current === seq) switchingRef.current = 0;
    }
  }, [getClip, prefetch, ensureAudioContext, getMusic, readyStream, ensureStream, cancelPendingLoad, dispatch]);

  const playChime = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || !latest.current.chimeEnabled || latest.current.muted) return 0;
    try {
      const now = ctx.currentTime;
      const peak = 0.07 * latest.current.volume;
      [[659.25, 0], [987.77, 0.13]].forEach(([freq, offset]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.28);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.3);
      });
      return CHIME_MS;
    } catch {
      return 0;
    }
  }, []);

  // ---- Continuous stream: chapter tracking, transitions and failure fallback ------------------
  const enterStreamChapter = useCallback((index, natural) => {
    const stream = readyStream();
    const audio = audioRef.current;
    if (!stream || !audio) return null;
    const s = sessionRef.current;
    if (natural) s.chapters.add(streamIndexRef.current);
    s.maxChapter = Math.max(s.maxChapter, index);
    streamIndexRef.current = index;
    targetIndexRef.current = index;
    const chapter = stream.chapters[index];
    setCurrentClip(chapter);
    dispatch({ type: 'chapter', index, elapsed: chapterElapsed(chapter, audio.currentTime), duration: chapter.duration });
    latest.current.onChapterStart?.(latest.current.segments[index], index);
    return chapter;
  }, [readyStream]);

  handlersRef.current.onStreamTime = (audio) => {
    const stream = readyStream();
    // Ignore positions reported while a load/seek is being set up or during a music swell.
    if (!stream || switchingRef.current || transitionRef.current) return;
    const time = audio.currentTime;
    const prevIndex = streamIndexRef.current;
    const index = chapterAtTime(stream.chapters, time);
    if (index !== prevIndex) {
      const natural = index === prevIndex + 1 && !audio.paused && time - stream.chapters[prevIndex].end < 1.5;
      const chapter = enterStreamChapter(index, natural);
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      if (natural && chapter && !hidden) {
        // Speech of the previous chapter just ended: the chime plays over the short pause that is
        // part of the file. With music on, hold the voice for a swell like the chapter-by-chapter player.
        playChime();
        if (latest.current.musicEnabled && musicRef.current?.isRunning) {
          const seq = loadSeqRef.current;
          musicRef.current.setLevel('bed');
          gapRef.current = index;
          transitionRef.current = true;
          audio.pause();
          setTimeout(() => {
            if (seq !== loadSeqRef.current || gapRef.current !== index) return;
            gapRef.current = null;
            transitionRef.current = false;
            audio.currentTime = chapter.start;
            audio.play().catch(() => dispatch({ type: 'paused' }));
          }, MUSIC_CHAPTER_GAP_MS);
        }
        return;
      }
    }
    const chapter = stream.chapters[streamIndexRef.current];
    dispatch({ type: 'time', elapsed: chapterElapsed(chapter, time), duration: chapter.duration });
  };

  handlersRef.current.onStreamError = () => {
    // The continuous file failed to load: fall back to chapter clips and don't retry it for a while.
    streamRef.current = null;
    streamFetchRef.current = { variant: currentVariant(), at: Date.now(), promise: null };
    modeRef.current = 'clips';
    transitionRef.current = false;
    const { status } = stateRef.current;
    if (status === 'playing' || status === 'loading') {
      play(streamIndexRef.current, { chained: true });
    } else {
      dispatch({ type: 'error', message: 'audio' });
      musicRef.current?.pause();
    }
  };

  handlersRef.current.onEnded = () => {
    if (modeRef.current === 'stream') {
      sessionRef.current.chapters.add(streamIndexRef.current);
      musicRef.current?.outro();
      dispatch({ type: 'ended' });
      flushSession('episode_complete');
      return;
    }
    const { index } = stateRef.current;
    const segs = latest.current.segments;
    sessionRef.current.chapters.add(index);
    const musicOn = latest.current.musicEnabled && musicRef.current?.isRunning;
    if (index + 1 < segs.length) {
      const seq = loadSeqRef.current;
      // Hidden tabs / locked screens freeze timers and Web Audio on mobile: chain the next chapter
      // straight from this 'ended' event (no chime or music gap) so playback keeps going.
      // Once the continuous file is ready, this hand-off moves onto it and the rest is gapless.
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      if (hidden) {
        gapRef.current = null;
        play(index + 1, { chained: true });
        return;
      }
      if (musicOn) musicRef.current.setLevel('bed');
      const wait = Math.max(playChime(), musicOn ? MUSIC_CHAPTER_GAP_MS : 0);
      gapRef.current = index + 1;
      setTimeout(() => {
        if (seq === loadSeqRef.current) play(index + 1, { chained: true });
      }, wait);
      return;
    }
    musicRef.current?.outro();
    dispatch({ type: 'ended' });
    flushSession('episode_complete');
  };
  handlersRef.current.flushGap = () => {
    const nextIndex = gapRef.current;
    if (nextIndex == null) return;
    const stream = readyStream();
    const audio = audioRef.current;
    if (transitionRef.current && stream && audio) {
      gapRef.current = null;
      transitionRef.current = false;
      audio.currentTime = stream.chapters[nextIndex].start;
      audio.play().catch(() => dispatch({ type: 'paused' }));
    } else if (!transitionRef.current) {
      play(nextIndex, { chained: true });
    }
  };
  handlersRef.current.music = getMusic;

  const pause = useCallback(() => {
    cancelPendingLoad();
    switchingRef.current = 0;
    if (gapRef.current != null) {
      // Paused between chapters: cancel the pending chapter and wait on the next one.
      const nextIndex = gapRef.current;
      gapRef.current = null;
      transitionRef.current = false;
      loadSeqRef.current += 1;
      targetIndexRef.current = nextIndex;
      musicRef.current?.pause();
      dispatch({ type: 'select', index: nextIndex });
      return;
    }
    if (stateRef.current.status === 'loading') {
      loadSeqRef.current += 1;
      audioRef.current?.pause();
      musicRef.current?.pause();
      dispatch({ type: 'select', index: targetIndexRef.current });
      return;
    }
    audioRef.current?.pause();
  }, [cancelPendingLoad]);

  const resume = useCallback(async () => {
    const audio = audioRef.current;
    const st = stateRef.current;
    ensureAudioContext();
    if (audio && audio.src && !audio.src.startsWith('data:') && (st.status === 'paused' || st.status === 'playing')) {
      try {
        await audio.play();
        return;
      } catch {
        // fall through to a fresh load
      }
    }
    const resumeIdx = st.status === 'ended' ? 0 : targetIndexRef.current;
    await play(resumeIdx);
  }, [play, ensureAudioContext]);

  const toggle = useCallback(() => {
    const st = stateRef.current;
    if (st.status === 'playing' || st.status === 'loading') pause();
    else resume();
  }, [pause, resume]);

  // Absolute position inside the continuous stream (lock-screen scrubber, ±10 s across chapters).
  const seekStream = useCallback((time) => {
    const audio = audioRef.current;
    const stream = readyStream();
    if (!audio || !stream) return;
    const max = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : stream.duration;
    const target = Math.min(Math.max(0, time), Math.max(0, max - 0.05));
    const resumeAfter = transitionRef.current;
    if (resumeAfter) {
      gapRef.current = null;
      transitionRef.current = false;
    }
    audio.currentTime = target;
    sessionRef.current.lastTime = target;
    const index = chapterAtTime(stream.chapters, target);
    if (index !== streamIndexRef.current) enterStreamChapter(index, false);
    const chapter = stream.chapters[index];
    dispatch({ type: 'time', elapsed: chapterElapsed(chapter, target), duration: chapter.duration });
    if (resumeAfter) audio.play().catch(() => dispatch({ type: 'paused' }));
  }, [readyStream, enterStreamChapter]);

  const inStream = useCallback(() => modeRef.current === 'stream' && Boolean(readyStream()), [readyStream]);

  // Chapter-relative seek (the progress bar always spans the current chapter).
  const seekTo = useCallback((sec) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (inStream()) {
      const chapter = readyStream().chapters[streamIndexRef.current];
      seekStream(chapter.start + Math.min(Math.max(0, sec), Math.max(0, chapter.duration - 0.05)));
      return;
    }
    if (!Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.min(Math.max(0, sec), Math.max(0, audio.duration - 0.05));
    sessionRef.current.lastTime = audio.currentTime;
    dispatch({ type: 'time', elapsed: audio.currentTime, duration: audio.duration });
  }, [inStream, readyStream, seekStream]);

  const seekAbsolute = useCallback((sec) => {
    if (inStream()) seekStream(sec);
    else seekTo(sec);
  }, [inStream, seekStream, seekTo]);

  const seekRatio = useCallback((ratio) => {
    const audio = audioRef.current;
    if (inStream()) seekTo(ratio * readyStream().chapters[streamIndexRef.current].duration);
    else if (audio && Number.isFinite(audio.duration)) seekTo(ratio * audio.duration);
  }, [inStream, readyStream, seekTo]);

  const seekBy = useCallback((delta) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (inStream()) seekStream(audio.currentTime + delta);
    else seekTo(audio.currentTime + delta);
  }, [inStream, seekStream, seekTo]);

  const next = useCallback(() => {
    const nextIdx = resolveNextIndex(targetIndexRef.current, latest.current.segments.length);
    if (nextIdx != null) play(nextIdx);
  }, [play]);

  const prev = useCallback(() => {
    const st = stateRef.current;
    const decision = resolvePrevAction({
      index: targetIndexRef.current,
      status: st.status,
      elapsed: st.elapsed,
    });
    if (decision.action === 'seek') seekTo(decision.time);
    else if (decision.action === 'chapter') play(decision.index);
  }, [play, seekTo]);

  const selectChapter = useCallback((index) => {
    const st = stateRef.current;
    if (st.status === 'playing' || st.status === 'loading') play(index);
    else {
      cancelPendingLoad();
      loadSeqRef.current += 1;
      switchingRef.current = 0;
      targetIndexRef.current = index;
      gapRef.current = null;
      transitionRef.current = false;
      audioRef.current?.pause();
      // The continuous file stays loaded: playing later just seeks inside it.
      if (modeRef.current !== 'stream') audioRef.current?.removeAttribute('src');
      musicRef.current?.pause();
      dispatch({ type: 'select', index });
      latest.current.onChapterStart?.(latest.current.segments[index], index);
    }
  }, [play, cancelPendingLoad]);

  const stop = useCallback(() => {
    cancelPendingLoad();
    loadSeqRef.current += 1;
    switchingRef.current = 0;
    gapRef.current = null;
    transitionRef.current = false;
    audioRef.current?.pause();
    musicRef.current?.stop();
    flushSession();
  }, [flushSession, cancelPendingLoad]);

  const cycleRate = useCallback(() => {
    setPlaybackRate((r) => {
      const n = nextSpeed(r);
      if (audioRef.current) audioRef.current.playbackRate = n;
      return n;
    });
  }, []);

  const setVolume = useCallback((value) => {
    const v = Math.min(1, Math.max(0, Number(value) || 0));
    setVolumeState(v);
    setMuted(v === 0);
    if (audioRef.current) {
      audioRef.current.volume = v;
      audioRef.current.muted = v === 0;
    }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const nextMuted = !m;
      if (audioRef.current) audioRef.current.muted = nextMuted;
      if (!nextMuted && latest.current.volume === 0) {
        setVolumeState(1);
        if (audioRef.current) audioRef.current.volume = 1;
      }
      return nextMuted;
    });
  }, []);

  // Returning from the background: mobile browsers suspend the AudioContext (music/chimes) meanwhile.
  // Going to the background mid-transition: timers get frozen, so start the next chapter right away.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        handlersRef.current.flushGap?.();
        return;
      }
      if (document.visibilityState !== 'visible') return;
      ensureStream();
      const st = stateRef.current.status;
      if (st === 'playing' || st === 'loading') {
        ensureAudioContext();
        if (st === 'playing' && latest.current.musicEnabled) {
          handlersRef.current.music?.().start('duck');
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [ensureAudioContext, ensureStream]);

  // ---- Media Session (lock screen / headphones) ----------------------------------------------
  const segment = segments[state.index] || null;
  useEffect(() => {
    if (!enabled || !episode || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return undefined;
    const ms = navigator.mediaSession;
    try {
      const art = latest.current.getArtworkUrl?.(segment);
      // eslint-disable-next-line no-undef
      ms.metadata = new MediaMetadata({
        title: segment?.chapter_title || episode.title || 'ChroniX',
        artist: [episode.host1_name, episode.host2_name].filter(Boolean).join(' & ') || 'ChroniX',
        album: episode.title || 'ChroniX Podcast',
        artwork: art ? [{ src: art, sizes: '512x512' }] : [],
      });
    } catch {
      // MediaMetadata unsupported
    }
    const handlers = {
      play: () => resume(),
      pause: () => pause(),
      previoustrack: () => prev(),
      nexttrack: () => next(),
      seekbackward: (d) => seekBy(-(d?.seekOffset || SEEK_STEP_SEC)),
      seekforward: (d) => seekBy(d?.seekOffset || SEEK_STEP_SEC),
      seekto: (d) => (Number.isFinite(d?.seekTime) ? seekAbsolute(d.seekTime) : undefined),
    };
    Object.entries(handlers).forEach(([action, handler]) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // action unsupported in this browser
      }
    });
    return () => {
      Object.keys(handlers).forEach((action) => {
        try {
          ms.setActionHandler(action, null);
        } catch {
          // ignore
        }
      });
    };
  }, [enabled, episode, segment, resume, pause, prev, next, seekBy, seekAbsolute]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    // 'loading' is the hand-off between chapters: keep reporting "playing" so the OS media notification isn't dropped.
    const status = state.status;
    navigator.mediaSession.playbackState = status === 'playing' || status === 'loading' ? 'playing' : (status === 'paused' ? 'paused' : 'none');
  }, [state.status]);

  // ---- Keyboard shortcuts: Space/K play-pause, J/L ±10s, Shift+N / Shift+P chapters -----------
  useEffect(() => {
    if (!enabled || !episode) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      const onButton = (e.target?.tagName || '').toLowerCase() === 'button';
      if ((key === ' ' && !onButton) || key === 'k') {
        e.preventDefault();
        toggle();
      } else if (key === 'j') {
        seekBy(-SEEK_STEP_SEC);
      } else if (key === 'l') {
        seekBy(SEEK_STEP_SEC);
      } else if (e.shiftKey && key === 'n') {
        next();
      } else if (e.shiftKey && key === 'p') {
        prev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, episode, toggle, seekBy, next, prev]);

  const metrics = computeTimeMetrics(durations, state.index, state.elapsed);
  const cue = findActiveCue(currentClip, state.elapsed, segment?.turns || [], state.duration || durations[state.index]);

  return {
    status: state.status,
    index: state.index,
    segment,
    isPlaying: state.status === 'playing',
    isBuffering: state.status === 'loading',
    isEnded: state.status === 'ended',
    needsGesture: state.needsGesture,
    error: state.error,
    musicSupported: typeof window !== 'undefined' && Boolean(window.AudioContext || window.webkitAudioContext),
    elapsed: state.elapsed,
    progress: metrics.chapterDuration > 0 ? metrics.chapterElapsed / metrics.chapterDuration : 0,
    clip: currentClip,
    cue,
    durations,
    metrics,
    playbackRate,
    volume,
    muted,
    seedClip,
    unlock,
    play,
    toggle,
    pause,
    resume,
    next,
    prev,
    seekTo,
    seekRatio,
    seekBy,
    selectChapter,
    stop,
    cycleRate,
    setVolume,
    toggleMute,
  };
}

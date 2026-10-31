import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GripVertical, Headphones, Loader2, Maximize2, Play, Square, X } from './icons/ThemeIcons';
import { useLanguage } from '../context/LanguageContext';
import {
  deletePodcastEpisode,
  downloadPodcastEpisode,
  fetchPodcastClip,
  fetchPodcastEpisode,
  fetchPodcastOptions,
  generatePodcastEpisode,
  listTimelinePodcasts,
  requestPodcastAudio,
} from '../api';
import { isSameArticleId } from '../utils/timelineArticles';
import { buildListenLink, defaultPodcastEngineForLanguage } from '../utils/podcastPlayback';
import { DEFAULT_MUSIC_VOLUME, normalizeMusicMood } from '../utils/podcastMusic';
import { FLOATING_Z } from '../utils/floatingFocus';
import {
  countEpisodeEventSegments,
  getCreditCosts,
  getPodcastAudioCreditCost,
  getRemainingPaidCredits,
  isPremiumCreditsExhausted,
} from '../utils/modelUtils';
import usePodcastPlayback from '../hooks/usePodcastPlayback';
import useFloatingDrag from '../hooks/useFloatingDrag';
import PodcastStudioDialog, { ALL_ENGINES } from './podcast/PodcastStudioDialog';
import PodcastPlayerBar from './podcast/PodcastPlayerBar';

const PREFS_KEY = 'chronix_podcast_prefs_v3';
const LEGACY_PREFS_KEY = 'chronix_podcast_prefs_v2';
const CHIME_KEY = 'chronix_podcast_chime';
const MUSIC_KEY = 'chronix_podcast_music';
const DEFAULT_CONFIG = { format: 'single', voiceGender: 'male', length: 'focused', engine: 'edge' };
const HEBREW_RE = /[\u0590-\u05FF]/;

function loadPrefs(lang = 'en') {
  const defaultEngine = defaultPodcastEngineForLanguage(lang);
  try {
    // Only format, voice gender, and length are remembered; voice engine always defaults to free
    // ('gcloud' for Hebrew, 'edge' otherwise) so Gemini audio always requires an explicit choice.
    const current = localStorage.getItem(PREFS_KEY);
    const saved = JSON.parse(current || localStorage.getItem(LEGACY_PREFS_KEY) || '{}');
    return {
      format: saved.format === 'duo' ? 'duo' : 'single',
      voiceGender: saved.voiceGender === 'female' ? 'female' : 'male',
      length: saved.length === 'full' ? 'full' : 'focused',
      engine: defaultEngine,
    };
  } catch {
    return { ...DEFAULT_CONFIG, engine: defaultEngine };
  }
}

function loadMusicPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(MUSIC_KEY) || '{}');
    const rawVol = Number(saved.volume);
    const hasVolume = Number.isFinite(rawVol);
    const clamped = hasVolume ? Math.min(1, Math.max(0, rawVol)) : DEFAULT_MUSIC_VOLUME;
    if (hasVolume && clamped <= 0) {
      return { enabled: false, volume: DEFAULT_MUSIC_VOLUME };
    }
    return {
      enabled: saved.enabled !== false,
      volume: clamped > 0 ? clamped : DEFAULT_MUSIC_VOLUME,
    };
  } catch {
    return { enabled: true, volume: DEFAULT_MUSIC_VOLUME };
  }
}

function timelineLanguage(timeline) {
  if (HEBREW_RE.test(`${timeline?.title || ''} ${timeline?.description || ''}`)) return 'he';
  return String(timeline?.detectedLanguage || 'en').slice(0, 2).toLowerCase() || 'en';
}

function hostNamesFor(lang) {
  return lang === 'he' ? { male: 'מיכאל', female: 'מאיה' } : { male: 'Michael', female: 'Maya' };
}

/**
 * Timeline podcast: studio (create / pick an episode) + floating player that narrates the
 * timeline chapter by chapter and moves the timeline & map along with the story.
 */
export default function TimelinePodcastPlayer({
  timeline,
  isOpen,
  onClose,
  onFocusArticle,
  onEnsureMapVisible,
  focusedArticleId,
  onPlayingChange,
  onRefreshQuota,
  quota,
  isGuest = false,
  onOpenAuth,
  onOpenSettings,
  onGetShareLink,
  isReadOnlyView = false,
  isMobile = false,
  isMinimized: isMinimizedProp,
  onMinimizedChange,
  resetKey = 0,
}) {
  const { t, isRtl, contentMode } = useLanguage();
  const timelineId = timeline?.id || null;
  const language = useMemo(() => timelineLanguage(timeline), [timeline]);

  const [episodes, setEpisodes] = useState([]);
  const [episodesLoadedFor, setEpisodesLoadedFor] = useState(null);
  const [activeEpisodeId, setActiveEpisodeId] = useState(null);
  const [engine, setEngine] = useState(() => defaultPodcastEngineForLanguage(language));
  const [viewMode, setViewMode] = useState('studio');
  const [config, setConfig] = useState(() =>
    (typeof window === 'undefined' ? { ...DEFAULT_CONFIG, engine: defaultPodcastEngineForLanguage(language) } : loadPrefs(language)));
  const [engineOptions, setEngineOptions] = useState([]);
  const [generation, setGeneration] = useState({ status: 'idle', error: null });
  const [isGenerationMinimized, setIsGenerationMinimized] = useState(false);
  const [internalMinimized, setInternalMinimized] = useState(true);
  const isMinimized = isMinimizedProp !== undefined ? isMinimizedProp : internalMinimized;
  const setIsMinimized = useCallback((valueOrUpdater) => {
    const nextVal = typeof valueOrUpdater === 'function' ? valueOrUpdater(isMinimized) : valueOrUpdater;
    setInternalMinimized(nextVal);
    onMinimizedChange?.(nextVal);
  }, [isMinimized, onMinimizedChange]);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [musicPanelOpen, setMusicPanelOpen] = useState(false);
  const [isAutoFollow, setIsAutoFollow] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [notices, setNotices] = useState([]);
  const [chimeEnabled, setChimeEnabled] = useState(() => {
    try {
      return localStorage.getItem(CHIME_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const [music, setMusic] = useState(() =>
    (typeof window === 'undefined' ? { enabled: true, volume: DEFAULT_MUSIC_VOLUME } : loadMusicPrefs()));
  const [hasCustomKey, setHasCustomKey] = useState(
    () => typeof window !== 'undefined' && Boolean(localStorage.getItem('gemini_api_key')?.trim()),
  );

  const scriptAbortRef = useRef(null);
  const pendingAutoplayRef = useRef(null);
  const pendingResumeRef = useRef(null);
  const programmaticFocusRef = useRef(false);
  const programmaticFocusTimerRef = useRef(null);
  const prevFocusedArticleIdRef = useRef(focusedArticleId);
  const autoFollowRef = useRef(isAutoFollow);
  autoFollowRef.current = isAutoFollow;

  const activeEpisode = useMemo(
    () => episodes.find((ep) => ep.id === activeEpisodeId) || null,
    [episodes, activeEpisodeId],
  );

  // The script model selects the background score per episode; legacy moods map deterministically per episode id.
  const musicMood = normalizeMusicMood(activeEpisode?.music_mood, activeEpisode?.content_mode, activeEpisode?.id);

  const articlesMap = useMemo(() => {
    const map = new Map();
    for (const a of timeline?.articles || []) {
      if (a?.id != null) map.set(String(a.id), a);
    }
    return map;
  }, [timeline?.articles]);

  // ---- Quota & cost ------------------------------------------------------------------------
  useEffect(() => {
    const sync = () => setHasCustomKey(Boolean(localStorage.getItem('gemini_api_key')?.trim()));
    window.addEventListener('focus', sync);
    window.addEventListener('storage', sync);
    window.addEventListener('chronix-api-key-change', sync);
    return () => {
      window.removeEventListener('focus', sync);
      window.removeEventListener('storage', sync);
      window.removeEventListener('chronix-api-key-change', sync);
    };
  }, []);

  const isAdmin = quota?.is_admin === true;
  const isFreeMode = quota?.mode === 'free' && !isAdmin;
  const isUnlimited = !isAdmin && !isFreeMode && quota?.daily_paid_limit === -1;
  const isPremiumLocked = !isAdmin && !hasCustomKey;
  const creditCosts = useMemo(() => getCreditCosts(quota), [quota]);
  const scriptCreditCost = creditCosts.text;
  const remainingPaidCredits = getRemainingPaidCredits(quota);
  const isZeroCreditsLeft = isPremiumCreditsExhausted(quota, {
    isAdmin,
    hasCustomKey,
    requiredCredits: 1,
  });

  const reusableEpisode = useMemo(() => {
    const normFormat = config.format === 'duo' ? 'duo' : 'single';
    const normLength = config.length === 'full' ? 'full' : 'focused';
    const effMode = contentMode || timeline?.contentMode || 'classic';
    return episodes.find((ep) => {
      if (!ep?.is_mine || ep.id === 'legacy' || !ep.segments?.length) return false;
      if ((ep.format || 'single') !== normFormat) return false;
      if ((ep.length || 'full') !== normLength) return false;
      if ((ep.content_mode || 'classic') !== effMode) return false;
      return ep.segments.every((s) => !s.event_id || articlesMap.has(String(s.event_id)));
    }) || null;
  }, [episodes, config.format, config.length, contentMode, timeline?.contentMode, articlesMap]);

  const timelineEventCount = Array.isArray(timeline?.articles) ? timeline.articles.length : null;
  const studioEventCount = useMemo(() => {
    const reusableEvents = countEpisodeEventSegments(reusableEpisode);
    if (reusableEvents !== null && timelineEventCount !== null) {
      return Math.min(reusableEvents, timelineEventCount);
    }
    return reusableEvents ?? timelineEventCount;
  }, [reusableEpisode, timelineEventCount]);

  const studioGeminiAudioCreditCost = useMemo(
    () =>
      getPodcastAudioCreditCost(quota, {
        length: config.length,
        eventCount: studioEventCount,
      }),
    [quota, config.length, studioEventCount],
  );
  const newGeminiEpisodeCredits = scriptCreditCost + studioGeminiAudioCreditCost;

  const activeEpisodeEventCount = useMemo(() => {
    const epEvents = countEpisodeEventSegments(activeEpisode);
    if (epEvents !== null && timelineEventCount !== null) {
      return Math.min(epEvents, timelineEventCount);
    }
    return epEvents ?? timelineEventCount;
  }, [activeEpisode, timelineEventCount]);

  const playerGeminiAudioCreditCost = useMemo(
    () =>
      getPodcastAudioCreditCost(quota, {
        length: activeEpisode?.length || 'full',
        eventCount: activeEpisodeEventCount,
      }),
    [quota, activeEpisode?.length, activeEpisodeEventCount],
  );

  // Reusing an already-unlocked Gemini episode costs 0 credits; unlocking Gemini on an existing
  // script costs `studioGeminiAudioCreditCost` (10 or 20); generating a brand-new episode with
  // Gemini audio costs `scriptCreditCost + studioGeminiAudioCreditCost` (11 or 21).
  const studioGeminiCreditsNeeded = reusableEpisode
    ? (reusableEpisode.audio?.gemini?.unlocked ? 0 : studioGeminiAudioCreditCost)
    : newGeminiEpisodeCredits;
  const isStudioGeminiBlockedByQuota =
    studioGeminiCreditsNeeded > 0 &&
    isPremiumCreditsExhausted(quota, {
      isAdmin,
      hasCustomKey,
      requiredCredits: studioGeminiCreditsNeeded,
    });
  const studioGeminiBlockReason = isStudioGeminiBlockedByQuota
    ? (isZeroCreditsLeft ? 'credits_exhausted' : 'insufficient_credits')
    : null;
  const isPlayerGeminiBlockedByQuota =
    !activeEpisode?.audio?.gemini?.unlocked &&
    isPremiumCreditsExhausted(quota, {
      isAdmin,
      hasCustomKey,
      requiredCredits: playerGeminiAudioCreditCost,
    });
  const playerGeminiBlockReason = isPlayerGeminiBlockedByQuota
    ? (isZeroCreditsLeft ? 'credits_exhausted' : 'insufficient_credits')
    : null;

  const studioEngines = useMemo(() => {
    const hasGemini = engineOptions.some((e) => e.id === 'gemini');
    const base = hasGemini
      ? engineOptions
      : [
          { id: 'edge', available: true },
          ...(language === 'he' ? [{ id: 'gcloud', available: true }] : []),
          { id: 'gemini', available: true },
        ];
    return base.map((e) => {
      if (e.id !== 'gemini') return e;
      if (isStudioGeminiBlockedByQuota && e.available !== false) {
        return {
          ...e,
          available: false,
          reason: studioGeminiBlockReason,
          requiredCredits: studioGeminiCreditsNeeded,
          remainingCredits: remainingPaidCredits,
          audioCredits: studioGeminiAudioCreditCost,
        };
      }
      return { ...e, audioCredits: studioGeminiAudioCreditCost };
    });
  }, [
    engineOptions,
    language,
    isStudioGeminiBlockedByQuota,
    studioGeminiBlockReason,
    studioGeminiCreditsNeeded,
    remainingPaidCredits,
    studioGeminiAudioCreditCost,
  ]);

  const playerEngines = useMemo(() => {
    const hasGemini = engineOptions.some((e) => e.id === 'gemini');
    const base = hasGemini
      ? engineOptions
      : [
          { id: 'edge', available: true },
          ...(language === 'he' ? [{ id: 'gcloud', available: true }] : []),
          { id: 'gemini', available: true },
        ];
    return base.map((e) => {
      if (e.id !== 'gemini') return e;
      if (isPlayerGeminiBlockedByQuota && e.available !== false) {
        return {
          ...e,
          available: false,
          reason: playerGeminiBlockReason,
          requiredCredits: playerGeminiAudioCreditCost,
          remainingCredits: remainingPaidCredits,
          audioCredits: playerGeminiAudioCreditCost,
        };
      }
      return { ...e, audioCredits: playerGeminiAudioCreditCost };
    });
  }, [
    engineOptions,
    language,
    isPlayerGeminiBlockedByQuota,
    playerGeminiBlockReason,
    playerGeminiAudioCreditCost,
    remainingPaidCredits,
  ]);

  // Studio voice engine defaults to free ('gcloud' for Hebrew, 'edge' for other languages); when the chosen
  // engine can't be used right now (unavailable for this language, or insufficient credits for the chosen length),
  // fall back to free.
  const effectiveConfig = useMemo(() => {
    const entry = studioEngines.find((e) => e.id === config.engine);
    const unavailable = entry ? entry.available === false : (config.engine === 'gcloud' && language !== 'he');
    const isGeminiQuotaLocked = config.engine === 'gemini' && isStudioGeminiBlockedByQuota;
    if (!unavailable && !isGeminiQuotaLocked) return config;
    const fallbackEngine = defaultPodcastEngineForLanguage(language, studioEngines);
    return { ...config, engine: fallbackEngine };
  }, [config, studioEngines, language, isStudioGeminiBlockedByQuota]);

  const costLabel = useMemo(() => {
    if (reusableEpisode) {
      const needsPremiumUnlock = effectiveConfig.engine === 'gemini' && !reusableEpisode.audio?.gemini?.unlocked;
      if (!needsPremiumUnlock) return t('podcast.costReuseFree');
      if (hasCustomKey) return t('podcast.costOwnKey');
      if (isAdmin || isUnlimited || isFreeMode) return t('podcast.costReuseFree');
      return t('podcast.costReusePremium', { credits: studioGeminiAudioCreditCost });
    }
    if (hasCustomKey) return t('podcast.costOwnKey');
    if (isAdmin || isUnlimited || isFreeMode) return t('podcast.costIncluded');
    if (effectiveConfig.engine === 'gemini') {
      return t('podcast.costTwoCredits', {
        credits: newGeminiEpisodeCredits,
        scriptCredits: scriptCreditCost,
        audioCredits: studioGeminiAudioCreditCost,
      });
    }
    return scriptCreditCost === 1
      ? t('podcast.costOneCredit')
      : t('podcast.costScriptCredits', { credits: scriptCreditCost });
  }, [
    reusableEpisode,
    hasCustomKey,
    isAdmin,
    isUnlimited,
    isFreeMode,
    effectiveConfig.engine,
    studioGeminiAudioCreditCost,
    newGeminiEpisodeCredits,
    scriptCreditCost,
    t,
  ]);

  const approxMinutes = useMemo(() => {
    const totalEvents = (timeline?.articles || []).length;
    const eventChapters = config.length === 'full'
      ? Math.min(totalEvents, 25)
      : Math.min(totalEvents, 12, Math.max(5, Math.round(totalEvents * 0.55)));
    const chapters = eventChapters + 2;
    const secondsPerChapter = config.length === 'full' ? 33 : 27;
    return Math.max(1, Math.round((chapters * secondsPerChapter) / 60));
  }, [timeline?.articles, config.length]);

  // ---- Notices ------------------------------------------------------------------------------
  const pushNotice = useCallback((notice) => {
    setNotices((prev) => [...prev.filter((n) => n.id !== notice.id), notice].slice(-3));
    if (notice.ttl) {
      setTimeout(() => setNotices((prev) => prev.filter((n) => n.id !== notice.id)), notice.ttl);
    }
  }, []);
  const dismissNotice = useCallback((id) => setNotices((prev) => prev.filter((n) => n.id !== id)), []);

  // ---- Timeline focus (auto-follow) ---------------------------------------------------------
  useEffect(() => () => {
    if (programmaticFocusTimerRef.current) clearTimeout(programmaticFocusTimerRef.current);
  }, []);

  const focusSegment = useCallback((segment) => {
    if (!segment?.event_id) return;
    const article = articlesMap.get(String(segment.event_id));
    if (!article) return;
    programmaticFocusRef.current = true;
    if (programmaticFocusTimerRef.current) clearTimeout(programmaticFocusTimerRef.current);
    onFocusArticle?.(article, { animate: true, forceCenter: true });
    programmaticFocusTimerRef.current = setTimeout(() => {
      programmaticFocusTimerRef.current = null;
      programmaticFocusRef.current = false;
    }, 900);
  }, [articlesMap, onFocusArticle]);

  const handleChapterStart = useCallback((segment) => {
    if (autoFollowRef.current) focusSegment(segment);
  }, [focusSegment]);

  const handleFallback = useCallback(() => {
    pushNotice({ id: 'fallback', tone: 'warn', text: t('podcast.fallbackNotice') });
  }, [pushNotice, t]);

  const getArtworkUrl = useCallback((segment) => {
    const article = segment?.event_id ? articlesMap.get(String(segment.event_id)) : null;
    const img = article?.imageUrl;
    if (!img || img.toLowerCase().endsWith('.svg')) return null;
    return img.startsWith('//') ? `https:${img}` : img;
  }, [articlesMap]);

  const playback = usePodcastPlayback({
    timelineId,
    episode: activeEpisode,
    engine,
    enabled: Boolean(isOpen && activeEpisode && viewMode === 'player'),
    contentMode,
    isSharedView: isReadOnlyView,
    chimeEnabled,
    musicEnabled: music.enabled,
    musicVolume: music.volume,
    musicMood,
    musicSeed: activeEpisode?.id || '',
    onChapterStart: handleChapterStart,
    onFallback: handleFallback,
    getArtworkUrl,
  });

  const wasPlayingRef = useRef(false);
  useEffect(() => {
    onPlayingChange?.(playback.isPlaying);
    if (!wasPlayingRef.current && playback.isPlaying) {
      onEnsureMapVisible?.();
    }
    wasPlayingRef.current = playback.isPlaying;
  }, [playback.isPlaying, onPlayingChange, onEnsureMapVisible]);

  // The user picked another event while listening: stop dragging the view back.
  useEffect(() => {
    const prevFocused = prevFocusedArticleIdRef.current;
    prevFocusedArticleIdRef.current = focusedArticleId;
    // Only react to user/external changes of `focusedArticleId`, never to chapter switches or loading→playing transitions.
    if (prevFocused === focusedArticleId) return;
    const eventId = playback.segment?.event_id;
    if (!playback.isPlaying || !isAutoFollow || !eventId || !focusedArticleId || programmaticFocusRef.current) return;
    if (!isSameArticleId(focusedArticleId, eventId)) setIsAutoFollow(false);
  }, [focusedArticleId, playback.isPlaying, isAutoFollow, playback.segment?.event_id]);

  // ---- Episodes -------------------------------------------------------------------------------
  const dragResetRef = useRef(null);

  const resetForTimeline = useCallback(() => {
    playback.stop();
    scriptAbortRef.current?.abort();
    setEpisodes([]);
    setEpisodesLoadedFor(null);
    setActiveEpisodeId(null);
    const defaultEng = defaultPodcastEngineForLanguage(language);
    setEngine(defaultEng);
    setConfig((prev) => (prev.engine === defaultEng ? prev : { ...prev, engine: defaultEng }));
    setViewMode('studio');
    setGeneration({ status: 'idle', error: null });
    setNotices([]);
    setTranscriptOpen(false);
    setMusicPanelOpen(false);
    setIsAutoFollow(true);
    setIsMinimized(true);
    dragResetRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setIsMinimized, language]);

  const prevTimelineSigRef = useRef(`${timelineId || ''}:${resetKey}`);
  useEffect(() => {
    const sig = `${timelineId || ''}:${resetKey}`;
    if (prevTimelineSigRef.current === sig) return;
    prevTimelineSigRef.current = sig;
    resetForTimeline();
  }, [timelineId, resetKey, resetForTimeline]);

  useEffect(() => {
    if (!isOpen || !timelineId || episodesLoadedFor === timelineId) return undefined;
    let cancelled = false;
    listTimelinePodcasts(timelineId)
      .then((list) => {
        if (cancelled) return;
        setEpisodes(list);
        setEpisodesLoadedFor(timelineId);
        if (list.length && !activeEpisodeId) {
          const preferred = list.find((ep) => ep.is_mine) || list[0];
          setActiveEpisodeId(preferred.id);
          setEngine(ALL_ENGINES.includes(preferred.default_engine) ? preferred.default_engine : 'edge');
          setViewMode('player');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setEpisodesLoadedFor(timelineId);
        pushNotice({ id: 'episodes', tone: 'error', text: t('podcast.loadEpisodesFailed'), ttl: 6000 });
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, timelineId, episodesLoadedFor, activeEpisodeId, pushNotice, t]);

  const optionsLang = viewMode === 'player' && activeEpisode ? String(activeEpisode.detected_language || language).slice(0, 2) : language;
  const optionsFormat = viewMode === 'player' && activeEpisode ? activeEpisode.format : config.format;
  const optionsGender = viewMode === 'player' && activeEpisode ? activeEpisode.voice_gender : config.voiceGender;
  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    fetchPodcastOptions(optionsLang, optionsFormat, optionsGender)
      .then((res) => {
        if (!cancelled) setEngineOptions(res.engines || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen, optionsLang, optionsFormat, optionsGender]);

  const defaultFreeEngine = useMemo(
    () => defaultPodcastEngineForLanguage(language, studioEngines),
    [language, studioEngines],
  );

  const resetStudioEngineToFree = useCallback(() => {
    setConfig((prev) => (prev.engine === defaultFreeEngine ? prev : { ...prev, engine: defaultFreeEngine }));
  }, [defaultFreeEngine]);

  useEffect(() => {
    if (!isOpen) resetStudioEngineToFree();
  }, [isOpen, resetStudioEngineToFree]);

  // Keep the studio default engine aligned with the timeline's language when switching between Hebrew and non-Hebrew timelines.
  const prevLangRef = useRef(language);
  useEffect(() => {
    if (prevLangRef.current === language) return;
    prevLangRef.current = language;
    setConfig((prev) => (prev.engine === 'gemini' ? prev : { ...prev, engine: defaultFreeEngine }));
  }, [language, defaultFreeEngine]);

  // If the user switches to a length whose Gemini credit cost exceeds their remaining credits,
  // reset the studio engine to free so Gemini is never silently re-selected later.
  useEffect(() => {
    if (config.engine === 'gemini' && isStudioGeminiBlockedByQuota) {
      setConfig((prev) => (prev.engine === 'gemini' ? { ...prev, engine: defaultFreeEngine } : prev));
    }
  }, [config.engine, isStudioGeminiBlockedByQuota, defaultFreeEngine]);

  const updateConfig = useCallback((partial) => {
    setConfig((prev) => {
      const safePartial =
        partial?.engine === 'gemini' && isStudioGeminiBlockedByQuota
          ? { ...partial, engine: defaultFreeEngine }
          : partial;
      const next = { ...prev, ...safePartial };
      try {
        const { engine: _omitEngine, ...prefsToPersist } = next;
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefsToPersist));
      } catch {
        // storage unavailable
      }
      return next;
    });
  }, [isStudioGeminiBlockedByQuota, defaultFreeEngine]);

  const replaceEpisode = useCallback((updated) => {
    setEpisodes((prev) => [updated, ...prev.filter((ep) => ep.id !== updated.id)]
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
  }, []);

  // Poll episode metadata while Gemini chapters finish rendering in the background so audio cost updates live.
  useEffect(() => {
    if (!isOpen || !timelineId || !activeEpisode || activeEpisode.id === 'legacy') return undefined;
    if (activeEpisode.audio?.gemini?.status !== 'rendering') return undefined;
    let cancelled = false;
    let inFlight = false;
    let polls = 0;
    let timer = null;
    const syncEpisode = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const fresh = await fetchPodcastEpisode(timelineId, activeEpisode.id);
        if (cancelled || !fresh?.id) return;
        replaceEpisode(fresh);
        if (fresh.audio?.gemini?.status !== 'rendering' && timer) {
          clearInterval(timer);
          timer = null;
        }
      } catch {
        // ignore transient polling failure
      } finally {
        inFlight = false;
      }
    };
    timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      polls += 1;
      if (polls > 180) {
        clearInterval(timer);
        timer = null;
        return;
      }
      syncEpisode();
    }, 3500);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') syncEpisode();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isOpen, timelineId, activeEpisode?.id, activeEpisode?.audio?.gemini?.status, replaceEpisode]);

  // Start playback once the hook has switched to the newly selected episode.
  useEffect(() => {
    if (!activeEpisode || pendingAutoplayRef.current !== activeEpisode.id) return;
    pendingAutoplayRef.current = null;
    playback.play(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEpisode?.id]);

  useEffect(() => {
    if (pendingResumeRef.current == null) return;
    const idx = pendingResumeRef.current;
    pendingResumeRef.current = null;
    playback.play(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, activeEpisode?.voice_gender]);

  useEffect(() => {
    if (playback.status !== 'error') return;
    pushNotice({
      id: 'audio-error',
      tone: 'error',
      text: t('podcast.audioError'),
      action: { label: t('podcast.retry'), onClick: () => { dismissNotice('audio-error'); playback.play(playback.index); } },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback.status]);

  const handleListen = async () => {
    if (!timeline?.articles?.length || generation.status === 'script' || generation.status === 'audio') return;
    playback.stop();
    scriptAbortRef.current?.abort();
    const controller = new AbortController();
    scriptAbortRef.current = controller;
    setNotices([]);
    if (reusableEpisode) {
      setGeneration({ status: 'audio', error: null });
      try {
        let targetEngine = effectiveConfig.engine || defaultFreeEngine;
        let updated;
        try {
          updated = await requestPodcastAudio(timeline.id, reusableEpisode.id, targetEngine, effectiveConfig.voiceGender);
        } catch (err) {
          if (err?.status === 402 && targetEngine === 'gemini') {
            targetEngine = defaultFreeEngine;
            onRefreshQuota?.();
            pushNotice({ id: 'premium-fallback', tone: 'warn', text: t('podcast.noticeCreditsExhaustedFallback') });
            updated = await requestPodcastAudio(timeline.id, reusableEpisode.id, targetEngine, effectiveConfig.voiceGender);
          } else {
            throw err;
          }
        }
        replaceEpisode(updated);
        setEngine(targetEngine);
        setActiveEpisodeId(updated.id);
        onRefreshQuota?.();
        const firstClip = await fetchPodcastClip(
          timeline.id, updated.id, updated.segments[0].id, targetEngine, controller.signal, updated.voice_gender,
        );
        if (firstClip.fallback_from) handleFallback();
        if (targetEngine === 'gemini' && Number(firstClip?.cost_usd) > 0 && !(updated.audio?.gemini?.cost_usd > 0)) {
          replaceEpisode({
            ...updated,
            audio: {
              ...(updated.audio || {}),
              gemini: {
                ...(updated.audio?.gemini || {}),
                cost_usd: Number(firstClip.cost_usd),
                rendered_clips: Math.max(1, Number(updated.audio?.gemini?.rendered_clips || 0)),
              },
            },
          });
        }
        playback.seedClip(updated.id, targetEngine, updated.segments[0].id, firstClip, updated.voice_gender);
        onEnsureMapVisible?.();
        setIsAutoFollow(true);
        resetStudioEngineToFree();
        setGeneration({ status: 'idle', error: null });
        setIsGenerationMinimized(false);
        setViewMode('player');
        setIsMinimized(true);
        if (updated.id === activeEpisodeId) pendingResumeRef.current = 0;
        else pendingAutoplayRef.current = updated.id;
      } catch (err) {
        if (err?.name === 'AbortError') {
          resetStudioEngineToFree();
          setGeneration({ status: 'idle', error: null });
          return;
        }
        setIsGenerationMinimized(false);
        setGeneration({ status: 'idle', error: err?.message || t('podcast.audioError') });
      }
      return;
    }
    setGeneration({ status: 'script', error: null });
    try {
      const res = await generatePodcastEpisode(timeline, effectiveConfig, controller.signal, null, contentMode);
      const rawEp = res?.episode;
      if (!rawEp?.segments?.length) throw new Error(t('podcast.audioError'));
      const ep = res?.tokenUsage && !rawEp.tokenUsage
        ? { ...rawEp, tokenUsage: res.tokenUsage, script_cost_usd: rawEp.script_cost_usd ?? res.tokenUsage?.estimatedCostUsd }
        : rawEp;
      const epEngine = ep.default_engine || 'edge';
      replaceEpisode(ep);
      setEngine(epEngine);
      setActiveEpisodeId(ep.id);
      if (res.notice === 'premium_quota_exhausted') {
        pushNotice({ id: 'premium-fallback', tone: 'warn', text: t('podcast.noticeCreditsExhaustedFallback') });
      } else if (res.notice === 'gemini_requires_custom_key') {
        pushNotice({ id: 'premium-fallback', tone: 'warn', text: t('podcast.noticePremiumFallback') });
      }
      onRefreshQuota?.();
      setGeneration({ status: 'audio', error: null });
      const firstClip = await fetchPodcastClip(
        timeline.id, ep.id, ep.segments[0].id, epEngine, controller.signal, ep.voice_gender,
      );
      if (firstClip.fallback_from) handleFallback();
      if (epEngine === 'gemini' && Number(firstClip?.cost_usd) > 0 && !(ep.audio?.gemini?.cost_usd > 0)) {
        replaceEpisode({
          ...ep,
          audio: {
            ...(ep.audio || {}),
            gemini: {
              ...(ep.audio?.gemini || {}),
              cost_usd: Number(firstClip.cost_usd),
              rendered_clips: Math.max(1, Number(ep.audio?.gemini?.rendered_clips || 0)),
            },
          },
        });
      }
      playback.seedClip(ep.id, epEngine, ep.segments[0].id, firstClip, ep.voice_gender);
      onEnsureMapVisible?.();
      setIsAutoFollow(true);
      resetStudioEngineToFree();
      setGeneration({ status: 'idle', error: null });
      setIsGenerationMinimized(false);
      setViewMode('player');
      setIsMinimized(true);
    } catch (err) {
      if (err?.name === 'AbortError') {
        resetStudioEngineToFree();
        setGeneration({ status: 'idle', error: null });
        return;
      }
      setIsGenerationMinimized(false);
      setGeneration({ status: 'idle', error: err?.message || t('podcast.audioError') });
    }
  };

  const handleStopGeneration = () => {
    scriptAbortRef.current?.abort();
    scriptAbortRef.current = null;
    pendingAutoplayRef.current = null;
    playback.stop();
    resetStudioEngineToFree();
    setGeneration({ status: 'idle', error: null });
    setIsGenerationMinimized(false);
  };

  const handlePlayEpisode = (ep) => {
    playback.unlock();
    onEnsureMapVisible?.();
    setViewMode('player');
    setIsAutoFollow(true);
    setIsMinimized(true);
    if (ep.id === activeEpisodeId) {
      playback.play(0);
      return;
    }
    setEngine(ep.default_engine || 'edge');
    pendingAutoplayRef.current = ep.id;
    setActiveEpisodeId(ep.id);
  };

  const handleDeleteEpisode = async (ep) => {
    if (!window.confirm(t('podcast.deleteConfirm'))) return;
    try {
      await deletePodcastEpisode(timelineId, ep.id);
      setEpisodes((prev) => prev.filter((e) => e.id !== ep.id));
      if (ep.id === activeEpisodeId) {
        playback.stop();
        setActiveEpisodeId(null);
      }
    } catch (err) {
      pushNotice({ id: 'delete', tone: 'error', text: err?.message || t('podcast.audioError'), ttl: 6000 });
    }
  };

  const switchEngine = async (id) => {
    const ep = activeEpisode;
    if (!ep) return;
    dismissNotice('confirm-premium');
    const resumeIndex = playback.isPlaying || playback.isBuffering ? playback.index : null;
    try {
      const updated = await requestPodcastAudio(timelineId, ep.id, id, ep.voice_gender);
      replaceEpisode(updated);
      if (id === 'gemini' && !ep.audio?.gemini?.unlocked) onRefreshQuota?.();
      pendingResumeRef.current = resumeIndex;
      setEngine(id);
    } catch (err) {
      if (err?.status === 402) {
        const lockedMsg =
          remainingPaidCredits && remainingPaidCredits > 0
            ? t('podcast.engineInsufficientCredits', {
                credits: playerGeminiAudioCreditCost,
                remaining: remainingPaidCredits,
              })
            : t('podcast.engineCreditsExhausted');
        pushNotice({ id: 'premium-locked', tone: 'warn', text: lockedMsg, ttl: 6000 });
        onRefreshQuota?.();
      } else {
        pushNotice({ id: 'engine', tone: 'error', text: err?.message || t('podcast.audioError'), ttl: 6000 });
      }
    }
  };

  const handleSwitchEngine = (id) => {
    if (!activeEpisode || id === engine) return;
    playback.unlock();
    const needsUnlock = id === 'gemini' && !activeEpisode.audio?.gemini?.unlocked;
    if (needsUnlock) {
      if (isPlayerGeminiBlockedByQuota) {
        const lockedMsg =
          remainingPaidCredits && remainingPaidCredits > 0
            ? t('podcast.engineInsufficientCredits', {
                credits: playerGeminiAudioCreditCost,
                remaining: remainingPaidCredits,
              })
            : t('podcast.engineCreditsExhausted');
        pushNotice({ id: 'premium-locked', tone: 'warn', text: lockedMsg, ttl: 6000 });
        return;
      }
      const confirmText = isPremiumLocked
        ? t('podcast.unlockPremiumCreditConfirm', { credits: playerGeminiAudioCreditCost })
        : t('podcast.unlockPremiumConfirm');
      pushNotice({
        id: 'confirm-premium',
        tone: 'info',
        text: confirmText,
        action: { label: t('podcast.engineGemini'), onClick: () => switchEngine(id) },
      });
      return;
    }
    switchEngine(id);
  };

  const handleSwitchGender = async (newGender) => {
    const ep = activeEpisode;
    const targetGender = newGender === 'female' ? 'female' : 'male';
    if (!ep || (ep.voice_gender || 'male') === targetGender) return;
    playback.unlock();
    const resumeIndex = playback.isPlaying || playback.isBuffering ? playback.index : null;
    try {
      const updated = await requestPodcastAudio(timelineId, ep.id, engine, targetGender);
      updateConfig({ voiceGender: targetGender });
      pendingResumeRef.current = resumeIndex;
      replaceEpisode(updated);
    } catch (err) {
      pushNotice({ id: 'gender', tone: 'error', text: err?.message || t('podcast.audioError'), ttl: 6000 });
    }
  };

  const saveBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  // With music on, the episode is mixed in the browser with the same synth the player uses.
  const downloadWithMusic = async (ep) => {
    const mixdown = await import('../utils/podcastMixdown');
    if (!mixdown.supportsMusicMixdown()) throw new Error('unsupported');
    let shown = -1;
    const onProgress = (fraction) => {
      const percent = Math.floor(fraction * 100);
      if (percent === shown) return;
      shown = percent;
      pushNotice({ id: 'download', tone: 'info', text: t('podcast.mixingDownload', { percent }) });
    };
    onProgress(0);
    const segs = ep.segments || [];
    const blob = await mixdown.mixdownEpisodeWithMusic({
      chapterCount: segs.length,
      loadClip: async (i) => {
        const clip = await fetchPodcastClip(timelineId, ep.id, segs[i].id, engine, null, ep.voice_gender);
        const res = await fetch(clip.src);
        if (!res.ok) throw new Error(`clip ${res.status}`);
        return res.arrayBuffer();
      },
      mood: musicMood,
      seed: ep.id,
      musicVolume: music.volume,
      title: ep.title || timeline?.title,
      artist: [ep.host1_name, ep.host2_name].filter(Boolean).join(' & ') || 'ChroniX',
      onProgress,
    });
    saveBlob(blob, mixdown.downloadFilename(ep.title || timeline?.title));
  };

  const handleDownload = async () => {
    if (!activeEpisode || isDownloading) return;
    setIsDownloading(true);
    try {
      if (music.enabled) {
        try {
          await downloadWithMusic(activeEpisode);
          dismissNotice('download');
          return;
        } catch (err) {
          if (err?.status === 402 || err?.status === 429) throw err;
          pushNotice({ id: 'download', tone: 'warn', text: t('podcast.musicMixFailed'), ttl: 6000 });
        }
      }
      const { blob, filename } = await downloadPodcastEpisode(timelineId, activeEpisode.id, engine, activeEpisode.voice_gender);
      saveBlob(blob, filename);
    } catch {
      pushNotice({ id: 'download', tone: 'error', text: t('podcast.downloadFailed'), ttl: 6000 });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleShare = async () => {
    try {
      const base = onGetShareLink ? await onGetShareLink() : `${window.location.origin}/t/${encodeURIComponent(timelineId)}`;
      const link = buildListenLink(base);
      if (isMobile && navigator.share) {
        await navigator.share({ title: activeEpisode?.title || timeline?.title, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      pushNotice({ id: 'share', tone: 'success', text: t('podcast.linkCopied'), ttl: 3000 });
    } catch (err) {
      if (err?.name === 'AbortError') return;
      pushNotice({ id: 'share', tone: 'error', text: t('podcast.shareFailed'), ttl: 5000 });
    }
  };

  const handleToggleChime = () => {
    setChimeEnabled((on) => {
      try {
        localStorage.setItem(CHIME_KEY, on ? 'off' : 'on');
      } catch {
        // storage unavailable
      }
      return !on;
    });
  };

  const updateMusic = useCallback((change) => {
    setMusic((prev) => {
      const next = typeof change === 'function' ? change(prev) : { ...prev, ...change };
      try {
        localStorage.setItem(MUSIC_KEY, JSON.stringify(next));
      } catch {
        // storage unavailable
      }
      return next;
    });
  }, []);

  const handleToggleMusicPanel = useCallback(() => setMusicPanelOpen((v) => !v), []);

  const handleToggleMusic = () => {
    playback.unlock();
    updateMusic((prev) => ({
      enabled: !prev.enabled,
      volume: prev.volume > 0 ? prev.volume : DEFAULT_MUSIC_VOLUME,
    }));
  };

  const handleMusicVolume = (value) => {
    const raw = Math.min(1, Math.max(0, Number(value) || 0));
    if (raw <= 0) {
      updateMusic((prev) => ({
        enabled: false,
        volume: prev.volume > 0 ? prev.volume : DEFAULT_MUSIC_VOLUME,
      }));
      return;
    }
    playback.unlock();
    updateMusic({ enabled: true, volume: raw });
  };

  const handleToggleAutoFollow = () => {
    if (isAutoFollow) {
      setIsAutoFollow(false);
      return;
    }
    setIsAutoFollow(true);
    focusSegment(playback.segment);
  };

  const handleClose = () => {
    playback.stop();
    onClose?.();
  };

  const getSpeakerName = useCallback((speaker) => {
    const names = hostNamesFor(String(activeEpisode?.detected_language || language).slice(0, 2));
    const lead = activeEpisode?.voice_gender === 'female' ? 'female' : 'male';
    if (speaker === 'host2') return activeEpisode?.host2_name || names[lead === 'male' ? 'female' : 'male'];
    return activeEpisode?.host1_name || names[lead];
  }, [activeEpisode, language]);

  // ---- Layout -------------------------------------------------------------------------------
  const isGenerating = generation.status === 'script' || generation.status === 'audio';
  const showPill = isOpen && isGenerating && isGenerationMinimized;
  const showStarterPill = isOpen && !isGenerating && !activeEpisode && isMinimized;
  const showStudio = isOpen && !showPill && !isMinimized && (viewMode === 'studio' || !activeEpisode || isGenerating);
  const showPlayer = isOpen && !showStudio && !showPill && !showStarterPill && Boolean(activeEpisode);
  const drag = useFloatingDrag({
    enabled: showPlayer || showPill || showStarterPill,
    touch: isMobile,
    remeasureKey: `${isMinimized}-${transcriptOpen}-${musicPanelOpen}-${showPlayer}-${showPill}-${showStarterPill}-${notices.length}`,
  });
  dragResetRef.current = drag.reset;
  const containerStyle = {
    zIndex: isMobile ? FLOATING_Z.PODCAST_MOBILE : FLOATING_Z.ALWAYS_ON_TOP + 10,
    bottom: isMobile ? 'calc(58px + env(safe-area-inset-bottom, 0px) + 8px)' : '16px',
    transform: `translate3d(${drag.offset.x}px, ${drag.offset.y}px, 0)`,
  };
  const activeArticle = playback.segment?.event_id ? articlesMap.get(String(playback.segment.event_id)) : null;

  return (
    <>
      {showStudio && (
        <PodcastStudioDialog
          t={t}
          isRtl={isRtl}
          episodes={episodes}
          activeEpisodeId={activeEpisodeId}
          onPlayEpisode={handlePlayEpisode}
          onDeleteEpisode={handleDeleteEpisode}
          config={effectiveConfig}
          onConfigChange={updateConfig}
          engines={studioEngines}
          language={language}
          hostNames={hostNamesFor(language)}
          costLabel={costLabel}
          approxMinutes={approxMinutes}
          generation={generation}
          onListen={handleListen}
          onStop={handleStopGeneration}
          onMinimize={() => {
            if (isGenerating) {
              setIsGenerationMinimized(true);
            } else {
              setIsMinimized(true);
              if (activeEpisode) {
                setViewMode('player');
              }
            }
          }}
          onClose={() => {
            if (activeEpisode) {
              setViewMode('player');
            } else {
              handleClose();
            }
          }}
          quotaBanner={{
            show: false,
            isGuest,
            onOpenAuth: onOpenAuth ? () => { handleClose(); onOpenAuth(); } : null,
            onOpenSettings: onOpenSettings || (() => window.dispatchEvent(new Event('chronix-open-settings'))),
          }}
        />
      )}

      {showStarterPill && (
        <div
          ref={drag.containerRef}
          style={containerStyle}
          dir={isRtl ? 'rtl' : 'ltr'}
          className="fixed inset-x-0 mx-auto w-[calc(100vw-16px)] sm:w-fit max-w-[calc(100vw-16px)] sm:max-w-xl pointer-events-none flex flex-col items-center gap-2 select-none"
        >
          {notices.length > 0 && (
            <div className="flex flex-col items-center gap-1.5 pointer-events-auto" aria-live="polite">
              {notices.map((n) => (
                <div
                  key={n.id}
                  role={n.tone === 'error' ? 'alert' : 'status'}
                  className={`px-3.5 py-1.5 rounded-full bg-surface-raised/95 border text-[11px] font-medium shadow-card flex items-center gap-2 ${
                    n.tone === 'error' ? 'border-danger/40 text-danger' : n.tone === 'success' ? 'border-emerald-500/40 text-emerald-500' : 'border-amber-500/40 text-amber-500'
                  }`}
                >
                  <span>{n.text}</span>
                  <button
                    type="button"
                    onClick={() => dismissNotice(n.id)}
                    className="ms-1 hover:text-ink cursor-pointer"
                    aria-label={t('common.close')}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div
            {...drag.dragHandlers}
            className={`pointer-events-auto flex items-center justify-between sm:justify-start gap-1 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full bg-surface-raised/95 backdrop-blur-2xl border border-line shadow-pop transition-shadow w-full sm:w-auto max-w-full overflow-hidden touch-none ${
              drag.isDragging ? 'cursor-grabbing ring-2 ring-accent/40 shadow-xl' : 'cursor-grab'
            }`}
          >
            <span className="hidden sm:flex text-ink-subtle items-center shrink-0" title={t('podcast.dragHint')}>
              <GripVertical className="w-4 h-4" />
            </span>

            <div className="w-8 h-8 rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0">
              <Headphones className="w-4 h-4" />
            </div>

            <button
              type="button"
              onClick={() => {
                resetStudioEngineToFree();
                setViewMode('studio');
                setIsMinimized(false);
              }}
              className="flex flex-col text-start px-2 border-x border-line/70 min-w-0 flex-1 sm:max-w-[240px] cursor-pointer hover:opacity-90 transition-opacity"
              title={t('podcast.expandPlayer')}
            >
              <div className="flex items-center gap-1.5 truncate">
                <span className="text-[11px] font-bold text-ink truncate">
                  {t('podcast.starterTitle')}
                </span>
              </div>
              <div className="text-[10px] text-ink-muted truncate">
                {t('podcast.starterSubtitle', { minutes: approxMinutes })}
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                resetStudioEngineToFree();
                setViewMode('studio');
                setIsMinimized(false);
              }}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-bold shadow-xs cursor-pointer transition-transform active:scale-95 shrink-0"
              title={t('podcast.listenNow')}
            >
              <Play className="w-3 h-3 fill-current ms-0.5" />
              <span className="hidden sm:inline">{t('podcast.starterListen')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                resetStudioEngineToFree();
                setViewMode('studio');
                setIsMinimized(false);
              }}
              className="p-1.5 rounded-lg text-ink-subtle hover:text-accent hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
              title={t('podcast.expandPlayer')}
              aria-label={t('podcast.expandPlayer')}
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 rounded-lg text-ink-subtle hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer shrink-0"
              title={t('podcast.close')}
              aria-label={t('podcast.close')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {showPill && (
        <div
          ref={drag.containerRef}
          style={containerStyle}
          dir={isRtl ? 'rtl' : 'ltr'}
          className="fixed inset-x-0 mx-auto w-[calc(100vw-16px)] sm:w-fit max-w-[calc(100vw-16px)] sm:max-w-xl pointer-events-none flex flex-col items-center select-none"
        >
          <div
            {...drag.dragHandlers}
            className={`pointer-events-auto flex items-center justify-between sm:justify-start gap-2 px-3 py-2 rounded-full bg-surface-raised/95 backdrop-blur-2xl border border-accent/40 shadow-pop w-full sm:w-auto max-w-full overflow-hidden touch-none ${
              drag.isDragging ? 'cursor-grabbing ring-2 ring-accent/40' : 'cursor-grab'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Loader2 className="w-4 h-4 text-accent animate-spin shrink-0" />
              <span className="text-xs font-bold text-ink truncate" aria-live="polite">
                {generation.status === 'audio' ? t('podcast.stepAudio') : t('podcast.stepScript')}
              </span>
            </div>
            <button
              type="button"
              onClick={handleStopGeneration}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-danger/15 hover:bg-danger/25 border border-danger/40 text-danger text-[11px] font-bold cursor-pointer"
            >
              <Square className="w-3 h-3 fill-current" />
              {t('podcast.stop')}
            </button>
            <button
              type="button"
              onClick={() => setIsGenerationMinimized(false)}
              className="p-1.5 rounded-full text-ink-subtle hover:text-accent hover:bg-surface-hover cursor-pointer"
              title={t('podcast.expand')}
              aria-label={t('podcast.expand')}
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {showPlayer && (
        <PodcastPlayerBar
          t={t}
          isRtl={isRtl}
          isMobile={isMobile}
          episode={activeEpisode}
          playback={playback}
          engine={engine}
          engines={playerEngines}
          onSwitchEngine={handleSwitchEngine}
          voiceGender={activeEpisode.voice_gender || 'male'}
          hostNames={hostNamesFor(optionsLang)}
          onSwitchGender={handleSwitchGender}
          isAutoFollow={isAutoFollow}
          onToggleAutoFollow={handleToggleAutoFollow}
          activeArticle={activeArticle}
          articlesMap={articlesMap}
          getSpeakerName={getSpeakerName}
          isMinimized={isMinimized}
          onMinimize={() => setIsMinimized(true)}
          onExpand={() => setIsMinimized(false)}
          transcriptOpen={transcriptOpen}
          onToggleTranscript={() => setTranscriptOpen((v) => !v)}
          onOpenStudio={() => {
            resetStudioEngineToFree();
            setViewMode('studio');
            setIsMinimized(false);
          }}
          onClose={handleClose}
          onDownload={handleDownload}
          isDownloading={isDownloading}
          onShare={handleShare}
          notices={notices}
          onDismissNotice={dismissNotice}
          chimeEnabled={chimeEnabled}
          onToggleChime={handleToggleChime}
          music={{
            supported: playback.musicSupported,
            enabled: music.enabled,
            volume: music.volume,
            onToggle: handleToggleMusic,
            onVolume: handleMusicVolume,
            panelOpen: musicPanelOpen,
            onTogglePanel: handleToggleMusicPanel,
          }}
          drag={drag}
        />
      )}
    </>
  );
}

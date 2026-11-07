import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, Suspense, lazy } from 'react';
import { fireConfetti } from './utils/confetti';
import Toolbar from './components/Toolbar';
import { ACTIVE_TILE_PROVIDER, clearSavedMapViews } from './utils/mapConfig';
import { clearHoveredArticleId } from './utils/hoverSync';
import { clampEventDrawerWidth } from './utils/drawerLayout';
import ErrorBoundary from './components/ErrorBoundary';
import LazyMount from './components/LazyMount';
import HomeLibrarySection from './components/HomeLibrarySection';
import TimelineLayerBar from './components/TimelineLayerBar';
import UnknownSubjectNotice from './components/UnknownSubjectNotice';
import LeftDockMenu from './components/LeftDockMenu';
import ChatTeaser from './components/ChatTeaser';
import { getChatSuggestions } from './utils/chatSuggestions';
import { buildGuideSteps, buildHomeGuideSteps, closeHomeMenu } from './data/interactiveGuideSteps';
import {
  isInteractiveGuideEnabled,
  isHomeGuideEnabled,
  isTimelineGuideEnabled,
  isStoryStudioEnabled,
} from './utils/featureFlags';
import PublicPageShell from './components/public/PublicPageShell';
import FeatureShowcase from './components/public/FeatureShowcase';
import PublicFooter from './components/public/PublicFooter';
import { useAuth, waitForGuestClaim } from './context/AuthContext';
import { useLanguage } from './context/LanguageContext';
import ChroniXLogo from './components/ChroniXLogo';
import PromptBar from './components/PromptBar';
import PromptExamples from './components/PromptExamples';
import TriviaTicker from './components/TriviaTicker';
import AiQueueNotice from './components/AiQueueNotice';
import FloatingMapWidget from './components/FloatingMapWidget';
import AmbientAuraBackground from './components/AmbientAuraBackground';
import { useFloatingFocus, FLOATING_Z } from './utils/floatingFocus';
import { DEFAULT_LANE_COLORS, getDistinctCategories, getCategoryColor } from './data/laneColors';
import { GROUNDING_STORAGE_KEY, isDefaultGroundingEnabled } from './utils/groundingConfig';
import { classifyAttachmentFile } from './utils/fileUploadValidation';
import { snapshotImageFields } from './utils/photoTray';
import { eventsForEnrichment, applyEnrichment, dismissContextLink, worldEventsSubject, worldEventsPrompt, linksOfKind } from './utils/personalEnrichment';
import TimelineLearnMore from './components/TimelineLearnMore';
import {
  isSameArticleId,
  normalizeAdditionalImages,
} from './utils/timelineArticles';
import { computeSplitRatioFromClientY, createFrameThrottle, getTimelinePaneHeight } from './utils/splitPane';

const TimelineView = lazy(() => import('./components/TimelineView'));
const EventDrawer = lazy(() => import('./components/EventDrawer'));
const CardsListDrawer = lazy(() => import('./components/CardsListDrawer'));
const TimelineEditPanel = lazy(() => import('./components/TimelineEditPanel'));
const TimelineCardFeed = lazy(() => import('./components/timeline/TimelineCardFeed'));
const TimelineOverviewPanel = lazy(() => import('./components/TimelineOverviewPanel'));
const GeoMapView = lazy(() => import('./components/GeoMapView'));
const AiRefineModal = lazy(() => import('./components/AiRefineModal'));
const SavedTimelinesModal = lazy(() => import('./components/SavedTimelinesModal'));
const ExploreLibraryModal = lazy(() => import('./components/ExploreLibraryModal'));
const AdminPanel = lazy(() => import('./components/AdminPanel'));
const StoryStudio = lazy(() => import('./components/storyStudio/StoryStudio'));
const StoryReadyCard = lazy(() => import('./components/storyStudio/StoryReadyCard'));
const SettingsModal = lazy(() => import('./components/SettingsModal'));
const AiDisclaimerModal = lazy(() => import('./components/AiDisclaimerModal'));
const PromptGuideModal = lazy(() => import('./components/PromptGuideModal'));
const AboutModal = lazy(() => import('./components/AboutModal'));
const TimelineQuizPanel = lazy(() => import('./components/TimelineQuizPanel'));
const TimelinePodcastPlayer = lazy(() => import('./components/TimelinePodcastPlayer'));
const TimelineChatPanel = lazy(() => import('./components/TimelineChatPanel'));
const InteractiveGuide = lazy(() => import('./components/InteractiveGuide'));
const AuthModal = lazy(() => import('./components/AuthModal'));
const FeaturesView = lazy(() => import('./components/public/FeaturesView'));
const PrivacyView = lazy(() => import('./components/public/PrivacyView'));
const TermsView = lazy(() => import('./components/public/TermsView'));
const OpenSourceView = lazy(() => import('./components/public/OpenSourceView'));
const CommunitySupportModal = lazy(() => import('./components/CommunitySupportModal'));

// Quota-change notifications arrive in bursts; refetch at most once per window (P-08).
const QUOTA_NOTIFY_COALESCE_MS = 2000;
// Placeholder article for the "add event" form (event drawer opened in edit mode with an empty draft).
const NEW_EVENT_DRAFT = Object.freeze({ id: '__new-event__', title: '' });
import { compareArticlesByStart } from './utils/dateTime';
import { createCoalescer } from './utils/requestCoalescing';
import { stripTransientTimelineFields } from './utils/timelineExport';
import {
  mergeTimelines,
  extractSourceTimelines,
  applyHiddenLayersToTimeline,
  MAX_MERGED_SOURCES,
} from './utils/mergeTimelines';
import { FolderOpen, AlertTriangle, Loader2, Map, MapPin, Maximize2, Minimize2, X, Columns2, BookUser, Lightbulb, Plus, ShieldCheck, Eye, ChevronDown, ChevronLeft, ChevronRight, Clock, Scan, RectangleVertical, RectangleHorizontal, Rows3, ArrowUpRight, MessageSquare, Home, BookOpen, LayoutList, Puzzle, Calendar, Compass, Layers, Pencil } from './components/icons/ThemeIcons';
import {
  GameTriviaIcon,
  GamePuzzleIcon,
  GameTimeGuesserIcon,
  GameMemoryIcon,
  GameWordleIcon,
  GameSequenceIcon,
  GameWhoAmIIcon,
} from './components/icons/GameIcons';
import {
  EMPTY_PANEL_HISTORY,
  getCurrentPanel,
  getPreviousPanel,
  getNextPanel,
  pushPanel,
  openPanelSection,
  goBackPanel,
  goForwardPanel,
  canGoBack,
  removePanelEntries,
  replaceCurrentPanel,
} from './utils/panelHistory';
import useSystemBackNavigation from './hooks/useSystemBackNavigation';
import useIsMobileViewport from './hooks/useIsMobileViewport';
import { publishQuota } from './hooks/useAiMode';
import { BasicModeNotice, BasicModeHint } from './components/BasicModeIndicators';

import {
  generateTimeline,
  enrichPersonalTimeline,
  notifyQuotaChanged,
  generateTimelineFromFiles,
  generateTimelineFromPromptFiles,
  refineTimeline,
  chatWithTimeline,
  chatAttachFilesToTimeline,
  fetchTimeline,
  fetchSharedTimeline,
  saveTimeline,
  deleteTimeline,
  markTimelineDeleted,
  TIMELINES_UPDATED_EVENT,
  fetchTimelineChat,
  saveTimelineChat,
  setTimelineShareEnabled,
  getApiKey,
  fetchUserQuota,
  QUOTA_REFRESH_EVENT,
  getActiveAiJob,
  setActiveAiJob,
  clearActiveAiJob,
  cancelAiJob,
  pollAiJob,
  noteTimelineServerState,
  TIMELINE_SAVE_SYNC_EVENT,
  TIMELINE_META_CHANGE_EVENT,
} from './api';
import { applyAiResultToLatest, applyEditToLatest, mergeTimelineThreeWay } from './utils/timelineMerge';
import { isEmptyTimelineError } from './utils/saveQueue';
import { createDebouncedTimelineSaver, videosChanged } from './utils/videoPersistence';
import { createPartialPreviewTracker, isPartialTimeline } from './utils/partialTimeline';
import { wouldLeaveTimelineEmpty } from './utils/timelineEditing';
import { clampPromptText, savedTimelineFromCancel } from './utils/aiJobPolling';
import { createChatUndoEntry, restoreSnapshotMedia, undoableChatMessageId } from './utils/chatUndo';
import { resolveMergedLayerId, resolveMergedSaveId } from './utils/mergedTimelineId';

// Clearance to keep the Event Detail Drawer above the bottom of the browser window (0 = all the way down).
const EVENT_DRAWER_BOTTOM_CLEARANCE = 0;

const LEFT_DOCK_WIDTH = 52;
// Height of the manual-authorship note under a hand-built timeline (h-9); floating bars sit above it.
const MANUAL_NOTE_HEIGHT = 36;
const LEFT_DRAWER_WIDTH = 440;
// Default share (%) of the map pane in split mode; also what double-clicking the divider restores.
const DEFAULT_SPLIT_RATIO = 33;
// Shared fallbacks so a timeline without lanes/articles doesn't hand the map, canvas and
// lists a new [] on every render (a new array rebuilds every map pin).
const EMPTY_ARTICLES = [];
const EMPTY_LANES = [];
const EVENT_DRAWER_WIDTH_KEY = 'chronix_event_drawer_width';
const EVENT_VISIBILITY_KEY = 'chronix_event_visibility';

const MAX_PERSISTED_CHAT_MESSAGES = 60;
const CHAT_SERVER_SAVE_DELAY_MS = 800;

const serializeChatMessages = (messages) =>
  messages.map(({ canUndo, ...rest }) => rest).slice(-MAX_PERSISTED_CHAT_MESSAGES);

// Chat message ids end in their Date.now() creation time (`u-1727...`).
const getChatMessageTime = (message) => {
  const match = /-(\d{12,})$/.exec(String(message?.id || ''));
  return match ? Number(match[1]) : 0;
};

// Chat discovery teaser: once per timeline; retired for good once the user sends a chat message,
// closes it twice, or lets it time out 3 times. Limits are skipped in local dev so it stays testable.
const CHAT_TEASER_SEEN_KEY = 'chronix_chat_teaser_seen';
const CHAT_TEASER_SEEN_MAX = 200;
const CHAT_ADOPTED_KEY = 'chronix_chat_adopted';
const CHAT_TEASER_CLOSED_KEY = 'chronix_chat_teaser_closed';
const CHAT_TEASER_TIMEOUTS_KEY = 'chronix_chat_teaser_timeouts';
const CHAT_TEASER_MAX_CLOSED = 2;
const CHAT_TEASER_MAX_TIMEOUTS = 3;
const CHAT_TEASER_IDLE_MS = 18000;
const CHAT_TEASER_LIMITS_ENABLED = !import.meta.env.DEV;

const readTeaserSeen = () => {
  try {
    const list = JSON.parse(localStorage.getItem(CHAT_TEASER_SEEN_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};
const readCount = (key) => {
  try { return parseInt(localStorage.getItem(key) || '0', 10) || 0; } catch { return 0; }
};
const isChatTeaserRetired = () => {
  try {
    if (localStorage.getItem(CHAT_ADOPTED_KEY) === '1') return true;
  } catch { }
  return readCount(CHAT_TEASER_CLOSED_KEY) >= CHAT_TEASER_MAX_CLOSED
    || readCount(CHAT_TEASER_TIMEOUTS_KEY) >= CHAT_TEASER_MAX_TIMEOUTS;
};
const markChatAdopted = () => {
  try { localStorage.setItem(CHAT_ADOPTED_KEY, '1'); } catch { }
};

// Approximate decimal-year value for chronological ordering (mirrors dateToDecimalYear mapping)
const articleDateValue = (a) => {
  const f = a?.from || {};
  const y = Number(f.year) || 0;
  const m = (Number(f.month) || 1) - 1;
  const d = (Number(f.day) || 1) - 1;
  const minutesIntoDay = (Number(f.hour) || 0) * 60 + (Number(f.minute) || 0);
  return y + (m * 30 + d + minutesIntoDay / 1440) / 365;
};



const DEFAULT_APP_TITLE = 'ChroniX – Interactive Visual Timelines';

export default function App() {
  const { user, loading: authLoading, isGuest } = useAuth();
  const { language, isRtl, t, formatDatePart, contentMode, setContentMode, markModeChosen, visualTheme } = useLanguage();
  const [currentTimeline, setCurrentTimelineState] = useState(null);
  // The latest timeline state, updated synchronously on every change, so async handlers (image
  // generation, AI jobs, saves) build on the newest copy instead of their render-time closure (B-04).
  const currentTimelineStateRef = useRef(null);
  const currentTimelineIdRef = useRef(null);
  currentTimelineIdRef.current = currentTimeline?.id ?? null;
  const setCurrentTimeline = useCallback((valueOrUpdater) => {
    const prev = currentTimelineStateRef.current;
    const next = typeof valueOrUpdater === 'function' ? valueOrUpdater(prev) : valueOrUpdater;
    if (next === prev) return;
    currentTimelineStateRef.current = next;
    currentTimelineIdRef.current = next?.id ?? null;
    // Opening another timeline: its server version is the base for the next save of it.
    if (next?.id && next.id !== prev?.id && next.updatedAt) noteTimelineServerState(next);
    setCurrentTimelineState(next);
  }, []);
  const selectTimelineSeqRef = useRef(0);
  const timelineCategories = useMemo(
    () => getDistinctCategories(currentTimeline?.articles || []),
    [currentTimeline]
  );
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [focusedArticleId, setFocusedArticleId] = useState(null);

  // Narrow-viewport (mobile portrait) tracking. Landscape phones share the compact
  // desktop/rail layout so 100% of vertical screen height goes to the timeline canvas
  // without mixing mobile top bars and desktop side drawers.
  const isNarrowViewport = useIsMobileViewport();
  const [isWideDesktop, setIsWideDesktop] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= 1150
  );
  const [mobileTimelineView, setMobileTimelineView] = useState('canvas');
  // null = default responsive width; set by dragging the event drawer's edge (in-session per timeline only).
  const [eventDrawerWidth, setEventDrawerWidth] = useState(null);
  const handleEventDrawerWidthChange = useCallback((width) => {
    setEventDrawerWidth(width || null);
  }, []);
  useEffect(() => {
    const handleResize = () => {
      setIsWideDesktop(window.innerWidth >= 1150);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Card layout state: the default density is automatic on every platform so the
  // timeline can adapt to the available space without starting in a cramped small mode.
  // We intentionally do not persist this across timelines or sessions so that every
  // timeline build/load opens in the ideal platform default.
  const [densityMode, setDensityMode] = useState(() => 'auto');
  const densityUserOverrideRef = useRef(false);

  // Apply platform defaults across breakpoints only until the user explicitly chooses a layout.
  const prevNarrowRef = useRef(isNarrowViewport);
  useEffect(() => {
    if (prevNarrowRef.current !== isNarrowViewport) {
      prevNarrowRef.current = isNarrowViewport;
      setMobileTimelineView((prev) => (prev === 'classic' ? 'classic' : 'canvas'));
      if (!densityUserOverrideRef.current) {
        setDensityMode('auto');
      }
    }
  }, [isNarrowViewport]);

  const handleToggleDensityMode = useCallback((newMode) => {
    const nextMode = newMode || 'auto';
    densityUserOverrideRef.current = true;
    setDensityMode(nextMode);
    if (isNarrowViewport && nextMode !== 'auto') {
      setMobileTimelineView('classic');
    }
  }, [isNarrowViewport]);
  // Event visibility: 'smart' lets Histropedia thin events by rank as you zoom out (the
  // default), 'all' shows every event at every zoom level. Persisted as a user preference.
  const [eventVisibility, setEventVisibility] = useState(() => {
    try {
      return localStorage.getItem(EVENT_VISIBILITY_KEY) === 'all' ? 'all' : 'smart';
    } catch {
      return 'smart';
    }
  });
  const handleChangeEventVisibility = useCallback((mode) => {
    const next = mode === 'all' ? 'all' : 'smart';
    setEventVisibility(next);
    try { localStorage.setItem(EVENT_VISIBILITY_KEY, next); } catch { }
  }, []);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [activePrompt, setActivePrompt] = useState('');

  // Starred events state (in-session favorites)
  const [starredArticleIds, setStarredArticleIds] = useState(() => new Set());
  const [filterStarredOnly, setFilterStarredOnly] = useState(false);

  // Shared-link viewing ("/t/<id>"): lets anyone open a timeline directly, no login wall.
  // Parsed once at mount so it's available before auth resolves (bypasses the AuthGate).
  const [sharedRouteId] = useState(() => {
    if (typeof window === 'undefined') return null;
    const m = window.location.pathname.match(/^\/t\/([^/]+)\/?$/);
    const fallbackId = new URLSearchParams(window.location.search).get('timeline');
    return m ? decodeURIComponent(m[1]) : fallbackId;
  });
  const [isSharedViewLoading, setIsSharedViewLoading] = useState(!!sharedRouteId);
  const [sharedViewError, setSharedViewError] = useState(null);
  const [isReadOnlyBannerDismissed, setIsReadOnlyBannerDismissed] = useState(false);

  // Warm the heavy timeline canvas chunk in the background while generation or shared fetch is in flight
  useEffect(() => {
    if (!isLoading && !isSharedViewLoading) return;
    import('./components/TimelineView').catch(() => {});
    if (isNarrowViewport) {
      import('./components/timeline/TimelineCardFeed').catch(() => {});
    }
  }, [isLoading, isSharedViewLoading, isNarrowViewport]);
  useEffect(() => {
    setIsReadOnlyBannerDismissed(false);
  }, [sharedRouteId]);


  useEffect(() => {
    if (!sharedRouteId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchSharedTimeline(sharedRouteId);
        if (cancelled) return;
        resetAllElementPositionsAndState(data?.id ?? null);
        setCurrentTimeline(data);
        if (data?.title) setActivePrompt(data.title);
      } catch (e) {
        if (!cancelled) setSharedViewError(e.message || 'Failed to load shared timeline');
      } finally {
        if (!cancelled) setIsSharedViewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sharedRouteId]);

  // Public-page route tracking ("/privacy", "/terms", "/features", "/open-source")
  const [publicRoute, setPublicRoute] = useState(() => {
    if (typeof window === 'undefined') return null;
    const p = window.location.pathname.toLowerCase();
    const h = window.location.hash.toLowerCase();
    if (p.includes('features') || h.includes('features')) return 'features';
    if (p.includes('privacy') || h.includes('privacy')) return 'privacy';
    if (p.includes('open-source') || h.includes('open-source') || p.includes('opensource') || h.includes('opensource')) return 'open-source';
    if (p.includes('terms') || h.includes('terms')) return 'terms';
    return null;
  });

  useEffect(() => {
    const handleUrlChange = () => {
      const p = window.location.pathname.toLowerCase();
      const h = window.location.hash.toLowerCase();
      if (p.includes('features') || h.includes('features')) setPublicRoute('features');
      else if (p.includes('privacy') || h.includes('privacy')) setPublicRoute('privacy');
      else if (p.includes('open-source') || h.includes('open-source') || p.includes('opensource') || h.includes('opensource')) setPublicRoute('open-source');
      else if (p.includes('terms') || h.includes('terms')) setPublicRoute('terms');
      else setPublicRoute(null);
    };
    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleUrlChange);
    };
  }, []);

  const handleClosePublicRoute = useCallback(() => {
    setPublicRoute(null);
    window.history.pushState(null, '', '/');
  }, []);

  const handleOpenPublicRoute = useCallback((route) => {
    setPublicRoute(route);
    window.history.pushState(null, '', `/${route}`);
  }, []);

  const applyDocumentTitle = useCallback((nextTitle) => {
    if (typeof document === 'undefined') return;
    const target = nextTitle || DEFAULT_APP_TITLE;
    if (document.title === target) {
      // Force Blink/Chromium to emit a fresh UpdateTitle IPC to the browser process
      // even when DOM document.title already matches target after same-document navigation.
      document.title = `${target}\u200B`;
    }
    document.title = target;
  }, []);

  const computeAppTitle = useCallback((timeline = currentTimeline, route = publicRoute) => {
    if (route) {
      const titleMap = {
        terms: 'Terms of Service | ChroniX',
        'open-source': 'Open Source Notices | ChroniX',
        privacy: 'Privacy Policy | ChroniX',
        features: 'Features | ChroniX',
      };
      if (titleMap[route]) return titleMap[route];
    }
    if (timeline?.title) {
      return `${timeline.title} | ChroniX`;
    }
    return DEFAULT_APP_TITLE;
  }, [currentTimeline, publicRoute]);

  const DEFAULT_GUEST_QUOTA = {
    is_admin: false,
    is_guest: true,
    mode: 'limited',
    daily_paid_limit: 5,
    remaining_paid: 5,
    used_today: 0,
    registered_mode: 'limited',
    registered_daily_limit: 15,
  };

  const [quota, setQuota] = useState(() => {
    try {
      const cached = localStorage.getItem('chronix_cached_quota');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object' && parsed.mode) return parsed;
      }
    } catch { }
    return DEFAULT_GUEST_QUOTA;
  });

  const quotaReqIdRef = useRef(0);
  const lastQuotaRefreshAtRef = useRef(0);
  const refreshQuota = useCallback(async (options) => {
    const passive = Boolean(options && typeof options === 'object' && options.passive === true);
    const now = Date.now();
    if (passive && now - lastQuotaRefreshAtRef.current < 5000) {
      return;
    }
    lastQuotaRefreshAtRef.current = now;
    const reqId = ++quotaReqIdRef.current;
    try {
      const q = await fetchUserQuota();
      // Drop out-of-order (stale) responses so the count never bounces backwards.
      if (reqId !== quotaReqIdRef.current) return;
      if (q) {
        setQuota(q);
        try { localStorage.setItem('chronix_cached_quota', JSON.stringify(q)); } catch { }
      }
    } catch (e) {
      // Transient network error - keep the last known value rather than clearing it.
      if (reqId === quotaReqIdRef.current) {
        lastQuotaRefreshAtRef.current = 0;
      }
    }
  }, []);

  // One boot fetch, after auth has resolved (the guest session is known), then again only when the
  // identity really changes - not on every token refresh, which replaces the user object.
  const quotaIdentityKey = authLoading ? null : `${user?.id || ''}:${user?.is_anonymous ? 'guest' : 'account'}`;
  useEffect(() => {
    if (quotaIdentityKey === null) return;
    refreshQuota();
  }, [quotaIdentityKey, refreshQuota]);

  // Keep the server-authoritative quota in sync whenever the user returns to the
  // tab/window. Covers window switching, tab close/reopen, and multi-tab usage -
  // the badge is always re-read from the server (which tracks guests by IP).
  // A 5s cooldown skips the duplicate focus + visibilitychange pair on tab return.
  useEffect(() => {
    const onFocus = () => refreshQuota({ passive: true });
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshQuota({ passive: true });
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshQuota]);

  // Sync quota badge across all open browser tabs in real time. Notifications (tier changes seen
  // on responses, other tabs' updates) arrive in bursts, so they share one refetch per 2 s.
  useEffect(() => {
    const coalesced = createCoalescer(() => refreshQuota(), QUOTA_NOTIFY_COALESCE_MS);
    const onStorage = (e) => {
      if (e.key === 'chronix_quota_updated') {
        coalesced.trigger();
      }
    };
    const onQuotaChanged = () => coalesced.trigger();
    window.addEventListener('storage', onStorage);
    window.addEventListener(QUOTA_REFRESH_EVENT, onQuotaChanged);
    return () => {
      coalesced.cancel();
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(QUOTA_REFRESH_EVENT, onQuotaChanged);
    };
  }, [refreshQuota]);

  // Publish the quota so basic-mode indicators anywhere in the tree stay in sync with it.
  useEffect(() => {
    publishQuota(quota);
  }, [quota]);

  // AbortControllers for active AI requests
  const generateAbortControllerRef = useRef(null);
  const refineAbortControllerRef = useRef(null);
  const chatAbortControllerRef = useRef(null);
  const activeGenerateJobIdRef = useRef(null);
  const activeRefineJobIdRef = useRef(null);
  const activeChatJobIdRef = useRef(null);
  const filesAbortControllerRef = useRef(null);
  // The timeline copy a running refine / chat job was started from, for a Stop that lands mid-save.
  const activeRefineSnapshotRef = useRef(null);
  const activeChatSnapshotRef = useRef(null);
  // Undo for the latest chat-driven edit only (B-08), kept in memory without inline media.
  const [chatUndoEntry, setChatUndoEntry] = useState(null);
  // Server-side conversation sync state for the active timeline.
  const chatSyncRef = useRef({ id: null, enabled: false, lastSent: null });
  const chatPendingSaveRef = useRef(null);
  const chatSaveTimerRef = useRef(null);
  const [chatSyncVersion, setChatSyncVersion] = useState(0);

  // Handle stopping generation
  const handleStopGenerate = useCallback(async () => {
    const activeJob = getActiveAiJob();
    const jobId = activeJob?.jobId || activeGenerateJobIdRef.current;
    const previewId = isPartialTimeline(currentTimelineStateRef.current) ? currentTimelineStateRef.current.id : null;
    if (generateAbortControllerRef.current) {
      generateAbortControllerRef.current.abort();
      generateAbortControllerRef.current = null;
    }
    clearActiveAiJob();
    activeGenerateJobIdRef.current = null;
    setIsLoading(false);
    if (jobId) {
      const cancelResponse = await cancelAiJob(jobId);
      refreshQuota();
      try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch { }
      // The job was already saving when Stop landed (B-16): open what it saved in place of the preview.
      const saved = previewId ? savedTimelineFromCancel(cancelResponse, previewId) : null;
      if (saved) {
        try {
          const latest = await fetchTimeline(saved.timelineId);
          const current = currentTimelineStateRef.current;
          if (latest && (!current || isPartialTimeline(current) || String(current.id) === String(previewId))) {
            setCurrentTimeline(latest);
          }
        } catch (err) {
          console.warn('Could not load the timeline saved before Stop:', err);
        }
      }
    }
  }, [refreshQuota, setCurrentTimeline]);

  // A Stop that lands while the job is already saving doesn't undo the save (B-16): the cancel
  // response says so, and the saved result is applied to the open copy like a finished job's.
  const applyResultSavedDespiteStop = async (snapshot, cancelResponse) => {
    const saved = savedTimelineFromCancel(cancelResponse, snapshot?.id ?? null);
    if (!saved) return;
    try {
      const latest = await fetchTimeline(saved.timelineId);
      applyAiTimelineResult(snapshot, latest, true);
    } catch (err) {
      console.warn('Could not load the timeline saved before Stop:', err);
    }
  };

  // Handle stopping refinement
  const handleStopRefine = useCallback(async () => {
    const jobId = activeRefineJobIdRef.current;
    const snapshot = activeRefineSnapshotRef.current;
    if (refineAbortControllerRef.current) {
      refineAbortControllerRef.current.abort();
      refineAbortControllerRef.current = null;
    }
    activeRefineJobIdRef.current = null;
    activeRefineSnapshotRef.current = null;
    setIsRefining(false);
    if (jobId) {
      const cancelResponse = await cancelAiJob(jobId);
      refreshQuota();
      try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch { }
      await applyResultSavedDespiteStop(snapshot, cancelResponse);
    }
  }, [refreshQuota]);

  // Keyboard shortcut: Escape to stop active generation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (isLoading) {
          handleStopGenerate();
        } else if (isRefining) {
          handleStopRefine();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLoading, isRefining, handleStopGenerate, handleStopRefine]);

  // Clean up ongoing requests on unmount
  useEffect(() => {
    return () => {
      generateAbortControllerRef.current?.abort();
      refineAbortControllerRef.current?.abort();
      chatAbortControllerRef.current?.abort();
      filesAbortControllerRef.current?.abort();
    };
  }, []);

  // Map Display Mode ('icon' | 'pip' | 'split' | 'full') - always defaults to 'icon' per timeline
  const [mapDisplayMode, setMapDisplayMode] = useState('icon');

  // Map Basemap Tile Provider ('google' | 'esriStreet' | 'esri') - defaults to system provider per timeline
  const [mapTileProvider, setMapTileProvider] = useState(() => ACTIVE_TILE_PROVIDER || 'google');

  const handleMapTileProviderChange = useCallback((provider) => {
    setMapTileProvider(provider);
  }, []);

  // Active lane AND category (topic) filters from the timeline's own filter menu - the
  // two dimensions are independent and always combined, kept in sync so the geo map's
  // pins mirror what's shown/hidden on the timeline.
  const [timelineFilter, setTimelineFilter] = useState(null);
  // Bring-to-front focus for the split-mode map pane (shares the 'map' id with
  // the floating/PiP widget, which is never mounted at the same time).
  const { zIndex: splitMapZ, raise: raiseSplitMap } = useFloatingFocus('map', FLOATING_Z.MAP_BASE);
  const handleTimelineFilterChange = useCallback((laneItems, categoryItems) => {
    setTimelineFilter(
      laneItems.length > 0 || categoryItems.length > 0 ? { laneItems, categoryItems } : null
    );
  }, []);

  const handleMapDisplayModeChange = useCallback((mode) => {
    setMapDisplayMode(mode);
  }, []);

  const [hiddenLayerIds, setHiddenLayerIds] = useState(() => new Set());
  // Non-destructively hide temporarily toggled layers on canvas, map, and card feeds
  const visibleTimeline = useMemo(
    () => applyHiddenLayersToTimeline(currentTimeline, hiddenLayerIds),
    [currentTimeline, hiddenLayerIds]
  );

  useEffect(() => {
    if (!selectedArticle || !hiddenLayerIds || hiddenLayerIds.size === 0) return;
    const stillVisible = (visibleTimeline?.articles || []).some((a) => isSameArticleId(a.id, selectedArticle.id));
    if (!stillVisible) {
      setSelectedArticle(null);
    }
  }, [hiddenLayerIds, visibleTimeline?.articles, selectedArticle]);

  const geoArticlesCount = useMemo(() => {
    return (visibleTimeline?.articles || []).filter(
      (a) => a.lat != null && a.lng != null && !isNaN(parseFloat(a.lat)) && !isNaN(parseFloat(a.lng))
    ).length;
  }, [visibleTimeline?.articles]);

  // Resizable Split Pane State (percentage for top map pane, 15% to 85%). The map defaults to the
  // top third on every timeline: the event card lives on the timeline below, which gets the larger share.
  const [splitRatio, setSplitRatio] = useState(DEFAULT_SPLIT_RATIO);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const splitContainerRef = useRef(null);

  // The divider drag resizes the two panes straight through the DOM, once per animation
  // frame, and commits splitRatio on release, so the App doesn't re-render on every move.
  // Both panes' ResizeObservers (canvas and Leaflet) still follow the live size.
  const mapPaneRef = useRef(null);
  const timelinePaneRef = useRef(null);
  const splitDragCleanupRef = useRef(null);
  useEffect(() => () => splitDragCleanupRef.current?.(), []);

  const beginSplitDrag = (subscribe) => {
    splitDragCleanupRef.current?.();
    const narrow = isNarrowViewport;
    let lastRatio = null;
    const throttle = createFrameThrottle((ratio) => {
      if (mapPaneRef.current) mapPaneRef.current.style.height = `${ratio}%`;
      if (timelinePaneRef.current) timelinePaneRef.current.style.height = getTimelinePaneHeight(ratio, narrow);
    });
    const onMove = (clientY) => {
      const ratio = computeSplitRatioFromClientY(splitContainerRef.current, clientY);
      if (ratio == null) return;
      lastRatio = ratio;
      throttle.schedule(ratio);
    };
    let unsubscribe = null;
    // Also used to end an interrupted drag: the panes may already show a new size, so the
    // last ratio is always committed and state matches the DOM again.
    const finish = () => {
      if (splitDragCleanupRef.current !== finish) return;
      splitDragCleanupRef.current = null;
      unsubscribe?.();
      throttle.flush();
      setIsDraggingSplit(false);
      if (lastRatio != null) setSplitRatio(lastRatio);
    };
    splitDragCleanupRef.current = finish;
    unsubscribe = subscribe(onMove, finish);
    setIsDraggingSplit(true);
  };

  const handleSplitMouseDown = (e) => {
    e.preventDefault();
    beginSplitDrag((onMove, onEnd) => {
      const onMouseMove = (moveEvent) => onMove(moveEvent.clientY);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onEnd);
      return () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onEnd);
      };
    });
  };

  // On narrow screens, a map pin popup can be taller than the current split-pane share
  // (it grows upward from the pin) and get clipped at the top of the map. Called with the
  // popup's required pixel height so the map pane can grow to fit it - never shrinks it,
  // so this never fights a size the user already picked via the divider. Returns whether
  // it actually grew the pane, so the caller can wait out the resize's CSS transition
  // before re-framing the pin (otherwise it gets positioned against the stale, smaller size).
  const handleMapHeightRequest = useCallback((requiredPx) => {
    if (!isNarrowViewport || mapDisplayMode !== 'split' || !splitContainerRef.current) return false;
    const style = window.getComputedStyle(splitContainerRef.current);
    const topPad = parseFloat(style.paddingTop) || 0;
    const bottomPad = parseFloat(style.paddingBottom) || 0;
    const totalHeight = splitContainerRef.current.getBoundingClientRect().height - topPad - bottomPad;
    if (!totalHeight || totalHeight <= 0) return false;
    const neededPercent = (requiredPx / totalHeight) * 100;
    const clamped = Math.min(Math.max(neededPercent, 15), 85);
    if (clamped <= splitRatio) return false;
    setSplitRatio(clamped);
    return true;
  }, [isNarrowViewport, mapDisplayMode, splitRatio]);

  const handleSplitTouchStart = () => {
    beginSplitDrag((onMove, onEnd) => {
      const onTouchMove = (moveEvent) => {
        if (moveEvent.touches[0]) onMove(moveEvent.touches[0].clientY);
      };
      window.addEventListener('touchmove', onTouchMove, { passive: true });
      window.addEventListener('touchend', onEnd);
      window.addEventListener('touchcancel', onEnd);
      return () => {
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onEnd);
        window.removeEventListener('touchcancel', onEnd);
      };
    });
  };

  // Theme state ('light' | 'dark') - defaults to user's system preferences unless manually chosen
  const [theme, setTheme] = useState(() => {
    try {
      const isManual = localStorage.getItem('vt_theme_manual') === 'true';
      if (isManual) {
        const saved = localStorage.getItem('vt_theme');
        if (saved === 'light' || saved === 'dark') return saved;
      }
      return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    } catch (e) {
      return 'light';
    }
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Keep in sync with OS/system theme changes when user has not manually set a preference
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = (e) => {
      try {
        const isManual = localStorage.getItem('vt_theme_manual') === 'true';
        if (!isManual) {
          setTheme(e.matches ? 'dark' : 'light');
        }
      } catch (err) { }
    };
    mediaQuery.addEventListener('change', handleSystemThemeChange);
    return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
  }, []);

  // What the person chose in Appearance: 'light' | 'dark', or 'system' (follow the OS setting).
  const [themePreference, setThemePreference] = useState(() => {
    try {
      if (localStorage.getItem('vt_theme_manual') === 'true') {
        const saved = localStorage.getItem('vt_theme');
        if (saved === 'light' || saved === 'dark') return saved;
      }
    } catch (e) { }
    return 'system';
  });

  const handleSetThemePreference = (pref) => {
    setThemePreference(pref);
    try {
      if (pref === 'system') {
        localStorage.setItem('vt_theme_manual', 'false');
        localStorage.removeItem('vt_theme');
      } else {
        localStorage.setItem('vt_theme', pref);
        localStorage.setItem('vt_theme_manual', 'true');
      }
    } catch (e) { }
    if (pref === 'system') {
      const prefersDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      setTheme(prefersDark ? 'dark' : 'light');
    } else {
      setTheme(pref);
    }
  };

  // The quick sun/moon buttons flip between light and dark (and so stop following the system).
  const handleToggleTheme = () => handleSetThemePreference(theme === 'dark' ? 'light' : 'dark');

  // Daylight background aesthetic mode: configurable via VITE_DAY_BACKGROUND ('topo' | 'constellations', defaults to 'constellations')
  const dayBackground = (import.meta.env.VITE_DAY_BACKGROUND || 'constellations').toLowerCase();

  // In-place event editing (event drawer edit mode). `eventEditRequestId` asks the drawer to
  // open that event straight in edit mode; the dirty ref guards navigation away from unsaved edits.
  const [eventEditRequestId, setEventEditRequestId] = useState(null);
  const eventEditDirtyRef = useRef(false);
  const handleEventEditDirtyChange = useCallback((dirty) => {
    eventEditDirtyRef.current = Boolean(dirty);
  }, []);
  // Kept in a ref so stable (useCallback) handlers always see the current language.
  const confirmDiscardEventEditRef = useRef(() => true);

  // Modals state
  const [isAiRefineOpen, setIsAiRefineOpen] = useState(false);
  const [isSavedModalOpen, setIsSavedModalOpen] = useState(false);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  // Story Studio: where every personal timeline is built (from documents, photos, a blank
  // canvas or a guided story) and where existing personal timelines are reworked.
  const [isStoryStudioOpen, setIsStoryStudioOpen] = useState(false);
  const [storyStudioInitialName, setStoryStudioInitialName] = useState('');
  // How the Studio opens: null (the ways to start), 'documents', 'paste' or 'blank'.
  const [storyStudioInitialStart, setStoryStudioInitialStart] = useState(null);
  // When set, the Studio opens in edit mode on this (current) timeline instead of creating one.
  const [storyStudioEditTimeline, setStoryStudioEditTimeline] = useState(null);
  // Opens the personal-timeline builder. `preset` ({ start, title }) comes from the unknown-subject notice.
  const openBuildOwn = (preset = null) => {
    setStoryStudioEditTimeline(null);
    setStoryStudioInitialName(preset?.title || '');
    setStoryStudioInitialStart(preset?.start || null);
    setIsStoryStudioOpen(true);
  };
  // "Your story is ready" card after a Story Studio creation: { id, title, events, chapters, status }.
  const [storyReady, setStoryReady] = useState(null);
  // Subject the AI honestly had no reliable public info about (backend `insufficient_info`).
  const [unknownSubject, setUnknownSubject] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDisclaimerModalOpen, setIsDisclaimerModalOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [isCommunityModalOpen, setIsCommunityModalOpen] = useState(false);
  const [isLibraryModalOpen, setIsLibraryModalOpen] = useState(false);
  const [isSavingMerged, setIsSavingMerged] = useState(false);
  const [mergedSavedDone, setMergedSavedDone] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  // The left side panel (bottom sheet on mobile) is a single navigation container: event
  // details, events list, overview and games all open in it. Its history trail drives the
  // panel's Back/Forward controls, and which panel is open is derived from the current entry.
  const [panelHistory, setPanelHistory] = useState(EMPTY_PANEL_HISTORY);
  const activePanel = getCurrentPanel(panelHistory);
  const isCardsListOpen = activePanel?.kind === 'list';
  const isOverviewOpen = activePanel?.kind === 'overview';
  const isQuizOpen = activePanel?.kind === 'games';
  const isEditPanelOpen = activePanel?.kind === 'edit';
  const isNewEventPanelOpen = activePanel?.kind === 'new-event';
  confirmDiscardEventEditRef.current = () => {
    if (!eventEditDirtyRef.current) return true;
    if (!window.confirm(t('eventEditor.discardConfirm'))) return false;
    eventEditDirtyRef.current = false;
    return true;
  };
  // Game shown in the games panel. Kept while other panels are open so returning resumes it.
  const [quizGame, setQuizGame] = useState('hub');
  const [isQuizWide, setIsQuizWide] = useState(false);
  const [isEventDrawerDismissed, setIsEventDrawerDismissed] = useState(false);
  const [isPodcastOpen, setIsPodcastOpen] = useState(true);
  const [isPodcastMinimized, setIsPodcastMinimized] = useState(true);
  const [isPodcastPlaying, setIsPodcastPlaying] = useState(false);
  const [hasPodcastMobileOverlay, setHasPodcastMobileOverlay] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [isChatBusy, setIsChatBusy] = useState(false);
  const [chatSeed, setChatSeed] = useState(null);
  const [leftDockRect, setLeftDockRect] = useState(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalInitialMode, setAuthModalInitialMode] = useState('signin');
  const [timelineLoadKey, setTimelineLoadKey] = useState(0);
  // Edit Timeline panel & Photo Tray state (session-only).
  const [trayPhotos, setTrayPhotos] = useState([]);
  const [lastTrayAssignment, setLastTrayAssignment] = useState(null);
  const [lastTimelineEditSnapshot, setLastTimelineEditSnapshot] = useState(null);
  const prevTimelineIdRef = useRef(undefined);
  const homeScrollRef = useRef(null);
  const returnToHomeScrollTopRef = useRef(null);
  const [openedFromHomeLibrary, setOpenedFromHomeLibrary] = useState(false);
  const [hasHomeLibraryItems, setHasHomeLibraryItems] = useState(true);
  const [isHomeScrolled, setIsHomeScrolled] = useState(false);

  const handleHomeScroll = useCallback((e) => {
    const top = e.currentTarget.scrollTop;
    setIsHomeScrolled((prev) => (prev ? top > 28 : top > 64));
  }, []);

  const handleScrollToHomeLibrary = useCallback(() => {
    const target = document.getElementById('home-public-library');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  useEffect(() => {
    if (currentTimeline) return undefined;
    const savedTop = returnToHomeScrollTopRef.current;
    if (savedTop != null && savedTop > 0) {
      returnToHomeScrollTopRef.current = null;
      setIsHomeScrolled(savedTop > 64);
      const applyScroll = () => {
        if (homeScrollRef.current) {
          homeScrollRef.current.scrollTop = savedTop;
        }
      };
      applyScroll();
      const rafId = requestAnimationFrame(applyScroll);
      return () => cancelAnimationFrame(rafId);
    }
    returnToHomeScrollTopRef.current = null;
    setIsHomeScrolled(false);
    return undefined;
  }, [currentTimeline]);

  const handleOpenAuth = useCallback((mode = 'signin') => {
    setAuthModalInitialMode(mode);
    setIsAuthModalOpen(true);
  }, []);

  // Central reset helper: guarantees that every time a timeline is created, loaded, or cleared,
  // all screen elements (floating chat bubble, map widget, split ratio, side drawers, podcast dock,
  // filters, and modes) return to their pristine default positions with zero lingering memory.
  const resetAllElementPositionsAndState = useCallback((nextTimelineId) => {
    if (nextTimelineId !== undefined) {
      prevTimelineIdRef.current = nextTimelineId;
    }

    // 1. Reset map display mode, split ratio, tile layer & panned/zoomed map coordinates
    setMapDisplayMode('icon');
    setMapTileProvider(ACTIVE_TILE_PROVIDER || 'google');
    setSplitRatio(DEFAULT_SPLIT_RATIO);
    clearSavedMapViews();

    // 2. Reset chat open state
    setIsChatOpen(false);

    // 3. Reset side drawers, custom widths & selection
    setSelectedArticle(null);
    setFocusedArticleId(null);
    clearHoveredArticleId();
    setIsEventDrawerDismissed(false);
    setEventDrawerWidth(null);
    setPanelHistory(EMPTY_PANEL_HISTORY);
    setQuizGame('hub');
    setIsQuizWide(false);
    setIsPodcastOpen(true);
    setIsPodcastMinimized(true);
    setIsPodcastPlaying(false);
    setHasPodcastMobileOverlay(false);
    setMobileTimelineView('canvas');

    // 4. Reset filters & stars
    setTimelineFilter(null);
    setStarredArticleIds((prev) => (prev.size === 0 ? prev : new Set()));
    setFilterStarredOnly(false);
    setHiddenLayerIds(new Set());
    setIsSavingMerged(false);
    setMergedSavedDone(false);

    // 5. Reset card layout to platform defaults: automatic on every device unless the
    // user explicitly chose a different density mode for this timeline.
    densityUserOverrideRef.current = false;
    setDensityMode('auto');

    // 6. Advance load nonce so timeline-scoped widgets (canvas, map, cards list, dock, podcast drag)
    // always re-initialize from defaults, even when re-opening the same saved timeline.
    setTimelineLoadKey((k) => k + 1);
  }, []);

  // Clean up any legacy persisted layout/mode keys on startup so stale values never linger in browser storage
  useEffect(() => {
    try {
      const legacyKeys = [
        GROUNDING_STORAGE_KEY,
        EVENT_DRAWER_WIDTH_KEY,
        'vt_split_ratio',
        'chronix_map_mode',
        'chronix_map_tile_provider',
        'chronix_pip_size',
        'chronix_chat_dock_v3',
        'chronix_chat_size',
        'chronix_density_mode_desktop',
        'chronix_density_mode_mobile',
        'chronix_mobile_dock_collapsed',
        'chronix_mobile_dock_top',
        'chronix_feed_density',
      ];
      legacyKeys.forEach((k) => localStorage.removeItem(k));
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const key = localStorage.key(i);
        if (key && key.startsWith('chronix_lane_weights_')) {
          localStorage.removeItem(key);
        }
      }
    } catch { }
  }, []);

  useEffect(() => {
    const handleOpenSettings = () => setIsSettingsOpen(true);
    window.addEventListener('chronix-open-settings', handleOpenSettings);
    return () => window.removeEventListener('chronix-open-settings', handleOpenSettings);
  }, []);

  const timelineRef = useRef(null);

  // Mobile / Tab-reload recovery: If the user backgrounded the browser and it reloaded,
  // resume polling the pending background job so the generation is not lost.
  const resumedJobRef = useRef(false);
  useEffect(() => {
    if (resumedJobRef.current) return;
    if (!user) return;
    resumedJobRef.current = true;
    const pendingJob = getActiveAiJob();
    if (!pendingJob) return;

    resumedJobRef.current = true;
    if (pendingJob.type === 'generate' && pendingJob.jobId) {
      console.log('Resuming active background generation after page reload:', pendingJob.jobId);
      const controller = new AbortController();
      generateAbortControllerRef.current = controller;
      setActivePrompt(pendingJob.prompt || '');
      setIsLoading(true);

      // If the guest signed in mid-generation, the job still belongs to the old guest id until
      // the guest -> account claim transfers it; polling before that would get a 403.
      waitForGuestClaim()
        .then(() => pollAiJob(pendingJob.jobId, controller.signal, t('app.failedGenerate'), {
          // The job may have expired while the tab was gone; its timeline was saved before delivery.
          recoverResult: (timelineId) => fetchTimeline(timelineId),
          knownTimeline: { timelineId: pendingJob.timelineId || null, persisted: Boolean(pendingJob.persisted) },
        }))
        .then((data) => {
          clearActiveAiJob();
          if (!data?.articles || data.articles.length === 0) {
            setErrorMessage(t('app.emptyTimelineError'));
            return;
          }
          resetAllElementPositionsAndState(data?.id ?? null);
          setCurrentTimeline(data);
          triggerCelebration();
        })
        .catch((err) => {
          clearActiveAiJob();
          if (err.name === 'AbortError' || controller.signal.aborted) {
            return;
          }
          console.error('Resumed generation failed:', err);
          if (err.code === 'insufficient_info') {
            setUnknownSubject(err.subject || pendingJob.prompt || '');
            refreshQuota();
            return;
          }
          // Stopped by the server (busy queue / deadline): its credits come back, so say so plainly.
          setErrorMessage(err.serverTimeout ? t('app.serverTimeout') : (err.message || t('app.failedGenerate')));
        })
        .finally(() => {
          if (generateAbortControllerRef.current === controller) {
            generateAbortControllerRef.current = null;
          }
          setIsLoading(false);
        });
    }
  }, [user, refreshQuota, t, resetAllElementPositionsAndState]);

  const triggerCelebration = () => {
    fireConfetti({
      particleCount: 50,
      spread: 60,
      origin: { y: 0.85 }
    });
  };

  // Handle generation from prompt (or photo/visual prompt)
  const handleGenerate = async (prompt, grounding, files = [], inputMethod = 'typed') => {
    if (generateAbortControllerRef.current) {
      generateAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    generateAbortControllerRef.current = controller;

    // Grounding mode: Fast mode skips web search for ~2x faster generation; Verified mode grounds generation via Google Search.
    const isGroundingActive = typeof grounding === 'boolean' ? grounding : isDefaultGroundingEnabled();
    const hasPhotoFiles = Array.isArray(files) && files.length > 0;
    const hasDocFiles = hasPhotoFiles && files.some((f) => classifyAttachmentFile(f).kind !== 'image');
    const defaultAttachmentLabel = hasDocFiles
      ? t('toolbar.filePromptDefaultLabel')
      : t('toolbar.photoPromptDefaultLabel');
    const displayPrompt = (prompt && prompt.trim()) || (hasPhotoFiles ? defaultAttachmentLabel : '');

    setActivePrompt(displayPrompt);
    setIsLoading(true);
    setErrorMessage(null);
    setUnknownSubject(null);
    returnToHomeScrollTopRef.current = null;
    setOpenedFromHomeLibrary(false);
    markModeChosen?.();
    resetAllElementPositionsAndState(null);

    // P-03: the timeline appears read-only as soon as the model's answer is parsed, while images
    // and links are still being added; the finished result (same id) replaces it.
    const preview = createPartialPreviewTracker({
      getCurrent: () => currentTimelineStateRef.current,
      setCurrent: (next, { replacingOwnPreview = false, restoring = false } = {}) => {
        if (!replacingOwnPreview) resetAllElementPositionsAndState(next?.id ?? null);
        setCurrentTimeline(next);
        if (!restoring && hasPhotoFiles && !prompt?.trim() && next?.title) setActivePrompt(next.title);
      },
      isActive: () => generateAbortControllerRef.current === controller && !controller.signal.aborted,
    });

    const onJobStarted = (jobId) => {
      activeGenerateJobIdRef.current = jobId;
      setActiveAiJob({
        jobId,
        type: 'generate',
        prompt: displayPrompt,
        startedAt: Date.now(),
      });
      // Quota is consumed on the server when the job is accepted; refresh immediately
      refreshQuota();
      try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch { }
    };

    try {
      // Timeline content language is detected server-side from the prompt text itself -
      // or when only a photo is provided, falls back to the current UI language.
      const data = hasPhotoFiles
        ? await generateTimelineFromPromptFiles(
            files,
            prompt || '',
            controller.signal,
            isGroundingActive,
            onJobStarted,
            contentMode,
            null,
            inputMethod,
            preview.show,
          )
        : await generateTimeline(
            prompt,
            '',
            controller.signal,
            isGroundingActive,
            onJobStarted,
            contentMode,
            inputMethod,
            preview.show,
          );
      if (!data?.articles || data.articles.length === 0) {
        throw new Error(t('app.emptyTimelineError'));
      }
      clearActiveAiJob();
      activeGenerateJobIdRef.current = null;
      // Keep the view (zoom, selection) when the final result replaces its own preview.
      const replacesPreview = preview.isShowing() && String(preview.shownId()) === String(data?.id);
      preview.finish();
      if (!replacesPreview) resetAllElementPositionsAndState(data?.id ?? null);
      setCurrentTimeline(data);
      if (hasPhotoFiles && !prompt?.trim() && data?.title) {
        setActivePrompt(data.title);
      }
      // Credits were charged (and the badge refreshed) when the job started.
      triggerCelebration();
    } catch (err) {
      clearActiveAiJob();
      activeGenerateJobIdRef.current = null;
      refreshQuota();
      try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch { }
      // A failed or stopped job leaves nothing behind: drop its preview (a saved result was already
      // recovered by the poller, or is opened by handleStopGenerate).
      preview.discard();
      if (err.name === 'AbortError' || controller.signal.aborted) {
        console.log('Generation stopped by user.');
        return;
      }
      console.error('Generation failed:', err);
      if (err.code === 'insufficient_info') {
        // Honest "no reliable info" verdict: offer fact-based alternatives instead of an error.
        setUnknownSubject(err.subject || displayPrompt);
        return;
      }
      setErrorMessage(err.serverTimeout ? t('app.serverTimeout') : (err.message || t('app.failedGenerate')));
      if (err.message && (err.message.includes('Authentication') || (err.message.includes('sign in') && !isGuest))) {
        handleOpenAuth('signin');
      } else if (err.message && err.message.includes('API Key') && !isGuest) {
        setIsSettingsOpen(true);
      }
    } finally {
      activeGenerateJobIdRef.current = null;
      if (generateAbortControllerRef.current === controller) {
        generateAbortControllerRef.current = null;
      }
      setIsLoading(false);
    }
  };

  // Story Studio "start from documents": the AI extracts a timeline from uploaded files (scans,
  // photos of pages, PDFs, TXT/MD) and/or pasted text. The result goes back to the Studio, where
  // it is reviewed and previewed before it is created; errors are thrown back for it to show.
  // `signal` comes from the Studio (leaving it cancels the job, refunded until the model answered).
  const handleGenerateFromDocuments = async (files, contextText, rawText, signal) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    filesAbortControllerRef.current?.abort();
    filesAbortControllerRef.current = controller;
    try {
      const data = await generateTimelineFromFiles(files, contextText, rawText, controller.signal, contentMode, () => {
        // Credits are charged when the job is accepted; aborting the signal cancels the job.
        refreshQuota();
        try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch { }
      });
      if (!data?.articles?.length) throw new Error(t('app.emptyTimelineError'));
      return data;
    } catch (err) {
      if (err?.name !== 'AbortError' && !controller.signal.aborted) refreshQuota();
      throw err;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (filesAbortControllerRef.current === controller) filesAbortControllerRef.current = null;
    }
  };

  // Example cards only fill the search bar (on every viewport); the user submits explicitly.
  const handleSelectPrompt = (promptText) => {
    if (isLoading) return;
    if (activePrompt === promptText) {
      setActivePrompt('');
      requestAnimationFrame(() => setActivePrompt(promptText));
    } else {
      setActivePrompt(promptText);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    homeScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Prompt guide examples only fill the search bar (never auto-generate) so the user can edit first.
  const [isPromptGuideOpen, setIsPromptGuideOpen] = useState(false);
  const handleUseGuidePrompt = (promptText) => {
    if (activePrompt === promptText) {
      setActivePrompt('');
      requestAnimationFrame(() => setActivePrompt(promptText));
    } else {
      setActivePrompt(promptText);
    }
    homeScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Check for URL query parameters on mount (e.g. ?prompt=... or ?guide=true)
  const initialUrlCheckedRef = useRef(false);
  useEffect(() => {
    if (!user || initialUrlCheckedRef.current) return;
    initialUrlCheckedRef.current = true;

    try {
      const params = new URLSearchParams(window.location.search);
      // A link can carry more than the PromptBar accepts: cut it the same way (B-21).
      const promptParam = clampPromptText(params.get('prompt') || '');
      const guideParam = params.get('guide');

      if (isTimelineGuideEnabled() && (guideParam === 'true' || guideParam === '1')) {
        setIsGuideOpen(true);
      }

      if (promptParam) {
        // Clean up URL query parameters without reloading
        window.history.replaceState({}, '', window.location.pathname);
        setActivePrompt(promptParam);
        handleGenerate(promptParam, undefined, [], 'url');
      }
    } catch (e) {
      console.warn('Error reading URL parameters:', e);
    }
  }, [user]);

  // Saves a timeline state through the save queue; failures are logged, never thrown at the UI.
  // The one exception is an empty timeline, which the server refuses (B-18): say it wasn't saved.
  const saveTimelineQuietly = useCallback((timeline, label = 'timeline') => (
    saveTimeline(timeline).catch((err) => {
      console.warn(`Failed to save ${label}:`, err);
      if (isEmptyTimelineError(err)) setErrorMessage(t('app.emptyTimelineNotSaved'));
      return null;
    })
  ), [t]);

  // Applies `produce(latest)` to the timeline an action started on, never to another timeline the
  // user switched to meanwhile, and stores the result (B-04). Returns the new state, or null.
  const commitTimelineChange = useCallback((targetId, produce) => {
    const prev = currentTimelineStateRef.current;
    if (!prev || prev.isOwner === false || isPartialTimeline(prev) || targetId == null || String(prev.id) !== String(targetId)) return null;
    const next = produce(prev);
    if (!next || next === prev) return null;
    setCurrentTimeline(next);
    return next;
  }, [setCurrentTimeline]);

  // An AI result (refine / chat edit / attach files) was computed from `snapshot`, the copy sent at
  // job start. It is applied to the latest state as a diff by event id, so edits made while the
  // job ran survive (B-04). It is saved here when the server didn't (stale snapshot -> `conflict`)
  // or when the latest state has edits the server copy lacks. Returns { before, after } or null.
  const applyAiTimelineResult = (snapshot, result, persisted) => {
    const latest = currentTimelineStateRef.current;
    if (!latest || !result || !snapshot || String(latest.id) !== String(snapshot.id)) return null;
    if (persisted && result.updatedAt) noteTimelineServerState(result);
    const next = applyAiResultToLatest(snapshot, latest, result, { compare: compareArticlesByStart });
    setCurrentTimeline(next);
    if (!persisted || latest !== snapshot) saveTimelineQuietly(next, 'AI edit');
    return { before: latest, after: next };
  };

  // Save-queue outcomes for the open timeline (B-04): another writer's changes merged into ours,
  // a conflict we couldn't resolve (show the server copy, with a notice), or a deleted timeline.
  useEffect(() => {
    const onSaveSync = (event) => {
      const info = event?.detail || {};
      const isOpen = (prev) => prev && String(prev.id) === String(info.id);
      if (info.type === 'merged' && info.merged) {
        setCurrentTimeline((prev) => {
          if (!isOpen(prev)) return prev;
          // Edits made while the save was in flight are kept on top of the merged copy.
          return prev === info.sent ? info.merged : mergeTimelineThreeWay(info.sent, prev, info.merged, { prefer: 'local' });
        });
      } else if (info.type === 'reloaded' && info.latest) {
        let replaced = false;
        setCurrentTimeline((prev) => {
          if (!isOpen(prev)) return prev;
          replaced = true;
          return { ...info.latest, isOwner: info.latest.isOwner ?? prev.isOwner, isShared: info.latest.isShared ?? prev.isShared };
        });
        if (replaced) setErrorMessage(t('app.timelineChangedElsewhere'));
      } else if (info.type === 'gone') {
        let affected = false;
        setCurrentTimeline((prev) => {
          if (!isOpen(prev) || prev.isOwner === false) return prev;
          affected = true;
          return { ...prev, isOwner: false };
        });
        if (affected) setErrorMessage(t('app.timelineDeletedElsewhere'));
      }
    };
    // The Saved list renames / pins the open timeline through this copy, so it can't be reverted.
    const onMetaChange = (event) => {
      const detail = event?.detail;
      const prev = currentTimelineStateRef.current;
      if (!detail || !prev || String(prev.id) !== String(detail.id) || prev.isOwner === false) return;
      const next = { ...prev, ...(detail.changes || {}) };
      setCurrentTimeline(next);
      detail.handled = true;
      detail.promise = saveTimeline(next);
    };
    window.addEventListener(TIMELINE_SAVE_SYNC_EVENT, onSaveSync);
    window.addEventListener(TIMELINE_META_CHANGE_EVENT, onMetaChange);
    return () => {
      window.removeEventListener(TIMELINE_SAVE_SYNC_EVENT, onSaveSync);
      window.removeEventListener(TIMELINE_META_CHANGE_EVENT, onMetaChange);
    };
  }, [setCurrentTimeline, t]);

  // Handle refinement with AI
  const handleRefine = async (instruction) => {
    if (!currentTimeline) return;
    if (refineAbortControllerRef.current) {
      refineAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    refineAbortControllerRef.current = controller;

    setIsRefining(true);
    setErrorMessage(null);

    const snapshot = currentTimelineStateRef.current || currentTimeline;
    const targetTimelineId = snapshot?.id ?? null;
    activeRefineSnapshotRef.current = snapshot;
    try {
      const updated = await refineTimeline(
        snapshot,
        instruction,
        controller.signal,
        (jobId) => {
          activeRefineJobIdRef.current = jobId;
          refreshQuota();
          try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch { }
        },
        contentMode,
      );
      activeRefineJobIdRef.current = null;
      if (currentTimelineIdRef.current !== targetTimelineId) {
        return;
      }
      applyAiTimelineResult(snapshot, updated, updated?.persisted !== false);
      setIsAiRefineOpen(false);
      triggerCelebration();
    } catch (err) {
      activeRefineJobIdRef.current = null;
      if (err.name === 'AbortError' || controller.signal.aborted) {
        console.log('Refinement stopped by user.');
        return;
      }
      console.error('Refinement failed:', err);
      setErrorMessage(err.message || t('app.failedRefine'));
      if (err.message && (err.message.includes('Authentication') || (err.message.includes('sign in') && !isGuest))) {
        handleOpenAuth('signin');
      }
    } finally {
      activeRefineJobIdRef.current = null;
      if (refineAbortControllerRef.current === controller) {
        refineAbortControllerRef.current = null;
        activeRefineSnapshotRef.current = null;
      }
      setIsRefining(false);
    }
  };

  // ---- Timeline chat ("Talk to the timeline") ----
  const chatStorageKey = currentTimeline?.id ? `chronix_chat_${currentTimeline.id}` : null;
  // Older builds kept whole-timeline undo snapshots (often multi-MB with photos) here; undo is now
  // in memory only, so this key is just cleaned up.
  const chatUndoStorageKey = currentTimeline?.id ? `chronix_chat_undo_${currentTimeline.id}` : null;

  const chatTimelineId = currentTimeline?.id || null;
  const canSyncChat = Boolean(user && chatTimelineId && currentTimeline?.isOwner !== false);

  const flushServerChatSave = useCallback(() => {
    clearTimeout(chatSaveTimerRef.current);
    const pending = chatPendingSaveRef.current;
    chatPendingSaveRef.current = null;
    if (!pending) return;
    saveTimelineChat(pending.id, pending.payload)
      .then(() => {
        if (chatSyncRef.current.id === pending.id) chatSyncRef.current.lastSent = pending.json;
      })
      .catch((err) => console.warn('Failed to save chat to server:', err));
  }, []);

  // Load a persisted conversation (and its undo snapshots) when the active timeline changes.
  useEffect(() => {
    // Don't lose a debounced save for the timeline we're leaving.
    flushServerChatSave();
    chatSyncRef.current = { id: chatTimelineId, enabled: false, lastSent: null };

    // Undo never carries over to another timeline (or a reload): only the latest edit made here is undoable.
    setChatUndoEntry((entry) => (entry && String(entry.timelineId) === String(chatTimelineId) ? entry : null));
    if (!chatStorageKey) {
      setChatMessages([]);
      return;
    }
    if (chatUndoStorageKey) {
      try { localStorage.removeItem(chatUndoStorageKey); } catch { }
    }
    const withoutUndoFlags = (list) => list.map(({ canUndo, ...m }) => m);
    try {
      const raw = localStorage.getItem(chatStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setChatMessages(Array.isArray(parsed) ? withoutUndoFlags(parsed) : []);
    } catch {
      setChatMessages([]);
    }

    if (!canSyncChat) return;
    let cancelled = false;
    fetchTimelineChat(chatTimelineId)
      .then((res) => {
        if (cancelled || !Array.isArray(res?.messages)) return;
        const serverMessages = res.messages;
        const serverIds = new Set(serverMessages.map((m) => m.id));
        const serverTime = res.updatedAt ? Date.parse(res.updatedAt) || 0 : null;
        chatSyncRef.current.enabled = true;
        chatSyncRef.current.lastSent = serverTime === null ? null : JSON.stringify(serializeChatMessages(serverMessages));
        // Server copy wins; keep local-only messages newer than it (unsynced or sent while loading).
        // No server row yet (serverTime null) -> keep the whole local conversation and upload it.
        setChatMessages((prev) => {
          if (serverTime === null) return prev;
          const localOnly = prev.filter((m) => !serverIds.has(m.id) && getChatMessageTime(m) > serverTime);
          return withoutUndoFlags([...serverMessages, ...localOnly]);
        });
        setChatSyncVersion((v) => v + 1);
      })
      .catch((err) => console.warn('Failed to load chat from server:', err));
    return () => {
      cancelled = true;
    };
  }, [chatStorageKey, chatUndoStorageKey, chatTimelineId, canSyncChat, flushServerChatSave]);

  // Persist the conversation (without volatile flags) per timeline, locally and to the server.
  useEffect(() => {
    if (!chatStorageKey) return;
    const payload = serializeChatMessages(chatMessages);
    try {
      localStorage.setItem(chatStorageKey, JSON.stringify(payload));
    } catch {
      // ignore quota/serialization errors
    }

    const sync = chatSyncRef.current;
    if (!sync.enabled || !sync.id) return;
    const json = JSON.stringify(payload);
    if (json === sync.lastSent) return;
    // Don't create empty server rows for timelines that were never chatted with.
    if (sync.lastSent === null && payload.length === 0) return;
    chatPendingSaveRef.current = { id: sync.id, payload, json };
    clearTimeout(chatSaveTimerRef.current);
    chatSaveTimerRef.current = setTimeout(flushServerChatSave, CHAT_SERVER_SAVE_DELAY_MS);
  }, [chatMessages, chatStorageKey, chatSyncVersion, flushServerChatSave]);

  // Push a pending chat save before the page goes away.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushServerChatSave();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [flushServerChatSave]);

  // Stops a chat turn or a chat file attach: both are server jobs, so Stop cancels the job (B-09).
  const handleChatStop = useCallback(async () => {
    const jobId = activeChatJobIdRef.current;
    const snapshot = activeChatSnapshotRef.current;
    if (chatAbortControllerRef.current) {
      chatAbortControllerRef.current.abort();
      chatAbortControllerRef.current = null;
    }
    activeChatJobIdRef.current = null;
    activeChatSnapshotRef.current = null;
    setIsChatBusy(false);
    if (jobId) {
      const cancelResponse = await cancelAiJob(jobId);
      refreshQuota();
      try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch { }
      await applyResultSavedDespiteStop(snapshot, cancelResponse);
    }
  }, [refreshQuota]);

  const handleChatSend = async (text, grounding = isDefaultGroundingEnabled(), inputMethod = 'typed') => {
    if (!currentTimeline || !text?.trim() || isChatBusy) return;
    markChatAdopted();

    if (chatAbortControllerRef.current) {
      chatAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    chatAbortControllerRef.current = controller;

    const userMsg = { id: `u-${Date.now()}`, role: 'user', content: text.trim() };
    const history = chatMessages.map((m) => ({ role: m.role, content: m.content }));
    setChatMessages((prev) => [...prev, userMsg]);
    setIsChatBusy(true);

    const snapshot = currentTimelineStateRef.current || currentTimeline;
    const targetTimelineId = snapshot?.id ?? null;
    activeChatSnapshotRef.current = snapshot;
    try {
      const res = await chatWithTimeline(
        snapshot,
        text.trim(),
        history,
        grounding,
        controller.signal,
        (jobId) => {
          activeChatJobIdRef.current = jobId;
          refreshQuota();
          try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch { }
        },
        contentMode,
        inputMethod,
      );
      // No success-path quota refresh: the chat job was charged (and refreshed) when it started.
      activeChatJobIdRef.current = null;
      if (currentTimelineIdRef.current !== targetTimelineId) {
        return;
      }
      const assistantId = `a-${Date.now()}`;
      const isEdit = res.action === 'edit' && res.updated_timeline;

      if (isEdit) {
        // Apply the edit to the latest state; remember the state just before it for undo.
        const applied = applyAiTimelineResult(snapshot, res.updated_timeline, res.persisted !== false);
        setChatUndoEntry(applied
          ? createChatUndoEntry({ messageId: assistantId, timelineId: targetTimelineId, before: applied.before, after: applied.after })
          : null);
        triggerCelebration();
      }

      setChatMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: 'assistant',
          // A recovered edit (job result lost, saved timeline reloaded) has no reply text.
          content: res.reply || (res.recovered ? t('chat.updated') : ''),
          action: res.action,
          sources: res.grounding?.sources || null,
          isRelevant: res.is_relevant !== false,
          model: res.model || null,
        },
      ]);
    } catch (err) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        return;
      }
      console.error('Chat failed:', err);
      setChatMessages((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: 'assistant', content: err.message || t('chat.error'), error: true },
      ]);
      if (err.message && (err.message.includes('Authentication') || err.message.includes('sign in'))) {
        handleOpenAuth('signin');
      }
    } finally {
      if (chatAbortControllerRef.current === controller) {
        chatAbortControllerRef.current = null;
        activeChatJobIdRef.current = null;
        activeChatSnapshotRef.current = null;
      }
      setIsChatBusy(false);
    }
  };

  // Chat-attached files: extracts new events from uploaded photos/PDFs and merges them
  // into the current timeline (counts as one refinement, same as a text edit instruction).
  const handleChatSendFiles = async (files, text = '', inputMethod = 'typed') => {
    if (!currentTimeline || !files?.length || isChatBusy) return;
    markChatAdopted();

    if (chatAbortControllerRef.current) {
      chatAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    chatAbortControllerRef.current = controller;

    const userMsg = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text?.trim() || t('chat.filesAttachedMessage', { count: files.length }),
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setIsChatBusy(true);

    const snapshot = currentTimelineStateRef.current || currentTimeline;
    const targetTimelineId = snapshot?.id ?? null;
    activeChatSnapshotRef.current = snapshot;
    try {
      const res = await chatAttachFilesToTimeline(
        snapshot,
        files,
        text?.trim() || '',
        controller.signal,
        contentMode,
        inputMethod,
        (jobId) => {
          activeChatJobIdRef.current = jobId;
          // Credits are charged when the job is accepted.
          refreshQuota();
          try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch { }
        },
      );
      activeChatJobIdRef.current = null;
      if (currentTimelineIdRef.current !== targetTimelineId) {
        return;
      }
      const assistantId = `a-${Date.now()}`;
      const isEdit = res.action === 'edit' && res.updated_timeline;

      if (isEdit) {
        const applied = applyAiTimelineResult(snapshot, res.updated_timeline, res.persisted !== false);
        setChatUndoEntry(applied
          ? createChatUndoEntry({ messageId: assistantId, timelineId: targetTimelineId, before: applied.before, after: applied.after })
          : null);
        triggerCelebration();
      }

      setChatMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: 'assistant',
          content: res.reply || '',
          action: res.action,
          model: res.model || null,
        },
      ]);
    } catch (err) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        return;
      }
      console.error('Chat file attach failed:', err);
      setChatMessages((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: 'assistant', content: err.message || t('chat.error'), error: true },
      ]);
      if (err.message && (err.message.includes('Authentication') || err.message.includes('sign in'))) {
        handleOpenAuth('signin');
      }
    } finally {
      if (chatAbortControllerRef.current === controller) {
        chatAbortControllerRef.current = null;
        activeChatJobIdRef.current = null;
        activeChatSnapshotRef.current = null;
      }
      setIsChatBusy(false);
    }
  };

  // Only the latest edit is undoable, and only while the timeline is unchanged since it (B-08).
  const undoableChatMessage = useMemo(
    () => undoableChatMessageId(chatUndoEntry, currentTimeline),
    [chatUndoEntry, currentTimeline]
  );
  const chatMessagesWithUndo = useMemo(
    () => chatMessages.map((m) => {
      const canUndo = m.id === undoableChatMessage && !m.undone;
      return Boolean(m.canUndo) === canUndo ? m : { ...m, canUndo };
    }),
    [chatMessages, undoableChatMessage]
  );

  const handleChatUndo = (messageId) => {
    const current = currentTimelineStateRef.current;
    const entry = chatUndoEntry;
    if (!entry || entry.messageId !== messageId || undoableChatMessageId(entry, current) !== messageId) return;
    const restored = {
      ...restoreSnapshotMedia(entry.snapshot, current),
      isOwner: current.isOwner,
      isShared: current.isShared,
      updatedAt: current.updatedAt,
    };
    setCurrentTimeline(restored);
    saveTimelineQuietly(restored, 'chat undo');
    setChatUndoEntry(null);
    setChatMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, undone: true, canUndo: false } : m))
    );
  };

  const handleChatClear = () => {
    setChatMessages([]);
    setChatUndoEntry(null);
    if (chatStorageKey) {
      try { localStorage.removeItem(chatStorageKey); } catch { }
    }
    if (chatUndoStorageKey) {
      try { localStorage.removeItem(chatUndoStorageKey); } catch { }
    }
  };

  // Open the chat pre-seeded with a question about a specific event.
  const handleAskAiAboutEvent = (article) => {
    if (!article) return;
    setChatSeed(t('chat.askEventSeed', { title: article.title }));
    setIsChatOpen(true);
  };

  // ---- Chat discovery teaser: a one-off speech bubble by the chat launcher ----
  const [isChatTeaserOpen, setIsChatTeaserOpen] = useState(false);
  const devTeaserSeenRef = useRef(new Set());
  const chatSuggestions = useMemo(() => getChatSuggestions(currentTimeline, t, contentMode), [currentTimeline, t, contentMode]);
  const teaserTimelineId = currentTimeline?.id ?? null;
  const canShowChatTeaser = Boolean(
    teaserTimelineId &&
    (currentTimeline?.articles?.length ?? 0) > 0 &&
    currentTimeline?.isOwner !== false &&
    !isChatOpen && !isGuideOpen && !isLoading &&
    !(isNarrowViewport && (isOverviewOpen || isCardsListOpen)) &&
    !isSettingsOpen && !isSavedModalOpen && !isStoryStudioOpen && !isAuthModalOpen && !isAboutModalOpen && !isCommunityModalOpen && !isAdminPanelOpen && !isLibraryModalOpen
  );

  useEffect(() => {
    if (isChatOpen) setIsChatTeaserOpen(false);
  }, [isChatOpen]);

  useEffect(() => {
    if (!canShowChatTeaser) {
      setIsChatTeaserOpen(false);
      return undefined;
    }
    // Shown once per timeline, after the user has been idle on it for a while.
    const timelineKey = String(teaserTimelineId);
    if (CHAT_TEASER_LIMITS_ENABLED
      ? (isChatTeaserRetired() || readTeaserSeen().includes(timelineKey))
      : devTeaserSeenRef.current.has(timelineKey)) return undefined;
    const timer = setTimeout(() => {
      const anchor = document.getElementById('guide-chat-bubble');
      if (!anchor || anchor.getBoundingClientRect().width === 0) return;
      devTeaserSeenRef.current.add(timelineKey);
      try {
        const seen = readTeaserSeen().filter((id) => id !== timelineKey);
        seen.push(timelineKey);
        localStorage.setItem(CHAT_TEASER_SEEN_KEY, JSON.stringify(seen.slice(-CHAT_TEASER_SEEN_MAX)));
      } catch { }
      setIsChatTeaserOpen(true);
    }, CHAT_TEASER_IDLE_MS);
    return () => clearTimeout(timer);
  }, [canShowChatTeaser, teaserTimelineId]);

  // Used by the teaser and the overview panel: prefill (never auto-send) so edits are reviewed first.
  const handleChatStarterPick = (text) => {
    setIsChatTeaserOpen(false);
    if (isNarrowViewport && isOverviewOpen) setPanelHistory(EMPTY_PANEL_HISTORY);
    setChatSeed(text);
    setIsChatOpen(true);
  };

  // ---- Timeline edit handlers ----
  // Every handler below builds the next state from the *latest* timeline (commitTimelineChange),
  // guarded by the id of the timeline the action started on, and saves through the save queue
  // (B-04). Long-running ones (AI images, video searches) can't revert other edits or jump back
  // to a timeline the user already left, and no article object is mutated in place.

  // Handle saving an edited/new event
  const handleSaveEvent = async (savedArticle) => {
    if (!currentTimeline || currentTimeline.isOwner === false) return;
    const { newLane, ...articleToStore } = savedArticle;
    let replacedExisting = false;

    const next = commitTimelineChange(currentTimeline.id, (prev) => {
      // If the event introduced a brand-new topic/lane, register it on the timeline.
      // Preserve `lanes` reference when unchanged so non-structural event edits
      // (e.g. AI image generation or gallery/extract edits) do not rebuild the canvas.
      let updatedLanes = prev.lanes;
      if (newLane && !(updatedLanes || []).some((l) => l.id === newLane.id)) {
        const baseLanes = updatedLanes || [];
        updatedLanes = [
          ...baseLanes,
          {
            id: newLane.id,
            title: newLane.title,
            color: DEFAULT_LANE_COLORS[baseLanes.length % DEFAULT_LANE_COLORS.length],
            order: baseLanes.length + 1,
          },
        ];
      }

      const updatedArticles = [...(prev.articles || [])];
      const index = updatedArticles.findIndex((a) => isSameArticleId(a.id, articleToStore.id));
      replacedExisting = index >= 0;
      if (replacedExisting) {
        updatedArticles[index] = articleToStore;
      } else {
        updatedArticles.push(articleToStore);
      }

      // Sort chronologically (down to the minute for same-day events)
      updatedArticles.sort(compareArticlesByStart);
      return { ...prev, lanes: updatedLanes, articles: updatedArticles };
    });
    if (!next) return;

    // The memoized canvas keeps its own article objects: push the new fields to it directly.
    if (replacedExisting) timelineRef.current?.setArticleImage?.(articleToStore.id, articleToStore);
    setSelectedArticle((previous) => (
      previous && isSameArticleId(previous.id, articleToStore.id) ? articleToStore : previous
    ));
    await saveTimelineQuietly(next, 'event edit');
  };

  // Replaces fields on one event of the timeline `targetId`. `fieldsOrBuilder` is an object, or a
  // function of the latest version of the event returning the fields (null = nothing to change).
  const updateEventFields = (targetId, articleId, fieldsOrBuilder) => {
    let fields = null;
    const next = commitTimelineChange(targetId, (prev) => {
      const article = prev.articles?.find((a) => isSameArticleId(a.id, articleId));
      if (!article) return null;
      fields = typeof fieldsOrBuilder === 'function' ? fieldsOrBuilder(article) : fieldsOrBuilder;
      if (!fields) return null;
      return {
        ...prev,
        articles: prev.articles.map((a) => (isSameArticleId(a.id, articleId) ? { ...a, ...fields } : a)),
      };
    });
    if (!next) return null;
    setSelectedArticle((previous) => (
      previous && isSameArticleId(previous.id, articleId) ? { ...previous, ...fields } : previous
    ));
    return { next, fields };
  };

  // "Not this place" / "Not related": a wrong Wikipedia link goes (a place link from every event at
  // that place) and is remembered, so a later "Find Wikipedia links" never brings it back.
  const handleDismissContextLink = async (url, eventId = null) => {
    if (!currentTimeline || currentTimeline.isOwner === false) return;
    const next = commitTimelineChange(currentTimeline.id, (prev) => dismissContextLink(prev, url, eventId));
    if (!next) return;
    setSelectedArticle((previous) => (
      previous ? (next.articles.find((a) => isSameArticleId(a.id, previous.id)) || previous) : previous
    ));
    await saveTimelineQuietly(next, 'removed Wikipedia link');
  };

  // Wikipedia links (places, checked historical events) and, when asked, illustrative pictures of
  // places for a personal timeline's events. Runs in the background after the Story Studio creates or
  // saves a timeline (new events only), or from the Overview panel (`force`: every event again).
  const [enrichStatus, setEnrichStatus] = useState(null);
  const runPersonalEnrichment = useCallback(async (timelineId, { images = false, history = true, force = false, source = null } = {}) => {
    const tl = source || currentTimelineStateRef.current;
    if (!tl || String(tl.id) !== String(timelineId) || tl.isOwner === false || !tl.isPersonal) return;
    const events = eventsForEnrichment(tl.articles, { force });
    if (!events.length) {
      setEnrichStatus({ timelineId, status: 'done', links: 0, images: 0 });
      return;
    }
    setEnrichStatus({ timelineId, status: 'running' });
    try {
      const result = await enrichPersonalTimeline({
        events, lang: tl.detectedLanguage || language, images, history, timelineId, contentMode,
      });
      // Not an answer from the enrichment service: mark nothing (the events stay "not checked").
      if (!result || typeof result.links !== 'object' || result.links === null) throw new Error('unexpected response');
      const sentIds = events.map((e) => e.id);
      let changedImages = [];
      const next = commitTimelineChange(timelineId, (prev) => {
        const articles = applyEnrichment(prev.articles, result, sentIds, prev.dismissedLinks);
        if (!articles) return null;
        changedImages = articles.filter((a, i) => a.imageUrl !== prev.articles[i]?.imageUrl);
        return { ...prev, articles };
      });
      if (next) {
        // The memoized canvas keeps its own article objects: push new covers to it directly.
        for (const art of changedImages) timelineRef.current?.setArticleImage?.(art.id, art);
        setSelectedArticle((previous) => (
          previous ? (next.articles.find((a) => isSameArticleId(a.id, previous.id)) || previous) : previous
        ));
        await saveTimelineQuietly(next, 'Wikipedia links');
      }
      if (result?.credits) notifyQuotaChanged();
      setEnrichStatus({
        timelineId,
        status: 'done',
        links: Object.values(result?.links || {}).reduce((n, l) => n + l.length, 0),
        images: Object.keys(result?.images || {}).length,
        historySkipped: result?.historySkipped || null,
      });
    } catch (err) {
      console.warn('Wikipedia enrichment failed:', err);
      setEnrichStatus({ timelineId, status: 'error', message: err?.message || '' });
    }
  }, [commitTimelineChange, contentMode, language, saveTimelineQuietly]);

  // "What was happening in the world": a general timeline for the same years and places, generated
  // like any other and laid over this one as a layer (the usual read-only merged view).
  const [worldLayerStatus, setWorldLayerStatus] = useState(null);
  const handleAddWorldEventsLayer = async () => {
    const tl = currentTimelineStateRef.current;
    const subject = worldEventsSubject(tl);
    if (!tl || !subject || worldLayerStatus?.status === 'running') return;
    const lang = tl.detectedLanguage || language;
    setWorldLayerStatus({ timelineId: tl.id, status: 'running' });
    try {
      const data = await generateTimeline(worldEventsPrompt(subject, lang), '', null, isDefaultGroundingEnabled(), null, contentMode, 'typed');
      if (!data?.articles?.length) throw new Error(t('app.emptyTimelineError'));
      refreshQuota();
      const saved = await saveTimeline(data);
      const stillHere = currentTimelineStateRef.current && String(currentTimelineStateRef.current.id) === String(tl.id);
      setWorldLayerStatus({ timelineId: tl.id, status: 'done', layerId: saved?.id ?? data.id });
      window.dispatchEvent(new Event(TIMELINES_UPDATED_EVENT));
      if (stillHere) await handleAddLayerTimeline(saved?.id ?? data.id);
    } catch (err) {
      refreshQuota();
      console.warn('World events layer failed:', err);
      setWorldLayerStatus({ timelineId: tl.id, status: 'error', message: err?.message || t('app.failedGenerate') });
    }
  };

  const handleSaveImagePosition = async (articleId, { x, y }) => {
    if (!currentTimeline || currentTimeline.isOwner === false) return;
    const updated = updateEventFields(currentTimeline.id, articleId, { imagePositionX: x, imagePositionY: y });
    if (!updated) return;
    timelineRef.current?.setArticleImagePosition?.(articleId, { x, y });
    await saveTimelineQuietly(updated.next, 'image position');
  };

  const handleSaveEventImage = async (articleId, imageUrl, imageSource = 'ai', imageModel = null, imageCostUsd = null) => {
    if (!currentTimeline || currentTimeline.isOwner === false || !imageUrl) return;
    // `currentTimeline` is the one the image was requested on (this handler's render); the image
    // lands on that timeline's latest state, or nowhere if the user has moved on.
    await persistEventImageFields(articleId, (articleToUpdate) => {
      const existingAdditional = normalizeAdditionalImages(articleToUpdate.additionalImages);
      const oldCoverUrl = typeof articleToUpdate.imageUrl === 'string' ? articleToUpdate.imageUrl.trim() : '';
      const oldCoverSource = articleToUpdate.imageSource || '';
      const oldCoverModel = articleToUpdate.imageModel || '';
      const oldCoverCost = Number(articleToUpdate.imageCostUsd) > 0 ? Number(articleToUpdate.imageCostUsd) : null;
      const nextAdditionalImages = (oldCoverUrl && oldCoverUrl !== imageUrl && !existingAdditional.some((img) => img.url === oldCoverUrl))
        ? [
            {
              url: oldCoverUrl,
              caption: articleToUpdate.title || '',
              ...(oldCoverSource ? { imageSource: oldCoverSource } : {}),
              ...(oldCoverModel ? { imageModel: oldCoverModel } : {}),
              ...(oldCoverCost ? { imageCostUsd: oldCoverCost } : {}),
            },
            ...existingAdditional,
          ]
        : existingAdditional;

      return {
        imageUrl,
        imageSource,
        imageModel: imageSource === 'ai' ? (imageModel || undefined) : undefined,
        imageCostUsd: imageSource === 'ai' && Number(imageCostUsd) > 0 ? Number(imageCostUsd) : undefined,
        mediaType: 'image',
        imagePositionX: undefined,
        imagePositionY: undefined,
        additionalImages: nextAdditionalImages,
      };
    }, currentTimeline.id);
  };

  // Applies image fields (or a builder of them from the latest event) to an event of the timeline
  // `targetId` (canvas, open drawer, state) and saves.
  const persistEventImageFields = async (articleId, fieldsOrBuilder, targetId = currentTimeline?.id) => {
    if (!currentTimeline || currentTimeline.isOwner === false) return;
    const updated = updateEventFields(targetId, articleId, fieldsOrBuilder);
    if (!updated) return;
    timelineRef.current?.setArticleImage?.(articleId, updated.fields);
    await saveTimelineQuietly(updated.next, 'generated event image');
  };

  // Assigns a Photo Tray photo (object or tray id) as an event's cover; the previous cover is
  // kept in the event's additional images by handleSaveEventImage. Remembers a snapshot for Undo.
  const handleAssignTrayPhoto = async (articleId, photoOrId) => {
    const photo = typeof photoOrId === 'object' && photoOrId
      ? photoOrId
      : trayPhotos.find((p) => p.id === photoOrId);
    const article = currentTimeline?.articles?.find((a) => isSameArticleId(a.id, articleId));
    if (!photo || !article || currentTimeline?.isOwner === false) return;
    setLastTrayAssignment({ articleId: article.id, photoId: photo.id, snapshot: snapshotImageFields(article) });
    setTrayPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, assignedTo: article.id } : p)));
    await handleSaveEventImage(article.id, photo.dataUrl, 'upload');
  };

  const handleUndoTrayAssignment = async () => {
    if (!lastTrayAssignment) return;
    const { articleId, photoId, snapshot } = lastTrayAssignment;
    setLastTrayAssignment(null);
    setTrayPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, assignedTo: undefined } : p)));
    await persistEventImageFields(articleId, snapshot);
  };

  // Applies an edit from the Edit Timeline panel (details, overview, lanes, topics, bulk events)
  // and keeps the previous timeline state for single-step Undo.
  // `meta.base` is the copy the editor computed `nextTimeline` from: only its changes are applied, so
  // an AI image or other change that landed while the editor was open is kept (B-04).
  const handleApplyTimelineEdit = async (nextTimeline, meta = {}) => {
    if (!currentTimeline || currentTimeline.isOwner === false || !nextTimeline) return;
    if (!Array.isArray(nextTimeline.articles) || nextTimeline.articles.length === 0) {
      // The server refuses a timeline with no events (B-18): offer deleting it instead.
      await offerDeleteEmptyTimeline();
      return;
    }
    let previousState = null;
    const next = commitTimelineChange(nextTimeline.id, (prev) => {
      previousState = prev;
      return applyEditToLatest(meta.base || null, prev, nextTimeline, {
        removedIds: meta.removedEventIds,
        compare: compareArticlesByStart,
      });
    });
    if (!next) return;
    setLastTimelineEditSnapshot(previousState);
    if (Array.isArray(meta.removedEventIds) && meta.removedEventIds.length) {
      const removed = new Set(meta.removedEventIds.map(String));
      const nextPanelHistory = removePanelEntries(
        panelHistory,
        (entry) => entry.kind === 'event' && removed.has(String(entry.id))
      );
      if (nextPanelHistory !== panelHistory) {
        setPanelHistory(nextPanelHistory);
      }
    }
    await saveTimelineQuietly(next, 'timeline edit');
  };

  const handleUndoTimelineEdit = async () => {
    if (!lastTimelineEditSnapshot || currentTimeline?.isOwner === false) return;
    const restored = lastTimelineEditSnapshot;
    setLastTimelineEditSnapshot(null);
    const next = commitTimelineChange(restored.id, () => restored);
    if (next) await saveTimelineQuietly(next, 'undone timeline edit');
  };

  const handleSetEventCoverImage = async (articleId, additionalIndex) => {
    if (!currentTimeline || currentTimeline.isOwner === false) return;
    const updated = updateEventFields(currentTimeline.id, articleId, (articleToUpdate) => {
      const existingAdditional = normalizeAdditionalImages(articleToUpdate.additionalImages);
      const selected = existingAdditional[additionalIndex];
      if (!selected?.url) return null;

      const oldCoverUrl = typeof articleToUpdate.imageUrl === 'string' ? articleToUpdate.imageUrl.trim() : '';
      const oldCoverSource = articleToUpdate.imageSource || '';
      const nextAdditionalImages = existingAdditional.filter((_, i) => i !== additionalIndex);
      if (oldCoverUrl && oldCoverUrl !== selected.url && !nextAdditionalImages.some((img) => img.url === oldCoverUrl)) {
        nextAdditionalImages.unshift({
          url: oldCoverUrl,
          caption: articleToUpdate.title || '',
          ...(oldCoverSource ? { imageSource: oldCoverSource } : {}),
        });
      }

      const lowerUrl = selected.url.toLowerCase();
      return {
        imageUrl: selected.url,
        imageSource: selected.imageSource || undefined,
        imageModel: selected.imageModel || undefined,
        imageCostUsd: selected.imageCostUsd || undefined,
        mediaType: (lowerUrl.endsWith('.gif') || lowerUrl.includes('.gif?')) ? 'gif' : 'image',
        imagePositionX: undefined,
        imagePositionY: undefined,
        additionalImages: nextAdditionalImages,
      };
    });
    if (!updated) return;
    timelineRef.current?.setArticleImage?.(articleId, updated.fields);
    await saveTimelineQuietly(updated.next, 'event cover image');
  };

  // Saves a photo made in the app (the event-drawer collage) on the event: appended to its
  // additional photos, or made the main image (the old main image moves into the photos).
  const handleAddEventPhoto = async (articleId, url, { asCover = false, caption = '', imageSource = 'collage' } = {}) => {
    if (!url || !currentTimeline || currentTimeline.isOwner === false) return;
    const updated = updateEventFields(currentTimeline.id, articleId, (articleToUpdate) => {
      const existingAdditional = normalizeAdditionalImages(articleToUpdate.additionalImages);
      const oldCoverUrl = typeof articleToUpdate.imageUrl === 'string' ? articleToUpdate.imageUrl.trim() : '';
      if (asCover || !oldCoverUrl) {
        const nextAdditionalImages = [...existingAdditional];
        if (oldCoverUrl && !nextAdditionalImages.some((img) => img.url === oldCoverUrl)) {
          nextAdditionalImages.unshift({
            url: oldCoverUrl,
            caption: articleToUpdate.title || '',
            ...(articleToUpdate.imageSource ? { imageSource: articleToUpdate.imageSource } : {}),
          });
        }
        return {
          imageUrl: url,
          imageSource,
          imageModel: undefined,
          imageCostUsd: undefined,
          mediaType: 'image',
          imagePositionX: undefined,
          imagePositionY: undefined,
          additionalImages: nextAdditionalImages,
        };
      }
      return { additionalImages: [...existingAdditional, { url, caption, imageSource }] };
    });
    if (!updated) return;
    if ('imageUrl' in updated.fields) timelineRef.current?.setArticleImage?.(articleId, updated.fields);
    await saveTimelineQuietly(updated.next, 'event photo');
  };

  // Saves Videos-tab search results on the event so it is never searched (and billed) again.
  // The Videos tab caches its search results on the event: stored only when the list changed, and
  // saved debounced (P-10), so opening tabs doesn't save the whole timeline each time.
  const videoSaveDebouncerRef = useRef(null);
  if (!videoSaveDebouncerRef.current) {
    videoSaveDebouncerRef.current = createDebouncedTimelineSaver((latest) => {
      if (latest.isOwner === false || isPartialTimeline(latest)) return;
      saveTimeline(latest).catch((err) => console.warn('Failed to save event videos:', err));
    });
  }
  useEffect(() => () => videoSaveDebouncerRef.current?.cancelAll(), []);

  const handleSaveEventVideos = (articleId, query, items) => {
    if (!currentTimeline || currentTimeline.isOwner === false) return;
    const updated = updateEventFields(currentTimeline.id, articleId, (articleToUpdate) => (
      videosChanged(articleToUpdate, query, items) ? { videos: items, videosQuery: query } : null
    ));
    if (!updated) return;
    videoSaveDebouncerRef.current.schedule(updated.next.id, () => currentTimelineStateRef.current);
  };

  // Rename the current timeline (used by the Overview panel and Saved/Personal Timelines list)
  const handleRenameTimeline = async (newTitle) => {
    if (!currentTimeline || currentTimeline.isOwner === false) return;
    const trimmed = (newTitle || '').trim();
    if (!trimmed) return;
    const next = commitTimelineChange(currentTimeline.id, (prev) => (
      trimmed === prev.title ? null : { ...prev, title: trimmed }
    ));
    if (next) await saveTimelineQuietly(next, 'renamed timeline');
  };

  // Rename a topic (category) or track (lane) from the LeftDockMenu filter popover
  const handleRenameFilterItem = async (dimension, item, newName) => {
    if (!currentTimeline || currentTimeline.isOwner === false) return;
    const trimmedNew = (newName || '').trim();
    if (!trimmedNew || !item) return;

    if (dimension === 'category') {
      const oldCategory = item.name || item.id;
      if (oldCategory === trimmedNew) return;

      const oldKey = oldCategory.toLowerCase();
      const next = commitTimelineChange(currentTimeline.id, (prev) => ({
        ...prev,
        articles: (prev.articles || []).map((art) => (
          (art.category ?? '').toString().trim().toLowerCase() === oldKey ? { ...art, category: trimmedNew } : art
        )),
      }));
      if (!next) return;

      setSelectedArticle((prev) => (
        prev && (prev.category ?? '').toString().trim().toLowerCase() === oldKey ? { ...prev, category: trimmedNew } : prev
      ));

      // If this category was part of the active filter, keep it selected under the new name
      if (timelineFilter?.categoryItems?.length) {
        const updatedCatFilters = timelineFilter.categoryItems.map((c) => {
          const cId = typeof c === 'object' ? c.id : c;
          if (String(cId).toLowerCase() === oldKey) {
            return typeof c === 'object' ? { ...c, id: trimmedNew, name: trimmedNew } : trimmedNew;
          }
          return c;
        });
        setTimelineFilter((prev) => (prev ? { ...prev, categoryItems: updatedCatFilters } : prev));
      }

      await saveTimelineQuietly(next, 'category rename');
    } else if (dimension === 'lane') {
      const oldLaneId = String(item.id);
      const oldLaneName = item.name;
      if (oldLaneName === trimmedNew) return;

      const next = commitTimelineChange(currentTimeline.id, (prev) => ({
        ...prev,
        lanes: (prev.lanes || []).map((l, idx) => {
          const matches =
            String(l.id ?? l.title ?? idx) === oldLaneId ||
            (l.id && String(l.id) === oldLaneId) ||
            (l.title && l.title === oldLaneName);
          if (matches) {
            return {
              ...l,
              title: trimmedNew,
              ...(l.name ? { name: trimmedNew } : {}),
              ...(l.id === oldLaneName ? { id: trimmedNew } : {}),
            };
          }
          return l;
        }),
        // Update articles that reference this lane by title
        articles: (prev.articles || []).map((art) => (art.lane === oldLaneName ? { ...art, lane: trimmedNew } : art)),
      }));
      if (!next) return;

      setSelectedArticle((prev) => (prev && prev.lane === oldLaneName ? { ...prev, lane: trimmedNew } : prev));

      // If this lane was part of the active filter, keep it selected under the new title
      if (timelineFilter?.laneItems?.length) {
        const updatedLaneFilters = timelineFilter.laneItems.map((l) => {
          const lId = typeof l === 'object' ? l.id : l;
          if (String(lId) === oldLaneId || String(lId) === oldLaneName) {
            return typeof l === 'object' ? { ...l, name: trimmedNew } : l;
          }
          return l;
        });
        setTimelineFilter((prev) => (prev ? { ...prev, laneItems: updatedLaneFilters } : prev));
      }

      await saveTimelineQuietly(next, 'lane rename');
    }
  };

  // A timeline can't be saved without events (B-18). Removing the last one offers deleting the whole
  // timeline instead of a change that would silently not be saved.
  const offerDeleteEmptyTimeline = async () => {
    const tl = currentTimelineStateRef.current;
    if (!tl || tl.isOwner === false) return;
    if (!confirm(t('eventDrawer.deleteLastEventConfirm'))) return;
    try {
      await deleteTimeline(tl.id);
      // A published Library timeline is only hidden from Saved, so it may still be saved later.
      if (!tl.isLibrary) markTimelineDeleted(tl.id);
      window.dispatchEvent(new Event(TIMELINES_UPDATED_EVENT));
      if (String(currentTimelineStateRef.current?.id) === String(tl.id)) handleGoHome();
    } catch (err) {
      console.warn('Failed to delete the emptied timeline:', err);
      setErrorMessage(t('savedTimelines.deleteError'));
    }
  };

  // Handle deleting an event
  const handleDeleteEvent = async (articleId) => {
    if (!currentTimeline || currentTimeline.isOwner === false) return;
    const targetId = currentTimeline.id;
    if (wouldLeaveTimelineEmpty(currentTimelineStateRef.current || currentTimeline, [articleId])) {
      await offerDeleteEmptyTimeline();
      return;
    }
    if (!confirm(t('eventDrawer.deleteConfirm'))) return;

    const next = commitTimelineChange(targetId, (prev) => ({
      ...prev,
      articles: (prev.articles || []).filter((a) => a.id !== articleId),
    }));
    if (!next) return;
    // Drop the deleted event from the panel trail; the panel falls back to where the user came from.
    const nextPanelHistory = removePanelEntries(
      panelHistory,
      (entry) => entry.kind === 'event' && isSameArticleId(entry.id, articleId)
    );
    setPanelHistory(nextPanelHistory);
    applyPanelEntry(getCurrentPanel(nextPanelHistory), next.articles);

    await saveTimelineQuietly(next, 'event delete');
  };

  // Export as JSON file
  const handleExportJson = () => {
    if (!currentTimeline) return;
    const blob = new Blob([JSON.stringify(stripTransientTimelineFields(currentTimeline), null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentTimeline.id || 'timeline'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export as Snapshot Image
  const handleExportImage = () => {
    const canvas = timelineRef.current?.getCanvas();
    if (canvas) {
      try {
        const imageUri = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = imageUri;
        a.download = `${currentTimeline?.title?.replace(/\s+/g, '_') || 'timeline'}.png`;
        a.click();
        return;
      } catch (e) {
        console.warn('Direct canvas download failed, attempting html-to-image fallback:', e);
      }
    }

    const container = document.getElementById('histropedia-container');
    if (container) {
      import('html-to-image')
        .then(({ toPng }) => toPng(container))
        .then((dataUrl) => {
          const a = document.createElement('a');
          a.download = `${currentTimeline?.title?.replace(/\s+/g, '_') || 'timeline'}.png`;
          a.href = dataUrl;
          a.click();
        })
        .catch((err) => {
          alert(t('app.failedExportImg') + err.message);
        });
    }
  };

  const handleSelectTimeline = async (id, options = {}) => {
    const fromHomeLibrary = Boolean(options?.fromHomeLibrary);
    const capturedHomeScroll = fromHomeLibrary ? (homeScrollRef.current?.scrollTop ?? 0) : null;
    const reqSeq = ++selectTimelineSeqRef.current;
    try {
      const data = await fetchTimeline(id);
      if (reqSeq !== selectTimelineSeqRef.current) return;
      returnToHomeScrollTopRef.current = fromHomeLibrary ? capturedHomeScroll : null;
      setOpenedFromHomeLibrary(fromHomeLibrary);
      resetAllElementPositionsAndState(data?.id ?? null);
      setCurrentTimeline(data);
      if (data?.title) {
        setActivePrompt(data.title);
      }
    } catch (err) {
      if (reqSeq !== selectTimelineSeqRef.current) return;
      alert(t('app.failedLoad') + err.message);
    }
  };

  const handleSelectFromHomeLibrary = useCallback((id) => {
    return handleSelectTimeline(id, { fromHomeLibrary: true });
  }, []);

  const handleImportJson = async (imported) => {
    const {
      isOwner,
      isShared,
      is_shared,
      is_public,
      isDeleted,
      is_deleted,
      deletedAt,
      deleted_at,
      ownerId,
      user_id,
      ...rest
    } = imported || {};
    const newId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timelineToSave = {
      ...rest,
      id: newId,
      createdAt: null,
      updatedAt: null,
      isPinned: Boolean(rest.isPinned),
    };
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/t/')) {
      window.history.replaceState({}, '', '/');
    }
    resetAllElementPositionsAndState(newId);
    setCurrentTimeline({ ...timelineToSave, isOwner: true, isShared: false });
    if (timelineToSave.title) {
      setActivePrompt(timelineToSave.title);
    }
    try {
      const saved = await saveTimeline(timelineToSave);
      if (saved) {
        setCurrentTimeline((prev) => (prev && prev.id === newId ? { ...saved, isOwner: true, isShared: false } : prev));
      }
    } catch (e) {
      console.error('Failed to save imported JSON timeline:', e);
    }
  };

  // Resolves the shareable "/t/<id>" URL, ensuring the timeline is marked as shared in the backend.
  const handleGetShareLink = async () => {
    if (!currentTimeline?.id) throw new Error('No timeline to share yet');

    try {
      const author = user && !isGuest
        ? (user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Explorer')
        : 'Explorer';

      await setTimelineShareEnabled(currentTimeline.id, true, author);
      setCurrentTimeline((prev) => (prev ? { ...prev, isShared: true } : prev));
    } catch (err) {
      console.warn('setTimelineShareEnabled failed, attempting to save timeline first:', err);
      try {
        const latest = currentTimelineStateRef.current?.id === currentTimeline.id ? currentTimelineStateRef.current : currentTimeline;
        await saveTimeline(latest);
        await setTimelineShareEnabled(currentTimeline.id, true);
        setCurrentTimeline((prev) => (prev ? { ...prev, isShared: true } : prev));
      } catch (saveErr) {
        console.error('Failed to enable sharing for timeline:', saveErr);
      }
    }

    return `${window.location.origin}/t/${currentTimeline.id}`;
  };

  // Clones a read-only shared timeline into the current (logged-in, non-guest) user's own account.
  const handleSaveSharedCopy = async () => {
    if (!currentTimeline) return;
    const { isOwner, isShared, isLibrary, isFeatured, _unsavedMerged, ...rest } = currentTimeline;
    const copy = {
      ...rest,
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      createdAt: null,
      updatedAt: null,
    };
    try {
      const saved = await saveTimeline(copy);
      window.history.replaceState({}, '', '/');
      resetAllElementPositionsAndState(saved?.id ?? copy.id);
      setCurrentTimeline({ ...saved, isOwner: true, isShared: false });
    } catch (e) {
      alert(t('app.failedSave') || 'Failed to save a copy.');
    }
  };

  // ---- Public Library & Deterministic Timeline Layering / Merging ----
  const handleOpenAddLayerModal = useCallback(() => {
    setIsLibraryModalOpen(true);
  }, []);

  const handleMergeTimelineIds = useCallback(async (ids, options = {}) => {
    const fromHomeLibrary = Boolean(options?.fromHomeLibrary);
    const capturedHomeScroll = fromHomeLibrary ? (homeScrollRef.current?.scrollTop ?? 0) : null;
    const uniqueIds = Array.from(new Set((ids || []).filter(Boolean))).slice(0, MAX_MERGED_SOURCES);
    if (uniqueIds.length < 2) return;
    try {
      const fetched = await Promise.all(uniqueIds.map((id) => fetchTimeline(id)));
      const merged = mergeTimelines(fetched, { expandSubLanes: false });
      returnToHomeScrollTopRef.current = fromHomeLibrary ? capturedHomeScroll : null;
      setOpenedFromHomeLibrary(fromHomeLibrary);
      resetAllElementPositionsAndState(merged.id);
      setCurrentTimeline({
        ...merged,
        _unsavedMerged: true,
        isOwner: false,
        isShared: false,
      });
      if (merged.title) setActivePrompt(merged.title);
    } catch (err) {
      alert((t('app.failedLoad') || 'Failed to load timeline: ') + (err?.message || ''));
    }
  }, [resetAllElementPositionsAndState, t]);

  const handleMergeFromHomeLibrary = useCallback((ids) => {
    return handleMergeTimelineIds(ids, { fromHomeLibrary: true });
  }, [handleMergeTimelineIds]);

  const handleAddLayerTimeline = useCallback(async (addedId) => {
    if (!currentTimeline || !addedId) return;
    try {
      const added = await fetchTimeline(addedId);
      const isPersistedOwnedMerged = Boolean(
        currentTimeline.creationSource === 'merged' &&
        !currentTimeline._unsavedMerged &&
        !currentTimeline.isLibrary &&
        currentTimeline.isOwner !== false
      );
      // Keep the id only for an unsaved merge or the user's own merged timeline (B-12).
      const merged = mergeTimelines([currentTimeline, added], {
        expandSubLanes: Boolean(currentTimeline.subLanesExpanded),
        existingId: resolveMergedLayerId(currentTimeline),
      });
      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/t/')) {
        window.history.replaceState({}, '', '/');
      }
      setHiddenLayerIds(new Set());
      setTimelineFilter(null);
      setSelectedArticle(null);
      setFocusedArticleId(null);
      setTimelineLoadKey((k) => k + 1);

      if (isPersistedOwnedMerged) {
        const nextTl = { ...merged, _unsavedMerged: false, isOwner: true, isShared: Boolean(currentTimeline.isShared) };
        setCurrentTimeline(nextTl);
        if (nextTl.title) setActivePrompt(nextTl.title);
        await saveTimelineQuietly(merged, 'updated merged timeline');
      } else {
        const nextTl = { ...merged, _unsavedMerged: true, isOwner: false, isShared: false };
        setCurrentTimeline(nextTl);
        if (nextTl.title) setActivePrompt(nextTl.title);
      }
    } catch (err) {
      alert((t('app.failedLoad') || 'Failed to load timeline: ') + (err?.message || ''));
    }
  }, [currentTimeline, t, saveTimelineQuietly, setCurrentTimeline]);

  const handleToggleHideLayer = useCallback((laneId) => {
    if (!laneId) return;
    setHiddenLayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(laneId)) next.delete(laneId);
      else next.add(laneId);
      return next;
    });
  }, []);

  const handleZoomToLayer = useCallback((layerMeta) => {
    if (!layerMeta) return;
    const laneIds = Array.isArray(layerMeta.laneIds) && layerMeta.laneIds.length > 0
      ? layerMeta.laneIds
      : (layerMeta.laneId ? [layerMeta.laneId] : []);
    if (laneIds.length > 0) {
      requestAnimationFrame(() => {
        timelineRef.current?.fitLayerLanes?.(laneIds);
      });
    }
  }, []);

  const rebuildMergedFromSources = useCallback(async (nextSources, nextExpandSubLanes) => {
    if (!currentTimeline) return;
    const isPersistedOwnedMerged = Boolean(
      currentTimeline.creationSource === 'merged' &&
      !currentTimeline._unsavedMerged &&
      !currentTimeline.isLibrary &&
      currentTimeline.isOwner !== false
    );
    const preserveCuratedLibraryMeta =
      Boolean(currentTimeline.isLibrary) &&
      nextSources.length === (currentTimeline.mergedSources?.length || 0);
    // B-12: keep the id only when it is safe to write to (unsaved merge, or the user's own merged
    // timeline). A curated comparison the user doesn't own keeps its id for viewing only, flagged so
    // that Save mints a new one; any other foreign merged timeline gets a new id right away.
    const reusableId = resolveMergedLayerId(currentTimeline, { allowLibrary: true });
    const keepsForeignId = !reusableId && preserveCuratedLibraryMeta;
    const merged = mergeTimelines(nextSources, {
      expandSubLanes: nextExpandSubLanes,
      existingId: reusableId || (keepsForeignId ? currentTimeline.id : undefined),
      customTitle: preserveCuratedLibraryMeta ? currentTimeline.title : undefined,
    });
    setHiddenLayerIds(new Set());
    setTimelineFilter(null);
    setSelectedArticle(null);
    setFocusedArticleId(null);
    setTimelineLoadKey((k) => k + 1);

    if (isPersistedOwnedMerged) {
      const nextTl = { ...merged, _unsavedMerged: false, isOwner: true, isShared: Boolean(currentTimeline.isShared) };
      setCurrentTimeline(nextTl);
      if (nextTl.title) setActivePrompt(nextTl.title);
      await saveTimelineQuietly(merged, 'updated merged timeline');
    } else {
      const nextTl = {
        ...merged,
        ...(preserveCuratedLibraryMeta
          ? {
              description: currentTimeline.description || merged.description,
              overview: currentTimeline.overview || merged.overview,
              quiz: currentTimeline.quiz || merged.quiz,
              isLibrary: true,
              isPersonal: Boolean(currentTimeline.isPersonal),
            }
          : {}),
        _unsavedMerged: !preserveCuratedLibraryMeta,
        ...(keepsForeignId ? { _mergedIdForeign: true } : {}),
        isOwner: Boolean(preserveCuratedLibraryMeta && currentTimeline.isOwner),
        isShared: Boolean(currentTimeline.isShared),
      };
      setCurrentTimeline(nextTl);
      if (nextTl.title) setActivePrompt(nextTl.title);
    }
  }, [currentTimeline, saveTimelineQuietly, setCurrentTimeline]);

  const handleMoveLayer = useCallback((idx, dir) => {
    if (!currentTimeline) return;
    const sources = extractSourceTimelines(currentTimeline);
    const target = idx + dir;
    if (target < 0 || target >= sources.length) return;
    const reordered = [...sources];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(target, 0, moved);
    rebuildMergedFromSources(reordered, Boolean(currentTimeline.subLanesExpanded));
  }, [currentTimeline, rebuildMergedFromSources]);

  const handleRemoveLayer = useCallback(async (idx) => {
    if (!currentTimeline) return;
    const sources = extractSourceTimelines(currentTimeline);
    if (idx < 0 || idx >= sources.length) return;
    const remaining = sources.filter((_, i) => i !== idx);
    if (remaining.length >= 2) {
      rebuildMergedFromSources(remaining, Boolean(currentTimeline.subLanesExpanded));
      return;
    }
    if (remaining.length === 1) {
      const sole = remaining[0];
      if (sole.id && !String(sole.id).startsWith('source-')) {
        try {
          const fresh = await fetchTimeline(sole.id);
          resetAllElementPositionsAndState(fresh?.id ?? sole.id);
          setCurrentTimeline(fresh);
          if (fresh?.title) setActivePrompt(fresh.title);
          return;
        } catch {
          // Fall back to reconstructed source object below
        }
      }
      resetAllElementPositionsAndState(sole.id);
      setCurrentTimeline({ ...sole, isOwner: false });
      if (sole.title) setActivePrompt(sole.title);
    }
  }, [currentTimeline, rebuildMergedFromSources, resetAllElementPositionsAndState]);

  const handleToggleExpandSubLanes = useCallback(() => {
    if (!currentTimeline) return;
    const sources = extractSourceTimelines(currentTimeline);
    if (sources.length < 2) return;
    rebuildMergedFromSources(sources, !currentTimeline.subLanesExpanded);
  }, [currentTimeline, rebuildMergedFromSources]);

  const handleSaveMergedTimeline = useCallback(async () => {
    if (!currentTimeline || isSavingMerged) return;
    setIsSavingMerged(true);
    try {
      const {
        _unsavedMerged,
        isOwner,
        isShared,
        isLibrary,
        isFeatured,
        featuredOrder,
        _mergedIdForeign,
        ...cleanPayload
      } = currentTimeline;
      const toSave = {
        ...cleanPayload,
        // Someone else's merged timeline is saved as the user's own copy, never over theirs (B-12).
        id: resolveMergedSaveId(currentTimeline),
        createdAt: null,
        updatedAt: null,
        isPinned: false,
      };
      const saved = await saveTimeline(toSave);
      setCurrentTimeline({
        ...(saved || toSave),
        _unsavedMerged: false,
        isOwner: true,
        isShared: false,
      });
      setMergedSavedDone(true);
      setTimeout(() => setMergedSavedDone(false), 2800);
    } catch (err) {
      alert(t('app.failedSave') || 'Failed to save merged timeline.');
    } finally {
      setIsSavingMerged(false);
    }
  }, [currentTimeline, isSavingMerged, t]);

  // Create a hand-authored personal timeline from the "Build Your Own Timeline" flow
  // (no AI/backend generation - the object is built locally and persisted like an import).
  const handleCreatePersonalTimeline = async (data) => {
    resetAllElementPositionsAndState(data?.id ?? null);
    setCurrentTimeline(data);
    if (data?.title) {
      setActivePrompt(data.title);
    }
    // If the user started from a blank canvas, open Add Event immediately.
    // We only persist to the backend once at least one event is added.
    if (!data?.articles?.length) {
      if (data?.isOwner !== false) setPanelHistory(pushPanel(EMPTY_PANEL_HISTORY, { kind: 'new-event' }));
    } else {
      // The "your story is ready" moment, with the save's real outcome (never silently lost).
      setStoryReady({
        id: data.id,
        title: data.title || '',
        events: data.articles.length,
        chapters: (data.timeBands || []).length,
        status: 'saving',
      });
      await saveStoryTimeline(data);
    }
  };

  // Saves a timeline just created in the Story Studio and reports the result on the ready card.
  const saveStoryTimeline = async (data) => {
    const settle = (status) => setStoryReady((r) => (r && String(r.id) === String(data.id) ? { ...r, status } : r));
    try {
      await saveTimeline(data);
      settle('saved');
    } catch (e) {
      console.warn('Failed to save the new personal timeline:', e);
      settle('error');
    }
  };
  // Try again: save the latest state of that timeline (it may have been edited meanwhile).
  const retryStoryTimelineSave = () => {
    const ready = storyReady;
    if (!ready) return;
    const latest = currentTimelineStateRef.current;
    if (!latest || String(latest.id) !== String(ready.id)) {
      setStoryReady(null);
      return;
    }
    setStoryReady({ ...ready, status: 'saving' });
    saveStoryTimeline(latest);
  };
  const dismissStoryReady = useCallback(() => setStoryReady(null), []);

  // Clear board (reset timeline)
  const handleClearBoard = () => {
    returnToHomeScrollTopRef.current = null;
    setOpenedFromHomeLibrary(false);
    resetAllElementPositionsAndState(null);
    setCurrentTimeline(null);
    applyDocumentTitle(DEFAULT_APP_TITLE);
    setActivePrompt('');
  };

  // Navigate back to the home view (Logo click)
  const handleGoHome = () => {
    setOpenedFromHomeLibrary(false);
    resetAllElementPositionsAndState(null);
    setCurrentTimeline(null);
    applyDocumentTitle(DEFAULT_APP_TITLE);
    setActivePrompt('');
  };

  // Toggle star / favorite status on an article
  const handleToggleStar = useCallback((articleId, explicitState) => {
    setStarredArticleIds((prev) => {
      const shouldBeStarred = explicitState !== undefined ? explicitState : !prev.has(articleId);
      // Update canvas instance directly without remounting
      timelineRef.current?.setArticleStarred(articleId, shouldBeStarred);
      // Same contents: keep the Set identity so map, canvas and lists don't re-filter.
      if (shouldBeStarred === prev.has(articleId)) return prev;
      const next = new Set(prev);
      if (shouldBeStarred) {
        next.add(articleId);
      } else {
        next.delete(articleId);
      }

      // If currently filtering by starred only, re-apply canvas filter with updated set
      setFilterStarredOnly((currentFilter) => {
        if (currentFilter) {
          timelineRef.current?.setFilterStarredOnly(true, next);
        }
        return currentFilter;
      });

      return next;
    });
  }, []);

  // Toggle filtering by starred events only
  const handleToggleFilterStarredOnly = useCallback(() => {
    setFilterStarredOnly((prev) => {
      const next = !prev;
      timelineRef.current?.setFilterStarredOnly(next, starredArticleIds);
      return next;
    });
  }, [starredArticleIds]);

  // Selects an article (always resolving the full object with all metadata - locationName, lat,
  // lng, etc.) and opens its details in the side panel. While the events list is open, picking an
  // event on the timeline/map only highlights it in the list unless `openDetails` is set.
  const selectArticle = (article, openDetails = false) => {
    const nextId = article ? (article.id || article.data?.id) : null;
    if (eventEditDirtyRef.current && !(nextId != null && selectedArticle && isSameArticleId(selectedArticle.id, nextId))) {
      if (!confirmDiscardEventEditRef.current()) return;
    }
    if (!article) {
      setSelectedArticle(null);
      setFocusedArticleId(null);
      setPanelHistory((h) => (getCurrentPanel(h)?.kind === 'event' ? EMPTY_PANEL_HISTORY : h));
      return;
    }
    const articleId = article.id || article.data?.id;
    const fullArticle = currentTimeline?.articles?.find((a) => a.id === articleId) || article;
    setSelectedArticle(fullArticle);
    setFocusedArticleId(articleId);
    setIsEventDrawerDismissed(false);
    setPanelHistory((h) => (
      !openDetails && getCurrentPanel(h)?.kind === 'list'
        ? h
        : pushPanel(h, { kind: 'event', id: articleId })
    ));
  };

  const handleSelectArticle = (article) => selectArticle(article);

  const handleOpenArticleDetails = (article) => {
    selectArticle(article, true);
    const id = article?.id || article?.data?.id;
    if (id) timelineRef.current?.focusArticle(id);
  };

  // Focus timeline on an article (pan timeline and bring card to front) without opening the details drawer,
  // and focus the map on the matching pin.
  const handleFocusTimelineArticle = useCallback((article, opts) => {
    const id = article?.id || article?.data?.id;
    if (id) {
      setFocusedArticleId(id);
      timelineRef.current?.focusArticle(id, opts);
    }
  }, []);

  // Focus and select article from cards list or map
  const handleFocusArticle = (article) => {
    handleSelectArticle(article);
    const id = article?.id || article?.data?.id;
    if (id) {
      timelineRef.current?.focusArticle(id);
    }
  };

  // Opening an event from the list stacks its details on top of the list, so the panel's Back
  // control returns to the list (with its search, filters and scroll intact).
  const handleSelectArticleFromCardsList = (article) => {
    handleOpenArticleDetails(article);
  };

  const handleSelectArticleFromMobileFeed = (article) => {
    handleOpenArticleDetails(article);
  };

  // ---- Side panel navigation (Back / Forward / Close) ----
  const QUIZ_GAME_META = {
    hub: { titleKey: 'quiz.hubTitle', Icon: Puzzle },
    trivia: { titleKey: 'quiz.title', Icon: GameTriviaIcon },
    puzzle: { titleKey: 'quiz.puzzle.title', Icon: GamePuzzleIcon },
    timeGuesser: { titleKey: 'quiz.timeGuesser.title', Icon: GameTimeGuesserIcon },
    memory: { titleKey: 'quiz.memory.title', Icon: GameMemoryIcon },
    wordle: { titleKey: 'quiz.wordle.title', Icon: GameWordleIcon },
    sequence: { titleKey: 'quiz.sequence.title', Icon: GameSequenceIcon },
    whoAmI: { titleKey: 'quiz.whoAmI.title', Icon: GameWhoAmIIcon },
  };

  const describePanelEntry = (entry) => {
    if (!entry) return null;
    switch (entry.kind) {
      case 'event': {
        const article = (currentTimeline?.articles || []).find((a) => isSameArticleId(a.id, entry.id));
        return { label: article?.title || t('panelNav.untitledEvent'), Icon: Calendar };
      }
      case 'list':
        return { label: t('cardsList.title'), Icon: LayoutList };
      case 'overview':
        return { label: t('overview.title'), Icon: BookOpen };
      case 'edit':
        return { label: t('editPanel.title'), Icon: Pencil };
      case 'new-event':
        return { label: t('eventEditor.newEvent'), Icon: Plus };
      case 'games': {
        const meta = QUIZ_GAME_META[entry.game] || QUIZ_GAME_META.hub;
        return { label: t(meta.titleKey), Icon: meta.Icon };
      }
      default:
        return null;
    }
  };

  // Syncs selection/focus with the panel entry being shown by Back/Forward or a removal.
  const applyPanelEntry = (entry, articles = currentTimeline?.articles || []) => {
    if (entry?.kind === 'event') {
      const article = articles.find((a) => isSameArticleId(a.id, entry.id));
      if (article) {
        setSelectedArticle(article);
        setFocusedArticleId(article.id);
        setIsEventDrawerDismissed(false);
        timelineRef.current?.focusArticle(article.id);
      }
      return;
    }
    // Leaving an event's details keeps that event selected (focusedArticleId) on the timeline,
    // unless it no longer exists (deleted).
    setSelectedArticle(null);
    setFocusedArticleId((id) => (
      id != null && articles.some((a) => isSameArticleId(a.id, id)) ? id : null
    ));
    if (entry?.kind === 'games') setQuizGame(entry.game || 'hub');
  };

  const pendingPanelNavFocusRef = useRef(false);
  const navigatePanelHistory = (next, { moveFocus = false } = {}) => {
    if (next === panelHistory) return;
    if (!confirmDiscardEventEditRef.current()) return;
    setPanelHistory(next);
    applyPanelEntry(getCurrentPanel(next));
    pendingPanelNavFocusRef.current = moveFocus;
  };
  const handlePanelBack = (opts) => navigatePanelHistory(goBackPanel(panelHistory), opts);
  const handlePanelForward = (opts) => navigatePanelHistory(goForwardPanel(panelHistory), opts);

  // Keep keyboard focus on the Back/Forward controls of the panel that just came into view
  // (the clicked button belonged to the panel that was just hidden).
  useEffect(() => {
    if (!pendingPanelNavFocusRef.current) return undefined;
    pendingPanelNavFocusRef.current = false;
    const frame = requestAnimationFrame(() => {
      const nav = document.querySelector('[data-panel-nav]');
      const target = nav?.querySelector('button:not([disabled])');
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [panelHistory]);

  const handleCloseEventPanel = () => {
    if (!confirmDiscardEventEditRef.current()) return;
    // Closing the details only closes the panel: the event stays selected/focused on the timeline
    // (and map) until the user explicitly deselects it (background tap) or picks another event.
    // Clearing selectedArticle (while keeping focusedArticleId) lets re-clicking it re-open details.
    setSelectedArticle(null);
    setIsEventDrawerDismissed(false);
    setPanelHistory(EMPTY_PANEL_HISTORY);
  };

  const handleClosePanel = () => {
    if (!confirmDiscardEventEditRef.current()) return;
    if (activePanel?.kind === 'event') {
      handleCloseEventPanel();
      return;
    }
    if (activePanel?.kind === 'list') setSelectedArticle(null);
    setPanelHistory(EMPTY_PANEL_HISTORY);
  };

  // ---- In-place event editing ----
  // Opens the "add event" form: the event drawer in edit mode with an empty draft.
  const handleStartNewEvent = () => {
    if (!currentTimeline || currentTimeline.isOwner === false) return;
    if (!confirmDiscardEventEditRef.current()) return;
    setSelectedArticle(null);
    setIsEventDrawerDismissed(false);
    setPanelHistory((h) => pushPanel(h, { kind: 'new-event' }));
  };

  // Opens an event's details straight in edit mode (Back returns to wherever it was opened from).
  const handleEditEventInPlace = (article) => {
    if (!article) return;
    const id = article.id || article.data?.id;
    selectArticle(article, true);
    setEventEditRequestId(id);
    if (id) timelineRef.current?.focusArticle(id);
  };

  const handleSaveEditedEvent = (savedArticle) => {
    eventEditDirtyRef.current = false;
    handleSaveEvent(savedArticle);
  };

  // A saved new event replaces the "new event" form with its details.
  const handleSaveNewEvent = (savedArticle) => {
    eventEditDirtyRef.current = false;
    const { newLane, ...stored } = savedArticle;
    handleSaveEvent(savedArticle);
    setSelectedArticle(stored);
    setFocusedArticleId(stored.id);
    setIsEventDrawerDismissed(false);
    setPanelHistory((h) => replaceCurrentPanel(h, { kind: 'event', id: stored.id }));
    setTimeout(() => timelineRef.current?.focusArticle?.(stored.id), 350);
  };

  const handleCancelNewEvent = () => {
    eventEditDirtyRef.current = false;
    const next = removePanelEntries(panelHistory, (entry) => entry.kind === 'new-event');
    setPanelHistory(next);
    applyPanelEntry(getCurrentPanel(next));
  };

  const handleSelectQuizGame = (game) => {
    setQuizGame(game);
    setPanelHistory((h) => pushPanel(h, { kind: 'games', game }));
  };

  // Events can also disappear outside handleDeleteEvent (AI chat edits, chat undo); drop their
  // trail entries so Back/Forward never lands on an event that no longer exists.
  useEffect(() => {
    const articles = currentTimeline?.articles;
    if (!articles) return;
    const next = removePanelEntries(
      panelHistory,
      (entry) => entry.kind === 'event' && !articles.some((a) => isSameArticleId(a.id, entry.id))
    );
    if (next === panelHistory) return;
    setPanelHistory(next);
    if (getCurrentPanel(next) !== activePanel) applyPanelEntry(getCurrentPanel(next), articles);
  }, [currentTimeline?.articles]);

  // The event in the middle of the mobile feed; switching back to the canvas opens on it.
  // Kept in a ref (not state) so feed scrolling doesn't re-render the app.
  const feedVisibleArticleRef = useRef(null);
  const handleFeedVisibleArticleChange = useCallback((article) => {
    feedVisibleArticleRef.current = article;
  }, []);
  const handleShowMobileFeed = () => {
    const lensFocusId = timelineRef.current?.getLensFocusId?.();
    setMobileTimelineView('feed');
    if (lensFocusId != null && !isSameArticleId(lensFocusId, selectedArticle?.id || focusedArticleId)) {
      const article = (currentTimeline?.articles || []).find((a) => isSameArticleId(a.id, lensFocusId));
      if (article) setFocusedArticleId(article.id);
    }
  };
  const handleShowMobileCanvas = () => {
    const prevView = mobileTimelineView;
    const visible = feedVisibleArticleRef.current;
    feedVisibleArticleRef.current = null;
    if (densityMode !== 'auto') {
      setDensityMode('auto');
    }
    setMobileTimelineView('canvas');
    if (
      prevView === 'feed'
      && visible
      && !isSameArticleId(visible.id, selectedArticle?.id || focusedArticleId)
      && (currentTimeline?.articles || []).some((a) => isSameArticleId(a.id, visible.id))
    ) {
      requestAnimationFrame(() => handleFocusTimelineArticle(visible));
    }
  };
  const handleShowMobileClassic = () => {
    const prevView = mobileTimelineView;
    const lensFocusId = prevView === 'canvas' ? timelineRef.current?.getLensFocusId?.() : null;
    const wasAutoOpened = prevView === 'canvas' && Boolean(timelineRef.current?.isLensAutoOpened?.());
    const visible = feedVisibleArticleRef.current;
    feedVisibleArticleRef.current = null;
    setMobileTimelineView('classic');
    if (
      prevView === 'feed'
      && visible
      && !isSameArticleId(visible.id, selectedArticle?.id || focusedArticleId)
      && (currentTimeline?.articles || []).some((a) => isSameArticleId(a.id, visible.id))
    ) {
      requestAnimationFrame(() => handleFocusTimelineArticle(visible));
    } else if (prevView === 'canvas' && wasAutoOpened && !selectedArticle) {
      setFocusedArticleId(null);
      timelineRef.current?.clearMobileFocus?.();
    } else if (
      prevView === 'canvas'
      && lensFocusId != null
      && !wasAutoOpened
    ) {
      const article = (currentTimeline?.articles || []).find((a) => isSameArticleId(a.id, lensFocusId));
      if (article) requestAnimationFrame(() => handleFocusTimelineArticle(article));
    }
  };

  const handleShowArticleOnMap = useCallback((article) => {
    if (!article) return;
    if (isNarrowViewport) {
      handleMapDisplayModeChange('split');
      setIsEventDrawerDismissed(true);
    } else {
      if (mapDisplayMode === 'icon') {
        handleMapDisplayModeChange('pip');
      }
    }
    const id = article?.id || article?.data?.id;
    if (id) {
      setFocusedArticleId(id);
      timelineRef.current?.focusArticle(id);
    }
  }, [isNarrowViewport, mapDisplayMode, handleMapDisplayModeChange]);

  // Synchronize canvas redraw when switching back from mobile feed view (or rotating from
  // portrait feed to landscape canvas) to ensure crisp canvas layout and preserved scroll context.
  useEffect(() => {
    if (mobileTimelineView !== 'feed' || !isNarrowViewport) {
      if (!isNarrowViewport && feedVisibleArticleRef.current) {
        const visible = feedVisibleArticleRef.current;
        feedVisibleArticleRef.current = null;
        if (
          !isSameArticleId(visible.id, selectedArticle?.id || focusedArticleId)
          && (currentTimeline?.articles || []).some((a) => isSameArticleId(a.id, visible.id))
        ) {
          requestAnimationFrame(() => handleFocusTimelineArticle(visible));
        }
      }
      timelineRef.current?.redraw?.();
    }
  }, [mobileTimelineView, isNarrowViewport]);

  // Dock sections are top-level destinations of the side panel: clicking one opens it as a new
  // step (Back returns to whatever was showing) and restores its preserved state; clicking the
  // section that's already showing closes the panel.
  const handleToggleCardsList = useCallback(() => {
    if (!confirmDiscardEventEditRef.current()) return;
    setSelectedArticle(null);
    setPanelHistory((h) => (
      getCurrentPanel(h)?.kind === 'list' ? EMPTY_PANEL_HISTORY : openPanelSection(h, { kind: 'list' })
    ));
  }, []);

  const handleToggleEditPanel = useCallback(() => {
    if (!confirmDiscardEventEditRef.current()) return;
    setSelectedArticle(null);
    setPanelHistory((h) => (
      getCurrentPanel(h)?.kind === 'edit' ? EMPTY_PANEL_HISTORY : openPanelSection(h, { kind: 'edit' })
    ));
  }, []);

  const handleToggleOverview = useCallback(() => {
    if (!confirmDiscardEventEditRef.current()) return;
    // The selected event stays highlighted on the timeline; only its details panel gives way.
    if (!isOverviewOpen) setSelectedArticle(null);
    setPanelHistory((h) => (
      getCurrentPanel(h)?.kind === 'overview' ? EMPTY_PANEL_HISTORY : openPanelSection(h, { kind: 'overview' })
    ));
  }, [isOverviewOpen]);

  const handleToggleQuiz = useCallback(() => {
    if (!confirmDiscardEventEditRef.current()) return;
    if (!isQuizOpen) setSelectedArticle(null);
    setPanelHistory((h) => (
      getCurrentPanel(h)?.kind === 'games' ? EMPTY_PANEL_HISTORY : openPanelSection(h, { kind: 'games', game: quizGame })
    ));
  }, [isQuizOpen, quizGame]);

  const handleQuizGenerated = useCallback((questions) => {
    setCurrentTimeline((prev) => (prev ? { ...prev, quiz: questions } : prev));
  }, []);

  const handleWhoAmIGenerated = useCallback((items) => {
    setCurrentTimeline((prev) => (prev ? { ...prev, whoami: items } : prev));
  }, []);

  const handleTogglePodcast = useCallback(() => {
    if (!isPodcastOpen) {
      setSelectedArticle(null);
      setPanelHistory(EMPTY_PANEL_HISTORY);
      setIsPodcastOpen(true);
      setIsPodcastMinimized(false);
    } else if (isPodcastMinimized) {
      setSelectedArticle(null);
      setPanelHistory(EMPTY_PANEL_HISTORY);
      setIsPodcastMinimized(false);
    } else {
      setIsPodcastOpen(false);
    }
  }, [isPodcastOpen, isPodcastMinimized]);

  // "?listen=1" deep links (shared from the podcast player) open the player once the timeline loads.
  const [pendingListenLink, setPendingListenLink] = useState(() => {
    if (typeof window === 'undefined') return false;
    const value = new URLSearchParams(window.location.search).get('listen');
    return value === '1' || value === 'true';
  });
  useEffect(() => {
    if (!pendingListenLink || !currentTimeline?.id) return undefined;
    const timer = setTimeout(() => {
      setPendingListenLink(false);
      setSelectedArticle(null);
      setPanelHistory(EMPTY_PANEL_HISTORY);
      setIsPodcastOpen(true);
      setIsPodcastMinimized(false);
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('listen');
        window.history.replaceState(window.history.state, '', url.toString());
      } catch {
        // ignore
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [pendingListenLink, currentTimeline?.id]);

  const handleEnsureMapForPodcast = useCallback(() => {
    setPanelHistory((h) => (getCurrentPanel(h)?.kind === 'event' && !isNarrowViewport ? h : EMPTY_PANEL_HISTORY));
    if (isNarrowViewport) {
      setSelectedArticle(null);
    }
    handleMapDisplayModeChange('split');
    setSplitRatio(DEFAULT_SPLIT_RATIO);
  }, [isNarrowViewport, handleMapDisplayModeChange]);

  const handlePodcastFocusArticle = useCallback((article, opts) => {
    const id = article?.id || article?.data?.id;
    if (!id) return;
    if (!isNarrowViewport) {
      const fullArticle = currentTimeline?.articles?.find((a) => isSameArticleId(a.id, id)) || article;
      setSelectedArticle(fullArticle);
      setFocusedArticleId(id);
      setIsEventDrawerDismissed(false);
      setPanelHistory((h) => pushPanel(h, { kind: 'event', id }));
    } else {
      setFocusedArticleId(id);
    }
    timelineRef.current?.focusArticle(id, opts);
  }, [isNarrowViewport, currentTimeline?.articles]);

  // ---- Prev/Next event stepping (details drawer, map cards) ----
  useEffect(() => {
    setIsEventDrawerDismissed(false);
  }, [selectedArticle?.id]);

  // Chronologically ordered articles currently visible on the canvas. When both filters
  // are active, visibility is their intersection, so Prev/Next follows that same subset.
  const getNavigationOrder = useCallback(() => {
    const articles = currentTimeline?.articles || [];
    const visibleIds = timelineRef.current?.getVisibleArticleIds?.();
    const visibleSet = Array.isArray(visibleIds) ? new Set(visibleIds) : null;
    return articles
      .filter((a) => !visibleSet || visibleSet.has(a.id))
      .slice()
      .sort((a, b) => articleDateValue(a) - articleDateValue(b));
  }, [currentTimeline, timelineFilter, filterStarredOnly, starredArticleIds]);

  // The visible event `delta` steps away from `fromArticle` (clamped to the ends).
  const getSteppedArticle = useCallback((fromArticle, delta) => {
    const order = getNavigationOrder();
    if (order.length === 0) return null;
    const curIdx = fromArticle ? order.findIndex((a) => isSameArticleId(a.id, fromArticle.id)) : -1;
    let nextIdx;
    if (curIdx >= 0) {
      nextIdx = Math.min(order.length - 1, Math.max(0, curIdx + delta));
    } else if (fromArticle) {
      // Current event no longer visible (filter changed) - re-anchor to the nearest later event
      const cur = articleDateValue(fromArticle);
      const laterIdx = order.findIndex((a) => articleDateValue(a) >= cur);
      nextIdx = laterIdx >= 0 ? laterIdx : order.length - 1;
    } else {
      nextIdx = 0;
    }
    return order[nextIdx];
  }, [getNavigationOrder]);

  const focusSteppedArticle = useCallback((article) => {
    setSelectedArticle(article);
    // Stepping swaps the open event in place (no extra Back step per event).
    setPanelHistory((h) => (
      getCurrentPanel(h)?.kind === 'event' ? pushPanel(h, { kind: 'event', id: article.id }) : h
    ));
    timelineRef.current?.focusArticle(article.id, { animate: true, keepCompact: true });
  }, []);

  // Details drawer Prev/Next (buttons, swipe, ← → keys).
  const handleStepEvent = useCallback((delta) => {
    const target = getSteppedArticle(selectedArticle, delta);
    if (target) focusSteppedArticle(target);
  }, [getSteppedArticle, selectedArticle, focusSteppedArticle]);

  // Map card Prev/Next. While the details drawer is open on desktop it follows along; otherwise (and always on
  // mobile where the drawer is modal / full-screen) only the pin card and timeline focus move, without opening the drawer.
  const handleMapNavigate = useCallback((fromArticle, delta) => {
    const target = getSteppedArticle(fromArticle, delta);
    if (!target) return;
    const isDrawerShowing = !isNarrowViewport && Boolean(selectedArticle) && !isEventDrawerDismissed && activePanel?.kind === 'event';
    if (isDrawerShowing) {
      focusSteppedArticle(target);
      return;
    }
    setSelectedArticle(null);
    setIsEventDrawerDismissed(true);
    setFocusedArticleId(target.id);
    timelineRef.current?.focusArticle(target.id, { animate: true });
  }, [getSteppedArticle, isNarrowViewport, selectedArticle, isEventDrawerDismissed, activePanel?.kind, focusSteppedArticle]);

  // The canvas focus lens moved to another event on its own (card Prev/Next, swipe, tap). Same rules as the
  // map card's Prev/Next, so the shared focus - and with it the map pin - follows the canvas. The canvas is
  // already centred on the event, so it isn't asked to move again.
  const handleTimelineLensFocus = useCallback((article) => {
    const target = currentTimeline?.articles?.find((a) => isSameArticleId(a.id, article?.id)) || article;
    if (!target?.id) return;
    const isDrawerShowing = !isNarrowViewport && Boolean(selectedArticle) && !isEventDrawerDismissed && activePanel?.kind === 'event';
    if (isDrawerShowing) {
      focusSteppedArticle(target);
      return;
    }
    setSelectedArticle(null);
    setIsEventDrawerDismissed(true);
    setFocusedArticleId(target.id);
  }, [currentTimeline?.articles, isNarrowViewport, selectedArticle, isEventDrawerDismissed, activePanel?.kind, focusSteppedArticle]);

  // ---- Interactive feature guide: coach-mark walkthrough of the timeline screen ----
  const [guideSteps, setGuideSteps] = useState(() => buildGuideSteps(t));

  const handleStartGuide = useCallback(() => {
    if (!isInteractiveGuideEnabled()) return;
    if (currentTimeline) {
      setPanelHistory((h) => (getCurrentPanel(h)?.kind === 'list' ? EMPTY_PANEL_HISTORY : h));
      setGuideSteps(buildGuideSteps(t));
      setIsGuideOpen(true);
    } else {
      setHomeGuideSteps(buildHomeGuideSteps(t));
      setIsHomeGuideOpen(true);
    }
  }, [currentTimeline, t]);

  useEffect(() => {
    if (isGuideOpen) {
      setGuideSteps(buildGuideSteps(t));
    }
  }, [isGuideOpen, t]);

  const handleCloseGuide = useCallback(() => {
    setIsGuideOpen(false);
    try { localStorage.setItem('chronix_tour_seen', '1'); } catch (e) { }
  }, []);

  // First-run: auto-launch the timeline guide the first time a populated timeline appears.
  const guideAutoStartedRef = useRef(false);
  const guidePendingRef = useRef(false);
  useEffect(() => {
    if (!isTimelineGuideEnabled()) return;
    if (guideAutoStartedRef.current) return;
    const hasEvents = (currentTimeline?.articles?.length ?? 0) > 0;
    if (!hasEvents) return;
    let seen = false;
    try { seen = !!localStorage.getItem('chronix_tour_seen'); } catch (e) { }
    guideAutoStartedRef.current = true;
    if (seen) return;
    try { localStorage.setItem('chronix_tour_seen', '1'); } catch (e) { }
    guidePendingRef.current = true;
    const timer = setTimeout(() => {
      guidePendingRef.current = false;
      setIsGuideOpen(true);
    }, 700);
    return () => clearTimeout(timer);
  }, [currentTimeline]);

  // ---- Home-screen interactive feature guide ----
  const [isHomeGuideOpen, setIsHomeGuideOpen] = useState(false);
  const [homeGuideSteps, setHomeGuideSteps] = useState(() => buildHomeGuideSteps(t));
  const [homeGuideSeen, setHomeGuideSeen] = useState(() => {
    try {
      return !!localStorage.getItem('chronix_home_tour_seen');
    } catch {
      return false;
    }
  });

  const handleStartHomeGuide = useCallback(() => {
    if (!isHomeGuideEnabled()) return;
    setHomeGuideSteps(buildHomeGuideSteps(t));
    setIsHomeGuideOpen(true);
  }, [t]);

  useEffect(() => {
    if (isHomeGuideOpen) {
      setHomeGuideSteps(buildHomeGuideSteps(t));
    }
  }, [isHomeGuideOpen, t]);

  const handleCloseHomeGuide = useCallback(() => {
    setIsHomeGuideOpen(false);
    setHomeGuideSeen(true);
    closeHomeMenu();
    try { localStorage.setItem('chronix_home_tour_seen', '1'); } catch (e) { }
  }, []);

  // First-run: auto-launch home guide for new users on the home screen
  const homeGuideAutoStartedRef = useRef(false);
  useEffect(() => {
    if (!isHomeGuideEnabled()) return;
    if (homeGuideAutoStartedRef.current) return;
    if (currentTimeline || authLoading || sharedRouteId || publicRoute || isLoading) return;

    let seen = false;
    try { seen = !!localStorage.getItem('chronix_home_tour_seen'); } catch (e) { }

    let forceFromUrl = false;
    try {
      const params = new URLSearchParams(window.location.search);
      forceFromUrl =
        params.get('homeguide') === '1' ||
        params.get('homeguide') === 'true' ||
        ((params.get('guide') === '1' || params.get('guide') === 'true') && !currentTimeline);
    } catch (e) { }

    if (seen && !forceFromUrl) {
      homeGuideAutoStartedRef.current = true;
      return;
    }

    homeGuideAutoStartedRef.current = true;
    try { localStorage.setItem('chronix_home_tour_seen', '1'); } catch (e) { }

    const timer = setTimeout(() => {
      if (!currentTimeline && !isLoading) {
        setIsHomeGuideOpen(true);
      }
    }, 700);

    return () => clearTimeout(timer);
  }, [currentTimeline, authLoading, sharedRouteId, publicRoute, isLoading]);

  // ---- Personal-timeline authorship note (footer) ----
  const [isDisclaimerExpanded, setIsDisclaimerExpanded] = useState(false);
  // Its real height (it grows when expanded): the podcast player sits just above it.
  const disclaimerRef = useRef(null);
  const [disclaimerHeight, setDisclaimerHeight] = useState(MANUAL_NOTE_HEIGHT);
  useEffect(() => {
    const el = disclaimerRef.current;
    if (!el) return undefined;
    const measure = () => setDisclaimerHeight(Math.round(el.getBoundingClientRect().height) || MANUAL_NOTE_HEIGHT);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [currentTimeline?.isManual, isDisclaimerExpanded]);
  // The events are the user's own; once AI-suggested historical links appear, the note says so.
  const personalDisclaimerKey = (currentTimeline?.articles || []).some((a) => linksOfKind(a, 'event').length)
    ? 'personalDisclaimer.textWithLinks'
    : 'personalDisclaimer.text';

  // ---- Timeline narrative overview panel ----
  // Gated on isManual (hand-authored, no AI) rather than isPersonal - AI-extracted-from-files
  // "personal" timelines still have a real AI-written overview and should show it.
  // Personal timelines always have one: it holds "Learn more" (Wikipedia links, world events).
  const hasOverview = (!currentTimeline?.isManual && !!(currentTimeline?.overview || '').trim())
    || Boolean(currentTimeline?.isPersonal && currentTimeline?.articles?.length && !currentTimeline?.isLibrary);

  // Detail drawer visibility: shown while an event is the side panel's current entry, unless the
  // user temporarily dismissed it (e.g. "show on map" on narrow screens).
  const showEventDrawer =
    !!selectedArticle &&
    activePanel?.kind === 'event' &&
    !isEventDrawerDismissed;

  const showNewEventDrawer = Boolean(currentTimeline) && currentTimeline.isOwner !== false && isNewEventPanelOpen;

  const hasLeftDrawer = Boolean(
    showEventDrawer ||
    showNewEventDrawer ||
    isCardsListOpen ||
    (currentTimeline && currentTimeline.isOwner !== false && isEditPanelOpen) ||
    (currentTimeline && hasOverview && isOverviewOpen) ||
    (currentTimeline && isQuizOpen)
  );

  // System Back (Android gesture/button, browser Back, mouse back button) steps back through the
  // side panel, closes it once there's nowhere left to go back to, and returns to the Home Library
  // scroll position if the current timeline was opened from the Home Library catalog.
  useSystemBackNavigation(Boolean(currentTimeline), () => {
    if (hasLeftDrawer) {
      if (canGoBack(panelHistory)) handlePanelBack();
      else handleClosePanel();
    } else {
      handleGoHome();
    }
  }, DEFAULT_APP_TITLE);

  // Esc does what Back does for the side panel: one level back, then closed. It leaves Esc alone
  // while typing, while a dialog or the Story Studio is open, and when something else already
  // handled it (a dropdown, the photo lightbox, the music panel... call preventDefault()).
  const panelEscapeRef = useRef(null);
  panelEscapeRef.current = () => {
    if (canGoBack(panelHistory)) handlePanelBack({ moveFocus: true });
    else handleClosePanel();
  };
  useEffect(() => {
    if (!hasLeftDrawer) return undefined;
    let timer = null;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape' || e.isComposing || e.repeat) return;
      if (e.target?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return;
      if (document.querySelector('[aria-modal="true"], [role="alertdialog"]')) return;
      // After every other listener has had its turn, so their preventDefault() is seen.
      clearTimeout(timer);
      timer = setTimeout(() => { if (!e.defaultPrevented) panelEscapeRef.current?.(); }, 0);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { clearTimeout(timer); window.removeEventListener('keydown', onKeyDown); };
  }, [hasLeftDrawer]);

  // Sync URL query / path cleanly after useSystemBackNavigation arms/disarms its history guard
  // so the underlying Home ('/') history entry stays pristine on Back or Logo navigation.
  const currentTimelineRefForUrl = useRef(currentTimeline);
  currentTimelineRefForUrl.current = currentTimeline;
  const isSharedViewLoadingRefForUrl = useRef(isSharedViewLoading);
  isSharedViewLoadingRefForUrl.current = isSharedViewLoading;
  const publicRouteRefForUrl = useRef(publicRoute);
  publicRouteRefForUrl.current = publicRoute;

  useEffect(() => {
    if (typeof window === 'undefined' || isSharedViewLoading) return;
    if (currentTimeline) {
      if (!window.location.pathname.startsWith('/t/')) {
        if (currentTimeline.isLibrary && currentTimeline.id) {
          const nextUrl = `/?timeline=${encodeURIComponent(currentTimeline.id)}`;
          if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
            window.history.replaceState(window.history.state, '', nextUrl);
          }
        } else if (window.location.search.includes('timeline=')) {
          window.history.replaceState(window.history.state, '', '/');
        }
      }
    } else if (window.location.pathname.startsWith('/t/') || window.location.search.includes('timeline=')) {
      window.history.replaceState(window.history.state, '', '/');
    }
  }, [currentTimeline, isSharedViewLoading, hasLeftDrawer, openedFromHomeLibrary]);

  // Declare the document.title effect AFTER useSystemBackNavigation so that when a timeline opens,
  // history.pushState creates the guard entry BEFORE document.title changes from DEFAULT_APP_TITLE.
  useEffect(() => {
    applyDocumentTitle(computeAppTitle(currentTimeline, publicRoute));
  }, [currentTimeline, currentTimeline?.title, publicRoute, computeAppTitle, applyDocumentTitle]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleCleanHomeUrlOnPop = () => {
      if (
        !currentTimelineRefForUrl.current &&
        !isSharedViewLoadingRefForUrl.current &&
        !publicRouteRefForUrl.current
      ) {
        if (window.location.pathname.startsWith('/t/') || window.location.search.includes('timeline=')) {
          window.history.replaceState(window.history.state, '', '/');
        }
        applyDocumentTitle(DEFAULT_APP_TITLE);
      }
    };
    window.addEventListener('popstate', handleCleanHomeUrlOnPop);
    return () => window.removeEventListener('popstate', handleCleanHomeUrlOnPop);
  }, [applyDocumentTitle]);

  const nextPanelEntry = getNextPanel(panelHistory);

  // Back/Forward descriptor handed to whichever panel is currently showing.
  const previousPanelEntry = getPreviousPanel(panelHistory);
  const panelNav = (previousPanelEntry || nextPanelEntry)
    ? {
      back: describePanelEntry(previousPanelEntry),
      forward: describePanelEntry(nextPanelEntry),
      onBack: () => handlePanelBack({ moveFocus: true }),
      onForward: () => handlePanelForward({ moveFocus: true }),
    }
    : null;
  // Inside a game, offer a link to the games hub unless Back already leads there.
  const showQuizHubLink = quizGame !== 'hub' && !(
    previousPanelEntry?.kind === 'games' && (previousPanelEntry.game || 'hub') === 'hub'
  );

  // Auto-open the overview panel once per timeline load/creation. Deferred while the first-run
  // coach-mark tour is pending/open, so they never conflict.
  const overviewAutoShownRef = useRef(new Set());
  useEffect(() => {
    const id = currentTimeline?.id;
    const overview = (currentTimeline?.overview || '').trim();
    if (!id || !overview || currentTimeline?.isManual || currentTimeline?.creationSource === 'merged') return;
    const autoShowKey = `${id}:${timelineLoadKey}`;
    if (overviewAutoShownRef.current.has(autoShowKey)) return;
    if (isGuideOpen || guidePendingRef.current) return;
    const timer = setTimeout(() => {
      overviewAutoShownRef.current.add(autoShowKey);
      // Never take over a panel the user already opened.
      setPanelHistory((h) => (getCurrentPanel(h) ? h : pushPanel(h, { kind: 'overview' })));
    }, 550);
    return () => clearTimeout(timer);
  }, [currentTimeline?.id, currentTimeline?.overview, currentTimeline?.isManual, isGuideOpen, timelineLoadKey]);

  // Close the side panel (and forget its trail) whenever the board is cleared.
  useEffect(() => {
    if (!currentTimeline) {
      setPanelHistory(EMPTY_PANEL_HISTORY);
    }
  }, [currentTimeline]);

  // Safety net: reset layout/widget positions whenever a different timeline id becomes active
  // through any code path that did not already call resetAllElementPositionsAndState.
  useEffect(() => {
    const id = currentTimeline?.id ?? null;
    if (prevTimelineIdRef.current === id) return;
    prevTimelineIdRef.current = id;
    if (id) {
      resetAllElementPositionsAndState(id);
    }
  }, [currentTimeline?.id, resetAllElementPositionsAndState]);

  // Measure live top-banner & layer-bar vertical clearance so the top-right FloatingMapWidget
  // (icon capsule, PiP window, and split-map bar) steps cleanly below any active top banner
  // instead of colliding with it horizontally or covering its action buttons.
  const topBannersRef = useRef(null);
  const [canvasTopClearance, setCanvasTopClearance] = useState({ mapTop: null, splitBarTop: 12 });
  const isPartialPreviewForLayout = isPartialTimeline(currentTimeline);
  const isReadOnlyForLayout = Boolean(currentTimeline && (currentTimeline.isOwner === false || isPartialPreviewForLayout));
  const hasTopBannerCandidate = Boolean(
    currentTimeline && (
      (isReadOnlyForLayout && (isPartialPreviewForLayout || !isReadOnlyBannerDismissed) && !currentTimeline?._unsavedMerged && mapDisplayMode !== 'full')
      || errorMessage
    )
  );
  const hasLayerBarForLayout = (currentTimeline?.mergedSources?.length || 0) >= 2;

  useLayoutEffect(() => {
    if (typeof window === 'undefined' || !currentTimeline) {
      setCanvasTopClearance((prev) => (prev.mapTop === null && prev.splitBarTop === 12 ? prev : { mapTop: null, splitBarTop: 12 }));
      return undefined;
    }

    const measure = () => {
      const splitEl = splitContainerRef.current;
      if (!splitEl) return;
      const splitTop = Math.max(0, Math.round(splitEl.getBoundingClientRect().top));
      const bannersEl = topBannersRef.current;
      const bannerHeight = bannersEl ? bannersEl.offsetHeight : 0;
      const bannerBottomInSplit = bannerHeight > 0 ? bannersEl.offsetTop + bannerHeight : 0;

      const baseLaneHeaderOffset = isNarrowViewport ? 8 : (window.innerHeight <= 520 ? 12 : 38);
      const baseViewportTop = isNarrowViewport
        ? Math.max(60, splitTop + baseLaneHeaderOffset)
        : splitTop + baseLaneHeaderOffset;
      const bannerClearViewportTop = bannerBottomInSplit > 0 ? splitTop + bannerBottomInSplit + 8 : 0;
      const nextMapTop = Math.max(baseViewportTop, bannerClearViewportTop);

      const rawSplitBarTop = bannerBottomInSplit > 0 ? Math.max(12, bannerBottomInSplit + 8) : 12;
      const mapPaneHeight = mapPaneRef.current ? mapPaneRef.current.clientHeight : 0;
      const nextSplitBarTop = mapPaneHeight > 64
        ? Math.max(12, Math.min(rawSplitBarTop, mapPaneHeight - 52))
        : rawSplitBarTop;

      setCanvasTopClearance((prev) => (
        prev.mapTop === nextMapTop && prev.splitBarTop === nextSplitBarTop
          ? prev
          : { mapTop: nextMapTop, splitBarTop: nextSplitBarTop }
      ));
    };

    measure();

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (observer) {
      if (splitContainerRef.current) observer.observe(splitContainerRef.current);
      if (splitContainerRef.current?.parentElement) observer.observe(splitContainerRef.current.parentElement);
      if (topBannersRef.current) observer.observe(topBannersRef.current);
      if (mapPaneRef.current) observer.observe(mapPaneRef.current);
    }
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [
    currentTimeline,
    hasTopBannerCandidate,
    isPartialPreviewForLayout,
    isReadOnlyBannerDismissed,
    errorMessage,
    hasLayerBarForLayout,
    mapDisplayMode,
    isNarrowViewport,
    isWideDesktop,
    hasLeftDrawer,
    eventDrawerWidth,
    authLoading,
    publicRoute,
    isSharedViewLoading,
  ]);

  if (authLoading) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-surface text-ink gap-3 select-none">
        <div className="relative flex items-center justify-center">
          <div className="w-12 h-12 rounded-panel bg-accent-soft border border-line flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-accent" />
          </div>
        </div>
        <span className="text-xs text-ink-subtle font-medium tracking-wide">{t('app.starting')}</span>
      </div>
    );
  }

  // Public-page views (Features / Privacy / Terms)
  if (publicRoute === 'features') {
    return (
      <PublicPageShell
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onGoHome={handleClosePublicRoute}
        onOpenPublicRoute={handleOpenPublicRoute}
      >
        <Suspense fallback={null}>
          <FeaturesView onEnter={handleClosePublicRoute} />
        </Suspense>
      </PublicPageShell>
    );
  }

  if (publicRoute === 'privacy') {
    return (
      <PublicPageShell
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onGoHome={handleClosePublicRoute}
        onOpenPublicRoute={handleOpenPublicRoute}
      >
        <Suspense fallback={null}>
          <PrivacyView />
        </Suspense>
      </PublicPageShell>
    );
  }

  if (publicRoute === 'terms') {
    return (
      <PublicPageShell
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onGoHome={handleClosePublicRoute}
        onOpenPublicRoute={handleOpenPublicRoute}
      >
        <Suspense fallback={null}>
          <TermsView
            onOpenOpenSource={() => handleOpenPublicRoute('open-source')}
            onOpenPublicRoute={handleOpenPublicRoute}
          />
        </Suspense>
      </PublicPageShell>
    );
  }

  if (publicRoute === 'open-source') {
    return (
      <PublicPageShell
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onGoHome={handleClosePublicRoute}
        onOpenPublicRoute={handleOpenPublicRoute}
      >
        <Suspense fallback={null}>
          <OpenSourceView
            onBackToTerms={() => handleOpenPublicRoute('terms')}
          />
        </Suspense>
      </PublicPageShell>
    );
  }

  const isSharedView = !!sharedRouteId;

  // Anonymous/foreign visitor on a "/t/<id>" link before the fetch resolves.
  if (isSharedView && (isSharedViewLoading || (!currentTimeline && !sharedViewError))) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-surface text-ink gap-3 select-none">
        <div className="w-12 h-12 rounded-panel bg-accent-soft border border-line flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
        <span className="text-xs text-ink-subtle font-medium tracking-wide">{t('app.starting')}</span>
      </div>
    );
  }

  // Shared route error view (e.g. timeline deleted, private, or not found)
  if (isSharedView && sharedViewError && !currentTimeline) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-surface-sunken text-ink p-6 select-none">
        <div className="max-w-md w-full p-6 rounded-2xl bg-surface border border-line/80 shadow-card flex flex-col items-center text-center gap-4 animate-in fade-in zoom-in-95">
          <div className="w-12 h-12 rounded-xl bg-danger/10 text-danger flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-bold text-ink">
              {t('share.notFoundTitle') || 'ציר הזמן אינו זמין'}
            </h2>
            <p className="text-sm text-ink-muted leading-relaxed">
              {t('share.notFoundDesc') || 'ציר זמן זה אינו קיים, נמחק, או שהשיתוף שלו בוטל על ידי היוצר.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleGoHome}
            className="mt-2 px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-accent-fg text-sm font-semibold transition-colors cursor-pointer flex items-center gap-2 shadow-sm"
          >
            <Home className="w-4 h-4" />
            <span>{t('share.returnHome') || t('toolbar.home') || 'חזרה לדף הבית'}</span>
          </button>
        </div>
      </div>
    );
  }

  // Read-only whenever the viewer is not the owner of this timeline
  // (covers logged-out visitors, guests, and other users opening a public/shared timeline).
  // A generation's preview (P-03) is read-only too, until the finished result replaces it.
  const isPartialPreview = isPartialTimeline(currentTimeline);
  const isReadOnlyView = Boolean(currentTimeline && (currentTimeline.isOwner === false || isPartialPreview));
  const canEditImagePosition = Boolean(currentTimeline) && !isReadOnlyView;

  const hasRightDrawer = false;
  const leftDrawerWidth = hasLeftDrawer && eventDrawerWidth
    ? clampEventDrawerWidth(eventDrawerWidth)
    : (isQuizOpen && isQuizWide ? 560 : LEFT_DRAWER_WIDTH);
  // Below the wide-desktop breakpoint the side panel floats over the timeline instead of pushing
  // it aside; the canvas keeps the selected event clear of this covered strip. Default widths
  // mirror the panels' responsive classes (w-[340px] md:w-[380px] lg:w-[440px], wide quiz 560).
  let canvasLeftOcclusion = 0;
  if (!isNarrowViewport && !isWideDesktop && hasLeftDrawer) {
    const viewportW = typeof window === 'undefined' ? 1024 : window.innerWidth;
    if (eventDrawerWidth) canvasLeftOcclusion = clampEventDrawerWidth(eventDrawerWidth);
    else if (viewportW >= 1024) canvasLeftOcclusion = isQuizOpen && isQuizWide ? 560 : 440;
    else canvasLeftOcclusion = viewportW >= 768 ? 380 : 340;
  }

  // Position of the open event within the current chronological order, driving the
  // drawer's prev/next controls, counter, and their end-of-list disabled states.
  const desktopLeftOccupiedWidth = !isNarrowViewport
    ? LEFT_DOCK_WIDTH + (hasLeftDrawer ? (isWideDesktop ? leftDrawerWidth : canvasLeftOcclusion) : 0)
    : 0;

  let drawerNavProgress = null;
  if (showEventDrawer && selectedArticle) {
    const order = getNavigationOrder();
    const idx = order.findIndex((a) => isSameArticleId(a.id, selectedArticle.id));
    if (idx >= 0) drawerNavProgress = { current: idx + 1, total: order.length };
  }

  return (
    <div className={`fixed inset-0 flex flex-col w-full h-full h-[100dvh] text-ink overflow-hidden font-sans transition-colors duration-200 ${!currentTimeline ? 'home-screen-bg home-bg-particles' : 'bg-surface-sunken'}`}>
      {/* Living Ambient Aura Background (Night Constellations + Daylight Options) */}
      {!currentTimeline && <AmbientAuraBackground mode="particles" dayMode={dayBackground} />}

      {/* Top Navigation & Toolbar (Home screen only) */}
      {!currentTimeline && (
        <Toolbar
          timelineData={currentTimeline}
          onZoomIn={() => timelineRef.current?.zoomIn()}
          onZoomOut={() => timelineRef.current?.zoomOut()}
          onFitAll={() => timelineRef.current?.fitAll()}
          onOpenSaved={() => setIsSavedModalOpen(true)}
          onOpenAdmin={() => setIsAdminPanelOpen(true)}
          onExportJson={handleExportJson}
          onExportImage={handleExportImage}
          onOpenDisclaimer={() => setIsDisclaimerModalOpen(true)}
          onOpenAbout={() => setIsAboutModalOpen(true)}
          onOpenCommunitySupport={() => setIsCommunityModalOpen(true)}
          onStartGuide={handleStartGuide}
          isGenerating={isLoading}
          onStopGenerate={handleStopGenerate}
          theme={theme}
          onToggleTheme={handleToggleTheme}
          onGenerate={handleGenerate}
          onGoHome={handleGoHome}
          onOpenAuth={handleOpenAuth}
          onOpenPublicRoute={handleOpenPublicRoute}
          activePrompt={activePrompt}
          quota={quota}
          onOpenQuota={() => setIsSettingsOpen(true)}
        />
      )}


      {/* Unknown-subject notice: AI found no reliable public info (e.g. a private person) */}
      {unknownSubject !== null && !currentTimeline && !isLoading && (
        <UnknownSubjectNotice
          subject={unknownSubject}
          onUpload={() => {
            setUnknownSubject(null);
            openBuildOwn({ start: 'documents', title: unknownSubject });
          }}
          onPaste={() => {
            setUnknownSubject(null);
            openBuildOwn({ start: 'paste', title: unknownSubject });
          }}
          onManual={() => {
            setUnknownSubject(null);
            openBuildOwn({ start: 'blank', title: unknownSubject });
          }}
          onDismiss={() => setUnknownSubject(null)}
        />
      )}
      {/* Error banner (Home screen only; timeline banners render centered inside the visible canvas area) */}
      {errorMessage && !currentTimeline && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-30 bg-danger-soft border border-danger/30 text-danger px-4 py-3 rounded-panel text-xs flex flex-wrap items-center justify-center gap-3 shadow-card w-[calc(100%-24px)] sm:w-fit max-w-[min(36rem,calc(100%-24px))] text-center">
          <span>{errorMessage}</span>
          <BasicModeHint variant="error" errorMessage={errorMessage} className="basis-full justify-center text-center" />
          {isGuest && (
            <button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                handleOpenAuth('signin');
              }}
              className="px-3 py-1 rounded-control bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-caption transition-colors whitespace-nowrap shadow-control"
            >
              {t('toolbar.signInOrRegister') || 'Sign In / Register'}
            </button>
          )}
          {(errorMessage.includes('Gemini API key in Settings') || errorMessage.includes('your own free Gemini API key')) && (
            <button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                setIsSettingsOpen(true);
              }}
              className="px-3 py-1 rounded-control bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-caption transition-colors whitespace-nowrap shadow-control"
            >
              {t('quota.openSettings') || 'Open Key Settings'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-danger hover:text-ink ms-1 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Canvas Area */}
      <main className="flex-1 min-h-0 relative w-full overflow-hidden">
        {/* Left-edge vertical dock: consolidated timeline controls (Desktop only) */}
        {currentTimeline && (
          <LeftDockMenu
            resetKey={timelineLoadKey}
            timelineData={currentTimeline}
            densityMode={densityMode}
            onToggleDensityMode={handleToggleDensityMode}
            eventVisibility={eventVisibility}
            onChangeEventVisibility={handleChangeEventVisibility}
            activeFilter={timelineFilter}
            onFilterSelect={(dimension, item) => timelineRef.current?.setLegendFilter(dimension, item ? item.id : null)}
            onRenameFilterItem={handleRenameFilterItem}
            isCardsListOpen={isCardsListOpen}
            onToggleCardsList={handleToggleCardsList}
            isEditPanelOpen={isEditPanelOpen}
            onToggleEditPanel={isReadOnlyView ? undefined : handleToggleEditPanel}
            filterStarredOnly={filterStarredOnly}
            onToggleFilterStarredOnly={handleToggleFilterStarredOnly}
            starredCount={starredArticleIds.size}
            hasOverview={hasOverview}
            isOverviewOpen={isOverviewOpen}
            onToggleOverview={handleToggleOverview}
            isQuizOpen={isQuizOpen}
            onToggleQuiz={handleToggleQuiz}
            isPodcastOpen={isPodcastOpen}
            isPodcastMinimized={isPodcastMinimized}
            isPodcastPlaying={isPodcastPlaying}
            hasPodcastMobileOverlay={hasPodcastMobileOverlay}
            onTogglePodcast={handleTogglePodcast}
            onRectChange={setLeftDockRect}
            onGoHome={handleGoHome}
            onOpenSaved={() => setIsSavedModalOpen(true)}
            onOpenAddLayer={handleOpenAddLayerModal}
            activeLayerCount={currentTimeline?.mergedSources?.length || 1}
            canAddMoreLayers={(currentTimeline?.mergedSources?.length || 1) < MAX_MERGED_SOURCES}
            onExportImage={handleExportImage}
            onExportJson={handleExportJson}
            onOpenAdmin={() => setIsAdminPanelOpen(true)}
            onOpenAbout={() => setIsAboutModalOpen(true)}
            onOpenCommunitySupport={() => setIsCommunityModalOpen(true)}
            onOpenDisclaimer={() => setIsDisclaimerModalOpen(true)}
            onStartGuide={handleStartGuide}
            theme={theme}
            onToggleTheme={handleToggleTheme}
            themePreference={themePreference}
            onSetThemePreference={handleSetThemePreference}
            visualTheme={visualTheme}
            quota={quota}
            onOpenQuota={() => setIsSettingsOpen(true)}
            onOpenAuth={handleOpenAuth}
            onOpenPublicRoute={handleOpenPublicRoute}
            isReadOnlyView={isReadOnlyView}
            canShare={!isReadOnlyView && !!currentTimeline?.id}
            onGetShareLink={handleGetShareLink}
          />
        )}

        {/* Narrative overview reading panel (docked to the left dock rail) */}
        {currentTimeline && hasOverview && (
          <LazyMount
            key={`overview-mount-${currentTimeline.id || 'tl'}-${timelineLoadKey}`}
            isOpen={isOverviewOpen}
          >
            <TimelineOverviewPanel
              key={`overview-${currentTimeline.id || 'tl'}-${timelineLoadKey}`}
              timeline={currentTimeline}
              isOpen={isOverviewOpen}
              onClose={handleClosePanel}
              panelNav={isOverviewOpen ? panelNav : null}
              onRename={handleRenameTimeline}
              chatSuggestions={isReadOnlyView ? null : chatSuggestions}
              onAskChat={isReadOnlyView ? undefined : handleChatStarterPick}
              onBuildPersonalTimeline={() => {
                handleClosePanel();
                openBuildOwn();
              }}
              footer={currentTimeline?.isPersonal && !currentTimeline?.isLibrary ? (
                <TimelineLearnMore
                  timeline={currentTimeline}
                  canEdit={!isReadOnlyView && currentTimeline.isOwner !== false}
                  enrichStatus={enrichStatus}
                  onFindLinks={(opts) => runPersonalEnrichment(currentTimeline.id, opts)}
                  worldLayerStatus={worldLayerStatus}
                  onAddWorldEvents={user ? handleAddWorldEventsLayer : undefined}
                />
              ) : null}
              width={eventDrawerWidth}
              onWidthChange={handleEventDrawerWidthChange}
              style={{
                top: 0,
                bottom: 0,
                zIndex: FLOATING_Z.DRAWER,
              }}
            />
          </LazyMount>
        )}

        {/* Interactive timeline games hub panel (docked to the left dock rail) */}
        {currentTimeline && (
          <LazyMount
            key={`quiz-mount-${currentTimeline.id || 'tl'}-${timelineLoadKey}`}
            isOpen={isQuizOpen}
          >
            <TimelineQuizPanel
              key={`quiz-${currentTimeline.id || 'tl'}-${timelineLoadKey}`}
              timeline={currentTimeline}
              isOpen={isQuizOpen}
              onClose={handleClosePanel}
              activeGame={quizGame}
              onSelectGame={handleSelectQuizGame}
              showHubLink={showQuizHubLink}
              panelNav={isQuizOpen ? panelNav : null}
              onQuizGenerated={handleQuizGenerated}
              onWhoAmIGenerated={handleWhoAmIGenerated}
              onAfterGenerating={refreshQuota}
              quota={quota}
              onWideModeChange={setIsQuizWide}
              width={eventDrawerWidth}
              onWidthChange={handleEventDrawerWidthChange}
              onFocusArticle={(article) => {
                handleFocusTimelineArticle(article, { forceCenter: true });
              }}
              style={{
                top: 0,
                bottom: 0,
                zIndex: FLOATING_Z.DRAWER,
              }}
            />
          </LazyMount>
        )}

        {/* Interactive Timeline Podcast / Audio Tour Player */}
        {currentTimeline && (
          <LazyMount
            key={`podcast-mount-${timelineLoadKey}`}
            isOpen={isPodcastOpen && (currentTimeline?.articles?.length || 0) > 0}
          >
            <TimelinePodcastPlayer
              resetKey={timelineLoadKey}
              timeline={currentTimeline}
              isOpen={isPodcastOpen && (currentTimeline?.articles?.length || 0) > 0}
              isMinimized={isPodcastMinimized}
              onMinimizedChange={setIsPodcastMinimized}
              onClose={() => setIsPodcastOpen(false)}
              onFocusArticle={handlePodcastFocusArticle}
              onEnsureMapVisible={handleEnsureMapForPodcast}
              focusedArticleId={selectedArticle?.id || focusedArticleId}
              onPlayingChange={setIsPodcastPlaying}
              onMobileOverlayChange={setHasPodcastMobileOverlay}
              onRefreshQuota={refreshQuota}
              quota={quota}
              isGuest={isGuest}
              onOpenAuth={() => handleOpenAuth('signin')}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onGetShareLink={isReadOnlyView ? null : handleGetShareLink}
              isReadOnlyView={isReadOnlyView}
              isMobile={isNarrowViewport}
              bottomOffset={currentTimeline?.isManual ? disclaimerHeight : 0}
              leftOccupiedWidth={desktopLeftOccupiedWidth}
              isChatOpen={isChatOpen && !isReadOnlyView}
            />
          </LazyMount>
        )}

        {/* Conversational "Talk to the timeline" floating chat dock (hidden for read-only shared views) */}
        {currentTimeline && !isReadOnlyView && (
          <Suspense fallback={null}>
            <TimelineChatPanel
              key={`chat-${currentTimeline.id || 'tl'}-${timelineLoadKey}`}
              timelineId={currentTimeline.id}
              isOpen={isChatOpen}
              onClose={() => setIsChatOpen(false)}
              onOpen={() => setIsChatOpen(true)}
              timelineTitle={currentTimeline.title}
              messages={chatMessagesWithUndo}
              isBusy={isChatBusy}
              onSend={handleChatSend}
              onSendFiles={handleChatSendFiles}
              onStop={handleChatStop}
              onClear={handleChatClear}
              onUndo={handleChatUndo}
              seed={chatSeed}
              onSeedConsumed={() => setChatSeed(null)}
              isMobile={isNarrowViewport}
              attention={isChatTeaserOpen}
              suggestions={chatSuggestions}
            />
          </Suspense>
        )}
        {currentTimeline && !isReadOnlyView && (
          <ChatTeaser
            open={isChatTeaserOpen}
            anchorId="guide-chat-bubble"
            question={chatSuggestions.questions[0]}
            editIdea={chatSuggestions.edits[0]}
            onPick={handleChatStarterPick}
            onDismiss={(reason) => {
              setIsChatTeaserOpen(false);
              const key = reason === 'timeout' ? CHAT_TEASER_TIMEOUTS_KEY : CHAT_TEASER_CLOSED_KEY;
              try { localStorage.setItem(key, String(readCount(key) + 1)); } catch { }
            }}
          />
        )}

        {/* Edit Timeline Panel: docked side panel for editing details, overview, events, lanes, topics & photos (owners only) */}
        {currentTimeline && !isReadOnlyView && (
          <LazyMount
            key={`edit-panel-mount-${currentTimeline?.id || 'none'}-${timelineLoadKey}`}
            isOpen={isEditPanelOpen}
          >
            <TimelineEditPanel
              key={`edit-panel-${currentTimeline?.id || 'none'}-${timelineLoadKey}`}
              timeline={currentTimeline}
              isOpen={isEditPanelOpen}
              onClose={handleClosePanel}
              panelNav={isEditPanelOpen ? panelNav : null}
              width={eventDrawerWidth}
              onWidthChange={handleEventDrawerWidthChange}
              onApply={(next, meta) => handleApplyTimelineEdit(next, { ...meta, base: currentTimeline })}
              onUndo={handleUndoTimelineEdit}
              canUndo={Boolean(lastTimelineEditSnapshot)}
              onEditEvent={handleEditEventInPlace}
              onAddEvent={handleStartNewEvent}
              photos={trayPhotos}
              setPhotos={setTrayPhotos}
              onAssignPhoto={handleAssignTrayPhoto}
              onUndoPhoto={handleUndoTrayAssignment}
              canUndoPhoto={Boolean(lastTrayAssignment)}
              onOpenStoryStudio={
                isStoryStudioEnabled() && currentTimeline?.isPersonal && currentTimeline.timeScale !== 'prehistoric' && currentTimeline.isOwner !== false
                  ? () => {
                    setStoryStudioEditTimeline(currentTimeline);
                    setIsStoryStudioOpen(true);
                  }
                  : null
              }
              style={{
                top: 0,
                bottom: 0,
                zIndex: FLOATING_Z.DRAWER,
              }}
            />
          </LazyMount>
        )}

        {/* Cards List Drawer (docked to the left rail) */}
        {currentTimeline && (
          <LazyMount
            key={`cards-drawer-mount-${currentTimeline?.id || 'none'}-${timelineLoadKey}`}
            isOpen={isCardsListOpen}
          >
            <CardsListDrawer
              key={`cards-drawer-${currentTimeline?.id || 'none'}-${timelineLoadKey}`}
              isOpen={isCardsListOpen}
              onClose={handleClosePanel}
              panelNav={isCardsListOpen ? panelNav : null}
              articles={visibleTimeline?.articles || EMPTY_ARTICLES}
              lanes={visibleTimeline?.lanes || EMPTY_LANES}
              selectedArticleId={selectedArticle?.id || focusedArticleId}
              onSelectArticle={handleSelectArticleFromCardsList}
              starredArticleIds={starredArticleIds}
              onToggleStar={handleToggleStar}
              onImagePositionChange={canEditImagePosition ? handleSaveImagePosition : undefined}
              filterStarredOnly={filterStarredOnly}
              onToggleFilterStarredOnly={handleToggleFilterStarredOnly}
              width={eventDrawerWidth}
              onWidthChange={handleEventDrawerWidthChange}
              style={{
                top: 0,
                bottom: 0,
                zIndex: FLOATING_Z.DRAWER,
              }}
            />
          </LazyMount>
        )}

        {currentTimeline ? (
          <div
            style={{
              paddingLeft: !isNarrowViewport
                ? isWideDesktop && hasLeftDrawer
                  ? `calc(${LEFT_DOCK_WIDTH + leftDrawerWidth}px + env(safe-area-inset-left, 0px))`
                  : `calc(${LEFT_DOCK_WIDTH}px + env(safe-area-inset-left, 0px))`
                : '0px',
              paddingTop: isNarrowViewport
                ? 'calc(52px + env(safe-area-inset-top, 0px))'
                : '0px',
              paddingBottom: isNarrowViewport
                ? 'calc(52px + env(safe-area-inset-bottom, 0px))'
                : '0px',
            }}
            className={`w-full h-full flex flex-col overflow-hidden relative transition-[padding-left] duration-200 ease-out ${isDraggingSplit ? 'select-none cursor-row-resize' : ''
              }`}
          >
            {/* Layered Comparison Control Bar (shown when 2+ timelines are layered) */}
            {(currentTimeline?.mergedSources?.length || 0) >= 2 && (
              <TimelineLayerBar
                timeline={currentTimeline}
                hiddenLayerIds={hiddenLayerIds}
                onToggleHideLayer={handleToggleHideLayer}
                onZoomToLayer={handleZoomToLayer}
                onFitAll={() => timelineRef.current?.fitAll?.()}
                onMoveLayer={handleMoveLayer}
                onRemoveLayer={handleRemoveLayer}
                onToggleExpandSubLanes={handleToggleExpandSubLanes}
                onOpenAddLayer={handleOpenAddLayerModal}
                onSaveMerged={handleSaveMergedTimeline}
                isSavingMerged={isSavingMerged}
                mergedSavedDone={mergedSavedDone}
              />
            )}

            <div
              ref={splitContainerRef}
              className="flex-1 min-h-0 w-full flex flex-col relative overflow-hidden"
            >
            {/* Top: Geo Map pane (in split mode) */}
            {mapDisplayMode === 'split' && (
              <>
                <div
                  ref={mapPaneRef}
                  style={{ height: `${splitRatio}%`, zIndex: isNarrowViewport ? 10 : splitMapZ }}
                  onPointerDownCapture={isNarrowViewport ? undefined : raiseSplitMap}
                  className={`w-full relative shrink-0 overflow-hidden ${isDraggingSplit ? '' : 'transition-[height] duration-150 ease-out'
                    }`}
                >
                  {/* Floating Felt Quick Controls inside Split Map pane (Desktop only; mobile uses the top mode bar) */}
                  {!isNarrowViewport && (
                    <div
                      style={{ top: `${canvasTopClearance.splitBarTop}px` }}
                      className="chronix-map-split-bar absolute top-3 right-3 z-[1000] flex items-center gap-2 bg-surface-raised/90 backdrop-blur-2xl px-3 py-2 rounded-xl shadow-pop border border-line select-none animate-in fade-in slide-in-from-top-1 transition-[top] duration-200 ease-out"
                    >
                      {/* Title & Count Badge */}
                      <div className="flex items-center gap-2 pr-3 rtl:pr-0 rtl:pl-3 border-r rtl:border-r-0 rtl:border-l border-line">
                        <div className="p-1 rounded-lg bg-accent-soft text-accent">
                          <Map className="w-3.5 h-3.5" />
                        </div>
                        {geoArticlesCount > 0 && (
                          <span className="text-caption font-semibold tabular-nums px-2 py-0.5 rounded-full bg-surface-hover text-ink-muted border border-line">
                            {geoArticlesCount}
                          </span>
                        )}
                      </div>

                      {/* Segmented Mode buttons: PiP | Full | Close/Icon */}
                      <div className="flex items-center gap-1 bg-surface-hover/60 p-0.5 rounded-lg border border-line">
                        <button
                          type="button"
                          onClick={() => handleMapDisplayModeChange('pip')}
                          className="p-2 text-ink-muted hover:text-accent hover:bg-surface-raised rounded-md transition-all cursor-pointer"
                          title={t('floatingMap.pipTooltip')}
                          aria-label={t('floatingMap.pipTooltip')}
                        >
                          <Minimize2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMapDisplayModeChange('full')}
                          className="p-2 text-ink-muted hover:text-accent hover:bg-surface-raised rounded-md transition-all cursor-pointer"
                          title={t('floatingMap.fullTooltip')}
                          aria-label={t('floatingMap.fullTooltip')}
                        >
                          <Maximize2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMapDisplayModeChange('icon')}
                          className="p-2 text-ink-muted hover:text-danger hover:bg-danger-soft rounded-md transition-all cursor-pointer"
                          title={t('floatingMap.closeTooltip')}
                          aria-label={t('floatingMap.closeTooltip')}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  <Suspense fallback={<div className="w-full h-full bg-surface-sunken/40 animate-pulse" />}>
                    <GeoMapView
                      articles={visibleTimeline?.articles || EMPTY_ARTICLES}
                      lanes={visibleTimeline?.lanes || EMPTY_LANES}
                      selectedArticleId={selectedArticle?.id || focusedArticleId}
                      timelineId={currentTimeline?.id}
                      onSelectArticle={handleFocusArticle}
                      onFocusArticle={handleFocusTimelineArticle}
                      onOpenDetails={handleOpenArticleDetails}
                      theme={theme}
                      activeFilter={timelineFilter}
                      filterStarredOnly={filterStarredOnly}
                      starredArticleIds={starredArticleIds}
                      tileProvider={mapTileProvider}
                      onTileProviderChange={handleMapTileProviderChange}
                      onNavigate={handleMapNavigate}
                      isMobile={isNarrowViewport}
                      showEventCard={false}
                      hasRightDrawer={hasRightDrawer}
                      onRequestMapHeight={handleMapHeightRequest}
                      isGuidedPlayback={isPodcastPlaying}
                    />
                  </Suspense>
                </div>

                {/* Draggable Divider Bar - Frosted */}
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  tabIndex={0}
                  onMouseDown={handleSplitMouseDown}
                  onTouchStart={handleSplitTouchStart}
                  onDoubleClick={() => {
                    setSplitRatio(DEFAULT_SPLIT_RATIO);
                  }}
                  className={`group relative w-full ${isNarrowViewport ? 'h-6 touch-none' : 'h-3.5'} flex items-center justify-center cursor-row-resize bg-surface/80 backdrop-blur-md border-y border-line hover:bg-surface-hover transition-colors shrink-0 z-30 select-none ${isDraggingSplit ? 'bg-surface-active' : ''
                    }`}
                  title={t('floatingMap.resizeTooltip')}
                >
                  {/* Visual Grip pill */}
                  <div className="flex items-center gap-1 px-4 py-0.5 rounded-full bg-surface-raised border border-line shadow-control group-hover:border-line-strong transition-colors pointer-events-none">
                    <div className={`${isNarrowViewport ? 'w-10 h-1.5' : 'w-7 h-1'} rounded-full bg-ink-faint group-hover:bg-ink-muted transition-colors`} />
                  </div>
                </div>
              </>
            )}

            {/* Timeline pane */}
            <div
              key="timeline-pane"
              ref={timelinePaneRef}
              style={mapDisplayMode === 'split' ? { height: getTimelinePaneHeight(splitRatio, isNarrowViewport) } : undefined}
              className={`w-full relative overflow-hidden ${mapDisplayMode === 'split'
                  ? `shrink-0 ${isDraggingSplit ? '' : 'transition-[height] duration-150 ease-out'}`
                  : 'flex-1 h-full'
                }`}
            >
              {/* Interactive Timeline Canvas - preserved across mobile view switches */}
              <div
                className={`w-full h-full ${
                  isNarrowViewport && mobileTimelineView === 'feed'
                    ? 'invisible pointer-events-none'
                    : 'visible'
                }`}
              >
                <Suspense fallback={<div className="w-full h-full bg-surface animate-pulse" />}>
                  <TimelineView
                    key={`timeline-canvas-${currentTimeline?.id || 'none'}-${timelineLoadKey}`}
                    ref={timelineRef}
                    densityMode={densityMode}
                    showAllEvents={eventVisibility === 'all'}
                    // TimelineView diffs each new object itself: structural changes rebuild the
                    // canvas, text/date/detail edits are applied in place (image fields are pushed
                    // separately via setArticleImage). visibleTimeline only changes identity when
                    // the timeline data or the hidden layers change.
                    timelineData={visibleTimeline}
                    onSelectArticle={handleSelectArticle}
                    onDropPhotoOnArticle={isReadOnlyView ? undefined : handleAssignTrayPhoto}
                    onFocusArticle={handleFocusTimelineArticle}
                    onLensFocusChange={handleTimelineLensFocus}
                    selectedArticleId={selectedArticle?.id || focusedArticleId}
                    starredArticleIds={starredArticleIds}
                    filterStarredOnly={filterStarredOnly}
                    activeFilter={timelineFilter}
                    onToggleStar={handleToggleStar}
                    theme={theme}
                    visualTheme={visualTheme}
                    onFilterChange={handleTimelineFilterChange}
                    hasRightDrawer={hasRightDrawer}
                    leftOcclusion={canvasLeftOcclusion}
                    isNarrowViewport={isNarrowViewport}
                    forceDesktopCanvas={!isNarrowViewport || mobileTimelineView === 'classic'}
                    onImagePositionChange={canEditImagePosition ? handleSaveImagePosition : undefined}
                  />
                </Suspense>
              </div>

              {/* Mobile Feed View Overlay - rendered without unmounting canvas to preserve state */}
              {isNarrowViewport && (
                <div
                  className={`absolute inset-0 z-20 bg-surface ${
                    mobileTimelineView === 'feed' ? 'visible' : 'invisible pointer-events-none'
                  }`}
                >
                  {/* Mounted on first show only, then kept alive while hidden so scroll position
                      and filters survive view switches. */}
                  <LazyMount
                    key={`timeline-feed-mount-${currentTimeline?.id || 'none'}-${timelineLoadKey}`}
                    isOpen={mobileTimelineView === 'feed'}
                    fallback={<div className="w-full h-full bg-surface animate-pulse" />}
                  >
                    <TimelineCardFeed
                      key={`timeline-feed-${currentTimeline?.id || 'none'}-${timelineLoadKey}`}
                      articles={visibleTimeline?.articles || EMPTY_ARTICLES}
                      lanes={visibleTimeline?.lanes || EMPTY_LANES}
                      selectedArticleId={selectedArticle?.id || focusedArticleId}
                      onSelectArticle={handleSelectArticleFromMobileFeed}
                      starredArticleIds={starredArticleIds}
                      onToggleStar={handleToggleStar}
                      onImagePositionChange={canEditImagePosition ? handleSaveImagePosition : undefined}
                      filterStarredOnly={filterStarredOnly}
                      onToggleFilterStarredOnly={handleToggleFilterStarredOnly}
                      timeBands={visibleTimeline?.timeBands}
                      onVisibleArticleChange={handleFeedVisibleArticleChange}
                    />
                  </LazyMount>
                </div>
              )}
            </div>

            {/* Floating Canvas Top Banners (Read-Only notice & in-timeline errors):
                dynamically centered within the visible canvas area to the right of any open side drawer
                and below the mobile top bar / layer comparison bar. */}
            {((isReadOnlyView && (isPartialPreview || !isReadOnlyBannerDismissed) && !currentTimeline?._unsavedMerged && mapDisplayMode !== 'full') || errorMessage) && (
              <div
                ref={topBannersRef}
                data-canvas-top-banners
                style={{
                  zIndex: isNarrowViewport ? 38 : FLOATING_Z.FOCUSED,
                  ...(!isNarrowViewport && !isWideDesktop && hasLeftDrawer && eventDrawerWidth
                    ? { left: `${clampEventDrawerWidth(eventDrawerWidth)}px` }
                    : {}),
                }}
                className={`pointer-events-none absolute top-2.5 sm:top-3 right-0 ${
                  !isNarrowViewport && !isWideDesktop && hasLeftDrawer
                    ? `left-[340px] md:left-[380px] ${isQuizOpen && isQuizWide ? 'lg:left-[560px]' : 'lg:left-[440px]'}`
                    : 'left-0'
                } pl-3 pr-3 sm:pl-3 sm:pr-3 flex flex-col items-center gap-2 transition-[left,padding] duration-200 ease-out`}
              >
                {isPartialPreview && mapDisplayMode !== 'full' && (
                  <div
                    role="status"
                    aria-live="polite"
                    data-partial-timeline-banner
                    className="pointer-events-auto bg-surface-overlay/95 backdrop-blur-md border border-line text-ink-muted px-3 sm:px-4 py-2 sm:py-2 rounded-panel text-xs inline-flex items-center justify-center gap-2 shadow-card w-fit max-w-[min(40rem,100%)] text-center"
                  >
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-accent/30 border-t-accent animate-spin shrink-0" aria-hidden="true" />
                    <span className="text-balance">{t('app.partialTimelineBanner') || 'Adding images and links…'}</span>
                    <button
                      type="button"
                      onClick={() => {
                        // A file generation's preview stops its own job; otherwise it's the prompt generation.
                        if (filesAbortControllerRef.current) filesAbortControllerRef.current.abort();
                        else handleStopGenerate();
                      }}
                      className="ms-1 px-2 py-0.5 rounded-control text-caption font-semibold text-ink-subtle hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                    >
                      {t('app.partialTimelineStop') || 'Stop'}
                    </button>
                  </div>
                )}
                {isReadOnlyView && !isPartialPreview && !isReadOnlyBannerDismissed && !currentTimeline?._unsavedMerged && mapDisplayMode !== 'full' && (
                  <div className="pointer-events-auto bg-surface-overlay/95 backdrop-blur-md border border-line text-ink-muted px-3 sm:px-4 py-2 sm:py-2 rounded-panel text-xs flex flex-wrap items-center justify-center gap-x-3 gap-y-2 shadow-card w-fit max-w-[min(40rem,100%)] text-center">
                    <span className="inline-flex items-center justify-center gap-2 min-w-0">
                      {currentTimeline?.isLibrary && currentTimeline?.isPersonal ? (
                        <BookUser className="w-3.5 h-3.5 text-accent shrink-0" />
                      ) : currentTimeline?.isLibrary ? (
                        <Compass className="w-3.5 h-3.5 text-accent shrink-0" />
                      ) : (
                        <Eye className="w-3.5 h-3.5 text-accent shrink-0" />
                      )}
                      <span className="text-balance">
                        {currentTimeline?.isLibrary && currentTimeline?.isPersonal
                          ? t('library.personalDemoBanner')
                          : currentTimeline?.isLibrary
                            ? (t('library.readOnlyBanner') || t('app.sharedReadOnlyBanner'))
                            : (t('app.sharedReadOnlyBanner') || "You're viewing a shared, read-only timeline.")}
                      </span>
                    </span>
                    <div className="inline-flex flex-wrap items-center justify-center gap-2 sm:gap-2">
                      {currentTimeline?.isLibrary && currentTimeline?.isPersonal && (
                        <button
                          type="button"
                          onClick={() => {
                            openBuildOwn();
                          }}
                          className="theme-memory inline-flex items-center gap-1 px-3 py-1 rounded-control bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-caption transition-colors whitespace-nowrap shadow-control cursor-pointer"
                        >
                          <BookUser className="w-3 h-3 shrink-0" />
                          <span>{t('library.buildYourOwnCta')}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleOpenAddLayerModal}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-control bg-surface-raised hover:bg-surface-hover text-ink border border-line font-semibold text-caption transition-colors whitespace-nowrap shadow-control cursor-pointer"
                      >
                        <Layers className="w-3 h-3 text-accent shrink-0" />
                        <span>{t('layers.addLayerBtn')}</span>
                      </button>
                      {user && !isGuest ? (
                        <button
                          type="button"
                          onClick={handleSaveSharedCopy}
                          className={`px-3 py-1 rounded-control font-semibold text-caption transition-colors whitespace-nowrap shadow-control cursor-pointer ${
                            currentTimeline?.isLibrary && currentTimeline?.isPersonal
                              ? 'bg-surface-raised hover:bg-surface-hover text-ink border border-line'
                              : 'bg-accent hover:bg-accent-hover text-accent-fg'
                          }`}
                        >
                          {t('app.sharedSaveCopy') || 'Save a Copy'}
                        </button>
                      ) : !(currentTimeline?.isLibrary && currentTimeline?.isPersonal) ? (
                        <button
                          type="button"
                          onClick={() => handleOpenAuth('signin')}
                          className="px-3 py-1 rounded-control bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-caption transition-colors whitespace-nowrap shadow-control cursor-pointer"
                        >
                          {t('toolbar.signIn')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setIsReadOnlyBannerDismissed(true)}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-ink-subtle hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer"
                        title={t('common.close')}
                        aria-label={t('common.close')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                {!isReadOnlyView && (
                  <BasicModeNotice
                    onOpenKeySettings={() => setIsSettingsOpen(true)}
                    onSignIn={() => handleOpenAuth('signin')}
                    isBusy={isLoading || isChatBusy || isRefining}
                    registeredMode={quota?.registered_mode}
                    registeredLimit={quota?.registered_daily_limit}
                  />
                )}
                {errorMessage && (
                  <div className="pointer-events-auto bg-danger-soft/95 backdrop-blur-md border border-danger/30 text-danger px-4 py-3 rounded-panel text-xs flex flex-wrap items-center justify-center gap-3 shadow-card w-fit max-w-[min(36rem,100%)] text-center">
                    <span>{errorMessage}</span>
                    <BasicModeHint variant="error" errorMessage={errorMessage} className="basis-full justify-center text-center" />
                    {isGuest && (
                      <button
                        type="button"
                        onClick={() => {
                          setErrorMessage(null);
                          handleOpenAuth('signin');
                        }}
                        className="px-3 py-1 rounded-control bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-caption transition-colors whitespace-nowrap shadow-control cursor-pointer"
                      >
                        {t('toolbar.signInOrRegister') || 'Sign In / Register'}
                      </button>
                    )}
                    {(errorMessage.includes('Gemini API key in Settings') || errorMessage.includes('your own free Gemini API key')) && (
                      <button
                        type="button"
                        onClick={() => {
                          setErrorMessage(null);
                          setIsSettingsOpen(true);
                        }}
                        className="px-3 py-1 rounded-control bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-caption transition-colors whitespace-nowrap shadow-control cursor-pointer"
                      >
                        {t('quota.openSettings') || 'Open Key Settings'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setErrorMessage(null)}
                      className="text-danger hover:text-ink ms-1 font-bold cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Floating Map Widget (Icon | PiP | Full) */}
            <FloatingMapWidget
              key={`map-${currentTimeline?.id || 'none'}-${timelineLoadKey}`}
              articles={visibleTimeline?.articles || EMPTY_ARTICLES}
              lanes={visibleTimeline?.lanes || EMPTY_LANES}
              selectedArticleId={selectedArticle?.id || focusedArticleId}
              timelineId={currentTimeline?.id}
              onSelectArticle={handleFocusArticle}
              onFocusArticle={handleFocusTimelineArticle}
              onOpenDetails={handleOpenArticleDetails}
              theme={theme}
              mapMode={mapDisplayMode}
              onModeChange={handleMapDisplayModeChange}
              activeFilter={timelineFilter}
              filterStarredOnly={filterStarredOnly}
              starredArticleIds={starredArticleIds}
              tileProvider={mapTileProvider}
              onTileProviderChange={handleMapTileProviderChange}
              onNavigate={handleMapNavigate}
              isMobile={isNarrowViewport}
              hasLeftDrawer={hasLeftDrawer}
              isWideDesktop={isWideDesktop}
              leftDockWidth={LEFT_DOCK_WIDTH}
              leftDrawerWidth={leftDrawerWidth}
              isGuidedPlayback={isPodcastPlaying}
              topOffset={canvasTopClearance.mapTop}
            />

            {/* Mobile Top Controls: Persistent, Unified Command Bar (Mobile Portrait only) */}
            {isNarrowViewport && (
              <header
                id="chronix-mobile-top-bar"
                className="mobile-top-command-bar fixed top-0 inset-x-0 z-[49] flex items-center justify-between gap-2 px-3 select-none"
                style={{
                  paddingTop: 'env(safe-area-inset-top, 0px)',
                  height: 'calc(52px + env(safe-area-inset-top, 0px))',
                }}
              >
                {/* 1. Leading Action: Floating Map Toggle */}
                <div className="flex items-center shrink-0 w-9">
                  <button
                    type="button"
                    onClick={() => {
                      const nextMode = mapDisplayMode !== 'icon' ? 'icon' : 'split';
                      handleMapDisplayModeChange(nextMode);
                    }}
                    className={`chronix-chat-top-btn relative ${mapDisplayMode !== 'icon' ? 'is-active' : ''}`}
                    title={mapDisplayMode !== 'icon' ? (t('floatingMap.closeTooltip') || t('common.close') || 'Close Map') : (t('floatingMap.splitTooltip') || t('mobile.map') || 'Map')}
                    aria-label={t('mobile.map') || 'Map'}
                  >
                    <span className="chronix-chat-top-inner">
                      {mapDisplayMode !== 'icon' ? (
                        <X className="w-3.5 h-3.5 shrink-0" strokeWidth={2.2} />
                      ) : (
                        <Map className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                      )}
                    </span>
                    {mapDisplayMode === 'icon' && geoArticlesCount > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-0.5 text-[9px] font-bold rounded-full bg-accent text-accent-fg flex items-center justify-center shadow-xs pointer-events-none">
                        {geoArticlesCount}
                      </span>
                    )}
                  </button>
                </div>

                {/* 2. Center: Persistent View Mode Switcher (Feed | Focus | Classic) */}
                <div
                  role="radiogroup"
                  aria-label={t('mobile.viewMode') || 'View Mode'}
                  className="seg-track flex items-center gap-0.5 p-1 rounded-control min-w-0"
                >
                  <button
                    type="button"
                    role="radio"
                    data-mobile-view="feed"
                    aria-checked={mobileTimelineView === 'feed'}
                    onClick={handleShowMobileFeed}
                    title={t('mobile.viewFeedHint') || t('mobile.viewFeed')}
                    className={`seg-item flex min-h-[36px] items-center justify-center gap-1 rounded-control px-3 max-[359px]:px-2 text-xs max-[359px]:text-caption font-semibold whitespace-nowrap cursor-pointer touch-manipulation transition-all ${
                      mobileTimelineView === 'feed'
                        ? 'seg-item-active text-ink shadow-xs'
                        : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    <Rows3 className="w-3.5 h-3.5 shrink-0" />
                    <span>{t('mobile.viewFeed')}</span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    data-mobile-view="canvas"
                    aria-checked={mobileTimelineView === 'canvas'}
                    onClick={handleShowMobileCanvas}
                    title={t('mobile.viewCanvasHint') || t('mobile.viewCanvas')}
                    className={`seg-item flex min-h-[36px] items-center justify-center gap-1 rounded-control px-3 max-[359px]:px-2 text-xs max-[359px]:text-caption font-semibold whitespace-nowrap cursor-pointer touch-manipulation transition-all ${
                      mobileTimelineView === 'canvas'
                        ? 'seg-item-active text-ink shadow-xs'
                        : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    <Scan className="w-3.5 h-3.5 shrink-0" />
                    <span>{t('mobile.viewCanvas')}</span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    data-mobile-view="classic"
                    aria-checked={mobileTimelineView === 'classic'}
                    onClick={handleShowMobileClassic}
                    title={t('mobile.viewClassicHint') || t('mobile.viewClassic')}
                    className={`seg-item flex min-h-[36px] items-center justify-center gap-1 rounded-control px-3 max-[359px]:px-2 text-xs max-[359px]:text-caption font-semibold whitespace-nowrap cursor-pointer touch-manipulation transition-all ${
                      mobileTimelineView === 'classic'
                        ? 'seg-item-active text-ink shadow-xs'
                        : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    <span>{t('mobile.viewClassic')}</span>
                  </button>
                </div>

                {/* 3. Trailing Action: Timeline AI Copilot Chat */}
                <div className="flex items-center justify-end shrink-0 w-9">
                  {currentTimeline && !isReadOnlyView ? (
                    <button
                      id="guide-chat-bubble"
                      data-guide="chat-bubble"
                      type="button"
                      onClick={() => setIsChatOpen((prev) => !prev)}
                      className={`chronix-chat-top-btn ${isChatOpen ? 'is-active' : ''} ${isChatTeaserOpen ? 'chronix-chat-attention' : ''}`}
                      title={t('chat.title') || 'AI Chat'}
                      aria-label={t('chat.open')}
                    >
                      <span className="chronix-chat-top-inner">
                        <MessageSquare className="w-3.5 h-3.5 shrink-0" strokeWidth={2.2} />
                      </span>
                      {isChatBusy && (
                        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-warning border-2 border-surface animate-pulse z-20 pointer-events-none" />
                      )}
                    </button>
                  ) : (
                    <div className="w-8 h-8" />
                  )}
                </div>
              </header>
            )}
            </div>

            {/* Manual-authorship note for hand-built (non-AI) personal timelines only. It lives
                inside the canvas column, so it clears the desktop dock and the mobile bottom bar;
                the podcast player lifts itself above it (podcastBottomOffset). */}
            {currentTimeline?.isManual && (
              <footer ref={disclaimerRef} className={`relative z-20 shrink-0 w-full bg-surface-overlay border-t border-line px-3 sm:px-4 select-none flex items-center gap-2 ${
                isDisclaimerExpanded ? 'min-h-9 py-2' : 'h-9'
              }`}>
                <ShieldCheck className="w-4 h-4 shrink-0 text-success self-start mt-0.5" aria-hidden="true" />
                {/* Too long for a phone: a tap shows all of it (touch screens have no tooltip). */}
                <button
                  type="button"
                  onClick={() => setIsDisclaimerExpanded((v) => !v)}
                  aria-expanded={isDisclaimerExpanded}
                  className={`min-w-0 text-start text-caption text-ink-muted cursor-pointer ${isDisclaimerExpanded ? 'whitespace-normal leading-snug' : 'truncate'}`}
                  title={`${t('personalDisclaimer.prefix')} ${t(personalDisclaimerKey)}`}
                >
                  <strong className="text-ink font-semibold">{t('personalDisclaimer.prefix')}</strong> {t(personalDisclaimerKey)}
                </button>
              </footer>
            )}
          </div>
        ) : (
          <div
            ref={homeScrollRef}
            onScroll={handleHomeScroll}
            className="home-screen-scroll-container w-full h-full overflow-y-auto overscroll-y-contain flex flex-col items-center text-center pt-3 sm:pt-6 px-3 sm:px-6 pb-0 select-none animate-in fade-in duration-300 bg-transparent relative z-10"
          >
            {/* Full-Viewport Hero & Search Section (strictly isolated from sections below the fold) */}
            <div className="home-hero-container w-full max-w-4xl mx-auto min-h-full shrink-0 flex flex-col items-center">
              <div className="w-full flex flex-col items-center mt-[max(1rem,6dvh)] mb-auto sm:my-auto py-3 sm:py-6">
                {/* Hero Branding & Welcome */}
                <div className="home-hero-logo mb-0.5 sm:mb-1">
                  <ChroniXLogo size="lg" className="w-auto h-12 sm:h-20" />
                </div>
                <div className="home-hero-text space-y-2 sm:space-y-2 flex flex-col items-center px-2">
                  <h2 className="home-hero-title text-xl sm:text-2xl md:text-3xl font-semibold text-ink tracking-tight font-sans">
                    {t('home.title')}
                  </h2>
                  <p className="home-hero-subtitle text-body-sm sm:text-body text-ink-muted max-w-xl leading-relaxed font-sans font-normal">
                    {t('home.subtitle')}
                  </p>
                </div>

                {/* Basic-mode heads-up (once per credit day) when fast AI credits run out */}
                <div className="w-full max-w-2xl mt-4 flex justify-center empty:hidden">
                  <BasicModeNotice
                    onOpenKeySettings={() => setIsSettingsOpen(true)}
                    onSignIn={() => handleOpenAuth('signin')}
                    isBusy={isLoading}
                    registeredMode={quota?.registered_mode}
                    registeredLimit={quota?.registered_daily_limit}
                  />
                </div>

                {/* Primary Search Bar (centered focal point of the home screen) */}
                <div className="home-search-wrapper w-full mt-3 sm:mt-6 mb-2 sm:mb-3">
                  <PromptBar
                    onGenerate={handleGenerate}
                    onStop={handleStopGenerate}
                    isLoading={isLoading}
                    activePrompt={activePrompt}
                    onOpenPromptGuide={() => setIsPromptGuideOpen(true)}
                  />
                </div>

                {/* Quick actions (top): Tell Your Story (personal timeline builder) + Prompt guide */}
                <div
                  id="guide-home-quick-actions"
                  data-guide="home-quick-actions"
                  className="home-quick-actions pb-1 flex flex-wrap items-center justify-center gap-2 sm:gap-3"
                  dir={isRtl ? 'rtl' : 'ltr'}
                >
                  {/* The door to personal / family stories: symmetrically balanced, centered, and cohesive with system typography. */}
                  <button
                    type="button"
                    onClick={() => {
                      openBuildOwn();
                    }}
                    disabled={isLoading}
                    title={t('buildOwn.homeBtnSub')}
                    className="theme-memory group inline-flex items-center justify-center gap-2.5 sm:gap-3 min-h-11 px-2.5 py-2 rounded-pill bg-surface-raised hover:bg-surface-hover/60 border border-accent/30 hover:border-accent/60 shadow-card hover:shadow-pop text-center transition-[background-color,border-color,box-shadow,transform] duration-150 cursor-pointer motion-safe:active:scale-[0.98] disabled:opacity-50 disabled:cursor-default"
                  >
                    <span className="flex items-center justify-center w-8 h-8 rounded-full bg-accent-soft text-accent shrink-0 transition-transform duration-150 group-hover:scale-105">
                      <BookUser className="w-4 h-4" />
                    </span>
                    <span className="flex flex-col items-center text-center leading-snug">
                      <span className="font-sans text-body-sm sm:text-[15px] font-semibold tracking-tight text-ink">{t('buildOwn.homeBtn')}</span>
                      <span className="hidden sm:block text-caption text-ink-muted">{t('buildOwn.homeBtnHint')}</span>
                    </span>
                    <span aria-hidden="true" className="flex items-center justify-center w-8 h-8 rounded-full text-ink-subtle group-hover:text-accent group-hover:bg-accent-soft/60 shrink-0 transition-[color,background-color,transform] duration-150 rtl:group-hover:-translate-x-0.5 ltr:group-hover:translate-x-0.5">
                      {isRtl ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </span>
                  </button>
                </div>

                {/* Example Prompts (compact, secondary - moved below the main search); swapped
                    for a rotating trivia ticker while a generation is in flight so the wait
                    feels shorter than staring at now-irrelevant, disabled example chips. */}
                <div className="home-prompt-examples w-full mt-2 sm:mt-4">
                  {isLoading ? (
                    <>
                      <TriviaTicker prompt={activePrompt} />
                      <AiQueueNotice className="mt-2" />
                      <BasicModeHint variant="loading" className="justify-center mt-2" />
                    </>
                  ) : (
                    <PromptExamples
                      onSelectPrompt={handleSelectPrompt}
                      isGenerating={isLoading}
                    />
                  )}
                </div>
              </div>

              {/* Subtle bottom-center scroll cue toward the Public Library */}
              {(() => {
                const showScrollHint = hasHomeLibraryItems && !isLoading && !isHomeScrolled;
                return (
                  <div className="home-scroll-hint-slot h-12 sm:h-14 shrink-0 flex items-center justify-center pb-2 sm:pb-4">
                    <button
                      type="button"
                      onClick={handleScrollToHomeLibrary}
                      tabIndex={showScrollHint ? 0 : -1}
                      aria-hidden={!showScrollHint}
                      className={`group flex flex-col items-center gap-0.5 px-4 py-1 rounded-full text-ink-subtle/85 hover:text-ink transition-opacity duration-300 cursor-pointer ${
                        showScrollHint ? 'opacity-100' : 'opacity-0 pointer-events-none'
                      }`}
                    >
                      <span className="text-caption sm:text-xs font-normal tracking-wide transition-colors">
                        {t('library.scrollDownHint')}
                      </span>
                      <ChevronDown className="w-4 h-4 text-ink-subtle/80 group-hover:text-ink transition-colors home-scroll-hint-arrow" />
                    </button>
                  </div>
                );
              })()}
            </div>

            <HomeLibrarySection
              onSelectTimeline={handleSelectFromHomeLibrary}
              onMergeTimelines={handleMergeFromHomeLibrary}
              onOpenBuildPersonal={() => {
                openBuildOwn();
              }}
              onAvailabilityChange={setHasHomeLibraryItems}
              isAdmin={Boolean(quota?.is_admin)}
              disabled={isLoading}
            />

            <FeatureShowcase />

            {/* Public Footer */}
            <div className="w-full pb-12">
              <PublicFooter
                onOpenPublicRoute={handleOpenPublicRoute}
              />
            </div>
          </div>
        )}

        {/* Empty personal timeline overlay: shown over the (empty) canvas until the first event
            is added. Only for an active, editable personal/manual timeline with no events. */}
        {currentTimeline && !isReadOnlyView && Boolean(currentTimeline.isPersonal || currentTimeline.isManual) && (currentTimeline.articles?.length ?? 0) === 0 && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center text-center p-6 bg-surface-sunken/95 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="p-3 rounded-panel bg-surface-raised border border-line shadow-card mb-4">
              <BookUser className="w-7 h-7 text-ink-subtle" />
            </div>
            <h3 className="text-lg font-bold text-ink mb-2">
              {t('emptyState.title')}
            </h3>
            <p className="text-sm text-ink-muted max-w-md leading-relaxed mb-5">
              {t('emptyState.body')}
            </p>
            <button
              type="button"
              onClick={handleStartNewEvent}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-control bg-accent hover:bg-accent-hover text-accent-fg text-sm font-semibold shadow-card transition-colors cursor-pointer active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>{t('emptyState.addFirst')}</span>
            </button>
          </div>
        )}

        {/* Selected Article Detail Drawer. Spans `main` below the top toolbar down to
            the bottom of the page - including over the map pane in
            split mode (z-index DRAWER sits above the map/floating overlays, below the toolbar's
            own open dropdowns). */}
        {(showEventDrawer || showNewEventDrawer) && (
          <ErrorBoundary
            onReset={showNewEventDrawer ? handleCancelNewEvent : handleCloseEventPanel}
            fallback={(err, reset) => (
              <div className="fixed bottom-6 right-6 z-50 bg-surface-raised text-danger p-4 rounded-panel shadow-panel flex items-center gap-3 text-xs border border-danger/30">
                <span>Failed to display event details: {err?.message}</span>
                <button
                  onClick={reset}
                  className="bg-surface hover:bg-surface-hover px-2 py-1 rounded-control text-ink border border-line font-medium cursor-pointer"
                >
                  {t('common.close')}
                </button>
              </div>
            )}
          >
            <Suspense fallback={null}>
              <EventDrawer
                article={showNewEventDrawer ? NEW_EVENT_DRAFT : selectedArticle}
                isNew={showNewEventDrawer}
                onSaveEdit={showNewEventDrawer ? handleSaveNewEvent : handleSaveEditedEvent}
                editRequestId={eventEditRequestId}
                onEditRequestHandled={() => setEventEditRequestId(null)}
                onEditDirtyChange={handleEventEditDirtyChange}
                lanes={currentTimeline?.lanes || []}
                articles={currentTimeline?.articles || []}
                timelineId={currentTimeline?.id}
                timelineTitle={currentTimeline?.title || ''}
                timelineTags={currentTimeline?.tags || []}
                timelineTimeScale={currentTimeline?.timeScale || 'calendar'}
                isTimelineFictional={Boolean(currentTimeline?.isFictional)}
                isTimelinePersonal={Boolean(currentTimeline?.isPersonal)}
                grounding={currentTimeline?.grounding}
                isStarred={!showNewEventDrawer && selectedArticle ? (starredArticleIds.has(selectedArticle.id) || (selectedArticle.id != null && (starredArticleIds.has(String(selectedArticle.id)) || starredArticleIds.has(Number(selectedArticle.id))))) : false}
                onToggleStar={handleToggleStar}
                style={{
                  top: 0,
                  bottom: 0,
                  zIndex: FLOATING_Z.DRAWER,
                }}
                onClose={showNewEventDrawer ? handleCancelNewEvent : handleCloseEventPanel}
                panelNav={panelNav}
                onDelete={handleDeleteEvent}
                onAskAi={handleAskAiAboutEvent}
                onImagePositionChange={(position) => handleSaveImagePosition(selectedArticle.id, position)}
                onEventImageGenerated={handleSaveEventImage}
                onSetCoverImage={(idx) => handleSetEventCoverImage(selectedArticle.id, idx)}
                onAddEventPhoto={(url, options) => handleAddEventPhoto(selectedArticle.id, url, options)}
                quota={quota}
                onRefreshQuota={refreshQuota}
                onVideosFound={handleSaveEventVideos}
                onShowOnMap={mapDisplayMode === 'icon' ? handleShowArticleOnMap : undefined}
                onDismissContextLink={handleDismissContextLink}
                readOnly={isReadOnlyView}
                width={eventDrawerWidth}
                onWidthChange={handleEventDrawerWidthChange}
                navProgress={drawerNavProgress}
                onNavigateNext={() => handleStepEvent(1)}
                onNavigatePrev={() => handleStepEvent(-1)}
              />
            </Suspense>
          </ErrorBoundary>
        )}
      </main>

      {/* Modals */}
      <LazyMount isOpen={isAiRefineOpen}>
        <AiRefineModal
          isOpen={isAiRefineOpen}
          onClose={() => {
            handleStopRefine();
            setIsAiRefineOpen(false);
          }}
          onRefine={handleRefine}
          isLoading={isRefining}
          currentTimeline={currentTimeline}
          quota={quota}
        />
      </LazyMount>

      <LazyMount isOpen={isSavedModalOpen}>
        <SavedTimelinesModal
          isOpen={isSavedModalOpen}
          onClose={() => setIsSavedModalOpen(false)}
          onSelectTimeline={handleSelectTimeline}
          onImportJson={handleImportJson}
          onOpenAuth={handleOpenAuth}
          onMergeTimelines={handleMergeTimelineIds}
        />
      </LazyMount>

      <LazyMount isOpen={isLibraryModalOpen}>
        <ExploreLibraryModal
          isOpen={isLibraryModalOpen}
          onClose={() => setIsLibraryModalOpen(false)}
          mode="add-layer"
          onSelectTimeline={handleSelectTimeline}
          onMergeTimelines={handleMergeTimelineIds}
          onAddLayerTimeline={handleAddLayerTimeline}
          activeLayerSourceIds={
            Array.isArray(currentTimeline?.mergedSources) && currentTimeline.mergedSources.length >= 2
              ? currentTimeline.mergedSources.map((s) => s.id).filter(Boolean)
              : (currentTimeline?.id ? [currentTimeline.id] : [])
          }
        />
      </LazyMount>

      <LazyMount isOpen={isAdminPanelOpen}>
        <AdminPanel
          isOpen={isAdminPanelOpen}
          onClose={() => setIsAdminPanelOpen(false)}
          onSelectTimeline={handleSelectTimeline}
          quota={quota}
        />
      </LazyMount>

      <LazyMount isOpen={isStoryStudioOpen}>
        <StoryStudio
          isOpen={isStoryStudioOpen}
          onClose={() => {
            setIsStoryStudioOpen(false);
            setStoryStudioEditTimeline(null);
          }}
          initialName={storyStudioInitialName}
          initialStart={storyStudioInitialStart}
          editTimeline={storyStudioEditTimeline}
          theme={theme}
          onSave={async (next, meta) => {
            // Story Studio edited the copy it opened with: apply only its changes (B-04).
            const base = storyStudioEditTimeline;
            setIsStoryStudioOpen(false);
            setStoryStudioEditTimeline(null);
            await handleApplyTimelineEdit(next, { ...meta, base });
            // Wikipedia links for the events the edit added, on timelines enriched before (older
            // ones use "Find Wikipedia links" in the Overview: no surprise AI charge on a save).
            if ((next.articles || []).some((a) => a?.enrichV)) {
              runPersonalEnrichment(next.id, { images: Boolean(meta?.illustrativeImages), history: meta?.history !== false });
            }
          }}
          onCreate={async (data, options = {}) => {
            setIsStoryStudioOpen(false);
            await handleCreatePersonalTimeline(data);
            if (data?.articles?.length) {
              runPersonalEnrichment(data.id, { images: Boolean(options.illustrativeImages), history: options.history !== false, source: data });
            }
          }}
          onGenerateFromDocuments={handleGenerateFromDocuments}
          onOpenTimeline={(id) => {
            // A book import was created on the server: open the saved copy (no second save).
            setIsStoryStudioOpen(false);
            setStoryStudioEditTimeline(null);
            window.dispatchEvent(new Event(TIMELINES_UPDATED_EVENT));
            handleSelectTimeline(id);
          }}
        />
      </LazyMount>

      <LazyMount isOpen={Boolean(storyReady)}>
        <StoryReadyCard
          ready={storyReady && currentTimeline && String(currentTimeline.id) === String(storyReady.id) ? storyReady : null}
          onDismiss={dismissStoryReady}
          onRetry={retryStoryTimelineSave}
          onShare={handleGetShareLink}
        />
      </LazyMount>

      <LazyMount isOpen={isSettingsOpen}>
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onOpenCommunitySupport={() => setIsCommunityModalOpen(true)}
          quota={quota}
          onRefreshQuota={refreshQuota}
        />
      </LazyMount>

      <LazyMount isOpen={isDisclaimerModalOpen}>
        <AiDisclaimerModal
          isOpen={isDisclaimerModalOpen}
          onClose={() => setIsDisclaimerModalOpen(false)}
          model={!currentTimeline?.isManual ? (currentTimeline?.tokenUsage?.model || currentTimeline?.model) : null}
          tokenUsage={!currentTimeline?.isManual ? (currentTimeline?.tokenUsage || null) : null}
        />
      </LazyMount>

      <LazyMount isOpen={isPromptGuideOpen}>
        <PromptGuideModal
          isOpen={isPromptGuideOpen}
          onClose={() => setIsPromptGuideOpen(false)}
          onUsePrompt={handleUseGuidePrompt}
        />
      </LazyMount>

      <LazyMount isOpen={isAboutModalOpen}>
        <AboutModal
          isOpen={isAboutModalOpen}
          onClose={() => setIsAboutModalOpen(false)}
          onOpenCommunitySupport={() => setIsCommunityModalOpen(true)}
        />
      </LazyMount>

      <LazyMount isOpen={isCommunityModalOpen}>
        <CommunitySupportModal
          isOpen={isCommunityModalOpen}
          onClose={() => setIsCommunityModalOpen(false)}
          quota={quota}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />
      </LazyMount>



      {isTimelineGuideEnabled() && (
        <LazyMount isOpen={isGuideOpen}>
          <InteractiveGuide
            isOpen={isGuideOpen}
            steps={guideSteps}
            onClose={handleCloseGuide}
          />
        </LazyMount>
      )}

      {isHomeGuideEnabled() && (
        <LazyMount isOpen={isHomeGuideOpen}>
          <InteractiveGuide
            isOpen={isHomeGuideOpen}
            steps={homeGuideSteps}
            onClose={handleCloseHomeGuide}
          />
        </LazyMount>
      )}

      <LazyMount isOpen={isAuthModalOpen}>
        <AuthModal
          isOpen={isAuthModalOpen}
          onClose={() => setIsAuthModalOpen(false)}
          initialMode={authModalInitialMode}
          onOpenPublicRoute={handleOpenPublicRoute}
        />
      </LazyMount>


    </div>
  );
}

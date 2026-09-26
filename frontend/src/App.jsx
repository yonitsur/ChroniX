import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import confetti from 'canvas-confetti';
import { toPng } from 'html-to-image';
import Toolbar from './components/Toolbar';
import TimelineView from './components/TimelineView';
import GeoMapView, { ACTIVE_TILE_PROVIDER } from './components/GeoMapView';
import EventDrawer from './components/EventDrawer';
import ErrorBoundary from './components/ErrorBoundary';
import CardsListDrawer from './components/CardsListDrawer';
import TimelineCardFeed from './components/timeline/TimelineCardFeed';
import EventEditModal from './components/EventEditModal';
import AiRefineModal from './components/AiRefineModal';
import SavedTimelinesModal from './components/SavedTimelinesModal';
import AdminPanel from './components/AdminPanel';
import PersonalTimelineModal from './components/PersonalTimelineModal';
import SettingsModal from './components/SettingsModal';
import AiDisclaimerModal from './components/AiDisclaimerModal';
import PromptGuideModal from './components/PromptGuideModal';
import AboutModal from './components/AboutModal';
import LeftDockMenu from './components/LeftDockMenu';
import TimelineOverviewPanel from './components/TimelineOverviewPanel';
import TimelineChatPanel from './components/TimelineChatPanel';
import ChatTeaser from './components/ChatTeaser';
import { getChatSuggestions } from './utils/chatSuggestions';
import InteractiveGuide from './components/InteractiveGuide';
import { buildGuideSteps, buildHomeGuideSteps, closeHomeMenu } from './data/interactiveGuideSteps';
import {
  isInteractiveGuideEnabled,
  isHomeGuideEnabled,
  isTimelineGuideEnabled,
} from './utils/featureFlags';
import AuthModal from './components/AuthModal';
import QuickAuthPrompt from './components/QuickAuthPrompt';
import GoogleOneTap from './components/GoogleOneTap';
import FeaturesView from './components/public/FeaturesView';
import PrivacyView from './components/public/PrivacyView';
import TermsView from './components/public/TermsView';
import OpenSourceView from './components/public/OpenSourceView';
import PublicPageShell from './components/public/PublicPageShell';
import FeatureShowcase from './components/public/FeatureShowcase';
import PublicFooter from './components/public/PublicFooter';
import { useAuth } from './context/AuthContext';
import { useLanguage } from './context/LanguageContext';
import ChroniXLogo from './components/ChroniXLogo';
import PromptBar from './components/PromptBar';
import PromptExamples from './components/PromptExamples';
import TriviaTicker from './components/TriviaTicker';
import FloatingMapWidget from './components/FloatingMapWidget';
import AmbientAuraBackground from './components/AmbientAuraBackground';
import { useFloatingFocus, FLOATING_Z } from './utils/floatingFocus';
import { DEFAULT_LANE_COLORS, getDistinctCategories, getCategoryColor } from './data/laneColors';
import { readGroundingPref } from './utils/groundingConfig';
import { isSameArticleId } from './utils/timelineArticles';
import { FolderOpen, AlertTriangle, Loader2, Map, MapPin, Maximize2, Minimize2, X, Columns2, BookUser, Lightbulb, Plus, ShieldCheck, Eye, ChevronDown, Clock, Scan, RectangleVertical, RectangleHorizontal, Rows3, ArrowUpRight, MessageSquare, Home } from 'lucide-react';

import {
  generateTimeline,
  generateTimelineFromFiles,
  refineTimeline,
  chatWithTimeline,
  chatAttachFilesToTimeline,
  fetchTimeline,
  saveTimeline,
  setTimelineShareEnabled,
  getApiKey,
  fetchUserQuota,
  getActiveAiJob,
  setActiveAiJob,
  clearActiveAiJob,
  cancelAiJob,
  pollAiJob
} from './api';

// Clearance to keep the Event Detail Drawer above the bottom of the browser window (0 = all the way down).
const EVENT_DRAWER_BOTTOM_CLEARANCE = 0;

const LEFT_DOCK_WIDTH = 52;
const LEFT_DRAWER_WIDTH = 440;

// How many recent chat-edit snapshots to persist for post-reload undo (per timeline).
const MAX_CHAT_UNDO = 5;

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
const CHAT_TEASER_AFTER_TOUR_MS = 1200;
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
  return y + (m * 30 + d) / 365;
};



export default function App() {
  const { user, loading: authLoading, isGuest } = useAuth();
  const { isRtl, t, formatDatePart } = useLanguage();
  const [currentTimeline, setCurrentTimeline] = useState(null);
  const timelineCategories = useMemo(
    () => getDistinctCategories(currentTimeline?.articles || []),
    [currentTimeline]
  );
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [focusedArticleId, setFocusedArticleId] = useState(null);
  const [hoveredArticleId, setHoveredArticleId] = useState(null);

  // Narrow-viewport (physical mobile/portrait) tracking. The desktop layout is served on
  // all screen sizes; this only toggles narrow-screen affordances (drawer insets,
  // map popup behaviour).
  const checkIsMobileLandscape = useCallback(() => {
    if (typeof window === 'undefined') return false;
    const isTouch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
                    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
    return isTouch
      ? (window.innerHeight < 550 && window.innerWidth >= 768)
      : (window.innerHeight < 500 && window.innerWidth < 1024);
  }, []);

  const [isNarrowViewport, setIsNarrowViewport] = useState(() =>
    typeof window === 'undefined' ? false : window.innerWidth < 768
  );
  const [isWideDesktop, setIsWideDesktop] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= 1150
  );
  const [isMobileLandscape, setIsMobileLandscape] = useState(() => checkIsMobileLandscape());
  const [mobileTimelineView, setMobileTimelineView] = useState('canvas');
  useEffect(() => {
    const handleResize = () => {
      setIsNarrowViewport(window.innerWidth < 768);
      setIsWideDesktop(window.innerWidth >= 1150);
      setIsMobileLandscape(checkIsMobileLandscape());
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [checkIsMobileLandscape]);

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
      if (isNarrowViewport) {
        setMobileTimelineView('canvas');
      }
      if (!densityUserOverrideRef.current) {
        setDensityMode('auto');
      }
    }
  }, [isNarrowViewport]);

  const handleToggleDensityMode = useCallback((newMode) => {
    densityUserOverrideRef.current = true;
    setDensityMode(newMode || 'auto');
  }, []);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [activePrompt, setActivePrompt] = useState('');
  const [isOneTapActive, setIsOneTapActive] = useState(false);

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
  useEffect(() => {
    setIsReadOnlyBannerDismissed(false);
  }, [sharedRouteId]);


  useEffect(() => {
    if (currentTimeline?.title) {
      document.title = `${currentTimeline.title} | ChroniX`;
    } else {
      document.title = 'ChroniX - Interactive Visual Chronologies';
    }
  }, [currentTimeline?.title]);

  useEffect(() => {
    if (!sharedRouteId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchTimeline(sharedRouteId);
        if (cancelled) return;
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

  useEffect(() => {
    if (!publicRoute) return;
    const titleMap = {
      terms: 'Terms of Service | ChroniX',
      'open-source': 'Open Source Notices | ChroniX',
      privacy: 'Privacy Policy | ChroniX',
      features: 'Features | ChroniX',
    };
    if (titleMap[publicRoute]) {
      document.title = titleMap[publicRoute];
    }
  }, [publicRoute]);

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
  const refreshQuota = useCallback(async () => {
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
    }
  }, []);

  useEffect(() => {
    refreshQuota();
  }, [user, refreshQuota]);

  // Keep the server-authoritative quota in sync whenever the user returns to the
  // tab/window. Covers window switching, tab close/reopen, and multi-tab usage -
  // the badge is always re-read from the server (which tracks guests by IP).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshQuota();
    };
    window.addEventListener('focus', refreshQuota);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', refreshQuota);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshQuota]);

  // Sync quota badge across all open browser tabs in real time
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'chronix_quota_updated') {
        refreshQuota();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refreshQuota]);

  // AbortControllers for active AI requests
  const generateAbortControllerRef = useRef(null);
  const refineAbortControllerRef = useRef(null);
  const chatAbortControllerRef = useRef(null);
  const activeGenerateJobIdRef = useRef(null);
  const activeRefineJobIdRef = useRef(null);
  const activeChatJobIdRef = useRef(null);
  // One-step undo snapshot for chat-driven edits, keyed by the assistant message id
  const chatUndoRef = useRef({});

  // Handle stopping generation
  const handleStopGenerate = useCallback(async () => {
    const activeJob = getActiveAiJob();
    const jobId = activeJob?.jobId || activeGenerateJobIdRef.current;
    if (generateAbortControllerRef.current) {
      generateAbortControllerRef.current.abort();
      generateAbortControllerRef.current = null;
    }
    clearActiveAiJob();
    activeGenerateJobIdRef.current = null;
    setIsLoading(false);
    if (jobId) {
      await cancelAiJob(jobId);
      refreshQuota();
      try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch { }
    }
  }, [refreshQuota]);

  // Handle stopping refinement
  const handleStopRefine = useCallback(async () => {
    const jobId = activeRefineJobIdRef.current;
    if (refineAbortControllerRef.current) {
      refineAbortControllerRef.current.abort();
      refineAbortControllerRef.current = null;
    }
    activeRefineJobIdRef.current = null;
    setIsRefining(false);
    if (jobId) {
      await cancelAiJob(jobId);
      refreshQuota();
      try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch { }
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
    };
  }, []);

  // Map Display Mode ('icon' | 'pip' | 'split' | 'full')
  const [mapDisplayMode, setMapDisplayMode] = useState(() => {
    try {
      const saved = localStorage.getItem('chronix_map_mode');
      if (saved === 'icon' || saved === 'pip' || saved === 'split' || saved === 'full') return saved;
      // Default to 'icon' (minimized) so the map stays out of the way until requested
      return 'icon';
    } catch (e) {
      return 'icon';
    }
  });

  // Map Basemap Tile Provider ('osm' | 'esri')
  const [mapTileProvider, setMapTileProvider] = useState(() => {
    try {
      const saved = localStorage.getItem('chronix_map_tile_provider');
      if (saved === 'osm' || saved === 'esri') {
        return saved;
      }
      return ACTIVE_TILE_PROVIDER || 'esri';
    } catch (e) {
      return ACTIVE_TILE_PROVIDER || 'esri';
    }
  });

  const handleMapTileProviderChange = useCallback((provider) => {
    setMapTileProvider(provider);
    try {
      localStorage.setItem('chronix_map_tile_provider', provider);
    } catch (e) { }
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
    try {
      localStorage.setItem('chronix_map_mode', mode);
    } catch (e) { }
  }, []);

  // Resizable Split Pane State (percentage for top map pane, 15% to 85%)
  const [splitRatio, setSplitRatio] = useState(() => {
    try {
      const saved = localStorage.getItem('vt_split_ratio');
      const num = parseFloat(saved);
      if (!isNaN(num) && num >= 15 && num <= 85) return num;
      return 48;
    } catch (e) {
      return 48;
    }
  });
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const splitContainerRef = useRef(null);

  const handleSplitMouseDown = (e) => {
    e.preventDefault();
    setIsDraggingSplit(true);

    const onMouseMove = (moveEvent) => {
      if (!splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const style = window.getComputedStyle(splitContainerRef.current);
      const topPad = parseFloat(style.paddingTop) || 0;
      const bottomPad = parseFloat(style.paddingBottom) || 0;
      const usableHeight = rect.height - topPad - bottomPad;
      if (usableHeight <= 0) return;
      const relY = moveEvent.clientY - rect.top - topPad;
      const newPercent = (relY / usableHeight) * 100;
      const clamped = Math.min(Math.max(newPercent, 15), 85);
      setSplitRatio(clamped);
    };

    const onMouseUp = () => {
      setIsDraggingSplit(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      try {
        setSplitRatio((current) => {
          localStorage.setItem('vt_split_ratio', String(Math.round(current)));
          return current;
        });
      } catch (e) { }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
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

  const handleSplitTouchStart = (e) => {
    setIsDraggingSplit(true);

    const onTouchMove = (moveEvent) => {
      if (!splitContainerRef.current || !moveEvent.touches[0]) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const style = window.getComputedStyle(splitContainerRef.current);
      const topPad = parseFloat(style.paddingTop) || 0;
      const bottomPad = parseFloat(style.paddingBottom) || 0;
      const usableHeight = rect.height - topPad - bottomPad;
      if (usableHeight <= 0) return;
      const relY = moveEvent.touches[0].clientY - rect.top - topPad;
      const newPercent = (relY / usableHeight) * 100;
      const clamped = Math.min(Math.max(newPercent, 15), 85);
      setSplitRatio(clamped);
    };

    const onTouchEnd = () => {
      setIsDraggingSplit(false);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      try {
        setSplitRatio((current) => {
          localStorage.setItem('vt_split_ratio', String(Math.round(current)));
          return current;
        });
      } catch (e) { }
    };

    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
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

  const handleToggleTheme = () => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('vt_theme', next);
        localStorage.setItem('vt_theme_manual', 'true');
      } catch (e) { }
      return next;
    });
  };

  // Daylight background aesthetic mode: configurable via VITE_DAY_BACKGROUND ('topo' | 'constellations', defaults to 'constellations')
  const dayBackground = (import.meta.env.VITE_DAY_BACKGROUND || 'constellations').toLowerCase();

  // Modals state
  const [isEventEditOpen, setIsEventEditOpen] = useState(false);
  const [eventBeingEdited, setEventBeingEdited] = useState(null);
  const [isAiRefineOpen, setIsAiRefineOpen] = useState(false);
  const [isSavedModalOpen, setIsSavedModalOpen] = useState(false);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [isPersonalModalOpen, setIsPersonalModalOpen] = useState(false);
  const [isGeneratingFromFiles, setIsGeneratingFromFiles] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDisclaimerModalOpen, setIsDisclaimerModalOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isCardsListOpen, setIsCardsListOpen] = useState(false);
  const [isOverviewOpen, setIsOverviewOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isExploring, setIsExploring] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [isChatBusy, setIsChatBusy] = useState(false);
  const [chatSeed, setChatSeed] = useState(null);
  const [leftDockRect, setLeftDockRect] = useState(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalInitialMode, setAuthModalInitialMode] = useState('signin');
  const homeScrollRef = useRef(null);

  const handleOpenAuth = useCallback((mode = 'signin') => {
    setAuthModalInitialMode(mode);
    setIsAuthModalOpen(true);
  }, []);

  // Central reset helper: guarantees that every time a timeline is created, loaded, or cleared,
  // all screen elements (floating chat bubble, map widget, side drawers, modes) return to their
  // pristine default positions, with no lingering "memory" or displaced coordinates from previous timelines.
  const resetAllElementPositionsAndState = useCallback(() => {
    // 1. Reset map display mode & clear persisted map keys
    setMapDisplayMode('icon');
    try {
      localStorage.removeItem('chronix_map_mode');
      localStorage.removeItem('chronix_pip_size');
    } catch { }

    // 2. Reset chat open state & clear dock position memory
    setIsChatOpen(false);
    try {
      localStorage.removeItem('chronix_chat_dock_v3');
      localStorage.removeItem('chronix_chat_size');
    } catch { }

    // 3. Reset side drawers & selection
    setSelectedArticle(null);
    setFocusedArticleId(null);
    setIsCardsListOpen(false);
    setIsOverviewOpen(false);
    setMobileTimelineView('canvas');

    // 4. Reset filters & stars
    setTimelineFilter(null);
    setStarredArticleIds(new Set());
    setFilterStarredOnly(false);

    // 5. Exit exploration mode
    setIsExploring(false);

    // 6. Reset card layout to platform defaults: automatic on every device unless the
    // user explicitly chose a different density mode for this timeline.
    densityUserOverrideRef.current = false;
    setDensityMode('auto');
    try {
      localStorage.removeItem('chronix_density_mode_desktop');
      localStorage.removeItem('chronix_density_mode_mobile');
    } catch { }
  }, [isNarrowViewport]);

  // Clean up any legacy persisted positions on startup so elements never load off-screen
  useEffect(() => {
    try {
      localStorage.removeItem('chronix_chat_dock_v3');
      localStorage.removeItem('chronix_chat_size');
      localStorage.removeItem('chronix_pip_size');
      localStorage.removeItem('chronix_map_mode');
      localStorage.removeItem('chronix_density_mode_desktop');
      localStorage.removeItem('chronix_density_mode_mobile');
    } catch { }
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

      pollAiJob(pendingJob.jobId, controller.signal, t('app.failedGenerate'))
        .then((data) => {
          clearActiveAiJob();
          if (!data?.articles || data.articles.length === 0) {
            setErrorMessage(t('app.emptyTimelineError'));
            return;
          }
          resetAllElementPositionsAndState();
          setCurrentTimeline(data);
          triggerCelebration();
          refreshQuota();
        })
        .catch((err) => {
          clearActiveAiJob();
          if (err.name === 'AbortError' || controller.signal.aborted) {
            return;
          }
          console.error('Resumed generation failed:', err);
          setErrorMessage(err.message || t('app.failedGenerate'));
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
    try {
      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.85 }
      });
    } catch (e) {
      // ignore
    }
  };

  // Handle generation from prompt
  const handleGenerate = async (prompt, grounding) => {
    if (generateAbortControllerRef.current) {
      generateAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    generateAbortControllerRef.current = controller;

    // Grounding mode: Fast mode skips web search for ~2x faster generation; Verified mode grounds generation via Google Search.
    const isGroundingActive = typeof grounding === 'boolean' ? grounding : readGroundingPref();

    setActivePrompt(prompt);
    setIsLoading(true);
    setErrorMessage(null);
    resetAllElementPositionsAndState();

    try {
      // Timeline content language is detected server-side from the prompt text itself -
      // intentionally NOT the UI display language, so the two stay fully independent.
      const data = await generateTimeline(
        prompt,
        '',
        controller.signal,
        isGroundingActive,
        (jobId) => {
          activeGenerateJobIdRef.current = jobId;
          setActiveAiJob({
            jobId,
            type: 'generate',
            prompt,
            startedAt: Date.now(),
          });
          // Quota is consumed on the server when the job is accepted; refresh immediately
          refreshQuota();
          try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch { }
        }
      );
      if (!data?.articles || data.articles.length === 0) {
        throw new Error(t('app.emptyTimelineError'));
      }
      clearActiveAiJob();
      activeGenerateJobIdRef.current = null;
      resetAllElementPositionsAndState();
      setCurrentTimeline(data);
      triggerCelebration();
      refreshQuota();
      try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch { }
    } catch (err) {
      clearActiveAiJob();
      activeGenerateJobIdRef.current = null;
      refreshQuota();
      try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch { }
      if (err.name === 'AbortError' || controller.signal.aborted) {
        console.log('Generation stopped by user.');
        return;
      }
      console.error('Generation failed:', err);
      setErrorMessage(err.message || t('app.failedGenerate'));
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

  // Generate a timeline by extracting content from uploaded files (photos of book/document
  // pages, scans, PDFs) and/or pasted raw text, instead of a text prompt. Errors are surfaced
  // back to the modal (via the thrown rejection) so it can display them inline and retry.
  const handleGenerateFromFiles = async (files, contextText, rawText = '') => {
    setIsGeneratingFromFiles(true);
    setErrorMessage(null);
    try {
      const data = await generateTimelineFromFiles(files, contextText, rawText);
      if (!data?.articles || data.articles.length === 0) {
        throw new Error(t('app.emptyTimelineError'));
      }
      resetAllElementPositionsAndState();
      setCurrentTimeline(data);
      setActivePrompt(contextText || data?.title || '');
      setIsPersonalModalOpen(false);
      triggerCelebration();
      refreshQuota();
      try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch { }
    } finally {
      setIsGeneratingFromFiles(false);
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
      const promptParam = params.get('prompt');
      const guideParam = params.get('guide');

      if (isTimelineGuideEnabled() && (guideParam === 'true' || guideParam === '1')) {
        setIsGuideOpen(true);
      }

      if (promptParam) {
        // Clean up URL query parameters without reloading
        window.history.replaceState({}, document.title, window.location.pathname);
        setActivePrompt(promptParam);
        handleGenerate(promptParam);
      }
    } catch (e) {
      console.warn('Error reading URL parameters:', e);
    }
  }, [user]);

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

    try {
      const updated = await refineTimeline(
        currentTimeline,
        instruction,
        controller.signal,
        (jobId) => {
          activeRefineJobIdRef.current = jobId;
          refreshQuota();
          try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch { }
        }
      );
      activeRefineJobIdRef.current = null;
      setCurrentTimeline({ ...updated });
      setIsAiRefineOpen(false);
      triggerCelebration();
      refreshQuota();
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
      }
      setIsRefining(false);
    }
  };

  // ---- Timeline chat ("Talk to the timeline") ----
  const chatStorageKey = currentTimeline?.id ? `chronix_chat_${currentTimeline.id}` : null;
  const chatUndoStorageKey = currentTimeline?.id ? `chronix_chat_undo_${currentTimeline.id}` : null;

  // Persist the most recent chat-edit undo snapshots (capped) so undo survives a reload.
  const persistChatUndo = useCallback(() => {
    if (!chatUndoStorageKey) return;
    try {
      const entries = Object.entries(chatUndoRef.current).slice(-MAX_CHAT_UNDO);
      if (entries.length === 0) {
        localStorage.removeItem(chatUndoStorageKey);
      } else {
        localStorage.setItem(
          chatUndoStorageKey,
          JSON.stringify(entries.map(([id, snapshot]) => ({ id, snapshot })))
        );
      }
    } catch {
      // ignore quota/serialization errors
    }
  }, [chatUndoStorageKey]);

  // Load a persisted conversation (and its undo snapshots) when the active timeline changes.
  useEffect(() => {
    if (!chatStorageKey) {
      setChatMessages([]);
      chatUndoRef.current = {};
      return;
    }
    // Restore persisted undo snapshots so edits stay reversible after a reload.
    const undoMap = {};
    if (chatUndoStorageKey) {
      try {
        const rawUndo = localStorage.getItem(chatUndoStorageKey);
        const arr = rawUndo ? JSON.parse(rawUndo) : [];
        if (Array.isArray(arr)) {
          for (const entry of arr) {
            if (entry && entry.id && entry.snapshot) undoMap[entry.id] = entry.snapshot;
          }
        }
      } catch {
        // ignore parse errors
      }
    }
    chatUndoRef.current = undoMap;
    try {
      const raw = localStorage.getItem(chatStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      // An edit is undoable only if its snapshot is still present and it hasn't been undone.
      setChatMessages(
        Array.isArray(parsed)
          ? parsed.map((m) => ({ ...m, canUndo: !m.undone && !!undoMap[m.id] }))
          : []
      );
    } catch {
      setChatMessages([]);
    }
  }, [chatStorageKey, chatUndoStorageKey]);

  // Persist the conversation (without volatile flags) per timeline.
  useEffect(() => {
    if (!chatStorageKey) return;
    try {
      const serializable = chatMessages.map(({ canUndo, ...rest }) => rest);
      localStorage.setItem(chatStorageKey, JSON.stringify(serializable.slice(-60)));
    } catch {
      // ignore quota/serialization errors
    }
  }, [chatMessages, chatStorageKey]);

  const handleChatStop = useCallback(async () => {
    const jobId = activeChatJobIdRef.current;
    if (chatAbortControllerRef.current) {
      chatAbortControllerRef.current.abort();
      chatAbortControllerRef.current = null;
    }
    activeChatJobIdRef.current = null;
    setIsChatBusy(false);
    if (jobId) {
      await cancelAiJob(jobId);
      refreshQuota();
      try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch { }
    }
  }, [refreshQuota]);

  const handleChatSend = async (text, grounding = readGroundingPref()) => {
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

    try {
      const res = await chatWithTimeline(
        currentTimeline,
        text.trim(),
        history,
        grounding,
        controller.signal,
        (jobId) => {
          activeChatJobIdRef.current = jobId;
          refreshQuota();
          try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch { }
        }
      );
      activeChatJobIdRef.current = null;
      const assistantId = `a-${Date.now()}`;
      const isEdit = res.action === 'edit' && res.updated_timeline;

      let snapshotStored = false;
      if (isEdit) {
        // Snapshot the pre-edit timeline for one-step undo, then apply the change.
        chatUndoRef.current[assistantId] = currentTimeline;
        persistChatUndo();
        snapshotStored = true;
        setCurrentTimeline({ ...res.updated_timeline });
        triggerCelebration();
        refreshQuota();
      }

      setChatMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: 'assistant',
          content: res.reply || '',
          action: res.action,
          canUndo: snapshotStored,
          sources: res.grounding?.sources || null,
          isRelevant: res.is_relevant !== false,
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
      }
      setIsChatBusy(false);
    }
  };

  // Chat-attached files: extracts new events from uploaded photos/PDFs and merges them
  // into the current timeline (counts as one refinement, same as a text edit instruction).
  const handleChatSendFiles = async (files, text = '') => {
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

    try {
      const res = await chatAttachFilesToTimeline(currentTimeline, files, text?.trim() || '', controller.signal);
      const assistantId = `a-${Date.now()}`;
      const isEdit = res.action === 'edit' && res.updated_timeline;

      let snapshotStored = false;
      if (isEdit) {
        chatUndoRef.current[assistantId] = currentTimeline;
        persistChatUndo();
        snapshotStored = true;
        setCurrentTimeline({ ...res.updated_timeline });
        triggerCelebration();
        refreshQuota();
      }

      setChatMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: 'assistant',
          content: res.reply || '',
          action: res.action,
          canUndo: snapshotStored,
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
      }
      setIsChatBusy(false);
    }
  };

  const handleChatUndo = (messageId) => {
    const snapshot = chatUndoRef.current[messageId];
    if (!snapshot) return;
    setCurrentTimeline({ ...snapshot });
    saveTimeline(snapshot).catch(() => { });
    delete chatUndoRef.current[messageId];
    persistChatUndo();
    setChatMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, undone: true, canUndo: false } : m))
    );
  };

  const handleChatClear = () => {
    setChatMessages([]);
    chatUndoRef.current = {};
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
  const tourJustEndedRef = useRef(false);
  const wasExploringRef = useRef(false);
  const chatSuggestions = useMemo(() => getChatSuggestions(currentTimeline, t), [currentTimeline, t]);
  const teaserTimelineId = currentTimeline?.id ?? null;
  const canShowChatTeaser = Boolean(
    teaserTimelineId &&
    (currentTimeline?.articles?.length ?? 0) > 0 &&
    currentTimeline?.isOwner !== false &&
    !isChatOpen && !isExploring && !isGuideOpen && !isLoading &&
    !(isNarrowViewport && (isOverviewOpen || isCardsListOpen)) &&
    !isSettingsOpen && !isSavedModalOpen && !isPersonalModalOpen && !isAuthModalOpen && !isAboutModalOpen && !isAdminPanelOpen
  );

  useEffect(() => {
    if (wasExploringRef.current && !isExploring) tourJustEndedRef.current = true;
    wasExploringRef.current = isExploring;
  }, [isExploring]);

  useEffect(() => {
    if (isChatOpen) setIsChatTeaserOpen(false);
  }, [isChatOpen]);

  useEffect(() => {
    if (!canShowChatTeaser) {
      setIsChatTeaserOpen(false);
      return undefined;
    }
    // Shown once per timeline; if the tour starts before the idle delay, it appears right after the tour instead.
    const kind = tourJustEndedRef.current ? 'tour' : 'idle';
    tourJustEndedRef.current = false;
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
    }, kind === 'tour' ? CHAT_TEASER_AFTER_TOUR_MS : CHAT_TEASER_IDLE_MS);
    return () => clearTimeout(timer);
  }, [canShowChatTeaser, teaserTimelineId]);

  // Used by the teaser and the overview panel: prefill (never auto-send) so edits are reviewed first.
  const handleChatStarterPick = (text) => {
    setIsChatTeaserOpen(false);
    if (isNarrowViewport) setIsOverviewOpen(false);
    setChatSeed(text);
    setIsChatOpen(true);
  };

  // Handle saving an edited/new event
  const handleSaveEvent = async (savedArticle) => {
    if (!currentTimeline || currentTimeline.isOwner === false) return;

    // If the event introduced a brand-new topic/lane, register it on the timeline.
    let updatedLanes = currentTimeline.lanes || [];
    const { newLane, ...articleToStore } = savedArticle;
    if (newLane && !updatedLanes.some((l) => l.id === newLane.id)) {
      updatedLanes = [
        ...updatedLanes,
        {
          id: newLane.id,
          title: newLane.title,
          color: DEFAULT_LANE_COLORS[updatedLanes.length % DEFAULT_LANE_COLORS.length],
          order: updatedLanes.length + 1,
        },
      ];
    }

    let updatedArticles = [...(currentTimeline.articles || [])];
    const index = updatedArticles.findIndex((a) => a.id === articleToStore.id);

    if (index >= 0) {
      updatedArticles[index] = articleToStore;
    } else {
      updatedArticles.push(articleToStore);
    }

    // Sort chronologically
    updatedArticles.sort((a, b) => {
      const aY = a.from?.year || 0;
      const bY = b.from?.year || 0;
      if (aY !== bY) return aY - bY;
      const aM = a.from?.month || 1;
      const bM = b.from?.month || 1;
      return aM - bM;
    });

    const updatedTimeline = {
      ...currentTimeline,
      lanes: updatedLanes,
      articles: updatedArticles
    };

    setCurrentTimeline(updatedTimeline);
    if (selectedArticle && isSameArticleId(selectedArticle.id, articleToStore.id)) {
      setSelectedArticle(articleToStore);
    }

    try {
      await saveTimeline(updatedTimeline);
    } catch (err) {
      console.warn('Failed to auto-save after event edit:', err);
    }
  };

  const handleSaveImagePosition = async (articleId, { x, y }) => {
    if (!currentTimeline || currentTimeline.isOwner === false) return;
    const articleToUpdate = currentTimeline.articles?.find((article) => isSameArticleId(article.id, articleId));
    if (!articleToUpdate) return;

    const imagePosition = { imagePositionX: x, imagePositionY: y };
    Object.assign(articleToUpdate, imagePosition);
    setSelectedArticle((previous) => (
      previous && isSameArticleId(previous.id, articleId)
        ? { ...previous, ...imagePosition }
        : previous
    ));

    const timelineToSave = {
      ...currentTimeline,
      articles: currentTimeline.articles.map((article) => (
        isSameArticleId(article.id, articleId) ? { ...article, ...imagePosition } : article
      )),
    };

    setCurrentTimeline(timelineToSave);

    try {
      await saveTimeline(timelineToSave);
    } catch (err) {
      console.warn('Failed to save image position:', err);
    }
  };

  // Rename the current timeline (used by the Overview panel and Saved/Personal Timelines list)
  const handleRenameTimeline = async (newTitle) => {
    if (!currentTimeline || currentTimeline.isOwner === false) return;
    const trimmed = (newTitle || '').trim();
    if (!trimmed || trimmed === currentTimeline.title) return;

    const updatedTimeline = { ...currentTimeline, title: trimmed };
    setCurrentTimeline(updatedTimeline);

    try {
      await saveTimeline(updatedTimeline);
    } catch (err) {
      console.warn('Failed to save renamed timeline:', err);
    }
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
      const updatedArticles = (currentTimeline.articles || []).map((art) => {
        if ((art.category ?? '').toString().trim().toLowerCase() === oldKey) {
          return { ...art, category: trimmedNew };
        }
        return art;
      });

      const updatedTimeline = {
        ...currentTimeline,
        articles: updatedArticles,
      };

      setCurrentTimeline(updatedTimeline);

      if (selectedArticle && (selectedArticle.category ?? '').toString().trim().toLowerCase() === oldKey) {
        setSelectedArticle((prev) => (prev ? { ...prev, category: trimmedNew } : prev));
      }

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

      try {
        await saveTimeline(updatedTimeline);
      } catch (err) {
        console.warn('Failed to auto-save after category rename:', err);
      }
    } else if (dimension === 'lane') {
      const oldLaneId = String(item.id);
      const oldLaneName = item.name;
      if (oldLaneName === trimmedNew) return;

      const updatedLanes = (currentTimeline.lanes || []).map((l, idx) => {
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
      });

      // Update articles that reference this lane by title
      const updatedArticles = (currentTimeline.articles || []).map((art) => {
        if (art.lane === oldLaneName) {
          return { ...art, lane: trimmedNew };
        }
        return art;
      });

      const updatedTimeline = {
        ...currentTimeline,
        lanes: updatedLanes,
        articles: updatedArticles,
      };

      setCurrentTimeline(updatedTimeline);

      if (selectedArticle && selectedArticle.lane === oldLaneName) {
        setSelectedArticle((prev) => (prev ? { ...prev, lane: trimmedNew } : prev));
      }

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

      try {
        await saveTimeline(updatedTimeline);
      } catch (err) {
        console.warn('Failed to auto-save after lane rename:', err);
      }
    }
  };

  // Handle deleting an event
  const handleDeleteEvent = async (articleId) => {
    if (!currentTimeline || currentTimeline.isOwner === false) return;
    if (!confirm(t('eventDrawer.deleteConfirm'))) return;

    const updatedArticles = currentTimeline.articles.filter((a) => a.id !== articleId);
    const updatedTimeline = {
      ...currentTimeline,
      articles: updatedArticles
    };

    setCurrentTimeline(updatedTimeline);
    setSelectedArticle(null);
    setCameFromCardsList(false);

    try {
      await saveTimeline(updatedTimeline);
    } catch (err) {
      console.warn('Failed to auto-save after event delete:', err);
    }
  };

  // Export as JSON file
  const handleExportJson = () => {
    if (!currentTimeline) return;
    const blob = new Blob([JSON.stringify(currentTimeline, null, 2)], {
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
      toPng(container)
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

  const handleSelectTimeline = async (id) => {
    try {
      const data = await fetchTimeline(id);
      resetAllElementPositionsAndState();
      setCurrentTimeline(data);
      if (data?.title) {
        setActivePrompt(data.title);
      }
    } catch (err) {
      alert(t('app.failedLoad') + err.message);
    }
  };

  const handleImportJson = async (imported) => {
    resetAllElementPositionsAndState();
    setCurrentTimeline(imported);
    if (imported?.title) {
      setActivePrompt(imported.title);
    }
    try {
      await saveTimeline(imported);
    } catch (e) {
      // ignore
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
        await saveTimeline({ ...currentTimeline, isShared: true, is_public: true });
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
    const { isOwner, isShared, ...rest } = currentTimeline;
    const copy = {
      ...rest,
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      createdAt: null,
      updatedAt: null,
    };
    try {
      const saved = await saveTimeline(copy);
      window.history.replaceState({}, document.title, '/');
      resetAllElementPositionsAndState();
      setCurrentTimeline({ ...saved, isOwner: true, isShared: false });
    } catch (e) {
      alert(t('app.failedSave') || 'Failed to save a copy.');
    }
  };

  // Create a hand-authored personal timeline from the "Build Your Own Timeline" flow
  // (no AI/backend generation - the object is built locally and persisted like an import).
  const handleCreatePersonalTimeline = async (data) => {
    setIsPersonalModalOpen(false);
    resetAllElementPositionsAndState();
    setCurrentTimeline(data);
    if (data?.title) {
      setActivePrompt(data.title);
    }
    // If the user started from a blank canvas, open Add Event immediately.
    // We only persist to the backend once at least one event is added.
    if (!data?.articles?.length) {
      setEventBeingEdited(null);
      setIsEventEditOpen(true);
    } else {
      try {
        await saveTimeline(data);
      } catch (e) {
        // ignore
      }
    }
  };

  // Clear board (reset timeline)
  const handleClearBoard = () => {
    resetAllElementPositionsAndState();
    setCurrentTimeline(null);
    setActivePrompt('');
  };

  // Navigate back to the home view (Logo click)
  const handleGoHome = () => {
    resetAllElementPositionsAndState();
    setCurrentTimeline(null);
    setActivePrompt('');
  };

  // Toggle star / favorite status on an article
  const handleToggleStar = useCallback((articleId, explicitState) => {
    setStarredArticleIds((prev) => {
      const next = new Set(prev);
      const shouldBeStarred = explicitState !== undefined ? explicitState : !next.has(articleId);
      if (shouldBeStarred) {
        next.add(articleId);
      } else {
        next.delete(articleId);
      }
      // Update canvas instance directly without remounting
      timelineRef.current?.setArticleStarred(articleId, shouldBeStarred);

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

  // Helper to ensure we always have the full article object with all metadata (locationName, lat, lng, etc.)
  const handleSelectArticle = (article, { fromUserClick = false } = {}) => {
    if (!article) {
      setSelectedArticle(null);
      setFocusedArticleId(null);
      setIsMobileTourDrawerOpen(false);
      return;
    }
    setIsOverviewOpen(false);
    setCameFromCardsList(false);
    const articleId = article.id || article.data?.id;
    const fullArticle = currentTimeline?.articles?.find((a) => a.id === articleId) || article;
    setSelectedArticle(fullArticle);
    setFocusedArticleId(articleId);
    setIsEventDrawerDismissed(false);
    setIsTourDrawerDismissed(false);
    if (fromUserClick && isNarrowViewport) {
      setIsMobileTourDrawerOpen(true);
    }
  };

  const handleOpenArticleDetails = (article) => {
    handleFocusArticle(article);
    setIsEventDrawerDismissed(false);
    setIsTourDrawerDismissed(false);
    setIsMobileTourDrawerOpen(true);
  };

  // Focus timeline on an article (pan timeline and bring card to front) without opening the details drawer,
  // and focus the map on the matching pin.
  const handleFocusTimelineArticle = useCallback((article) => {
    const id = article?.id || article?.data?.id;
    if (id) {
      setFocusedArticleId(id);
      timelineRef.current?.focusArticle(id);
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

  // Track whether the detail drawer was opened from the event list, so closing it returns
  // to the list instead of dropping back to the plain timeline (list is hidden while the
  // drawer shows, since on narrow screens there's only room for one at a time).
  const [cameFromCardsList, setCameFromCardsList] = useState(false);
  const handleSelectArticleFromCardsList = (article) => {
    setIsCardsListOpen(false);
    setIsOverviewOpen(false);
    handleFocusArticle(article);
    setCameFromCardsList(true);
  };

  const handleSelectArticleFromMobileFeed = (article) => {
    setIsOverviewOpen(false);
    handleFocusArticle(article);
    setCameFromCardsList(true);
  };

  // Synchronize canvas redraw when switching back from mobile feed view to ensure crisp canvas layout
  useEffect(() => {
    if (mobileTimelineView === 'canvas') {
      timelineRef.current?.redraw?.();
    }
  }, [mobileTimelineView]);

  // Toggle Cards List Drawer (docked to left rail, mutually exclusive with Overview)
  const handleToggleCardsList = useCallback(() => {
    if (isCardsListOpen) {
      setIsCardsListOpen(false);
      setSelectedArticle(null);
      setCameFromCardsList(false);
    } else {
      setIsOverviewOpen(false);
      setSelectedArticle(null);
      setCameFromCardsList(false);
      setIsCardsListOpen(true);
    }
  }, [isCardsListOpen]);

  // Toggle Overview panel (docked to left rail, mutually exclusive with Cards List and Event Drawer)
  const handleToggleOverview = useCallback(() => {
    setIsOverviewOpen((v) => {
      const next = !v;
      if (next) {
        setIsCardsListOpen(false);
        setSelectedArticle(null);
        setFocusedArticleId(null);
        setCameFromCardsList(false);
      }
      return next;
    });
  }, []);

  // ---- Exploration mode: guided event-by-event walkthrough of the desktop timeline ----
  const [exploreProgress, setExploreProgress] = useState(null); // { current, total }
  // Map layout in effect before exploration forced the split view, restored on exit
  const prevMapModeRef = useRef(null);
  // User dismissed the detail drawer's own X while touring (unlike the map popup's close
  // button, its onClose would otherwise null selectedArticle and auto-exit the tour) - reset
  // whenever the focused article changes so the drawer reappears for the next/prev event.
  const [isTourDrawerDismissed, setIsTourDrawerDismissed] = useState(false);
  // Unlike the per-event dismissal above, minimizing persists across Prev/Next until restored.
  const [isTourDrawerMinimized, setIsTourDrawerMinimized] = useState(false);
  const [isEventDrawerDismissed, setIsEventDrawerDismissed] = useState(false);
  // On mobile during tour, user can explicitly tap a timeline event or map popup to open full details.
  // When open, stepping Prev/Next within the drawer or timeline keeps the drawer open.
  const [isMobileTourDrawerOpen, setIsMobileTourDrawerOpen] = useState(false);
  useEffect(() => {
    setIsTourDrawerDismissed(false);
    setIsEventDrawerDismissed(false);
  }, [selectedArticle?.id]);

  // Chronologically ordered articles currently visible on the canvas. When both filters
  // are active, visibility is their intersection, so the tour follows that same subset.
  const getExploreOrder = useCallback(() => {
    const articles = currentTimeline?.articles || [];
    const visibleIds = timelineRef.current?.getVisibleArticleIds?.();
    const visibleSet = Array.isArray(visibleIds) ? new Set(visibleIds) : null;
    return articles
      .filter((a) => !visibleSet || visibleSet.has(a.id))
      .slice()
      .sort((a, b) => articleDateValue(a) - articleDateValue(b));
  }, [currentTimeline, timelineFilter, filterStarredOnly, starredArticleIds]);

  const focusExploredArticle = useCallback((article) => {
    setSelectedArticle(article);
    timelineRef.current?.focusArticle(article.id, { animate: true, keepCompact: true });
  }, []);

  const handleStartExplore = useCallback(() => {
    const order = getExploreOrder();
    if (order.length === 0) return;
    setIsCardsListOpen(false);
    setCameFromCardsList(false);
    setIsOverviewOpen(false);
    // Default to the split timeline+map layout while exploring; remember the prior mode.
    // State only (not persisted), so the user's saved map preference is untouched.
    const switchingToSplit = mapDisplayMode !== 'split';
    if (switchingToSplit) {
      prevMapModeRef.current = mapDisplayMode;
      setMapDisplayMode('split');
    }
    setIsExploring(true);
    setIsMobileTourDrawerOpen(false);
    setIsTourDrawerMinimized(false);
    setExploreProgress({ current: 1, total: order.length });
    const first = order[0];
    setSelectedArticle(first);
    if (switchingToSplit) {
      // The timeline canvas remounts when the layout switches to split; focus once it has settled
      // (its init runs a fitArticles pass ~100ms after mount).
      setTimeout(() => timelineRef.current?.focusArticle(first.id, { animate: true, keepCompact: true }), 400);
    } else {
      timelineRef.current?.focusArticle(first.id, { animate: true, keepCompact: true });
    }
  }, [getExploreOrder, mapDisplayMode]);

  const handleExitExplore = useCallback(() => {
    setIsExploring(false);
    setIsMobileTourDrawerOpen(false);
    setIsTourDrawerMinimized(false);
    setExploreProgress(null);
    // On narrow screens there's no room to show the timeline AND the last event's detail
    // drawer at once - return to the plain timeline instead of leaving it stuck open.
    if (isNarrowViewport) {
      setSelectedArticle(null);
    }
    const prevMode = prevMapModeRef.current;
    prevMapModeRef.current = null;
    if (prevMode) {
      // Restore the pre-exploration map layout unless the user already switched away from split.
      setMapDisplayMode((cur) => (cur === 'split' ? prevMode : cur));
    }
  }, [isNarrowViewport]);

  const handleExploreStep = useCallback((delta) => {
    const order = getExploreOrder();
    if (order.length === 0) return;
    const curIdx = selectedArticle ? order.findIndex((a) => isSameArticleId(a.id, selectedArticle.id)) : -1;
    let nextIdx;
    if (curIdx >= 0) {
      nextIdx = Math.min(order.length - 1, Math.max(0, curIdx + delta));
    } else if (selectedArticle) {
      // Current event no longer visible (filter changed) - re-anchor to the nearest later event
      const cur = articleDateValue(selectedArticle);
      const laterIdx = order.findIndex((a) => articleDateValue(a) >= cur);
      nextIdx = laterIdx >= 0 ? laterIdx : order.length - 1;
    } else {
      nextIdx = 0;
    }
    if (isExploring) {
      setExploreProgress({ current: nextIdx + 1, total: order.length });
    }
    focusExploredArticle(order[nextIdx]);
  }, [getExploreOrder, selectedArticle, isExploring, focusExploredArticle]);

  // Keep progress in sync when the selection changes by other means (card click, map pin),
  // and auto-exit exploration when the drawer closes or the timeline is replaced/cleared.
  useEffect(() => {
    if (!isExploring) return;
    if (!selectedArticle) {
      handleExitExplore();
      return;
    }
    const order = getExploreOrder();
    if (order.length === 0) {
      setSelectedArticle(null);
      handleExitExplore();
      return;
    }
    const idx = order.findIndex((a) => isSameArticleId(a.id, selectedArticle.id));
    if (idx >= 0) {
      setExploreProgress((p) =>
        p && p.current === idx + 1 && p.total === order.length
          ? p
          : { current: idx + 1, total: order.length }
      );
    } else {
      // The selected event has been filtered out mid-tour. Continue from the first
      // visible event on or after it, falling back to the final visible event.
      const currentDate = articleDateValue(selectedArticle);
      const nextIndex = order.findIndex((article) => articleDateValue(article) >= currentDate);
      const nextArticle = order[nextIndex >= 0 ? nextIndex : order.length - 1];
      setExploreProgress({ current: nextIndex >= 0 ? nextIndex + 1 : order.length, total: order.length });
      focusExploredArticle(nextArticle);
    }
  }, [isExploring, selectedArticle, getExploreOrder, handleExitExplore, focusExploredArticle]);

  // Keyboard navigation while exploring: ← → move between events, Esc exits
  useEffect(() => {
    if (!isExploring) return;
    const onKeyDown = (e) => {
      const el = e.target;
      if (el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleExploreStep(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleExploreStep(-1);
      } else if (e.key === 'Escape') {
        handleExitExplore();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isExploring, handleExploreStep, handleExitExplore]);

  // ---- Interactive feature guide: coach-mark walkthrough of the timeline screen ----
  const [guideSteps, setGuideSteps] = useState(() => buildGuideSteps(t));

  const handleStartGuide = useCallback(() => {
    if (!isInteractiveGuideEnabled()) return;
    if (currentTimeline) {
      setIsCardsListOpen(false);
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

  // ---- Timeline narrative overview panel ----
  // Gated on isManual (hand-authored, no AI) rather than isPersonal - AI-extracted-from-files
  // "personal" timelines still have a real AI-written overview and should show it.
  const hasOverview = !currentTimeline?.isManual && !!(currentTimeline?.overview || '').trim();

  // Only re-compute timeline canvas data when properties relevant to the canvas change (ignore imagePositionX/Y)
  const timelineCanvasArticlesSig = useMemo(() => {
    if (!currentTimeline?.articles) return '';
    return currentTimeline.articles
      .map((a) => `${a.id}_${a.title}_${a.subtitle || ''}_${a.from?.year}_${a.from?.month}_${a.from?.day}_${a.to?.year}_${a.to?.month}_${a.to?.day}_${a.lane || ''}_${a.category || ''}_${a.imageUrl || ''}_${a.rank || ''}`)
      .join('|');
  }, [currentTimeline?.articles]);

  const timelineCanvasData = useMemo(() => currentTimeline, [
    currentTimeline?.id,
    timelineCanvasArticlesSig,
    currentTimeline?.lanes,
    currentTimeline?.timeBands,
    currentTimeline?.timeScale,
  ]);

  // Auto-open the overview panel once per timeline. Deferred while the first-run
  // coach-mark tour is pending/open or interactive exploration is active, so they never conflict.
  const overviewAutoShownRef = useRef(new Set());
  useEffect(() => {
    const id = currentTimeline?.id;
    const overview = (currentTimeline?.overview || '').trim();
    if (!id || !overview || currentTimeline?.isManual) return;
    if (overviewAutoShownRef.current.has(id)) return;
    if (isGuideOpen || guidePendingRef.current || isExploring) return;
    const timer = setTimeout(() => {
      overviewAutoShownRef.current.add(id);
      setIsOverviewOpen(true);
    }, 550);
    return () => clearTimeout(timer);
  }, [currentTimeline?.id, currentTimeline?.overview, currentTimeline?.isManual, isGuideOpen, isExploring]);

  // Close the overview panel whenever the board is cleared.
  useEffect(() => {
    if (!currentTimeline) setIsOverviewOpen(false);
  }, [currentTimeline]);

  // Reset the floating map widget & chat dock to their default closed state whenever a
  // different timeline is created/loaded - their open/PIP state should never carry over
  // from a previous timeline or session, only within the currently-open one.
  const prevTimelineIdRef = useRef(undefined);
  useEffect(() => {
    const id = currentTimeline?.id ?? null;
    if (prevTimelineIdRef.current === id) return;
    prevTimelineIdRef.current = id;
    if (id) {
      resetAllElementPositionsAndState();
    }
  }, [currentTimeline?.id, resetAllElementPositionsAndState]);

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
        <FeaturesView onEnter={handleClosePublicRoute} />
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
        <PrivacyView />
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
        <TermsView
          onOpenOpenSource={() => handleOpenPublicRoute('open-source')}
          onOpenPublicRoute={handleOpenPublicRoute}
        />
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
        <OpenSourceView
          onBackToTerms={() => handleOpenPublicRoute('terms')}
        />
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
  const isReadOnlyView = Boolean(currentTimeline && currentTimeline.isOwner === false);

  // Detail drawer visibility: always shown for a normal selection; during the guided tour it's
  // also shown on desktop (exceptions: narrow/mobile viewports unless explicitly opened by tapping the
  // event or map popup, and the user dismissing it via its own X - both leave the tour running,
  // mirroring the map popup's close button).
  const showEventDrawer =
    !!selectedArticle &&
    !isCardsListOpen &&
    !isEventDrawerDismissed &&
    !(isExploring && (isNarrowViewport ? !isMobileTourDrawerOpen : (isTourDrawerDismissed || isTourDrawerMinimized)));

  const hasLeftDrawer = Boolean(
    showEventDrawer ||
    isCardsListOpen ||
    (currentTimeline && hasOverview && isOverviewOpen)
  );
  const hasRightDrawer = false;

  // Position of the open event within the current chronological order, so the drawer's
  // prev/next controls (and their end-of-list disabled states) work outside of the tour too.
  let drawerNavProgress = null;
  if (isExploring) {
    drawerNavProgress = exploreProgress;
  } else if (showEventDrawer && selectedArticle) {
    const order = getExploreOrder();
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

      {/* Google One Tap - Native single-click sign in */}
      <GoogleOneTap
        disabled={(isHomeGuideEnabled() && !homeGuideSeen) || isHomeGuideOpen || !!currentTimeline || !!publicRoute}
        onPromptDisplayed={setIsOneTapActive}
      />

      {/* Floating Quick-Auth Prompt for Guests only when Google One Tap is not configured */}
      {!currentTimeline && !import.meta.env.VITE_GOOGLE_CLIENT_ID && (
        <QuickAuthPrompt
          onOpenAuth={handleOpenAuth}
          disabled={(isHomeGuideEnabled() && !homeGuideSeen) || isHomeGuideOpen || isOneTapActive}
        />
      )}

      {/* Error banner */}
      {errorMessage && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-30 bg-danger-soft border border-danger/30 text-danger px-4 py-2.5 rounded-panel text-xs flex flex-wrap items-center justify-center gap-2.5 shadow-card max-w-xl text-center">
          <span>{errorMessage}</span>
          {isGuest && (
            <button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                handleOpenAuth('signin');
              }}
              className="px-2.5 py-1 rounded-control bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-caption transition-colors whitespace-nowrap shadow-control"
            >
              {t('toolbar.signInOrRegister') || 'Sign In / Register'}
            </button>
          )}
          {errorMessage.includes('your own free Gemini API key') && (
            <button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                setIsSettingsOpen(true);
              }}
              className="px-2.5 py-1 rounded-control bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-caption transition-colors whitespace-nowrap shadow-control"
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

      {/* Read-only shared-view banner */}
      {isReadOnlyView && !isReadOnlyBannerDismissed && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-surface-overlay border border-line text-ink-muted px-3.5 py-2 rounded-panel text-xs flex flex-wrap items-center justify-center gap-2.5 shadow-card max-w-xl text-center">
          <Eye className="w-3.5 h-3.5 text-accent shrink-0" />
          <span>{t('app.sharedReadOnlyBanner') || "You're viewing a shared, read-only timeline."}</span>
          {user && !isGuest ? (
            <button
              type="button"
              onClick={handleSaveSharedCopy}
              className="px-2.5 py-1 rounded-control bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-caption transition-colors whitespace-nowrap shadow-control cursor-pointer"
            >
              {t('app.sharedSaveCopy') || 'Save a Copy'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleOpenAuth('signin')}
              className="px-2.5 py-1 rounded-control bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-caption transition-colors whitespace-nowrap shadow-control cursor-pointer"
            >
              {t('toolbar.signIn')}
            </button>
          )}
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
      )}

      {/* Main Canvas Area */}
      <main className="flex-1 min-h-0 relative w-full overflow-hidden">
        {/* Left-edge vertical dock: consolidated timeline controls (Desktop only) */}
        {currentTimeline && (
          <LeftDockMenu
            timelineData={currentTimeline}
            densityMode={densityMode}
            onToggleDensityMode={handleToggleDensityMode}
            mapTileProvider={mapTileProvider}
            onMapTileProviderChange={handleMapTileProviderChange}
            activeFilter={timelineFilter}
            onFilterSelect={(dimension, item) => timelineRef.current?.setLegendFilter(dimension, item ? item.id : null)}
            onRenameFilterItem={handleRenameFilterItem}
            isCardsListOpen={isCardsListOpen}
            onToggleCardsList={handleToggleCardsList}
            isExploring={isExploring}
            onStartExplore={handleStartExplore}
            onExploreNext={() => handleExploreStep(1)}
            onExplorePrev={() => handleExploreStep(-1)}
            onExitExplore={handleExitExplore}
            exploreProgress={exploreProgress}
            isTourDetailsMinimized={!showEventDrawer}
            onToggleTourDetails={isNarrowViewport ? undefined : () => {
              if (!showEventDrawer) {
                setIsTourDrawerMinimized(false);
                setIsTourDrawerDismissed(false);
                setIsEventDrawerDismissed(false);
              } else {
                setIsTourDrawerMinimized(true);
              }
            }}
            filterStarredOnly={filterStarredOnly}
            onToggleFilterStarredOnly={handleToggleFilterStarredOnly}
            starredCount={starredArticleIds.size}
            hasOverview={hasOverview}
            isOverviewOpen={isOverviewOpen}
            onToggleOverview={handleToggleOverview}
            onRectChange={setLeftDockRect}
            onGoHome={handleGoHome}
            onOpenSaved={() => setIsSavedModalOpen(true)}
            onExportImage={handleExportImage}
            onExportJson={handleExportJson}
            onOpenAdmin={() => setIsAdminPanelOpen(true)}
            onOpenAbout={() => setIsAboutModalOpen(true)}
            onOpenDisclaimer={() => setIsDisclaimerModalOpen(true)}
            onStartGuide={handleStartGuide}
            theme={theme}
            onToggleTheme={handleToggleTheme}
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
          <TimelineOverviewPanel
            timeline={currentTimeline}
            isOpen={isOverviewOpen}
            onClose={() => setIsOverviewOpen(false)}
            onRename={handleRenameTimeline}
            chatSuggestions={isReadOnlyView ? null : chatSuggestions}
            onAskChat={isReadOnlyView ? undefined : handleChatStarterPick}
            style={{
              top: 0,
              bottom: 0,
              zIndex: FLOATING_Z.DRAWER,
            }}
          />
        )}

        {/* Conversational "Talk to the timeline" floating chat dock (hidden for read-only shared views) */}
        {currentTimeline && !isReadOnlyView && (
          <TimelineChatPanel
            key={currentTimeline.id}
            timelineId={currentTimeline.id}
            isOpen={isChatOpen}
            onClose={() => setIsChatOpen(false)}
            onOpen={() => setIsChatOpen(true)}
            timelineTitle={currentTimeline.title}
            messages={chatMessages}
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

        {/* Cards List Drawer (docked to the left rail) */}
        <CardsListDrawer
          isOpen={isCardsListOpen}
          onClose={() => {
            setIsCardsListOpen(false);
            setCameFromCardsList(false);
          }}
          articles={currentTimeline?.articles || []}
          lanes={currentTimeline?.lanes || []}
          selectedArticleId={selectedArticle?.id || focusedArticleId}
          onSelectArticle={handleSelectArticleFromCardsList}
          starredArticleIds={starredArticleIds}
          onToggleStar={handleToggleStar}
          filterStarredOnly={filterStarredOnly}
          onToggleFilterStarredOnly={handleToggleFilterStarredOnly}
          style={{
            top: 0,
            bottom: 0,
            zIndex: FLOATING_Z.DRAWER,
          }}
        />

        {currentTimeline ? (
          <div
            ref={splitContainerRef}
            style={{
              paddingLeft: !isNarrowViewport
                ? isWideDesktop && hasLeftDrawer
                  ? `${LEFT_DOCK_WIDTH + LEFT_DRAWER_WIDTH}px`
                  : `${LEFT_DOCK_WIDTH}px`
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
            {/* Top: Geo Map pane (in split mode) */}
            {mapDisplayMode === 'split' && (
              <>
                <div
                  style={{ height: `${splitRatio}%`, zIndex: isNarrowViewport ? 10 : splitMapZ }}
                  onPointerDownCapture={isNarrowViewport ? undefined : raiseSplitMap}
                  className={`w-full relative shrink-0 overflow-hidden ${isDraggingSplit ? '' : 'transition-[height] duration-150 ease-out'
                    }`}
                >
                  {/* Floating Felt Quick Controls inside Split Map pane (Desktop only; mobile uses the top mode bar) */}
                  {!isNarrowViewport && (
                    <div
                      className="absolute top-3 right-3 z-[1000] flex items-center gap-2 bg-surface-raised/90 backdrop-blur-2xl px-2.5 py-1.5 rounded-xl shadow-pop border border-line select-none animate-in fade-in slide-in-from-top-1 duration-200"
                    >
                      {/* Title & Count Badge */}
                      <div className="flex items-center gap-2 pr-2.5 rtl:pr-0 rtl:pl-2.5 border-r rtl:border-r-0 rtl:border-l border-line">
                        <div className="p-1 rounded-lg bg-accent-soft text-accent">
                          <Map className="w-3.5 h-3.5" />
                        </div>
                        {((currentTimeline?.articles || []).filter((a) => a.lat != null && a.lng != null && !isNaN(parseFloat(a.lat)) && !isNaN(parseFloat(a.lng))).length) > 0 && (
                          <span className="text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full bg-surface-hover text-ink-muted border border-line">
                            {(currentTimeline?.articles || []).filter((a) => a.lat != null && a.lng != null && !isNaN(parseFloat(a.lat)) && !isNaN(parseFloat(a.lng))).length}
                          </span>
                        )}
                      </div>

                      {/* Segmented Mode buttons: PiP | Full | Close/Icon */}
                      <div className="flex items-center gap-1 bg-surface-hover/60 p-0.5 rounded-lg border border-line">
                        <button
                          type="button"
                          onClick={() => handleMapDisplayModeChange('pip')}
                          className="p-1.5 text-ink-muted hover:text-accent hover:bg-surface-raised rounded-md transition-all cursor-pointer"
                          title={t('floatingMap.pipTooltip')}
                          aria-label={t('floatingMap.pipTooltip')}
                        >
                          <Minimize2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMapDisplayModeChange('full')}
                          className="p-1.5 text-ink-muted hover:text-accent hover:bg-surface-raised rounded-md transition-all cursor-pointer"
                          title={t('floatingMap.fullTooltip')}
                          aria-label={t('floatingMap.fullTooltip')}
                        >
                          <Maximize2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMapDisplayModeChange('icon')}
                          className="p-1.5 text-ink-muted hover:text-danger hover:bg-danger-soft rounded-md transition-all cursor-pointer"
                          title={t('floatingMap.closeTooltip')}
                          aria-label={t('floatingMap.closeTooltip')}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  <GeoMapView
                    articles={currentTimeline?.articles || []}
                    lanes={currentTimeline?.lanes || []}
                    selectedArticleId={selectedArticle?.id || focusedArticleId}
                    hoveredArticleId={hoveredArticleId}
                    onHoverArticle={setHoveredArticleId}
                    timelineId={currentTimeline?.id}
                    onSelectArticle={handleFocusArticle}
                    onFocusArticle={handleFocusTimelineArticle}
                    onOpenDetails={handleOpenArticleDetails}
                    theme={theme}
                    activeFilter={timelineFilter}
                    filterStarredOnly={filterStarredOnly}
                    starredArticleIds={starredArticleIds}
                    tileProvider={mapTileProvider}
                    isExploring={isExploring}
                    isMobile={isNarrowViewport}
                    hasRightDrawer={hasRightDrawer}
                    onRequestMapHeight={handleMapHeightRequest}
                  />
                </div>

                {/* Draggable Divider Bar - Frosted */}
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  tabIndex={0}
                  onMouseDown={handleSplitMouseDown}
                  onTouchStart={handleSplitTouchStart}
                  onDoubleClick={() => {
                    setSplitRatio(50);
                    try {
                      localStorage.setItem('vt_split_ratio', '50');
                    } catch (e) { }
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
              style={mapDisplayMode === 'split' ? { height: `calc(${100 - splitRatio}% - ${isNarrowViewport ? 24 : 14}px)` } : undefined}
              className={`w-full relative overflow-hidden ${mapDisplayMode === 'split'
                  ? `shrink-0 ${isDraggingSplit ? '' : 'transition-[height] duration-150 ease-out'}`
                  : 'flex-1 h-full'
                }`}
            >
              {/* Interactive Timeline Canvas - preserved across mobile view switches */}
              <div
                className={`w-full h-full ${
                  (isNarrowViewport || isMobileLandscape) && mobileTimelineView === 'feed'
                    ? 'invisible pointer-events-none'
                    : 'visible'
                }`}
              >
                <TimelineView
                  ref={timelineRef}
                  densityMode={densityMode}
                  timelineData={timelineCanvasData}
                  onSelectArticle={handleSelectArticle}
                  onFocusArticle={handleFocusTimelineArticle}
                  selectedArticleId={selectedArticle?.id || focusedArticleId}
                  starredArticleIds={starredArticleIds}
                  filterStarredOnly={filterStarredOnly}
                  activeFilter={timelineFilter}
                  onToggleStar={handleToggleStar}
                  theme={theme}
                  isExploring={isExploring}
                  exploreProgress={exploreProgress}
                  onStartExplore={handleStartExplore}
                  onExploreNext={() => handleExploreStep(1)}
                  onExplorePrev={() => handleExploreStep(-1)}
                  onExitExplore={handleExitExplore}
                  onFilterChange={handleTimelineFilterChange}
                  hasRightDrawer={hasRightDrawer}
                  isNarrowViewport={isNarrowViewport}
                  hoveredArticleId={hoveredArticleId}
                  onHoverArticle={setHoveredArticleId}
                />
              </div>

              {/* Mobile Feed View Overlay - rendered without unmounting canvas to preserve state */}
              {(isNarrowViewport || isMobileLandscape) && (
                <div
                  className={`absolute inset-0 z-20 bg-surface ${
                    mobileTimelineView === 'feed' ? 'visible' : 'invisible pointer-events-none'
                  }`}
                >
                  <TimelineCardFeed
                    articles={currentTimeline?.articles || []}
                    lanes={currentTimeline?.lanes || []}
                    selectedArticleId={selectedArticle?.id || focusedArticleId}
                    onSelectArticle={handleSelectArticleFromMobileFeed}
                    starredArticleIds={starredArticleIds}
                    onToggleStar={handleToggleStar}
                    filterStarredOnly={filterStarredOnly}
                    onToggleFilterStarredOnly={handleToggleFilterStarredOnly}
                  />
                </div>
              )}
            </div>

            {/* Floating Map Widget (Icon | PiP | Full) */}
            <FloatingMapWidget
              key={currentTimeline?.id || 'map'}
              articles={currentTimeline?.articles || []}
              lanes={currentTimeline?.lanes || []}
              selectedArticleId={selectedArticle?.id || focusedArticleId}
              hoveredArticleId={hoveredArticleId}
              onHoverArticle={setHoveredArticleId}
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
              isExploring={isExploring}
              isMobile={isNarrowViewport}
              hasLeftDrawer={hasLeftDrawer}
              isWideDesktop={isWideDesktop}
              leftDockWidth={LEFT_DOCK_WIDTH}
              leftDrawerWidth={LEFT_DRAWER_WIDTH}
            />

            {/* Mobile Top Controls: Persistent, Unified Command Bar */}
            {(isNarrowViewport || isMobileLandscape) && (
              <header
                id="chronix-mobile-top-bar"
                className="mobile-top-command-bar fixed top-0 inset-x-0 z-[49] flex items-center justify-between px-3 select-none"
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
                    className={`chronix-chat-top-btn ${mapDisplayMode !== 'icon' ? 'is-active' : ''}`}
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
                  </button>
                </div>

                {/* 2. Center: Persistent View Mode Switcher (Feed | Canvas) */}
                <div
                  role="radiogroup"
                  aria-label={t('mobile.viewMode') || 'View Mode'}
                  className="seg-track flex items-center gap-1 p-1 rounded-control"
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={mobileTimelineView === 'feed'}
                    onClick={() => setMobileTimelineView('feed')}
                    className={`seg-item flex min-h-[36px] items-center justify-center gap-1.5 rounded-control px-3.5 text-xs font-semibold cursor-pointer touch-manipulation transition-all ${
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
                    aria-checked={mobileTimelineView === 'canvas'}
                    onClick={() => setMobileTimelineView('canvas')}
                    className={`seg-item flex min-h-[36px] items-center justify-center gap-1.5 rounded-control px-3.5 text-xs font-semibold cursor-pointer touch-manipulation transition-all ${
                      mobileTimelineView === 'canvas'
                        ? 'seg-item-active text-ink shadow-xs'
                        : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    <span>{t('mobile.viewCanvas')}</span>
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
        ) : (
          <div ref={homeScrollRef} className="home-screen-scroll-container w-full h-full overflow-y-auto overscroll-y-contain flex flex-col items-center text-center p-3 sm:p-6 pb-12 select-none animate-in fade-in duration-300 bg-transparent relative z-10">
            {/* Centered Hero & Search Section */}
            <div className="home-hero-container w-full max-w-4xl mx-auto flex flex-col items-center justify-center min-h-[calc(100vh-140px)] sm:min-h-[calc(100vh-160px)] py-4 sm:py-8">
              {/* Hero Branding & Welcome */}
              <div className="home-hero-logo mb-0.5 sm:mb-1">
                <ChroniXLogo size="lg" className="w-auto h-12 sm:h-20" />
              </div>
              <div className="home-hero-text space-y-1.5 sm:space-y-2 flex flex-col items-center px-2">
                <h2 className="home-hero-title text-xl sm:text-2xl md:text-3xl font-semibold text-ink tracking-tight font-sans">
                  {t('home.title')}
                </h2>
                <p className="home-hero-subtitle text-body-sm sm:text-body text-ink-muted max-w-xl leading-relaxed font-sans font-normal">
                  {t('home.subtitle')}
                </p>
              </div>

              {/* Primary Search Bar (centered focal point of the home screen) */}
              <div className="home-search-wrapper w-full mt-3 sm:mt-6 mb-2 sm:mb-3">
                <PromptBar
                  onGenerate={handleGenerate}
                  onStop={handleStopGenerate}
                  isLoading={isLoading}
                  activePrompt={activePrompt}
                />
              </div>

              {/* Quick actions (top): Prompt guide + Build Your Own Timeline */}
              <div
                id="guide-home-quick-actions"
                data-guide="home-quick-actions"
                className="home-quick-actions pb-1 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2.5"
                dir={isRtl ? 'rtl' : 'ltr'}
              >
                <button
                  type="button"
                  onClick={() => setIsPromptGuideOpen(true)}
                  disabled={isLoading}
                  className="group inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium text-ink-muted hover:text-ink bg-surface-raised/80 hover:bg-surface-raised backdrop-blur-md border border-line hover:border-line-strong shadow-control transition-colors duration-150 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-default"
                >
                  <Lightbulb className="w-3.5 h-3.5 text-ink-subtle group-hover:text-ink transition-colors shrink-0" />
                  <span>{t('promptGuide.homeBtn')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsPersonalModalOpen(true)}
                  disabled={isLoading}
                  className="group inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium text-ink-muted hover:text-ink bg-surface-raised/80 hover:bg-surface-raised backdrop-blur-md border border-line hover:border-line-strong shadow-control transition-colors duration-150 active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-default"
                >
                  <BookUser className="w-3.5 h-3.5 text-ink-subtle group-hover:text-ink transition-colors shrink-0" />
                  <span>{t('buildOwn.homeBtn')}</span>
                </button>
              </div>

              {/* Example Prompts (compact, secondary - moved below the main search); swapped
                  for a rotating trivia ticker while a generation is in flight so the wait
                  feels shorter than staring at now-irrelevant, disabled example chips. */}
              <div className="home-prompt-examples w-full mt-2 sm:mt-4">
                {isLoading ? (
                  <TriviaTicker prompt={activePrompt} />
                ) : (
                  <PromptExamples
                    onSelectPrompt={handleSelectPrompt}
                    isGenerating={isLoading}
                  />
                )}
              </div>

            </div>

            <FeatureShowcase />

            {/* Public Footer */}
            <PublicFooter
              onOpenPublicRoute={handleOpenPublicRoute}
            />
          </div>
        )}

        {/* Empty personal timeline overlay: shown over the (empty) canvas until the first event
            is added. Only for an active, editable personal/manual timeline with no events. */}
        {currentTimeline && !isReadOnlyView && Boolean(currentTimeline.isPersonal || currentTimeline.isManual) && (currentTimeline.articles?.length ?? 0) === 0 && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center text-center p-6 bg-surface-sunken/95 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="p-3 rounded-panel bg-surface-raised border border-line shadow-card mb-4">
              <BookUser className="w-7 h-7 text-ink-subtle" />
            </div>
            <h3 className="text-lg font-bold text-ink mb-1.5">
              {t('emptyState.title')}
            </h3>
            <p className="text-sm text-ink-muted max-w-md leading-relaxed mb-5">
              {t('emptyState.body')}
            </p>
            <button
              type="button"
              onClick={() => {
                setEventBeingEdited(null);
                setIsEventEditOpen(true);
              }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-control bg-accent hover:bg-accent-hover text-accent-fg text-sm font-semibold shadow-card transition-colors cursor-pointer active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>{t('emptyState.addFirst')}</span>
            </button>
          </div>
        )}

        {/* Selected Article Detail Drawer. Suppressed during guided exploration on narrow/mobile
            viewports (the map popup above the pin carries the event details there instead);
            shown alongside the map popup on desktop. Spans `main` below the top toolbar down to
            the bottom of the page - including over the map pane in
            split mode (z-index DRAWER sits above the map/floating overlays, below the toolbar's
            own open dropdowns). */}
        {showEventDrawer && (
          <ErrorBoundary
            onReset={() => setSelectedArticle(null)}
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
            <EventDrawer
              article={selectedArticle}
              lanes={currentTimeline?.lanes || []}
              articles={currentTimeline?.articles || []}
              grounding={currentTimeline?.grounding}
              isStarred={selectedArticle ? (starredArticleIds.has(selectedArticle.id) || (selectedArticle.id != null && (starredArticleIds.has(String(selectedArticle.id)) || starredArticleIds.has(Number(selectedArticle.id))))) : false}
              onToggleStar={handleToggleStar}
              style={{
                top: 0,
                bottom: 0,
                zIndex: FLOATING_Z.DRAWER,
              }}
              onBackToList={cameFromCardsList ? () => {
                setSelectedArticle(null);
                setFocusedArticleId(null);
                setCameFromCardsList(false);
                if (!((isNarrowViewport || isMobileLandscape) && mobileTimelineView === 'feed')) {
                  setIsCardsListOpen(true);
                }
              } : undefined}
              onClose={() => {
                setIsMobileTourDrawerOpen(false);
                timelineRef.current?.clearMobileFocus?.();
                if (isExploring) {
                  // Keep the tour running; the drawer reappears on the next/prev step.
                  setIsTourDrawerDismissed(true);
                  setIsEventDrawerDismissed(true);
                } else if (cameFromCardsList) {
                  setSelectedArticle(null);
                  setFocusedArticleId(null);
                  setCameFromCardsList(false);
                  if (!((isNarrowViewport || isMobileLandscape) && mobileTimelineView === 'feed')) {
                    setIsCardsListOpen(true);
                  }
                  setIsTourDrawerDismissed(false);
                  setIsEventDrawerDismissed(false);
                } else {
                  // Clear the selection so re-clicking the same event later re-triggers
                  // showEventDrawer.
                  setSelectedArticle(null);
                  setFocusedArticleId(null);
                  setIsTourDrawerDismissed(false);
                  setIsEventDrawerDismissed(false);
                }
              }}
              onMinimize={isExploring && !isNarrowViewport ? () => setIsTourDrawerMinimized(true) : undefined}
              onEdit={(art) => {
                setEventBeingEdited(art);
                setIsEventEditOpen(true);
              }}
              onDelete={handleDeleteEvent}
              onAskAi={handleAskAiAboutEvent}
              onImagePositionChange={(position) => handleSaveImagePosition(selectedArticle.id, position)}
              readOnly={isReadOnlyView}
              isExploring={isExploring}
              exploreProgress={drawerNavProgress}
              onExploreNext={() => handleExploreStep(1)}
              onExplorePrev={() => handleExploreStep(-1)}
            />
          </ErrorBoundary>
        )}
      </main>

      {/* Bottom bar: manual-authorship note for hand-built (non-AI) personal timelines only. */}
      {currentTimeline?.isManual && (
        <footer className="relative z-20 w-full bg-surface-overlay border-t border-line px-3 sm:px-4 py-1.5 text-xs select-none flex items-center gap-2 shrink-0">
          <div className="p-1 rounded-control bg-success-soft text-success shrink-0">
            <ShieldCheck className="w-3.5 h-3.5" />
          </div>
          <p className="text-caption font-medium text-ink-muted truncate">
            <strong className="text-ink font-semibold">{t('personalDisclaimer.prefix')}</strong> {t('personalDisclaimer.text')}
          </p>
        </footer>
      )}

      {/* Modals */}
      <EventEditModal
        isOpen={isEventEditOpen}
        onClose={() => {
          setIsEventEditOpen(false);
          setEventBeingEdited(null);
        }}
        onSave={handleSaveEvent}
        initialEvent={eventBeingEdited}
        lanes={currentTimeline?.lanes || []}
        timelineTopic={currentTimeline?.title || ''}
        timeScale={currentTimeline?.timeScale || 'calendar'}
        timelineId={currentTimeline?.id}
        currentTimeline={currentTimeline}
        quota={quota}
        onRefreshQuota={refreshQuota}
      />

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

      <SavedTimelinesModal
        isOpen={isSavedModalOpen}
        onClose={() => setIsSavedModalOpen(false)}
        onSelectTimeline={handleSelectTimeline}
        onImportJson={handleImportJson}
      />

      <AdminPanel
        isOpen={isAdminPanelOpen}
        onClose={() => setIsAdminPanelOpen(false)}
        onSelectTimeline={handleSelectTimeline}
        quota={quota}
      />

      <PersonalTimelineModal
        isOpen={isPersonalModalOpen}
        onClose={() => setIsPersonalModalOpen(false)}
        onCreate={handleCreatePersonalTimeline}
        onGenerateFromFiles={handleGenerateFromFiles}
        isGeneratingFromFiles={isGeneratingFromFiles}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        quota={quota}
        onRefreshQuota={refreshQuota}
      />

      <AiDisclaimerModal
        isOpen={isDisclaimerModalOpen}
        onClose={() => setIsDisclaimerModalOpen(false)}
      />

      <PromptGuideModal
        isOpen={isPromptGuideOpen}
        onClose={() => setIsPromptGuideOpen(false)}
        onUsePrompt={handleUseGuidePrompt}
      />

      <AboutModal
        isOpen={isAboutModalOpen}
        onClose={() => setIsAboutModalOpen(false)}
      />



      {isTimelineGuideEnabled() && (
        <InteractiveGuide
          isOpen={isGuideOpen}
          steps={guideSteps}
          onClose={handleCloseGuide}
        />
      )}

      {isHomeGuideEnabled() && (
        <InteractiveGuide
          isOpen={isHomeGuideOpen}
          steps={homeGuideSteps}
          onClose={handleCloseHomeGuide}
        />
      )}

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        initialMode={authModalInitialMode}
      />


    </div>
  );
}

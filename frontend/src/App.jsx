import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import confetti from 'canvas-confetti';
import { toPng } from 'html-to-image';
import Toolbar from './components/Toolbar';
import TimelineView, { isSameArticleId } from './components/TimelineView';
import GeoMapView from './components/GeoMapView';
import EventDrawer from './components/EventDrawer';
import ErrorBoundary from './components/ErrorBoundary';
import CardsListDrawer from './components/CardsListDrawer';
import EventEditModal from './components/EventEditModal';
import AiRefineModal from './components/AiRefineModal';
import SavedTimelinesModal from './components/SavedTimelinesModal';
import AdminPanel from './components/AdminPanel';
import PersonalTimelineModal from './components/PersonalTimelineModal';
import SettingsModal from './components/SettingsModal';
import AiDisclaimerModal from './components/AiDisclaimerModal';
import AboutModal from './components/AboutModal';
import LeftDockMenu from './components/LeftDockMenu';
import TimelineOverviewPanel from './components/TimelineOverviewPanel';
import TimelineChatPanel from './components/TimelineChatPanel';
import InteractiveGuide from './components/InteractiveGuide';
import { buildGuideSteps, buildHomeGuideSteps, closeHomeMenu } from './data/interactiveGuideSteps';
import AuthModal from './components/AuthModal';
import QuickAuthPrompt from './components/QuickAuthPrompt';
import FeaturesView from './components/public/FeaturesView';
import PrivacyView from './components/public/PrivacyView';
import TermsView from './components/public/TermsView';
import PublicPageShell from './components/public/PublicPageShell';
import FeatureShowcase from './components/public/FeatureShowcase';
import PublicFooter from './components/public/PublicFooter';
import TimelineCommentsModal from './components/TimelineCommentsModal';
import { useAuth } from './context/AuthContext';
import { useLanguage } from './context/LanguageContext';
import ChroniXLogo from './components/ChroniXLogo';
import PromptBar from './components/PromptBar';
import PromptExamples, { PROMPT_EXAMPLES } from './components/PromptExamples';
import TriviaTicker from './components/TriviaTicker';
import FloatingMapWidget from './components/FloatingMapWidget';
import { useFloatingFocus, FLOATING_Z } from './utils/floatingFocus';
import { DEFAULT_LANE_COLORS } from './data/laneColors';
import { readGroundingPref } from './utils/groundingConfig';
import { FolderOpen, AlertTriangle, Loader2, MapPin, Maximize2, Minimize2, X, Columns2, BookUser, Dices, Plus, ShieldCheck, Eye, ChevronDown, Globe } from 'lucide-react';

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

// How many recent chat-edit snapshots to persist for post-reload undo (per timeline).
const MAX_CHAT_UNDO = 5;

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
  const { isRtl, t, language } = useLanguage();
  const [currentTimeline, setCurrentTimeline] = useState(null);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [focusedArticleId, setFocusedArticleId] = useState(null);
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
  const [isPublishPillDismissed, setIsPublishPillDismissed] = useState(false);

  useEffect(() => {
    setIsReadOnlyBannerDismissed(false);
  }, [sharedRouteId]);

  useEffect(() => {
    setIsPublishPillDismissed(false);
  }, [currentTimeline?.id]);

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

  // Public-page route tracking ("/privacy", "/terms", "/features")
  const [publicRoute, setPublicRoute] = useState(() => {
    if (typeof window === 'undefined') return null;
    const p = window.location.pathname.toLowerCase();
    const h = window.location.hash.toLowerCase();
    if (p.includes('features') || h.includes('features')) return 'features';
    if (p.includes('privacy') || h.includes('privacy')) return 'privacy';
    if (p.includes('terms') || h.includes('terms')) return 'terms';
    return null;
  });

  useEffect(() => {
    const handleUrlChange = () => {
      const p = window.location.pathname.toLowerCase();
      const h = window.location.hash.toLowerCase();
      if (p.includes('features') || h.includes('features')) setPublicRoute('features');
      else if (p.includes('privacy') || h.includes('privacy')) setPublicRoute('privacy');
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

  // Narrow-viewport (physical mobile/portrait) tracking. The desktop layout is served on
  // all screen sizes; this only toggles narrow-screen affordances (touch scrubber, drawer
  // insets, map popup behaviour).
  const [isNarrowViewport, setIsNarrowViewport] = useState(() =>
    typeof window === 'undefined' ? false : window.innerWidth < 768
  );
  const [isWideDesktop, setIsWideDesktop] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= 1150
  );
  useEffect(() => {
    const handleResize = () => {
      setIsNarrowViewport(window.innerWidth < 768);
      setIsWideDesktop(window.innerWidth >= 1150);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
    } catch {}
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
        try { localStorage.setItem('chronix_cached_quota', JSON.stringify(q)); } catch {}
      }
    } catch (e) {
      // Transient network error — keep the last known value rather than clearing it.
    }
  }, []);

  useEffect(() => {
    refreshQuota();
  }, [user, refreshQuota]);

  // Keep the server-authoritative quota in sync whenever the user returns to the
  // tab/window. Covers window switching, tab close/reopen, and multi-tab usage —
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
      try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch {}
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
      try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch {}
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
      if (saved === 'osm' || saved === 'esri') return saved;
      return 'osm';
    } catch (e) {
      return 'osm';
    }
  });

  const handleMapTileProviderChange = useCallback((provider) => {
    setMapTileProvider(provider);
    try {
      localStorage.setItem('chronix_map_tile_provider', provider);
    } catch (e) {}
  }, []);

  // Active lane AND category (topic) filters from the timeline's own filter menu — the
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
    } catch (e) {}
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
      const newPercent = ((moveEvent.clientY - rect.top) / rect.height) * 100;
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
      } catch (e) {}
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // On narrow screens, a map pin popup can be taller than the current split-pane share
  // (it grows upward from the pin) and get clipped at the top of the map. Called with the
  // popup's required pixel height so the map pane can grow to fit it — never shrinks it,
  // so this never fights a size the user already picked via the divider. Returns whether
  // it actually grew the pane, so the caller can wait out the resize's CSS transition
  // before re-framing the pin (otherwise it gets positioned against the stale, smaller size).
  const handleMapHeightRequest = useCallback((requiredPx) => {
    if (!isNarrowViewport || mapDisplayMode !== 'split' || !splitContainerRef.current) return false;
    const totalHeight = splitContainerRef.current.getBoundingClientRect().height;
    if (!totalHeight) return false;
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
      const newPercent = ((moveEvent.touches[0].clientY - rect.top) / rect.height) * 100;
      const clamped = Math.min(Math.max(newPercent, 15), 85);
      setSplitRatio(clamped);
    };

    const onTouchEnd = () => {
      setIsDraggingSplit(false);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      try {
        setSplitRatio((current) => {
          localStorage.setItem('vt_split_ratio', String(Math.round(current)));
          return current;
        });
      } catch (e) {}
    };

    window.addEventListener('touchmove', onTouchMove);
    window.addEventListener('touchend', onTouchEnd);
  };

  // Theme state ('light' | 'dark')
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('vt_theme');
      if (saved === 'light' || saved === 'dark') return saved;
      return 'light';
    } catch (e) {
      return 'light';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('vt_theme', theme);
    } catch (e) {}

    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const handleToggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

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
  const [commentingTimeline, setCommentingTimeline] = useState(null);
  const [commentOverrides, setCommentOverrides] = useState({});
  const homeScrollRef = useRef(null);

  const handleScrollToCommunityWall = useCallback(() => {
    const el = document.getElementById('features-showcase') || document.getElementById('community-timelines-wall');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (homeScrollRef.current) {
      homeScrollRef.current.scrollTo({ top: 800, behavior: 'smooth' });
    }
  }, []);

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
    } catch {}

    // 2. Reset chat open state & clear dock position memory
    setIsChatOpen(false);
    try {
      localStorage.removeItem('chronix_chat_dock_v3');
      localStorage.removeItem('chronix_chat_size');
    } catch {}

    // 3. Reset side drawers & selection
    setSelectedArticle(null);
    setFocusedArticleId(null);
    setIsCardsListOpen(false);
    setIsOverviewOpen(false);

    // 4. Reset filters & stars
    setTimelineFilter(null);
    setStarredArticleIds(new Set());
    setFilterStarredOnly(false);
    setIsPublishPillDismissed(false);

    // 5. Exit exploration mode
    setIsExploring(false);
  }, []);

  // Clean up any legacy persisted positions on startup so elements never load off-screen
  useEffect(() => {
    try {
      localStorage.removeItem('chronix_chat_dock_v3');
      localStorage.removeItem('chronix_chat_size');
      localStorage.removeItem('chronix_pip_size');
      localStorage.removeItem('chronix_map_mode');
    } catch {}
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
      // Timeline content language is detected server-side from the prompt text itself —
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
          try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch {}
        }
      );
      clearActiveAiJob();
      activeGenerateJobIdRef.current = null;
      resetAllElementPositionsAndState();
      setCurrentTimeline(data);
      triggerCelebration();
      refreshQuota();
      try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch {}
    } catch (err) {
      clearActiveAiJob();
      activeGenerateJobIdRef.current = null;
      refreshQuota();
      try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch {}
      if (err.name === 'AbortError' || controller.signal.aborted) {
        console.log(t('app.generatingStopped'));
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
      resetAllElementPositionsAndState();
      setCurrentTimeline(data);
      setActivePrompt(contextText || data?.title || '');
      setIsPersonalModalOpen(false);
      triggerCelebration();
      refreshQuota();
      try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch {}
    } finally {
      setIsGeneratingFromFiles(false);
    }
  };

  // Handle prompt card selection from home screen
  const handleSelectPrompt = (promptText) => {
    if (isLoading) return;
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    if (isMobile) {
      setActivePrompt((prev) => (prev === promptText ? '' : prev));
      setTimeout(() => {
        setActivePrompt(promptText);
      }, 10);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      setActivePrompt(promptText);
      handleGenerate(promptText);
    }
  };

  // "Surprise Me": pick a random example prompt, preferring the UI language and avoiding an immediate repeat.
  const lastSurprisePromptRef = useRef(null);
  const handleSurpriseMe = () => {
    if (isLoading) return;
    const langPool = PROMPT_EXAMPLES.filter((p) => p.prompt !== lastSurprisePromptRef.current && (language ? p.lang === language : true));
    const pool = langPool.length > 0 ? langPool : PROMPT_EXAMPLES.filter((p) => p.prompt !== lastSurprisePromptRef.current);
    const candidateList = pool.length > 0 ? pool : PROMPT_EXAMPLES;
    const randomItem = candidateList[Math.floor(Math.random() * candidateList.length)];
    if (randomItem) {
      lastSurprisePromptRef.current = randomItem.prompt;
      setActivePrompt(randomItem.prompt);
      handleGenerate(randomItem.prompt);
    }
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

      if (guideParam === 'true' || guideParam === '1') {
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
          try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch {}
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
      try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch {}
    }
  }, [refreshQuota]);

  const handleChatSend = async (text, grounding = readGroundingPref()) => {
    if (!currentTimeline || !text?.trim() || isChatBusy) return;

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
          try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch {}
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
    saveTimeline(snapshot).catch(() => {});
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
      try { localStorage.removeItem(chatStorageKey); } catch {}
    }
    if (chatUndoStorageKey) {
      try { localStorage.removeItem(chatUndoStorageKey); } catch {}
    }
  };

  // Open the chat pre-seeded with a question about a specific event.
  const handleAskAiAboutEvent = (article) => {
    if (!article) return;
    setChatSeed(t('chat.askEventSeed', { title: article.title }));
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

  // Resolves the shareable "/t/<id>" URL.
  const handleGetShareLink = async () => {
    if (!currentTimeline?.id) throw new Error('No timeline to share yet');
    return `${window.location.origin}/t/${currentTimeline.id}`;
  };

  // Explicitly toggle Community Wall public/private status with optional author attribution
  const handleToggleCurrentTimelineShare = async (authorChoice = null) => {
    if (!currentTimeline?.id) return;
    const newStatus = !currentTimeline.isShared;
    const author = authorChoice ?? (user?.user_metadata?.full_name || user?.user_metadata?.name || (user?.email ? user.email.split('@')[0] : null));
    await setTimelineShareEnabled(currentTimeline.id, newStatus, newStatus ? author : null);
    setCurrentTimeline((prev) => (prev ? { ...prev, isShared: newStatus } : prev));
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
  // (no AI/backend generation — the object is built locally and persisted like an import).
  const handleCreatePersonalTimeline = async (data) => {
    setIsPersonalModalOpen(false);
    resetAllElementPositionsAndState();
    setCurrentTimeline(data);
    if (data?.title) {
      setActivePrompt(data.title);
    }
    // If the user started from a blank canvas, open Add Event immediately.
    if (!data?.articles?.length) {
      setEventBeingEdited(null);
      setIsEventEditOpen(true);
    }
    try {
      await saveTimeline(data);
    } catch (e) {
      // ignore
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
  // button, its onClose would otherwise null selectedArticle and auto-exit the tour) — reset
  // whenever the focused article changes so the drawer reappears for the next/prev event.
  const [isTourDrawerDismissed, setIsTourDrawerDismissed] = useState(false);
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
    timelineRef.current?.focusArticle(article.id, { animate: true });
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
    setExploreProgress({ current: 1, total: order.length });
    const first = order[0];
    setSelectedArticle(first);
    if (switchingToSplit) {
      // The timeline canvas remounts when the layout switches to split; focus once it has settled
      // (its init runs a fitArticles pass ~100ms after mount).
      setTimeout(() => timelineRef.current?.focusArticle(first.id, { animate: true }), 400);
    } else {
      timelineRef.current?.focusArticle(first.id, { animate: true });
    }
  }, [getExploreOrder, mapDisplayMode]);

  const handleExitExplore = useCallback(() => {
    setIsExploring(false);
    setIsMobileTourDrawerOpen(false);
    setExploreProgress(null);
    // On narrow screens there's no room to show the timeline AND the last event's detail
    // drawer at once — return to the plain timeline instead of leaving it stuck open.
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
      // Current event no longer visible (filter changed) — re-anchor to the nearest later event
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
    try { localStorage.setItem('chronix_tour_seen', '1'); } catch (e) {}
  }, []);

  // First-run: auto-launch the timeline guide the first time a populated timeline appears.
  const guideAutoStartedRef = useRef(false);
  const guidePendingRef = useRef(false);
  useEffect(() => {
    if (guideAutoStartedRef.current) return;
    const hasEvents = (currentTimeline?.articles?.length ?? 0) > 0;
    if (!hasEvents) return;
    let seen = false;
    try { seen = !!localStorage.getItem('chronix_tour_seen'); } catch (e) {}
    guideAutoStartedRef.current = true;
    if (seen) return;
    try { localStorage.setItem('chronix_tour_seen', '1'); } catch (e) {}
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
    try { localStorage.setItem('chronix_home_tour_seen', '1'); } catch (e) {}
  }, []);

  // First-run: auto-launch home guide for new users on the home screen
  const homeGuideAutoStartedRef = useRef(false);
  useEffect(() => {
    if (homeGuideAutoStartedRef.current) return;
    if (currentTimeline || authLoading || sharedRouteId || publicRoute || isLoading) return;

    let seen = false;
    try { seen = !!localStorage.getItem('chronix_home_tour_seen'); } catch (e) {}

    let forceFromUrl = false;
    try {
      const params = new URLSearchParams(window.location.search);
      forceFromUrl =
        params.get('homeguide') === '1' ||
        params.get('homeguide') === 'true' ||
        ((params.get('guide') === '1' || params.get('guide') === 'true') && !currentTimeline);
    } catch (e) {}

    if (seen && !forceFromUrl) {
      homeGuideAutoStartedRef.current = true;
      return;
    }

    homeGuideAutoStartedRef.current = true;
    try { localStorage.setItem('chronix_home_tour_seen', '1'); } catch (e) {}

    const timer = setTimeout(() => {
      if (!currentTimeline && !isLoading) {
        setIsHomeGuideOpen(true);
      }
    }, 700);

    return () => clearTimeout(timer);
  }, [currentTimeline, authLoading, sharedRouteId, publicRoute, isLoading]);

  // ---- Timeline narrative overview panel ----
  // Gated on isManual (hand-authored, no AI) rather than isPersonal — AI-extracted-from-files
  // "personal" timelines still have a real AI-written overview and should show it.
  const hasOverview = !currentTimeline?.isManual && !!(currentTimeline?.overview || '').trim();

  const timelineCanvasData = useMemo(() => currentTimeline, [
    currentTimeline?.id,
    currentTimeline?.articles,
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
  // different timeline is created/loaded — their open/PIP state should never carry over
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
        <TermsView />
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

  // Read-only whenever the viewer is not the owner of this timeline
  // (covers logged-out visitors, guests, and other users opening a public/shared timeline).
  const isReadOnlyView = Boolean(currentTimeline && currentTimeline.isOwner === false);

  // Detail drawer visibility: always shown for a normal selection; during the guided tour it's
  // also shown on desktop (exceptions: narrow/mobile viewports unless explicitly opened by tapping the
  // event or map popup, and the user dismissing it via its own X — both leave the tour running,
  // mirroring the map popup's close button).
  const showEventDrawer =
    !!selectedArticle &&
    !isCardsListOpen &&
    !isEventDrawerDismissed &&
    !(isExploring && (isNarrowViewport ? !isMobileTourDrawerOpen : isTourDrawerDismissed));

  // True whenever any drawer occupies the left dock area. Used to trigger push layout on wide viewports.
  const hasLeftDrawer = Boolean(
    (currentTimeline && hasOverview && isOverviewOpen) ||
    isCardsListOpen ||
    showEventDrawer
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
    <div className={`fixed inset-0 flex flex-col w-full h-full h-[100dvh] text-ink overflow-hidden font-sans transition-colors duration-200 ${!currentTimeline ? 'home-screen-bg' : 'bg-surface-sunken'}`}>
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

      {/* Floating Quick-Auth Prompt for Guests (deferred until home guide is completed) */}
      {!currentTimeline && (
        <QuickAuthPrompt
          onOpenAuth={handleOpenAuth}
          disabled={!homeGuideSeen || isHomeGuideOpen}
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

      {/* 1-Click Community Wall encouragement pill for timeline owner */}
      {!isReadOnlyView && currentTimeline && !isPublishPillDismissed && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-surface-overlay/95 backdrop-blur-md border border-line/80 text-ink px-3 py-1.5 rounded-full text-xs flex items-center gap-2.5 shadow-pop transition-all animate-in fade-in slide-in-from-top-2 duration-200 select-none">
          {currentTimeline.isShared ? (
            <>
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold text-xs">
                <Globe className="w-3.5 h-3.5 shrink-0" />
                <span>{t('community.publishedToWall') || 'Public on Community Wall'}</span>
              </span>
              <button
                type="button"
                onClick={() => handleToggleCurrentTimelineShare()}
                className="text-caption text-ink-subtle hover:text-danger hover:underline cursor-pointer transition-colors px-1 whitespace-nowrap"
                title={t('community.unpublishFromWall')}
              >
                {t('community.makePrivate') || 'Make private'}
              </button>
            </>
          ) : (
            <>
              <span className="flex h-2 w-2 relative shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
              </span>
              <span className="font-medium text-ink-muted hidden sm:inline text-xs">
                {t('community.encourageSharePrompt') || 'Want to share your timeline with the community?'}
              </span>
              <button
                type="button"
                onClick={() => handleToggleCurrentTimelineShare()}
                className="px-3 py-1 rounded-full bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-caption transition-all flex items-center gap-1.5 shadow-control cursor-pointer active:scale-95 whitespace-nowrap"
                title={t('community.publishToWallTooltip') || 'Publish to Community Wall (1-click)'}
              >
                <Globe className="w-3.5 h-3.5 shrink-0" />
                <span>{t('community.publishToWall') || 'Publish to Community Wall'}</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setIsPublishPillDismissed(true)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink-subtle hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Main Canvas Area */}
      <main className="flex-1 min-h-0 relative w-full overflow-hidden">
        {/* Left-edge vertical dock: consolidated timeline controls (Desktop only) */}
        {currentTimeline && (
          <LeftDockMenu
            timelineData={currentTimeline}
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
            isShared={!!currentTimeline?.isShared}
            onGetShareLink={handleGetShareLink}
            onToggleShare={handleToggleCurrentTimelineShare}
          />
        )}

        {/* Narrative overview reading panel (docked to the left dock rail) */}
        {currentTimeline && hasOverview && (
          <TimelineOverviewPanel
            timeline={currentTimeline}
            isOpen={isOverviewOpen}
            onClose={() => setIsOverviewOpen(false)}
            onRename={handleRenameTimeline}
            style={{
              top: 0,
              bottom: 0,
              zIndex: FLOATING_Z.DRAWER,
              ...(isNarrowViewport && leftDockRect ? { left: leftDockRect.right + 8 } : {}),
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
            ...(isNarrowViewport && leftDockRect ? { left: leftDockRect.right + 8 } : {}),
          }}
        />

        {currentTimeline ? (
          <div
            ref={splitContainerRef}
            style={{
              paddingLeft: !isNarrowViewport
                ? isWideDesktop && hasLeftDrawer
                  ? '452px'
                  : '52px'
                : '0px',
            }}
            className={`w-full h-full flex flex-col overflow-hidden relative transition-[padding-left] duration-200 ease-out ${
              isDraggingSplit ? 'select-none cursor-row-resize' : ''
            }`}
          >
            {/* Top: Geo Map pane (in split mode) */}
            {mapDisplayMode === 'split' && (
              <>
                <div
                  style={{ height: `${splitRatio}%`, zIndex: splitMapZ }}
                  onPointerDownCapture={raiseSplitMap}
                  className={`w-full relative shrink-0 overflow-hidden ${
                    isDraggingSplit ? '' : 'transition-[height] duration-150 ease-out'
                  }`}
                >
                  {/* Floating Quick Controls inside Split Map pane */}
                  <div
                    className="absolute top-3 right-3 z-[1000] flex items-center gap-1 bg-surface-overlay/95 p-1 rounded-panel shadow-pop border border-line backdrop-blur-md select-none"
                  >
                    <button
                      type="button"
                      onClick={() => handleMapDisplayModeChange('pip')}
                      className="p-1.5 text-ink-muted hover:text-accent hover:bg-surface-hover rounded-lg transition-colors cursor-pointer"
                      title={t('floatingMap.pipTooltip')}
                    >
                      <Minimize2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMapDisplayModeChange('full')}
                      className="p-1.5 text-ink-muted hover:text-accent hover:bg-surface-hover rounded-lg transition-colors cursor-pointer"
                      title={t('floatingMap.fullTooltip')}
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMapDisplayModeChange('icon')}
                      className="p-1.5 text-ink-subtle hover:text-danger hover:bg-danger-soft rounded-control transition-colors cursor-pointer"
                      title={t('floatingMap.closeTooltip')}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <GeoMapView
                    articles={currentTimeline?.articles || []}
                    lanes={currentTimeline?.lanes || []}
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
                    isExploring={isExploring}
                    isMobile={isNarrowViewport}
                    hasRightDrawer={hasRightDrawer}
                    onRequestMapHeight={handleMapHeightRequest}
                  />
                </div>

                {/* Draggable Divider Bar */}
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
                    } catch (e) {}
                  }}
                  className={`group relative w-full h-3.5 flex items-center justify-center cursor-row-resize bg-surface-sunken border-y border-line hover:bg-accent/15 transition-colors shrink-0 z-30 select-none ${
                    isDraggingSplit ? 'bg-accent/25 ring-1 ring-accent/60' : ''
                  }`}
                  title={t('floatingMap.resizeTooltip')}
                >
                  {/* Visual Grip pill */}
                  <div className="flex items-center gap-1 px-3 py-0.5 rounded-full bg-surface-raised border border-line shadow-control group-hover:border-accent-ring group-hover:scale-105 transition-all pointer-events-none">
                    <div className="w-6 h-1 rounded-full bg-ink-faint group-hover:bg-accent transition-colors" />
                  </div>
                </div>
              </>
            )}

            {/* Timeline pane */}
            <div
              key="timeline-pane"
              style={mapDisplayMode === 'split' ? { height: `calc(${100 - splitRatio}% - 14px)` } : undefined}
              className={`w-full relative overflow-hidden ${
                mapDisplayMode === 'split'
                  ? `shrink-0 ${isDraggingSplit ? '' : 'transition-[height] duration-150 ease-out'}`
                  : 'flex-1 h-full'
              }`}
            >
              <TimelineView
                ref={timelineRef}
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
              />
            </div>

            {/* Floating Map Widget (Icon | PiP | Full) */}
            <FloatingMapWidget
              key={currentTimeline?.id || 'map'}
              articles={currentTimeline?.articles || []}
              lanes={currentTimeline?.lanes || []}
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
              isExploring={isExploring}
              isMobile={isNarrowViewport}
            />
          </div>
        ) : (
          <div ref={homeScrollRef} className="w-full h-full overflow-y-auto overscroll-y-contain flex flex-col items-center text-center p-3 sm:p-6 pb-12 select-none animate-in fade-in duration-300 bg-transparent">
            {/* Centered Hero & Search Section */}
            <div className="w-full max-w-4xl mx-auto flex flex-col items-center justify-center min-h-[calc(100vh-140px)] sm:min-h-[calc(100vh-160px)] py-4 sm:py-8">
              {/* Hero Branding & Welcome */}
              <div className="mb-0.5 sm:mb-1 transition-transform duration-300 hover:scale-105">
                <ChroniXLogo size="lg" className="w-auto h-12 sm:h-20" />
              </div>
              <div className="space-y-1.5 sm:space-y-2 flex flex-col items-center px-2">
                <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-ink tracking-tight font-sans">
                  {t('home.title')}
                </h2>
                <p className="text-body-sm sm:text-body text-ink-muted max-w-xl leading-relaxed font-sans font-normal sm:font-medium">
                  {t('home.subtitle')}
                </p>
              </div>

              {/* Primary Search Bar (centered focal point of the home screen) */}
              <div className="w-full mt-3 sm:mt-6 mb-2 sm:mb-3">
                <PromptBar
                  onGenerate={handleGenerate}
                  onStop={handleStopGenerate}
                  isLoading={isLoading}
                  activePrompt={activePrompt}
                />
              </div>

              {/* Quick actions (top): Surprise Me + Build Your Own Timeline */}
              <div
                id="guide-home-quick-actions"
                data-guide="home-quick-actions"
                className="pb-1 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2"
                dir="ltr"
                style={{ direction: 'ltr' }}
              >
                <button
                  type="button"
                  onClick={handleSurpriseMe}
                  disabled={isLoading}
                  title={t('home.surpriseMe')}
                  className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-ink-muted hover:text-ink bg-surface-raised hover:bg-surface-hover border border-line shadow-control hover:shadow-card transition-all duration-150 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-default"
                >
                  <Dices className="w-3.5 h-3.5 text-accent group-hover:rotate-45 transition-transform duration-300 shrink-0" />
                  <span>{t('home.surpriseMe')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsPersonalModalOpen(true)}
                  disabled={isLoading}
                  className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-raised hover:bg-surface-hover border border-line hover:border-line-strong text-ink-muted hover:text-ink text-xs font-semibold shadow-control hover:shadow-card transition-all duration-150 active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-default"
                >
                  <BookUser className="w-3.5 h-3.5 text-accent shrink-0" />
                  <span>{t('buildOwn.homeBtn')}</span>
                </button>
              </div>

              {/* Example Prompts (compact, secondary — moved below the main search); swapped
                  for a rotating trivia ticker while a generation is in flight so the wait
                  feels shorter than staring at now-irrelevant, disabled example chips. */}
              <div className="w-full mt-2 sm:mt-4">
                {isLoading ? (
                  <TriviaTicker prompt={activePrompt} />
                ) : (
                  <PromptExamples
                    onSelectPrompt={handleSelectPrompt}
                    isGenerating={isLoading}
                  />
                )}
              </div>

              {/* Downward indicator arrow: signals to users that public community timelines are below */}
              <div className="mt-8 sm:mt-12 flex flex-col items-center">
                <button
                  type="button"
                  onClick={handleScrollToCommunityWall}
                  className="group inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-ink-muted hover:text-ink transition-colors duration-200 cursor-pointer"
                  title={t('home.exploreCommunity') || 'Explore Public Timelines'}
                >
                  <span className="text-accent text-xs font-bold">↓</span>
                  <span>{t('home.exploreCommunity') || 'Explore Public Timelines'}</span>
                  <ChevronDown className="w-4 h-4 text-accent animate-bounce" />
                </button>
              </div>
            </div>

            {/* Community Wall Section (visible on scroll down) */}
            <FeatureShowcase
              onOpenFeatures={() => handleOpenPublicRoute('features')}
              onSelectTimeline={handleSelectTimeline}
              onOpenComments={(item) => setCommentingTimeline(item)}
              commentCountOverrides={commentOverrides}
              isAdmin={Boolean(quota?.is_admin)}
            />

            {/* Public Footer */}
            <PublicFooter
              onOpenPublicRoute={handleOpenPublicRoute}
            />
          </div>
        )}

        {/* Empty personal timeline overlay: shown over the (empty) canvas until the first event
            is added. Only for an active, editable timeline with no events. */}
        {currentTimeline && !isReadOnlyView && (currentTimeline.articles?.length ?? 0) === 0 && (
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
            the bottom of the page — including over the map pane in
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
                // On narrow screens the drawer spans edge-to-edge; keep its left edge clear of
                // the floating left dock rail instead of sliding underneath it.
                ...(isNarrowViewport && leftDockRect ? { left: leftDockRect.right + 8 } : {}),
              }}
              onBackToList={cameFromCardsList ? () => {
                setSelectedArticle(null);
                setFocusedArticleId(null);
                setCameFromCardsList(false);
                setIsCardsListOpen(true);
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
                  setIsCardsListOpen(true);
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

      <AboutModal
        isOpen={isAboutModalOpen}
        onClose={() => setIsAboutModalOpen(false)}
      />

      <TimelineCommentsModal
        isOpen={Boolean(commentingTimeline)}
        onClose={() => setCommentingTimeline(null)}
        timeline={commentingTimeline}
        onCommentCountChange={(id, count) => {
          setCommentOverrides((prev) => ({ ...prev, [id]: count }));
        }}
      />

      <InteractiveGuide
        isOpen={isGuideOpen}
        steps={guideSteps}
        onClose={handleCloseGuide}
      />

      <InteractiveGuide
        isOpen={isHomeGuideOpen}
        steps={homeGuideSteps}
        onClose={handleCloseHomeGuide}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        initialMode={authModalInitialMode}
      />
    </div>
  );
}

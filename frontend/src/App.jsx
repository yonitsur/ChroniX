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
import ExportModal from './components/ExportModal';
import AiDisclaimerModal from './components/AiDisclaimerModal';
import AboutModal from './components/AboutModal';
import LeftDockMenu from './components/LeftDockMenu';
import TimelineOverviewPanel from './components/TimelineOverviewPanel';
import TimelineChatPanel from './components/TimelineChatPanel';
import InteractiveGuide from './components/InteractiveGuide';
import { buildGuideSteps } from './data/interactiveGuideSteps';
import AuthModal from './components/AuthModal';
import AuthGate from './components/AuthGate';
import { useAuth } from './context/AuthContext';
import { useLanguage } from './context/LanguageContext';
import ChroniXLogo from './components/ChroniXLogo';
import PromptBar from './components/PromptBar';
import PromptExamples, { PROMPT_EXAMPLES } from './components/PromptExamples';
import FloatingMapWidget from './components/FloatingMapWidget';
import { useFloatingFocus, FLOATING_Z } from './utils/floatingFocus';
import { DEFAULT_LANE_COLORS } from './data/laneColors';
import { FolderOpen, AlertTriangle, Loader2, MapPin, Maximize2, Minimize2, X, Columns2, BookUser, Dices, Plus, ShieldCheck } from 'lucide-react';

import {
  generateTimeline,
  refineTimeline,
  chatWithTimeline,
  fetchTimeline,
  saveTimeline,
  getApiKey,
  fetchUserQuota,
  getActiveAiJob,
  setActiveAiJob,
  clearActiveAiJob,
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

  // Narrow-viewport (physical mobile/portrait) tracking. The desktop layout is served on
  // all screen sizes; this only toggles narrow-screen affordances (touch scrubber, drawer
  // insets, map popup behaviour).
  const [isNarrowViewport, setIsNarrowViewport] = useState(() =>
    typeof window === 'undefined' ? false : window.innerWidth < 768
  );
  useEffect(() => {
    const handleResize = () => setIsNarrowViewport(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // AbortControllers for active AI requests
  const generateAbortControllerRef = useRef(null);
  const refineAbortControllerRef = useRef(null);
  const chatAbortControllerRef = useRef(null);
  // One-step undo snapshot for chat-driven edits, keyed by the assistant message id
  const chatUndoRef = useRef({});

  // Handle stopping generation
  const handleStopGenerate = useCallback(() => {
    if (generateAbortControllerRef.current) {
      generateAbortControllerRef.current.abort();
      generateAbortControllerRef.current = null;
    }
    clearActiveAiJob();
    setIsLoading(false);
  }, []);

  // Handle stopping refinement
  const handleStopRefine = useCallback(() => {
    if (refineAbortControllerRef.current) {
      refineAbortControllerRef.current.abort();
      refineAbortControllerRef.current = null;
    }
    setIsRefining(false);
  }, []);

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

  // Active lane/theme filter from the timeline's own filter legend, kept in
  // sync so the geo map's pins mirror what's shown/hidden on the timeline.
  const [timelineFilter, setTimelineFilter] = useState(null);
  // Bring-to-front focus for the split-mode map pane (shares the 'map' id with
  // the floating/PiP widget, which is never mounted at the same time).
  const { zIndex: splitMapZ, raise: raiseSplitMap } = useFloatingFocus('map', FLOATING_Z.MAP_BASE);
  const handleTimelineFilterChange = useCallback((items, mode) => {
    setTimelineFilter(items.length > 0 ? { mode, items } : null);
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
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [isPersonalModalOpen, setIsPersonalModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDisclaimerModalOpen, setIsDisclaimerModalOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isCardsListOpen, setIsCardsListOpen] = useState(false);
  const [isOverviewOpen, setIsOverviewOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [isChatBusy, setIsChatBusy] = useState(false);
  const [chatSeed, setChatSeed] = useState(null);
  const [leftDockRect, setLeftDockRect] = useState(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [quota, setQuota] = useState(null);

  const quotaReqIdRef = useRef(0);
  const refreshQuota = useCallback(async () => {
    if (!user) return;
    const reqId = ++quotaReqIdRef.current;
    try {
      const q = await fetchUserQuota();
      // Drop out-of-order (stale) responses so the count never bounces backwards.
      if (reqId !== quotaReqIdRef.current) return;
      if (q) setQuota(q);
    } catch (e) {
      // Transient network error — keep the last known value rather than clearing it.
    }
  }, [user]);

  useEffect(() => {
    refreshQuota();
  }, [user, refreshQuota]);

  // Keep the server-authoritative quota in sync whenever the user returns to the
  // tab/window. Covers window switching, tab close/reopen, and multi-tab usage —
  // the badge is always re-read from the server (which tracks guests by IP).
  useEffect(() => {
    if (!user) return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshQuota();
    };
    window.addEventListener('focus', refreshQuota);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', refreshQuota);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user, refreshQuota]);

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
  }, [user, refreshQuota, t]);

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

    // Verified mode (web search, default) grounds generation via Google Search; Fast mode skips web search for ~2x lower latency.
    let isGroundingActive;
    if (typeof grounding === 'boolean') {
      isGroundingActive = grounding;
    } else {
      try {
        const v = localStorage.getItem('chronix_enable_grounding_v2');
        isGroundingActive = v === null ? true : v === 'true';
      } catch {
        isGroundingActive = true;
      }
    }

    setActivePrompt(prompt);
    setIsLoading(true);
    setErrorMessage(null);
    setSelectedArticle(null);
    setStarredArticleIds(new Set());
    setFilterStarredOnly(false);

    try {
      // Timeline content language is detected server-side from the prompt text itself —
      // intentionally NOT the UI display language, so the two stay fully independent.
      const data = await generateTimeline(
        prompt,
        '',
        controller.signal,
        isGroundingActive,
        (jobId) => {
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
      setCurrentTimeline(data);
      triggerCelebration();
      refreshQuota();
      try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch {}
    } catch (err) {
      clearActiveAiJob();
      refreshQuota();
      try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch {}
      if (err.name === 'AbortError' || controller.signal.aborted) {
        console.log(t('app.generatingStopped'));
        return;
      }
      console.error('Generation failed:', err);
      setErrorMessage(err.message || t('app.failedGenerate'));
      if (err.message && (err.message.includes('Authentication') || (err.message.includes('sign in') && !isGuest))) {
        setIsAuthModalOpen(true);
      } else if (err.message && err.message.includes('API Key') && !isGuest) {
        setIsSettingsOpen(true);
      }
    } finally {
      if (generateAbortControllerRef.current === controller) {
        generateAbortControllerRef.current = null;
      }
      setIsLoading(false);
    }
  };

  // Handle prompt card selection from home screen
  const handleSelectPrompt = (promptText) => {
    if (isLoading) return;
    setActivePrompt(promptText);
    handleGenerate(promptText);
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
      handleSelectPrompt(randomItem.prompt);
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
      const updated = await refineTimeline(currentTimeline, instruction, controller.signal);
      setCurrentTimeline({ ...updated });
      setIsAiRefineOpen(false);
      triggerCelebration();
      refreshQuota();
    } catch (err) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        console.log('Refinement stopped by user.');
        return;
      }
      console.error('Refinement failed:', err);
      setErrorMessage(err.message || t('app.failedRefine'));
      if (err.message && (err.message.includes('Authentication') || (err.message.includes('sign in') && !isGuest))) {
        setIsAuthModalOpen(true);
      }
    } finally {
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

  const handleChatStop = useCallback(() => {
    if (chatAbortControllerRef.current) {
      chatAbortControllerRef.current.abort();
      chatAbortControllerRef.current = null;
    }
    setIsChatBusy(false);
  }, []);

  const handleChatSend = async (text, grounding = true) => {
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
      const res = await chatWithTimeline(currentTimeline, text.trim(), history, grounding, controller.signal);
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
        setIsAuthModalOpen(true);
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
    if (!currentTimeline) return;

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

  // Handle deleting an event
  const handleDeleteEvent = async (articleId) => {
    if (!currentTimeline) return;
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
      setCurrentTimeline(data);
      setSelectedArticle(null);
      setStarredArticleIds(new Set());
      setFilterStarredOnly(false);
      if (data?.title) {
        setActivePrompt(data.title);
      }
    } catch (err) {
      alert(t('app.failedLoad') + err.message);
    }
  };

  const handleImportJson = async (imported) => {
    setCurrentTimeline(imported);
    setSelectedArticle(null);
    setStarredArticleIds(new Set());
    setFilterStarredOnly(false);
    if (imported?.title) {
      setActivePrompt(imported.title);
    }
    try {
      await saveTimeline(imported);
    } catch (e) {
      // ignore
    }
  };

  // Create a hand-authored personal timeline from the "Build Your Own Timeline" flow
  // (no AI/backend generation — the object is built locally and persisted like an import).
  const handleCreatePersonalTimeline = async (data) => {
    setIsPersonalModalOpen(false);
    setCurrentTimeline(data);
    setSelectedArticle(null);
    setStarredArticleIds(new Set());
    setFilterStarredOnly(false);
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
    setCurrentTimeline(null);
    setSelectedArticle(null);
    setFocusedArticleId(null);
    setIsCardsListOpen(false);
    setStarredArticleIds(new Set());
    setFilterStarredOnly(false);
    setActivePrompt('');
  };

  // Navigate back to the home view (Logo click)
  const handleGoHome = () => {
    setCurrentTimeline(null);
    setSelectedArticle(null);
    setFocusedArticleId(null);
    setIsCardsListOpen(false);
    setStarredArticleIds(new Set());
    setFilterStarredOnly(false);
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
    handleFocusArticle(article);
    setCameFromCardsList(true);
  };

  // Toggle Cards List Drawer (or tabs of elements in timeline) from top bar or shortcuts
  const handleToggleCardsList = useCallback(() => {
    if (isCardsListOpen) {
      setIsCardsListOpen(false);
      setSelectedArticle(null);
      setCameFromCardsList(false);
    } else {
      setSelectedArticle(null);
      setCameFromCardsList(false);
      setIsCardsListOpen(true);
    }
  }, [isCardsListOpen]);

  // ---- Exploration mode: guided event-by-event walkthrough of the desktop timeline ----
  const [isExploring, setIsExploring] = useState(false);
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
    setExploreProgress({ current: nextIdx + 1, total: order.length });
    focusExploredArticle(order[nextIdx]);
  }, [getExploreOrder, selectedArticle, focusExploredArticle]);

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
    setIsCardsListOpen(false);
    setGuideSteps(buildGuideSteps(t));
    setIsGuideOpen(true);
  }, [t]);

  useEffect(() => {
    if (isGuideOpen) {
      setGuideSteps(buildGuideSteps(t));
    }
  }, [isGuideOpen, t]);

  const handleCloseGuide = useCallback(() => {
    setIsGuideOpen(false);
    try { localStorage.setItem('chronix_tour_seen', '1'); } catch (e) {}
  }, []);

  // First-run: auto-launch the guide the first time a populated timeline appears.
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

  // ---- Timeline narrative overview panel ----
  const hasOverview = !currentTimeline?.isPersonal && !!(currentTimeline?.overview || '').trim();

  // Auto-open the overview panel once per timeline. Deferred while the first-run
  // coach-mark tour is pending/open or interactive exploration is active, so they never conflict.
  const overviewAutoShownRef = useRef(new Set());
  useEffect(() => {
    const id = currentTimeline?.id;
    const overview = (currentTimeline?.overview || '').trim();
    if (!id || !overview || currentTimeline?.isPersonal) return;
    if (overviewAutoShownRef.current.has(id)) return;
    if (isGuideOpen || guidePendingRef.current || isExploring) return;
    const timer = setTimeout(() => {
      overviewAutoShownRef.current.add(id);
      setIsOverviewOpen(true);
    }, 550);
    return () => clearTimeout(timer);
  }, [currentTimeline?.id, currentTimeline?.overview, currentTimeline?.isPersonal, isGuideOpen, isExploring]);

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
      setMapDisplayMode('icon');
      setIsChatOpen(false);
    }
  }, [currentTimeline?.id]);

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

  if (!user) {
    return <AuthGate theme={theme} onToggleTheme={handleToggleTheme} />;
  }

  // Detail drawer visibility: always shown for a normal selection; during the guided tour it's
  // also shown on desktop (exceptions: narrow/mobile viewports unless explicitly opened by tapping the
  // event or map popup, and the user dismissing it via its own X — both leave the tour running,
  // mirroring the map popup's close button).
  const showEventDrawer =
    !!selectedArticle &&
    !isCardsListOpen &&
    !isEventDrawerDismissed &&
    !(isExploring && (isNarrowViewport ? !isMobileTourDrawerOpen : isTourDrawerDismissed));

  // True whenever either the event detail drawer or the cards list drawer occupies
  // the right edge of the screen on desktop. Used to position floating controls
  // and the timeline's right navigation arrow clear to the left of the pane.
  const hasRightDrawer = showEventDrawer || isCardsListOpen;

  // Position of the open event within the current chronological order, so the drawer's
  // prev/next controls (and their end-of-list disabled states) work outside of the tour too.
  let drawerNavProgress = exploreProgress;
  if (!drawerNavProgress && showEventDrawer && selectedArticle) {
    const order = getExploreOrder();
    const idx = order.findIndex((a) => isSameArticleId(a.id, selectedArticle.id));
    if (idx >= 0) drawerNavProgress = { current: idx + 1, total: order.length };
  }

  return (
    <div className="fixed inset-0 flex flex-col w-full h-full h-[100dvh] bg-surface-sunken text-ink overflow-hidden font-sans transition-colors duration-200">
      {/* Top Navigation & Toolbar */}
      <Toolbar
        timelineData={currentTimeline}
        onZoomIn={() => timelineRef.current?.zoomIn()}
        onZoomOut={() => timelineRef.current?.zoomOut()}
        onFitAll={() => timelineRef.current?.fitAll()}
        onOpenSaved={() => setIsSavedModalOpen(true)}
        onOpenAdmin={() => setIsAdminPanelOpen(true)}
        onOpenExport={() => setIsExportModalOpen(true)}
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
        onOpenAuth={() => setIsAuthModalOpen(true)}
        activePrompt={activePrompt}
        quota={quota}
        onOpenQuota={() => setIsSettingsOpen(true)}
      />

      {/* Error banner */}
      {errorMessage && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-30 bg-danger-soft border border-danger/30 text-danger px-4 py-2.5 rounded-panel text-xs flex flex-wrap items-center justify-center gap-2.5 shadow-card max-w-xl text-center">
          <span>{errorMessage}</span>
          {isGuest && (
            <button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                setIsAuthModalOpen(true);
              }}
              className="px-2.5 py-1 rounded-control bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-[11.5px] transition-colors whitespace-nowrap shadow-control"
            >
              {t('toolbar.guestSaveAccount') || 'Sign In / Save Account'}
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
            timelineData={currentTimeline}
            activeFilter={timelineFilter}
            onFilterSelect={(item) => timelineRef.current?.setLegendFilter(item ? item.id : null)}
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
            onToggleOverview={() => setIsOverviewOpen((v) => !v)}
            onRectChange={setLeftDockRect}
          />
        )}

        {/* Narrative overview reading panel (opens to the right of the left dock rail) */}
        {currentTimeline && hasOverview && (
          <TimelineOverviewPanel
            timeline={currentTimeline}
            isOpen={isOverviewOpen}
            onClose={() => setIsOverviewOpen(false)}
            style={{ top: 12, bottom: 12, left: 68, zIndex: FLOATING_Z.DRAWER }}
          />
        )}

        {/* Conversational "Talk to the timeline" floating chat dock */}
        {currentTimeline && (
          <TimelineChatPanel
            isOpen={isChatOpen}
            onClose={() => setIsChatOpen(false)}
            onOpen={() => setIsChatOpen(true)}
            timelineTitle={currentTimeline.title}
            messages={chatMessages}
            isBusy={isChatBusy}
            onSend={handleChatSend}
            onStop={handleChatStop}
            onClear={handleChatClear}
            onUndo={handleChatUndo}
            seed={chatSeed}
            onSeedConsumed={() => setChatSeed(null)}
          />
        )}

        {/* Cards List Drawer (right-side panel) */}
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
            // On narrow screens keep the left edge clear of the floating left dock rail,
            // matching the event detail drawer, instead of spanning the full screen width.
            ...(isNarrowViewport && leftDockRect ? { left: leftDockRect.right + 8 } : {}),
          }}
        />

        {currentTimeline ? (
            mapDisplayMode === 'split' ? (
              <div
                ref={splitContainerRef}
                className={`w-full h-full flex flex-col overflow-hidden ${
                  isDraggingSplit ? 'select-none cursor-row-resize' : ''
                }`}
              >
                {/* Top: Geo Map pane */}
                <div
                  style={{ height: `${splitRatio}%`, zIndex: splitMapZ }}
                  onPointerDownCapture={raiseSplitMap}
                  className={`w-full relative shrink-0 overflow-hidden ${
                    isDraggingSplit ? '' : 'transition-[height] duration-150 ease-out'
                  }`}
                >
                  {/* Floating Quick Controls inside Split Map pane. Slide clear of the
                      event drawer (which overlays the right edge) while it is open. */}
                  <div
                    className={`absolute top-3 z-[1000] flex items-center gap-1 bg-surface-overlay/95 p-1 rounded-panel shadow-pop border border-line backdrop-blur-md select-none transition-[right] duration-300 ease-in-out ${
                      hasRightDrawer ? 'right-3 sm:right-[396px] md:right-[432px]' : 'right-3'
                    }`}
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

                {/* Bottom: Timeline pane */}
                <div
                  style={{ height: `calc(${100 - splitRatio}% - 14px)` }}
                  className={`w-full relative overflow-hidden shrink-0 ${
                    isDraggingSplit ? '' : 'transition-[height] duration-150 ease-out'
                  }`}
                >
                  <TimelineView
                    ref={timelineRef}
                    timelineData={currentTimeline}
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
              </div>
            ) : (
              <>
                {/* Full Height Timeline */}
                <TimelineView
                  ref={timelineRef}
                  timelineData={currentTimeline}
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

                {/* Floating Map Widget (Icon | PiP | Full) */}
                <FloatingMapWidget
                  articles={currentTimeline?.articles || []}
                  lanes={currentTimeline?.lanes || []}
                  selectedArticleId={selectedArticle?.id || focusedArticleId}
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
              </>
            )
        ) : (
          <div className="w-full h-full overflow-y-auto overscroll-y-contain flex flex-col items-center text-center justify-between sm:justify-center p-3 sm:p-6 pb-6 sm:pb-20 select-none animate-in fade-in duration-300 home-screen-bg">
            <div className="w-full max-w-4xl mx-auto my-auto flex flex-col items-center justify-center">
              {/* Hero Branding & Welcome */}
              <div className="mb-0.5 sm:mb-1 transition-transform duration-300 hover:scale-105">
                <ChroniXLogo size="lg" className="w-auto h-12 sm:h-20" />
              </div>
              <div className="space-y-1 sm:space-y-1.5 flex flex-col items-center px-2">
                <h2 className="text-lg sm:text-2xl font-bold text-ink tracking-tight font-sans">
                  {t('home.title')}
                </h2>
                <p className="text-xs sm:text-sm text-ink-muted max-w-lg leading-relaxed font-sans font-medium">
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
              <div className="pb-1 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={handleSurpriseMe}
                  disabled={isLoading}
                  title={t('home.surpriseMe')}
                  className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-ink-muted hover:text-ink bg-surface-raised hover:bg-surface-hover border border-line shadow-control hover:shadow-card transition-all duration-150 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Dices className="w-3.5 h-3.5 text-accent group-hover:rotate-45 transition-transform duration-300 shrink-0" />
                  <span>{t('home.surpriseMe')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsPersonalModalOpen(true)}
                  disabled={isLoading}
                  className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-raised hover:bg-surface-hover border border-line hover:border-line-strong text-ink-muted hover:text-ink text-xs font-semibold shadow-control hover:shadow-card transition-all duration-150 active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <BookUser className="w-3.5 h-3.5 text-accent shrink-0" />
                  <span>{t('buildOwn.homeBtn')}</span>
                </button>
              </div>

              {/* Example Prompts (compact, secondary — moved below the main search) */}
              <div className="w-full mt-2 sm:mt-4">
                <PromptExamples
                  onSelectPrompt={handleSelectPrompt}
                  isGenerating={isLoading}
                />
              </div>
            </div>
          </div>
        )}

        {/* Empty personal timeline overlay: shown over the (empty) canvas until the first event
            is added. Only for an active timeline with no events. */}
        {currentTimeline && (currentTimeline.articles?.length ?? 0) === 0 && (
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
                bottom: EVENT_DRAWER_BOTTOM_CLEARANCE,
                zIndex: FLOATING_Z.DRAWER,
                // On narrow screens the drawer spans edge-to-edge; keep its left edge clear of
                // the floating left dock rail instead of sliding underneath it.
                ...(isNarrowViewport && leftDockRect ? { left: leftDockRect.right + 8 } : {}),
              }}
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
              isExploring={isExploring}
              exploreProgress={drawerNavProgress}
              onExploreNext={() => handleExploreStep(1)}
              onExplorePrev={() => handleExploreStep(-1)}
            />
          </ErrorBoundary>
        )}
      </main>

      {/* Bottom bar: manual-authorship note for personal timelines only. */}
      {currentTimeline?.isPersonal && (
        <footer className="relative z-20 w-full bg-surface-overlay border-t border-line px-3 sm:px-4 py-1.5 text-xs select-none flex items-center gap-2 shrink-0">
          <div className="p-1 rounded-control bg-success-soft text-success shrink-0">
            <ShieldCheck className="w-3.5 h-3.5" />
          </div>
          <p className="text-[11px] font-medium text-ink-muted truncate">
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

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        timeline={currentTimeline}
        onExportImage={handleExportImage}
        onExportJson={handleExportJson}
      />

      <AdminPanel
        isOpen={isAdminPanelOpen}
        onClose={() => setIsAdminPanelOpen(false)}
        onSelectTimeline={handleSelectTimeline}
      />

      <PersonalTimelineModal
        isOpen={isPersonalModalOpen}
        onClose={() => setIsPersonalModalOpen(false)}
        onCreate={handleCreatePersonalTimeline}
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
        onOpenGuide={() => {
          setIsAboutModalOpen(false);
          setIsGuideOpen(true);
        }}
      />

      <InteractiveGuide
        isOpen={isGuideOpen}
        steps={guideSteps}
        onClose={handleCloseGuide}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />
    </div>
  );
}

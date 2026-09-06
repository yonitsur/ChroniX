import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import confetti from 'canvas-confetti';
import { toPng } from 'html-to-image';
import Toolbar from './components/Toolbar';
import TimelineView from './components/TimelineView';
import GeoMapView from './components/GeoMapView';
import EventDrawer from './components/EventDrawer';
import ErrorBoundary from './components/ErrorBoundary';
import CardsListDrawer from './components/CardsListDrawer';
import EventEditModal from './components/EventEditModal';
import AiRefineModal from './components/AiRefineModal';
import SavedTimelinesModal from './components/SavedTimelinesModal';
import SettingsModal from './components/SettingsModal';
import AiDisclaimerModal from './components/AiDisclaimerModal';
import AboutModal from './components/AboutModal';
import UserGuideModal from './components/UserGuideModal';
import AiDisclaimerBar from './components/AiDisclaimerBar';
import FloatingCardsButton from './components/FloatingCardsButton';
import AuthModal from './components/AuthModal';
import AuthGate from './components/AuthGate';
import QuotaModal from './components/QuotaModal';
import { useAuth } from './context/AuthContext';
import { useLanguage } from './context/LanguageContext';
import ChroniXLogo from './components/ChroniXLogo';
import PromptExamples from './components/PromptExamples';
import FloatingMapWidget from './components/FloatingMapWidget';
import MobileTimelineView from './components/MobileTimelineView';
import MobileNavBar from './components/MobileNavBar';
import { FolderOpen, AlertTriangle, Loader2, MapPin, Maximize2, Minimize2, X, Columns2, Square, BookOpen, ArrowRight, Globe } from 'lucide-react';

import {
  generateTimeline,
  refineTimeline,
  fetchTimeline,
  saveTimeline,
  getApiKey,
  fetchUserQuota
} from './api';

export default function App() {
  const { user, loading: authLoading } = useAuth();
  const { language, isRtl, t } = useLanguage();
  const [currentTimeline, setCurrentTimeline] = useState(null);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [activePrompt, setActivePrompt] = useState('');
  const [activeDetailLevel, setActiveDetailLevel] = useState('standard');

  // Starred events state (in-session favorites)
  const [starredArticleIds, setStarredArticleIds] = useState(() => new Set());
  const [filterStarredOnly, setFilterStarredOnly] = useState(false);

  // Mobile layout detection and state
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });
  const [mobileTab, setMobileTab] = useState('timeline'); // 'timeline' | 'map' | 'cards'
  const [isMobileCanvasView, setIsMobileCanvasView] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Compute count of geocoded locations
  const locationsCount = useMemo(() => {
    if (!currentTimeline?.articles) return 0;
    return currentTimeline.articles.filter(
      (a) =>
        a.lat !== undefined &&
        a.lat !== null &&
        a.lng !== undefined &&
        a.lng !== null &&
        !isNaN(Number(a.lat)) &&
        !isNaN(Number(a.lng))
    ).length;
  }, [currentTimeline]);

  // AbortControllers for active AI requests
  const generateAbortControllerRef = useRef(null);
  const refineAbortControllerRef = useRef(null);

  // Handle stopping generation
  const handleStopGenerate = useCallback(() => {
    if (generateAbortControllerRef.current) {
      generateAbortControllerRef.current.abort();
      generateAbortControllerRef.current = null;
    }
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
    };
  }, []);

  // Map Display Mode ('icon' | 'pip' | 'split' | 'full')
  const [mapDisplayMode, setMapDisplayMode] = useState(() => {
    try {
      const saved = localStorage.getItem('chronix_map_mode');
      if (saved === 'icon' || saved === 'pip' || saved === 'split' || saved === 'full') return saved;
      // Default to 'pip' (Compact floating PiP map window so new users discover the feature)
      return 'pip';
    } catch (e) {
      return 'pip';
    }
  });

  const handleMapDisplayModeChange = useCallback((mode) => {
    if (isMobile) {
      if (mode === 'icon') {
        setMobileTab('timeline');
      } else {
        setMobileTab('map');
      }
      return;
    }
    setMapDisplayMode(mode);
    try {
      localStorage.setItem('chronix_map_mode', mode);
    } catch (e) {}
  }, [isMobile]);

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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDisclaimerModalOpen, setIsDisclaimerModalOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [isUserGuideOpen, setIsUserGuideOpen] = useState(false);
  const [isCardsListOpen, setIsCardsListOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isQuotaModalOpen, setIsQuotaModalOpen] = useState(false);
  const [quota, setQuota] = useState(null);

  const refreshQuota = useCallback(async () => {
    if (!user) return;
    try {
      const q = await fetchUserQuota();
      if (q) setQuota(q);
    } catch (e) {
      // ignore
    }
  }, [user]);

  useEffect(() => {
    refreshQuota();
  }, [user, refreshQuota]);

  const timelineRef = useRef(null);

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
  const handleGenerate = async (prompt, detailLevel) => {
    if (generateAbortControllerRef.current) {
      generateAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    generateAbortControllerRef.current = controller;

    setActivePrompt(prompt);
    if (detailLevel) setActiveDetailLevel(detailLevel);
    setIsLoading(true);
    setErrorMessage(null);
    setSelectedArticle(null);
    setStarredArticleIds(new Set());
    setFilterStarredOnly(false);

    try {
      const data = await generateTimeline(prompt, detailLevel, '', controller.signal);
      setCurrentTimeline(data);
      triggerCelebration();
      refreshQuota();
    } catch (err) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        console.log(t('app.generatingStopped'));
        return;
      }
      console.error('Generation failed:', err);
      setErrorMessage(err.message || t('app.failedGenerate'));
      if (err.message && (err.message.includes('Authentication') || err.message.includes('sign in'))) {
        setIsAuthModalOpen(true);
      } else if (err.message && err.message.includes('API Key')) {
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
  const handleSelectPrompt = (promptText, detailLevel = 'standard') => {
    setActivePrompt(promptText);
    setActiveDetailLevel(detailLevel);
    handleGenerate(promptText, detailLevel);
  };

  // Check for URL query parameters on mount (e.g. ?prompt=...&detailLevel=... or ?guide=true)
  const initialUrlCheckedRef = useRef(false);
  useEffect(() => {
    if (!user || initialUrlCheckedRef.current) return;
    initialUrlCheckedRef.current = true;

    try {
      const params = new URLSearchParams(window.location.search);
      const promptParam = params.get('prompt');
      const detailParam = params.get('detailLevel') || 'standard';
      const guideParam = params.get('guide');

      if (guideParam === 'true' || guideParam === '1') {
        setIsUserGuideOpen(true);
      }

      if (promptParam) {
        // Clean up URL query parameters without reloading
        window.history.replaceState({}, document.title, window.location.pathname);
        setActivePrompt(promptParam);
        setActiveDetailLevel(detailParam);
        handleGenerate(promptParam, detailParam);
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
      if (err.message && (err.message.includes('Authentication') || err.message.includes('sign in'))) {
        setIsAuthModalOpen(true);
      }
    } finally {
      if (refineAbortControllerRef.current === controller) {
        refineAbortControllerRef.current = null;
      }
      setIsRefining(false);
    }
  };

  // Handle saving an edited/new event
  const handleSaveEvent = async (savedArticle) => {
    if (!currentTimeline) return;

    let updatedArticles = [...(currentTimeline.articles || [])];
    const index = updatedArticles.findIndex((a) => a.id === savedArticle.id);

    if (index >= 0) {
      updatedArticles[index] = savedArticle;
    } else {
      updatedArticles.push(savedArticle);
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
      articles: updatedArticles
    };

    setCurrentTimeline(updatedTimeline);
    if (selectedArticle && selectedArticle.id === savedArticle.id) {
      setSelectedArticle(savedArticle);
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

  // Clear board (reset timeline)
  const handleClearBoard = () => {
    setCurrentTimeline(null);
    setSelectedArticle(null);
    setIsCardsListOpen(false);
    setStarredArticleIds(new Set());
    setFilterStarredOnly(false);
    setActivePrompt('');
    setActiveDetailLevel('standard');
  };

  // Navigate back to the home view (Logo click)
  const handleGoHome = () => {
    setCurrentTimeline(null);
    setSelectedArticle(null);
    setIsCardsListOpen(false);
    setStarredArticleIds(new Set());
    setFilterStarredOnly(false);
    setActivePrompt('');
    setActiveDetailLevel('standard');
    setMobileTab('timeline');
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
  const handleSelectArticle = (article) => {
    if (!article) {
      setSelectedArticle(null);
      return;
    }
    const articleId = article.id || article.data?.id;
    const fullArticle = currentTimeline?.articles?.find((a) => a.id === articleId) || article;
    setSelectedArticle(fullArticle);
  };

  // Focus and select article from cards list or map
  const handleFocusArticle = (article) => {
    handleSelectArticle(article);
    const id = article?.id || article?.data?.id;
    if (id) {
      timelineRef.current?.focusArticle(id);
    }
  };

  // Jump directly to map on mobile and focus article
  const handleFocusOnMapMobile = useCallback((article) => {
    handleSelectArticle(article);
    setMobileTab('map');
  }, []);

  // Toggle Cards List Drawer (or tabs of elements in timeline) from top bar or shortcuts
  const handleToggleCardsList = useCallback(() => {
    if (isMobile) {
      setMobileTab((prev) => (prev === 'cards' ? 'timeline' : 'cards'));
      return;
    }
    if (isCardsListOpen) {
      setIsCardsListOpen(false);
      setSelectedArticle(null);
    } else {
      setSelectedArticle(null);
      setIsCardsListOpen(true);
    }
  }, [isMobile, isCardsListOpen]);

  if (authLoading) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-950 text-white gap-3 select-none">
        <div className="relative flex items-center justify-center">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
          </div>
        </div>
        <span className="text-xs text-slate-400 font-medium tracking-wide">{t('app.starting')}</span>
      </div>
    );
  }

  if (!user) {
    return <AuthGate />;
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100 overflow-hidden font-sans transition-colors duration-200">
      {/* Top Navigation & Toolbar */}
      <Toolbar
        timelineData={currentTimeline}
        onZoomIn={() => timelineRef.current?.zoomIn()}
        onZoomOut={() => timelineRef.current?.zoomOut()}
        onFitAll={() => timelineRef.current?.fitAll()}
        onOpenRefine={() => setIsAiRefineOpen(true)}
        onAddEvent={() => {
          setEventBeingEdited(null);
          setIsEventEditOpen(true);
        }}
        onOpenSaved={() => setIsSavedModalOpen(true)}
        onExportJson={handleExportJson}
        onExportImage={handleExportImage}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenDisclaimer={() => setIsDisclaimerModalOpen(true)}
        onOpenAbout={() => setIsAboutModalOpen(true)}
        onOpenGuide={() => setIsUserGuideOpen(true)}
        isGenerating={isLoading}
        onStopGenerate={handleStopGenerate}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onGenerate={handleGenerate}
        onClearBoard={handleClearBoard}
        onGoHome={handleGoHome}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        activePrompt={activePrompt}
        activeDetailLevel={activeDetailLevel}
        quota={quota}
        onOpenQuota={() => setIsQuotaModalOpen(true)}
        filterStarredOnly={filterStarredOnly}
        onToggleFilterStarredOnly={handleToggleFilterStarredOnly}
        starredCount={starredArticleIds.size}
        isCardsListOpen={isCardsListOpen}
        onToggleCardsList={handleToggleCardsList}
        mapMode={mapDisplayMode}
        onMapModeChange={handleMapDisplayModeChange}
      />

      {/* Error banner */}
      {errorMessage && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-30 bg-rose-100/95 dark:bg-rose-900/90 border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-100 px-4 py-2 rounded-xl text-xs flex items-center gap-2 shadow-xl backdrop-blur-md">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-rose-600 dark:text-rose-300 hover:text-rose-900 dark:hover:text-white ml-2 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Canvas Area */}
      <main className="flex-1 relative w-full h-full">
        {/* Floating Edge Toggle for Cards List when closed and cards exist (Desktop only) */}
        {currentTimeline?.articles?.length > 0 && !isCardsListOpen && !isMobile && (
          <FloatingCardsButton
            count={currentTimeline.articles.length}
            onClick={() => {
              setSelectedArticle(null);
              setIsCardsListOpen(true);
            }}
            side="right"
          />
        )}

        {/* Cards List Drawer (Panel - Desktop only; on mobile handled inside tab) */}
        {!isMobile && (
          <CardsListDrawer
            isOpen={isCardsListOpen}
            onClose={() => setIsCardsListOpen(false)}
            articles={currentTimeline?.articles || []}
            lanes={currentTimeline?.lanes || []}
            selectedArticleId={selectedArticle?.id}
            onSelectArticle={handleFocusArticle}
            starredArticleIds={starredArticleIds}
            onToggleStar={handleToggleStar}
            filterStarredOnly={filterStarredOnly}
            onToggleFilterStarredOnly={handleToggleFilterStarredOnly}
          />
        )}

        {currentTimeline ? (
          isMobile ? (
            <div className="w-full h-full relative overflow-hidden">
              {/* Tab 1: Timeline (Vertical Feed or Canvas if toggled) */}
              {mobileTab === 'timeline' && (
                isMobileCanvasView ? (
                  <TimelineView
                    ref={timelineRef}
                    timelineData={currentTimeline}
                    onSelectArticle={handleSelectArticle}
                    selectedArticleId={selectedArticle?.id}
                    starredArticleIds={starredArticleIds}
                    onToggleStar={handleToggleStar}
                    theme={theme}
                  />
                ) : (
                  <MobileTimelineView
                    timelineData={currentTimeline}
                    onSelectArticle={handleSelectArticle}
                    selectedArticleId={selectedArticle?.id}
                    onFocusOnMap={handleFocusOnMapMobile}
                    starredArticleIds={starredArticleIds}
                    onToggleStar={handleToggleStar}
                    filterStarredOnly={filterStarredOnly}
                    onToggleFilterStarredOnly={handleToggleFilterStarredOnly}
                    theme={theme}
                  />
                )
              )}

              {/* Tab 2: Full-screen Geo Map */}
              {mobileTab === 'map' && (
                <div className="w-full h-full relative pb-14">
                  <GeoMapView
                    articles={currentTimeline?.articles || []}
                    lanes={currentTimeline?.lanes || []}
                    selectedArticleId={selectedArticle?.id}
                    onSelectArticle={handleSelectArticle}
                    theme={theme}
                  />
                </div>
              )}

              {/* Tab 3: Full-screen Cards List & Search */}
              {mobileTab === 'cards' && (
                <CardsListDrawer
                  isOpen={true}
                  onClose={() => setMobileTab('timeline')}
                  articles={currentTimeline?.articles || []}
                  lanes={currentTimeline?.lanes || []}
                  selectedArticleId={selectedArticle?.id}
                  onSelectArticle={handleSelectArticle}
                  starredArticleIds={starredArticleIds}
                  onToggleStar={handleToggleStar}
                  filterStarredOnly={filterStarredOnly}
                  onToggleFilterStarredOnly={handleToggleFilterStarredOnly}
                />
              )}

              {/* Fixed Mobile Bottom Navigation Bar */}
              <MobileNavBar
                activeTab={mobileTab}
                onTabChange={setMobileTab}
                onOpenRefine={() => setIsAiRefineOpen(true)}
                locationsCount={locationsCount}
                cardsCount={currentTimeline?.articles?.length || 0}
                isGenerating={isLoading}
                isCanvasView={isMobileCanvasView}
                onToggleCanvasView={() => setIsMobileCanvasView((prev) => !prev)}
              />
            </div>
          ) : (
            mapDisplayMode === 'split' ? (
              <div
                ref={splitContainerRef}
                className={`w-full h-full flex flex-col overflow-hidden ${
                  isDraggingSplit ? 'select-none cursor-row-resize' : ''
                }`}
              >
                {/* Top: Geo Map pane */}
                <div
                  style={{ height: `${splitRatio}%` }}
                  className={`w-full relative shrink-0 overflow-hidden ${
                    isDraggingSplit ? '' : 'transition-[height] duration-150 ease-out'
                  }`}
                >
                  {/* Floating Quick Controls inside Split Map pane */}
                  <div className="absolute top-3 right-3 z-[1000] flex items-center gap-1 bg-white/95 dark:bg-slate-900/95 p-1 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 backdrop-blur-md select-none">
                    <button
                      type="button"
                      onClick={() => handleMapDisplayModeChange('pip')}
                      className="p-1.5 text-slate-600 hover:text-sky-600 dark:text-slate-300 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                      title={t('floatingMap.pipTooltip')}
                    >
                      <Minimize2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMapDisplayModeChange('full')}
                      className="p-1.5 text-slate-600 hover:text-sky-600 dark:text-slate-300 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                      title={t('floatingMap.fullTooltip')}
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMapDisplayModeChange('icon')}
                      className="p-1.5 text-slate-500 hover:text-rose-500 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                      title={t('floatingMap.closeTooltip')}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <GeoMapView
                    articles={currentTimeline?.articles || []}
                    lanes={currentTimeline?.lanes || []}
                    selectedArticleId={selectedArticle?.id}
                    onSelectArticle={handleFocusArticle}
                    theme={theme}
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
                  className={`group relative w-full h-3.5 flex items-center justify-center cursor-row-resize bg-slate-200/90 dark:bg-slate-800/90 border-y border-slate-300 dark:border-slate-700 hover:bg-sky-500/20 dark:hover:bg-sky-500/30 transition-colors shrink-0 z-30 select-none ${
                    isDraggingSplit ? 'bg-sky-500/30 dark:bg-sky-500/40 ring-1 ring-sky-500/60' : ''
                  }`}
                  title={t('floatingMap.resizeTooltip')}
                >
                  {/* Visual Grip pill */}
                  <div className="flex items-center gap-1 px-3 py-0.5 rounded-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 shadow-2xs group-hover:border-sky-400 group-hover:scale-105 transition-all pointer-events-none">
                    <div className="w-6 h-1 rounded-full bg-slate-400 dark:bg-slate-500 group-hover:bg-sky-500 transition-colors" />
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
                    selectedArticleId={selectedArticle?.id}
                    starredArticleIds={starredArticleIds}
                    onToggleStar={handleToggleStar}
                    theme={theme}
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
                  selectedArticleId={selectedArticle?.id}
                  starredArticleIds={starredArticleIds}
                  onToggleStar={handleToggleStar}
                  theme={theme}
                />

                {/* Floating Map Widget (Icon | PiP | Full) */}
                <FloatingMapWidget
                  articles={currentTimeline?.articles || []}
                  lanes={currentTimeline?.lanes || []}
                  selectedArticleId={selectedArticle?.id}
                  onSelectArticle={handleFocusArticle}
                  theme={theme}
                  mapMode={mapDisplayMode}
                  onModeChange={handleMapDisplayModeChange}
                />
              </>
            )
          )
        ) : (
          <div className="w-full h-full overflow-y-auto flex flex-col items-center text-center justify-center p-4 sm:p-6 pb-20 select-none animate-in fade-in duration-300 home-screen-bg">
            {/* Hero Branding & Welcome */}
            <div className="mb-1 transition-transform duration-300 hover:scale-105">
                <ChroniXLogo size="xl" className="w-auto drop-shadow-md" />
              </div>
              <div className="space-y-1.5 flex flex-col items-center">
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight font-sans drop-shadow-xs">
                  {t('home.title')}
                </h2>
                <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-200 max-w-lg leading-relaxed font-sans font-medium drop-shadow-xs">
                  {t('home.subtitle')}
                </p>
            </div>

            {/* User Guide & Multilingual Tip Banners on Home Screen */}
            <div className="pt-2 pb-1 flex flex-wrap items-center justify-center gap-2 max-w-xl">
              <button
                type="button"
                id="home-open-user-guide-btn"
                onClick={() => setIsUserGuideOpen(true)}
                className="group inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/90 dark:bg-slate-900/90 hover:bg-sky-50 dark:hover:bg-slate-800 border border-slate-200/90 dark:border-slate-800 hover:border-sky-300 dark:hover:border-sky-700 text-slate-700 dark:text-slate-300 hover:text-sky-600 dark:hover:text-sky-400 text-xs font-semibold shadow-xs hover:shadow-md transition-all duration-200 hover:scale-[1.02] active:scale-95 cursor-pointer backdrop-blur-md"
              >
                <BookOpen className="w-3.5 h-3.5 text-sky-500 group-hover:rotate-6 transition-transform" />
                <span>{t('home.exploreGuide')}</span>
                <ArrowRight className="w-3 h-3 text-slate-400 group-hover:text-sky-500 group-hover:translate-x-0.5 transition-all" />
              </button>
              {t('home.multilingualTip') && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 text-[11px] font-medium text-slate-600 dark:text-slate-300 backdrop-blur-md shadow-2xs">
                  <Globe className="w-3 h-3 text-sky-500 shrink-0" />
                  <span>{t('home.multilingualTip')}</span>
                </div>
              )}
            </div>

            {/* Prompt Cards (Simple & Complex) */}
            <PromptExamples
              onSelectPrompt={handleSelectPrompt}
              isGenerating={isLoading}
            />
          </div>
        )}

        {/* Selected Article Detail Drawer */}
        {selectedArticle && (
          <ErrorBoundary
            onReset={() => setSelectedArticle(null)}
            fallback={(err, reset) => (
              <div className="fixed bottom-6 right-6 z-50 bg-rose-900/95 text-white p-4 rounded-xl shadow-2xl flex items-center gap-3 text-xs border border-rose-700 backdrop-blur-md">
                <span>Failed to display event details: {err?.message}</span>
                <button
                  onClick={reset}
                  className="bg-white/20 hover:bg-white/30 px-2 py-1 rounded text-white font-medium cursor-pointer"
                >
                  {t('common.close')}
                </button>
              </div>
            )}
          >
            <EventDrawer
              article={selectedArticle}
              lanes={currentTimeline?.lanes || []}
              isStarred={selectedArticle ? starredArticleIds.has(selectedArticle.id) : false}
              onToggleStar={handleToggleStar}
              onClose={() => setSelectedArticle(null)}
              onEdit={(art) => {
                setEventBeingEdited(art);
                setIsEventEditOpen(true);
              }}
              onDelete={handleDeleteEvent}
              onOpenDisclaimer={() => setIsDisclaimerModalOpen(true)}
            />
          </ErrorBoundary>
        )}

        {/* Floating Generation Status Pill with Stop Button */}
        {isLoading && (
          <div className={`fixed ${isMobile ? 'bottom-16' : 'bottom-12'} left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-white/95 dark:bg-slate-900/95 border border-slate-200/90 dark:border-slate-700/90 pl-4 pr-2 py-1.5 rounded-full shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-4 duration-200 select-none`}>
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-500 shrink-0" />
              <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                {t('app.generatingChronology')}
              </span>
            </div>
            <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" />
            <button
              type="button"
              onClick={handleStopGenerate}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 text-xs font-semibold border border-rose-200/80 dark:border-rose-800/80 transition-all cursor-pointer active:scale-95 shadow-2xs group"
              title={t('toolbar.stopGenerateBtn')}
            >
              <Square className="w-2.5 h-2.5 fill-current text-rose-500 group-hover:scale-110 transition-transform" />
              <span>{t('app.stopGenerate')}</span>
            </button>
          </div>
        )}
      </main>

      {/* Bottom AI Disclaimer Bar (hidden on mobile when timeline is active to leave room for MobileNavBar) */}
      {(!isMobile || !currentTimeline) && (
        <AiDisclaimerBar onOpenModal={() => setIsDisclaimerModalOpen(true)} />
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

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        quota={quota}
        onRefreshQuota={refreshQuota}
      />

      <QuotaModal
        isOpen={isQuotaModalOpen}
        onClose={() => setIsQuotaModalOpen(false)}
        quota={quota}
        onOpenSettings={() => setIsSettingsOpen(true)}
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
          setIsUserGuideOpen(true);
        }}
      />

      <UserGuideModal
        isOpen={isUserGuideOpen}
        onClose={() => setIsUserGuideOpen(false)}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />
    </div>
  );
}

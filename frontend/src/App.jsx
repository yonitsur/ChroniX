import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import { toPng } from 'html-to-image';
import Toolbar from './components/Toolbar';
import TimelineView from './components/TimelineView';
import GeoMapView from './components/GeoMapView';
import EventDrawer from './components/EventDrawer';
import CardsListDrawer from './components/CardsListDrawer';
import EventEditModal from './components/EventEditModal';
import AiRefineModal from './components/AiRefineModal';
import SavedTimelinesModal from './components/SavedTimelinesModal';
import SettingsModal from './components/SettingsModal';
import AiDisclaimerModal from './components/AiDisclaimerModal';
import AiDisclaimerBar from './components/AiDisclaimerBar';
import FloatingCardsButton from './components/FloatingCardsButton';
import AuthModal from './components/AuthModal';
import AuthGate from './components/AuthGate';
import { useAuth } from './context/AuthContext';
import ChroniXLogo from './components/ChroniXLogo';
import PromptExamples from './components/PromptExamples';
import { FolderOpen, AlertTriangle, Loader2, MapPin } from 'lucide-react';

import {
  generateTimeline,
  refineTimeline,
  fetchTimeline,
  saveTimeline,
  getApiKey
} from './api';

export default function App() {
  const { user, loading: authLoading } = useAuth();
  const [currentTimeline, setCurrentTimeline] = useState(null);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [activePrompt, setActivePrompt] = useState('');
  const [activeDetailLevel, setActiveDetailLevel] = useState('standard');

  // View Mode ('timeline' | 'split' | 'map')
  const [viewMode, setViewMode] = useState(() => {
    try {
      const saved = localStorage.getItem('vt_view_mode');
      if (saved === 'timeline' || saved === 'split' || saved === 'map') return saved;
      return 'split';
    } catch (e) {
      return 'split';
    }
  });

  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('vt_view_mode', mode);
    } catch (e) {}
  };

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
  const [isCardsListOpen, setIsCardsListOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const timelineRef = useRef(null);

  if (authLoading) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-950 text-white gap-3 select-none">
        <div className="relative flex items-center justify-center">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
          </div>
        </div>
        <span className="text-xs text-slate-400 font-medium tracking-wide">Starting ChroniX...</span>
      </div>
    );
  }

  if (!user) {
    return <AuthGate />;
  }

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
    setIsLoading(true);
    setErrorMessage(null);
    setSelectedArticle(null);

    try {
      const data = await generateTimeline(prompt, detailLevel);
      setCurrentTimeline(data);
      triggerCelebration();
    } catch (err) {
      console.error('Generation failed:', err);
      setErrorMessage(err.message || 'Failed to generate timeline');
      if (err.message && err.message.includes('API Key')) {
        setIsSettingsOpen(true);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Handle prompt card selection from home screen
  const handleSelectPrompt = (promptText, detailLevel = 'standard') => {
    setActivePrompt(promptText);
    setActiveDetailLevel(detailLevel);
    handleGenerate(promptText, detailLevel);
  };

  // Handle refinement with AI
  const handleRefine = async (instruction) => {
    if (!currentTimeline) return;
    setIsRefining(true);
    setErrorMessage(null);

    try {
      const updated = await refineTimeline(currentTimeline, instruction);
      setCurrentTimeline({ ...updated });
      setIsAiRefineOpen(false);
      triggerCelebration();
    } catch (err) {
      console.error('Refinement failed:', err);
      setErrorMessage(err.message || 'Failed to refine timeline');
    } finally {
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
    if (!confirm('Are you sure you want to delete this event?')) return;

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
          alert('Failed to export image: ' + err.message);
        });
    }
  };

  const handleSelectTimeline = async (id) => {
    try {
      const data = await fetchTimeline(id);
      setCurrentTimeline(data);
      setSelectedArticle(null);
    } catch (err) {
      alert('Failed to load timeline: ' + err.message);
    }
  };

  const handleImportJson = async (imported) => {
    setCurrentTimeline(imported);
    setSelectedArticle(null);
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
  };

  // Focus and select article from cards list
  const handleFocusArticle = (article) => {
    setSelectedArticle(article);
    timelineRef.current?.focusArticle(article.id);
  };

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
        isGenerating={isLoading}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onGenerate={handleGenerate}
        onClearBoard={handleClearBoard}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        activePrompt={activePrompt}
        activeDetailLevel={activeDetailLevel}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
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
        {/* Floating Left Edge Toggle for Cards List when closed and cards exist */}
        {currentTimeline?.articles?.length > 0 && !isCardsListOpen && (
          <FloatingCardsButton
            count={currentTimeline.articles.length}
            onClick={() => setIsCardsListOpen(true)}
          />
        )}

        {/* Cards List Drawer (Left Panel) */}
        <CardsListDrawer
          isOpen={isCardsListOpen}
          onClose={() => setIsCardsListOpen(false)}
          articles={currentTimeline?.articles || []}
          lanes={currentTimeline?.lanes || []}
          selectedArticleId={selectedArticle?.id}
          onSelectArticle={handleFocusArticle}
        />

        {currentTimeline ? (
          viewMode === 'map' ? (
            <GeoMapView
              articles={currentTimeline?.articles || []}
              lanes={currentTimeline?.lanes || []}
              selectedArticleId={selectedArticle?.id}
              onSelectArticle={handleFocusArticle}
              theme={theme}
              className="w-full h-full"
            />
          ) : viewMode === 'split' ? (
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
                title="גרור כדי לשנות את גודל המפה וציר הזמן • לחץ פעמיים לאיפוס חצי-חצי (50%)"
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
                  onSelectArticle={(article) => setSelectedArticle(article)}
                  selectedArticleId={selectedArticle?.id}
                  theme={theme}
                />
              </div>
            </div>
          ) : (
            <TimelineView
              ref={timelineRef}
              timelineData={currentTimeline}
              onSelectArticle={(article) => setSelectedArticle(article)}
              selectedArticleId={selectedArticle?.id}
              theme={theme}
            />
          )
        ) : (
          <div className="w-full h-full overflow-y-auto flex flex-col items-center p-4 sm:p-6 pb-24 select-none animate-in fade-in duration-300">
            {/* Hero Branding & Welcome */}
            <div className="max-w-xl flex flex-col items-center gap-3 text-center mb-2">
              <div className="mb-1 transition-transform duration-300 hover:scale-105">
                <ChroniXLogo size="xl" className="w-auto drop-shadow-sm" />
              </div>
              <div className="space-y-1.5 flex flex-col items-center">
                <h2 className="text-lg sm:text-xl font-bold text-slate-800 dark:text-slate-100 tracking-tight">
                  Discover and build interactive timelines
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md leading-relaxed">
                  Type a topic in the search bar above, or click one of the example cards to get started:
                </p>
                <div className="mx-auto flex items-center justify-center text-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300/90 bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/20 rounded-xl px-3 py-1.5 max-w-md">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>AI models synthesize dates and events. Minor inaccuracies may occur; verifying key facts is recommended.</span>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap justify-center">
                <button
                  type="button"
                  onClick={() => setIsSavedModalOpen(true)}
                  className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-medium bg-white dark:bg-slate-800/90 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shadow-xs hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition-all active:scale-95 cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4 text-amber-500" />
                  <span>Saved Timelines</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectTimeline('sample-us-presidents')}
                  className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white shadow-sm transition-all active:scale-95 cursor-pointer"
                  title="Open live Geo-Timeline demo with map and Google Maps links"
                >
                  <MapPin className="w-3.5 h-3.5 text-rose-300 animate-pulse" />
                  <span>🗺️ Geo-Timeline Demo</span>
                </button>
              </div>
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
          <EventDrawer
            article={selectedArticle}
            lanes={currentTimeline?.lanes || []}
            onClose={() => setSelectedArticle(null)}
            onEdit={(art) => {
              setEventBeingEdited(art);
              setIsEventEditOpen(true);
            }}
            onDelete={handleDeleteEvent}
            onOpenDisclaimer={() => setIsDisclaimerModalOpen(true)}
          />
        )}
      </main>

      {/* Bottom AI Disclaimer Bar */}
      <AiDisclaimerBar onOpenModal={() => setIsDisclaimerModalOpen(true)} />

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
      />

      <AiRefineModal
        isOpen={isAiRefineOpen}
        onClose={() => setIsAiRefineOpen(false)}
        onRefine={handleRefine}
        isLoading={isRefining}
        currentTimelineTitle={currentTimeline?.title}
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
      />

      <AiDisclaimerModal
        isOpen={isDisclaimerModalOpen}
        onClose={() => setIsDisclaimerModalOpen(false)}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />
    </div>
  );
}

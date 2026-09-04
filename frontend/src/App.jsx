import React, { useState, useEffect, useRef } from 'react';
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
import AiDisclaimerBar from './components/AiDisclaimerBar';
import FloatingCardsButton from './components/FloatingCardsButton';
import AuthModal from './components/AuthModal';
import AuthGate from './components/AuthGate';
import { useAuth } from './context/AuthContext';
import ChroniXLogo from './components/ChroniXLogo';
import PromptExamples from './components/PromptExamples';
import FloatingMapWidget from './components/FloatingMapWidget';
import { FolderOpen, AlertTriangle, Loader2, MapPin, Maximize2, Minimize2, X, Columns2 } from 'lucide-react';

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

  // Map Display Mode ('icon' | 'pip' | 'split' | 'full')
  const [mapDisplayMode, setMapDisplayMode] = useState(() => {
    try {
      const saved = localStorage.getItem('chronix_map_mode');
      if (saved === 'icon' || saved === 'pip' || saved === 'split' || saved === 'full') return saved;
      // Default to 'icon' (Timeline full, floating globe button in bottom-right)
      return 'icon';
    } catch (e) {
      return 'icon';
    }
  });

  const handleMapDisplayModeChange = (mode) => {
    setMapDisplayMode(mode);
    try {
      localStorage.setItem('chronix_map_mode', mode);
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
    setActivePrompt(prompt);
    if (detailLevel) setActiveDetailLevel(detailLevel);
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
      if (data?.title) {
        setActivePrompt(data.title);
      }
    } catch (err) {
      alert('Failed to load timeline: ' + err.message);
    }
  };

  const handleImportJson = async (imported) => {
    setCurrentTimeline(imported);
    setSelectedArticle(null);
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
    setActivePrompt('');
    setActiveDetailLevel('standard');
  };

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
                    title="Switch to Picture-in-Picture (PiP)"
                  >
                    <Minimize2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMapDisplayModeChange('full')}
                    className="p-1.5 text-slate-600 hover:text-sky-600 dark:text-slate-300 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                    title="Full Screen"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMapDisplayModeChange('icon')}
                    className="p-1.5 text-slate-500 hover:text-rose-500 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                    title="Close split and return to timeline"
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
                title="Drag to resize map & timeline • Double-click to reset 50/50"
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
        ) : (
          <div className="w-full h-full overflow-y-auto flex flex-col items-center justify-center p-4 sm:p-6 pb-20 select-none animate-in fade-in duration-300">
            {/* Hero Branding & Welcome */}
            <div className="max-w-xl flex flex-col items-center gap-3.5 text-center mb-4">
              <div className="mb-1 transition-transform duration-300 hover:scale-105">
                <ChroniXLogo size="xl" className="w-auto drop-shadow-sm" />
              </div>
              <div className="space-y-1.5 flex flex-col items-center">
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight font-sans">
                  Discover and explore interactive chronologies
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-lg leading-relaxed font-sans">
                  Enter any historical epoch, scientific revolution, or biographical journey above — or select an exhibition below to begin:
                </p>
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap justify-center">
                <button
                  type="button"
                  onClick={() => setIsSavedModalOpen(true)}
                  className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 shadow-2xs hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-all active:scale-95 cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                  <span>Saved Timelines</span>
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
          <ErrorBoundary
            onReset={() => setSelectedArticle(null)}
            fallback={(err, reset) => (
              <div className="fixed bottom-6 right-6 z-50 bg-rose-900/95 text-white p-4 rounded-xl shadow-2xl flex items-center gap-3 text-xs border border-rose-700 backdrop-blur-md">
                <span>Failed to display event details: {err?.message}</span>
                <button
                  onClick={reset}
                  className="bg-white/20 hover:bg-white/30 px-2 py-1 rounded text-white font-medium cursor-pointer"
                >
                  Close
                </button>
              </div>
            )}
          >
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
          </ErrorBoundary>
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

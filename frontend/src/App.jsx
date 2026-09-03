import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import { toPng } from 'html-to-image';
import Toolbar from './components/Toolbar';
import TimelineView from './components/TimelineView';
import EventDrawer from './components/EventDrawer';
import CardsListDrawer from './components/CardsListDrawer';
import EventEditModal from './components/EventEditModal';
import AiRefineModal from './components/AiRefineModal';
import SavedTimelinesModal from './components/SavedTimelinesModal';
import SettingsModal from './components/SettingsModal';
import AiDisclaimerModal from './components/AiDisclaimerModal';
import AiDisclaimerBar from './components/AiDisclaimerBar';
import FloatingCardsButton from './components/FloatingCardsButton';
import { Sparkles, FolderOpen, AlertTriangle } from 'lucide-react';

import {
  generateTimeline,
  refineTimeline,
  fetchTimeline,
  saveTimeline,
  getApiKey
} from './api';

export default function App() {
  const [currentTimeline, setCurrentTimeline] = useState(null);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

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
        isCardsListOpen={isCardsListOpen}
        onToggleCardsList={() => setIsCardsListOpen((prev) => !prev)}
        onClearBoard={handleClearBoard}
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
          <TimelineView
            ref={timelineRef}
            timelineData={currentTimeline}
            onSelectArticle={(article) => setSelectedArticle(article)}
            selectedArticleId={selectedArticle?.id}
            theme={theme}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center select-none">
            <div className="max-w-md flex flex-col items-center gap-4 animate-in fade-in duration-300">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-sky-500/10 via-blue-500/20 to-indigo-500/10 dark:from-sky-400/20 dark:to-indigo-500/20 border border-sky-200 dark:border-sky-800/60 flex items-center justify-center shadow-inner">
                <Sparkles className="w-8 h-8 text-sky-500 dark:text-sky-400" />
              </div>
              <div className="space-y-2 flex flex-col items-center">
                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
                  Ready to explore history
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                  Type a topic or historical era in the search bar above to generate a new interactive timeline, or open a saved one.
                </p>
                <div className="mx-auto flex items-center justify-center text-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300/90 bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/20 rounded-xl px-3 py-1.5 max-w-sm">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>AI models synthesize events and dates, which may contain inaccuracies. Verify key facts.</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSavedModalOpen(true)}
                className="mt-2 flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-white dark:bg-slate-800/90 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shadow-xs hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition-all active:scale-95 cursor-pointer"
              >
                <FolderOpen className="w-4 h-4 text-amber-500" />
                <span>Open Saved Timelines</span>
              </button>
            </div>
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
    </div>
  );
}

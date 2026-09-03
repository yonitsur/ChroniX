import React, { useState, useEffect, useRef } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Sparkles,
  PlusCircle,
  FolderOpen,
  Download,
  Key,
  Layers,
  Calendar,
  Sun,
  Moon,
  Loader2,
  ArrowRight,
  HelpCircle,
  AlertTriangle,
  LayoutList,
  Trash2,
  ChevronDown,
  SlidersHorizontal,
  Check
} from 'lucide-react';
import ChroniXLogo from './ChroniXLogo';

const DETAIL_LEVEL_OPTIONS = [
  {
    id: 'overview',
    label: 'Overview',
    description: '~10-15 landmark events'
  },
  {
    id: 'standard',
    label: 'Standard',
    description: '~20-30 balanced events'
  },
  {
    id: 'deep_dive',
    label: 'Deep',
    description: '~35-50 granular events'
  }
];

const SUGGESTIONS = [
  "Presidents of the United States",
  "Empires",
  "Dinosaurs & Mesozoic Eras",
  "World War II Key Events",
  "Human Evolution & Early Hominids",
  "History of Artificial Intelligence",
  "Space Race & Moon Missions",
  "Rise & Fall of the Roman Empire",
  "Ancient Egypt & Pharaohs",
  "History of Aviation & Flight",
  "Renaissance Masters & Art Movements",
  "Evolution of Video Game Consoles",
  "Timeline of the Universe (Big Bang to Now)"
];

const LOADING_STEPS = [
  "Consulting Gemini AI...",
  "Structuring chronology & swimlanes...",
  "Fetching verified Wikimedia Commons images...",
  "Loading articles into Histropedia engine..."
];

export default function Toolbar({
  timelineData,
  onZoomIn,
  onZoomOut,
  onFitAll,
  onOpenRefine,
  onAddEvent,
  onOpenSaved,
  onExportJson,
  onExportImage,
  onOpenSettings,
  onOpenDisclaimer,
  isGenerating,
  theme = 'light',
  onToggleTheme,
  onGenerate,
  isCardsListOpen = false,
  onToggleCardsList,
  onClearBoard
}) {
  const isDark = theme === 'dark';
  const [prompt, setPrompt] = useState('');
  const [detailLevel, setDetailLevel] = useState('standard');
  const [isDetailDropdownOpen, setIsDetailDropdownOpen] = useState(false);
  const detailDropdownRef = useRef(null);
  const [loadingStepIdx, setLoadingStepIdx] = useState(0);
  const [showExamples, setShowExamples] = useState(true);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (detailDropdownRef.current && !detailDropdownRef.current.contains(e.target)) {
        setIsDetailDropdownOpen(false);
      }
    };
    if (isDetailDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDetailDropdownOpen]);

  const activeDetailOption =
    DETAIL_LEVEL_OPTIONS.find((opt) => opt.id === detailLevel) || DETAIL_LEVEL_OPTIONS[1];

  useEffect(() => {
    let interval;
    if (isGenerating) {
      setLoadingStepIdx(0);
      interval = setInterval(() => {
        setLoadingStepIdx((prev) => (prev + 1) % LOADING_STEPS.length);
      }, 2200);
    }
    return () => clearInterval(interval);
  }, [isGenerating]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;
    if (onGenerate) {
      onGenerate(prompt.trim(), detailLevel);
    }
  };

  const handleChipClick = (suggestion) => {
    setPrompt(suggestion);
    if (onGenerate) {
      onGenerate(suggestion, detailLevel);
    }
  };

  return (
    <div className="relative w-full bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 z-20 select-none transition-colors">
      {/* Top Row: Left branding | Center search box | Right tools */}
      <div className="px-3 sm:px-4 py-2 flex flex-wrap xl:flex-nowrap items-center justify-between gap-2 sm:gap-3 text-slate-700 dark:text-slate-200">
        {/* Left: Branding & Info */}
        <div className="flex items-center gap-3 shrink-0 min-w-0">
          <div className="flex items-center gap-2.5">
            <ChroniXLogo className="h-10 sm:h-11 w-auto transition-transform hover:scale-105" />
            {timelineData?.title && timelineData.title !== 'ChroniX' ? (
              <div className="hidden sm:block pl-2.5 border-l border-slate-300 dark:border-slate-700">
                <h1 className="font-semibold text-xs sm:text-sm text-slate-800 dark:text-slate-200 truncate max-w-[130px] xl:max-w-xs" title={timelineData.title}>
                  {timelineData.title}
                </h1>
                <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-sky-500 dark:text-sky-400" />
                    {timelineData?.articles?.length || 0} events
                  </span>
                  {timelineData?.lanes?.length > 0 && (
                    <>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Layers className="w-3 h-3 text-indigo-500 dark:text-indigo-400" />
                        {timelineData.lanes.length} lanes
                      </span>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="hidden sm:block pl-2 border-l border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-sky-500 dark:text-sky-400" />
                  {timelineData?.articles?.length || 0} events
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Center: Search / Prompt Form (Prominent in top row) */}
        <form
          onSubmit={handleSubmit}
          className="flex-1 max-w-2xl min-w-[260px] mx-1 sm:mx-2 order-last xl:order-none w-full xl:w-auto"
        >
          <div className="relative flex items-center bg-slate-100/90 dark:bg-slate-800/90 hover:bg-slate-100 dark:hover:bg-slate-800 focus-within:bg-white dark:focus-within:bg-slate-900 border border-slate-300/80 dark:border-slate-700/80 focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/20 rounded-xl px-2.5 py-1 transition-all shadow-2xs">
            <div className="text-slate-400 dark:text-slate-400 pr-1.5 flex items-center shrink-0">
              {isGenerating ? (
                <Loader2 className="w-4 h-4 animate-spin text-sky-500 dark:text-sky-400" />
              ) : (
                <Sparkles className="w-4 h-4 text-sky-500 dark:text-sky-400" />
              )}
            </div>

            <input
              type="text"
              dir="auto"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isGenerating}
              placeholder={
                isGenerating
                  ? LOADING_STEPS[loadingStepIdx]
                  : "Enter timeline topic"
              }
              className="flex-1 min-w-0 bg-transparent text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 text-xs sm:text-sm outline-none font-medium py-1 px-1"
            />

            {/* Detail Level Dropdown */}
            <div className="relative shrink-0" ref={detailDropdownRef}>
              <button
                type="button"
                onClick={() => setIsDetailDropdownOpen((prev) => !prev)}
                disabled={isGenerating}
                className="flex items-center gap-1.5 bg-slate-200/80 dark:bg-slate-700/70 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 px-2 py-1 rounded-lg border border-slate-300/70 dark:border-slate-600/60 text-xs font-semibold transition-all mr-1.5 shadow-2xs active:scale-95"
                title={`Detail level: ${activeDetailOption.label} (${activeDetailOption.description})`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400 shrink-0" />
                <span>{activeDetailOption.label}</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-slate-400 dark:text-slate-400 transition-transform duration-200 ${
                    isDetailDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {isDetailDropdownOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-56 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-2 py-1 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    Detail Level
                  </div>
                  {DETAIL_LEVEL_OPTIONS.map((opt) => {
                    const isSelected = detailLevel === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setDetailLevel(opt.id);
                          setIsDetailDropdownOpen(false);
                        }}
                        className={`w-full text-left flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                          isSelected
                            ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 font-semibold'
                            : 'hover:bg-slate-100 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <div className="flex flex-col text-left">
                          <span className="font-medium text-xs text-slate-900 dark:text-slate-100">
                            {opt.label}
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-normal">
                            {opt.description}
                          </span>
                        </div>
                        {isSelected && (
                          <Check className="w-4 h-4 text-sky-500 dark:text-sky-400 shrink-0 ml-2" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={!prompt.trim() || isGenerating}
              className="flex items-center gap-1 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-3 py-1.5 rounded-lg shadow-sm transition-all active:scale-95 text-xs shrink-0"
            >
              <span>{isGenerating ? 'Creating...' : 'Generate'}</span>
              {!isGenerating && <ArrowRight className="w-3.5 h-3.5" />}
            </button>
          </div>
        </form>

        {/* Right: Actions */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 flex-wrap">
          {/* Zoom Controls */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 rounded-xl p-0.5 border border-slate-200 dark:border-slate-700/60 shadow-xs">
            <button
              type="button"
              onClick={onZoomIn}
              className="p-1.5 hover:bg-white dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onZoomOut}
              className="p-1.5 hover:bg-white dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onFitAll}
              className="p-1.5 hover:bg-white dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors"
              title="Fit All Articles"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>

          <div className="h-5 w-px bg-slate-200 dark:bg-slate-800 mx-0.5 hidden xl:block" />

          {/* AI Refine Button */}
          <button
            type="button"
            disabled={isGenerating || !timelineData}
            onClick={onOpenRefine}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1.5 rounded-xl text-xs font-medium shadow-sm transition-all disabled:opacity-50 active:scale-95"
            title="Refine timeline using AI instructions"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
            <span className="hidden xl:inline">Refine AI</span>
          </button>

          {/* Add Event Button */}
          <button
            type="button"
            disabled={!timelineData}
            onClick={onAddEvent}
            className="flex items-center gap-1 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white px-2.5 py-1.5 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-700 shadow-xs transition-all disabled:opacity-50"
            title="Add Event"
          >
            <PlusCircle className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
            <span className="hidden xl:inline">Add</span>
          </button>

          {/* Cards List Panel Toggle Button */}
          <button
            type="button"
            disabled={!timelineData || !timelineData.articles || timelineData.articles.length === 0}
            onClick={onToggleCardsList}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border shadow-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
              isCardsListOpen
                ? 'bg-sky-50 dark:bg-sky-950/70 border-sky-400 dark:border-sky-600 text-sky-700 dark:text-sky-300 ring-2 ring-sky-500/20'
                : 'bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white border-slate-200 dark:border-slate-700'
            }`}
            title={isCardsListOpen ? 'Close Cards List' : 'Open Cards List'}
          >
            <LayoutList className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
            <span className="hidden sm:inline">Cards</span>
            {timelineData?.articles?.length > 0 && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                isCardsListOpen
                  ? 'bg-sky-200 dark:bg-sky-800 text-sky-900 dark:text-sky-100'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
              }`}>
                {timelineData.articles.length}
              </span>
            )}
          </button>

          {/* Clear Board Button */}
          <button
            type="button"
            disabled={!timelineData}
            onClick={() => {
              if (!timelineData) return;
              if (window.confirm('Are you sure you want to clear the board? All unsaved events will be deleted.')) {
                onClearBoard?.();
              }
            }}
            className="flex items-center gap-1 bg-white dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-700 dark:text-slate-200 hover:text-rose-600 dark:hover:text-rose-300 px-2 py-1.5 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-700 hover:border-rose-300 dark:hover:border-rose-800 shadow-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            title="Clear Board"
          >
            <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-rose-500 transition-colors" />
            <span className="hidden xl:inline">Clear</span>
          </button>

          {/* Saved Timelines */}
          <button
            type="button"
            onClick={onOpenSaved}
            className="flex items-center gap-1 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white px-2.5 py-1.5 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-700 shadow-xs transition-all"
            title="Saved Timelines"
          >
            <FolderOpen className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
            <span className="hidden xl:inline">Saved</span>
          </button>

          {/* Export Buttons */}
          <div className="flex items-center bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-xs shadow-xs">
            <button
              type="button"
              onClick={onExportJson}
              disabled={!timelineData}
              className="px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors disabled:opacity-50"
              title="Download Timeline as JSON"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onExportImage}
              disabled={!timelineData}
              className="px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors border-l border-slate-200 dark:border-slate-700 disabled:opacity-50 text-[11px] font-medium"
              title="Export Snapshot Image"
            >
              Img
            </button>
          </div>

          {/* AI Disclaimer Button */}
          <button
            type="button"
            onClick={onOpenDisclaimer}
            className="p-1.5 bg-white dark:bg-slate-800 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-amber-300 dark:hover:border-amber-800 shadow-xs transition-colors"
            title="AI Disclaimer"
          >
            <AlertTriangle className="w-4 h-4" />
          </button>

          {/* Settings Button */}
          <button
            type="button"
            onClick={onOpenSettings}
            className="p-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs transition-colors"
            title="API Key Settings"
          >
            <Key className="w-4 h-4 text-sky-500 dark:text-sky-400" />
          </button>

          {/* Light / Dark Mode Toggle Button */}
          <button
            type="button"
            onClick={onToggleTheme}
            className="p-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs transition-all active:scale-95"
            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {isDark ? (
              <Sun className="w-4 h-4 text-amber-400 hover:rotate-45 transition-transform" />
            ) : (
              <Moon className="w-4 h-4 text-indigo-600 hover:-rotate-12 transition-transform" />
            )}
          </button>

          {/* Toggle Examples Button */}
          <button
            type="button"
            onClick={() => setShowExamples((prev) => !prev)}
            className={`px-2 py-1.5 rounded-xl border text-xs font-medium transition-colors flex items-center gap-1 shadow-xs ${
              showExamples
                ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
            title={showExamples ? 'Hide suggestions row' : 'Show suggestions row'}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span className="hidden 2xl:inline">Examples</span>
          </button>
        </div>
      </div>

      {/* Row 2: Examples / Suggestions Sub-row (fixed at top, not floating over canvas) */}
      {showExamples && (
        <div className="px-3 sm:px-4 py-1.5 bg-slate-50/90 dark:bg-slate-900/60 border-t border-slate-200/80 dark:border-slate-800/80 flex items-center gap-1.5 overflow-x-auto text-xs no-scrollbar">
          <span className="text-slate-500 dark:text-slate-400 shrink-0 font-medium mr-1 flex items-center gap-1 text-[11px]">
            <span>Examples:</span>
          </span>
          {SUGGESTIONS.map((item) => (
            <button
              key={item}
              type="button"
              disabled={isGenerating}
              onClick={() => handleChipClick(item)}
              className="shrink-0 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700/60 shadow-2xs rounded-full px-2.5 py-0.5 transition-all hover:border-slate-400 dark:hover:border-slate-500 text-xs"
            >
              {item}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowExamples(false)}
            className="ml-auto text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs shrink-0 px-1 py-0.5 rounded hover:bg-slate-200/60 dark:hover:bg-slate-800"
            title="Hide examples row"
          >
            ✕
          </button>
        </div>
      )}

      {/* Loading Progress Bar */}
      {isGenerating && (
        <div className="absolute -bottom-px left-0 right-0 h-[2.5px] bg-slate-200/50 dark:bg-slate-800/60 overflow-hidden pointer-events-none z-30">
          <div className="h-full w-[28%] bg-gradient-to-r from-transparent via-sky-400 via-blue-500 to-transparent rounded-full shadow-[0_0_12px_rgba(56,189,248,0.9)] animate-progress-indeterminate" />
        </div>
      )}
    </div>
  );
}

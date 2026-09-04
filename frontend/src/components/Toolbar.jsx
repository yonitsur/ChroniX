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
  AlertTriangle,
  Trash2,
  ChevronDown,
  SlidersHorizontal,
  Check,
  Dices,
  LogIn,
  LogOut,
  MoreVertical,
  Image as ImageIcon,
  X,
  User as UserIcon
} from 'lucide-react';
import ChroniXLogo from './ChroniXLogo';
import { getRandomSurpriseTopic } from '../data/surpriseTopics';
import { useAuth } from '../context/AuthContext';

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
  onClearBoard,
  onOpenAuth,
  activePrompt,
  activeDetailLevel
}) {
  const isDark = theme === 'dark';
  const { user, logout } = useAuth();
  
  // Dropdown states
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef(null);

  const [isDetailDropdownOpen, setIsDetailDropdownOpen] = useState(false);
  const detailDropdownRef = useRef(null);

  // Close menus on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setIsUserMenuOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target)) {
        setIsMoreMenuOpen(false);
      }
      if (detailDropdownRef.current && !detailDropdownRef.current.contains(event.target)) {
        setIsDetailDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [prompt, setPrompt] = useState(activePrompt || '');

  useEffect(() => {
    setPrompt(activePrompt || '');
  }, [activePrompt]);

  const [detailLevel, setDetailLevel] = useState(activeDetailLevel || 'standard');

  useEffect(() => {
    setDetailLevel(activeDetailLevel || 'standard');
  }, [activeDetailLevel]);
  const [loadingStepIdx, setLoadingStepIdx] = useState(0);
  const [recentSurprises, setRecentSurprises] = useState(() => {
    try {
      const saved = localStorage.getItem('chronix_recent_surprises');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  const handleSurpriseMe = () => {
    if (isGenerating) return;
    const { topic, nextHistory } = getRandomSurpriseTopic(recentSurprises);
    setRecentSurprises(nextHistory);
    try {
      localStorage.setItem('chronix_recent_surprises', JSON.stringify(nextHistory));
    } catch (e) {}
    setPrompt(topic);
    if (onGenerate) {
      onGenerate(topic, detailLevel);
    }
  };

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

  return (
    <header className="relative w-full bg-white/90 dark:bg-slate-950/90 backdrop-blur-xl border-b border-slate-200/80 dark:border-slate-800/80 z-20 select-none transition-colors">
      <div className="px-3 sm:px-4 py-2 flex flex-wrap lg:flex-nowrap items-center justify-between gap-2 lg:gap-4 text-slate-700 dark:text-slate-200">
        
        {/* Left: Branding & Timeline Info (Strictly bounded, never overflows) */}
        <div className="order-1 flex items-center gap-2 sm:gap-3 min-w-0 max-w-[58%] sm:max-w-[62%] lg:max-w-[30%] xl:max-w-[34%] overflow-hidden shrink-0">
          <div className="flex items-center gap-2 min-w-0 w-full overflow-hidden">
            <ChroniXLogo mode="minimal" size="md" className="h-8 sm:h-9 w-auto shrink-0" />
            
            {timelineData?.title && timelineData.title !== 'ChroniX' ? (
              <div className="flex flex-col min-w-0 flex-1 overflow-hidden pl-2 sm:pl-2.5 border-l border-slate-200 dark:border-slate-800">
                <h1
                  className="font-semibold text-xs sm:text-sm text-slate-900 dark:text-slate-100 truncate min-w-0 w-full font-sans tracking-tight"
                  title={timelineData.title}
                >
                  {timelineData.title}
                </h1>
                <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400 min-w-0 truncate">
                  <span className="flex items-center gap-1 shrink-0 font-medium">
                    <Calendar className="w-3 h-3 text-sky-500 dark:text-sky-400" />
                    {timelineData?.articles?.length || 0} events
                  </span>
                  {timelineData?.lanes?.length > 0 && (
                    <>
                      <span className="shrink-0 opacity-40">•</span>
                      <span className="flex items-center gap-1 shrink-0 font-medium">
                        <Layers className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                        {timelineData.lanes.length} lanes
                      </span>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="hidden sm:flex flex-col pl-2.5 border-l border-slate-200 dark:border-slate-800 text-[11px] text-slate-400 dark:text-slate-500 shrink-0">
                <span className="flex items-center gap-1 font-medium tracking-wide">
                  <Calendar className="w-3 h-3 text-sky-500/80 dark:text-sky-400/80" />
                  Visual Chronology
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Right: Core Actions & More Dropdown (Top right on smaller screens, far right on large) */}
        <div className="order-2 lg:order-3 flex items-center gap-1 sm:gap-1.5 shrink-0 ml-auto lg:ml-0">
          {/* Zoom Controls Pill */}
          <div className="flex items-center bg-slate-100/90 dark:bg-slate-900/90 rounded-lg p-0.5 border border-slate-200/90 dark:border-slate-800/90 shadow-2xs">
            <button
              type="button"
              onClick={onZoomIn}
              className="p-1.5 hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white rounded-md transition-colors cursor-pointer"
              title="Zoom In"
              aria-label="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
            <button
              type="button"
              onClick={onZoomOut}
              className="p-1.5 hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white rounded-md transition-colors cursor-pointer"
              title="Zoom Out"
              aria-label="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
            <button
              type="button"
              onClick={onFitAll}
              className="p-1.5 hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white rounded-md transition-colors cursor-pointer"
              title="Fit All Articles"
              aria-label="Fit All Articles"
            >
              <Maximize2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          </div>

          {/* AI Refine Button (when timeline exists) */}
          {timelineData && (
            <button
              type="button"
              disabled={isGenerating}
              onClick={onOpenRefine}
              className="flex items-center gap-1.5 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-2xs transition-all disabled:opacity-50 active:scale-95 cursor-pointer"
              title="Refine timeline using AI instructions"
            >
              <Sparkles className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400 shrink-0" />
              <span className="hidden sm:inline">Refine</span>
            </button>
          )}

          {/* Add Custom Event Button (Quick Access) */}
          {timelineData && (
            <button
              type="button"
              onClick={onAddEvent}
              className="flex items-center gap-1.5 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white px-2 sm:px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-800 shadow-2xs transition-all active:scale-95 cursor-pointer"
              title="Add Custom Event"
              aria-label="Add Custom Event"
            >
              <PlusCircle className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
            </button>
          )}

          {/* Clear / New Board Quick Access Button (when timeline exists) */}
          {timelineData && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Are you sure you want to clear the board and start a new timeline? All unsaved events will be deleted.')) {
                  setPrompt('');
                  onClearBoard?.();
                }
              }}
              className="flex items-center gap-1.5 bg-white dark:bg-slate-900 hover:bg-rose-50/80 dark:hover:bg-rose-950/30 text-slate-700 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 px-2 sm:px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-800 hover:border-rose-200 dark:hover:border-rose-900/50 shadow-2xs transition-all active:scale-95 cursor-pointer group"
              title="Clear Board / New Board"
              aria-label="Clear Board / New Board"
            >
              <Trash2 className="w-3.5 h-3.5 text-slate-400 group-hover:text-rose-500 transition-colors shrink-0" />
            </button>
          )}

          {/* Light / Dark Mode Toggle Button */}
          <button
            type="button"
            onClick={onToggleTheme}
            className="p-1.5 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs transition-all active:scale-95 cursor-pointer"
            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {isDark ? (
              <Sun className="w-4 h-4 text-amber-400 hover:rotate-45 transition-transform" />
            ) : (
              <Moon className="w-4 h-4 text-slate-600 hover:-rotate-12 transition-transform" />
            )}
          </button>

          {/* More Actions Dropdown Menu */}
          <div className="relative" ref={moreMenuRef}>
            <button
              type="button"
              onClick={() => setIsMoreMenuOpen((prev) => !prev)}
              className={`p-1.5 rounded-lg border shadow-2xs transition-all active:scale-95 cursor-pointer ${
                isMoreMenuOpen
                  ? 'bg-slate-100 dark:bg-slate-800 border-slate-400 dark:border-slate-600 text-slate-900 dark:text-white'
                  : 'bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border-slate-200 dark:border-slate-800'
              }`}
              title="More Actions & Settings"
              aria-label="More Actions & Settings"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {isMoreMenuOpen && (
              <div className="absolute right-0 mt-2 w-60 bg-white/95 dark:bg-slate-900/95 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 py-1.5 z-50 text-xs animate-in fade-in zoom-in-95 duration-150 backdrop-blur-xl">
                
                {/* Timeline Actions */}
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  Timeline
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onOpenSaved();
                  }}
                  className="w-full text-left px-3 py-2 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="font-medium">Saved Timelines</span>
                </button>

                <button
                  type="button"
                  disabled={!timelineData}
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onAddEvent();
                  }}
                  className="w-full text-left px-3 py-2 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent transition-colors cursor-pointer"
                >
                  <PlusCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span className="font-medium">Add Custom Event</span>
                </button>

                {/* Export Options */}
                <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  Export
                </div>

                <button
                  type="button"
                  disabled={!timelineData}
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onExportImage();
                  }}
                  className="w-full text-left px-3 py-2 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent transition-colors cursor-pointer"
                >
                  <ImageIcon className="w-4 h-4 text-sky-500 shrink-0" />
                  <span className="font-medium">Export Snapshot (PNG)</span>
                </button>

                <button
                  type="button"
                  disabled={!timelineData}
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onExportJson();
                  }}
                  className="w-full text-left px-3 py-2 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4 text-indigo-500 shrink-0" />
                  <span className="font-medium">Export Data (JSON)</span>
                </button>

                {/* Clear Board option */}
                {timelineData && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      if (window.confirm('Are you sure you want to clear the board? All unsaved events will be deleted.')) {
                        setPrompt('');
                        onClearBoard?.();
                      }
                    }}
                    className="w-full text-left px-3 py-2 flex items-center gap-2.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4 text-rose-500 shrink-0" />
                    <span className="font-medium">Clear Board</span>
                  </button>
                )}

                {/* System Settings & Info */}
                <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  System
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onOpenSettings();
                  }}
                  className="w-full text-left px-3 py-2 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <Key className="w-4 h-4 text-sky-500 shrink-0" />
                  <span className="font-medium">API Key Settings</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onOpenDisclaimer();
                  }}
                  className="w-full text-left px-3 py-2 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="font-medium">AI Accuracy Disclaimer</span>
                </button>
              </div>
            )}
          </div>

          {/* User Auth Profile / Login Button */}
          {user ? (
            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="flex items-center gap-1.5 p-1 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs transition-all cursor-pointer"
                title={user.email}
              >
                {user.user_metadata?.avatar_url || user.user_metadata?.picture ? (
                  <img
                    src={user.user_metadata.avatar_url || user.user_metadata.picture}
                    alt="Avatar"
                    className="w-6 h-6 rounded-lg object-cover"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white text-[11px] font-bold uppercase">
                    {(user.user_metadata?.full_name || user.email || 'U')[0]}
                  </div>
                )}
                <ChevronDown className="w-3 h-3 text-slate-500 dark:text-slate-400 mr-0.5" />
              </button>

              {isUserMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white/95 dark:bg-slate-900/95 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 py-1.5 z-50 text-xs animate-in fade-in zoom-in-95 duration-150 backdrop-blur-xl">
                  <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
                    <p className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                      {user.user_metadata?.full_name || 'User'}
                    </p>
                    <p className="text-slate-500 dark:text-slate-400 truncate text-[11px]">
                      {user.email}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onOpenSaved();
                    }}
                    className="w-full text-left px-3 py-2 flex items-center gap-2 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
                    <span>My Timelines</span>
                  </button>

                  <div className="border-t border-slate-100 dark:border-slate-800 my-1" />

                  <button
                    type="button"
                    onClick={async () => {
                      setIsUserMenuOpen(false);
                      await logout();
                    }}
                    className="w-full text-left px-3 py-2 flex items-center gap-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenAuth}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-800 shadow-2xs transition-all active:scale-95 cursor-pointer"
              title="Sign In with Google, Facebook or Email"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign In</span>
            </button>
          )}
        </div>

        {/* Center: Search / Prompt Form (Full-width row on mobile/tablet, centered on desktop) */}
        <form
          onSubmit={handleSubmit}
          className="order-3 lg:order-2 w-full lg:w-auto lg:flex-1 min-w-0 max-w-2xl mx-auto lg:mx-2"
        >
          <div className="relative flex items-center bg-slate-100/80 dark:bg-slate-900/90 hover:bg-slate-100 dark:hover:bg-slate-900 focus-within:bg-white dark:focus-within:bg-slate-950 border border-slate-200 dark:border-slate-800 focus-within:border-sky-500/80 focus-within:ring-2 focus-within:ring-sky-500/15 rounded-xl px-2 sm:px-2.5 py-1 transition-all shadow-2xs w-full min-w-0">
            
            <div className="text-slate-400 dark:text-slate-400 pl-0.5 pr-1.5 flex items-center shrink-0">
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
              title={prompt || "Enter timeline topic"}
              placeholder={
                isGenerating
                  ? LOADING_STEPS[loadingStepIdx]
                  : "Enter timeline topic (e.g. Ancient Egypt, Space Race, תולדות הציונות)"
              }
              className="flex-1 min-w-0 bg-transparent text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 text-xs sm:text-sm outline-none font-medium py-1 px-1 font-sans"
            />

            {/* Quick Clear Button when text entered */}
            {prompt && !isGenerating && (
              <button
                type="button"
                onClick={() => setPrompt('')}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors shrink-0 mr-1 cursor-pointer"
                title="Clear input"
                aria-label="Clear input"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Detail Level Dropdown */}
            <div className="relative shrink-0" ref={detailDropdownRef}>
              <button
                type="button"
                onClick={() => setIsDetailDropdownOpen((prev) => !prev)}
                disabled={isGenerating}
                className="flex items-center gap-1 bg-white/80 dark:bg-slate-800/80 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold transition-all mr-1 shadow-2xs active:scale-95 cursor-pointer"
                title={`Detail level: ${activeDetailOption.label} (${activeDetailOption.description})`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                <span className="hidden sm:inline">{activeDetailOption.label}</span>
                <ChevronDown
                  className={`w-3 h-3 text-slate-400 transition-transform duration-200 ${
                    isDetailDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {isDetailDropdownOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
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
                        className={`w-full text-left flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-slate-100 dark:bg-slate-800 text-slate-950 dark:text-white font-semibold'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
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
                          <Check className="w-4 h-4 text-sky-500 shrink-0 ml-2" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Surprise Me Button */}
            <button
              type="button"
              onClick={handleSurpriseMe}
              disabled={isGenerating}
              className="flex items-center gap-1 bg-white/80 dark:bg-slate-800/80 hover:bg-amber-50 dark:hover:bg-amber-950/30 text-slate-700 dark:text-slate-300 hover:text-amber-700 dark:hover:text-amber-400 border border-slate-200 dark:border-slate-700 hover:border-amber-300 dark:hover:border-amber-700/60 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed font-medium p-1.5 sm:px-2 rounded-lg shadow-2xs transition-all text-xs shrink-0 mr-1 cursor-pointer group"
              title="Surprise me with a random fascinating timeline topic!"
            >
              <Dices className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 group-hover:rotate-45 transition-transform duration-300 shrink-0" />
            </button>

            {/* Generate Button - Stays firmly inside the prompt container */}
            <button
              type="submit"
              disabled={!prompt.trim() || isGenerating}
              className="flex items-center justify-center bg-sky-600 hover:bg-sky-500 active:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold p-1.5 sm:px-2.5 rounded-lg shadow-xs transition-all active:scale-95 text-xs shrink-0 cursor-pointer"
              title={isGenerating ? "Creating timeline..." : "Generate timeline"}
              aria-label={isGenerating ? "Creating timeline..." : "Generate timeline"}
            >
              {isGenerating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              ) : (
                <ArrowRight className="w-3.5 h-3.5 shrink-0" />
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Loading Progress Bar */}
      {isGenerating && (
        <div className="absolute -bottom-px left-0 right-0 h-[2.5px] bg-slate-200/50 dark:bg-slate-800/60 overflow-hidden pointer-events-none z-30">
          <div className="h-full w-[28%] bg-gradient-to-r from-transparent via-sky-400 via-blue-500 to-transparent rounded-full shadow-[0_0_12px_rgba(56,189,248,0.9)] animate-progress-indeterminate" />
        </div>
      )}
    </header>
  );
}

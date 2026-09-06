import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Sparkles,
  PlusCircle,
  FolderOpen,
  Download,
  Key,
  Sun,
  Moon,
  Loader2,
  ArrowRight,
  AlertTriangle,
  Trash2,
  ChevronDown,
  SlidersHorizontal,
  Check,
  LogIn,
  LogOut,
  MoreVertical,
  Image as ImageIcon,
  X,
  User as UserIcon,
  Square,
  Info,
  BookOpen,
  Languages,
  Zap,
  Star,
  LayoutList,
  Globe,
  Columns2
} from 'lucide-react';
import ChroniXLogo from './ChroniXLogo';
import QuotaBadge from './QuotaBadge';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

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
  onOpenAbout,
  onOpenGuide,
  isGenerating,
  onStopGenerate,
  theme = 'light',
  onToggleTheme,
  onGenerate,
  onClearBoard,
  onGoHome,
  onOpenAuth,
  activePrompt,
  activeDetailLevel,
  quota,
  onOpenQuota,
  filterStarredOnly = false,
  onToggleFilterStarredOnly,
  starredCount = 0,
  isCardsListOpen = false,
  onToggleCardsList,
  mapMode = 'pip',
  onMapModeChange
}) {
  const isDark = theme === 'dark';
  const { user, logout } = useAuth();
  const { language, toggleLanguage, isRtl, t } = useLanguage();
  
  // Dropdown states
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef(null);

  const [isDetailDropdownOpen, setIsDetailDropdownOpen] = useState(false);
  const detailDropdownRef = useRef(null);

  const [isMapMenuOpen, setIsMapMenuOpen] = useState(false);
  const mapMenuRef = useRef(null);

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
      if (mapMenuRef.current && !mapMenuRef.current.contains(event.target)) {
        setIsMapMenuOpen(false);
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

  // Prompt bar expansion & custom width states
  const [isPromptExpanded, setIsPromptExpanded] = useState(() => {
    try {
      return localStorage.getItem('vt_prompt_expanded') === 'true';
    } catch (e) {
      return false;
    }
  });

  const [promptCustomWidth, setPromptCustomWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('vt_prompt_custom_width');
      return saved ? Number(saved) : null;
    } catch (e) {
      return null;
    }
  });

  const formContainerRef = useRef(null);
  const rightControlsRef = useRef(null);
  const toolbarContainerRef = useRef(null);
  const logoRef = useRef(null);

  // Granular one-by-one room detection for top bar controls:
  // refine -> add -> cards -> starred -> map -> zoom -> clear -> quota -> language -> theme
  const [visibleIcons, setVisibleIcons] = useState({
    refine: true,
    add: true,
    cards: true,
    starred: true,
    map: true,
    zoom: true,
    clear: true,
    quota: true,
    language: true,
    theme: true
  });

  const updateRoomAvailability = useCallback((overrideWidth) => {
    if (!toolbarContainerRef.current) return;
    const containerWidth = toolbarContainerRef.current.clientWidth;

    // Mobile viewport (< 768px): prompt is full-width in row 2; row 1 has logo & core controls
    if (containerWidth < 768) {
      setVisibleIcons({
        refine: false,
        add: false,
        cards: false,
        starred: false,
        map: false,
        zoom: false,
        clear: false,
        quota: containerWidth >= 480 && Boolean(user && quota),
        language: containerWidth >= 400,
        theme: containerWidth >= 340
      });
      return;
    }

    const logoWidth = logoRef.current?.offsetWidth || 130;
    // Permanent controls: More Menu (38px with gap) + User Profile / Sign In (52px or 86px with gap)
    const permanentWidth = 38 + (user ? 52 : 86);
    const hasArticles = (timelineData?.articles?.length ?? 0) > 0;
    const hasStarred = starredCount > 0;

    // Ordered list of collapsible items from left to right (first to be removed as prompt expands)
    const collapsibleItems = [
      { id: 'refine', width: 38, isEligible: Boolean(timelineData) },
      { id: 'add', width: 38, isEligible: Boolean(timelineData) },
      { id: 'cards', width: hasArticles ? 60 : 38, isEligible: Boolean(timelineData) },
      { id: 'starred', width: hasStarred ? 56 : 38, isEligible: Boolean(timelineData) },
      { id: 'map', width: 38, isEligible: Boolean(timelineData) },
      { id: 'zoom', width: 104, isEligible: Boolean(timelineData) },
      { id: 'clear', width: 42, isEligible: Boolean(timelineData) },
      { id: 'quota', width: 60, isEligible: Boolean(user && quota) },
      { id: 'language', width: 90, isEligible: true },
      { id: 'theme', width: 38, isEligible: true },
    ];

    const eligibleItems = collapsibleItems.filter((it) => it.isEligible);

    let effectiveFormWidth = 0;
    let baseOverhead = 0;

    // Tablet 2-row layout (768px <= containerWidth < 1024px): prompt is in row 2, form in row 1 takes 0 space
    if (containerWidth < 1024) {
      baseOverhead = 32 + logoWidth + 16 + permanentWidth + 8;
      effectiveFormWidth = 0;
    } else {
      // Desktop single-row layout (containerWidth >= 1024px)
      const activeWidth = typeof overrideWidth === 'number' ? overrideWidth : promptCustomWidth;
      const defaultFormWidth = containerWidth >= 1280 ? 460 : 380;
      effectiveFormWidth = activeWidth || (isPromptExpanded ? (containerWidth - logoWidth - permanentWidth - 64) : defaultFormWidth);
      baseOverhead = 32 + logoWidth + 16 + 16 + permanentWidth + 10;
    }

    const availableSpace = containerWidth - baseOverhead - effectiveFormWidth;

    const newVisible = {
      refine: false,
      add: false,
      cards: false,
      starred: false,
      map: false,
      zoom: false,
      clear: false,
      quota: false,
      language: false,
      theme: false,
    };

    // Calculate cumulative widths from each eligible item to the end (rightmost)
    eligibleItems.forEach((item, index) => {
      const neededFromHere = eligibleItems.slice(index).reduce((sum, curr) => sum + curr.width, 0);
      newVisible[item.id] = availableSpace >= neededFromHere;
    });

    setVisibleIcons(newVisible);
  }, [isPromptExpanded, promptCustomWidth, timelineData, user, starredCount, quota]);

  useEffect(() => {
    updateRoomAvailability();
    if (!toolbarContainerRef.current) return;

    let resizeObserver;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateRoomAvailability();
      });
      resizeObserver.observe(toolbarContainerRef.current);
    }

    window.addEventListener('resize', () => updateRoomAvailability());

    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', () => updateRoomAvailability());
    };
  }, [updateRoomAvailability, timelineData, user, language, filterStarredOnly, isCardsListOpen, isMapMenuOpen, mapMode]);

  const isResizingRef = useRef(false);
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const resizeDirRef = useRef('right');
  const maxAvailableWidthRef = useRef(1200);

  const handleResizeStart = (e, direction) => {
    e.preventDefault();
    e.stopPropagation();
    isResizingRef.current = true;
    setIsResizing(true);
    resizeDirRef.current = direction;
    startXRef.current = e.touches ? e.touches[0].clientX : e.clientX;

    // If currently toggled as expanded, reset expanded state so custom width controls size smoothly
    if (isPromptExpanded) {
      setIsPromptExpanded(false);
      try {
        localStorage.setItem('vt_prompt_expanded', 'false');
      } catch (err) {}
    }

    if (formContainerRef.current) {
      startWidthRef.current = formContainerRef.current.getBoundingClientRect().width;
    } else {
      startWidthRef.current = promptCustomWidth || 450;
    }

    // Calculate maximum available width dynamically until it reaches right before the More Actions button
    const containerWidth = toolbarContainerRef.current?.clientWidth || window.innerWidth;
    const logoWidth = logoRef.current?.offsetWidth || 130;
    const permanentWidth = 38 + (user ? 52 : 86);
    const paddingAndGaps = 32 + 16 + 16 + 10;
    const maxAllowed = containerWidth - logoWidth - permanentWidth - paddingAndGaps;
    maxAvailableWidthRef.current = Math.max(260, Math.floor(maxAllowed));

    const onMouseMove = (moveEvent) => {
      if (!isResizingRef.current) return;
      const clientX = moveEvent.touches ? moveEvent.touches[0].clientX : moveEvent.clientX;
      const deltaX = clientX - startXRef.current;
      // Header layout is LTR: dragging right handle to the right (+deltaX) expands width.
      // Dragging left handle to the left (-deltaX) expands width.
      const change = resizeDirRef.current === 'right' ? deltaX : -deltaX;

      const maxWidth = maxAvailableWidthRef.current;
      const newWidth = Math.min(maxWidth, Math.max(260, Math.round(startWidthRef.current + change)));

      setPromptCustomWidth(newWidth);
      updateRoomAvailability(newWidth);
    };

    const onMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        setIsResizing(false);
        setPromptCustomWidth((finalWidth) => {
          if (finalWidth) {
            try {
              localStorage.setItem('vt_prompt_custom_width', String(finalWidth));
            } catch (err) {}
            updateRoomAvailability(finalWidth);
          }
          return finalWidth;
        });
      }
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onMouseMove);
      window.removeEventListener('touchend', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onMouseMove);
    window.addEventListener('touchend', onMouseUp);
  };

  const handleResetResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setPromptCustomWidth(null);
    setIsPromptExpanded(false);
    updateRoomAvailability(null);
    try {
      localStorage.removeItem('vt_prompt_custom_width');
      localStorage.removeItem('vt_prompt_expanded');
    } catch (err) {}
  };

  const togglePromptExpanded = () => {
    setIsPromptExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('vt_prompt_expanded', String(next));
      } catch (e) {}
      // When collapsing, clear custom width so it reliably collapses back to compact size
      if (!next) {
        setPromptCustomWidth(null);
        try {
          localStorage.removeItem('vt_prompt_custom_width');
        } catch (e) {}
      }
      return next;
    });
  };

  const detailOptions = [
    {
      id: 'overview',
      label: t('toolbar.detailOverview'),
      description: t('toolbar.detailOverviewDesc')
    },
    {
      id: 'standard',
      label: t('toolbar.detailStandard'),
      description: t('toolbar.detailStandardDesc')
    },
    {
      id: 'deep_dive',
      label: t('toolbar.detailDeep'),
      description: t('toolbar.detailDeepDesc')
    }
  ];

  const activeDetailOption =
    detailOptions.find((opt) => opt.id === detailLevel) || detailOptions[1];

  const loadingSteps = Array.isArray(t('toolbar.loadingSteps'))
    ? t('toolbar.loadingSteps')
    : LOADING_STEPS;

  useEffect(() => {
    let interval;
    if (isGenerating) {
      setLoadingStepIdx(0);
      interval = setInterval(() => {
        setLoadingStepIdx((prev) => (prev + 1) % loadingSteps.length);
      }, 2200);
    }
    return () => clearInterval(interval);
  }, [isGenerating, loadingSteps.length]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;
    if (onGenerate) {
      onGenerate(prompt.trim(), detailLevel);
    }
  };

  const mapOptionsList = [
    { id: 'pip', label: t('toolbar.mapPip') || t('floatingMap.pipTooltip'), icon: Globe },
    { id: 'split', label: t('toolbar.mapSplit') || t('floatingMap.splitTooltip'), icon: Columns2 },
    { id: 'full', label: t('toolbar.mapFull') || t('floatingMap.fullTooltip'), icon: Maximize2 },
    { id: 'icon', label: t('toolbar.mapIcon') || t('floatingMap.closeTooltip'), icon: Minimize2 },
  ];

  return (
    <header
      dir="ltr"
      className={`relative w-full bg-white/90 dark:bg-slate-950/90 backdrop-blur-xl border-b border-slate-200/80 dark:border-slate-800/80 select-none transition-colors ${
        isMoreMenuOpen || isUserMenuOpen || isDetailDropdownOpen || isMapMenuOpen ? 'z-[45]' : 'z-40'
      }`}
    >
      <div
        ref={toolbarContainerRef}
        className="px-3 sm:px-4 py-2 flex flex-wrap lg:flex-nowrap items-center justify-between gap-2 lg:gap-4 text-slate-700 dark:text-slate-200"
      >
        
        {/* Left: Branding & Home button */}
        <div ref={logoRef} className="order-1 flex items-center shrink-0">
          <button
            type="button"
            onClick={() => {
              setPrompt('');
              onGoHome?.();
            }}
            className="flex items-center cursor-pointer transition-transform duration-200 hover:scale-105 active:scale-95 focus:outline-none rounded-lg group"
            title={t('toolbar.goHome')}
            aria-label={t('toolbar.goHome')}
          >
            <ChroniXLogo mode="minimal" size="md" className="h-8 sm:h-9 w-auto shrink-0 transition-opacity group-hover:opacity-90" />
          </button>
        </div>

        {/* Right: Core Actions & More Dropdown (Top right on smaller screens, far right on large) */}
        <div
          ref={rightControlsRef}
          className={`order-2 lg:order-3 flex items-center gap-1 sm:gap-1.5 shrink-0 min-w-0 ml-auto ${
            isResizing ? 'transition-none' : 'transition-all duration-200'
          }`}
        >
          {/* AI Refine Quick Access Button (when timeline exists and room permits) */}
          {timelineData && visibleIcons.refine && (
            <button
              type="button"
              id="toolbar-refine-btn"
              data-action="refine"
              disabled={isGenerating}
              onClick={onOpenRefine}
              className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg text-xs font-semibold border transition-all cursor-pointer select-none active:scale-95 shadow-2xs bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:text-sky-600 dark:hover:text-sky-400 hover:border-sky-300 dark:hover:border-sky-700/60 hover:bg-sky-50/70 dark:hover:bg-sky-950/40 disabled:opacity-40 disabled:cursor-not-allowed group"
              title={t('toolbar.refineTitle')}
              aria-label={t('toolbar.refine')}
            >
              <Sparkles className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400 group-hover:rotate-12 transition-transform duration-200 shrink-0" />
            </button>
          )}

          {/* Add Event Quick Access Button (when timeline exists and room permits) */}
          {timelineData && visibleIcons.add && (
            <button
              type="button"
              id="toolbar-add-event-btn"
              data-action="add-event"
              onClick={onAddEvent}
              className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg text-xs font-semibold border transition-all cursor-pointer select-none active:scale-95 shadow-2xs bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:text-emerald-600 dark:hover:text-emerald-400 hover:border-emerald-300 dark:hover:border-emerald-700/60 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/40 disabled:opacity-40 disabled:cursor-not-allowed group"
              title={t('toolbar.addEvent')}
              aria-label={t('toolbar.addEvent')}
            >
              <PlusCircle className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 group-hover:scale-110 transition-transform duration-200 shrink-0" />
            </button>
          )}

          {/* Cards List / Events Drawer Quick Access Button (when timeline exists and room permits) */}
          {timelineData && visibleIcons.cards && (
            <button
              type="button"
              id="toolbar-cards-btn"
              data-action="cards"
              onClick={onToggleCardsList}
              className={`h-8 shrink-0 flex items-center justify-center gap-1.5 ${
                (timelineData?.articles?.length ?? 0) > 0 ? 'px-2' : 'w-8 px-0'
              } rounded-lg text-xs font-semibold border transition-all cursor-pointer select-none active:scale-95 shadow-2xs group ${
                isCardsListOpen
                  ? 'bg-indigo-500/10 dark:bg-indigo-400/15 border-indigo-400/80 dark:border-indigo-500/80 text-indigo-700 dark:text-indigo-300 ring-2 ring-indigo-400/20 shadow-xs'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-300 dark:hover:border-indigo-700/60 hover:bg-indigo-50/70 dark:hover:bg-indigo-950/40'
              }`}
              title={isCardsListOpen ? (t('toolbar.cardsListCloseTitle') || t('common.close')) : (t('toolbar.cardsListTitle') || t('cardsList.title'))}
              aria-label={t('toolbar.cardsList') || t('cardsList.title')}
              aria-pressed={isCardsListOpen}
            >
              <LayoutList className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 group-hover:scale-105 transition-transform duration-200 shrink-0" />
              {(timelineData?.articles?.length ?? 0) > 0 && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full transition-colors ${
                    isCardsListOpen
                      ? 'bg-indigo-200/80 dark:bg-indigo-900/80 text-indigo-800 dark:text-indigo-200'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {timelineData.articles.length}
                </span>
              )}
            </button>
          )}

          {/* Starred Filter Quick Access Button (when timeline exists and room permits) - Right to Cards */}
          {timelineData && visibleIcons.starred && (
            <button
              type="button"
              id="toolbar-starred-btn"
              data-action="starred"
              onClick={onToggleFilterStarredOnly}
              className={`h-8 shrink-0 flex items-center justify-center gap-1.5 ${
                starredCount > 0 ? 'px-2' : 'w-8 px-0'
              } rounded-lg text-xs font-semibold border transition-all cursor-pointer select-none active:scale-95 shadow-2xs ${
                filterStarredOnly
                  ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold ring-2 ring-amber-400/40 shadow-xs'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white hover:border-amber-300 dark:hover:border-amber-700/60'
              }`}
              title={filterStarredOnly ? t('toolbar.filterStarredActive') : t('toolbar.filterStarred')}
              aria-label={filterStarredOnly ? t('toolbar.filterStarredActive') : t('toolbar.filterStarred')}
              aria-pressed={filterStarredOnly}
            >
              <Star className={`w-3.5 h-3.5 ${filterStarredOnly ? 'fill-current text-slate-950' : 'text-amber-500 fill-amber-500/20'}`} />
              {starredCount > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                  filterStarredOnly ? 'bg-black/20 text-slate-950' : 'bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300'
                }`}>
                  {starredCount}
                </span>
              )}
            </button>
          )}

          {/* Map Options Dropdown Button (when timeline exists and room permits) */}
          {timelineData && visibleIcons.map && (
            <div className="relative shrink-0" ref={mapMenuRef}>
              <button
                type="button"
                id="toolbar-map-btn"
                data-action="map"
                onClick={() => setIsMapMenuOpen((prev) => !prev)}
                className={`h-8 w-8 shrink-0 flex items-center justify-center rounded-lg text-xs font-semibold border transition-all cursor-pointer select-none active:scale-95 shadow-2xs group ${
                  isMapMenuOpen || mapMode !== 'icon'
                    ? 'bg-sky-500/10 dark:bg-sky-400/15 border-sky-400/80 dark:border-sky-500/80 text-sky-700 dark:text-sky-300 ring-2 ring-sky-400/20 shadow-xs'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:text-sky-600 dark:hover:text-sky-400 hover:border-sky-300 dark:hover:border-sky-700/60 hover:bg-sky-50/70 dark:hover:bg-sky-950/40'
                }`}
                title={t('toolbar.mapOptions')}
                aria-label={t('toolbar.mapOptions')}
                aria-haspopup="true"
                aria-expanded={isMapMenuOpen}
              >
                <Globe className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400 group-hover:rotate-12 transition-transform duration-200 shrink-0" />
              </button>

              {isMapMenuOpen && (
                <div
                  className={`absolute mt-2 w-52 bg-white/95 dark:bg-slate-900/95 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 py-1.5 z-50 text-xs animate-in fade-in zoom-in-95 duration-150 backdrop-blur-xl ${
                    language === 'he' ? 'right-auto left-0 text-right' : 'right-0 text-left'
                  }`}
                  dir={language === 'he' ? 'rtl' : 'ltr'}
                >
                  <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    {t('toolbar.mapSection')}
                  </div>
                  {mapOptionsList.map((opt) => {
                    const IconComponent = opt.icon;
                    const isActive = mapMode === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={!timelineData}
                        onClick={() => {
                          setIsMapMenuOpen(false);
                          onMapModeChange?.(opt.id);
                        }}
                        className={`w-full text-start px-3 py-2 flex items-center justify-between transition-colors cursor-pointer ${
                          isActive
                            ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-semibold'
                            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <IconComponent className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'}`} />
                          <span>{opt.label}</span>
                        </div>
                        {isActive && (
                          <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Zoom Controls (Desktop only - only when timeline exists) - Unified Segmented Control */}
          {timelineData && visibleIcons.zoom && (
            <div className="hidden md:flex items-center h-8 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs overflow-hidden shrink-0">
              <button
                type="button"
                onClick={onZoomIn}
                className="h-full w-8 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer border-r border-slate-200 dark:border-slate-800 active:bg-slate-200 dark:active:bg-slate-700 select-none"
                title={t('toolbar.zoomIn')}
                aria-label={t('toolbar.zoomIn')}
              >
                <ZoomIn className="w-3.5 h-3.5 shrink-0" />
              </button>
              <button
                type="button"
                onClick={onZoomOut}
                className="h-full w-8 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer border-r border-slate-200 dark:border-slate-800 active:bg-slate-200 dark:active:bg-slate-700 select-none"
                title={t('toolbar.zoomOut')}
                aria-label={t('toolbar.zoomOut')}
              >
                <ZoomOut className="w-3.5 h-3.5 shrink-0" />
              </button>
              <button
                type="button"
                onClick={onFitAll}
                className="h-full w-8 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer active:bg-slate-200 dark:active:bg-slate-700 select-none"
                title={t('toolbar.fitAll')}
                aria-label={t('toolbar.fitAll')}
              >
                <Maximize2 className="w-3.5 h-3.5 shrink-0" />
              </button>
            </div>
          )}

          {/* Clear / New Board Quick Access Button (when timeline exists) */}
          {timelineData && visibleIcons.clear && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(t('toolbar.clearConfirm'))) {
                  setPrompt('');
                  onClearBoard?.();
                }
              }}
              className="h-8 shrink-0 flex items-center justify-center gap-1.5 bg-white dark:bg-slate-900 hover:bg-rose-50/80 dark:hover:bg-rose-950/30 text-slate-700 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 px-2 sm:px-2.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-800 hover:border-rose-200 dark:hover:border-rose-900/50 shadow-2xs transition-all active:scale-95 cursor-pointer group"
              title={t('toolbar.clearBoard')}
              aria-label={t('toolbar.clearBoard')}
            >
              <Trash2 className="w-3.5 h-3.5 text-slate-400 group-hover:text-rose-500 transition-colors shrink-0" />
            </button>
          )}

          {/* Quota Indicator Badge */}
          {user && visibleIcons.quota && (
            <QuotaBadge quota={quota} onClick={onOpenQuota} />
          )}

          {/* Dedicated Language Switcher (EN / עב) - Perfectly locked size and non-wrapping */}
          {visibleIcons.language && (
            <button
              type="button"
              onClick={toggleLanguage}
              className="h-8 shrink-0 whitespace-nowrap select-none flex items-center justify-center gap-1.5 px-2.5 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs transition-all active:scale-95 cursor-pointer text-xs font-semibold"
              title={language === 'en' ? t('toolbar.switchLanguageToHebrew') : t('toolbar.switchLanguageToEnglish')}
              aria-label={language === 'en' ? 'Switch to Hebrew' : 'Switch to English'}
            >
              <Languages className="w-3.5 h-3.5 text-sky-500 shrink-0" />
              <span className="whitespace-nowrap tracking-wide leading-none inline-flex items-center">
                {language === 'en' ? (
                  <span><strong className="text-sky-600 dark:text-sky-400 font-bold">EN</strong> / עב</span>
                ) : (
                  <span><strong className="text-sky-600 dark:text-sky-400 font-bold">עב</strong> / EN</span>
                )}
              </span>
            </button>
          )}

          {/* Light / Dark Mode Toggle Button */}
          {visibleIcons.theme && (
            <button
              type="button"
              onClick={onToggleTheme}
              className="h-8 w-8 shrink-0 flex items-center justify-center bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs transition-all active:scale-95 cursor-pointer"
              title={isDark ? t('toolbar.switchThemeLight') : t('toolbar.switchThemeDark')}
              aria-label={isDark ? t('toolbar.switchThemeLight') : t('toolbar.switchThemeDark')}
            >
              {isDark ? (
                <Sun className="w-4 h-4 text-amber-400 hover:rotate-45 transition-transform" />
              ) : (
                <Moon className="w-4 h-4 text-slate-600 hover:-rotate-12 transition-transform" />
              )}
            </button>
          )}

          {/* More Actions Dropdown Menu */}
          <div className="relative shrink-0" ref={moreMenuRef}>
            <button
              type="button"
              onClick={() => setIsMoreMenuOpen((prev) => !prev)}
              className={`h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border shadow-2xs transition-all active:scale-95 cursor-pointer ${
                isMoreMenuOpen
                  ? 'bg-slate-100 dark:bg-slate-800 border-slate-400 dark:border-slate-600 text-slate-900 dark:text-white'
                  : 'bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white border-slate-200 dark:border-slate-800'
              }`}
              title={t('toolbar.moreActions')}
              aria-label={t('toolbar.moreActions')}
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {isMoreMenuOpen && (
              <div
                className={`absolute right-0 mt-2 w-60 max-h-[calc(100vh-5rem)] overflow-y-auto overscroll-contain bg-white/95 dark:bg-slate-900/95 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 py-1.5 z-50 text-xs animate-in fade-in zoom-in-95 duration-150 backdrop-blur-xl ${
                  language === 'he' ? 'text-right' : 'text-left'
                }`}
                dir={language === 'he' ? 'rtl' : 'ltr'}
              >
                
                {/* Timeline Actions */}
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  {t('toolbar.timelineSection')}
                </div>

                <button
                  type="button"
                  disabled={!timelineData || isGenerating}
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onOpenRefine();
                  }}
                  className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent transition-colors cursor-pointer"
                  title={t('toolbar.refineTitle')}
                >
                  <Sparkles className="w-4 h-4 text-sky-500 shrink-0" />
                  <span className="font-medium">{t('toolbar.refine')}</span>
                </button>

                <button
                  type="button"
                  disabled={!timelineData}
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onAddEvent();
                  }}
                  className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent transition-colors cursor-pointer"
                >
                  <PlusCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span className="font-medium">{t('toolbar.addEvent')}</span>
                </button>

                <button
                  type="button"
                  disabled={!timelineData}
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onToggleCardsList?.();
                  }}
                  className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent transition-colors cursor-pointer"
                >
                  <LayoutList className="w-4 h-4 text-indigo-500 shrink-0" />
                  <span className="font-medium">{t('toolbar.cardsList') || t('cardsList.title')}</span>
                  {timelineData?.articles?.length > 0 && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 ml-auto rtl:mr-auto rtl:ml-0">
                      {timelineData.articles.length}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  disabled={!timelineData}
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onToggleFilterStarredOnly?.();
                  }}
                  className={`w-full text-start px-3 py-2 flex items-center justify-between transition-colors cursor-pointer ${
                    filterStarredOnly
                      ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-semibold'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Star className={`w-4 h-4 shrink-0 ${filterStarredOnly ? 'fill-amber-400 text-amber-500' : 'text-amber-500'}`} />
                    <span>{filterStarredOnly ? t('toolbar.filterStarredActive') : t('toolbar.filterStarred')}</span>
                  </div>
                  {starredCount > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300">
                      {starredCount}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onOpenSaved();
                  }}
                  className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="font-medium">{t('toolbar.savedTimelines')}</span>
                </button>

                {/* Map View Options */}
                <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  {t('toolbar.mapSection')}
                </div>
                {mapOptionsList.map((opt) => {
                  const IconComponent = opt.icon;
                  const isActive = mapMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={!timelineData}
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        onMapModeChange?.(opt.id);
                      }}
                      className={`w-full text-start px-3 py-2 flex items-center justify-between transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-semibold'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <IconComponent className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'}`} />
                        <span>{opt.label}</span>
                      </div>
                      {isActive && (
                        <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                      )}
                    </button>
                  );
                })}

                {/* Zoom & Navigation Controls (only when timeline exists) */}
                {timelineData && (
                  <>
                    <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                    <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                      {t('toolbar.zoomSection')}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        onZoomIn?.();
                      }}
                      className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      title={t('toolbar.zoomIn')}
                    >
                      <ZoomIn className="w-4 h-4 text-sky-500 shrink-0" />
                      <span className="font-medium">{t('toolbar.zoomIn')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        onZoomOut?.();
                      }}
                      className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      title={t('toolbar.zoomOut')}
                    >
                      <ZoomOut className="w-4 h-4 text-sky-500 shrink-0" />
                      <span className="font-medium">{t('toolbar.zoomOut')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        onFitAll?.();
                      }}
                      className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      title={t('toolbar.fitAll')}
                    >
                      <Maximize2 className="w-4 h-4 text-sky-500 shrink-0" />
                      <span className="font-medium">{t('toolbar.fitAll')}</span>
                    </button>
                  </>
                )}

                {/* Export Options */}
                <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  {t('toolbar.exportSection')}
                </div>

                <button
                  type="button"
                  disabled={!timelineData}
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onExportImage();
                  }}
                  className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent transition-colors cursor-pointer"
                >
                  <ImageIcon className="w-4 h-4 text-sky-500 shrink-0" />
                  <span className="font-medium">{t('toolbar.exportPng')}</span>
                </button>

                <button
                  type="button"
                  disabled={!timelineData}
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onExportJson();
                  }}
                  className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4 text-indigo-500 shrink-0" />
                  <span className="font-medium">{t('toolbar.exportJson')}</span>
                </button>

                {/* Clear Board option */}
                {timelineData && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      if (window.confirm(t('toolbar.clearConfirm'))) {
                        setPrompt('');
                        onClearBoard?.();
                      }
                    }}
                    className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4 text-rose-500 shrink-0" />
                    <span className="font-medium">{t('toolbar.clearBoard')}</span>
                  </button>
                )}

                {/* System Settings & Info */}
                <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  {t('toolbar.systemSection')}
                </div>

                {/* Prompt Cap / Quota Status */}
                <button
                  type="button"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    if (user) {
                      onOpenQuota?.();
                    } else {
                      onOpenAuth?.();
                    }
                  }}
                  className="w-full text-start px-3 py-2 flex items-center justify-between text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  title={t('toolbar.promptCap')}
                >
                  <div className="flex items-center gap-2.5">
                    <Zap className="w-4 h-4 text-amber-500 shrink-0" />
                    <span className="font-medium">{t('toolbar.promptCap')}</span>
                  </div>
                  {user && quota ? (
                    <span className="text-[10px] font-bold text-sky-600 dark:text-sky-400 px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800">
                      {quota.is_admin
                        ? t('quota.badgeAdmin')
                        : quota.remaining_paid > 0
                        ? `${quota.remaining_paid}/${quota.daily_paid_limit || 15}`
                        : t('quota.tierFree')}
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                      {t('toolbar.signIn')}
                    </span>
                  )}
                </button>

                {/* Theme Mode Toggle (Light / Dark) */}
                <button
                  type="button"
                  onClick={() => {
                    onToggleTheme?.();
                  }}
                  className="w-full text-start px-3 py-2 flex items-center justify-between text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  title={isDark ? t('toolbar.switchThemeLight') : t('toolbar.switchThemeDark')}
                >
                  <div className="flex items-center gap-2.5">
                    {isDark ? (
                      <Sun className="w-4 h-4 text-amber-400 shrink-0" />
                    ) : (
                      <Moon className="w-4 h-4 text-slate-600 dark:text-slate-400 shrink-0" />
                    )}
                    <span className="font-medium">{isDark ? t('toolbar.switchThemeLight') : t('toolbar.switchThemeDark')}</span>
                  </div>
                  <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                    {isDark ? t('toolbar.themeDark') : t('toolbar.themeLight')}
                  </span>
                </button>

                {/* Language switch option in More Menu */}
                <button
                  type="button"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    toggleLanguage();
                  }}
                  className="w-full text-start px-3 py-2 flex items-center justify-between text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <Languages className="w-4 h-4 text-sky-500 shrink-0" />
                    <span className="font-medium">{t('toolbar.language')}: {language === 'en' ? 'English' : 'עברית'}</span>
                  </div>
                  <span className="text-[10px] font-bold text-sky-600 dark:text-sky-400 px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800">
                    {language === 'en' ? 'עברית' : 'English'}
                  </span>
                </button>

                <button
                  type="button"
                  id="toolbar-menu-user-guide-btn"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onOpenGuide?.();
                  }}
                  className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <BookOpen className="w-4 h-4 text-sky-500 shrink-0" />
                  <span className="font-medium">{t('toolbar.userGuide')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onOpenAbout?.();
                  }}
                  className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <Info className="w-4 h-4 text-sky-500 shrink-0" />
                  <span className="font-medium">{t('toolbar.aboutChronix')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onOpenSettings();
                  }}
                  className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <Key className="w-4 h-4 text-sky-500 shrink-0" />
                  <span className="font-medium">{t('toolbar.apiKeySettings')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onOpenDisclaimer();
                  }}
                  className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="font-medium">{t('toolbar.aiDisclaimer')}</span>
                </button>
              </div>
            )}
          </div>

          {/* User Auth Profile / Login Button */}
          {user ? (
            <div className="relative shrink-0" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="h-8 flex items-center gap-1.5 px-1 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-700 shadow-xs transition-all cursor-pointer"
                title={user.email}
              >
                {user.user_metadata?.avatar_url || user.user_metadata?.picture ? (
                  <img
                    src={user.user_metadata.avatar_url || user.user_metadata.picture}
                    alt="Avatar"
                    className="w-6 h-6 rounded-md object-cover"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-md bg-sky-600 flex items-center justify-center text-white text-[11px] font-bold uppercase">
                    {(user.user_metadata?.full_name || user.email || 'U')[0]}
                  </div>
                )}
                <ChevronDown className="w-3 h-3 text-slate-500 dark:text-slate-400 mr-0.5" />
              </button>

              {isUserMenuOpen && (
                <div
                  className={`absolute right-0 mt-2 w-56 bg-white/95 dark:bg-slate-900/95 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 py-1.5 z-50 text-xs animate-in fade-in zoom-in-95 duration-150 backdrop-blur-xl ${
                    language === 'he' ? 'text-right' : 'text-left'
                  }`}
                  dir={language === 'he' ? 'rtl' : 'ltr'}
                >
                  <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
                    <p className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                      {user.user_metadata?.full_name || 'User'}
                    </p>
                    <p className="text-slate-500 dark:text-slate-400 truncate text-[11px]">
                      {user.email}
                    </p>
                  </div>

                  {/* Daily Quota Summary in User Menu */}
                  {quota && (
                    <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                      <div className="flex items-center justify-between text-[11px] font-semibold mb-1">
                        <span className="text-slate-700 dark:text-slate-200 flex items-center gap-1">
                          <Zap className="w-3 h-3 text-sky-500 shrink-0" />
                          <span>{quota.is_admin ? t('quota.tierAdmin') : t('quota.modalTitle')}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            onOpenQuota?.();
                          }}
                          className="text-[10px] text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
                        >
                          {t('common.learnMore')}
                        </button>
                      </div>
                      {!quota.is_admin && (
                        <>
                          <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden my-1">
                            <div
                              className="bg-sky-500 h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${Math.min(
                                  100,
                                  Math.max(0, ((quota.remaining_paid ?? 0) / (quota.daily_paid_limit || 15)) * 100)
                                )}%`
                              }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                            <span>{t('quota.statusUsed', { used: quota.used_today ?? 0, limit: quota.daily_paid_limit || 15 })}</span>
                            <span className="font-bold text-sky-600 dark:text-sky-400">
                              {quota.remaining_paid > 0 ? `${quota.remaining_paid}` : t('quota.tierFree')}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onOpenSaved();
                    }}
                    className="w-full text-start px-3 py-2 flex items-center gap-2 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
                    <span>{t('toolbar.myTimelines')}</span>
                  </button>

                  <div className="border-t border-slate-100 dark:border-slate-800 my-1" />

                  <button
                    type="button"
                    onClick={async () => {
                      setIsUserMenuOpen(false);
                      await logout();
                    }}
                    className="w-full text-start px-3 py-2 flex items-center gap-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>{t('toolbar.signOut')}</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenAuth}
              className="h-8 shrink-0 whitespace-nowrap flex items-center gap-1.5 px-3 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-800 shadow-2xs transition-all active:scale-95 cursor-pointer"
              title={t('toolbar.signIn')}
            >
              <LogIn className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline whitespace-nowrap">{t('toolbar.signIn')}</span>
            </button>
          )}
        </div>

        {/* Center: Search / Prompt Form (Full-width row on mobile/tablet, right next to logo on desktop) */}
        <div
          ref={formContainerRef}
          style={
            !isPromptExpanded && promptCustomWidth
              ? { width: `${promptCustomWidth}px`, maxWidth: '100%' }
              : undefined
          }
          className={`order-3 lg:order-2 w-full relative flex items-center group/prompt ${
            isResizing ? 'transition-none' : 'transition-[width,max-width,flex] duration-200 ease-out'
          } min-w-0 mx-auto lg:mx-0 ${
            isPromptExpanded
              ? 'lg:flex-1 max-w-none'
              : promptCustomWidth
              ? 'lg:flex-initial shrink-0'
              : 'lg:w-[380px] xl:w-[460px] max-w-xl'
          }`}
        >
          {/* Left resize handle (desktop only) */}
          <div
            onMouseDown={(e) => handleResizeStart(e, 'left')}
            onTouchStart={(e) => handleResizeStart(e, 'left')}
            onDoubleClick={handleResetResize}
            className="hidden lg:flex items-center justify-center absolute -left-2 top-1/2 -translate-y-1/2 w-3.5 h-8 cursor-ew-resize opacity-0 group-hover/prompt:opacity-100 hover:!opacity-100 transition-opacity z-20"
            title={t('toolbar.resizePrompt')}
            aria-label={t('toolbar.resizePrompt')}
          >
            <div className="w-1 h-4 rounded-full bg-slate-300 dark:bg-slate-600 hover:bg-sky-500 dark:hover:bg-sky-400 transition-colors shadow-xs" />
          </div>

          <form
            onSubmit={handleSubmit}
            className="w-full min-w-0"
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
                dir={prompt ? (/[\u0590-\u05FF]/.test(prompt) ? 'rtl' : 'ltr') : (language === 'he' ? 'rtl' : 'ltr')}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={isGenerating}
                title={prompt || t('toolbar.inputPlaceholder')}
                placeholder={
                  isGenerating
                    ? loadingSteps[loadingStepIdx % loadingSteps.length]
                    : t('toolbar.inputPlaceholder')
                }
                className={`flex-1 min-w-0 bg-transparent text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 text-xs sm:text-sm outline-none font-medium py-1 px-1 font-sans ${
                  (prompt ? /[\u0590-\u05FF]/.test(prompt) : language === 'he') ? 'text-right' : 'text-left'
                }`}
              />

              {/* Quick Clear Button when text entered */}
              {prompt && !isGenerating && (
                <button
                  type="button"
                  onClick={() => setPrompt('')}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors shrink-0 mr-1 cursor-pointer"
                  title={t('toolbar.clearInput')}
                  aria-label={t('toolbar.clearInput')}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Expand / Minimize Toggle Button (Desktop/Tablet only) */}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  togglePromptExpanded();
                }}
                className="hidden sm:flex p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800/60 rounded-md transition-colors shrink-0 mr-1 cursor-pointer"
                title={isPromptExpanded ? t('toolbar.collapsePrompt') : t('toolbar.expandPrompt')}
                aria-label={isPromptExpanded ? t('toolbar.collapsePrompt') : t('toolbar.expandPrompt')}
              >
                {isPromptExpanded ? (
                  <Minimize2 className="w-3.5 h-3.5 text-sky-500" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </button>

            {/* Detail Level Dropdown */}
            <div className="relative shrink-0" ref={detailDropdownRef}>
              <button
                type="button"
                onClick={() => setIsDetailDropdownOpen((prev) => !prev)}
                disabled={isGenerating}
                className="flex items-center gap-1 bg-white/80 dark:bg-slate-800/80 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold transition-all mr-1 shadow-2xs active:scale-95 cursor-pointer"
                title={`${t('toolbar.detailLevel')}: ${activeDetailOption.label} (${activeDetailOption.description})`}
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
                <div
                  className={`absolute right-0 top-full mt-1.5 w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150 ${
                    language === 'he' ? 'text-right' : 'text-left'
                  }`}
                  dir={language === 'he' ? 'rtl' : 'ltr'}
                >
                  <div className="px-2 py-1 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    {t('toolbar.detailLevel')}
                  </div>
                  {detailOptions.map((opt) => {
                    const isSelected = detailLevel === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setDetailLevel(opt.id);
                          setIsDetailDropdownOpen(false);
                        }}
                        className={`w-full text-start flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-slate-100 dark:bg-slate-800 text-slate-950 dark:text-white font-semibold'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <div className="flex flex-col text-start">
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
                {/* Generate / Stop Button - Stays firmly inside the prompt container */}
              {isGenerating ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onStopGenerate?.();
                  }}
                  className="w-7 h-7 flex items-center justify-center bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white rounded-lg shadow-xs transition-all active:scale-95 shrink-0 cursor-pointer animate-in fade-in zoom-in-95 duration-150"
                  title={t('toolbar.stopGenerateBtn')}
                  aria-label={t('toolbar.stopGenerateBtn')}
                >
                  <Square className="w-3.5 h-3.5 fill-current shrink-0" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!prompt.trim()}
                  className="w-7 h-7 flex items-center justify-center bg-sky-600 hover:bg-sky-500 active:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg shadow-xs transition-all active:scale-95 shrink-0 cursor-pointer"
                  title={t('toolbar.generateBtn')}
                  aria-label={t('toolbar.generateBtn')}
                >
                  <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                </button>
              )}
            </div>
          </form>

          {/* Right resize handle (desktop only) */}
          <div
            onMouseDown={(e) => handleResizeStart(e, 'right')}
            onTouchStart={(e) => handleResizeStart(e, 'right')}
            onDoubleClick={handleResetResize}
            className="hidden lg:flex items-center justify-center absolute -right-2 top-1/2 -translate-y-1/2 w-3.5 h-8 cursor-ew-resize opacity-0 group-hover/prompt:opacity-100 hover:!opacity-100 transition-opacity z-20"
            title={t('toolbar.resizePrompt')}
            aria-label={t('toolbar.resizePrompt')}
          >
            <div className="w-1 h-4 rounded-full bg-slate-300 dark:bg-slate-600 hover:bg-sky-500 dark:hover:bg-sky-400 transition-colors shadow-xs" />
          </div>
        </div>
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

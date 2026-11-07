import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Search,
  Calendar,
  Layers,
  Star,
  Headphones,
  Check,
  Plus,
  ArrowUp,
  ArrowDown,
  Loader2,
  FolderOpen,
  Compass,
  BookOpen,
  BookUser,
} from './icons/ThemeIcons';
import {
  fetchPublicLibrary,
  getCachedPublicLibraryItems,
  fetchTimelines,
  PUBLIC_LIBRARY_UPDATED_EVENT,
  TIMELINES_UPDATED_EVENT,
} from '../api';
import useModalAnimation from '../hooks/useModalAnimation';
import useModalFocusTrap from '../hooks/useModalFocusTrap';
import useIsMobileViewport from '../hooks/useIsMobileViewport';
import useTwoTapOpen from '../hooks/useTwoTapOpen';
import { useLanguage } from '../context/LanguageContext';
import { isTextRtl } from '../utils/textDirection';
import TimelineModeBadges from './TimelineModeBadges';
import HorizontalCapsuleScroller from './HorizontalCapsuleScroller';
import { MAX_MERGED_SOURCES, LAYER_ACCENT_COLORS } from '../utils/mergeTimelines';
import { formatYearRangeLabel } from '../utils/timelineArticles';

export { formatYearRangeLabel };

const DOMAIN_KEYS = [
  'personal',
  'history',
  'technology',
  'space',
  'geography',
  'nature',
  'arts',
  'biography',
  'military',
  'business',
  'society',
];

function ModalLibraryCardTitle({ title, isTitleRtl }) {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const [overflowPx, setOverflowPx] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return undefined;

    let rafId = null;
    const measure = () => {
      if (!containerRef.current || !textRef.current) return;
      const cw = containerRef.current.clientWidth;
      const sw = textRef.current.scrollWidth;
      const diff = sw - cw;
      setOverflowPx(diff > 2 ? Math.ceil(diff + 6) : 0);
    };

    rafId = requestAnimationFrame(measure);
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(measure).catch(() => {});
    }

    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(container);
    }
    window.addEventListener('resize', measure);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [title, isTitleRtl]);

  const durationSec = overflowPx > 0
    ? Math.max(3.6, Math.min(7.5, Math.round((overflowPx / 32 + 2.8) * 10) / 10))
    : 0;

  return (
    <h3
      ref={containerRef}
      dir={isTitleRtl ? 'rtl' : 'ltr'}
      title={title}
      className={`font-bold text-sm text-ink group-hover:text-accent transition-colors overflow-hidden whitespace-nowrap leading-snug ${
        isTitleRtl ? 'text-right' : 'text-left'
      }`}
    >
      <span
        ref={textRef}
        style={
          overflowPx > 0
            ? {
                '--saved-title-scroll-dist': `${overflowPx}px`,
                '--saved-title-duration': `${durationSec}s`,
              }
            : undefined
        }
        className={`library-card-title-inner ${
          overflowPx > 0 ? (isTitleRtl ? 'has-overflow is-rtl' : 'has-overflow is-ltr') : ''
        }`}
      >
        {title}
      </span>
    </h3>
  );
}

export default function ExploreLibraryModal({
  isOpen,
  onClose,
  onSelectTimeline,
  onMergeTimelines,
  onAddLayerTimeline,
  mode = 'browse', // 'browse' | 'add-layer'
  activeLayerSourceIds = [],
  initialCategory = 'all',
}) {
  const { t, language, isRtl, contentMode } = useLanguage();
  const dialogRef = useModalFocusTrap(isOpen);
  const { isRendered, isVisible, handleClose, dragHandleProps } = useModalAnimation(isOpen, onClose, { duration: 250 });

  const isAddLayerMode = mode === 'add-layer';
  const isMobile = useIsMobileViewport();
  const { armedId, getPressProps } = useTwoTapOpen(isMobile);

  const [sourceTab, setSourceTab] = useState('library'); // 'library' | 'saved' (used in 'add-layer' mode)
  const [libraryItems, setLibraryItems] = useState(() => getCachedPublicLibraryItems() || []);
  const [savedItems, setSavedItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [failedCoverUrls, setFailedCoverUrls] = useState(() => new Set());

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLang, setSelectedLang] = useState('auto'); // 'auto' | 'all' | 'he' | 'en'
  const [selectedMode, setSelectedMode] = useState('auto'); // 'auto' | 'all' | 'classic' | 'kids'
  const [selectedCategories, setSelectedCategories] = useState(() =>
    initialCategory && initialCategory !== 'all' ? [initialCategory] : []
  );

  const [compareMode, setCompareMode] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState([]); // [{ id, title }]
  const [mergingBusy, setMergingBusy] = useState(false);

  const activeLayerSet = useMemo(
    () => new Set((activeLayerSourceIds || []).filter(Boolean).map(String)),
    [activeLayerSourceIds],
  );

  useEffect(() => {
    if (isOpen) {
      setSelectedCategories(initialCategory && initialCategory !== 'all' ? [initialCategory] : []);
      setSearchQuery('');
      if (isAddLayerMode) {
        setCompareMode(false);
        setSelectedForMerge([]);
        setSourceTab('saved');
      }
    } else {
      setCompareMode(false);
      setSelectedForMerge([]);
      setMergingBusy(false);
    }
  }, [isOpen, initialCategory, isAddLayerMode]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const loadData = async () => {
      const cachedLib = getCachedPublicLibraryItems();
      if (Array.isArray(cachedLib) && cachedLib.length > 0) {
        setLibraryItems(cachedLib);
      } else {
        setLoading(true);
        const initLang = selectedLang === 'auto' ? (language === 'he' ? 'he' : 'en') : selectedLang;
        const initMode = contentMode === 'kids' ? 'kids' : (selectedMode === 'auto' ? (contentMode || 'classic') : selectedMode);
        fetchPublicLibrary({ lang: initLang, contentMode: initMode, limit: 12 })
          .then((firstRes) => {
            if (cancelled) return;
            const firstItems = Array.isArray(firstRes?.items) ? firstRes.items : [];
            if (firstItems.length > 0 && !getCachedPublicLibraryItems()) {
              setLibraryItems(firstItems);
              if (!isAddLayerMode) setLoading(false);
            }
          })
          .catch(() => {});
      }
      if (isAddLayerMode && savedItems.length === 0) {
        setLoading(true);
      }

      try {
        const [libRes, savedRes] = await Promise.all([
          fetchPublicLibrary({ limit: 200 }).catch(() => ({ items: [] })),
          isAddLayerMode ? fetchTimelines().catch(() => []) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        const nextLib = Array.isArray(libRes?.items) ? libRes.items : [];
        const nextSaved = Array.isArray(savedRes) ? savedRes : [];
        setLibraryItems(nextLib);
        setSavedItems(nextSaved);
        if (isAddLayerMode && nextSaved.length === 0 && nextLib.length > 0) {
          setSourceTab('library');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadData();
    window.addEventListener(PUBLIC_LIBRARY_UPDATED_EVENT, loadData);
    window.addEventListener(TIMELINES_UPDATED_EVENT, loadData);
    return () => {
      cancelled = true;
      window.removeEventListener(PUBLIC_LIBRARY_UPDATED_EVENT, loadData);
      window.removeEventListener(TIMELINES_UPDATED_EVENT, loadData);
    };
  }, [isOpen, isAddLayerMode]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, handleClose]);

  const effectiveLang = useMemo(() => {
    if (selectedLang !== 'auto') return selectedLang;
    return language === 'he' ? 'he' : 'en';
  }, [selectedLang, language]);

  const effectiveMode = useMemo(() => {
    if (contentMode === 'kids') return 'kids';
    if (selectedMode !== 'auto') return selectedMode;
    return contentMode || 'classic';
  }, [selectedMode, contentMode]);

  const activeList = isAddLayerMode && sourceTab === 'saved' ? savedItems : libraryItems;

  const availableCategoryKeys = useMemo(() => {
    if (libraryItems.length === 0) return DOMAIN_KEYS;
    const present = new Set();
    for (const item of libraryItems) {
      if (effectiveLang !== 'all' && (item.language || 'en') !== effectiveLang) continue;
      if (effectiveMode !== 'all' && (item.contentMode || 'classic') !== effectiveMode) continue;
      for (const k of item.categoryKeys || []) {
        present.add(k);
      }
    }
    if (present.size === 0) return DOMAIN_KEYS;
    return DOMAIN_KEYS.filter((k) => present.has(k) || selectedCategories.includes(k));
  }, [libraryItems, effectiveLang, effectiveMode, selectedCategories]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return activeList.filter((item) => {
      if (!isAddLayerMode || sourceTab === 'library') {
        if (effectiveLang !== 'all' && (item.language || 'en') !== effectiveLang) {
          return false;
        }
        if (effectiveMode !== 'all' && (item.contentMode || 'classic') !== effectiveMode) {
          return false;
        }
        if (selectedCategories.length > 0) {
          const keys = Array.isArray(item.categoryKeys) ? item.categoryKeys : [];
          if (!keys.some((k) => selectedCategories.includes(k))) return false;
        }
      }
      if (!q) return true;
      const haystack = [
        item.title || '',
        item.description || '',
        ...(item.tags || []),
        ...(item.categories || []),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [activeList, isAddLayerMode, sourceTab, effectiveLang, effectiveMode, selectedCategories, searchQuery]);

  if (!isRendered) return null;

  const toggleMergeSelection = (item, e) => {
    e?.stopPropagation();
    setSelectedForMerge((prev) => {
      const existsIdx = prev.findIndex((x) => x.id === item.id);
      if (existsIdx >= 0) {
        return prev.filter((x) => x.id !== item.id);
      }
      if (prev.length >= MAX_MERGED_SOURCES) {
        return prev;
      }
      return [...prev, { id: item.id, title: item.title }];
    });
  };

  const moveSelectedItem = (idx, dir) => {
    setSelectedForMerge((prev) => {
      const nextIdx = idx + dir;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(idx, 1);
      copy.splice(nextIdx, 0, moved);
      return copy;
    });
  };

  const handleConfirmMerge = async () => {
    if (selectedForMerge.length < 2 || mergingBusy) return;
    setMergingBusy(true);
    try {
      await onMergeTimelines?.(selectedForMerge.map((x) => x.id));
      handleClose();
    } finally {
      setMergingBusy(false);
    }
  };

  const handleCardPrimaryClick = async (item) => {
    if (isAddLayerMode) {
      if (activeLayerSet.has(String(item.id)) || mergingBusy) return;
      setMergingBusy(true);
      try {
        await onAddLayerTimeline?.(item.id);
        handleClose();
      } finally {
        setMergingBusy(false);
      }
      return;
    }

    if (compareMode) {
      toggleMergeSelection(item);
      return;
    }

    onSelectTimeline?.(item.id);
    handleClose();
  };

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedLang('all');
    setSelectedMode('all');
    setSelectedCategories([]);
  };

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      role="dialog"
      aria-modal="true"
      onClick={handleClose}
      className={`fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-xs transition-opacity duration-200 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        className={`w-full sm:max-w-5xl max-h-[92vh] sm:max-h-[88vh] flex flex-col bg-surface border border-line rounded-t-2xl sm:rounded-panel shadow-panel overflow-hidden transition-all duration-200 ${
          isVisible ? 'translate-y-0 scale-100' : 'translate-y-4 sm:translate-y-0 sm:scale-95'
        }`}
      >
        {/* Mobile drag handle */}
        <div {...dragHandleProps} className="sm:hidden flex justify-center pt-3 pb-1 cursor-grab">
          <div className="w-10 h-1 rounded-full bg-line-strong" />
        </div>

        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-line flex flex-wrap items-center justify-between gap-3 bg-surface-raised/60">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-3 rounded-panel bg-accent-soft text-accent border border-accent/20 shrink-0">
              {isAddLayerMode ? <Layers className="w-5 h-5" /> : <Compass className="w-5 h-5" />}
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-ink truncate">
                {isAddLayerMode ? t('layers.pickerTitle') : t('library.modalTitle')}
              </h2>
              <p className="text-xs text-ink-muted line-clamp-1 mt-0.5">
                {isAddLayerMode ? t('layers.pickerSubtitle') : t('library.modalSubtitle')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!isAddLayerMode && libraryItems.length >= 2 && (
              <button
                type="button"
                onClick={() => setCompareMode((prev) => !prev)}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-control text-xs font-semibold border transition-all cursor-pointer ${
                  compareMode || selectedForMerge.length > 0
                    ? 'bg-accent text-accent-fg border-accent shadow-control'
                    : 'bg-surface hover:bg-surface-hover text-ink border-line'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>{compareMode ? t('layers.exitCompareBtn') : t('layers.compareModeBtn')}</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="p-2 rounded-control text-ink-subtle hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
              aria-label={t('common.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Add-Layer Source Tabs (My Saved Timelines vs Public Library) */}
        {isAddLayerMode && (
          <div className="px-4 sm:px-6 pt-3 flex items-center gap-2 bg-surface">
            <div className="seg-track inline-flex items-center p-1 rounded-control border border-line bg-surface-sunken">
              <button
                type="button"
                onClick={() => setSourceTab('saved')}
                className={`seg-item inline-flex items-center gap-2 px-3 py-2 rounded-control text-xs font-semibold cursor-pointer transition-all ${
                  sourceTab === 'saved' ? 'seg-item-active bg-surface-raised text-ink shadow-xs' : 'text-ink-muted hover:text-ink'
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>{t('layers.tabSaved')}</span>
                <span className="text-caption opacity-75">({savedItems.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setSourceTab('library')}
                className={`seg-item inline-flex items-center gap-2 px-3 py-2 rounded-control text-xs font-semibold cursor-pointer transition-all ${
                  sourceTab === 'library' ? 'seg-item-active bg-surface-raised text-ink shadow-xs' : 'text-ink-muted hover:text-ink'
                }`}
              >
                <Compass className="w-3.5 h-3.5" />
                <span>{t('layers.tabLibrary')}</span>
                <span className="text-caption opacity-75">({libraryItems.length})</span>
              </button>
            </div>
          </div>
        )}

        {/* Search & Filters */}
        <div className="px-4 sm:px-6 py-3 border-b border-line space-y-3 bg-surface">
          <div className="flex flex-wrap items-center gap-2">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-ink-subtle absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('library.searchPlaceholder')}
                className="w-full ps-9 pe-8 py-2 text-xs sm:text-sm bg-surface-sunken border border-line focus:border-accent rounded-control text-ink placeholder:text-ink-subtle outline-none transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute top-1/2 -translate-y-1/2 end-2 p-0.5 text-ink-subtle hover:text-ink cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Language & Audience Mode Filters (for Library tab) */}
            {(!isAddLayerMode || sourceTab === 'library') && (
              <>
                <div className="inline-flex items-center rounded-control border border-line bg-surface-sunken p-0.5 text-xs">
                  {[
                    { id: 'all', label: t('library.langAll') },
                    { id: 'he', label: t('library.langHe') },
                    { id: 'en', label: t('library.langEn') },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSelectedLang(opt.id)}
                      className={`px-3 py-1 rounded-control font-medium transition-colors cursor-pointer ${
                        effectiveLang === opt.id
                          ? 'bg-surface-raised text-ink font-semibold shadow-xs'
                          : 'text-ink-muted hover:text-ink'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {contentMode !== 'kids' && (
                  <div className="inline-flex items-center rounded-control border border-line bg-surface-sunken p-0.5 text-xs">
                    {[
                      { id: 'all', label: t('library.modeAll') },
                      { id: 'classic', label: t('library.modeClassic') },
                      { id: 'kids', label: t('library.modeKids') },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setSelectedMode(opt.id)}
                        className={`px-2 py-1 rounded-control font-medium transition-colors cursor-pointer ${
                          effectiveMode === opt.id
                            ? 'bg-surface-raised text-ink font-semibold shadow-xs'
                            : 'text-ink-muted hover:text-ink'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Domain Category Pills (multi-select) */}
          {(!isAddLayerMode || sourceTab === 'library') && (
            <HorizontalCapsuleScroller
              isRtl={isRtl}
              scrollLeftLabel={t('library.scrollCategoriesLeft')}
              scrollRightLabel={t('library.scrollCategoriesRight')}
              depsKey={`${language}:${isRtl}:${sourceTab}:${selectedCategories.join(',')}`}
            >
              <button
                type="button"
                onClick={() => setSelectedCategories([])}
                aria-pressed={selectedCategories.length === 0}
                className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                  selectedCategories.length === 0
                    ? 'bg-accent text-accent-fg border-accent font-semibold'
                    : 'bg-surface-sunken hover:bg-surface-hover text-ink-muted border-line'
                }`}
              >
                {t('library.catAll')}
              </button>
              {availableCategoryKeys.map((key) => {
                const isCatSelected = selectedCategories.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={isCatSelected}
                    onClick={() =>
                      setSelectedCategories((prev) =>
                        prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
                      )
                    }
                    className={`shrink-0 inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                      isCatSelected
                        ? 'bg-accent text-accent-fg border-accent font-semibold'
                        : 'bg-surface-sunken hover:bg-surface-hover text-ink-muted border-line'
                    }`}
                  >
                    {isCatSelected ? (
                      <Check className="w-3 h-3 shrink-0" />
                    ) : key === 'personal' ? (
                      <BookUser className="w-3 h-3 shrink-0 text-accent" />
                    ) : null}
                    <span>{t(`library.categories.${key}`)}</span>
                  </button>
                );
              })}
            </HorizontalCapsuleScroller>
          )}
        </div>

        {/* Cards Grid */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-2 text-ink-muted">
              <Loader2 className="w-6 h-6 animate-spin text-accent" />
              <span className="text-xs">{t('common.loading')}</span>
            </div>
          ) : activeList.length === 0 ? (
            <div className="py-14 text-center max-w-md mx-auto space-y-2">
              <div className="w-11 h-11 rounded-panel bg-surface-sunken border border-line flex items-center justify-center mx-auto text-ink-subtle">
                <BookOpen className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-ink">{t('library.emptyTitle')}</h3>
              <p className="text-xs text-ink-muted leading-relaxed">{t('library.emptyDesc')}</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-14 text-center max-w-md mx-auto space-y-3">
              <h3 className="text-sm font-bold text-ink">{t('library.noResultsTitle')}</h3>
              <p className="text-xs text-ink-muted">{t('library.noResultsDesc')}</p>
              <button
                type="button"
                onClick={resetFilters}
                className="px-4 py-2 rounded-control bg-surface-raised hover:bg-surface-hover border border-line text-xs font-semibold text-ink cursor-pointer"
              >
                {t('library.resetFilters')}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredItems.map((item) => {
                const mergeIdx = selectedForMerge.findIndex((x) => x.id === item.id);
                const isSelected = mergeIdx >= 0;
                const alreadyLayered = isAddLayerMode && activeLayerSet.has(String(item.id));
                const cardRtl = isTextRtl(`${item.title || ''} ${item.description || ''}`, isRtl);
                const yearLabel = formatYearRangeLabel(item.minYear, item.maxYear, item.timeScale, t, cardRtl);
                const primaryCatKey = item.categoryKeys?.[0];
                const hasCoverImage = Boolean(item.coverImageUrl) && !failedCoverUrls.has(item.coverImageUrl);

                return (
                  <div
                    key={item.id}
                    dir={cardRtl ? 'rtl' : 'ltr'}
                    {...getPressProps(item.id, () => handleCardPrimaryClick(item))}
                    onClick={() => (compareMode ? handleCardPrimaryClick(item) : getPressProps(item.id, () => handleCardPrimaryClick(item)).onClick())}
                    className={`group relative flex flex-col rounded-panel border overflow-hidden transition-all duration-150 ${
                      armedId === item.id ? 'is-armed ' : ''
                    }${
                      alreadyLayered
                        ? 'opacity-55 cursor-not-allowed border-line bg-surface-sunken'
                        : isSelected || armedId === item.id
                          ? 'border-accent ring-2 ring-accent/30 bg-surface-raised cursor-pointer shadow-card'
                          : 'border-line hover:border-accent/50 bg-surface-raised hover:shadow-card cursor-pointer'
                    }`}
                  >
                    {/* Cover Header */}
                    {hasCoverImage ? (
                      <div className="relative aspect-[16/10] w-full bg-white overflow-hidden shrink-0">
                        <img
                          src={item.coverImageUrl}
                          alt={item.title}
                          loading="lazy"
                          onError={() => {
                            setFailedCoverUrls((prev) => {
                              const next = new Set(prev);
                              next.add(item.coverImageUrl);
                              return next;
                            });
                          }}
                          className="w-full h-full object-cover bg-white group-hover:scale-105 transition-transform duration-300"
                          style={{
                            objectPosition: `${item.coverImagePositionX ?? 50}% ${item.coverImagePositionY ?? 50}%`,
                          }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent" />
                        <div className="absolute top-2.5 inset-x-2.5 flex items-center justify-between gap-2">
                          {primaryCatKey ? (
                            <span className="px-2 py-0.5 rounded-full text-caption font-semibold bg-black/55 text-white backdrop-blur-xs">
                              {t(`library.categories.${primaryCatKey}`)}
                            </span>
                          ) : <span />}
                          {item.isFeatured && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-caption font-semibold bg-amber-500/90 text-white shadow-xs">
                              <Star className="w-3 h-3 fill-current" />
                              <span>{t('library.featuredBadge')}</span>
                            </span>
                          )}
                        </div>
                        {yearLabel && (
                          <div className="absolute bottom-2 start-2.5 text-caption font-semibold text-white/95 drop-shadow">
                            {yearLabel}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="px-4 pt-3 flex items-center justify-between gap-2">
                        {primaryCatKey ? (
                          <span className="px-2 py-0.5 rounded-full text-caption font-semibold bg-surface-sunken text-ink-muted border border-line">
                            {t(`library.categories.${primaryCatKey}`)}
                          </span>
                        ) : (
                          <TimelineModeBadges
                            contentMode={item.contentMode || 'classic'}
                            searchMode={item.searchMode}
                            isManual={Boolean(item.isPersonal)}
                            isPersonalDemo={Boolean(item.isPersonal)}
                            mergedLayerCount={item.mergedLayerCount || 0}
                          />
                        )}
                        {item.isFeatured && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-caption font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                            <Star className="w-3 h-3 fill-current" />
                            <span>{t('library.featuredBadge')}</span>
                          </span>
                        )}
                      </div>
                    )}

                    {/* Body */}
                    <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                      <div className="space-y-2">
                        <ModalLibraryCardTitle title={item.title} isTitleRtl={isTextRtl(item.title || '', cardRtl)} />
                        {item.description && (
                          <p className="text-xs text-ink-muted line-clamp-2 leading-relaxed">
                            {item.description}
                          </p>
                        )}
                      </div>

                      <div className="space-y-3 pt-2 border-t border-line">
                        <div className="flex flex-wrap items-center gap-2 text-caption text-ink-muted">
                          <span className="inline-flex items-center gap-1 font-medium">
                            <Calendar className="w-3 h-3" />
                            {t('library.eventsCount', { count: item.articleCount || 0 })}
                          </span>
                          {item.hasPodcast && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-sunken border border-line">
                              <Headphones className="w-2.5 h-2.5 text-accent" />
                              {t('library.hasPodcast')}
                            </span>
                          )}
                          {hasCoverImage && (
                            <TimelineModeBadges
                              contentMode={item.contentMode || 'classic'}
                              searchMode={item.searchMode}
                              isManual={Boolean(item.isPersonal)}
                              isPersonalDemo={Boolean(item.isPersonal)}
                              mergedLayerCount={item.mergedLayerCount || 0}
                              className="ms-auto"
                            />
                          )}
                        </div>

                        {/* Card Actions */}
                        <div className="flex items-center justify-end gap-2">
                          {isAddLayerMode ? (
                            <span
                              className={`w-full text-center py-2 px-3 rounded-control text-xs font-semibold ${
                                alreadyLayered
                                  ? 'bg-surface-sunken text-ink-subtle'
                                  : 'bg-accent/10 text-accent group-hover:bg-accent group-hover:text-accent-fg transition-colors'
                              }`}
                            >
                              {alreadyLayered ? t('layers.alreadyInLayers') : t('layers.addSelectedLayer')}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => toggleMergeSelection(item, e)}
                              disabled={!isSelected && selectedForMerge.length >= MAX_MERGED_SOURCES}
                              className={`inline-flex items-center gap-1 px-3 py-1 rounded-control text-xs font-semibold border transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                                isSelected
                                  ? 'bg-accent text-accent-fg border-accent'
                                  : 'bg-surface hover:bg-surface-hover text-ink-muted hover:text-ink border-line'
                              }`}
                            >
                              {isSelected ? (
                                <>
                                  <Check className="w-3 h-3" />
                                  <span>{t('library.selectedForLayer', { n: mergeIdx + 1 })}</span>
                                </>
                              ) : (
                                <>
                                  <Plus className="w-3 h-3" />
                                  <span>{t('library.addToLayers')}</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Bottom Layer Merge Tray (shown in compareMode or whenever >=1 timeline is queued for layering) */}
        {!isAddLayerMode && (compareMode || selectedForMerge.length > 0) && (
          <div className="px-4 sm:px-6 py-3 border-t border-line bg-surface-raised flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex-1 min-w-0 space-y-2">
              <div className="text-xs font-semibold text-ink">
                {selectedForMerge.length < 2
                  ? t('layers.selectAtLeastTwo', { max: MAX_MERGED_SOURCES })
                  : t('layers.selectedCount', { count: selectedForMerge.length, max: MAX_MERGED_SOURCES })}
              </div>
              {selectedForMerge.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {selectedForMerge.map((sel, idx) => (
                    <div
                      key={sel.id}
                      style={{ borderInlineStartColor: LAYER_ACCENT_COLORS[idx % LAYER_ACCENT_COLORS.length] }}
                      className="inline-flex items-center gap-2 px-3 py-1 rounded-control bg-surface border border-line border-s-4 text-xs"
                    >
                      <span className="font-bold text-ink-muted">{idx + 1}.</span>
                      <span className="font-medium text-ink truncate max-w-[150px]">{sel.title}</span>
                      <button
                        type="button"
                        onClick={() => moveSelectedItem(idx, -1)}
                        disabled={idx === 0}
                        title={t('layers.moveUp')}
                        className="p-0.5 text-ink-subtle hover:text-ink disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveSelectedItem(idx, 1)}
                        disabled={idx === selectedForMerge.length - 1}
                        title={t('layers.moveDown')}
                        className="p-0.5 text-ink-subtle hover:text-ink disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedForMerge((prev) => prev.filter((x) => x.id !== sel.id))}
                        className="p-0.5 text-ink-subtle hover:text-danger cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
              {selectedForMerge.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedForMerge([])}
                  className="px-3 py-2 rounded-control text-xs font-medium text-ink-muted hover:text-ink hover:bg-surface-hover cursor-pointer"
                >
                  {t('common.clear')}
                </button>
              )}
              <button
                type="button"
                disabled={selectedForMerge.length < 2 || mergingBusy}
                onClick={handleConfirmMerge}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-control bg-accent hover:bg-accent-hover text-accent-fg text-xs font-bold shadow-control transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {mergingBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />}
                <span>{t('layers.openLayeredView', { count: selectedForMerge.length })}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Compass,
  Calendar,
  Layers,
  Star,
  Headphones,
  Check,
  Plus,
  Loader2,
  Search,
  X,
  Move,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  GripVertical,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  BookUser,
} from './icons/ThemeIcons';
import {
  fetchPublicLibrary,
  setCachedPublicLibraryItems,
  setTimelineLibraryStatus,
  reorderPublicLibrary,
  PUBLIC_LIBRARY_UPDATED_EVENT,
} from '../api';
import { useLanguage } from '../context/LanguageContext';
import { isTextRtl } from '../utils/textDirection';
import TimelineModeBadges from './TimelineModeBadges';
import HorizontalCapsuleScroller from './HorizontalCapsuleScroller';
import { formatYearRangeLabel } from '../utils/timelineArticles';
import { MAX_MERGED_SOURCES, LAYER_ACCENT_COLORS } from '../utils/mergeTimelines';
import useAutoFocalPoint from '../hooks/useAutoFocalPoint';
import useIsMobileViewport from '../hooks/useIsMobileViewport';
import useTwoTapOpen from '../hooks/useTwoTapOpen';
import { getCoverCandidates, hasAdminCoverCandidates, pickActiveCover } from '../utils/libraryCover';
import {
  shouldIgnoreEmptyLibraryStage2,
  sanitizeLibraryFacets,
  buildLibraryFacets,
  summarizeLibraryFacets,
  readStoredLibraryFacets,
  writeStoredLibraryFacets,
} from '../utils/libraryStages';

const DOMAIN_ORDER = [
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

const INITIAL_PAGE_SIZE = 6;
const PAGE_STEP = 9;
const SKELETON_CATEGORY_WIDTHS = ['w-28', 'w-32', 'w-24', 'w-28', 'w-32', 'w-24'];
const SKELETON_TITLE_WIDTHS = ['w-4/5', 'w-2/3', 'w-3/4'];
const SKELETON_DESC_SECOND_WIDTHS = ['w-3/4', 'w-5/6', 'w-2/3'];

// In-session cache so returning from an open timeline restores the library grid,
// active filters, and expanded card count synchronously on frame 1 (zero layout jump).
const homeLibrarySessionState = {
  items: null,
  searchQuery: '',
  selectedLang: 'auto', // 'auto' follows the system language until the user picks a filter
  selectedMode: 'auto', // 'auto' follows the system content mode until the user picks a filter
  selectedCategories: [],
  sortBy: 'featured',
  visibleCount: INITIAL_PAGE_SIZE,
};

const clampPercent = (value) => Math.max(0, Math.min(100, value));
const normalizeSortBy = (value) => (value === 'chronological' ? 'chronological' : 'featured');

function resolveItemLanguage(item) {
  if (item?.language === 'he' || item?.language === 'en') {
    return item.language;
  }
  return isTextRtl(item?.title || '', false) ? 'he' : 'en';
}

function itemCategoryKeys(item) {
  if (Array.isArray(item?.categoryKeys) && item.categoryKeys.length > 0) {
    return item.categoryKeys;
  }
  if (item?.category) {
    return [item.category];
  }
  return ['history'];
}

function LibraryCardSkeleton({ index = 0 }) {
  const titleWidth = SKELETON_TITLE_WIDTHS[index % SKELETON_TITLE_WIDTHS.length];
  const descSecondWidth = SKELETON_DESC_SECOND_WIDTHS[index % SKELETON_DESC_SECOND_WIDTHS.length];

  return (
    <div
      aria-hidden="true"
      className="rounded-2xl overflow-hidden bg-surface-raised/90 backdrop-blur-md border border-line flex flex-col shadow-card pointer-events-none"
    >
      <div className="relative w-full aspect-[16/10] overflow-hidden bg-surface-sunken shrink-0 home-library-skeleton">
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-ink/[0.03] via-surface-sunken to-ink/[0.06]">
          <Compass className="w-9 h-9 text-ink-faint/35 animate-pulse" />
        </div>
        <div className="absolute top-2.5 inset-x-2.5 flex items-center justify-between gap-2">
          <span className="h-5 w-20 rounded-full bg-ink/[0.06]" />
          <span className="h-5 w-14 rounded-full bg-ink/[0.06]" />
        </div>
        <div className="absolute bottom-2.5 inset-x-2.5 flex items-center justify-between gap-2">
          <span className="h-3.5 w-20 rounded-full bg-ink/[0.06]" />
        </div>
      </div>

      <div className="p-4 flex-1 flex flex-col justify-between gap-3">
        <div>
          <div className={`h-5 ${titleWidth} rounded-md bg-ink/[0.08] home-library-skeleton`} />
          <div className="mt-2 space-y-2">
            <div className="h-3.5 w-full rounded bg-ink/[0.055] home-library-skeleton" />
            <div className={`h-3.5 ${descSecondWidth} rounded bg-ink/[0.055] home-library-skeleton`} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-3 border-t border-line/60">
          <div className="flex items-center gap-2">
            <span className="h-4 w-20 rounded-full bg-ink/[0.06] home-library-skeleton" />
            <span className="h-4 w-12 rounded-full bg-ink/[0.05] home-library-skeleton" />
            <span className="h-4 w-11 rounded-full bg-ink/[0.05] home-library-skeleton" />
          </div>
        </div>
      </div>
    </div>
  );
}

function LibraryCardTitle({ title, isTitleRtl }) {
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
    <h4
      ref={containerRef}
      dir={isTitleRtl ? 'rtl' : 'ltr'}
      title={title}
      className={`font-bold text-sm sm:text-[15px] text-ink group-hover:text-accent transition-colors overflow-hidden whitespace-nowrap ${
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
    </h4>
  );
}

function LibraryCardCover({
  item,
  primaryCategoryLabel,
  yearRange,
  selectedIdx,
  layerColor,
  canSelectMore,
  onToggleSelectForMerge,
  isAdmin,
  isRtl,
  isReordering = false,
  orderIndex = 0,
  totalOrderCount = 0,
  onMoveEarlier,
  onMoveLater,
  onMoveFirst,
  onAdminUpdateCover,
  onAdminToggleFeatured,
  onPositioningChange,
  eagerLoad = false,
  t,
}) {
  const isSelected = selectedIdx >= 0;
  const [failedUrls, setFailedUrls] = useState(() => new Set());
  const [loadedSrc, setLoadedSrc] = useState(null);
  const [isPositioning, setIsPositioning] = useState(false);

  const frameRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null);

  const candidates = useMemo(
    () => getCoverCandidates(item, failedUrls),
    [item.coverImageCandidates, item.coverImageUrl, failedUrls]
  );

  const activeSrc = useMemo(
    () => pickActiveCover(item, candidates, failedUrls),
    [item.coverImageUrl, candidates, failedUrls]
  );

  const activeIndex = useMemo(() => {
    if (!activeSrc || candidates.length === 0) return -1;
    const idx = candidates.indexOf(activeSrc);
    return idx >= 0 ? idx : 0;
  }, [activeSrc, candidates]);

  const hasSavedPosition = item.coverImagePositionX != null && item.coverImagePositionY != null;
  const autoPosition = useAutoFocalPoint(activeSrc, frameRef, !hasSavedPosition && loadedSrc === activeSrc);

  const [position, setPosition] = useState({
    x: item.coverImagePositionX ?? 50,
    y: item.coverImagePositionY ?? 50,
  });
  const positionRef = useRef(position);
  positionRef.current = position;

  useEffect(() => {
    if (dragRef.current) return;
    setPosition({
      x: item.coverImagePositionX ?? autoPosition?.x ?? 50,
      y: item.coverImagePositionY ?? autoPosition?.y ?? 50,
    });
  }, [activeSrc, item.coverImagePositionX, item.coverImagePositionY, autoPosition?.x, autoPosition?.y]);

  const setPositioningMode = useCallback((nextVal) => {
    setIsPositioning(nextVal);
    onPositioningChange?.(nextVal);
  }, [onPositioningChange]);

  useEffect(() => {
    return () => {
      onPositioningChange?.(false);
    };
  }, [onPositioningChange]);

  const handlePointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const image = imageRef.current;
    if (!image?.naturalWidth || !image?.naturalHeight) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      position: positionRef.current,
      moved: false,
    };
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    const image = imageRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !image) return;
    const rect = image.getBoundingClientRect();
    const coverScale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
    const overflowX = Math.max(0, image.naturalWidth * coverScale - rect.width);
    const overflowY = Math.max(0, image.naturalHeight * coverScale - rect.height);
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    const next = {
      x: overflowX > 0 ? clampPercent(drag.position.x - (dx / overflowX) * 100) : drag.position.x,
      y: overflowY > 0 ? clampPercent(drag.position.y - (dy / overflowY) * 100) : drag.position.y,
    };
    positionRef.current = next;
    setPosition(next);
  };

  const handlePointerEnd = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (drag.moved) {
      const rx = Math.round(positionRef.current.x * 10) / 10;
      const ry = Math.round(positionRef.current.y * 10) / 10;
      onAdminUpdateCover?.(item.id, {
        coverImagePositionX: rx,
        coverImagePositionY: ry,
      });
    }
  };

  const handleCycleImage = (delta, e) => {
    e.stopPropagation();
    if (candidates.length <= 1) return;
    const nextIdx = (activeIndex + delta + candidates.length) % candidates.length;
    const nextUrl = candidates[nextIdx];
    if (!nextUrl || nextUrl === activeSrc) return;
    onAdminUpdateCover?.(item.id, {
      coverImageUrl: nextUrl,
      coverImagePositionX: null,
      coverImagePositionY: null,
    });
  };

  const dragLabel = t('eventDrawer.dragImageToPosition');

  return (
    <div
      ref={frameRef}
      className={`relative w-full aspect-[16/10] overflow-hidden shrink-0 ${
        activeSrc ? 'bg-white' : 'bg-surface-sunken'
      }`}
    >
      {activeSrc ? (
        <img
          ref={imageRef}
          src={activeSrc}
          alt={item.title}
          loading={eagerLoad ? 'eager' : 'lazy'}
          fetchPriority={eagerLoad ? 'high' : undefined}
          decoding="async"
          draggable={false}
          onLoad={() => setLoadedSrc(activeSrc)}
          onError={() => {
            setFailedUrls((prev) => {
              const next = new Set(prev);
              next.add(activeSrc);
              return next;
            });
          }}
          className={`w-full h-full object-cover bg-white select-none pointer-events-none ${
            isPositioning ? '' : 'group-hover:scale-[1.03] transition-transform duration-300'
          }`}
          style={{
            objectPosition: `${position.x}% ${position.y}%`,
          }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-accent/15 via-surface-sunken to-amber-500/10">
          <Compass className="w-10 h-10 text-accent/45 group-hover:scale-110 transition-transform duration-300" />
        </div>
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent pointer-events-none" />

      {/* Top Badges, Admin 1-Click Featured Star, Reorder Controls & + Layer Toggle */}
      {!isPositioning && (
        <div className="absolute top-2.5 inset-x-2.5 flex items-center justify-between gap-2 z-[2]">
          <div className="flex items-center gap-1 min-w-0">
            {isReordering && (
              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-caption font-extrabold font-mono bg-accent text-accent-fg shadow-xs shrink-0">
                <GripVertical className="w-2.5 h-2.5 opacity-85" />
                <span>#{orderIndex + 1}</span>
              </span>
            )}
            {isAdmin ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAdminToggleFeatured?.(item.id, !item.isFeatured);
                }}
                aria-pressed={Boolean(item.isFeatured)}
                title={item.isFeatured ? t('library.adminCardUnfeatureTip') : t('library.adminCardFeatureTip')}
                aria-label={item.isFeatured ? t('library.adminCardUnfeatureTip') : t('library.adminCardFeatureTip')}
                className={`inline-flex items-center gap-1 rounded-full text-caption font-bold shadow-xs shrink-0 transition-all cursor-pointer ${
                  item.isFeatured
                    ? 'px-2 py-0.5 bg-amber-400/95 hover:bg-amber-300 text-[#1c1a18]'
                    : `p-1 bg-black/55 hover:bg-amber-400/95 text-white/90 hover:text-[#1c1a18] backdrop-blur-sm border border-white/20 hover:border-amber-300 ${
                        isReordering
                          ? 'opacity-95'
                          : 'opacity-90 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100'
                      }`
                }`}
              >
                <Star className={`w-2.5 h-2.5 ${item.isFeatured ? 'fill-current' : ''}`} />
                {item.isFeatured && !isReordering && <span>{t('library.featuredBadge')}</span>}
              </button>
            ) : (
              item.isFeatured && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-caption font-bold bg-amber-400/95 text-[#1c1a18] shadow-xs shrink-0">
                  <Star className="w-2.5 h-2.5 fill-current" />
                  <span>{t('library.featuredBadge')}</span>
                </span>
              )
            )}
            {primaryCategoryLabel && (
              <span className="px-2 py-0.5 rounded-full text-caption font-semibold bg-black/55 text-white backdrop-blur-sm border border-white/15 truncate">
                {primaryCategoryLabel}
              </span>
            )}
          </div>

          {isReordering && isAdmin ? (
            <div
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              className="inline-flex items-center rounded-full bg-black/75 text-white backdrop-blur-md border border-white/25 shadow-pop shrink-0 overflow-hidden"
            >
              {orderIndex > 1 && onMoveFirst && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveFirst();
                    }}
                    title={t('library.reorderMoveFirst')}
                    aria-label={t('library.reorderMoveFirst')}
                    className="px-2 h-6 flex items-center justify-center text-caption font-bold font-mono text-amber-300 hover:bg-white/15 transition-colors cursor-pointer"
                  >
                    #1
                  </button>
                  <span className="w-px h-3.5 bg-white/20" aria-hidden="true" />
                </>
              )}
              <button
                type="button"
                disabled={orderIndex <= 0}
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveEarlier?.();
                }}
                title={t('library.reorderMoveEarlier')}
                aria-label={t('library.reorderMoveEarlier')}
                className="w-6 h-6 flex items-center justify-center hover:bg-white/15 disabled:opacity-35 cursor-pointer disabled:cursor-default transition-colors"
              >
                {isRtl ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
              </button>
              <span className="w-px h-3.5 bg-white/20" aria-hidden="true" />
              <button
                type="button"
                disabled={orderIndex >= totalOrderCount - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveLater?.();
                }}
                title={t('library.reorderMoveLater')}
                aria-label={t('library.reorderMoveLater')}
                className="w-6 h-6 flex items-center justify-center hover:bg-white/15 disabled:opacity-35 cursor-pointer disabled:cursor-default transition-colors"
              >
                {isRtl ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            </div>
          ) : (
            onToggleSelectForMerge && (
              <button
                type="button"
                onClick={(e) => onToggleSelectForMerge(item.id, e)}
                aria-pressed={isSelected}
                disabled={!isSelected && !canSelectMore}
                title={t('library.compareToggleTooltip')}
                className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-caption font-bold transition-all cursor-pointer disabled:cursor-not-allowed shadow-xs shrink-0 ${
                  isSelected
                    ? 'text-white'
                    : 'bg-black/60 hover:bg-black/80 text-white backdrop-blur-sm border border-white/20 disabled:opacity-40'
                }`}
                style={isSelected ? { backgroundColor: layerColor } : undefined}
              >
                {isSelected ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                <span>
                  {isSelected
                    ? t('library.selectedForLayer', { n: selectedIdx + 1 })
                    : t('library.addAsLayerBtn')}
                </span>
              </button>
            )
          )}
        </div>
      )}

      {/* Bottom Year Range, Podcast Indicator & Admin Cover Tools */}
      <div className="absolute bottom-2.5 inset-x-2.5 flex items-center justify-between gap-2 text-white text-caption font-medium z-20 pointer-events-none">
        <span className={`truncate font-mono drop-shadow-xs ${isPositioning ? 'opacity-0' : ''}`}>
          {yearRange}
        </span>

        <div className="flex items-center gap-2 shrink-0 pointer-events-auto">
          {!isReordering && isAdmin && activeSrc && (
            <div
              dir="ltr"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              className={`inline-flex items-center rounded-full border backdrop-blur-md shadow-pop transition-opacity ${
                isPositioning
                  ? 'bg-accent text-accent-fg border-accent opacity-100'
                  : 'bg-black/65 text-white border-white/20 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100'
              }`}
            >
              {!isPositioning && candidates.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={(e) => handleCycleImage(-1, e)}
                    title={t('library.coverPrevPhoto')}
                    aria-label={t('library.coverPrevPhoto')}
                    className="w-6 h-6 flex items-center justify-center rounded-l-full hover:bg-white/15 transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-caption font-mono px-1 text-white/85 select-none">
                    {activeIndex + 1}/{candidates.length}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => handleCycleImage(1, e)}
                    title={t('library.coverNextPhoto')}
                    aria-label={t('library.coverNextPhoto')}
                    className="w-6 h-6 flex items-center justify-center hover:bg-white/15 transition-colors cursor-pointer"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <span className="w-px h-3 bg-white/20" aria-hidden="true" />
                </>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPositioningMode(!isPositioning);
                }}
                aria-pressed={isPositioning}
                title={isPositioning ? t('common.confirm') : t('library.coverPositionBtn')}
                aria-label={isPositioning ? t('common.confirm') : t('library.coverPositionBtn')}
                className={`flex items-center justify-center cursor-pointer transition-colors ${
                  isPositioning
                    ? 'px-3 h-7 gap-1 text-xs font-semibold'
                    : `w-6 h-6 hover:bg-white/15 ${candidates.length > 1 ? 'rounded-r-full' : 'rounded-full'}`
                }`}
              >
                {isPositioning ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>{t('common.confirm')}</span>
                  </>
                ) : (
                  <Move className="w-3 h-3" />
                )}
              </button>
            </div>
          )}

          {!isPositioning && item.hasPodcast && (
            <span title={t('library.hasPodcastBadge')} className="p-1 rounded-full bg-black/45 backdrop-blur-xs pointer-events-none">
              <Headphones className="w-3 h-3 text-amber-300" />
            </span>
          )}
        </div>
      </div>

      {/* Admin Active Drag Surface */}
      {isAdmin && isPositioning && (
        <div
          className="absolute inset-0 z-10 touch-none cursor-move bg-black/20 backdrop-blur-[0.5px]"
          role="application"
          aria-label={dragLabel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="absolute left-1/2 top-2.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/75 backdrop-blur-md px-3 py-1 text-caption font-semibold text-white pointer-events-none shadow-pop border border-white/20">
            {dragLabel}
          </span>
        </div>
      )}
    </div>
  );
}

export default function HomeLibrarySection({
  onSelectTimeline,
  onMergeTimelines,
  onAvailabilityChange,
  onOpenBuildPersonal,
  isAdmin = false,
  disabled = false,
}) {
  const { t, language, isRtl, contentMode } = useLanguage();
  const isMobile = useIsMobileViewport();
  const { armedId, getPressProps } = useTwoTapOpen(isMobile);
  const [items, setItems] = useState(() => homeLibrarySessionState.items || []);
  const [loaded, setLoaded] = useState(() => homeLibrarySessionState.items !== null);
  const [isLoadingRest, setIsLoadingRest] = useState(false);
  const [stage1Total, setStage1Total] = useState(0);
  // Whole-catalog category facets used only while the catalog is still loading, so the category row
  // is complete from the start: the server's (fast first page) win over the last-known local copy.
  const [pendingFacets, setPendingFacets] = useState(() =>
    homeLibrarySessionState.items === null ? readStoredLibraryFacets() : null
  );

  const [searchQuery, setSearchQuery] = useState(() => homeLibrarySessionState.searchQuery);
  const [selectedLang, setSelectedLang] = useState(() => homeLibrarySessionState.selectedLang);
  const [selectedMode, setSelectedMode] = useState(() => homeLibrarySessionState.selectedMode);
  const [selectedCategories, setSelectedCategories] = useState(() => homeLibrarySessionState.selectedCategories);
  const [sortBy, setSortBy] = useState(() => normalizeSortBy(homeLibrarySessionState.sortBy));
  const [visibleCount, setVisibleCount] = useState(() => homeLibrarySessionState.visibleCount);

  const [selectedIds, setSelectedIds] = useState([]);
  const [mergingBusy, setMergingBusy] = useState(false);
  const [positioningCardId, setPositioningCardId] = useState(null);
  const [isReordering, setIsReordering] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [draggedCardId, setDraggedCardId] = useState(null);
  const [dragOverCardId, setDragOverCardId] = useState(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const isReorderingRef = useRef(isReordering);
  isReorderingRef.current = isReordering;
  const orderSaveStateRef = useRef({ inFlight: false, queuedIds: null });

  // Sync session state cache whenever catalog or filter state updates
  useEffect(() => {
    homeLibrarySessionState.searchQuery = searchQuery;
    homeLibrarySessionState.selectedLang = selectedLang;
    homeLibrarySessionState.selectedMode = selectedMode;
    homeLibrarySessionState.selectedCategories = selectedCategories;
    homeLibrarySessionState.sortBy = normalizeSortBy(sortBy);
    homeLibrarySessionState.visibleCount = visibleCount;
  }, [searchQuery, selectedLang, selectedMode, selectedCategories, sortBy, visibleCount]);

  useEffect(() => {
    if (!isAdmin && isReordering) {
      setIsReordering(false);
      setDraggedCardId(null);
      setDragOverCardId(null);
    }
  }, [isAdmin, isReordering]);

  const reloadLibraryRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let stage1Count = 0;
      try {
        // Stage 1 (Fast First Page): when cold, fetch just the initial 6 visible cards for the active
        // language/mode so the first row renders almost immediately, while Stage 2 hydrates the full catalog.
        if (homeLibrarySessionState.items === null) {
          const initLang =
            homeLibrarySessionState.selectedLang === 'auto'
              ? (language === 'he' ? 'he' : 'en')
              : homeLibrarySessionState.selectedLang;
          const initMode =
            contentMode === 'kids'
              ? 'kids'
              : homeLibrarySessionState.selectedMode === 'auto'
                ? contentMode
                : homeLibrarySessionState.selectedMode;
          try {
            const firstRes = await fetchPublicLibrary({
              lang: initLang,
              contentMode: initMode,
              limit: INITIAL_PAGE_SIZE,
            });
            const firstList = Array.isArray(firstRes)
              ? firstRes
              : Array.isArray(firstRes?.items)
                ? firstRes.items
                : [];
            const serverFacets = sanitizeLibraryFacets(firstRes?.facets);
            if (!cancelled && serverFacets && homeLibrarySessionState.items === null) {
              setPendingFacets(serverFacets);
            }
            if (!cancelled && firstList.length > 0 && homeLibrarySessionState.items === null) {
              stage1Count = firstList.length;
              setItems(firstList);
              setStage1Total(typeof firstRes?.total === 'number' ? firstRes.total : firstList.length);
              setLoaded(true);
              setIsLoadingRest(true);
            }
          } catch {
            // Fall through to full catalog load if fast-page fails
          }
        }

        // Stage 2 (Background Full Catalog): hydrate all items for instant client-side filtering & pagination
        const res = await fetchPublicLibrary({ limit: 200 });
        let list = Array.isArray(res) ? res : (Array.isArray(res?.items) ? res.items : []);
        // More than one page of Library timelines (B-23): fetch the rest (the API caps offset at 500).
        const total = typeof res?.total === 'number' ? res.total : list.length;
        while (!cancelled && list.length > 0 && list.length < total && list.length <= 500) {
          const more = await fetchPublicLibrary({ limit: 200, offset: list.length }).catch(() => null);
          const seen = new Set(list.map((it) => it?.id));
          const page = (Array.isArray(more?.items) ? more.items : []).filter((it) => !seen.has(it?.id));
          if (page.length === 0) break;
          list = [...list, ...page];
        }
        if (!cancelled && shouldIgnoreEmptyLibraryStage2(list, stage1Count)) {
          // A transient server error can answer 200 with []: keep the cards already shown (B-23).
          setLoaded(true);
          setIsLoadingRest(false);
          return;
        }
        if (!cancelled) {
          homeLibrarySessionState.items = list;
          setCachedPublicLibraryItems(list);
          writeStoredLibraryFacets(buildLibraryFacets(list, resolveItemLanguage, itemCategoryKeys));
          setPendingFacets(null);
          setItems(list);
          setLoaded(true);
          setIsLoadingRest(false);
          setStage1Total(0);
        }
      } catch {
        if (!cancelled) {
          if (homeLibrarySessionState.items === null) {
            homeLibrarySessionState.items = [];
            setItems([]);
          }
          setLoaded(true);
          setIsLoadingRest(false);
        }
      }
    };
    load();
    reloadLibraryRef.current = load;

    const handleRefresh = () => {
      load();
    };
    window.addEventListener(PUBLIC_LIBRARY_UPDATED_EVENT, handleRefresh);
    return () => {
      cancelled = true;
      reloadLibraryRef.current = null;
      window.removeEventListener(PUBLIC_LIBRARY_UPDATED_EVENT, handleRefresh);
    };
  }, []);

  // Cover candidates are only sent on an admin's authenticated request: if admin status arrives
  // after a list loaded without them (e.g. signed in mid-session), reload once so cover cycling works.
  const adminReloadDoneRef = useRef(false);
  useEffect(() => {
    if (!isAdmin || !loaded || adminReloadDoneRef.current) return;
    if (hasAdminCoverCandidates(items)) return;
    adminReloadDoneRef.current = true;
    reloadLibraryRef.current?.();
  }, [isAdmin, loaded, items]);

  // Strict child-safety pool: when global site mode is 'kids', strictly restrict to 'kids' timelines.
  const safePool = useMemo(() => {
    if (!Array.isArray(items) || items.length === 0) return [];
    if (contentMode === 'kids') {
      return items.filter((item) => (item.contentMode || 'classic') === 'kids');
    }
    return items;
  }, [items, contentMode]);

  const effectiveLang = selectedLang === 'auto' ? (language === 'he' ? 'he' : 'en') : selectedLang;
  const effectiveModeFilter = contentMode === 'kids' ? 'kids' : (selectedMode === 'auto' ? contentMode : selectedMode);

  // Language & Age/Mode filtered pool (used to compute accurate category counts)
  const langAndModePool = useMemo(() => {
    if (safePool.length === 0) return [];
    return safePool.filter((item) => {
      if (effectiveLang !== 'all' && resolveItemLanguage(item) !== effectiveLang) {
        return false;
      }
      if (effectiveModeFilter !== 'all' && (item.contentMode || 'classic') !== effectiveModeFilter) {
        return false;
      }
      return true;
    });
  }, [safePool, effectiveLang, effectiveModeFilter]);

  const getItemCategories = useCallback(itemCategoryKeys, []);

  // Until the full catalog lands (Stage 2), the loaded cards are only a slice of the Library.
  const isCatalogPending = !loaded || isLoadingRest;
  const facetSummary = useMemo(
    () =>
      isCatalogPending && pendingFacets
        ? summarizeLibraryFacets(pendingFacets, {
            lang: effectiveLang,
            mode: effectiveModeFilter,
            kidsOnly: contentMode === 'kids',
          })
        : null,
    [isCatalogPending, pendingFacets, effectiveLang, effectiveModeFilter, contentMode]
  );

  const allSafeCategories = useMemo(() => {
    const present = new Set(facetSummary ? facetSummary.present : []);
    safePool.forEach((item) => {
      getItemCategories(item).forEach((cat) => present.add(cat));
    });
    return DOMAIN_ORDER.filter((cat) => present.has(cat));
  }, [safePool, getItemCategories, facetSummary]);

  // Counts of the cards actually loaded: a category with none yet can't be filtered to.
  const loadedCategoryCounts = useMemo(() => {
    const counts = new Map();
    langAndModePool.forEach((item) => {
      getItemCategories(item).forEach((cat) => {
        counts.set(cat, (counts.get(cat) || 0) + 1);
      });
    });
    return counts;
  }, [langAndModePool, getItemCategories]);

  // Counts shown on the pills: whole-catalog facets while loading (never below what is loaded).
  const categoryCounts = useMemo(() => {
    if (!facetSummary) return loadedCategoryCounts;
    const counts = new Map(facetSummary.counts);
    loadedCategoryCounts.forEach((n, cat) => counts.set(cat, Math.max(n, counts.get(cat) || 0)));
    return counts;
  }, [facetSummary, loadedCategoryCounts]);

  // Show categories that exist in the active language/age slice, plus any currently selected category
  // so the user can always uncheck an active category pill.
  const visibleCategoryKeys = useMemo(
    () => allSafeCategories.filter((cat) => (categoryCounts.get(cat) || 0) > 0 || selectedCategories.includes(cat)),
    [allSafeCategories, categoryCounts, selectedCategories]
  );
  // Without facets, counts from a partial catalog would mislead: they are hidden until it lands.
  const showCategoryCounts = !isCatalogPending || Boolean(facetSummary);

  // Drop selected categories that no longer exist anywhere in safePool
  useEffect(() => {
    if (selectedCategories.length === 0) return;
    const valid = selectedCategories.filter((cat) => allSafeCategories.includes(cat));
    if (valid.length !== selectedCategories.length) {
      setSelectedCategories(valid);
    }
  }, [allSafeCategories, selectedCategories]);

  const compareFeatured = useCallback(
    (a, b) => {
      const aHasOrder = typeof a.featuredOrder === 'number' && Number.isFinite(a.featuredOrder);
      const bHasOrder = typeof b.featuredOrder === 'number' && Number.isFinite(b.featuredOrder);
      const aGroup = aHasOrder ? 0 : (a.isFeatured ? -1 : 1);
      const bGroup = bHasOrder ? 0 : (b.isFeatured ? -1 : 1);
      if (aGroup !== bGroup) return aGroup - bGroup;
      if (aGroup === 0 && a.featuredOrder !== b.featuredOrder) {
        return a.featuredOrder - b.featuredOrder;
      }
      const aFeat = a.isFeatured ? 1 : 0;
      const bFeat = b.isFeatured ? 1 : 0;
      if (aFeat !== bFeat) return bFeat - aFeat;
      const aLang = resolveItemLanguage(a) === language ? 1 : 0;
      const bLang = resolveItemLanguage(b) === language ? 1 : 0;
      if (aLang !== bLang) return bLang - aLang;
      const aMode = (a.contentMode || 'classic') === contentMode ? 1 : 0;
      const bMode = (b.contentMode || 'classic') === contentMode ? 1 : 0;
      if (aMode !== bMode) return bMode - aMode;
      const byDate = String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      if (byDate !== 0) return byDate;
      return String(a.title || '').localeCompare(String(b.title || ''));
    },
    [language, contentMode]
  );

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matched = langAndModePool.filter((item) => {
      if (selectedCategories.length > 0) {
        const itemCats = getItemCategories(item);
        if (!itemCats.some((c) => selectedCategories.includes(c))) {
          return false;
        }
      }
      if (!q) return true;
      const haystack = [
        item.title,
        item.description,
        ...(Array.isArray(item.tags) ? item.tags : []),
        ...(Array.isArray(item.categories) ? item.categories : []),
        ...getItemCategories(item).map((k) => t(`library.categories.${k}`)),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });

    return [...matched].sort((a, b) => {
      if (sortBy === 'chronological') {
        const aHasMin = typeof a.minYear === 'number' && Number.isFinite(a.minYear);
        const bHasMin = typeof b.minYear === 'number' && Number.isFinite(b.minYear);
        if (aHasMin !== bHasMin) return aHasMin ? -1 : 1;
        if (aHasMin && bHasMin && a.minYear !== b.minYear) {
          return a.minYear - b.minYear;
        }
        const aMax = typeof a.maxYear === 'number' && Number.isFinite(a.maxYear) ? a.maxYear : 0;
        const bMax = typeof b.maxYear === 'number' && Number.isFinite(b.maxYear) ? b.maxYear : 0;
        if (aMax !== bMax) return aMax - bMax;
        return String(a.title || '').localeCompare(String(b.title || ''));
      }
      return compareFeatured(a, b);
    });
  }, [
    langAndModePool,
    selectedCategories,
    searchQuery,
    sortBy,
    compareFeatured,
    getItemCategories,
    t,
  ]);

  const visibleCards = useMemo(
    () => filteredItems.slice(0, visibleCount),
    [filteredItems, visibleCount]
  );

  const isInitialLoading = !loaded;
  const isSectionVisible = isInitialLoading || safePool.length > 0;

  useEffect(() => {
    onAvailabilityChange?.(isSectionVisible);
  }, [isSectionVisible, onAvailabilityChange]);

  const handleSearchChange = (val) => {
    setSearchQuery(val);
    setVisibleCount(INITIAL_PAGE_SIZE);
  };

  const handleLangChange = (langId) => {
    setSelectedLang(langId);
    setVisibleCount(INITIAL_PAGE_SIZE);
  };

  const handleModeChange = (modeId) => {
    setSelectedMode(modeId);
    setVisibleCount(INITIAL_PAGE_SIZE);
  };

  const handleSortChange = (nextSort) => {
    const normalized = normalizeSortBy(nextSort);
    setSortBy(normalized);
    if (normalized !== 'featured') {
      setIsReordering(false);
      setDraggedCardId(null);
      setDragOverCardId(null);
    }
    setVisibleCount(INITIAL_PAGE_SIZE);
  };

  const handleToggleCategory = (cat) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
    setVisibleCount(INITIAL_PAGE_SIZE);
  };

  const handleClearCategories = () => {
    setSelectedCategories([]);
    setVisibleCount(INITIAL_PAGE_SIZE);
  };

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedLang('all');
    setSelectedMode('all');
    setSelectedCategories([]);
    setVisibleCount(INITIAL_PAGE_SIZE);
  };

  const persistLibraryOrder = useCallback(async (orderedIds) => {
    const state = orderSaveStateRef.current;
    state.queuedIds = orderedIds;
    if (state.inFlight) return;

    state.inFlight = true;
    setSavingOrder(true);
    try {
      while (state.queuedIds) {
        const nextBatch = state.queuedIds;
        state.queuedIds = null;
        await reorderPublicLibrary(nextBatch, { silent: true });
      }
    } catch (err) {
      console.error('Failed saving library order:', err);
    } finally {
      state.inFlight = false;
      setSavingOrder(false);
    }
  }, []);

  const handleMoveFeaturedCard = useCallback(
    (fromFilteredIdx, toFilteredIdx) => {
      if (
        !isAdmin ||
        fromFilteredIdx === toFilteredIdx ||
        fromFilteredIdx < 0 ||
        toFilteredIdx < 0 ||
        fromFilteredIdx >= filteredItems.length ||
        toFilteredIdx >= filteredItems.length
      ) {
        return;
      }

      const nextFilteredIds = filteredItems.map((it) => it.id);
      const [movedId] = nextFilteredIds.splice(fromFilteredIdx, 1);
      nextFilteredIds.splice(toFilteredIdx, 0, movedId);

      const visibleSet = new Set(nextFilteredIds);
      const fullSorted = [...itemsRef.current].sort(compareFeatured);
      let cursor = 0;
      const nextFullIds = fullSorted.map((it) =>
        visibleSet.has(it.id) ? nextFilteredIds[cursor++] : it.id
      );

      const orderMap = new Map(nextFullIds.map((id, idx) => [id, idx]));
      setItems((prev) => {
        const nextList = prev.map((entry) =>
          orderMap.has(entry.id)
            ? { ...entry, featuredOrder: orderMap.get(entry.id) }
            : entry
        );
        homeLibrarySessionState.items = nextList;
        setCachedPublicLibraryItems(nextList);
        return nextList;
      });

      persistLibraryOrder(nextFullIds);
    },
    [isAdmin, filteredItems, compareFeatured, persistLibraryOrder]
  );

  const handleAdminUpdateCover = useCallback(async (timelineId, updates) => {
    setItems((prev) => {
      const nextList = prev.map((entry) => {
        if (entry.id !== timelineId) return entry;
        const next = { ...entry };
        if ('coverImageUrl' in updates) {
          next.coverImageUrl = updates.coverImageUrl;
        }
        if ('coverImagePositionX' in updates) {
          next.coverImagePositionX = updates.coverImagePositionX;
          next.coverImagePositionY = updates.coverImagePositionY;
        }
        return next;
      });
      homeLibrarySessionState.items = nextList;
      setCachedPublicLibraryItems(nextList);
      return nextList;
    });

    try {
      const payload = { silent: true };
      if ('coverImageUrl' in updates) {
        payload.coverImageUrl = updates.coverImageUrl;
      }
      if (typeof updates.coverImagePositionX === 'number' && typeof updates.coverImagePositionY === 'number') {
        payload.coverImagePositionX = updates.coverImagePositionX;
        payload.coverImagePositionY = updates.coverImagePositionY;
      }
      await setTimelineLibraryStatus(timelineId, payload);
    } catch (err) {
      console.error('Failed saving cover image customization:', err);
    }
  }, []);

  const handleAdminToggleFeatured = useCallback(async (timelineId, nextFeatured) => {
    const prevTarget = itemsRef.current.find((entry) => entry.id === timelineId);
    const prevFeaturedOrder = prevTarget?.featuredOrder ?? null;
    const keepCurrentSlot =
      isReorderingRef.current &&
      typeof prevFeaturedOrder === 'number' &&
      Number.isFinite(prevFeaturedOrder);
    const optimisticOrder = nextFeatured
      ? (keepCurrentSlot ? prevFeaturedOrder : null)
      : prevFeaturedOrder;

    setItems((prev) => {
      const nextList = prev.map((entry) =>
        entry.id === timelineId
          ? { ...entry, isFeatured: nextFeatured, featuredOrder: optimisticOrder }
          : entry
      );
      homeLibrarySessionState.items = nextList;
      setCachedPublicLibraryItems(nextList);
      return nextList;
    });

    try {
      const payload = { isFeatured: nextFeatured, silent: true };
      if (keepCurrentSlot) {
        payload.featuredOrder = prevFeaturedOrder;
      }
      await setTimelineLibraryStatus(timelineId, payload);
    } catch (err) {
      console.error('Failed toggling featured status:', err);
      setItems((prev) => {
        const reverted = prev.map((entry) =>
          entry.id === timelineId
            ? { ...entry, isFeatured: !nextFeatured, featuredOrder: prevFeaturedOrder }
            : entry
        );
        homeLibrarySessionState.items = reverted;
        setCachedPublicLibraryItems(reverted);
        return reverted;
      });
    }
  }, []);

  if (!isSectionVisible) {
    return null;
  }

  const toggleSelectForMerge = (id, e) => {
    e.stopPropagation();
    if (disabled || mergingBusy) return;
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= MAX_MERGED_SOURCES) {
        return prev;
      }
      return [...prev, id];
    });
  };

  const moveSelectedLayer = (idx, delta) => {
    setSelectedIds((prev) => {
      const nextIdx = idx + delta;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(idx, 1);
      copy.splice(nextIdx, 0, moved);
      return copy;
    });
  };

  const removeSelectedLayer = (id) => {
    setSelectedIds((prev) => prev.filter((x) => x !== id));
  };

  const handleLaunchMerge = async () => {
    if (selectedIds.length < 2 || mergingBusy || disabled) return;
    setMergingBusy(true);
    try {
      await onMergeTimelines?.(selectedIds);
      setSelectedIds([]);
    } finally {
      setMergingBusy(false);
    }
  };

  const effectiveReordering =
    isAdmin && sortBy === 'featured' && isReordering && filteredItems.length > 1;
  const displayedCards = effectiveReordering ? filteredItems : visibleCards;
  const totalPoolCount = facetSummary
    ? Math.max(facetSummary.total, langAndModePool.length)
    : isLoadingRest && stage1Total > langAndModePool.length
      ? stage1Total
      : langAndModePool.length;
  // While loading, the expected number of cards for the active filters (drives the "rest" skeletons).
  const pendingFilteredTotal = (() => {
    if (!isLoadingRest || searchQuery.trim()) return 0;
    if (selectedCategories.length === 0) return totalPoolCount;
    if (facetSummary && selectedCategories.length === 1) return categoryCounts.get(selectedCategories[0]) || 0;
    return 0;
  })();
  const effectiveFilteredTotal = Math.max(filteredItems.length, pendingFilteredTotal);
  const remainingCount = effectiveReordering
    ? 0
    : Math.max(0, effectiveFilteredTotal - visibleCount);
  const pendingRestSkeletonCount =
    !effectiveReordering && isLoadingRest && visibleCount > displayedCards.length
      ? Math.max(0, Math.min(visibleCount, effectiveFilteredTotal) - displayedCards.length)
      : 0;

  return (
    <section
      id="home-public-library"
      aria-busy={isInitialLoading}
      className="w-full max-w-[1160px] mx-auto px-4 sm:px-6 lg:px-8 mt-12 sm:mt-20 pt-8 sm:pt-12 pb-6 scroll-mt-4 sm:scroll-mt-6 select-none"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Subtle full-width visual separator from the Hero screen above */}
      <div
        className="w-full max-w-3xl mx-auto h-px bg-gradient-to-r from-transparent via-line-strong/75 to-transparent mb-8 sm:mb-10"
        aria-hidden="true"
      />

      {/* Header Row + Always-Visible Search */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-4 text-start">
        <div className="space-y-1">
          <h3 className="text-lg sm:text-2xl font-bold text-ink tracking-tight">
            {t('library.homeSectionTitle')}
          </h3>
          <p className="text-xs sm:text-sm text-ink-muted max-w-2xl">
            {t('library.homeSectionSubtitle')}
          </p>
        </div>

        <div className="relative w-full sm:w-72 md:w-80 shrink-0">
          <Search className="w-3.5 h-3.5 text-ink-subtle absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={t('library.searchPlaceholder')}
            aria-label={t('library.searchPlaceholder')}
            className="w-full ps-8 pe-8 py-2 rounded-full bg-surface-raised/85 hover:bg-surface-raised focus:bg-surface-raised border border-line focus:border-accent/60 text-xs text-ink placeholder:text-ink-subtle outline-none shadow-control transition-colors"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => handleSearchChange('')}
              aria-label={t('common.close')}
              className="absolute top-1/2 -translate-y-1/2 end-2.5 p-0.5 rounded-full text-ink-subtle hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : isInitialLoading ? (
            <span
              aria-hidden="true"
              className="absolute inset-y-0 end-3 flex items-center pointer-events-none"
            >
              <Loader2 className="w-3.5 h-3.5 text-ink-subtle/75 animate-spin" />
            </span>
          ) : null}
        </div>
      </div>

      {/* Filter & Sort Controls Row: Language + Age Suitability + Sort */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 text-start">
        <div className="flex flex-wrap items-center gap-2">
          {/* Language Filter */}
          <div
            role="group"
            aria-label={t('library.langAll')}
            className="inline-flex items-center p-0.5 rounded-full bg-surface-raised/85 border border-line shadow-2xs"
          >
            {[
              { id: 'all', label: t('library.langAll') },
              { id: 'he', label: t('library.langHe') },
              { id: 'en', label: t('library.langEn') },
            ].map((opt) => {
              const active = effectiveLang === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleLangChange(opt.id)}
                  aria-pressed={active}
                  className={`px-3 py-1 rounded-full text-caption font-medium whitespace-nowrap transition-all cursor-pointer ${
                    active
                      ? 'bg-accent text-accent-fg font-semibold shadow-2xs'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Age / Content-Mode Filter (hidden when top-bar Kids mode is active to keep Kids lock strict) */}
          {contentMode !== 'kids' && (
            <div
              role="group"
              aria-label={t('library.modeAll')}
              className="inline-flex items-center p-0.5 rounded-full bg-surface-raised/85 border border-line shadow-2xs"
            >
              {[
                { id: 'all', label: t('library.modeAll') },
                { id: 'classic', label: t('library.modeClassic') },
                { id: 'kids', label: t('library.modeKids') },
              ].map((opt) => {
                const active = effectiveModeFilter === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleModeChange(opt.id)}
                    aria-pressed={active}
                    className={`px-3 py-1 rounded-full text-caption font-medium whitespace-nowrap transition-all cursor-pointer ${
                      active
                        ? 'bg-accent text-accent-fg font-semibold shadow-2xs'
                        : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Sort Selector + Admin Reorder Toggle */}
        <div className="flex items-center gap-2 ms-auto">
          <span className="text-caption font-medium text-ink-subtle hidden sm:inline">
            {t('library.sortLabel')}
          </span>
          <div
            role="group"
            aria-label={t('library.sortLabel')}
            className="inline-flex items-center p-0.5 rounded-full bg-surface-raised/85 border border-line shadow-2xs"
          >
            {[
              { id: 'featured', label: t('library.sortFeatured') },
              { id: 'chronological', label: t('library.sortChronological') },
            ].map((opt) => {
              const active = sortBy === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSortChange(opt.id)}
                  aria-pressed={active}
                  className={`px-3 py-1 rounded-full text-caption font-medium whitespace-nowrap transition-all cursor-pointer ${
                    active
                      ? 'bg-surface text-ink font-semibold shadow-xs border border-line/80'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {isAdmin && sortBy === 'featured' && filteredItems.length > 1 && (
            <button
              type="button"
              onClick={() => {
                setIsReordering((prev) => !prev);
                setDraggedCardId(null);
                setDragOverCardId(null);
              }}
              aria-pressed={effectiveReordering}
              title={t('library.reorderTip')}
              className={`inline-flex items-center gap-1 px-3 py-2 rounded-full text-caption font-semibold whitespace-nowrap border transition-all cursor-pointer shadow-2xs ${
                effectiveReordering
                  ? 'bg-accent text-accent-fg border-accent shadow-xs'
                  : 'bg-surface-raised/85 hover:bg-surface-hover text-ink-muted hover:text-ink border-line'
              }`}
            >
              {effectiveReordering ? (
                <>
                  <Check className="w-3 h-3 shrink-0" />
                  <span>{t('library.reorderDoneBtn')}</span>
                </>
              ) : (
                <>
                  <ArrowUpDown className="w-3 h-3 shrink-0 text-accent" />
                  <span>{t('library.reorderBtn')}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Multi-Select Category Filter Pills with Horizontal Scroller & Side Arrows */}
      {isInitialLoading && !facetSummary ? (
        <div
          aria-hidden="true"
          className="flex items-center gap-2 overflow-hidden py-1 mb-3"
        >
          <span className="shrink-0 px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap border bg-accent/85 text-accent-fg border-accent/85 shadow-xs">
            {t('library.catAll')}
          </span>
          {SKELETON_CATEGORY_WIDTHS.map((widthClass, idx) => (
            <span
              key={idx}
              className={`shrink-0 h-[26px] ${widthClass} rounded-full bg-surface-raised/80 border border-line home-library-skeleton`}
            />
          ))}
        </div>
      ) : visibleCategoryKeys.length >= 1 ? (
        <HorizontalCapsuleScroller
          isRtl={isRtl}
          scrollLeftLabel={t('library.scrollCategoriesLeft')}
          scrollRightLabel={t('library.scrollCategoriesRight')}
          depsKey={`${language}:${isRtl}:${langAndModePool.length}:${visibleCategoryKeys.join(',')}:${selectedCategories.join(',')}:${isCatalogPending}`}
          className="mb-3"
        >
          <button
            type="button"
            onClick={handleClearCategories}
            aria-pressed={selectedCategories.length === 0}
            className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer border ${
              selectedCategories.length === 0
                ? 'bg-accent text-accent-fg border-accent shadow-xs font-semibold'
                : 'bg-surface-raised/80 text-ink-muted hover:text-ink border-line hover:border-line-strong'
            }`}
          >
            {t('library.catAll')}
            {showCategoryCounts && totalPoolCount > 0 ? ` (${totalPoolCount})` : ''}
          </button>
          {visibleCategoryKeys.map((cat) => {
            const isCatSelected = selectedCategories.includes(cat);
            const count = categoryCounts.get(cat) || 0;
            // Known to exist (facets) but none of its cards has loaded yet: shown, not clickable.
            const isCatPending = isCatalogPending && !isCatSelected && !(loadedCategoryCounts.get(cat) > 0);
            return (
              <button
                key={cat}
                type="button"
                onClick={() => handleToggleCategory(cat)}
                aria-pressed={isCatSelected}
                disabled={isCatPending}
                title={isCatPending ? t('library.categoryLoading') : undefined}
                className={`shrink-0 inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all border ${
                  isCatSelected
                    ? 'cursor-pointer bg-accent text-accent-fg border-accent shadow-xs font-semibold'
                    : isCatPending
                      ? 'cursor-default bg-surface-raised/60 text-ink-muted/70 border-line home-library-skeleton'
                      : 'cursor-pointer bg-surface-raised/80 text-ink-muted hover:text-ink border-line hover:border-line-strong'
                }`}
              >
                {isCatSelected ? (
                  <Check className="w-3 h-3 shrink-0" />
                ) : cat === 'personal' ? (
                  <BookUser className="w-3 h-3 shrink-0 text-accent" />
                ) : null}
                <span>
                  {t(`library.categories.${cat}`)}
                  {showCategoryCounts ? ` (${count})` : ''}
                </span>
              </button>
            );
          })}
          {/* No facets yet: placeholders hint that more categories are still on their way. */}
          {isCatalogPending &&
            !facetSummary &&
            SKELETON_CATEGORY_WIDTHS.slice(0, 2).map((widthClass, idx) => (
              <span
                key={`cat-skel-${idx}`}
                aria-hidden="true"
                className={`shrink-0 h-[26px] ${widthClass} rounded-full bg-surface-raised/80 border border-line home-library-skeleton`}
              />
            ))}
        </HorizontalCapsuleScroller>
      ) : null}

      {/* Personal & Family Category Inspiration Callout */}
      {!isInitialLoading && !effectiveReordering && selectedCategories.includes('personal') && onOpenBuildPersonal && (
        <div className="mb-4 px-4 py-3 rounded-2xl bg-accent-soft/65 border border-accent/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-start animate-in fade-in duration-200">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-surface-raised text-accent border border-accent/20 shrink-0 mt-0.5">
              <BookUser className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs sm:text-sm font-bold text-ink">
                {t('library.personalCategoryBannerTitle')}
              </div>
              <p className="text-caption sm:text-xs text-ink-muted leading-relaxed mt-0.5">
                {t('library.personalCategoryBannerSub')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenBuildPersonal}
            disabled={disabled}
            className="theme-memory inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-sm font-semibold shadow-control transition-colors duration-150 cursor-pointer shrink-0 self-start sm:self-center motion-safe:active:scale-95 disabled:opacity-50"
          >
            <BookUser className="w-4 h-4 shrink-0" />
            <span>{t('buildOwn.homeBtn')}</span>
          </button>
        </div>
      )}

      {/* Admin Reorder Mode Hint Banner */}
      {effectiveReordering && (
        <div className="mb-4 px-4 py-2 rounded-full bg-accent-soft/80 border border-accent/35 flex items-center justify-between gap-2 text-xs text-ink">
          <span className="inline-flex items-center gap-2 font-medium min-w-0">
            <GripVertical className="w-3.5 h-3.5 text-accent shrink-0" />
            <span className="truncate">{t('library.reorderHint')}</span>
          </span>
          {savingOrder && (
            <span className="inline-flex items-center gap-1 text-caption font-medium text-accent shrink-0">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>{t('library.reorderSaving')}</span>
            </span>
          )}
        </div>
      )}

      {/* Quick Multi-Select Compare Banner (when user selects >= 1 timeline via + Layer) */}
      {!effectiveReordering && selectedIds.length > 0 && (
        <div className="mb-4 p-3 rounded-panel bg-surface-raised/95 backdrop-blur-md border border-accent/40 shadow-card flex flex-wrap items-center justify-between gap-3 text-start animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-2 text-xs font-bold text-accent">
              <Layers className="w-4 h-4 shrink-0" />
              <span>{t('layers.selectedCount', { count: selectedIds.length, max: MAX_MERGED_SOURCES })}</span>
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {selectedIds.map((id, idx) => {
                const found = safePool.find((x) => x.id === id) || items.find((x) => x.id === id);
                const color = LAYER_ACCENT_COLORS[idx % LAYER_ACCENT_COLORS.length];
                return (
                  <div
                    key={id}
                    className="inline-flex items-center gap-1 ps-3 pe-2 py-0.5 rounded-full text-caption font-medium bg-surface border border-line text-ink max-w-[240px]"
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-ink-subtle font-mono text-caption shrink-0">{idx + 1}.</span>
                    <span className="truncate">{found?.title || id}</span>
                    {selectedIds.length >= 2 && (
                      <div className="inline-flex items-center ms-0.5 shrink-0">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => moveSelectedLayer(idx, -1)}
                          title={t('library.moveLayerEarlier')}
                          aria-label={t('library.moveLayerEarlier')}
                          className="p-0.5 rounded-full text-ink-subtle hover:text-ink hover:bg-surface-hover disabled:opacity-30 cursor-pointer disabled:cursor-default transition-colors"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === selectedIds.length - 1}
                          onClick={() => moveSelectedLayer(idx, 1)}
                          title={t('library.moveLayerLater')}
                          aria-label={t('library.moveLayerLater')}
                          className="p-0.5 rounded-full text-ink-subtle hover:text-ink hover:bg-surface-hover disabled:opacity-30 cursor-pointer disabled:cursor-default transition-colors"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeSelectedLayer(id)}
                      title={t('library.removeLayerFromSelection')}
                      aria-label={t('library.removeLayerFromSelection')}
                      className="p-0.5 rounded-full text-ink-subtle hover:text-danger hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 ms-auto">
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="px-3 py-1 rounded-control text-xs text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
            >
              {t('library.clearSelection')}
            </button>
            <button
              type="button"
              disabled={selectedIds.length < 2 || mergingBusy}
              onClick={handleLaunchMerge}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-control bg-accent hover:bg-accent-hover disabled:opacity-45 text-accent-fg text-xs font-semibold shadow-control transition-all cursor-pointer"
            >
              {mergingBusy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Layers className="w-3.5 h-3.5" />
              )}
              <span>
                {selectedIds.length >= 2
                  ? t('library.launchLayeredBtn', { count: selectedIds.length })
                  : t('library.selectAtLeastTwo')}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Cards Grid, Loading Skeletons, or Empty Filter State */}
      {isInitialLoading || (isLoadingRest && filteredItems.length === 0) ? (
        <div
          role="status"
          aria-live="polite"
          aria-label={t('common.loading')}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 text-start"
        >
          <span className="sr-only">{t('common.loading')}</span>
          {Array.from({ length: INITIAL_PAGE_SIZE }, (_, idx) => (
            <LibraryCardSkeleton key={idx} index={idx} />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="py-10 px-4 rounded-2xl bg-surface-raised/60 border border-line text-center space-y-3">
          <p className="text-sm font-semibold text-ink">{t('library.noResultsTitle')}</p>
          <p className="text-xs text-ink-muted">{t('library.noResultsDesc')}</p>
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold bg-surface-raised hover:bg-surface-hover text-ink border border-line shadow-control transition-colors cursor-pointer"
          >
            {t('library.resetFilters')}
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 text-start animate-in fade-in duration-200">
            {displayedCards.map((item, cardIdx) => {
              const isTitleRtl = isTextRtl(item.title || '', isRtl);
              const isDescRtl = isTextRtl(item.description || '', isTitleRtl);
              const yearRange = formatYearRangeLabel(item.minYear, item.maxYear, item.timeScale, t, isRtl);
              const selectedIdx = selectedIds.indexOf(item.id);
              const isSelected = !effectiveReordering && selectedIdx >= 0;
              const layerColor = isSelected ? LAYER_ACCENT_COLORS[selectedIdx % LAYER_ACCENT_COLORS.length] : null;
              const primaryCategory = getItemCategories(item)[0];
              const isCardPositioning = positioningCardId === item.id;
              const isBeingDragged = effectiveReordering && draggedCardId === item.id;
              const isDropTarget =
                effectiveReordering &&
                dragOverCardId === item.id &&
                draggedCardId &&
                draggedCardId !== item.id;

              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                  draggable={effectiveReordering && !isCardPositioning}
                  onDragStart={(e) => {
                    if (!effectiveReordering || isCardPositioning) return;
                    setDraggedCardId(item.id);
                    e.dataTransfer.effectAllowed = 'move';
                    try {
                      e.dataTransfer.setData('text/plain', item.id);
                    } catch {
                      // ignore browser dataTransfer quirks
                    }
                  }}
                  onDragOver={(e) => {
                    if (!effectiveReordering || !draggedCardId || draggedCardId === item.id) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverCardId !== item.id) {
                      setDragOverCardId(item.id);
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!effectiveReordering) return;
                    if (!e.currentTarget.contains(e.relatedTarget)) {
                      setDragOverCardId((prev) => (prev === item.id ? null : prev));
                    }
                  }}
                  onDrop={(e) => {
                    if (!effectiveReordering) return;
                    e.preventDefault();
                    let fromId = draggedCardId;
                    if (!fromId) {
                      try {
                        fromId = e.dataTransfer.getData('text/plain');
                      } catch {
                        fromId = null;
                      }
                    }
                    setDraggedCardId(null);
                    setDragOverCardId(null);
                    if (!fromId || fromId === item.id) return;
                    const fromIdx = displayedCards.findIndex((c) => c.id === fromId);
                    if (fromIdx >= 0 && fromIdx !== cardIdx) {
                      handleMoveFeaturedCard(fromIdx, cardIdx);
                    }
                  }}
                  onDragEnd={() => {
                    setDraggedCardId(null);
                    setDragOverCardId(null);
                  }}
                  {...getPressProps(item.id, () => onSelectTimeline?.(item.id))}
                  onClick={() => {
                    if (disabled || mergingBusy || isCardPositioning || effectiveReordering) return;
                    getPressProps(item.id, () => onSelectTimeline?.(item.id)).onClick();
                  }}
                  onKeyDown={(e) => {
                    if (disabled || mergingBusy || isCardPositioning) return;
                    if (effectiveReordering) {
                      const earlierKey = isRtl ? 'ArrowRight' : 'ArrowLeft';
                      const laterKey = isRtl ? 'ArrowLeft' : 'ArrowRight';
                      if (e.key === earlierKey && cardIdx > 0) {
                        e.preventDefault();
                        handleMoveFeaturedCard(cardIdx, cardIdx - 1);
                      } else if (e.key === laterKey && cardIdx < displayedCards.length - 1) {
                        e.preventDefault();
                        handleMoveFeaturedCard(cardIdx, cardIdx + 1);
                      }
                      return;
                    }
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectTimeline?.(item.id);
                    }
                  }}
                  className={`group relative rounded-2xl overflow-hidden bg-surface-raised/90 hover:bg-surface-raised backdrop-blur-md border transition-all duration-200 flex flex-col shadow-card hover:shadow-glass-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    armedId === item.id ? 'is-armed ' : ''
                  }${
                    isCardPositioning
                      ? 'cursor-default ring-2 ring-accent/45 border-accent'
                      : effectiveReordering
                        ? 'cursor-grab active:cursor-grabbing'
                        : 'cursor-pointer'
                  } ${
                    isDropTarget
                      ? 'border-accent ring-2 ring-accent scale-[1.01]'
                      : isSelected || armedId === item.id
                        ? 'border-accent ring-2 ring-accent/35'
                        : effectiveReordering
                          ? 'border-accent/35 hover:border-accent'
                          : 'border-line hover:border-accent/45'
                  } ${isBeingDragged ? 'opacity-45 scale-[0.98]' : ''} ${
                    disabled ? 'opacity-60 pointer-events-none' : ''
                  }`}
                >
                  <LibraryCardCover
                    item={item}
                    primaryCategoryLabel={primaryCategory ? t(`library.categories.${primaryCategory}`) : null}
                    yearRange={yearRange}
                    selectedIdx={selectedIdx}
                    layerColor={layerColor}
                    canSelectMore={selectedIds.length < MAX_MERGED_SOURCES}
                    onToggleSelectForMerge={onMergeTimelines ? toggleSelectForMerge : null}
                    isAdmin={isAdmin}
                    isRtl={isRtl}
                    isReordering={effectiveReordering}
                    orderIndex={cardIdx}
                    totalOrderCount={displayedCards.length}
                    onMoveEarlier={() => handleMoveFeaturedCard(cardIdx, cardIdx - 1)}
                    onMoveLater={() => handleMoveFeaturedCard(cardIdx, cardIdx + 1)}
                    onMoveFirst={() => handleMoveFeaturedCard(cardIdx, 0)}
                    onAdminUpdateCover={handleAdminUpdateCover}
                    onAdminToggleFeatured={handleAdminToggleFeatured}
                    onPositioningChange={(active) => {
                      setPositioningCardId((prev) => (active ? item.id : prev === item.id ? null : prev));
                    }}
                    eagerLoad={cardIdx < 3}
                    t={t}
                  />

                  {/* Card Body */}
                  <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                    <div>
                      <LibraryCardTitle title={item.title} isTitleRtl={isTitleRtl} />
                      {item.description && (
                        <p
                          dir={isDescRtl ? 'rtl' : 'ltr'}
                          className={`text-xs text-ink-muted line-clamp-2 mt-1 leading-relaxed ${
                            isDescRtl ? 'text-right' : 'text-left'
                          }`}
                        >
                          {item.description}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-3 border-t border-line/60 text-caption text-ink-subtle">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <span className="inline-flex items-center gap-1 font-medium">
                          <Calendar className="w-3 h-3 text-accent shrink-0" />
                          <span>{t('library.eventsCount', { count: item.articleCount || 0 })}</span>
                        </span>
                        <TimelineModeBadges
                          contentMode={item.contentMode}
                          searchMode={item.searchMode}
                          isManual={Boolean(item.isPersonal)}
                          isPersonalDemo={Boolean(item.isPersonal)}
                          mergedLayerCount={item.mergedLayerCount || 0}
                        />
                      </div>
                      {effectiveReordering && (
                        <span className="inline-flex items-center gap-0.5 text-accent font-mono font-bold shrink-0">
                          <GripVertical className="w-3 h-3" />
                          <span>#{cardIdx + 1}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {pendingRestSkeletonCount > 0 &&
              Array.from({ length: pendingRestSkeletonCount }, (_, idx) => (
                <LibraryCardSkeleton key={`rest-skel-${idx}`} index={displayedCards.length + idx} />
              ))}
          </div>

          {/* Show More / Show Less Pagination */}
          {!effectiveReordering &&
            (remainingCount > 0 || (visibleCount > INITIAL_PAGE_SIZE && filteredItems.length > INITIAL_PAGE_SIZE)) && (
            <div className="mt-6 flex items-center justify-center gap-3">
              {remainingCount > 0 && (
                <button
                  type="button"
                  onClick={() => setVisibleCount((prev) => prev + PAGE_STEP)}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-surface-raised hover:bg-surface-hover text-ink text-xs font-semibold border border-line hover:border-line-strong shadow-control transition-all cursor-pointer active:scale-95"
                >
                  <span>{t('library.showMoreBtn', { count: remainingCount })}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-accent" />
                </button>
              )}
              {visibleCount > INITIAL_PAGE_SIZE && remainingCount === 0 && (
                <button
                  type="button"
                  onClick={() => setVisibleCount(INITIAL_PAGE_SIZE)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface-raised/80 hover:bg-surface-hover text-ink-muted hover:text-ink text-xs font-medium border border-line transition-all cursor-pointer"
                >
                  <span>{t('library.showLessBtn')}</span>
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

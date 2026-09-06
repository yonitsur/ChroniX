import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Calendar,
  Layers,
  MapPin,
  ZoomIn,
  ZoomOut,
  Maximize2,
  List,
  Columns,
  ChevronRight,
  Filter,
  Image as ImageIcon,
  Sparkles,
  ArrowUpDown,
  Star,
  GripVertical,
  RotateCcw
} from 'lucide-react';
import { getLaneColor, isColorLight, DEFAULT_LANE_COLORS } from '../data/laneColors';
import { useLanguage } from '../context/LanguageContext';

function hexToRgba(hex, alpha = 0.6) {
  if (!hex) return `rgba(59, 130, 246, ${alpha})`;
  if (hex.startsWith('rgba') || hex.startsWith('hsla')) return hex;
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  if (clean.length === 6) {
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return hex;
}

/**
 * Converts any ChroniX date object to a float decimal year
 */
export function dateToDecimalYear(d) {
  if (!d) return 0;
  if (typeof d === 'number') return d;
  if (typeof d === 'string') {
    const parsed = parseFloat(d);
    return isNaN(parsed) ? 0 : parsed;
  }
  if (d.year === undefined || d.year === null) return 0;
  const y = Number(d.year);
  if (isNaN(y)) return 0;

  if (d.precision === 'million-years' || Math.abs(y) >= 1000000) {
    return y;
  }

  const m = Number(d.month) || 1;
  const day = Number(d.day) || 1;
  const frac = ((m - 1) * 30 + (day - 1)) / 365;
  return y >= 0 ? y + frac : y - frac;
}

/**
 * Calculates adaptive tick marks step based on total span
 */
function getTickInterval(totalSpan) {
  if (totalSpan <= 3) return { step: 1, minor: 0.25 };
  if (totalSpan <= 10) return { step: 1, minor: 0.5 };
  if (totalSpan <= 25) return { step: 2, minor: 1 };
  if (totalSpan <= 60) return { step: 5, minor: 1 };
  if (totalSpan <= 150) return { step: 10, minor: 2.5 };
  if (totalSpan <= 350) return { step: 25, minor: 5 };
  if (totalSpan <= 800) return { step: 50, minor: 10 };
  if (totalSpan <= 2500) return { step: 100, minor: 25 };
  if (totalSpan <= 10000) return { step: 500, minor: 100 };
  return { step: 1000, minor: 250 };
}

const RULER_HEADER_HEIGHT = 32;
const BASELINE_PADDING = 24;

export default function MobileTimelineView({
  timelineData,
  onSelectArticle,
  selectedArticleId,
  onFocusOnMap,
  starredArticleIds,
  onToggleStar,
  filterStarredOnly = false,
  onToggleFilterStarredOnly,
  theme = 'light'
}) {
  const { t, isRtl, formatTimeSpan, formatDatePart } = useLanguage();
  const [selectedLaneId, setSelectedLaneId] = useState('all');
  const [viewMode, setViewMode] = useState('ruler'); // 'ruler' | 'feed'
  const [scaleMultiplier, setScaleMultiplier] = useState(1.0);
  const [feedSortOrder, setFeedSortOrder] = useState('asc'); // for feed view
  const [hoveredArticleId, setHoveredArticleId] = useState(null);
  const [zoomBadge, setZoomBadge] = useState(null);

  const rulerContainerRef = useRef(null);
  const scaleMultiplierRef = useRef(scaleMultiplier);
  scaleMultiplierRef.current = scaleMultiplier;

  // Dragged card custom offsets: { [articleId]: { x: number, y: number } }
  const [cardOffsets, setCardOffsets] = useState({});
  const dragRef = useRef({
    id: null,
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
    isDragging: false,
  });

  const handleDragHandlePointerDown = (e, artId) => {
    e.stopPropagation();
    const current = cardOffsets[artId] || { x: 0, y: 0 };
    dragRef.current = {
      id: artId,
      startX: e.clientX,
      startY: e.clientY,
      initialX: current.x,
      initialY: current.y,
      isDragging: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleDragHandlePointerMove = (e, artId) => {
    if (dragRef.current.id !== artId) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (!dragRef.current.isDragging && Math.hypot(dx, dy) > 4) {
      dragRef.current.isDragging = true;
    }
    if (dragRef.current.isDragging) {
      setCardOffsets((prev) => ({
        ...prev,
        [artId]: {
          x: Math.round(dragRef.current.initialX + dx),
          y: Math.round(dragRef.current.initialY + dy),
        }
      }));
    }
  };

  const handleDragHandlePointerUp = (e, artId) => {
    if (dragRef.current.id === artId) {
      dragRef.current.id = null;
      dragRef.current.isDragging = false;
    }
  };

  const hasMovedCards = Object.keys(cardOffsets).length > 0;
  const handleResetPositions = () => {
    setCardOffsets({});
  };

  // Native multi-touch pinch-to-zoom handler for the vertical timeline
  useEffect(() => {
    const container = rulerContainerRef.current;
    if (!container || viewMode !== 'ruler') return;

    let initialDistance = 0;
    let initialScale = 1.0;
    let isPinching = false;
    let initialCenterY = 0;
    let initialScrollTop = 0;
    let hideBadgeTimer = null;

    const getTouchDistance = (e) => {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    };

    const handleTouchStart = (e) => {
      if (e.touches.length === 2) {
        isPinching = true;
        initialDistance = getTouchDistance(e);
        initialScale = scaleMultiplierRef.current;
        initialCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        initialScrollTop = container.scrollTop;
      }
    };

    const handleTouchMove = (e) => {
      if (!isPinching || e.touches.length < 2) return;
      // Prevent the mobile browser from zooming the entire page/viewport
      if (e.cancelable) {
        e.preventDefault();
      }

      const currentDist = getTouchDistance(e);
      if (initialDistance <= 0) return;

      const ratio = currentDist / initialDistance;
      const targetScale = Math.min(4.0, Math.max(0.3, initialScale * ratio));

      setScaleMultiplier(targetScale);

      // Keep timeline focal point anchored around user fingers
      const scaleDiff = targetScale / initialScale;
      const rect = container.getBoundingClientRect();
      const relativeCenterY = initialCenterY - rect.top;
      container.scrollTop = (initialScrollTop + relativeCenterY) * scaleDiff - relativeCenterY;

      if (hideBadgeTimer) clearTimeout(hideBadgeTimer);
      setZoomBadge(Math.round(targetScale * 100));
    };

    const handleTouchEnd = (e) => {
      if (isPinching && e.touches.length < 2) {
        isPinching = false;
        if (hideBadgeTimer) clearTimeout(hideBadgeTimer);
        hideBadgeTimer = setTimeout(() => {
          setZoomBadge(null);
        }, 900);
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      if (hideBadgeTimer) clearTimeout(hideBadgeTimer);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [viewMode]);

  const articles = timelineData?.articles || [];
  const lanes = timelineData?.lanes || [];

  const starredCount = useMemo(() => {
    return articles.filter((a) => starredArticleIds?.has(a.id)).length;
  }, [articles, starredArticleIds]);

  // Map lanes for fast lookup with multi-key indexing (id, title, lowercase)
  const laneMap = useMemo(() => {
    const map = new Map();
    lanes.forEach((lane, idx) => {
      const color = getLaneColor(lane, idx, lanes);
      const entry = {
        id: lane.id,
        title: lane.title,
        color,
        isLight: isColorLight(color)
      };
      if (lane.id !== undefined && lane.id !== null) {
        map.set(lane.id, entry);
        map.set(String(lane.id).toLowerCase(), entry);
      }
      if (lane.title) {
        map.set(lane.title, entry);
        map.set(lane.title.toLowerCase().trim(), entry);
      }
    });
    return map;
  }, [lanes]);

  // Helper to reliably resolve lane info for an article
  const getArticleLaneInfo = (laneIdentifier) => {
    if (!laneIdentifier && lanes.length > 0) {
      const first = lanes[0];
      return laneMap.get(first.id) || {
        id: first.id,
        title: first.title || t('mobile.timeline'),
        color: getLaneColor(first, 0, lanes),
        isLight: false
      };
    }
    if (laneIdentifier) {
      if (laneMap.has(laneIdentifier)) return laneMap.get(laneIdentifier);
      const str = String(laneIdentifier).toLowerCase().trim();
      if (laneMap.has(str)) return laneMap.get(str);
      const foundIdx = lanes.findIndex(
        (l) =>
          String(l.id).toLowerCase() === str ||
          String(l.title || '').toLowerCase() === str
      );
      if (foundIdx >= 0) {
        const found = lanes[foundIdx];
        const color = getLaneColor(found, foundIdx, lanes);
        return {
          id: found.id,
          title: found.title,
          color,
          isLight: isColorLight(color)
        };
      }
    }
    // Deterministic fallback by hashing the lane string into museum colors
    const fallbackStr = String(laneIdentifier || 'default');
    let hash = 0;
    for (let i = 0; i < fallbackStr.length; i++) {
      hash = (hash << 5) - hash + fallbackStr.charCodeAt(i);
      hash |= 0;
    }
    const color = DEFAULT_LANE_COLORS[Math.abs(hash) % DEFAULT_LANE_COLORS.length];
    return {
      id: fallbackStr,
      title: laneIdentifier || t('mobile.timeline'),
      color,
      isLight: isColorLight(color)
    };
  };

  // Lane articles counts
  const laneCounts = useMemo(() => {
    const counts = {};
    articles.forEach((a) => {
      counts[a.lane] = (counts[a.lane] || 0) + 1;
    });
    return counts;
  }, [articles]);

  // 1. Compute numeric dates and bounds for all articles
  const { processedArticles, minYear, maxYear, totalSpan, defaultPixelsPerYear } = useMemo(() => {
    if (!articles.length) {
      return {
        processedArticles: [],
        minYear: 1900,
        maxYear: 2000,
        totalSpan: 100,
        defaultPixelsPerYear: 20
      };
    }

    let min = Infinity;
    let max = -Infinity;

    const list = articles.map((art) => {
      const start = dateToDecimalYear(art.from);
      let end = start;
      const isRange = Boolean(art.to || art.isToPresent);

      if (art.isToPresent) {
        end = new Date().getFullYear();
      } else if (art.to) {
        end = dateToDecimalYear(art.to);
      }

      if (end < start) {
        end = start;
      }

      if (start < min) min = start;
      if (end > max) max = end;

      return {
        ...art,
        startYear: start,
        endYear: end,
        isRange,
        duration: Math.max(0, end - start)
      };
    });

    let span = max - min;
    if (span <= 0) {
      span = 1;
      min -= 1;
      max += 1;
    } else {
      const padding = Math.max(0.5, span * 0.04);
      min -= padding;
      max += padding;
      span = max - min;
    }

    const basePpy = Math.max(0.4, Math.min(90, 1400 / span));

    return {
      processedArticles: list,
      minYear: min,
      maxYear: max,
      totalSpan: span,
      defaultPixelsPerYear: basePpy
    };
  }, [articles]);

  // Active scale
  const pixelsPerYear = defaultPixelsPerYear * scaleMultiplier;

  // Helper to get precise Y coordinate for any year
  const getYearY = (year) => {
    return RULER_HEADER_HEIGHT + BASELINE_PADDING + (year - minYear) * pixelsPerYear;
  };

  // 2. Generate ruler ticks
  const ticks = useMemo(() => {
    if (!totalSpan || totalSpan <= 0) return [];
    const { step, minor } = getTickInterval(totalSpan / scaleMultiplier);
    const result = [];

    const startTick = Math.floor(minYear / step) * step;
    const endTick = Math.ceil(maxYear / step) * step;

    for (let yr = startTick; yr <= endTick; yr += minor) {
      if (yr < minYear - 0.01 || yr > maxYear + 0.01) continue;
      const remainder = Math.abs(yr % step);
      const isMajor = remainder < 0.001 || Math.abs(remainder - step) < 0.001;

      const y = getYearY(yr);
      result.push({
        year: Math.round(yr),
        decimalYear: yr,
        isMajor,
        y
      });
    }
    return result;
  }, [minYear, maxYear, totalSpan, scaleMultiplier, pixelsPerYear]);

  // 3. Resolve overlapping cards within each lane using relaxation stacking + ruler period tracks
  const { layoutArticles, rulerPeriodArticles, maxLayoutY } = useMemo(() => {
    const visible = processedArticles.filter((art) => {
      if (filterStarredOnly && !starredArticleIds?.has(art.id)) return false;
      if (selectedLaneId !== 'all' && art.lane !== selectedLaneId) return false;
      return true;
    });

    // 3a. Group by lane
    const byLane = new Map();
    visible.forEach((art) => {
      const lId = art.lane || 'default';
      if (!byLane.has(lId)) byLane.set(lId, []);
      byLane.get(lId).push(art);
    });

    const cardList = [];
    let overallMaxY = 0;

    byLane.forEach((laneArticles) => {
      // Sort chronologically by start year
      laneArticles.sort((a, b) => {
        if (Math.abs(a.startYear - b.startYear) > 0.0001) {
          return a.startYear - b.startYear;
        }
        return b.duration - a.duration;
      });

      let lastCardBottom = 0;
      const CARD_GAP = 16;

      laneArticles.forEach((art) => {
        const hasImage = Boolean(art.imageUrl);
        const isLongTitle = (art.title || '').length > 32;
        // Natural card height
        const cardHeight = hasImage ? 138 : (isLongTitle ? 92 : 78);

        const anchorY = getYearY(art.startYear);
        const rawEndY = art.isRange ? getYearY(art.endYear) : anchorY;

        // Collision-free vertical relaxation:
        // Card is placed at its natural chronological date (anchorY),
        // BUT if that overlaps the previous card, it is relaxed down so cards NEVER overlap!
        const placedY = Math.max(anchorY, lastCardBottom);
        lastCardBottom = placedY + cardHeight + CARD_GAP;

        if (placedY + cardHeight > overallMaxY) {
          overallMaxY = placedY + cardHeight;
        }

        cardList.push({
          ...art,
          anchorY,
          rawEndY,
          placedY,
          cardHeight,
          hasImage
        });
      });
    });

    // 3b. Period lines ON the Ruler (stagger parallel periods on the ruler axis)
    const rulerList = [...visible].sort((a, b) => a.startYear - b.startYear);
    const rulerActiveEnds = [];

    const rulerDecorated = rulerList.map((art) => {
      let track = -1;
      for (let t = 0; t < rulerActiveEnds.length; t++) {
        if (rulerActiveEnds[t] <= art.startYear + 0.05) {
          track = t;
          rulerActiveEnds[t] = art.endYear;
          break;
        }
      }
      if (track === -1) {
        track = rulerActiveEnds.length;
        rulerActiveEnds.push(art.endYear);
      }

      const startY = getYearY(art.startYear);
      const endY = art.isRange ? getYearY(art.endYear) : startY;

      return {
        ...art,
        rulerTrack: track % 3,
        startY,
        endY,
        height: Math.max(art.isRange ? 12 : 8, endY - startY)
      };
    });

    return {
      layoutArticles: cardList,
      rulerPeriodArticles: rulerDecorated,
      maxLayoutY: overallMaxY
    };
  }, [processedArticles, selectedLaneId, minYear, pixelsPerYear, starredArticleIds, filterStarredOnly]);

  // Height of ruler canvas - ensures full scroll reach with no clipping
  const canvasHeight = Math.max(
    600,
    totalSpan * pixelsPerYear + 240,
    maxLayoutY + 180
  );

  // Lanes to display
  const displayLanes = useMemo(() => {
    if (selectedLaneId !== 'all') {
      const found = lanes.find((l) => l.id === selectedLaneId);
      return found ? [found] : lanes;
    }
    return lanes.length > 0 ? lanes : [{ id: 'default', title: t('mobile.timeline') }];
  }, [lanes, selectedLaneId, t]);

  // Feed view articles
  const feedArticles = useMemo(() => {
    return [...processedArticles]
      .filter((art) => {
        if (filterStarredOnly && !starredArticleIds?.has(art.id)) return false;
        return selectedLaneId === 'all' || art.lane === selectedLaneId;
      })
      .sort((a, b) => {
        if (feedSortOrder === 'desc') return b.startYear - a.startYear;
        return a.startYear - b.startYear;
      });
  }, [processedArticles, selectedLaneId, feedSortOrder, filterStarredOnly, starredArticleIds]);

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="w-full h-full flex flex-col bg-slate-100/80 dark:bg-slate-950 select-none overflow-hidden"
    >
      {/* ─── Top Control Header ────────────────────────────────────── */}
      <div className="shrink-0 bg-white/95 dark:bg-slate-900/90 backdrop-blur-xl border-b border-slate-200/80 dark:border-slate-800/80 pt-2 pb-2 px-3 shadow-2xs z-20 space-y-2">
        
        {/* Row 1: View Toggle (Ruler ⟷ Feed) + Zoom Controls */}
        <div className="flex items-center justify-between gap-2">
          {/* View Mode Toggle Pill */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800/90 rounded-xl p-0.5 border border-slate-200/90 dark:border-slate-700/80 shadow-2xs">
            <button
              type="button"
              onClick={() => setViewMode('ruler')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                viewMode === 'ruler'
                  ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Columns className="w-3.5 h-3.5" />
              <span>{t('mobile.viewRuler')}</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('feed')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                viewMode === 'feed'
                  ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>{t('mobile.viewFeed')}</span>
            </button>
          </div>

          {/* Controls: Zoom In / Out / Reset for Ruler, or Sort for Feed */}
          {viewMode === 'ruler' ? (
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/90 rounded-xl p-0.5 border border-slate-200/90 dark:border-slate-700/80 shadow-2xs">
              <button
                type="button"
                onClick={() => setScaleMultiplier((prev) => Math.min(3.0, prev * 1.35))}
                className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 transition-colors cursor-pointer"
                title={t('mobile.zoomInRuler')}
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setScaleMultiplier((prev) => Math.max(0.35, prev * 0.75))}
                className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 transition-colors cursor-pointer"
                title={t('mobile.zoomOutRuler')}
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setScaleMultiplier(1.0)}
                className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 transition-colors cursor-pointer"
                title={t('mobile.fitRuler')}
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              {hasMovedCards && (
                <button
                  type="button"
                  onClick={handleResetPositions}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25 transition-colors cursor-pointer border border-amber-500/25 shadow-2xs"
                  title={t('mobile.resetPositions')}
                >
                  <RotateCcw className="w-3 h-3" />
                  <span className="text-[11px]">{t('mobile.resetPositions')}</span>
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setFeedSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer text-xs font-medium"
            >
              <ArrowUpDown className="w-3 h-3 text-sky-500" />
              <span>{feedSortOrder === 'asc' ? t('mobile.sortAsc') : t('mobile.sortDesc')}</span>
            </button>
          )}
        </div>

        {/* Row 2: Horizontal Swimlane & Star Filter Chips */}
        <div
          className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 px-0.5"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {/* "Starred Only" chip */}
          <button
            type="button"
            onClick={onToggleFilterStarredOnly}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer active:scale-95 ${
              filterStarredOnly
                ? 'bg-amber-500 text-slate-950 font-bold border-amber-400 shadow-xs'
                : 'bg-white dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Star className={`w-3 h-3 ${filterStarredOnly ? 'fill-current text-slate-950' : 'text-amber-500'}`} />
            <span>{t('cardsList.filterStarred')}</span>
            {starredCount > 0 && (
              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                filterStarredOnly ? 'bg-black/20 text-slate-950' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
              }`}>
                {starredCount}
              </span>
            )}
          </button>

          {/* "All Lanes" chip */}
          <button
            type="button"
            onClick={() => setSelectedLaneId('all')}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer active:scale-95 ${
              selectedLaneId === 'all'
                ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950 shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <span>{t('mobile.allLanes')}</span>
            <span className="text-[10px] opacity-75 font-bold bg-black/15 dark:bg-white/20 px-1.5 py-0.2 rounded-full">
              {articles.length}
            </span>
          </button>

            {/* Individual Lane chips */}
            {lanes.map((lane) => {
              const laneInfo = getArticleLaneInfo(lane.id);
              const isSelected = selectedLaneId === lane.id;
              const count = laneCounts[lane.id] || 0;

              return (
                <button
                  key={lane.id}
                  type="button"
                  onClick={() => setSelectedLaneId(lane.id)}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer active:scale-95 ${
                    isSelected
                      ? 'shadow-xs ring-2 ring-sky-500/30 font-semibold'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                  }`}
                  style={{
                    backgroundColor: isSelected
                      ? laneInfo?.color || '#0284c7'
                      : undefined,
                    color: isSelected
                      ? laneInfo?.isLight ? '#0f172a' : '#ffffff'
                      : undefined,
                    borderColor: isSelected
                      ? 'transparent'
                      : laneInfo?.color ? `${laneInfo.color}66` : undefined
                  }}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      backgroundColor: isSelected
                        ? (laneInfo?.isLight ? '#0f172a' : '#ffffff')
                        : laneInfo?.color || '#0284c7'
                    }}
                  />
                  <span className="truncate max-w-[130px]">{lane.title}</span>
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.2 rounded-full"
                    style={{
                      backgroundColor: isSelected
                        ? 'rgba(0,0,0,0.18)'
                        : 'rgba(100,116,139,0.15)'
                    }}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
      </div>

      {/* ─── Mode 1: Visual Proportional Time Ruler & Parallel Spans ─── */}
      {viewMode === 'ruler' ? (
        <div
          ref={rulerContainerRef}
          className="flex-1 overflow-y-auto overflow-x-auto relative pb-28"
          style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y' }}
        >
          {/* Visual Pinch Zoom Floating Badge */}
          {zoomBadge !== null && (
            <div className="fixed top-28 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-all duration-200 animate-in fade-in zoom-in-95">
              <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/90 dark:bg-slate-100/95 text-white dark:text-slate-900 shadow-2xl backdrop-blur-md text-xs font-bold border border-slate-700/50 dark:border-slate-300/50">
                <ZoomIn className="w-3.5 h-3.5 text-sky-400 dark:text-sky-600" />
                <span>{zoomBadge}%</span>
              </div>
            </div>
          )}
          <div
            className="relative min-w-full flex"
            style={{ height: `${canvasHeight}px` }}
          >
            {/* 1. Sticky Time Ruler Axis (Frozen on the side) */}
            <div
              className={`sticky ${
                isRtl ? 'right-0 border-l' : 'left-0 border-r'
              } top-0 w-20 sm:w-24 shrink-0 h-full bg-white/95 dark:bg-slate-900/95 border-slate-200/90 dark:border-slate-800/90 shadow-xs z-20 flex flex-col justify-start select-none`}
            >
              {/* Ruler Header Indicator */}
              <div className="h-8 flex items-center justify-center border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-850 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                {t('mobile.rulerScale')}
              </div>

              {/* Ticks and Year labels along the ruler */}
              <div className="relative flex-1 w-full">
                {ticks.map((tick, idx) => (
                  <div
                    key={idx}
                    className="absolute inset-x-0 flex items-center"
                    style={{ top: `${tick.y}px` }}
                  >
                    {/* Tick line */}
                    <div
                      className={`h-px ${
                        tick.isMajor
                          ? 'w-3 bg-slate-400 dark:bg-slate-500'
                          : 'w-1.5 bg-slate-300 dark:bg-slate-700'
                      } ${isRtl ? 'ml-auto' : 'mr-auto'}`}
                    />

                    {/* Year Label */}
                    {tick.isMajor && (
                      <span
                        className={`text-[10px] font-mono font-bold leading-none px-1 text-slate-600 dark:text-slate-300 ${
                          isRtl ? 'text-right' : 'text-left'
                        }`}
                      >
                        {tick.year < 0 ? `${Math.abs(tick.year)} BCE` : tick.year}
                      </span>
                    )}
                  </div>
                ))}

                {/* ─── Period Lines Directly ON the Ruler (פסי טווח על גבי הסרגל) ─── */}
                <div
                  className="absolute inset-y-0 w-8 pointer-events-auto"
                  style={{ [isRtl ? 'left' : 'right']: '2px' }}
                >
                  {rulerPeriodArticles.map((art) => {
                    const laneInfo = getArticleLaneInfo(art.lane);
                    const isSelected = selectedArticleId === art.id;
                    const isHovered = hoveredArticleId === art.id;
                    const isHigh = isSelected || isHovered;
                    const trackOffset = art.rulerTrack * 8; // 0px, 8px, 16px
                    const color = laneInfo.color;
                    const normalColor = hexToRgba(color, 0.55);

                    return (
                      <div
                        key={`ruler-span-${art.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectArticle?.(art);
                        }}
                        onMouseEnter={() => setHoveredArticleId(art.id)}
                        onMouseLeave={() => setHoveredArticleId(null)}
                        style={{
                          top: `${art.startY}px`,
                          height: `${art.height}px`,
                          [isRtl ? 'left' : 'right']: `${trackOffset}px`,
                          backgroundColor: isHigh ? color : normalColor
                        }}
                        className={`absolute rounded-full transition-all cursor-pointer shadow-xs ${
                          isHigh
                            ? 'w-3 ring-2 ring-slate-900/60 dark:ring-white/80 z-30 shadow-md scale-y-[1.03] opacity-100'
                            : 'w-2 hover:w-2.5 z-10 ring-1 ring-black/10 dark:ring-white/15'
                        }`}
                        title={`${art.title} (${formatTimeSpan(art.from, art.to, art.isToPresent)})`}
                      >
                        {/* Top End Bracket Cap on Ruler */}
                        <div
                          className="absolute -top-1 left-1/2 -translate-x-1/2 w-3.5 h-1 rounded-full shadow-xs"
                          style={{ backgroundColor: isHigh ? color : normalColor }}
                        />
                        {/* Bottom End Bracket Cap on Ruler (if range) */}
                        {art.isRange && (
                          <div
                            className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-3.5 h-1 rounded-full shadow-xs"
                            style={{ backgroundColor: isHigh ? color : normalColor }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 2. Main Timeline Tracks Area (Horizontal Gridlines + Connectors + Parallel Swimlane Columns) */}
            <div className="flex-1 relative flex">
              {/* Background Horizontal Guide Lines tracing from ticks across the timeline */}
              <div className="absolute inset-0 pointer-events-none">
                {ticks.map((tick, idx) =>
                  tick.isMajor ? (
                    <div
                      key={idx}
                      className="absolute inset-x-0 h-px border-t border-dashed border-slate-200/70 dark:border-slate-800/70"
                      style={{ top: `${tick.y}px` }}
                    />
                  ) : null
                )}
              </div>

              {/* Swimlane Track Columns */}
              {displayLanes.map((lane) => {
                const laneInfo = laneMap.get(lane.id);
                const laneArticles = layoutArticles.filter(
                  (a) => a.lane === lane.id || (!a.lane && lane.id === 'default')
                );

                return (
                  <div
                    key={lane.id}
                    className="flex-1 min-w-[280px] sm:min-w-[340px] relative border-e border-slate-200/60 dark:border-slate-800/60"
                  >
                    {/* Sticky Lane Column Header */}
                    <div className="sticky top-0 z-30 h-8 px-3 flex items-center justify-between bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 shadow-2xs">
                      <div className="flex items-center gap-1.5 truncate">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: laneInfo?.color || '#0284c7' }}
                        />
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                          {lane.title}
                        </span>
                      </div>
                      <span className="text-[10px] font-semibold text-slate-400 px-1.5 py-0.2 rounded-full bg-slate-100 dark:bg-slate-800">
                        {laneArticles.length}
                      </span>
                    </div>

                    {/* Non-Overlapping Draggable Cards with Dynamic SVG Stems */}
                    <div className="relative w-full h-full p-2 z-20">
                      {laneArticles.map((art) => {
                        const artLaneInfo = getArticleLaneInfo(art.lane);
                        const isSelected = selectedArticleId === art.id;
                        const isHovered = hoveredArticleId === art.id;
                        const isHigh = isSelected || isHovered;
                        const isStarred = Boolean(starredArticleIds?.has(art.id));
                        const timeSpan = formatTimeSpan(art.from, art.to, art.isToPresent);
                        const offset = cardOffsets[art.id] || { x: 0, y: 0 };
                        const isDragged = offset.x !== 0 || offset.y !== 0;

                        // Calculate relative anchor position for dynamic SVG stem
                        const deltaY = art.anchorY - art.placedY;
                        const startX = (isRtl ? 18 : -18) - offset.x;
                        const startY = deltaY - offset.y;
                        const targetX = 0;
                        const targetY = Math.min(art.cardHeight / 2, 28);

                        // Midpoint control points for smooth cubic Bézier curve
                        const midX = startX * 0.5;
                        const pathD = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${targetY}, ${targetX} ${targetY}`;

                        return (
                          <div
                            key={art.id}
                            style={{
                              top: `${art.placedY}px`,
                              height: `${art.cardHeight}px`,
                              [isRtl ? 'right' : 'left']: '22px',
                              [isRtl ? 'left' : 'right']: '8px',
                              transform: isDragged ? `translate3d(${offset.x}px, ${offset.y}px, 0)` : undefined,
                              transition: dragRef.current.id === art.id ? 'none' : 'transform 0.15s ease-out',
                            }}
                            className={`absolute ${isHigh ? 'z-30' : 'z-20'}`}
                            onMouseEnter={() => setHoveredArticleId(art.id)}
                            onMouseLeave={() => setHoveredArticleId(null)}
                          >
                            {/* ─── Dynamic SVG Bézier Connector Stem ─── */}
                            <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible -z-10">
                              {/* Axis Anchor Pin Dot at the exact date */}
                              <circle
                                cx={startX}
                                cy={startY}
                                r={isHigh ? 5 : 3.5}
                                fill={isHigh ? artLaneInfo.color : hexToRgba(artLaneInfo.color, 0.65)}
                                className="transition-all"
                              />
                              {/* Range end anchor dot if range */}
                              {art.isRange && (
                                <>
                                  <line
                                    x1={startX}
                                    y1={startY}
                                    x2={startX}
                                    y2={(art.rawEndY - art.placedY) - offset.y}
                                    stroke={isHigh ? artLaneInfo.color : hexToRgba(artLaneInfo.color, 0.6)}
                                    strokeWidth={isHigh ? 4.5 : 3.5}
                                    strokeOpacity={isHigh ? 1 : 0.85}
                                  />
                                  <circle
                                    cx={startX}
                                    cy={(art.rawEndY - art.placedY) - offset.y}
                                    r={isHigh ? 4.5 : 3}
                                    fill={isHigh ? artLaneInfo.color : hexToRgba(artLaneInfo.color, 0.65)}
                                  />
                                </>
                              )}
                              {/* Curved Bézier stem linking ruler tick to card */}
                              <path
                                d={pathD}
                                fill="none"
                                stroke={isHigh ? artLaneInfo.color : hexToRgba(artLaneInfo.color, 0.6)}
                                strokeWidth={isHigh ? 3 : 2}
                                strokeOpacity={isHigh ? 1 : 0.75}
                                strokeDasharray={Math.abs(deltaY) > 8 && !isHigh ? '3 3' : undefined}
                              />
                              {/* Connection pin on card edge */}
                              <circle
                                cx={targetX}
                                cy={targetY}
                                r={isHigh ? 4 : 2.5}
                                fill={isHigh ? artLaneInfo.color : hexToRgba(artLaneInfo.color, 0.65)}
                              />
                            </svg>

                            {/* ─── Main Event Card ─── */}
                            <div
                              onClick={() => onSelectArticle?.(art)}
                              style={{
                                borderColor: isSelected
                                  ? artLaneInfo.color
                                  : isHovered
                                  ? hexToRgba(artLaneInfo.color, 0.6)
                                  : undefined,
                                boxShadow: isSelected
                                  ? `0 0 0 2px ${artLaneInfo.color}, 0 12px 28px -4px rgba(0, 0, 0, 0.25)`
                                  : undefined
                              }}
                              className={`w-full h-full rounded-xl border relative cursor-pointer overflow-hidden group/card select-none flex flex-col justify-between transition-all ${
                                isSelected
                                  ? 'bg-white dark:bg-slate-900 z-30 shadow-xl'
                                  : isHovered
                                  ? 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 shadow-md'
                                  : 'bg-white/95 dark:bg-slate-900/90 border-slate-200/90 dark:border-slate-800/90 shadow-2xs hover:shadow-xs'
                              }`}
                            >
                              {/* Left/Right Duration Stem Accent on the Card */}
                              <div
                                className="absolute inset-y-0 w-1.5 transition-colors z-10"
                                style={{
                                  backgroundColor: artLaneInfo.color,
                                  [isRtl ? 'right' : 'left']: 0
                                }}
                              />

                              {/* Event Image Banner (if available) */}
                              {art.hasImage && art.imageUrl && (
                                <div className="w-full h-14 shrink-0 overflow-hidden relative bg-slate-200 dark:bg-slate-800">
                                  <img
                                    src={art.imageUrl}
                                    alt={art.title}
                                    className="w-full h-full object-cover group-hover/card:scale-105 transition-transform duration-300"
                                    loading="lazy"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                    }}
                                  />
                                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
                                  <div className="absolute bottom-1 inset-x-2 flex items-center justify-between pointer-events-none">
                                    <span className="text-[9px] font-bold text-white drop-shadow-xs px-1.5 py-0.2 rounded-full bg-black/40 backdrop-blur-xs">
                                      {timeSpan}
                                    </span>
                                  </div>
                                </div>
                              )}

                              {/* Card Body Content */}
                              <div className={`p-2 sm:p-2.5 flex-1 flex flex-col justify-between min-h-0 ${isRtl ? 'pr-3.5' : 'pl-3.5'}`}>
                                {/* Row 1: Title + Drag Grip Handle + Star Bookmark */}
                                <div className="flex items-start justify-between gap-1.5 min-w-0">
                                  <h4 className="text-xs sm:text-[13px] font-bold text-slate-900 dark:text-white leading-tight line-clamp-2 flex-1">
                                    {art.title}
                                  </h4>
                                  <div className="flex items-center gap-0.5 shrink-0">
                                    {/* Draggable Grip Handle */}
                                    <div
                                      onPointerDown={(e) => handleDragHandlePointerDown(e, art.id)}
                                      onPointerMove={(e) => handleDragHandlePointerMove(e, art.id)}
                                      onPointerUp={(e) => handleDragHandlePointerUp(e, art.id)}
                                      onPointerCancel={(e) => handleDragHandlePointerUp(e, art.id)}
                                      className="p-1 text-slate-300 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-300 cursor-grab active:cursor-grabbing rounded transition-colors active:scale-110"
                                      style={{ touchAction: 'none' }}
                                      title={t('mobile.dragToMove')}
                                    >
                                      <GripVertical className="w-3.5 h-3.5" />
                                    </div>
                                    {/* Star Button */}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onToggleStar?.(art.id);
                                      }}
                                      className={`p-1 rounded transition-colors cursor-pointer ${
                                        isStarred
                                          ? 'text-amber-500 bg-amber-500/10'
                                          : 'text-slate-300 dark:text-slate-600 hover:text-amber-500'
                                      }`}
                                      title={isStarred ? t('cardsList.unstar') : t('cardsList.star')}
                                    >
                                      <Star className={`w-3.5 h-3.5 ${isStarred ? 'fill-amber-400 text-amber-400' : ''}`} />
                                    </button>
                                  </div>
                                </div>

                                {/* Row 2: Date badge + Range badge (when no image banner) */}
                                {!art.hasImage && (
                                  <div className="flex items-center justify-between gap-1 mt-1">
                                    <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-bold">
                                      <Calendar className="w-2.5 h-2.5 text-sky-500" />
                                      <span>{timeSpan}</span>
                                    </div>

                                    {art.isRange && (
                                      <span
                                        className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
                                        style={{
                                          backgroundColor: `${artLaneInfo.color}20`,
                                          color: artLaneInfo.color
                                        }}
                                      >
                                        {Math.round(art.duration) > 0
                                          ? `${Math.round(art.duration)}y span`
                                          : 'Period'}
                                      </span>
                                    )}
                                  </div>
                                )}

                                {/* Subtitle / Snippet if available */}
                                {art.subtitle && (
                                  <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                                    {art.subtitle}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        /* ─── Mode 2: Sequential Cards Feed View ───────────────────── */
        <div
          className="flex-1 overflow-y-auto px-3 py-4 space-y-3 pb-28"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {feedArticles.map((art) => {
            const isSelected = selectedArticleId === art.id;
            const isStarred = Boolean(starredArticleIds?.has(art.id));
            const laneInfo = getArticleLaneInfo(art.lane);
            const timeSpan = formatTimeSpan(art.from, art.to, art.isToPresent);

            return (
              <article
                key={art.id}
                onClick={() => onSelectArticle?.(art)}
                style={{
                  borderColor: isSelected
                    ? laneInfo.color
                    : undefined,
                  boxShadow: isSelected
                    ? `0 0 0 2px ${laneInfo.color}, 0 10px 22px -4px rgba(0, 0, 0, 0.2)`
                    : undefined
                }}
                className={`p-3.5 rounded-2xl border transition-all cursor-pointer shadow-xs active:scale-[0.99] ${
                  isSelected
                    ? 'bg-white dark:bg-slate-900 shadow-md ring-0'
                    : 'bg-white dark:bg-slate-900/90 hover:bg-slate-50 dark:hover:bg-slate-850 border-slate-200/90 dark:border-slate-800/90'
                }`}
              >
                {art.imageUrl && (
                  <div className="w-full h-32 rounded-xl overflow-hidden mb-2.5 bg-slate-100 dark:bg-slate-950">
                    <img
                      src={art.imageUrl}
                      alt={art.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-1.5">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-snug flex-1">
                      {art.title}
                    </h3>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleStar?.(art.id);
                      }}
                      className={`p-1.5 rounded-lg transition-colors cursor-pointer shrink-0 ${
                        isStarred
                          ? 'text-amber-500 bg-amber-500/10'
                          : 'text-slate-300 dark:text-slate-600 hover:text-amber-500'
                      }`}
                      title={isStarred ? t('cardsList.unstar') : t('cardsList.star')}
                    >
                      <Star className={`w-4 h-4 ${isStarred ? 'fill-amber-400 text-amber-400' : ''}`} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {timeSpan}
                    </span>
                    {laneInfo && (
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full border"
                        style={{
                          backgroundColor: `${laneInfo.color}15`,
                          color: laneInfo.color,
                          borderColor: `${laneInfo.color}40`
                        }}
                      >
                        {laneInfo.title}
                      </span>
                    )}
                  </div>
                  {(art.subtitle || art.extract) && (
                    <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
                      {art.subtitle || art.extract}
                    </p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

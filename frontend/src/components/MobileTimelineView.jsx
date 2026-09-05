import React, { useState, useMemo, useRef } from 'react';
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
  ArrowUpDown
} from 'lucide-react';
import { getLaneColor, isColorLight } from '../data/laneColors';
import { useLanguage } from '../context/LanguageContext';

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
  theme = 'light'
}) {
  const { t, isRtl, formatTimeSpan, formatDatePart } = useLanguage();
  const [selectedLaneId, setSelectedLaneId] = useState('all');
  const [viewMode, setViewMode] = useState('ruler'); // 'ruler' | 'feed'
  const [scaleMultiplier, setScaleMultiplier] = useState(1.0);
  const [feedSortOrder, setFeedSortOrder] = useState('asc'); // for feed view
  const [hoveredArticleId, setHoveredArticleId] = useState(null);

  const articles = timelineData?.articles || [];
  const lanes = timelineData?.lanes || [];

  // Map lanes for fast lookup
  const laneMap = useMemo(() => {
    const map = new Map();
    lanes.forEach((lane, idx) => {
      const color = getLaneColor(lane, idx, lanes);
      map.set(lane.id, {
        title: lane.title,
        color,
        isLight: isColorLight(color)
      });
    });
    return map;
  }, [lanes]);

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

  // 3. Resolve overlapping sub-columns within each lane and assign ruler period tracks
  const { layoutArticles, rulerPeriodArticles } = useMemo(() => {
    const visible = processedArticles.filter((art) => {
      if (selectedLaneId !== 'all' && art.lane !== selectedLaneId) return false;
      return true;
    });

    // 3a. Sub-columns for cards within each lane
    const byLane = new Map();
    visible.forEach((art) => {
      const lId = art.lane || 'default';
      if (!byLane.has(lId)) byLane.set(lId, []);
      byLane.get(lId).push(art);
    });

    const cardList = [];

    byLane.forEach((laneArticles) => {
      laneArticles.sort((a, b) => {
        if (Math.abs(a.startYear - b.startYear) > 0.001) {
          return a.startYear - b.startYear;
        }
        return b.duration - a.duration;
      });

      const activeEnds = [];

      laneArticles.forEach((art) => {
        let placedCol = -1;
        for (let c = 0; c < activeEnds.length; c++) {
          if (activeEnds[c] <= art.startYear + 0.01) {
            placedCol = c;
            activeEnds[c] = art.endYear;
            break;
          }
        }

        if (placedCol === -1) {
          placedCol = activeEnds.length;
          activeEnds.push(art.endYear);
        }

        const startY = getYearY(art.startYear);
        const rawEndY = art.isRange ? getYearY(art.endYear) : startY;
        const heightY = Math.max(art.isRange ? 60 : 42, rawEndY - startY);

        cardList.push({
          ...art,
          subCol: placedCol,
          startY,
          endY: rawEndY,
          heightY
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
        height: Math.max(art.isRange ? 6 : 4, endY - startY)
      };
    });

    return {
      layoutArticles: cardList,
      rulerPeriodArticles: rulerDecorated
    };
  }, [processedArticles, selectedLaneId, minYear, pixelsPerYear]);

  // Height of ruler canvas
  const canvasHeight = Math.max(600, totalSpan * pixelsPerYear + 180);

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
      .filter((art) => selectedLaneId === 'all' || art.lane === selectedLaneId)
      .sort((a, b) => {
        if (feedSortOrder === 'desc') return b.startYear - a.startYear;
        return a.startYear - b.startYear;
      });
  }, [processedArticles, selectedLaneId, feedSortOrder]);

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

        {/* Row 2: Horizontal Swimlane Filter Chips */}
        {lanes.length > 0 && (
          <div
            className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 px-0.5"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
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
              const laneInfo = laneMap.get(lane.id);
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
        )}
      </div>

      {/* ─── Mode 1: Visual Proportional Time Ruler & Parallel Spans ─── */}
      {viewMode === 'ruler' ? (
        <div
          className="flex-1 overflow-y-auto overflow-x-auto relative pb-28"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
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
                  className="absolute inset-y-0 w-5 pointer-events-auto"
                  style={{ [isRtl ? 'left' : 'right']: '2px' }}
                >
                  {rulerPeriodArticles.map((art) => {
                    const laneInfo = laneMap.get(art.lane);
                    const isSelected = selectedArticleId === art.id;
                    const isHovered = hoveredArticleId === art.id;
                    const isHigh = isSelected || isHovered;
                    const trackOffset = art.rulerTrack * 6; // 0px, 6px, 12px

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
                          backgroundColor: laneInfo?.color || '#0284c7'
                        }}
                        className={`absolute w-1 rounded-full transition-all cursor-pointer ${
                          isHigh
                            ? 'w-2 ring-2 ring-white dark:ring-slate-900 z-30 shadow-md scale-y-[1.02]'
                            : 'opacity-70 hover:opacity-100 hover:w-1.5 z-10'
                        }`}
                        title={`${art.title} (${formatTimeSpan(art.from, art.to, art.isToPresent)})`}
                      >
                        {/* Top End Bracket Cap on Ruler */}
                        <div
                          className="absolute -top-0.5 w-2.5 h-0.5 -translate-x-0.5 rounded-full shadow-xs"
                          style={{ backgroundColor: laneInfo?.color || '#0284c7' }}
                        />
                        {/* Bottom End Bracket Cap on Ruler (if range) */}
                        {art.isRange && (
                          <div
                            className="absolute -bottom-0.5 w-2.5 h-0.5 -translate-x-0.5 rounded-full shadow-xs"
                            style={{ backgroundColor: laneInfo?.color || '#0284c7' }}
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
              {displayLanes.map((lane, laneIdx) => {
                const laneInfo = laneMap.get(lane.id);
                const laneArticles = layoutArticles.filter(
                  (a) => a.lane === lane.id || (!a.lane && lane.id === 'default')
                );

                return (
                  <div
                    key={lane.id}
                    className="flex-1 min-w-[240px] sm:min-w-[280px] relative border-e border-slate-200/60 dark:border-slate-800/60"
                  >
                    {/* Sticky Lane Column Header */}
                    <div className="sticky top-0 z-10 h-8 px-3 flex items-center justify-between bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 shadow-2xs">
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

                    {/* Events Placed Proportionally in this Lane with Range Connector Lines */}
                    <div className="relative w-full h-full p-2">
                      {laneArticles.map((art) => {
                        const isSelected = selectedArticleId === art.id;
                        const isHovered = hoveredArticleId === art.id;
                        const isHigh = isSelected || isHovered;
                        const timeSpan = formatTimeSpan(art.from, art.to, art.isToPresent);
                        const top = art.startY;
                        const height = art.heightY;

                        return (
                          <div
                            key={art.id}
                            style={{
                              top: `${top}px`,
                              height: `${height}px`,
                              width: art.subCol > 0 ? '88%' : '94%',
                              marginInlineStart: art.subCol > 0 ? '10%' : '3%'
                            }}
                            className="absolute"
                          >
                            {/* ─── Top Connector Line: from Ruler start tick to Card Top ─── */}
                            <div
                              className={`absolute top-0 h-px transition-all pointer-events-none ${
                                isHigh
                                  ? 'h-0.5 opacity-100 shadow-sm z-20'
                                  : 'opacity-35'
                              }`}
                              style={{
                                backgroundColor: laneInfo?.color || '#0284c7',
                                [isRtl ? 'right' : 'left']: '-2000px', // stretches across toward the ruler
                                [isRtl ? 'left' : 'right']: '100%'
                              }}
                            />

                            {/* ─── Bottom Connector Line: from Ruler end tick to Card Bottom (if range) ─── */}
                            {art.isRange && (
                              <div
                                className={`absolute bottom-0 h-px transition-all pointer-events-none ${
                                  isHigh
                                    ? 'h-0.5 opacity-100 shadow-sm z-20'
                                    : 'opacity-35'
                                }`}
                                style={{
                                  backgroundColor: laneInfo?.color || '#0284c7',
                                  [isRtl ? 'right' : 'left']: '-2000px', // stretches across toward the ruler
                                  [isRtl ? 'left' : 'right']: '100%'
                                }}
                              />
                            )}

                            {/* ─── Main Event Card ─── */}
                            <div
                              onClick={() => onSelectArticle?.(art)}
                              onMouseEnter={() => setHoveredArticleId(art.id)}
                              onMouseLeave={() => setHoveredArticleId(null)}
                              className={`relative w-full h-full rounded-2xl border transition-all duration-200 cursor-pointer overflow-hidden flex flex-col justify-between shadow-xs hover:shadow-lg active:scale-[0.99] group/card ${
                                isSelected
                                  ? 'ring-2 ring-sky-500 shadow-md z-30'
                                  : 'hover:z-20'
                              } ${
                                art.isRange
                                  ? 'bg-white/95 dark:bg-slate-900/95'
                                  : 'bg-white/95 dark:bg-slate-900/95'
                              }`}
                            >
                              {/* Left/Right Duration Stem Accent on the Card */}
                              <div
                                className="absolute inset-y-0 w-1.5 transition-colors"
                                style={{
                                  backgroundColor: laneInfo?.color || '#0284c7',
                                  [isRtl ? 'right' : 'left']: 0
                                }}
                              />

                              {/* Card Body */}
                              <div
                                className={`p-2.5 sm:p-3 flex flex-col justify-between h-full space-y-1.5 ${
                                  isRtl ? 'pr-4' : 'pl-4'
                                }`}
                              >
                                {/* 1. Title at the very TOP */}
                                <div className="min-w-0">
                                  <h4 className="text-xs sm:text-[13px] font-bold text-slate-900 dark:text-white leading-tight line-clamp-2">
                                    {art.title}
                                  </h4>

                                  {/* Date badge + Range span badge underneath title */}
                                  <div className="flex items-center justify-between gap-1 mt-1">
                                    <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-bold">
                                      <Calendar className="w-2.5 h-2.5 text-sky-500" />
                                      <span>{timeSpan}</span>
                                    </div>

                                    {art.isRange && (
                                      <span
                                        className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
                                        style={{
                                          backgroundColor: `${laneInfo?.color}20`,
                                          color: laneInfo?.color || '#0284c7'
                                        }}
                                      >
                                        {Math.round(art.duration) > 0
                                          ? `${Math.round(art.duration)}y span`
                                          : 'Period'}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* 2. Event Image Banner (if available and height allows) */}
                                {art.imageUrl && height >= 120 && (
                                  <div className="w-full h-16 sm:h-20 rounded-lg overflow-hidden relative bg-slate-100 dark:bg-slate-950 shrink-0">
                                    <img
                                      src={art.imageUrl}
                                      alt={art.title}
                                      loading="lazy"
                                      className="w-full h-full object-cover object-center group-hover/card:scale-105 transition-transform duration-300"
                                      onError={(e) => {
                                        e.currentTarget.style.display = 'none';
                                      }}
                                    />
                                  </div>
                                )}

                                {/* 3. Subtitle / Extract */}
                                {height >= 90 && (art.subtitle || art.extract) && (
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-snug">
                                    {art.subtitle || art.extract}
                                  </p>
                                )}

                                {/* Bottom Footer */}
                                {height >= 70 && (
                                  <div className="pt-1 flex items-center justify-between text-[10px] text-slate-400 border-t border-slate-100 dark:border-slate-800/80">
                                    {art.lat && art.lng ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onFocusOnMap?.(art);
                                        }}
                                        className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400 hover:underline"
                                      >
                                        <MapPin className="w-2.5 h-2.5" />
                                        <span className="truncate max-w-[90px]">
                                          {art.locationName || t('mobile.tapToViewMap')}
                                        </span>
                                      </button>
                                    ) : (
                                      <span>{art.wikiTitle ? 'Wiki' : ''}</span>
                                    )}

                                    <span className="inline-flex items-center text-slate-400 group-hover/card:text-sky-500">
                                      {t('common.learnMore')}
                                      <ChevronRight
                                        className={`w-3 h-3 ${isRtl ? 'rotate-180' : ''}`}
                                      />
                                    </span>
                                  </div>
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
            const laneInfo = laneMap.get(art.lane);
            const timeSpan = formatTimeSpan(art.from, art.to, art.isToPresent);
            const isSelected = selectedArticleId === art.id;

            return (
              <article
                key={art.id}
                onClick={() => onSelectArticle?.(art)}
                className={`p-3.5 rounded-2xl border transition-all cursor-pointer shadow-xs active:scale-[0.99] ${
                  isSelected
                    ? 'bg-sky-50/90 dark:bg-sky-950/40 border-sky-400 dark:border-sky-500 ring-2 ring-sky-500/20 shadow-md'
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
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">
                    {art.title}
                  </h3>
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

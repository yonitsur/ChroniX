import React, { useState, useMemo, useRef } from 'react';
import {
  Calendar,
  List,
  Columns,
  ArrowUpDown,
  Star,
} from 'lucide-react';
import { getLaneColor, isColorLight, DEFAULT_LANE_COLORS } from '../data/laneColors';
import { useLanguage } from '../context/LanguageContext';
import VerticalTimeline, { dateToDecimalYear } from './VerticalTimeline';

// Re-exported for backwards compatibility (canonical implementation lives in VerticalTimeline)
export { dateToDecimalYear };

/**
 * MobileTimelineView — the mobile timeline surface.
 *
 * Two modes:
 *  - 'ruler': the interactive VerticalTimeline engine (Histropedia-style vertical axis:
 *    pinch zoom, inertial panning, adaptive time scale, draggable cards, lane columns)
 *  - 'feed': a simple chronological card feed
 */
export default function MobileTimelineView({
  timelineData,
  onSelectArticle,
  selectedArticleId,
  onFocusOnMap,
  starredArticleIds,
  onToggleStar,
  filterStarredOnly = false,
  onToggleFilterStarredOnly,
  theme = 'light',
}) {
  const { t, isRtl, formatTimeSpan } = useLanguage();
  const [selectedLaneId, setSelectedLaneId] = useState('all');
  const [viewMode, setViewMode] = useState('ruler'); // 'ruler' | 'feed'
  const [feedSortOrder, setFeedSortOrder] = useState('asc');

  const articles = timelineData?.articles || [];
  const lanes = timelineData?.lanes || [];

  const starredCount = useMemo(
    () => articles.filter((a) => starredArticleIds?.has(a.id)).length,
    [articles, starredArticleIds]
  );

  // ─── Lane resolution (multi-key indexing: id, title, lowercase) ───
  const laneMap = useMemo(() => {
    const map = new Map();
    lanes.forEach((lane, idx) => {
      const color = getLaneColor(lane, idx, lanes);
      const entry = {
        id: lane.id,
        title: lane.title,
        index: idx,
        color,
        isLight: isColorLight(color),
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

  const getArticleLaneInfo = (laneIdentifier) => {
    if (!laneIdentifier && lanes.length > 0) {
      const first = lanes[0];
      return (
        laneMap.get(first.id) || {
          id: first.id,
          title: first.title || t('mobile.timeline'),
          index: 0,
          color: getLaneColor(first, 0, lanes),
          isLight: false,
        }
      );
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
          index: foundIdx,
          color,
          isLight: isColorLight(color),
        };
      }
    }
    // Deterministic fallback: hash the lane string into the museum palette
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
      index: 0,
      color,
      isLight: isColorLight(color),
    };
  };

  const laneCounts = useMemo(() => {
    const counts = {};
    articles.forEach((a) => {
      counts[a.lane] = (counts[a.lane] || 0) + 1;
    });
    return counts;
  }, [articles]);

  // ─── Numeric date processing ───
  const processedArticles = useMemo(() => {
    return articles.map((art) => {
      const start = dateToDecimalYear(art.from);
      let end = start;
      const isRange = Boolean(art.to || art.isToPresent);
      if (art.isToPresent) {
        end = new Date().getFullYear();
      } else if (art.to) {
        end = dateToDecimalYear(art.to);
      }
      if (end < start) end = start;
      return {
        ...art,
        startYear: start,
        endYear: end,
        isRange,
        duration: Math.max(0, end - start),
      };
    });
  }, [articles]);

  // ─── Filtering + lane column assignment for the engine ───
  const {
    engineArticles,
    engineLanes,
    minYear,
    maxYear,
  } = useMemo(() => {
    const filtered = processedArticles.filter((art) => {
      if (filterStarredOnly && !starredArticleIds?.has(art.id)) return false;
      if (selectedLaneId !== 'all' && art.lane !== selectedLaneId) return false;
      return true;
    });

    // Displayed lane columns
    let dispLanes;
    if (selectedLaneId !== 'all') {
      const found = lanes.find((l) => l.id === selectedLaneId);
      dispLanes = found ? [found] : [{ id: 'default', title: t('mobile.timeline') }];
    } else {
      dispLanes = lanes.length > 0 ? lanes : [{ id: 'default', title: t('mobile.timeline') }];
    }

    const laneIdxById = new Map(dispLanes.map((l, i) => [l.id, i]));

    const decorated = filtered.map((art) => {
      const laneInfo = getArticleLaneInfo(art.lane);
      let laneIndex = laneIdxById.has(laneInfo.id) ? laneIdxById.get(laneInfo.id) : 0;
      return { ...art, laneInfo, laneIndex };
    });

    // Per-column counts + colors for the engine's lane headers
    const colCounts = dispLanes.map(() => 0);
    decorated.forEach((a) => {
      colCounts[a.laneIndex] = (colCounts[a.laneIndex] || 0) + 1;
    });
    const engLanes = dispLanes.map((l, i) => {
      const info = getArticleLaneInfo(l.id);
      return {
        id: l.id,
        title: l.title || t('mobile.timeline'),
        color: info.color,
        isLight: info.isLight,
        count: colCounts[i] || 0,
      };
    });

    // Bounds with proportional padding
    let min = Infinity;
    let max = -Infinity;
    decorated.forEach((a) => {
      if (a.startYear < min) min = a.startYear;
      if (a.endYear > max) max = a.endYear;
    });
    if (!decorated.length) {
      min = 1900;
      max = 2000;
    }
    let span = max - min;
    if (span <= 0) {
      min -= 1;
      max += 1;
    } else {
      const padding = Math.max(0.5, span * 0.04);
      min -= padding;
      max += padding;
    }

    return { engineArticles: decorated, engineLanes: engLanes, minYear: min, maxYear: max };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedArticles, selectedLaneId, filterStarredOnly, starredArticleIds, lanes, laneMap, t]);

  // Re-fit the engine view whenever the dataset or filters change
  const timelineKeyRef = useRef(0);
  const timelineKey = useMemo(() => ++timelineKeyRef.current, [timelineData]);
  const fitKey = `${timelineKey}:${selectedLaneId}:${filterStarredOnly ? 1 : 0}`;

  // ─── Feed view articles ───
  const feedArticles = useMemo(() => {
    return [...processedArticles]
      .filter((art) => {
        if (filterStarredOnly && !starredArticleIds?.has(art.id)) return false;
        return selectedLaneId === 'all' || art.lane === selectedLaneId;
      })
      .sort((a, b) =>
        feedSortOrder === 'desc' ? b.startYear - a.startYear : a.startYear - b.startYear
      );
  }, [processedArticles, selectedLaneId, feedSortOrder, filterStarredOnly, starredArticleIds]);

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="w-full h-full flex flex-col bg-slate-100/80 dark:bg-slate-950 select-none overflow-hidden"
    >
      {/* ─── Top Control Header ────────────────────────────────────── */}
      <div className="shrink-0 bg-white/95 dark:bg-slate-900/90 backdrop-blur-xl border-b border-slate-200/80 dark:border-slate-800/80 pt-2 pb-2 px-3 shadow-2xs z-20 space-y-2">
        {/* Row 1: View Toggle (Ruler ⟷ Feed) + Feed sort */}
        <div className="flex items-center justify-between gap-2">
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

          {viewMode === 'feed' && (
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

        {/* Row 2: Star Filter + Lane Chips */}
        <div
          className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 px-0.5"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
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
              <span
                className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                  filterStarredOnly
                    ? 'bg-black/20 text-slate-950'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                {starredCount}
              </span>
            )}
          </button>

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

          {lanes.map((lane) => {
            const laneInfo = getArticleLaneInfo(lane.id);
            const isSelected = selectedLaneId === lane.id;
            const count = laneCounts[lane.id] || 0;

            return (
              <button
                key={lane.id}
                type="button"
                onClick={() => setSelectedLaneId(isSelected ? 'all' : lane.id)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer active:scale-95 ${
                  isSelected
                    ? 'shadow-xs ring-2 ring-sky-500/30 font-semibold'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                }`}
                style={{
                  backgroundColor: isSelected ? laneInfo?.color || '#0284c7' : undefined,
                  color: isSelected ? (laneInfo?.isLight ? '#0f172a' : '#ffffff') : undefined,
                  borderColor: isSelected
                    ? 'transparent'
                    : laneInfo?.color
                    ? `${laneInfo.color}66`
                    : undefined,
                }}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    backgroundColor: isSelected
                      ? laneInfo?.isLight
                        ? '#0f172a'
                        : '#ffffff'
                      : laneInfo?.color || '#0284c7',
                  }}
                />
                <span className="truncate max-w-[130px]">{lane.title}</span>
                <span
                  className="text-[10px] font-bold px-1.5 py-0.2 rounded-full"
                  style={{
                    backgroundColor: isSelected ? 'rgba(0,0,0,0.18)' : 'rgba(100,116,139,0.15)',
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Mode 1: Interactive Vertical Timeline Engine ─── */}
      {viewMode === 'ruler' ? (
        <VerticalTimeline
          articles={engineArticles}
          displayLanes={engineLanes}
          minYear={minYear}
          maxYear={maxYear}
          timeBands={timelineData?.timeBands || []}
          fitKey={fitKey}
          selectedArticleId={selectedArticleId}
          onSelectArticle={onSelectArticle}
          starredArticleIds={starredArticleIds}
          onToggleStar={onToggleStar}
          theme={theme}
        />
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
                  borderColor: isSelected ? laneInfo.color : undefined,
                  boxShadow: isSelected
                    ? `0 0 0 2px ${laneInfo.color}, 0 10px 22px -4px rgba(0, 0, 0, 0.2)`
                    : undefined,
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
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 inline-flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-sky-500" />
                      {timeSpan}
                    </span>
                    {laneInfo && (
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full border"
                        style={{
                          backgroundColor: `${laneInfo.color}15`,
                          color: laneInfo.color,
                          borderColor: `${laneInfo.color}40`,
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

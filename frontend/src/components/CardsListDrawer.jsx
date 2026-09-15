import React, { useState, useMemo } from 'react';
import {
  X,
  Search,
  Calendar,
  LayoutList,
  ArrowUpDown,
  Image as ImageIcon,
  ChevronLeft,
  Filter,
  MapPin,
  Star
} from 'lucide-react';
import { getLaneColor, getDistinctCategories, getCategoryColor } from '../data/laneColors';
import { useLanguage } from '../context/LanguageContext';
import { FLOATING_Z } from '../utils/floatingFocus';
import { isSameArticleId } from './TimelineView';

export default function CardsListDrawer({
  isOpen,
  onClose,
  articles = [],
  lanes = [],
  selectedArticleId,
  onSelectArticle,
  starredArticleIds,
  onToggleStar,
  filterStarredOnly = false,
  onToggleFilterStarredOnly,
  style = {}
}) {
  const { t, isRtl, formatTimeSpan } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLaneId, setSelectedLaneId] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [sortBy, setSortBy] = useState('chronological_asc'); // 'chronological_asc' | 'chronological_desc' | 'alphabetical'

  const starredCount = useMemo(() => {
    return articles.filter((a) => starredArticleIds?.has(a.id)).length;
  }, [articles, starredArticleIds]);

  // In a single (non-split) timeline, group/color by theme (`category`) instead of lane.
  const categories = useMemo(() => getDistinctCategories(articles), [articles]);
  const themedMode = lanes.length <= 1 && categories.length >= 2;

  // Map lanes for fast lookup
  const laneMap = useMemo(() => {
    const map = new Map();
    lanes.forEach((lane, idx) => {
      map.set(lane.id, {
        title: lane.title,
        color: getLaneColor(lane, idx, lanes),
      });
    });
    return map;
  }, [lanes]);

  // Resolves the badge (color + label) an event shows: theme in single timelines, else lane.
  const getEventBadge = (art) => {
    if (themedMode && art.category) {
      return { title: art.category, color: getCategoryColor(art.category, categories) };
    }
    return laneMap.get(art.lane) || null;
  };

  // Filter and sort articles
  const filteredArticles = useMemo(() => {
    return articles
      .filter((art) => {
        // Filter by starred if enabled
        if (filterStarredOnly && !starredArticleIds?.has(art.id)) {
          return false;
        }

        // Filter by lane
        if (selectedLaneId !== 'all') {
          if (art.lane !== selectedLaneId) return false;
        }

        // Filter by theme (single-timeline mode)
        if (themedMode && selectedCategory !== 'all') {
          if ((art.category || '') !== selectedCategory) return false;
        }

        // Filter by search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const titleMatch = art.title?.toLowerCase().includes(q);
          const subtitleMatch = art.subtitle?.toLowerCase().includes(q);
          const extractMatch = art.extract?.toLowerCase().includes(q);
          const laneName = (laneMap.get(art.lane)?.title || '').toLowerCase();
          const laneMatch = laneName.includes(q);
          const categoryMatch = (art.category || '').toLowerCase().includes(q);
          const yearMatch = art.from?.year?.toString().includes(q);

          return titleMatch || subtitleMatch || extractMatch || laneMatch || categoryMatch || yearMatch;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'alphabetical') {
          return (a.title || '').localeCompare(b.title || '');
        }

        const aYear = a.from?.year ?? 0;
        const bYear = b.from?.year ?? 0;
        const aMonth = a.from?.month ?? 1;
        const bMonth = b.from?.month ?? 1;
        const aDay = a.from?.day ?? 1;
        const bDay = b.from?.day ?? 1;

        if (sortBy === 'chronological_desc') {
          if (aYear !== bYear) return bYear - aYear;
          if (aMonth !== bMonth) return bMonth - aMonth;
          return bDay - aDay;
        }

        // Default: chronological_asc
        if (aYear !== bYear) return aYear - bYear;
        if (aMonth !== bMonth) return aMonth - bMonth;
        return aDay - bDay;
      });
  }, [articles, searchQuery, selectedLaneId, selectedCategory, themedMode, categories, sortBy, laneMap]);

  if (!isOpen) return null;

  const hasRtl = (str) => /[\u0590-\u05FF\u0600-\u06FF]/.test(str || '');

  return (
    <aside
      className={`absolute inset-y-0 right-0 left-0 sm:left-auto sm:w-[420px] bg-surface-overlay border-l border-line shadow-panel flex flex-col transition-transform duration-300 ease-in-out font-sans ${
        isRtl ? 'text-right' : 'text-left'
      }`}
      style={{
        top: 0,
        bottom: 0,
        zIndex: FLOATING_Z.DRAWER,
        ...style,
      }}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-line">
        <div className="flex items-center gap-2">
          <LayoutList className="w-4 h-4 text-accent" />
          <h2 className="font-bold text-sm text-ink">
            {t('cardsList.title')}
          </h2>
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-surface-sunken text-ink-muted border border-line">
            {filteredArticles.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-ink-subtle hover:text-ink hover:bg-surface-hover rounded-control transition-colors cursor-pointer"
          title={t('common.close')}
          aria-label={t('common.close')}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Search & Filter Controls */}
      <div className="p-3 border-b border-line bg-surface-sunken space-y-2">
        {/* Search Input */}
        <div className="relative flex items-center">
          <Search className="w-4 h-4 absolute left-3 text-ink-subtle pointer-events-none" />
          <input
            type="text"
            dir={searchQuery ? (hasRtl(searchQuery) ? 'rtl' : 'ltr') : (isRtl ? 'rtl' : 'ltr')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('cardsList.searchPlaceholder')}
            className={`w-full pl-9 pr-8 py-1.5 text-xs bg-surface-raised border border-line rounded-control text-ink placeholder-ink-faint focus:outline-none focus:ring-1 focus:ring-accent-ring/30 focus:border-accent transition-all shadow-control ${
              (searchQuery ? hasRtl(searchQuery) : isRtl) ? 'text-right' : 'text-left'
            }`}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 text-ink-subtle hover:text-ink text-xs p-0.5 cursor-pointer"
              title={t('cardsList.clearSearch')}
            >
              ✕
            </button>
          )}
        </div>

        {/* Sort, Lane & Star Filters Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          {/* Left: Star filter toggle button */}
          <button
            type="button"
            onClick={onToggleFilterStarredOnly}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-control text-[11px] font-semibold border transition-all cursor-pointer ${
              filterStarredOnly
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400 shadow-control'
                : 'bg-surface-raised border-line text-ink-muted hover:text-ink'
            }`}
            title={filterStarredOnly ? t('toolbar.filterStarredActive') : t('toolbar.filterStarred')}
            aria-pressed={filterStarredOnly}
          >
            <Star className={`w-3.5 h-3.5 ${filterStarredOnly ? 'fill-amber-400 text-amber-500' : 'text-ink-subtle'}`} />
            <span>{t('cardsList.filterStarred')}</span>
            {starredCount > 0 && (
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                filterStarredOnly
                  ? 'bg-amber-200 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200'
                  : 'bg-surface-sunken text-ink-muted'
              }`}>
                {starredCount}
              </span>
            )}
          </button>

          <div className="flex items-center gap-2">
            {/* Sort Selector */}
            <div className="flex items-center gap-1 text-ink-subtle">
              <ArrowUpDown className="w-3 h-3 text-ink-subtle" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="bg-surface-raised border border-line text-ink rounded-control px-2 py-1 text-[11px] font-medium outline-none focus:border-accent"
              >
                <option value="chronological_asc">{t('cardsList.sortChronologicalAsc')}</option>
                <option value="chronological_desc">{t('cardsList.sortChronologicalDesc')}</option>
                <option value="alphabetical">{t('cardsList.sortAlphabetical')}</option>
              </select>
            </div>

            {/* Lane / Theme Filter dropdown */}
            {themedMode ? (
              <div className="flex items-center gap-1 text-ink-subtle">
                <Filter className="w-3 h-3 text-ink-subtle" />
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="bg-surface-raised border border-line text-ink rounded-control px-2 py-1 text-[11px] font-medium outline-none focus:border-accent max-w-[110px] truncate"
                >
                  <option value="all">{t('cardsList.allThemes')}</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              lanes.length > 0 && (
                <div className="flex items-center gap-1 text-ink-subtle">
                  <Filter className="w-3 h-3 text-ink-subtle" />
                  <select
                    value={selectedLaneId}
                    onChange={(e) => setSelectedLaneId(e.target.value)}
                    className="bg-surface-raised border border-line text-ink rounded-control px-2 py-1 text-[11px] font-medium outline-none focus:border-accent max-w-[110px] truncate"
                  >
                    <option value="all">{t('cardsList.allLanes')}</option>
                    {lanes.map((lane) => (
                      <option key={lane.id} value={lane.id}>
                        {lane.title}
                      </option>
                    ))}
                  </select>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* Cards Scroll Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 divide-y-0 pb-20 md:pb-3">
        {filteredArticles.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-ink-subtle gap-2 text-center px-4">
            {filterStarredOnly ? (
              <>
                <Star className="w-8 h-8 opacity-40 text-amber-500" />
                <p className="text-xs max-w-xs">{t('cardsList.noStarredResults')}</p>
                <button
                  type="button"
                  onClick={onToggleFilterStarredOnly}
                  className="text-xs text-accent underline font-medium cursor-pointer"
                >
                  {t('toolbar.filterStarredActive')}
                </button>
              </>
            ) : (
              <>
                <Search className="w-8 h-8 opacity-40" />
                <p className="text-xs">{t('cardsList.noResults')}</p>
                {(searchQuery || selectedLaneId !== 'all' || selectedCategory !== 'all') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedLaneId('all');
                      setSelectedCategory('all');
                    }}
                    className="text-xs text-accent underline font-medium cursor-pointer"
                  >
                    {t('cardsList.resetFilters')}
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          filteredArticles.map((art) => {
            const isSelected = isSameArticleId(selectedArticleId, art.id);
            const isStarred = Boolean(starredArticleIds?.has(art.id) || (art.id != null && (starredArticleIds?.has(String(art.id)) || starredArticleIds?.has(Number(art.id)))));
            const timeSpan = formatTimeSpan(art.from, art.to, art.isToPresent);
            const laneInfo = getEventBadge(art);
            const isItemRtl = hasRtl((art.title || '') + ' ' + (art.subtitle || ''));

            return (
              <div
                key={art.id}
                onClick={() => onSelectArticle(art)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectArticle(art);
                  }
                }}
                className={`group relative flex items-center gap-3 p-2.5 rounded-panel border transition-all cursor-pointer text-start ${
                  isSelected
                    ? 'bg-accent-soft border-accent ring-1 ring-accent-ring/30 shadow-control'
                    : 'bg-surface-raised hover:bg-surface-hover border-line hover:border-line-strong shadow-control'
                }`}
              >
                {/* Thumbnail / Icon */}
                <div className="w-12 h-12 rounded-control bg-surface-sunken border border-line overflow-hidden shrink-0 flex items-center justify-center">
                  {art.imageUrl ? (
                    <img
                      src={art.imageUrl}
                      alt={art.title}
                      className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-200"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <Calendar className="w-5 h-5 text-ink-subtle" />
                  )}
                </div>

                {/* Content */}
                <div
                  className={`flex-1 min-w-0 ${isItemRtl ? 'text-right' : (isRtl ? 'text-right' : 'text-left')}`}
                  dir={isItemRtl ? 'rtl' : (isRtl ? 'rtl' : 'ltr')}
                >
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-semibold text-xs sm:text-[13px] text-ink truncate leading-snug">
                      {art.title}
                    </h3>
                  </div>

                  {art.subtitle && (
                    <p className="text-[11px] text-ink-muted line-clamp-2 mt-0.5 leading-relaxed">
                      {art.subtitle}
                    </p>
                  )}

                  {/* Badges: Time & Lane */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    {timeSpan && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-accent bg-accent-soft border border-accent/20 px-1.5 py-0.5 rounded-control">
                        <Calendar className="w-2.5 h-2.5" />
                        <span>{timeSpan}</span>
                      </span>
                    )}

                    {laneInfo && (
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-ink bg-surface-sunken border border-line px-1.5 py-0.5 rounded-control truncate max-w-[120px]">
                        <span className="w-2 h-2 rounded-full shrink-0 shadow-2xs" style={{ backgroundColor: laneInfo.color }} />
                        <span className="truncate">{laneInfo.title}</span>
                      </span>
                    )}

                    {art.locationName && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-ink bg-surface-sunken border border-line px-1.5 py-0.5 rounded-control truncate max-w-[120px]" title={art.locationName}>
                        <MapPin className="w-2.5 h-2.5 text-danger shrink-0" />
                        <span className="truncate">{art.locationName}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Right action area: Star Button + Select marker */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleStar?.(art.id);
                    }}
                    className={`p-1.5 rounded-control transition-colors cursor-pointer ${
                      isStarred
                        ? 'text-amber-500 bg-amber-500/10'
                        : 'text-ink-faint hover:text-amber-500 hover:bg-surface-hover'
                    }`}
                    title={isStarred ? t('cardsList.unstar') : t('cardsList.star')}
                    aria-label={isStarred ? t('cardsList.unstar') : t('cardsList.star')}
                  >
                    <Star className={`w-4 h-4 ${isStarred ? 'fill-amber-400 text-amber-400' : ''}`} />
                  </button>

                  <div
                    className={`transition-colors ${
                      isSelected
                        ? 'text-accent'
                        : 'text-ink-faint group-hover:text-accent'
                    }`}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer hint */}
      <div className="px-4 py-2 border-t border-line bg-surface-sunken text-[11px] text-ink-subtle flex items-center justify-between">
        <span>{t('cardsList.clickToFocusHint')}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-ink hover:text-accent font-medium cursor-pointer"
        >
          {t('common.close')}
        </button>
      </div>
    </aside>
  );
}

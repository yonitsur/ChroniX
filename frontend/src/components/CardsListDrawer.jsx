import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  X,
  Search,
  Calendar,
  LayoutList,
  ArrowUpDown,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  Filter,
  MapPin,
  Star,
  Layers,
  Tag,
  ChevronDown,
  Check
} from 'lucide-react';
import { getLaneColor, getDistinctCategories, getCategoryColor } from '../data/laneColors';
import { useLanguage } from '../context/LanguageContext';
import { FLOATING_Z } from '../utils/floatingFocus';
import { isSameArticleId } from './TimelineView';

function ColorFilterSelect({
  value,
  onChange,
  options = [],
  allLabel,
  icon: Icon,
  align = 'start',
  isRtl = false,
  className = '',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const selected = options.find((o) => o.value === value);
  const isFiltered = value !== 'all';

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={selected?.label || allLabel}
        className={`w-full min-w-0 bg-surface-raised border rounded-control px-2 py-1 text-caption font-medium outline-none focus:border-accent focus:ring-1 focus:ring-accent-ring/30 flex items-center justify-between gap-1.5 cursor-pointer shadow-control transition-colors ${
          isFiltered
            ? 'border-accent text-accent font-semibold bg-accent/5'
            : 'border-line text-ink hover:border-line-strong hover:bg-surface-hover'
        }`}
      >
        <span className="flex items-center gap-1.5 min-w-0 flex-1">
          {selected?.color ? (
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0 shadow-2xs ring-1 ring-black/10 dark:ring-white/15"
              style={{ backgroundColor: selected.color }}
            />
          ) : (
            Icon && <Icon className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
          )}
          <span className="truncate flex-1 text-start">
            {selected?.label || allLabel}
          </span>
        </span>
        <ChevronDown
          className={`w-3 h-3 text-ink-subtle shrink-0 transition-transform duration-150 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          dir={isRtl ? 'rtl' : 'ltr'}
          className={`absolute z-30 mt-1 w-full min-w-[170px] max-w-[250px] max-h-56 overflow-y-auto rounded-control border border-line bg-surface-overlay shadow-panel py-1 text-caption ${
            align === 'end' ? 'ltr:right-0 rtl:left-0' : 'ltr:left-0 rtl:right-0'
          }`}
        >
          {options.map((opt) => {
            const isActive = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`w-full px-2.5 py-1.5 flex items-center gap-2 transition-colors cursor-pointer text-start ${
                  isActive
                    ? 'bg-accent-soft text-accent font-semibold'
                    : 'text-ink hover:bg-surface-hover'
                }`}
              >
                {opt.color ? (
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 shadow-2xs ring-1 ring-black/10 dark:ring-white/15"
                    style={{ backgroundColor: opt.color }}
                  />
                ) : (
                  Icon && <Icon className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                )}
                <span className="truncate flex-1 font-medium">{opt.label}</span>
                {isActive && <Check className="w-3.5 h-3.5 shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

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

  // Topic (`category`) drives color coding, independent of the lane/timeline split
  // which only controls which parallel track an event sits in.
  const categories = useMemo(() => getDistinctCategories(articles), [articles]);

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

  // Options for Topic filter with color dots
  const categoryOptions = useMemo(() => {
    return [
      { value: 'all', label: t('cardsList.allThemes'), color: null },
      ...categories.map((cat) => ({
        value: cat,
        label: cat,
        color: getCategoryColor(cat, categories),
      })),
    ];
  }, [categories, t]);

  // Options for Lane filter with color dots
  const laneOptions = useMemo(() => {
    return [
      { value: 'all', label: t('cardsList.allLanes'), color: null },
      ...lanes.map((lane, idx) => ({
        value: lane.id,
        label: lane.title,
        color: laneMap.get(lane.id)?.color || getLaneColor(lane, idx, lanes),
      })),
    ];
  }, [lanes, laneMap, t]);

  // Topic badge (with topic color)
  const getTopicBadge = (art) => {
    if (art.category) {
      return { title: art.category, color: getCategoryColor(art.category, categories) };
    }
    return null;
  };

  // Filter and sort articles
  const filteredArticles = useMemo(() => {
    return articles
      .filter((art) => {
        // Filter by starred if enabled
        if (filterStarredOnly && !starredArticleIds?.has(art.id)) {
          return false;
        }

        // Filter by timeline track / lane
        if (selectedLaneId !== 'all') {
          if (art.lane !== selectedLaneId) return false;
        }

        // Filter by topic / category
        if (selectedCategory !== 'all') {
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
  }, [articles, searchQuery, selectedLaneId, selectedCategory, categories, sortBy, laneMap]);

  if (!isOpen) return null;

  const hasRtl = (str) => /[\u0590-\u05FF\u0600-\u06FF]/.test(str || '');

  return (
    <aside
      className={`fixed md:absolute inset-y-0 left-0 md:left-[52px] w-full sm:w-[400px] max-w-[calc(100vw-52px)] bg-surface-overlay border-r border-line shadow-panel flex flex-col transition-transform duration-300 ease-in-out font-sans overflow-hidden ${
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
          <span className="text-caption font-medium px-2 py-0.5 rounded-full bg-surface-sunken text-ink-muted border border-line">
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
      <div className="p-3 border-b border-line bg-surface-sunken space-y-2 relative z-20">
        {/* Search Input */}
        <div className="relative flex items-center">
          <Search className="w-4 h-4 absolute start-3 text-ink-subtle pointer-events-none" />
          <input
            type="text"
            dir={searchQuery ? (hasRtl(searchQuery) ? 'rtl' : 'ltr') : (isRtl ? 'rtl' : 'ltr')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('cardsList.searchPlaceholder')}
            className={`w-full ps-9 pe-8 py-1.5 text-xs bg-surface-raised border border-line rounded-control text-ink placeholder-ink-faint focus:outline-none focus:ring-1 focus:ring-accent-ring/30 focus:border-accent transition-all shadow-control ${
              (searchQuery ? hasRtl(searchQuery) : isRtl) ? 'text-right' : 'text-left'
            }`}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute end-2.5 text-ink-subtle hover:text-ink text-xs p-0.5 cursor-pointer"
              title={t('cardsList.clearSearch')}
            >
              ✕
            </button>
          )}
        </div>

        {/* Row 1: Star filter toggle & Sort Selector */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          {/* Star filter toggle button */}
          <button
            type="button"
            onClick={onToggleFilterStarredOnly}
            className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-control text-caption font-semibold border transition-all cursor-pointer ${
              filterStarredOnly
                ? 'bg-star/15 border-star/30 text-star shadow-control'
                : 'bg-surface-raised border-line text-ink-muted hover:text-ink hover:bg-surface-hover'
            }`}
            title={filterStarredOnly ? t('toolbar.filterStarredActive') : t('toolbar.filterStarred')}
            aria-pressed={filterStarredOnly}
          >
            <Star className={`w-3.5 h-3.5 shrink-0 ${filterStarredOnly ? 'fill-star text-star' : 'text-ink-subtle'}`} />
            <span>{t('cardsList.filterStarred')}</span>
            {starredCount > 0 && (
              <span className={`px-1.5 py-0.2 rounded-full text-caption font-bold ${
                filterStarredOnly
                  ? 'bg-star/20 text-star'
                  : 'bg-surface-sunken text-ink-muted'
              }`}>
                {starredCount}
              </span>
            )}
          </button>

          {/* Sort Selector */}
          <div className="flex items-center gap-1.5 text-ink-subtle min-w-0 flex-1 justify-end max-w-[220px]">
            <ArrowUpDown className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full min-w-0 bg-surface-raised border border-line text-ink rounded-control px-2 py-1 text-caption font-medium outline-none focus:border-accent truncate cursor-pointer shadow-control transition-colors"
            >
              <option value="chronological_asc">{t('cardsList.sortChronologicalAsc')}</option>
              <option value="chronological_desc">{t('cardsList.sortChronologicalDesc')}</option>
              <option value="alphabetical">{t('cardsList.sortAlphabetical')}</option>
            </select>
          </div>
        </div>

        {/* Row 2: Topic & Timeline Track Filters (when available) */}
        {(categories.length > 0 || lanes.length > 1) && (
          <div className="flex items-center gap-2 text-xs pt-0.5">
            {/* Topic Filter dropdown with color dots */}
            {categories.length > 0 && (
              <ColorFilterSelect
                value={selectedCategory}
                onChange={setSelectedCategory}
                options={categoryOptions}
                allLabel={t('cardsList.allThemes')}
                icon={Tag}
                align="start"
                isRtl={isRtl}
                className="flex-1 min-w-0"
              />
            )}

            {/* Timeline Track / Lane Filter dropdown with color dots */}
            {lanes.length > 1 && (
              <ColorFilterSelect
                value={selectedLaneId}
                onChange={setSelectedLaneId}
                options={laneOptions}
                allLabel={t('cardsList.allLanes')}
                icon={Layers}
                align={categories.length > 0 ? 'end' : 'start'}
                isRtl={isRtl}
                className="flex-1 min-w-0"
              />
            )}
          </div>
        )}
      </div>

      {/* Cards Scroll Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 divide-y-0 pb-20 md:pb-3">
        {filteredArticles.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-ink-subtle gap-2 text-center px-4">
            {filterStarredOnly ? (
              <>
                <Star className="w-8 h-8 opacity-40 text-star" />
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
            const topicBadge = getTopicBadge(art);
            const laneInfo = lanes.length > 1 ? laneMap.get(art.lane) : null;
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
                className={`group relative flex items-start gap-3 p-3 rounded-panel border transition-all cursor-pointer text-start ${
                  isSelected
                    ? 'bg-accent-soft border-accent ring-1 ring-accent-ring/30 shadow-control'
                    : 'bg-surface-raised hover:bg-surface-hover border-line hover:border-line-strong shadow-control'
                }`}
              >
                {/* Thumbnail / Icon */}
                <div className="w-12 h-12 rounded-control bg-surface-sunken border border-line overflow-hidden shrink-0 flex items-center justify-center mt-0.5">
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
                    <h3 className="font-semibold text-body-sm text-ink leading-snug">
                      {art.title}
                    </h3>
                  </div>

                  {art.subtitle && (
                    <p className="text-caption text-ink-muted line-clamp-2 mt-0.5 leading-relaxed">
                      {art.subtitle}
                    </p>
                  )}

                  {/* Details on separate lines: Date, Topic, Lane, Location */}
                  <div className="mt-2.5 space-y-1.5 text-caption">
                    {/* Line 1: Date */}
                    {timeSpan && (
                      <div className="flex items-center">
                        <span className="inline-flex items-center gap-1.5 font-medium text-accent bg-accent-soft border border-accent/20 px-2 py-0.5 rounded-control">
                          <Calendar className="w-3 h-3 shrink-0" />
                          <span>{timeSpan}</span>
                        </span>
                      </div>
                    )}

                    {/* Line 2: Topic (label icon + topic color + full topic text) */}
                    {topicBadge && (
                      <div className="flex items-center gap-2 text-ink font-medium">
                        <Tag className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0 shadow-2xs ring-1 ring-black/10 dark:ring-white/15"
                          style={{ backgroundColor: topicBadge.color }}
                        />
                        <span className="leading-snug break-words">{topicBadge.title}</span>
                      </div>
                    )}

                    {/* Line 3: Lane (lane icon + lane color + full lane text) */}
                    {laneInfo && (
                      <div className="flex items-center gap-2 text-ink font-medium">
                        <Layers className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                        {laneInfo.color && (
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0 shadow-2xs ring-1 ring-black/10 dark:ring-white/15"
                            style={{ backgroundColor: laneInfo.color }}
                          />
                        )}
                        <span className="leading-snug break-words">{laneInfo.title}</span>
                      </div>
                    )}

                    {/* Line 4: Location (location icon + full location text) */}
                    {art.locationName && (
                      <div className="flex items-center gap-2 text-ink-muted">
                        <MapPin className="w-3.5 h-3.5 text-danger shrink-0" />
                        <span className="leading-snug break-words">{art.locationName}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right action area: Star Button + Select marker */}
                <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleStar?.(art.id);
                    }}
                    className={`p-1.5 rounded-control transition-colors cursor-pointer ${
                      isStarred
                        ? 'text-star bg-star/10'
                        : 'text-ink-faint hover:text-star hover:bg-surface-hover'
                    }`}
                    title={isStarred ? t('cardsList.unstar') : t('cardsList.star')}
                    aria-label={isStarred ? t('cardsList.unstar') : t('cardsList.star')}
                  >
                    <Star className={`w-4 h-4 ${isStarred ? 'fill-star text-star' : ''}`} />
                  </button>

                  <div
                    className={`transition-colors ${
                      isSelected
                        ? 'text-accent'
                        : 'text-ink-faint group-hover:text-accent'
                    }`}
                  >
                    {isRtl ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer hint */}
      <div className="px-4 py-2 border-t border-line bg-surface-sunken text-caption text-ink-subtle flex items-center justify-between">
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

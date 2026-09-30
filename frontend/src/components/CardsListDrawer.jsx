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
  Check,
  Pencil
} from 'lucide-react';
import { getDistinctCategories, getCategoryColor } from '../data/laneColors';
import { useLanguage } from '../context/LanguageContext';
import { FLOATING_Z } from '../utils/floatingFocus';
import { isSameArticleId } from '../utils/timelineArticles';
import { normalizeAnimatedMediaUrl } from './EventDrawer';
import MathMarkdown from './MathMarkdown';

function ColorFilterSelect({
  value,
  onChange,
  options = [],
  allLabel,
  icon: Icon,
  align = 'start',
  isRtl = false,
  className = '',
  defaultValue = 'all',
  highlightFiltered = true,
  showOptionIcon = true,
  ariaLabel,
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
  const isFiltered = highlightFiltered && value !== defaultValue;

  return (
    <div ref={rootRef} className={`relative min-w-0 ${isOpen ? 'z-30' : ''} ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel || selected?.label || allLabel}
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
            Icon && (
              <Icon
                className={`w-3.5 h-3.5 shrink-0 ${
                  isFiltered ? 'text-accent' : 'text-ink-subtle'
                }`}
              />
            )
          )}
          <span className="truncate flex-1 text-start">
            {selected?.label || allLabel}
          </span>
        </span>
        <ChevronDown
          className={`w-3 h-3 shrink-0 transition-transform duration-150 ${
            isFiltered ? 'text-accent' : 'text-ink-subtle'
          } ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          dir={isRtl ? 'rtl' : 'ltr'}
          className={`absolute z-30 mt-1 min-w-[170px] sm:min-w-full w-max max-w-[260px] max-h-56 overflow-y-auto rounded-control border border-line bg-surface-overlay shadow-panel py-1 text-caption ${
            align === 'end' ? 'end-0' : 'start-0'
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
                ) : opt.icon ? (
                  <opt.icon
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isActive ? 'text-accent' : 'text-ink-subtle'
                    }`}
                  />
                ) : showOptionIcon && Icon ? (
                  <Icon
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isActive ? 'text-accent' : 'text-ink-subtle'
                    }`}
                  />
                ) : null}
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
  presentation = 'drawer',
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
  const isPage = presentation === 'page';
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLaneId, setSelectedLaneId] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [sortBy, setSortBy] = useState('chronological_asc'); // 'chronological_asc' | 'chronological_desc' | 'alphabetical'

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const touchStartYRef = useRef(0);
  const handleTouchStart = (e) => {
    touchStartYRef.current = e.touches[0].clientY;
  };
  const handleTouchEnd = (e) => {
    const deltaY = e.changedTouches[0].clientY - touchStartYRef.current;
    if (deltaY > 60) {
      onClose?.();
    }
  };

  const starredCount = useMemo(() => {
    return articles.filter((a) => starredArticleIds?.has(a.id)).length;
  }, [articles, starredArticleIds]);

  // Topic (`category`) drives color coding, independent of the lane/timeline split
  // which only controls which parallel track an event sits in.
  const categories = useMemo(() => getDistinctCategories(articles), [articles]);

  // Map lanes for fast lookup
  const laneMap = useMemo(() => {
    const map = new Map();
    lanes.forEach((lane) => {
      map.set(lane.id, {
        title: lane.title,
        color: null,
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

  // Options for Lane filter (clean, no color dots)
  const laneOptions = useMemo(() => {
    return [
      { value: 'all', label: t('cardsList.allLanes'), color: null },
      ...lanes.map((lane) => ({
        value: lane.id,
        label: lane.title,
        color: null,
      })),
    ];
  }, [lanes, t]);

  // Options for Sort selector
  const sortOptions = useMemo(() => {
    return [
      { value: 'chronological_asc', label: t('cardsList.sortChronologicalAsc') },
      { value: 'chronological_desc', label: t('cardsList.sortChronologicalDesc') },
      { value: 'alphabetical', label: t('cardsList.sortAlphabetical') },
    ];
  }, [t]);

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
  }, [articles, searchQuery, selectedLaneId, selectedCategory, sortBy, laneMap, filterStarredOnly, starredArticleIds]);

  const hasRtl = (str) => /[\u0590-\u05FF\u0600-\u06FF]/.test(str || '');

  // Keep the active event centred in the list (e.g. as the guided tour advances).
  const scrollAreaRef = useRef(null);
  useEffect(() => {
    const container = scrollAreaRef.current;
    if (!container || selectedArticleId == null) return;
    const card = [...container.querySelectorAll('[data-article-id]')]
      .find((el) => isSameArticleId(el.getAttribute('data-article-id'), selectedArticleId));
    if (!card) return;
    const contRect = container.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const dock = document.getElementById('chronix-mobile-bottom-dock');
    const dockTop = dock && dock.offsetParent ? dock.getBoundingClientRect().top : Infinity;
    const visibleH = Math.max(0, Math.min(contRect.bottom, dockTop) - contRect.top);
    const offset = cardRect.top - contRect.top;
    const centred = offset - Math.max(8, (visibleH - cardRect.height) / 2);
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    container.scrollTo({ top: container.scrollTop + centred, behavior: reduceMotion ? 'auto' : 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedArticleId]);

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {!isPage && isMobile && isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 md:hidden animate-in fade-in duration-200"
          onClick={onClose}
        />
      )}
      <aside
        role="complementary"
        inert={!isOpen}
        className={`${
          isPage
            ? 'relative w-full h-full bg-surface flex flex-col font-sans overflow-hidden'
            : `fixed md:absolute inset-x-0 bottom-0 md:inset-y-0 md:left-[52px] md:right-auto w-full md:w-[380px] lg:w-[440px] md:max-w-[calc(100vw-56px)] h-[86vh] md:h-full max-h-[90vh] md:max-h-full rounded-t-3xl md:rounded-none bg-surface-overlay border-t md:border-t-0 md:border-r border-line shadow-2xl flex flex-col transition-all duration-300 ease-in-out font-sans overflow-hidden z-50 ${
                isOpen
                  ? (isMobile ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-x-0 opacity-100 pointer-events-auto')
                  : (isMobile ? 'translate-y-full opacity-0 pointer-events-none' : '-translate-x-full opacity-0 pointer-events-none')
              }`
        } ${
          isRtl ? 'text-right' : 'text-left'
        }`}
        style={isPage || isMobile ? undefined : {
          top: 0,
          bottom: 0,
          zIndex: FLOATING_Z.DRAWER,
          ...style,
        }}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Mobile Native Drag Handle */}
        {!isPage && isMobile && (
          <div
            className="w-full flex flex-col items-center pt-3 pb-1 cursor-grab active:cursor-grabbing shrink-0 touch-none"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div className="w-10 h-1 rounded-full bg-line-strong" />
          </div>
        )}
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
        {!isPage && (
          <button
            type="button"
            onClick={onClose}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center p-2 text-ink-subtle hover:text-ink hover:bg-surface-hover rounded-full transition-all cursor-pointer active:scale-95 touch-manipulation"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        )}
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
          <ColorFilterSelect
            value={sortBy}
            onChange={setSortBy}
            options={sortOptions}
            icon={ArrowUpDown}
            align="end"
            isRtl={isRtl}
            defaultValue="chronological_asc"
            showOptionIcon={false}
            ariaLabel={t('cardsList.sortBy')}
            className="ms-auto min-w-0 flex-1 max-w-[210px]"
          />
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
      <div ref={scrollAreaRef} className="flex-1 overflow-y-auto p-3 space-y-2 divide-y-0 pb-20 md:pb-3">
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
            const isEdited = Boolean(art.isEdited || art.is_edited || art.isManuallyEdited || art.is_manually_edited);

            return (
              <div
                key={art.id}
                data-article-id={art.id}
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
                <div className="relative w-12 h-12 rounded-control bg-surface-sunken border border-line overflow-hidden shrink-0 flex items-center justify-center mt-0.5">
                  {art.imageUrl ? (
                    <img
                      src={normalizeAnimatedMediaUrl(art.imageUrl)}
                      alt={art.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      style={{ objectPosition: `${art.imagePositionX ?? 50}% ${art.imagePositionY ?? 50}%` }}
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
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h3 className="font-semibold text-body-sm text-ink leading-snug break-words">
                      {art.title}
                    </h3>
                    {isEdited && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] font-medium text-ink-muted bg-surface-sunken px-1.5 py-0.5 rounded border border-line/60 shrink-0"
                        title={art.editedAt ? (t('eventDrawer.manuallyEditedDate', { date: new Date(art.editedAt).toLocaleDateString() }) || t('cardsList.manuallyEditedTooltip')) : t('cardsList.manuallyEditedTooltip')}
                      >
                        <Pencil className="w-2.5 h-2.5 text-accent shrink-0" />
                        <span>{t('cardsList.manuallyEdited')}</span>
                      </span>
                    )}
                  </div>

                  {art.subtitle && (
                    <div className="text-caption text-ink-muted line-clamp-2 mt-0.5 leading-relaxed">
                      <MathMarkdown content={art.subtitle} inline />
                    </div>
                  )}

                  {/* Details: Date, Location + Topic, Lane */}
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

                    {/* Line 2: Location + Topic (same row, like the map card) */}
                    {(art.locationName || topicBadge) && (
                      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 min-w-0">
                        {art.locationName && (
                          <span className="inline-flex items-center gap-1.5 min-w-0 text-ink-muted">
                            <MapPin className="w-3.5 h-3.5 text-danger shrink-0" />
                            <span className="leading-snug break-words">{art.locationName}</span>
                          </span>
                        )}
                        {topicBadge && (
                          <span className="inline-flex items-center gap-1.5 min-w-0 text-ink font-medium">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0 shadow-2xs ring-1 ring-black/10 dark:ring-white/15"
                              style={{ backgroundColor: topicBadge.color }}
                            />
                            <span className="leading-snug break-words">{topicBadge.title}</span>
                          </span>
                        )}
                      </div>
                    )}

                    {/* Line 3: Lane (lane icon + full lane text) */}
                    {laneInfo && (
                      <div className="flex items-center gap-2 text-ink font-medium">
                        <Layers className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                        <span className="leading-snug break-words">{laneInfo.title}</span>
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
    </aside>
    </>
  );
}

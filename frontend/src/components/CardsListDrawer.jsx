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
  Pencil,
  Hourglass,
  GalleryVertical,
  List as ListIcon,
  useIsToyTheme
} from './icons/ThemeIcons';
import { getDistinctCategories, getCategoryColor } from '../data/laneColors';
import { buildFeedItems } from './timeline/feedLayout';
import useIsMobileViewport from '../hooks/useIsMobileViewport';
import { useLanguage } from '../context/LanguageContext';
import { FLOATING_Z } from '../utils/floatingFocus';
import { isSameArticleId } from '../utils/timelineArticles';
import { areTextsRtl } from '../utils/textDirection';
import { compareArticlesByStart } from '../utils/dateTime';
import { getCanvasImageCandidates, getCanvasImageUrl } from '../utils/wikimediaImageUrl';
import MathMarkdown from './MathMarkdown';
import PositionablePhoto from './PositionablePhoto';
import { containsMath } from '../utils/mathUtils';
import { EVENT_DRAWER_MIN_WIDTH, EVENT_DRAWER_KEY_STEP, clampEventDrawerWidth } from './EventDrawer';
import PanelNavButtons from './PanelNavButtons';

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
  // Side panel Back/Forward descriptor (see PanelNavButtons); null when there's no history.
  panelNav = null,
  presentation = 'drawer',
  articles = [],
  lanes = [],
  selectedArticleId,
  onSelectArticle,
  starredArticleIds,
  onToggleStar,
  // (articleId, { x, y }) — enables dragging card photos to a new focal point.
  onImagePositionChange,
  filterStarredOnly = false,
  onToggleFilterStarredOnly,
  timeBands,
  onVisibleArticleChange,
  width = null,
  onWidthChange,
  style = {}
}) {
  const { t, isRtl, formatTimeSpan, formatDatePart } = useLanguage();
  const isToy = useIsToyTheme();
  const isPage = presentation === 'page';
  const [hasOpened, setHasOpened] = useState(() => Boolean(isOpen || isPage));
  useEffect(() => {
    if (isOpen || isPage) setHasOpened(true);
  }, [isOpen, isPage]);
  useEffect(() => {
    if (!isOpen && !isPage) setHasOpened(false);
  }, [articles]);
  const shouldLoadThumbnails = isOpen || isPage || hasOpened;
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLaneId, setSelectedLaneId] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [sortBy, setSortBy] = useState('chronological_asc'); // 'chronological_asc' | 'chronological_desc' | 'alphabetical'
  const [feedDensity, setFeedDensity] = useState('comfortable');
  const changeFeedDensity = (next) => {
    setFeedDensity(next);
  };
  const useComfortableCards = isPage && feedDensity === 'comfortable';

  const isMobile = useIsMobileViewport();

  const drawerRef = useRef(null);
  const resizeDragRef = useRef(null);
  const [liveWidth, setLiveWidth] = useState(null);
  const canResize = Boolean(onWidthChange) && !isPage && !isMobile;

  const handleResizePointerDown = (e) => {
    if (e.button !== 0 || !drawerRef.current) return;
    e.preventDefault();
    const startWidth = drawerRef.current.getBoundingClientRect().width;
    resizeDragRef.current = { startX: e.clientX, startWidth, width: startWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
    setLiveWidth(startWidth);
  };
  const handleResizePointerMove = (e) => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    drag.width = clampEventDrawerWidth(drag.startWidth + e.clientX - drag.startX);
    setLiveWidth(drag.width);
  };
  const handleResizePointerEnd = () => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    resizeDragRef.current = null;
    setLiveWidth(null);
    if (Math.abs(drag.width - drag.startWidth) >= 1) onWidthChange(drag.width);
  };
  const handleResizeKeyDown = (e) => {
    const current = drawerRef.current?.getBoundingClientRect().width || EVENT_DRAWER_MIN_WIDTH;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? EVENT_DRAWER_KEY_STEP : -EVENT_DRAWER_KEY_STEP;
      onWidthChange(clampEventDrawerWidth(current + delta));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onWidthChange(null);
    }
  };

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
  }, [categories, t, isToy]);

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

        // Chronological (includes hour/minute for same-day events); default is ascending.
        const cmp = compareArticlesByStart(a, b);
        return sortBy === 'chronological_desc' ? -cmp : cmp;
      });
  }, [articles, searchQuery, selectedLaneId, selectedCategory, sortBy, laneMap, filterStarredOnly, starredArticleIds]);

  const hasRtl = (str) => /[\u0590-\u05FF\u0600-\u06FF]/.test(str || '');

  const isArticleStarred = (art) => Boolean(
    starredArticleIds?.has(art.id)
    || (art.id != null && (starredArticleIds?.has(String(art.id)) || starredArticleIds?.has(Number(art.id))))
  );

  // The mobile feed lays chronological results out as a vertical timeline (alphabetical stays a plain list).
  const feedItems = useMemo(() => {
    if (!isPage || sortBy === 'alphabetical') return null;
    return buildFeedItems(filteredArticles, timeBands, { descending: sortBy === 'chronological_desc' });
  }, [isPage, sortBy, filteredArticles, timeBands]);

  const filteredArticlesRef = useRef(filteredArticles);
  filteredArticlesRef.current = filteredArticles;
  const onVisibleArticleChangeRef = useRef(onVisibleArticleChange);
  onVisibleArticleChangeRef.current = onVisibleArticleChange;

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

  // Report the card at the middle of the visible feed so the canvas can open on the same event.
  useEffect(() => {
    const container = scrollAreaRef.current;
    if (!isPage || !container) return undefined;
    let raf = 0;
    const report = () => {
      raf = 0;
      const notify = onVisibleArticleChangeRef.current;
      if (!notify) return;
      const contRect = container.getBoundingClientRect();
      const dock = document.getElementById('chronix-mobile-bottom-dock');
      const dockTop = dock && dock.offsetParent ? dock.getBoundingClientRect().top : Infinity;
      const probeY = (contRect.top + Math.min(contRect.bottom, dockTop)) / 2;
      let best = null;
      let bestDist = Infinity;
      container.querySelectorAll('[data-article-id]').forEach((el) => {
        const r = el.getBoundingClientRect();
        const dist = probeY < r.top ? r.top - probeY : probeY > r.bottom ? probeY - r.bottom : 0;
        if (dist < bestDist) {
          bestDist = dist;
          best = el;
        }
      });
      if (!best) return;
      const id = best.getAttribute('data-article-id');
      const article = filteredArticlesRef.current.find((a) => isSameArticleId(a.id, id));
      if (article) notify(article);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(report);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isPage]);

  const renderRowCard = (art) => {
    const isSelected = isSameArticleId(selectedArticleId, art.id);
    const isStarred = Boolean(starredArticleIds?.has(art.id) || (art.id != null && (starredArticleIds?.has(String(art.id)) || starredArticleIds?.has(Number(art.id)))));
    const timeSpan = formatTimeSpan(art.from, art.to, art.isToPresent);
    const topicBadge = getTopicBadge(art);
    const laneInfo = lanes.length > 1 ? laneMap.get(art.lane) : null;
    const isItemRtl = areTextsRtl([art.title, art.subtitle], isRtl);
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
          {art.imageUrl && shouldLoadThumbnails ? (
            <img
              src={getCanvasImageUrl(art.imageUrl)}
              alt={art.title}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200 bg-white"
              style={{ objectPosition: `${art.imagePositionX ?? 50}% ${art.imagePositionY ?? 50}%` }}
              onError={(e) => {
                const candidates = getCanvasImageCandidates(art.imageUrl);
                const nextIdx = Number(e.currentTarget.dataset.candidateIdx || '0') + 1;
                if (nextIdx < candidates.length) {
                  e.currentTarget.dataset.candidateIdx = String(nextIdx);
                  e.currentTarget.src = candidates[nextIdx];
                  return;
                }
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <Calendar className="w-5 h-5 text-ink-subtle" />
          )}
        </div>

        {/* Content */}
        <div
          className={`flex-1 min-w-0 ${isItemRtl ? 'text-right' : 'text-left'}`}
          dir={isItemRtl ? 'rtl' : 'ltr'}
        >
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="cards-list-item-title font-serif font-semibold text-body-sm text-ink leading-snug break-words">
              {containsMath(art.title) ? <MathMarkdown content={art.title} inline /> : art.title}
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
  };

  const formatGapSpan = ({ unit, n }) => {
    if (unit === 'megaannum') return t('cardsList.spanMegaannum', { n: n.toLocaleString() });
    const key = { day: 'Day', month: 'Month', year: 'Year' }[unit] || 'Year';
    return n === 1 ? t(`cardsList.span${key}`) : t(`cardsList.span${key}s`, { n: n.toLocaleString() });
  };

  const describeSectionHeader = (header) => {
    if (header.kind === 'band') {
      const range = formatTimeSpan(header.from, header.to, false);
      return header.title
        ? { title: header.title, subtitle: range, color: header.color }
        : { title: range, subtitle: '', color: header.color };
    }
    const title = header.unit === 'year' || header.unit === 'megaannum'
      ? formatDatePart({ year: header.start })
      : formatTimeSpan({ year: header.start }, { year: header.end }, false);
    return { title, subtitle: '', color: null };
  };

  const renderComfortableCard = (art) => {
    const isSelected = isSameArticleId(selectedArticleId, art.id);
    const isStarred = isArticleStarred(art);
    const timeSpan = formatTimeSpan(art.from, art.to, art.isToPresent);
    const topicBadge = getTopicBadge(art);
    const laneInfo = lanes.length > 1 ? laneMap.get(art.lane) : null;
    const isItemRtl = areTextsRtl([art.title, art.subtitle], isRtl);
    const isEdited = Boolean(art.isEdited || art.is_edited || art.isManuallyEdited || art.is_manually_edited);

    return (
      <div
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
        className={`group relative overflow-hidden rounded-panel border bg-surface-raised transition-all cursor-pointer text-start active:scale-[0.99] ${
          isSelected
            ? 'border-accent ring-2 ring-accent-ring/40 shadow-panel'
            : 'border-line hover:border-line-strong shadow-control'
        }`}
      >
        {art.imageUrl && shouldLoadThumbnails && (
          <PositionablePhoto
            src={getCanvasImageUrl(art.imageUrl)}
            candidates={getCanvasImageCandidates(art.imageUrl)}
            positionX={art.imagePositionX}
            positionY={art.imagePositionY}
            onPositionChange={onImagePositionChange ? (position) => onImagePositionChange(art.id, position) : undefined}
            className="border-b border-line"
            onError={(e) => {
              e.currentTarget.parentElement.style.display = 'none';
            }}
          />
        )}

        <div className={`p-3 ${isItemRtl ? 'text-right' : 'text-left'}`} dir={isItemRtl ? 'rtl' : 'ltr'}>
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              {timeSpan && (
                <div className="text-caption font-semibold text-accent leading-snug">{timeSpan}</div>
              )}
              <h3 className="cards-list-item-title font-serif mt-0.5 text-body font-semibold text-ink leading-snug break-words">
                {containsMath(art.title) ? <MathMarkdown content={art.title} inline /> : art.title}
              </h3>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleStar?.(art.id);
              }}
              className={`-me-1.5 -mt-1 shrink-0 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-control transition-colors cursor-pointer touch-manipulation ${
                isStarred ? 'text-star' : 'text-ink-faint hover:text-star'
              }`}
              title={isStarred ? t('cardsList.unstar') : t('cardsList.star')}
              aria-label={isStarred ? t('cardsList.unstar') : t('cardsList.star')}
            >
              <Star className={`w-[18px] h-[18px] ${isStarred ? 'fill-star text-star' : ''}`} />
            </button>
          </div>

          {art.subtitle && (
            <div className="mt-1 text-body-sm text-ink-muted sm:line-clamp-3">
              <MathMarkdown content={art.subtitle} inline />
            </div>
          )}

          {(art.locationName || topicBadge || laneInfo || isEdited) && (
            <div className="mt-2 flex items-center flex-wrap gap-x-3 gap-y-1 text-caption min-w-0">
              {topicBadge && (
                <span className="inline-flex items-center gap-1.5 min-w-0 text-ink font-medium">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/10 dark:ring-white/15"
                    style={{ backgroundColor: topicBadge.color }}
                  />
                  <span className="break-words">{topicBadge.title}</span>
                </span>
              )}
              {art.locationName && (
                <span className="inline-flex items-center gap-1 min-w-0 text-ink-muted">
                  <MapPin className="w-3.5 h-3.5 text-danger shrink-0" />
                  <span className="break-words">{art.locationName}</span>
                </span>
              )}
              {laneInfo && (
                <span className="inline-flex items-center gap-1 min-w-0 text-ink-muted">
                  <Layers className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                  <span className="break-words">{laneInfo.title}</span>
                </span>
              )}
              {isEdited && (
                <span className="inline-flex items-center gap-1 text-ink-muted" title={t('cardsList.manuallyEditedTooltip')}>
                  <Pencil className="w-3 h-3 text-accent shrink-0" />
                  <span>{t('cardsList.manuallyEdited')}</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderCard = (art) => (useComfortableCards ? renderComfortableCard(art) : renderRowCard(art));

  // Mobile feed: a vertical timeline with a spine, sticky era/period headers and gap markers.
  const renderFeedTimeline = () => (
    <div className="relative">
      <span aria-hidden="true" className="absolute top-0 bottom-0 start-[11px] w-0.5 rounded-full bg-line" />
      {feedItems.map((item) => {
        if (item.type === 'header') {
          const { title, subtitle, color } = describeSectionHeader(item.header);
          return (
            <div
              key={item.key}
              className="sticky top-0 z-10 -mx-3 px-3 pt-3 pb-2 bg-surface/90 backdrop-blur-md"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  aria-hidden="true"
                  className="relative z-[1] w-6 h-6 shrink-0 rounded-full border-2 border-surface flex items-center justify-center"
                  style={{ backgroundColor: color || 'rgb(var(--accent))' }}
                >
                  <span className="w-2 h-2 rounded-full bg-surface" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-body-sm font-bold text-ink leading-tight truncate" dir="auto">{title}</h3>
                  {subtitle && (
                    <p className="text-caption text-ink-subtle leading-tight truncate">{subtitle}</p>
                  )}
                </div>
              </div>
            </div>
          );
        }

        if (item.type === 'gap') {
          const label = t(item.direction === 'earlier' ? 'cardsList.gapEarlier' : 'cardsList.gapLater', {
            span: formatGapSpan(item.span),
          });
          return (
            <div key={item.key} className="relative ps-8 py-3">
              <span aria-hidden="true" className="absolute top-0 bottom-0 start-[11px] w-0.5 bg-surface" />
              <span aria-hidden="true" className="absolute top-1 bottom-1 start-[11px] border-s-2 border-dashed border-line-strong" />
              <span className="inline-flex items-center gap-1.5 text-caption italic text-ink-subtle">
                <Hourglass className="w-3.5 h-3.5 shrink-0" />
                {label}
              </span>
            </div>
          );
        }

        const art = item.article;
        const isSelected = isSameArticleId(selectedArticleId, art.id);
        const topic = getTopicBadge(art);
        return (
          <div key={item.key} className="relative ps-8 py-1.5">
            <span
              aria-hidden="true"
              className={`absolute rounded-full border-2 border-surface transition-all ${
                useComfortableCards ? 'top-6' : 'top-5'
              } ${isSelected ? 'start-[3px] w-[18px] h-[18px] ring-2 ring-accent' : 'start-[5px] w-3.5 h-3.5'}`}
              style={{ backgroundColor: topic?.color || 'rgb(var(--accent))' }}
            />
            {renderCard(art)}
          </div>
        );
      })}
    </div>
  );

  const renderFeedContent = () => {
    if (feedItems) return renderFeedTimeline();
    return filteredArticles.map((art) => (
      <React.Fragment key={art.id}>{renderCard(art)}</React.Fragment>
    ));
  };

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {!isPage && isMobile && isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 animate-in fade-in duration-200"
          onClick={onClose}
        />
      )}
      <aside
        ref={drawerRef}
        role="complementary"
        inert={!isOpen}
        className={`${
          isPage
            ? 'relative w-full h-full bg-surface flex flex-col font-sans overflow-hidden'
            : `chronix-side-drawer ${
                isMobile
                  ? 'fixed inset-x-0 bottom-0 w-full h-[86vh] max-h-[90vh] rounded-t-3xl border-t overflow-hidden'
                  : 'absolute inset-y-0 left-[calc(52px+env(safe-area-inset-left,0px))] right-auto w-[340px] md:w-[380px] lg:w-[440px] max-w-[calc(100vw-56px-env(safe-area-inset-left,0px))] h-full max-h-full rounded-none border-r overflow-visible'
              } bg-surface-overlay border-line shadow-2xl flex flex-col ${
                liveWidth != null ? 'select-none' : 'transition-all duration-300 ease-in-out'
              } font-sans z-50 ${
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
          ...(canResize && (liveWidth ?? width) ? { width: liveWidth ?? clampEventDrawerWidth(width) } : {}),
        }}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {canResize && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('eventDrawer.resize')}
            title={t('eventDrawer.resize')}
            tabIndex={0}
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerEnd}
            onPointerCancel={handleResizePointerEnd}
            onDoubleClick={() => onWidthChange(null)}
            onKeyDown={handleResizeKeyDown}
            style={{ touchAction: 'none' }}
            className="group/resize absolute top-0 bottom-0 -right-1.5 w-3 z-30 flex items-center justify-center cursor-col-resize focus-visible:outline-none"
          >
            <span
              className={`h-full w-0.5 transition-colors ${
                liveWidth != null ? 'bg-ink-subtle' : 'bg-transparent group-hover/resize:bg-line-strong group-focus-visible/resize:bg-ink-subtle'
              }`}
            />
            <span
              className={`absolute top-1/2 -translate-y-1/2 h-10 w-1.5 rounded-full border border-line bg-surface-raised shadow-control transition-opacity ${
                liveWidth != null ? 'opacity-100' : 'opacity-0 group-hover/resize:opacity-100 group-focus-visible/resize:opacity-100'
              }`}
            />
          </div>
        )}
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
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-line">
        <div className="flex items-center gap-2 min-w-0">
          {!isPage && panelNav && (
            <>
              <PanelNavButtons nav={panelNav} className="-ms-1" />
              <span className="w-px h-5 bg-line shrink-0" aria-hidden="true" />
            </>
          )}
          <LayoutList className="w-4 h-4 text-accent shrink-0" />
          <h2 className="font-bold text-sm text-ink truncate">
            {t('cardsList.title')}
          </h2>
          <span className="text-caption font-medium px-2 py-0.5 rounded-full bg-surface-sunken text-ink-muted border border-line shrink-0">
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
              âœ•
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

          {/* Feed density (mobile feed only) */}
          {isPage && (
            <div
              role="group"
              aria-label={t('cardsList.densityComfortable')}
              className="shrink-0 flex items-center rounded-control border border-line bg-surface-raised shadow-control p-0.5"
            >
              {[
                { value: 'comfortable', icon: GalleryVertical, label: t('cardsList.densityComfortable') },
                { value: 'compact', icon: ListIcon, label: t('cardsList.densityCompact') },
              ].map(({ value, icon: DensityIcon, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => changeFeedDensity(value)}
                  aria-pressed={feedDensity === value}
                  aria-label={label}
                  title={label}
                  className={`min-w-[32px] min-h-[28px] flex items-center justify-center rounded-[6px] transition-colors cursor-pointer ${
                    feedDensity === value ? 'bg-accent-soft text-accent' : 'text-ink-subtle hover:text-ink'
                  }`}
                >
                  <DensityIcon className="w-4 h-4" />
                </button>
              ))}
            </div>
          )}

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
      <div ref={scrollAreaRef} className={`flex-1 overflow-y-auto p-3 ${feedItems ? 'pt-0' : 'space-y-2'} ${isMobile ? 'pb-20' : 'pb-3'}`}>
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
          renderFeedContent()
        )}
      </div>
    </aside>
    </>
  );
}

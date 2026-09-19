import React, { useState, useEffect, useRef } from 'react';
import {
  Heart,
  MessageSquare,
  Search,
  Flame,
  Clock,
  MessageCircle,
  Calendar,
  Layers,
  ArrowRight,
  BookOpen,
  X,
  Tag,
  ChevronLeft,
  ChevronRight,
  User,
  Globe,
  ShieldAlert,
  Trash2,
  EyeOff,
  AlertTriangle
} from 'lucide-react';
import { fetchCommunityTimelines, toggleTimelineLike, deleteTimeline, setTimelineShareEnabled } from '../api';
import { useLanguage } from '../context/LanguageContext';
import { SUPPORTED_LANGUAGES } from '../locales/translations';

const TOPICS = [
  { key: 'all' },
  { key: 'history' },
  { key: 'technology' },
  { key: 'space' },
  { key: 'geography' },
  { key: 'nature' },
  { key: 'arts' },
  { key: 'biography' },
  { key: 'military' },
  { key: 'business' },
  { key: 'society' },
];

const CATEGORY_TO_TOPIC_KEY = {
  'History & Politics': 'history',
  'Science & Technology': 'technology',
  'Space & Aviation': 'space',
  'Geography & Nations': 'geography',
  'Nature & Evolution': 'nature',
  'Arts & Culture': 'arts',
  'Biographies & Figures': 'biography',
  'Military & Wars': 'military',
  'Military & War': 'military',
  'Economy & Business': 'business',
  'Society & Philosophy': 'society',
};

// Pagination batch sizes: 6 or 12 ensure balanced rows on 3-col (desktop) and 2-col (tablet) screens.
// INITIAL_BATCH_SIZE = 6 allows immediate demonstration and testing with the current collection,
// while LOAD_MORE_BATCH_SIZE = 6 adds 2 full rows (desktop) / 3 full rows (tablet) on each click.
const INITIAL_BATCH_SIZE = 6;
const LOAD_MORE_BATCH_SIZE = 6;

export default function CommunityTimelinesWall({
  onSelectTimeline,
  onOpenComments,
  commentCountOverrides = {},
  isAdmin = false,
}) {
  const { t, isRtl } = useLanguage();

  const [timelines, setTimelines] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSort, setActiveSort] = useState('popular'); // 'popular' | 'discussed' | 'newest'
  const [activeTopic, setActiveTopic] = useState('all');
  const [activeTag, setActiveTag] = useState('');
  const [activeLanguage, setActiveLanguage] = useState('all');
  const [likingIds, setLikingIds] = useState(new Set());

  const requestIdRef = useRef(0);
  const isInitialMountRef = useRef(true);

  // Admin moderation state
  const [adminActionMenuId, setAdminActionMenuId] = useState(null);
  const [adminConfirmModal, setAdminConfirmModal] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);

  useEffect(() => {
    const closeMenu = () => setAdminActionMenuId(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  const handleAdminExecuteAction = async () => {
    if (!adminConfirmModal || !adminConfirmModal.timeline) return;
    const { type, timeline } = adminConfirmModal;
    setAdminLoading(true);
    try {
      if (type === 'unpublish') {
        await setTimelineShareEnabled(timeline.id, false);
      } else if (type === 'delete') {
        await deleteTimeline(timeline.id);
      }
      setTimelines((prev) => prev.filter((t) => t.id !== timeline.id));
      setTotalCount((prev) => Math.max(0, prev - 1));
      setAdminConfirmModal(null);
    } catch (err) {
      alert((isRtl ? 'שגיאה בביצוע פעולת מנהל: ' : 'Admin action failed: ') + (err?.message || err));
    } finally {
      setAdminLoading(false);
    }
  };

  // Topic carousel scroll buttons & drag-to-scroll handling
  const carouselRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);
  const hasMovedRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const checkScrollButtons = () => {
    if (!carouselRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = carouselRef.current;
    const maxScroll = scrollWidth - clientWidth;
    if (maxScroll <= 0) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    const currentScroll = Math.abs(scrollLeft);
    if (isRtl) {
      setCanScrollRight(currentScroll > 6);
      setCanScrollLeft(currentScroll < maxScroll - 6);
    } else {
      setCanScrollLeft(currentScroll > 6);
      setCanScrollRight(currentScroll < maxScroll - 6);
    }
  };

  useEffect(() => {
    checkScrollButtons();
    const handleResize = () => checkScrollButtons();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [timelines, isRtl]);

  const handleScrollCarousel = (direction) => {
    if (!carouselRef.current) return;
    const delta = direction === 'left' ? -260 : 260;
    carouselRef.current.scrollBy({ left: delta, behavior: 'smooth' });
  };

  // Drag-to-scroll mouse handlers
  const handleMouseDown = (e) => {
    if (e.button !== 0 || !carouselRef.current) return;
    isDraggingRef.current = true;
    hasMovedRef.current = false;
    startXRef.current = e.clientX;
    scrollLeftRef.current = carouselRef.current.scrollLeft;
    setIsDragging(true);
  };

  useEffect(() => {
    const handleGlobalMouseMove = (e) => {
      if (!isDraggingRef.current || !carouselRef.current) return;
      const deltaX = e.clientX - startXRef.current;
      if (Math.abs(deltaX) > 4) {
        hasMovedRef.current = true;
      }
      carouselRef.current.scrollLeft = scrollLeftRef.current - deltaX;
      checkScrollButtons();
    };

    const handleGlobalMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsDragging(false);
        setTimeout(() => {
          hasMovedRef.current = false;
        }, 60);
      }
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, []);

  // Fetch community timelines (initial page or load more)
  const loadTimelines = async ({
    isLoadMore = false,
    sortChoice = activeSort,
    searchChoice = searchQuery,
    topicChoice = activeTopic,
    tagChoice = activeTag,
    languageChoice = activeLanguage,
  } = {}) => {
    const currentReqId = ++requestIdRef.current;

    if (isLoadMore) {
      if (loadingMore || loading) return;
      setLoadingMore(true);
    } else {
      setLoading(true);
    }

    try {
      const offset = isLoadMore ? timelines.length : 0;
      const limit = isLoadMore ? LOAD_MORE_BATCH_SIZE : INITIAL_BATCH_SIZE;

      const res = await fetchCommunityTimelines({
        sort: sortChoice,
        search: searchChoice,
        topic: topicChoice,
        tag: tagChoice,
        language: languageChoice,
        limit,
        offset,
      });

      // Guard against race conditions: ignore response if a newer request was made
      if (currentReqId !== requestIdRef.current) return;

      const fetchedList = res?.timelines || [];
      const total = typeof res?.total === 'number' ? res.total : fetchedList.length;
      setTotalCount(total);

      if (isLoadMore) {
        setTimelines((prev) => {
          const existingIds = new Set(prev.map((t) => t.id));
          const newUnique = fetchedList.filter((item) => !existingIds.has(item.id));
          return [...prev, ...newUnique];
        });
      } else {
        setTimelines(fetchedList);
      }
    } catch (err) {
      console.warn('Failed to fetch community timelines:', err);
    } finally {
      if (currentReqId === requestIdRef.current) {
        if (isLoadMore) {
          setLoadingMore(false);
        } else {
          setLoading(false);
        }
      }
    }
  };

  const handleLoadMore = () => {
    if (loadingMore || loading || timelines.length >= totalCount) return;
    loadTimelines({ isLoadMore: true });
  };

  useEffect(() => {
    loadTimelines({
      isLoadMore: false,
      sortChoice: activeSort,
      searchChoice: searchQuery,
      topicChoice: activeTopic,
      tagChoice: activeTag,
      languageChoice: activeLanguage,
    });
  }, [activeSort, activeTopic, activeTag, activeLanguage]);

  // Debounced search
  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }
    const handler = setTimeout(() => {
      loadTimelines({
        isLoadMore: false,
        sortChoice: activeSort,
        searchChoice: searchQuery,
        topicChoice: activeTopic,
        tagChoice: activeTag,
        languageChoice: activeLanguage,
      });
    }, 350);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Handle Like Toggle
  const handleLikeToggle = async (e, item) => {
    e.stopPropagation();
    if (likingIds.has(item.id)) return;

    // Optimistic update
    const prevLiked = item.hasLiked;
    const prevCount = item.likesCount || 0;
    const newLiked = !prevLiked;
    const newCount = prevLiked ? Math.max(0, prevCount - 1) : prevCount + 1;

    setTimelines((prev) =>
      prev.map((t) =>
        t.id === item.id ? { ...t, hasLiked: newLiked, likesCount: newCount } : t
      )
    );

    setLikingIds((prev) => new Set(prev).add(item.id));

    try {
      const res = await toggleTimelineLike(item.id);
      if (res && typeof res.likesCount === 'number') {
        setTimelines((prev) =>
          prev.map((t) =>
            t.id === item.id
              ? { ...t, hasLiked: res.hasLiked, likesCount: res.likesCount }
              : t
          )
        );
      }
    } catch (err) {
      // Revert on error
      setTimelines((prev) =>
        prev.map((t) =>
          t.id === item.id ? { ...t, hasLiked: prevLiked, likesCount: prevCount } : t
        )
      );
    } finally {
      setLikingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  return (
    <div className="w-full mt-4" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* 1. Curated Topic Carousel with Scroll Buttons */}
      <div className="relative w-full mb-2 group/carousel border-b border-line/60 bg-surface-raised/65 rounded-t-panel" dir={isRtl ? 'rtl' : 'ltr'}>
        {/* Left Scroll Button and Fade */}
        {canScrollLeft && (
          <div className="absolute left-0 inset-y-0 flex items-center pe-5 ps-0.5 bg-gradient-to-r from-surface-raised via-surface-raised/85 to-transparent z-20 pointer-events-none">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleScrollCarousel('left');
              }}
              aria-label="Scroll left"
              className="p-1.5 text-ink-muted hover:text-accent transition-colors cursor-pointer pointer-events-auto"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Scrollable Topics Bar with Drag-to-Scroll */}
        <div
          ref={carouselRef}
          onScroll={checkScrollButtons}
          onMouseDown={handleMouseDown}
          className={`w-full overflow-x-auto scrollbar-none px-1 select-none ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
        >
          <div className="flex items-center gap-6 min-w-max">
            {TOPICS.map((topic) => {
              const isSelected = activeTopic === topic.key;
              const label = t(`community.topics.${topic.key}`) || topic.key;
              return (
                <button
                  key={topic.key}
                  type="button"
                  onClick={() => {
                    if (hasMovedRef.current) return;
                    setActiveTopic(topic.key);
                  }}
                  className={`inline-flex items-center px-0.5 py-3 text-sm font-semibold transition-colors duration-150 cursor-pointer border-b-2 whitespace-nowrap select-none ${
                    isSelected
                      ? 'text-accent border-accent font-bold'
                      : 'text-ink-muted hover:text-ink border-transparent'
                  }`}
                >
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Scroll Button and Fade */}
        {canScrollRight && (
          <div className="absolute right-0 inset-y-0 flex items-center ps-5 pe-0.5 bg-gradient-to-l from-surface-raised via-surface-raised/85 to-transparent z-20 pointer-events-none">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleScrollCarousel('right');
              }}
              aria-label="Scroll right"
              className="p-1.5 text-ink-muted hover:text-accent transition-colors cursor-pointer pointer-events-auto"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* 2. Filter and Search Controls Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-end justify-between gap-4 mb-5 px-3 py-3 border-b border-line/60 bg-surface-raised/65 rounded-b-panel">
        {/* Sort Pills */}
        <div className="flex items-center gap-5 overflow-x-auto scrollbar-none" dir="ltr">
          <button
            type="button"
            onClick={() => setActiveSort('popular')}
            className={`inline-flex items-center gap-1.5 px-0.5 py-2 text-sm font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
              activeSort === 'popular'
                ? 'text-accent border-accent font-bold'
                : 'text-ink-muted hover:text-ink border-transparent'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>{t('community.sortPopular') || 'Most Popular'}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSort('discussed')}
            className={`inline-flex items-center gap-1.5 px-0.5 py-2 text-sm font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
              activeSort === 'discussed'
                ? 'text-accent border-accent font-bold'
                : 'text-ink-muted hover:text-ink border-transparent'
            }`}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            <span>{t('community.sortDiscussed') || 'Most Discussed'}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSort('newest')}
            className={`inline-flex items-center gap-1.5 px-0.5 py-2 text-sm font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
              activeSort === 'newest'
                ? 'text-accent border-accent font-bold'
                : 'text-ink-muted hover:text-ink border-transparent'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>{t('community.sortNewest') || 'Newest'}</span>
          </button>
        </div>

        {/* Right side controls: Language Selector + Search Input */}
        <div className="flex items-end gap-4">
          {/* Language Selector Dropdown */}
          <div className="relative shrink-0">
            <select
              value={activeLanguage}
              onChange={(e) => setActiveLanguage(e.target.value)}
              aria-label="Filter by language"
              className="community-language-select ps-0 pe-6 py-2 text-sm font-medium bg-transparent border-0 border-b border-line-strong text-ink hover:border-accent focus:outline-none focus:border-accent cursor-pointer transition-colors"
            >
              <option value="all">{t('community.allLanguages') || 'All Languages'}</option>
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {t(`community.languages.${lang.code}`) || lang.nativeLabel || lang.label}
                </option>
              ))}
            </select>
          </div>

          {/* Search Input */}
          <div className="relative flex-1 sm:w-64">
            <div className="absolute inset-y-0 start-0 flex items-center pointer-events-none text-ink-subtle">
              <Search className="w-4 h-4" />
            </div>
            <input
              type="text"
              dir="auto"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('community.searchPlaceholder') || 'Search public timelines...'}
              className="w-full ps-7 pe-1 py-2 text-sm bg-transparent border-0 border-b border-line-strong text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent transition-colors"
            />
          </div>
        </div>
      </div>

      {/* 3. Active Tag / Topic / Language Indicator Banner */}
      {(activeTag || (activeTopic && activeTopic !== 'all') || (activeLanguage && activeLanguage !== 'all')) && (
        <div className="flex items-center flex-wrap gap-2 mb-6 px-1 animate-in fade-in duration-150">
          <span className="text-xs text-ink-muted flex items-center gap-1">
            <Tag className="w-3.5 h-3.5 text-accent" />
            <span>{t('community.filterByTag') || 'Filtering by'}:</span>
          </span>

          {activeTopic && activeTopic !== 'all' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-accent/15 text-accent text-xs font-semibold border border-accent/30">
              <span>{t(`community.topics.${activeTopic}`) || activeTopic}</span>
              <button
                type="button"
                onClick={() => setActiveTopic('all')}
                className="hover:text-ink-strong cursor-pointer p-0.5 rounded-full hover:bg-accent/20 transition-colors"
                title={t('community.clearFilter') || 'Clear filter'}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {activeTag && (() => {
            const isTagRtl = /[\u0590-\u08FF]/.test(activeTag);
            return (
              <span
                dir={isTagRtl ? 'rtl' : 'ltr'}
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-semibold border border-emerald-500/30"
              >
                <span className="inline-flex items-center">
                  <span>#</span>
                  <span>{activeTag}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTag('')}
                  className="hover:text-ink-strong cursor-pointer p-0.5 rounded-full hover:bg-emerald-500/20 transition-colors"
                  title={t('community.clearFilter') || 'Clear filter'}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })()}

          {activeLanguage && activeLanguage !== 'all' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 text-xs font-semibold border border-blue-500/30">
              <span>{t(`community.languages.${activeLanguage}`) || activeLanguage.toUpperCase()}</span>
              <button
                type="button"
                onClick={() => setActiveLanguage('all')}
                className="hover:text-ink-strong cursor-pointer p-0.5 rounded-full hover:bg-blue-500/20 transition-colors"
                title={t('community.clearFilter') || 'Clear filter'}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          <button
            type="button"
            onClick={() => {
              setActiveTopic('all');
              setActiveTag('');
              setActiveLanguage('all');
            }}
            className="text-xs text-ink-subtle hover:text-ink underline ms-2 cursor-pointer transition-colors"
          >
            {t('community.clearFilter') || 'Clear filter'}
          </button>
        </div>
      )}

      {/* Grid of Public Timeline Cards */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
          {[1, 2, 3, 4, 5, 6].map((idx) => (
            <div
              key={idx}
              className="h-72 rounded-2xl bg-surface-raised/50 border border-line animate-pulse flex flex-col p-4 justify-between"
            >
              <div className="h-32 bg-surface-sunken rounded-xl mb-3" />
              <div className="space-y-2">
                <div className="h-4 bg-surface-sunken rounded w-3/4" />
                <div className="h-3 bg-surface-sunken rounded w-1/2" />
              </div>
              <div className="h-8 bg-surface-sunken rounded-lg mt-3" />
            </div>
          ))}
        </div>
      ) : timelines.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-surface-raised/40 border border-line flex flex-col items-center justify-center">
          <div className="p-3.5 rounded-full bg-accent-soft text-accent mb-3">
            <BookOpen className="w-6 h-6" />
          </div>
          <h4 className="text-base font-bold text-ink mb-1">
            {t('community.emptyTitle') || 'No Public Timelines Found'}
          </h4>
          <p className="text-xs sm:text-sm text-ink-muted max-w-md mb-4">
            {searchQuery
              ? t('community.emptySearch') || 'No timelines match your search query. Try different keywords.'
              : t('community.emptyPrompt') || 'Be the first to share an interactive visual chronology with the world!'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
          {timelines.map((item) => {
            const hasImages = item.previewImages && item.previewImages.length > 0;
            const commentsCount = commentCountOverrides[item.id] ?? item.commentsCount ?? 0;
            const likesCount = item.likesCount || 0;
            const isLiked = Boolean(item.hasLiked);
            const isLiking = likingIds.has(item.id);

            // Determine content direction for this specific timeline
            const contentText = `${item.title || ''} ${item.description || ''}`;
            const hasRtlChars = /[\u0590-\u08FF]/.test(contentText);
            const isItemRtl = hasRtlChars || item.language === 'he' || item.language === 'ar';
            const itemDir = isItemRtl ? 'rtl' : 'ltr';

            return (
              <div
                key={item.id}
                onClick={() => onSelectTimeline?.(item.id)}
                className="group relative flex flex-col rounded-2xl bg-surface-raised hover:bg-surface-hover/90 border border-line/80 hover:border-accent/40 shadow-card hover:shadow-panel transition-all duration-200 cursor-pointer overflow-hidden"
              >
                {/* Visual Header Collage or Geometric Preview Banner */}
                <div className="relative h-36 w-full bg-surface-sunken overflow-hidden border-b border-line/60">
                  {hasImages ? (
                    <div className="absolute inset-0 flex">
                      {item.previewImages.slice(0, 3).map((imgUrl, i) => (
                        <div
                          key={i}
                          className="relative h-full flex-1 overflow-hidden border-r border-line/30 last:border-r-0"
                        >
                          <img
                            src={imgUrl}
                            alt=""
                            loading="lazy"
                            className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-300"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-accent-soft/40 via-surface-sunken to-surface-raised flex items-center justify-center">
                      <Layers className="w-10 h-10 text-accent/30 group-hover:scale-110 transition-transform duration-300" />
                    </div>
                  )}

                  {/* Top Badges Overlay */}
                  <div className="absolute top-2.5 inset-x-2.5 flex items-center justify-between gap-1 z-10">
                    <div className="flex items-center gap-1">
                      <span className="px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-white font-medium text-[11px] shadow-sm border border-white/10 flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-accent" />
                        <span>{item.articleCount} {t('community.milestones') || 'events'}</span>
                      </span>

                      {item.categories && item.categories.length > 0 && (() => {
                        const rawCat = item.categories[0];
                        const topicKey = CATEGORY_TO_TOPIC_KEY[rawCat];
                        const displayCat = (topicKey && t(`community.topics.${topicKey}`)) || rawCat;
                        return (
                          <span
                            className="hidden sm:inline-flex px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-white/95 text-[10px] font-medium border border-white/10 truncate max-w-[130px]"
                            title={displayCat}
                          >
                            {displayCat}
                          </span>
                        );
                      })()}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {item.timeScale && (
                        <span className="px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-white/90 text-[10px] font-semibold uppercase tracking-wider border border-white/10">
                          {item.timeScale}
                        </span>
                      )}

                      {isAdmin && (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAdminActionMenuId(adminActionMenuId === item.id ? null : item.id);
                            }}
                            className="p-1 rounded-full bg-red-600/85 hover:bg-red-600 text-white shadow-md backdrop-blur-md transition-all cursor-pointer border border-white/20 hover:scale-105"
                            title={isRtl ? 'ניהול מנהל' : 'Admin Moderation'}
                          >
                            <ShieldAlert className="w-3.5 h-3.5" />
                          </button>

                          {adminActionMenuId === item.id && (
                            <div
                              className="absolute end-0 top-full mt-1.5 w-48 rounded-xl bg-surface-overlay/95 backdrop-blur-xl border border-line shadow-panel p-1 z-30 text-start animate-in fade-in zoom-in-95 duration-150"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="px-2 py-1 text-[10px] font-bold text-ink-subtle uppercase tracking-wider border-b border-line/50 mb-1 flex items-center gap-1">
                                <ShieldAlert className="w-3 h-3 text-red-500" />
                                <span>{isRtl ? 'ניהול מנהל' : 'Admin Actions'}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setAdminActionMenuId(null);
                                  setAdminConfirmModal({ type: 'unpublish', timeline: item });
                                }}
                                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-ink hover:bg-surface-hover font-medium transition-colors cursor-pointer"
                              >
                                <EyeOff className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                <span>{isRtl ? 'הסר מהקיר הציבורי' : 'Remove from Wall'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setAdminActionMenuId(null);
                                  setAdminConfirmModal({ type: 'delete', timeline: item });
                                }}
                                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-danger hover:bg-danger/10 font-medium transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5 text-danger shrink-0" />
                                <span>{isRtl ? 'מחק מה-DB לצמיתות' : 'Delete Permanently'}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card Main Info */}
                <div className="p-4 flex-1 flex flex-col justify-between">
                  <div
                    dir={itemDir}
                    className={`w-full ${isItemRtl ? 'text-right' : 'text-left'}`}
                  >
                    {/* Title */}
                    <h3
                      dir={itemDir}
                      className={`font-bold text-base text-ink group-hover:text-accent transition-colors line-clamp-2 leading-snug mb-1.5 ${
                        isItemRtl ? 'text-right' : 'text-left'
                      }`}
                    >
                      {item.title}
                    </h3>

                    {/* Description */}
                    <p
                      dir={itemDir}
                      className={`text-xs text-ink-muted line-clamp-2 leading-relaxed font-normal mb-2.5 ${
                        isItemRtl ? 'text-right' : 'text-left'
                      }`}
                    >
                      {item.description || t('community.defaultDesc') || 'Explore this curated multi-lane chronology on ChroniX.'}
                    </p>

                    {/* Entity and Topic Tags */}
                    {item.tags && item.tags.length > 0 && (
                      <div
                        dir={itemDir}
                        className="flex flex-wrap items-center gap-1.5 mb-3"
                      >
                        {item.tags.slice(0, 4).map((tag, tIdx) => {
                          const isSelected = activeTag && activeTag.toLowerCase() === tag.toLowerCase();
                          const isTagRtl = /[\u0590-\u08FF]/.test(tag) || (isItemRtl && !/[A-Za-z\u00C0-\u024F]/.test(tag));
                          const tagDir = isTagRtl ? 'rtl' : 'ltr';
                          return (
                            <button
                              key={tIdx}
                              type="button"
                              dir={tagDir}
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveTag(isSelected ? '' : tag);
                              }}
                              className={`text-[10px] font-medium px-2 py-0.5 rounded-md transition-all cursor-pointer inline-flex items-center ${
                                isSelected
                                  ? 'bg-accent text-accent-fg font-bold shadow-sm'
                                  : 'bg-surface-sunken hover:bg-surface-hover text-accent hover:text-accent-hover border border-line/60'
                              }`}
                            >
                              <span>#</span>
                              <span>{tag}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Author Attribution & Language Metadata */}
                  <div className="flex items-center justify-between text-[11px] text-ink-muted mb-2.5 pt-1.5 border-t border-line/40">
                    <div className="flex items-center gap-1.5 truncate max-w-[200px]" title={item.authorName || 'ChroniX'}>
                      <span className="w-4 h-4 rounded-full bg-accent/15 text-accent flex items-center justify-center text-[10px] font-bold shrink-0">
                        {(item.authorName || 'C')[0].toUpperCase()}
                      </span>
                      <span className="truncate">
                        {t('community.byAuthor', {
                          author: item.authorName || 'ChroniX',
                          name: item.authorName || 'ChroniX'
                        })}
                      </span>
                    </div>

                    {item.language && (
                      <span
                        title={t(`community.languages.${item.language}`) || item.language.toUpperCase()}
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-surface-sunken border border-line/60 text-ink-subtle"
                      >
                        {t(`community.languages.${item.language}`) || item.language.toUpperCase()}
                      </span>
                    )}
                  </div>

                  {/* Card Bottom Actions Row: Likes, Comments, Explore */}
                  <div className="pt-3 border-t border-line/60 flex items-center justify-between gap-2 mt-auto">
                    <div className="flex items-center gap-2">
                      {/* Like / Heart Button */}
                      <button
                        type="button"
                        onClick={(e) => handleLikeToggle(e, item)}
                        disabled={isLiking}
                        title={isLiked ? (t('community.unlike') || 'Unlike') : (t('community.like') || 'Like')}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all duration-150 cursor-pointer ${
                          isLiked
                            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                            : 'bg-surface-sunken hover:bg-surface-hover text-ink-muted hover:text-ink border border-line/60'
                        }`}
                      >
                        <Heart
                          className={`w-3.5 h-3.5 transition-all duration-150 ${
                            isLiked
                              ? 'fill-rose-500 text-rose-500 scale-110'
                              : 'text-ink-subtle group-hover/btn:text-rose-500'
                          }`}
                        />
                        <span>{likesCount}</span>
                      </button>

                      {/* Comments Button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenComments?.(item);
                        }}
                        title={t('community.comments') || 'Comments'}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-sunken hover:bg-surface-hover text-ink-muted hover:text-ink border border-line/60 text-xs font-semibold transition-all cursor-pointer"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-ink-subtle" />
                        <span>{commentsCount}</span>
                      </button>
                    </div>

                    {/* Open / Explore CTA */}
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-accent group-hover:underline">
                      <span>{t('community.exploreBtn') || 'Explore'}</span>
                      <ArrowRight className={`w-3.5 h-3.5 transition-transform ${isRtl ? 'rotate-180 group-hover:-translate-x-0.5' : 'group-hover:translate-x-0.5'}`} />
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination / Load More Controls */}
      {!loading && timelines.length > 0 && (
        <div className="mt-10 mb-6 flex flex-col items-center justify-center gap-2 select-none">
          {/* Progress / count indicator */}
          <div className="text-xs font-medium text-ink-muted">
            <span>
              {t('community.showingCount', { shown: timelines.length, total: totalCount }) ||
                `Showing ${timelines.length} of ${totalCount} timelines`}
            </span>
          </div>

          {timelines.length < totalCount ? (
            /* Load More Button */
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore || loading}
              className="group inline-flex items-center gap-2 px-1 py-2 border-b-2 border-accent/50 hover:border-accent text-xs sm:text-sm font-bold text-ink hover:text-accent transition-colors duration-150 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none"
            >
              {loadingMore ? (
                <>
                  <span className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  <span>{t('community.loadingMore') || 'Loading...'}</span>
                </>
              ) : (
                <>
                  <Layers className="w-4 h-4 text-accent group-hover:scale-110 transition-transform" />
                  <span>{t('community.loadMore') || 'Load More'}</span>
                  <span className="text-accent text-[11px] font-bold">
                    +{Math.min(LOAD_MORE_BATCH_SIZE, totalCount - timelines.length)}
                  </span>
                </>
              )}
            </button>
          ) : (
            totalCount > INITIAL_BATCH_SIZE && (
              /* Completion state when all timelines have been loaded */
              <div className="flex items-center gap-2 text-ink-subtle text-xs font-medium py-1">
                <div className="w-8 h-px bg-line/60" />
                <span>{t('community.allLoaded') || 'All timelines loaded'}</span>
                <div className="w-8 h-px bg-line/60" />
              </div>
            )
          )}
        </div>
      )}

      {/* Admin Action Confirmation Modal */}
      {adminConfirmModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => !adminLoading && setAdminConfirmModal(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-surface-overlay border border-line shadow-panel p-6 animate-in zoom-in-95 duration-150 text-start"
            onClick={(e) => e.stopPropagation()}
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            <div className="flex items-center gap-3 mb-3 text-danger">
              <div className="p-2.5 rounded-xl bg-danger-soft">
                {adminConfirmModal.type === 'delete' ? (
                  <Trash2 className="w-6 h-6 text-danger" />
                ) : (
                  <EyeOff className="w-6 h-6 text-amber-500" />
                )}
              </div>
              <h3 className="text-base font-bold text-ink">
                {adminConfirmModal.type === 'delete'
                  ? (isRtl ? 'מחיקת ציר זמן לצמיתות (Admin)' : 'Delete Timeline Permanently')
                  : (isRtl ? 'הסרת ציר זמן מהקיר הציבורי' : 'Remove Timeline from Wall')}
              </h3>
            </div>

            <p className="text-sm text-ink-muted leading-relaxed mb-6">
              {adminConfirmModal.type === 'delete'
                ? (isRtl
                    ? `האם אתה בטוח שברצונך למחוק לצמיתות את ציר הזמן "${adminConfirmModal.timeline.title}" ממאגר הנתונים? פעולה זו תמחק אותו לחלוטין מהמערכת.`
                    : `Are you sure you want to permanently delete "${adminConfirmModal.timeline.title}" from the database? This action cannot be undone.`)
                : (isRtl
                    ? `האם להסיר את "${adminConfirmModal.timeline.title}" מקיר הקהילה? ציר הזמן יחזור להיות פרטי ולא יוצג עוד לציבור, אך יישמר עבור המחבר.`
                    : `Remove "${adminConfirmModal.timeline.title}" from the community wall? It will be made private and hidden from the public.`)}
            </p>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setAdminConfirmModal(null)}
                disabled={adminLoading}
                className="px-4 py-2 rounded-control bg-surface-sunken hover:bg-surface-hover text-ink text-xs font-semibold border border-line transition-colors cursor-pointer"
              >
                {t('common.cancel') || 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleAdminExecuteAction}
                disabled={adminLoading}
                className={`px-4 py-2 rounded-control text-white text-xs font-bold shadow-sm transition-all cursor-pointer flex items-center gap-1.5 ${
                  adminConfirmModal.type === 'delete'
                    ? 'bg-danger hover:bg-danger-hover'
                    : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {adminLoading && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                <span>
                  {adminConfirmModal.type === 'delete'
                    ? (isRtl ? 'מחק לצמיתות' : 'Delete Permanently')
                    : (isRtl ? 'הסר מהקיר' : 'Remove from Wall')}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

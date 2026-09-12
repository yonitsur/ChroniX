import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import {
  Filter,
  LayoutList,
  Play,
  Star,
  Check,
  GripHorizontal,
  ChevronUp,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  X,
  BookOpen,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { FLOATING_Z } from '../utils/floatingFocus';
import { getLaneColor, getDistinctCategories, getCategoryColor } from '../data/laneColors';

/**
 * Vertical menu docked to the left edge of the screen. Consolidates the timeline
 * viewing controls that previously lived in the top bar and as floating overlays:
 * filter, event list, guided exploration and star. Popovers open to the right of
 * the rail.
 */
export default function LeftDockMenu({
  timelineData,
  activeFilter = null,
  onFilterSelect,
  isCardsListOpen = false,
  onToggleCardsList,
  isExploring = false,
  onStartExplore,
  onExploreNext,
  onExplorePrev,
  onExitExplore,
  exploreProgress = null,
  filterStarredOnly = false,
  onToggleFilterStarredOnly,
  starredCount = 0,
  hasOverview = false,
  isOverviewOpen = false,
  onToggleOverview,
  onRectChange,
}) {
  const { language, t, isRtl } = useLanguage();

  // Which popover (if any) is open: 'filter' | null
  const [openMenu, setOpenMenu] = useState(null);
  const rootRef = useRef(null);

  // Collapsed state — hides all action buttons, leaving just the grip + toggle (saves
  // screen space, most useful on narrow viewports where the rail competes with content).
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('chronix_left_dock_collapsed') === 'true';
    } catch (e) {
      return false;
    }
  });
  const toggleCollapsed = () => {
    setOpenMenu(null);
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('chronix_left_dock_collapsed', String(next));
      } catch (e) {}
      return next;
    });
  };

  // Vertical-only drag position (top offset in px; null = default vertically-centered).
  const [posY, setPosY] = useState(() => {
    try {
      const saved = localStorage.getItem('chronix_left_dock_top');
      const n = saved != null ? Number(saved) : NaN;
      return Number.isFinite(n) ? n : null;
    } catch (e) {
      return null;
    }
  });
  const dragRef = useRef({ startY: 0, initialTop: 0, moved: false });

  const clampTop = (y) => {
    const h = rootRef.current?.offsetHeight || 320;
    return Math.max(8, Math.min(window.innerHeight - h - 8, y));
  };

  // Keep the rail on-screen when the window is resized.
  useEffect(() => {
    const onResize = () => {
      setPosY((prev) => (prev == null ? prev : clampTop(prev)));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Report the rail's current on-screen bounds so other floating elements (e.g. the
  // chat launcher) can anchor themselves relative to it, live-tracking drag/resize.
  useLayoutEffect(() => {
    if (!onRectChange) return;
    const measure = () => {
      const r = rootRef.current?.getBoundingClientRect();
      if (r) onRectChange({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (rootRef.current) ro.observe(rootRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [posY, onRectChange]);

  const handleGripPointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { startY: e.clientY, initialTop: rect.top, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}

    const onMove = (moveEvent) => {
      const dy = moveEvent.clientY - dragRef.current.startY;
      if (Math.abs(dy) > 3) dragRef.current.moved = true;
      setPosY(clampTop(dragRef.current.initialTop + dy));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (dragRef.current.moved) {
        setPosY((finalY) => {
          try {
            if (finalY != null) localStorage.setItem('chronix_left_dock_top', String(Math.round(finalY)));
          } catch (err) {}
          return finalY;
        });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  useEffect(() => {
    if (!openMenu) return;
    const handleClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openMenu]);

  const toggle = (name) => setOpenMenu((prev) => (prev === name ? null : name));

  // Filterable lane/theme items, mirroring TimelineView's own legend computation
  // so the ids line up with the timeline's imperative filter.
  const lanesArr = useMemo(() => timelineData?.lanes || [], [timelineData]);
  const isSingleTimeline = lanesArr.length <= 1;
  const legendCategories = useMemo(
    () => (isSingleTimeline ? getDistinctCategories(timelineData?.articles || []) : []),
    [isSingleTimeline, timelineData]
  );
  const useThemeMode = isSingleTimeline && legendCategories.length >= 2;
  const filterItems = useMemo(() => {
    const articles = timelineData?.articles || [];
    if (useThemeMode) {
      return legendCategories.map((name) => {
        const key = name.toLowerCase();
        const count = articles.filter(
          (a) => (a?.category ?? '').toString().trim().toLowerCase() === key
        ).length;
        return { id: name, name, color: getCategoryColor(name, legendCategories), count };
      });
    }
    return lanesArr.map((lane, idx) => {
      const matchKeys = [];
      if (lane.id !== undefined && lane.id !== null) matchKeys.push(lane.id);
      if (lane.title) matchKeys.push(lane.title);
      const normalizedKeys = matchKeys.map((k) => String(k).toLowerCase().trim());
      const count = articles.filter((a) =>
        normalizedKeys.includes(String(a?.lane ?? '').toLowerCase().trim())
      ).length;
      return {
        id: String(lane.id ?? lane.title ?? idx),
        name: lane.title || lane.name || `Lane ${idx + 1}`,
        color: getLaneColor(lane, idx, lanesArr),
        count,
      };
    });
  }, [useThemeMode, legendCategories, lanesArr, timelineData]);
  const canFilter = filterItems.length >= 2;

  const hasArticles = (timelineData?.articles?.length ?? 0) > 0;
  const atStart = !exploreProgress || exploreProgress.current <= 1;
  const atEnd = !exploreProgress || exploreProgress.current >= exploreProgress.total;

  // Nudge the user toward the guided tour: pulse the Play button whenever a fresh
  // timeline appears, and stop once they start (or have started) exploring.
  const [showTourHint, setShowTourHint] = useState(false);
  const timelineSigRef = useRef(null);
  useEffect(() => {
    if (!hasArticles) {
      setShowTourHint(false);
      timelineSigRef.current = null;
      return;
    }
    const sig = `${timelineData?.title ?? ''}|${timelineData?.articles?.length ?? 0}`;
    if (sig !== timelineSigRef.current) {
      timelineSigRef.current = sig;
      setShowTourHint(!isExploring);
    }
  }, [hasArticles, timelineData, isExploring]);
  useEffect(() => {
    if (isExploring) setShowTourHint(false);
  }, [isExploring]);

  // Shared classes for a rail icon button.
  const railBtn =
    'h-10 w-10 shrink-0 flex items-center justify-center rounded-control border transition-all cursor-pointer select-none active:scale-95 shadow-control group';
  const railIdle =
    'bg-surface-raised border-line text-ink-muted';

  // Tour navigation: a clear hierarchy so the forward step reads as the primary action.
  const navPrev =
    'bg-accent-soft border-accent/40 text-accent ' +
    'hover:bg-accent-soft/80 hover:border-accent ' +
    'disabled:opacity-30 disabled:cursor-default disabled:hover:bg-accent-soft';
  const navNext =
    'bg-accent border-accent text-accent-fg shadow-control ring-1 ring-accent-ring/30 ' +
    'hover:bg-accent-hover hover:border-accent ' +
    'disabled:opacity-30 disabled:cursor-default disabled:hover:bg-accent';

  // Popover container anchored to the right of the rail (rail is always on the physical left edge).
  const popoverBase =
    'absolute left-full top-0 ml-2 w-56 bg-surface-overlay rounded-sheet shadow-panel border border-line py-1.5 text-xs animate-in fade-in zoom-in-95 duration-150';

  return (
    <div
      ref={rootRef}
      id="chronix-left-dock"
      dir="ltr"
      style={{ zIndex: FLOATING_Z.ALWAYS_ON_TOP, ...(posY != null ? { top: posY } : {}) }}
      className={`fixed left-2 select-none ${posY == null ? 'top-1/2 -translate-y-1/2' : ''}`}
    >
      <div className="flex flex-col items-center gap-1.5 p-1.5 rounded-sheet bg-surface-overlay border border-line shadow-panel">
        {/* Drag handle — moves the rail up/down only */}
        <button
          type="button"
          onPointerDown={handleGripPointerDown}
          style={{ touchAction: 'none' }}
          className="h-5 w-10 shrink-0 flex items-center justify-center rounded-lg text-ink-subtle hover:text-ink-muted hover:bg-surface-hover cursor-grab active:cursor-grabbing transition-colors"
          title={t('legend.drag')}
          aria-label={t('legend.drag')}
        >
          <GripHorizontal className="w-4 h-4 pointer-events-none" />
        </button>

        {/* Collapse / expand toggle */}
        <button
          type="button"
          onClick={toggleCollapsed}
          className="h-6 w-10 shrink-0 flex items-center justify-center rounded-lg text-ink-subtle hover:text-ink-muted hover:bg-surface-hover cursor-pointer transition-colors"
          title={collapsed ? t('leftDock.expand') : t('leftDock.collapse')}
          aria-label={collapsed ? t('leftDock.expand') : t('leftDock.collapse')}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronsUpDown className="w-4 h-4 pointer-events-none" />
          ) : (
            <ChevronsDownUp className="w-4 h-4 pointer-events-none" />
          )}
        </button>

        {!collapsed && (
        <>

        {/* Narrative overview — opens the AI-written big-picture reading panel */}
        {hasOverview && (
          <button
            id="guide-dock-overview"
            type="button"
            onClick={() => onToggleOverview?.()}
            className={`${railBtn} ${
              isOverviewOpen
                ? 'bg-accent-soft border-accent text-accent'
                : `${railIdle} hover:text-accent hover:border-line-strong hover:bg-surface-hover`
            }`}
            title={t('overview.buttonTooltip')}
            aria-label={t('overview.title')}
            aria-pressed={isOverviewOpen}
          >
            <BookOpen className="w-4 h-4 shrink-0" />
          </button>
        )}

        {/* Filter by Theme/Lane */}
        {canFilter && (
          <div className="relative">
            <button
              id="guide-dock-filter"
              type="button"
              onClick={() => toggle('filter')}
              className={`${railBtn} ${
                openMenu === 'filter' || activeFilter?.items?.length
                  ? 'bg-accent-soft border-accent text-accent'
                  : `${railIdle} hover:text-accent hover:border-line-strong hover:bg-surface-hover`
              }`}
              title={t('toolbar.filterOptions')}
              aria-label={t('toolbar.filterOptions')}
              aria-haspopup="true"
              aria-expanded={openMenu === 'filter'}
            >
              <Filter className="w-4 h-4 shrink-0" />
            </button>

            {openMenu === 'filter' && (
              <div
                className={`${popoverBase} max-h-80 overflow-y-auto overscroll-contain`}
                dir={isRtl ? 'rtl' : 'ltr'}
              >
                <div className="px-3 py-1.5 flex items-center gap-1.5 text-[10px] font-bold text-ink-subtle uppercase tracking-wider">
                  <Filter className="w-3 h-3" />
                  {useThemeMode ? t('legend.filterByTheme') : t('legend.filterByLane')}
                </div>
                {filterItems.map((item) => {
                  const isActive = Boolean(activeFilter?.items?.some((selected) => selected.id === item.id));
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onFilterSelect?.(item);
                      }}
                      aria-pressed={isActive}
                      className={`w-full text-start px-3 py-2 flex items-center justify-between transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-accent-soft text-accent font-semibold'
                          : 'text-ink-muted hover:bg-surface-hover'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                        <span className="truncate">{item.name}</span>
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-surface-sunken text-ink-subtle">
                          {item.count ?? 0}
                        </span>
                        {isActive && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Guided exploration — the Play button toggles the tour; while active, prev/next
            arrows pop out above and below it. Pressing Play again ends the tour and they retract. */}
        {hasArticles && (
          <div className="flex flex-col items-center gap-1.5">
            {isExploring && (
              <button
                type="button"
                onClick={() => onExplorePrev?.()}
                disabled={atStart}
                className={`${railBtn} ${navPrev} animate-in fade-in zoom-in-90 duration-150`}
                title={`${t('explore.prev')} (\u2190)`}
                aria-label={t('explore.prev')}
              >
                <ChevronUp className="w-4 h-4 shrink-0" />
              </button>
            )}

            <button
              id="guide-dock-explore"
              type="button"
              onClick={() => (isExploring ? onExitExplore?.() : onStartExplore?.())}
              className={`${railBtn} ${
                isExploring
                  ? 'bg-surface-active border-line-strong text-ink hover:bg-surface-hover'
                  : `${railIdle} hover:text-ink hover:border-line-strong hover:bg-surface-hover${
                      showTourHint ? ' tour-play-hint' : ''
                    }`
              }`}
              title={isExploring ? t('explore.exit') : t('explore.startTooltip')}
              aria-label={isExploring ? t('explore.exit') : t('explore.start')}
              aria-pressed={isExploring}
            >
              {isExploring ? (
                <X className="w-4 h-4 shrink-0" />
              ) : (
                <Play className="w-4 h-4 fill-current shrink-0 translate-x-px" />
              )}
            </button>

            {isExploring && (
              <button
                type="button"
                onClick={() => onExploreNext?.()}
                disabled={atEnd}
                className={`${railBtn} ${navNext} animate-in fade-in zoom-in-90 duration-150`}
                title={`${t('explore.next')} (\u2192)`}
                aria-label={t('explore.next')}
              >
                <ChevronDown className="w-4 h-4 shrink-0" />
              </button>
            )}
          </div>
        )}

        {/* Event list / Cards drawer (opens on the right, unchanged behavior) */}
        <button
          id="guide-dock-cards"
          type="button"
          onClick={() => onToggleCardsList?.()}
          className={`${railBtn} ${
            isCardsListOpen
              ? 'bg-accent-soft border-accent text-accent'
              : `${railIdle} hover:text-accent hover:border-line-strong hover:bg-surface-hover`
          }`}
          title={isCardsListOpen ? (t('toolbar.cardsListCloseTitle') || t('common.close')) : (t('toolbar.cardsListTitle') || t('cardsList.title'))}
          aria-label={t('toolbar.cardsList') || t('cardsList.title')}
          aria-pressed={isCardsListOpen}
        >
          <LayoutList className="w-4 h-4 shrink-0" />
        </button>

        {/* Star / favorites filter */}
        <button
          id="guide-dock-star"
          type="button"
          onClick={() => onToggleFilterStarredOnly?.()}
          className={`${railBtn} relative ${
            filterStarredOnly
              ? 'bg-accent-soft border-accent text-accent'
              : `${railIdle} hover:text-accent hover:border-line-strong hover:bg-surface-hover`
          }`}
          title={filterStarredOnly ? t('toolbar.filterStarredActive') : t('toolbar.filterStarred')}
          aria-label={filterStarredOnly ? t('toolbar.filterStarredActive') : t('toolbar.filterStarred')}
          aria-pressed={filterStarredOnly}
        >
          <Star className={`w-4 h-4 shrink-0 ${filterStarredOnly ? 'fill-current' : ''}`} />
          {starredCount > 0 && (
            <span
              className={`absolute -top-1 -right-1 min-w-4 h-4 px-1 flex items-center justify-center text-[9px] font-bold rounded-full ${
                filterStarredOnly
                  ? 'bg-accent text-accent-fg'
                  : 'bg-surface-sunken text-ink-subtle border border-line'
              }`}
            >
              {starredCount}
            </span>
          )}
        </button>
        </>
        )}
      </div>
    </div>
  );
}

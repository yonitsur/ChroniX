import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Timeline, Article } from 'histropediajs';
import { GripVertical, Rows3, Columns3, Minus, Palette, Layers, Check, Play, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { getLaneColor, isColorLight, DEFAULT_LANE_COLORS, getDistinctCategories, getCategoryColor } from '../data/laneColors';
import { useLanguage } from '../context/LanguageContext';

// Reimplement Article.prototype.drawPeriodLinesAndConnectors so the period line and connector line
// are semi-transparent in the normal state (100% solid when hovered/selected/active), while the arrow
// triangle at the card is always filled opaquely — otherwise the connector line shows through it.
if (typeof window !== 'undefined' && Article) {
  if (!Article.prototype._originalChroniXDrawPeriodLinesAndConnectors) {
    Article.prototype._originalChroniXDrawPeriodLinesAndConnectors = Article.prototype.drawPeriodLinesAndConnectors;
  }
  Article.prototype.drawPeriodLinesAndConnectors = function(ctx, axisY) {
    const selectedId = this.owner?._selectedArticleId;
    const isSelected = selectedId ? (this.id === selectedId) : false;
    const isHigh = Boolean(this.isMouseover || this.isDragging || isSelected);
    const baseAlpha = typeof this.opacity === 'number' ? this.opacity : 1;
    const lineAlpha = isHigh ? baseAlpha : baseAlpha * 0.45;

    const style = this._getCurrentStyle();
    // The period/connector lines carry the timeline (lane) color, kept independent from the
    // card header background so the title itself can render on the plain card background.
    const lineColor = style.connectorLine?.color || style.color;
    const geometry = this._getPeriodLineRenderGeometry(axisY);
    const y = geometry.y;

    ctx.globalAlpha = lineAlpha;
    if (!this.hidePeriodLine) {
      const fromX = this.indicator.fromX, toX = this.indicator.toX;
      ctx.beginPath();
      ctx.lineWidth = geometry.thickness;
      ctx.moveTo(fromX, y);
      ctx.lineTo(toX, y);
      if (this.period.isToPresent) {
        const periodLength = toX - fromX, maxFadeLength = 15;
        const fadeStartColorStop = Math.max(1 - maxFadeLength / periodLength, 0.7);
        const grad = ctx.createLinearGradient(fromX, y, toX, y);
        grad.addColorStop(0, lineColor);
        grad.addColorStop(fadeStartColorStop, lineColor);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = grad;
      } else {
        ctx.strokeStyle = lineColor;
      }
      ctx.stroke();
    }

    if (!style.connectorLine.visible) {
      ctx.globalAlpha = 1;
      return;
    }

    const cardLayout = this._getCurrentCardLayout();
    const connectorEnd = typeof cardLayout.getConnectorEnd === 'function'
      ? cardLayout.getConnectorEnd.call(this)
      : {
          left: this.position.left + style.connectorLine.offsetX,
          top: this.position.top + this.getHeight() + style.connectorLine.offsetY,
        };
    const x1 = Math.max(0, this.indicator.fromX);
    const y1 = y;
    const x2 = connectorEnd.left;
    const y2 = connectorEnd.top;

    // Connector line: semi-transparent in the normal state.
    ctx.globalAlpha = lineAlpha;
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = style.connectorLine.thickness;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Arrow triangle: always fully opaque so the connector line never shows through it.
    const radians = Math.atan((y2 - y1) / (x2 - x1)) + (x2 >= x1 ? -90 : 90) * Math.PI / 180;
    ctx.globalAlpha = baseAlpha;
    ctx.fillStyle = lineColor;
    ctx.save();
    ctx.beginPath();
    ctx.translate(x2, y2);
    ctx.rotate(radians);
    ctx.moveTo(-style.connectorLine.arrow.width, 0);
    ctx.lineTo(style.connectorLine.arrow.width, 0);
    ctx.lineTo(0, -style.connectorLine.arrow.height);
    ctx.closePath();
    ctx.restore();
    ctx.fill();

    ctx.globalAlpha = 1;
  };

  // Patch Article.prototype._getCurrentStyle so that in landscape layout (used in multi-lane / multi-timeline view),
  // event titles always contrast against the card background (dark text on white cards in day mode!)
  if (!Article.prototype._originalChroniXGetCurrentStyle) {
    Article.prototype._originalChroniXGetCurrentStyle = Article.prototype._getCurrentStyle;
  }
  const originalGetCurrentStyle = Article.prototype._originalChroniXGetCurrentStyle;
  Article.prototype._getCurrentStyle = function() {
    // While we temporarily force isActive to reveal the star on hover, keep the card
    // rendered with its hover style rather than the "selected"/active style.
    let restoreActive = false;
    if (this._chronixFakeActive && this.isActive) {
      this.isActive = false;
      restoreActive = true;
    }
    const style = originalGetCurrentStyle.call(this);
    if (restoreActive) this.isActive = true;
    if (!style) return style;

    const layoutName = typeof this._getCurrentCardLayoutName === 'function'
      ? this._getCurrentCardLayoutName()
      : (this._resolvedCardLayoutName || 'portrait');

    if (layoutName === 'landscape') {
      const bg = style.backgroundColor || (this.owner?._isDarkTheme ? '#0f172a' : '#ffffff');
      const isBgLight = isColorLight(bg);
      const landscapeTextColor = isBgLight ? '#0f172a' : '#f8fafc';
      return {
        ...style,
        header: {
          ...style.header,
          text: {
            ...style.header?.text,
            color: landscapeTextColor
          }
        }
      };
    }

    return style;
  };

  // Reveal the (unstarred) star icon whenever an article is hovered, so users can star
  // an event directly on hover without selecting it first. The library only draws the
  // star when an article is active or already starred, so we briefly force isActive
  // during the card draw (kept visually as hover style via _getCurrentStyle above).
  if (!Article.prototype._originalChroniXDraw) {
    Article.prototype._originalChroniXDraw = Article.prototype.draw;
  }
  Article.prototype.draw = function(ctx) {
    const starVisible = this.owner?.options?.article?.star?.visible !== false;
    const showStarOnHover = starVisible && this.isMouseover && !this.isActive && !this.isStarred;
    if (showStarOnHover) {
      this._chronixFakeActive = true;
      this.isActive = true;
    }
    try {
      this._originalChroniXDraw.call(this, ctx);
    } finally {
      if (showStarOnHover) {
        this.isActive = false;
        this._chronixFakeActive = false;
      }
    }
  };

  Article.prototype._hasChroniXAlphaPatch = true;
}

// Convert a hex color (#rgb or #rrggbb) to an rgba string with the given alpha.
function hexToRgba(hex, alpha = 1) {
  if (typeof hex !== 'string' || !hex.startsWith('#')) return hex;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return hex;
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function resolveArticleLaneColor(laneIdentifier, lanes = []) {
  if (!laneIdentifier && lanes.length > 0) {
    return getLaneColor(lanes[0], 0, lanes);
  }
  if (laneIdentifier && lanes.length > 0) {
    const str = String(laneIdentifier).toLowerCase().trim();
    const foundIdx = lanes.findIndex(
      (l) =>
        String(l.id).toLowerCase() === str ||
        String(l.title || '').toLowerCase() === str
    );
    if (foundIdx >= 0) {
      return getLaneColor(lanes[foundIdx], foundIdx, lanes);
    }
  }
  const fallbackStr = String(laneIdentifier || 'default');
  let hash = 0;
  for (let i = 0; i < fallbackStr.length; i++) {
    hash = (hash << 5) - hash + fallbackStr.charCodeAt(i);
    hash |= 0;
  }
  return DEFAULT_LANE_COLORS[Math.abs(hash) % DEFAULT_LANE_COLORS.length];
}

const clampVal = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Approximate decimal-year conversions (kept consistent with dateToDecimalYear's (m-1)*30+(d-1))/365 mapping)
const dateToDecimal = (d) => {
  if (!d || d.year === undefined || d.year === null) return null;
  const y = Number(d.year);
  if (isNaN(y)) return null;
  const m = (Number(d.month) || 1) - 1;
  const day = (Number(d.day) || 1) - 1;
  return y + (m * 30 + day) / 365;
};
const decimalToDmy = (v) => {
  let year = Math.floor(v);
  const doy = Math.round((v - year) * 365);
  if (year === 0) year = 1; // histropedia calendars have no year 0
  const month = clampVal(Math.floor(doy / 30) + 1, 1, 12);
  const day = clampVal((doy % 30) + 1, 1, 28);
  return { year, month, day };
};

/**
 * Floating, interactive filter legend for the timeline. Doubles as a color key
 * and a filter control: clicking an entry shows only events of that theme
 * (single timelines) or lane (split timelines); an "All" entry clears it.
 * Draggable within the timeline area, toggles vertical/horizontal layout, and
 * minimizes to a pill.
 */
function FilterLegend({ items, mode, selectedId, onSelect, t, isRtl }) {
  const [pos, setPos] = useState({ x: 12, y: 12 });
  const [orientation, setOrientation] = useState('vertical');
  const [minimized, setMinimized] = useState(false);
  const elRef = useRef(null);
  const dragRef = useRef(null);

  const isThemeMode = mode === 'theme';
  const HeaderIcon = isThemeMode ? Palette : Layers;
  const allLabel = isThemeMode ? t('legend.allThemes') : t('legend.allLanes');
  const filterTitle = isThemeMode ? t('legend.filterByTheme') : t('legend.filterByLane');
  const selectedItem = items.find((it) => it.id === selectedId) || null;

  const beginDrag = (e) => {
    const el = elRef.current;
    const parent = el?.parentElement;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origin: { ...pos },
      parentRect: parent?.getBoundingClientRect(),
      elRect: el?.getBoundingClientRect(),
      moved: false,
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };

  const moveDrag = (e) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
    let nx = d.origin.x + dx;
    let ny = d.origin.y + dy;
    if (d.parentRect && d.elRect) {
      nx = clampVal(nx, 0, Math.max(0, d.parentRect.width - d.elRect.width));
      ny = clampVal(ny, 0, Math.max(0, d.parentRect.height - d.elRect.height));
    }
    setPos({ x: nx, y: ny });
  };

  const endDrag = (e, onTap) => {
    const d = dragRef.current;
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    if (d && !d.moved && onTap) onTap();
  };

  const dragHandlers = (onTap) => ({
    onPointerDown: beginDrag,
    onPointerMove: moveDrag,
    onPointerUp: (e) => endDrag(e, onTap),
  });

  if (minimized) {
    return (
      <div ref={elRef} className="absolute z-10" style={{ left: pos.x, top: pos.y, touchAction: 'none' }}>
        <button
          type="button"
          {...dragHandlers(() => setMinimized(false))}
          title={filterTitle}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/90 dark:bg-slate-900/85 backdrop-blur-md border border-slate-200/80 dark:border-slate-700/70 shadow-lg cursor-grab active:cursor-grabbing text-slate-700 dark:text-slate-200"
        >
          <HeaderIcon className="w-3.5 h-3.5 text-sky-500" />
          {selectedItem ? (
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: selectedItem.color }} />
              <span className="text-xs font-semibold truncate max-w-[120px]">{selectedItem.name}</span>
            </span>
          ) : (
            <span className="text-xs font-semibold">{items.length}</span>
          )}
        </button>
      </div>
    );
  }

  const itemBase =
    'flex items-center gap-1.5 text-xs font-medium rounded-lg px-1.5 py-1 transition-colors cursor-pointer text-start';

  const renderAll = () => {
    const isSelected = !selectedId;
    return (
      <button
        key="__all__"
        type="button"
        onClick={() => onSelect(null)}
        title={allLabel}
        className={`${itemBase} ${
          isSelected
            ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-semibold'
            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60'
        }`}
      >
        <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-gradient-to-br from-sky-400 to-indigo-500" />
        <span className="truncate max-w-[160px]">{allLabel}</span>
        {isSelected && <Check className="w-3 h-3 shrink-0 text-sky-500" />}
      </button>
    );
  };

  const renderItem = (item) => {
    const isSelected = selectedId === item.id;
    const dimmed = !!selectedId && !isSelected;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onSelect(item)}
        title={item.name}
        className={`${itemBase} ${
          isSelected
            ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
            : dimmed
            ? 'text-slate-400 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/60'
            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60'
        }`}
      >
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
        <span className="truncate max-w-[160px]">{item.name}</span>
        {isSelected && <Check className="w-3 h-3 shrink-0 text-sky-500" />}
      </button>
    );
  };

  return (
    <div
      ref={elRef}
      dir={isRtl ? 'rtl' : 'ltr'}
      className="absolute z-10 max-w-[70%] rounded-xl bg-white/90 dark:bg-slate-900/85 backdrop-blur-md border border-slate-200/80 dark:border-slate-700/70 shadow-lg overflow-hidden"
      style={{ left: pos.x, top: pos.y, touchAction: 'none' }}
    >
      {/* Header / drag bar */}
      <div className="flex items-center gap-1 pl-1 pr-1 py-1 border-b border-slate-200/70 dark:border-slate-700/60">
        <span
          {...dragHandlers()}
          title={t('legend.drag')}
          className="flex items-center text-slate-400 dark:text-slate-500 cursor-grab active:cursor-grabbing px-0.5"
        >
          <GripVertical className="w-4 h-4" />
        </span>
        <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400 mr-auto select-none">
          <HeaderIcon className="w-3.5 h-3.5 text-sky-500" />
          <span className="truncate max-w-[110px]">{filterTitle}</span>
        </span>
        <button
          type="button"
          onClick={() => setOrientation((o) => (o === 'vertical' ? 'horizontal' : 'vertical'))}
          title={orientation === 'vertical' ? t('legend.layoutHorizontal') : t('legend.layoutVertical')}
          className="p-1 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer transition-colors"
        >
          {orientation === 'vertical'
            ? <Columns3 className="w-3.5 h-3.5" />
            : <Rows3 className="w-3.5 h-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => setMinimized(true)}
          title={t('legend.minimize')}
          className="p-1 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer transition-colors"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Legend / filter items */}
      <div
        className={`px-2 py-2 ${
          orientation === 'vertical'
            ? 'flex flex-col gap-0.5'
            : 'flex flex-row flex-wrap items-center gap-x-1.5 gap-y-1 max-w-[46vw]'
        }`}
      >
        {renderAll()}
        {items.map((it) => renderItem(it))}
      </div>
    </div>
  );
}

const TimelineView = forwardRef(({
  timelineData,
  onSelectArticle,
  selectedArticleId,
  starredArticleIds,
  onToggleStar,
  theme = 'light',
  // Exploration mode (desktop): entry button + floating HUD are rendered only when these are provided
  isExploring = false,
  exploreProgress = null,
  onStartExplore,
  onExploreNext,
  onExplorePrev,
  onExitExplore
}, ref) => {
  const { t, isRtl } = useLanguage();
  const containerRef = useRef(null);
  const timelineInstanceRef = useRef(null);
  const starredArticleIdsRef = useRef(starredArticleIds);

  // Active lane/theme filter (null = show all). State drives the legend UI;
  // refs let imperative + load handlers read the latest values without stale closures.
  const [activeFilterId, setActiveFilterId] = useState(null);
  const activeFilterRef = useRef(null);
  const filterModeRef = useRef('lane');
  const filterStarredOnlyRef = useRef(false);

  useEffect(() => {
    starredArticleIdsRef.current = starredArticleIds;
  }, [starredArticleIds]);

  // Applies both the starred-only filter and the lane/theme filter to the
  // canvas via each article's `hiddenByFilter` option, then refits the view.
  const applyVisibilityFilters = useCallback(() => {
    const tl = timelineInstanceRef.current;
    if (!tl || !tl.articles) return;
    const starredOnly = filterStarredOnlyRef.current;
    const ids = starredArticleIdsRef.current || new Set();
    const sel = activeFilterRef.current;
    const mode = filterModeRef.current;

    tl.articles.forEach((art) => {
      let hidden = false;
      if (starredOnly && !ids.has(art.id)) hidden = true;
      if (!hidden && sel) {
        const value =
          mode === 'theme'
            ? (art.data?.category ?? art.category ?? '')
            : (art.data?.lane ?? art.lane);
        if (!sel.matchKeys.includes(value)) hidden = true;
      }
      art.setOption('hiddenByFilter', hidden);
    });

    // In split timelines, collapse the body of filtered-out lanes down to their
    // colored header stripe (fixed height) so the selected lane — left on auto
    // height — expands to absorb the freed space.
    if (mode === 'lane' && Array.isArray(tl.lanes)) {
      tl.lanes.forEach((lane) => {
        const isSelected =
          !sel ||
          sel.matchKeys.includes(lane.id) ||
          sel.matchKeys.includes(lane.title) ||
          String(sel.id) === String(lane.id);
        if (isSelected) {
          lane.setOption('layout.height', null);
          lane.setOption('layout.heightWeight', 1);
        } else {
          const headerH = lane.layout?.header?.height ?? 28;
          lane.setOption('layout.height', headerH);
        }
      });
    }

    tl.redraw();
    try {
      tl.fitArticles({ padding: 70 });
    } catch (e) {
      // ignore
    }
  }, []);

  const handleFilterSelect = (item) => {
    const nextId = !item || activeFilterId === item.id ? null : item.id;
    activeFilterRef.current = nextId ? item : null;
    setActiveFilterId(nextId);
  };

  // Re-apply whenever the active lane/theme selection changes.
  useEffect(() => {
    applyVisibilityFilters();
  }, [activeFilterId, applyVisibilityFilters]);


  // Synchronize external selection with Histropedia canvas instance
  useEffect(() => {
    const tl = timelineInstanceRef.current;
    if (tl) {
      tl._selectedArticleId = selectedArticleId || null;
      if (selectedArticleId) {
        try {
          tl.select(selectedArticleId);
        } catch (e) {
          // ignore
        }
      } else {
        if (tl.articles) {
          tl.articles.forEach((a) => {
            a.isActive = false;
          });
        }
      }
      tl.redraw();
    }
  }, [selectedArticleId]);

  useImperativeHandle(ref, () => ({
    zoomIn: () => {
      const tl = timelineInstanceRef.current;
      if (tl) {
        const currentZoom = tl.getZoom();
        tl.setZoom(Math.max(0, currentZoom - 4));
      }
    },
    zoomOut: () => {
      const tl = timelineInstanceRef.current;
      if (tl) {
        const currentZoom = tl.getZoom();
        tl.setZoom(currentZoom + 4);
      }
    },
    fitAll: () => {
      const tl = timelineInstanceRef.current;
      if (tl) {
        tl.fitArticles({ padding: 60 });
      }
    },
    focusArticle: (articleId, opts = {}) => {
      const tl = timelineInstanceRef.current;
      if (tl && articleId) {
        tl._selectedArticleId = articleId;
        const art = tl.getArticleById(articleId);
        if (art) {
          let fitted = false;
          if (opts.animate) {
            // Exploration mode: glide to the event at a stable zoom level (a fixed date window
            // derived from the timeline's total span) so stepping feels like a smooth camera pan
            // instead of a jarring re-zoom on every point event.
            const dataArts = timelineData?.articles || [];
            const vals = [];
            dataArts.forEach((a) => {
              const f = dateToDecimal(a.from);
              if (f !== null) vals.push(f);
              const t2 = dateToDecimal(a.to);
              if (t2 !== null) vals.push(t2);
            });
            const dataArt = dataArts.find((a) => a.id === articleId);
            const from = dateToDecimal(dataArt?.from);
            if (vals.length > 0 && from !== null) {
              const span = Math.max(...vals) - Math.min(...vals);
              const to = dateToDecimal(dataArt?.to);
              const periodSpan = to !== null && to > from ? to - from : 0;
              let window = Math.max(span * 0.16, periodSpan * 1.5);
              if (!(window > 0)) window = 0.5;
              const center = periodSpan > 0 ? (from + to) / 2 : from;
              // The event drawer overlays the right ~420px of the canvas while exploring,
              // so bias the fit leftwards to centre the event in the visible region.
              const canvasW = containerRef.current?.clientWidth || 0;
              const drawerPad = canvasW > 760 ? { left: 24, right: 444 } : 24;
              try {
                tl.fitDateRange(
                  decimalToDmy(center - window / 2),
                  decimalToDmy(center + window / 2),
                  { padding: drawerPad, animation: { active: true, duration: 620, easing: 'swing' } }
                );
                fitted = true;
              } catch (e) {
                console.warn('fitDateRange fallback:', e);
              }
            }
          }
          if (!fitted) {
            try {
              tl.fitArticleRange(art, { padding: 120 });
            } catch (e) {
              console.warn('fitArticleRange fallback:', e);
              const date = art.from || art.data?.from || art.period?.from;
              if (date) {
                tl.setCentreDate(date);
              }
            }
          }
          try {
            tl.select(articleId);
            tl.bringFront(articleId);
          } catch (e) {
            // ignore
          }
          tl.redraw();
        }
      }
    },
    // Ids of articles currently passing the lane/theme + starred filters, for exploration ordering.
    getVisibleArticleIds: () => {
      const tl = timelineInstanceRef.current;
      if (!tl?.articles) return null;
      return tl.articles.filter((a) => !a.isHiddenByFilter).map((a) => a.id);
    },
    setArticleStarred: (articleId, isStarred) => {
      const tl = timelineInstanceRef.current;
      if (tl && articleId) {
        const art = tl.getArticleById(articleId);
        if (art) {
          art.setOption('starred', isStarred);
          tl.redraw();
        }
      }
    },
    setFilterStarredOnly: (onlyStarred, currentStarredIds) => {
      filterStarredOnlyRef.current = onlyStarred;
      if (currentStarredIds) starredArticleIdsRef.current = currentStarredIds;
      applyVisibilityFilters();
    },
    getCanvas: () => {
      return timelineInstanceRef.current?.canvas || null;
    }
  }));

  useEffect(() => {
    if (!containerRef.current || !timelineData) return;

    const container = containerRef.current;
    container.innerHTML = '';

    const width = container.clientWidth || 1000;
    const height = container.clientHeight || 600;

    const isDark = theme === 'dark';

    // Find a reasonable initial date
    let initialDate = { year: 1950, month: 1, day: 1 };
    if (timelineData.articles && timelineData.articles.length > 0) {
      const first = timelineData.articles[0];
      if (first.from) {
        initialDate = {
          year: first.from.year,
          month: first.from.month || 1,
          day: first.from.day || 1,
        };
      }
    }

    const articleStyle = {
      backgroundColor: isDark ? '#0f172a' : '#ffffff',
      color: isDark ? '#1e293b' : '#f1f5f9',
      topRadius: 6,
      borderRadius: 6,
      border: {
        color: isDark ? '#334155' : '#cbd5e1',
        width: 1,
      },
      header: {
        height: 50,
        text: {
          font: "600 13px 'Plus Jakarta Sans', Heebo, system-ui, sans-serif",
          color: isDark ? '#f8fafc' : '#0f172a',
          margin: 10,
          lineHeight: 18,
          numberOfLines: 2,
        }
      },
      subheader: {
        height: 26,
        color: isDark ? '#0b1120' : '#e2e8f0',
        text: {
          font: "500 11px 'Plus Jakarta Sans', Heebo, system-ui, sans-serif",
          color: isDark ? '#94a3b8' : '#64748b',
          margin: 10,
          lineHeight: 14,
        }
      },
      shadow: {
        x: 0,
        y: 3,
        amount: isDark ? 8 : 4,
        color: isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(0, 0, 0, 0.08)',
      },
      connectorLine: {
        visible: true,
        thickness: 1.5,
        color: isDark ? '#475569' : '#94a3b8',
      }
    };

    try {
      const options = {
        width,
        height,
        initialDate,
        disableBranding: true,
        enableUserControl: true,
        enableCursor: true,
        verticalOffset: 65,
        style: {
          mainLine: {
            visible: true,
            size: 8,
          },
          dateLabel: {
            minor: {
              color: isDark ? '#cbd5e1' : '#475569',
              font: "500 11px 'Plus Jakarta Sans', Heebo, system-ui, sans-serif",
            },
            major: {
              color: isDark ? '#f8fafc' : '#0f172a',
              font: "700 13px 'Plus Jakarta Sans', Heebo, system-ui, sans-serif",
            }
          },
          marker: {
            minor: {
              height: 12,
              color: isDark ? '#38bdf8' : '#0284c7',
            },
            major: {
              height: 24,
              color: isDark ? '#818cf8' : '#4338ca',
            }
          }
        },
        lane: {
          visible: true,
          gap: 2,
          axisGap: 2,
          defaultStyle: {
            header: {
              backgroundColor: isDark ? 'rgba(30, 41, 59, 0.9)' : 'rgba(241, 245, 249, 0.95)',
            },
            body: {
              backgroundColor: isDark ? 'rgba(15, 23, 42, 0.4)' : 'rgba(203, 213, 225, 0.6)',
              borderColor: isDark ? 'rgba(51, 65, 85, 0.5)' : 'rgba(203, 213, 225, 0.8)',
            },
            title: {
              color: isDark ? '#f1f5f9' : '#1e293b',
              font: "600 13px 'Plus Jakarta Sans', Heebo, system-ui, sans-serif",
            }
          }
        },
        timeBand: {
          visible: true,
          reserveSpace: true,
        },
        article: {
          cardLayout: 'portrait',
          draggable: true,
          autoStacking: {
            active: true,
            fitToHeight: true,
            rowSpacing: 40,
          },
          periodLine: {
            thickness: 8,
            spacing: 4,
          },
          defaultStyle: articleStyle,
          defaultHoverStyle: {
            backgroundColor: isDark ? '#1e293b' : '#ffffff',
            border: {
              width: 2,
            },
            shadow: {
              x: 0,
              y: 6,
              amount: 14,
              color: isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.16)',
            }
          },
          defaultActiveStyle: {
            backgroundColor: isDark ? '#172554' : '#eff6ff',
            border: {
              width: 2.5,
            }
          },
          layoutStyles: {
            landscape: {
              style: {
                header: {
                  text: {
                    color: isDark ? '#f8fafc' : '#0f172a',
                  }
                },
                subheader: {
                  text: {
                    color: isDark ? '#94a3b8' : '#64748b',
                  }
                }
              },
              hoverStyle: {
                header: {
                  text: {
                    color: isDark ? '#f8fafc' : '#0f172a',
                  }
                }
              },
              activeStyle: {
                header: {
                  text: {
                    color: isDark ? '#f8fafc' : '#0f172a',
                  }
                }
              }
            }
          }
        }
      };

      const timeline = new Timeline(container, options);
      timelineInstanceRef.current = timeline;
      timeline._isDarkTheme = isDark;

      // 1. Load lanes if any
      if (timelineData.lanes && timelineData.lanes.length > 0) {
        timeline.loadLanes(
          timelineData.lanes.map((l, idx) => {
            const laneColor = getLaneColor(l, idx, timelineData.lanes);
            const isLight = isColorLight(laneColor);
            const textColor = isLight ? '#0f172a' : '#ffffff';

            return {
              id: l.id,
              title: l.title,
              layout: {
                header: {
                  height: 28,
                  padding: { left: 14, right: 14 }
                }
              },
              style: {
                header: {
                  backgroundColor: laneColor,
                },
                body: {
                  backgroundColor: isDark ? 'rgba(15, 23, 42, 0.4)' : 'rgba(203, 213, 225, 0.6)',
                  borderColor: isDark ? 'rgba(51, 65, 85, 0.5)' : 'rgba(203, 213, 225, 0.8)',
                },
                title: {
                  color: textColor,
                  font: "600 13px 'Plus Jakarta Sans', Heebo, system-ui, sans-serif",
                }
              }
            };
          })
        );
      }

      // Helper to tone down timeband background in dark mode
      const formatBandBg = (color) => {
        if (!color) return isDark ? 'rgba(59, 130, 246, 0.12)' : 'rgba(59, 130, 246, 0.08)';
        if (typeof color === 'string' && color.startsWith('rgba')) {
          return isDark ? color.replace(/[\d\.]+\)$/, '0.12)') : color;
        }
        if (typeof color === 'string' && color.startsWith('#')) {
          let hex = color.slice(1);
          if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
          if (hex.length === 6) {
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            return `rgba(${r}, ${g}, ${b}, ${isDark ? 0.12 : 0.09})`;
          }
        }
        return color;
      };

      // 2. Load time bands if any
      if (timelineData.timeBands && timelineData.timeBands.length > 0) {
        timeline.loadTimeBands(
          timelineData.timeBands.map((tb) => ({
            id: tb.id,
            title: tb.title,
            from: tb.from,
            to: tb.to,
            style: {
              background: formatBandBg(tb.color),
              text: {
                color: isDark ? '#e2e8f0' : '#475569',
              },
            }
          }))
        );
      }

      // 3. Load articles
      if (timelineData.articles && timelineData.articles.length > 0) {
        // In a single (non-split) timeline, color events by their theme (`category`)
        // so users still see a thematic division — mirroring how lanes color a split timeline.
        const isSingleTimeline = !timelineData.lanes || timelineData.lanes.length <= 1;
        const themeCategories = isSingleTimeline
          ? getDistinctCategories(timelineData.articles)
          : [];
        const colorByTheme = isSingleTimeline && themeCategories.length >= 2;
        filterModeRef.current = colorByTheme ? 'theme' : 'lane';

        const formattedArticles = timelineData.articles.map((art) => {
          const laneColor = colorByTheme && art.category
            ? getCategoryColor(art.category, themeCategories)
            : resolveArticleLaneColor(art.lane, timelineData.lanes);

          return {
            ...art,
            id: art.id,
            title: art.title,
            subtitle: art.subtitle || '',
            lane: art.lane,
            from: art.from,
            to: art.to || undefined,
            isToPresent: art.isToPresent || false,
            imageUrl: art.imageUrl || undefined,
            rank: art.rank || 5,
            starred: starredArticleIdsRef.current?.has(art.id) || !!art.starred,
            style: {
              ...articleStyle,
              // Plain card background behind the title; the lane color lives on the frame and lines.
              color: isDark ? '#0f172a' : '#ffffff',
              border: {
                color: laneColor,
                width: 1.5,
              },
              connectorLine: {
                ...articleStyle.connectorLine,
                color: laneColor,
              }
            },
            hoverStyle: {
              ...articleStyle,
              color: isDark ? '#1e293b' : '#ffffff',
              backgroundColor: isDark ? '#1e293b' : '#ffffff',
              border: {
                color: laneColor,
                width: 2,
              },
              connectorLine: {
                ...articleStyle.connectorLine,
                color: laneColor,
                thickness: 2,
              }
            },
            activeStyle: {
              ...articleStyle,
              color: isDark ? '#172554' : '#eff6ff',
              backgroundColor: isDark ? '#172554' : '#eff6ff',
              border: {
                color: laneColor,
                width: 2.5,
              },
              connectorLine: {
                ...articleStyle.connectorLine,
                color: laneColor,
                thickness: 2.5,
              }
            },
            // Attach custom rich data into article object for drawer
            wikiUrl: art.wikiUrl,
            extract: art.extract,
            wikiTitle: art.wikiTitle,
            locationName: art.locationName,
            lat: art.lat,
            lng: art.lng,
            googleMapsUrl: art.googleMapsUrl,
          };
        });

        timeline.load(formattedArticles);

        // Reset any active lane/theme filter for the freshly loaded timeline.
        activeFilterRef.current = null;
        setActiveFilterId(null);

        // Sync initial selection state so unselected articles start with semi-transparent lines
        timeline._selectedArticleId = selectedArticleId || null;
        if (selectedArticleId) {
          try {
            timeline.select(selectedArticleId);
          } catch (e) {
            // ignore
          }
        } else if (timeline.articles) {
          timeline.articles.forEach((a) => {
            a.isActive = false;
          });
          timeline.redraw();
        }

        // Fit articles in view
        setTimeout(() => {
          try {
            timeline.fitArticles({ padding: 70 });
          } catch (e) {
            console.warn('fitArticles fallback:', e);
          }
        }, 100);
      }

      // Event listener for article clicks
      timeline.on('article-click', (article) => {
        const clickedId = article?.id || article?.data?.id;
        if (!clickedId) return;

        // If the user clicked specifically on the star icon on canvas
        if (article.isMouseOverStar) {
          onToggleStar?.(clickedId, article.isStarred);
          return;
        }

        if (timelineInstanceRef.current) {
          timelineInstanceRef.current._selectedArticleId = clickedId;
          timelineInstanceRef.current.redraw();
        }

        if (onSelectArticle) {
          const original = timelineData.articles?.find((a) => a.id === clickedId);
          onSelectArticle(original || article.data || article);
        }
      });

      // Event listener for timeline background clicks (deselection)
      timeline.on('timeline-click', () => {
        if (timelineInstanceRef.current) {
          timelineInstanceRef.current._selectedArticleId = null;
          if (timelineInstanceRef.current.articles) {
            timelineInstanceRef.current.articles.forEach((a) => {
              a.isActive = false;
            });
          }
          timelineInstanceRef.current.redraw();
        }
        onSelectArticle?.(null);
      });

    } catch (err) {
      console.error('Histropedia initialization failed:', err);
    }

    // Resize observer to keep canvas full size
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: newWidth, height: newHeight } = entry.contentRect;
        if (newWidth > 0 && newHeight > 0 && timelineInstanceRef.current) {
          try {
            timelineInstanceRef.current.setSize(newWidth, newHeight);
          } catch (e) {
            // ignore during unmount
          }
        }
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      timelineInstanceRef.current = null;
      container.innerHTML = '';
    };
  }, [timelineData, theme]);

  // Legend / filter items: by event theme in single timelines, by lane in split ones.
  const lanesArr = timelineData?.lanes || [];
  const isSingleTimeline = lanesArr.length <= 1;
  const legendCategories = isSingleTimeline
    ? getDistinctCategories(timelineData?.articles || [])
    : [];
  const useThemeMode = isSingleTimeline && legendCategories.length >= 2;

  const filterItems = useThemeMode
    ? legendCategories.map((name) => ({
        id: name,
        name,
        color: getCategoryColor(name, legendCategories),
        matchKeys: [name],
      }))
    : lanesArr.map((lane, idx) => {
        const matchKeys = [];
        if (lane.id !== undefined && lane.id !== null) matchKeys.push(lane.id);
        if (lane.title) matchKeys.push(lane.title);
        return {
          id: String(lane.id ?? lane.title ?? idx),
          name: lane.title || lane.name || `Lane ${idx + 1}`,
          color: getLaneColor(lane, idx, lanesArr),
          matchKeys,
        };
      });

  const exploreCurrentTitle = isExploring && selectedArticleId
    ? (timelineData?.articles?.find((a) => a.id === selectedArticleId)?.title || '')
    : '';

  // Keep the floating explore controls centred in the area left visible by the event drawer (~420px)
  const exploreOverlayLeft = selectedArticleId ? 'max(200px, calc((100% - 420px) / 2))' : '50%';

  return (
    <div
      dir="ltr"
      className="w-full h-full relative overflow-hidden bg-slate-100 dark:bg-slate-950 select-none transition-colors duration-200 histropedia-timeline-wrapper"
    >
      <div
        ref={containerRef}
        id="histropedia-container"
        dir="ltr"
        className="w-full h-full absolute inset-0"
        style={{ touchAction: 'none' }}
      />
      {filterItems.length >= 2 && (
        <FilterLegend
          items={filterItems}
          mode={useThemeMode ? 'theme' : 'lane'}
          selectedId={activeFilterId}
          onSelect={(item) => handleFilterSelect(item)}
          t={t}
          isRtl={isRtl}
        />
      )}

      {/* Exploration mode — entry point (“Start Exploring” pill) */}
      {typeof onStartExplore === 'function' && !isExploring && (timelineData?.articles?.length || 0) > 0 && (
        <div
          className="absolute bottom-5 -translate-x-1/2 z-20 transition-[left] duration-300 animate-in fade-in slide-in-from-bottom-3"
          style={{ left: exploreOverlayLeft }}
        >
          <button
            type="button"
            onClick={onStartExplore}
            title={t('explore.startTooltip')}
            className="group flex items-center gap-2.5 pl-2 pr-4 py-1.5 rounded-full bg-white/95 dark:bg-slate-900/95 hover:bg-sky-50 dark:hover:bg-slate-800 border border-slate-200/90 dark:border-slate-700/90 hover:border-sky-300 dark:hover:border-sky-700 shadow-xl backdrop-blur-md transition-all duration-200 hover:scale-[1.03] active:scale-95 cursor-pointer select-none"
          >
            <span className="flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 shadow-md group-hover:shadow-sky-500/40 transition-shadow">
              <Play className="w-3.5 h-3.5 text-white fill-white translate-x-px" />
            </span>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 group-hover:text-sky-700 dark:group-hover:text-sky-300 transition-colors">
              {t('explore.start')}
            </span>
          </button>
        </div>
      )}

      {/* Exploration mode — floating navigation HUD (kept LTR: canvas time always flows left → right) */}
      {isExploring && (
        <div
          dir="ltr"
          className="absolute bottom-5 -translate-x-1/2 z-20 flex items-center gap-1 pl-1.5 pr-1.5 py-1.5 rounded-full bg-white/95 dark:bg-slate-900/95 border border-slate-200/90 dark:border-slate-700/90 shadow-2xl backdrop-blur-md select-none transition-[left] duration-300 animate-in fade-in slide-in-from-bottom-3"
          style={{ left: exploreOverlayLeft }}
          title={t('explore.keyboardHint')}
        >
          <button
            type="button"
            onClick={onExitExplore}
            title={`${t('explore.exit')} (Esc)`}
            aria-label={t('explore.exit')}
            className="p-1.5 rounded-full text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <button
            type="button"
            onClick={onExplorePrev}
            disabled={!exploreProgress || exploreProgress.current <= 1}
            title={`${t('explore.prev')} (←)`}
            aria-label={t('explore.prev')}
            className="p-1.5 rounded-full text-slate-600 dark:text-slate-300 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-slate-600 dark:disabled:hover:text-slate-300"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 px-2 min-w-0">
            <span className="text-[11px] font-bold tabular-nums text-sky-600 dark:text-sky-400 whitespace-nowrap">
              {exploreProgress ? `${exploreProgress.current} / ${exploreProgress.total}` : ''}
            </span>
            {exploreCurrentTitle && (
              <>
                <span className="h-3.5 w-px bg-slate-200 dark:bg-slate-700 shrink-0" />
                <span
                  key={selectedArticleId}
                  className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate max-w-[220px] animate-in fade-in duration-300"
                >
                  {exploreCurrentTitle}
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onExploreNext}
            disabled={!exploreProgress || exploreProgress.current >= exploreProgress.total}
            title={`${t('explore.next')} (→)`}
            aria-label={t('explore.next')}
            className="p-1.5 rounded-full bg-sky-500 hover:bg-sky-600 text-white shadow-md shadow-sky-500/30 transition-all cursor-pointer active:scale-90 disabled:opacity-30 disabled:cursor-default disabled:hover:bg-sky-500 disabled:active:scale-100"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
});

TimelineView.displayName = 'TimelineView';
export default TimelineView;

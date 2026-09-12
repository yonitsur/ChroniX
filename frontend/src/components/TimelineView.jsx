import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback, useMemo } from 'react';
import { Timeline, Article } from 'histropediajs';
import { ChevronLeft, ChevronRight, Plus, Minus } from 'lucide-react';
import { getLaneColor, isColorLight, DEFAULT_LANE_COLORS, getDistinctCategories, getCategoryColor, getTimelineDisplayColor, CATEGORY_PALETTE } from '../data/laneColors';
import { useLanguage } from '../context/LanguageContext';
import { FEATURE_FLAGS } from '../featureFlags';

// Order-insensitive equality for filter id lists. Used to bail out of state
// updates when the incoming selection matches the current one, which prevents
// the two-way sync between `activeFilterIds` and the parent's `activeFilter`
// prop from ping-ponging into an infinite render loop.
function sameIdSet(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  const set = new Set(a);
  for (const id of b) {
    if (!set.has(id)) return false;
  }
  return true;
}

// Equality helper for article IDs that gracefully handles string vs number comparisons
export function isSameArticleId(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

// Reimplement Article.prototype.drawPeriodLinesAndConnectors so the period line and connector line
// are semi-transparent in the normal state (100% solid when hovered/selected/active), while the arrow
// triangle at the card is always filled opaquely — otherwise the connector line shows through it.
if (typeof window !== 'undefined' && Article) {
  if (!Article.prototype._originalChroniXDrawPeriodLinesAndConnectors) {
    Article.prototype._originalChroniXDrawPeriodLinesAndConnectors = Article.prototype.drawPeriodLinesAndConnectors;
  }
  Article.prototype.drawPeriodLinesAndConnectors = function(ctx, axisY) {
    const selectedId = this.owner?._selectedArticleId;
    const isSelected = selectedId ? isSameArticleId(this.id, selectedId) : false;
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

  if (!Article.prototype._originalChroniXUpdateVisibility) {
    Article.prototype._originalChroniXUpdateVisibility = Article.prototype.updateVisibility;
  }
  Article.prototype.updateVisibility = function() {
    Article.prototype._originalChroniXUpdateVisibility.call(this);
    const selectedId = this.owner?._selectedArticleId;
    const isSelected = selectedId ? isSameArticleId(this.id, selectedId) : false;
    if ((this.isActive || isSelected) && !this.isHiddenByFilter && this.isVisibleInLane !== false) {
      this.isVisible = true;
      this.isVisibleAfterFade = true;
      this.opacity = 1;
    }
  };

  Article.prototype._hasChroniXAlphaPatch = true;
}

// Patch Timeline methods so that any selected article (_selectedArticleId) is guaranteed
// to be marked active, kept visible, and positioned at the top of the render stack (bringFront)
// even across automatic stacking, row sorting, and frame renders.
if (typeof window !== 'undefined' && Timeline) {
  if (!Timeline.prototype._originalChroniXGetArticleById) {
    Timeline.prototype._originalChroniXGetArticleById = Timeline.prototype.getArticleById;
  }
  Timeline.prototype.getArticleById = function(id) {
    if (id == null) return undefined;
    if (Array.isArray(this.articles)) {
      const found = this.articles.find((a) => a && isSameArticleId(a.id, id));
      if (found) return found;
    }
    return Timeline.prototype._originalChroniXGetArticleById.call(this, id);
  };

  if (!Timeline.prototype._originalChroniXHasArticle) {
    Timeline.prototype._originalChroniXHasArticle = Timeline.prototype.hasArticle;
  }
  Timeline.prototype.hasArticle = function(id) {
    if (id == null) return false;
    return Boolean(this.getArticleById(id));
  };

  if (!Timeline.prototype._originalChroniXBringFront) {
    Timeline.prototype._originalChroniXBringFront = Timeline.prototype.bringFront;
  }
  Timeline.prototype.bringFront = function(articleId) {
    if (articleId != null && Array.isArray(this.articles)) {
      const index = this.articles.findIndex((item) => item && isSameArticleId(item.id, articleId));
      if (index >= 0) {
        const item = this.articles.splice(index, 1)[0];
        this.articles.push(item);
        return;
      }
    }
    Timeline.prototype._originalChroniXBringFront.call(this, articleId);
  };

  if (!Timeline.prototype._originalChroniXSelect) {
    Timeline.prototype._originalChroniXSelect = Timeline.prototype.select;
  }
  Timeline.prototype.select = function(articleId) {
    this._selectedArticleId = articleId;
    if (Array.isArray(this.articles)) {
      for (let i = 0; i < this.articles.length; i++) {
        const a = this.articles[i];
        if (a) a.isActive = isSameArticleId(a.id, articleId);
      }
      this.bringFront(articleId);
    }
    const previousActive = this.getActiveArticle();
    this.updateIsActiveStatus();
    const newActive = this.getActiveArticle();
    if (newActive !== previousActive && newActive) {
      this.trigger("article-select", newActive);
    }
    this._emitTimelineStateChange();
  };

  if (!Timeline.prototype._originalChroniXGetActiveArticle) {
    Timeline.prototype._originalChroniXGetActiveArticle = Timeline.prototype.getActiveArticle;
  }
  Timeline.prototype.getActiveArticle = function() {
    if (this._selectedArticleId) {
      const art = this.getArticleById(this._selectedArticleId);
      if (art && art.isDataLoaded) {
        return art;
      }
    }
    return Timeline.prototype._originalChroniXGetActiveArticle.call(this);
  };

  if (!Timeline.prototype._originalChroniXUpdateIsActiveStatus) {
    Timeline.prototype._originalChroniXUpdateIsActiveStatus = Timeline.prototype.updateIsActiveStatus;
  }
  Timeline.prototype.updateIsActiveStatus = function() {
    if (this._selectedArticleId && Array.isArray(this.articles)) {
      let found = false;
      for (let i = 0; i < this.articles.length; i++) {
        const a = this.articles[i];
        const isTarget = a && isSameArticleId(a.id, this._selectedArticleId);
        if (a) a.isActive = isTarget;
        if (isTarget) found = true;
      }
      if (found) {
        this.bringFront(this._selectedArticleId);
        return;
      }
    }
    Timeline.prototype._originalChroniXUpdateIsActiveStatus.call(this);
  };

  if (!Timeline.prototype._originalChroniXStack) {
    Timeline.prototype._originalChroniXStack = Timeline.prototype.stack;
  }
  Timeline.prototype.stack = function(drawCycleContext) {
    if (this._selectedArticleId && Array.isArray(this.articles)) {
      const selId = this._selectedArticleId;
      for (let i = 0; i < this.articles.length; i++) {
        const a = this.articles[i];
        if (a) {
          const isTarget = isSameArticleId(a.id, selId);
          a.isActive = isTarget;
          if (isTarget) {
            a.isVisibleInGroup = true;
            a.isVisibleInRows = true;
            a.isVisible = true;
            a.isVisibleAfterFade = true;
          }
        }
      }
    }
    Timeline.prototype._originalChroniXStack.call(this, drawCycleContext);
    if (this._selectedArticleId) {
      this.bringFront(this._selectedArticleId);
    }
  };

  if (!Timeline.prototype._originalChroniXRedraw) {
    Timeline.prototype._originalChroniXRedraw = Timeline.prototype.redraw;
  }
  Timeline.prototype.redraw = function(callbacks) {
    if (this._selectedArticleId && Array.isArray(this.articles)) {
      const selId = this._selectedArticleId;
      for (let i = 0; i < this.articles.length; i++) {
        const a = this.articles[i];
        if (a) {
          const isTarget = isSameArticleId(a.id, selId);
          a.isActive = isTarget;
          if (isTarget) {
            a.isVisibleInGroup = true;
            a.isVisibleInRows = true;
            if (!a.isHiddenByFilter && a.isVisibleInLane !== false) {
              a.isVisible = true;
              a.isVisibleAfterFade = true;
              a.opacity = 1;
              if (a.fadeAnimation?.dummyElement?.stop) {
                a.fadeAnimation.dummyElement.stop();
                a.isFading = false;
              }
            }
          }
        }
      }
    }
    Timeline.prototype._originalChroniXRedraw.call(this, callbacks);
  };

  if (!Timeline.prototype._originalChroniXRender) {
    Timeline.prototype._originalChroniXRender = Timeline.prototype.render;
  }
  Timeline.prototype.render = function(ctx, top, width, markers, drawCycleContext) {
    if (this._selectedArticleId && Array.isArray(this.articles)) {
      const selId = this._selectedArticleId;
      let found = false;
      for (let i = 0; i < this.articles.length; i++) {
        const a = this.articles[i];
        if (a) {
          const isTarget = isSameArticleId(a.id, selId);
          a.isActive = isTarget;
          if (isTarget) {
            if (!a.isHiddenByFilter && a.isVisibleInLane !== false) {
              a.isVisible = true;
              a.isVisibleAfterFade = true;
              a.opacity = 1;
            }
            found = true;
          }
        }
      }
      if (found) {
        this.bringFront(this._selectedArticleId);
      }
    }
    Timeline.prototype._originalChroniXRender.call(this, ctx, top, width, markers, drawCycleContext);

    // Hard guarantee: active article is always drawn on the topmost layer of canvas
    if (this._selectedArticleId) {
      const active = this.getActiveArticle();
      if (active && active.isDataLoaded && !active.isHiddenByFilter && active.isVisibleInLane !== false) {
        active.isVisible = true;
        active.drawPeriodLinesAndConnectors(ctx, top);
        active.draw(ctx);
      }
    }
  };
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

function resolveArticleLaneColor(laneIdentifier, lanes = [], articleIndex = 0, isDark = false) {
  let baseColor = null;
  if (!laneIdentifier && lanes.length > 0) {
    baseColor = getLaneColor(lanes[0], 0, lanes);
  } else if (laneIdentifier && lanes.length > 0) {
    const str = String(laneIdentifier).toLowerCase().trim();
    const foundIdx = lanes.findIndex(
      (l) =>
        String(l.id).toLowerCase() === str ||
        String(l.title || '').toLowerCase() === str
    );
    if (foundIdx >= 0) {
      baseColor = getLaneColor(lanes[foundIdx], foundIdx, lanes);
    }
  }
  if (!baseColor) {
    baseColor = CATEGORY_PALETTE[articleIndex % CATEGORY_PALETTE.length];
  }
  return isDark ? getTimelineDisplayColor(baseColor, true) : baseColor;
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

// Height (px) of the narrow-screen scrubber strip reserved below the canvas.
const SCRUBBER_H = 68;

// Format a decimal year as a compact era-aware label for the scrubber date readout.
const formatScrubberYear = (v) => {
  const y = Math.round(v);
  if (y < 0) return `${Math.abs(y).toLocaleString()} BCE`;
  if (y < 1000) return `${y} CE`;
  return y.toLocaleString();
};

// Narrow-screen navigation bar shown in place of the desktop pan arrows. It's a
// "viewport window" scrubber: the thumb spans the currently-visible slice of the
// whole data range (so its WIDTH communicates zoom and its POSITION communicates
// where you are), with a live date readout and fixed +/- zoom buttons. The timeline
// wrapper is always dir="ltr" (time flows left→right regardless of UI language), so
// no RTL mirroring is needed here. histropediajs exposes only date→pixel (getPixel),
// so pixel→date is recovered by bisection against the current transform.
function TimelineScrubberBar({ timelineRef, range, syncRef, className = '' }) {
  const trackRef = useRef(null);
  const rafRef = useRef(null);
  const dragRef = useRef({ active: false, pointerId: null });
  const [thumb, setThumb] = useState({ start: 0, end: 1 });
  const [dragging, setDragging] = useState(false);
  const thumbRef = useRef(thumb);
  thumbRef.current = thumb;

  const pixelAt = useCallback((tl, v) => {
    try { return tl.getPixel(tl.getDmyFromInput(decimalToDmy(v))); } catch { return NaN; }
  }, []);

  // Invert getPixel (monotonic in date) to find the decimal year at a canvas x.
  const yearAtPixel = useCallback((tl, targetPx) => {
    let a = range.lo, b = range.hi;
    for (let i = 0; i < 30; i++) {
      const mid = (a + b) / 2;
      const px = pixelAt(tl, mid);
      if (!Number.isFinite(px)) break;
      if (px < targetPx) a = mid; else b = mid;
    }
    return (a + b) / 2;
  }, [range, pixelAt]);

  const sync = useCallback(() => {
    if (dragRef.current.active) return; // don't fight an in-progress drag
    const tl = timelineRef.current;
    if (!tl) return;
    const width = tl.width || tl.canvas?.width || 0;
    const span = range.hi - range.lo;
    if (!width || !(span > 0)) return;
    let s = (yearAtPixel(tl, 0) - range.lo) / span;
    let e = (yearAtPixel(tl, width) - range.lo) / span;
    s = Math.max(0, Math.min(1, s));
    e = Math.max(0, Math.min(1, e));
    if (e < s) { const t = s; s = e; e = t; }
    setThumb((prev) => (Math.abs(prev.start - s) < 0.001 && Math.abs(prev.end - e) < 0.001 ? prev : { start: s, end: e }));
  }, [range, yearAtPixel, timelineRef]);

  // Register a rAF-throttled sync callback into the parent's ref so the timeline's
  // 'timeline-render-end' event (fired on every pan/zoom/fit) keeps the thumb in step.
  useEffect(() => {
    const throttled = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => { rafRef.current = null; sync(); });
    };
    syncRef.current = throttled;
    throttled();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (syncRef.current === throttled) syncRef.current = null;
    };
  }, [sync, syncRef]);

  // Pan the timeline so the given fraction of the data range sits at canvas centre.
  const panToFraction = useCallback((frac) => {
    const tl = timelineRef.current;
    if (!tl) return;
    const width = tl.width || 0;
    if (!width) return;
    const clamped = Math.max(0, Math.min(1, frac));
    const targetYear = range.lo + clamped * (range.hi - range.lo);
    const px = pixelAt(tl, targetYear);
    if (!Number.isFinite(px)) return;
    try {
      tl.updateFromByPixels(px - width / 2); // +px advances forward in time
      tl.requestRedraw();
    } catch { /* ignore during teardown */ }
  }, [range, pixelAt, timelineRef]);

  const fracFromClient = useCallback((clientX) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  }, []);

  const moveTo = useCallback((frac) => {
    const clamped = Math.max(0, Math.min(1, frac));
    setThumb((prev) => {
      const half = (prev.end - prev.start) / 2;
      return { start: clamped - half, end: clamped + half };
    });
    panToFraction(clamped);
  }, [panToFraction]);

  const onPointerDown = useCallback((e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const el = trackRef.current;
    if (!el) return;
    dragRef.current.active = true;
    dragRef.current.pointerId = e.pointerId;
    setDragging(true);
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    moveTo(fracFromClient(e.clientX));
  }, [fracFromClient, moveTo]);

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d.active || e.pointerId !== d.pointerId) return;
    moveTo(fracFromClient(e.clientX));
  }, [fracFromClient, moveTo]);

  const endDrag = useCallback(() => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    setDragging(false);
    requestAnimationFrame(() => syncRef.current?.());
  }, [syncRef]);

  // dir: -1 zooms in (lower zoom value = closer), +1 zooms out.
  const zoomStep = useCallback((dir) => {
    const tl = timelineRef.current;
    if (!tl) return;
    try {
      tl.setZoom(tl.getZoom() + dir * 0.9); // ~one scroll-wheel notch; self-clamps + repositions
      requestAnimationFrame(() => syncRef.current?.());
    } catch { /* ignore */ }
  }, [timelineRef, syncRef]);

  const widthPct = Math.max(7, (thumb.end - thumb.start) * 100);
  const leftPct = Math.max(0, Math.min(100 - widthPct, thumb.start * 100));
  const span = range.hi - range.lo;
  const startLabel = formatScrubberYear(range.lo + thumb.start * span);
  const endLabel = formatScrubberYear(range.lo + thumb.end * span);

  return (
    <div
      className={`pointer-events-auto absolute inset-x-0 bottom-0 flex flex-col justify-center gap-1 px-2.5 pb-[calc(env(safe-area-inset-bottom,0px)+6px)] pt-1.5 bg-surface-overlay/95 backdrop-blur-md border-t border-line shadow-panel z-30 ${className}`}
      style={{ height: `calc(${SCRUBBER_H}px + env(safe-area-inset-bottom, 0px))` }}
    >
      <div className="flex items-center gap-2">
        {/* Scrubber track (press or drag anywhere to navigate) */}
        <div
          ref={trackRef}
          role="slider"
          aria-label="Scrub the timeline. Drag to move through time; the highlighted band shows the visible range."
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(((thumb.start + thumb.end) / 2) * 100)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          className="relative h-7 flex-1 rounded-lg border border-line bg-surface-sunken"
          style={{ touchAction: 'none' }}
        >
          <div className="pointer-events-none absolute left-2 right-2 top-1/2 h-px -translate-y-1/2 bg-ink-faint/40" />
          <div
            className={`pointer-events-none absolute top-1/2 h-5 -translate-y-1/2 rounded-md border transition-colors ${dragging ? 'border-ink-muted bg-ink-muted/80' : 'border-ink-faint/70 bg-ink-faint/55'}`}
            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          >
            <span className="absolute left-1/2 top-1/2 h-2.5 w-4 -translate-x-1/2 -translate-y-1/2 grid grid-cols-3 gap-px opacity-60">
              <span className="bg-surface/80 rounded-full" />
              <span className="bg-surface/80 rounded-full" />
              <span className="bg-surface/80 rounded-full" />
            </span>
          </div>
        </div>
        {/* Fixed zoom controls (never shift position) */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => zoomStep(1)}
            className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface-sunken text-ink-muted transition-colors hover:bg-surface-hover active:scale-95"
          >
            <Minus className="h-4 w-4" strokeWidth={2.2} />
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => zoomStep(-1)}
            className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface-sunken text-ink-muted transition-colors hover:bg-surface-hover active:scale-95"
          >
            <Plus className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
      </div>
      {/* Visible date range readout */}
      <div className="flex items-center justify-between px-0.5 text-[10px] font-medium tabular-nums text-ink-subtle" dir="ltr">
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}

const TimelineView = forwardRef(({
  timelineData,
  onSelectArticle,
  onFocusArticle,
  selectedArticleId,
  starredArticleIds,
  filterStarredOnly = false,
  activeFilter = null,
  onToggleStar,
  theme = 'light',
  // Exploration mode (desktop): entry button + floating HUD are rendered only when these are provided
  isExploring = false,
  exploreProgress = null,
  onStartExplore,
  onExploreNext,
  onExplorePrev,
  onExitExplore,
  // Notified with (items, mode) whenever lane/theme filters change, so the geo map
  // and guided exploration stay in sync with the timeline's visible subset.
  onFilterChange,
  // Indicates if a right-side drawer (EventDrawer or CardsListDrawer) is currently open,
  // so the right pan arrow can move to the left of the drawer instead of being covered.
  hasRightDrawer = false,
  // On narrow/mobile viewports the desktop side pan arrows are hidden; the touch
  // jog/shuttle controls (pan + zoom) are shown instead when enabled by feature flag.
  isNarrowViewport = false,
  enableMobileScrubber = FEATURE_FLAGS.ENABLE_MOBILE_SCRUBBER,
}, ref) => {
  const { t, isRtl } = useLanguage();
  const containerRef = useRef(null);
  const timelineInstanceRef = useRef(null);
  const isNarrowViewportRef = useRef(isNarrowViewport);
  useEffect(() => {
    isNarrowViewportRef.current = isNarrowViewport;
  }, [isNarrowViewport]);
  const onFocusArticleRef = useRef(onFocusArticle);
  useEffect(() => {
    onFocusArticleRef.current = onFocusArticle;
  }, [onFocusArticle]);
  // Mobile two-tap-to-open: id of the event brought to the foreground by the first tap.
  // A second tap on that same event opens its details drawer.
  const mobileFocusedArticleIdRef = useRef(null);
  // Set when a long press has already opened the drawer, so the click fired on
  // release (if any) is ignored instead of being treated as a normal tap.
  const longPressConsumedRef = useRef(false);
  // Pending long-press timer for the current touch gesture.
  const longPressTimerRef = useRef(null);
  // Set by the narrow-screen scrubber bar so the timeline's render-end event can nudge it.
  const scrubberSyncRef = useRef(null);
  const starredArticleIdsRef = useRef(starredArticleIds);
  const panHighlightTimerRef = useRef(null);
  const [activePanDirection, setActivePanDirection] = useState(null);

  // Active lane/theme filters (empty = show all). State drives the filter UI;
  // refs let imperative + load handlers read the latest values without stale closures.
  const [activeFilterIds, setActiveFilterIds] = useState(
    () => activeFilter?.items?.map((item) => item.id) || []
  );
  const activeFiltersRef = useRef(activeFilter?.items || []);
  const filterModeRef = useRef(activeFilter?.mode || 'lane');
  const filterStarredOnlyRef = useRef(filterStarredOnly);

  useEffect(() => {
    starredArticleIdsRef.current = starredArticleIds;
  }, [starredArticleIds]);

  useEffect(() => () => {
    if (panHighlightTimerRef.current) clearTimeout(panHighlightTimerRef.current);
  }, []);

  const handleTimelinePan = useCallback((direction) => {
    const timeline = timelineInstanceRef.current;
    if (!timeline) return;

    const distance = Math.max(180, (containerRef.current?.clientWidth || 1000) * 0.32);
    timeline.goToPixelAnim(direction === 'left' ? -distance : distance, {
      duration: 420,
      easing: 'swing',
    });

    setActivePanDirection(direction);
    if (panHighlightTimerRef.current) clearTimeout(panHighlightTimerRef.current);
    panHighlightTimerRef.current = setTimeout(() => {
      setActivePanDirection(null);
      panHighlightTimerRef.current = null;
    }, 480);
  }, []);

  // Long-press support: holding a pan arrow keeps repeating the pan until released.
  const panHoldRef = useRef({ timeoutId: null, intervalId: null });

  const stopPanHold = useCallback(() => {
    const hold = panHoldRef.current;
    if (hold.timeoutId) {
      clearTimeout(hold.timeoutId);
      hold.timeoutId = null;
    }
    if (hold.intervalId) {
      clearInterval(hold.intervalId);
      hold.intervalId = null;
    }
  }, []);

  const startPanHold = useCallback((direction, event) => {
    if (event?.button !== undefined && event.button !== 0) return;
    try {
      event?.currentTarget?.setPointerCapture?.(event.pointerId);
    } catch {
      // ignore if pointer capture isn't supported
    }
    stopPanHold();
    handleTimelinePan(direction);
    // Wait one pan cycle before repeating, so a quick tap only pans once.
    panHoldRef.current.timeoutId = setTimeout(() => {
      panHoldRef.current.intervalId = setInterval(() => {
        handleTimelinePan(direction);
      }, 380);
    }, 420);
  }, [handleTimelinePan, stopPanHold]);

  useEffect(() => () => stopPanHold(), [stopPanHold]);

  // Full data date-range (decimal years, ±8% padding) that the narrow-screen scrubber
  // maps its thumb against. Null when there are no dated events or scrubber is disabled.
  const scrubberRange = useMemo(() => {
    if (!enableMobileScrubber) return null;
    const arts = timelineData?.articles || [];
    const vals = [];
    arts.forEach((a) => {
      const f = dateToDecimal(a.from);
      if (f !== null) vals.push(f);
      const to = dateToDecimal(a.to);
      if (to !== null) vals.push(to);
    });
    if (vals.length === 0) return null;
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi === lo) { lo -= 0.5; hi += 0.5; }
    const pad = (hi - lo) * 0.08;
    return { lo: lo - pad, hi: hi + pad };
  }, [timelineData, enableMobileScrubber]);

  const showScrubber = Boolean(enableMobileScrubber && isNarrowViewport && scrubberRange);

  // Legend / filter items: by event theme in single timelines, by lane in split ones.
  // Computed here (rather than near the render) so the imperative `setLegendFilter`
  // handle below can look items up by id for external controls (e.g. the Toolbar).
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
        return {
          id: name,
          name,
          color: getCategoryColor(name, legendCategories),
          matchKeys: [name],
          count,
        };
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
        matchKeys,
        count,
      };
    });
  }, [useThemeMode, legendCategories, lanesArr, timelineData]);

  // Applies both the starred-only filter and the lane/theme filter to the
  // canvas via each article's `hiddenByFilter` option, then refits the view.
  const applyVisibilityFilters = useCallback(() => {
    const tl = timelineInstanceRef.current;
    if (!tl || !tl.articles) return;
    const starredOnly = filterStarredOnlyRef.current;
    const ids = starredArticleIdsRef.current || new Set();
    const selectedItems = activeFiltersRef.current;
    const mode = filterModeRef.current;

    tl.articles.forEach((art) => {
      let hidden = false;
      if (starredOnly && !ids.has(art.id)) hidden = true;
      if (!hidden && selectedItems.length > 0) {
        const value =
          mode === 'theme'
            ? (art.data?.category ?? art.category ?? '')
            : (art.data?.lane ?? art.lane);
        if (!selectedItems.some((item) => item.matchKeys.includes(value))) hidden = true;
      }
      art.setOption('hiddenByFilter', hidden);
    });

    // In split timelines, collapse the body of filtered-out lanes down to their
    // colored header stripe (fixed height) so the selected lane — left on auto
    // height — expands to absorb the freed space.
    if (mode === 'lane' && Array.isArray(tl.lanes)) {
      tl.lanes.forEach((lane) => {
        const isSelected = selectedItems.length === 0 || selectedItems.some((item) =>
          item.matchKeys.includes(lane.id) ||
          item.matchKeys.includes(lane.title) ||
          String(item.id) === String(lane.id)
        );
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

  // Restore selections supplied by App after a canvas/layout remount (such as the
  // split view entered for an interactive tour).
  useEffect(() => {
    const selectedIds = activeFilter?.items?.map((item) => item.id) || [];
    const selectedItems = filterItems.filter((item) => selectedIds.includes(item.id));
    activeFiltersRef.current = selectedItems;
    // `activeFilter` is derived from `activeFilterIds` (pushed out via onFilterChange),
    // so only sync back when the selection genuinely differs — otherwise returning the
    // previous reference lets React bail out and breaks the feedback loop.
    setActiveFilterIds((prev) => (sameIdSet(prev, selectedIds) ? prev : selectedIds));
    filterModeRef.current = activeFilter?.mode || (useThemeMode ? 'theme' : 'lane');
    applyVisibilityFilters();
  }, [activeFilter, filterItems, useThemeMode, applyVisibilityFilters]);

  useEffect(() => {
    filterStarredOnlyRef.current = filterStarredOnly;
    applyVisibilityFilters();
  }, [filterStarredOnly, applyVisibilityFilters]);

  const handleFilterSelect = (item) => {
    const nextItems = item
      ? activeFiltersRef.current.some((selected) => selected.id === item.id)
        ? activeFiltersRef.current.filter((selected) => selected.id !== item.id)
        : [...activeFiltersRef.current, item]
      : [];
    activeFiltersRef.current = nextItems;
    setActiveFilterIds(nextItems.map((selected) => selected.id));
  };

  // Re-apply whenever the active lane/theme selection changes.
  useEffect(() => {
    applyVisibilityFilters();
  }, [activeFilterIds, applyVisibilityFilters]);


  // Synchronize external selection with Histropedia canvas instance
  useEffect(() => {
    const tl = timelineInstanceRef.current;
    if (tl) {
      tl._selectedArticleId = selectedArticleId || null;
      if (selectedArticleId) {
        try {
          if (tl.articles) {
            tl.articles.forEach((a) => {
              a.isActive = isSameArticleId(a.id, selectedArticleId);
            });
          }
          tl.select(selectedArticleId);
          tl.bringFront(selectedArticleId);
        } catch (e) {
          // ignore
        }
      } else {
        if (tl.articles) {
          tl.articles.forEach((a) => {
            a.isActive = false;
          });
        }
        mobileFocusedArticleIdRef.current = null;
      }
      tl.redraw();
    }
  }, [selectedArticleId]);

  useImperativeHandle(ref, () => ({
    clearMobileFocus: () => {
      mobileFocusedArticleIdRef.current = null;
    },
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
      mobileFocusedArticleIdRef.current = articleId;
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
            const dataArt = dataArts.find((a) => isSameArticleId(a.id, articleId));
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
            const date = art.from || art.data?.from || art.period?.from;
            if (date) {
              try {
                const canvasW = containerRef.current?.clientWidth || 0;
                const targetPad = canvasW > 760 ? Math.max(100, (canvasW - 420) / 2) : canvasW / 2;
                tl.setStartDate(date, {
                  padding: targetPad,
                  animation: { active: true, duration: 420, easing: 'swing' }
                });
              } catch (e) {
                try {
                  tl.setCentreDate(date);
                } catch (err) {}
              }
            }
          }
          try {
            if (tl.articles) {
              tl.articles.forEach((a) => {
                a.isActive = isSameArticleId(a.id, articleId);
              });
            }
            tl.select(articleId);
            tl.bringFront(articleId);
          } catch (e) {
            // ignore
          }
          tl.redraw();

          setTimeout(() => {
            const currentTl = timelineInstanceRef.current;
            if (currentTl && isSameArticleId(currentTl._selectedArticleId, articleId)) {
              try {
                currentTl.bringFront(articleId);
                const a = currentTl.getArticleById(articleId);
                if (a) a.isActive = true;
                currentTl.redraw();
              } catch (e) {}
            }
          }, opts.animate ? 640 : 450);
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
    // Toggles a lane/theme filter from an external control.
    setLegendFilter: (itemId) => {
      const item = itemId ? (filterItems.find((f) => f.id === itemId) || null) : null;
      handleFilterSelect(item);
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
      backgroundColor: isDark ? '#141417' : '#ffffff',
      color: isDark ? '#18181b' : '#f4f4f5',
      topRadius: 6,
      borderRadius: 6,
      border: {
        color: isDark ? '#52525b' : '#cbd5e1',
        width: 1,
      },
      header: {
        height: 50,
        text: {
          font: "600 13px 'Plus Jakarta Sans', Heebo, system-ui, sans-serif",
          color: isDark ? '#f4f4f5' : '#09090b',
          margin: 10,
          lineHeight: 18,
          numberOfLines: 2,
        }
      },
      subheader: {
        height: 26,
        color: isDark ? '#1a1a1e' : '#e4e4e7',
        text: {
          font: "500 11px 'Plus Jakarta Sans', Heebo, system-ui, sans-serif",
          color: isDark ? '#a1a1aa' : '#71717a',
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
        thickness: 1,
        color: isDark ? '#3f3f46' : '#94a3b8',
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
              color: isDark ? '#a1a1aa' : '#71717a',
              font: "500 11px 'Plus Jakarta Sans', Heebo, system-ui, sans-serif",
            },
            major: {
              color: isDark ? '#f4f4f5' : '#09090b',
              font: "700 13px 'Plus Jakarta Sans', Heebo, system-ui, sans-serif",
            }
          },
          marker: {
            minor: {
              height: 12,
              color: isDark ? '#71717a' : '#a1a1aa',
            },
            major: {
              height: 24,
              color: isDark ? '#a1a1aa' : '#52525b',
            }
          }
        },
        lane: {
          visible: true,
          gap: 2,
          axisGap: 2,
          defaultStyle: {
            header: {
              backgroundColor: isDark ? 'rgba(24, 24, 27, 0.95)' : 'rgba(244, 244, 245, 0.95)',
            },
            body: {
              backgroundColor: isDark ? 'rgba(18, 18, 20, 0.45)' : 'rgba(240, 240, 242, 0.6)',
              borderColor: isDark ? 'rgba(39, 39, 42, 0.6)' : 'rgba(228, 228, 231, 0.8)',
            },
            title: {
              color: isDark ? '#f4f4f5' : '#18181b',
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
            backgroundColor: isDark ? '#1c1c20' : '#ffffff',
            border: {
              width: 1.8,
            },
            shadow: {
              x: 0,
              y: 6,
              amount: 14,
              color: isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.16)',
            }
          },
          defaultActiveStyle: {
            backgroundColor: isDark ? '#27272a' : '#f4f4f5',
            border: {
              width: 2.5,
            }
          },
          layoutStyles: {
            landscape: {
              style: {
                header: {
                  text: {
                    color: isDark ? '#f4f4f5' : '#09090b',
                  }
                },
                subheader: {
                  text: {
                    color: isDark ? '#a1a1aa' : '#71717a',
                  }
                }
              },
              hoverStyle: {
                header: {
                  text: {
                    color: isDark ? '#f4f4f5' : '#09090b',
                  }
                }
              },
              activeStyle: {
                header: {
                  text: {
                    color: isDark ? '#f4f4f5' : '#09090b',
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
            const textColor = isLight ? '#09090b' : '#ffffff';

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
                  backgroundColor: isDark ? 'rgba(28, 28, 32, 0.55)' : 'rgba(240, 240, 242, 0.6)',
                  borderColor: isDark ? 'rgba(60, 60, 68, 0.7)' : 'rgba(228, 228, 231, 0.8)',
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
        if (!color) return isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)';
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
                color: isDark ? '#f4f4f5' : '#71717a',
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

        const formattedArticles = timelineData.articles.map((art, artIdx) => {
          let cat = art.category;
          if (typeof cat === 'object' && cat !== null) {
            cat = cat.en || cat.he || Object.values(cat)[0] || '';
          }
          if (!cat) {
            cat = art.categoryKey || art.theme || '';
          }

          let laneColor;
          if (colorByTheme && cat) {
            laneColor = getCategoryColor(cat, themeCategories, isDark);
          } else if (timelineData.lanes && timelineData.lanes.length > 1) {
            const raw = resolveArticleLaneColor(art.lane, timelineData.lanes, artIdx, false);
            laneColor = isDark ? getTimelineDisplayColor(raw, true) : raw;
          } else if (cat) {
            laneColor = getCategoryColor(cat, themeCategories, isDark);
          } else {
            // Distribute across category palette so events have distinct colors
            const raw = CATEGORY_PALETTE[artIdx % CATEGORY_PALETTE.length];
            laneColor = isDark ? getTimelineDisplayColor(raw, true) : raw;
          }

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
              color: isDark ? '#141417' : '#ffffff',
              border: {
                color: laneColor,
                width: 1,
              },
              connectorLine: {
                ...articleStyle.connectorLine,
                color: laneColor,
                thickness: 1,
              }
            },
            hoverStyle: {
              ...articleStyle,
              color: isDark ? '#1c1c20' : '#ffffff',
              backgroundColor: isDark ? '#1c1c20' : '#ffffff',
              border: {
                color: laneColor,
                width: 1.8,
              },
              shadow: {
                x: 0,
                y: 6,
                amount: 14,
                color: isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.16)',
              },
              connectorLine: {
                ...articleStyle.connectorLine,
                color: laneColor,
                thickness: 1.8,
              }
            },
            activeStyle: {
              ...articleStyle,
              color: isDark ? '#27272a' : '#f4f4f5',
              backgroundColor: isDark ? '#27272a' : '#f4f4f5',
              border: {
                color: laneColor,
                width: 2.5,
              },
              shadow: {
                x: 0,
                y: 8,
                amount: 18,
                color: isDark ? 'rgba(0, 0, 0, 0.8)' : 'rgba(0, 0, 0, 0.22)',
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

        // Filters are controlled by App and must survive canvas/layout remounts.
        applyVisibilityFilters();

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
      timeline.on('article-click', (article, evt) => {
        // A long press already opened the drawer for this gesture; ignore the
        // click that fires on release so we don't reprocess it as a tap.
        if (longPressConsumedRef.current) {
          longPressConsumedRef.current = false;
          return;
        }

        const clickedId = article?.id || article?.data?.id;
        if (!clickedId) return;

        // If the user clicked specifically on the star icon on canvas
        if (article.isMouseOverStar) {
          onToggleStar?.(clickedId, article.isStarred);
          return;
        }

        if (timelineInstanceRef.current) {
          timelineInstanceRef.current._selectedArticleId = clickedId;
          try {
            if (timelineInstanceRef.current.articles) {
              timelineInstanceRef.current.articles.forEach((a) => {
                a.isActive = isSameArticleId(a.id, clickedId);
              });
            }
            timelineInstanceRef.current.bringFront(clickedId);
          } catch (e) {}
          timelineInstanceRef.current.redraw();
        }

        // Mobile: the first tap brings the event to the foreground and focuses the map
        // on its pin; a second tap on that same event opens the details drawer.
        // A long press (handled separately) opens it directly.
        if (isNarrowViewportRef.current) {
          const alreadyFocused = isSameArticleId(mobileFocusedArticleIdRef.current, clickedId);
          mobileFocusedArticleIdRef.current = clickedId;
          if (!alreadyFocused) {
            const original = timelineData?.articles?.find((a) => isSameArticleId(a.id, clickedId));
            onFocusArticleRef.current?.(original || article.data || article);
            return;
          }
        }

        if (onSelectArticle) {
          const original = timelineData.articles?.find((a) => isSameArticleId(a.id, clickedId));
          onSelectArticle(original || article.data || article, { fromUserClick: true });
        }
      });

      // Event listener for timeline background clicks (deselection)
      timeline.on('timeline-click', () => {
        // On mobile / narrow screens, touching or swiping the background to pan must not clear
        // the selected event. As per user specification, the event stays in focus until another event is clicked.
        if (isNarrowViewportRef.current) {
          return;
        }

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

      // Keep the narrow-screen scrubber thumb in step with any pan/zoom/fit.
      timeline.on('timeline-render-end', () => {
        scrubberSyncRef.current?.();
      });

    } catch (err) {
      console.error('Histropedia initialization failed:', err);
    }

    // Long-press to open the event drawer directly on touch devices. This runs
    // alongside the two-tap-to-focus behavior: a sustained press on an event
    // skips the "bring to foreground first" step and opens its details at once.
    const LONG_PRESS_MS = 500;
    const LONG_PRESS_MOVE_TOLERANCE = 12;
    const canvasEl = timelineInstanceRef.current?.canvas || null;
    let longPressStart = null;

    const clearLongPressTimer = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };

    const findArticleAtPoint = (clientX, clientY) => {
      const tl = timelineInstanceRef.current;
      if (!tl || !tl.canvas || !Array.isArray(tl.articles)) return null;
      const rect = tl.canvas.getBoundingClientRect();
      const pos = { left: clientX - rect.left, top: clientY - rect.top };
      for (let i = tl.articles.length - 1; i >= 0; i--) {
        const a = tl.articles[i];
        if (a && a.isVisible && typeof a.isInside === 'function' && a.isInside(pos)) {
          return a;
        }
      }
      return null;
    };

    const onCanvasPointerDown = (e) => {
      clearLongPressTimer();
      longPressConsumedRef.current = false;
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      if (!isNarrowViewportRef.current) return;
      const { clientX, clientY } = e;
      longPressStart = { x: clientX, y: clientY };
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        const hit = findArticleAtPoint(clientX, clientY);
        if (!hit) return;
        const id = hit.id;
        longPressConsumedRef.current = true;
        mobileFocusedArticleIdRef.current = id;
        const tl = timelineInstanceRef.current;
        if (tl) {
          tl._selectedArticleId = id;
          try {
            if (tl.articles) {
              tl.articles.forEach((a) => {
                a.isActive = isSameArticleId(a.id, id);
              });
            }
            tl.bringFront(id);
          } catch (err2) {}
          tl.redraw();
        }
        if (onSelectArticle) {
          const original = timelineData.articles?.find((a) => isSameArticleId(a.id, id));
          onSelectArticle(original || hit.data || hit, { fromUserClick: true });
        }
      }, LONG_PRESS_MS);
    };

    const onCanvasPointerMove = (e) => {
      if (!longPressTimerRef.current || !longPressStart) return;
      if (
        Math.abs(e.clientX - longPressStart.x) > LONG_PRESS_MOVE_TOLERANCE ||
        Math.abs(e.clientY - longPressStart.y) > LONG_PRESS_MOVE_TOLERANCE
      ) {
        clearLongPressTimer();
      }
    };

    const onCanvasPointerUp = () => {
      clearLongPressTimer();
      longPressStart = null;
    };

    if (canvasEl) {
      canvasEl.addEventListener('pointerdown', onCanvasPointerDown);
      canvasEl.addEventListener('pointermove', onCanvasPointerMove);
      canvasEl.addEventListener('pointerup', onCanvasPointerUp);
      canvasEl.addEventListener('pointercancel', onCanvasPointerUp);
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
      clearLongPressTimer();
      if (canvasEl) {
        canvasEl.removeEventListener('pointerdown', onCanvasPointerDown);
        canvasEl.removeEventListener('pointermove', onCanvasPointerMove);
        canvasEl.removeEventListener('pointerup', onCanvasPointerUp);
        canvasEl.removeEventListener('pointercancel', onCanvasPointerUp);
      }
      timelineInstanceRef.current = null;
      container.innerHTML = '';
    };
  }, [timelineData, theme]);

  // Keep the geo map's pin filters synchronized with the timeline selection.
  useEffect(() => {
    const mode = useThemeMode ? 'theme' : 'lane';
    const items = filterItems.filter((item) => activeFilterIds.includes(item.id));
    onFilterChange?.(items, mode);
  }, [activeFilterIds, filterItems, useThemeMode, onFilterChange]);

  return (
    <div
      dir="ltr"
      className="w-full h-full relative overflow-hidden bg-surface-sunken select-none transition-colors duration-200 histropedia-timeline-wrapper"
    >
      <div
        ref={containerRef}
        id="histropedia-container"
        dir="ltr"
        className="absolute inset-0"
        style={{
          touchAction: 'none',
          bottom: showScrubber ? `calc(${SCRUBBER_H}px + env(safe-area-inset-bottom, 0px))` : 0,
        }}
      />
      {[
        { direction: 'left', label: 'Move timeline left', Icon: ChevronLeft, positionClass: 'left-16 top-1/2' },
        {
          direction: 'right',
          label: 'Move timeline right',
          Icon: ChevronRight,
          positionClass: hasRightDrawer
            ? 'right-2 sm:right-[396px] md:right-[432px] top-1/2'
            : 'right-2 top-1/2',
        },
      ].map(({ direction, label, Icon, positionClass }) => (
        <button
          key={direction}
          type="button"
          aria-label={label}
          title={label}
          onPointerDown={(e) => startPanHold(direction, e)}
          onPointerUp={stopPanHold}
          onPointerLeave={stopPanHold}
          onPointerCancel={stopPanHold}
          className={`absolute ${positionClass} z-20 hidden h-16 w-8 -translate-y-1/2 items-center justify-center rounded-md border border-ink/10 bg-surface/10 text-ink-muted opacity-10 shadow-sm backdrop-blur-[1px] transition-[opacity,background-color,border-color,transform,right] duration-300 ease-in-out hover:border-ink/25 hover:bg-surface/70 hover:opacity-70 focus-visible:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring/60 active:scale-95 active:bg-surface/90 active:!opacity-100 md:flex ${
            activePanDirection === direction ? 'border-accent-ring/40 !bg-surface/90 !opacity-100' : ''
          }`}
        >
          <Icon className="h-6 w-6" strokeWidth={1.6} />
        </button>
      ))}
      {showScrubber && (
        <TimelineScrubberBar
          timelineRef={timelineInstanceRef}
          range={scrubberRange}
          syncRef={scrubberSyncRef}
          className="md:hidden"
        />
      )}
    </div>
  );
});

TimelineView.displayName = 'TimelineView';
export default TimelineView;

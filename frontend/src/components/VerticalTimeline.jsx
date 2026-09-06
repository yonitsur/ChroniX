import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { ZoomIn, ZoomOut, Maximize2, RotateCcw, Star, GripVertical, Calendar, Move } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { translations } from '../locales/translations';

/**
 * VerticalTimeline — a custom-built vertical timeline "graphics engine" for mobile.
 *
 * It replicates the Histropedia horizontal-axis interaction model on a vertical axis:
 *  - Continuous pinch-to-zoom anchored under the fingers (adaptive time scale)
 *  - Free 2D panning (vertical = time, horizontal = lane columns) with inertia
 *  - Adaptive ruler ticks: millennia → centuries → decades → years → months → days
 *  - Tap to select events, tap empty space to deselect, double-tap to zoom in
 *  - Draggable event cards (via grip handle) with reset
 *  - Animated focus on externally-selected events
 *  - Period bars + anchor dots on per-lane date spines, era time bands, "now" line
 *
 * Rendering is virtualized: only content inside a ~3-viewport window around the
 * current view is rendered. Pure panning is done with direct transform writes
 * (zero React re-renders); re-renders happen only on zoom or window re-basing.
 */

/** Converts any ChroniX date object to a float decimal year (consistent app-wide mapping). */
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

function hexToRgba(hex, alpha = 0.6) {
  if (!hex) return `rgba(59, 130, 246, ${alpha})`;
  if (hex.startsWith('rgba') || hex.startsWith('hsla')) return hex;
  let clean = hex.replace('#', '');
  if (clean.length === 3) clean = clean.split('').map((c) => c + c).join('');
  if (clean.length === 6) {
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return hex;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Layout constants
const AXIS_W = 64;            // fixed ruler strip width
const LANE_HEADER_H = 30;     // sticky lane column header height
const SPINE_X = 14;           // per-column date spine offset from column start edge
const CARD_X = 38;            // card offset from column start edge
const CARD_END_PAD = 10;      // card inset from column far edge
const CARD_GAP = 14;          // vertical gap between stacked cards
const TOP_RESERVE = 48;       // px reserved above the first event when fitting
const BOTTOM_RESERVE = 130;   // px reserved below (mobile nav bar) when fitting
const MAX_PX_PER_YEAR = 60000;

/** Picks a "nice" step (1/2/5 × 10^n) that is >= minYears. */
function niceStep(minYears) {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(minYears, 1e-12))));
  for (const m of [1, 2, 5, 10]) {
    if (m * pow >= minYears) return m * pow;
  }
  return 10 * pow;
}

const monthFrac = (m, d = 1) => (((m - 1) * 30) + (d - 1)) / 365;
const decYear = (y, m = 1, d = 1) => (y >= 0 ? y + monthFrac(m, d) : y - monthFrac(m, d));

/**
 * Adaptive ruler ticks for the visible window.
 * Returns [{ y (window px), label, kind: 'minor'|'major'|'strong' }]
 */
function generateTicks(winStart, winEnd, px, dict) {
  const ticks = [];
  const GUARD = 1200;
  const push = (dec, label, kind) => {
    if (dec < winStart - 0.5 / px || dec > winEnd + 0.5 / px) return;
    if (ticks.length >= GUARD) return;
    ticks.push({ y: (dec - winStart) * px, label, kind });
  };

  const months = dict.months || [];
  const fmtYear = (y) => {
    const abs = Math.abs(y);
    if (abs >= 1e6) {
      const ma = abs / 1e6;
      const s = ma % 1 === 0 ? ma.toFixed(0) : ma.toFixed(1);
      return y < 0 ? `${s}M ${dict.bce}` : `${s}M`;
    }
    const str = abs >= 10000 ? abs.toLocaleString() : String(abs);
    return y < 0 ? `${str} ${dict.bce}` : str;
  };

  const dayPx = px / 365;
  const monthPx = px * (30 / 365);
  const MIN_MAJOR = 54;
  const MIN_MINOR = 11;

  const yLo = Math.floor(winStart) - 1;
  const yHi = Math.ceil(winEnd) + 1;

  if (dayPx >= 30 || dayPx * 5 >= 30) {
    // ─── Day mode ───
    const dayStep = dayPx >= 30 ? 1 : 5;
    for (let y = yLo; y <= yHi; y++) {
      for (let m = 1; m <= 12; m++) {
        for (let d = 1; d <= 30; d += 1) {
          const isLabeled = dayStep === 1 || d % 5 === 1;
          if (!isLabeled && dayPx < MIN_MINOR) continue;
          const dec = decYear(y, m, d);
          if (d === 1) {
            push(dec, m === 1 ? fmtYear(y) : `${months[m - 1]}`, m === 1 ? 'strong' : 'major');
          } else if (isLabeled) {
            push(dec, `${d} ${months[m - 1]}`, 'major');
          } else {
            push(dec, null, 'minor');
          }
        }
      }
    }
  } else if (monthPx >= 40 || monthPx * 3 >= 40) {
    // ─── Month mode ───
    const monthStep = monthPx >= 40 ? 1 : 3;
    for (let y = yLo; y <= yHi; y++) {
      for (let m = 1; m <= 12; m++) {
        const dec = decYear(y, m, 1);
        if (m === 1) {
          push(dec, fmtYear(y), 'strong');
        } else if ((m - 1) % monthStep === 0) {
          push(dec, months[m - 1], 'major');
        } else if (monthPx >= MIN_MINOR) {
          push(dec, null, 'minor');
        }
      }
    }
  } else {
    // ─── Year mode (years → decades → centuries → millennia → deep time) ───
    const step = Math.max(1, niceStep(MIN_MAJOR / px));
    let minor = null;
    if (step === 1) {
      minor = monthPx >= MIN_MINOR ? 'months' : (px / 2 >= MIN_MINOR ? 0.5 : null);
    } else if ((step / 5) * px >= MIN_MINOR) {
      minor = step / 5;
    } else if ((step / 2) * px >= MIN_MINOR) {
      minor = step / 2;
    }

    const start = Math.floor(winStart / step) * step;
    const count = Math.min(GUARD, Math.ceil((winEnd - start) / step) + 2);
    for (let i = 0; i < count; i++) {
      const y = start + i * step;
      push(y, fmtYear(Math.round(y)), 'major');
      if (minor === 'months') {
        for (let m = 2; m <= 12; m++) push(decYear(Math.round(y), m, 1), null, 'minor');
      } else if (typeof minor === 'number') {
        for (let f = minor; f < step - minor / 2; f += minor) {
          push(y + f, null, 'minor');
        }
      }
    }
  }

  return ticks;
}

export default function VerticalTimeline({
  articles,          // processed: { ..., startYear, endYear, isRange, duration, laneIndex, laneInfo }
  displayLanes,      // [{ id, title, color, isLight, count }]
  minYear,
  maxYear,
  timeBands = [],
  fitKey,            // when this changes, the view re-fits to the data
  selectedArticleId,
  onSelectArticle,
  starredArticleIds,
  onToggleStar,
}) {
  const { t, isRtl, formatTimeSpan, language } = useLanguage();
  const dict = translations[language]?.dates || translations.en.dates;

  // ─── Refs: view state (single source of truth, mutated at 60fps) ───
  const viewRef = useRef({ topYear: minYear, pxPerYear: 1, panX: 0 });
  const viewportRef = useRef(null);
  const gridWorldRef = useRef(null);
  const axisWorldRef = useRef(null);
  const laneWorldRef = useRef(null);
  const laneHeaderRef = useRef(null);

  const sizeRef = useRef({ w: 360, h: 640 });
  const [size, setSize] = useState({ w: 360, h: 640 });
  const [sizeReady, setSizeReady] = useState(false);
  const boundsRef = useRef({ minYear, maxYear });
  boundsRef.current = { minYear, maxYear };
  const fitPxRef = useRef(1);
  const overflowPxRef = useRef(0);
  const laneDimsRef = useRef({ count: 1, colW: 300, visW: 300 });
  const isRtlRef = useRef(isRtl);
  isRtlRef.current = isRtl;

  const animRef = useRef(null);
  const renderRafRef = useRef(null);
  const didPanRef = useRef(false);
  const lastTapRef = useRef(null);
  const suppressFocusRef = useRef(null);
  const layoutIndexRef = useRef(new Map());
  const onSelectArticleRef = useRef(onSelectArticle);
  onSelectArticleRef.current = onSelectArticle;

  // ─── Render snapshot: the window of time currently rendered into the DOM ───
  const [snap, setSnap] = useState({ pxPerYear: 1, winStart: minYear, winEnd: minYear + 100 });
  const snapRef = useRef(snap);
  snapRef.current = snap;

  const [hoveredId, setHoveredId] = useState(null);
  const [zoomBadge, setZoomBadge] = useState(null);
  const zoomBadgeTimerRef = useRef(null);
  const [showHint, setShowHint] = useState(false);
  const [cardOffsets, setCardOffsets] = useState({});

  // ─── Derived layout dims ───
  const laneCount = Math.max(1, displayLanes.length);
  const visW = Math.max(120, size.w - AXIS_W);
  const colW = laneCount > 1 ? clamp(Math.round(visW * 0.86), 235, 360) : visW;
  const totalW = laneCount * colW;
  laneDimsRef.current = { count: laneCount, colW, visW, totalW };

  const span = Math.max(maxYear - minYear, 1e-9);
  const fitPx = Math.max((size.h - TOP_RESERVE - BOTTOM_RESERVE) / span, 1e-9);
  fitPxRef.current = fitPx;

  // Density-aware fit: enough px/year so stacked cards stay near their dates
  const densityPx = useMemo(() => {
    const laneHeights = new Map();
    for (const art of articles) {
      const h = (art.imageUrl ? 132 : (art.title || '').length > 32 ? 92 : 76) + CARD_GAP;
      const li = art.laneIndex ?? 0;
      laneHeights.set(li, (laneHeights.get(li) || 0) + h);
    }
    const maxH = Math.max(0, ...laneHeights.values());
    return (maxH * 0.85) / span;
  }, [articles, span]);
  const fitTargetPxRef = useRef(fitPx);
  fitTargetPxRef.current = clamp(Math.max(fitPx, densityPx), fitPx, MAX_PX_PER_YEAR);

  // ─── Core view helpers (stable identities, read refs only) ───
  const helpersRef = useRef({});
  helpersRef.current.clampPx = (px) => clamp(px, fitPxRef.current * 0.5, MAX_PX_PER_YEAR);

  helpersRef.current.clampView = () => {
    const v = viewRef.current;
    const { h } = sizeRef.current;
    const { minYear: lo0, maxYear: hi0 } = boundsRef.current;
    const vy = h / v.pxPerYear;
    let lo = lo0 - TOP_RESERVE / v.pxPerYear;
    let hi = hi0 + (BOTTOM_RESERVE + overflowPxRef.current) / v.pxPerYear - vy;
    if (hi < lo) {
      const mid = (lo + hi) / 2;
      lo = mid;
      hi = mid;
    }
    v.topYear = clamp(v.topYear, lo, hi);

    const { totalW: tw, visW: vw } = laneDimsRef.current;
    if (tw <= vw) {
      v.panX = 0;
    } else if (isRtlRef.current) {
      v.panX = clamp(v.panX, 0, tw - vw);
    } else {
      v.panX = clamp(v.panX, -(tw - vw), 0);
    }
  };

  helpersRef.current.syncTransforms = () => {
    const s = snapRef.current;
    const v = viewRef.current;
    const offY = -(v.topYear - s.winStart) * s.pxPerYear;
    const ty = `translate3d(0, ${offY.toFixed(2)}px, 0)`;
    if (gridWorldRef.current) gridWorldRef.current.style.transform = ty;
    if (axisWorldRef.current) axisWorldRef.current.style.transform = ty;
    if (laneWorldRef.current) {
      laneWorldRef.current.style.transform = `translate3d(${v.panX.toFixed(2)}px, ${offY.toFixed(2)}px, 0)`;
    }
    if (laneHeaderRef.current) {
      laneHeaderRef.current.style.transform = `translate3d(${v.panX.toFixed(2)}px, 0, 0)`;
    }
  };

  helpersRef.current.scheduleRender = () => {
    if (renderRafRef.current) return;
    renderRafRef.current = requestAnimationFrame(() => {
      renderRafRef.current = null;
      const v = viewRef.current;
      const vy = sizeRef.current.h / v.pxPerYear;
      setSnap({ pxPerYear: v.pxPerYear, winStart: v.topYear - vy, winEnd: v.topYear + vy * 2 });
    });
  };

  helpersRef.current.ensureWindow = () => {
    const v = viewRef.current;
    const s = snapRef.current;
    const vy = sizeRef.current.h / v.pxPerYear;
    if (
      s.pxPerYear !== v.pxPerYear ||
      v.topYear - vy * 0.3 < s.winStart ||
      v.topYear + vy * 1.3 > s.winEnd
    ) {
      helpersRef.current.scheduleRender();
    }
  };

  helpersRef.current.stopMotion = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = null;
  };

  helpersRef.current.showZoomBadge = (targetPx) => {
    if (zoomBadgeTimerRef.current) clearTimeout(zoomBadgeTimerRef.current);
    const px = targetPx || viewRef.current.pxPerYear;
    setZoomBadge(sizeRef.current.h / px);
    zoomBadgeTimerRef.current = setTimeout(() => setZoomBadge(null), 900);
  };

  /** Eased animation of view params. Zoom-target animations keep the anchor point fixed. */
  helpersRef.current.animateTo = (target, ms = 300, anchorViewY = null) => {
    const H = helpersRef.current;
    H.stopMotion();
    const v0 = { ...viewRef.current };
    const anchorYear = anchorViewY !== null ? v0.topYear + anchorViewY / v0.pxPerYear : null;
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const k = 1 - Math.pow(1 - p, 3);
      const v = viewRef.current;
      if (target.pxPerYear != null) {
        v.pxPerYear = v0.pxPerYear + (target.pxPerYear - v0.pxPerYear) * k;
        if (anchorYear !== null) v.topYear = anchorYear - anchorViewY / v.pxPerYear;
      }
      if (target.topYear != null && anchorYear === null) {
        v.topYear = v0.topYear + (target.topYear - v0.topYear) * k;
      }
      if (target.panX != null) v.panX = v0.panX + (target.panX - v0.panX) * k;
      H.clampView();
      H.syncTransforms();
      H.scheduleRender();
      if (p < 1) {
        animRef.current = requestAnimationFrame(step);
      } else {
        animRef.current = null;
      }
    };
    animRef.current = requestAnimationFrame(step);
  };

  helpersRef.current.zoomAt = (anchorViewY, factor, ms = 220) => {
    const H = helpersRef.current;
    const v = viewRef.current;
    const targetPx = H.clampPx(v.pxPerYear * factor);
    H.animateTo({ pxPerYear: targetPx }, ms, anchorViewY);
    H.showZoomBadge(targetPx);
  };

  helpersRef.current.fitAll = () => {
    const H = helpersRef.current;
    const px = H.clampPx(fitTargetPxRef.current);
    H.animateTo(
      { pxPerYear: px, topYear: boundsRef.current.minYear - TOP_RESERVE / px, panX: 0 },
      340
    );
    H.showZoomBadge(px);
  };

  helpersRef.current.startMomentum = (vx, vy) => {
    const H = helpersRef.current;
    H.stopMotion();
    let lastT = performance.now();
    let cvx = vx;
    let cvy = vy;
    const step = (now) => {
      const dt = Math.min(50, Math.max(1, now - lastT));
      lastT = now;
      const v = viewRef.current;
      const beforeTop = v.topYear;
      const beforePan = v.panX;
      v.topYear -= (cvy * dt) / v.pxPerYear;
      v.panX += cvx * dt;
      H.clampView();
      // Kill velocity on the axis that hit a boundary
      if (Math.abs(v.topYear - beforeTop) * v.pxPerYear < Math.abs(cvy * dt) * 0.4) cvy = 0;
      if (Math.abs(v.panX - beforePan) < Math.abs(cvx * dt) * 0.4) cvx = 0;
      const decay = Math.exp(-dt / 325);
      cvx *= decay;
      cvy *= decay;
      H.syncTransforms();
      H.ensureWindow();
      if (Math.abs(cvx) > 0.015 || Math.abs(cvy) > 0.015) {
        animRef.current = requestAnimationFrame(step);
      } else {
        animRef.current = null;
      }
    };
    animRef.current = requestAnimationFrame(step);
  };

  // ─── Resize observer ───
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          sizeRef.current = { w: width, h: height };
          setSize({ w: width, h: height });
          setSizeReady(true);
          helpersRef.current.clampView();
          helpersRef.current.syncTransforms();
          helpersRef.current.ensureWindow();
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ─── Initial fit (and re-fit when the dataset/filters change) ───
  const initKeyRef = useRef(null);
  useEffect(() => {
    if (!sizeReady || !articles.length) return;
    if (initKeyRef.current === fitKey) return;
    initKeyRef.current = fitKey;
    const H = helpersRef.current;
    H.stopMotion();
    const px = H.clampPx(fitTargetPxRef.current);
    viewRef.current = {
      topYear: boundsRef.current.minYear - TOP_RESERVE / px,
      pxPerYear: px,
      panX: 0,
    };
    H.clampView();
    const v = viewRef.current;
    const vy = sizeRef.current.h / v.pxPerYear;
    setSnap({ pxPerYear: v.pxPerYear, winStart: v.topYear - vy, winEnd: v.topYear + vy * 2 });
  }, [fitKey, sizeReady, articles.length]);

  // ─── First-use gesture hint ───
  useEffect(() => {
    if (!articles.length) return;
    try {
      if (!localStorage.getItem('chronix_vt_hint_v1')) {
        setShowHint(true);
        localStorage.setItem('chronix_vt_hint_v1', '1');
        const timer = setTimeout(() => setShowHint(false), 4500);
        return () => clearTimeout(timer);
      }
    } catch (e) {
      // ignore
    }
  }, [articles.length]);

  // ─── Gesture engine (pan / pinch / momentum / tap / double-tap / wheel) ───
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const H = helpersRef.current;

    const pointers = new Map();
    let pinchBase = null;
    let samples = [];
    let lastX = 0;
    let lastY = 0;
    let downT = 0;
    let moved = 0;

    const detachWindow = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    const onDown = (e) => {
      if (e.target.closest('[data-vt-grip]')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      H.stopMotion();
      setShowHint(false);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        didPanRef.current = false;
        moved = 0;
        downT = performance.now();
        lastX = e.clientX;
        lastY = e.clientY;
        samples = [{ t: downT, x: e.clientX, y: e.clientY }];
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      } else if (pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        const rect = el.getBoundingClientRect();
        const v = viewRef.current;
        pinchBase = {
          dist: Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1,
          px0: v.pxPerYear,
          anchorYear: v.topYear + ((p1.y + p2.y) / 2 - rect.top) / v.pxPerYear,
          lastCX: (p1.x + p2.x) / 2,
        };
        didPanRef.current = true;
      }
    };

    const onMove = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const v = viewRef.current;

      if (pointers.size >= 2 && pinchBase) {
        const [p1, p2] = [...pointers.values()];
        const rect = el.getBoundingClientRect();
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
        const cy = (p1.y + p2.y) / 2 - rect.top;
        const cx = (p1.x + p2.x) / 2;
        const newPx = H.clampPx(pinchBase.px0 * (dist / pinchBase.dist));
        v.pxPerYear = newPx;
        v.topYear = pinchBase.anchorYear - cy / newPx;
        v.panX += cx - pinchBase.lastCX;
        pinchBase.lastCX = cx;
        H.clampView();
        H.syncTransforms();
        H.scheduleRender();
        H.showZoomBadge();
      } else if (pointers.size === 1) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved > 8) didPanRef.current = true;
        v.topYear -= dy / v.pxPerYear;
        v.panX += dx;
        H.clampView();
        H.syncTransforms();
        H.ensureWindow();
        const now = performance.now();
        samples.push({ t: now, x: e.clientX, y: e.clientY });
        while (samples.length > 6 || (samples.length > 1 && now - samples[0].t > 90)) {
          samples.shift();
        }
      }
    };

    const onUp = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);

      if (pointers.size === 1) {
        // Pinch ended → continue panning with the remaining finger
        pinchBase = null;
        const [p] = [...pointers.values()];
        lastX = p.x;
        lastY = p.y;
        samples = [];
        return;
      }
      if (pointers.size > 0) return;

      detachWindow();
      pinchBase = null;
      const now = performance.now();

      if (!didPanRef.current && now - downT < 380) {
        // Tap: deselect on empty space + double-tap-to-zoom detection
        const onCard = e.target.closest('[data-vt-card], [data-vt-spine], button');
        const lt = lastTapRef.current;
        if (
          lt &&
          now - lt.t < 320 &&
          Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 42 &&
          !onCard
        ) {
          const rect = el.getBoundingClientRect();
          H.zoomAt(e.clientY - rect.top, 2.2, 260);
          lastTapRef.current = null;
        } else {
          lastTapRef.current = { t: now, x: e.clientX, y: e.clientY };
          if (!onCard) onSelectArticleRef.current?.(null);
        }
      } else if (samples.length >= 2) {
        const first = samples[0];
        const last = samples[samples.length - 1];
        const dt = last.t - first.t;
        if (dt > 10 && now - last.t < 70) {
          H.startMomentum((last.x - first.x) / dt, (last.y - first.y) / dt);
        }
      }
    };

    const onWheel = (e) => {
      e.preventDefault();
      const v = viewRef.current;
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        H.stopMotion();
        const factor = Math.exp(-e.deltaY * 0.0022);
        const anchorViewY = e.clientY - rect.top;
        const anchorYear = v.topYear + anchorViewY / v.pxPerYear;
        v.pxPerYear = H.clampPx(v.pxPerYear * factor);
        v.topYear = anchorYear - anchorViewY / v.pxPerYear;
        H.clampView();
        H.syncTransforms();
        H.scheduleRender();
        H.showZoomBadge();
      } else {
        H.stopMotion();
        v.topYear += e.deltaY / v.pxPerYear;
        v.panX -= e.deltaX;
        H.clampView();
        H.syncTransforms();
        H.ensureWindow();
      }
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('wheel', onWheel);
      detachWindow();
      helpersRef.current.stopMotion();
      if (renderRafRef.current) cancelAnimationFrame(renderRafRef.current);
      renderRafRef.current = null;
    };
  }, []);

  // ─── Keep transforms consistent with the freshly rendered window ───
  useLayoutEffect(() => {
    helpersRef.current.syncTransforms();
  });

  // ─── Stacking layout (absolute px space, origin at minYear) ───
  const layout = useMemo(() => {
    const px = snap.pxPerYear;
    const absY = (year) => (year - minYear) * px;
    const columns = displayLanes.map(() => ({ cards: [], spans: [] }));
    const index = new Map();
    let maxBottom = 0;

    const byLane = new Map();
    for (const art of articles) {
      const li = clamp(art.laneIndex ?? 0, 0, columns.length - 1);
      if (!byLane.has(li)) byLane.set(li, []);
      byLane.get(li).push(art);
    }

    byLane.forEach((laneArts, li) => {
      laneArts.sort((a, b) => {
        if (Math.abs(a.startYear - b.startYear) > 1e-9) return a.startYear - b.startYear;
        return b.duration - a.duration;
      });

      // Cards: collision-free relaxation downward from their true date anchor
      let lastBottom = -Infinity;
      for (const art of laneArts) {
        const hasImage = Boolean(art.imageUrl);
        const isLongTitle = (art.title || '').length > 32;
        const cardH = hasImage ? 132 : isLongTitle ? 92 : 76;
        const anchorY = absY(art.startYear);
        const placedY = Math.max(anchorY, lastBottom);
        lastBottom = placedY + cardH + CARD_GAP;
        if (placedY + cardH > maxBottom) maxBottom = placedY + cardH;
        const item = { art, anchorY, placedY, cardH, hasImage, laneIndex: li };
        columns[li].cards.push(item);
        index.set(art.id, { startYear: art.startYear, laneIndex: li });
      }

      // Spine spans: stagger overlapping periods across up to 3 tracks
      const activeEnds = [];
      for (const art of laneArts) {
        let track = -1;
        for (let ti = 0; ti < activeEnds.length; ti++) {
          if (activeEnds[ti] <= art.startYear + 1e-9) {
            track = ti;
            activeEnds[ti] = art.endYear;
            break;
          }
        }
        if (track === -1) {
          track = activeEnds.length;
          activeEnds.push(art.endYear);
        }
        columns[li].spans.push({
          art,
          track: track % 3,
          startAbs: absY(art.startYear),
          endAbs: absY(Math.max(art.endYear, art.startYear)),
        });
      }
    });

    overflowPxRef.current = Math.max(0, maxBottom - absY(maxYear));
    layoutIndexRef.current = index;
    return { columns, px };
  }, [articles, displayLanes, snap.pxPerYear, minYear, maxYear]);

  // ─── External selection → animated focus (skipped for internal taps) ───
  useEffect(() => {
    if (!selectedArticleId) return;
    if (suppressFocusRef.current === selectedArticleId) {
      suppressFocusRef.current = null;
      return;
    }
    const item = layoutIndexRef.current.get(selectedArticleId);
    if (!item) return;
    const H = helpersRef.current;
    const v = viewRef.current;
    const { h } = sizeRef.current;
    const targetTop = item.startYear - (h * 0.35) / v.pxPerYear;

    // Bring the article's lane column into horizontal view
    const { colW: cw, visW: vw, totalW: tw } = laneDimsRef.current;
    let targetPanX = v.panX;
    if (tw > vw) {
      const colStart = item.laneIndex * cw;
      const desired = -(colStart - Math.max(0, (vw - cw) / 2));
      targetPanX = isRtlRef.current
        ? clamp(-desired, 0, tw - vw)
        : clamp(desired, -(tw - vw), 0);
    }
    H.animateTo({ topYear: targetTop, panX: targetPanX }, 360);
  }, [selectedArticleId]);

  // ─── Card drag (grip handle) ───
  const dragRef = useRef({ id: null, startX: 0, startY: 0, initialX: 0, initialY: 0 });
  const handleGripDown = (e, artId) => {
    e.stopPropagation();
    const current = cardOffsets[artId] || { x: 0, y: 0 };
    dragRef.current = {
      id: artId,
      startX: e.clientX,
      startY: e.clientY,
      initialX: current.x,
      initialY: current.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handleGripMove = (e, artId) => {
    if (dragRef.current.id !== artId) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.hypot(dx, dy) > 4) didPanRef.current = true; // suppress the trailing click
    setCardOffsets((prev) => ({
      ...prev,
      [artId]: {
        x: Math.round(dragRef.current.initialX + dx),
        y: Math.round(dragRef.current.initialY + dy),
      },
    }));
  };
  const handleGripUp = (e, artId) => {
    if (dragRef.current.id === artId) dragRef.current.id = null;
  };
  const hasMovedCards = Object.keys(cardOffsets).length > 0;

  // ─── Per-render window helpers ───
  const px = snap.pxPerYear;
  const winHpx = Math.max(1, (snap.winEnd - snap.winStart) * px);
  const winAbsStart = (snap.winStart - minYear) * px;
  const winAbsEnd = (snap.winEnd - minYear) * px;
  const toWin = (abs) => abs - winAbsStart;
  const side = isRtl ? 'right' : 'left';
  const farSide = isRtl ? 'left' : 'right';

  const ticks = useMemo(
    () => generateTicks(snap.winStart, snap.winEnd, snap.pxPerYear, dict),
    [snap, dict]
  );

  // Era time bands within the window
  const visibleBands = useMemo(() => {
    return (timeBands || [])
      .map((tb) => ({
        id: tb.id || tb.title,
        title: tb.title,
        color: tb.color || '#64748b',
        start: dateToDecimalYear(tb.from),
        end: dateToDecimalYear(tb.to),
      }))
      .filter((b) => b.end > snap.winStart && b.start < snap.winEnd);
  }, [timeBands, snap]);

  const nowYear = new Date().getFullYear() + monthFrac(new Date().getMonth() + 1, new Date().getDate());
  const nowVisible = nowYear > snap.winStart && nowYear < snap.winEnd && nowYear >= minYear && nowYear <= maxYear + 1;

  if (!articles.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-400 dark:text-slate-500 select-none px-8 text-center">
        <Calendar className="w-8 h-8 opacity-40" />
        <p className="text-sm font-medium">{t('mobile.noEvents')}</p>
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      dir={isRtl ? 'rtl' : 'ltr'}
      className="flex-1 relative overflow-hidden select-none bg-slate-100/80 dark:bg-slate-950 cursor-grab active:cursor-grabbing"
      style={{ touchAction: 'none', WebkitTouchCallout: 'none' }}
      onClickCapture={(e) => {
        if (didPanRef.current) {
          e.stopPropagation();
          e.preventDefault();
          didPanRef.current = false;
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* ═══ 1. Grid layer: major gridlines, era bands, now-line ═══ */}
      <div className="absolute inset-y-0 overflow-hidden" style={{ [side]: AXIS_W, [farSide]: 0 }}>
        <div
          ref={gridWorldRef}
          className="absolute inset-x-0 top-0 pointer-events-none"
          style={{ height: `${winHpx}px`, willChange: 'transform' }}
        >
          {/* Era time bands */}
          {visibleBands.map((b) => {
            const topAbs = Math.max((b.start - minYear) * px, winAbsStart - 800);
            const botAbs = Math.min((b.end - minYear) * px, winAbsEnd + 800);
            return (
              <div
                key={b.id}
                className="absolute inset-x-0"
                style={{
                  top: `${toWin(topAbs)}px`,
                  height: `${Math.max(2, botAbs - topAbs)}px`,
                  backgroundColor: hexToRgba(b.color, 0.07),
                  borderTop: `1px solid ${hexToRgba(b.color, 0.25)}`,
                }}
              >
                {(b.start - minYear) * px >= winAbsStart - 800 && (
                  <span
                    className="absolute top-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{
                      [farSide]: '6px',
                      color: b.color,
                      backgroundColor: hexToRgba(b.color, 0.12),
                    }}
                  >
                    {b.title}
                  </span>
                )}
              </div>
            );
          })}

          {/* Major gridlines */}
          {ticks.map((tick, i) =>
            tick.kind !== 'minor' ? (
              <div
                key={`g${i}`}
                className={`absolute inset-x-0 h-px ${
                  tick.kind === 'strong'
                    ? 'bg-slate-300/70 dark:bg-slate-700/70'
                    : 'border-t border-dashed border-slate-200/80 dark:border-slate-800/80'
                }`}
                style={{ top: `${tick.y}px` }}
              />
            ) : null
          )}

          {/* "Now" indicator */}
          {nowVisible && (
            <div
              className="absolute inset-x-0 flex items-center"
              style={{ top: `${toWin((nowYear - minYear) * px)}px` }}
            >
              <div className="flex-1 h-px bg-rose-400/70 dark:bg-rose-500/60" style={{ boxShadow: '0 0 4px rgba(244,63,94,0.4)' }} />
              <span className="absolute text-[8px] font-bold uppercase tracking-wide text-rose-500 bg-rose-50 dark:bg-rose-950/80 px-1 py-px rounded" style={{ [farSide]: '4px', top: '-14px' }}>
                {dict.present}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ═══ 2. Lane columns layer: spines, period bars, anchor dots, cards ═══ */}
      <div className="absolute inset-y-0 overflow-hidden" style={{ [side]: AXIS_W, [farSide]: 0 }}>
        <div
          ref={laneWorldRef}
          className="absolute top-0"
          style={{ width: `${totalW}px`, height: `${winHpx}px`, willChange: 'transform', [side]: 0 }}
        >
          {layout.columns.map((col, li) => {
            const lane = displayLanes[li];
            const laneColor = lane?.color || '#0284c7';
            return (
              <div
                key={lane?.id ?? li}
                className={`absolute inset-y-0 ${laneCount > 1 ? 'border-e border-slate-200/50 dark:border-slate-800/50' : ''}`}
                style={{ width: `${colW}px`, [side]: `${li * colW}px` }}
              >
                {/* Date spine */}
                <div
                  className="absolute inset-y-0 w-px bg-slate-300/80 dark:bg-slate-700/70"
                  style={{ [side]: `${SPINE_X}px` }}
                />

                {/* Period bars + anchor dots on the spine */}
                {col.spans.map(({ art, track, startAbs, endAbs }) => {
                  if (endAbs < winAbsStart - 60 || startAbs > winAbsEnd + 60) return null;
                  const isHigh = selectedArticleId === art.id || hoveredId === art.id;
                  const color = art.laneInfo?.color || laneColor;
                  const clTop = Math.max(startAbs, winAbsStart - 400);
                  const clBot = Math.min(endAbs, winAbsEnd + 400);
                  return (
                    <React.Fragment key={`sp-${art.id}`}>
                      {art.isRange && clBot - clTop > 1 && (
                        <div
                          data-vt-spine
                          onClick={(e) => {
                            e.stopPropagation();
                            suppressFocusRef.current = art.id;
                            onSelectArticle?.(art);
                          }}
                          className={`absolute rounded-full cursor-pointer transition-[width,opacity] ${
                            isHigh ? 'w-[7px] z-20 ring-1 ring-white/60 dark:ring-black/40' : 'w-[5px] z-10'
                          }`}
                          style={{
                            top: `${toWin(clTop)}px`,
                            height: `${Math.max(6, clBot - clTop)}px`,
                            [side]: `${SPINE_X - 2 + track * 7}px`,
                            backgroundColor: isHigh ? color : hexToRgba(color, 0.5),
                          }}
                        />
                      )}
                      {/* Start anchor dot */}
                      <div
                        className={`absolute rounded-full z-20 pointer-events-none transition-transform ${isHigh ? 'scale-125' : ''}`}
                        style={{
                          top: `${toWin(startAbs) - 4}px`,
                          [side]: `${SPINE_X - 3.5 + track * 7}px`,
                          width: '8px',
                          height: '8px',
                          backgroundColor: isHigh ? color : hexToRgba(color, 0.85),
                          boxShadow: '0 0 0 2px rgba(255,255,255,0.65)',
                        }}
                      />
                    </React.Fragment>
                  );
                })}

                {/* Event cards */}
                {col.cards.map(({ art, anchorY, placedY, cardH, hasImage }) => {
                  const offset = cardOffsets[art.id] || { x: 0, y: 0 };
                  const isDragged = offset.x !== 0 || offset.y !== 0;
                  const visTop = placedY + offset.y;
                  if (visTop + cardH < winAbsStart - 250 || visTop > winAbsEnd + 250) return null;

                  const isSelected = selectedArticleId === art.id;
                  const isHovered = hoveredId === art.id;
                  const isHigh = isSelected || isHovered;
                  const isStarred = Boolean(starredArticleIds?.has(art.id));
                  const color = art.laneInfo?.color || laneColor;
                  const timeSpan = formatTimeSpan(art.from, art.to, art.isToPresent);

                  // Connector geometry in card-local coords (SVG x grows toward the ruler side)
                  const spanShift = (col.spans.find((s) => s.art.id === art.id)?.track || 0) * 7;
                  const ax = (isRtl ? 1 : -1) * (CARD_X - SPINE_X - spanShift) - offset.x;
                  const sy = anchorY - placedY - offset.y;
                  const ey = Math.min(cardH / 2, 26);
                  const isRelaxed = Math.abs(anchorY - placedY) > 8;
                  // Straight Histropedia-style connector; gentle curve only when nearly level
                  const pathD = isRelaxed
                    ? `M ${ax} ${sy} L 0 ${ey}`
                    : `M ${ax} ${sy} C ${ax * 0.45} ${sy}, ${ax * 0.45} ${ey}, 0 ${ey}`;

                  return (
                    <div
                      key={art.id}
                      data-vt-card
                      className={`absolute ${isHigh ? 'z-40' : 'z-30'}`}
                      style={{
                        top: `${toWin(placedY)}px`,
                        height: `${cardH}px`,
                        [side]: `${CARD_X}px`,
                        [farSide]: `${CARD_END_PAD}px`,
                        transform: isDragged ? `translate3d(${offset.x}px, ${offset.y}px, 0)` : undefined,
                        transition: dragRef.current.id === art.id ? 'none' : 'transform 0.15s ease-out',
                      }}
                      onMouseEnter={() => setHoveredId(art.id)}
                      onMouseLeave={() => setHoveredId(null)}
                    >
                      {/* Bézier connector to the exact date anchor on the spine */}
                      <svg
                        className="absolute top-0 bottom-0 pointer-events-none"
                        style={{ [side]: 0, width: '2px', height: '100%', overflow: 'visible', zIndex: -1 }}
                      >
                        <path
                          d={pathD}
                          fill="none"
                          stroke={isHigh ? color : hexToRgba(color, 0.55)}
                          strokeWidth={isHigh ? 2.5 : 1.8}
                          strokeDasharray={isRelaxed && !isHigh ? '3 3' : undefined}
                        />
                        <circle cx={0} cy={ey} r={isHigh ? 3.5 : 2.5} fill={isHigh ? color : hexToRgba(color, 0.7)} />
                      </svg>

                      {/* Card body */}
                      <div
                        onClick={() => {
                          suppressFocusRef.current = art.id;
                          onSelectArticle?.(art);
                        }}
                        style={{
                          borderColor: isSelected ? color : isHovered ? hexToRgba(color, 0.6) : undefined,
                          boxShadow: isSelected
                            ? `0 0 0 2px ${color}, 0 12px 28px -4px rgba(0,0,0,0.25)`
                            : undefined,
                        }}
                        className={`w-full h-full rounded-xl border relative cursor-pointer overflow-hidden group/card flex flex-col transition-shadow ${
                          isSelected
                            ? 'bg-white dark:bg-slate-900 shadow-xl'
                            : isHovered
                            ? 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 shadow-md'
                            : 'bg-white/95 dark:bg-slate-900/90 border-slate-200/90 dark:border-slate-800/90 shadow-2xs'
                        }`}
                      >
                        {/* Lane color accent strip */}
                        <div
                          className="absolute inset-y-0 w-1.5 z-10"
                          style={{ backgroundColor: color, [side]: 0 }}
                        />

                        {hasImage && art.imageUrl && (
                          <div className="w-full h-14 shrink-0 overflow-hidden relative bg-slate-200 dark:bg-slate-800">
                            <img
                              src={art.imageUrl}
                              alt={art.title}
                              draggable={false}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
                            <span className="absolute bottom-1 text-[9px] font-bold text-white px-1.5 py-0.5 rounded-full bg-black/40 backdrop-blur-xs" style={{ [side]: '8px' }}>
                              {timeSpan}
                            </span>
                          </div>
                        )}

                        <div className={`p-2 flex-1 flex flex-col justify-between min-h-0 ${isRtl ? 'pr-3.5' : 'pl-3.5'}`}>
                          <div className="flex items-start justify-between gap-1.5 min-w-0">
                            <h4 className="text-xs sm:text-[13px] font-bold text-slate-900 dark:text-white leading-tight line-clamp-2 flex-1">
                              {art.title}
                            </h4>
                            <div className="flex items-center gap-0.5 shrink-0">
                              <div
                                data-vt-grip
                                onPointerDown={(e) => handleGripDown(e, art.id)}
                                onPointerMove={(e) => handleGripMove(e, art.id)}
                                onPointerUp={(e) => handleGripUp(e, art.id)}
                                onPointerCancel={(e) => handleGripUp(e, art.id)}
                                className="p-1 text-slate-300 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-300 cursor-grab active:cursor-grabbing rounded"
                                style={{ touchAction: 'none' }}
                                title={t('mobile.dragToMove')}
                              >
                                <GripVertical className="w-3.5 h-3.5" />
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onToggleStar?.(art.id);
                                }}
                                className={`p-1 rounded transition-colors cursor-pointer ${
                                  isStarred
                                    ? 'text-amber-500 bg-amber-500/10'
                                    : 'text-slate-300 dark:text-slate-600 hover:text-amber-500'
                                }`}
                                title={isStarred ? t('cardsList.unstar') : t('cardsList.star')}
                              >
                                <Star className={`w-3.5 h-3.5 ${isStarred ? 'fill-amber-400 text-amber-400' : ''}`} />
                              </button>
                            </div>
                          </div>

                          {!hasImage && (
                            <div className="flex items-center justify-between gap-1 mt-1">
                              <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-bold">
                                <Calendar className="w-2.5 h-2.5 text-sky-500" />
                                <span>{timeSpan}</span>
                              </div>
                              {art.isRange && Math.round(art.duration) > 0 && (
                                <span
                                  className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
                                  style={{ backgroundColor: hexToRgba(color, 0.13), color }}
                                >
                                  {Math.round(art.duration).toLocaleString()}y
                                </span>
                              )}
                            </div>
                          )}

                          {art.subtitle && (
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                              {art.subtitle}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ 3. Fixed ruler strip with translating ticks ═══ */}
      <div
        className={`absolute inset-y-0 z-30 bg-white/95 dark:bg-slate-900/95 ${isRtl ? 'border-l' : 'border-r'} border-slate-200/90 dark:border-slate-800/90 shadow-xs`}
        style={{ width: `${AXIS_W}px`, [side]: 0 }}
      >
        <div className="absolute inset-0 overflow-hidden">
          <div
            ref={axisWorldRef}
            className="absolute inset-x-0 top-0"
            style={{ height: `${winHpx}px`, willChange: 'transform' }}
          >
            {ticks.map((tick, i) => (
              <div
                key={i}
                className="absolute inset-x-0"
                style={{ top: `${tick.y}px` }}
              >
                <div
                  className={`absolute h-px ${
                    tick.kind === 'strong'
                      ? 'w-3.5 bg-slate-500 dark:bg-slate-400'
                      : tick.kind === 'major'
                      ? 'w-2.5 bg-slate-400 dark:bg-slate-500'
                      : 'w-1.5 bg-slate-300 dark:bg-slate-700'
                  }`}
                  style={{ [farSide]: 0 }}
                />
                {tick.label && (
                  <span
                    className={`absolute leading-none font-mono ${
                      tick.kind === 'strong'
                        ? 'text-[10px] font-extrabold text-slate-800 dark:text-slate-100'
                        : 'text-[9px] font-bold text-slate-500 dark:text-slate-400'
                    }`}
                    style={{ [side]: '5px', transform: 'translateY(-50%)', top: '0.5px', maxWidth: `${AXIS_W - 14}px`, whiteSpace: 'nowrap', overflow: 'hidden' }}
                  >
                    {tick.label}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ 4. Sticky lane column headers ═══ */}
      {laneCount > 1 && (
        <div
          className="absolute top-0 z-40 overflow-hidden pointer-events-none"
          style={{ height: `${LANE_HEADER_H}px`, [side]: AXIS_W, [farSide]: 0 }}
        >
          <div ref={laneHeaderRef} className="absolute top-0 h-full" style={{ width: `${totalW}px`, [side]: 0 }}>
            {displayLanes.map((lane, li) => (
              <div
                key={lane.id ?? li}
                className="absolute inset-y-0 flex items-center justify-between px-3 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-e border-slate-200/80 dark:border-slate-800/80"
                style={{ width: `${colW}px`, [side]: `${li * colW}px` }}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: lane.color }} />
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                    {lane.title}
                  </span>
                </div>
                <span className="text-[10px] font-semibold text-slate-400 px-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                  {lane.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ 5. Overlays: zoom badge, gesture hint, controls ═══ */}
      {zoomBadge !== null && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/90 dark:bg-slate-100/95 text-white dark:text-slate-900 shadow-2xl backdrop-blur-md text-xs font-bold" dir={isRtl ? 'rtl' : 'ltr'}>
            <ZoomIn className="w-3.5 h-3.5 text-sky-400 dark:text-sky-600" />
            <span>
              {zoomBadge >= 2
                ? t('mobile.spanYears', { n: Math.round(zoomBadge).toLocaleString() })
                : zoomBadge >= 2 / 12
                ? t('mobile.spanMonths', { n: Math.max(1, Math.round(zoomBadge * 12)) })
                : t('mobile.spanDays', { n: Math.max(1, Math.round(zoomBadge * 365)) })}
            </span>
          </div>
        </div>
      )}

      {showHint && (
        <div className="absolute inset-x-0 top-1/3 z-50 flex justify-center pointer-events-none animate-pulse">
          <div className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-slate-900/85 text-white text-xs font-semibold shadow-2xl backdrop-blur-md">
            <Move className="w-4 h-4 text-sky-400" />
            <span>{t('mobile.gestureHint')}</span>
          </div>
        </div>
      )}

      {/* Floating zoom controls (opposite side from the ruler) */}
      <div
        className="absolute z-40 flex flex-col gap-1 p-1 rounded-2xl bg-white/92 dark:bg-slate-900/92 border border-slate-200/90 dark:border-slate-700/80 shadow-lg backdrop-blur-md"
        style={{ [farSide]: '10px', bottom: '86px' }}
      >
        <button
          type="button"
          onClick={() => helpersRef.current.zoomAt(sizeRef.current.h / 2, 1.6)}
          className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 transition-all cursor-pointer"
          title={t('mobile.zoomInRuler')}
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => helpersRef.current.zoomAt(sizeRef.current.h / 2, 1 / 1.6)}
          className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 transition-all cursor-pointer"
          title={t('mobile.zoomOutRuler')}
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => helpersRef.current.fitAll()}
          className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 transition-all cursor-pointer"
          title={t('mobile.fitRuler')}
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {hasMovedCards && (
        <button
          type="button"
          onClick={() => setCardOffsets({})}
          className="absolute bottom-[86px] left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 shadow-lg backdrop-blur-md active:scale-95 transition-all cursor-pointer"
          title={t('mobile.resetPositions')}
        >
          <RotateCcw className="w-3 h-3" />
          <span>{t('mobile.resetPositions')}</span>
        </button>
      )}
    </div>
  );
}

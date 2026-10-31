import { useCallback, useEffect, useRef, useState } from 'react';

const MARGIN = 10;
const TOUCH_DRAG_THRESHOLD = 6;

/**
 * Drag-to-move for a fixed, bottom-anchored floating panel. Keeps the whole panel inside the
 * viewport (re-clamped on resize and whenever `remeasureKey` changes) and resets on double-click.
 *
 * `touch` (mobile) additionally lets a drag start on buttons once the pointer travels past a small
 * threshold (so taps still click), keeps the panel below the mobile top bar, and never lets it sit
 * lower than its default (bottom-anchored) spot above the bottom bar.
 */
export default function useFloatingDrag({ enabled = true, remeasureKey = '', touch = false } = {}) {
  const containerRef = useRef(null);
  const dragRef = useRef(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  // The position the user dragged to. `offset` is this value clamped to the viewport for the
  // panel's current size, so a temporarily larger panel (e.g. expanded) doesn't permanently
  // shift the position the user chose.
  const preferredRef = useRef(offset);

  const clamp = useCallback((candidate) => {
    const el = containerRef.current;
    if (!el || typeof window === 'undefined') return candidate;
    const rect = el.getBoundingClientRect();
    const current = offsetRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let { x, y } = candidate;
    let left = rect.left + (x - current.x);
    const right = rect.right + (x - current.x);
    let top = rect.top + (y - current.y);
    const bottom = rect.bottom + (y - current.y);
    if (right > vw - MARGIN) {
      const shift = right - (vw - MARGIN);
      x -= shift;
      left -= shift;
    }
    if (left < MARGIN) x += MARGIN - left;
    if (bottom > vh - MARGIN) {
      const shift = bottom - (vh - MARGIN);
      y -= shift;
      top -= shift;
    }
    let minTop = MARGIN;
    if (touch) {
      const topBar = document.querySelector('.mobile-top-command-bar');
      if (topBar) minTop = Math.max(minTop, topBar.getBoundingClientRect().bottom + 4);
    }
    if (top < minTop) y += minTop - top;
    if (touch && y > 0) y = 0;
    x = Math.round(x);
    y = Math.round(y);
    return x === candidate.x && y === candidate.y ? candidate : { x, y };
  }, [touch]);

  useEffect(() => {
    if (!enabled) return undefined;
    const raf = requestAnimationFrame(() => setOffset(clamp(preferredRef.current)));
    return () => cancelAnimationFrame(raf);
  }, [enabled, remeasureKey, clamp]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onResize = () => setOffset(clamp(preferredRef.current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [enabled, clamp]);

  const onPointerDown = useCallback((e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const onControl = Boolean(e.target.closest('button, a, input, select, [role="slider"]'));
    if (onControl && !touch) return;
    if (!onControl) {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: offsetRef.current.x,
      originY: offsetRef.current.y,
      active: !onControl,
    };
    if (!onControl) setIsDragging(true);
  }, [touch]);

  const onPointerMove = useCallback((e) => {
    const st = dragRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    if (!st.active) {
      if (Math.hypot(e.clientX - st.startX, e.clientY - st.startY) < TOUCH_DRAG_THRESHOLD) return;
      st.active = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setIsDragging(true);
    }
    const next = clamp({ x: st.originX + e.clientX - st.startX, y: st.originY + e.clientY - st.startY });
    preferredRef.current = next;
    setOffset(next);
  }, [clamp]);

  const onPointerUp = useCallback((e) => {
    const st = dragRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (!st.active) return;
    setIsDragging(false);
    // A drag that began on a button must not also trigger that button's click.
    const swallowClick = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', swallowClick, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallowClick, true), 0);
  }, []);

  const reset = useCallback(() => {
    preferredRef.current = { x: 0, y: 0 };
    setOffset(preferredRef.current);
  }, []);

  const onDoubleClick = useCallback((e) => {
    if (e?.target?.closest?.('button, a, input, select, [role="slider"]')) return;
    reset();
  }, [reset]);

  return {
    containerRef,
    offset,
    isDragging,
    reset,
    dragHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onDoubleClick,
    },
  };
}

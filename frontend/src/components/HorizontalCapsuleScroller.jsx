import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from './icons/ThemeIcons';

/**
 * Horizontally scrollable capsule/pill bar with side navigation arrows,
 * subtle edge fade masks, native touch swipe, and desktop mouse drag-to-scroll.
 * Works identically in both RTL and LTR layouts.
 */
export default function HorizontalCapsuleScroller({
  children,
  isRtl = false,
  scrollLeftLabel = 'Scroll left',
  scrollRightLabel = 'Scroll right',
  className = '',
  trackClassName = '',
  depsKey = '',
}) {
  const scrollRef = useRef(null);
  const dragCleanupRef = useRef(null);
  const suppressClickRef = useRef(false);

  const [isDragging, setIsDragging] = useState(false);
  const [scrollState, setScrollState] = useState({
    hasOverflow: false,
    canScrollLeft: false,
    canScrollRight: false,
  });

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    if (maxScroll <= 2) {
      setScrollState((prev) =>
        !prev.hasOverflow && !prev.canScrollLeft && !prev.canScrollRight
          ? prev
          : { hasOverflow: false, canScrollLeft: false, canScrollRight: false }
      );
      return;
    }

    let canLeft = false;
    let canRight = false;
    const trackRect = el.getBoundingClientRect();
    const firstChild = el.firstElementChild;
    const lastChild = el.lastElementChild;

    if (trackRect.width > 0 && firstChild && lastChild) {
      const firstRect = firstChild.getBoundingClientRect();
      const lastRect = lastChild.getBoundingClientRect();
      const minLeft = Math.min(firstRect.left, lastRect.left);
      const maxRight = Math.max(firstRect.right, lastRect.right);
      canLeft = minLeft < trackRect.left - 2;
      canRight = maxRight > trackRect.right + 2;
    } else if (isRtl) {
      const distFromRight = el.scrollLeft <= 0 ? -el.scrollLeft : maxScroll - el.scrollLeft;
      canRight = distFromRight > 2;
      canLeft = distFromRight < maxScroll - 2;
    } else {
      canLeft = el.scrollLeft > 2;
      canRight = el.scrollLeft < maxScroll - 2;
    }

    const nextOverflow = canLeft || canRight || maxScroll > 2;
    setScrollState((prev) =>
      prev.hasOverflow === nextOverflow &&
      prev.canScrollLeft === canLeft &&
      prev.canScrollRight === canRight
        ? prev
        : { hasOverflow: nextOverflow, canScrollLeft: canLeft, canScrollRight: canRight }
    );
  }, [isRtl]);

  useLayoutEffect(() => {
    updateScrollState();
  }, [updateScrollState, depsKey, scrollState.hasOverflow]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;

    const rafId = requestAnimationFrame(updateScrollState);
    let cancelled = false;
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!cancelled) updateScrollState();
      }).catch(() => {});
    }
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => updateScrollState());
      ro.observe(el);
      Array.from(el.children).forEach((child) => ro.observe(child));
    }
    window.addEventListener('resize', updateScrollState);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      ro?.disconnect();
      window.removeEventListener('resize', updateScrollState);
    };
  }, [updateScrollState, depsKey]);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  const scrollPhysical = (directionSign) => {
    const el = scrollRef.current;
    if (!el) return;
    const step = Math.max(180, Math.round(el.clientWidth * 0.62));
    el.scrollBy({ left: directionSign * step, behavior: 'smooth' });
  };

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth + 2) return;

    dragCleanupRef.current?.();
    const startX = e.clientX;
    const startScrollLeft = el.scrollLeft;
    let moved = false;

    const onMouseMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      if (!moved && Math.abs(dx) > 5) {
        moved = true;
        setIsDragging(true);
      }
      if (moved) {
        el.scrollLeft = startScrollLeft - dx;
      }
    };

    const onMouseUp = () => {
      cleanup();
      if (moved) {
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 50);
      }
    };

    const cleanup = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      dragCleanupRef.current = null;
      setIsDragging(false);
    };

    dragCleanupRef.current = cleanup;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleClickCapture = (e) => {
    if (suppressClickRef.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressClickRef.current = false;
    }
  };

  // Start button sits on the right in RTL (scrolls right, +1) and on the left in LTR (scrolls left, -1).
  // End button sits on the left in RTL (scrolls left, -1) and on the right in LTR (scrolls right, +1).
  const canScrollStart = isRtl ? scrollState.canScrollRight : scrollState.canScrollLeft;
  const canScrollEnd = isRtl ? scrollState.canScrollLeft : scrollState.canScrollRight;
  const startLabel = isRtl ? scrollRightLabel : scrollLeftLabel;
  const endLabel = isRtl ? scrollLeftLabel : scrollRightLabel;

  let maskStyle;
  if (scrollState.canScrollLeft && scrollState.canScrollRight) {
    maskStyle = {
      WebkitMaskImage:
        'linear-gradient(to right, transparent 0px, black 18px, black calc(100% - 18px), transparent 100%)',
      maskImage:
        'linear-gradient(to right, transparent 0px, black 18px, black calc(100% - 18px), transparent 100%)',
    };
  } else if (scrollState.canScrollLeft) {
    maskStyle = {
      WebkitMaskImage: 'linear-gradient(to right, transparent 0px, black 20px, black 100%)',
      maskImage: 'linear-gradient(to right, transparent 0px, black 20px, black 100%)',
    };
  } else if (scrollState.canScrollRight) {
    maskStyle = {
      WebkitMaskImage: 'linear-gradient(to right, black 0%, black calc(100% - 20px), transparent 100%)',
      maskImage: 'linear-gradient(to right, black 0%, black calc(100% - 20px), transparent 100%)',
    };
  }

  const arrowBtnClass = (enabled) =>
    `w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-full border transition-all ${
      enabled
        ? 'bg-surface-raised/95 hover:bg-surface-hover text-ink border-line hover:border-accent/50 shadow-control cursor-pointer active:scale-95'
        : 'bg-surface-raised/45 text-ink-subtle/40 border-line/50 cursor-default opacity-45'
    }`;

  return (
    <div className={`flex items-center gap-2 min-w-0 ${className}`}>
      {scrollState.hasOverflow && (
        <button
          type="button"
          disabled={!canScrollStart}
          onClick={() => scrollPhysical(isRtl ? 1 : -1)}
          title={startLabel}
          aria-label={startLabel}
          className={arrowBtnClass(canScrollStart)}
        >
          {isRtl ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      )}

      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        onMouseDown={handleMouseDown}
        onClickCapture={handleClickCapture}
        style={maskStyle}
        className={`flex-1 min-w-0 flex items-center gap-2 overflow-x-auto py-1 touch-pan-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
          scrollState.hasOverflow ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : ''
        } ${trackClassName}`}
      >
        {children}
      </div>

      {scrollState.hasOverflow && (
        <button
          type="button"
          disabled={!canScrollEnd}
          onClick={() => scrollPhysical(isRtl ? -1 : 1)}
          title={endLabel}
          aria-label={endLabel}
          className={arrowBtnClass(canScrollEnd)}
        >
          {isRtl ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      )}
    </div>
  );
}

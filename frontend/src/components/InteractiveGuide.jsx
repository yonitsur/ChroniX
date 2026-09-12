import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { ChevronRight, ChevronLeft, X, Compass } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

// Padding around the highlighted element (spotlight hole).
const PAD = 8;
// Gap between the highlighted element and the tooltip card.
const GAP = 16;
// Keep the tooltip this far from the viewport edges.
const MARGIN = 12;

/**
 * A lightweight coach-mark / spotlight tour. It dims the screen, cuts a bright
 * hole around one target element at a time, and shows an explanatory card next
 * to it. Read-only: all interaction goes through the card's Back / Next / Skip.
 *
 * steps: [{ key, target: string(id) | () => Element|null, title, body,
 *           placement?: 'right'|'left'|'top'|'bottom'|'center',
 *           optional?: bool, beforeShow?: () => void, afterHide?: () => void }]
 */
export default function InteractiveGuide({ isOpen, steps = [], onClose }) {
  const { t, isRtl } = useLanguage();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null); // highlighted element rect, or null = centered card
  const [pos, setPos] = useState(null); // tooltip {left, top}
  const dirRef = useRef(1);
  const ttRef = useRef(null);

  // Latest steps kept in a ref so effects can key on `index` alone and stay stable
  // even if the caller passes a freshly-built steps array each render.
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const total = steps.length;
  const step = steps[index] || null;
  const isFirst = index <= 0;
  const isLast = index >= total - 1;

  // Reset to the first step every time the tour opens.
  useEffect(() => {
    if (isOpen) {
      dirRef.current = 1;
      setIndex(0);
      setRect(null);
    }
  }, [isOpen]);

  const resolveTarget = useCallback(() => {
    const step = stepsRef.current[index];
    if (!step?.target) return null;
    return typeof step.target === 'function'
      ? step.target()
      : document.getElementById(step.target);
  }, [index]);

  // Set the rect only when it actually changes, so re-measures (e.g. from scroll
  // events) don't churn state and loop.
  const applyRect = useCallback((r) => {
    setRect((prev) => {
      if (!r) return prev == null ? prev : null;
      if (prev && prev.left === r.left && prev.top === r.top && prev.width === r.width && prev.height === r.height) {
        return prev;
      }
      return r;
    });
  }, []);

  // Locate the current step's target (running its beforeShow hook first, e.g. to
  // open a menu). Polls briefly so targets that appear asynchronously are caught;
  // optional steps whose target never shows up are auto-skipped.
  useEffect(() => {
    if (!isOpen) return;
    const step = stepsRef.current[index];
    if (!step) return;
    let cancelled = false;
    let raf = 0;
    let tries = 0;
    const maxTries = step.beforeShow ? 45 : 14;

    try { step.beforeShow?.(); } catch (e) { /* noop */ }

    const tick = () => {
      if (cancelled) return;
      if (!step.target) {
        applyRect(null);
        return;
      }
      const el = resolveTarget();
      if (el) {
        try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* noop */ }
        const r = el.getBoundingClientRect();
        if (r.width || r.height) {
          applyRect({ left: r.left, top: r.top, width: r.width, height: r.height });
          return;
        }
      }
      tries += 1;
      if (tries >= maxTries) {
        if (step.optional) {
          const d = dirRef.current || 1;
          setIndex((i) => Math.min(total - 1, Math.max(0, i + d)));
        } else {
          applyRect(null); // fall back to a centered card
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      try { step.afterHide?.(); } catch (e) { /* noop */ }
    };
  }, [isOpen, index, total, resolveTarget, applyRect]);

  // Keep the highlight aligned when the layout shifts.
  useEffect(() => {
    if (!isOpen || !stepsRef.current[index]?.target) return;
    const remeasure = () => {
      const el = resolveTarget();
      if (el) {
        const r = el.getBoundingClientRect();
        applyRect({ left: r.left, top: r.top, width: r.width, height: r.height });
      }
    };
    window.addEventListener('resize', remeasure);
    window.addEventListener('scroll', remeasure, true);
    return () => {
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('scroll', remeasure, true);
    };
  }, [isOpen, index, resolveTarget, applyRect]);

  // Position the tooltip card relative to the highlighted element (or centered).
  useLayoutEffect(() => {
    if (!isOpen) return;
    const node = ttRef.current;
    if (!node) return;
    const tt = { w: node.offsetWidth, h: node.offsetHeight };
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (!rect) {
      setPos({ left: (vw - tt.w) / 2, top: (vh - tt.h) / 2 });
      return;
    }

    const placement = stepsRef.current[index]?.placement || 'bottom';
    let left;
    let top;
    switch (placement) {
      case 'right':
        left = rect.left + rect.width + GAP;
        top = rect.top + rect.height / 2 - tt.h / 2;
        if (left + tt.w > vw - MARGIN) left = rect.left - GAP - tt.w;
        break;
      case 'left':
        left = rect.left - GAP - tt.w;
        top = rect.top + rect.height / 2 - tt.h / 2;
        if (left < MARGIN) left = rect.left + rect.width + GAP;
        break;
      case 'top':
        top = rect.top - GAP - tt.h;
        left = rect.left + rect.width / 2 - tt.w / 2;
        if (top < MARGIN) top = rect.top + rect.height + GAP;
        break;
      case 'bottom':
      default:
        top = rect.top + rect.height + GAP;
        left = rect.left + rect.width / 2 - tt.w / 2;
        if (top + tt.h > vh - MARGIN) top = rect.top - GAP - tt.h;
        break;
    }
    left = Math.max(MARGIN, Math.min(vw - tt.w - MARGIN, left));
    top = Math.max(MARGIN, Math.min(vh - tt.h - MARGIN, top));
    setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
  }, [isOpen, rect, index]);

  const finish = useCallback(() => onClose?.('finish'), [onClose]);
  const skip = useCallback(() => onClose?.('skip'), [onClose]);
  const goNext = useCallback(() => {
    dirRef.current = 1;
    if (isLast) finish();
    else setIndex((i) => Math.min(total - 1, i + 1));
  }, [isLast, finish, total]);
  const goPrev = useCallback(() => {
    dirRef.current = -1;
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // Keyboard navigation.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        skip();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, goNext, goPrev, skip]);

  if (!isOpen || !step) return null;

  return (
    <div className="fixed inset-0" style={{ zIndex: 9999 }} aria-live="polite" role="dialog" aria-modal="true">
      {/* Dimming + spotlight hole. Read-only: a transparent catcher swallows clicks. */}
      {rect ? (
        <div
          className="fixed rounded-panel ring-2 ring-accent transition-all duration-200 ease-out"
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.75)',
            pointerEvents: 'none',
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-black/75" style={{ pointerEvents: 'none' }} />
      )}

      {/* Full-screen click catcher (below the card) keeps the tour read-only. */}
      <div
        className="fixed inset-0"
        style={{ pointerEvents: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      />

      {/* Tooltip / coach-mark card */}
      <div
        ref={ttRef}
        dir={isRtl ? 'rtl' : 'ltr'}
        className="fixed w-[19rem] max-w-[calc(100vw-1.5rem)] bg-surface-overlay rounded-sheet shadow-panel border border-line p-4 animate-in fade-in zoom-in-95 duration-200"
        style={{
          left: pos ? pos.left : -9999,
          top: pos ? pos.top : -9999,
          visibility: pos ? 'visible' : 'hidden',
          pointerEvents: 'auto',
        }}
      >
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 h-7 w-7 shrink-0 flex items-center justify-center rounded-control bg-accent-soft text-accent">
            <Compass className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-ink leading-snug">
              {step.title}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              {step.body}
            </p>
          </div>
          <button
            type="button"
            onClick={skip}
            className="shrink-0 -mt-1 -me-1 p-1 rounded-control text-ink-subtle hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
            title={t('tour.skip')}
            aria-label={t('tour.skip')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-3.5 flex items-center justify-between gap-2">
          {/* Progress dots */}
          <div className="flex items-center gap-1.5">
            {steps.map((s, i) => (
              <span
                key={s.key}
                className={`h-1.5 rounded-full transition-all ${
                  i === index
                    ? 'w-4 bg-accent'
                    : 'w-1.5 bg-surface-sunken border border-line'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            {!isFirst && (
              <button
                type="button"
                onClick={goPrev}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-control text-xs font-medium text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
              >
                {isRtl ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
                {t('tour.back')}
              </button>
            )}
            <button
              type="button"
              onClick={goNext}
              className="flex items-center gap-1 px-3 py-1.5 rounded-control text-xs font-semibold bg-accent hover:bg-accent-hover text-accent-fg shadow-control transition-colors cursor-pointer"
            >
              {isLast ? t('tour.done') : t('tour.next')}
              {!isLast && (isRtl ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />)}
            </button>
          </div>
        </div>

        <div className="mt-2 text-center text-[10px] font-medium text-ink-subtle">
          {t('tour.stepLabel', { current: index + 1, total })}
        </div>
      </div>
    </div>
  );
}

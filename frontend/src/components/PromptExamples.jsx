import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Split,
  Clock,
  Crosshair,
  SlidersHorizontal,
  Castle,
  Compass,
  Lightbulb,
} from './icons/ThemeIcons';
import { useLanguage } from '../context/LanguageContext';
import {
  PROMPT_EXAMPLES,
  KIDS_PROMPT_EXAMPLES,
  PROMPT_SKILL_TAGS,
  resolvePromptSkillTag,
  getSmartShuffledExamples,
} from '../data/promptExamplesData';
import { advanceMarquee, marqueeSegmentWidth, MARQUEE_MAX_STEP_SECONDS } from '../utils/marqueeMotion';
import { createAnimationGate, observeAnimationGate } from '../utils/frameThrottle';

export {
  PROMPT_EXAMPLES,
  KIDS_PROMPT_EXAMPLES,
  PROMPT_SKILL_TAGS,
  resolvePromptSkillTag,
  getSmartShuffledExamples,
};

const SKILL_TAG_ICONS = {
  parallel: Split,
  microTime: Clock,
  lens: Crosshair,
  scope: SlidersHorizontal,
  fiction: Castle,
  journey: Compass,
  microHistory: Lightbulb,
};

const SKILL_TAG_FALLBACK_LABELS = {
  en: {
    parallel: 'Parallel Lanes',
    microTime: 'Hour by Hour',
    lens: 'Unique Lens',
    scope: 'Focus & Scope',
    fiction: 'Fictional Lore',
    journey: 'Map Journey',
    microHistory: 'Everyday History',
  },
  he: {
    parallel: 'צירים מקבילים',
    microTime: 'שעה אחר שעה',
    lens: 'זווית מפתיעה',
    scope: 'מיקוד והיקף',
    fiction: 'עולם בדיוני',
    journey: 'מסע על המפה',
    microHistory: 'סיפורו של רעיון',
  },
};

export default function PromptExamples({ onSelectPrompt, isGenerating = false }) {
  const { t, language, contentMode, isRtl: isAppRtl } = useLanguage();
  const scrollRef = useRef(null);
  const scrollPosRef = useRef(0);
  const isHoveredRef = useRef(false);
  const isTouchingRef = useRef(false);
  const isManualScrollingRef = useRef(false);
  const resumeTimeoutRef = useRef(null);
  const lastTimeRef = useRef(null);
  const segmentWidthRef = useRef(0);

  // Initialize with all examples strictly matching the current language and content mode
  const [examples, setExamples] = useState(() => getSmartShuffledExamples(language, null, contentMode));

  // Triple array for seamless infinite wrapping in both directions
  const triplicatedExamples = useMemo(() => [
    ...examples,
    ...examples,
    ...examples
  ], [examples]);

  // Center in the middle set of cards initially or on language/mode change
  const resetToMiddle = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const segmentWidth = el.scrollWidth / 3;
    if (segmentWidth > 0) {
      el.scrollLeft = segmentWidth;
      scrollPosRef.current = segmentWidth;
    }
  }, []);

  useEffect(() => {
    setExamples(getSmartShuffledExamples(language, null, contentMode));
    const timer = setTimeout(resetToMiddle, 60);
    return () => clearTimeout(timer);
  }, [language, contentMode, resetToMiddle]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Small delay to ensure initial layout metrics are ready
    const initTimer = setTimeout(resetToMiddle, 60);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    // Reading scrollWidth every frame forces layout right after the previous frame's scrollLeft
    // write, so the segment width is cached and only re-measured when the track or its content
    // resizes (which also covers example / language changes).
    const measure = () => {
      segmentWidthRef.current = marqueeSegmentWidth(el.scrollWidth);
    };
    measure();
    let resizeObserver = null;
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(el);
      if (el.firstElementChild) resizeObserver.observe(el.firstElementChild);
    }

    let animationId = 0;
    const step = (timestamp) => {
      animationId = 0;
      if (!gate.isActive()) return;
      if (lastTimeRef.current == null) {
        lastTimeRef.current = timestamp;
      }
      const deltaTime = Math.min((timestamp - lastTimeRef.current) / 1000, MARQUEE_MAX_STEP_SECONDS);
      lastTimeRef.current = timestamp;

      // Without ResizeObserver (or before first layout) fall back to measuring until it is known.
      if (!resizeObserver || segmentWidthRef.current <= 0) measure();
      const segmentWidth = segmentWidthRef.current;

      // Auto-scroll when not paused by hover, manual scroll, or touch interaction
      if (
        !isHoveredRef.current &&
        !isTouchingRef.current &&
        !isManualScrollingRef.current &&
        !reducedMotion.matches &&
        !el.contains(document.activeElement) &&
        segmentWidth > 0
      ) {
        // Accumulated in JS ref so WebKit integer truncation doesn't freeze it
        scrollPosRef.current = advanceMarquee(scrollPosRef.current, segmentWidth, deltaTime);
        el.scrollLeft = scrollPosRef.current;
      }

      animationId = requestAnimationFrame(step);
    };
    const start = () => {
      if (!animationId && gate.isActive()) {
        lastTimeRef.current = null;
        animationId = requestAnimationFrame(step);
      }
    };
    const stop = () => {
      cancelAnimationFrame(animationId);
      animationId = 0;
    };
    // Pause while the tab is hidden or the reel is scrolled off-screen.
    const gate = createAnimationGate({ onPause: stop, onResume: () => { measure(); start(); } });
    const unobserveGate = observeAnimationGate(gate, el);
    start();

    return () => {
      clearTimeout(initTimer);
      if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);
      stop();
      unobserveGate();
      resizeObserver?.disconnect();
    };
  }, [resetToMiddle]);

  const handleManualScroll = (direction) => {
    const el = scrollRef.current;
    if (!el) return;

    isManualScrollingRef.current = true;
    if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);

    const scrollAmount = typeof window !== 'undefined' && window.innerWidth >= 640 ? 270 : 238; // one card width (256/224) + gap
    el.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth'
    });

    // Re-enable auto-scroll after smooth animation settles
    resumeTimeoutRef.current = setTimeout(() => {
      isManualScrollingRef.current = false;
      const segmentWidth = el.scrollWidth / 3;
      if (segmentWidth > 0) {
        if (el.scrollLeft >= segmentWidth * 2) {
          el.scrollLeft -= segmentWidth;
        } else if (el.scrollLeft <= segmentWidth * 0.1) {
          el.scrollLeft += segmentWidth;
        }
      }
      scrollPosRef.current = el.scrollLeft;
      lastTimeRef.current = null;
    }, 450);
  };

  const handleTouchStart = () => {
    isTouchingRef.current = true;
    if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);
  };

  const handleTouchEnd = () => {
    // Keep isTouchingRef true briefly to allow iOS momentum scrolling to settle
    if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);
    resumeTimeoutRef.current = setTimeout(() => {
      const el = scrollRef.current;
      if (el) {
        const segmentWidth = el.scrollWidth / 3;
        if (segmentWidth > 0) {
          if (el.scrollLeft >= segmentWidth * 2) {
            el.scrollLeft -= segmentWidth;
          } else if (el.scrollLeft <= segmentWidth * 0.1) {
            el.scrollLeft += segmentWidth;
          }
        }
        scrollPosRef.current = el.scrollLeft;
      }
      isTouchingRef.current = false;
      lastTimeRef.current = null;
    }, 1000);
  };

  const handleWheel = () => {
    if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);
    isManualScrollingRef.current = true;
    resumeTimeoutRef.current = setTimeout(() => {
      const el = scrollRef.current;
      if (el) {
        scrollPosRef.current = el.scrollLeft;
      }
      isManualScrollingRef.current = false;
      lastTimeRef.current = null;
    }, 800);
  };

  const handleScroll = () => {
    // Sync scrollPosRef from DOM only when the user is actively swiping or manually scrolling
    if (isTouchingRef.current || isManualScrollingRef.current) {
      if (scrollRef.current) {
        scrollPosRef.current = scrollRef.current.scrollLeft;
      }
    }
  };

  return (
    <div
      dir="ltr"
      className="w-full max-w-4xl mx-auto mt-0.5 sm:mt-2 px-1 sm:px-4 relative select-none group/carousel isolate"
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') {
          isHoveredRef.current = true;
        }
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') {
          isHoveredRef.current = false;
          lastTimeRef.current = null;
        }
      }}
    >
      {/* Scrollable Reel Track with transparent alpha mask */}
      <div
        ref={scrollRef}
        data-prompt-examples-track
        onScroll={handleScroll}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onWheel={handleWheel}
        className="overflow-x-auto overflow-y-hidden py-2 sm:py-4 px-6 sm:px-12 scrollbar-none prompt-examples-track"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch',
          maskImage: 'linear-gradient(to right, transparent 0%, black 48px, black calc(100% - 48px), transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 48px, black calc(100% - 48px), transparent 100%)'
        }}
      >
        <div className="flex gap-3 sm:gap-4 w-max group/track">
          {triplicatedExamples.map((item, idx) => {
            const isRTL = item.lang ? (item.lang === 'he' || item.lang === 'ar') : isAppRtl;
            const isLongPrompt = (item.prompt || '').length > 40;
            const skillTag = resolvePromptSkillTag(item);
            const SkillIcon = skillTag ? SKILL_TAG_ICONS[skillTag] : null;
            const langKey = isRTL ? 'he' : 'en';
            const i18nKey = skillTag ? `promptSkills.${skillTag}` : '';
            const translatedSkill = skillTag ? t(i18nKey) : '';
            const skillLabel = skillTag
              ? (translatedSkill && translatedSkill !== i18nKey
                  ? translatedSkill
                  : (SKILL_TAG_FALLBACK_LABELS[langKey]?.[skillTag] || SKILL_TAG_FALLBACK_LABELS.en[skillTag] || skillTag))
              : '';

            return (
              <button
                key={idx}
                type="button"
                disabled={isGenerating}
                onClick={() => onSelectPrompt?.(item.prompt)}
                dir={isRTL ? 'rtl' : 'ltr'}
                className={`group/card relative flex flex-col justify-between p-3.5 sm:p-4 rounded-2xl border transition-[transform,background-color,border-color,box-shadow,opacity] duration-200 ease-out-quart cursor-pointer prompt-example-card ${
                  isRTL ? 'text-right' : 'text-left'
                } w-56 sm:w-64 h-[112px] sm:h-[118px] shrink-0 hover:-translate-y-0.5 hover:z-10 bg-surface-raised border-line-strong/75 hover:border-accent/45 shadow-card hover:shadow-pop active:translate-y-0 active:scale-[0.99] disabled:opacity-30 disabled:hover:translate-y-0 disabled:hover:opacity-30 disabled:cursor-default`}
              >
                {/* Prompt Title */}
                <p
                  dir={isRTL ? 'rtl' : 'ltr'}
                  className={`text-ink font-medium transition-colors font-sans line-clamp-3 ${
                    isLongPrompt
                      ? 'text-xs sm:text-[13px] leading-snug'
                      : 'text-xs sm:text-body-sm leading-snug'
                  } ${isRTL ? 'text-right' : 'text-left'}`}
                >
                  {item.prompt}
                </p>

                {/* Prompt Skill Badge - dedicated bottom row, teaches the prompting technique */}
                {skillTag && (
                  <div className={`mt-auto pt-1 flex items-center ${isRTL ? 'justify-start' : 'justify-end'}`}>
                    <span
                      data-skill-tag={skillTag}
                      className="prompt-example-skill-badge inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-caption sm:text-caption font-medium bg-surface-sunken group-hover/card:bg-accent-soft/75 text-ink-muted group-hover/card:text-accent border border-line/90 group-hover/card:border-accent/25 transition-colors"
                    >
                      {SkillIcon && <SkillIcon className="w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0" />}
                      <span className="leading-none">{skillLabel}</span>
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Left Navigation Arrow */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleManualScroll('left');
        }}
        aria-label="Scroll left"
        className="absolute left-0 sm:left-1.5 top-1/2 -translate-y-1/2 z-20 w-7.5 h-7.5 sm:w-8 sm:h-8 rounded-full flex items-center justify-center bg-surface-raised hover:bg-surface-hover text-ink-muted hover:text-ink border border-line-strong/80 hover:border-line-strong shadow-card active:scale-95 transition-colors cursor-pointer pointer-events-auto"
      >
        <ChevronLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
      </button>

      {/* Right Navigation Arrow */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleManualScroll('right');
        }}
        aria-label="Scroll right"
        className="absolute right-0 sm:right-1.5 top-1/2 -translate-y-1/2 z-20 w-7.5 h-7.5 sm:w-8 sm:h-8 rounded-full flex items-center justify-center bg-surface-raised hover:bg-surface-hover text-ink-muted hover:text-ink border border-line-strong/80 hover:border-line-strong shadow-card active:scale-95 transition-colors cursor-pointer pointer-events-auto"
      >
        <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
      </button>
    </div>
  );
}

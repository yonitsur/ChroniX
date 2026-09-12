import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Split } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { PROMPT_EXAMPLES } from '../data/promptExamplesData';

export { PROMPT_EXAMPLES };

// Fisher-Yates array shuffle helper
function shuffleArray(arr) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Filter and shuffle prompt examples strictly by selected language:
 * If a preferred language is selected and has matching prompts, returns those.
 * Otherwise falls back to English prompts.
 */
export function getSmartShuffledExamples(preferredLang = null) {
  if (preferredLang) {
    const matched = PROMPT_EXAMPLES.filter((p) => p.lang === preferredLang);
    if (matched.length > 0) {
      return shuffleArray(matched);
    }
  }
  const english = PROMPT_EXAMPLES.filter((p) => p.lang === 'en');
  return shuffleArray(english.length > 0 ? english : PROMPT_EXAMPLES);
}

export default function PromptExamples({ onSelectPrompt, isGenerating = false }) {
  const { t, language } = useLanguage();
  const scrollRef = useRef(null);
  const scrollPosRef = useRef(0);
  const isHoveredRef = useRef(false);
  const isTouchingRef = useRef(false);
  const isManualScrollingRef = useRef(false);
  const resumeTimeoutRef = useRef(null);
  const lastTimeRef = useRef(null);

  // Initialize with examples strictly matching the current language
  const [examples, setExamples] = useState(() => getSmartShuffledExamples(language));

  // Triple array for seamless infinite wrapping in both directions
  const triplicatedExamples = useMemo(() => [
    ...examples,
    ...examples,
    ...examples
  ], [examples]);

  // Center in the middle set of cards initially or on language change
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
    setExamples(getSmartShuffledExamples(language));
    const timer = setTimeout(resetToMiddle, 60);
    return () => clearTimeout(timer);
  }, [language, resetToMiddle]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Small delay to ensure initial layout metrics are ready
    const initTimer = setTimeout(resetToMiddle, 60);

    let animationId;
    const step = (timestamp) => {
      if (lastTimeRef.current == null) {
        lastTimeRef.current = timestamp;
      }
      const deltaTime = Math.min((timestamp - lastTimeRef.current) / 1000, 0.1);
      lastTimeRef.current = timestamp;

      // Auto-scroll when not paused by hover, manual scroll, or touch interaction
      if (
        !isHoveredRef.current &&
        !isTouchingRef.current &&
        !isManualScrollingRef.current &&
        el.scrollWidth > 0
      ) {
        const segmentWidth = el.scrollWidth / 3;

        // If not initialized yet, start in the middle segment
        if (scrollPosRef.current === 0 && segmentWidth > 0) {
          scrollPosRef.current = segmentWidth;
          el.scrollLeft = segmentWidth;
        }

        // ~45px per second continuous gentle cruise speed (independent of 60Hz / 120Hz display rate)
        scrollPosRef.current += 45 * deltaTime;

        // If we crossed past the 2nd third, wrap seamlessly back by 1 segment
        if (scrollPosRef.current >= segmentWidth * 2) {
          scrollPosRef.current -= segmentWidth;
        } else if (scrollPosRef.current <= segmentWidth * 0.1) {
          scrollPosRef.current += segmentWidth;
        }

        // Assign to DOM (accumulated in JS ref so WebKit integer truncation doesn't freeze it)
        el.scrollLeft = scrollPosRef.current;
      }

      animationId = requestAnimationFrame(step);
    };

    animationId = requestAnimationFrame(step);

    return () => {
      clearTimeout(initTimer);
      if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);
      cancelAnimationFrame(animationId);
    };
  }, [resetToMiddle]);

  const handleManualScroll = (direction) => {
    const el = scrollRef.current;
    if (!el) return;

    isManualScrollingRef.current = true;
    if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);

    const scrollAmount = 220; // roughly one card width (208px) + gap (12px)
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
      className="w-full max-w-4xl mx-auto mt-0.5 sm:mt-1.5 px-1 sm:px-4 relative select-none group/carousel isolate"
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
        onScroll={handleScroll}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onWheel={handleWheel}
        className="overflow-x-auto overflow-y-hidden py-2 sm:py-3.5 px-6 sm:px-12 scrollbar-none"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch',
          maskImage: 'linear-gradient(to right, transparent 0%, black 48px, black calc(100% - 48px), transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 48px, black calc(100% - 48px), transparent 100%)'
        }}
      >
        <div className="flex gap-2 sm:gap-3 w-max group/track">
          {triplicatedExamples.map((item, idx) => {
            const isRTL = item.lang === 'he' || item.lang === 'ar';

            return (
              <button
                key={idx}
                type="button"
                disabled={isGenerating}
                onClick={() => onSelectPrompt?.(item.prompt)}
                title={item.prompt}
                dir={isRTL ? 'rtl' : 'ltr'}
                className={`group/card relative flex flex-col justify-between text-start p-2 sm:p-2.5 rounded-panel border transition-all duration-200 ease-out cursor-pointer ${
                  isRTL ? 'text-right' : 'text-left'
                } w-36 sm:w-52 h-[4.25rem] sm:h-24 shrink-0 opacity-70 hover:opacity-100 hover:scale-105 hover:z-10 bg-surface-raised/75 hover:bg-surface-raised border-line/75 hover:border-line-strong shadow-control/40 hover:shadow-card disabled:opacity-30 disabled:hover:scale-100 disabled:hover:opacity-30 disabled:cursor-not-allowed`}
              >
                {/* Prompt Title */}
                <p
                  className={`text-xs sm:text-[13px] text-ink group-hover/card:text-accent leading-snug font-medium transition-colors font-sans ${
                    item.isParallel ? 'line-clamp-2' : 'line-clamp-2 sm:line-clamp-3'
                  }`}
                >
                  {item.prompt}
                </p>

                {/* Card Bottom Metadata Bar - Only shown if parallel lanes tag applies */}
                {item.isParallel && (
                  <div className="flex items-center gap-1.5 justify-start w-full mt-auto pt-1" dir="ltr">
                    <span
                      className="text-[9.5px] sm:text-[10px] font-medium px-1.5 py-0.5 rounded border bg-surface-sunken/80 text-ink-muted border-line/70 flex items-center gap-1"
                    >
                      <Split className="w-2.5 h-2.5 shrink-0 text-ink-subtle" />
                      <span>{t('toolbar.parallelLanes')}</span>
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
        className="absolute left-0 sm:left-1.5 top-1/2 -translate-y-1/2 z-20 w-7.5 h-7.5 sm:w-8 sm:h-8 rounded-full flex items-center justify-center bg-surface-raised hover:bg-surface-hover text-ink-muted hover:text-ink border border-line shadow-control hover:shadow-card hover:scale-105 active:scale-95 transition-all cursor-pointer pointer-events-auto"
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
        className="absolute right-0 sm:right-1.5 top-1/2 -translate-y-1/2 z-20 w-7.5 h-7.5 sm:w-8 sm:h-8 rounded-full flex items-center justify-center bg-surface-raised hover:bg-surface-hover text-ink-muted hover:text-ink border border-line shadow-control hover:shadow-card hover:scale-105 active:scale-95 transition-all cursor-pointer pointer-events-auto"
      >
        <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
      </button>
    </div>
  );
}

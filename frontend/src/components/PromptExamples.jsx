import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Dices, Split } from 'lucide-react';
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
 * If 'he' is selected, returns ONLY Hebrew prompts.
 * If 'en' is selected, returns ONLY English prompts.
 */
export function getSmartShuffledExamples(preferredLang = null) {
  if (preferredLang === 'he') {
    const hebrew = PROMPT_EXAMPLES.filter((p) => p.lang === 'he');
    return shuffleArray(hebrew);
  }
  if (preferredLang === 'en') {
    const english = PROMPT_EXAMPLES.filter((p) => p.lang === 'en');
    return shuffleArray(english);
  }
  return shuffleArray(PROMPT_EXAMPLES);
}

export default function PromptExamples({ onSelectPrompt, isGenerating = false }) {
  const { t, language } = useLanguage();
  const scrollRef = useRef(null);
  const isHoveredRef = useRef(false);
  const isManualScrollingRef = useRef(false);
  const lastPickedPromptRef = useRef(null);

  // Initialize with examples strictly matching the current language
  const [examples, setExamples] = useState(() => getSmartShuffledExamples(language));

  useEffect(() => {
    setExamples(getSmartShuffledExamples(language));
    const el = scrollRef.current;
    if (el) {
      setTimeout(() => {
        const segmentWidth = el.scrollWidth / 3;
        if (segmentWidth > 0) {
          el.scrollLeft = segmentWidth;
        }
      }, 50);
    }
  }, [language]);

  // Triple array for seamless infinite wrapping in both directions
  const triplicatedExamples = useMemo(() => [
    ...examples,
    ...examples,
    ...examples
  ], [examples]);

  const handleSelectRandomPrompt = useCallback(() => {
    if (isGenerating || !onSelectPrompt) return;
    // Pick a random prompt avoiding immediately repeating the last selection and matching language if available
    const langPool = PROMPT_EXAMPLES.filter((p) => p.prompt !== lastPickedPromptRef.current && (language ? p.lang === language : true));
    const pool = langPool.length > 0 ? langPool : PROMPT_EXAMPLES.filter((p) => p.prompt !== lastPickedPromptRef.current);
    const candidateList = pool.length > 0 ? pool : PROMPT_EXAMPLES;
    const randomItem = candidateList[Math.floor(Math.random() * candidateList.length)];
    if (randomItem) {
      lastPickedPromptRef.current = randomItem.prompt;
      onSelectPrompt(randomItem.prompt, randomItem.detailLevel);
    }
  }, [isGenerating, onSelectPrompt, language]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Center in the middle set of cards initially
    const initMiddle = () => {
      const segmentWidth = el.scrollWidth / 3;
      if (segmentWidth > 0 && el.scrollLeft === 0) {
        el.scrollLeft = segmentWidth;
      }
    };

    // Small delay to ensure layout metrics are ready
    const initTimer = setTimeout(initMiddle, 50);

    let animationId;
    const step = () => {
      if (!isHoveredRef.current && !isManualScrollingRef.current && el.scrollWidth > 0) {
        el.scrollLeft += 0.75; // gentle continuous cruise speed

        const segmentWidth = el.scrollWidth / 3;
        // If we crossed past the 2nd third, wrap seamlessly back by 1 segment
        if (el.scrollLeft >= segmentWidth * 2) {
          el.scrollLeft -= segmentWidth;
        } else if (el.scrollLeft <= segmentWidth * 0.1) {
          el.scrollLeft += segmentWidth;
        }
      }
      animationId = requestAnimationFrame(step);
    };

    animationId = requestAnimationFrame(step);

    return () => {
      clearTimeout(initTimer);
      cancelAnimationFrame(animationId);
    };
  }, []);

  const handleManualScroll = (direction) => {
    const el = scrollRef.current;
    if (!el) return;

    isManualScrollingRef.current = true;
    const scrollAmount = 260; // roughly one card width + gap
    el.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth'
    });

    // Re-enable auto-scroll after smooth animation settles
    setTimeout(() => {
      isManualScrollingRef.current = false;
      const segmentWidth = el.scrollWidth / 3;
      if (el.scrollLeft >= segmentWidth * 2) {
        el.scrollLeft -= segmentWidth;
      } else if (el.scrollLeft <= segmentWidth * 0.1) {
        el.scrollLeft += segmentWidth;
      }
    }, 450);
  };

  return (
    <div
      className="w-full max-w-5xl mx-auto mt-2 sm:mt-3 px-2 sm:px-4 relative select-none group/carousel isolate"
      onMouseEnter={() => { isHoveredRef.current = true; }}
      onMouseLeave={() => { isHoveredRef.current = false; }}
    >
      {/* Scrollable Reel Track with transparent alpha mask */}
      <div
        ref={scrollRef}
        className="overflow-x-auto overflow-y-hidden py-2.5 sm:py-3 px-8 sm:px-12 scrollbar-none"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          maskImage: 'linear-gradient(to right, transparent 0%, black 48px, black calc(100% - 48px), transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 48px, black calc(100% - 48px), transparent 100%)'
        }}
      >
        <div className="flex gap-2.5 sm:gap-3 w-max group/track transition-all duration-300 opacity-100 scale-100">
          {triplicatedExamples.map((item, idx) => {
            const isHebrew = item.lang === 'he';

            return (
              <button
                key={idx}
                type="button"
                disabled={isGenerating}
                onClick={() => onSelectPrompt?.(item.prompt, item.detailLevel)}
                dir={isHebrew ? 'rtl' : 'ltr'}
                className={`group/card relative flex flex-col justify-between text-start p-3 sm:p-3.5 rounded-lg sm:rounded-xl border transition-all duration-200 ease-out cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  isHebrew ? 'text-right' : 'text-left'
                } w-56 sm:w-64 h-28 sm:h-32 shrink-0 bg-white/95 dark:bg-slate-900/90 hover:bg-slate-50/90 dark:hover:bg-slate-850 border-slate-200/90 dark:border-slate-800/90 hover:border-slate-400/80 dark:hover:border-slate-600/80 hover:-translate-y-0.5 hover:shadow-md shadow-2xs group-hover/track:opacity-85 hover:!opacity-100 backdrop-blur-md`}
              >
                {/* Prompt Title at the Top */}
                <p
                  className={`text-[11.5px] sm:text-xs text-slate-800 dark:text-slate-100 group-hover/card:text-sky-600 dark:group-hover/card:text-sky-400 leading-snug line-clamp-3 font-medium transition-colors ${
                    isHebrew ? 'font-sans' : 'font-sans'
                  }`}
                >
                  {item.prompt}
                </p>

                {/* Card Bottom Metadata Bar - Always LTR for uniform left alignment */}
                <div className="flex items-center gap-1.5 justify-start w-full mt-auto pt-1.5" dir="ltr">
                  <span
                    className={`text-[9.5px] sm:text-[10px] font-medium px-1.5 sm:px-2 py-0.5 rounded border ${
                      item.detailLevel === 'deep_dive'
                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        : item.detailLevel === 'overview'
                        ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border-sky-200/70 dark:border-sky-800/60'
                        : 'bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border-slate-200/60 dark:border-slate-700/50'
                    }`}
                  >
                    {item.detailLevel === 'deep_dive'
                      ? t('toolbar.detailDeep')
                      : item.detailLevel === 'overview'
                      ? t('toolbar.detailOverview')
                      : t('toolbar.detailStandard')}
                  </span>

                  {item.isParallel && (
                    <span
                      className="text-[9.5px] sm:text-[10px] font-medium px-1.5 py-0.5 rounded border bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-slate-200/80 dark:border-slate-700/60 flex items-center gap-1"
                    >
                      <Split className="w-2.5 h-2.5 shrink-0 text-slate-500 dark:text-slate-400" />
                      <span>{t('toolbar.parallelLanes')}</span>
                    </span>
                  )}
                </div>
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
        className="absolute left-0 sm:left-1.5 top-1/2 -translate-y-1/2 z-20 w-7.5 h-7.5 sm:w-8 sm:h-8 rounded-full flex items-center justify-center bg-white/95 dark:bg-slate-900/95 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md hover:scale-105 active:scale-95 transition-all cursor-pointer pointer-events-auto"
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
        className="absolute right-0 sm:right-1.5 top-1/2 -translate-y-1/2 z-20 w-7.5 h-7.5 sm:w-8 sm:h-8 rounded-full flex items-center justify-center bg-white/95 dark:bg-slate-900/95 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md hover:scale-105 active:scale-95 transition-all cursor-pointer pointer-events-auto"
      >
        <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
      </button>

      {/* Random prompt selection button */}
      <div className="flex justify-center mt-2">
        <button
          type="button"
          onClick={handleSelectRandomPrompt}
          disabled={isGenerating}
          title={t('home.surpriseMe')}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-white/90 dark:bg-slate-900/90 hover:bg-white dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 shadow-2xs hover:shadow-xs transition-all duration-200 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed group"
        >
          <Dices className="w-3.5 h-3.5 text-sky-500 group-hover:rotate-45 transition-transform duration-300 shrink-0" />
          <span>{t('home.surpriseMe')}</span>
        </button>
      </div>
    </div>
  );
}

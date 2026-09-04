import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Shuffle } from 'lucide-react';

export const PROMPT_EXAMPLES = [
  // 1. Hebrew - Standard
  {
    prompt: 'מצרים העתיקה: פרעונים, פירמידות והשושלות הגדולות',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 2. English - Deep
  {
    prompt: 'The Space Race (1955–1975): Comparative timeline contrasting Soviet milestones with NASA achievements',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 3. Hebrew - Deep
  {
    prompt: 'תולדות הציונות והקמת מדינת ישראל: מהקונגרס הציוני בבזל והצהרת בלפור, דרך גלי העלייה ומחתרות היישוב, ועד להחלטת כ"ט בנובמבר והכרזת העצמאות',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 4. English - Standard
  {
    prompt: 'World War II: Major Battles and Turning Points (1939-1945)',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 5. Hebrew - Standard
  {
    prompt: 'עלילת הארי פוטר: מהצלקת בדרך פריווט ואבן החכמים ועד לקרב על הוגוורטס והבסת וולדמורט',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 6. English - Deep
  {
    prompt: 'Ancient Egypt: Complete dynastic history from the Old Kingdom pyramids to the New Kingdom empires of Tutankhamun and Ramesses II',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 7. Hebrew - Deep
  {
    prompt: 'יוון העתיקה: מעליית ערי-המדינה ואתונה הדמוקרטית, דרך מלחמות פרס-יוון והתור הפילוסופי, ועד למלחמה הפלופונסית וכיבושי אלכסנדר מוקדון',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 8. English - Standard
  {
    prompt: 'The Viking Age: Raids, Trade and Exploration — From Lindisfarne to Normandy, Kievan Rus and Vinland',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 9. Hebrew - Standard
  {
    prompt: 'דינוזאורים: שלבי ההתפתחות לאורך תורי הטריאס, היורה והקרטיקון ועד לאירוע ההכחדה הגדול',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 10. English - Deep
  {
    prompt: 'The Industrial Revolution: Multi-phase chronology from Watt\'s steam engine to railways, Bessemer steel, and electrical power grids',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 11. Hebrew - Deep
  {
    prompt: 'האבולוציה של האדם: מההומינידים המוקדמים באפריקה (אוסטרלופיתקוס, לוסי), דרך הומו הביליס וארקטוס, ועד להומו סאפיינס והאדם הניאנדרטלי',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 12. English - Standard
  {
    prompt: 'Dinosaurs: Triassic, Jurassic and Cretaceous Eras — Rise of apex predators and the K-Pg extinction event',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 13. Hebrew - Standard
  {
    prompt: 'פרהיסטוריה בארץ ישראל: מהאדם הקדמון בעובדיה ומערות הכרמל ועד למהפכה החקלאית והתרבות הנאטופית',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 14. English - Deep
  {
    prompt: "The Targaryen Dynasty: Complete chronology from Aegon's Conquest to Robert's Rebellion",
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 15. Hebrew - Deep
  {
    prompt: 'תקופת בית ראשון ומלכי יהודה וישראל: ציר זמן מקביל בין מלכי יהודה למלכי ישראל, מפלג הממלכה ועד חורבן שומרון וחורבן בית המקדש הראשון',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 16. English - Standard
  {
    prompt: 'History of Aviation: From Wright Brothers to Commercial Jet Age',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 17. Hebrew - Standard
  {
    prompt: 'הנחיתה על הירח ומבצעי אפולו של נאס"א',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 18. English - Deep
  {
    prompt: 'History of Artificial Intelligence: From Turing Test and Dartmouth Workshop to modern LLMs and Generative AI',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 19. Hebrew - Deep
  {
    prompt: 'אירועים ותקופות גאולוגיים: מהפרקמבריון והמפץ הקמבריוני, דרך עידן הפלאוזואיקון והמזוזואיקון, ועד לקנוזואיקון ועידן הקרח',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 20. English - Standard
  {
    prompt: 'Timeline of the Universe: Cosmic chronology from the Big Bang and inflation to star formation, the Solar System, and humanity',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 21. Hebrew - Standard
  {
    prompt: 'מגילות ים המלח, קומראן ומצדה: כת מדבר יהודה, גניזת המגילות, המרד הגדול ונפילת מצדה',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 22. English - Deep
  {
    prompt: 'History of Rock and Roll: Evolution across genres from 1950s rhythm & blues to the British Invasion, Psychedelic Rock, Punk, Grunge and Indie',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 23. Hebrew - Deep
  {
    prompt: 'מבצעי העלייה הגדולים לישראל במאה ה-20: חלוקה לנתיבים עבור עליות המזרח, אתיופיה וברה"מ לשעבר',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 24. English - Standard
  {
    prompt: 'The Golden Age of Islam: Scientific, medical and philosophical breakthroughs from Baghdad to Al-Andalus',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 25. Hebrew - Deep
  {
    prompt: 'מהלך מלחמת יום הכיפורים (אוקטובר 1973): ציר זמן מפורט המחולק לחזית סיני מול חזית רמת הגולן',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 26. English - Standard
  {
    prompt: "Harry Potter: Chronological storyline from the Philosopher's Stone to the Battle of Hogwarts",
    detailLevel: 'standard',
    lang: 'en'
  },
  // 27. Hebrew - Deep
  {
    prompt: 'הסכסוך הישראלי-פלסטיני: ממאורעות תרפ"ט ותוכנית החלוקה, דרך מלחמת ששת הימים, הסכמי אוסלו והאינתיפאדות, ועד להסכמי אברהם וימינו',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 28. English - Standard
  {
    prompt: 'Marvel Cinematic Universe: The Avengers and the Infinity Saga (2008–2019)',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 29. English - Deep
  {
    prompt: 'History of Quantum Mechanics: From Planck\'s radiation and Einstein\'s photons, through Heisenberg and Schrödinger, to quantum entanglement and computers',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 30. Hebrew - Deep (Comparative / Parallel)
  {
    prompt: 'מה קרה באימפריה הרומית במקביל למה שקרה בסין העתיקה (שושלת האן)? ציר זמן השוואתי מקביל של שתי אימפריות-העל באותן מאות שנים',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 31. English - Standard (Comparative / Parallel)
  {
    prompt: 'The Roman Empire vs. Han Dynasty China: Parallel timeline comparing Eurasia\'s twin classical superpowers (200 BCE – 220 CE)',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 32. Hebrew - Standard (Comparative / Parallel)
  {
    prompt: 'ציר זמן מקביל: הרנסאנס באירופה במקביל לתור הזהב של האימפריה העות\'מאנית (1450–1600)',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 33. English - Standard
  {
    prompt: 'Rise and Fall of the Roman Empire: From Republic to Fall of Rome',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 34. Hebrew - Deep (Comparative / Parallel)
  {
    prompt: 'המהפכה האמריקאית מול המהפכה הצרפתית: ציר זמן מקביל של שני המאבקים הגדולים לחירות ודמוקרטיה (1775–1799)',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 35. English - Deep
  {
    prompt: 'The Manhattan Project and Cold War Nuclear Proliferation (1939–1962): From Trinity test to the Cuban Missile Crisis',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 36. English - Standard (Comparative / Parallel)
  {
    prompt: 'American Revolution vs. French Revolution: Parallel chronology of two Atlantic struggles for liberty (1775–1799)',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 37. English - Deep (Comparative / Parallel)
  {
    prompt: 'World War II Parallel Theaters: European Theater vs. Pacific Theater — Simultaneous timeline contrasting campaigns and turning points (1939–1945)',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 38. English - Deep
  {
    prompt: 'Human Evolution from the earliest hominids to Homo sapiens',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
];

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
 * Smart balanced shuffle:
 * Randomizes all prompt examples while balancing Hebrew and English prompts
 * so users always see both languages upfront in a fresh random order every time.
 */
export function getSmartShuffledExamples() {
  const hebrew = shuffleArray(PROMPT_EXAMPLES.filter((p) => p.lang === 'he'));
  const english = shuffleArray(PROMPT_EXAMPLES.filter((p) => p.lang === 'en'));

  const merged = [];
  let h = 0;
  let e = 0;
  // 50% chance to start with Hebrew or English
  let pickHebrewNext = Math.random() < 0.5;

  while (h < hebrew.length || e < english.length) {
    if (pickHebrewNext && h < hebrew.length) {
      merged.push(hebrew[h++]);
      if (e < english.length) pickHebrewNext = false;
    } else if (!pickHebrewNext && e < english.length) {
      merged.push(english[e++]);
      // English has 24 items vs Hebrew's 14, so allow a 2nd English card with ~45% chance
      if (e < english.length && (english.length - e) > (hebrew.length - h) && Math.random() < 0.45) {
        merged.push(english[e++]);
      }
      if (h < hebrew.length) pickHebrewNext = true;
    } else if (h < hebrew.length) {
      merged.push(hebrew[h++]);
    } else if (e < english.length) {
      merged.push(english[e++]);
    }
  }

  return merged;
}

export default function PromptExamples({ onSelectPrompt, isGenerating = false }) {
  const scrollRef = useRef(null);
  const isHoveredRef = useRef(false);
  const isManualScrollingRef = useRef(false);
  const [isShuffling, setIsShuffling] = useState(false);

  // Initialize with a fresh smart-shuffled order every time the component mounts
  const [examples, setExamples] = useState(() => getSmartShuffledExamples());

  // Triple array for seamless infinite wrapping in both directions
  const triplicatedExamples = useMemo(() => [
    ...examples,
    ...examples,
    ...examples
  ], [examples]);

  const handleShuffle = useCallback(() => {
    setIsShuffling(true);
    setExamples(getSmartShuffledExamples());
    setTimeout(() => {
      setIsShuffling(false);
    }, 450);
  }, []);

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
    const scrollAmount = 320; // roughly one card width + gap
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
      className="w-full max-w-6xl mx-auto mt-4 px-2 sm:px-4 relative select-none group/carousel"
      onMouseEnter={() => { isHoveredRef.current = true; }}
      onMouseLeave={() => { isHoveredRef.current = false; }}
    >
      {/* Edge gradient fade masks for that infinite cinema look */}
      <div className="absolute left-0 top-0 bottom-0 w-16 sm:w-24 bg-gradient-to-r from-slate-100 dark:from-slate-950 to-transparent z-30 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-16 sm:w-24 bg-gradient-to-l from-slate-100 dark:from-slate-950 to-transparent z-30 pointer-events-none" />

      {/* Scrollable Reel Track */}
      <div
        ref={scrollRef}
        className="overflow-x-auto overflow-y-hidden py-4 px-10 sm:px-14 scrollbar-none"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        <div
          className={`flex gap-3.5 w-max group/track transition-all duration-300 ${
            isShuffling ? 'opacity-40 scale-[0.99]' : 'opacity-100 scale-100'
          }`}
        >
          {triplicatedExamples.map((item, idx) => {
            const isHebrew = item.lang === 'he';

            return (
              <button
                key={idx}
                type="button"
                disabled={isGenerating}
                onClick={() => onSelectPrompt?.(item.prompt, item.detailLevel)}
                dir={isHebrew ? 'rtl' : 'ltr'}
                className={`group/card relative flex flex-col justify-between text-start p-4 sm:p-5 rounded-xl border transition-all duration-200 ease-out cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  isHebrew ? 'text-right' : 'text-left'
                } w-72 sm:w-80 h-40 sm:h-44 shrink-0 bg-white/95 dark:bg-slate-900/90 hover:bg-slate-50/90 dark:hover:bg-slate-850 border-slate-200/90 dark:border-slate-800/90 hover:border-slate-400/80 dark:hover:border-slate-600/80 hover:-translate-y-1 hover:shadow-lg shadow-2xs group-hover/track:opacity-85 hover:!opacity-100`}
              >
                {/* Prompt Title at the Top */}
                <p
                  className={`text-xs sm:text-[13px] text-slate-800 dark:text-slate-100 group-hover/card:text-sky-600 dark:group-hover/card:text-sky-400 leading-relaxed line-clamp-4 font-medium transition-colors ${
                    isHebrew ? 'font-sans' : 'font-sans'
                  }`}
                >
                  {item.prompt}
                </p>

                {/* Card Bottom Metadata Bar - Always LTR for uniform left alignment */}
                <div className="flex items-center justify-start w-full mt-auto pt-2" dir="ltr">
                  <span
                    className={`text-[10px] font-medium px-2 py-0.5 rounded-md border ${
                      item.detailLevel === 'deep_dive'
                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        : 'bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border-slate-200/60 dark:border-slate-700/50'
                    }`}
                  >
                    {item.detailLevel === 'deep_dive' ? 'Deep Dive' : 'Standard'}
                  </span>
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
        className="absolute left-1 sm:left-3 top-1/2 -translate-y-1/2 z-50 w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center bg-white/95 dark:bg-slate-900/95 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 transition-all cursor-pointer pointer-events-auto"
      >
        <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
      </button>

      {/* Right Navigation Arrow */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleManualScroll('right');
        }}
        aria-label="Scroll right"
        className="absolute right-1 sm:right-3 top-1/2 -translate-y-1/2 z-50 w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center bg-white/95 dark:bg-slate-900/95 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 transition-all cursor-pointer pointer-events-auto"
      >
        <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
      </button>

      {/* Subtle manual shuffle button */}
      <div className="flex justify-center mt-3">
        <button
          type="button"
          onClick={handleShuffle}
          disabled={isGenerating}
          title="Shuffle prompts"
          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-white/90 dark:bg-slate-900/90 hover:bg-white dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 shadow-2xs hover:shadow-xs transition-all duration-200 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Shuffle
            className={`w-3.5 h-3.5 transition-transform duration-500 ${
              isShuffling ? 'rotate-180 text-sky-500' : ''
            }`}
          />
          <span>Shuffle</span>
        </button>
      </div>
    </div>
  );
}

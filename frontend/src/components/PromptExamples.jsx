import React, { useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

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
  // 30. English - Standard
  {
    prompt: 'Rise and Fall of the Roman Empire: From Republic to Fall of Rome',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 31. English - Deep
  {
    prompt: 'The Manhattan Project and Cold War Nuclear Proliferation (1939–1962): From Trinity test to the Cuban Missile Crisis',
    detailLevel: 'deep_dive',
    lang: 'en'
  }
];

export default function PromptExamples({ onSelectPrompt, isGenerating = false }) {
  const scrollRef = useRef(null);
  const isHoveredRef = useRef(false);
  const isManualScrollingRef = useRef(false);

  // Triple array for seamless infinite wrapping in both directions
  const triplicatedExamples = [
    ...PROMPT_EXAMPLES,
    ...PROMPT_EXAMPLES,
    ...PROMPT_EXAMPLES
  ];

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
      <div className="absolute left-0 top-0 bottom-0 w-16 sm:w-24 bg-gradient-to-r from-slate-100 dark:from-slate-950 to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-16 sm:w-24 bg-gradient-to-l from-slate-100 dark:from-slate-950 to-transparent z-10 pointer-events-none" />

      {/* Left Navigation Arrow */}
      <button
        type="button"
        onClick={() => handleManualScroll('left')}
        aria-label="Scroll left"
        className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-20 w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center bg-white/90 dark:bg-slate-900/90 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700/80 shadow-lg hover:shadow-xl hover:scale-110 active:scale-95 transition-all cursor-pointer opacity-80 group-hover/carousel:opacity-100"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      {/* Right Navigation Arrow */}
      <button
        type="button"
        onClick={() => handleManualScroll('right')}
        aria-label="Scroll right"
        className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-20 w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center bg-white/90 dark:bg-slate-900/90 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700/80 shadow-lg hover:shadow-xl hover:scale-110 active:scale-95 transition-all cursor-pointer opacity-80 group-hover/carousel:opacity-100"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      {/* Scrollable Reel Track */}
      <div
        ref={scrollRef}
        className="overflow-x-auto overflow-y-hidden py-4 px-8 scrollbar-none"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        <div className="flex gap-3.5 w-max group/track">
          {triplicatedExamples.map((item, idx) => {
            const isHebrew = item.lang === 'he';

            return (
              <button
                key={idx}
                type="button"
                disabled={isGenerating}
                onClick={() => onSelectPrompt?.(item.prompt, item.detailLevel)}
                dir={isHebrew ? 'rtl' : 'ltr'}
                className={`group/card relative flex flex-col justify-between text-start p-4 rounded-2xl border transition-all duration-250 ease-out cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  isHebrew ? 'text-right' : 'text-left'
                } w-64 sm:w-72 h-36 sm:h-40 shrink-0 bg-white/95 dark:bg-slate-900/90 hover:bg-white dark:hover:bg-slate-850 border-slate-200 dark:border-slate-800/90 hover:border-sky-400 dark:hover:border-sky-400 hover:scale-105 sm:hover:scale-108 hover:-translate-y-1 hover:z-30 hover:shadow-2xl hover:shadow-sky-500/20 shadow-xs group-hover/track:opacity-75 hover:!opacity-100`}
              >
                <p className="text-xs sm:text-[13px] text-slate-700 dark:text-slate-200 group-hover/card:text-slate-950 dark:group-hover/card:text-white leading-relaxed line-clamp-3 font-medium transition-colors">
                  {item.prompt}
                </p>
                <div className="flex items-center justify-between text-[11px] pt-2 border-t border-slate-100 dark:border-slate-800/60 mt-auto w-full">
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${
                      item.detailLevel === 'deep_dive'
                        ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border-indigo-200/70 dark:border-indigo-800/50'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700/60'
                    }`}
                  >
                    {item.detailLevel === 'deep_dive' ? '🔬 Deep' : '⚡ Standard'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

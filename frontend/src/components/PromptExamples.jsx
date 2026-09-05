import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Shuffle } from 'lucide-react';

export const PROMPT_EXAMPLES = [
  // 1. Hebrew - Overview
  {
    prompt: 'מצרים העתיקה: סקירה של ציוני הדרך והשושלות הגדולות מהפירמידות ועד לקלאופטרה',
    detailLevel: 'overview',
    lang: 'he'
  },
  // 2. English - Multi-lane (Space Race)
  {
    prompt: 'The Space Race (1955–1975), divided into separate swimlanes for the Soviet Space Program and NASA',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 3. Hebrew - Deep
  {
    prompt: 'תולדות הציונות והקמת מדינת ישראל: מהקונגרס הציוני בבזל והצהרת בלפור, דרך גלי העלייה ומחתרות היישוב, ועד להחלטת כ"ט בנובמבר והכרזת העצמאות',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 4. English - Multi-lane (WWII)
  {
    prompt: 'World War II (1939–1945), divided into parallel time lanes for the European Theater, Pacific Theater, and Diplomatic Summits',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 5. Hebrew - Overview
  {
    prompt: 'עלילת הארי פוטר: סקירה תמציתית של שבע שנות הלימוד מדרך פריווט ועד לקרב על הוגוורטס',
    detailLevel: 'overview',
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
  // 8. English - Overview
  {
    prompt: 'The Viking Age: Quick overview of key raids, voyages, and settlements from Lindisfarne to Vinland',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 9. Hebrew - Multi-lane (Dinosaurs)
  {
    prompt: 'דינוזאורים: שלבי ההתפתחות לאורך הטריאס, היורה והקרטיקון בחלוקה למסלולים נפרדים עבור תרופודים (טורפים), זאורופודים (ענקים צמחוניים) ובעלי אגן עוף',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 10. English - Multi-lane (Industrial Revolution)
  {
    prompt: 'The Industrial Revolution, divided into separate lanes for Technological Inventions, Steam & Transportation, and Labor Movements',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 11. Hebrew - Overview
  {
    prompt: 'האבולוציה של האדם: סקירת אבני הדרך המרכזיות מלוסי והאוסטרלופיתקוס ועד להומו סאפיינס והניאנדרטלים',
    detailLevel: 'overview',
    lang: 'he'
  },
  // 12. English - Overview
  {
    prompt: 'Dinosaurs: High-level overview of the Triassic, Jurassic, and Cretaceous eras leading to the K-Pg extinction event',
    detailLevel: 'overview',
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
  // 15. Hebrew - Multi-lane (First Temple Kings)
  {
    prompt: 'תקופת בית ראשון: ציר זמן בחלוקה לשני מסלולי זמן מקבילים עבור מלכי יהודה מול מלכי ישראל, מפלג הממלכה ועד חורבן בית ראשון',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 16. English - Overview
  {
    prompt: 'History of Aviation: Milestone overview from the Wright Brothers at Kitty Hawk to commercial jets and space exploration',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 17. Hebrew - Overview
  {
    prompt: 'תוכנית אפולו והנחיתה על הירח: סקירה מהירה של טיסות המפתח מניסויי אפולו הראשונים ועד אפולו 11 ו-17',
    detailLevel: 'overview',
    lang: 'he'
  },
  // 18. English - Multi-lane (AI & Computing)
  {
    prompt: 'History of Artificial Intelligence and Computing, divided into parallel swimlanes for Hardware Systems, Core Algorithms & Models, and Society & Ethics',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 19. Hebrew - Deep
  {
    prompt: 'אירועים ותקופות גאולוגיים: מהפרקמבריון והמפץ הקמבריוני, דרך עידן הפלאוזואיקון והמזוזואיקון, ועד לקנוזואיקון ועידן הקרח',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 20. English - Overview
  {
    prompt: 'Timeline of the Universe: Fast cosmic overview from the Big Bang and star formation to our Solar System and humanity',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 21. Hebrew - Standard
  {
    prompt: 'מגילות ים המלח, קומראן ומצדה: כת מדבר יהודה, גניזת המגילות, המרד הגדול ונפילת מצדה',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 22. English - Multi-lane (Rock & Roll)
  {
    prompt: 'History of Rock Music: Multi-lane timeline with separate tracks for Classic Rock, Punk & Post-Punk, and Grunge / 90s Alternative',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 23. Hebrew - Multi-lane (Aliyah Operations)
  {
    prompt: 'מבצעי העלייה הגדולים לישראל במאה ה-20: בחלוקה למסלולים נפרדים עבור עליות המזרח, מבצעי עליית יהודי אתיופיה ועליית ברה"מ',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 24. English - Overview
  {
    prompt: 'The Golden Age of Islam: Overview of major scientific, medical, and astronomical breakthroughs from Baghdad to Córdoba',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 25. Hebrew - Multi-lane (Yom Kippur War)
  {
    prompt: 'מהלך מלחמת יום הכיפורים (אוקטובר 1973): בחלוקה לשני מסלולים מקבילים עבור חזית הדרום (סיני) וחזית הצפון (רמת הגולן)',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 26. English - Overview
  {
    prompt: "Harry Potter Storyline: Overview of the major plot turning points across Harry's seven years at Hogwarts",
    detailLevel: 'overview',
    lang: 'en'
  },
  // 27. Hebrew - Deep
  {
    prompt: 'הסכסוך הישראלי-פלסטיני: ממאורעות תרפ"ט ותוכנית החלוקה, דרך מלחמת ששת הימים, הסכמי אוסלו והאינתיפאדות, ועד להסכמי אברהם וימינו',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 28. English - Overview
  {
    prompt: 'Marvel Cinematic Universe: Overview of pivotal milestone events across Phase 1 to Phase 3 of the Infinity Saga',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 29. English - Deep
  {
    prompt: "History of Quantum Mechanics: From Planck's radiation and Einstein's photons, through Heisenberg and Schrödinger, to quantum entanglement and computers",
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 30. Hebrew - Multi-lane (Rome vs Han)
  {
    prompt: 'האימפריה הרומית ושושלת האן בסין במקביל: ציר זמן בחלוקה לשני מסלולים מקבילים להשוואת אימפריות העל בעת העתיקה (200 לפנה"ס – 220 לספירה)',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 31. English - Multi-lane (Rome vs Han)
  {
    prompt: 'The Roman Empire vs. Han Dynasty China (200 BCE – 220 CE), divided into two parallel lanes comparing the twin classical superpowers',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 32. Hebrew - Multi-lane (Renaissance vs Ottoman)
  {
    prompt: "ציר זמן בחלוקה למסלולים מקבילים: הרנסאנס באירופה מול תור הזהב של האימפריה העות'מאנית (1450–1600)",
    detailLevel: 'standard',
    lang: 'he'
  },
  // 33. English - Overview
  {
    prompt: 'Rise and Fall of the Roman Empire: Concise overview of defining eras from the Roman Republic to the Fall of Constantinople',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 34. Hebrew - Multi-lane (American vs French Revolution)
  {
    prompt: 'המהפכה האמריקאית מול המהפכה הצרפתית: ציר זמן בחלוקה לשני מסלולים נפרדים עבור שני המאבקים הגדולים לחירות (1775–1799)',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 35. English - Deep
  {
    prompt: 'The Manhattan Project and Cold War Nuclear Proliferation (1939–1962): From Trinity test to the Cuban Missile Crisis',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 36. English - Multi-lane (American vs French Revolution)
  {
    prompt: 'American Revolution vs. French Revolution (1775–1799), divided into two parallel swimlanes contrasting both revolutions',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 37. English - Multi-lane (WWII Theaters)
  {
    prompt: 'World War II (1939–1945), divided into separate swimlanes for the European Theater and the Pacific Theater',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 38. English - Overview
  {
    prompt: 'Human Evolution: Overview of pivotal milestone hominids from Australopithecus to Neanderthals and modern Homo sapiens',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 39. Hebrew - Overview (Israeli History)
  {
    prompt: 'תולדות מדינת ישראל: סקירה של אירועים מכוננים מהכרזת העצמאות ועד ימינו',
    detailLevel: 'overview',
    lang: 'he'
  },
  // 40. English - Overview (The Beatles)
  {
    prompt: 'The Beatles: Overview of essential career milestones from Hamburg and the Cavern Club to Beatlemania, Sgt. Pepper and the Rooftop Concert',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 41. Hebrew - Overview (Scientific Revolution)
  {
    prompt: 'המהפכה המדעית: סקירת התגליות הגדולות מקופרניקוס וגלילאו ועד לאייזק ניוטון',
    detailLevel: 'overview',
    lang: 'he'
  },
  // 42. English - Overview (Cold War)
  {
    prompt: 'The Cold War: Overview of defining crises from the Berlin Airlift and Cuban Missile Crisis to the Fall of the Berlin Wall',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 43. Hebrew - Multi-lane (Israeli Music)
  {
    prompt: 'תולדות המוזיקה הישראלית: ציר זמן בחלוקה למסלולים עבור שירי ארץ ישראל והלהקות הצבאיות, רוק ישראלי, ומוזיקה מזרחית ים-תיכונית',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 44. English - Overview (Renaissance)
  {
    prompt: 'The European Renaissance: High-level overview of milestone breakthroughs in art, architecture, and humanism from Florence to Rome',
    detailLevel: 'overview',
    lang: 'en'
  }
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
                        : item.detailLevel === 'overview'
                        ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border-sky-200/70 dark:border-sky-800/60'
                        : 'bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border-slate-200/60 dark:border-slate-700/50'
                    }`}
                  >
                    {item.detailLevel === 'deep_dive'
                      ? 'Deep Dive'
                      : item.detailLevel === 'overview'
                      ? 'Overview'
                      : 'Standard'}
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

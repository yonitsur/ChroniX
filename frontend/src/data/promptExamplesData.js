// Curated, pedagogy-driven prompt examples for ChroniX (English & Hebrew) across Classic and Kids modes.
// Designed with ZERO topic overlap against the canonical Public Library: every card teaches a concrete
// prompting superpower (skillTag) and acts as an editable blueprint users can adapt to their own curiosity.

export const PROMPT_SKILL_TAGS = [
  'parallel',
  'microTime',
  'lens',
  'scope',
  'fiction',
  'journey',
  'microHistory',
];

export function resolvePromptSkillTag(item) {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.skillTag === 'string' && item.skillTag) return item.skillTag;
  if (item.isParallel) return 'parallel';
  return null;
}

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
 * Filter and stratified-shuffle prompt examples strictly by selected language and content mode.
 * Interleaves `skillTag` buckets round-by-round so adjacent cards (including across the
 * infinite-carousel wrap seam) showcase distinct prompting techniques.
 */
export function getSmartShuffledExamples(preferredLang = null, limit = null, contentMode = 'classic') {
  const sourceList = contentMode === 'kids'
    ? KIDS_PROMPT_EXAMPLES
    : PROMPT_EXAMPLES;

  let matched = [];
  if (preferredLang) {
    matched = sourceList.filter((p) => p.lang === preferredLang);
  }
  if (matched.length === 0) {
    matched = sourceList.filter((p) => p.lang === 'en');
  }
  const pool = matched.length > 0 ? matched : sourceList;
  if (pool.length <= 1) return [...pool];

  // Group items by skillTag and shuffle within each bucket
  const buckets = new Map();
  for (const item of pool) {
    const key = resolvePromptSkillTag(item) || '__other__';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }

  if (buckets.size <= 1) {
    const flat = shuffleArray(pool);
    return limit && limit < flat.length ? flat.slice(0, limit) : flat;
  }

  for (const [key, list] of buckets.entries()) {
    buckets.set(key, shuffleArray(list));
  }

  const result = [];
  let firstTag = null;
  let lastTag = null;

  while (true) {
    const activeKeys = [];
    let maxRemaining = 0;
    for (const [key, list] of buckets.entries()) {
      if (list.length > 0) {
        activeKeys.push(key);
        if (list.length > maxRemaining) maxRemaining = list.length;
      }
    }
    if (activeKeys.length === 0) break;

    const roundOrder = shuffleArray(activeKeys);

    // Prevent back-to-back identical skillTag across round boundaries
    if (lastTag && roundOrder.length > 1 && roundOrder[0] === lastTag) {
      const swapIdx = roundOrder.findIndex((k) => k !== lastTag);
      if (swapIdx > 0) {
        [roundOrder[0], roundOrder[swapIdx]] = [roundOrder[swapIdx], roundOrder[0]];
      }
    }

    // On the final round, also prevent the last card from matching the very first card's skillTag
    // so triplicating `[...examples, ...examples, ...examples]` has no duplicate seam.
    const isFinalRound = maxRemaining === 1;
    if (isFinalRound && firstTag && roundOrder.length > 1 && roundOrder[roundOrder.length - 1] === firstTag) {
      for (let i = roundOrder.length - 2; i >= 0; i--) {
        if (roundOrder[i] !== firstTag && (i > 0 || roundOrder[roundOrder.length - 1] !== lastTag)) {
          const lastIdx = roundOrder.length - 1;
          [roundOrder[i], roundOrder[lastIdx]] = [roundOrder[lastIdx], roundOrder[i]];
          break;
        }
      }
    }

    for (const key of roundOrder) {
      const nextItem = buckets.get(key).pop();
      if (result.length === 0) firstTag = key;
      result.push(nextItem);
      lastTag = key;
    }
  }

  if (limit && limit > 0 && limit < result.length) {
    return result.slice(0, limit);
  }
  return result;
}

// ============================================================================
// 1. CLASSIC / GENERAL MODE (42 English + 42 Hebrew = 84 prompts)
// ============================================================================
export const PROMPT_EXAMPLES = [
  // ==========================================
  // --- English Classic Prompts (en) ---
  // ==========================================

  // 1) Micro-Chronology (Hour by Hour / Day by Day)
  {
    prompt: 'The dramatic 36 hours of the Apollo 13 space rescue from explosion to splashdown, hour by hour',
    lang: 'en',
    skillTag: 'microTime',
  },
  {
    prompt: 'The 13 days of the Cuban Missile Crisis day by day on the brink of nuclear war',
    lang: 'en',
    skillTag: 'microTime',
  },
  {
    prompt: 'The night the Titanic sank from iceberg impact to the arrival of the Carpathia, minute by minute',
    lang: 'en',
    skillTag: 'microTime',
  },
  {
    prompt: 'D-Day and the Normandy landings across the critical first 24 hours, hour by hour',
    lang: 'en',
    skillTag: 'microTime',
  },
  {
    prompt: 'The Chicxulub asteroid impact and Cretaceous extinction minute by minute, from strike to impact winter',
    lang: 'en',
    skillTag: 'microTime',
  },
  {
    prompt: 'The July Crisis of 1914 day by day: the 37 days from the Sarajevo assassination to World War I',
    lang: 'en',
    skillTag: 'microTime',
  },

  // 2) Creative Parallel Lanes
  {
    prompt: 'The War of the Currents: the rivalry between Nikola Tesla and Thomas Edison in two parallel lanes',
    lang: 'en',
    skillTag: 'parallel',
    isParallel: true,
  },
  {
    prompt: 'Frida Kahlo divided into two parallel lanes: her turbulent life milestones and her iconic paintings',
    lang: 'en',
    skillTag: 'parallel',
    isParallel: true,
  },
  {
    prompt: 'Leonardo da Vinci and Michelangelo in Florence and Rome across two parallel tracks',
    lang: 'en',
    skillTag: 'parallel',
    isParallel: true,
  },
  {
    prompt: 'The 1960s divided into 3 parallel lanes: music & counterculture, civil rights, and tech breakthroughs',
    lang: 'en',
    skillTag: 'parallel',
    isParallel: true,
  },
  {
    prompt: 'Medieval warrior cultures in two parallel lanes: European feudal knights vs. Japanese samurai',
    lang: 'en',
    skillTag: 'parallel',
    isParallel: true,
  },
  {
    prompt: 'The battle for commercial aviation in two parallel lanes: Boeing vs. Airbus from the jet age to today',
    lang: 'en',
    skillTag: 'parallel',
    isParallel: true,
  },

  // 3) Unexpected Thematic Lens
  {
    prompt: 'Human history told through the great pandemics that reshaped empires, economies, and borders',
    lang: 'en',
    skillTag: 'lens',
  },
  {
    prompt: 'History of cryptography and secret codes: from Caesar’s cipher and Enigma to quantum encryption',
    lang: 'en',
    skillTag: 'lens',
  },
  {
    prompt: '20th-century political history told through iconic speeches that changed the world',
    lang: 'en',
    skillTag: 'lens',
  },
  {
    prompt: 'History of Western art told through famous scandals, heists, and works that shocked the public',
    lang: 'en',
    skillTag: 'lens',
  },
  {
    prompt: '20th-century car design through Giorgetto Giugiaro’s icons: from the Golf Mk1 and DeLorean to the Fiat Panda',
    lang: 'en',
    skillTag: 'lens',
  },
  {
    prompt: 'How humanity pictured Earth: world history told through famous maps that reshaped geography and power',
    lang: 'en',
    skillTag: 'lens',
  },

  // 4) Scope, Depth & Time-Window Control
  {
    prompt: 'The 10 most decisive turning points in modern medicine, from germ theory and penicillin to CRISPR',
    lang: 'en',
    skillTag: 'scope',
  },
  {
    prompt: 'A comprehensive, in-depth history of the Silk Road from the Han Dynasty to maritime trade',
    lang: 'en',
    skillTag: 'scope',
  },
  {
    prompt: 'Weimar Germany (1918–1933): from the end of World War I to the collapse of democracy',
    lang: 'en',
    skillTag: 'scope',
  },
  {
    prompt: 'A concise overview of the 12 most surprising archaeological discoveries of the past two centuries',
    lang: 'en',
    skillTag: 'scope',
  },
  {
    prompt: 'An exhaustive timeline of 40+ landmark buildings and monuments that shaped world architecture',
    lang: 'en',
    skillTag: 'scope',
  },
  {
    prompt: 'Fin-de-siècle Vienna (1890–1914): from Freud and Gustav Klimt to Mahler and the birth of modernism',
    lang: 'en',
    skillTag: 'scope',
  },

  // 5) Fictional Universes, Literature & Lore
  {
    prompt: 'History of Tolkien’s Middle-earth: from the First Age to the destruction of the One Ring',
    lang: 'en',
    skillTag: 'fiction',
  },
  {
    prompt: 'Timeline of the Dune universe: from the Butlerian Jihad to the rise of Paul Atreides',
    lang: 'en',
    skillTag: 'fiction',
  },
  {
    prompt: 'In-universe chronological timeline of the Marvel Cinematic Universe (MCU) in story order',
    lang: 'en',
    skillTag: 'fiction',
  },
  {
    prompt: 'A Song of Ice and Fire lore: from the Doom of Valyria and Targaryen conquest to the War of the Five Kings',
    lang: 'en',
    skillTag: 'fiction',
  },
  {
    prompt: 'Isaac Asimov’s future history: from early positronic robots to the Galactic Empire and the Foundation',
    lang: 'en',
    skillTag: 'fiction',
  },
  {
    prompt: 'One Hundred Years of Solitude: seven generations of the Buendía family and the town of Macondo',
    lang: 'en',
    skillTag: 'fiction',
  },

  // 6) Map-Driven Geographic Journeys
  {
    prompt: 'Charles Darwin’s voyage aboard HMS Beagle port by port around the world toward evolution',
    lang: 'en',
    skillTag: 'journey',
  },
  {
    prompt: 'Marco Polo’s journey from Venice along the Silk Road to Kublai Khan’s court, stop by stop',
    lang: 'en',
    skillTag: 'journey',
  },
  {
    prompt: 'The epic 30-year journeys of Ibn Battuta across Africa, the Middle East, India, and China',
    lang: 'en',
    skillTag: 'journey',
  },
  {
    prompt: 'The race to the South Pole: the Antarctic expeditions of Amundsen, Scott, and Shackleton',
    lang: 'en',
    skillTag: 'journey',
  },
  {
    prompt: 'Xenophon’s March of the Ten Thousand from the gates of Babylon across the mountains to the Black Sea',
    lang: 'en',
    skillTag: 'journey',
  },
  {
    prompt: 'The Lewis and Clark expedition with Sacagawea from St. Louis across the Rockies to the Pacific Ocean',
    lang: 'en',
    skillTag: 'journey',
  },

  // 7) Micro-History of Everyday Things & Ideas
  {
    prompt: 'How humans slept through history: from medieval biphasic sleep to street lighting and alarm clocks',
    lang: 'en',
    skillTag: 'microHistory',
  },
  {
    prompt: 'The story of coffee: from Ethiopian legends and Ottoman coffeehouses to modern espresso culture',
    lang: 'en',
    skillTag: 'microHistory',
  },
  {
    prompt: 'Evolution of the alphabet and writing systems: from Proto-Sinaitic script to modern print',
    lang: 'en',
    skillTag: 'microHistory',
  },
  {
    prompt: 'How humanity measured time: from ancient sundials and water clocks to the atomic clock',
    lang: 'en',
    skillTag: 'microHistory',
  },
  {
    prompt: 'Evolution of the horse: from fox-sized forest ancestors to grassland equines and human domestication',
    lang: 'en',
    skillTag: 'microHistory',
  },
  {
    prompt: 'How glass shaped civilization: from Roman workshops and Murano to spectacles, telescopes, and fiber optics',
    lang: 'en',
    skillTag: 'microHistory',
  },

  // ==========================================
  // --- Hebrew Classic Prompts (he) ---
  // ==========================================

  // 1) זום-אין לזמן קצר (שעה אחר שעה / יום אחר יום)
  {
    prompt: '36 השעות הדרמטיות של חילוץ החללית אפולו 13 מהפיצוץ בחלל ועד הנחיתה באוקיינוס, שעה אחר שעה',
    lang: 'he',
    skillTag: 'microTime',
  },
  {
    prompt: '13 הימים של משבר הטילים בקובה יום אחר יום – העולם על סף מלחמה גרעינית',
    lang: 'he',
    skillTag: 'microTime',
  },
  {
    prompt: 'ליל הטביעה של הטיטאניק מפגיעת הקרחון ועד הגעת ספינת החילוץ קרפתיה, דקה אחר דקה',
    lang: 'he',
    skillTag: 'microTime',
  },
  {
    prompt: 'מבצע אנטבה מחטיפת המטוס של אייר פראנס ועד נחיתת כוח החילוץ בישראל, שלב אחר שלב',
    lang: 'he',
    skillTag: 'microTime',
  },
  {
    prompt: 'הכחדת הקרטיקון דקה אחר דקה: מפגיעת האסטרואיד במכתש צ׳יקשולוב ועד גלי הצונאמי והחשכת כדור הארץ',
    lang: 'he',
    skillTag: 'microTime',
  },
  {
    prompt: 'משבר יולי 1914 יום אחר יום: 37 הימים מהרצח בסרייבו שדרדרו את מעצמות אירופה למלחמת העולם הראשונה',
    lang: 'he',
    skillTag: 'microTime',
  },

  // 2) צירים מקבילים יצירתיים
  {
    prompt: 'מלחמת הזרמים: היריבות בין ניקולה טסלה לתומאס אדיסון בשני צירים מקבילים',
    lang: 'he',
    skillTag: 'parallel',
    isParallel: true,
  },
  {
    prompt: 'פרידה קאלו בחלוקה לשני צירים מקבילים: תחנות חייה הסוערות וציוריה המפורסמים',
    lang: 'he',
    skillTag: 'parallel',
    isParallel: true,
  },
  {
    prompt: 'לאונרדו דה וינצ׳י ומיכלאנג׳לו בפירנצה וברומא בשני צירים מקבילים',
    lang: 'he',
    skillTag: 'parallel',
    isParallel: true,
  },
  {
    prompt: 'שנות ה-60 בחלוקה ל-3 צירים מקבילים: מהפכות מוזיקה ותרבות, מאבקי זכויות אזרח ופריצות דרך טכנולוגיות',
    lang: 'he',
    skillTag: 'parallel',
    isParallel: true,
  },
  {
    prompt: 'לוחמי ימי הביניים בשני צירים מקבילים: האבירים באירופה הפיאודלית מול הסמוראים ביפן',
    lang: 'he',
    skillTag: 'parallel',
    isParallel: true,
  },
  {
    prompt: 'הקרב על שמי התעופה האזרחית בשני צירים מקבילים: בואינג מול איירבוס מעידן הסילון ועד היום',
    lang: 'he',
    skillTag: 'parallel',
    isParallel: true,
  },

  // 3) זווית ראייה / עדשה מפתיעה
  {
    prompt: 'תולדות האנושות דרך המגפות הגדולות ששינו אימפריות, כלכלות וגבולות',
    lang: 'he',
    skillTag: 'lens',
  },
  {
    prompt: 'ההיסטוריה של הצפנים והקריפטוגרפיה – מצופן קיסר, דרך מכונת האניגמה ועד ההצפנה הקוונטית',
    lang: 'he',
    skillTag: 'lens',
  },
  {
    prompt: 'ההיסטוריה הפוליטית של המאה ה-20 דרך נאומים היסטוריים ששינו את פני העולם',
    lang: 'he',
    skillTag: 'lens',
  },
  {
    prompt: 'תולדות האמנות המערבית דרך שערוריות, גניבות מפורסמות ויצירות שזעזעו את הציבור',
    lang: 'he',
    skillTag: 'lens',
  },
  {
    prompt: 'עיצוב הרכב במאה ה-20 דרך המכוניות האיקוניות של ג׳ורג׳טו ג׳וג׳ארו – מהגולף והדלוריאן ועד הפיאט פנדה',
    lang: 'he',
    skillTag: 'lens',
  },
  {
    prompt: 'איך האנושות ציירה את העולם: תולדות הקרטוגרפיה דרך מפות היסטוריות ששינו את תפיסת המרחב',
    lang: 'he',
    skillTag: 'lens',
  },

  // 4) שליטה בעומק, כמות וטווח
  {
    prompt: '10 נקודות המפנה המכריעות ביותר בתולדות הרפואה – מגילוי החיידקים והפניצילין ועד עריכת גנים ב-CRISPR',
    lang: 'he',
    skillTag: 'scope',
  },
  {
    prompt: 'תולדות ירושלים מחורבן בית שני ועד סוף התקופה הצלבנית בפירוט מקיף',
    lang: 'he',
    skillTag: 'scope',
  },
  {
    prompt: 'רפובליקת ויימאר בגרמניה (1918–1933): מתום מלחמת העולם הראשונה ועד קריסת הדמוקרטיה',
    lang: 'he',
    skillTag: 'scope',
  },
  {
    prompt: 'סקירה קצרה של 12 התגליות הארכיאולוגיות המפתיעות ביותר במזרח התיכון',
    lang: 'he',
    skillTag: 'scope',
  },
  {
    prompt: 'סקירה כרונולוגית מקיפה של מעל 40 מבני מופת ומונומנטים ששינו את תולדות האדריכלות העולמית',
    lang: 'he',
    skillTag: 'scope',
  },
  {
    prompt: 'וינה של מפנה המאה (1890–1914): מפרויד וקלימט ועד מאהלר, הרצל והולדת המודרניזם האירופי',
    lang: 'he',
    skillTag: 'scope',
  },

  // 5) עולמות בדיוניים, ספרות וקולנוע
  {
    prompt: 'ההיסטוריה של הארץ התיכונה בכתבי טולקין: מבריאת העולם והעידן הראשון ועד השמדת הטבעת האחת',
    lang: 'he',
    skillTag: 'fiction',
  },
  {
    prompt: 'ציר הזמן של יקום חולית (Dune): מהג׳יהאד הבאטלריאני ועד עלייתו של פול אטריידס',
    lang: 'he',
    skillTag: 'fiction',
  },
  {
    prompt: 'הכרונולוגיה הפנימית של היקום הקולנועי של מארוול (MCU) לפי סדר התרחשות האירועים בעלילה',
    lang: 'he',
    skillTag: 'fiction',
  },
  {
    prompt: 'שיר של אש ושל קרח: מחורבן ואליריה ושושלת טארגאריין ועד המלחמה על כס הברזל',
    lang: 'he',
    skillTag: 'fiction',
  },
  {
    prompt: 'היסטוריית העתיד של אייזק אסימוב: מעידן הרובוטים המוקדם ועד האימפריה הגלקטית ומוסד הפסיכוהיסטוריה',
    lang: 'he',
    skillTag: 'fiction',
  },
  {
    prompt: 'מאה שנים של בדידות: שבעת הדורות של משפחת בואנדיה ועלייתה ושקיעתה של העיירה הבדיונית מקונדו',
    lang: 'he',
    skillTag: 'fiction',
  },

  // 6) מסעות גאוגרפיים שמדליקים את המפה
  {
    prompt: 'מסע ספינת הביגל של צ׳ארלס דרווין מנמל לנמל סביב העולם בדרך לתורת האבולוציה',
    lang: 'he',
    skillTag: 'journey',
  },
  {
    prompt: 'מסעו של מרקו פולו מוונציה לאורך דרך המשי ועד חצר קובלאי חאן בסין, תחנה אחר תחנה',
    lang: 'he',
    skillTag: 'journey',
  },
  {
    prompt: 'המרוץ אל הקוטב הדרומי: המשלחות של אמונדסן, סקוט ושקלטון אל לב אנטארקטיקה',
    lang: 'he',
    skillTag: 'journey',
  },
  {
    prompt: 'תולדות הקהילות היהודיות הגדולות בגולה מבבל ואלכסנדריה ועד ספרד, מזרח אירופה ואמריקה',
    lang: 'he',
    skillTag: 'journey',
  },
  {
    prompt: 'מסע הרבבה של קסנופון: נסיגת עשרת אלפים שכירי החרב היוונים מלב בבל ועד חופי הים השחור',
    lang: 'he',
    skillTag: 'journey',
  },
  {
    prompt: 'מסע משלחת לואיס וקלארק וסאקאג׳וויה מנהר המיזורי דרך הרי הרוקי ועד חופי האוקיינוס השקט',
    lang: 'he',
    skillTag: 'journey',
  },

  // 7) מיקרו-היסטוריה של היומיום ורעיונות
  {
    prompt: 'איך בני אדם ישנו לאורך ההיסטוריה – משינה דו-שלבית בימי הביניים ועד תאורת הרחוב והשעון המעורר',
    lang: 'he',
    skillTag: 'microHistory',
  },
  {
    prompt: 'גלגולו של הקפה: מאגדת רועי העזים באתיופיה ובתי הקפה העות׳מאניים ועד תרבות האספרסו המודרנית',
    lang: 'he',
    skillTag: 'microHistory',
  },
  {
    prompt: 'התפתחות האלפבית והכתב העברי: מהכתב הפרוטו-כנעני והעברי הקדום ועד הכתב המרובע והדפוס',
    lang: 'he',
    skillTag: 'microHistory',
  },
  {
    prompt: 'איך מדדו בני אדם את הזמן: משעוני שמש ומים במצרים ובבל ועד השעון האטומי',
    lang: 'he',
    skillTag: 'microHistory',
  },
  {
    prompt: 'האבולוציה של הסוס: מאבותיו הקדומים בגודל שועל ביערות ועד סוסי הערבות וביות הסוס בידי האדם',
    lang: 'he',
    skillTag: 'microHistory',
  },
  {
    prompt: 'איך הזכוכית שינתה את העולם: מזכוכית עתיקה ואי המוראנו ועד משקפיים, טלסקופים וסיבים אופטיים',
    lang: 'he',
    skillTag: 'microHistory',
  },
];

// ============================================================================
// 2. KIDS MODE (Ages 8–11: 28 English + 28 Hebrew = 56 prompts)
// ============================================================================
export const KIDS_PROMPT_EXAMPLES = [
  // ==========================================
  // --- English Kids Prompts (en) ---
  // ==========================================

  // 1) Micro-Chronology (Hour by Hour / Day by Day)
  {
    prompt: 'The thrilling 24 hours of Apollo 11 landing and walking on the Moon, hour by hour',
    lang: 'en',
    skillTag: 'microTime',
  },
  {
    prompt: 'The amazing cave rescue of the 12 young soccer players in Thailand, day by day',
    lang: 'en',
    skillTag: 'microTime',
  },
  {
    prompt: 'The day Mount Vesuvius erupted and froze ancient Pompeii in time, hour by hour',
    lang: 'en',
    skillTag: 'microTime',
  },
  {
    prompt: 'Launch day and unfolding of the giant James Webb Space Telescope in deep space, step by step',
    lang: 'en',
    skillTag: 'microTime',
  },

  // 2) Creative Parallel Tracks
  {
    prompt: 'Superheroes through time divided into two parallel tracks: Marvel vs. DC Comics',
    lang: 'en',
    skillTag: 'parallel',
    isParallel: true,
  },
  {
    prompt: 'Prehistoric ocean giants across millions of years in two parallel tracks: giant sharks vs. whales',
    lang: 'en',
    skillTag: 'parallel',
    isParallel: true,
  },
  {
    prompt: 'Greek mythology and Norse mythology side by side in two parallel tracks of gods, heroes, and monsters',
    lang: 'en',
    skillTag: 'parallel',
    isParallel: true,
  },
  {
    prompt: 'Three gaming icons in 3 parallel tracks: Super Mario, Sonic the Hedgehog, and Pikachu',
    lang: 'en',
    skillTag: 'parallel',
    isParallel: true,
  },

  // 3) Cool Angle / Lens
  {
    prompt: 'The story of space exploration told through the brave animals that flew to space before humans',
    lang: 'en',
    skillTag: 'lens',
  },
  {
    prompt: 'History of science told through accidental inventions: from Popsicles and potato chips to penicillin',
    lang: 'en',
    skillTag: 'lens',
  },
  {
    prompt: 'History of the oceans told through famous shipwrecks and sunken treasures found on the sea floor',
    lang: 'en',
    skillTag: 'lens',
  },
  {
    prompt: 'The story of the Olympic Games told through the most surprising world records in sports history',
    lang: 'en',
    skillTag: 'lens',
  },

  // 4) Pick the Scope & Count
  {
    prompt: 'The 10 coolest discoveries made by space rovers driving across planet Mars',
    lang: 'en',
    skillTag: 'scope',
  },
  {
    prompt: 'The detailed story of LEGO: from a small wooden toy workshop in Denmark to giant brick worlds and movies',
    lang: 'en',
    skillTag: 'scope',
  },
  {
    prompt: 'The 10 most amazing fossil discoveries in history and when each prehistoric creature was found',
    lang: 'en',
    skillTag: 'scope',
  },
  {
    prompt: 'A short history of roller coasters and amusement parks, from ice slides to modern mega-coasters',
    lang: 'en',
    skillTag: 'scope',
  },

  // 5) Story Worlds & Fiction
  {
    prompt: 'The complete story of the Harry Potter wizarding world from Hogwarts founding to the Battle of Hogwarts',
    lang: 'en',
    skillTag: 'fiction',
  },
  {
    prompt: 'The Chronicles of Narnia in story order: from Aslan creating Narnia to the final adventure',
    lang: 'en',
    skillTag: 'fiction',
  },
  {
    prompt: 'Percy Jackson and Camp Half-Blood timeline: from The Lightning Thief to the Battle of Manhattan',
    lang: 'en',
    skillTag: 'fiction',
  },
  {
    prompt: 'In-universe timeline of Toy Story: from Andy’s childhood room to Woody and Buzz’s adventures',
    lang: 'en',
    skillTag: 'fiction',
  },

  // 6) Map Adventures
  {
    prompt: 'Nellie Bly’s real-life 1889 race around the world in 72 days by ship and train, stop by stop',
    lang: 'en',
    skillTag: 'journey',
  },
  {
    prompt: 'Ernest Shackleton’s incredible survival journey across the Antarctic ice aboard the Endurance',
    lang: 'en',
    skillTag: 'journey',
  },
  {
    prompt: 'Marco Polo’s adventure from Venice along the Silk Road to the Emperor’s palace in China',
    lang: 'en',
    skillTag: 'journey',
  },
  {
    prompt: 'The first climb to the top of Mount Everest from Himalayan base camps to the roof of the world',
    lang: 'en',
    skillTag: 'journey',
  },

  // 7) How Everyday Wonders Began
  {
    prompt: 'How the bicycle was invented: from wooden running machines with no pedals to modern mountain bikes',
    lang: 'en',
    skillTag: 'microHistory',
  },
  {
    prompt: 'How people sent secret messages and letters: from carrier pigeons and Morse code to text messages',
    lang: 'en',
    skillTag: 'microHistory',
  },
  {
    prompt: 'The story of soccer: from ancient leather balls in China and England to giant World Cup stadiums',
    lang: 'en',
    skillTag: 'microHistory',
  },
  {
    prompt: 'How comic books were born: from early newspaper strips to superheroes and manga around the world',
    lang: 'en',
    skillTag: 'microHistory',
  },

  // ==========================================
  // --- Hebrew Kids Prompts (he) ---
  // ==========================================

  // 1) זום-אין לזמן קצר (שעה אחר שעה / יום אחר יום)
  {
    prompt: '24 השעות המרגשות של הנחיתה הראשונה על הירח בחללית אפולו 11, שעה אחר שעה',
    lang: 'he',
    skillTag: 'microTime',
  },
  {
    prompt: 'מבצע החילוץ המדהים של 12 הילדים מקבוצת הכדורגל במערה בתאילנד, יום אחר יום',
    lang: 'he',
    skillTag: 'microTime',
  },
  {
    prompt: 'היום שבו התפרץ הר הגעש וזוב וכיסה את העיר העתיקה פומפיי, שעה אחר שעה',
    lang: 'he',
    skillTag: 'microTime',
  },
  {
    prompt: 'שיגור טלסקופ החלל הענק ג׳יימס ווב ופתיחת המראות המוזהבות שלו בחלל, שלב אחר שלב',
    lang: 'he',
    skillTag: 'microTime',
  },

  // 2) מסלולים מקבילים
  {
    prompt: 'עולם גיבורי-העל בחלוקה לשני מסלולים מקבילים: מארוול (Marvel) מול די-סי (DC)',
    lang: 'he',
    skillTag: 'parallel',
    isParallel: true,
  },
  {
    prompt: 'מפלצות האוקיינוס לאורך מיליוני שנים בשני מסלולים מקבילים: כרישי ענק מול לווייתנים',
    lang: 'he',
    skillTag: 'parallel',
    isParallel: true,
  },
  {
    prompt: 'המיתולוגיה היוונית והמיתולוגיה הנורדית בשני מסלולים מקבילים של אלים, גיבורים ויצורים אגדיים',
    lang: 'he',
    skillTag: 'parallel',
    isParallel: true,
  },
  {
    prompt: 'שלושה כוכבי משחקים ב-3 מסלולים מקבילים: סופר מריו, סוניק הקיפוד ופיקאצ׳ו',
    lang: 'he',
    skillTag: 'parallel',
    isParallel: true,
  },

  // 3) זווית מפתיעה
  {
    prompt: 'הסיפור של חקר החלל דרך בעלי החיים האמיצים שטסו לחלל לפני בני האדם',
    lang: 'he',
    skillTag: 'lens',
  },
  {
    prompt: 'תולדות המדע דרך המצאות שקרו לגמרי בטעות – מקרטיב הקרח והתפוצ׳יפס ועד הפניצילין',
    lang: 'he',
    skillTag: 'lens',
  },
  {
    prompt: 'היסטוריה של האוקיינוסים דרך ספינות טרופות ואוצרות אבודים שהתגלו במצולות הים',
    lang: 'he',
    skillTag: 'lens',
  },
  {
    prompt: 'סיפורם של המשחקים האולימפיים דרך הרגעים והשיאים הכי מפתיעים בתולדות הספורט',
    lang: 'he',
    skillTag: 'lens',
  },

  // 4) בחירת היקף וכמות
  {
    prompt: '10 התגליות המדהימות ביותר של רכבי החלל שנוסעים על כוכב הלכת מאדים',
    lang: 'he',
    skillTag: 'scope',
  },
  {
    prompt: 'הסיפור של לגו (LEGO) מנגריית צעצועי עץ קטנה בדנמרק ועד עולמות קוביות וסרטים בפירוט',
    lang: 'he',
    skillTag: 'scope',
  },
  {
    prompt: '10 תגליות המאובנים המפתיעות ביותר בהיסטוריה ומתי התגלה כל יצור קדמון',
    lang: 'he',
    skillTag: 'scope',
  },
  {
    prompt: 'תולדות רכבות ההרים ופארקי השעשועים ממגלשות הקרח הראשונות ועד רכבות הענק בקצרה',
    lang: 'he',
    skillTag: 'scope',
  },

  // 5) עולמות דמיוניים, ספרים וסרטים
  {
    prompt: 'הסיפור המלא של עולם הקסמים של הארי פוטר מהקמת הוגוורטס ועד הקרב האחרון',
    lang: 'he',
    skillTag: 'fiction',
  },
  {
    prompt: 'דברי ימי נרניה לפי הסדר הפנימי של הסיפור: מבריאת נרניה והאריה אסלן ועד ההרפתקה האחרונה',
    lang: 'he',
    skillTag: 'fiction',
  },
  {
    prompt: 'ציר הזמן של פרסי ג׳קסון ומחנה החצויים מהברק הגנוב ועד הקרב על האולימפוס',
    lang: 'he',
    skillTag: 'fiction',
  },
  {
    prompt: 'הסיפור הפנימי של צעצוע של סיפור (Toy Story): מהחדר של אנדי ועד ההרפתקאות של וודי ובאז',
    lang: 'he',
    skillTag: 'fiction',
  },

  // 6) מסעות והרפתקאות על המפה
  {
    prompt: 'מסעה האמיתי של העיתונאית נלי בליי שהקיפה את העולם ב-72 ימים בספינות וברכבות, תחנה אחר תחנה',
    lang: 'he',
    skillTag: 'journey',
  },
  {
    prompt: 'המסע המדהים של ארנסט שקלטון וצוות ספינת האנדיורנס ששרדו בקרח של אנטארקטיקה',
    lang: 'he',
    skillTag: 'journey',
  },
  {
    prompt: 'מסע ההרפתקאות של מרקו פולו מאיטליה לאורך דרך המשי ועד ארמון הקיסר בסין',
    lang: 'he',
    skillTag: 'journey',
  },
  {
    prompt: 'הטיפוס הראשון אל פסגת הר האוורסט ממחנות הבסיס בהרי ההימלאיה ועד גג העולם',
    lang: 'he',
    skillTag: 'journey',
  },

  // 7) איך נולדו דברים שאנחנו מכירים
  {
    prompt: 'איך המציאו את האופניים – ממכונת הריצה מעץ ללא דוושות ועד אופני ההרים של היום',
    lang: 'he',
    skillTag: 'microHistory',
  },
  {
    prompt: 'איך בני אדם שלחו הודעות סודיות ומכתבים: מיוני דואר וקוד מורס ועד הודעות בטלפון',
    lang: 'he',
    skillTag: 'microHistory',
  },
  {
    prompt: 'הסיפור של הכדורגל מכדורי עור עתיקים בסין ובאנגליה ועד האצטדיונים הגדולים בעולם',
    lang: 'he',
    skillTag: 'microHistory',
  },
  {
    prompt: 'איך נולדו ספרי הקומיקס: מציורי העיתונים הראשונים ועד גיבורי-על ומנגה מרחבי העולם',
    lang: 'he',
    skillTag: 'microHistory',
  },
];

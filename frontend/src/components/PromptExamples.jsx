import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Dices } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

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
  },
  // 45. Hebrew - Concise Overview
  {
    prompt: 'המהפכה הצרפתית',
    detailLevel: 'overview',
    lang: 'he'
  },
  // 46. Hebrew - Concise Overview
  {
    prompt: 'נפילת ברית המועצות וקץ המלחמה הקרה',
    detailLevel: 'overview',
    lang: 'he'
  },
  // 47. Hebrew - Concise Overview
  {
    prompt: "האימפריה המונגולית וכיבושי ג'ינגיס חאן",
    detailLevel: 'overview',
    lang: 'he'
  },
  // 48. Hebrew - Concise Overview
  {
    prompt: 'שושלות סין העתיקה',
    detailLevel: 'overview',
    lang: 'he'
  },
  // 49. Hebrew - Concise Overview
  {
    prompt: 'תולדות הצילום מראשיתו ועד לעידן הדיגיטלי',
    detailLevel: 'overview',
    lang: 'he'
  },
  // 50. Hebrew - Concise Standard
  {
    prompt: 'מבצע יונתן באנטבה (1976)',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 51. Hebrew - Concise Overview
  {
    prompt: 'האימפריה הביזנטית ונפילת קונסטנטינופול',
    detailLevel: 'overview',
    lang: 'he'
  },
  // 52. Hebrew - Concise Overview
  {
    prompt: 'עידן התגליות ומסעות קולומבוס',
    detailLevel: 'overview',
    lang: 'he'
  },
  // 53. Hebrew - Concise Standard
  {
    prompt: 'מלחמת ששת הימים: מהלך הקרבות יום אחר יום',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 54. Hebrew - Concise Overview
  {
    prompt: 'תולדות הבירה והיין בעולם העתיק',
    detailLevel: 'overview',
    lang: 'he'
  },
  // 55. Hebrew - Multi-lane (WWI)
  {
    prompt: 'מלחמת העולם הראשונה (1914–1918): בחלוקה למסלולים נפרדים עבור החזית המערבית, החזית המזרחית והמערכה במזרח התיכון',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 56. Hebrew - Multi-lane (Modern Medicine)
  {
    prompt: 'תולדות הרפואה המודרנית: ציר זמן בחלוקה למסלולים מקבילים עבור פיתוח תרופות ואנטיביוטיקה, כירורגיה והרדמה, וחיסונים ומחקר גנטי',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 57. Hebrew - Multi-lane (Hasmoneans)
  {
    prompt: 'מרד החשמונאים וממלכת החשמונאים: בחלוקה לשני מסלולים מקבילים עבור מאבקים צבאיים ומדיניים מול תמורות דתיות ותרבותיות ביהודה',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 58. Hebrew - Multi-lane (Jerusalem)
  {
    prompt: 'תולדות ירושלים לאורך הדורות: ציר זמן בחלוקה למסלולים נפרדים עבור ביצורים ושליטים, מקומות קדושים ומבני דת, וחיי התרבות והמסחר',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 59. Hebrew - Multi-lane (Cold War Race)
  {
    prompt: 'מרוץ החימוש מול מרוץ החלל במלחמה הקרה: ציר זמן בחלוקה לשני מסלולים מקבילים המציגים את התחרות בין ארה"ב לברית המועצות',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 60. Hebrew - Multi-lane (Israeli Cinema)
  {
    prompt: 'תולדות הקולנוע הישראלי: בחלוקה לשלושה מסלולים נפרדים עבור סרטי בורקס, קולנוע אישי ופוליטי, ויצירות עכשוויות שזכו להכרה עולמית',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 61. Hebrew - Multi-lane (Aliyah 1 & 2)
  {
    prompt: 'העלייה הראשונה והשנייה (1882–1914): ציר זמן בחלוקה לשני מסלולים להשוואת המושבות החקלאיות של הברון רוטשילד מול תנועת הפועלים והקמת הקיבוץ הראשון',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 62. Hebrew - Multi-lane (Apple vs Microsoft)
  {
    prompt: 'מהפכת המחשוב האישי: ציר זמן בחלוקה לשני מסלולים מקבילים עבור חברת אפל (Apple) מול מיקרוסופט (Microsoft) משנות ה-70 ועד ימינו',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 63. Hebrew - Multi-lane (Great Revolt vs Bar Kokhba)
  {
    prompt: 'המרד הגדול ומרד בר כוכבא: ציר זמן בחלוקה לשני מסלולים מקבילים להשוואת המהלכים הצבאיים, המנהיגים והתוצאות ההיסטוריות מול האימפריה הרומית',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 64. Hebrew - Multi-lane (Media & Press)
  {
    prompt: 'תולדות התקשורת והדפוס: בחלוקה לשני מסלולים נפרדים עבור התפתחות הכתב והדפוס המסורתי מול מהפכת הרדיו, הטלוויזיה והאינטרנט',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 65. Hebrew - Deep Dive (Alexander the Great)
  {
    prompt: 'חייו ומסעותיו של אלכסנדר מוקדון: מחינוכו אצל אריסטו ורצח פיליפוס, דרך כיבוש פרס, מצרים וסוריה, קרב גאוגמלה, ועד לחציית נהר ההידספס בהודו ומותו בבבל',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 66. Hebrew - Deep Dive (Holocaust & WWII)
  {
    prompt: 'תולדות השואה ומלחמת העולם השנייה (1933–1945): מעליית המפלגה הנאצית וחוקי נירנברג, ליל הבדולח והקמת הגטאות, דרך מבצע ברברוסה, "הפתרון הסופי" ומחנות ההשמדה, ועד למרידות בגטאות, צעדות המוות והשחרור',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 67. Hebrew - Deep Dive (Ancient Philosophy)
  {
    prompt: 'המהפכה הפילוסופית של העת העתיקה: מסוקרטס, אפלטון והאקדמיה באתונה, דרך אריסטו והאסכולה הפריפטטית, ועד לאסכולה הסטואית והאפיקוראית',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 68. Hebrew - Deep Dive (South Pole Race)
  {
    prompt: 'מסעות הקוטב הדרומי: המרוץ הדרמטי של רואלד אמונדסן מול רוברט פלקון סקוט (1910–1912), כולל ההכנות, השיט באוניות, הקמת מחנות הבסיס והמסע הרגלי לכיבוש הקוטב',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 69. Hebrew - Deep Dive (Israel-Egypt Peace)
  {
    prompt: "הסכם השלום בין ישראל למצרים: מביקור סאדאת בירושלים ב-1977, שיחות ועידת קמפ דייוויד עם מנחם בגין וג'ימי קרטר, חתימת ההסכם בוושינגטון ב-1979 ועד פינוי סיני",
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 70. Hebrew - Deep Dive (Spanish Jewry Golden Age)
  {
    prompt: 'תור הזהב של יהדות ספרד: מיוסוף אבן נגרילה וחסדאי אבן שפרוט, דרך שירת שלמה אבן גבירול ויהודה הלוי, פסיקותיו וכתביו של הרמב"ם, ועד לגירוש ספרד ב-1492',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 71. Hebrew - Deep Dive (AI History)
  {
    prompt: "תולדות הבינה המלאכותית: ממבחן טיורינג ב-1950, כנס דארטמות' ב-1956, חורפי הבינה המלאכותית, ניצחון Deep Blue על קספרוב, מהפכת הלמידה העמוקה ועד ל-ChatGPT ומודלי שפה ענקיים",
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 72. Hebrew - Deep Dive (Modern Astronomy)
  {
    prompt: "תולדות האסטרונומיה המודרנית: מהמודל ההליוצנטרי של קופרניקוס ותצפיות גלילאו, דרך חוקי קפלר, עבודתו של אדווין האבל על התפשטות היקום, ועד לשיגור טלסקופ החלל ג'יימס ווב",
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 73. Hebrew - Standard (Hebrew Language)
  {
    prompt: 'תולדות השפה העברית: מעברית מקראית ומגילות ים המלח, דרך לשון חז"ל וימי הביניים, ועד למפעל תחיית הלשון של אליעזר בן-יהודה והעברית בת זמננו',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 74. Hebrew - Standard (Leonardo da Vinci)
  {
    prompt: "חייו ויצירותיו של לאונרדו דה וינצ'י: ציור המונה ליזה, הסעודה האחרונה, מחברות הרישום והמצאותיו ההנדסיות והאנטומיות",
    detailLevel: 'standard',
    lang: 'he'
  },
  // 75. Hebrew - Standard (Tel Aviv)
  {
    prompt: 'תולדות תל אביב-יפו: מהגרלת המגרשים באחוזת בית ב-1909, דרך תוכנית גדס, בניית העיר הלבנה בסגנון הבאוהאוס, ועד להפיכתה למרכז הייטק ותרבות גלובלי',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 76. Hebrew - Standard (Deep Sea Exploration)
  {
    prompt: 'חקר מעמקי האוקיינוס: מגילוי שקע מריאנה וצלילת הבתיסקף טריאסטה ועד לגילוי הריסות הטיטניק ורובוטים תת-ימיים חדישים',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 77. Hebrew - Standard (Classical Music)
  {
    prompt: "תולדות המוזיקה הקלאסית: מהבארוק של באך וויואלדי, דרך הקלאסיציזם של מוצרט ובטהובן, ועד לרומנטיקה של שופן וצ'ייקובסקי",
    detailLevel: 'standard',
    lang: 'he'
  },
  // 78. Hebrew - Standard (Video Games)
  {
    prompt: 'התפתחות משחקי הווידאו: מ-Pong ומשחקי הארקייד של שנות ה-70, דרך עידן ה-8-ביט וה-16-ביט של נינטנדו וסגה, ועד לקונסולות תלת-ממד ומציאות מדומה',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 79. Hebrew - Standard (Israeli Agriculture & Water)
  {
    prompt: 'המהפכה החקלאית בארץ ישראל וההתיישבות העובדת: מייבוש ביצות החולה ועמק יזרעאל, פיתוח הטפטפות ומשק המים, ועד לחקלאות מדברית מתקדמת',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 80. Hebrew - Overview (Maritime Explorers)
  {
    prompt: "מסעות גילוי העולם הימיים: מסעות ואסקו דה גאמה להודו, מגלן והקפת כדור הארץ, וג'יימס קוק באוקיינוס השקט",
    detailLevel: 'overview',
    lang: 'he'
  },
  // 81. Hebrew - Standard (Lord of the Rings)
  {
    prompt: 'עלילת שר הטבעות: ציר זמן כרונולוגי של מסע אחוות הטבעת מפלך ההוביטים ועד להשמדת הטבעת בהר הגזירה',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 82. Hebrew - Standard (Israeli Tech & Internet)
  {
    prompt: 'ההיסטוריה של האינטרנט בישראל: מחיבור האוניברסיטאות הראשון לרשת מחשבים בשנות ה-80, הקמת אתרי החדשות הראשונים, ועד להפיכת ישראל ל"סטארט-אפ ניישן"',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 83. English - Concise Overview
  {
    prompt: 'The French Revolution',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 84. English - Concise Overview
  {
    prompt: 'Fall of the Soviet Union (1985–1991)',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 85. English - Concise Overview
  {
    prompt: 'The Mongol Empire and Genghis Khan',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 86. English - Concise Standard
  {
    prompt: 'The Black Death (1346–1353)',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 87. English - Concise Overview
  {
    prompt: 'James Bond Movies: 60 Years of 007',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 88. English - Concise Overview
  {
    prompt: 'Ancient Mesopotamia: Sumer, Babylon, and Assyria',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 89. English - Concise Overview
  {
    prompt: 'History of Photography: From Daguerreotypes to Smartphones',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 90. English - Concise Overview
  {
    prompt: 'The Maya Civilization: Preclassic to Postclassic Periods',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 91. English - Concise Overview
  {
    prompt: 'History of Coffee: From Ethiopian Forests to Global Cafes',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 92. English - Concise Overview
  {
    prompt: 'The Space Shuttle Era (1981–2011)',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 93. English - Multi-lane (WWI Theaters)
  {
    prompt: 'World War I (1914–1918), divided into separate swimlanes for the Western Front, Eastern Front, and Middle Eastern Theater',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 94. English - Multi-lane (Gaming Consoles)
  {
    prompt: 'History of Video Game Consoles, divided into separate lanes for Nintendo, Sega, Sony PlayStation, and Microsoft Xbox',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 95. English - Multi-lane (Reformation)
  {
    prompt: 'The Protestant Reformation and Counter-Reformation (1517–1648), divided into separate swimlanes for Protestant Reformers, Catholic Response, and Religious Wars',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 96. English - Multi-lane (Silk Road)
  {
    prompt: 'The Silk Road: divided into parallel lanes for Overland Caravan Routes, Maritime Trade Routes, and Religious & Cultural Diffusion',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 97. English - Multi-lane (US Civil War)
  {
    prompt: 'The American Civil War (1861–1865), divided into separate swimlanes for Eastern Theater Battles, Western Theater Campaigns, and Political & Emancipation Milestones',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 98. English - Multi-lane (Cinema History)
  {
    prompt: 'History of Cinema: divided into parallel lanes for Hollywood Studio System, European Art Cinema, and Asian & World Cinema',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 99. English - Multi-lane (Internet Evolution)
  {
    prompt: 'Evolution of the Internet, divided into separate swimlanes for Network Protocols & Hardware, Web Browsers & Platforms, and Mobile & Social Media',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 100. English - Multi-lane (Classical Music)
  {
    prompt: 'History of Western Classical Music: divided into parallel tracks for Orchestral & Instrumental Works and Opera & Choral Music',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 101. English - Multi-lane (Jazz & Blues)
  {
    prompt: 'Evolution of Jazz & Blues: divided into parallel lanes for Delta & Chicago Blues, Traditional New Orleans to Bebop, and Cool Jazz to Modern Fusion',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 102. English - Multi-lane (Cold War Space vs Arms)
  {
    prompt: 'The Cold War: Space Race vs. Nuclear Arms Race, divided into two parallel lanes tracking orbital missions and nuclear weapon development',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 103. English - Deep Dive (Alexander the Great)
  {
    prompt: "The Life and Campaigns of Alexander the Great: From Philip's assassination and the Battle of the Granicus, through the Siege of Tyre and Alexandria, to Gaugamela, the Hindu Kush, and his death in Babylon",
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 104. English - Deep Dive (Roman Empire)
  {
    prompt: 'The Rise of the Roman Empire: From the assassination of Julius Caesar and the Second Triumvirate, through the Battle of Actium, the Pax Romana of Augustus, to Marcus Aurelius and the Antonine Plague',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 105. English - Deep Dive (Scientific Revolution)
  {
    prompt: "The Scientific Revolution (1543–1687): From Copernicus's heliocentric model and Vesalius's anatomy, through Kepler's planetary laws and Galileo's telescopic discoveries, to Newton's Principia Mathematica",
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 106. English - Deep Dive (History of Medicine)
  {
    prompt: "The History of Medicine and Surgery: From Hippocrates and Galen's humors, to Harvey's blood circulation, Jenner's smallpox vaccine, Lister's antiseptics, Fleming's penicillin, and CRISPR gene editing",
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 107. English - Deep Dive (The Crusades)
  {
    prompt: "The Crusades (1095–1291): From Pope Urban II's Council of Clermont and the capture of Jerusalem, through Saladin and the Third Crusade with Richard the Lionheart, to the Fourth Crusade's sack of Constantinople and the fall of Acre",
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 108. English - Deep Dive (AI History)
  {
    prompt: "The Evolution of Artificial Intelligence: From Turing's 1950 imitation game and the 1956 Dartmouth workshop, through AI winters and expert systems, to Deep Blue, AlphaGo, and Large Language Models",
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 109. English - Deep Dive (Race to South Pole)
  {
    prompt: "The Race to the South Pole (1910–1912): Chronology of Roald Amundsen's Fram expedition versus Robert Falcon Scott's Terra Nova expedition, from depot laying to the polar summit and Scott's tragic return",
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 110. English - Deep Dive (Origins of WWI)
  {
    prompt: "Origins of World War I: From the 1871 Franco-Prussian War and Bismarck's alliance systems, through the Balkan Wars, the assassination of Archduke Franz Ferdinand in Sarajevo, to the July Crisis and declarations of war",
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 111. English - Standard (Lord of the Rings)
  {
    prompt: "The Lord of the Rings: Chronology of the War of the Ring from Bilbo's farewell birthday party in the Shire to Aragorn's coronation and the Grey Havens",
    detailLevel: 'standard',
    lang: 'en'
  },
  // 112. English - Standard (Star Wars)
  {
    prompt: 'Star Wars Canon: Major galactic timeline from the Fall of the Republic and Order 66, through the Galactic Civil War and Battle of Endor, to the Rise of the First Order',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 113. English - Standard (Studio Ghibli)
  {
    prompt: "Studio Ghibli: Chronological history of Hayao Miyazaki and Isao Takahata's films from Nausicaä and Castle in the Sky to The Boy and the Heron",
    detailLevel: 'standard',
    lang: 'en'
  },
  // 114. English - Standard (Cybersecurity)
  {
    prompt: 'History of Cybersecurity: From the 1988 Morris Worm and early computer viruses, through Stuxnet and ransomware, to modern zero-day exploits and encryption wars',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 115. English - Standard (Mass Extinctions)
  {
    prompt: "The Five Great Mass Extinction Events in Earth's History: Ordovician, Late Devonian, Permian Great Dying, Triassic-Jurassic, and Cretaceous-Paleogene",
    detailLevel: 'standard',
    lang: 'en'
  },
  // 116. English - Standard (Modern Architecture)
  {
    prompt: 'History of Modern Architecture: From the Crystal Palace and Chicago School skyscrapers, through Bauhaus and Le Corbusier, to Frank Gehry and sustainable biomimetic design',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 117. English - Standard (FIFA World Cup)
  {
    prompt: "History of the FIFA World Cup: Landmark tournaments and iconic matches from Uruguay 1930 and Pelé's 1958 debut, to Maradona's 1986 heroics and Qatar 2022",
    detailLevel: 'standard',
    lang: 'en'
  },
  // 118. English - Standard (Modern Olympics)
  {
    prompt: "The Modern Olympic Games: From Pierre de Coubertin's revival in Athens 1896, through the Berlin 1936 games, Cold War boycotts, to the 2024 Paris Olympics",
    detailLevel: 'standard',
    lang: 'en'
  },
  // 119. English - Standard (Silicon Valley)
  {
    prompt: 'History of Silicon Valley: From Shockley Semiconductor and the "Traitorous Eight", through Fairchild, Intel, Apple, and Google, to modern venture capital giants',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 120. English - Standard (Mars Exploration)
  {
    prompt: 'The Exploration of Mars: From Mariner 4 flybys and Viking landers, through Pathfinder, Spirit, Opportunity, and Curiosity, to the Perseverance rover and Ingenuity helicopter',
    detailLevel: 'standard',
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
      className="w-full max-w-6xl mx-auto mt-4 px-2 sm:px-4 relative select-none group/carousel isolate"
      onMouseEnter={() => { isHoveredRef.current = true; }}
      onMouseLeave={() => { isHoveredRef.current = false; }}
    >
      {/* Edge gradient fade masks for that infinite cinema look */}
      <div className="absolute left-0 top-0 bottom-0 w-16 sm:w-24 bg-gradient-to-r from-slate-100 dark:from-slate-950 to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-16 sm:w-24 bg-gradient-to-l from-slate-100 dark:from-slate-950 to-transparent z-10 pointer-events-none" />

      {/* Scrollable Reel Track */}
      <div
        ref={scrollRef}
        className="overflow-x-auto overflow-y-hidden py-4 px-10 sm:px-14 scrollbar-none"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        <div className="flex gap-3.5 w-max group/track transition-all duration-300 opacity-100 scale-100">
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
                      ? t('toolbar.detailDeep')
                      : item.detailLevel === 'overview'
                      ? t('toolbar.detailOverview')
                      : t('toolbar.detailStandard')}
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
        className="absolute left-1 sm:left-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center bg-white/95 dark:bg-slate-900/95 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 transition-all cursor-pointer pointer-events-auto"
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
        className="absolute right-1 sm:right-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center bg-white/95 dark:bg-slate-900/95 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 transition-all cursor-pointer pointer-events-auto"
      >
        <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
      </button>

      {/* Random prompt selection button */}
      <div className="flex justify-center mt-3">
        <button
          type="button"
          onClick={handleSelectRandomPrompt}
          disabled={isGenerating}
          title={t('home.surpriseMe')}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-white/90 dark:bg-slate-900/90 hover:bg-white dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 shadow-2xs hover:shadow-xs transition-all duration-200 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed group"
        >
          <Dices className="w-3.5 h-3.5 text-sky-500 group-hover:rotate-45 transition-transform duration-300 shrink-0" />
          <span>{t('home.surpriseMe')}</span>
        </button>
      </div>
    </div>
  );
}

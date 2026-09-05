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
    prompt: 'עלילת הארי פוטר לאורך שבע שנות הלימוד בהוגוורטס',
    detailLevel: 'overview',
    lang: 'he'
  },
  // 6. English - Overview
  {
    prompt: 'Ancient Egypt: The story of the great pharaohs and pyramids to Cleopatra',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 7. Hebrew - Standard
  {
    prompt: 'יוון העתיקה: מעליית הדמוקרטיה באתונה ועד לכיבושי אלכסנדר מוקדון',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 8. English - Overview
  {
    prompt: 'The Viking Age: Viking voyages, raids, and discoveries across Europe',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 9. Hebrew - Multi-lane (Dinosaurs)
  {
    prompt: 'עולם הדינוזאורים: סקירה של המינים המפורסמים, בחלוקה למסלולים: דינוזאורים טורפים מול דינוזאורים צמחוניים',
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
    prompt: 'האבולוציה של האדם: המסע מהקופים הקדומים ועד לאדם המודרני',
    detailLevel: 'overview',
    lang: 'he'
  },
  // 12. English - Overview
  {
    prompt: 'Dinosaurs: From their early rise to their dramatic extinction',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 13. Hebrew - Overview
  {
    prompt: 'פרהיסטוריה בארץ ישראל: חיי האדם הקדמון במערות ועד להמצאת החקלאות',
    detailLevel: 'overview',
    lang: 'he'
  },
  // 14. English - Standard
  {
    prompt: "The Targaryen Dynasty: Complete chronology from Aegon's Conquest to Robert's Rebellion",
    detailLevel: 'standard',
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
    prompt: "History of Aviation: From the Wright brothers' first flight to supersonic jets and space exploration",
    detailLevel: 'overview',
    lang: 'en'
  },
  // 17. Hebrew - Overview
  {
    prompt: 'תוכנית אפולו: המסע של נאס״א להנחתת האדם הראשון על הירח',
    detailLevel: 'overview',
    lang: 'he'
  },
  // 18. English - Multi-lane (AI & Computing)
  {
    prompt: 'History of Artificial Intelligence and Computing, divided into parallel swimlanes for Hardware Systems, Core Algorithms & Models, and Society & Ethics',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 19. Hebrew - Standard
  {
    prompt: 'ההיסטוריה הגאולוגית של כדור הארץ: מעידן היווצרות הכוכב ועד לעידן הקרח',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 20. English - Overview
  {
    prompt: 'Timeline of the Universe: From the Big Bang to our Solar System and life on Earth',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 21. Hebrew - Standard
  {
    prompt: 'מגילות ים המלח ומצדה: תעלומת המגילות הגנוזות והמרד הגדול',
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
    prompt: 'The Golden Age of Islam: Great scientific, medical, and philosophical discoveries',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 25. Hebrew - Multi-lane (Yom Kippur War)
  {
    prompt: 'מהלך מלחמת יום הכיפורים (אוקטובר 1973): בחלוקה לשני מסלולים מקבילים עבור חזית הדרום (סיני) וחזית הצפון (רמת הגולן)',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 26. English - Overview
  {
    prompt: "Harry Potter Storyline: Key plot points across the seven years at Hogwarts",
    detailLevel: 'overview',
    lang: 'en'
  },
  // 27. Hebrew - Standard
  {
    prompt: 'ההיסטוריה של הסכסוך הישראלי-פלסטיני: האירועים, המלחמות והסכמי השלום מראשיתו ועד ימינו',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 28. English - Overview
  {
    prompt: 'Marvel Cinematic Universe: Major events from Iron Man to Avengers: Endgame',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 29. English - Standard
  {
    prompt: 'History of Quantum Physics: Discoveries that changed our understanding of the subatomic world',
    detailLevel: 'standard',
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
    prompt: 'Rise and Fall of the Roman Empire: From the Republic to the fall of Rome',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 34. Hebrew - Multi-lane (American vs French Revolution)
  {
    prompt: 'המהפכה האמריקאית מול המהפכה הצרפתית: ציר זמן בחלוקה לשני מסלולים נפרדים עבור שני המאבקים הגדולים לחירות (1775–1799)',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 35. English - Standard
  {
    prompt: 'The Manhattan Project and Cold War Nuclear Proliferation (1939–1962): From Trinity test to the Cuban Missile Crisis',
    detailLevel: 'standard',
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
    prompt: 'Human Evolution: The journey of humanity from early hominid ancestors to modern humans',
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
    prompt: 'The Beatles: The story of the legendary band from their early days to Beatlemania and breakup',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 41. Hebrew - Overview (Scientific Revolution)
  {
    prompt: 'המהפכה המדעית: התגליות והמדענים הגדולים ששינו את העולם',
    detailLevel: 'overview',
    lang: 'he'
  },
  // 42. English - Overview (Cold War)
  {
    prompt: 'The Cold War: Major crises and showdowns between the US and the Soviet Union',
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
    prompt: 'The European Renaissance: Great artists, masterworks, and ideas from Florence to Rome',
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
  // 50. Hebrew - Concise Overview
  {
    prompt: 'מבצע יונתן באנטבה (1976)',
    detailLevel: 'overview',
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
    detailLevel: 'standard',
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
    detailLevel: 'standard',
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
  // 65. Hebrew - Standard (Alexander the Great)
  {
    prompt: 'אלכסנדר מוקדון: מסעות הכיבוש והאימפריה מיוון ועד להודו',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 66. Hebrew - Deep Dive (Holocaust & WWII)
  {
    prompt: 'תולדות השואה ומלחמת העולם השנייה: האירועים המרכזיים מעליית הנאצים ועד לשחרור',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 67. Hebrew - Standard (Ancient Philosophy)
  {
    prompt: 'הפילוסופיה ביוון העתיקה: מסוקרטס ואפלטון ועד לאריסטו',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 68. Hebrew - Overview (South Pole Race)
  {
    prompt: 'המרוץ לקוטב הדרומי: התחרות הדרמטית בין אמונדסן לסקוט באנטארקטיקה',
    detailLevel: 'overview',
    lang: 'he'
  },
  // 69. Hebrew - Standard (Israel-Egypt Peace)
  {
    prompt: 'הסכם השלום בין ישראל למצרים: מביקור סאדאת בירושלים ועד להסכם ההיסטורי',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 70. Hebrew - Standard (Spanish Jewry Golden Age)
  {
    prompt: 'תור הזהב של יהדות ספרד: שירה, הגות ומדע עד לגירוש ספרד',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 71. Hebrew - Standard (AI History)
  {
    prompt: 'ההיסטוריה של הבינה המלאכותית: ממחשבי שנות ה-50 ועד ל-ChatGPT',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 72. Hebrew - Standard (Modern Astronomy)
  {
    prompt: 'תולדות האסטרונומיה: מהטלסקופ של גלילאו ועד לטלסקופ החלל ג\'יימס ווב',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 73. Hebrew - Standard (Hebrew Language)
  {
    prompt: 'תולדות השפה העברית: מתקופת התנ"ך ועד לתחיית השפה בימינו',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 74. Hebrew - Standard (Leonardo da Vinci)
  {
    prompt: 'לאונרדו דה וינצ\'י: הציורים, המחברות וההמצאות של הגאון מתקופת הרנסאנס',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 75. Hebrew - Standard (Tel Aviv)
  {
    prompt: 'תולדות תל אביב: מהקמת השכונה הראשונה בחולות ועד לעיר העברית הגדולה',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 76. Hebrew - Standard (Deep Sea Exploration)
  {
    prompt: 'חקר מעמקי האוקיינוס: מהצלילות הראשונות ועד לגילוי הטיטניק והתהומות העמוקים בעולם',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 77. Hebrew - Standard (Classical Music)
  {
    prompt: 'תולדות המוזיקה הקלאסית: המלחינים והיצירות הגדולות מבאך ומוצרט ועד בטהובן',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 78. Hebrew - Standard (Video Games)
  {
    prompt: 'ההיסטוריה של משחקי הווידאו: ממשחקי הארקייד של שנות ה-70 ועד לקונסולות המודרניות',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 79. Hebrew - Standard (Israeli Agriculture & Water)
  {
    prompt: 'המהפכה החקלאית בישראל: מייבוש הביצות והמצאת הטפטפות ועד לחקלאות מדברית',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 80. Hebrew - Overview (Maritime Explorers)
  {
    prompt: 'עידן התגליות הימי: המסעות הגדולים שגילו יבשות והקיפו את העולם',
    detailLevel: 'overview',
    lang: 'he'
  },
  // 81. Hebrew - Standard (Lord of the Rings)
  {
    prompt: 'עלילת שר הטבעות: מסע אחוות הטבעת מהפלך ועד להר הגזירה',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 82. Hebrew - Standard (Israeli Tech & Internet)
  {
    prompt: 'ההיסטוריה של האינטרנט בישראל: מחיבורי המחשבים הראשונים ועד לסטארט-אפ ניישן',
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
  // 86. English - Concise Overview
  {
    prompt: 'The Black Death (1346–1353)',
    detailLevel: 'overview',
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
  // 103. English - Standard (Alexander the Great)
  {
    prompt: 'The Life and Campaigns of Alexander the Great: The conquest of the ancient world from Greece and Egypt to India',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 104. English - Standard (Roman Empire)
  {
    prompt: 'The Rise of the Roman Empire: From the fall of the Republic to Pax Romana',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 105. English - Standard (Scientific Revolution)
  {
    prompt: 'The Scientific Revolution: Discoveries and thinkers that transformed our view of the universe',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 106. English - Standard (History of Medicine)
  {
    prompt: 'History of Medicine: Landmark breakthroughs from ancient cures to vaccines and antibiotics',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 107. English - Standard (The Crusades)
  {
    prompt: 'The Crusades: The medieval clash of empires and the struggle for Jerusalem',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 108. English - Standard (AI History)
  {
    prompt: "History of Artificial Intelligence: From Alan Turing's earliest tests to modern AI and ChatGPT",
    detailLevel: 'standard',
    lang: 'en'
  },
  // 109. English - Overview (Race to South Pole)
  {
    prompt: 'The Race to the South Pole: The dramatic journey of Amundsen and Scott across Antarctica',
    detailLevel: 'overview',
    lang: 'en'
  },
  // 110. English - Standard (Origins of WWI)
  {
    prompt: "Origins of World War I: From the 1871 Franco-Prussian War and Bismarck's alliance systems, through the Balkan Wars, the assassination of Archduke Franz Ferdinand in Sarajevo, to the July Crisis and declarations of war",
    detailLevel: 'standard',
    lang: 'en'
  },
  // 111. English - Standard (Lord of the Rings)
  {
    prompt: 'The Lord of the Rings: The epic journey of the Fellowship from the Shire to Mount Doom',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 112. English - Standard (Star Wars)
  {
    prompt: 'Star Wars: Major milestones from the fall of the Republic to the Galactic Rebellion',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 113. English - Standard (Studio Ghibli)
  {
    prompt: "Studio Ghibli: Chronological history of Hayao Miyazaki's famous animated films",
    detailLevel: 'standard',
    lang: 'en'
  },
  // 114. English - Standard (Cybersecurity)
  {
    prompt: 'History of Cybersecurity: The evolution of computer viruses, hacking, and digital defense',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 115. English - Overview (Mass Extinctions)
  {
    prompt: "Mass Extinctions in Earth's History: The catastrophic events that reshaped life on Earth",
    detailLevel: 'overview',
    lang: 'en'
  },
  // 116. English - Standard (Modern Architecture)
  {
    prompt: 'History of Modern Architecture: The rise of skyscrapers and innovative city design',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 117. English - Standard (FIFA World Cup)
  {
    prompt: 'History of the FIFA World Cup: Iconic tournaments, champions, and legends in soccer history',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 118. English - Standard (Modern Olympics)
  {
    prompt: 'The Modern Olympic Games: Key moments and historic milestones from 1896 to today',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 119. English - Standard (Silicon Valley)
  {
    prompt: 'History of Silicon Valley: The rise of personal computers, the internet, and tech giants',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 120. English - Standard (Mars Exploration)
  {
    prompt: 'The Exploration of Mars: Key robotic missions and rovers that explored the Red Planet',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 121. Hebrew - Deep (Evolution of Life)
  {
    prompt: 'התפתחות החיים על פני כדור הארץ מראשיתם ועד ימינו, בחלוקה לשלושה מסלולים מקבילים: בעלי חיים, צמחים, ומיקרואורגניזמים (יצורים חד-תאיים)',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 122. English - Deep (Evolution of Life)
  {
    prompt: 'The Evolution of Life on Earth from the beginning to the present day, divided into parallel swimlanes for Animals, Plants, and Microorganisms',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 123. Hebrew - Standard (Evolution of the Universe)
  {
    prompt: 'התפתחות היקום מהמפץ הגדול ועד ימינו, בחלוקה לשלושה מסלולים מקבילים: שלבי התפשטות היקום, היווצרות כוכבים וגלקסיות, והיווצרות מערכת השמש וכדור הארץ',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 124. English - Standard (Evolution of the Universe)
  {
    prompt: 'The Evolution of the Universe from the Big Bang to today, divided into parallel swimlanes for Early Universe Expansion, Stars & Galaxies Formation, and the Solar System & Earth',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 125. Hebrew - Standard (Game of Thrones Houses)
  {
    prompt: 'עלילת משחקי הכס, בחלוקה לשלושה מסלולים מקבילים עבור בית סטארק, בית לאניסטר ובית טרגאריין',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 126. English - Standard (Game of Thrones Houses)
  {
    prompt: 'The storyline of Game of Thrones, divided into three parallel swimlanes for House Stark, House Lannister, and House Targaryen',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 127. Hebrew - Standard (Israeli-Palestinian Conflict)
  {
    prompt: 'ההיסטוריה של הסכסוך הישראלי-פלסטיני: סקירה של האירועים, המלחמות והסכמי השלום המרכזיים מראשיתו ועד ימינו',
    detailLevel: 'standard',
    lang: 'he'
  },
  // 128. English - Standard (Israeli-Palestinian Conflict)
  {
    prompt: 'The history of the Israeli-Palestinian conflict: Major events, wars, and peace agreements from its beginnings to the present day',
    detailLevel: 'standard',
    lang: 'en'
  },
  // 129. Hebrew - Deep (History of Rock & Roll)
  {
    prompt: 'תולדות מוזיקת הרוק משנות ה-50 ועד ימינו, בחלוקה לשלושה מסלולים מקבילים: רוק קלאסי, פאנק ומטאל, ורוק אלטרנטיבי וגראנג\'',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  // 130. English - Deep (History of Rock & Roll)
  {
    prompt: 'History of rock music from the 1950s to the present day, divided into parallel swimlanes for Classic Rock, Punk & Heavy Metal, and Alternative & Grunge',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  // 131. Hebrew - Overview (Whale Evolution)
  {
    prompt: 'האבולוציה של הלווייתן: כיצד התפתח הלווייתן מיונק יבשתי שהלך על ארבע ועד ללווייתן הענק באוקיינוס',
    detailLevel: 'overview',
    lang: 'he'
  },
  // 132. English - Overview (Whale Evolution)
  {
    prompt: 'The evolution of the whale: How whales evolved from four-legged land mammals into modern ocean giants',
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

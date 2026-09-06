// Full Bilingual Data for ChroniX User Guide
// Supports complete English and Hebrew localized documentation

export const SHOWCASE_PROMPTS_DATA = [
  {
    id: 'horse-evolution',
    categoryKey: 'prehistory',
    detailLevel: 'overview',
    title: {
      en: 'Evolution of the Horse',
      he: 'האבולוציה של הסוס'
    },
    category: {
      en: 'Prehistory & Nature',
      he: 'פרה-היסטוריה וטבע'
    },
    prompt: {
      en: 'Evolution of the horse',
      he: 'האבולוציה של הסוס'
    },
    whyItWorks: {
      en: 'Traces the classic evolutionary journey from multi-toed forest dwellers to modern horses using clear transitional milestones.',
      he: 'מדגים מסע אבולוציוני קלאסי מיונקים קטנים בעלי אצבעות לסוס המודרני עם ציוני דרך ומאובני מעבר ברורים.'
    }
  },
  {
    id: 'space-race',
    categoryKey: 'science',
    detailLevel: 'standard',
    title: {
      en: 'The Space Race (1955–1975)',
      he: 'המרוץ לחלל (1955–1975)'
    },
    category: {
      en: 'Science & Space',
      he: 'מדע וחלל'
    },
    prompt: {
      en: 'The Space Race (1955–1975): Soviet Space Program vs. NASA',
      he: 'המרוץ לחלל (1955–1975): תוכנית החלל הסובייטית מול נאס״א'
    },
    whyItWorks: {
      en: 'Compares two historical rivals side-by-side using intuitive parallel swimlanes.',
      he: 'משווה בין שני יריבים היסטוריים זה לצד זה באמצעות מסלולים מקבילים וברורים.'
    }
  },
  {
    id: 'wwii-theaters',
    categoryKey: 'modern_history',
    detailLevel: 'deep_dive',
    title: {
      en: 'World War II Multi-Theater Chronology',
      he: 'מלחמת העולם השנייה בחלוקה לזירות'
    },
    category: {
      en: 'Modern History',
      he: 'היסטוריה מודרנית'
    },
    prompt: {
      en: 'World War II (1939–1945), divided into parallel time lanes for European Theater, Pacific Theater, and Diplomatic Summits',
      he: 'מלחמת העולם השנייה (1939–1945), בחלוקה למסלולים מקבילים: הזירה האירופית, זירת האוקיינוס השקט וועידות דיפלומטיות'
    },
    whyItWorks: {
      en: 'Organizes a global conflict into distinct geographic theaters at high narrative depth.',
      he: 'מארגן עימות עולמי לזירות גיאוגרפיות מובחנות ברמת פירוט ועומק גבוהה.'
    }
  },
  {
    id: 'ancient-egypt-overview',
    categoryKey: 'ancient',
    detailLevel: 'overview',
    title: {
      en: 'Ancient Egypt: Dynastic Overview',
      he: 'מצרים העתיקה: סקירת השושלות והממלכות'
    },
    category: {
      en: 'Ancient Civilizations',
      he: 'עת עתיקה ותרבויות קדומות'
    },
    prompt: {
      en: 'Ancient Egypt: The story of the great pharaohs and monuments from the pyramids to Cleopatra',
      he: 'מצרים העתיקה: סיפורם של הפרעונים והמונומנטים הגדולים מהפירמידות ועד לקלאופטרה'
    },
    whyItWorks: {
      en: 'A simple natural prompt lets the AI map millennia of dynastic history effortlessly.',
      he: 'ניסוח פשוט וטבעי שמאפשר ל-AI לפרוס אלפי שנות היסטוריה שושלתית בקלות.'
    }
  },
  {
    id: 'dinosaurs-eras',
    categoryKey: 'prehistory',
    detailLevel: 'standard',
    title: {
      en: 'Dinosaurs: Evolution and Extinction',
      he: 'עולם הדינוזאורים: שלבי ההתפתחות וההכחדה'
    },
    category: {
      en: 'Prehistory & Nature',
      he: 'פרה-היסטוריה וטבע'
    },
    prompt: {
      en: 'Dinosaurs: Timeline of major eras and species, divided into swimlanes for Carnivores vs. Herbivores',
      he: 'עולם הדינוזאורים: סקירה של התקופות והמינים המפורסמים, בחלוקה למסלולים: דינוזאורים טורפים מול דינוזאורים צמחוניים'
    },
    whyItWorks: {
      en: 'Uses intuitive thematic grouping (Carnivores vs. Herbivores) instead of technical taxonomy.',
      he: 'משתמש בחלוקה נושאית אינטואיטיבית (טורפים מול צמחוניים) במקום מינוח מדעי מסובך.'
    }
  },
  {
    id: 'industrial-revolution',
    categoryKey: 'science',
    detailLevel: 'standard',
    title: {
      en: 'The Industrial Revolution & Inventions',
      he: 'המהפכה התעשייתית וההמצאות הגדולות'
    },
    category: {
      en: 'Science & Space',
      he: 'מדע וחלל'
    },
    prompt: {
      en: 'The Industrial Revolution: Breakthrough inventions and technologies that shaped the modern world',
      he: 'המהפכה התעשייתית: המצאות מפתח וטכנולוגיות ששינו את העולם המודרני'
    },
    whyItWorks: {
      en: 'Lets the AI identify pivotal breakthroughs—steam, railways, electricity, and factories—chronologically.',
      he: 'מאפשר ל-AI למפות כרונולוגית את פריצות הדרך המרכזיות: קיטור, רכבות, חשמל ובתי חרושת.'
    }
  },
  {
    id: 'israel-zionism',
    categoryKey: 'israel_jewish',
    detailLevel: 'deep_dive',
    title: {
      en: 'History of Zionism & the State of Israel',
      he: 'תולדות הציונות והקמת מדינת ישראל'
    },
    category: {
      en: 'Israel & Jewish History',
      he: 'תולדות עם ישראל וציונות'
    },
    prompt: {
      en: 'History of Zionism & the Founding of Israel: from the First Zionist Congress in Basel to the Declaration of Independence',
      he: 'תולדות הציונות והקמת מדינת ישראל: מקונגרס בזל הראשון ועד להכרזת העצמאות'
    },
    whyItWorks: {
      en: 'Clear historical bookends (Basel to Independence) guide the AI to focus on decisive milestones.',
      he: 'הגדרת תחנות פתיחה וסיום ברורות (מבזל ועד העצמאות) מכוונת את ה-AI לאבני הדרך המכריעות.'
    }
  },
  {
    id: 'harry-potter-saga',
    categoryKey: 'culture',
    detailLevel: 'overview',
    title: {
      en: 'Harry Potter Saga (Seven School Years)',
      he: 'עלילת הארי פוטר (שבע שנות הלימוד)'
    },
    category: {
      en: 'Culture & Lore',
      he: 'תרבות וספרות'
    },
    prompt: {
      en: 'Harry Potter: Chronological journey through the seven school years at Hogwarts',
      he: 'עלילת הארי פוטר לאורך שבע שנות הלימוד בהוגוורטס'
    },
    whyItWorks: {
      en: 'Shows how ChroniX visualizes fictional sagas and book storylines just as smoothly as real history.',
      he: 'מדגים כיצד ChroniX ממפה עלילות ספרותיות ועולמות בדיוניים בדיוק כמו היסטוריה אמיתית.'
    }
  }
];

export const USER_GUIDE_DATA = {
  en: {
    getting_started: {
      welcomeTitle: 'Welcome to ChroniX',
      welcomeDesc: 'ChroniX transforms any topic into an interactive visual timeline powered by Google Gemini, HistropediaJS, and verified Wikimedia imagery. Built for interactive inquiry, it empowers you to ask exploratory questions, test historical perspectives, and uncover connections across time.',
      exploreBtn: 'Explore Examples',
      navHeading: '1. Navigating the Canvas',
      zoomTitle: 'Fluid Multi-Scale Zoom',
      zoomDesc: 'Scroll or pinch to zoom smoothly from millions of years down to single days.',
      panTitle: 'Pan Across Time',
      panDesc: 'Click and drag anywhere on the canvas background to move forward or backward.',
      fitAllTitle: 'Fit All Articles',
      fitAllDesc: 'Click "Fit All" on the toolbar anytime to center the full timeline at a glance.',
      inspectHeading: '2. Inspecting Events & Drawers',
      eventDrawerTitle: 'Event Details Drawer',
      eventDrawerDesc: 'Click any card to view photos, verified dates, Wikipedia extracts, and editing tools.',
      cardsDrawerTitle: 'Cards List Drawer',
      cardsDrawerDesc: 'Open the searchable chronological list of events grouped by lanes with quick jump-to-event.',
      starTitle: 'Starring Favorites',
      starDesc: 'Click the star icon on any card to highlight key events and keep them visible even when zoomed far out.',
      stopGenTitle: 'Cancel Generation:',
      stopGenDesc: 'Press Esc or click "Stop generate" in the bottom status pill anytime.'
    },
    prompt_mastery: {
      title: 'Prompt Crafting Guide',
      subtitle: 'A few simple words are enough. Here is how to achieve the exact depth and layout you want.',
      detailHeading: '1. Choosing Detail Level',
      levels: {
        overview: {
          name: 'Overview',
          count: '~10–15 events',
          bestFor: 'A clean bird’s-eye view of key milestones or focused short-span events.',
          example: '"Cuban Missile Crisis" or "Ancient Egypt Overview"'
        },
        standard: {
          name: 'Standard (Recommended)',
          count: '~20–30 events',
          bestFor: 'Balanced depth and narrative flow for complete historical eras and biographies.',
          example: '"Ancient Rome: Republic to Empire" or "The Space Race: NASA vs. USSR"'
        },
        deep_dive: {
          name: 'Deep Dive',
          count: '~35–50 events',
          bestFor: 'Granular step-by-step history and complex multi-lane timelines.',
          example: '"World War II: European Theater vs. Pacific Theater"'
        }
      },
      swimlanesHeading: '2. Parallel Swimlanes',
      swimlanesDesc: 'Add "vs." or "divided into swimlanes for..." to compare parallel tracks side-by-side:',
      swimlanesExamples: [
        {
          title: 'Opposing Sides:',
          desc: '"Soviet Space Program vs. NASA"'
        },
        {
          title: 'Thematic Tracks:',
          desc: '"Inventions, Transport, and Labor Movements"'
        },
        {
          title: 'Geographic Theaters:',
          desc: '"European Theater vs. Pacific Theater"'
        },
        {
          title: 'Parallel History:',
          desc: '"Kings of Judah vs. Kings of Israel"'
        }
      ],
      themesHeading: '3. Automatic Color Themes',
      themesTitle: 'Color-Coded Themes & Floating Legend',
      themesDesc: 'In single timelines, events are automatically colored by theme (Politics, Science, Culture) with a draggable filter legend.',
      framingHeading: '4. Prompt Framing: Simple vs. Detailed',
      conciseTitle: 'Natural & Short: Let AI Explore',
      conciseDesc: 'Prompts like "Evolution of the horse" or "Industrial Revolution" let the AI discover key milestones automatically—no jargon required.',
      detailedTitle: 'Structured: Focus on Specific Angles',
      detailedDesc: 'Guide the AI explicitly when you want a narrow angle (e.g. "French Revolution from 1789 to 1799").',
      multilingualHeading: '5. Multilingual Prompts',
      multilingualTitle: 'Write in Any Language',
      multilingualDesc: 'ChroniX works in virtually any language (English, Hebrew, Spanish, French, etc.). Milestones and Wikipedia links match the language of your prompt.'
    },
    prompt_showcase: {
      title: 'Curated Prompt Showcase',
      subtitle: 'Click Try Now ↗ to launch any prompt immediately!',
      tryNow: 'Try Now',
      copyPrompt: 'Copy Prompt',
      copied: 'Copied!',
      whyItWorksLabel: 'Why it works:',
      detailLevels: {
        overview: 'Overview',
        standard: 'Standard',
        deep_dive: 'Deep Dive'
      }
    },
    event_editing: {
      title: 'Editing & Adding Events',
      subtitle: 'Full control to customize, edit, or add events with AI assistance and Wikipedia search.',
      cards: [
        {
          title: 'Gemini AI Auto-Fill',
          desc: 'Type an event title and click AI Auto-Fill to automatically fetch dates, summaries, and coordinates.'
        },
        {
          title: 'Wikipedia Search',
          desc: 'Search Wikipedia directly to pull verified photography and encyclopedic article summaries.'
        },
        {
          title: 'Add Custom Event (+)',
          desc: 'Click + to add any milestone to existing swimlanes or create brand new lanes on the fly.'
        }
      ],
      geoCoordsTitle: 'Geographic Coordinates',
      geoCoordsDesc: 'Add a location name and latitude/longitude coordinates in the event editor to place an interactive pin on the world map.'
    },
    ai_refine: {
      title: 'Refine with AI',
      subtitle: 'Engage in interactive inquiry: click Refine on the top toolbar to expand, tweak, or split your existing timeline without starting from scratch.',
      splitTipTitle: 'Restructuring & Splitting Tracks',
      splitTipDesc: 'Ask Gemini to reorganize existing events into parallel swimlanes by region, faction, or theme.',
      examplesHeading: 'Popular Refinement Prompts:',
      prompts: [
        {
          label: 'Split into parallel thematic paths:',
          prompt: '"Split the timeline into three parallel paths: Politics, Science, and Culture"'
        },
        {
          label: 'Divide by geographic theaters:',
          prompt: '"Divide the events into two timelines: European Theater and Pacific Theater"'
        },
        {
          label: 'Separate opposing sides:',
          prompt: '"Restructure the events into two parallel tracks: United States vs. Soviet Union"'
        },
        {
          label: 'Add, remove, or edit themes:',
          prompt: '"Add a \'Diplomacy\' theme, remove the \'Culture\' theme, and rename \'Science\' to \'Science & Technology\'"'
        },
        {
          label: 'Expand a sub-period:',
          prompt: '"Add 5 more key battles between 1942 and 1943"'
        },
        {
          label: 'Highlight scientific breakthroughs:',
          prompt: '"Add key scientific inventions and technological discoveries from this era"'
        }
      ]
    },
    geo_map: {
      title: 'Synchronized World Map',
      subtitle: 'Explore where history happened on an interactive map synchronized live with the timeline.',
      modesHeading: '4 Map Display Modes:',
      modes: [
        {
          title: '1. Floating Globe',
          desc: 'Draggable globe button showing mapped events count. Click to open PiP or Split view.'
        },
        {
          title: '2. Picture-in-Picture',
          desc: 'Compact floating map overlaid on the canvas. Drag by header or resize from corners.'
        },
        {
          title: '3. Resizable Split Screen',
          desc: 'Map on top, timeline on bottom. Drag the divider to adjust the height ratio.'
        },
        {
          title: '4. Fullscreen Map',
          desc: 'Expands across the entire screen for a comprehensive spatial overview.'
        }
      ],
      syncHeading: 'Bi-Directional Synchronization',
      syncPoints: [
        'Timeline to Map: Clicking an event card flies the map camera directly to its geographic pin.',
        'Map to Timeline: Clicking a map marker highlights the event and centers the timeline canvas.',
        'Color Coding: Map pins match each event’s swimlane color for instant visual clarity.',
        'Guided Exploration Mode: Launch a step-by-step tour that glides through events one at a time, automatically pairing the map and timeline in split-screen for an interactive chronological-geographic journey through both time and place.'
      ]
    },
    export_saving: {
      title: 'Export & Cloud Saving',
      subtitle: 'Save your work, export presentation snapshots, or share timeline datasets.',
      cards: [
        {
          title: 'Snapshot Image (PNG)',
          desc: 'Download a crisp, high-resolution image of your timeline canvas from More Actions.'
        },
        {
          title: 'JSON Export & Import',
          desc: 'Export the complete dataset as JSON or import previously saved timeline files.'
        },
        {
          title: 'Cloud Saved Timelines',
          desc: 'Timelines automatically save to your personal cloud library in Supabase for access anywhere.'
        }
      ],
      disclaimerTitle: 'AI Accuracy Notice',
      disclaimerDesc: 'Events are AI-generated and Wikipedia-enriched. While reliable, ancient dates may be approximations. You can always edit and verify any event.'
    },
    footer: {
      tagline: 'ChroniX User Guide • Built for curious minds, researchers & educators.',
      closeBtn: 'Close Guide'
    }
  },

  he: {
    getting_started: {
      welcomeTitle: 'ברוכים הבאים ל-ChroniX',
      welcomeDesc: 'ChroniX הופכת כל נושא היסטורי, מדעי או ספרותי לציר זמן ויזואלי ואינטראקטיבי המופעל על ידי Google Gemini, מנוע HistropediaJS ותמונות מאומתות מוויקימדיה. המערכת מיועדת לחקירה אינטראקטיבית, ומאפשרת לשאול שאלות, להעמיק בתקופות שונות ולגלות הקשרים חדשים.',
      exploreBtn: 'גלו דוגמאות מובילות',
      navHeading: '1. ניווט בקנבס ציר הזמן',
      zoomTitle: 'זום רציף ורב-ממדי',
      zoomDesc: 'גללו בעכבר או צבטו במשטח המגע לזום חלק ממיליוני שנים ועד לרמת ימים בודדים.',
      panTitle: 'תנועה רציפה בציר הזמן',
      panDesc: 'לחצו וגררו בכל נקודה ברקע הקנבס לתנועה חופשית קדימה ואחורה בין תקופות.',
      fitAllTitle: 'התאם הכל לתצוגה',
      fitAllDesc: 'לחצו על "התאם הכל" בסרגל העליון למרכוז וצפייה בכל טווח ציר הזמן במבט אחד.',
      inspectHeading: '2. בחינת אירועים וחלוניות המידע',
      eventDrawerTitle: 'חלונית פרטי אירוע',
      eventDrawerDesc: 'לחיצה על כל כרטיסיית אירוע מציגה תמונות, תאריכים מאומתים, תקציר מוויקיפדיה וכלי עריכה ומחיקה.',
      cardsDrawerTitle: 'רשימת כרטיסיות אירועים',
      cardsDrawerDesc: 'פתחו את רשימת האירועים הכרונולוגית לחיפוש, סינון ומעבר מיידי ישירות לכל אירוע בקנבס.',
      starTitle: 'סימון מועדפים בכוכב',
      starDesc: 'לחצו על הכוכב בכל כרטיסייה כדי להדגיש אירועי מפתח ולשמור עליהם גלויים גם בזום רחוק.',
      stopGenTitle: 'עצירת יצירה:',
      stopGenDesc: 'לחצו Esc או על "עצור יצירה" בסרגל הסטטוס התחתון בכל עת.'
    },
    prompt_mastery: {
      title: 'מדריך לניסוח פרומפט מנצח',
      subtitle: 'מספר מילים פשוטות מספיקות. כך תוכלו לקבל בדיוק את רמת הפירוט, המסלולים והמבנה הרצויים.',
      detailHeading: '1. בחירת רמת הפירוט',
      levels: {
        overview: {
          name: 'סקירה (Overview)',
          count: '~10–15 אירועים',
          bestFor: 'מבט-על מהיר על ציוני הדרך הגדולים או נושאים ממוקדים וקצרי-מועד.',
          example: '"משבר הטילים בקובה" או "מבט-על: מצרים העתיקה"'
        },
        standard: {
          name: 'סטנדרטי (מומלץ)',
          count: '~20–30 אירועים',
          bestFor: 'האיזון המושלם לתקופות היסטוריות, ביוגרפיות והשוואות בין 1–2 מסלולים.',
          example: '"רומא העתיקה: מרפובליקה לאימפריה" או "המרוץ לחלל: נאס״א מול ברה״מ"'
        },
        deep_dive: {
          name: 'מעמיק (Deep Dive)',
          count: '~35–50 אירועים',
          bestFor: 'צירים רב-מסלוליים מורכבים ומחקר היסטורי מפורט צעד-אחר-צעד.',
          example: '"מלחמת העולם השנייה: הזירה האירופית מול האוקיינוס השקט"'
        }
      },
      swimlanesHeading: '2. חלוקה למסלולים מקבילים (Swimlanes)',
      swimlanesDesc: 'הוסיפו "מול" או "בחלוקה למסלולים עבור..." כדי להשוות מסלולים מקבילים זה לצד זה:',
      swimlanesExamples: [
        {
          title: 'צדדים יריבים:',
          desc: '"תוכנית החלל הסובייטית מול נאס״א"'
        },
        {
          title: 'תחומים מקבילים:',
          desc: '"המצאות טכנולוגיות, תחבורה ותנועות פועלים"'
        },
        {
          title: 'זירות גיאוגרפיות:',
          desc: '"הזירה האירופית מול זירת האוקיינוס השקט"'
        },
        {
          title: 'השוואה היסטורית:',
          desc: '"מלכי יהודה מול מלכי ישראל"'
        }
      ],
      themesHeading: '3. צביעה נושאית אוטומטית',
      themesTitle: 'צבעים חכמים ומקרא נושאים צף',
      themesDesc: 'בציר זמן בודד, האירועים נצבעים אוטומטית לפי נושא (פוליטיקה, מדע, תרבות) לצד מקרא צף הניתן לגרירה וסינון.',
      framingHeading: '4. מבנה הפרומפט: קצר מול מובנה',
      conciseTitle: 'קצר וטבעי: תנו ל-AI לגלות',
      conciseDesc: 'פרומפטים כמו "האבולוציה של הסוס" או "המהפכה התעשייתית" מאפשרים ל-AI למפות את אבני הדרך ללא צורך במינוח מורכב.',
      detailedTitle: 'מובנה: התמקדו בזווית מוגדרת',
      detailedDesc: 'כוונו את ה-AI במפורש כשאתם מעוניינים בזווית ממוקדת (למשל: "המהפכה הצרפתית מ-1789 עד 1799").',
      multilingualHeading: '5. תמיכה מלאה בכל שפה',
      multilingualTitle: 'שפת הפרומפט קובעת את שפת הציר',
      multilingualDesc: 'ChroniX תומכת ביצירת צירים בכל שפה (עברית, אנגלית, צרפתית, ספרדית ועוד). האירועים והקישורים לוויקיפדיה יותאמו לשפת הפרומפט שבחרתם.'
    },
    prompt_showcase: {
      title: 'מאגר פרומפטים מומלצים',
      subtitle: 'לחצו על "נסו עכשיו ↗" כדי ליצור כל ציר זמן מיד!',
      tryNow: 'נסו עכשיו',
      copyPrompt: 'העתקת פרומפט',
      copied: 'הועתק!',
      whyItWorksLabel: 'למה זה עובד:',
      detailLevels: {
        overview: 'סקירה',
        standard: 'סטנדרטי',
        deep_dive: 'מעמיק'
      }
    },
    event_editing: {
      title: 'עריכה והוספת אירועים',
      subtitle: 'שליטה מלאה בעריכת כל אירוע בעזרת בינה מלאכותית וחיפוש בוויקיפדיה.',
      cards: [
        {
          title: 'מילוי אוטומטי ב-AI',
          desc: 'הקלידו כותרת אירוע ולחצו "מילוי אוטומטי" להשלמה מיידית של תאריכים, תקצירים וקואורדינטות.'
        },
        {
          title: 'חיפוש בוויקיפדיה',
          desc: 'חפשו ישירות בוויקיפדיה לשליפת תמונות מאומתות ותקצירי ערכים אנציקלופדיים.'
        },
        {
          title: 'הוספת אירוע מותאם (+)',
          desc: 'לחצו על + להוספת כל אירוע למסלול קיים או יצירת Swimlane חדש.'
        }
      ],
      geoCoordsTitle: 'קואורדינטות גיאוגרפיות',
      geoCoordsDesc: 'הזינו שם מיקום וקווי רוחב/אורך בעורך האירוע להצגת נעץ אינטראקטיבי במפת העולם.'
    },
    ai_refine: {
      title: 'ליטוש וארגון מחדש ב-AI',
      subtitle: 'חקירה אינטראקטיבית מתמשכת: לחצו על "ליטוש" בסרגל העליון כדי להרחיב, לעדכן או לפצל את ציר הזמן הקיים בלי להתחיל מאפס.',
      splitTipTitle: 'פיצול וארגון למסלולים מקבילים',
      splitTipDesc: 'בקשו מ-Gemini לארגן מחדש את האירועים במסלולים מקבילים לפי זירה גיאוגרפית, צדדים יריבים או תחומי תוכן.',
      examplesHeading: 'הנחיות ליטוש נפוצות ומומלצות:',
      prompts: [
        {
          label: 'פיצול למסלולים נושאיים:',
          prompt: '"פצל את ציר הזמן לשלושה מסלולים מקבילים: פוליטיקה, מדע ותרבות"'
        },
        {
          label: 'חלוקה לזירות גיאוגרפיות:',
          prompt: '"חלק את האירועים לשני צירי זמן: הזירה האירופית וזירת האוקיינוס השקט"'
        },
        {
          label: 'הפרדת צדדים יריבים:',
          prompt: '"ארגן מחדש את האירועים לשני מסלולים מקבילים: ארצות הברית מול ברית המועצות"'
        },
        {
          label: 'הוספה, הסרה או עריכת נושאים (Themes):',
          prompt: '"הוסף נושא חדש של \'דיפלומטיה\', הסר את נושא \'תרבות\', ושנה את \'מדע\' ל-\'מדע וטכנולוגיה\'"'
        },
        {
          label: 'הרחבת תת-תקופה:',
          prompt: '"הוסף עוד 5 קרבות מרכזיים בין השנים 1942 ל-1943"'
        },
        {
          label: 'הדגשת פריצות דרך מדעיות:',
          prompt: '"הוסף אירועים המתמקדים ברפואה, מדע והמצאות טכנולוגיות מהתקופה"'
        }
      ]
    },
    geo_map: {
      title: 'מפה גיאוגרפית מסונכרנת בזמן אמת',
      subtitle: 'גלו היכן התרחשה ההיסטוריה במפה אינטראקטיבית המסונכרנת לחלוטין עם קנבס ציר הזמן.',
      modesHeading: '4 מצבי תצוגה של המפה:',
      modes: [
        {
          title: '1. כפתור גלובוס צף',
          desc: 'כפתור צף המציג את כמות האירועים הממוקמים. לחיצה עליו פותחת חלון PiP או מסך מפוצל.'
        },
        {
          title: '2. תמונה-בתוך-תמונה (PiP)',
          desc: 'חלון מפה צף קומפקטי מעל ציר הזמן. ניתן לגרירה מסרגל הכותרת ולשינוי גודל מהפינות.'
        },
        {
          title: '3. מסך מפוצל עם פס גרירה',
          desc: 'מפה בחלק העליון וציר זמן בתחתון. גררו את פס ההפרדה לקביעת היחס הרצוי.'
        },
        {
          title: '4. מפה במסך מלא',
          desc: 'מרחיב את המפה על פני כל המסך לחקירה מרחבית מקיפה של פיזור האירועים.'
        }
      ],
      syncHeading: 'סנכרון דו-כיווני מושלם',
      syncPoints: [
        'מציר הזמן למפה: לחיצה על אירוע בציר הזמן מטיסה את מצלמת המפה ישירות לנעץ שלו.',
        'מהמפה לציר הזמן: לחיצה על נעץ במפה מדגישה את האירוע וממרכזת את קנבס ציר הזמן.',
        'התאמת צבעים: צבעי הנעצים תואמים לצבעי המסלולים לזיהוי ויזואלי מיידי.',
        'מצב חקירה מודרך: הפעילו סיור צעד-אחר-צעד בין האירועים, המסנכרן אוטומטית את המפה וציר הזמן במסך מפוצל למסע כרונולוגי-גיאוגרפי אינטראקטיבי בזמן ובמרחב.'
      ]
    },
    export_saving: {
      title: 'ייצוא ושמירה',
      subtitle: 'שמרו את עבודתכם, הורידו תמונות למצגות או גשו לצירי הזמן השמורים שלכם.',
      cards: [
        {
          title: 'תמונת קנבס (PNG)',
          desc: 'הורידו תמונה חדה ואיכותית של קנבס ציר הזמן מתפריט פעולות נוספות.'
        },
        {
          title: 'ייצוא וייבוא JSON',
          desc: 'ייצאו את מערך הנתונים המלא כקובץ JSON או ייבאו קובץ ציר זמן חיצוני.'
        },
        {
          title: 'ספריית צירים בענן',
          desc: 'צירי הזמן נשמרים אוטומטית לענן ב-Supabase לגישה מכל מכשיר.'
        }
      ],
      disclaimerTitle: 'הערת דיוק בינה מלאכותית',
      disclaimerDesc: 'האירועים נוצרים ב-AI ומועשרים מוויקיפדיה. תאריכים בעת העתיקה עשויים להיות מקורבים. תמיד תוכלו לערוך ולאמת כל אירוע.'
    },
    footer: {
      tagline: 'מדריך למשתמש ChroniX • נבנה עבור סקרנים, חוקרים ואנשי חינוך.',
      closeBtn: 'סגירת המדריך'
    }
  }
};

// Full Bilingual Data for ChroniX User Guide
// Supports complete English and Hebrew localized documentation

export const SHOWCASE_PROMPTS_DATA = [
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
      en: 'The Space Race (1955–1975), divided into separate swimlanes for the Soviet Space Program and NASA',
      he: 'המרוץ לחלל (1955–1975), בחלוקה לשני מסלולי זמן מקבילים: תוכנית החלל הסובייטית מול נאס״א'
    },
    whyItWorks: {
      en: 'Explicitly requests two parallel swimlanes (NASA vs Soviet Space Program), creating a side-by-side comparative chronology with clear start/end dates.',
      he: 'מגדיר שני מסלולי זמן מקבילים (נאס״א מול תוכנית החלל הסובייטית), המייצרים השוואה כרונולוגית עשירה זו לצד זו עם תאריכים מוגדרים.'
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
      en: 'World War II (1939–1945), divided into parallel time lanes for the European Theater, Pacific Theater, and Diplomatic Summits',
      he: 'מלחמת העולם השנייה (1939–1945), בחלוקה למסלולים מקבילים: הזירה האירופית, זירת האוקיינוס השקט וועידות דיפלומטיות'
    },
    whyItWorks: {
      en: 'Utilizes Deep Dive granularity with three separate swimlanes to organize complex simultaneous military and diplomatic events without clutter.',
      he: 'מנצל רמת פירוט מעמיקה (Deep Dive) עם שלושה מסלולים מקבילים כדי לארגן אירועים צבאיים ומדיניים מורכבים במקביל ללא עומס.'
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
      en: 'The History of Zionism and the founding of Israel: from the First Zionist Congress in Basel and the Balfour Declaration, through the Aliyah waves, underground organizations, UN Partition Plan, to the Declaration of Independence',
      he: 'תולדות הציונות והקמת מדינת ישראל: מהקונגרס הציוני בבזל והצהרת בלפור, דרך גלי העלייה ומחתרות היישוב, ועד להחלטת כ"ט בנובמבר והכרזת העצמאות'
    },
    whyItWorks: {
      en: 'Explicitly specifies pivotal chronological milestones from Basel to Independence, guiding Gemini to pinpoint essential national turning points.',
      he: 'מגדיר תחנות מפתח מפורטות מהקונגרס בבזל ועד להכרזת העצמאות, המנחות את ה-AI לבחור בדיוק את האירועים המרכזיים החשובים.'
    }
  },
  {
    id: 'first-temple-kings',
    categoryKey: 'israel_jewish',
    detailLevel: 'standard',
    title: {
      en: 'Kings of Judah and Kings of Israel (First Temple)',
      he: 'מלכי יהודה ומלכי ישראל (בית ראשון)'
    },
    category: {
      en: 'Israel & Jewish History',
      he: 'תולדות עם ישראל וציונות'
    },
    prompt: {
      en: 'First Temple Era: A timeline divided into two parallel time lanes for the Kings of Judah versus the Kings of Israel, from the division of the monarchy to the destruction of the First Temple',
      he: 'תקופת בית ראשון: ציר זמן בחלוקה לשני מסלולי זמן מקבילים עבור מלכי יהודה מול מלכי ישראל, מפלג הממלכה ועד חורבן בית ראשון'
    },
    whyItWorks: {
      en: 'Instructs Gemini to split the era into two parallel tracks (Judah vs Israel), creating a clear, accurate comparative chronology between the monarchs.',
      he: 'מורה ל-AI לחלק את התקופה לשני מסלולים מקבילים של ממלכת יהודה וממלכת ישראל, מה שיוצר השוואה כרונולוגית ברורה ומדויקת בין המלכים.'
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
      en: 'Ancient Egypt: High-level overview of the major kingdoms and dynasties from the unification of Narmer and the Great Pyramids to Cleopatra',
      he: 'מצרים העתיקה: סקירה תמציתית של הממלכות והשושלות המרכזיות מאיחוד מצרים בידי נערמר והפירמידות הגדולות ועד לקלאופטרה'
    },
    whyItWorks: {
      en: 'Uses the "Overview" setting (~10–15 events) to deliver a clean, non-overwhelming timeline spanning thousands of years of dynastic transitions.',
      he: 'עושה שימוש ברמת "סקירה" (~10–15 אירועים) להפקת ציר זמן בהיר ולא עמוס, המקיף אלפי שנות היסטוריה שושלתית.'
    }
  },
  {
    id: 'dinosaurs-eras',
    categoryKey: 'prehistory',
    detailLevel: 'standard',
    title: {
      en: 'Dinosaurs: Evolution and Extinction',
      he: 'הדינוזאורים: שלבי ההתפתחות וההכחדה'
    },
    category: {
      en: 'Prehistory & Nature',
      he: 'פרה-היסטוריה וטבע'
    },
    prompt: {
      en: 'Dinosaurs: Evolutionary stages through the Triassic, Jurassic, and Cretaceous, divided into separate lanes for Theropods (predators), Sauropods (giant herbivores), and Ornithischians',
      he: 'דינוזאורים: שלבי ההתפתחות לאורך הטריאס, היורה והקרטיקון בחלוקה למסלולים נפרדים עבור תרופודים (טורפים), זאורופודים (ענקים צמחוניים) ובעלי אגן עוף'
    },
    whyItWorks: {
      en: 'Spans a prehistoric deep-time scale (millions of years) and categorizes dinosaurs taxonomically across parallel lanes.',
      he: 'עושה שימוש בסקאלה פרה-היסטורית (מיליוני שנים אחורה) וחלוקה למסלולים טקסונומיים, המאפשרת לצפות בהתפתחות במקביל של קבוצות דינוזאורים שונות.'
    }
  },
  {
    id: 'industrial-revolution',
    categoryKey: 'science',
    detailLevel: 'deep_dive',
    title: {
      en: 'The Industrial Revolution & Inventions',
      he: 'המהפכה התעשייתית וההמצאות הגדולות'
    },
    category: {
      en: 'Science & Space',
      he: 'מדע וחלל'
    },
    prompt: {
      en: 'The Industrial Revolution, divided into separate lanes for Technological Inventions, Steam & Transportation, and Labor Movements',
      he: 'המהפכה התעשייתית: ציר זמן בחלוקה למסלולים מקבילים של המצאות טכנולוגיות, מנועי קיטור ותחבורה, ותנועות פועלים ומאבקים חברתיים'
    },
    whyItWorks: {
      en: 'Pairs technological milestones with social and labor movements across parallel lanes, revealing the human impact of technological evolution.',
      he: 'משלב אבני דרך טכנולוגיות לצד תנועות חברתיות ופועלים במסלולים מקבילים, וממחיש את השפעת הטכנולוגיה על חיי האדם.'
    }
  },
  {
    id: 'human-evolution',
    categoryKey: 'prehistory',
    detailLevel: 'overview',
    title: {
      en: 'Human Evolution Milestones',
      he: 'האבולוציה של האדם'
    },
    category: {
      en: 'Prehistory & Nature',
      he: 'פרה-היסטוריה וטבע'
    },
    prompt: {
      en: 'Human Evolution: Overview of key milestones from Lucy and Australopithecus to Neanderthals and Homo Sapiens',
      he: 'האבולוציה של האדם: סקירת אבני הדרך המרכזיות מלוסי והאוסטרלופיתקוס ועד להומו סאפיינס והאדם הניאנדרטלי'
    },
    whyItWorks: {
      en: 'Demonstrates a concise deep-time evolutionary timeline spanning millions of years highlighting hominid ancestors.',
      he: 'מדגים ציר זמן אבולוציוני תמציתי וממוקד שנע לאורך מיליוני שנים ומדגיש את אבות המין האנושי.'
    }
  },
  {
    id: 'aviation-milestones',
    categoryKey: 'science',
    detailLevel: 'overview',
    title: {
      en: 'History of Aviation',
      he: 'תולדות התעופה והטיסה'
    },
    category: {
      en: 'Science & Space',
      he: 'מדע וחלל'
    },
    prompt: {
      en: 'History of Aviation: Milestone overview from the Wright Brothers at Kitty Hawk to commercial jets and supersonic flight',
      he: 'תולדות התעופה: סקירת אבני דרך מהאחים רייט בקיטי הוק, דרך מטוסי סילון מסחריים ועד לטיסות על-קוליות ומטוסי חמקן'
    },
    whyItWorks: {
      en: 'Concise, focused single-track prompt that delivers an inspirational journey through 20th-century aerospace engineering.',
      he: 'פרומפט ממוקד ומעורר השראה המציג מסע כרונולוגי של התפתחות ההנדסה האווירית במאה ה-20.'
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
      en: 'Harry Potter: Chronological overview of the seven years at Hogwarts from Privet Drive to the Battle of Hogwarts',
      he: 'עלילת הארי פוטר: סקירה תמציתית של שבע שנות הלימוד מדרך פריווט ועד לקרב על הוגוורטס'
    },
    whyItWorks: {
      en: 'Demonstrates how ChroniX can timeline fictional literary universes and book sagas just as effectively as real history.',
      he: 'מדגים כיצד ChroniX מסוגלת לבנות ציר זמן של עולמות בדיוניים וספרותיים בדיוק כמו אירועים היסטוריים אמיתיים.'
    }
  }
];

export const USER_GUIDE_DATA = {
  en: {
    getting_started: {
      welcomeTitle: 'Welcome to ChroniX',
      welcomeDesc: 'ChroniX synthesizes any historical period, scientific story, or literary saga into a live, interactive visual timeline powered by Google Gemini, HistropediaJS, and verified Wikimedia Commons imagery.',
      exploreBtn: 'Explore Examples',
      navHeading: '1. How to Navigate the Timeline Canvas',
      zoomTitle: 'Zoom & Multi-Scale',
      zoomDesc: 'Use your mouse scroll wheel or trackpad pinch to fluidly zoom from millions of years down to single days and hours. You can also use the + and - zoom buttons on the toolbar.',
      panTitle: 'Pan Across Time',
      panDesc: 'Click and drag anywhere on the timeline background to pan backward and forward across historical eras seamlessly.',
      fitAllTitle: 'Fit All Articles',
      fitAllDesc: 'Click the Fit All button on the toolbar anytime to re-center the canvas and view the full span of your timeline at a single glance.',
      inspectHeading: '2. Inspecting Events & The Side Drawers',
      eventDrawerTitle: 'Event Details Drawer (Right)',
      eventDrawerDesc: 'Click any event card on the timeline canvas to open its comprehensive slide-over drawer. You can view high-res Wikimedia photography, verified dates, encyclopedic summaries, and direct Wikipedia article links. From here, you can also Edit or Delete the event.',
      cardsDrawerTitle: 'Cards List Drawer (Left)',
      cardsDrawerDesc: 'When a timeline is loaded, a floating button appears on the screen edge. Click it to open a searchable, chronological list of all events grouped by swimlanes. Selecting any card instantly flies the camera to that event on the canvas.',
      stopGenTitle: 'Stopping Generation:',
      stopGenDesc: 'If you want to cancel an in-flight prompt, press the Esc key or click Stop generate in the bottom status pill.'
    },
    prompt_mastery: {
      title: 'How to Write a Powerful Prompt',
      subtitle: 'ChroniX understands natural language in both English and Hebrew. Here is how to achieve the best chronological structure, lane divisions, and event depth.',
      detailHeading: '1. Choosing the Right Detail Level',
      levels: {
        overview: {
          name: 'Overview',
          count: '~10–15 events',
          bestFor: 'Long historical epochs, complete civilizational overviews, or rapid high-level summaries.',
          example: '"Ancient Egypt overview from the Old Kingdom to Cleopatra"'
        },
        standard: {
          name: 'Standard (Recommended)',
          count: '~20–30 events',
          bestFor: 'The default balanced experience. Provides a rich narrative arc with pivotal figures, battles, and turning points.',
          example: '"The Space Race (1955–1975) between NASA and USSR"'
        },
        deep_dive: {
          name: 'Deep Dive',
          count: '~35–50 events',
          bestFor: 'Specific wars, intensive biographies, short intense crises, or granular scientific evolutions.',
          example: '"World War II in Europe, month-by-month key campaigns"'
        }
      },
      swimlanesHeading: '2. Dividing into Swimlanes (Parallel Thematic Tracks)',
      swimlanesDesc: 'One of ChroniX\'s most powerful features is parallel swimlanes. You can explicitly instruct Gemini to categorize events into distinct horizontal tracks by writing:',
      swimlanesExamples: [
        {
          title: 'Opposing Factions / Nations:',
          desc: '"...divided into swimlanes for Soviet Space Program vs NASA" or "...Allied Powers vs Axis Powers"'
        },
        {
          title: 'Thematic Disciplines:',
          desc: '"...split into Technological Inventions, Steam & Transport, and Labor Movements"'
        },
        {
          title: 'Geographic Theaters:',
          desc: '"...lanes for European Theater, Pacific Theater, and Diplomatic Summits"'
        },
        {
          title: 'Parallel Division in Hebrew:',
          desc: '"...בחלוקה למסלולים נפרדים עבור מלכי יהודה מול מלכי ישראל"'
        }
      ],
      framingHeading: '3. Prompt Framing: Concise vs Detailed',
      conciseTitle: 'When to use Concise Prompts',
      conciseDesc: 'Short prompts like "The French Revolution" or "History of Aviation" allow Gemini creative freedom to choose the most recognized consensus milestones. Perfect for quick exploration!',
      detailedTitle: 'When to use Detailed Prompts',
      detailedDesc: 'If you want specific bookends, specify them explicitly: "The French Revolution from the Storming of the Bastille (1789) to Napoleon\'s 18 Brumaire coup (1799), focusing on political factions".'
    },
    prompt_showcase: {
      title: 'Interactive Prompt Showcase',
      subtitle: 'Click Try Now ↗ to open the prompt in a new window and generate it immediately!',
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
      title: 'Editing & Adding Events (Full Control)',
      subtitle: 'You are never locked into AI-generated events. ChroniX gives you full power to edit, augment, or create brand-new events with smart AI assist and Wikipedia search.',
      cards: [
        {
          title: 'Gemini AI Auto-Fill',
          desc: 'Type an event title (e.g., "Apollo 11 Moon Landing") and click AI Auto-Fill. Gemini will automatically determine the historical dates, precision, relevant lane, Wikipedia link, extract, and geographic coordinates!'
        },
        {
          title: 'Wikipedia Candidate Picker',
          desc: 'Click Search Wikipedia to query Wikimedia Commons. If multiple candidates exist, an interactive disambiguation picker lets you select the exact article to instantly pull verified photography and descriptions.'
        },
        {
          title: 'Add Custom Event (+)',
          desc: 'Click the + button on the toolbar or menu anytime to add any milestone. You can assign it to existing swimlanes or type a new lane name to create a brand new swimlane automatically.'
        }
      ],
      geoCoordsTitle: 'Adding Geographic Coordinates to Events',
      geoCoordsDesc: 'Inside the Event Edit Modal, scroll down to Location & Coordinates. You can enter a location name (e.g. "Normandy, France") and Latitude/Longitude coordinates (e.g. 49.4144, -0.8322). When populated, the event instantly gains a map marker on the interactive world map!'
    },
    ai_refine: {
      title: 'Refine Your Timeline with AI',
      subtitle: 'Click the Refine button on the top toolbar to converse with Gemini and iteratively expand or tweak your existing timeline without starting from scratch.',
      examplesHeading: 'Popular Refinement Prompts:',
      prompts: [
        {
          label: 'Expand a specific sub-era:',
          prompt: '"Add 5 more key battles that took place in the Pacific theater between 1942 and 1943"'
        },
        {
          label: 'Add cultural/social context:',
          prompt: '"Include cultural, philosophical, and social developments that occurred during this reign"'
        },
        {
          label: 'Highlight scientific breakthroughs:',
          prompt: '"Add events focused on medicine, science, and technological inventions in this era"'
        },
        {
          label: 'Cover aftermath & consequences:',
          prompt: '"Add 3 events showing the long-term aftermath and diplomatic treaties in the decade following"'
        }
      ]
    },
    geo_map: {
      title: 'Synchronized Geographic Map Feature',
      subtitle: 'History happened in both Time and Space. ChroniX integrates a live Leaflet world map synchronized in real time with the timeline canvas.',
      modesHeading: 'The 4 Map Display Modes:',
      modes: [
        {
          title: '1. Floating Earth Icon',
          desc: 'A discrete, draggable globe button located on your screen showing the count of mapped events. Click it anytime to open the Picture-in-Picture window or Split view.'
        },
        {
          title: '2. Picture-in-Picture (PiP) Window',
          desc: 'A compact floating map window overlaid above the timeline. You can drag it anywhere by its header bar, and resize it from its corners and edges.'
        },
        {
          title: '3. Resizable Split Screen',
          desc: 'Splits the screen horizontally with the Geo Map on top and Timeline on the bottom. Drag the divider bar up or down to adjust the ratio, or double-click it to reset to 50/50.'
        },
        {
          title: '4. Fullscreen Map Mode',
          desc: 'Expands the map to take over the entire screen for a comprehensive spatial overview of historical events worldwide.'
        }
      ],
      syncHeading: 'Bi-Directional Synchronization',
      syncPoints: [
        'Timeline to Map: Clicking any event on the timeline automatically flies the map camera to its geographic location and opens its detail popup.',
        'Map to Timeline: Clicking any pin on the map highlights that event, opens the drawer, and centers the timeline canvas right onto that card!',
        'Lane Color Pin Coding: Each map marker is color-coded according to its swimlane color for instant visual categorization.'
      ]
    },
    export_saving: {
      title: 'Exporting, Saving & Settings',
      subtitle: 'Preserve your work, export presentations, or load previously generated chronologies anytime.',
      cards: [
        {
          title: 'Snapshot Image (PNG)',
          desc: 'Under the More Actions menu (three vertical dots), click Export Snapshot (PNG) to download a crisp image file of your timeline canvas.'
        },
        {
          title: 'Data Export & Import (JSON)',
          desc: 'Export your complete timeline dataset (events, lanes, coordinates, and Wiki extracts) as a JSON file, or import external JSON files via Saved Timelines.'
        },
        {
          title: 'Saved Timelines Library',
          desc: 'All created and edited timelines are automatically saved to your cloud library in Supabase. Re-open any past exploration anytime from the menu.'
        }
      ],
      disclaimerTitle: 'AI Accuracy Notice',
      disclaimerDesc: 'Timeline events are structured by Google Gemini AI and enriched with Wikimedia Commons. While models are highly capable, dates (especially in ancient BCE history) or minor facts may occasionally contain approximations. You can always verify and correct dates via the Edit Event dialog and Search Wikipedia.'
    },
    footer: {
      tagline: 'ChroniX User Guide • Built for curious minds, researchers & educators.',
      closeBtn: 'Close Guide'
    }
  },

  he: {
    getting_started: {
      welcomeTitle: 'ברוכים הבאים ל-ChroniX',
      welcomeDesc: 'ChroniX מסנתזת כל תקופה היסטורית, עלילה מדעית או סאגה ספרותית לכדי ציר זמן ויזואלי ואינטראקטיבי המופעל על ידי Google Gemini, מנוע HistropediaJS ותמונות מאומתות מוויקימדיה קומונס.',
      exploreBtn: 'גלו דוגמאות מובילות',
      navHeading: '1. כיצד לנווט בקנבס ציר הזמן',
      zoomTitle: 'זום וסקאלה רב-ממדית',
      zoomDesc: 'השתמשו בגלגלת העכבר או בהרחבת אצבעות במשטח המגע כדי לבצע זום ממיליוני שנים ועד לרמת שעות וימים בודדים. ניתן להשתמש גם בכפתורי + ו- - בסרגל הכלים העליון.',
      panTitle: 'תנועה רציפה בציר הזמן',
      panDesc: 'לחצו וגררו בכל נקודה ברקע של ציר הזמן כדי לנוע קדימה ואחורה בין תקופות היסטוריות באופן חלק, מהיר ונוח.',
      fitAllTitle: 'התאמת כל האירועים לתצוגה',
      fitAllDesc: 'לחצו על כפתור "התאם הכל" בסרגל העליון בכל עת כדי למרכז את התצוגה ולצפות בכל טווח ציר הזמן מראשיתו ועד סופו במבט אחד.',
      inspectHeading: '2. בחינת אירועים וחלוניות המידע',
      eventDrawerTitle: 'חלונית פרטי אירוע (מימין)',
      eventDrawerDesc: 'לחיצה על כל כרטיסייה בקנבס פותחת חלונית צד עשירה הכוללת תצלומי ויקימדיה איכותיים, תאריכים מדויקים, תקצירי ויקיפדיה מקיפים וקישור לערך המלא. מכאן תוכלו גם לערוך או למחוק את האירוע.',
      cardsDrawerTitle: 'מגירת רשימת הכרטיסיות (משמאל)',
      cardsDrawerDesc: 'כאשר ציר זמן נטען, מופיע כפתור צף בקצה המסך. לחיצה עליו פותחת רשימה כרונולוגית מלאה של כל האירועים בחלוקה למסלולים ועם שורת חיפוש. בחירת כרטיסייה מטיסה מיד את התצוגה לאירוע בקנבס.',
      stopGenTitle: 'עצירת תהליך היצירה:',
      stopGenDesc: 'אם ברצונכם לעצור יצירת ציר זמן בעיצומה, לחצו על מקש Esc במקלדת או על כפתור "עצור יצירה" בבועת הסטטוס התחתונה.'
    },
    prompt_mastery: {
      title: 'כיצד לנסח פרומפט מנצח',
      subtitle: 'ChroniX מבינה שפה טבעית בעברית ובאנגלית. להלן הכללים והטיפים להשגת המבנה הכרונולוגי המדויק ביותר, חלוקה אידיאלית למסלולים ורמת פירוט נכונה.',
      detailHeading: '1. בחירת רמת הפירוט המתאימה',
      levels: {
        overview: {
          name: 'מבט-על (Overview)',
          count: '~10–15 אירועים',
          bestFor: 'תקופות היסטוריות ארוכות, סקירת ציוויליזציות שלמות או סיכום תמציתי ממוקד.',
          example: '"מצרים העתיקה: סקירה תמציתית מהממלכה הקדומה ועד קלאופטרה"'
        },
        standard: {
          name: 'סטנדרטי (מומלץ כברירת מחדל)',
          count: '~20–30 אירועים',
          bestFor: 'חוויה מאוזנת ועשירה. מספקת קשת עלילתית מלאה עם דמויות מפתח, קרבות ונקודות מפנה היסטוריות.',
          example: '"המרוץ לחלל (1955–1975) בין נאס״א לברית המועצות"'
        },
        deep_dive: {
          name: 'מעמיק (Deep Dive)',
          count: '~35–50 אירועים',
          bestFor: 'מלחמות ספציפיות, ביוגרפיות מפורטות, משברים קצרים ואינטנסיביים או התפתחויות מדעיות שלב-אחר-שלב.',
          example: '"מלחמת העולם השנייה באירופה, מערכות מפתח חודש אחר חודש"'
        }
      },
      swimlanesHeading: '2. חלוקה למסלולי זמן מקבילים (Swimlanes)',
      swimlanesDesc: 'אחת היכולות העוצמתיות ביותר של ChroniX היא חלוקה למסלולים אופקיים מקבילים. תוכלו להורות ל-Gemini במפורש לארגן את האירועים במסלולים נושאיים על ידי ניסוח מתאים:',
      swimlanesExamples: [
        {
          title: 'צדדים יריבים ומדינות:',
          desc: '"...בחלוקה למסלולים עבור תוכנית החלל הסובייטית מול נאס״א" או "...בעלות הברית מול מדינות הציר"'
        },
        {
          title: 'תחומי תוכן ומדע שונים:',
          desc: '"...פיצול למסלולים עבור המצאות טכנולוגיות, תחבורה ותנועות פועלים ומאבקים חברתיים"'
        },
        {
          title: 'זירות גיאוגרפיות:',
          desc: '"...מסלולים לזירה האירופית, זירת האוקיינוס השקט וועידות דיפלומטיות בינלאומיות"'
        },
        {
          title: 'דוגמה היסטורית עברית:',
          desc: '"...בחלוקה למסלולים נפרדים עבור מלכי יהודה מול מלכי ישראל"'
        }
      ],
      framingHeading: '3. מבנה הפרומפט: קצר ותמציתי מול מפורט',
      conciseTitle: 'מתי להשתמש בפרומפט קצר',
      conciseDesc: 'פרומפטים קצרים כמו "המהפכה הצרפתית" או "תולדות התעופה" מאפשרים ל-Gemini חופש יצירתי לבחור את אבני הדרך המוסכמות והחשובות ביותר. מעולה לגילוי ראשוני מהיר!',
      detailedTitle: 'מתי להשתמש בפרומפט מפורט',
      detailedDesc: 'אם יש לכם תחימה ספציפית, ציינו אותה במפורש: "המהפכה הצרפתית מנפילת הבסטיליה (1789) ועד לעליית נפוליאון (1799), תוך התמקדות בפלגים הפוליטיים והמאבקים הפנימיים".'
    },
    prompt_showcase: {
      title: 'מאגר פרומפטים אינטראקטיבי',
      subtitle: 'לחצו על "נסו עכשיו ↗" כדי לפתוח את הפרומפט בחלון חדש וליצור אותו מיד!',
      tryNow: 'נסו עכשיו',
      copyPrompt: 'העתקת פרומפט',
      copied: 'הועתק!',
      whyItWorksLabel: 'למה זה עובד:',
      detailLevels: {
        overview: 'מבט-על',
        standard: 'סטנדרטי',
        deep_dive: 'מעמיק'
      }
    },
    event_editing: {
      title: 'עריכה והוספת אירועים (שליטה מלאה)',
      subtitle: 'אינכם כבולים לאירועים שה-AI יצר. ל-ChroniX יש כלים מלאים המאפשרים לכם לערוך, להוסיף או ליצור אירועים חדשים לחלוטין בעזרת בינה מלאכותית וחיפוש בוויקיפדיה.',
      cards: [
        {
          title: 'מילוי אוטומטי בעזרת Gemini AI',
          desc: 'הקלידו כותרת אירוע (למשל "נחיתת אפולו 11 על הירח") ולחצו על "מילוי אוטומטי ב-AI". המודל ישלים מיד תאריכים מדויקים, דרגת דיוק, מסלול מתאים, קישור לוויקיפדיה, תקציר וקואורדינטות גיאוגרפיות!'
        },
        {
          title: 'איתור ערך מדויק מוויקיפדיה',
          desc: 'לחצו על "חיפוש בוויקיפדיה" כדי לתשאל את מאגרי ויקימדיה. במידה וקיימות מספר תוצאות, חלונית בחירה אינטראקטיבית מאפשרת לבחור את הערך המדויק ולשלוף באופן מיידי תמונות מאומתות ותקציר.'
        },
        {
          title: 'הוספת אירוע מותאם אישית (+)',
          desc: 'לחצו על כפתור ה- + בסרגל או בתפריט בכל עת כדי להוסיף כל אירוע. תוכלו לשייך אותו למסלול קיים או להקליד שם מסלול חדש כדי לפתוח Swimlane חדש אוטומטית.'
        }
      ],
      geoCoordsTitle: 'הוספת קואורדינטות גיאוגרפיות לאירועים',
      geoCoordsDesc: 'בתוך חלונית עריכת האירוע, גללו אל "מיקום וקואורדינטות". תוכלו להזין שם מיקום (למשל "נורמנדי, צרפת") וקואורדינטות קו רוחב ואורך (למשל 49.4144, -0.8322). ברגע שהשדות מלאים, האירוע מקבל מיד נעץ במפה האינטראקטיבית!'
    },
    ai_refine: {
      title: 'שכלול וליטוש ציר הזמן באמצעות AI',
      subtitle: 'לחצו על כפתור "ליטוש" בסרגל הכלים העליון כדי לשוחח עם Gemini ולהרחיב, לעדכן או לחדד את ציר הזמן הקיים בלי להתחיל מאפס.',
      examplesHeading: 'הנחיות ליטוש נפוצות ומומלצות:',
      prompts: [
        {
          label: 'הרחבת תת-תקופה ספציפית:',
          prompt: '"הוסף עוד 5 קרבות מרכזיים שהתרחשו בזירת האוקיינוס השקט בין השנים 1942 ל-1943"'
        },
        {
          label: 'הוספת הקשר תרבותי וחברתי:',
          prompt: '"כלול התפתחויות תרבותיות, פילוסופיות וחברתיות שהתרחשו בתקופת שלטון זו"'
        },
        {
          label: 'הדגשת פריצות דרך מדעיות:',
          prompt: '"הוסף אירועים המתמקדים ברפואה, מדע והמצאות טכנולוגיות מרכזיות בתקופה זו"'
        },
        {
          label: 'כיסוי תוצאות והשלכות ארוכות טווח:',
          prompt: '"הוסף 3 אירועים המציגים את ההשלכות המדיניות וההסכמים הדיפלומטיים בעשור שלאחר מכן"'
        }
      ]
    },
    geo_map: {
      title: 'מפה גיאוגרפית מסונכרנת בזמן אמת',
      subtitle: 'ההיסטוריה התרחשה בזמן ובמרחב כאחד. ChroniX משלבת מפת עולם אינטראקטיבית של Leaflet המסונכרנת לחלוטין ובאופן דו-כיווני עם קנבס ציר הזמן.',
      modesHeading: '4 מצבי התצוגה של המפה:',
      modes: [
        {
          title: '1. כפתור כדור הארץ הצף',
          desc: 'כפתור גלובוס צף ונגרר הממוקם על המסך ומציג את מספר האירועים בעלי מיקום גיאוגרפי. לחיצה עליו פותחת חלון תמונה-בתוך-תמונה או תצוגה מפוצלת.'
        },
        {
          title: '2. חלון תמונה-בתוך-תמונה (PiP)',
          desc: 'חלון מפה צף קומפקטי הממוקם מעל ציר הזמן. ניתן לגרור אותו מכל נקודה בסרגל הכותרת שלו ולשנות את גודלו מהפינות והשוליים.'
        },
        {
          title: '3. מסך מפוצל עם פס גרירה',
          desc: 'מפצל את המסך אופקית: המפה בחלק העליון וציר הזמן בחלק התחתון. גררו את פס ההפרדה מעלה ומטה לקביעת היחס הרצוי, או לחצו עליו לחיצה כפולה לאיפוס ל-50/50.'
        },
        {
          title: '4. מפה במסך מלא',
          desc: 'מרחיב את המפה על פני כל שטח המסך לחקירה מרחבית מקיפה של פיזור האירועים ההיסטוריים ברחבי העולם.'
        }
      ],
      syncHeading: 'סנכרון דו-כיווני מושלם',
      syncPoints: [
        'מציר הזמן למפה: לחיצה על כל אירוע בקנבס ציר הזמן מטיסה מיד את מצלמת המפה למיקומו הגיאוגרפי ופותחת חלונית מידע.',
        'מהמפה לציר הזמן: לחיצה על כל נעץ במפה מדגישה את האירוע, פותחת את מגירת הפרטים וממרכזת את קנבס ציר הזמן ישירות עליו!',
        'התאמת צבעי נעצים למסלולים: כל נעץ במפה צבוע בהתאם לצבע ה-Swimlane שאליו הוא שייך לזיהוי ויזואלי מיידי.'
      ]
    },
    export_saving: {
      title: 'ייצוא, שמירה והגדרות',
      subtitle: 'שמרו את עבודתכם, ייצאו אותה למצגות ומסמכים או טענו צירי זמן קודמים בכל עת.',
      cards: [
        {
          title: 'תמונת קנבס חדה (PNG)',
          desc: 'תחת תפריט פעולות נוספות (שלוש נקודות אנכיות), לחצו על "ייצוא צילום מסך (PNG)" כדי להוריד תמונה חדה של קנבס ציר הזמן.'
        },
        {
          title: 'ייצוא וייבוא נתונים (JSON)',
          desc: 'ייצאו את מערך הנתונים המלא של ציר הזמן (אירועים, מסלולים, קואורדינטות ותקצירים) כקובץ JSON, או ייבאו קובץ קיים דרך חלונית צירי הזמן השמורים.'
        },
        {
          title: 'ספריית צירי הזמן השמורים',
          desc: 'כל ציר זמן שנוצר או נערך נשמר אוטומטית לספריית הענן האישית שלכם ב-Supabase. תוכלו לחזור לכל פרויקט קודם בכל עת מתפריט המערכת.'
        }
      ],
      disclaimerTitle: 'הודעת דיוק בינה מלאכותית',
      disclaimerDesc: 'אירועי ציר הזמן מסונתזים על ידי Google Gemini ומועשרים ממאגרי ויקימדיה קומונס. על אף יכולות המודל הגבוהות, תאריכים (במיוחד בעת העתיקה לפנה"ס) או עובדות משניות עשויים לכלול קירובים. תמיד תוכלו לאמת ולתקן כל תאריך ואירוע באמצעות חלונית עריכת האירוע וחיפוש בוויקיפדיה.'
    },
    footer: {
      tagline: 'מדריך למשתמש ChroniX • נבנה עבור סקרנים, חוקרים ואנשי חינוך.',
      closeBtn: 'סגירת המדריך'
    }
  }
};

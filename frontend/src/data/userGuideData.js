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
      en: 'Demonstrates how to instruct the AI to compare two historical adversaries (NASA vs Soviet Space Program) across parallel tracks.',
      he: 'מדגים כיצד להורות ל-AI להשוות במקביל בין שני יריבים היסטוריים (נאס״א מול תוכנית החלל הסובייטית) במסלולים נפרדים.'
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
      en: 'Shows how to direct the AI into three distinct geographical/political theaters at Deep Dive granularity.',
      he: 'מראה כיצד להנחות את ה-AI בדיוק לזירות גיאוגרפיות ומדיניות מוגדרות ברמת פירוט מעמיקה.'
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
      en: 'Listing key historical bookends explicitly (Basel to Independence) ensures the AI focuses on these exact moments.',
      he: 'ציון אבני דרך מרכזיות במפורש (מבזל ועד העצמאות) מבטיח שה-AI יתמקד בדיוק בתחנות אלו.'
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
      en: 'Splits the monarchy era into parallel tracks for Judah and Israel for direct chronological comparison.',
      he: 'מפצל את תקופת המלוכה לשני מסלולים מקבילים עבור יהודה וישראל לצורך השוואה כרונולוגית ישירה.'
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
      he: 'מצרים העתיקה: ציר זמן של הפרעונים והמונומנטים הגדולים מהפירמידות ועד לקלאופטרה'
    },
    whyItWorks: {
      en: 'No need to know dynasty names or archaeological jargon. Stating the broad epoch lets the AI build a rich, digestible timeline.',
      he: 'אין צורך לדעת שמות שושלות או מונחים ארכאולוגיים. פשוט מציינים את התקופה וה-AI פורס ציר זמן היסטורי מרתק.'
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
      en: 'Dinosaurs: Timeline of major eras and famous species, divided into swimlanes for Carnivores vs Herbivores',
      he: 'עולם הדינוזאורים: סקירה של התקופות והמינים המפורסמים, בחלוקה למסלולים: דינוזאורים טורפים מול דינוזאורים צמחוניים'
    },
    whyItWorks: {
      en: 'Uses intuitive swimlanes (Carnivores vs Herbivores) to explore prehistoric species without taxonomic jargon.',
      he: 'חלוקה אינטואיטיבית לשני מסלולים (טורפים מול צמחוניים) מאפשרת להכיר את ענקי העבר בלי להסתבך בשמות מדעיים.'
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
      en: 'The Industrial Revolution: The major inventions and breakthroughs that shaped our modern world',
      he: 'המהפכה התעשייתית: ההמצאות הגדולות והטכנולוגיות ששינו את חיי האדם'
    },
    whyItWorks: {
      en: 'A simple, direct prompt that lets the AI discover and map pivotal inventions (steam, railways, electricity, factories) automatically.',
      he: 'ניסוח קצר וישיר שנותן ל-AI למפות את המצאות המפתח (קיטור, רכבות, חשמל ובתי חרושת) לאורך ציר הזמן.'
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
      en: 'Human Evolution: The journey of humanity from early hominid ancestors to modern humans',
      he: 'האבולוציה של האדם: המסע של האנושות מהקופים הקדומים ועד לאדם המודרני'
    },
    whyItWorks: {
      en: 'Demonstrates how a simple topic yields a complete evolutionary journey of millions of years without needing complex anthropology terms.',
      he: 'מדגים איך נושא פשוט מניב ציר זמן אבולוציוני שלם של מיליוני שנים, ללא צורך במונחים מסובכים באנתרופולוגיה.'
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
      en: "History of Aviation: From the Wright brothers' first flight to jet aircraft and space exploration",
      he: 'תולדות התעופה: מהטיסה הראשונה של האחים רייט ועד למטוסי הסילון והחלל'
    },
    whyItWorks: {
      en: 'A clear journey through aerospace history phrased in everyday, accessible language.',
      he: 'מסע כרונולוגי של התפתחות הטיסה במאה ה-20 בשפה פשוטה, בהירה ונגישה.'
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
      en: 'Shows that ChroniX timelines fictional worlds and literary sagas with simple, natural language just as easily as real history.',
      he: 'מדגים כיצד ChroniX מסוגלת לבנות ציר זמן של עולמות ספרותיים ובדיוניים בשפה טבעית בדיוק כמו היסטוריה אמיתית.'
    }
  },
  {
    id: 'life-evolution',
    categoryKey: 'prehistory',
    detailLevel: 'deep_dive',
    title: {
      en: 'Evolution of Life on Earth',
      he: 'התפתחות החיים על פני כדור הארץ'
    },
    category: {
      en: 'Prehistory & Nature',
      he: 'פרה-היסטוריה וטבע'
    },
    prompt: {
      en: 'The Evolution of Life on Earth from the beginning to the present day, divided into parallel swimlanes for Animals, Plants, and Microorganisms',
      he: 'התפתחות החיים על פני כדור הארץ מראשיתם ועד ימינו, בחלוקה לשלושה מסלולים מקבילים: בעלי חיים, צמחים, ומיקרואורגניזמים (יצורים חד-תאיים)'
    },
    whyItWorks: {
      en: 'Asks for a comprehensive evolutionary story using three simple, intuitive tracks (Animals, Plants, Microorganisms). The AI handles the scientific timeline and discovers key fossil milestones for you.',
      he: 'מגדיר נושא רחב ומרתק ומבקש לחלק אותו לשלושה מסלולים פשוטים וברורים (בעלי חיים, צמחים וחד-תאיים). ה-AI מוצא בעצמו את נקודות המפנה והמאובנים החשובים ללא צורך בידע מוקדם.'
    }
  },
  {
    id: 'universe-evolution',
    categoryKey: 'science',
    detailLevel: 'standard',
    title: {
      en: 'Evolution of the Universe',
      he: 'התפתחות היקום'
    },
    category: {
      en: 'Science & Space',
      he: 'מדע וחלל'
    },
    prompt: {
      en: 'The Evolution of the Universe from the Big Bang to today, divided into parallel swimlanes for Early Universe Expansion, Stars & Galaxies Formation, and the Solar System & Earth',
      he: 'התפתחות היקום מהמפץ הגדול ועד ימינו, בחלוקה לשלושה מסלולים מקבילים: שלבי התפשטות היקום, היווצרות כוכבים וגלקסיות, והיווצרות מערכת השמש וכדור הארץ'
    },
    whyItWorks: {
      en: 'Allows anyone to see side-by-side how the cosmos expanded, when stars and galaxies were born, and how our solar system formed — in clear, natural language without complex astrophysics jargon.',
      he: 'מאפשר לראות זה לצד זה איך היקום התפשט, מתי נולדו הכוכבים והגלקסיות, ומתי נוצרו כדור הארץ ומערכת השמש – בניסוח טבעי וללא מונחים אסטרופיזיקליים מסובכים.'
    }
  },
  {
    id: 'game-of-thrones-houses',
    categoryKey: 'culture',
    detailLevel: 'standard',
    title: {
      en: 'Game of Thrones: The Great Houses',
      he: 'עלילת משחקי הכס לפי בתי מלוכה'
    },
    category: {
      en: 'Culture & Lore',
      he: 'תרבות וספרות'
    },
    prompt: {
      en: 'The storyline of Game of Thrones, divided into three parallel swimlanes for House Stark, House Lannister, and House Targaryen',
      he: 'עלילת משחקי הכס, בחלוקה לשלושה מסלולים מקבילים עבור בית סטארק, בית לאניסטר ובית טרגאריין'
    },
    whyItWorks: {
      en: 'Organizes the expansive storyline by major rival factions, letting you easily follow the journey of each great house without getting lost in the cast of characters.',
      he: 'מארגן את העלילה המפותלת לפי שלושת בתי האב המרכזיים, ומאפשר לעקוב בקלות אחרי הקורות של כל בית בנפרד בלי ללכת לאיבוד בשפע הדמויות.'
    }
  },
  {
    id: 'israeli-palestinian-conflict',
    categoryKey: 'modern_history',
    detailLevel: 'standard',
    title: {
      en: 'The Israeli-Palestinian Conflict',
      he: 'הסכסוך הישראלי-פלסטיני'
    },
    category: {
      en: 'Modern History',
      he: 'היסטוריה מודרנית'
    },
    prompt: {
      en: 'The history of the Israeli-Palestinian conflict: Major events, wars, and peace agreements from its beginnings to the present day',
      he: 'ההיסטוריה של הסכסוך הישראלי-פלסטיני: סקירה של האירועים, המלחמות והסכמי השלום המרכזיים מראשיתו ועד ימינו'
    },
    whyItWorks: {
      en: 'A neutral, single-track prompt that creates a clear, step-by-step chronological timeline of major events, clashes, and treaties for someone learning the history.',
      he: 'פרומפט ממוקד וניטרלי במסלול יחיד שיוצר ציר זמן כרונולוגי שלב אחר שלב של האירועים, העימותים וההסכמים העיקריים, בצורה מסודרת ונוחה ללמידה.'
    }
  },
  {
    id: 'history-of-rock',
    categoryKey: 'culture',
    detailLevel: 'deep_dive',
    title: {
      en: 'History of Rock Music',
      he: 'תולדות מוזיקת הרוק'
    },
    category: {
      en: 'Culture & Lore',
      he: 'תרבות וספרות'
    },
    prompt: {
      en: 'History of rock music from the 1950s to the present day, divided into parallel swimlanes for Classic Rock, Punk & Heavy Metal, and Alternative & Grunge',
      he: 'תולדות מוזיקת הרוק משנות ה-50 ועד ימינו, בחלוקה לשלושה מסלולים מקבילים: רוק קלאסי, פאנק ומטאל, ורוק אלטרנטיבי וגראנג\''
    },
    whyItWorks: {
      en: 'Shows how to organize a massive, 70-year musical history by instructing the AI to split by stylistic movements across parallel swimlanes.',
      he: 'מראה כיצד לארגן עשרות שנות מוזיקה עמוסות על ידי הנחיית ה-AI לחלוקה לפי זרמים סגנוניים במסלולים מקבילים.'
    }
  },
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
      en: 'A fascinating, accessible prompt: traces the classic evolutionary sequence from small multi-toed forest dwellers to the modern horse, with clear transitional fossils.',
      he: 'פרומפט מרתק ונגיש: מדגים את המסע האבולוציוני הקלאסי מיונקים קטנים בעלי מספר אצבעות לסוס המודרני, עם שלבי מעבר ומאובנים ברורים.'
    }
  },
  {
    id: 'hebrew-alphabet-evolution',
    categoryKey: 'israel_jewish',
    detailLevel: 'standard',
    title: {
      en: 'Evolution of the Hebrew Alphabet & Script',
      he: 'התפתחות האלפבית והכתב העברי'
    },
    category: {
      en: 'Israel & Jewish History',
      he: 'תולדות עם ישראל וציונות'
    },
    prompt: {
      en: 'The Evolution of the Hebrew Alphabet from ancient origins to modern times, divided into parallel swimlanes for Script Styles & Typography (from Proto-Canaanite and Paleo-Hebrew to Square Script and modern print) vs. Languages, Peoples & Cultural Influences',
      he: 'התפתחות האלפבית והכתב העברי מהמקורות הקדומים ועד ימינו, בחלוקה לשני מסלולים מקבילים: גלגולי סגנונות הכתב (מפרוטו-כנעני ועברי קדום ועד הכתב המרובע והדפוס המודרני) מול השפות, העמים וההשפעות התרבותיות לאורך הדורות'
    },
    whyItWorks: {
      en: 'Demonstrates how to explore a fascinating linguistic and historical topic: parallel swimlanes let you view the visual evolution of letterforms and scripts alongside the peoples, languages, and historical events that shaped them.',
      he: 'מדגים כיצד לחקור נושא בלשני-היסטורי מרתק: החלוקה לשני מסלולים מקבילים מאפשרת לראות זה לצד זה את השינויים הצורניים של האותיות והכתב מול העמים, השפות והמאורעות ההיסטוריים שהובילו לתמורות אלו.'
    }
  },
  {
    id: 'ancient-wonders',
    categoryKey: 'ancient',
    detailLevel: 'overview',
    title: {
      en: 'Seven Wonders of the Ancient World',
      he: 'שבעת פלאי תבל של העולם העתיק'
    },
    category: {
      en: 'Ancient Civilizations',
      he: 'עת עתיקה ותרבויות קדומות'
    },
    prompt: {
      en: 'The Seven Wonders of the Ancient World: When the famous monuments were built and what happened to them',
      he: 'שבעת פלאי תבל של העולם העתיק: מתי נבנו המבנים המפורסמים ומה עלה בגורלם'
    },
    whyItWorks: {
      en: 'A classic curiosity-driven prompt: without needing any BCE dates, names of architects, or ancient rulers, the AI maps when the great monuments stood and how they were lost.',
      he: 'מדגים חקר היסטורי מתוך סקרנות טהורה: אין צורך להכיר תאריכים לפנה״ס או שמות שליטים – ה-AI ממפה מתי עמדו המבנים האגדיים ומה הוביל לחורבנם בציר זמן בהיר ומרתק.'
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
      cardsDrawerTitle: 'Cards List Drawer',
      cardsDrawerDesc: 'When a timeline is loaded, click the Cards button on the top toolbar or the floating button on the screen edge to open a searchable, chronological list of all events grouped by swimlanes. Selecting any card instantly flies the camera to that event on the canvas and opens its Event Details drawer.',
      starTitle: 'Starring & Bookmarking Events',
      starDesc: 'Mark the events that matter most to you with a star. On the canvas, hover over any event card and click the star icon that appears in its top-right corner (you can also star from the Event Details drawer header, or from any card in the Cards List drawer). Starred events are highlighted with a golden star and are prioritized so they stay visible even when zoomed far out. Use the star filter in the Cards List drawer to show only your starred events. Your stars are saved together with the timeline.',
      stopGenTitle: 'Stopping Generation:',
      stopGenDesc: 'If you want to cancel an in-flight prompt, press the Esc key or click Stop generate in the bottom status pill.'
    },
    prompt_mastery: {
      title: 'How to Write a Powerful Prompt',
      subtitle: 'ChroniX generates timelines in any language you write your prompt in. Here is how to achieve the best chronological structure, lane divisions, and event depth.',
      detailHeading: '1. Choosing the Right Detail Level',
      levels: {
        overview: {
          name: 'Overview',
          count: '~10–15 events',
          bestFor: 'A clean, high-level bird’s-eye view focusing only on monumental turning points, or inherently focused/short-span topics (such as a single expedition, a multi-week crisis, or a targeted mission).',
          example: '"Cuban Missile Crisis: 13 Days of Brinkmanship" or "Ancient Egypt: High-level overview from the Old Kingdom to Cleopatra"'
        },
        standard: {
          name: 'Standard (Recommended)',
          count: '~20–30 events',
          bestFor: 'The ideal choice for most topics: full historical eras, complete civilizational narratives, comprehensive biographies, and dual-lane comparisons. Delivers rich narrative depth and causality without sacrificing clarity.',
          example: '"Ancient Rome: From Republic to Empire" or "The Space Race (1955–1975) between NASA and USSR"'
        },
        deep_dive: {
          name: 'Deep Dive',
          count: '~35–50 events',
          bestFor: 'Complex multi-lane timelines (3+ swimlanes) where every track requires substantial events, multi-theater world conflicts, or granular step-by-step historical research.',
          example: '"World War II (1939–1945), divided into parallel time lanes for European Theater, Pacific Theater, and Diplomatic Summits"'
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
          title: 'Parallel Division:',
          desc: '..in a parallel division for the Kings of Judea and the Kings of Israel'
        }
      ],
      framingHeading: '3. Prompt Framing: Concise vs. Detailed',
      conciseTitle: 'Concise & Natural Prompts: Exploring Topics with Ease',
      conciseDesc: 'Prompts can be simple, natural, and direct. There is no need for specialized dates or technical jargon. Prompts like "The Industrial Revolution", "Evolution of the Horse", or "The French Revolution" let the AI discover and organize the pivotal milestones and verified imagery automatically.',
      detailedTitle: 'Detailed & Structured Prompts: Custom Focus & Specific Angles',
      detailedDesc: 'When you want to study a targeted angle, you can guide the AI explicitly: specify bookend dates ("from 1789 to 1799"), define distinct geographical theaters ("WWII divided into European and Pacific Theaters"), or group opposing factions into parallel swimlanes.',
      multilingualHeading: '4. Multilingual Prompts vs. UI Language',
      multilingualTitle: 'Prompt Language Dictates Timeline Language & Wikipedia Links',
      multilingualDesc: 'While the ChroniX user interface (menus, dialogs, buttons) currently supports English and Hebrew, the timeline generation engine is fully multilingual and works in virtually any language. You can enter prompts in Spanish, French, German, Italian, Arabic, Russian, Japanese, or any other language, completely independent of the language currently selected in the UI. The milestones generated on the canvas (event titles, dates, descriptions, and swimlanes) will be written in the exact language of your prompt, and Wikipedia summaries and article links will automatically point to that language\'s specific Wikipedia edition (e.g. es.wikipedia.org, fr.wikipedia.org, de.wikipedia.org, he.wikipedia.org, or en.wikipedia.org). If an entry or thumbnail image is missing in that language edition, ChroniX automatically falls back to English Wikipedia (en.wikipedia.org) to ensure every event has rich encyclopedic information and historical imagery.'
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
      subtitle: 'Click the Refine button on the top toolbar to converse with Gemini and iteratively expand, tweak, or split your existing timeline into multiple parallel paths and swimlanes without starting from scratch.',
      splitTipTitle: 'Splitting into Multiple Paths & Timelines',
      splitTipDesc: 'You can ask Gemini to restructure any existing timeline into parallel tracks or multiple timelines (e.g. by geographic theater, opposing factions, or thematic domains). The AI intelligently redistributes your existing events into dedicated swimlanes while preserving their details and generating new connecting milestones.',
      examplesHeading: 'Popular Refinement Prompts:',
      prompts: [
        {
          label: 'Split into parallel thematic paths:',
          prompt: '"Split the timeline into three parallel paths: Political & Military events, Science & Technology, and Culture & Society"'
        },
        {
          label: 'Divide by geographic regions / theaters:',
          prompt: '"Divide the events into two separate timelines: European Theater and Pacific Theater"'
        },
        {
          label: 'Separate opposing sides or factions:',
          prompt: '"Restructure the events into two parallel tracks: United States and Soviet Union"'
        },
        {
          label: 'Split into domestic and foreign paths:',
          prompt: '"Split the timeline into two parallel paths: Domestic Policy & Reforms and Foreign Relations & Treaties"'
        },
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
      cardsDrawerTitle: 'מגירת רשימת הכרטיסיות',
      cardsDrawerDesc: 'כאשר ציר זמן נטען, לחצו על כפתור "כרטיסיות" בסרגל הכלים העליון או על הכפתור הצף בקצה המסך כדי לפתוח רשימה כרונולוגית מלאה של כל האירועים בחלוקה למסלולים ועם שורת חיפוש. בחירת כרטיסייה מטיסה מיד את התצוגה לאירוע בקנבס ופותחת את חלונית פרטי האירוע.',
      starTitle: 'סימון אירועים בכוכב (מועדפים)',
      starDesc: 'סמנו בכוכב את האירועים החשובים לכם ביותר. בקנבס, העבירו את העכבר מעל כרטיסיית אירוע ולחצו על סמל הכוכב שמופיע בפינה העליונה שלה (ניתן לסמן גם מכותרת חלונית פרטי האירוע, או מכל כרטיסייה במגירת רשימת הכרטיסיות). אירועים מסומנים מודגשים בכוכב זהוב ומקבלים עדיפות כך שהם נשארים גלויים גם בהתרחקות (זום אאוט). השתמשו במסנן הכוכב במגירת רשימת הכרטיסיות כדי להציג רק את האירועים שסימנתם. הסימונים נשמרים יחד עם ציר הזמן.',
      stopGenTitle: 'עצירת תהליך היצירה:',
      stopGenDesc: 'אם ברצונכם לעצור יצירת ציר זמן בעיצומה, לחצו על מקש Esc במקלדת או על כפתור "עצור יצירה" בבועת הסטטוס התחתונה.'
    },
    prompt_mastery: {
      title: 'כיצד לנסח פרומפט מנצח',
      subtitle: 'ChroniX יוצרת צירי זמן בכל שפה שבה תכתבו את הפרומפט. להלן הכללים והטיפים להשגת המבנה הכרונולוגי המדויק ביותר, חלוקה אידיאלית למסלולים ורמת פירוט נכונה.',
      detailHeading: '1. בחירת רמת הפירוט המתאימה',
      levels: {
        overview: {
          name: 'סקירה (Overview)',
          count: '~10–15 אירועים',
          bestFor: 'מבט-על תמציתי ("רק ציוני הדרך הגדולים ביותר") להתרשמות מהירה ללא עומס פרטים, או לנושאים ממוקדים וקצרי-מועד (כגון משבר של מספר שבועות, משלחת יחידה או מבצע נקודתי).',
          example: '"משבר הטילים בקובה: 13 ימי הכרעה" או "מבט-על: מצרים העתיקה מהממלכה הקדומה ועד קלאופטרה"'
        },
        standard: {
          name: 'סטנדרטי (מומלץ כברירת מחדל)',
          count: '~20–30 אירועים',
          bestFor: 'הבחירה המומלצת למרבית הנושאים: תקופות היסטוריות שלמות, תרבויות ואימפריות, ביוגרפיות מקיפות, והשוואות בין 1–2 מסלולים. מעניקה עומק סיפורי עשיר וקשר סיבתי בלי לאבד את התמונה הכוללת.',
          example: '"רומא העתיקה: מרפובליקה לאימפריה" או "המרוץ לחלל (1955–1975) בין נאס״א לברית המועצות"'
        },
        deep_dive: {
          name: 'מעמיק (Deep Dive)',
          count: '~35–50 אירועים',
          bestFor: 'צירים רב-מסלוליים מורכבים (3 מסלולים ומעלה) שבהם נדרש פירוט עשיר לכל מסלול, מלחמות עולם מרובות חזיתות, או מחקר היסטורי מקיף ברזולוציה גבוהה (צעד-אחר-צעד).',
          example: '"מלחמת העולם השנייה (1939–1945) בחלוקה לזירה האירופית, זירת האוקיינוס השקט וועידות דיפלומטיות"'
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
          title: 'דוגמה היסטורית:',
          desc: '"...בחלוקה למסלולים נפרדים עבור מלכי יהודה מול מלכי ישראל"'
        }
      ],
      framingHeading: '3. מבנה הפרומפט: קצר ופשוט מול מפורט ומובנה',
      conciseTitle: 'פרומפט קצר ופשוט: חקר נושאים בבהירות ובטבעיות',
      conciseDesc: 'פרומפטים יכולים להיות פשוטים, קצרים וטבעיים. אין צורך להכיר שמות היסטוריים או מונחים מדעיים מראש. פרומפטים כמו "המהפכה התעשייתית", "האבולוציה של הסוס" או "המהפכה הצרפתית" מאפשרים ל-AI לגלות באופן אוטומטי את כל ציוני הדרך והאישים המרכזיים.',
      detailedTitle: 'פרומפט מפורט ומובנה: מיקוד והכוונה מדויקת',
      detailedDesc: 'כאשר רוצים להתמקד בהיבט מסוים, ניתן להנחות את ה-AI במפורש: להגדיר תאריכי התחלה וסיום מדויקים ("המהפכה הצרפתית מ-1789 עד 1799"), לחלק לזירות גיאוגרפיות ("מלחמת העולם השנייה בחלוקה לזירה האירופית וזירת האוקיינוס השקט") או להשוות פלגים ומסלולים מקבילים.',
      multilingualHeading: '4. שפת הפרומפט מול שפת הממשק',
      multilingualTitle: 'שפת הפרומפט קובעת את שפת ציר הזמן והקישורים לוויקיפדיה',
      multilingualDesc: 'למרות שממשק המשתמש (התפריטים, הכפתורים והחלוניות) מוצג בעברית או באנגלית, מנוע הבינה המלאכותית של ChroniX תומך ביצירת צירי זמן בכל שפה שתרצו! תוכלו להקליד פרומפטים בצרפתית, ספרדית, גרמנית, ערבית, רוסית, יפנית או בכל שפה אחרת, ללא קשר לשפת הממשק הנבחרת. כל האירועים שייווצרו על הקנבס (כותרות, תאריכים, תקצירים ומסלולים) ייכתבו בדיוק בשפה שבה נוסח הפרומפט, והקישורים לוויקיפדיה יקשרו אוטומטית למהדורת ויקיפדיה המתאימה באותה שפה. במידה וערך או תמונת שער חסרים במהדורת ויקיפדיה המקומית, המערכת תבצע השלמה אוטומטית מוויקיפדיה באנגלית (en.wikipedia.org) העשירה ביותר בערכים ובתמונות היסטוריות, כך שאף אירוע לא יישאר ללא תוכן עשיר.'
    },
    prompt_showcase: {
      title: 'מאגר פרומפטים אינטראקטיבי',
      subtitle: 'לחצו על "נסו עכשיו ↗" כדי לפתוח את הפרומפט בחלון חדש וליצור אותו מיד!',
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
      subtitle: 'לחצו על כפתור "ליטוש" בסרגל הכלים העליון כדי לשוחח עם Gemini ולהרחיב, לעדכן או לפצל את ציר הזמן הקיים למספר מסלולים ונתיבים מקבילים בלי להתחיל מאפס.',
      splitTipTitle: 'פיצול וארגון מחדש למספר מסלולים וצירי זמן מקבילים',
      splitTipDesc: 'תוכלו לבקש מ-Gemini לארגן מחדש כל ציר זמן קיים ולפצל אותו למסלולים מקבילים (למשל לפי זירה גיאוגרפית, צדדים יריבים או תחומי תוכן). המודל משבץ באופן חכם את כל האירועים הקיימים במסלולים החדשים תוך שימור מלא של המידע והוספת ציוני דרך מתאימים.',
      examplesHeading: 'הנחיות ליטוש נפוצות ומומלצות:',
      prompts: [
        {
          label: 'פיצול למסלולים נושאיים מקבילים:',
          prompt: '"פצל את ציר הזמן לשלושה מסלולים מקבילים: אירועים פוליטיים וצבאיים, מדע וטכנולוגיה, ותרבות וחברה"'
        },
        {
          label: 'חלוקה לזירות גיאוגרפיות / צירי זמן נפרדים:',
          prompt: '"חלק את האירועים לשני צירי זמן נפרדים: הזירה האירופית וזירת האוקיינוס השקט"'
        },
        {
          label: 'הפרדת צדדים יריבים למסלולים מקבילים:',
          prompt: '"ארגן מחדש את האירועים לשני מסלולים מקבילים: ארצות הברית מול ברית המועצות"'
        },
        {
          label: 'פיצול למדיניות פנים ויחסי חוץ:',
          prompt: '"פצל את ציר הזמן לשני נתיבים מקבילים: מדיניות פנים ורפורמות מול יחסי חוץ ואמנות בינלאומיות"'
        },
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

import React, { useState } from 'react';
import {
  Sparkles,
  ArrowRight,
  Rocket,
  Landmark,
  Globe,
  Compass,
  Layers,
  Cpu,
  Shield,
  Check,
  Crown,
  BookOpen
} from 'lucide-react';

export const PROMPT_EXAMPLES = [
  // ==========================================
  // 1. SIMPLE PROMPTS (2 Hebrew, 4 English)
  // ==========================================

  // 1.1 Simple - Hebrew (1/2)
  {
    id: 'simple-he-1',
    title: 'מצרים העתיקה: פרעונים ופירמידות',
    prompt: 'מצרים העתיקה: פרעונים, פירמידות והשושלות הגדולות לאורך הנילוס',
    type: 'simple',
    typeLabel: 'פשוט ומהיר',
    categoryName: 'היסטוריה עתיקה',
    icon: Landmark,
    description: 'סקירה ממוקדת של השושלות המרכזיות, הפירמידות של גיזה ותקופת הזוהר של הפרעונים.',
    detailLevel: 'standard',
    lang: 'he',
    colorTheme: 'amber'
  },
  // 1.2 Simple - Hebrew (2/2)
  {
    id: 'simple-he-2',
    title: 'הנחיתה על הירח ותוכנית אפולו',
    prompt: 'הנחיתה על הירח ומבצעי אפולו של נאס"א',
    type: 'simple',
    typeLabel: 'פשוט ומהיר',
    categoryName: 'חלל ומדע',
    icon: Rocket,
    description: 'רצף המשימות של תוכנית אפולו משיגורי הניסוי ועד לצעד הראשון של ניל ארמסטרונג ב-1969.',
    detailLevel: 'standard',
    lang: 'he',
    colorTheme: 'sky'
  },
  // 1.3 Simple - English (1/4)
  {
    id: 'simple-en-1',
    title: 'World War II: Turning Points',
    prompt: 'World War II: Major Battles and Turning Points (1939-1945)',
    type: 'simple',
    typeLabel: 'Quick & Simple',
    categoryName: 'Military History',
    icon: Shield,
    description: 'Key strategic turning points including Battle of Britain, Stalingrad, Midway, and D-Day.',
    detailLevel: 'standard',
    lang: 'en',
    colorTheme: 'rose'
  },
  // 1.4 Simple - English (2/4)
  {
    id: 'simple-en-2',
    title: 'History of Aviation',
    prompt: 'History of Aviation: From Wright Brothers to Commercial Jet Age',
    type: 'simple',
    typeLabel: 'Quick & Simple',
    categoryName: 'Innovation',
    icon: Compass,
    description: 'Milestones of powered human flight, early biplanes, transatlantic journeys, and passenger jet airliners.',
    detailLevel: 'standard',
    lang: 'en',
    colorTheme: 'blue'
  },
  // 1.5 Simple - English (3/4)
  {
    id: 'simple-en-3',
    title: 'Rise and Fall of the Roman Empire',
    prompt: 'Rise and Fall of the Roman Empire: From Republic to the Fall of Rome',
    type: 'simple',
    typeLabel: 'Quick & Simple',
    categoryName: 'Ancient History',
    icon: Landmark,
    description: 'Essential milestones spanning Roman conquest, Pax Romana, imperial partition, and eventual collapse.',
    detailLevel: 'standard',
    lang: 'en',
    colorTheme: 'amber'
  },
  // 1.6 Simple - English (4/4)
  {
    id: 'simple-en-4',
    title: 'Harry Potter: Complete Hogwarts Saga',
    prompt: "Harry Potter: Chronological storyline from the Philosopher's Stone to the Battle of Hogwarts",
    type: 'simple',
    typeLabel: 'Quick & Simple',
    categoryName: 'Fantasy Literature',
    icon: BookOpen,
    description: "Key milestones across the seven books: Privet Drive, Chamber of Secrets, Triwizard Tournament, and the defeat of Lord Voldemort.",
    detailLevel: 'standard',
    lang: 'en',
    colorTheme: 'purple'
  },

  // ==========================================
  // 2. COMPLEX PROMPTS (2 Hebrew, 4 English)
  // ==========================================

  // 2.1 Complex - Hebrew (1/2)
  {
    id: 'complex-he-1',
    title: 'מבצעי העלייה הגדולים לישראל (השוואתי לנתיבים)',
    prompt: 'מבצעי העלייה הגדולים לישראל במאה ה-20: חלוקה לנתיבים עבור עליות המזרח (מרבד הקסמים ועזרא ונחמיה), מבצעי עליית יהודי אתיופיה (משה ושלמה), והעלייה מברית המועצות לשעבר',
    type: 'complex',
    typeLabel: 'מורכב ומפורט • חלוקה לנתיבים',
    categoryName: 'היסטוריה של עם ישראל',
    icon: Layers,
    description: 'ציר זמן עשיר המשווה במקביל את מסלולי העלייה השונים, אתגריהם ונקודות המפנה שעיצבו את החברה הישראלית.',
    detailLevel: 'deep_dive',
    lang: 'he',
    colorTheme: 'indigo'
  },
  // 2.2 Complex - Hebrew (2/2)
  {
    id: 'complex-he-2',
    title: 'מלחמת יום הכיפורים: חזית סיני מול רמת הגולן',
    prompt: 'מהלך מלחמת יום הכיפורים (אוקטובר 1973): ציר זמן מפורט המחולק לנתיב חזית סיני (ההפתעה, קרב החווה הסינית וצליחת התעלה) מול נתיב חזית רמת הגולן (קרבות הבלימה, עמק הבכא וההבקעה לסוריה)',
    type: 'complex',
    typeLabel: 'מורכב ומפורט • שתי חזיתות',
    categoryName: 'מערכות ישראל',
    icon: Shield,
    description: 'כרונולוגיה צבאית מפורטת יום אחר יום, המציגה את התפתחות המערכה במקביל בדרום ובצפון עד להפסקת האש.',
    detailLevel: 'deep_dive',
    lang: 'he',
    colorTheme: 'amber'
  },
  // 2.3 Complex - English (1/4)
  {
    id: 'complex-en-1',
    title: 'The Space Race: NASA vs Soviet Program (1955–1975)',
    prompt: 'The Space Race (1955–1975): Comparative timeline contrasting Soviet milestones (Sputnik, Yuri Gagarin, Voskhod) with NASA achievements (Mercury, Gemini, Apollo 11 lunar landing)',
    type: 'complex',
    typeLabel: 'Deep Dive • Two Superpowers',
    categoryName: 'Space & Geopolitics',
    icon: Rocket,
    description: 'Head-to-head Cold War timeline tracking artificial satellites, human spaceflight firsts, orbital dockings, and lunar landings.',
    detailLevel: 'deep_dive',
    lang: 'en',
    colorTheme: 'purple'
  },
  // 2.4 Complex - English (2/4)
  {
    id: 'complex-en-2',
    title: 'The Targaryen Dynasty: Fire & Blood (Aegon to Aerys II)',
    prompt: "The Targaryen Dynasty: Complete chronology from Aegon's Conquest and Maegor the Cruel, through the Dance of the Dragons, to the Mad King and Robert's Rebellion",
    type: 'complex',
    typeLabel: 'Deep Dive • Westeros Lore',
    categoryName: 'Fantasy & Lore',
    icon: Crown,
    description: 'A rich multi-century chronology tracking the dragon kings of Westeros, civil wars, Blackfyre Rebellions, and the downfall of House Targaryen.',
    detailLevel: 'deep_dive',
    lang: 'en',
    colorTheme: 'rose'
  },
  // 2.5 Complex - English (3/4)
  {
    id: 'complex-en-3',
    title: 'History of Artificial Intelligence: Turing to LLMs',
    prompt: 'History of Artificial Intelligence: From Turing Test and Dartmouth Workshop, through the AI Winters, expert systems, and Deep Learning breakthrough (AlexNet, AlphaGo), to modern Generative AI and Foundation Models',
    type: 'complex',
    typeLabel: 'Deep Dive • Multi-Era',
    categoryName: 'Computer Science',
    icon: Cpu,
    description: 'Seven decades of algorithmic leaps, computational breakthroughs, neural networks, and modern foundation models.',
    detailLevel: 'deep_dive',
    lang: 'en',
    colorTheme: 'sky'
  },
  // 2.6 Complex - English (4/4)
  {
    id: 'complex-en-4',
    title: 'The Manhattan Project & Cold War Nuclear Race (1939–1962)',
    prompt: 'The Manhattan Project and Cold War Nuclear Proliferation (1939–1962): From Einstein-Szilard letter and Trinity test, through Hiroshima and Nagasaki, to Soviet atomic tests and the Cuban Missile Crisis',
    type: 'complex',
    typeLabel: 'Deep Dive • Science & Defense',
    categoryName: 'Modern History',
    icon: Layers,
    description: 'Comprehensive chronological breakdown of secret wartime laboratories, atomic diplomacy, and early nuclear deterrence doctrine.',
    detailLevel: 'deep_dive',
    lang: 'en',
    colorTheme: 'rose'
  }
];

export default function PromptExamples({ onSelectPrompt, isGenerating = false }) {
  const [filterType, setFilterType] = useState('all'); // 'all' | 'simple' | 'complex'
  const [copiedId, setCopiedId] = useState(null);

  const filteredExamples = PROMPT_EXAMPLES.filter((item) => {
    if (filterType === 'all') return true;
    return item.type === filterType;
  });

  const handleCardClick = (example) => {
    if (isGenerating) return;
    setCopiedId(example.id);
    setTimeout(() => setCopiedId(null), 1500);
    onSelectPrompt?.(example.prompt, example.detailLevel);
  };

  return (
    <div className="w-full max-w-5xl mx-auto mt-4 px-2 sm:px-4">
      {/* Header & Category Filters */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 text-right">
          <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-sky-500/10 dark:bg-sky-500/20 text-sky-500 dark:text-sky-400">
            <Sparkles className="w-3.5 h-3.5" />
          </span>
          <h3 className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-200">
            דוגמאות לפרומפטים מובילים
          </h3>
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            (לחצו על כל כרטיס כדי להתחיל ליצור)
          </span>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-200/70 dark:bg-slate-800/80 rounded-xl border border-slate-300/60 dark:border-slate-700/60 shadow-inner">
          <button
            type="button"
            onClick={() => setFilterType('all')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              filterType === 'all'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            הכל ({PROMPT_EXAMPLES.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('simple')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1 ${
              filterType === 'simple'
                ? 'bg-sky-500 text-white shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400'
            }`}
          >
            <span>⚡ פשוטים (6)</span>
          </button>
          <button
            type="button"
            onClick={() => setFilterType('complex')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1 ${
              filterType === 'complex'
                ? 'bg-indigo-600 text-white shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400'
            }`}
          >
            <span>🔬 מורכבים ומפורטים (6)</span>
          </button>
        </div>
      </div>

      {/* Grid of Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {filteredExamples.map((item) => {
          const IconComponent = item.icon;
          const isComplex = item.type === 'complex';
          const isHebrew = item.lang === 'he';
          const isJustSelected = copiedId === item.id;

          return (
            <div
              key={item.id}
              onClick={() => handleCardClick(item)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleCardClick(item);
                }
              }}
              className={`group relative flex flex-col justify-between p-4 rounded-2xl border transition-all duration-200 cursor-pointer select-none ${
                isJustSelected
                  ? 'ring-2 ring-sky-500 scale-[1.02] bg-sky-50/90 dark:bg-sky-950/40 border-sky-400'
                  : 'bg-white/80 dark:bg-slate-900/80 hover:bg-white dark:hover:bg-slate-850 border-slate-200/90 dark:border-slate-800/90 hover:border-sky-300 dark:hover:border-sky-600/70 hover:shadow-lg hover:shadow-sky-500/5 hover:-translate-y-1'
              } backdrop-blur-sm shadow-xs`}
            >
              {/* Card Body */}
              <div dir={isHebrew ? 'rtl' : 'ltr'} className={isHebrew ? 'text-right' : 'text-left'}>
                {/* Top Row: Icon + Type Badge + Lang Tag */}
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-2xs transition-transform duration-200 group-hover:scale-110 ${
                      isComplex
                        ? 'bg-gradient-to-tr from-indigo-500/15 to-purple-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200/60 dark:border-indigo-800/60'
                        : 'bg-gradient-to-tr from-sky-500/15 to-blue-500/20 text-sky-600 dark:text-sky-400 border border-sky-200/60 dark:border-sky-800/60'
                    }`}
                  >
                    <IconComponent className="w-4 h-4" />
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                      {item.lang.toUpperCase()}
                    </span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${
                        isComplex
                          ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/60'
                          : 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800/60'
                      }`}
                    >
                      {item.typeLabel}
                    </span>
                  </div>
                </div>

                {/* Title */}
                <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors mb-1.5 leading-snug">
                  {item.title}
                </h4>

                {/* Description */}
                <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed mb-3">
                  {item.description}
                </p>

                {/* Prompt Box Preview */}
                <div className="bg-slate-50/90 dark:bg-slate-800/60 rounded-xl p-2 sm:p-2.5 border border-slate-200/70 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300 font-medium leading-relaxed mb-3 group-hover:border-sky-300 dark:group-hover:border-sky-700/60 transition-colors">
                  <div className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1 flex items-center justify-between">
                    <span>{isHebrew ? 'פרומפט לדוגמה' : 'Example Prompt'}</span>
                    <span className="text-slate-400 font-normal">
                      {isComplex ? (isHebrew ? '🔬 רמת פירוט גבוהה' : '🔬 Deep Dive') : (isHebrew ? '⚡ בסיסי' : '⚡ Standard')}
                    </span>
                  </div>
                  <div className="line-clamp-3 text-slate-800 dark:text-slate-200 font-mono text-[10.5px] leading-relaxed">
                    "{item.prompt}"
                  </div>
                </div>
              </div>

              {/* Bottom Action Row */}
              <div
                dir={isHebrew ? 'rtl' : 'ltr'}
                className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/80 text-[11px] text-slate-500 dark:text-slate-400 mt-1"
              >
                <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate max-w-[50%]">
                  {item.categoryName}
                </span>

                <div className="flex items-center gap-1 font-semibold text-sky-600 dark:text-sky-400 group-hover:underline shrink-0">
                  {isJustSelected ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {isHebrew ? 'טוען פרומפט...' : 'Loading...'}
                      </span>
                    </>
                  ) : (
                    <>
                      <span>{isHebrew ? 'הפעל פרומפט' : 'Generate'}</span>
                      <ArrowRight
                        className={`w-3.5 h-3.5 transition-transform ${
                          isHebrew ? 'group-hover:-translate-x-1 rotate-180' : 'group-hover:translate-x-1'
                        }`}
                      />
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

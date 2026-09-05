import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  BookOpen,
  Sparkles,
  Search,
  Copy,
  Check,
  ExternalLink,
  Layers,
  MapPin,
  Calendar,
  MousePointer,
  ZoomIn,
  Edit3,
  PlusCircle,
  Download,
  AlertTriangle,
  Compass,
  ArrowRight,
  Maximize2,
  Globe,
  SlidersHorizontal,
  ChevronRight,
  CheckCircle2,
  HelpCircle,
  Columns2,
  Minimize2,
  Play
} from 'lucide-react';

// Curated Showcase Prompts with "Try Now" and "Copy" capabilities
const SHOWCASE_PROMPTS = [
  {
    id: 'space-race',
    title: 'The Space Race (1955–1975)',
    category: 'Science & Space',
    detailLevel: 'standard',
    lang: 'en',
    prompt: 'The Space Race (1955–1975), divided into separate swimlanes for the Soviet Space Program and NASA',
    whyItWorks: 'Explicitly requests two parallel swimlanes (NASA vs Soviet Space Program), creating a side-by-side comparative chronology with clear start/end dates.'
  },
  {
    id: 'wwii-theaters',
    title: 'World War II Multi-Theater Chronology',
    category: 'Modern History',
    detailLevel: 'deep_dive',
    lang: 'en',
    prompt: 'World War II (1939–1945), divided into parallel time lanes for the European Theater, Pacific Theater, and Diplomatic Summits',
    whyItWorks: 'Utilizes Deep Dive granularity with three separate swimlanes to organize complex simultaneous military and diplomatic events without clutter.'
  },
  {
    id: 'israel-zionism',
    title: 'תולדות הציונות והקמת מדינת ישראל',
    category: 'Israel & Jewish History',
    detailLevel: 'deep_dive',
    lang: 'he',
    prompt: 'תולדות הציונות והקמת מדינת ישראל: מהקונגרס הציוני בבזל והצהרת בלפור, דרך גלי העלייה ומחתרות היישוב, ועד להחלטת כ"ט בנובמבר והכרזת העצמאות',
    whyItWorks: 'מגדיר "תחנות מפתח" מפורטות מהקונגרס בבזל ועד להכרזת העצמאות, המנחות את ה-AI לבחור בדיוק את האירועים המרכזיים שחשובים למשתמש.'
  },
  {
    id: 'first-temple-kings',
    title: 'מלכי יהודה ומלכי ישראל (בית ראשון)',
    category: 'Israel & Jewish History',
    detailLevel: 'standard',
    lang: 'he',
    prompt: 'תקופת בית ראשון: ציר זמן בחלוקה לשני מסלולי זמן מקבילים עבור מלכי יהודה מול מלכי ישראל, מפלג הממלכה ועד חורבן בית ראשון',
    whyItWorks: 'מורה ל-AI לחלק את התקופה לשני מסלולים מקבילים של ממלכת יהודה וממלכת ישראל, מה שיוצר השוואה כרונולוגית ברורה ומדויקת בין המלכים.'
  },
  {
    id: 'ancient-egypt-overview',
    title: 'Ancient Egypt: Dynastic Overview',
    category: 'Ancient Civilizations',
    detailLevel: 'overview',
    lang: 'en',
    prompt: 'Ancient Egypt: High-level overview of the major kingdoms and dynasties from the unification of Narmer and the Great Pyramids to Cleopatra',
    whyItWorks: 'Uses the "Overview" setting (~10–15 events) to deliver a clean, non-overwhelming timeline spanning thousands of years of dynastic transitions.'
  },
  {
    id: 'dinosaurs-eras',
    title: 'הדינוזאורים: שלבי ההתפתחות וההכחדה',
    category: 'Prehistory & Nature',
    detailLevel: 'standard',
    lang: 'he',
    prompt: 'דינוזאורים: שלבי ההתפתחות לאורך הטריאס, היורה והקרטיקון בחלוקה למסלולים נפרדים עבור תרופודים (טורפים), זאורופודים (ענקים צמחוניים) ובעלי אגן עוף',
    whyItWorks: 'עושה שימוש בסקאלה פרה-היסטורית (מיליוני שנים אחורה) וחלוקה למסלולים טקסונומיים, המאפשרת לצפות בהתפתחות במקביל של קבוצות דינוזאורים שונות.'
  },
  {
    id: 'industrial-revolution',
    title: 'The Industrial Revolution & Inventions',
    category: 'Science & Space',
    detailLevel: 'deep_dive',
    lang: 'en',
    prompt: 'The Industrial Revolution, divided into separate lanes for Technological Inventions, Steam & Transportation, and Labor Movements',
    whyItWorks: 'Pairs technological milestones with social and labor movements across parallel lanes, revealing the human impact of technological evolution.'
  },
  {
    id: 'human-evolution',
    title: 'האבולוציה של האדם',
    category: 'Prehistory & Nature',
    detailLevel: 'overview',
    lang: 'he',
    prompt: 'האבולוציה של האדם: סקירת אבני הדרך המרכזיות מלוסי והאוסטרלופיתקוס ועד להומו סאפיינס והאדם הניאנדרטלי',
    whyItWorks: 'מדגים ציר זמן אבולוציוני תמציתי וממוקד שנע לאורך מיליוני שנים ומדגיש את אבות המין האנושי.'
  },
  {
    id: 'aviation-milestones',
    title: 'History of Aviation',
    category: 'Science & Space',
    detailLevel: 'overview',
    lang: 'en',
    prompt: 'History of Aviation: Milestone overview from the Wright Brothers at Kitty Hawk to commercial jets and supersonic flight',
    whyItWorks: 'Concise, focused single-track prompt that delivers an inspirational journey through 20th-century aerospace engineering.'
  },
  {
    id: 'harry-potter-saga',
    title: 'עלילת הארי פוטר (שבע שנות הלימוד)',
    category: 'Culture & Lore',
    detailLevel: 'overview',
    lang: 'he',
    prompt: 'עלילת הארי פוטר: סקירה תמציתית של שבע שנות הלימוד מדרך פריווט ועד לקרב על הוגוורטס',
    whyItWorks: 'מדגים כיצד ChroniX מסוגל לבנות ציר זמן של עולמות בדיוניים וספרותיים בדיוק כמו אירועים היסטוריים אמיתיים.'
  }
];

const SECTIONS = [
  { id: 'getting_started', label: 'Getting Started', icon: Compass },
  { id: 'prompt_mastery', label: 'Prompt Mastery', icon: Sparkles },
  { id: 'prompt_showcase', label: 'Prompt Showcase', icon: Play },
  { id: 'event_editing', label: 'Editing & Adding', icon: Edit3 },
  { id: 'ai_refine', label: 'Refine with AI', icon: SlidersHorizontal },
  { id: 'geo_map', label: 'Geographic Map', icon: MapPin },
  { id: 'export_saving', label: 'Export & Saving', icon: Download }
];

export default function UserGuideModal({ isOpen, onClose }) {
  const [activeSection, setActiveSection] = useState('getting_started');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedPromptId, setCopiedPromptId] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('All');

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Handle "Try Now" - open in a new window/tab
  const handleTryNow = (promptItem) => {
    const url = `${window.location.origin}${window.location.pathname}?prompt=${encodeURIComponent(
      promptItem.prompt
    )}&detailLevel=${encodeURIComponent(promptItem.detailLevel)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Handle "Copy Prompt"
  const handleCopyPrompt = (promptItem) => {
    try {
      navigator.clipboard.writeText(promptItem.prompt);
      setCopiedPromptId(promptItem.id);
      setTimeout(() => setCopiedPromptId(null), 2500);
    } catch (err) {
      console.warn('Failed to copy prompt:', err);
    }
  };

  // Filtered Showcase Prompts
  const categories = useMemo(() => {
    const set = new Set(SHOWCASE_PROMPTS.map((p) => p.category));
    return ['All', ...Array.from(set)];
  }, []);

  const filteredPrompts = useMemo(() => {
    return SHOWCASE_PROMPTS.filter((item) => {
      const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
      const matchesSearch =
        !searchQuery.trim() ||
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.prompt.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.whyItWorks.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [selectedCategory, searchQuery]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200 font-sans"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-guide-title"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl sm:rounded-3xl w-full max-w-5xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200">
        
        {/* Top Header */}
        <div className="relative px-5 sm:px-6 pt-5 pb-4 border-b border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-slate-50 via-sky-50/25 to-white dark:from-slate-900 dark:via-slate-900/90 dark:to-slate-950 shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-sky-500/20 to-indigo-500/20 dark:from-sky-500/30 dark:to-indigo-500/30 border border-sky-500/30 text-sky-600 dark:text-sky-400 shadow-xs flex items-center justify-center">
                <BookOpen className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2
                    id="user-guide-title"
                    className="font-bold text-lg sm:text-xl text-slate-900 dark:text-white tracking-tight"
                  >
                    ChroniX User Guide
                  </h2>
                  <span className="hidden xs:inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-700 dark:bg-sky-950/80 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                    מדריך למשתמש
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Master prompts, swimlanes, AI refinement, event editing, and interactive maps
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Global search within guide */}
              <div className="relative hidden md:block w-52">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search guide..."
                  id="user-guide-search-input"
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500 transition-all"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={onClose}
                id="user-guide-close-button"
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-2 rounded-xl hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                title="Close (Esc)"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Section Navigation Tabs */}
          <div className="flex items-center gap-1 mt-4 overflow-x-auto no-scrollbar pb-1 pt-0.5">
            {SECTIONS.map((sec) => {
              const Icon = sec.icon;
              const isActive = activeSection === sec.id;
              return (
                <button
                  key={sec.id}
                  type="button"
                  id={`user-guide-tab-${sec.id}`}
                  onClick={() => setActiveSection(sec.id)}
                  className={`flex items-center gap-1.5 py-1.5 px-3 rounded-xl text-xs font-semibold shrink-0 transition-all cursor-pointer select-none ${
                    isActive
                      ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200/80 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{sec.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-7 space-y-6 text-slate-700 dark:text-slate-300 leading-relaxed text-xs sm:text-sm">
          
          {/* SECTION 1: GETTING STARTED */}
          {activeSection === 'getting_started' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-sky-500/10 via-indigo-500/5 to-transparent border border-sky-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-sky-500" />
                    Welcome to ChroniX
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
                    ChroniX synthesizes any historical period, scientific story, or literary saga into a live, interactive visual timeline powered by <strong>Google Gemini</strong>, <strong>HistropediaJS</strong>, and verified <strong>Wikimedia Commons</strong> imagery.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSection('prompt_showcase')}
                  className="px-3.5 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-semibold text-xs flex items-center gap-1.5 shadow-sm transition-all shrink-0 cursor-pointer"
                >
                  <span>Explore Examples</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Core Navigation Controls */}
              <div>
                <h4 className="font-bold text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
                  1. How to Navigate the Timeline Canvas
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-2">
                    <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400 font-semibold text-xs">
                      <ZoomIn className="w-4 h-4" />
                      <span>Zoom & Multi-Scale</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      Use your <strong>mouse scroll wheel</strong> or trackpad pinch to fluidly zoom from millions of years down to single days and hours. You can also use the <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-[10px] font-mono">+</kbd> and <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-[10px] font-mono">-</kbd> zoom buttons on the toolbar.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-2">
                    <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-semibold text-xs">
                      <MousePointer className="w-4 h-4" />
                      <span>Pan Across Time</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      <strong>Click and drag</strong> anywhere on the timeline background to pan backward and forward across historical eras seamlessly.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-2">
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-xs">
                      <Maximize2 className="w-4 h-4" />
                      <span>Fit All Articles</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      Click the <strong>Fit All</strong> button on the toolbar anytime to re-center the canvas and view the full span of your timeline at a single glance.
                    </p>
                  </div>
                </div>
              </div>

              {/* Event Inspection & Details */}
              <div>
                <h4 className="font-bold text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
                  2. Inspecting Events & The Side Drawers
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-2">
                    <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold text-xs">
                      <div className="p-1 rounded-lg bg-purple-500/15 text-purple-600 dark:text-purple-400">
                        <Calendar className="w-3.5 h-3.5" />
                      </div>
                      <span>Event Details Drawer (Right)</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      Click any event card on the timeline canvas to open its comprehensive slide-over drawer. You can view high-res Wikimedia photography, verified dates, encyclopedic summaries, and direct Wikipedia article links. From here, you can also <strong>Edit</strong> or <strong>Delete</strong> the event.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-2">
                    <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold text-xs">
                      <div className="p-1 rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400">
                        <Layers className="w-3.5 h-3.5" />
                      </div>
                      <span>Cards List Drawer (Left)</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      When a timeline is loaded, a floating button appears on the left screen edge. Click it to open a searchable, chronological list of all events grouped by swimlanes. Selecting any card instantly flies the camera to that event on the canvas.
                    </p>
                  </div>
                </div>
              </div>

              {/* Stopping Generation */}
              <div className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="text-xs text-amber-800 dark:text-amber-300">
                    <strong>Stopping Generation:</strong> If you want to cancel an in-flight prompt, press the <kbd className="px-1.5 py-0.5 rounded bg-amber-200/80 dark:bg-amber-900/60 font-mono text-[10px]">Esc</kbd> key or click <strong>Stop generate</strong> in the bottom status pill.
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 2: PROMPT MASTERY */}
          {activeSection === 'prompt_mastery' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="space-y-1">
                <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-sky-500" />
                  How to Write a Powerful Prompt
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  ChroniX understands natural language in both English and Hebrew. Here is how to achieve the best chronological structure, lane divisions, and event depth.
                </p>
              </div>

              {/* 1. Detail Levels */}
              <div>
                <h4 className="font-bold text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
                  1. Choosing the Right Detail Level
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                  {/* Overview */}
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-emerald-600 dark:text-emerald-400">Overview</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                        ~10–15 events
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      <strong>Best for:</strong> Long historical epochs, complete civilizational overviews, or rapid high-level summaries.
                    </p>
                    <div className="p-2 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300 font-mono">
                      "Ancient Egypt overview from the Old Kingdom to Cleopatra"
                    </div>
                  </div>

                  {/* Standard */}
                  <div className="p-4 rounded-xl border border-sky-300 dark:border-sky-800/60 bg-sky-50/30 dark:bg-sky-950/20 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-sky-600 dark:text-sky-400">Standard (Recommended)</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-950/80 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                        ~20–30 events
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      <strong>Best for:</strong> The default balanced experience. Provides a rich narrative arc with pivotal figures, battles, and turning points.
                    </p>
                    <div className="p-2 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300 font-mono">
                      "The Space Race (1955–1975) between NASA and USSR"
                    </div>
                  </div>

                  {/* Deep Dive */}
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-purple-600 dark:text-purple-400">Deep Dive</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                        ~35–50 events
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      <strong>Best for:</strong> Specific wars, intensive biographies, short intense crises, or granular scientific evolutions.
                    </p>
                    <div className="p-2 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300 font-mono">
                      "World War II in Europe, month-by-month key campaigns"
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Swimlanes Division */}
              <div>
                <h4 className="font-bold text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
                  2. Dividing into Swimlanes (Parallel Thematic Tracks)
                </h4>
                <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-3">
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    One of ChroniX's most powerful features is <strong>parallel swimlanes</strong>. You can explicitly instruct Gemini to categorize events into distinct horizontal tracks by writing:
                  </p>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
                      <span className="font-semibold text-xs text-sky-600 dark:text-sky-400">Opposing Factions / Nations:</span>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        <em>"...divided into swimlanes for Soviet Space Program vs NASA"</em> or <em>"...Allied Powers vs Axis Powers"</em>
                      </p>
                    </div>

                    <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
                      <span className="font-semibold text-xs text-indigo-600 dark:text-indigo-400">Thematic Disciplines:</span>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        <em>"...split into Technological Inventions, Steam & Transport, and Labor Movements"</em>
                      </p>
                    </div>

                    <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
                      <span className="font-semibold text-xs text-purple-600 dark:text-purple-400">Geographic Theaters:</span>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        <em>"...lanes for European Theater, Pacific Theater, and Diplomatic Summits"</em>
                      </p>
                    </div>

                    <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
                      <span className="font-semibold text-xs text-emerald-600 dark:text-emerald-400">חלוקה מקבילה בעברית:</span>
                      <p className="text-xs text-slate-600 dark:text-slate-400" dir="rtl">
                        <em>"...בחלוקה למסלולים נפרדים עבור מלכי יהודה מול מלכי ישראל"</em>
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. Concise vs Detailed Prompts */}
              <div>
                <h4 className="font-bold text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
                  3. Prompt Framing: Concise vs Detailed
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-2">
                    <span className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-sky-500" />
                      When to use Concise Prompts
                    </span>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      Short prompts like <em>"The French Revolution"</em> or <em>"History of Aviation"</em> allow Gemini creative freedom to choose the most recognized consensus milestones. Perfect for quick exploration!
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-2">
                    <span className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-indigo-500" />
                      When to use Detailed Prompts
                    </span>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      If you want specific bookends, specify them explicitly: <em>"The French Revolution from the Storming of the Bastille (1789) to Napoleon's 18 Brumaire coup (1799), focusing on political factions"</em>.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 3: PROMPT SHOWCASE (WITH TRY NOW) */}
          {activeSection === 'prompt_showcase' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2">
                    <Play className="w-4 h-4 text-sky-500" />
                    Interactive Prompt Showcase
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Click <strong>Try Now ↗</strong> to open the prompt in a new window and generate it immediately!
                  </p>
                </div>

                {/* Category Filter Pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                        selectedCategory === cat
                          ? 'bg-sky-500 text-white shadow-xs'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Prompt Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredPrompts.map((item) => {
                  const isCopied = copiedPromptId === item.id;
                  const isRtl = item.lang === 'he';

                  return (
                    <div
                      key={item.id}
                      className="group p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 hover:border-sky-400 dark:hover:border-sky-600 transition-all flex flex-col justify-between shadow-xs hover:shadow-md"
                    >
                      <div className="space-y-2.5">
                        {/* Header Badges */}
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                            {item.category}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-950/80 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 uppercase">
                              {item.detailLevel.replace('_', ' ')}
                            </span>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 uppercase">
                              {item.lang}
                            </span>
                          </div>
                        </div>

                        {/* Title */}
                        <h4 className="font-bold text-sm text-slate-900 dark:text-white" dir={isRtl ? 'rtl' : 'ltr'}>
                          {item.title}
                        </h4>

                        {/* Prompt Body */}
                        <div
                          dir={isRtl ? 'rtl' : 'ltr'}
                          className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 leading-relaxed font-sans select-all"
                        >
                          &ldquo;{item.prompt}&rdquo;
                        </div>

                        {/* Why it works */}
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed flex items-start gap-1.5">
                          <span className="font-semibold text-sky-600 dark:text-sky-400 shrink-0">Why it works:</span>
                          <span>{item.whyItWorks}</span>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="pt-4 mt-3 border-t border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          id={`copy-prompt-btn-${item.id}`}
                          onClick={() => handleCopyPrompt(item)}
                          className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          {isCopied ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-500" />
                              <span className="text-emerald-600 dark:text-emerald-400">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy Prompt</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          id={`try-now-btn-${item.id}`}
                          onClick={() => handleTryNow(item)}
                          className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm shadow-sky-500/20 active:scale-95 transition-all cursor-pointer"
                        >
                          <span>Try Now</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* SECTION 4: EDITING & ADDING EVENTS */}
          {activeSection === 'event_editing' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="space-y-1">
                <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2">
                  <Edit3 className="w-4 h-4 text-sky-500" />
                  Editing & Adding Events (Full Control)
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  You are never locked into AI-generated events. ChroniX gives you full power to edit, augment, or create brand-new events with smart AI assist and Wikipedia search.
                </p>
              </div>

              {/* Editing & Adding Workflow */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                  <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400 font-semibold text-xs">
                    <Sparkles className="w-4 h-4" />
                    <span>Gemini AI Auto-Fill</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    Type an event title (e.g., <em>"Apollo 11 Moon Landing"</em>) and click <strong>AI Auto-Fill</strong>. Gemini will automatically determine the historical dates, precision, relevant lane, Wikipedia link, extract, and geographic coordinates!
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                  <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-semibold text-xs">
                    <Search className="w-4 h-4" />
                    <span>Wikipedia Candidate Picker</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    Click <strong>Search Wikipedia</strong> to query Wikimedia Commons. If multiple candidates exist, an interactive disambiguation picker lets you select the exact article to instantly pull verified photography and descriptions.
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-xs">
                    <PlusCircle className="w-4 h-4" />
                    <span>Add Custom Event (+)</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    Click the <strong>+</strong> button on the toolbar or menu anytime to add any milestone. You can assign it to existing swimlanes or type a new lane name to create a brand new swimlane automatically.
                  </p>
                </div>
              </div>

              {/* Geographic Coordinates in Event Edit */}
              <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-2">
                <h4 className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-rose-500" />
                  Adding Geographic Coordinates to Events
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Inside the Event Edit Modal, scroll down to <strong>Location & Coordinates</strong>. You can enter a location name (e.g. <em>"Normandy, France"</em>) and Latitude/Longitude coordinates (e.g., <kbd className="px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-[10px] font-mono">49.4144</kbd>, <kbd className="px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-[10px] font-mono">-0.8322</kbd>). When populated, the event instantly gains a map marker on the interactive world map!
                </p>
              </div>
            </div>
          )}

          {/* SECTION 5: AI REFINE */}
          {activeSection === 'ai_refine' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="space-y-1">
                <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-indigo-500" />
                  Refine Your Timeline with AI
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Click the <strong>Refine</strong> button on the top toolbar to converse with Gemini and iteratively expand or tweak your existing timeline without starting from scratch.
                </p>
              </div>

              {/* Refinement examples */}
              <div className="space-y-3">
                <h4 className="font-bold text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Popular Refinement Prompts:
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1">
                    <span className="font-semibold text-xs text-slate-900 dark:text-white">Expand a specific sub-era:</span>
                    <p className="text-xs text-slate-600 dark:text-slate-400 font-mono bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200/80 dark:border-slate-800">
                      "Add 5 more key battles that took place in the Pacific theater between 1942 and 1943"
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1">
                    <span className="font-semibold text-xs text-slate-900 dark:text-white">Add cultural/social context:</span>
                    <p className="text-xs text-slate-600 dark:text-slate-400 font-mono bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200/80 dark:border-slate-800">
                      "Include cultural, philosophical, and social developments that occurred during this reign"
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1">
                    <span className="font-semibold text-xs text-slate-900 dark:text-white">Highlight scientific breakthroughs:</span>
                    <p className="text-xs text-slate-600 dark:text-slate-400 font-mono bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200/80 dark:border-slate-800">
                      "Add events focused on medicine, science, and technological inventions in this era"
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1">
                    <span className="font-semibold text-xs text-slate-900 dark:text-white">Cover aftermath & consequences:</span>
                    <p className="text-xs text-slate-600 dark:text-slate-400 font-mono bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200/80 dark:border-slate-800">
                      "Add 3 events showing the long-term aftermath and diplomatic treaties in the decade following"
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 6: GEOGRAPHIC MAP */}
          {activeSection === 'geo_map' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="space-y-1">
                <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-rose-500" />
                  Synchronized Geographic Map Feature
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  History happened in both <strong>Time</strong> and <strong>Space</strong>. ChroniX integrates a live Leaflet world map synchronized in real time with the timeline canvas.
                </p>
              </div>

              {/* The 4 Map Display Modes */}
              <div>
                <h4 className="font-bold text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
                  The 4 Map Display Modes:
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1.5">
                    <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400 font-semibold text-xs">
                      <Globe className="w-4 h-4" />
                      <span>1. Floating Earth Icon</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      A discrete, draggable globe button located on your screen showing the count of mapped events. Click it anytime to open the Picture-in-Picture window or Split view.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1.5">
                    <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-semibold text-xs">
                      <Minimize2 className="w-4 h-4" />
                      <span>2. Picture-in-Picture (PiP) Window</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      A compact floating map window overlaid above the timeline. You can <strong>drag it anywhere</strong> by its header bar, and <strong>resize it</strong> from its corners and edges.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1.5">
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-xs">
                      <Columns2 className="w-4 h-4" />
                      <span>3. Resizable Split Screen</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      Splits the screen horizontally with the Geo Map on top and Timeline on the bottom. <strong>Drag the divider bar</strong> up or down to adjust the ratio, or <strong>double-click</strong> it to reset to 50/50.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1.5">
                    <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 font-semibold text-xs">
                      <Maximize2 className="w-4 h-4" />
                      <span>4. Fullscreen Map Mode</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      Expands the map to take over the entire screen for a comprehensive spatial overview of historical events worldwide.
                    </p>
                  </div>
                </div>
              </div>

              {/* Bi-Directional Interactive Sync */}
              <div className="p-4 rounded-2xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/40 dark:bg-sky-950/20 space-y-2">
                <h4 className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-sky-500" />
                  Bi-Directional Synchronization
                </h4>
                <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5 list-disc list-inside">
                  <li>
                    <strong>Timeline to Map:</strong> Clicking any event on the timeline automatically flies the map camera to its geographic location and opens its detail popup.
                  </li>
                  <li>
                    <strong>Map to Timeline:</strong> Clicking any pin on the map highlights that event, opens the drawer, and centers the timeline canvas right onto that card!
                  </li>
                  <li>
                    <strong>Lane Color Pin Coding:</strong> Each map marker is color-coded according to its swimlane color for instant visual categorization.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* SECTION 7: EXPORT & SAVING */}
          {activeSection === 'export_saving' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="space-y-1">
                <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2">
                  <Download className="w-4 h-4 text-sky-500" />
                  Exporting, Saving & Settings
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Preserve your work, export presentations, or load previously generated chronologies anytime.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                  <span className="font-semibold text-xs text-sky-600 dark:text-sky-400 flex items-center gap-1.5">
                    <Download className="w-4 h-4" />
                    Snapshot Image (PNG)
                  </span>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    Under the <strong>More Actions</strong> menu (three vertical dots), click <strong>Export Snapshot (PNG)</strong> to download a crisp image file of your timeline canvas.
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                  <span className="font-semibold text-xs text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                    <Download className="w-4 h-4" />
                    Data Export & Import (JSON)
                  </span>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    Export your complete timeline dataset (events, lanes, coordinates, and Wiki extracts) as a JSON file, or import external JSON files via <strong>Saved Timelines</strong>.
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                  <span className="font-semibold text-xs text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                    <BookOpen className="w-4 h-4" />
                    Saved Timelines Library
                  </span>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    All created and edited timelines are automatically saved to your cloud library in Supabase. Re-open any past exploration anytime from the menu.
                  </p>
                </div>
              </div>

              {/* AI Disclaimer Alert */}
              <div className="p-4 rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 space-y-2">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-semibold text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>AI Accuracy Notice</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Timeline events are structured by Google Gemini AI and enriched with Wikimedia Commons. While models are highly capable, dates (especially in ancient BCE history) or minor facts may occasionally contain approximations. You can always verify and correct dates via the <strong>Edit Event</strong> dialog and <strong>Search Wikipedia</strong>.
                </p>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-5 sm:px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 flex items-center justify-between gap-3 shrink-0">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-sky-500 shrink-0" />
            <span className="hidden sm:inline">ChroniX User Guide • Built for curious minds, researchers & educators.</span>
            <span className="sm:hidden">ChroniX User Guide</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            id="user-guide-footer-close-btn"
            className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 shadow-xs transition-all active:scale-95 cursor-pointer"
          >
            Close Guide
          </button>
        </div>

      </div>
    </div>
  );
}

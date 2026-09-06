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
  CheckCircle2,
  Columns2,
  Minimize2,
  Play
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { USER_GUIDE_DATA, SHOWCASE_PROMPTS_DATA } from '../data/userGuideData';

const SECTIONS = [
  { id: 'getting_started', icon: Compass },
  { id: 'prompt_mastery', icon: Sparkles },
  { id: 'prompt_showcase', icon: Play },
  { id: 'event_editing', icon: Edit3 },
  { id: 'ai_refine', icon: SlidersHorizontal },
  { id: 'geo_map', icon: MapPin },
  { id: 'export_saving', icon: Download }
];

const DETAIL_LEVEL_STYLES = {
  overview: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  standard: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  deep_dive: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
};

export default function UserGuideModal({ isOpen, onClose }) {
  const { t, language } = useLanguage();
  const [activeSection, setActiveSection] = useState('getting_started');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedPromptId, setCopiedPromptId] = useState(null);
  const [selectedCategoryKey, setSelectedCategoryKey] = useState('all');

  // Localized guide text for current language with fallback to 'en'
  const guide = USER_GUIDE_DATA[language] || USER_GUIDE_DATA.en;

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Handle "Try Now" - open prompt in a new window/tab
  const handleTryNow = (promptItem) => {
    const promptText = promptItem.prompt[language] || promptItem.prompt.en;
    const url = `${window.location.origin}${window.location.pathname}?prompt=${encodeURIComponent(
      promptText
    )}&detailLevel=${encodeURIComponent(promptItem.detailLevel)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Handle "Copy Prompt"
  const handleCopyPrompt = (promptItem) => {
    try {
      const promptText = promptItem.prompt[language] || promptItem.prompt.en;
      navigator.clipboard.writeText(promptText);
      setCopiedPromptId(promptItem.id);
      setTimeout(() => setCopiedPromptId(null), 2500);
    } catch (err) {
      console.warn('Failed to copy prompt:', err);
    }
  };

  // Handle "Copy Refine Prompt"
  const handleCopyRefinePrompt = (promptText, idx) => {
    try {
      const cleanPrompt = promptText.replace(/^["']|["']$/g, '');
      navigator.clipboard.writeText(cleanPrompt);
      setCopiedPromptId(`refine-${idx}`);
      setTimeout(() => setCopiedPromptId(null), 2500);
    } catch (err) {
      console.warn('Failed to copy refine prompt:', err);
    }
  };

  // Curated category filter items
  const categoryFilters = useMemo(() => {
    const map = new Map();
    map.set('all', t('userGuide.categoryAll') || (language === 'he' ? 'כל הקטגוריות' : 'All Categories'));
    SHOWCASE_PROMPTS_DATA.forEach((p) => {
      if (!map.has(p.categoryKey)) {
        map.set(p.categoryKey, p.category[language] || p.category.en);
      }
    });
    return Array.from(map.entries()).map(([key, label]) => ({ key, label }));
  }, [language, t]);

  // Get localized label for detail level
  const getDetailLevelLabel = (level) => {
    return (
      guide?.prompt_showcase?.detailLevels?.[level] ||
      t(`userGuide.detailLevels.${level}`) ||
      (language === 'he'
        ? (level === 'deep_dive' ? 'מעמיק' : level === 'overview' ? 'סקירה' : 'סטנדרטי')
        : (level === 'deep_dive' ? 'Deep Dive' : level === 'overview' ? 'Overview' : 'Standard'))
    );
  };

  // Filtered Showcase Prompts
  const filteredPrompts = useMemo(() => {
    return SHOWCASE_PROMPTS_DATA.filter((item) => {
      const matchesCategory =
        selectedCategoryKey === 'all' || item.categoryKey === selectedCategoryKey;

      const title = (item.title[language] || item.title.en || '').toLowerCase();
      const prompt = (item.prompt[language] || item.prompt.en || '').toLowerCase();
      const whyItWorks = (item.whyItWorks[language] || item.whyItWorks.en || '').toLowerCase();
      const levelLabel = getDetailLevelLabel(item.detailLevel).toLowerCase();
      const q = searchQuery.toLowerCase().trim();

      const matchesSearch =
        !q ||
        title.includes(q) ||
        prompt.includes(q) ||
        whyItWorks.includes(q) ||
        item.detailLevel.includes(q) ||
        levelLabel.includes(q);

      return matchesCategory && matchesSearch;
    });
  }, [selectedCategoryKey, searchQuery, language, guide, t]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200 font-sans"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-guide-title"
    >
      <div
        className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-5xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200 ${language === 'he' ? 'text-right' : 'text-left'
          }`}
        dir={language === 'he' ? 'rtl' : 'ltr'}
      >

        {/* Top Header */}
        <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-sky-500" />
              </div>
              <div className={language === 'he' ? 'text-right' : 'text-left'}>
                <div className="flex items-center gap-2">
                  <h2
                    id="user-guide-title"
                    className="font-bold text-lg text-slate-900 dark:text-white tracking-tight"
                  >
                    {t('userGuide.title')}
                  </h2>
                  <span className="hidden xs:inline-flex px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                    {t('userGuide.badgeText')}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5" dir={language === 'he' ? 'rtl' : 'ltr'}>
                  {t('userGuide.subtitle')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Global search within guide */}
              <div className="relative hidden md:block w-56">
                <Search className={`w-3.5 h-3.5 absolute ${language === 'he' ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-slate-400`} />
                <input
                  type="text"
                  dir={searchQuery ? 'auto' : (language === 'he' ? 'rtl' : 'ltr')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('userGuide.searchPlaceholder')}
                  id="user-guide-search-input"
                  className={`w-full ${language === 'he' ? 'pr-8 pl-3 text-right' : 'pl-8 pr-3 text-left'} py-1.5 rounded-lg text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500 transition-all`}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className={`absolute ${language === 'he' ? 'left-2.5' : 'right-2.5'} top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs cursor-pointer`}
                  >
                    ✕
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={onClose}
                id="user-guide-close-button"
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                title={t('common.close')}
                aria-label={t('common.close')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Section Navigation Tabs */}
          <div className="flex items-center gap-1.5 mt-4 overflow-x-auto no-scrollbar pb-1 pt-0.5" dir={language === 'he' ? 'rtl' : 'ltr'}>
            {SECTIONS.map((sec) => {
              const Icon = sec.icon;
              const isActive = activeSection === sec.id;
              const label = t(`userGuide.tabs.${sec.id}`) || sec.id;
              return (
                <button
                  key={sec.id}
                  type="button"
                  id={`user-guide-tab-${sec.id}`}
                  onClick={() => setActiveSection(sec.id)}
                  className={`flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium shrink-0 transition-colors cursor-pointer select-none ${isActive
                      ? 'bg-sky-500 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white'
                    }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div
          className={`flex-1 overflow-y-auto p-5 sm:p-7 space-y-6 text-slate-700 dark:text-slate-300 leading-relaxed text-xs sm:text-sm ${language === 'he' ? 'text-right' : 'text-left'
            }`}
          dir={language === 'he' ? 'rtl' : 'ltr'}
        >

          {/* SECTION 1: GETTING STARTED */}
          {activeSection === 'getting_started' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              {/* Welcome Banner */}
              <div className="p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="font-semibold text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-sky-500 shrink-0" />
                    <span>{guide.getting_started.welcomeTitle}</span>
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl">
                    {guide.getting_started.welcomeDesc}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSection('prompt_showcase')}
                  className="px-3.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white font-medium text-xs flex items-center gap-1.5 shadow-xs transition-colors shrink-0 cursor-pointer"
                >
                  <span>{guide.getting_started.exploreBtn}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Core Navigation Controls */}
              <div>
                <h4 className="font-semibold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                  {guide.getting_started.navHeading}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                    <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold text-xs">
                      <ZoomIn className="w-4 h-4 text-sky-500 shrink-0" />
                      <span>{guide.getting_started.zoomTitle}</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {guide.getting_started.zoomDesc}
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                    <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold text-xs">
                      <MousePointer className="w-4 h-4 text-sky-500 shrink-0" />
                      <span>{guide.getting_started.panTitle}</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {guide.getting_started.panDesc}
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                    <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold text-xs">
                      <Maximize2 className="w-4 h-4 text-sky-500 shrink-0" />
                      <span>{guide.getting_started.fitAllTitle}</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {guide.getting_started.fitAllDesc}
                    </p>
                  </div>
                </div>
              </div>

              {/* Event Inspection & The Side Drawers */}
              <div>
                <h4 className="font-semibold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                  {guide.getting_started.inspectHeading}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                    <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold text-xs">
                      <div className="p-1 rounded-md bg-slate-200/60 dark:bg-slate-700/60 text-slate-700 dark:text-slate-300">
                        <Calendar className="w-3.5 h-3.5 text-sky-500" />
                      </div>
                      <span>{guide.getting_started.eventDrawerTitle}</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {guide.getting_started.eventDrawerDesc}
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                    <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold text-xs">
                      <div className="p-1 rounded-md bg-slate-200/60 dark:bg-slate-700/60 text-slate-700 dark:text-slate-300">
                        <Layers className="w-3.5 h-3.5 text-sky-500" />
                      </div>
                      <span>{guide.getting_started.cardsDrawerTitle}</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {guide.getting_started.cardsDrawerDesc}
                    </p>
                  </div>
                </div>
              </div>

              {/* Stopping Generation Notice */}
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
                  <span className="text-xs text-slate-600 dark:text-slate-400">
                    <strong className="text-slate-900 dark:text-white">{guide.getting_started.stopGenTitle} </strong>
                    {guide.getting_started.stopGenDesc}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 2: PROMPT MASTERY */}
          {activeSection === 'prompt_mastery' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="space-y-1">
                <h3 className="font-semibold text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-sky-500 shrink-0" />
                  <span>{guide.prompt_mastery.title}</span>
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {guide.prompt_mastery.subtitle}
                </p>
              </div>

              {/* 1. Detail Levels */}
              <div>
                <h4 className="font-semibold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                  {guide.prompt_mastery.detailHeading}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                  {/* Overview */}
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-slate-900 dark:text-white">
                        {guide.prompt_mastery.levels.overview.name}
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                        {guide.prompt_mastery.levels.overview.count}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      <strong>{language === 'he' ? 'מתאים במיוחד ל: ' : 'Best for: '}</strong>
                      {guide.prompt_mastery.levels.overview.bestFor}
                    </p>
                    <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300 font-mono">
                      {guide.prompt_mastery.levels.overview.example}
                    </div>
                  </div>

                  {/* Standard */}
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-slate-900 dark:text-white">
                        {guide.prompt_mastery.levels.standard.name}
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                        {guide.prompt_mastery.levels.standard.count}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      <strong>{language === 'he' ? 'מתאים במיוחד ל: ' : 'Best for: '}</strong>
                      {guide.prompt_mastery.levels.standard.bestFor}
                    </p>
                    <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300 font-mono">
                      {guide.prompt_mastery.levels.standard.example}
                    </div>
                  </div>

                  {/* Deep Dive */}
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-slate-900 dark:text-white">
                        {guide.prompt_mastery.levels.deep_dive.name}
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                        {guide.prompt_mastery.levels.deep_dive.count}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      <strong>{language === 'he' ? 'מתאים במיוחד ל: ' : 'Best for: '}</strong>
                      {guide.prompt_mastery.levels.deep_dive.bestFor}
                    </p>
                    <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300 font-mono">
                      {guide.prompt_mastery.levels.deep_dive.example}
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Swimlanes Division */}
              <div>
                <h4 className="font-semibold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                  {guide.prompt_mastery.swimlanesHeading}
                </h4>
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-3">
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {guide.prompt_mastery.swimlanesDesc}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {guide.prompt_mastery.swimlanesExamples.map((ex, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1"
                       
                      >
                        <span className="font-semibold text-xs text-slate-900 dark:text-white">
                          {ex.title}
                        </span>
                        <p className="text-xs text-slate-600 dark:text-slate-400 italic">
                          {ex.desc}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* 3. Concise vs Detailed Prompts */}
              <div>
                <h4 className="font-semibold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                  {guide.prompt_mastery.framingHeading}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                    <span className="font-semibold text-xs text-slate-900 dark:text-white flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-sky-500 shrink-0" />
                      <span>{guide.prompt_mastery.conciseTitle}</span>
                    </span>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {guide.prompt_mastery.conciseDesc}
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                    <span className="font-semibold text-xs text-slate-900 dark:text-white flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-sky-500 shrink-0" />
                      <span>{guide.prompt_mastery.detailedTitle}</span>
                    </span>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {guide.prompt_mastery.detailedDesc}
                    </p>
                  </div>
                </div>
              </div>

              {/* 4. Multilingual Support: Prompt Language vs UI Language */}
              {guide.prompt_mastery.multilingualHeading && (
                <div>
                  <h4 className="font-semibold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                    {guide.prompt_mastery.multilingualHeading}
                  </h4>
                  <div className="p-4 sm:p-5 rounded-xl border border-sky-200/80 dark:border-sky-800/60 bg-sky-50/60 dark:bg-sky-950/25 space-y-2.5">
                    <div className="flex items-center gap-2 font-semibold text-xs sm:text-sm text-sky-900 dark:text-sky-200">
                      <Globe className="w-4 h-4 text-sky-500 shrink-0" />
                      <span>{guide.prompt_mastery.multilingualTitle}</span>
                    </div>
                    <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                      {guide.prompt_mastery.multilingualDesc}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SECTION 3: PROMPT SHOWCASE */}
          {activeSection === 'prompt_showcase' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2">
                    <Play className="w-4 h-4 text-sky-500 shrink-0" />
                    <span>{guide.prompt_showcase.title}</span>
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {guide.prompt_showcase.subtitle}
                  </p>
                </div>

                {/* Category Filter Pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                  {categoryFilters.map((cat) => (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => setSelectedCategoryKey(cat.key)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 ${selectedCategoryKey === cat.key
                          ? 'bg-sky-500 text-white shadow-xs'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Prompt Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredPrompts.map((item) => {
                  const isCopied = copiedPromptId === item.id;
                  const itemTitle = item.title[language] || item.title.en;
                  const itemCategory = item.category[language] || item.category.en;
                  const itemPrompt = item.prompt[language] || item.prompt.en;
                  const itemWhy = item.whyItWorks[language] || item.whyItWorks.en;

                  return (
                    <div
                      key={item.id}
                      className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-700 transition-colors flex flex-col justify-between"
                    >
                      <div className="space-y-2.5">
                        {/* Header Badges */}
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            {itemCategory}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-[10px] font-medium px-2 py-0.5 rounded-md border ${DETAIL_LEVEL_STYLES[item.detailLevel] ||
                                'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                                }`}
                            >
                              {getDetailLevelLabel(item.detailLevel)}
                            </span>
                          </div>
                        </div>

                        {/* Title */}
                        <h4 className="font-semibold text-sm text-slate-900 dark:text-white">
                          {itemTitle}
                        </h4>

                        {/* Prompt Body */}
                        <div
                         
                          className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 leading-relaxed font-sans select-all"
                        >
                          &ldquo;{itemPrompt}&rdquo;
                        </div>

                        {/* Why it works */}
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed flex items-start gap-1.5">
                          <span className="font-medium text-slate-700 dark:text-slate-300 shrink-0">
                            {guide.prompt_showcase.whyItWorksLabel}
                          </span>
                          <span>{itemWhy}</span>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="pt-3.5 mt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          id={`copy-prompt-btn-${item.id}`}
                          onClick={() => handleCopyPrompt(item)}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          {isCopied ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-500" />
                              <span className="text-emerald-600 dark:text-emerald-400">{guide.prompt_showcase.copied}</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>{guide.prompt_showcase.copyPrompt}</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          id={`try-now-btn-${item.id}`}
                          onClick={() => handleTryNow(item)}
                          className="px-3.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                        >
                          <span>{guide.prompt_showcase.tryNow}</span>
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
                <h3 className="font-semibold text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2">
                  <Edit3 className="w-4 h-4 text-sky-500 shrink-0" />
                  <span>{guide.event_editing.title}</span>
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {guide.event_editing.subtitle}
                </p>
              </div>

              {/* Editing & Adding Workflow Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                  <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold text-xs">
                    <Sparkles className="w-4 h-4 text-sky-500 shrink-0" />
                    <span>{guide.event_editing.cards[0].title}</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {guide.event_editing.cards[0].desc}
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                  <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold text-xs">
                    <Search className="w-4 h-4 text-sky-500 shrink-0" />
                    <span>{guide.event_editing.cards[1].title}</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {guide.event_editing.cards[1].desc}
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                  <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold text-xs">
                    <PlusCircle className="w-4 h-4 text-sky-500 shrink-0" />
                    <span>{guide.event_editing.cards[2].title}</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {guide.event_editing.cards[2].desc}
                  </p>
                </div>
              </div>

              {/* Geographic Coordinates in Event Edit */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                <h4 className="font-semibold text-xs text-slate-900 dark:text-white flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-sky-500 shrink-0" />
                  <span>{guide.event_editing.geoCoordsTitle}</span>
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {guide.event_editing.geoCoordsDesc}
                </p>
              </div>
            </div>
          )}

          {/* SECTION 5: AI REFINE */}
          {activeSection === 'ai_refine' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="space-y-1">
                <h3 className="font-semibold text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-sky-500 shrink-0" />
                  <span>{guide.ai_refine.title}</span>
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {guide.ai_refine.subtitle}
                </p>
              </div>

              {/* Splitting / Restructuring tip banner */}
              {guide.ai_refine.splitTipTitle && (
                <div className="p-4 rounded-xl border border-sky-200/80 dark:border-sky-800/50 bg-sky-50/50 dark:bg-sky-950/20 space-y-1.5">
                  <h4 className="font-semibold text-xs text-sky-900 dark:text-sky-300 flex items-center gap-2">
                    <Columns2 className="w-4 h-4 text-sky-500 shrink-0" />
                    <span>{guide.ai_refine.splitTipTitle}</span>
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {guide.ai_refine.splitTipDesc}
                  </p>
                </div>
              )}

              {/* Refinement examples */}
              <div className="space-y-3">
                <h4 className="font-semibold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {guide.ai_refine.examplesHeading}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {guide.ai_refine.prompts.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2 flex flex-col justify-between"
                     
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-xs text-slate-900 dark:text-white">
                          {item.label}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyRefinePrompt(item.prompt, idx)}
                          className="text-slate-400 hover:text-sky-500 p-1 rounded-md hover:bg-slate-200/60 dark:hover:bg-slate-700/50 transition-colors cursor-pointer shrink-0"
                          title={copiedPromptId === `refine-${idx}` ? (language === 'he' ? 'הועתק!' : 'Copied!') : (language === 'he' ? 'העתקת פרומפט' : 'Copy prompt')}
                          aria-label={copiedPromptId === `refine-${idx}` ? (language === 'he' ? 'הועתק!' : 'Copied!') : (language === 'he' ? 'העתקת פרומפט' : 'Copy prompt')}
                        >
                          {copiedPromptId === `refine-${idx}` ? (
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      <p className="text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                        {item.prompt}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* SECTION 6: GEOGRAPHIC MAP */}
          {activeSection === 'geo_map' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="space-y-1">
                <h3 className="font-semibold text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-sky-500 shrink-0" />
                  <span>{guide.geo_map.title}</span>
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {guide.geo_map.subtitle}
                </p>
              </div>

              {/* The 4 Map Display Modes */}
              <div>
                <h4 className="font-semibold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                  {guide.geo_map.modesHeading}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1.5">
                    <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold text-xs">
                      <Globe className="w-4 h-4 text-sky-500 shrink-0" />
                      <span>{guide.geo_map.modes[0].title}</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {guide.geo_map.modes[0].desc}
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1.5">
                    <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold text-xs">
                      <Minimize2 className="w-4 h-4 text-sky-500 shrink-0" />
                      <span>{guide.geo_map.modes[1].title}</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {guide.geo_map.modes[1].desc}
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1.5">
                    <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold text-xs">
                      <Columns2 className="w-4 h-4 text-sky-500 shrink-0" />
                      <span>{guide.geo_map.modes[2].title}</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {guide.geo_map.modes[2].desc}
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1.5">
                    <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold text-xs">
                      <Maximize2 className="w-4 h-4 text-sky-500 shrink-0" />
                      <span>{guide.geo_map.modes[3].title}</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {guide.geo_map.modes[3].desc}
                    </p>
                  </div>
                </div>
              </div>

              {/* Bi-Directional Interactive Sync */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                <h4 className="font-semibold text-xs text-slate-900 dark:text-white flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-sky-500 shrink-0" />
                  <span>{guide.geo_map.syncHeading}</span>
                </h4>
                <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1.5 list-disc list-inside">
                  {guide.geo_map.syncPoints.map((pt, i) => (
                    <li key={i} className="leading-relaxed">
                      {pt}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* SECTION 7: EXPORT & SAVING */}
          {activeSection === 'export_saving' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="space-y-1">
                <h3 className="font-semibold text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2">
                  <Download className="w-4 h-4 text-sky-500 shrink-0" />
                  <span>{guide.export_saving.title}</span>
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {guide.export_saving.subtitle}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                  <span className="font-semibold text-xs text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Download className="w-4 h-4 text-sky-500 shrink-0" />
                    <span>{guide.export_saving.cards[0].title}</span>
                  </span>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {guide.export_saving.cards[0].desc}
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                  <span className="font-semibold text-xs text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Download className="w-4 h-4 text-sky-500 shrink-0" />
                    <span>{guide.export_saving.cards[1].title}</span>
                  </span>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {guide.export_saving.cards[1].desc}
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                  <span className="font-semibold text-xs text-slate-900 dark:text-white flex items-center gap-1.5">
                    <BookOpen className="w-4 h-4 text-sky-500 shrink-0" />
                    <span>{guide.export_saving.cards[2].title}</span>
                  </span>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {guide.export_saving.cards[2].desc}
                  </p>
                </div>
              </div>

              {/* AI Disclaimer Alert */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold text-xs">
                  <AlertTriangle className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
                  <span>{guide.export_saving.disclaimerTitle}</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {guide.export_saving.disclaimerDesc}
                </p>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-5 sm:px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 flex items-center justify-between gap-3 shrink-0" dir="ltr">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5" dir={language === 'he' ? 'rtl' : 'ltr'}>
            <Sparkles className="w-3.5 h-3.5 text-sky-500 shrink-0" />
            <span className="hidden sm:inline">{guide.footer.tagline}</span>
            <span className="sm:hidden">{t('userGuide.title')}</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            id="user-guide-footer-close-btn"
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 shadow-xs transition-colors cursor-pointer"
          >
            {guide.footer.closeBtn}
          </button>
        </div>

      </div>
    </div>
  );
}

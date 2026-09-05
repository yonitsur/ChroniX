import React from 'react';
import { Clock, MapPin, Layers, Sparkles, SlidersHorizontal, Eye } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

export default function MobileNavBar({
  activeTab,
  onTabChange,
  onOpenRefine,
  locationsCount = 0,
  cardsCount = 0,
  isGenerating = false,
  isCanvasView = false,
  onToggleCanvasView
}) {
  const { t } = useLanguage();

  return (
    <nav
      aria-label="Mobile Navigation"
      className="fixed bottom-0 inset-x-0 z-40 bg-white/92 dark:bg-slate-950/92 backdrop-blur-2xl border-t border-slate-200/80 dark:border-slate-800/80 px-2 py-1.5 shadow-[0_-8px_24px_rgba(0,0,0,0.06)] dark:shadow-[0_-8px_24px_rgba(0,0,0,0.35)] select-none transition-colors"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 6px)' }}
    >
      <div className="max-w-lg mx-auto flex items-center justify-around gap-1">
        {/* Tab 1: Timeline (Vertical Feed or Canvas) */}
        <button
          type="button"
          onClick={() => onTabChange('timeline')}
          className={`flex flex-col items-center justify-center flex-1 py-1 px-1.5 rounded-xl transition-all duration-200 cursor-pointer active:scale-95 ${
            activeTab === 'timeline'
              ? 'text-sky-600 dark:text-sky-400 font-semibold bg-sky-50/80 dark:bg-sky-950/50'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Clock className={`w-4 h-4 mb-0.5 transition-transform ${activeTab === 'timeline' ? 'scale-110' : ''}`} />
          <span className="text-[10px] tracking-tight whitespace-nowrap">
            {isCanvasView ? t('mobile.viewCanvas') : t('mobile.timeline')}
          </span>
        </button>

        {/* Tab 2: Interactive Map */}
        <button
          type="button"
          onClick={() => onTabChange('map')}
          className={`relative flex flex-col items-center justify-center flex-1 py-1 px-1.5 rounded-xl transition-all duration-200 cursor-pointer active:scale-95 ${
            activeTab === 'map'
              ? 'text-sky-600 dark:text-sky-400 font-semibold bg-sky-50/80 dark:bg-sky-950/50'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <div className="relative">
            <MapPin className={`w-4 h-4 mb-0.5 transition-transform ${activeTab === 'map' ? 'scale-110' : ''}`} />
            {locationsCount > 0 && (
              <span className="absolute -top-1 -right-2 min-w-[14px] h-3.5 px-1 bg-sky-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                {locationsCount}
              </span>
            )}
          </div>
          <span className="text-[10px] tracking-tight whitespace-nowrap">{t('mobile.map')}</span>
        </button>

        {/* Tab 3: Cards & Search Index */}
        <button
          type="button"
          onClick={() => onTabChange('cards')}
          className={`relative flex flex-col items-center justify-center flex-1 py-1 px-1.5 rounded-xl transition-all duration-200 cursor-pointer active:scale-95 ${
            activeTab === 'cards'
              ? 'text-sky-600 dark:text-sky-400 font-semibold bg-sky-50/80 dark:bg-sky-950/50'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <div className="relative">
            <Layers className={`w-4 h-4 mb-0.5 transition-transform ${activeTab === 'cards' ? 'scale-110' : ''}`} />
            {cardsCount > 0 && (
              <span className="absolute -top-1 -right-2 min-w-[14px] h-3.5 px-1 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                {cardsCount}
              </span>
            )}
          </div>
          <span className="text-[10px] tracking-tight whitespace-nowrap">{t('mobile.cards')}</span>
        </button>

        {/* Tab 4: AI Refine */}
        <button
          type="button"
          disabled={isGenerating}
          onClick={onOpenRefine}
          className="flex flex-col items-center justify-center flex-1 py-1 px-1.5 rounded-xl text-slate-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 transition-all duration-200 cursor-pointer active:scale-95 disabled:opacity-40"
        >
          <Sparkles className="w-4 h-4 mb-0.5 text-amber-500 dark:text-amber-400 hover:rotate-12 transition-transform" />
          <span className="text-[10px] tracking-tight whitespace-nowrap">{t('mobile.refine')}</span>
        </button>

        {/* Optional View Switcher (Feed <-> Canvas) */}
        {onToggleCanvasView && (
          <button
            type="button"
            onClick={onToggleCanvasView}
            className={`flex flex-col items-center justify-center py-1 px-2 rounded-xl text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-all duration-200 cursor-pointer active:scale-95 ${
              isCanvasView ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50/70 dark:bg-indigo-950/40' : ''
            }`}
            title={isCanvasView ? t('mobile.viewFeed') : t('mobile.viewCanvas')}
          >
            <Eye className="w-3.5 h-3.5 mb-0.5" />
            <span className="text-[9px] tracking-tight whitespace-nowrap">
              {isCanvasView ? t('mobile.viewFeed') : t('mobile.viewCanvas')}
            </span>
          </button>
        )}
      </div>
    </nav>
  );
}

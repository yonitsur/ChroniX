import React, { useState } from 'react';
import { X, Sparkles, Loader2, ArrowRight, AlertTriangle, Clock, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

const DEFAULT_SUGGESTIONS = [
  "Divide the events into two timelines (e.g. by region or theme)",
  "Split into political, cultural, and military tracks",
  "Add 5 more key milestone events with Wikipedia links",
  "Filter to highlight only major turning points and decisive battles"
];

export default function AiRefineModal({
  isOpen,
  onClose,
  onRefine,
  isLoading,
  currentTimeline,
  currentTimelineTitle,
  quota
}) {
  const { t, isRtl } = useLanguage();
  const [instruction, setInstruction] = useState('');

  if (!isOpen) return null;

  const isAdmin = quota?.is_admin === true;
  const limit = quota?.timeline_paid_refine_limit && quota.timeline_paid_refine_limit > 0
    ? quota.timeline_paid_refine_limit
    : 3;
  const used = currentTimeline?.aiRefineCount || 0;
  const remaining = Math.max(0, limit - used);
  const isFreeTier = !isAdmin && (remaining === 0 || (quota && quota.remaining_paid === 0));
  const activeTitle = currentTimelineTitle || currentTimeline?.title || '';

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!instruction.trim() || isLoading) return;
    onRefine(instruction.trim());
  };

  const handleSuggestionClick = (sug) => {
    setInstruction(sug);
  };

  const suggestions = Array.isArray(t('aiRefine.suggestions'))
    ? t('aiRefine.suggestions')
    : DEFAULT_SUGGESTIONS;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className={`bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl border border-white/60 dark:border-white/10 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col ${
          isRtl ? 'text-right' : 'text-left'
        }`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/70 dark:border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 border border-sky-200/60 dark:border-sky-800/50">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                {t('aiRefine.title')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-xs">
                {t('aiRefine.subtitle', { title: activeTitle })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-800 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Refine Quota Status Banner */}
        <div className="px-6 py-2 bg-slate-50/90 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
          {isAdmin ? (
            <div className="flex items-center gap-1.5 text-purple-600 dark:text-purple-400 font-medium">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span>{t('aiRefine.adminUnlimited')}</span>
            </div>
          ) : isFreeTier ? (
            <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>{t('aiRefine.freeTierNotice', { limit })}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-sky-600 dark:text-sky-400 font-medium">
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>{t('aiRefine.remainingPremium', { remaining, limit })}</span>
            </div>
          )}
          {!isAdmin && (
            <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">
              {used}/{limit}
            </span>
          )}
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-sm text-slate-700 dark:text-slate-300">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {t('aiRefine.label')}
              </label>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                {instruction.length}/500
              </span>
            </div>
            <textarea
              rows={3}
              required
              dir={instruction ? (/[\u0590-\u05FF]/.test(instruction) ? 'rtl' : 'ltr') : (isRtl ? 'rtl' : 'ltr')}
              maxLength={500}
              disabled={isLoading}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={t('aiRefine.placeholder')}
              className={`w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all resize-none text-sm ${
                (instruction ? /[\u0590-\u05FF]/.test(instruction) : isRtl) ? 'text-right' : 'text-left'
              }`}
            />
          </div>

          {/* Prompt Suggestions */}
          <div>
            <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
              {t('aiRefine.suggestionsTitle')}
            </span>
            <div className="flex flex-col gap-1.5">
              {suggestions.map((sug, idx) => (
                <button
                  key={idx}
                  type="button"
                  disabled={isLoading}
                  onClick={() => handleSuggestionClick(sug)}
                  className="text-start text-xs bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700/60 rounded-xl px-3 py-2 transition-colors flex items-center justify-between group cursor-pointer"
                >
                  <span className="truncate">{sug}</span>
                  <ArrowRight className={`w-3 h-3 text-slate-400 dark:text-slate-500 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors shrink-0 ${isRtl ? 'rotate-180 mr-2' : 'ml-2'}`} />
                </button>
              ))}
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="pt-4 flex items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800">
            <span className="text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>{t('eventDrawer.aiSynthesizedDesc')}</span>
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 font-medium transition-colors cursor-pointer text-xs"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={!instruction.trim() || isLoading}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-medium shadow-sm transition-all active:scale-95 disabled:opacity-50 text-xs cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t('aiRefine.refining')}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>{t('aiRefine.applyBtn')}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

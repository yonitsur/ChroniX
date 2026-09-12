import React, { useState } from 'react';
import { X, Sparkles, Loader2, ArrowRight, AlertTriangle, Clock, ShieldCheck, Leaf } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

const DEFAULT_SUGGESTIONS = [
  "Divide into two timelines (by region or theme)",
  "Split into political, cultural, and military tracks",
  "Add 5 more key milestone events",
  "Add, remove, or edit themes (e.g. add 'Diplomacy', remove 'Culture')",
  "Highlight only major turning points"
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
  const isFreeMode = quota?.mode === 'free' && !isAdmin;
  const isUnlimited = !isAdmin && !isFreeMode && quota?.timeline_paid_refine_limit === -1;
  const limit = quota?.timeline_paid_refine_limit && quota.timeline_paid_refine_limit > 0
    ? quota.timeline_paid_refine_limit
    : 3;
  const used = currentTimeline?.aiRefineCount || 0;
  const remaining = Math.max(0, limit - used);
  const isFreeTier = !isAdmin && !isUnlimited && (remaining === 0 || (quota && quota.remaining_paid === 0));
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-200">
      <div
        className={`bg-surface-raised border border-line rounded-sheet w-full max-w-lg overflow-hidden shadow-panel flex flex-col ${
          isRtl ? 'text-right' : 'text-left'
        }`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-surface-raised">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-control bg-accent-soft text-accent border border-accent/40">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-ink">
                {t('aiRefine.title')}
              </h3>
              <p className="text-xs text-ink-muted truncate max-w-xs">
                {t('aiRefine.subtitle', { title: activeTitle })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-subtle hover:text-ink p-1 rounded-control hover:bg-surface-hover transition-colors cursor-pointer"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Refine Quota Status Banner */}
        <div className="px-6 py-2 bg-surface-sunken border-b border-line flex items-center justify-between text-xs">
          {isAdmin ? (
            <div className="flex items-center gap-1.5 text-warning font-medium">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span>{t('aiRefine.adminUnlimited')}</span>
            </div>
          ) : isFreeMode ? (
            <div className="flex items-center gap-1.5 text-success font-medium">
              <Leaf className="w-3.5 h-3.5 shrink-0" />
              <span>{t('quota.freeModeNotice')}</span>
            </div>
          ) : isUnlimited ? (
            <div className="flex items-center gap-1.5 text-accent font-medium">
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>{t('aiRefine.unlimitedNotice')}</span>
            </div>
          ) : isFreeTier ? (
            <div className="flex items-center gap-1.5 text-warning font-medium">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>{t('aiRefine.freeTierNotice', { limit })}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-accent font-medium">
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>{t('aiRefine.remainingPremium', { remaining, limit })}</span>
            </div>
          )}
          {!isAdmin && !isUnlimited && !isFreeMode && (
            <span className="text-[11px] text-ink-subtle font-mono">
              {used}/{limit}
            </span>
          )}
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-sm text-ink">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-ink">
                {t('aiRefine.label')}
              </label>
              <span className="text-[10px] text-ink-subtle font-mono">
                {instruction.length}/500
              </span>
            </div>
            <textarea
              rows={3}
              required
              dir={instruction ? (/[\u0590-\u05FF\u0600-\u06FF]/.test(instruction) ? 'rtl' : 'ltr') : (isRtl ? 'rtl' : 'ltr')}
              maxLength={500}
              disabled={isLoading}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={t('aiRefine.placeholder')}
              className={`w-full bg-surface-sunken border border-line rounded-control p-3 text-ink placeholder-ink-faint outline-none focus:border-accent focus:ring-1 focus:ring-accent-ring/30 transition-all resize-none text-sm shadow-control ${
                (instruction ? /[\u0590-\u05FF\u0600-\u06FF]/.test(instruction) : isRtl) ? 'text-right' : 'text-left'
              }`}
            />
          </div>

          {/* Prompt Suggestions */}
          <div>
            <span className="block text-xs font-semibold text-ink-muted mb-2">
              {t('aiRefine.suggestionsTitle')}
            </span>
            <div className="flex flex-col gap-1.5">
              {suggestions.map((sug, idx) => (
                <button
                  key={idx}
                  type="button"
                  disabled={isLoading}
                  onClick={() => handleSuggestionClick(sug)}
                  className="text-start text-xs bg-surface-sunken hover:bg-surface-hover text-ink border border-line rounded-control px-3 py-2 transition-colors flex items-center justify-between group cursor-pointer shadow-control"
                >
                  <span className="truncate">{sug}</span>
                  <ArrowRight className={`w-3 h-3 text-ink-subtle group-hover:text-accent transition-colors shrink-0 ${isRtl ? 'rotate-180 mr-2' : 'ml-2'}`} />
                </button>
              ))}
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="pt-4 flex items-center justify-between gap-3 border-t border-line">
            <span className="text-[11px] text-ink-subtle flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
              <span>{t('eventDrawer.aiSynthesizedDesc')}</span>
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-control text-ink-muted hover:text-ink hover:bg-surface-hover font-medium transition-colors cursor-pointer text-xs"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={!instruction.trim() || isLoading}
                className="flex items-center gap-2 px-5 py-2 rounded-control bg-accent hover:bg-accent-hover text-accent-fg font-medium shadow-control transition-all active:scale-95 disabled:opacity-40 text-xs cursor-pointer"
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

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Zap, Key, CheckCircle2, Info } from './icons/ThemeIcons';
import { useLanguage } from '../context/LanguageContext';
import { getCreditCosts } from '../utils/modelUtils';
import useModalAnimation from '../hooks/useModalAnimation';

/**
 * "How credits work" modal — a clear, user-facing explanation of which actions use
 * fast AI credits (and how many) versus what is unlimited (no credits needed).
 * The whole site is free of charge; credits only pace shared AI usage.
 * Cost values come from the server-provided `quota.credit_costs` schedule.
 */
export default function CreditCostsModal({ isOpen, onClose, quota = null, isGuest = false, onOpenSettings = null }) {
  const { t, isRtl } = useLanguage();
  const costs = getCreditCosts(quota);
  const dailyLimit = quota?.daily_paid_limit ?? (isGuest ? 10 : 25);

  const { isRendered, isVisible, handleClose, dragHandleProps } = useModalAnimation(isOpen, onClose, { duration: 250 });

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  if (!isRendered || typeof document === 'undefined') return null;

  const fmt = (n) => (n === 1 ? t('settings.creditScheduleSingleVal') : t('settings.creditScheduleCreditsVal', { credits: n }));
  const fmtRange = (min, max) =>
    min === max ? fmt(min) : t('settings.creditScheduleRangeVal', { min, max });

  const paidRows = [
    { label: t('creditCosts.rowTimeline'), hint: t('creditCosts.rowTimelineHint'), value: fmt(costs.text) },
    { label: t('creditCosts.rowChat'), hint: t('creditCosts.rowChatHint'), value: fmt(costs.text) },
    { label: t('creditCosts.rowUploadSmall'), hint: t('creditCosts.rowUploadSmallHint'), value: fmt(costs.text) },
    {
      label: t('creditCosts.rowUploadLarge'),
      hint: t('creditCosts.rowUploadLargeHint'),
      value: fmtRange(costs.upload_medium, costs.upload_heavy),
    },
    {
      label: t('creditCosts.rowAiGames'),
      hint: t('creditCosts.rowAiGamesHint', { quiz: t('quiz.title'), whoAmI: t('quiz.whoAmI.title') }),
      value: fmt(costs.text),
    },
    { label: t('creditCosts.rowPodcastScript'), hint: t('creditCosts.rowPodcastScriptHint'), value: fmt(costs.text) },
    { label: t('creditCosts.rowPremiumImage'), hint: t('creditCosts.rowPremiumImageHint'), value: fmt(costs.gemini_image) },
    {
      label: t('creditCosts.rowPremiumAudio'),
      hint: t('creditCosts.rowPremiumAudioHint'),
      value: fmt(costs.gemini_audio),
    },
    {
      label: t('creditCosts.rowPremiumAudioFull'),
      hint: t('creditCosts.rowPremiumAudioFullHint'),
      value: fmt(costs.gemini_audio_full),
    },
  ];

  const freeGames = [
    t('quiz.sequence.title'),
    t('quiz.timeGuesser.title'),
    t('quiz.wordle.title'),
    t('quiz.puzzle.title'),
    t('quiz.memory.title'),
  ].join(', ');

  const freeRows = [
    { label: t('creditCosts.freeImages'), hint: t('creditCosts.freeImagesHint') },
    { label: t('creditCosts.freeAudio'), hint: t('creditCosts.freeAudioHint') },
    { label: t('creditCosts.freeGames'), hint: t('creditCosts.freeGamesHint', { games: freeGames }) },
    { label: t('creditCosts.freeBrowse'), hint: t('creditCosts.freeBrowseHint') },
  ];

  return createPortal(
    <div
      className={`fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-5 bg-black/60 dark:bg-black/75 backdrop-blur-md transition-opacity duration-250 ease-out ${
        isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t('creditCosts.title')}
    >
      <div
        className={`bg-surface-overlay border border-line rounded-t-3xl sm:rounded-2xl rounded-b-none sm:rounded-b-2xl w-full max-w-lg max-h-[90vh] sm:max-h-[86vh] overflow-hidden shadow-glass-lg flex flex-col transition-all duration-250 ease-out pb-[max(0.75rem,env(safe-area-inset-bottom))] ${
          isVisible
            ? 'translate-y-0 opacity-100 sm:scale-100'
            : 'translate-y-full opacity-0 sm:translate-y-0 sm:scale-95'
        } ${isRtl ? 'text-right' : 'text-left'}`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Mobile Drag Indicator */}
        <div
          className="sm:hidden flex justify-center pt-3 pb-2 bg-surface-raised/80 shrink-0 cursor-grab active:cursor-grabbing touch-none select-none"
          {...dragHandleProps}
        >
          <div className="w-12 h-1.5 rounded-full bg-line-strong/60" />
        </div>

        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b border-line bg-surface-overlay/80 backdrop-blur-sm select-none shrink-0"
          {...dragHandleProps}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-accent-soft text-accent border border-line flex items-center justify-center shadow-2xs shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-base text-ink truncate">{t('creditCosts.title')}</h3>
              <p className="text-xs text-ink-muted truncate">{t('creditCosts.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t('common.close')}
            title={t('common.close')}
            className="text-ink-subtle hover:text-ink p-1.5 rounded-full hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-4 text-sm text-ink">
          {/* The whole site is free of charge — credits are a fair-use pacing tool, never a price */}
          <div className="flex items-start gap-2 p-3 rounded-xl bg-success-soft border border-success/30 text-xs sm:text-sm font-semibold text-ink leading-relaxed">
            <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
            <span>{t('creditCosts.freeOfCharge')}</span>
          </div>

          <p className="text-xs sm:text-sm text-ink-muted leading-relaxed">
            {t('creditCosts.intro', { limit: dailyLimit })}
          </p>

          {/* Uses credits */}
          <section className="space-y-1.5">
            <h4 className="text-caption font-bold uppercase tracking-wider text-ink-subtle flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-accent shrink-0" />
              {t('creditCosts.paidTitle')}
            </h4>
            <div className="rounded-xl border border-line bg-surface-sunken/60 divide-y divide-line/60">
              {paidRows.map((row) => (
                <div key={row.label} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-ink">{row.label}</div>
                    {row.hint && <div className="text-[11px] text-ink-muted leading-snug mt-0.5">{row.hint}</div>}
                  </div>
                  <span className="text-xs font-bold text-ink shrink-0 whitespace-nowrap pt-px">{row.value}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Unlimited — no credits needed */}
          <section className="space-y-1.5">
            <h4 className="text-caption font-bold uppercase tracking-wider text-ink-subtle flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
              {t('creditCosts.freeTitle')}
            </h4>
            <div className="rounded-xl border border-line bg-surface-sunken/60 divide-y divide-line/60">
              {freeRows.map((row) => (
                <div key={row.label} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-ink">{row.label}</div>
                    {row.hint && <div className="text-[11px] text-ink-muted leading-snug mt-0.5">{row.hint}</div>}
                  </div>
                  <span className="text-xs font-bold text-success shrink-0 whitespace-nowrap pt-px">
                    {t('creditCosts.freeVal')}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Good to know */}
          <div className="p-3 rounded-xl bg-accent-soft/40 border border-line text-[11px] text-ink-muted leading-relaxed space-y-1">
            <div className="flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 text-accent shrink-0 mt-px" />
              <span>{t('creditCosts.noteReset')}</span>
            </div>
            <div className="flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 text-accent shrink-0 mt-px" />
              <span>{t('creditCosts.noteFailed')}</span>
            </div>
            <div className="flex items-start gap-1.5">
              <Key className="w-3.5 h-3.5 text-accent shrink-0 mt-px" />
              <span>{t('creditCosts.noteOwnKey')}</span>
            </div>
          </div>

          {onOpenSettings && (
            <button
              type="button"
              onClick={() => {
                handleClose();
                onOpenSettings();
              }}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-control bg-surface hover:bg-surface-hover text-ink border border-line font-semibold text-xs transition-colors cursor-pointer"
            >
              <Key className="w-3.5 h-3.5 text-accent" />
              {t('toolbar.apiKeySettings')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

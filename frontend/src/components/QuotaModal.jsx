import React, { useEffect } from 'react';
import { X, Zap, Sparkles, Key, Shield } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { getApiKey } from '../api';

export default function QuotaModal({ isOpen, onClose, quota, onOpenSettings }) {
  const { t, isRtl } = useLanguage();

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isAdmin = quota?.is_admin;
  const used = quota?.used_today ?? 0;
  const limit = quota?.daily_paid_limit ?? 15;
  const remaining = quota?.remaining_paid ?? 0;
  const hasCustomKey = Boolean(getApiKey());

  let statusBorder = 'border-slate-200 dark:border-slate-800';
  let statusBg = 'bg-slate-50/70 dark:bg-slate-800/40';
  let iconBoxClass = 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700';
  let statusIcon = <Zap className="w-4 h-4 text-sky-500" />;
  let tierTitle = t('quota.tierPaid');
  let statusSubtext = t('quota.statusUsed', { used, limit });
  let badgePill = null;

  if (hasCustomKey) {
    statusBorder = 'border-purple-300 dark:border-purple-700/80 ring-1 ring-purple-400/20';
    statusBg = 'bg-gradient-to-r from-purple-500/10 via-purple-500/5 to-transparent dark:from-purple-500/15 dark:via-purple-500/5';
    iconBoxClass = 'bg-purple-500/15 dark:bg-purple-500/20 text-purple-600 dark:text-purple-300 border-purple-300/80 dark:border-purple-700';
    statusIcon = <Key className="w-4 h-4 text-purple-600 dark:text-purple-300" />;
    tierTitle = t('quota.tierCustom');
    statusSubtext = t('quota.statusCustom');
    badgePill = (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-300/60 dark:border-purple-700/60">
        <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
        {t('quota.currentStatus')}
      </span>
    );
  } else if (isAdmin) {
    statusBorder = 'border-amber-300 dark:border-amber-700/80 ring-1 ring-amber-400/20';
    statusBg = 'bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent dark:from-amber-500/15 dark:via-amber-500/5';
    iconBoxClass = 'bg-amber-500/15 dark:bg-amber-500/20 text-amber-600 dark:text-amber-300 border-amber-300/80 dark:border-amber-700';
    statusIcon = <Shield className="w-4 h-4 text-amber-600 dark:text-amber-400" />;
    tierTitle = t('quota.tierAdmin');
    statusSubtext = t('quota.statusUnlimited');
    badgePill = (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-300/60 dark:border-amber-700/60">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
        {t('quota.currentStatus')}
      </span>
    );
  } else if (remaining > 0) {
    statusBorder = 'border-sky-300 dark:border-sky-700/80 ring-1 ring-sky-400/20';
    statusBg = 'bg-gradient-to-r from-sky-500/10 via-sky-500/5 to-transparent dark:from-sky-500/15 dark:via-sky-500/5';
    iconBoxClass = 'bg-sky-500/15 dark:bg-sky-500/20 text-sky-600 dark:text-sky-300 border-sky-300/80 dark:border-sky-700';
    statusIcon = <Zap className="w-4 h-4 text-sky-600 dark:text-sky-400" />;
    tierTitle = t('quota.tierPaid');
    statusSubtext = t('quota.statusUsed', { used, limit });
    badgePill = (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-300/60 dark:border-sky-700/60">
        <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
        {t('quota.currentStatus')}
      </span>
    );
  } else {
    statusBorder = 'border-slate-300 dark:border-slate-700';
    statusBg = 'bg-slate-100/70 dark:bg-slate-800/50';
    iconBoxClass = 'bg-slate-200/80 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600';
    statusIcon = <Zap className="w-4 h-4 text-slate-500 dark:text-slate-400" />;
    tierTitle = t('quota.tierFree');
    statusSubtext = t('quota.statusUsed', { used, limit });
    badgePill = (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200/80 dark:bg-slate-700/80 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
        {t('quota.currentStatus')}
      </span>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200 font-sans"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`bg-white/75 dark:bg-slate-900/75 backdrop-blur-2xl backdrop-saturate-150 border border-white/60 dark:border-white/10 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl shadow-slate-950/30 dark:shadow-black/50 ring-1 ring-black/5 dark:ring-white/5 flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 ${
          isRtl ? 'text-right' : 'text-left'
        }`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200/70 dark:border-white/10 bg-gradient-to-b from-white/60 via-white/30 to-transparent dark:from-white/[0.07] dark:to-transparent shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shrink-0">
                <Zap className="w-4 h-4 text-sky-500" />
              </div>
              <div>
                <h3 className="font-semibold text-sm sm:text-base text-slate-900 dark:text-white">
                  {t('quota.modalTitle')}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {t('quota.modalSubtitle')}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
              title={t('common.close')}
              aria-label={t('common.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto text-xs text-slate-600 dark:text-slate-300">
          {/* Active Status Hero Card */}
          <div className={`p-4 rounded-xl border ${statusBorder} ${statusBg} flex items-center justify-between gap-3 shadow-xs`}>
            <div className="flex items-center gap-3 min-w-0">
              <div className={`p-2.5 rounded-xl border shrink-0 ${iconBoxClass}`}>
                {statusIcon}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm">
                    {tierTitle}
                  </span>
                  {badgePill}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {statusSubtext}
                </div>
              </div>
            </div>

            {!isAdmin && !hasCustomKey && (
              <div className={`shrink-0 ${isRtl ? 'text-left' : 'text-right'}`}>
                <span className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  {remaining}
                </span>
                <span className="text-slate-400 text-xs">/{limit}</span>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  {isRtl ? 'נותרו היום' : 'remaining today'}
                </div>
              </div>
            )}
          </div>

          {/* Explanation Cards with Section Header */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 px-1">
              <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                {t('quota.howItWorks')}
              </span>
              <div className="h-px flex-1 bg-slate-200/80 dark:bg-slate-800/80" />
            </div>

            <div className="space-y-2.5">
              {/* Card 1: 15 Fast Prompts */}
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex items-start gap-3">
                <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shrink-0 mt-0.5">
                  <Sparkles className="w-4 h-4 text-sky-500" />
                </div>
                <div>
                  <h4 className="font-semibold text-xs text-slate-900 dark:text-white mb-1">
                    {t('quota.premiumTitle')}
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {t('quota.premiumDesc')}
                  </p>
                </div>
              </div>

              {/* Card 2: Free Tier Fallback */}
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex items-start gap-3">
                <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shrink-0 mt-0.5">
                  <Zap className="w-4 h-4 text-sky-500" />
                </div>
                <div>
                  <h4 className="font-semibold text-xs text-slate-900 dark:text-white mb-1">
                    {t('quota.freeTitle')}
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {t('quota.freeDesc')}
                  </p>
                </div>
              </div>

              {/* Card 3: BYOK */}
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex items-start gap-3">
                <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shrink-0 mt-0.5">
                  <Key className="w-4 h-4 text-sky-500" />
                </div>
                <div>
                  <h4 className="font-semibold text-xs text-slate-900 dark:text-white mb-1">
                    {t('quota.byokTitle')}
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {t('quota.byokDesc')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            {t('common.close')}
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              if (onOpenSettings) onOpenSettings();
            }}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 shadow-2xs transition-all cursor-pointer active:scale-95"
          >
            <Key className="w-3.5 h-3.5 text-sky-500" />
            <span>{t('quota.openSettings')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

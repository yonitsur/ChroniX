import React, { useEffect } from 'react';
import { X, Zap, Sparkles, Key, Shield } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200 font-sans"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 ${
          isRtl ? 'text-right' : 'text-left'
        }`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
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
          {/* Status summary banner - clean slate styling */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shrink-0">
                {isAdmin ? <Shield className="w-4 h-4 text-sky-500" /> : <Zap className="w-4 h-4 text-sky-500" />}
              </div>
              <div>
                <div className="font-semibold text-slate-900 dark:text-white text-xs sm:text-sm">
                  {isAdmin
                    ? t('quota.tierAdmin')
                    : remaining > 0
                    ? t('quota.tierPaid')
                    : t('quota.tierFree')}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {isAdmin
                    ? t('quota.statusUnlimited')
                    : t('quota.statusUsed', { used, limit })}
                </div>
              </div>
            </div>

            {!isAdmin && (
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

          {/* Explanation Cards - clean slate styling matching About & User Guide */}
          <div className="space-y-3 pt-1">
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

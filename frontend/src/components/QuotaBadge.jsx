import React from 'react';
import { Zap, Key, Shield, HelpCircle } from 'lucide-react';
import { getApiKey } from '../api';
import { useLanguage } from '../context/LanguageContext';

export default function QuotaBadge({ quota, onClick, compact = false }) {
  const { t } = useLanguage();
  const hasCustomKey = Boolean(getApiKey());

  if (!quota) return null;

  const isAdmin = quota.is_admin;
  const remaining = quota.remaining_paid ?? 0;
  const limit = quota.daily_paid_limit ?? 15;

  let badgeContent = null;
  let badgeColor = '';

  if (hasCustomKey) {
    badgeColor = 'bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 dark:text-purple-300 border-purple-300 dark:border-purple-800';
    badgeContent = (
      <>
        <Key className="w-3.5 h-3.5 shrink-0" />
        <span className="font-semibold">{t('quota.badgeCustom')}</span>
      </>
    );
  } else if (isAdmin) {
    badgeColor = 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-300 border-amber-300 dark:border-amber-800';
    badgeContent = (
      <>
        <Shield className="w-3.5 h-3.5 shrink-0" />
        <span className="font-semibold">{compact ? 'Admin' : t('quota.badgeAdmin')}</span>
      </>
    );
  } else if (remaining > 0) {
    const isLow = remaining <= 3;
    badgeColor = isLow
      ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-300 border-amber-300 dark:border-amber-800'
      : 'bg-sky-500/10 hover:bg-sky-500/20 text-sky-600 dark:text-sky-300 border-sky-300 dark:border-sky-800';
    badgeContent = (
      <>
        <Zap className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400 shrink-0" />
        <span className="font-semibold">
          {compact
            ? t('quota.badgeFastShort', { remaining, limit })
            : t('quota.badgeFast', { remaining, limit })}
        </span>
      </>
    );
  } else {
    badgeColor = 'bg-slate-500/10 hover:bg-slate-500/20 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700';
    badgeContent = (
      <>
        <span className="font-semibold">{t('quota.badgeFreeTier')}</span>
      </>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs border shadow-2xs transition-all active:scale-95 cursor-pointer backdrop-blur-md ${badgeColor}`}
      title={t('quota.modalSubtitle')}
    >
      {badgeContent}
      <HelpCircle className="w-3 h-3 opacity-60 hover:opacity-100 shrink-0" />
    </button>
  );
}

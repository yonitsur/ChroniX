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

  let badgeIcon = null;
  let badgeColor = '';
  let badgeLabel = '';

  if (hasCustomKey) {
    badgeColor = 'bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 dark:text-purple-300 border-purple-300 dark:border-purple-800';
    badgeLabel = t('quota.badgeCustom');
    badgeIcon = <Key className="w-3.5 h-3.5 shrink-0" />;
  } else if (isAdmin) {
    badgeColor = 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-300 border-amber-300 dark:border-amber-800';
    badgeLabel = t('quota.badgeAdmin');
    badgeIcon = <Shield className="w-3.5 h-3.5 shrink-0" />;
  } else if (remaining > 0) {
    const isLow = remaining <= 3;
    badgeColor = isLow
      ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-300 border-amber-300 dark:border-amber-800'
      : 'bg-sky-500/10 hover:bg-sky-500/20 text-sky-600 dark:text-sky-300 border-sky-300 dark:border-sky-800';
    badgeLabel = t('quota.badgeFast', { remaining, limit });
    badgeIcon = <Zap className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400 shrink-0" />;
  } else {
    badgeColor = 'bg-slate-500/10 hover:bg-slate-500/20 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700';
    badgeLabel = t('quota.badgeFreeTier');
    badgeIcon = <Zap className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0 opacity-60" />;
  }

  const tooltip = `${badgeLabel} • ${t('quota.modalSubtitle')}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 shrink-0 flex items-center justify-center gap-1.5 px-2.5 rounded-lg text-xs border shadow-2xs transition-all active:scale-95 cursor-pointer backdrop-blur-md group ${badgeColor}`}
      title={tooltip}
      aria-label={badgeLabel}
    >
      {badgeIcon}
      <HelpCircle className="w-3 h-3 opacity-60 group-hover:opacity-100 transition-opacity shrink-0" />
    </button>
  );
}

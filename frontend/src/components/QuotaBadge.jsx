import React from 'react';
import { Zap, Key, Shield, HelpCircle, Leaf } from 'lucide-react';
import { getApiKey } from '../api';
import { useLanguage } from '../context/LanguageContext';

export default function QuotaBadge({ quota, onClick, compact = false }) {
  const { t } = useLanguage();
  const hasCustomKey = Boolean(getApiKey());

  if (!quota) return null;

  const isAdmin = quota.is_admin;
  const remaining = quota.remaining_paid ?? 0;
  const limit = quota.daily_paid_limit ?? (quota.is_guest ? 5 : 15);
  const isUnlimited = limit === -1;
  const isGuest = quota.is_guest === true && !isAdmin;
  const isFreeMode = quota.mode === 'free' && !isAdmin && !isGuest;

  let badgeIcon = null;
  let badgeColor = '';
  let badgeLabel = '';

  if (hasCustomKey) {
    badgeColor = 'bg-accent-soft hover:bg-accent-soft/80 text-accent border-accent/40';
    badgeLabel = t('quota.badgeCustom');
    badgeIcon = <Key className="w-3.5 h-3.5 shrink-0" />;
  } else if (isAdmin) {
    badgeColor = 'bg-warning-soft hover:bg-warning-soft/80 text-warning border-warning/40';
    badgeLabel = t('quota.badgeAdmin');
    badgeIcon = <Shield className="w-3.5 h-3.5 shrink-0" />;
  } else if (isGuest && quota.mode === 'free') {
    badgeColor = 'bg-success-soft hover:bg-success-soft/80 text-success border-success/40';
    badgeLabel = t('quota.badgeGuest');
    badgeIcon = <Leaf className="w-3.5 h-3.5 shrink-0" />;
  } else if (isFreeMode) {
    badgeColor = 'bg-success-soft hover:bg-success-soft/80 text-success border-success/40';
    badgeLabel = t('quota.badgeFreeMode');
    badgeIcon = <Leaf className="w-3.5 h-3.5 shrink-0" />;
  } else if (isUnlimited) {
    badgeColor = 'bg-accent-soft hover:bg-accent-soft/80 text-accent border-accent/40';
    badgeLabel = t('quota.badgeUnlimited');
    badgeIcon = <Zap className="w-3.5 h-3.5 text-accent shrink-0" />;
  } else if (remaining > 0) {
    const isLow = remaining <= (isGuest ? 1 : 3);
    badgeColor = isLow
      ? 'bg-warning-soft hover:bg-warning-soft/80 text-warning border-warning/40'
      : 'bg-accent-soft hover:bg-accent-soft/80 text-accent border-accent/40';
    badgeLabel = t('quota.badgeFast', { remaining, limit });
    badgeIcon = <Zap className="w-3.5 h-3.5 text-accent shrink-0" />;
  } else {
    badgeColor = 'bg-surface-sunken hover:bg-surface-hover text-ink-subtle border-line';
    badgeLabel = t('quota.badgeFreeTier');
    badgeIcon = <Zap className="w-3.5 h-3.5 text-ink-subtle shrink-0 opacity-60" />;
  }

  const tooltip = `${badgeLabel} • ${t('quota.modalSubtitle')}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 shrink-0 flex items-center justify-center gap-1.5 px-2.5 rounded-control text-xs border shadow-control transition-all active:scale-95 cursor-pointer group ${badgeColor}`}
      title={tooltip}
      aria-label={badgeLabel}
    >
      {badgeIcon}
      <HelpCircle className="w-3 h-3 opacity-60 group-hover:opacity-100 transition-opacity shrink-0" />
    </button>
  );
}

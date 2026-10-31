import React, { useEffect, useState } from 'react';
import { Heart, Sparkles } from './icons/ThemeIcons';
import KofiSupportButton from './KofiSupportButton';
import { fetchCommunityLedger, getCommunityDonationUrl } from '../api';
import { useLanguage } from '../context/LanguageContext';

function formatUsd(val, decimals = 2) {
  const num = Number(val);
  if (!Number.isFinite(num) || num <= 0) return '$0.00';
  if (num < 0.01 && decimals > 2) return `$${num.toFixed(4)}`;
  return `$${num.toFixed(2)}`;
}

export default function CommunityTransparencyCard({
  initialLedger = null,
  compact = false,
  showDonateButton = true,
  variant = 'default',
  className = '',
}) {
  const { t, isRtl } = useLanguage();
  const [ledger, setLedger] = useState(initialLedger);

  useEffect(() => {
    if (initialLedger) {
      setLedger(initialLedger);
    }
  }, [initialLedger]);

  useEffect(() => {
    let active = true;
    fetchCommunityLedger()
      .then((data) => {
        if (active && data) setLedger(data);
      })
      .catch(() => {});

    const handleLedgerUpdate = (ev) => {
      if (active && ev?.detail) {
        setLedger(ev.detail);
      }
    };
    window.addEventListener('chronix-community-ledger-updated', handleLedgerUpdate);
    return () => {
      active = false;
      window.removeEventListener('chronix-community-ledger-updated', handleLedgerUpdate);
    };
  }, []);

  const activeLedger = ledger || initialLedger || {};
  const spentUsd = Number(activeLedger.spent_usd) || 0;
  const donatedUsd = Number(activeLedger.donated_usd) || 0;
  const coveragePercent =
    spentUsd > 0
      ? Math.min(100, Math.round((donatedUsd / spentUsd) * 100))
      : donatedUsd > 0
      ? 100
      : 0;
  const displayPercent = coveragePercent;
  const donationUrl = getCommunityDonationUrl(activeLedger.donation_url);

  if (variant === 'home') {
    return (
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        className={`community-transparency-card relative overflow-hidden rounded-2xl bg-surface-raised/90 backdrop-blur-md border border-line shadow-card p-4 sm:p-5 text-start transition-all ${className}`}
      >
        {/* Subtle theme-adaptive ambient corner glow */}
        <div
          aria-hidden="true"
          className="community-transparency-orb pointer-events-none absolute -top-16 -right-16 w-48 h-48 rounded-full opacity-20 blur-2xl"
        />

        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="community-transparency-badge inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-accent-soft text-ink border border-line">
                <Heart className="w-3 h-3 text-accent shrink-0" />
                <span>{t('home.communityCardBadge')}</span>
              </span>
            </div>

            <h3 className="text-sm sm:text-base font-bold text-ink leading-snug">
              {t('home.communityCardTitle')}
            </h3>

            <p className="text-xs sm:text-[13px] text-ink-muted leading-relaxed max-w-2xl">
              {t('home.communityCardDesc')}
            </p>
          </div>

          {showDonateButton && donationUrl && (
            <div className="shrink-0 flex items-center sm:self-center pt-0.5 sm:pt-0">
              <KofiSupportButton href={donationUrl} />
            </div>
          )}
        </div>

        {/* Live Transparency Meter Row */}
        <div className="relative mt-4 pt-3.5 border-t border-line/80 grid grid-cols-2 sm:grid-cols-12 gap-2.5 sm:gap-3 items-center">
          <div className="community-metric-tile sm:col-span-3 px-3 py-2 rounded-xl bg-surface-sunken/80 border border-line flex flex-col">
            <span className="text-[11px] text-ink-muted flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-accent shrink-0" />
              <span className="truncate">{t('about.transparencySpentLabel')}</span>
            </span>
            <span className="text-sm sm:text-base font-bold font-mono text-ink mt-0.5" dir="ltr">
              {formatUsd(spentUsd, 4)}
            </span>
          </div>

          <div className="community-metric-tile sm:col-span-3 px-3 py-2 rounded-xl bg-surface-sunken/80 border border-line-strong flex flex-col">
            <span className="text-[11px] text-ink-muted flex items-center gap-1">
              <Heart className="w-3 h-3 text-accent shrink-0" />
              <span className="truncate">{t('about.transparencyDonatedLabel')}</span>
            </span>
            <span className="community-donated-amount text-sm sm:text-base font-bold font-mono text-ink mt-0.5" dir="ltr">
              {formatUsd(donatedUsd, 2)}
            </span>
          </div>

          <div className="community-metric-tile col-span-2 sm:col-span-6 px-3 py-2 rounded-xl bg-surface-sunken/60 border border-line/80 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-ink-muted">
              <span className="font-medium">{t('about.transparencyCoverageLabel')}</span>
              <span className="font-mono font-bold text-ink" dir="ltr">
                {displayPercent}%
              </span>
            </div>
            <div className="community-progress-track w-full h-2 rounded-full bg-surface border border-line overflow-hidden">
              <div
                className="community-progress-fill h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: `${Math.max(coveragePercent > 0 ? 4 : 0, coveragePercent)}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`community-transparency-card rounded-xl bg-surface-sunken/80 border border-line ${
        compact ? 'p-3' : 'p-4'
      } space-y-2.5 ${className}`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-accent-soft border border-line text-accent shrink-0">
            <Heart className="w-3.5 h-3.5" />
          </div>
          <h4 className="text-xs font-bold text-ink">
            {t('about.transparencyDashboardTitle')}
          </h4>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="community-metric-tile p-2.5 rounded-lg bg-surface/80 border border-line flex flex-col">
          <span className="text-[11px] text-ink-muted flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-accent shrink-0" />
            <span>{t('about.transparencySpentLabel')}</span>
          </span>
          <span className="text-sm sm:text-base font-bold font-mono text-ink mt-0.5" dir="ltr">
            {formatUsd(spentUsd, 4)}
          </span>
        </div>

        <div className="community-metric-tile p-2.5 rounded-lg bg-surface/80 border border-line-strong flex flex-col">
          <span className="text-[11px] text-ink-muted flex items-center gap-1">
            <Heart className="w-3 h-3 text-accent shrink-0" />
            <span>{t('about.transparencyDonatedLabel')}</span>
          </span>
          <span className="community-donated-amount text-sm sm:text-base font-bold font-mono text-ink mt-0.5" dir="ltr">
            {formatUsd(donatedUsd, 2)}
          </span>
        </div>
      </div>

      {/* Coverage Progress Bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px] text-ink-muted">
          <span>{t('about.transparencyCoverageLabel')}</span>
          <span className="font-mono font-semibold text-ink" dir="ltr">
            {displayPercent}%
          </span>
        </div>
        <div className="community-progress-track w-full h-2 rounded-full bg-surface border border-line overflow-hidden">
          <div
            className="community-progress-fill h-full rounded-full bg-accent transition-all duration-500"
            style={{ width: `${Math.max(coveragePercent > 0 ? 4 : 0, coveragePercent)}%` }}
          />
        </div>
      </div>

      {!compact && (
        <p className="text-xs text-ink-muted leading-relaxed">
          {t('about.supportCommunityDesc')}
        </p>
      )}

      {showDonateButton && donationUrl && (
        <div className="pt-1">
          <KofiSupportButton href={donationUrl} size={compact ? 'sm' : 'md'} />
        </div>
      )}
    </div>
  );
}

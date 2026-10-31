import React, { useEffect } from 'react';
import { X, Key, ExternalLink } from './icons/ThemeIcons';
import KofiSupportButton, { CommunityCupIcon } from './KofiSupportButton';
import CommunityTransparencyCard from './CommunityTransparencyCard';
import { getCommunityDonationUrl } from '../api';
import { useLanguage } from '../context/LanguageContext';
import useModalAnimation from '../hooks/useModalAnimation';

export default function CommunitySupportModal({
  isOpen,
  onClose,
  quota = null,
  onOpenSettings = null,
}) {
  const { t, isRtl } = useLanguage();
  const donationUrl = getCommunityDonationUrl(quota);

  const { isRendered, isVisible, handleClose, dragHandleProps } = useModalAnimation(isOpen, onClose, { duration: 250 });

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  if (!isRendered) return null;

  return (
    <div
      className={`fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-5 bg-black/60 dark:bg-black/75 backdrop-blur-md transition-opacity duration-250 ease-out ${
        isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t('communityModal.title')}
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
            <div className="p-2 rounded-xl bg-accent-soft text-ink border border-line flex items-center justify-center shadow-2xs shrink-0">
              <CommunityCupIcon className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-base text-ink truncate">
                {t('communityModal.title')}
              </h3>
              <p className="text-xs text-ink-muted truncate">
                {t('communityModal.subtitle')}
              </p>
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
        <div className="p-6 overflow-y-auto space-y-4 text-sm text-ink">
          {/* Mission & Context */}
          <p className="text-xs sm:text-sm text-ink-muted leading-relaxed">
            {t('communityModal.intro')}
          </p>

          {/* Single Unified Live Transparency Dashboard */}
          <CommunityTransparencyCard
            initialLedger={quota?.community_pool}
            compact
            showDonateButton={false}
          />

          {/* Primary Voluntary Support CTA (the ONLY external Ko-fi trigger in the app) */}
          {donationUrl && (
            <div className="pt-1 space-y-2 flex flex-col items-center">
              <div className="w-full flex items-center justify-center">
                <KofiSupportButton
                  href={donationUrl}
                  label={t('communityModal.donateBtn')}
                  className="w-full sm:w-auto sm:min-w-[260px]"
                />
              </div>
              <p className="text-[11px] text-ink-subtle text-center leading-snug max-w-md flex items-center justify-center gap-1 flex-wrap">
                <span>{t('communityModal.disclaimer')}</span>
                <ExternalLink className="w-2.5 h-2.5 inline opacity-70 shrink-0" />
              </p>
            </div>
          )}

          {/* Helpful Alternative: Connect Personal Gemini API Key (Paid Recommended) */}
          {onOpenSettings && (
            <div className="p-3.5 rounded-xl bg-surface-sunken/80 border border-line flex flex-col gap-3 text-xs">
              <div className="space-y-0.5 min-w-0">
                <div className="font-semibold text-ink flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-accent shrink-0" />
                  <span>{t('communityModal.byokTipTitle')}</span>
                </div>
                <p className="text-caption text-ink-muted leading-snug">
                  {t('communityModal.byokTipDesc')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  handleClose();
                  onOpenSettings();
                }}
                className="px-3 py-1.5 rounded-control bg-surface hover:bg-surface-hover text-ink border border-line font-semibold text-caption transition-colors cursor-pointer shrink-0 self-start whitespace-nowrap"
              >
                {t('communityModal.byokTipBtn')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

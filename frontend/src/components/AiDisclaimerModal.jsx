import React, { useEffect } from 'react';
import {
  X,
  AlertTriangle,
  Calendar,
  Sparkles,
  Edit3,
  Globe,
  ShieldCheck,
  Info
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import useModalAnimation from '../hooks/useModalAnimation';

export default function AiDisclaimerModal({ isOpen, onClose }) {
  const { t, isRtl } = useLanguage();

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
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-5 bg-black/60 dark:bg-black/75 backdrop-blur-md transition-opacity duration-250 ease-out ${
        isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`bg-surface-overlay border border-line rounded-t-3xl sm:rounded-2xl rounded-b-none sm:rounded-b-2xl w-full max-w-xl overflow-hidden shadow-glass-lg flex flex-col max-h-[90vh] transition-all duration-250 ease-out pb-[max(0.75rem,env(safe-area-inset-bottom))] ${
          isVisible
            ? 'translate-y-0 opacity-100 sm:scale-100'
            : 'translate-y-full opacity-0 sm:translate-y-0 sm:scale-95'
        } ${
          isRtl ? 'text-right' : 'text-left'
        }`}
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
          className="flex items-center justify-between px-6 py-4 border-b border-line bg-surface-overlay/80 backdrop-blur-sm select-none"
          {...dragHandleProps}
        >
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-warning-soft text-warning border border-warning/30 flex items-center justify-center shadow-2xs">
              <AlertTriangle className="w-5 h-5 text-warning" />
            </div>
            <div>
              <h3 className="font-semibold text-base text-ink">
                {t('aiDisclaimer.modalTitle')}
              </h3>
              <p className="text-xs text-ink-muted">
                {t('aiDisclaimer.modalSubtitle')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            aria-label={t('common.close')}
            className="text-ink-subtle hover:text-ink p-1.5 rounded-full hover:bg-surface-hover transition-colors cursor-pointer"
            title={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-4 text-sm text-ink-muted leading-relaxed">
          <div className="p-3.5 rounded-control bg-warning-soft border border-warning/30 text-ink text-xs sm:text-sm font-medium flex items-start gap-3">
            <div className="p-1.5 rounded-control bg-surface text-warning border border-warning/30 shrink-0 mt-0.5">
              <AlertTriangle className="w-4 h-4 text-warning" />
            </div>
            <p className="leading-relaxed">
              {t('aiDisclaimer.bannerWarning')}
            </p>
          </div>

          <div className="space-y-3.5">
            <div className="flex items-start gap-3">
              <div className="p-1.5 rounded-control bg-surface-sunken text-accent border border-line shrink-0 mt-0.5">
                <Sparkles className="w-4 h-4 text-accent" />
              </div>
              <div>
                <h4 className="font-semibold text-ink text-sm">
                  {t('aiDisclaimer.hallucinationsTitle')}
                </h4>
                <p className="text-xs text-ink-muted mt-0.5">
                  {t('aiDisclaimer.hallucinationsText')}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="p-1.5 rounded-control bg-surface-sunken text-accent border border-line shrink-0 mt-0.5">
                <Calendar className="w-4 h-4 text-accent" />
              </div>
              <div>
                <h4 className="font-semibold text-ink text-sm">
                  {t('aiDisclaimer.datesPrecisionTitle')}
                </h4>
                <p className="text-xs text-ink-muted mt-0.5">
                  {t('aiDisclaimer.datesPrecisionText')}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="p-1.5 rounded-control bg-surface-sunken text-accent border border-line shrink-0 mt-0.5">
                <Globe className="w-4 h-4 text-accent" />
              </div>
              <div>
                <h4 className="font-semibold text-ink text-sm">
                  {t('aiDisclaimer.wikiLinkingTitle')}
                </h4>
                <p className="text-xs text-ink-muted mt-0.5">
                  {t('aiDisclaimer.wikiLinkingText')}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="p-1.5 rounded-control bg-surface-sunken text-accent border border-line shrink-0 mt-0.5">
                <ShieldCheck className="w-4 h-4 text-accent" />
              </div>
              <div>
                <h4 className="font-semibold text-ink text-sm">
                  {t('aiDisclaimer.groundedVerificationTitle')}
                </h4>
                <p className="text-xs text-ink-muted mt-0.5">
                  {t('aiDisclaimer.groundedVerificationText')}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="p-1.5 rounded-control bg-surface-sunken text-accent border border-line shrink-0 mt-0.5">
                <Edit3 className="w-4 h-4 text-accent" />
              </div>
              <div>
                <h4 className="font-semibold text-ink text-sm">
                  {t('aiDisclaimer.fullControlTitle')}
                </h4>
                <p className="text-xs text-ink-muted mt-0.5">
                  {t('aiDisclaimer.fullControlText')}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-line bg-surface-raised flex items-center justify-between">
          <span className="text-caption text-ink-muted flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-accent shrink-0" />
            {t('aiDisclaimer.footerNote')}
          </span>
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-1.5 rounded-control text-xs font-semibold text-accent-fg bg-accent hover:bg-accent-hover shadow-control transition-colors active:scale-[0.98] cursor-pointer"
          >
            {t('aiDisclaimer.gotIt')}
          </button>
        </div>
      </div>
    </div>
  );
}

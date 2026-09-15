import React from 'react';
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

export default function AiDisclaimerModal({ isOpen, onClose }) {
  const { t, isRtl } = useLanguage();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-200">
      <div
        className={`bg-surface-raised border border-line rounded-sheet w-full max-w-xl overflow-hidden shadow-panel flex flex-col max-h-[90vh] ${
          isRtl ? 'text-right' : 'text-left'
        }`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-surface-raised">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-control bg-warning-soft text-warning border border-warning/30 flex items-center justify-center">
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
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-ink-subtle hover:text-ink p-1.5 rounded-control hover:bg-surface-hover transition-colors cursor-pointer"
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
          <span className="text-[11px] text-ink-muted flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-accent shrink-0" />
            {t('aiDisclaimer.footerNote')}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-control text-xs font-semibold text-accent-fg bg-accent hover:bg-accent-hover shadow-control transition-colors active:scale-[0.98] cursor-pointer"
          >
            {t('aiDisclaimer.gotIt')}
          </button>
        </div>
      </div>
    </div>
  );
}

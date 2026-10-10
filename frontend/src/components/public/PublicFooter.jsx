import React from 'react';
import { Heart } from 'lucide-react';
import ChroniXLogo from '../ChroniXLogo';
import { useLanguage } from '../../context/LanguageContext';

export default function PublicFooter({
  onOpenPublicRoute,
  onGoHome,
}) {
  const { t } = useLanguage();

  return (
    <footer className="public-footer w-full max-w-[1160px] mx-auto select-none px-4 sm:px-6 py-8 mt-12 text-xs" dir="ltr" style={{ direction: 'ltr' }}>
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 w-full">
        {/* Left: Branding, copyright, non-profit note */}
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5 text-center sm:text-start">
          <button
            type="button"
            onClick={onGoHome}
            className="flex items-center gap-1.5 opacity-90 hover:opacity-100 transition-opacity cursor-pointer shrink-0"
            title="ChroniX Home"
          >
            <ChroniXLogo size="xs" variant="auto" className="h-6 w-auto" />
          </button>
          <span className="font-medium text-ink-muted tracking-tight">
            &copy; 2026 ChroniX
          </span>
          <span className="hidden md:inline text-ink-faint">•</span>
          <span className="inline-flex items-center gap-1 text-caption text-success font-semibold">
            <Heart className="w-3 h-3 fill-success/20 text-success" />
            <span>{t('auth.freeNonProfitTitle') || 'Free & Non-Profit'}</span>
          </span>
        </div>

        {/* Right: Informational Links */}
        <div className="public-footer-links flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs">
          {onGoHome && (
            <>
              <button
                type="button"
                id="footer-nav-home"
                onClick={onGoHome}
                className="text-ink-muted hover:text-ink font-medium transition-colors cursor-pointer"
              >
                {t('auth.navHome') || 'Home'}
              </button>
              <span className="text-ink-faint">&bull;</span>
            </>
          )}

          <button
            type="button"
            id="footer-nav-features"
            onClick={() => onOpenPublicRoute?.('features')}
            className="text-ink-muted hover:text-ink font-medium transition-colors cursor-pointer"
          >
            {t('toolbar.features') || t('auth.navFeatures') || 'Features'}
          </button>

          <span className="text-ink-faint">&bull;</span>

          <button
            type="button"
            id="footer-nav-privacy"
            onClick={() => onOpenPublicRoute?.('privacy')}
            className="text-ink-muted hover:text-ink font-medium transition-colors cursor-pointer"
          >
            {t('toolbar.privacyPolicy') || t('auth.privacyPolicyLink') || 'Privacy Policy'}
          </button>

          <span className="text-ink-faint">&bull;</span>

          <button
            type="button"
            id="footer-nav-terms"
            onClick={() => onOpenPublicRoute?.('terms')}
            className="text-ink-muted hover:text-ink font-medium transition-colors cursor-pointer"
          >
            {t('toolbar.termsOfService') || t('auth.termsLink') || 'Terms of Service'}
          </button>

          <span className="text-ink-faint">&bull;</span>

          <a
            href="mailto:chronixaicom@gmail.com"
            id="footer-nav-support"
            className="text-ink-muted hover:text-ink font-medium transition-colors"
          >
            {t('auth.supportContact') || 'Support'}
          </a>
        </div>
      </div>
    </footer>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import {
  Sun,
  Moon,
  Globe,
  ChevronDown,
  Check,
  X,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import ChroniXLogo from '../ChroniXLogo';
import PublicFooter from './PublicFooter';
import { useLanguage } from '../../context/LanguageContext';

export default function PublicPageShell({
  children,
  theme,
  onToggleTheme,
  onGoHome,
  onOpenPublicRoute,
}) {
  const isDark = theme === 'dark';
  const { language, setLanguage, supportedLanguages, activeLanguageInfo, isRtl, t } = useLanguage();
  const [isLangOpen, setIsLangOpen] = useState(false);
  const langRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (langRef.current && !langRef.current.contains(e.target)) {
        setIsLangOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div
      className="auth-gate-bg fixed inset-0 w-full h-full h-[100dvh] text-ink flex flex-col selection:bg-accent-soft selection:text-accent bg-cover overflow-hidden"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div
        className="w-full h-full overflow-y-auto overflow-x-hidden overscroll-y-contain flex flex-col bg-transparent"
        style={{
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
        }}
      >
        <div className="public-page-wrapper flex-1">
          {/* Top Stationary Navigation Header */}
          <header className="public-top-header" dir="ltr" style={{ direction: 'ltr' }}>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onGoHome}
              className="public-logo cursor-pointer"
              title="ChroniX Home"
            >
              <ChroniXLogo size="sm" minimal={true} variant={isDark ? 'dark' : 'light'} />
            </button>
          </div>

          <div className="public-header-actions" dir="ltr" style={{ direction: 'ltr' }}>
            {/* Theme switcher */}
            <button
              type="button"
              onClick={onToggleTheme}
              title={isDark ? t('toolbar.switchThemeLight') : t('toolbar.switchThemeDark')}
              aria-label={isDark ? t('toolbar.switchThemeLight') : t('toolbar.switchThemeDark')}
              className="public-btn-icon cursor-pointer shrink-0"
            >
              {isDark ? (
                <Sun className="w-4 h-4 text-amber-400 hover:rotate-45 transition-transform" />
              ) : (
                <Moon className="w-4 h-4 text-ink-muted hover:-rotate-12 transition-transform" />
              )}
            </button>

            {/* Language dropdown */}
            <div className="relative shrink-0" ref={langRef}>
              <button
                type="button"
                onClick={() => setIsLangOpen((prev) => !prev)}
                title={t('settings.languageHeading')}
                aria-label={t('settings.languageHeading')}
                className="public-btn-lang cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5 text-accent shrink-0" />
                <span>{activeLanguageInfo?.nativeLabel || language}</span>
                <ChevronDown className={`w-3 h-3 text-ink-subtle shrink-0 transition-transform ${isLangOpen ? 'rotate-180' : ''}`} />
              </button>

              {isLangOpen && (
                <div
                  className="absolute top-full mt-2 right-0 w-48 py-1 bg-surface-overlay border border-line rounded-panel shadow-pop z-50 animate-in fade-in zoom-in-95 duration-150"
                  dir={isRtl ? 'rtl' : 'ltr'}
                >
                  <div className="max-h-60 overflow-y-auto py-1">
                    {supportedLanguages.map((l) => {
                      const isSelected = l.code === language;
                      return (
                        <button
                          key={l.code}
                          type="button"
                          onClick={() => {
                            setLanguage(l.code);
                            setIsLangOpen(false);
                          }}
                          className={`w-full px-3 py-1.5 text-xs flex items-center justify-between transition-colors cursor-pointer text-start ${
                            isSelected
                              ? 'bg-accent-soft text-accent font-semibold'
                              : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-5 text-center font-mono text-caption font-semibold px-1 py-0.5 rounded-control bg-surface-sunken text-ink-subtle">
                              {l.badge}
                            </span>
                            <span>{l.nativeLabel}</span>
                          </div>
                          {isSelected && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Close / Return to Home Button */}
            <button
              type="button"
              onClick={onGoHome}
              className="public-btn-enter cursor-pointer gap-1.5"
              title={t('common.close') || 'Close'}
            >
              <span>{t('auth.navHome') || t('common.close') || 'Home'}</span>
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="w-full flex-1 flex flex-col">
          {children}
        </main>

        {/* Unified Footer */}
        <PublicFooter
          onOpenPublicRoute={onOpenPublicRoute}
          onGoHome={onGoHome}
        />
      </div>
    </div>
  </div>
);
}

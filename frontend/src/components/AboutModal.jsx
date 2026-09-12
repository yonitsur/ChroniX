import React, { useState, useEffect } from 'react';
import {
  X,
  ExternalLink,
  Sparkles,
  Layers,
  Globe,
  Cpu,
  Heart,
  ShieldCheck,
  Edit3,
  Code2,
  Mail,
  Copy,
  Check
} from 'lucide-react';
import ChroniXLogo from './ChroniXLogo';
import { useLanguage } from '../context/LanguageContext';

const GITHUB_REPO_URL = 'https://github.com/yonitsur/ChroniX';

function GithubIcon({ className = 'w-4 h-4', ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

export default function AboutModal({ isOpen, onClose, onOpenGuide }) {
  const { t, isRtl } = useLanguage();
  const [copiedEmail, setCopiedEmail] = useState(false);

  const handleCopyEmail = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText('chronix.ai.com@gmail.com');
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-chronix-title"
    >
      <div
        className="bg-surface-raised border border-line rounded-sheet w-full max-w-2xl overflow-hidden shadow-panel flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        
        {/* Header with Logo & Hero */}
        <div className="px-6 pt-6 pb-4 border-b border-line bg-surface-raised">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <h2 id="about-chronix-title" className="sr-only">
                  ChroniX
                </h2>
                <ChroniXLogo mode="minimal" size="md" className="h-7 w-auto" />
                <span className="px-2 py-0.5 rounded-control text-[10px] font-medium bg-surface-sunken text-ink-subtle border border-line">
                  v1.0
                </span>
                <a
                  href={GITHUB_REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-control text-[11px] font-medium bg-surface-sunken hover:bg-surface-hover text-ink-muted hover:text-ink border border-line transition-colors"
                  title={t('about.githubRepo')}
                >
                  <GithubIcon className="w-3.5 h-3.5" />
                  <span>GitHub</span>
                  <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                </a>
              </div>
              <p className={`text-xs font-medium text-ink-muted mt-1 ${isRtl ? 'text-right' : 'text-left'}`}>
                {t('about.tagline')}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="text-ink-subtle hover:text-ink p-1.5 rounded-control hover:bg-surface-hover transition-colors cursor-pointer"
              title={t('common.close')}
              aria-label={t('common.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-sm text-ink-muted leading-relaxed max-h-[calc(92vh-180px)]">
          
          {/* Overview */}
          <div className="space-y-5 animate-in fade-in duration-150">
              <div className="p-4 rounded-panel border border-line bg-surface-sunken">
                <p className={`text-ink text-xs sm:text-sm leading-relaxed ${isRtl ? 'text-right' : 'text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>
                  {t('about.heroDesc')}
                </p>
              </div>

              {/* Free & Non-Profit Mission Card */}
              <div className="p-4 rounded-panel border border-line bg-surface-sunken space-y-1.5" dir={isRtl ? 'rtl' : 'ltr'}>
                <div className="flex items-center gap-2">
                  <Heart className="w-4 h-4 text-accent shrink-0" />
                  <span className={`font-semibold text-xs sm:text-sm text-ink ${isRtl ? 'text-right' : 'text-left'}`}>
                    {t('about.nonProfitTitle')}
                  </span>
                </div>
                <p className={`text-xs text-ink-muted leading-relaxed ${isRtl ? 'text-right' : 'text-left'}`}>
                  {t('about.nonProfitDesc')}
                </p>
              </div>

              <h3 className={`text-xs font-semibold text-ink-subtle uppercase tracking-wider ${isRtl ? 'text-right' : 'text-left'}`}>
                {t('about.featuresHeading')}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-panel border border-line bg-surface-sunken space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-accent shrink-0" />
                    <span className={`font-semibold text-xs text-ink ${isRtl ? 'text-right' : 'text-left'}`}>
                      {t('about.features.0.title')}
                    </span>
                  </div>
                  <p className={`text-xs text-ink-muted ${isRtl ? 'text-right' : 'text-left'}`}>
                    {t('about.features.0.desc')}
                  </p>
                </div>

                <div className="p-3.5 rounded-panel border border-line bg-surface-sunken space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-accent shrink-0" />
                    <span className={`font-semibold text-xs text-ink ${isRtl ? 'text-right' : 'text-left'}`}>
                      {t('about.features.1.title')}
                    </span>
                  </div>
                  <p className={`text-xs text-ink-muted ${isRtl ? 'text-right' : 'text-left'}`}>
                    {t('about.features.1.desc')}
                  </p>
                </div>

                <div className="p-3.5 rounded-panel border border-line bg-surface-sunken space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-accent shrink-0" />
                    <span className={`font-semibold text-xs text-ink ${isRtl ? 'text-right' : 'text-left'}`}>
                      {t('about.features.2.title')}
                    </span>
                  </div>
                  <p className={`text-xs text-ink-muted ${isRtl ? 'text-right' : 'text-left'}`}>
                    {t('about.features.2.desc')}
                  </p>
                </div>

                <div className="p-3.5 rounded-panel border border-line bg-surface-sunken space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Edit3 className="w-4 h-4 text-accent shrink-0" />
                    <span className={`font-semibold text-xs text-ink ${isRtl ? 'text-right' : 'text-left'}`}>
                      {t('about.features.3.title')}
                    </span>
                  </div>
                  <p className={`text-xs text-ink-muted ${isRtl ? 'text-right' : 'text-left'}`}>
                    {t('about.features.3.desc')}
                  </p>
                </div>
              </div>

              {/* GitHub Repository */}
              <div className="p-4 rounded-panel border border-line bg-surface-sunken flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-control bg-surface text-accent border border-line shrink-0">
                    <GithubIcon className="w-4 h-4 text-accent" />
                  </div>
                  <div>
                    <h4 className={`font-semibold text-xs sm:text-sm text-ink ${isRtl ? 'text-right' : 'text-left'}`}>
                      {t('about.githubTitle')}
                    </h4>
                    <p className={`text-xs text-ink-muted ${isRtl ? 'text-right' : 'text-left'}`}>
                      {t('about.githubDesc')}
                    </p>
                  </div>
                </div>

                <a
                  href={GITHUB_REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-control text-xs font-semibold bg-accent hover:bg-accent-hover text-accent-fg shadow-control transition-colors shrink-0 cursor-pointer w-fit"
                >
                  <GithubIcon className="w-3.5 h-3.5" />
                  <span>{t('about.githubLink')}</span>
                  <ExternalLink className="w-3 h-3 opacity-70" />
                </a>
              </div>

              {/* Contact & Support */}
              <div className="p-4 rounded-panel border border-line bg-surface-sunken flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-control bg-surface text-accent border border-line shrink-0">
                    <Mail className="w-4 h-4 text-accent" />
                  </div>
                  <div>
                    <h4 className={`font-semibold text-xs sm:text-sm text-ink ${isRtl ? 'text-right' : 'text-left'}`}>
                      {t('about.contactTitle')}
                    </h4>
                    <p className={`text-xs text-ink-muted ${isRtl ? 'text-right' : 'text-left'}`}>
                      {t('about.contactDesc')}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <a
                    href="mailto:chronix.ai.com@gmail.com"
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-control text-xs font-medium bg-surface hover:bg-surface-hover text-ink border border-line transition-colors cursor-pointer"
                    title={t('about.copyEmail')}
                  >
                    <Mail className="w-3.5 h-3.5 text-accent" />
                    <span>chronix.ai.com@gmail.com</span>
                  </a>
                  <button
                    type="button"
                    onClick={handleCopyEmail}
                    className="p-1.5 rounded-control bg-surface hover:bg-surface-hover text-ink-subtle hover:text-ink border border-line transition-colors cursor-pointer"
                    title={copiedEmail ? t('about.copied') : t('about.copyEmail')}
                    aria-label={t('about.copyEmail')}
                  >
                    {copiedEmail ? (
                      <Check className="w-3.5 h-3.5 text-success" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>

          {/* Credits & Attributions */}
          <div className="pt-2 border-t border-line space-y-4 animate-in fade-in duration-150">
              <h3 className={`text-xs font-semibold text-ink-subtle uppercase tracking-wider ${isRtl ? 'text-right' : 'text-left'}`}>
                {t('about.tabs.credits')}
              </h3>
              <p className={`text-xs text-ink-muted ${isRtl ? 'text-right' : 'text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>
                {t('about.creditsIntro')}
              </p>

              {/* Histropedia Credit */}
              <div className="p-4 rounded-panel border border-line bg-surface-sunken space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="px-2 py-1 rounded-control bg-surface text-ink-muted border border-line font-bold text-xs">
                      JS
                    </div>
                    <div className={isRtl ? 'text-right' : 'text-left'} dir={isRtl ? 'rtl' : 'ltr'}>
                      <h4 className="font-semibold text-sm text-ink">
                        {t('about.creditsHistropediaTitle')}
                      </h4>
                      <p className="text-[11px] text-ink-subtle">
                        {t('about.creditsHistropediaSub')}
                      </p>
                    </div>
                  </div>
                  <a
                    href="https://histropedia.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                  >
                    <span>histropedia.com</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className={`text-xs text-ink-muted ${isRtl ? 'text-right' : 'text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>
                  {t('about.creditsHistropediaDesc')}
                </p>
                <div className="pt-1.5 text-[11px] text-ink-subtle flex items-center justify-between border-t border-line">
                  <span>{t('about.creditsHistropediaLicense')}</span>
                  <a
                    href="https://js.histropedia.com/licence"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline shrink-0 ms-2"
                  >
                    {t('about.creditsHistropediaLicenseLink')}
                  </a>
                </div>
              </div>

              {/* Google Gemini Credit */}
              <div className="p-4 rounded-panel border border-line bg-surface-sunken space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-control bg-surface text-accent border border-line">
                      <Cpu className="w-4 h-4 text-accent" />
                    </div>
                    <div className={isRtl ? 'text-right' : 'text-left'} dir={isRtl ? 'rtl' : 'ltr'}>
                      <h4 className="font-semibold text-sm text-ink">
                        {t('about.creditsGeminiTitle')}
                      </h4>
                      <p className="text-[11px] text-ink-subtle">
                        {t('about.creditsGeminiSub')}
                      </p>
                    </div>
                  </div>
                  <a
                    href="https://aistudio.google.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                  >
                    <span>Google AI Studio</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className={`text-xs text-ink-muted ${isRtl ? 'text-right' : 'text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>
                  {t('about.creditsGeminiDesc')}
                </p>
              </div>

              {/* Wikipedia & Wikimedia Commons Credit */}
              <div className="p-4 rounded-panel border border-line bg-surface-sunken space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-control bg-surface text-accent border border-line">
                      <Globe className="w-4 h-4 text-accent" />
                    </div>
                    <div className={isRtl ? 'text-right' : 'text-left'} dir={isRtl ? 'rtl' : 'ltr'}>
                      <h4 className="font-semibold text-sm text-ink">
                        {t('about.creditsWikiTitle')}
                      </h4>
                      <p className="text-[11px] text-ink-subtle">
                        {t('about.creditsWikiSub')}
                      </p>
                    </div>
                  </div>
                  <a
                    href="https://commons.wikimedia.org"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                  >
                    <span>Wikimedia</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className={`text-xs text-ink-muted ${isRtl ? 'text-right' : 'text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>
                  {t('about.creditsWikiDesc')}
                </p>
              </div>

              {/* Open Source Tech Stack & License */}
              <div className="p-4 rounded-panel border border-line bg-surface-sunken space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-control bg-surface text-accent border border-line">
                      <Code2 className="w-4 h-4 text-accent" />
                    </div>
                    <div className={isRtl ? 'text-right' : 'text-left'} dir={isRtl ? 'rtl' : 'ltr'}>
                      <h4 className="font-semibold text-sm text-ink">
                        {t('about.creditsLeafletTitle')}
                      </h4>
                      <p className="text-[11px] text-ink-subtle">
                        {t('about.creditsLeafletSub')}
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-control text-[10px] font-medium bg-surface text-ink-muted border border-line">
                    {t('about.creditsLeafletLicense')}
                  </span>
                </div>
                <p className={`text-xs text-ink-muted ${isRtl ? 'text-right' : 'text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>
                  {t('about.creditsLeafletDesc')}
                </p>
              </div>

              {/* ChroniX Open Source Repository */}
              <div className="p-4 rounded-panel border border-line bg-surface-sunken space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-control bg-surface text-accent border border-line">
                      <GithubIcon className="w-4 h-4 text-accent" />
                    </div>
                    <div className={isRtl ? 'text-right' : 'text-left'} dir={isRtl ? 'rtl' : 'ltr'}>
                      <h4 className="font-semibold text-sm text-ink">
                        {t('about.creditsChroniXTitle')}
                      </h4>
                      <p className="text-[11px] text-ink-subtle">
                        {t('about.creditsChroniXSub')}
                      </p>
                    </div>
                  </div>
                  <a
                    href={GITHUB_REPO_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                  >
                    <span>github.com/yonitsur/ChroniX</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className={`text-xs text-ink-muted ${isRtl ? 'text-right' : 'text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>
                  {t('about.creditsChroniXDesc')}
                </p>
              </div>

              {/* Contact / Inquiries */}
              <div className="p-3.5 rounded-panel border border-line bg-surface-sunken flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-control bg-surface text-ink-muted border border-line shrink-0">
                    <Mail className="w-3.5 h-3.5 text-accent" />
                  </div>
                  <div className={isRtl ? 'text-right' : 'text-left'} dir={isRtl ? 'rtl' : 'ltr'}>
                    <h5 className="font-semibold text-xs text-ink">
                      {t('about.contactTitle')}
                    </h5>
                    <p className="text-[11px] text-ink-subtle">
                      {t('about.contactDesc')}
                    </p>
                  </div>
                </div>
                <a
                  href="mailto:chronix.ai.com@gmail.com"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline w-fit"
                >
                  <Mail className="w-3 h-3" />
                  <span>chronix.ai.com@gmail.com</span>
                </a>
              </div>
            </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-line bg-surface-raised flex flex-col sm:flex-row items-center justify-between gap-2.5" dir="ltr">
          <div className="flex items-center gap-2.5 text-[11px] text-ink-muted flex-wrap">
            <div className="flex items-center gap-1.5" dir={isRtl ? 'rtl' : 'ltr'}>
              <ShieldCheck className="w-3.5 h-3.5 text-accent shrink-0" />
              <span>{t('about.footerTagline')}</span>
            </div>
            <span className="hidden sm:inline text-line">•</span>
            <a
              href="mailto:chronix.ai.com@gmail.com"
              className="inline-flex items-center gap-1.5 hover:text-accent transition-colors font-medium text-ink-muted"
              title="Contact us via email"
            >
              <Mail className="w-3 h-3 text-accent shrink-0" />
              <span dir="ltr">chronix.ai.com@gmail.com</span>
            </a>
            <span className="hidden sm:inline text-line">•</span>
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-accent transition-colors font-medium text-ink-muted"
              title={t('about.githubRepo')}
            >
              <GithubIcon className="w-3 h-3 text-accent shrink-0" />
              <span>GitHub</span>
            </a>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-control text-xs font-semibold bg-surface-hover hover:bg-surface-active text-ink border border-line transition-colors cursor-pointer"
            >
              {t('common.close')}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

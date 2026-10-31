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
  Check,
  Mic,
  BookUser,
  Palette,
  Gamepad2,
  Wand2,
  Headphones,
} from './icons/ThemeIcons';
import ChroniXLogo from './ChroniXLogo';
import { CommunityCupIcon } from './KofiSupportButton';
import { useLanguage } from '../context/LanguageContext';
import useModalAnimation from '../hooks/useModalAnimation';

const GITHUB_REPO_URL = 'https://github.com/yonitsur/ChroniX';

const ABOUT_FEATURE_ICONS = [
  Sparkles,
  Mic,
  BookUser,
  Palette,
  Headphones,
  Gamepad2,
  Wand2,
  Globe,
  Edit3,
];

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

export default function AboutModal({ isOpen, onClose, onOpenCommunitySupport = null }) {
  const { t, isRtl } = useLanguage();
  const [copiedEmail, setCopiedEmail] = useState(false);

  const { isRendered, isVisible, handleClose, dragHandleProps } = useModalAnimation(isOpen, onClose, { duration: 250 });

  const handleCopyEmail = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText('chronixaicom@gmail.com');
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleClose();
      }
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
      aria-labelledby="about-chronix-title"
    >
      <div
        className={`bg-surface-overlay border border-line rounded-t-3xl sm:rounded-2xl rounded-b-none sm:rounded-b-2xl w-full max-w-2xl overflow-hidden shadow-glass-lg flex flex-col max-h-[92vh] transition-all duration-250 ease-out pb-[max(0.75rem,env(safe-area-inset-bottom))] ${
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

        {/* Header with Logo & Hero */}
        <div
          className="px-6 pt-4 sm:pt-6 pb-4 border-b border-line bg-surface-overlay/80 backdrop-blur-sm select-none"
          {...dragHandleProps}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <h2 id="about-chronix-title" className="sr-only">
                  ChroniX
                </h2>
                <ChroniXLogo mode="minimal" size="md" className="h-7 w-auto" />
                <span className="px-2 py-0.5 rounded-control text-caption font-semibold bg-surface-sunken text-ink-subtle border border-line">
                  v1.0
                </span>
              </div>
              <p className={`text-xs font-medium text-ink-muted mt-1 ${isRtl ? 'text-right' : 'text-left'}`}>
                {t('about.tagline')}
              </p>
            </div>

            <button
              type="button"
              onClick={handleClose}
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
              <div className="p-4 rounded-panel border border-line bg-surface-sunken space-y-2" dir={isRtl ? 'rtl' : 'ltr'}>
                <div className="flex items-center gap-2">
                  <Heart className="w-4 h-4 text-accent shrink-0" />
                  <span className={`font-semibold text-xs sm:text-sm text-ink ${isRtl ? 'text-right' : 'text-left'}`}>
                    {t('about.nonProfitTitle')}
                  </span>
                </div>
                <p className={`text-xs text-ink-muted leading-relaxed ${isRtl ? 'text-right' : 'text-left'}`}>
                  {t('about.nonProfitDesc')}
                </p>
                {onOpenCommunitySupport && (
                  <div className="pt-2 border-t border-line/70 flex items-center justify-start">
                    <button
                      type="button"
                      onClick={() => {
                        handleClose();
                        onOpenCommunitySupport();
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-surface-overlay hover:bg-surface-hover text-ink border border-line hover:border-line-strong font-semibold text-xs shadow-2xs transition-colors cursor-pointer active:scale-95"
                    >
                      <CommunityCupIcon className="w-[18px] h-[18px] shrink-0" />
                      <span>{t('communityModal.openDashboardBtn')}</span>
                    </button>
                  </div>
                )}
              </div>

              <h3 className={`text-xs font-semibold text-ink-subtle uppercase tracking-wider ${isRtl ? 'text-right' : 'text-left'}`}>
                {t('about.featuresHeading')}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {ABOUT_FEATURE_ICONS.map((IconComp, idx) => {
                  const title = t(`about.features.${idx}.title`);
                  const desc = t(`about.features.${idx}.desc`);
                  if (!title || title === `about.features.${idx}.title`) return null;
                  const isLastOdd = ABOUT_FEATURE_ICONS.length % 2 === 1 && idx === ABOUT_FEATURE_ICONS.length - 1;
                  return (
                    <div
                      key={idx}
                      className={`p-3.5 rounded-panel border border-line bg-surface-sunken space-y-1.5 ${
                        isLastOdd ? 'sm:col-span-2' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <IconComp className="w-4 h-4 text-accent shrink-0" />
                        <span className={`font-semibold text-xs text-ink ${isRtl ? 'text-right' : 'text-left'}`}>
                          {title}
                        </span>
                      </div>
                      <p className={`text-xs text-ink-muted ${isRtl ? 'text-right' : 'text-left'}`}>
                        {desc}
                      </p>
                    </div>
                  );
                })}
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
                    href="mailto:chronixaicom@gmail.com"
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-control text-xs font-medium bg-surface hover:bg-surface-hover text-ink border border-line transition-colors cursor-pointer"
                    title={t('about.copyEmail')}
                  >
                    <Mail className="w-3.5 h-3.5 text-accent" />
                    <span>chronixaicom@gmail.com</span>
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

          {/* Powered by */}
          <div className="pt-2 border-t border-line space-y-4 animate-in fade-in duration-150">
              <h3 className={`text-xs font-semibold text-ink-subtle uppercase tracking-wider ${isRtl ? 'text-right' : 'text-left'}`}>
                {t('about.tabs.poweredBy')}
              </h3>
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
                      <p className="text-caption text-ink-subtle">
                        {t('about.creditsGeminiSub')}
                      </p>
                    </div>
                  </div>
                </div>
                <p className={`text-xs text-ink-muted ${isRtl ? 'text-right' : 'text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>
                  {t('about.creditsGeminiDesc')}
                </p>
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
                      <p className="text-caption text-ink-subtle">
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
                <div className="pt-1.5 text-caption text-ink-subtle flex items-center justify-between border-t border-line">
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
                      <p className="text-caption text-ink-subtle">
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

              {/* YouTube API Services Credit */}
              <div className="p-4 rounded-panel border border-line bg-surface-sunken space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-control bg-surface text-accent border border-line">
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-accent" aria-hidden="true">
                        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                      </svg>
                    </div>
                    <div className={isRtl ? 'text-right' : 'text-left'} dir={isRtl ? 'rtl' : 'ltr'}>
                      <h4 className="font-semibold text-sm text-ink">
                        {t('about.creditsYoutubeTitle')}
                      </h4>
                      <p className="text-caption text-ink-subtle">
                        {t('about.creditsYoutubeSub')}
                      </p>
                    </div>
                  </div>
                  <a
                    href="https://www.youtube.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                  >
                    <span>YouTube</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className={`text-xs text-ink-muted ${isRtl ? 'text-right' : 'text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>
                  {t('about.creditsYoutubeDesc')}
                </p>
              </div>

              {/* Podcast TTS & Open-Source Audio Stack Credit */}
              <div className="p-4 rounded-panel border border-line bg-surface-sunken space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-control bg-surface text-accent border border-line">
                      <Headphones className="w-4 h-4 text-accent" />
                    </div>
                    <div className={isRtl ? 'text-right' : 'text-left'} dir={isRtl ? 'rtl' : 'ltr'}>
                      <h4 className="font-semibold text-sm text-ink">
                        {t('about.creditsAudioTitle')}
                      </h4>
                      <p className="text-caption text-ink-subtle">
                        {t('about.creditsAudioSub')}
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-control text-caption font-semibold bg-surface text-ink-muted border border-line">
                    {t('about.creditsAudioLicense')}
                  </span>
                </div>
                <p className={`text-xs text-ink-muted ${isRtl ? 'text-right' : 'text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>
                  {t('about.creditsAudioDesc')}
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
                      <p className="text-caption text-ink-subtle">
                        {t('about.creditsLeafletSub')}
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-control text-caption font-semibold bg-surface text-ink-muted border border-line">
                    {t('about.creditsLeafletLicense')}
                  </span>
                </div>
                <p className={`text-xs text-ink-muted ${isRtl ? 'text-right' : 'text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>
                  {t('about.creditsLeafletDesc')}
                </p>
              </div>
            </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-line bg-surface-raised flex flex-col sm:flex-row items-center justify-between gap-2.5" dir="ltr">
          <div className="flex items-center gap-2.5 text-caption text-ink-muted flex-wrap">
            <div className="flex items-center gap-1.5" dir={isRtl ? 'rtl' : 'ltr'}>
              <ShieldCheck className="w-3.5 h-3.5 text-accent shrink-0" />
              <span>{t('about.footerTagline')}</span>
            </div>
            <span className="hidden sm:inline text-line">•</span>
            <a
              href="mailto:chronixaicom@gmail.com"
              className="inline-flex items-center gap-1.5 hover:text-accent transition-colors font-medium text-ink-muted"
              title="Contact us via email"
            >
              <Mail className="w-3 h-3 text-accent shrink-0" />
              <span dir="ltr">chronixaicom@gmail.com</span>
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

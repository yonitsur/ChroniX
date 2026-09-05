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
  MousePointer,
  ZoomIn,
  Edit3,
  Code2,
  BookOpen,
  ArrowRight,
  Mail,
  Copy,
  Check
} from 'lucide-react';
import ChroniXLogo from './ChroniXLogo';
import { useLanguage } from '../context/LanguageContext';

export default function AboutModal({ isOpen, onClose, onOpenGuide }) {
  const { t, isRtl } = useLanguage();
  const [activeTab, setActiveTab] = useState('overview');
  const [copiedEmail, setCopiedEmail] = useState(false);

  const TABS = [
    { id: 'overview', label: t('about.tabs.overview'), icon: Sparkles },
    { id: 'credits', label: t('about.tabs.credits'), icon: Heart },
    { id: 'guide', label: t('about.tabs.guide'), icon: MousePointer }
  ];

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
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-chronix-title"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200">
        
        {/* Header with Logo & Hero */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="flex items-start justify-between gap-4" dir="ltr">
            <div>
              <div className="flex items-center gap-2.5">
                <h2 id="about-chronix-title" className="sr-only">
                  ChroniX
                </h2>
                <ChroniXLogo mode="minimal" size="md" className="h-7 w-auto" />
                <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                  v1.0
                </span>
              </div>
              <p className={`text-xs font-medium text-slate-500 dark:text-slate-400 mt-1 ${isRtl ? 'text-right' : 'text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>
                {t('about.tagline')}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title={t('common.close')}
              aria-label={t('common.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="flex items-center gap-1 mt-5 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg" dir="ltr">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0 text-sky-500" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div
          className={`p-6 overflow-y-auto space-y-6 text-sm text-slate-700 dark:text-slate-300 leading-relaxed max-h-[calc(92vh-180px)] ${
            isRtl ? 'text-right' : 'text-left'
          }`}
          dir={isRtl ? 'rtl' : 'ltr'}
        >
          
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
                <p className="text-slate-800 dark:text-slate-200 text-xs sm:text-sm leading-relaxed">
                  {t('about.heroDesc')}
                </p>
              </div>

              <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                {t('about.featuresHeading')}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-sky-500" />
                    <span className="font-semibold text-xs text-slate-900 dark:text-white">
                      {t('about.features.0.title')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {t('about.features.0.desc')}
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-sky-500" />
                    <span className="font-semibold text-xs text-slate-900 dark:text-white">
                      {t('about.features.1.title')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {t('about.features.1.desc')}
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-sky-500" />
                    <span className="font-semibold text-xs text-slate-900 dark:text-white">
                      {t('about.features.2.title')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {t('about.features.2.desc')}
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Edit3 className="w-4 h-4 text-sky-500" />
                    <span className="font-semibold text-xs text-slate-900 dark:text-white">
                      {t('about.features.3.title')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {t('about.features.3.desc')}
                  </p>
                </div>
              </div>

              {/* Contact & Support */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shrink-0">
                    <Mail className="w-4 h-4 text-sky-500" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-xs sm:text-sm text-slate-900 dark:text-white">
                      {t('about.contactTitle')}
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {t('about.contactDesc')}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <a
                    href="mailto:chronix.ai.com@gmail.com"
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                    title={t('about.copyEmail')}
                  >
                    <Mail className="w-3.5 h-3.5 text-sky-500" />
                    <span>chronix.ai.com@gmail.com</span>
                  </a>
                  <button
                    type="button"
                    onClick={handleCopyEmail}
                    className="p-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                    title={copiedEmail ? t('about.copied') : t('about.copyEmail')}
                    aria-label={t('about.copyEmail')}
                  >
                    {copiedEmail ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CREDITS & ATTRIBUTIONS */}
          {activeTab === 'credits' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('about.creditsIntro')}
              </p>

              {/* Histropedia Credit */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-bold text-xs">
                      JS
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm text-slate-900 dark:text-white">
                        {t('about.creditsHistropediaTitle')}
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {t('about.creditsHistropediaSub')}
                      </p>
                    </div>
                  </div>
                  <a
                    href="https://histropedia.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline"
                  >
                    <span>histropedia.com</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {t('about.creditsHistropediaDesc')}
                </p>
                <div className="pt-1.5 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between border-t border-slate-200/80 dark:border-slate-800">
                  <span>{t('about.creditsHistropediaLicense')}</span>
                  <a
                    href="https://js.histropedia.com/licence"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-600 dark:text-sky-400 hover:underline shrink-0 ml-2"
                  >
                    {t('about.creditsHistropediaLicenseLink')}
                  </a>
                </div>
              </div>

              {/* Google Gemini Credit */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                      <Cpu className="w-4 h-4 text-sky-500" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm text-slate-900 dark:text-white">
                        {t('about.creditsGeminiTitle')}
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {t('about.creditsGeminiSub')}
                      </p>
                    </div>
                  </div>
                  <a
                    href="https://aistudio.google.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline"
                  >
                    <span>Google AI Studio</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {t('about.creditsGeminiDesc')}
                </p>
              </div>

              {/* Wikipedia & Wikimedia Commons Credit */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                      <Globe className="w-4 h-4 text-sky-500" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm text-slate-900 dark:text-white">
                        {t('about.creditsWikiTitle')}
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {t('about.creditsWikiSub')}
                      </p>
                    </div>
                  </div>
                  <a
                    href="https://commons.wikimedia.org"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline"
                  >
                    <span>Wikimedia</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {t('about.creditsWikiDesc')}
                </p>
              </div>

              {/* Open Source Tech Stack & License */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                      <Code2 className="w-4 h-4 text-sky-500" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm text-slate-900 dark:text-white">
                        {t('about.creditsLeafletTitle')}
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {t('about.creditsLeafletSub')}
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                    {t('about.creditsLeafletLicense')}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {t('about.creditsLeafletDesc')}
                </p>
              </div>

              {/* Contact / Inquiries */}
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shrink-0">
                    <Mail className="w-3.5 h-3.5 text-sky-500" />
                  </div>
                  <div>
                    <h5 className="font-semibold text-xs text-slate-900 dark:text-white">
                      {t('about.contactTitle')}
                    </h5>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {t('about.contactDesc')}
                    </p>
                  </div>
                </div>
                <a
                  href="mailto:chronix.ai.com@gmail.com"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline w-fit"
                >
                  <Mail className="w-3 h-3" />
                  <span>chronix.ai.com@gmail.com</span>
                </a>
              </div>
            </div>
          )}

          {/* TAB 3: QUICK GUIDE */}
          {activeTab === 'guide' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* Callout to Full User Guide */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <h4 className="font-semibold text-xs sm:text-sm text-slate-900 dark:text-white flex items-center gap-1.5">
                    <BookOpen className="w-4 h-4 text-sky-500" />
                    {t('about.guideCalloutTitle')}
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {t('about.guideCalloutDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  id="about-open-user-guide-btn"
                  onClick={() => {
                    onClose();
                    onOpenGuide?.();
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white font-medium text-xs flex items-center gap-1.5 shadow-xs transition-colors shrink-0 cursor-pointer"
                >
                  <span>{t('toolbar.userGuide')}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                {t('about.guideHeading')}
              </h3>

              <div className="space-y-2.5">
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50/60 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                  <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shrink-0 mt-0.5">
                    <ZoomIn className="w-4 h-4 text-sky-500" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-xs text-slate-900 dark:text-white">
                      {t('about.guides.0.title')}
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                      {t('about.guides.0.desc')}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50/60 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                  <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shrink-0 mt-0.5">
                    <MousePointer className="w-4 h-4 text-sky-500" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-xs text-slate-900 dark:text-white">
                      {t('about.guides.1.title')}
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                      {t('about.guides.1.desc')}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50/60 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                  <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shrink-0 mt-0.5">
                    <Sparkles className="w-4 h-4 text-sky-500" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-xs text-slate-900 dark:text-white">
                      {t('about.guides.2.title')}
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                      {t('about.guides.2.desc')}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 flex flex-col sm:flex-row items-center justify-between gap-2.5" dir="ltr">
          <div className="flex items-center gap-2.5 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap" dir={isRtl ? 'rtl' : 'ltr'}>
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-sky-500 shrink-0" />
              <span>{t('about.footerTagline')}</span>
            </div>
            <span className="hidden sm:inline text-slate-300 dark:text-slate-700">•</span>
            <a
              href="mailto:chronix.ai.com@gmail.com"
              className="inline-flex items-center gap-1.5 hover:text-sky-600 dark:hover:text-sky-400 transition-colors font-medium text-slate-600 dark:text-slate-400"
              title="Contact us via email"
            >
              <Mail className="w-3 h-3 text-sky-500 shrink-0" />
              <span dir="ltr">chronix.ai.com@gmail.com</span>
            </a>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              id="about-footer-guide-btn"
              onClick={() => {
                onClose();
                onOpenGuide?.();
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <BookOpen className="w-3.5 h-3.5 text-sky-500" />
              <span>{t('toolbar.userGuide')}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 shadow-xs transition-colors cursor-pointer"
            >
              {t('common.close')}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

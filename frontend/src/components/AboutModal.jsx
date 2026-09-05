import React, { useState, useEffect } from 'react';
import {
  X,
  Info,
  ExternalLink,
  Sparkles,
  Layers,
  Globe,
  Calendar,
  Cpu,
  Heart,
  ShieldCheck,
  MousePointer,
  ZoomIn,
  Edit3,
  Download,
  Code2,
  CheckCircle2,
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
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-chronix-title"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200">
        
        {/* Header with Logo & Hero */}
        <div className="relative px-6 pt-6 pb-4 border-b border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-slate-50 via-sky-50/30 to-white dark:from-slate-900 dark:via-slate-900/90 dark:to-slate-950">
          <div className="flex items-start justify-between gap-4" dir="ltr">
            <div>
              <div className="flex items-center gap-2.5">
                <h2 id="about-chronix-title" className="sr-only">
                  ChroniX
                </h2>
                <ChroniXLogo mode="minimal" size="md" className="h-7 w-auto" />
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-700 dark:bg-sky-950/80 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
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
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-xl hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title={t('common.close')}
              aria-label={t('common.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="flex items-center gap-1.5 mt-5 bg-slate-200/70 dark:bg-slate-800/80 p-1 rounded-xl" dir="ltr">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-slate-700/50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
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
              <div className="p-4 rounded-2xl bg-gradient-to-r from-sky-500/10 via-indigo-500/5 to-transparent border border-sky-500/15">
                <p className="text-slate-800 dark:text-slate-200 text-xs sm:text-sm leading-relaxed">
                  {t('about.heroDesc')}
                </p>
              </div>

              <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                {t('about.featuresHeading')}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1.5">
                  <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400">
                    <Sparkles className="w-4 h-4" />
                    <span className="font-semibold text-xs text-slate-900 dark:text-white">
                      {t('about.features.0.title')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {t('about.features.0.desc')}
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1.5">
                  <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                    <Layers className="w-4 h-4" />
                    <span className="font-semibold text-xs text-slate-900 dark:text-white">
                      {t('about.features.1.title')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {t('about.features.1.desc')}
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1.5">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                    <Globe className="w-4 h-4" />
                    <span className="font-semibold text-xs text-slate-900 dark:text-white">
                      {t('about.features.2.title')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {t('about.features.2.desc')}
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1.5">
                  <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400">
                    <Edit3 className="w-4 h-4" />
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
              <div className="p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-gradient-to-r from-sky-500/10 via-indigo-500/5 to-slate-50 dark:to-slate-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-sky-500/15 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 shrink-0">
                    <Mail className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">
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
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-slate-700/80 text-sky-600 dark:text-sky-400 border border-slate-200 dark:border-slate-700 shadow-2xs transition-all cursor-pointer"
                    title={t('about.copyEmail')}
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>chronix.ai.com@gmail.com</span>
                  </a>
                  <button
                    type="button"
                    onClick={handleCopyEmail}
                    className="p-1.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/80 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 shadow-2xs transition-all cursor-pointer"
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
              <div className="p-4 rounded-2xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/50 dark:bg-sky-950/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400 font-bold text-xs">
                      JS
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white">
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
                    className="inline-flex items-center gap-1 text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline"
                  >
                    <span>histropedia.com</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {t('about.creditsHistropediaDesc')}
                </p>
                <div className="pt-1 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between border-t border-sky-100 dark:border-sky-900/40">
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
              <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
                      <Cpu className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white">
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
                    className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
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
              <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      <Globe className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white">
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
                    className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
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
              <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
                      <Code2 className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                        {t('about.creditsLeafletTitle')}
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {t('about.creditsLeafletSub')}
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
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
                  <div className="p-1.5 rounded-lg bg-sky-500/10 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 shrink-0">
                    <Mail className="w-3.5 h-3.5" />
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
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline w-fit"
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
              <div className="p-4 rounded-2xl bg-gradient-to-r from-sky-500/10 via-indigo-500/10 to-transparent border border-sky-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <h4 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white flex items-center gap-1.5">
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
                  className="px-3.5 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs transition-all shrink-0 cursor-pointer"
                >
                  <span>{t('toolbar.userGuide')}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                {t('about.guideHeading')}
              </h3>

              <div className="space-y-2.5">
                <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                  <div className="p-1.5 rounded-lg bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5">
                    <ZoomIn className="w-4 h-4" />
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

                <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                  <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5">
                    <MousePointer className="w-4 h-4" />
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

                <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                  <div className="p-1.5 rounded-lg bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5">
                    <Sparkles className="w-4 h-4" />
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
        <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70 flex flex-col sm:flex-row items-center justify-between gap-2.5" dir="ltr">
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
              className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <BookOpen className="w-3.5 h-3.5 text-sky-500" />
              <span>{t('toolbar.userGuide')}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 shadow-xs transition-all active:scale-95 cursor-pointer"
            >
              {t('common.close')}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

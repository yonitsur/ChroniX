import React, { useState, useEffect } from 'react';
import { X, Key, CheckCircle, AlertCircle, Eye, EyeOff, Save, ExternalLink, Languages, Check, Zap } from 'lucide-react';
import { getApiKey, setApiKey, fetchHealth } from '../api';
import { useLanguage } from '../context/LanguageContext';

export default function SettingsModal({ isOpen, onClose, quota, onRefreshQuota }) {
  const { language, setLanguage, t, isRtl } = useLanguage();
  const [apiKey, setKeyValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [serverHasKey, setServerHasKey] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setKeyValue(getApiKey());
      fetchHealth()
        .then((data) => {
          setServerHasKey(Boolean(data.has_server_gemini_key));
        })
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = (e) => {
    e.preventDefault();
    setApiKey(apiKey);
    setSavedSuccess(true);
    if (onRefreshQuota) onRefreshQuota();
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 800);
  };

  const handleClear = () => {
    setApiKey('');
    setKeyValue('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className={`bg-white/75 dark:bg-slate-900/75 backdrop-blur-2xl backdrop-saturate-150 border border-white/60 dark:border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl shadow-slate-950/30 dark:shadow-black/50 ring-1 ring-black/5 dark:ring-white/5 flex flex-col ${
          isRtl ? 'text-right' : 'text-left'
        }`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/70 dark:border-white/10 bg-gradient-to-b from-white/60 via-white/30 to-transparent dark:from-white/[0.07] dark:to-transparent">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-sky-500/15 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                {t('settings.title')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('settings.subtitle')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-800 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSave} className="p-6 space-y-4 text-sm text-slate-700 dark:text-slate-300">
          {/* Language Selection Setting */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/80 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Languages className="w-4 h-4 text-sky-500" />
                <span className="text-xs font-semibold text-slate-900 dark:text-white">
                  {t('settings.languageHeading')}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
              {t('settings.languageDesc')}
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                  language === 'en'
                    ? 'bg-sky-50 dark:bg-sky-950/80 text-sky-700 dark:text-sky-300 border-sky-300 dark:border-sky-700 shadow-2xs'
                    : 'bg-white dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-750'
                }`}
              >
                <span>English (LTR)</span>
                {language === 'en' && <Check className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />}
              </button>
              <button
                type="button"
                onClick={() => setLanguage('he')}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                  language === 'he'
                    ? 'bg-sky-50 dark:bg-sky-950/80 text-sky-700 dark:text-sky-300 border-sky-300 dark:border-sky-700 shadow-2xs'
                    : 'bg-white dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-750'
                }`}
              >
                <span>עברית (RTL)</span>
                {language === 'he' && <Check className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />}
              </button>
            </div>
          </div>

          {/* Server status indicator */}
          <div className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700/60 text-xs">
            {serverHasKey ? (
              <>
                <CheckCircle className="w-4 h-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
                <span className="text-emerald-700 dark:text-emerald-300 font-medium">
                  {t('settings.serverKeyPresent')}
                </span>
              </>
            ) : (
              <>
                <AlertCircle className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" />
                <span className="text-amber-700 dark:text-amber-300">
                  {t('settings.noServerKey')}
                </span>
              </>
            )}
          </div>

          {/* Daily Quota / Server Mode Info Box */}
          <div className="p-3.5 bg-sky-50/70 dark:bg-sky-950/40 rounded-xl border border-sky-200/80 dark:border-sky-800/60 space-y-1.5 text-xs">
            <div className="flex items-center justify-between font-semibold text-slate-900 dark:text-white">
              <span className="flex items-center gap-1.5 text-sky-600 dark:text-sky-400">
                <Zap className="w-4 h-4" />
                <span>{t('quota.modalTitle')}</span>
              </span>
              {quota?.is_admin ? (
                <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800">
                  {t('quota.tierAdmin')}
                </span>
              ) : quota ? (
                <span className="text-[11px] font-bold text-sky-700 dark:text-sky-300 px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-900/60 border border-sky-300 dark:border-sky-700">
                  {quota.remaining_paid > 0 ? `${quota.remaining_paid}/${quota.daily_paid_limit}` : t('quota.tierFree')}
                </span>
              ) : null}
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
              {t('quota.premiumDesc')}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              {t('quota.freeDesc')}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              {t('settings.keyLabel')}
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setKeyValue(e.target.value)}
                placeholder={t('settings.keyPlaceholder')}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 pr-10 text-slate-900 dark:text-white outline-none focus:border-sky-500 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
              {t('settings.keyNote')}
            </p>
          </div>

          <div className="text-xs">
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 underline underline-offset-2"
            >
              <span>{t('settings.getFreeKey')}</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Footer buttons */}
          <div className="pt-4 flex items-center justify-between border-t border-slate-200 dark:border-slate-800">
            {apiKey ? (
              <button
                type="button"
                onClick={handleClear}
                className="text-xs text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:underline cursor-pointer"
              >
                {t('settings.clearKey')}
              </button>
            ) : <div />}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 font-medium transition-colors text-xs cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-semibold text-xs shadow-lg shadow-sky-500/25 transition-all cursor-pointer"
              >
                {savedSuccess ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>{t('settings.saved')}</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>{t('settings.saveKey')}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

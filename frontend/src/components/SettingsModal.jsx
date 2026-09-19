import React, { useState, useEffect } from 'react';
import { X, Key, CheckCircle, Eye, EyeOff, Save, ExternalLink } from 'lucide-react';
import { getApiKey, setApiKey } from '../api';
import { useLanguage } from '../context/LanguageContext';

export default function SettingsModal({
  isOpen,
  onClose,
  onRefreshQuota
}) {
  const { t, isRtl } = useLanguage();
  const [apiKey, setKeyValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setKeyValue(getApiKey());
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-200">
      <div
        className={`bg-surface-raised border border-line rounded-sheet w-full max-w-md max-h-[90vh] overflow-hidden shadow-panel flex flex-col ${
          isRtl ? 'text-right' : 'text-left'
        }`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-surface-raised">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-control bg-accent-soft text-accent border border-accent/40">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-ink">
                {t('toolbar.apiKeySettings')}
              </h3>
              <p className="text-xs text-ink-muted">
                {t('settings.subtitle')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-ink-subtle hover:text-ink p-1 rounded-control hover:bg-surface-hover transition-colors cursor-pointer"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-sm text-ink overflow-y-auto max-h-[calc(90vh-130px)]">
          {/* API Key Configuration Form */}
          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-ink mb-1.5">
                {t('settings.keyLabel')}
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setKeyValue(e.target.value)}
                  placeholder={t('settings.keyPlaceholder')}
                  dir="ltr"
                  className="w-full bg-surface-sunken border border-line rounded-control px-3 py-2.5 pr-10 text-ink outline-none focus:border-accent font-mono text-xs shadow-control"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2.5 top-2.5 text-ink-subtle hover:text-ink cursor-pointer"
                  title={showKey ? 'Hide key' : 'Show key'}
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-caption text-ink-subtle mt-1.5 leading-relaxed">
                {t('settings.keyNote')}
              </p>
            </div>

            <div className="text-xs">
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:text-accent-hover underline underline-offset-2"
              >
                <span>{t('settings.getFreeKey')}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {/* API Key Action Buttons: Clear Key & Save Key */}
            <div className="flex items-center justify-between pt-1">
              {apiKey ? (
                <button
                  type="button"
                  onClick={handleClear}
                  className="text-xs text-danger hover:underline cursor-pointer"
                >
                  {t('settings.clearKey')}
                </button>
              ) : <div />}

              <button
                type="submit"
                className="flex items-center gap-1.5 px-4 py-2 rounded-control bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-xs shadow-control transition-all cursor-pointer active:scale-95"
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
          </form>

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-line bg-surface-raised flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-control text-ink-muted hover:text-ink hover:bg-surface-hover font-medium transition-colors text-xs cursor-pointer"
          >
            {t('common.close')}
          </button>
        </div>

      </div>
    </div>
  );
}

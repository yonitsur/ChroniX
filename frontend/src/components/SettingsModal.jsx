import React, { useState, useEffect } from 'react';
import { X, Key, CheckCircle, Eye, EyeOff, Save, ExternalLink } from 'lucide-react';
import { getApiKey, setApiKey } from '../api';
import useModalAnimation from '../hooks/useModalAnimation';
import { useLanguage } from '../context/LanguageContext';

export default function SettingsModal({
  isOpen,
  onClose,
  onRefreshQuota,
}) {
  const { t, isRtl } = useLanguage();
  const [apiKey, setKeyValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const { isRendered, isVisible, handleClose, dragHandleProps } = useModalAnimation(isOpen, onClose, { duration: 250 });

  useEffect(() => {
    if (isOpen) {
      setKeyValue(getApiKey());
      const handleKeyDown = (e) => {
        if (e.key === 'Escape') handleClose();
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleClose]);

  if (!isRendered) return null;

  const handleSave = (e) => {
    e.preventDefault();
    setApiKey(apiKey);
    setSavedSuccess(true);
    if (onRefreshQuota) onRefreshQuota();
    setTimeout(() => {
      setSavedSuccess(false);
      handleClose();
    }, 800);
  };

  const handleClear = () => {
    setApiKey('');
    setKeyValue('');
  };

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
        className={`bg-surface-overlay border border-line rounded-t-3xl sm:rounded-2xl rounded-b-none sm:rounded-b-2xl w-full max-w-md max-h-[90vh] sm:max-h-[85vh] overflow-hidden shadow-glass-lg flex flex-col transition-all duration-250 ease-out pb-[max(0.75rem,env(safe-area-inset-bottom))] ${
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
            <div className="p-2 rounded-xl bg-accent-soft text-accent border border-accent/30 shadow-2xs">
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
            onClick={handleClose}
            className="text-ink-subtle hover:text-ink p-1.5 rounded-full hover:bg-surface-hover transition-colors cursor-pointer"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-sm text-ink overflow-y-auto max-h-[calc(90vh-130px)]">
          {/* Server Key Status Banner */}
          <div className="p-3 rounded-xl bg-accent-soft/50 border border-accent/30 text-xs flex items-start gap-2.5">
            <CheckCircle className="w-4 h-4 text-accent shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <p className="font-semibold text-ink mb-0.5">{t('settings.serverKeyPresent')}</p>
              <p className="text-ink-subtle">{t('settings.byokHint')}</p>
            </div>
          </div>

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
        <div className="px-6 py-3 border-t border-line bg-surface-raised flex items-center justify-end pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 sm:py-1.5 rounded-control text-ink-muted hover:text-ink hover:bg-surface-hover font-medium transition-colors text-xs cursor-pointer min-h-[36px] flex items-center justify-center"
          >
            {t('common.close')}
          </button>
        </div>

      </div>
    </div>
  );
}

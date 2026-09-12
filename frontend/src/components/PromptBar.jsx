import React, { useState, useEffect, useRef } from 'react';
import { ArrowUp, Square, ShieldCheck, Zap } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

const GROUNDING_STORAGE_KEY = 'chronix_enable_grounding_v2';
function readGroundingPref() {
  try {
    const v = localStorage.getItem(GROUNDING_STORAGE_KEY);
    if (v === null) return true;
    return v === 'true';
  } catch {
    return true;
  }
}

export default function PromptBar({
  onGenerate,
  onStop,
  isLoading,
  activePrompt = '',
}) {
  const { t, isRtl } = useLanguage();
  const [prompt, setPrompt] = useState(activePrompt);
  const [grounding, setGrounding] = useState(readGroundingPref);
  const [groundingMenuOpen, setGroundingMenuOpen] = useState(false);
  const groundingMenuRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    setPrompt(activePrompt);
    if (activePrompt && window.innerWidth >= 768) {
      inputRef.current?.focus();
    }
  }, [activePrompt]);

  useEffect(() => {
    if (!groundingMenuOpen) return;
    const handleClickOutside = (e) => {
      if (groundingMenuRef.current && !groundingMenuRef.current.contains(e.target)) {
        setGroundingMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [groundingMenuOpen]);

  const setGroundingValue = (next) => {
    setGrounding(next);
    try {
      localStorage.setItem(GROUNDING_STORAGE_KEY, String(next));
    } catch {}
    setGroundingMenuOpen(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!prompt.trim() || isLoading) return;
    onGenerate(prompt.trim(), grounding);
  };

  const isPromptRtl = prompt
    ? /[\u0590-\u05FF\u0600-\u06FF]/.test(prompt)
    : isRtl;

  return (
    <div className="w-full max-w-4xl mx-auto px-2 sm:px-4 z-20 transition-all">
      <form onSubmit={handleSubmit} className="relative group">
        <div
          className={`prompt-bar-shell relative flex items-center bg-surface-raised border border-line rounded-sheet shadow-card p-1.5 sm:p-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-ring/15 transition-all ${
            isLoading ? 'prompt-bar-shell-running' : !prompt ? 'prompt-bar-shell-idle' : ''
          }`}
        >
          <input
            ref={inputRef}
            type="text"
            dir={isPromptRtl ? 'rtl' : 'ltr'}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isLoading}
            maxLength={400}
            title={prompt || undefined}
            placeholder={t('toolbar.inputPlaceholder')}
            className={`flex-1 min-w-0 bg-transparent text-ink placeholder-ink-faint text-sm sm:text-lg px-3 sm:px-4 py-1.5 sm:py-2 outline-none font-medium ${
              isPromptRtl ? 'text-right' : 'text-left'
            }`}
          />

          {/* Verified / Fast (web-search grounding) toggle */}
          <div className="relative mx-1.5 shrink-0" ref={groundingMenuRef}>
            <button
              type="button"
              onClick={() => setGroundingMenuOpen((v) => !v)}
              disabled={isLoading}
              aria-pressed={grounding}
              aria-haspopup="menu"
              aria-expanded={groundingMenuOpen}
              title={grounding ? t('toolbar.groundingVerifiedTip') : t('toolbar.groundingFastTip')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-control border border-line bg-surface-sunken hover:bg-surface-hover text-xs font-semibold text-ink-muted hover:text-ink shrink-0 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {grounding ? (
                <ShieldCheck className="w-3.5 h-3.5 text-success shrink-0" />
              ) : (
                <Zap className="w-3.5 h-3.5 text-ink-muted shrink-0" />
              )}
              <span className="hidden sm:inline">
                {grounding ? t('toolbar.groundingToggle') : t('toolbar.groundingFast')}
              </span>
            </button>
            {groundingMenuOpen && (
              <div
                role="menu"
                className="absolute bottom-full mb-2 right-0 w-max min-w-full bg-surface-raised border border-line rounded-panel shadow-pop p-1 z-30 flex flex-col gap-0.5"
              >
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={grounding}
                  onClick={() => setGroundingValue(true)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-control transition-all whitespace-nowrap ${
                    isRtl ? 'text-right flex-row-reverse' : 'text-left'
                  } ${
                    grounding
                      ? 'bg-surface-hover text-ink font-semibold'
                      : 'text-ink-muted hover:bg-surface-hover'
                  }`}
                >
                  <ShieldCheck className={`w-3.5 h-3.5 shrink-0 ${grounding ? 'text-success' : 'text-ink-muted'}`} />
                  <span className="text-xs font-semibold">{t('toolbar.groundingToggle')}</span>
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={!grounding}
                  onClick={() => setGroundingValue(false)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-control transition-all whitespace-nowrap ${
                    isRtl ? 'text-right flex-row-reverse' : 'text-left'
                  } ${
                    !grounding
                      ? 'bg-surface-hover text-ink font-semibold'
                      : 'text-ink-muted hover:bg-surface-hover'
                  }`}
                >
                  <Zap className={`w-3.5 h-3.5 shrink-0 ${!grounding ? 'text-ink' : 'text-ink-muted'}`} />
                  <span className="text-xs font-semibold">{t('toolbar.groundingFast')}</span>
                </button>
              </div>
            )}
          </div>

          {/* Submit / Stop Button */}
          <button
            type={isLoading ? 'button' : 'submit'}
            onClick={
              isLoading
                ? (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onStop?.();
                  }
                : undefined
            }
            disabled={!isLoading && !prompt.trim()}
            className={`w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center font-medium rounded-control shadow-control transition-all active:scale-95 text-sm shrink-0 cursor-pointer ${
              isLoading
                ? 'bg-danger hover:bg-danger-hover text-danger-fg'
                : 'bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
            title={isLoading ? t('toolbar.stopGenerateBtn') : t('toolbar.generateBtn')}
            aria-label={isLoading ? t('toolbar.stopGenerateBtn') : t('toolbar.generateBtn')}
          >
            {isLoading ? (
              <Square className="w-3.5 h-3.5 fill-current shrink-0" />
            ) : (
              <ArrowUp className="w-4 h-4 shrink-0" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

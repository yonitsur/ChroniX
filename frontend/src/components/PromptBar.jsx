import React, { useState, useEffect, useRef } from 'react';
import { ArrowUp, Square } from 'lucide-react';
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
  const inputRef = useRef(null);

  useEffect(() => {
    setPrompt(activePrompt);
    if (activePrompt && window.innerWidth >= 768) {
      inputRef.current?.focus();
    }
  }, [activePrompt]);

  const setGroundingValue = (next) => {
    if (isLoading || next === grounding) return;
    setGrounding(next);
    try {
      localStorage.setItem(GROUNDING_STORAGE_KEY, String(next));
    } catch {}
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

          {/* Grounding mode toggle: Web Search / Fast */}
          <div
            role="radiogroup"
            aria-label={t('toolbar.groundingToggle')}
            dir={isRtl ? 'rtl' : 'ltr'}
            className="inline-flex items-center p-0.5 bg-surface-sunken border border-line rounded-full shrink-0 gap-0.5 select-none mx-1"
          >
            <button
              type="button"
              role="radio"
              aria-checked={grounding}
              disabled={isLoading}
              onClick={() => setGroundingValue(true)}
              title={t('toolbar.groundingVerifiedTip')}
              className={`px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-[11px] font-semibold whitespace-nowrap transition-all duration-150 cursor-pointer ${
                grounding
                  ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 shadow-sm'
                  : 'text-ink-muted hover:text-ink hover:bg-surface-hover/60'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {t('toolbar.groundingToggle')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!grounding}
              disabled={isLoading}
              onClick={() => setGroundingValue(false)}
              title={t('toolbar.groundingFastTip')}
              className={`px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-[11px] font-semibold whitespace-nowrap transition-all duration-150 cursor-pointer ${
                !grounding
                  ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 shadow-sm'
                  : 'text-ink-muted hover:text-ink hover:bg-surface-hover/60'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {t('toolbar.groundingFast')}
            </button>
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

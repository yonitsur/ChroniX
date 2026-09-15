import React, { useState, useEffect, useRef, useCallback } from 'react';
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

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const defaultMinH = isMobile ? 36 : 40;
  const [maintainedHeight, setMaintainedHeight] = useState(defaultMinH);
  const currentHeightRef = useRef(defaultMinH);

  // Auto-expand textarea height based on content
  const adjustHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el || isLoading) return;
    el.style.height = 'auto';
    const isMob = typeof window !== 'undefined' && window.innerWidth < 640;
    const minH = isMob ? 36 : 40;
    const maxH = isMob ? 110 : 140;
    const effectiveMin = Math.max(minH, maintainedHeight);
    const nextH = Math.min(Math.max(el.scrollHeight, effectiveMin), maxH);
    el.style.height = `${nextH}px`;
    currentHeightRef.current = nextH;
  }, [isLoading, maintainedHeight]);

  useEffect(() => {
    adjustHeight();
  }, [prompt, adjustHeight]);

  useEffect(() => {
    window.addEventListener('resize', adjustHeight);
    return () => window.removeEventListener('resize', adjustHeight);
  }, [adjustHeight]);

  useEffect(() => {
    setPrompt(activePrompt);
    if (!activePrompt) {
      const isMob = typeof window !== 'undefined' && window.innerWidth < 640;
      const minH = isMob ? 36 : 40;
      setMaintainedHeight(minH);
      currentHeightRef.current = minH;
    }
    if (activePrompt && window.innerWidth >= 768 && !isLoading) {
      inputRef.current?.focus();
    }
  }, [activePrompt, isLoading]);

  const setGroundingValue = (next) => {
    if (isLoading || next === grounding) return;
    setGrounding(next);
    try {
      localStorage.setItem(GROUNDING_STORAGE_KEY, String(next));
    } catch {}
  };

  const handleSubmit = (e) => {
    e?.preventDefault?.();
    if (!prompt.trim() || isLoading) return;
    const el = inputRef.current;
    const isMob = typeof window !== 'undefined' && window.innerWidth < 640;
    const minH = isMob ? 36 : 40;
    const maxH = isMob ? 110 : 140;
    const reachedHeight = el
      ? Math.min(Math.max(el.scrollHeight, minH), maxH)
      : currentHeightRef.current || minH;
    setMaintainedHeight(reachedHeight);
    currentHeightRef.current = reachedHeight;
    onGenerate(prompt.trim(), grounding);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const isPromptRtl = prompt
    ? /[\u0590-\u05FF\u0600-\u06FF]/.test(prompt)
    : isRtl;

  return (
    <div className="w-full max-w-4xl mx-auto px-2 sm:px-4 z-20 transition-all">
      <form onSubmit={handleSubmit} className="relative group">
        <div
          className={`prompt-bar-shell relative flex items-end bg-surface-raised border border-line rounded-sheet shadow-card p-1.5 sm:p-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-ring/15 transition-all ${
            isLoading ? 'prompt-bar-shell-running' : !prompt ? 'prompt-bar-shell-idle' : ''
          }`}
        >
          <textarea
            ref={inputRef}
            rows={1}
            dir={isPromptRtl ? 'rtl' : 'ltr'}
            value={prompt}
            readOnly={isLoading}
            onChange={(e) => {
              if (isLoading) return;
              const val = e.target.value;
              setPrompt(val);
              if (!val.trim()) {
                const isMob = typeof window !== 'undefined' && window.innerWidth < 640;
                const minH = isMob ? 36 : 40;
                setMaintainedHeight(minH);
                currentHeightRef.current = minH;
              }
            }}
            onKeyDown={handleKeyDown}
            maxLength={400}
            title={prompt || undefined}
            placeholder={t('toolbar.inputPlaceholder')}
            className={`flex-1 min-w-0 bg-transparent text-ink placeholder-ink-faint text-sm sm:text-lg px-3 sm:px-4 py-1.5 sm:py-2 outline-none font-medium resize-none overflow-y-auto leading-normal sm:leading-snug scrollbar-none ${
              isPromptRtl ? 'text-right' : 'text-left'
            } ${isLoading ? 'cursor-default select-text' : ''}`}
            style={{ minHeight: `${maintainedHeight}px` }}
          />

          {/* Grounding mode toggle: Web Search / Fast */}
          <div
            role="radiogroup"
            aria-label={t('toolbar.groundingToggle')}
            dir={isRtl ? 'rtl' : 'ltr'}
            className="inline-flex items-center p-0.5 bg-surface-sunken border border-line rounded-full shrink-0 gap-0.5 select-none mx-1 mb-0.5"
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
            className={`w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center font-medium rounded-control shadow-control transition-all active:scale-95 text-sm shrink-0 cursor-pointer mb-0.5 ${
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

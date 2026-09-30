import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { ArrowUp, Square, Globe, Zap } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { readGroundingPref, writeGroundingPref } from '../utils/groundingConfig';

export default function PromptBar({
  onGenerate,
  onStop,
  isLoading,
  activePrompt = '',
}) {
  const { t, isRtl } = useLanguage();
  const [prompt, setPrompt] = useState(activePrompt);
  const [prevActivePrompt, setPrevActivePrompt] = useState(activePrompt);
  const [grounding, setGrounding] = useState(readGroundingPref);
  const isCompactViewport = () => typeof window !== 'undefined' && (window.innerWidth < 640 || window.innerHeight <= 520);
  const [isMobile, setIsMobile] = useState(isCompactViewport);
  const inputRef = useRef(null);

  // Derive multi-line layout deterministically to prevent state ping-pong and infinite loops
  const isMultiLine = Boolean(
    prompt && (prompt.includes('\n') || (isMobile ? prompt.length > 25 : prompt.length > 55))
  );

  // Sync state if activePrompt prop changes (e.g. prompt guide, example prompt cards, history items, or new timeline)
  if (activePrompt !== prevActivePrompt) {
    setPrevActivePrompt(activePrompt);
    setPrompt(activePrompt);
  }

  // Auto-expand textarea height based on content
  const adjustHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const isMob = isCompactViewport();
    const minH = isMob ? 34 : 44;
    const maxH = isMob ? 175 : 220;
    const scrollH = el.scrollHeight;
    const nextH = Math.min(Math.max(scrollH, minH), maxH);
    el.style.height = `${nextH}px`;
  }, []);

  useLayoutEffect(() => {
    adjustHeight();
  }, [prompt, isMultiLine, adjustHeight]);

  useEffect(() => {
    const id = requestAnimationFrame(adjustHeight);
    return () => cancelAnimationFrame(id);
  }, [prompt, isMultiLine, adjustHeight]);

  useEffect(() => {
    const handleResize = () => {
      const mob = isCompactViewport();
      setIsMobile((prev) => (prev !== mob ? mob : prev));
      adjustHeight();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [adjustHeight]);

  useEffect(() => {
    if (activePrompt && window.innerWidth >= 768 && !isLoading) {
      inputRef.current?.focus();
    }
  }, [activePrompt, isLoading]);

  const setGroundingValue = (next) => {
    if (isLoading || next === grounding) return;
    setGrounding(next);
    writeGroundingPref(next);
  };

  const toggleGrounding = () => {
    if (isLoading) return;
    setGroundingValue(!grounding);
  };

  const handleSubmit = (e) => {
    e?.preventDefault?.();
    if (!prompt.trim() || isLoading) return;
    onGenerate(prompt.trim(), grounding);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    } else if (e.key === 'Escape' && prompt) {
      e.preventDefault();
      setPrompt('');
    }
  };

  const isPromptRtl = prompt
    ? /[\u0590-\u05FF\u0600-\u06FF]/.test(prompt)
    : isRtl;

  const minH = isMobile ? 38 : 44;

  return (
    <div className="w-full max-w-3xl mx-auto px-2 sm:px-4 z-20 transition-all">
      <form data-home-prompt onSubmit={handleSubmit} className="relative group w-full">
        {/* Floating island dock container: sleek card with consistent rounded corners across single-line and multi-line on mobile */}
        <div
          dir={isRtl ? 'rtl' : 'ltr'}
          className={`prompt-dock-shell relative transition-all duration-200 ${
            isMultiLine
              ? 'flex flex-col rounded-2xl sm:rounded-3xl p-2.5 sm:p-3.5 gap-2'
              : 'flex items-center rounded-2xl p-1.5 sm:p-2 gap-1.5 sm:gap-2'
          } ${
            isLoading ? 'prompt-bar-shell-running' : !prompt ? 'prompt-bar-shell-idle' : ''
          }`}
        >
          {/* Textarea: responsive expandable text input (full width when multiline) */}
          <textarea
            ref={inputRef}
            rows={1}
            dir={isPromptRtl ? 'rtl' : 'ltr'}
            value={prompt}
            readOnly={isLoading}
            onChange={(e) => {
              if (isLoading) return;
              setPrompt(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            maxLength={400}
            title={prompt || undefined}
            placeholder={t('toolbar.inputPlaceholder')}
            className={`${
              isMultiLine
                ? 'w-full px-2.5 sm:px-3.5 pt-1 sm:pt-1.5 pb-1'
                : 'flex-1 min-w-0 px-3 sm:px-4 py-1.5 sm:py-2'
            } bg-transparent text-ink placeholder:text-ink-subtle text-[14.5px] sm:text-base md:text-[17px] outline-none font-normal tracking-normal resize-none overflow-y-auto leading-relaxed scrollbar-none transition-colors prompt-bar-input ${
              isPromptRtl ? 'text-right' : 'text-left'
            } ${isLoading ? 'cursor-default select-text' : ''}`}
            style={{ minHeight: `${minH}px` }}
          />

          {/* Action buttons: dedicated bottom row when multi-line, inline row when single-line */}
          <div
            className={
              isMultiLine
                ? 'w-full flex items-center justify-between pt-1.5 px-1 sm:px-1.5 border-t border-line/60'
                : 'shrink-0 flex items-center gap-1.5 sm:gap-2 self-center'
            }
          >
            {/* Grounding mode toggle: Mobile Smart Chip + Desktop Segmented Capsule */}
            <div
              id="guide-home-grounding"
              data-guide="home-grounding"
              dir={isRtl ? 'rtl' : 'ltr'}
              className="shrink-0 select-none flex items-center"
            >
              {/* Mobile: Ultra-sleek Smart Chip (Toggles on tap, saving ~100px for generous text width) */}
              <button
                type="button"
                onClick={toggleGrounding}
                disabled={isLoading}
                title={grounding ? t('toolbar.groundingVerifiedTip') : t('toolbar.groundingFastTip')}
                aria-label={t('toolbar.groundingToggle')}
                className={`sm:hidden inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-caption font-medium transition-all duration-200 cursor-pointer active:scale-95 border ${
                  grounding
                    ? 'bg-surface-active border-line-strong text-ink font-semibold'
                    : 'bg-surface-sunken/90 border-line/70 text-ink-muted hover:text-ink hover:bg-surface-hover/80'
                } disabled:opacity-50 disabled:cursor-default`}
              >
                {grounding ? (
                  <>
                    <Globe className="w-3.5 h-3.5 shrink-0" />
                    <span className="whitespace-nowrap">{t('toolbar.groundingToggle')}</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5 shrink-0" />
                    <span className="whitespace-nowrap">{t('toolbar.groundingFast')}</span>
                  </>
                )}
              </button>

              {/* Desktop: Full Linear/Perplexity Segmented Capsule */}
              <div
                role="radiogroup"
                aria-label={t('toolbar.groundingToggle')}
                className="seg-track hidden sm:inline-flex items-center p-0.5 rounded-full gap-0.5"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={grounding}
                  disabled={isLoading}
                  onClick={() => setGroundingValue(true)}
                  title={t('toolbar.groundingVerifiedTip')}
                  className={`seg-item inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-caption sm:text-xs font-medium whitespace-nowrap cursor-pointer ${
                    grounding ? 'seg-item-active' : ''
                  } disabled:opacity-50 disabled:cursor-default`}
                >
                  <Globe className="w-3.5 h-3.5 shrink-0" />
                  <span>{t('toolbar.groundingToggle')}</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!grounding}
                  disabled={isLoading}
                  onClick={() => setGroundingValue(false)}
                  title={t('toolbar.groundingFastTip')}
                  className={`seg-item inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-caption sm:text-xs font-medium whitespace-nowrap cursor-pointer ${
                    !grounding ? 'seg-item-active' : ''
                  } disabled:opacity-50 disabled:cursor-default`}
                >
                  <Zap className="w-3.5 h-3.5 shrink-0" />
                  <span>{t('toolbar.groundingFast')}</span>
                </button>
              </div>
            </div>

            {/* Submit / Stop Action Button */}
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
              className={`w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center font-medium rounded-full transition-[background-color,color,transform,opacity] duration-150 shrink-0 active:scale-95 ${
                isLoading
                  ? 'bg-danger hover:bg-danger-hover text-danger-fg shadow-control cursor-pointer'
                  : prompt.trim()
                  ? 'bg-accent hover:bg-accent-hover text-accent-fg shadow-control cursor-pointer'
                  : 'bg-surface-hover text-ink-faint cursor-default'
              }`}
              title={isLoading ? t('toolbar.stopGenerateBtn') : t('toolbar.generateBtn')}
              aria-label={isLoading ? t('toolbar.stopGenerateBtn') : t('toolbar.generateBtn')}
            >
              {isLoading ? (
                <Square className="w-3.5 h-3.5 fill-current shrink-0" />
              ) : (
                <ArrowUp className="w-4 h-4 sm:w-4.5 sm:h-4.5 shrink-0" strokeWidth={2.2} />
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

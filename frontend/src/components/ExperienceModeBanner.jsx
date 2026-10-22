import React, { useState } from 'react';
import { Compass, Check, X } from './icons/ThemeIcons';
import { useLanguage } from '../context/LanguageContext';

function ToyRocketBadgeIcon({ className = 'w-5 h-5' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Left & right colorful toy fins */}
      <path
        d="M6.5 14.5 3.5 17.5l1.2 3 3.3-1.5"
        fill="#fb7185"
        stroke="#0f172a"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <path
        d="M17.5 14.5 20.5 17.5l-1.2 3-3.3-1.5"
        fill="#fb7185"
        stroke="#0f172a"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      {/* Exhaust flame */}
      <path
        d="M9.5 19h5l-2.5 3.5L9.5 19Z"
        fill="#facc15"
        stroke="#0f172a"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* Rocket body */}
      <path
        d="M12 2.5c3.8 2.8 5.5 6.8 5.5 11.5 0 2-.5 3.7-1.2 5H7.7c-.7-1.3-1.2-3-1.2-5 0-4.7 1.7-8.7 5.5-11.5Z"
        fill="#38bdf8"
        stroke="#0f172a"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Nose cone */}
      <path
        d="M12 2.5c1.9 1.4 3.2 3.1 4 5.2H8c.8-2.1 2.1-3.8 4-5.2Z"
        fill="#fbbf24"
        stroke="#0f172a"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      {/* Porthole window */}
      <circle
        cx="12"
        cy="12"
        r="2.4"
        fill="#fef9c3"
        stroke="#0f172a"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export default function ExperienceModeBanner({
  visualTheme = 'classic',
  onChangeVisualTheme,
}) {
  const { t, isRtl, hasChosenMode, markModeChosen, setContentMode } = useLanguage();
  const [isClosing, setIsClosing] = useState(false);
  const [pickedMode, setPickedMode] = useState(null);

  if (hasChosenMode && !isClosing) return null;

  const activeMode = pickedMode || (visualTheme === 'toy' ? 'toy' : 'classic');

  const handlePick = (mode) => {
    setPickedMode(mode);
    if (setContentMode) setContentMode(mode === 'toy' ? 'kids' : 'classic');
    else onChangeVisualTheme?.(mode);
    try {
      window.dispatchEvent(new CustomEvent('chronix:highlight-mode-toggle'));
    } catch (e) {}
    setIsClosing(true);
    setTimeout(() => {
      markModeChosen();
      setIsClosing(false);
    }, 320);
  };

  const handleDismiss = () => {
    try {
      window.dispatchEvent(new CustomEvent('chronix:highlight-mode-toggle'));
    } catch (e) {}
    setIsClosing(true);
    setTimeout(() => {
      markModeChosen();
      setIsClosing(false);
    }, 220);
  };

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className={`w-full max-w-xl mx-auto mt-3 sm:mt-4 mb-1 px-2 sm:px-0 transition-all duration-300 ${
        isClosing
          ? 'opacity-0 scale-95 -translate-y-1 pointer-events-none'
          : 'opacity-100 scale-100 translate-y-0 animate-in fade-in slide-in-from-top-2 duration-300'
      }`}
    >
      <div className="floating-dock-glass relative rounded-2xl p-3 sm:p-3.5 border border-line shadow-pop bg-surface-raised/90 backdrop-blur-md text-start">
        {/* Header Row */}
        <div className="flex items-start justify-between gap-2 mb-2.5 px-0.5">
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-ink leading-snug">
              {t('home.modePicker.title')}
            </h3>
            <p className="text-[11px] sm:text-xs text-ink-muted leading-tight mt-0.5">
              {t('home.modePicker.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            title={t('common.close')}
            aria-label={t('common.close')}
            className="p-1 rounded-full text-ink-subtle hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 2 Experience Cards: Classic vs Kids */}
        <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
          {/* Classic Mode Card */}
          <button
            type="button"
            onClick={() => handlePick('classic')}
            className={`group relative text-start p-2.5 sm:p-3 rounded-xl border transition-all duration-150 cursor-pointer flex flex-col justify-between gap-1.5 active:scale-[0.98] ${
              activeMode === 'classic'
                ? 'bg-accent-soft/90 border-accent text-ink shadow-xs'
                : 'bg-surface/80 hover:bg-surface-hover border-line hover:border-line-strong text-ink-muted hover:text-ink'
            }`}
          >
            <div className="flex items-center justify-between w-full gap-1.5">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-surface-raised border border-line flex items-center justify-center text-ink shrink-0 shadow-2xs">
                <Compass className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
              </div>
              <span
                className={`w-4 h-4 rounded-full flex items-center justify-center border transition-colors shrink-0 ${
                  activeMode === 'classic'
                    ? 'bg-accent border-accent text-accent-fg'
                    : 'border-line-strong bg-transparent text-transparent group-hover:border-ink-muted'
                }`}
              >
                <Check className="w-2.5 h-2.5 stroke-[2.5]" />
              </span>
            </div>
            <div>
              <div className="text-xs sm:text-[13px] font-bold text-ink leading-tight">
                {t('home.modePicker.classicTitle')}
              </div>
              <div className="text-[11px] text-ink-muted leading-snug mt-0.5 line-clamp-2">
                {t('home.modePicker.classicDesc')}
              </div>
            </div>
          </button>

          {/* Kids Mode Card */}
          <button
            type="button"
            onClick={() => handlePick('toy')}
            className={`group relative text-start p-2.5 sm:p-3 rounded-xl border transition-all duration-150 cursor-pointer flex flex-col justify-between gap-1.5 active:scale-[0.98] ${
              activeMode === 'toy'
                ? 'bg-amber-400/20 dark:bg-amber-400/15 border-amber-500 text-ink shadow-xs'
                : 'bg-surface/80 hover:bg-amber-400/10 border-line hover:border-amber-400/70 text-ink-muted hover:text-ink'
            }`}
          >
            <div className="flex items-center justify-between w-full gap-1.5">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-amber-300/90 dark:bg-amber-400/90 border border-slate-900/80 flex items-center justify-center shrink-0 shadow-2xs">
                <ToyRocketBadgeIcon className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <span
                className={`w-4 h-4 rounded-full flex items-center justify-center border transition-colors shrink-0 ${
                  activeMode === 'toy'
                    ? 'bg-amber-400 border-slate-900 text-slate-950'
                    : 'border-line-strong bg-transparent text-transparent group-hover:border-amber-500'
                }`}
              >
                <Check className="w-2.5 h-2.5 stroke-[2.5]" />
              </span>
            </div>
            <div>
              <div className="text-xs sm:text-[13px] font-bold text-ink leading-tight">
                {t('home.modePicker.kidsTitle')}
              </div>
              <div className="text-[11px] text-ink-muted leading-snug mt-0.5 line-clamp-2">
                {t('home.modePicker.kidsDesc')}
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

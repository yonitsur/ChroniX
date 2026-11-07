import React from 'react';
import { ChevronLeft, ChevronRight } from './icons/ThemeIcons';
import { useLanguage } from '../context/LanguageContext';

// Inline sizes so host panels' own svg rules (e.g. the games panel) can't restyle the control.
const ICON_16 = { width: 16, height: 16 };
const ICON_14 = { width: 14, height: 14 };

// Back control shared by every left-side panel (bottom sheet on mobile). It appears only after
// drilling into a section (the dock's sections are siblings and start a fresh trail) and names
// its destination ("‹ Cards List") so it's clear where it leads. There is no in-panel Forward
// button; the browser / system Forward still works through the panel history.
//   nav = { back: { label, Icon } | null, onBack }
export default function PanelNavButtons({ nav, className = '' }) {
  const { t, isRtl } = useLanguage();
  if (!nav?.back) return null;
  const { back, onBack } = nav;
  const BackChevron = isRtl ? ChevronRight : ChevronLeft;
  const BackIcon = back.Icon;
  const backTitle = t('panelNav.backTo', { label: back.label });

  return (
    <div
      role="group"
      aria-label={t('panelNav.group')}
      data-panel-nav=""
      className={`flex items-center min-w-0 shrink-0 ${className}`}
    >
      <button
        type="button"
        onClick={onBack}
        title={backTitle}
        aria-label={backTitle}
        className="group/back inline-flex items-center gap-1 min-w-0 max-w-[12rem] h-10 md:h-9 ps-2 pe-3 rounded-full border border-line bg-surface-raised text-sm font-medium text-ink shadow-control hover:bg-surface-hover hover:border-line-strong transition-colors duration-150 cursor-pointer motion-safe:active:scale-95 touch-manipulation"
      >
        <BackChevron style={ICON_16} className="shrink-0 text-ink-subtle group-hover/back:text-ink transition-colors" aria-hidden="true" />
        {BackIcon && <BackIcon style={ICON_14} className="shrink-0 text-ink-muted" aria-hidden="true" />}
        <span className="truncate" dir="auto">{back.label}</span>
      </button>
    </div>
  );
}

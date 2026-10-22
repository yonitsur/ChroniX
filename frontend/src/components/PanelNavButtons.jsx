import React from 'react';
import { ChevronLeft, ChevronRight } from './icons/ThemeIcons';
import { useLanguage } from '../context/LanguageContext';

// Inline sizes so host panels' own svg rules (e.g. the games panel) can't restyle the control.
const ICON_16 = { width: 16, height: 16 };
const ICON_14 = { width: 14, height: 14 };

// Back/Forward controls shared by every left-side panel (bottom sheet on mobile). Back names
// its destination ("‹ Games Hub") so it's clear where it leads; Forward only appears after
// stepping back. `nav` is null when the panel has no history to move through.
//   nav = { back: { label, Icon } | null, forward: { label, Icon } | null, onBack, onForward }
export default function PanelNavButtons({ nav, className = '' }) {
  const { t, isRtl } = useLanguage();
  if (!nav || (!nav.back && !nav.forward)) return null;
  const { back, forward, onBack, onForward } = nav;
  const BackChevron = isRtl ? ChevronRight : ChevronLeft;
  const ForwardChevron = isRtl ? ChevronLeft : ChevronRight;
  const BackIcon = back?.Icon;
  const backTitle = back ? t('panelNav.backTo', { label: back.label }) : t('panelNav.back');
  const forwardTitle = forward ? t('panelNav.forwardTo', { label: forward.label }) : t('panelNav.forward');

  return (
    <div
      role="group"
      aria-label={t('panelNav.group')}
      data-panel-nav=""
      className={`flex items-center gap-1 min-w-0 shrink ${className}`}
    >
      <button
        type="button"
        onClick={onBack}
        disabled={!back}
        title={backTitle}
        aria-label={backTitle}
        className={`group/back inline-flex items-center gap-1 min-w-0 h-9 md:h-8 rounded-full border text-xs font-semibold transition-colors touch-manipulation ${
          back
            ? 'max-w-[12rem] ps-1.5 pe-3 border-line bg-surface-raised text-ink shadow-control hover:bg-surface-hover hover:border-line-strong cursor-pointer active:scale-95'
            : 'w-9 md:w-8 justify-center border-transparent text-ink-faint cursor-default'
        }`}
      >
        <BackChevron style={ICON_16} className="shrink-0 text-ink-subtle group-hover/back:text-ink transition-colors" aria-hidden="true" />
        {back && (
          <>
            {BackIcon && <BackIcon style={ICON_14} className="shrink-0 text-accent" aria-hidden="true" />}
            <span className="truncate" dir="auto">{back.label}</span>
          </>
        )}
      </button>
      {forward && (
        <button
          type="button"
          onClick={onForward}
          title={forwardTitle}
          aria-label={forwardTitle}
          className="inline-flex items-center justify-center shrink-0 w-9 h-9 md:w-8 md:h-8 rounded-full border border-line bg-surface-raised text-ink-subtle shadow-control hover:bg-surface-hover hover:text-ink hover:border-line-strong transition-colors cursor-pointer active:scale-95 touch-manipulation"
        >
          <ForwardChevron style={ICON_16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

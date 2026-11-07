import React, { useEffect, useState } from 'react';
import { GripVertical, Headphones, Loader2, Maximize2, Play, Square, X } from '../icons/ThemeIcons';

export default function PodcastFloatingPills({
  t,
  isRtl,
  isMobile,
  showStarterPill,
  showPill,
  showMobileIdleNotices,
  generationStatus,
  approxMinutes,
  notices,
  onDismissNotice,
  onOpenStudio,
  onClose,
  onStopGeneration,
  onExpandGeneration,
  drag,
  containerStyle,
  pillContainerClass,
}) {
  const [isCapsuleHovered, setIsCapsuleHovered] = useState(false);
  const [isCapsuleFocused, setIsCapsuleFocused] = useState(false);

  useEffect(() => {
    setIsCapsuleHovered(false);
    setIsCapsuleFocused(false);
  }, [showStarterPill, showPill]);

  const showDesktopDetails = !isMobile && (isCapsuleHovered || isCapsuleFocused) && !drag.isDragging;

  const noticeStack = notices.length > 0 && (
    <div className="flex flex-col items-center gap-2 pointer-events-auto" aria-live="polite">
      {notices.map((n) => (
        <div
          key={n.id}
          role={n.tone === 'error' ? 'alert' : 'status'}
          className={`px-4 py-2 rounded-full bg-surface-raised/95 border text-caption font-medium shadow-card flex items-center gap-2 ${
            n.tone === 'error'
              ? 'border-danger/40 text-danger'
              : n.tone === 'success'
                ? 'border-emerald-500/40 text-emerald-500'
                : 'border-amber-500/40 text-amber-500'
          }`}
        >
          <span>{n.text}</span>
          <button
            type="button"
            onClick={() => onDismissNotice(n.id)}
            className="ms-1 hover:text-ink cursor-pointer"
            aria-label={t('common.close')}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );

  if (showMobileIdleNotices) {
    return (
      <div
        style={containerStyle}
        dir={isRtl ? 'rtl' : 'ltr'}
        className={pillContainerClass}
      >
        {noticeStack}
      </div>
    );
  }

  if (showStarterPill) {
    return (
      <div
        ref={drag.containerRef}
        style={containerStyle}
        dir={isRtl ? 'rtl' : 'ltr'}
        className={pillContainerClass}
      >
        {noticeStack}
        <div
          data-testid="podcast-capsule"
          dir="ltr"
          {...drag.dragHandlers}
          onMouseEnter={() => setIsCapsuleHovered(true)}
          onMouseLeave={() => setIsCapsuleHovered(false)}
          onFocusCapture={(e) => {
            if (e.target?.matches?.(':focus-visible')) setIsCapsuleFocused(true);
          }}
          onBlurCapture={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setIsCapsuleFocused(false);
          }}
          className={`chronix-podcast-capsule group/podcast-capsule order-last pointer-events-auto flex flex-row-reverse items-center h-12 p-1.5 rounded-full bg-surface-raised/95 backdrop-blur-2xl border max-w-full touch-none transition-[border-color,box-shadow] duration-200 ${
            drag.isDragging
              ? 'cursor-grabbing border-line-strong ring-2 ring-accent/40 shadow-panel'
              : 'cursor-grab border-line hover:border-line-strong shadow-pop'
          }`}
        >
          {/* Stationary right anchor: Grip + Headphones + Play/Listen */}
          <div className="flex flex-row-reverse items-center gap-1 shrink-0 select-none">
            <span
              className="px-1 text-ink-subtle hover:text-ink flex items-center shrink-0"
              title={t('podcast.dragHint')}
            >
              <GripVertical className="w-3.5 h-3.5 opacity-60 group-hover/podcast-capsule:opacity-100 transition-opacity pointer-events-none" />
            </span>

            <button
              type="button"
              onClick={onOpenStudio}
              className="w-8 h-8 rounded-full bg-accent/15 hover:bg-accent/25 text-accent flex items-center justify-center shrink-0 transition-colors cursor-pointer"
              title={t('podcast.starterTitle')}
              aria-label={t('podcast.dockLabel')}
            >
              <Headphones className="w-4 h-4 shrink-0" />
            </button>

            <button
              type="button"
              onClick={onOpenStudio}
              className="w-8 h-8 rounded-full bg-accent hover:bg-accent-hover text-accent-fg flex items-center justify-center shadow-card transition-transform active:scale-95 cursor-pointer shrink-0"
              title={t('podcast.listenNow')}
              aria-label={t('podcast.starterListen')}
            >
              <Play className="w-3.5 h-3.5 fill-current ms-0.5" />
            </button>
          </div>

          {/* Hover-expandable info & secondary actions (grows inward to the left) */}
          <div
            data-podcast-expandable
            inert={!showDesktopDetails}
            className={`flex items-center min-w-0 overflow-hidden ease-out ${
              drag.isDragging ? '' : 'transition-all duration-300'
            } ${
              showDesktopDetails
                ? 'max-w-[26rem] opacity-100 visible pointer-events-auto'
                : 'max-w-0 opacity-0 invisible pointer-events-none'
            }`}
          >
            <div className="flex items-center gap-0.5 ps-1 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-ink-subtle hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer shrink-0"
                title={t('podcast.close')}
                aria-label={t('podcast.close')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onOpenStudio}
                className="p-1.5 rounded-lg text-ink-subtle hover:text-accent hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
                title={t('podcast.expandPlayer')}
                aria-label={t('podcast.expandPlayer')}
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              type="button"
              dir={isRtl ? 'rtl' : 'ltr'}
              onClick={onOpenStudio}
              className="flex flex-col text-start px-2 mx-1 border-s border-line/70 min-w-0 max-w-[210px] hover:bg-surface-hover/50 rounded-lg py-0.5 transition-colors cursor-pointer"
              title={t('podcast.expandPlayer')}
            >
              <span className="text-caption font-bold text-ink truncate">
                {t('podcast.starterTitle')}
              </span>
              <span className="text-[11px] leading-tight text-ink-muted truncate">
                {t('podcast.starterSubtitle', { minutes: approxMinutes })}
              </span>
            </button>

            <div className="w-px h-5 bg-line-strong/70 mx-1.5 shrink-0" />
          </div>
        </div>
      </div>
    );
  }

  if (showPill) {
    const stepLabel = generationStatus === 'audio' ? t('podcast.stepAudio') : t('podcast.stepScript');

    if (isMobile) {
      return (
        <div
          ref={drag.containerRef}
          style={containerStyle}
          dir={isRtl ? 'rtl' : 'ltr'}
          className={pillContainerClass}
        >
          {noticeStack}
          <div
            {...drag.dragHandlers}
            className={`order-last pointer-events-auto flex items-center justify-between w-fit max-w-[calc(100vw-20px)] gap-2 px-3 py-1.5 rounded-full bg-surface-raised/95 backdrop-blur-2xl border border-accent/40 shadow-pop overflow-hidden touch-none ${
              drag.isDragging ? 'cursor-grabbing ring-2 ring-accent/40' : ''
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Loader2 className="w-4 h-4 text-accent animate-spin shrink-0" />
              <span className="text-xs font-bold text-ink truncate" aria-live="polite">
                {stepLabel}
              </span>
            </div>
            <button
              type="button"
              onClick={onStopGeneration}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-danger/15 hover:bg-danger/25 border border-danger/40 text-danger text-caption font-bold cursor-pointer shrink-0"
            >
              <Square className="w-3 h-3 fill-current" />
              {t('podcast.stop')}
            </button>
            <button
              type="button"
              onClick={onExpandGeneration}
              className="p-1.5 rounded-full text-ink-subtle hover:text-accent hover:bg-surface-hover cursor-pointer shrink-0"
              title={t('podcast.expand')}
              aria-label={t('podcast.expand')}
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        ref={drag.containerRef}
        style={containerStyle}
        dir={isRtl ? 'rtl' : 'ltr'}
        className={pillContainerClass}
      >
        <span className="sr-only" aria-live="polite">{stepLabel}</span>
        {noticeStack}
        <div
          data-testid="podcast-capsule"
          dir="ltr"
          {...drag.dragHandlers}
          onMouseEnter={() => setIsCapsuleHovered(true)}
          onMouseLeave={() => setIsCapsuleHovered(false)}
          onFocusCapture={(e) => {
            if (e.target?.matches?.(':focus-visible')) setIsCapsuleFocused(true);
          }}
          onBlurCapture={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setIsCapsuleFocused(false);
          }}
          className={`chronix-podcast-capsule group/podcast-capsule order-last pointer-events-auto flex flex-row-reverse items-center h-12 p-1.5 rounded-full bg-surface-raised/95 backdrop-blur-2xl border border-accent/40 max-w-full touch-none transition-[border-color,box-shadow] duration-200 ${
            drag.isDragging
              ? 'cursor-grabbing ring-2 ring-accent/40 shadow-panel'
              : 'cursor-grab hover:border-accent shadow-pop'
          }`}
        >
          {/* Stationary right anchor: Grip + Headphones + Active Spinner */}
          <div className="flex flex-row-reverse items-center gap-1 shrink-0 select-none">
            <span
              className="px-1 text-ink-subtle hover:text-ink flex items-center shrink-0"
              title={t('podcast.dragHint')}
            >
              <GripVertical className="w-3.5 h-3.5 opacity-60 group-hover/podcast-capsule:opacity-100 transition-opacity pointer-events-none" />
            </span>
            <button
              type="button"
              onClick={onExpandGeneration}
              className="w-8 h-8 rounded-full bg-accent/15 hover:bg-accent/25 text-accent flex items-center justify-center shrink-0 transition-colors cursor-pointer"
              title={t('podcast.expand')}
              aria-label={t('podcast.dockLabel')}
            >
              <Headphones className="w-4 h-4 shrink-0" />
            </button>
            <span
              className="w-8 h-8 rounded-full bg-accent/20 text-accent flex items-center justify-center shrink-0 pointer-events-none"
              title={stepLabel}
            >
              <Loader2 className="w-4 h-4 animate-spin" />
            </span>
          </div>

          {/* Hover-expandable status & Stop button */}
          <div
            data-podcast-expandable
            inert={!showDesktopDetails}
            className={`flex items-center min-w-0 overflow-hidden ease-out ${
              drag.isDragging ? '' : 'transition-all duration-300'
            } ${
              showDesktopDetails
                ? 'max-w-[24rem] opacity-100 visible pointer-events-auto'
                : 'max-w-0 opacity-0 invisible pointer-events-none'
            }`}
          >
            <div className="flex items-center gap-1 ps-1 shrink-0">
              <button
                type="button"
                onClick={onExpandGeneration}
                className="p-1.5 rounded-full text-ink-subtle hover:text-accent hover:bg-surface-hover cursor-pointer shrink-0"
                title={t('podcast.expand')}
                aria-label={t('podcast.expand')}
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onStopGeneration}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-danger/15 hover:bg-danger/25 border border-danger/40 text-danger text-caption font-bold cursor-pointer shrink-0"
              >
                <Square className="w-3 h-3 fill-current" />
                {t('podcast.stop')}
              </button>
            </div>

            <span
              dir={isRtl ? 'rtl' : 'ltr'}
              className="text-xs font-bold text-ink truncate px-2 max-w-[180px]"
            >
              {stepLabel}
            </span>

            <div className="w-px h-5 bg-line-strong/70 mx-1.5 shrink-0" />
          </div>
        </div>
      </div>
    );
  }

  return null;
}

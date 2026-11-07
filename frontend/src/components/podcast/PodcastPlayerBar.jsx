import React, { useEffect, useState } from 'react';
import {
  Bell,
  BellOff,
  Clock,
  Compass,
  Download,
  FileText,
  Globe,
  GripVertical,
  Headphones,
  Link2,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Music,
  Pause,
  Play,
  Settings,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume1,
  Volume2,
  VolumeX,
  X,
  Zap,
} from '../icons/ThemeIcons';
import { formatTimeSec, genderSwitchNeedsPremiumUnlock } from '../../utils/podcastPlayback';
import { FLOATING_Z } from '../../utils/floatingFocus';
import PodcastTranscript from './PodcastTranscript';
import PodcastMusicPanel from './PodcastMusicPanel';
import { ALL_ENGINES, engineLabelKey } from './PodcastStudioDialog';
import { formatAiModelName, formatPodcastCostBreakdown } from '../../utils/modelUtils';

const ENGINE_ICONS = { edge: Zap, gcloud: Globe, gemini: Sparkles };

function IconButton({ onClick, title, disabled, className = '', children, pressed }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      className={`p-2 rounded-lg text-ink-subtle hover:text-ink hover:bg-surface-hover disabled:opacity-35 transition-colors cursor-pointer ${className}`}
    >
      {children}
    </button>
  );
}

function PlayPauseButton({ playback, t, size = 'md' }) {
  const dims = size === 'sm' ? 'w-8 h-8' : 'w-10 h-10';
  const icon = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const isActiveOrLoading = playback.isPlaying || playback.isBuffering;
  return (
    <button
      type="button"
      onClick={playback.toggle}
      className={`${dims} rounded-full bg-accent hover:bg-accent-hover text-accent-fg flex items-center justify-center shadow-card transition-transform active:scale-95 cursor-pointer shrink-0 ${
        playback.needsGesture ? 'ring-4 ring-accent/30 animate-pulse' : ''
      }`}
      title={isActiveOrLoading ? t('podcast.pause') : t('podcast.play')}
      aria-label={isActiveOrLoading ? t('podcast.pause') : t('podcast.play')}
    >
      {playback.isBuffering ? (
        <Loader2 className={`${icon} animate-spin`} />
      ) : playback.isPlaying ? (
        <Pause className={`${icon} fill-current`} />
      ) : (
        <Play className={`${icon} fill-current ms-0.5`} />
      )}
    </button>
  );
}

function VolumeIcon({ volume, muted }) {
  const v = muted ? 0 : volume;
  if (v === 0) return <VolumeX className="w-3.5 h-3.5 text-danger" />;
  if (v < 0.5) return <Volume1 className="w-3.5 h-3.5 text-accent" />;
  return <Volume2 className="w-3.5 h-3.5 text-accent" />;
}

export default function PodcastPlayerBar({
  t,
  isRtl,
  isMobile,
  episode,
  playback,
  engine,
  engines,
  onSwitchEngine,
  voiceGender = 'male',
  hostNames,
  onSwitchGender,
  isAutoFollow,
  onToggleAutoFollow,
  activeArticle,
  articlesMap,
  getSpeakerName,
  isMinimized,
  onMinimize,
  onExpand,
  transcriptOpen,
  onToggleTranscript,
  onOpenStudio,
  onClose,
  onDownload,
  isDownloading,
  onShare,
  notices,
  onDismissNotice,
  chimeEnabled,
  onToggleChime,
  music,
  drag,
  baseContainerStyle = null,
  desktopAvailableWidthCss = 'calc(100vw - 140px)',
}) {
  const [isCapsuleHovered, setIsCapsuleHovered] = useState(false);
  const [isCapsuleFocused, setIsCapsuleFocused] = useState(false);
  useEffect(() => {
    if (!isMinimized) {
      setIsCapsuleHovered(false);
      setIsCapsuleFocused(false);
    }
  }, [isMinimized, episode?.id]);

  const segments = episode.segments || [];
  const { index, segment, metrics, cue } = playback;
  const volumePercent = Math.round((playback.muted ? 0 : playback.volume) * 100);
  const availableEngines = ALL_ENGINES;
  const subtitleText = cue.sentence?.text || segment?.turns?.[cue.turnIndex]?.text || '';
  const subtitleSpeaker = segment?.turns?.[cue.sentence?.turn ?? cue.turnIndex]?.speaker;

  const containerStyle = {
    zIndex: isMobile ? FLOATING_Z.PODCAST_MOBILE : FLOATING_Z.PODCAST,
    bottom: isMobile ? 'calc(102px + env(safe-area-inset-bottom, 0px))' : '54px',
    transform: `translate3d(${drag.offset.x}px, ${drag.offset.y}px, 0)`,
  };

  const noticeStack = notices.length > 0 && (
    <div className="flex flex-col items-center gap-2 pointer-events-auto" aria-live="polite">
      {notices.map((n) => (
        <div
          key={n.id}
          role={n.tone === 'error' ? 'alert' : 'status'}
          className={`px-4 py-2 rounded-full bg-surface-raised/95 border text-caption font-medium shadow-card flex items-center gap-2 ${
            n.tone === 'error' ? 'border-danger/40 text-danger' : n.tone === 'success' ? 'border-emerald-500/40 text-emerald-500' : 'border-amber-500/40 text-amber-500'
          }`}
        >
          <span>{n.text}</span>
          {n.action && (
            <button type="button" onClick={n.action.onClick} className="font-bold underline hover:text-ink cursor-pointer">
              {n.action.label}
            </button>
          )}
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

  const srAnnouncement = (
    <span className="sr-only" aria-live="polite">
      {segment ? t('podcast.nowPlaying', { title: segment.chapter_title }) : ''}
    </span>
  );
  const costBreakdownText = formatPodcastCostBreakdown(episode, t, engine);
  const desktopCrossEnd = isRtl ? 'items-start' : 'items-end';
  const effectiveBaseStyle = baseContainerStyle || {
    ...containerStyle,
    ...(isMobile ? {} : { right: 'calc(max(16px, calc(12px + env(safe-area-inset-right, 0px))) + 60px)', left: 'auto' }),
  };
  const resolvedContainerStyle = isMobile
    ? effectiveBaseStyle
    : {
        ...effectiveBaseStyle,
        maxWidth: isMinimized
          ? `min(42rem, ${desktopAvailableWidthCss})`
          : `min(46rem, ${desktopAvailableWidthCss})`,
      };
  const minimizedContainerClass = isMobile
    ? 'fixed inset-x-0 mx-auto w-fit max-w-[calc(100vw-20px)] pointer-events-none flex flex-col items-center gap-2 select-none'
    : `fixed w-fit pointer-events-none flex flex-col ${desktopCrossEnd} gap-2 select-none transition-[right,max-width] duration-200 ease-out`;
  const expandedContainerClass = isMobile
    ? 'fixed inset-x-0 mx-auto w-[calc(100vw-16px)] max-w-3xl pointer-events-none flex flex-col items-center gap-2 select-none'
    : `fixed w-[46rem] pointer-events-none flex flex-col ${desktopCrossEnd} gap-2 select-none transition-[right,max-width] duration-200 ease-out`;

  if (isMinimized) {
    if (isMobile) {
      const progressPct = Math.min(100, Math.max(0, Math.round(playback.progress * 100)));
      return (
        <div
          ref={drag.containerRef}
          style={resolvedContainerStyle}
          dir={isRtl ? 'rtl' : 'ltr'}
          className={minimizedContainerClass}
        >
          {srAnnouncement}
          {noticeStack}
          <div
            data-testid="podcast-mobile-miniplayer"
            {...drag.dragHandlers}
            className={`order-last pointer-events-auto relative w-fit max-w-[calc(100vw-20px)] flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-surface-raised/95 backdrop-blur-2xl border border-line shadow-pop overflow-hidden touch-none ${
              drag.isDragging ? 'cursor-grabbing ring-2 ring-accent/40' : ''
            }`}
          >
            <div className="flex items-center gap-0.5 shrink-0" dir="ltr">
              <PlayPauseButton playback={playback} t={t} size="sm" />
              <IconButton
                onClick={playback.next}
                title={t('podcast.nextChapter')}
                disabled={index >= segments.length - 1}
                className="p-1.5"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </IconButton>
            </div>
            <button
              type="button"
              onClick={onExpand}
              className="flex items-center gap-1.5 px-1.5 border-x border-line/70 min-w-0 max-w-[46vw] py-0.5 cursor-pointer"
              title={t('podcast.expandPlayer')}
            >
              <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-accent/15 text-accent shrink-0">
                {index + 1}/{segments.length}
              </span>
              <span className="text-caption font-semibold text-ink truncate">
                {segment?.chapter_title || episode.title}
              </span>
            </button>
            <div className="flex items-center gap-0.5 shrink-0">
              <IconButton onClick={onExpand} title={t('podcast.expandPlayer')} className="p-1.5 hover:text-accent">
                <Maximize2 className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton onClick={onClose} title={t('podcast.close')} className="p-1.5 hover:text-danger hover:bg-danger/10">
                <X className="w-3.5 h-3.5" />
              </IconButton>
            </div>
            <span
              aria-hidden="true"
              className="absolute bottom-0 inset-x-3 h-[2px] bg-surface-sunken/80 pointer-events-none rounded-full overflow-hidden"
            >
              <span
                className="block h-full bg-accent transition-[width] duration-150"
                style={{ width: `${progressPct}%` }}
              />
            </span>
          </div>
        </div>
      );
    }

    const showDesktopCapsuleDetails = (isCapsuleHovered || isCapsuleFocused) && !drag.isDragging;
    return (
      <div
        ref={drag.containerRef}
        style={resolvedContainerStyle}
        dir={isRtl ? 'rtl' : 'ltr'}
        className={minimizedContainerClass}
      >
        {srAnnouncement}
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
          {/* Stationary right anchor: Grip + Headphones (with chapter badge) + Play/Pause */}
          <div className="flex flex-row-reverse items-center gap-1 shrink-0 select-none">
            <span
              className="px-1 text-ink-subtle hover:text-ink flex items-center shrink-0"
              title={t('podcast.dragHint')}
            >
              <GripVertical className="w-3.5 h-3.5 opacity-60 group-hover/podcast-capsule:opacity-100 transition-opacity pointer-events-none" />
            </span>
            <button
              type="button"
              onClick={onExpand}
              className={`relative w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                playback.isPlaying
                  ? 'bg-accent/20 text-accent ring-1 ring-accent/45'
                  : 'bg-accent/15 hover:bg-accent/25 text-accent'
              }`}
              title={t('podcast.expandPlayer')}
              aria-label={t('podcast.dockLabel')}
            >
              <Headphones className="w-4 h-4 shrink-0" />
              {segments.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[15px] px-1 text-[9px] font-bold rounded-full bg-surface-raised border border-accent/40 text-accent flex items-center justify-center shadow-2xs pointer-events-none">
                  {index + 1}/{segments.length}
                </span>
              )}
            </button>
            <PlayPauseButton playback={playback} t={t} size="sm" />
          </div>

          {/* Hover-expandable controls cluster (grows inward to the left) */}
          <div
            data-podcast-expandable
            inert={!showDesktopCapsuleDetails}
            className={`flex items-center min-w-0 overflow-hidden ease-out ${
              drag.isDragging ? '' : 'transition-all duration-300'
            } ${
              showDesktopCapsuleDetails
                ? 'max-w-[34rem] opacity-100 visible pointer-events-auto'
                : 'max-w-0 opacity-0 invisible pointer-events-none'
            }`}
          >
            <div className="flex items-center gap-0.5 ps-1 shrink-0">
              <IconButton onClick={onClose} title={t('podcast.close')} className="p-1.5 hover:text-danger hover:bg-danger/10">
                <X className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton onClick={onExpand} title={t('podcast.expandPlayer')} className="p-1.5 hover:text-accent">
                <Maximize2 className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton onClick={playback.toggleMute} title={t('podcast.volumeTooltip', { percent: volumePercent })} className="p-1.5 shrink-0">
                <VolumeIcon volume={playback.volume} muted={playback.muted} />
              </IconButton>
              <button
                type="button"
                onClick={playback.cycleRate}
                className="px-2 py-0.5 rounded-full border border-line bg-surface hover:bg-surface-hover text-caption font-mono font-bold text-ink-muted hover:text-ink cursor-pointer shrink-0"
                title={t('podcast.speedTooltip')}
              >
                {playback.playbackRate}x
              </button>
            </div>

            <button
              type="button"
              dir={isRtl ? 'rtl' : 'ltr'}
              onClick={onExpand}
              className="flex flex-col text-start px-2 mx-1 border-x border-line/70 min-w-0 max-w-[190px] hover:bg-surface-hover/50 rounded-lg py-0.5 transition-colors cursor-pointer"
              title={t('podcast.expandPlayer')}
            >
              <span className="text-caption font-semibold text-ink truncate">
                {segment?.chapter_title || episode.title}
              </span>
              <span className="text-[11px] leading-tight font-mono text-ink-muted truncate">
                {formatTimeSec(metrics.chapterElapsed)} / {formatTimeSec(metrics.chapterDuration)}
                {' · '}
                {t('podcast.timeLeft', { time: formatTimeSec(metrics.totalRemaining) })}
              </span>
            </button>

            <div className="flex items-center gap-0.5 shrink-0" dir="ltr">
              <IconButton onClick={playback.prev} title={t('podcast.prevChapter')} disabled={index <= 0 && playback.elapsed <= 3} className="p-1.5">
                <SkipBack className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton onClick={playback.next} title={t('podcast.nextChapter')} disabled={index >= segments.length - 1} className="p-1.5">
                <SkipForward className="w-3.5 h-3.5" />
              </IconButton>
            </div>

            <div className="w-px h-5 bg-line-strong/70 mx-1.5 shrink-0" />
          </div>
        </div>
        {costBreakdownText && showDesktopCapsuleDetails && (
          <div
            data-testid="podcast-cost-pill"
            className="pointer-events-auto inline-flex items-center gap-2 px-3 py-0.5 rounded-full bg-surface-raised/90 backdrop-blur-xl border border-line/70 text-caption text-ink-muted shadow-xs max-w-full animate-in fade-in duration-150"
          >
            <Sparkles className="w-2.5 h-2.5 text-accent shrink-0" />
            <span className="truncate">{costBreakdownText}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={drag.containerRef}
      style={resolvedContainerStyle}
      dir={isRtl ? 'rtl' : 'ltr'}
      className={expandedContainerClass}
    >
      {srAnnouncement}
      {transcriptOpen && (
        <PodcastTranscript
          t={t}
          episode={episode}
          engine={engine}
          playback={playback}
          articlesMap={articlesMap}
          getSpeakerName={getSpeakerName}
          onClose={onToggleTranscript}
        />
      )}
      {music?.panelOpen && <PodcastMusicPanel t={t} music={music} onClose={music.onTogglePanel} />}
      {noticeStack}

      <div className="w-full bg-surface-raised/95 backdrop-blur-2xl border border-line rounded-2xl shadow-pop overflow-hidden pointer-events-auto">
        <div className="flex items-center gap-1 px-3 pt-3" role="group" aria-label={t('podcast.transcriptTitle')}>
          {segments.map((seg, idx) => {
            const fill = idx < index ? 100 : idx === index ? Math.round(playback.progress * 100) : 0;
            return (
              <button
                key={seg.id || idx}
                type="button"
                onClick={(e) => {
                  if (idx !== index) {
                    playback.play(idx);
                    return;
                  }
                  const rect = e.currentTarget.getBoundingClientRect();
                  if (!rect.width) return;
                  const ratio = isRtl ? (rect.right - e.clientX) / rect.width : (e.clientX - rect.left) / rect.width;
                  playback.seekRatio(Math.min(1, Math.max(0, ratio)));
                }}
                title={`${idx + 1}. ${seg.chapter_title} (${formatTimeSec(playback.durations[idx])})`}
                aria-label={`${idx + 1}. ${seg.chapter_title}`}
                aria-current={idx === index ? 'step' : undefined}
                className="relative h-2 rounded-full bg-surface-sunken overflow-hidden cursor-pointer hover:h-2.5 transition-all"
                style={{ flexGrow: Math.max(1, playback.durations[idx] || 1), flexBasis: 0 }}
              >
                <span className="absolute inset-y-0 start-0 bg-accent rounded-full transition-all duration-150" style={{ width: `${fill}%` }} />
              </button>
            );
          })}
        </div>

        <div className="px-4 pt-2 flex flex-wrap items-center justify-between gap-2 text-caption font-mono text-ink-muted">
          <span className="flex items-center gap-2">
            <Clock className="w-3 h-3 text-accent shrink-0" />
            {t('podcast.chapterLabel')}:{' '}
            <strong className="text-ink font-semibold">{formatTimeSec(metrics.chapterElapsed)}</strong> / {formatTimeSec(metrics.chapterDuration)}
          </span>
          <span className="flex items-center gap-2">
            <span>
              {t('podcast.totalLabel')}: <strong className="text-ink font-semibold">{formatTimeSec(metrics.totalElapsed)}</strong> /{' '}
              {formatTimeSec(metrics.totalDuration)}
            </span>
            <span className="px-2 rounded bg-surface-sunken text-ink font-semibold">
              {t('podcast.timeLeft', { time: formatTimeSec(metrics.totalRemaining) })}
            </span>
          </span>
        </div>

        <div
          {...drag.dragHandlers}
          className={`px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-2 sm:gap-3 touch-none ${drag.isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        >
          <div className="flex items-center gap-2 sm:gap-2 min-w-0 flex-1 overflow-hidden">
            <span className="hidden sm:flex text-ink-subtle shrink-0 items-center" title={t('podcast.dragHint')}>
              <GripVertical className="w-4 h-4" />
            </span>
            {activeArticle?.imageUrl && (
              <img
                src={activeArticle.imageUrl}
                alt=""
                className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg object-cover border border-line shrink-0 pointer-events-none"
              />
            )}
            <div className="min-w-0 flex items-center gap-1 sm:gap-2 truncate">
              <span className="text-caption font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-accent/15 text-accent shrink-0">
                {t('podcast.chapterCounter', { current: index + 1, total: segments.length })}
              </span>
              {activeArticle?.from?.year != null && (
                <span className="hidden sm:inline text-caption font-mono font-semibold text-ink-subtle shrink-0">{activeArticle.from.year}</span>
              )}
              <span className="text-xs font-bold text-ink truncate" title={segment?.chapter_title || episode.title}>
                {segment?.chapter_title || episode.title}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={onToggleAutoFollow}
              title={t('podcast.autoFollowTooltip')}
              aria-pressed={isAutoFollow}
              className={`p-2 sm:px-3 sm:py-1 rounded-full text-caption font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                isAutoFollow ? 'bg-accent/15 text-accent border border-accent/30' : 'bg-amber-500 text-slate-950 font-bold'
              }`}
            >
              <Compass className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">{isAutoFollow ? t('podcast.autoFollowOn') : t('podcast.autoFollowResume')}</span>
            </button>

            {onSwitchGender && (
              <div
                className="hidden sm:flex items-center bg-surface-sunken p-0.5 rounded-full border border-line text-caption font-semibold"
                role="radiogroup"
                aria-label={t('podcast.voiceLabel')}
              >
                {(['male', 'female']).map((g) => {
                  const active = (voiceGender || episode.voice_gender || 'male') === g;
                  const label = g === 'female'
                    ? (hostNames?.female || t('podcast.voiceFemale'))
                    : (hostNames?.male || t('podcast.voiceMale'));
                  const baseTitle = g === 'female' ? t('podcast.voiceFemale') : t('podcast.voiceMale');
                  // The other gender of a premium episode is a paid render: say so before the tap.
                  const needsUnlock = !active && genderSwitchNeedsPremiumUnlock(episode, engine, g);
                  const title = needsUnlock ? `${baseTitle} (${t('podcast.engineGemini')})` : baseTitle;
                  return (
                    <button
                      key={g}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => !active && onSwitchGender(g)}
                      className={`px-2 py-0.5 rounded-full flex items-center gap-1 transition-all cursor-pointer ${
                        active ? 'bg-surface-raised text-ink shadow-2xs' : 'text-ink-subtle hover:text-ink'
                      }`}
                      title={title}
                    >
                      <span>{label}</span>
                      {needsUnlock && <Lock className="w-2.5 h-2.5 opacity-70" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            )}

            <div
              className="hidden sm:flex items-center bg-surface-sunken p-0.5 rounded-full border border-line text-caption font-semibold"
              role="radiogroup"
              aria-label={t('podcast.qualityLabel')}
            >
              {availableEngines.map((id) => {
                const Icon = ENGINE_ICONS[id];
                const entry = engines?.find((e) => e.id === id);
                const available = entry ? entry.available !== false : (id === 'gemini' || id === 'edge' || id === engine);
                const isCreditsLocked =
                  entry?.reason === 'credits_exhausted' || entry?.reason === 'insufficient_credits';
                const unavailableReason =
                  entry?.reason === 'credits_exhausted'
                    ? t('podcast.engineCreditsExhausted')
                    : entry?.reason === 'insufficient_credits'
                      ? t('podcast.engineInsufficientCredits', {
                          credits: entry?.requiredCredits ?? 10,
                          remaining: entry?.remainingCredits ?? 0,
                        })
                      : entry?.reason === 'quota_exhausted'
                        ? t('podcast.engineQuotaExhausted')
                        : entry?.reason === 'unconfigured'
                          ? t('podcast.engineUnconfigured')
                          : t('podcast.engineUnavailable');
                const isActive = engine === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    disabled={!available && !isActive}
                    onClick={() => available && onSwitchEngine(id)}
                    className={`py-0.5 rounded-full flex items-center gap-1 transition-all ${
                      isActive ? 'px-2' : 'px-2'
                    } ${
                      !available && !isActive
                        ? 'opacity-40 cursor-not-allowed text-ink-subtle'
                        : isActive
                          ? 'bg-surface-raised text-ink shadow-2xs cursor-pointer'
                          : 'text-ink-subtle hover:text-ink hover:bg-surface-hover cursor-pointer'
                    }`}
                    title={
                      !available
                        ? `${t(engineLabelKey(id))} — ${unavailableReason}`
                        : t(engineLabelKey(id, 'Desc'), { credits: entry?.audioCredits ?? 10 })
                    }
                  >
                    {(isCreditsLocked && !isActive) ? <Lock className="w-3 h-3 text-amber-500" /> : <Icon className="w-3 h-3 text-accent" />}
                    {isActive ? (
                      <span>{t(engineLabelKey(id))}</span>
                    ) : (
                      <span className="sr-only">{t(engineLabelKey(id))}</span>
                    )}
                  </button>
                );
              })}
            </div>

            <IconButton onClick={onMinimize} title={t('podcast.minimize')}>
              <Minimize2 className="w-3.5 h-3.5" />
            </IconButton>
            <IconButton onClick={onClose} title={t('podcast.close')} className="hover:text-danger hover:bg-danger/10">
              <X className="w-4 h-4" />
            </IconButton>
          </div>
        </div>

        {(subtitleText || playback.needsGesture) && (
          <div className="px-4 py-2 mx-3 mb-2 rounded-xl bg-surface/80 border border-line/60 text-start max-h-24 overflow-y-auto">
            {playback.needsGesture ? (
              <p className="text-xs text-accent font-semibold">{t('podcast.tapToPlay')}</p>
            ) : (
              <p dir="auto" className="text-xs sm:text-[13px] text-ink leading-relaxed text-start">
                {episode.format === 'duo' && subtitleSpeaker && (
                  <span className="font-bold text-accent me-2">{getSpeakerName(subtitleSpeaker)}:</span>
                )}
                {subtitleText}
              </p>
            )}
          </div>
        )}

        <div className="px-3 sm:px-4 py-2 border-t border-line/70 bg-surface/50 flex flex-wrap items-center justify-between gap-1 sm:gap-2">
          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
            <button
              type="button"
              onClick={onToggleTranscript}
              aria-pressed={transcriptOpen}
              className={`p-2 sm:px-3 sm:py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border transition-colors cursor-pointer ${
                transcriptOpen
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-line bg-surface hover:bg-surface-hover text-ink-muted hover:text-ink'
              }`}
              title={t('podcast.transcriptToggle')}
            >
              <FileText className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">{t('podcast.transcriptToggle')}</span>
            </button>
            <IconButton onClick={onOpenStudio} title={t('podcast.reconfigureBtn')}>
              <Settings className="w-3.5 h-3.5" />
            </IconButton>
            <IconButton onClick={onShare} title={t('podcast.shareListen')}>
              <Link2 className="w-3.5 h-3.5" />
            </IconButton>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 shrink-0" dir="ltr">
            <IconButton onClick={playback.prev} title={t('podcast.prevChapter')} disabled={index <= 0 && playback.elapsed <= 3} className="p-2 sm:p-2 rounded-full">
              <SkipBack className="w-4 h-4" />
            </IconButton>
            <PlayPauseButton playback={playback} t={t} />
            <IconButton onClick={playback.next} title={t('podcast.nextChapter')} disabled={index >= segments.length - 1} className="p-2 sm:p-2 rounded-full">
              <SkipForward className="w-4 h-4" />
            </IconButton>
          </div>

          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
            <button
              type="button"
              onClick={playback.cycleRate}
              className="px-2 sm:px-2 py-1 rounded-lg border border-line bg-surface hover:bg-surface-hover text-caption font-mono font-bold text-ink-muted hover:text-ink cursor-pointer"
              title={t('podcast.speedTooltip')}
            >
              {playback.playbackRate}x
            </button>
            <div className="hidden sm:flex items-center gap-1">
              <IconButton onClick={playback.toggleMute} title={t('podcast.volumeTooltip', { percent: volumePercent })}>
                <VolumeIcon volume={playback.volume} muted={playback.muted} />
              </IconButton>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={playback.muted ? 0 : playback.volume}
                onChange={(e) => playback.setVolume(e.target.value)}
                aria-label={t('podcast.volumeTooltip', { percent: volumePercent })}
                className="w-16 accent-accent cursor-pointer"
              />
            </div>
            {music?.supported && (
              <button
                type="button"
                onClick={music.onTogglePanel}
                aria-expanded={music.panelOpen}
                aria-haspopup="dialog"
                title={music.enabled ? t('podcast.musicOn') : t('podcast.musicOff')}
                aria-label={music.enabled ? t('podcast.musicOn') : t('podcast.musicOff')}
                className={`relative p-2 rounded-lg transition-colors cursor-pointer hover:bg-surface-hover ${
                  music.panelOpen ? 'bg-accent/15' : ''
                } ${music.enabled ? 'text-accent' : 'text-ink-subtle hover:text-ink'}`}
              >
                <Music className="w-3.5 h-3.5" />
                {!music.enabled && (
                  <span aria-hidden="true" className="absolute inset-0 m-auto w-4 h-px bg-current rotate-45" />
                )}
              </button>
            )}
            <IconButton onClick={onToggleChime} title={chimeEnabled ? t('podcast.chimeOn') : t('podcast.chimeOff')} pressed={chimeEnabled} className="hidden sm:inline-flex">
              {chimeEnabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
            </IconButton>
            <IconButton onClick={onDownload} title={isDownloading ? t('podcast.downloading') : t('podcast.downloadBtn')} disabled={isDownloading}>
              {isDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            </IconButton>
          </div>
        </div>
        {costBreakdownText && (
          <div
            data-testid="podcast-cost-breakdown"
            className="px-4 py-1 border-t border-line/50 bg-surface/40 flex items-center justify-center gap-2 text-caption text-ink-muted text-center"
          >
            <Sparkles className="w-2.5 h-2.5 text-accent shrink-0" />
            <span>{costBreakdownText}</span>
          </div>
        )}
        <p className="hidden sm:block px-4 pb-2 pt-0.5 text-caption text-ink-subtle text-center">
          {t('podcast.keyboardHint')} · {t('podcast.aiDisclaimer')}
          {episode?.model && (
            <> · {t('podcast.scriptModel', { model: formatAiModelName(episode.model) })}</>
          )}
        </p>
      </div>
    </div>
  );
}

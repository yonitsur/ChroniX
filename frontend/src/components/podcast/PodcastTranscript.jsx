import React, { useEffect, useRef } from 'react';
import { FileText, X } from '../icons/ThemeIcons';
import { formatTimeSec } from '../../utils/podcastPlayback';
import { formatAiModelName, formatPodcastCostBreakdown } from '../../utils/modelUtils';

/**
 * Full episode script. The playing chapter is rendered sentence-by-sentence from the server's
 * timings: the spoken sentence is highlighted and any sentence can be clicked to play from there.
 */
export default function PodcastTranscript({ t, episode, engine = null, playback, articlesMap, getSpeakerName, onClose }) {
  const activeRef = useRef(null);
  const segments = episode?.segments || [];
  const { index: activeIndex, clip, cue, durations } = playback;

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex, cue.sentenceIndex, cue.turnIndex]);

  const renderActiveTurns = (seg) => {
    const sentences = clip?.sentences || [];
    if (!sentences.length) {
      return (seg.turns || []).map((turn, tIdx) => (
        <p
          key={tIdx}
          ref={tIdx === cue.turnIndex ? activeRef : undefined}
          dir="auto"
          className={`text-xs leading-relaxed ${tIdx === cue.turnIndex ? 'text-ink font-medium' : 'text-ink-muted'}`}
        >
          {episode.format === 'duo' && <strong className="text-accent font-semibold me-1.5">{getSpeakerName(turn.speaker)}:</strong>}
          {turn.text}
        </p>
      ));
    }
    return (seg.turns || []).map((turn, tIdx) => (
      <p key={tIdx} dir="auto" className="text-xs leading-relaxed text-ink-muted text-start">
        {episode.format === 'duo' && <strong className="text-accent font-semibold me-1.5">{getSpeakerName(turn.speaker)}:</strong>}
        {sentences.map((s, sIdx) => {
          if ((s.turn ?? 0) !== tIdx) return null;
          const isActive = sIdx === cue.sentenceIndex;
          return (
            <button
              key={sIdx}
              type="button"
              ref={isActive ? activeRef : undefined}
              onClick={() => playback.seekTo(s.start)}
              title={t('podcast.jumpToSentence')}
              className={`inline text-start rounded px-0.5 transition-colors cursor-pointer ${
                isActive ? 'bg-accent/20 text-ink font-medium' : 'hover:bg-surface-hover'
              }`}
            >
              {s.text}{' '}
            </button>
          );
        })}
      </p>
    ));
  };

  return (
    <div className="w-full max-h-[48dvh] bg-surface-raised/95 backdrop-blur-2xl border border-line rounded-2xl shadow-pop overflow-hidden flex flex-col pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="px-4 py-2.5 border-b border-line flex items-center justify-between bg-surface/60">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-accent shrink-0" />
          <span className="text-xs font-bold text-ink truncate">
            {t('podcast.transcriptTitle')} — {episode.title}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-mono text-ink-muted">
            {t('podcast.totalLabel')}: {formatTimeSec(playback.metrics.totalDuration)}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-ink-subtle hover:text-ink hover:bg-surface-hover cursor-pointer"
            aria-label={t('common.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-3 overflow-y-auto space-y-2.5 text-start">
        {segments.map((seg, idx) => {
          const isCurrent = idx === activeIndex;
          const article = seg.event_id ? articlesMap.get(String(seg.event_id)) : null;
          const badge = seg.type === 'intro'
            ? t('podcast.chapterIntro')
            : seg.type === 'outro'
              ? t('podcast.chapterOutro')
              : (article?.from?.year != null ? String(article.from.year) : `#${idx}`);
          return (
            <div
              key={seg.id || idx}
              className={`p-3 rounded-xl border transition-all ${
                isCurrent ? 'border-accent bg-accent/10 shadow-xs' : 'border-line/70 bg-surface/60'
              }`}
            >
              <button
                type="button"
                onClick={() => playback.play(idx)}
                className="w-full flex items-center justify-between gap-2 mb-1.5 cursor-pointer text-start"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                      isCurrent ? 'bg-accent text-accent-fg' : 'bg-surface-sunken text-ink-muted'
                    }`}
                  >
                    {badge}
                  </span>
                  <span className="text-xs font-bold text-ink truncate">{seg.chapter_title}</span>
                </span>
                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-surface-sunken text-ink-muted shrink-0">
                  {formatTimeSec(durations[idx])}
                </span>
              </button>
              <div className="space-y-1.5">
                {isCurrent
                  ? renderActiveTurns(seg)
                  : (seg.turns || []).map((turn, tIdx) => (
                    <p key={tIdx} dir="auto" className="text-xs leading-relaxed text-ink-muted text-start">
                      {episode.format === 'duo' && (
                        <strong className="text-accent font-semibold me-1.5">{getSpeakerName(turn.speaker)}:</strong>
                      )}
                      {turn.text}
                    </p>
                  ))}
              </div>
            </div>
          );
        })}

        {(() => {
          const costBreakdownText = formatPodcastCostBreakdown(episode, t, engine);
          if (!episode?.model && !costBreakdownText) return null;
          return (
            <div className="pt-3 pb-1 text-center select-none border-t border-line/60 space-y-0.5">
              {episode?.model && (
                <div className="text-[10px] text-ink-faint/60 tracking-wide">
                  {t('podcast.scriptModel', { model: formatAiModelName(episode.model) })}
                </div>
              )}
              {costBreakdownText && (
                <div className="text-[10px] text-ink-muted tracking-wide">
                  {costBreakdownText}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

import React, { useEffect } from 'react';
import { Music, X } from '../icons/ThemeIcons';

/** Background music settings: on/off toggle and music level slider (0% mutes). */
export default function PodcastMusicPanel({ t, music, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const effectiveVolume = music.enabled ? music.volume : 0;
  const percent = Math.round(effectiveVolume * 100);
  return (
    <div
      role="dialog"
      aria-label={t('podcast.musicTitle')}
      className="w-full sm:w-80 sm:self-end bg-surface-raised/95 backdrop-blur-2xl border border-line rounded-2xl shadow-pop overflow-hidden pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <div className="px-4 py-2.5 border-b border-line flex items-center justify-between gap-2 bg-surface/60">
        <div className="flex items-center gap-2 min-w-0">
          <Music className="w-4 h-4 text-accent shrink-0" />
          <span className="text-xs font-bold text-ink truncate">{t('podcast.musicTitle')}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            role="switch"
            aria-checked={music.enabled}
            aria-label={t('podcast.musicTitle')}
            onClick={music.onToggle}
            className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${music.enabled ? 'bg-accent' : 'bg-surface-sunken border border-line'}`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${music.enabled ? 'start-[18px]' : 'start-0.5'}`}
            />
          </button>
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

      <div className="px-4 py-3 flex flex-col gap-2.5">
        <label className="flex items-center gap-3 text-[11px] font-semibold text-ink-muted">
          <span className="shrink-0">{t('podcast.musicVolume')}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={effectiveVolume}
            onChange={(e) => music.onVolume(e.target.value)}
            aria-valuetext={`${percent}%`}
            className="flex-1 accent-accent cursor-pointer"
          />
          <span className={`w-8 text-end font-mono ${music.enabled ? 'text-ink' : 'text-ink-subtle'}`}>{percent}%</span>
        </label>

        <p className="text-[10px] leading-snug text-ink-subtle">{t('podcast.musicHint')}</p>
      </div>
    </div>
  );
}

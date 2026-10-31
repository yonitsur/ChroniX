import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Globe,
  Headphones,
  Key,
  Loader2,
  Lock,
  LogIn,
  Minimize2,
  Pause,
  Play,
  Sparkles,
  Square,
  Trash2,
  UserRound,
  Users,
  X,
  Zap,
} from '../icons/ThemeIcons';
import { fetchVoicePreview } from '../../api';
import { formatTimeSec, estimateEpisodeDurationSec } from '../../utils/podcastPlayback';
import { FLOATING_Z } from '../../utils/floatingFocus';
import { formatAiModelName, formatPodcastCostBreakdown } from '../../utils/modelUtils';

const ENGINE_ICONS = { edge: Zap, gcloud: Globe, gemini: Sparkles };
export const ALL_ENGINES = ['gemini', 'gcloud', 'edge'];

export const engineLabelKey = (id, suffix = '') => `podcast.engine${id.charAt(0).toUpperCase()}${id.slice(1)}${suffix}`;

function OptionCard({ selected, disabled, onClick, children, className = '' }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      className={`p-3 rounded-xl border text-start transition-all cursor-pointer flex flex-col gap-1 disabled:cursor-not-allowed disabled:opacity-50 ${
        selected
          ? 'border-accent bg-accent/10 text-ink shadow-xs ring-1 ring-accent/40'
          : 'border-line bg-surface hover:bg-surface-hover text-ink-muted'
      } ${className}`}
    >
      {children}
    </button>
  );
}

function SectionLabel({ children }) {
  return <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">{children}</p>;
}

function GenerationSteps({ status, t }) {
  const steps = [
    { id: 'script', label: t('podcast.stepScript') },
    { id: 'audio', label: t('podcast.stepAudio') },
    { id: 'ready', label: t('podcast.stepReady') },
  ];
  const activeIdx = Math.max(0, steps.findIndex((s) => s.id === status));
  return (
    <ol className="space-y-2.5" aria-live="polite">
      {steps.map((step, idx) => {
        const done = idx < activeIdx;
        const active = idx === activeIdx;
        return (
          <li key={step.id} className="flex items-center gap-2.5 text-sm">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                done ? 'bg-accent text-accent-fg' : active ? 'bg-accent/15 text-accent' : 'bg-surface-sunken text-ink-subtle'
              }`}
            >
              {done ? <Check className="w-3.5 h-3.5" /> : active ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : idx + 1}
            </span>
            <span className={done || active ? 'text-ink font-medium' : 'text-ink-subtle'}>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Podcast "studio": one-tap listen with smart defaults, existing episodes, and optional
 * customization (format, voice with samples, voice quality, length) behind a disclosure.
 */
export default function PodcastStudioDialog({
  t,
  isRtl,
  episodes = [],
  activeEpisodeId,
  onPlayEpisode,
  onDeleteEpisode,
  config,
  onConfigChange,
  engines = [],
  language = 'en',
  hostNames,
  costLabel,
  approxMinutes,
  generation,
  onListen,
  onStop,
  onMinimize,
  onClose,
  quotaBanner,
}) {
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [preview, setPreview] = useState({ key: null, loading: false, error: null });
  const previewAudioRef = useRef(null);
  const isGenerating = generation.status === 'script' || generation.status === 'audio';

  useEffect(() => () => previewAudioRef.current?.pause(), []);

  const stopPreview = () => {
    previewAudioRef.current?.pause();
    setPreview({ key: null, loading: false, error: null });
  };

  const playPreview = async (gender) => {
    const key = `${config.engine}:${gender}:${config.format}`;
    previewAudioRef.current?.pause();
    setPreview({ key, loading: true, error: null });
    try {
      const clip = await fetchVoicePreview({ engine: config.engine, gender, lang: language, format: config.format });
      if (!previewAudioRef.current) previewAudioRef.current = new Audio();
      const audio = previewAudioRef.current;
      audio.onended = () => setPreview((p) => (p.key === key ? { key: null, loading: false, error: null } : p));
      audio.src = clip.src;
      await audio.play();
      setPreview((p) => (p.key === key ? { ...p, loading: false } : p));
    } catch {
      setPreview({ key: null, loading: false, error: gender });
    }
  };

  const engineEntry = (id) => engines.find((e) => e.id === id);
  const engineAvailable = (id) => {
    const entry = engineEntry(id);
    if (!entry) return id === 'gemini' || id === 'edge';
    return entry.available !== false;
  };
  const engineUnavailableText = (id) => {
    const entry = engineEntry(id);
    const reason = entry?.reason;
    if (reason === 'credits_exhausted') return t('podcast.engineCreditsExhausted');
    if (reason === 'insufficient_credits' || reason === 'insufficient_credits_for_new') {
      return t('podcast.engineInsufficientCredits', {
        credits: entry?.requiredCredits ?? 11,
        remaining: entry?.remainingCredits ?? 0,
      });
    }
    if (reason === 'quota_exhausted') return t('podcast.engineQuotaExhausted');
    if (reason === 'unconfigured') return t('podcast.engineUnconfigured');
    return t('podcast.engineUnavailable');
  };
  const visibleEngines = ALL_ENGINES;

  const summary = [
    config.format === 'duo' ? t('podcast.formatDuo') : t('podcast.formatSingle'),
    t(engineLabelKey(config.engine)),
    config.length === 'full' ? t('podcast.lengthFull') : t('podcast.lengthFocused'),
    approxMinutes ? t('podcast.approxMinutes', { minutes: approxMinutes }) : null,
  ].filter(Boolean).join(' · ');

  return (
    <div
      style={{ zIndex: FLOATING_Z.MODAL || 100 }}
      className="fixed inset-0 flex items-center justify-center p-3 sm:p-6 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200"
      dir={isRtl ? 'rtl' : 'ltr'}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (isGenerating) onMinimize();
        else onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="podcast-studio-title"
        className="w-full max-w-lg rounded-2xl bg-surface-raised border border-line shadow-pop overflow-hidden flex flex-col max-h-[90dvh]"
      >
        <div className="px-5 py-4 border-b border-line flex items-center justify-between bg-surface/60">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
              <Headphones className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 id="podcast-studio-title" className="text-base font-bold text-ink truncate">{t('podcast.studioTitle')}</h2>
              <p className="text-xs text-ink-muted line-clamp-2">{t('podcast.studioSubtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onMinimize && (
              <button
                type="button"
                onClick={onMinimize}
                className="p-1.5 rounded-lg text-ink-subtle hover:text-accent hover:bg-surface-hover cursor-pointer"
                title={isGenerating ? t('podcast.minimizeGenerating') : t('podcast.minimize')}
                aria-label={isGenerating ? t('podcast.minimizeGenerating') : t('podcast.minimize')}
              >
                <Minimize2 className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={isGenerating ? onMinimize : onClose}
              className="p-1.5 rounded-lg text-ink-subtle hover:text-ink hover:bg-surface-hover cursor-pointer"
              title={t('common.close')}
              aria-label={t('common.close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 text-start">
          {isGenerating ? (
            <div className="space-y-4">
              <GenerationSteps status={generation.status} t={t} />
              <p className="text-xs text-ink-subtle">{summary}</p>
            </div>
          ) : (
            <>
              {episodes.length > 0 && (
                <section className="space-y-2">
                  <SectionLabel>{t('podcast.episodesTitle')}</SectionLabel>
                  <ul className="space-y-1.5">
                    {episodes.map((ep) => {
                      const engineId = ALL_ENGINES.includes(ep.default_engine) ? ep.default_engine : 'edge';
                      const duration = ep.audio?.[engineId]?.total_duration || estimateEpisodeDurationSec(ep);
                      const epCostLine = formatPodcastCostBreakdown(ep, t);
                      return (
                        <li
                          key={ep.id}
                          className={`flex items-center gap-2 p-2.5 rounded-xl border ${
                            ep.id === activeEpisodeId ? 'border-accent/60 bg-accent/5' : 'border-line bg-surface'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => onPlayEpisode(ep)}
                            className="w-9 h-9 rounded-full bg-accent hover:bg-accent-hover text-accent-fg flex items-center justify-center shrink-0 cursor-pointer"
                            aria-label={`${t('podcast.playEpisode')}: ${ep.title}`}
                          >
                            <Play className="w-4 h-4 fill-current ms-0.5" />
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-ink truncate">{ep.title}</p>
                            <p className="text-[11px] text-ink-muted truncate">
                              {[
                                ep.format === 'duo' ? t('podcast.formatDuo') : t('podcast.formatSingle'),
                                t(engineLabelKey(engineId)),
                                t('podcast.episodeMeta', { chapters: ep.segments?.length || 0, duration: formatTimeSec(duration) }),
                              ].join(' · ')}
                              {ep.is_mine && <span className="ms-1.5 text-accent font-semibold">· {t('podcast.episodeMine')}</span>}
                            </p>
                            {epCostLine && (
                              <p className="text-[10.5px] text-ink-subtle truncate mt-0.5">
                                {epCostLine}
                              </p>
                            )}
                          </div>
                          {ep.can_manage && (
                            <button
                              type="button"
                              onClick={() => onDeleteEpisode(ep)}
                              className="p-1.5 rounded-lg text-ink-subtle hover:text-danger hover:bg-danger/10 cursor-pointer shrink-0"
                              title={t('podcast.deleteEpisode')}
                              aria-label={t('podcast.deleteEpisode')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <div className="pt-2">
                    <SectionLabel>{t('podcast.newEpisode')}</SectionLabel>
                  </div>
                </section>
              )}

              {quotaBanner?.show && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/35 space-y-2.5">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <div className="space-y-1 min-w-0">
                      <p className="text-xs font-bold text-ink">{t('podcast.quotaExhaustedTitle')}</p>
                      <p className="text-[11px] text-ink-muted leading-relaxed">
                        {quotaBanner.isGuest ? t('podcast.quotaExhaustedGuestBody') : t('podcast.quotaExhaustedUserBody')}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {quotaBanner.isGuest && quotaBanner.onOpenAuth && (
                      <button
                        type="button"
                        onClick={quotaBanner.onOpenAuth}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-accent-fg text-[11px] font-bold cursor-pointer"
                      >
                        <LogIn className="w-3.5 h-3.5" />
                        {t('podcast.signInBtn')}
                      </button>
                    )}
                    {quotaBanner.onOpenSettings && (
                      <button
                        type="button"
                        onClick={quotaBanner.onOpenSettings}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/40 bg-surface hover:bg-surface-hover text-ink text-[11px] font-semibold cursor-pointer"
                      >
                        <Key className="w-3.5 h-3.5 text-amber-500" />
                        {t('podcast.addApiKeyBtn')}
                      </button>
                    )}
                  </div>
                </div>
              )}

              <section className="space-y-2">
                <button
                  type="button"
                  onClick={onListen}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-accent hover:bg-accent-hover text-accent-fg text-sm font-bold shadow-card cursor-pointer transition-colors"
                >
                  <Headphones className="w-4 h-4" />
                  {t('podcast.listenNow')}
                </button>
                <p className="text-[11px] text-ink-muted text-center">
                  {summary}
                  {costLabel && <span className="block text-ink-subtle">{costLabel}</span>}
                </p>
              </section>

              <section className="border-t border-line pt-3">
                <button
                  type="button"
                  onClick={() => setCustomizeOpen((v) => !v)}
                  aria-expanded={customizeOpen}
                  className="w-full flex items-center justify-between text-xs font-semibold text-ink-muted hover:text-ink cursor-pointer"
                >
                  <span>{customizeOpen ? t('podcast.hideCustomize') : t('podcast.customize')}</span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${customizeOpen ? 'rotate-180' : ''}`} />
                </button>

                {customizeOpen && (
                  <div className="pt-4 space-y-4">
                    <div className="space-y-1.5">
                      <SectionLabel>{t('podcast.formatLabel')}</SectionLabel>
                      <div className="grid grid-cols-2 gap-2.5">
                        {[
                          { id: 'single', Icon: UserRound, label: t('podcast.formatSingle'), desc: t('podcast.formatSingleDesc') },
                          { id: 'duo', Icon: Users, label: t('podcast.formatDuo'), desc: t('podcast.formatDuoDesc') },
                        ].map(({ id, Icon, label, desc }) => (
                          <OptionCard key={id} selected={config.format === id} onClick={() => onConfigChange({ format: id })}>
                            <span className="inline-flex items-center gap-1.5 font-semibold text-xs text-ink">
                              <Icon className="w-4 h-4 text-accent" />
                              {label}
                            </span>
                            <span className="text-[11px] leading-snug">{desc}</span>
                          </OptionCard>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <SectionLabel>{t('podcast.voiceLabel')}</SectionLabel>
                      <div className="grid grid-cols-2 gap-2.5">
                        {['male', 'female'].map((gender) => {
                          const key = `${config.engine}:${gender}:${config.format}`;
                          const isPreviewing = preview.key === key;
                          const previewDisabled = false;
                          return (
                            <div
                              key={gender}
                              className={`flex items-center gap-2 p-2.5 rounded-xl border transition-all ${
                                config.voiceGender === gender
                                  ? 'border-accent bg-accent/10 ring-1 ring-accent/40'
                                  : 'border-line bg-surface hover:bg-surface-hover'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => onConfigChange({ voiceGender: gender })}
                                aria-pressed={config.voiceGender === gender}
                                className="flex-1 min-w-0 text-start cursor-pointer"
                              >
                                <span className="block text-xs font-semibold text-ink truncate">{hostNames?.[gender]}</span>
                                <span className="block text-[11px] text-ink-muted truncate">
                                  {gender === 'male' ? t('podcast.voiceMale') : t('podcast.voiceFemale')}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => (isPreviewing ? stopPreview() : playPreview(gender))}
                                disabled={previewDisabled}
                                className="w-8 h-8 rounded-full border border-line bg-surface hover:bg-surface-hover text-accent flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                title={
                                  preview.error === gender
                                    ? t('podcast.previewUnavailable')
                                    : isPreviewing ? t('podcast.stopPreview') : t('podcast.previewVoice')
                                }
                                aria-label={isPreviewing ? t('podcast.stopPreview') : t('podcast.previewVoice')}
                              >
                                {isPreviewing && preview.loading ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : isPreviewing ? (
                                  <Pause className="w-3.5 h-3.5 fill-current" />
                                ) : preview.error === gender ? (
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                                ) : (
                                  <Play className="w-3.5 h-3.5 fill-current ms-0.5" />
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <SectionLabel>{t('podcast.qualityLabel')}</SectionLabel>
                      <div className="grid grid-cols-2 gap-2.5">
                        {visibleEngines.map((id) => {
                          const Icon = ENGINE_ICONS[id];
                          const available = engineAvailable(id);
                          const entry = engineEntry(id);
                          const reason = entry?.reason;
                          const isCreditsLocked =
                            id === 'gemini' &&
                            !available &&
                            (reason === 'credits_exhausted' ||
                              reason === 'insufficient_credits' ||
                              reason === 'insufficient_credits_for_new');
                          return (
                            <OptionCard
                              key={id}
                              selected={config.engine === id}
                              disabled={!available}
                              className={id === 'gemini' ? 'col-span-2' : ''}
                              onClick={() => {
                                if (!available) return;
                                onConfigChange({ engine: id });
                              }}
                            >
                              <span className="inline-flex items-center gap-1.5 font-semibold text-xs text-ink">
                                {isCreditsLocked ? (
                                  <Lock className="w-3.5 h-3.5 text-amber-500" />
                                ) : (
                                  <Icon className="w-3.5 h-3.5 text-accent" />
                                )}
                                {t(engineLabelKey(id))}
                              </span>
                              <span className="text-[11px] leading-snug">
                                {!available
                                  ? engineUnavailableText(id)
                                  : t(engineLabelKey(id, 'Desc'), { credits: entry?.audioCredits ?? 10 })}
                              </span>
                            </OptionCard>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <SectionLabel>{t('podcast.lengthLabel')}</SectionLabel>
                      <div className="grid grid-cols-2 gap-2.5">
                        {[
                          { id: 'focused', label: t('podcast.lengthFocused'), desc: t('podcast.lengthFocusedDesc') },
                          { id: 'full', label: t('podcast.lengthFull'), desc: t('podcast.lengthFullDesc') },
                        ].map(({ id, label, desc }) => (
                          <OptionCard
                            key={id}
                            selected={config.length === id}
                            onClick={() => onConfigChange({ length: id })}
                          >
                            <span className="inline-flex items-center gap-1.5 font-semibold text-xs text-ink">
                              {label}
                            </span>
                            <span className="text-[11px] leading-snug">{desc}</span>
                          </OptionCard>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}

          {generation.error && (
            <div role="alert" className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs font-medium">
              {generation.error}
            </div>
          )}
          {(() => {
            const activeEp = episodes.find((e) => e.id === activeEpisodeId) || episodes[0];
            const epModel = activeEp?.model;
            const activeEpCostLine = formatPodcastCostBreakdown(activeEp, t);
            return (
              <div className="space-y-0.5 text-[11px] text-ink-subtle text-center">
                <p>
                  {t('podcast.aiDisclaimer')}
                  {epModel && (
                    <> · {t('podcast.scriptModel', { model: formatAiModelName(epModel) })}</>
                  )}
                </p>
                {activeEpCostLine && (
                  <p className="text-[10.5px] text-ink-muted">{activeEpCostLine}</p>
                )}
              </div>
            );
          })()}
        </div>

        {isGenerating && (
          <div className="px-5 py-3.5 border-t border-line bg-surface/60 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onStop}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-danger/15 hover:bg-danger/25 border border-danger/40 text-danger text-xs font-bold cursor-pointer"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              {t('podcast.stop')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

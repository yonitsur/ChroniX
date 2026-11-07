import React, { useMemo, useState } from 'react';
import { BookOpen, ExternalLink, Layers, Loader2, Sparkles } from './icons/ThemeIcons';
import { useLanguage } from '../context/LanguageContext';
import { timelineHistoryLinks, worldEventsSubject } from '../utils/personalEnrichment';

/**
 * "Learn more" in the Overview panel of a personal timeline: the public history its events are
 * part of (checked Wikipedia articles), finding links for events that have none yet, and laying a
 * general "world events" timeline for the same years and places over this one.
 */
export default function TimelineLearnMore({
  timeline,
  canEdit = false,
  enrichStatus = null,
  onFindLinks,
  worldLayerStatus = null,
  onAddWorldEvents,
}) {
  const { t } = useLanguage();
  const [withPictures, setWithPictures] = useState(false);
  const history = useMemo(() => timelineHistoryLinks(timeline), [timeline]);
  const subject = useMemo(() => worldEventsSubject(timeline), [timeline]);
  if (!timeline?.isPersonal || !(timeline.articles || []).length) return null;

  const mine = (s) => s && String(s.timelineId) === String(timeline.id);
  const enrich = mine(enrichStatus) ? enrichStatus : null;
  const world = mine(worldLayerStatus) ? worldLayerStatus : null;
  const enriching = enrich?.status === 'running';
  const building = world?.status === 'running';

  const enrichMessage = () => {
    if (!enrich) return '';
    if (enrich.status === 'running') return t('learnMore.finding');
    if (enrich.status === 'error') return enrich.message || t('learnMore.findFailed');
    const parts = [t('learnMore.foundLinks', { count: enrich.links || 0 })];
    if (enrich.images) parts.push(t('learnMore.foundPictures', { count: enrich.images }));
    if (enrich.historySkipped) parts.push(t('learnMore.historySkipped'));
    return parts.join(' · ');
  };

  return (
    <section className="mt-5 pt-4 border-t border-line space-y-3 text-start" data-testid="learn-more">
      <h3 className="flex items-center gap-2 text-body-sm font-semibold text-ink">
        <BookOpen className="w-4 h-4 text-ink-muted shrink-0" />{t('learnMore.title')}
      </h3>

      {history.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-caption text-ink-muted">{t('learnMore.historyIntro')}</p>
          <ul className="flex flex-wrap gap-1.5">
            {history.map((link) => (
              <li key={link.url}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={link.description || link.title}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded-full border border-line bg-surface-raised text-ink hover:bg-surface-hover font-medium text-caption shadow-2xs transition-colors"
                >
                  <span dir="auto">{link.name || link.title}</span>
                  {link.firstYear != null && <span className="text-ink-subtle tabular-nums">{link.firstYear}</span>}
                  <ExternalLink className="w-3 h-3 text-ink-subtle shrink-0" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-caption text-ink-subtle">{t('learnMore.noHistory')}</p>
      )}

      {canEdit && onFindLinks && (
        <div className="space-y-2 p-3 rounded-panel bg-surface-sunken border border-line">
          <p className="text-caption text-ink-muted leading-snug">{t('learnMore.findHint')}</p>
          <label className="flex items-center gap-2 text-caption text-ink cursor-pointer select-none">
            <input
              type="checkbox"
              checked={withPictures}
              onChange={(e) => setWithPictures(e.target.checked)}
              disabled={enriching}
              className="w-3.5 h-3.5 shrink-0 accent-[rgb(var(--accent))] cursor-pointer"
            />
            <span>{t('storyStudio.placePictures')}</span>
          </label>
          <button
            type="button"
            onClick={() => onFindLinks({ images: withPictures, force: true })}
            disabled={enriching}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-accent border border-accent/40 hover:bg-accent-soft rounded-control cursor-pointer disabled:opacity-60 disabled:cursor-default"
            data-testid="learn-more-find"
          >
            {enriching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {t('learnMore.findBtn')}
          </button>
          {enrich && (
            <p className={`text-caption ${enrich.status === 'error' ? 'text-danger' : 'text-ink-subtle'}`} role="status">{enrichMessage()}</p>
          )}
        </div>
      )}

      {subject && onAddWorldEvents && (
        <div className="space-y-2 p-3 rounded-panel bg-surface-sunken border border-line">
          <p className="text-caption text-ink-muted leading-snug">
            {t('learnMore.worldHint', { from: subject.from, to: subject.to })}
          </p>
          <button
            type="button"
            onClick={onAddWorldEvents}
            disabled={building}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-accent border border-accent/40 hover:bg-accent-soft rounded-control cursor-pointer disabled:opacity-60 disabled:cursor-default"
            data-testid="learn-more-world"
          >
            {building ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />}
            {t(building ? 'learnMore.worldBuilding' : 'learnMore.worldBtn')}
          </button>
          {world?.status === 'error' && <p className="text-caption text-danger" role="alert">{world.message}</p>}
        </div>
      )}
    </section>
  );
}

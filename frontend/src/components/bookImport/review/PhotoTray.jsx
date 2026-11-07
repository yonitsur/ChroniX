import React, { useMemo, useState } from 'react';
import { Image as ImageIcon, EyeOff, Eye, Plus } from '../../icons/ThemeIcons';
import { useLanguage } from '../../../context/LanguageContext';
import { formatDraftDate } from '../../../utils/bookImport/draftModel';

const PHOTO_MIME = 'application/x-chronix-book-photo';
const PAGE = 120;

/**
 * Photos that weren't placed confidently: drag one onto an event, use "Assign to…", or put it on the
 * selected event. Excluded photos stay out of the timeline (and out of hosted storage).
 */
export default function PhotoTray({ draft, assets, events, selectedEvent, dispatch }) {
  const { t, language } = useLanguage();
  const lang = language === 'he' ? 'he' : 'en';
  const [showExcluded, setShowExcluded] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const eventsById = useMemo(() => Object.fromEntries(events.map((e) => [e.id, e])), [events]);
  const list = useMemo(
    () => (draft.photos || []).filter((p) => (showExcluded ? p.status === 'excluded' : p.status === 'tray')),
    [draft.photos, showExcluded],
  );
  const excludedCount = (draft.photos || []).filter((p) => p.status === 'excluded').length;

  return (
    <div className="p-3 space-y-3" data-testid="book-tray">
      <div className="flex items-center gap-2">
        <p className="text-caption text-ink-muted flex-1 leading-snug">{showExcluded ? t('bookImport.excludedHint') : t('bookImport.trayHint')}</p>
        {excludedCount > 0 && (
          <button type="button" onClick={() => setShowExcluded((v) => !v)} className="text-xs px-2 py-1 rounded-control border border-line text-ink-muted hover:text-ink">
            {showExcluded ? t('bookImport.showTray') : t('bookImport.showExcluded', { count: excludedCount })}
          </button>
        )}
      </div>
      {list.length === 0 && <p className="text-sm text-ink-muted text-center py-6">{showExcluded ? t('bookImport.noExcluded') : t('bookImport.trayEmpty')}</p>}
      <ul className="grid grid-cols-2 gap-2">
        {list.slice(0, limit).map((p) => {
          const suggested = p.suggestedEventId ? eventsById[p.suggestedEventId] : null;
          const src = assets?.photos?.[p.id]?.thumb;
          return (
            <li
              key={p.id}
              draggable={!showExcluded}
              onDragStart={(ev) => { ev.dataTransfer.setData(PHOTO_MIME, p.id); ev.dataTransfer.effectAllowed = 'move'; }}
              className="rounded-control border border-line bg-surface-raised overflow-hidden"
              data-testid="book-tray-photo"
              data-photo-id={p.id}
            >
              <div className="aspect-[4/3] bg-surface-sunken flex items-center justify-center">
                {src ? <img src={src} alt={p.caption || ''} loading="lazy" decoding="async" className="w-full h-full object-cover" /> : <ImageIcon className="w-5 h-5 text-ink-subtle" />}
              </div>
              <div className="p-2 space-y-1">
                {p.caption && <p className="text-caption text-ink leading-snug line-clamp-2" dir="auto">{p.caption}</p>}
                {!showExcluded && (
                  <>
                    {selectedEvent && (
                      <button type="button" onClick={() => dispatch({ op: 'photo.assign', photoId: p.id, eventId: selectedEvent.id })} className="w-full inline-flex items-center justify-center gap-1 text-caption px-2 py-1 rounded-control bg-accent-soft text-accent hover:bg-accent-soft/80" data-testid="book-tray-to-selected">
                        <Plus className="w-3 h-3" /><span className="truncate" dir="auto">{selectedEvent.title}</span>
                      </button>
                    )}
                    <select
                      value=""
                      onChange={(ev) => { if (ev.target.value) dispatch({ op: 'photo.assign', photoId: p.id, eventId: ev.target.value }); }}
                      className="w-full text-caption bg-surface-sunken border border-line rounded-control px-1 py-0.5 text-ink"
                      aria-label={t('bookImport.assignTo')}
                      data-testid="book-tray-assign"
                    >
                      <option value="">{suggested ? `${t('bookImport.assignTo')} (${t('bookImport.suggested')}: ${suggested.title})` : t('bookImport.assignTo')}</option>
                      {suggested && <option value={suggested.id}>★ {formatDraftDate(suggested.from, lang)} {suggested.title}</option>}
                      {events.map((e) => <option key={e.id} value={e.id}>{formatDraftDate(e.from, lang)} {e.title}</option>)}
                    </select>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => dispatch({ op: 'photo.exclude', photoIds: [p.id], excluded: !showExcluded })}
                  className="w-full inline-flex items-center justify-center gap-1 text-caption text-ink-muted hover:text-ink py-0.5"
                >
                  {showExcluded ? <><Eye className="w-3 h-3" />{t('bookImport.include')}</> : <><EyeOff className="w-3 h-3" />{t('bookImport.exclude')}</>}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {list.length > limit && (
        <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="w-full text-xs py-2 rounded-control border border-line text-ink-muted hover:text-ink">
          {t('bookImport.showMore', { count: list.length - limit })}
        </button>
      )}
    </div>
  );
}

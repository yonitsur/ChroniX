import React, { memo, useEffect, useState } from 'react';
import {
  ChevronDown, ChevronRight, ChevronLeft, MapPin, Users, AlertTriangle, Check, X, Image as ImageIcon, RotateCcw, Star, Trash2,
} from '../../icons/ThemeIcons';
import { useLanguage } from '../../../context/LanguageContext';
import FuzzyDateInput, { STUDIO_INPUT_CLASS } from '../../storyStudio/FuzzyDateInput';
import { formatFuzzyDate, parseFuzzyDate } from '../../../utils/fuzzyDate';

const PHOTO_MIME = 'application/x-chronix-book-photo';

const FLAG_TONE = {
  date_inferred: 'text-warning border-warning/40',
  hebrew_mismatch: 'text-danger border-danger/40',
  undated: 'text-danger border-danger/40',
  possible_duplicate: 'text-warning border-warning/40',
  place_uncertain: 'text-ink-muted border-line',
  low_photo_confidence: 'text-ink-muted border-line',
  unresolved_people: 'text-warning border-warning/40',
  photo_album: 'text-accent border-accent/40',
};

function dateLabel(e, lang) {
  if (!e.from) return '';
  return formatFuzzyDate({ ...e.from, circa: Boolean(e.circa) }, lang);
}

/** One extracted event: a compact row that expands into an editor. Edits commit on blur. */
function EventCard({ event: e, lang, castById, lanes, photoAssets, selected, checked, onSelect, onCheck, dispatch }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [dateText, setDateText] = useState(() => dateLabel(e, lang));
  const [dragOver, setDragOver] = useState(false);
  const rejected = e.status === 'rejected';

  useEffect(() => { setDateText(dateLabel(e, lang)); }, [e.from, e.circa, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (patch) => dispatch({ op: 'event.update', id: e.id, patch });
  const commitDate = () => {
    const text = dateText.trim();
    if (!text) {
      if (e.from) update({ from: null });
      return;
    }
    const parsed = parseFuzzyDate(text, { lang });
    if (!parsed) return;
    const next = { year: parsed.year, month: parsed.month ?? null, day: parsed.day ?? null, precision: ['day', 'month', 'year', 'decade', 'century'].includes(parsed.precision) ? parsed.precision : 'year' };
    const same = e.from && e.from.year === next.year && (e.from.month ?? null) === next.month && (e.from.day ?? null) === next.day && e.from.precision === next.precision && Boolean(e.circa) === Boolean(parsed.circa);
    if (!same) update({ from: next, circa: Boolean(parsed.circa) });
  };

  const people = (e.people || []).map((id) => castById[id]?.name || id);
  const cover = e.photos?.[0];
  const lane = (lanes || []).find((l) => l.id === e.lane);

  const onDrop = (ev) => {
    ev.preventDefault();
    setDragOver(false);
    const pid = ev.dataTransfer.getData(PHOTO_MIME);
    if (pid) dispatch({ op: 'photo.assign', photoId: pid, eventId: e.id });
  };

  const movePhoto = (idx, delta) => {
    const ids = (e.photos || []).map((p) => p.photoId);
    const to = idx + delta;
    if (to < 0 || to >= ids.length) return;
    [ids[idx], ids[to]] = [ids[to], ids[idx]];
    dispatch({ op: 'photo.reorder', eventId: e.id, photoIds: ids });
  };

  return (
    <li
      className={`rounded-control border transition-colors ${selected ? 'border-accent ring-1 ring-accent/40' : 'border-line'} ${rejected ? 'opacity-55' : ''} ${dragOver ? 'bg-accent-soft' : 'bg-surface-raised'}`}
      style={{ contentVisibility: open ? 'visible' : 'auto', containIntrinsicSize: 'auto 76px' }}
      onDragOver={(ev) => { if (ev.dataTransfer.types.includes(PHOTO_MIME)) { ev.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      data-testid="book-event"
      data-event-id={e.id}
    >
      <div className="flex items-start gap-2 p-2">
        <input type="checkbox" checked={checked} onChange={() => onCheck(e.id)} className="mt-1 accent-accent" aria-label={t('bookImport.selectEvent')} />
        <button type="button" onClick={() => { setOpen((v) => !v); onSelect(e.id); }} className="flex-1 min-w-0 text-start cursor-pointer" aria-expanded={open} data-testid="book-event-toggle">
          <div className="flex items-center gap-2 min-w-0">
            {open ? <ChevronDown className="w-3.5 h-3.5 text-ink-subtle shrink-0" /> : (lang === 'he' ? <ChevronLeft className="w-3.5 h-3.5 text-ink-subtle shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-ink-subtle shrink-0" />)}
            <span className={`shrink-0 text-caption tabular-nums px-2 py-0.5 rounded border ${e.from ? 'border-line text-ink-muted' : 'border-danger/40 text-danger'}`}>{dateLabel(e, lang) || t('bookImport.undated')}</span>
            <span className={`truncate text-sm font-medium ${rejected ? 'line-through text-ink-muted' : 'text-ink'}`} dir="auto">{e.title}</span>
          </div>
          <div className="flex items-center gap-2 mt-1 ms-5 text-caption text-ink-muted min-w-0">
            {people.length > 0 && <span className="inline-flex items-center gap-1 truncate" dir="auto"><Users className="w-3 h-3 shrink-0" />{people.slice(0, 3).join(', ')}{people.length > 3 ? ` +${people.length - 3}` : ''}</span>}
            {e.place?.name && <span className="inline-flex items-center gap-1 truncate" dir="auto"><MapPin className="w-3 h-3 shrink-0" />{e.place.name}</span>}
            {lane && (lanes || []).length > 1 && <span className="inline-flex items-center gap-1 truncate"><span className="w-2 h-2 rounded-full" style={{ background: lane.color || 'rgb(var(--ink-faint))' }} />{lane.title}</span>}
          </div>
          {(e.flags || []).length > 0 && !rejected && (
            <div className="flex flex-wrap gap-1 mt-1 ms-5">
              {e.flags.map((f) => <span key={f} className={`text-caption px-2 py-0.5 rounded-full border ${FLAG_TONE[f] || 'border-line text-ink-muted'}`}>{t(`bookImport.flag_${f}`)}</span>)}
            </div>
          )}
        </button>
        {(e.photos || []).length > 0 && (
          <div className="flex -space-x-2 rtl:space-x-reverse shrink-0">
            {e.photos.slice(0, 3).map((p) => (
              photoAssets?.[p.photoId]?.thumb
                ? <img key={p.photoId} src={photoAssets[p.photoId].thumb} alt="" loading="lazy" decoding="async" className="w-9 h-9 object-cover rounded border-2 border-surface-raised" />
                : <span key={p.photoId} className="w-9 h-9 rounded bg-surface-sunken border-2 border-surface-raised inline-flex items-center justify-center"><ImageIcon className="w-3.5 h-3.5 text-ink-subtle" /></span>
            ))}
            {e.photos.length > 3 && <span className="w-9 h-9 rounded bg-surface-sunken border-2 border-surface-raised text-caption inline-flex items-center justify-center text-ink-muted">+{e.photos.length - 3}</span>}
          </div>
        )}
      </div>

      {open && (
        <div className="border-t border-line p-3 space-y-3" data-testid="book-event-editor">
          <label className="block">
            <span className="block text-caption font-medium text-ink-muted mb-1">{t('bookImport.fieldTitle')}</span>
            <input defaultValue={e.title} dir="auto" onBlur={(ev) => { const v = ev.target.value.trim(); if (v && v !== e.title) update({ title: v }); }} className={STUDIO_INPUT_CLASS} data-testid="book-event-title" />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div onBlur={commitDate}>
              <span className="block text-caption font-medium text-ink-muted mb-1">{t('bookImport.fieldDate')}</span>
              <FuzzyDateInput value={dateText} onChange={setDateText} lang={lang} placeholder={t('bookImport.datePlaceholder')} unreadableText={t('storyStudio.dateUnreadable')} ariaLabel={t('bookImport.fieldDate')} />
              {e.dateText && <p className="text-caption text-ink-subtle -mt-0.5" dir="auto">{t('bookImport.dateAsWritten')}: “{e.dateText}”</p>}
              {e.dateNote && <p className="text-caption text-ink-subtle" dir="auto">{e.dateNote}</p>}
            </div>
            <label className="block">
              <span className="block text-caption font-medium text-ink-muted mb-1">{t('bookImport.fieldPlace')}</span>
              <input defaultValue={e.place?.name || ''} dir="auto" onBlur={(ev) => { const v = ev.target.value.trim(); if (v !== (e.place?.name || '')) update({ place: v ? { name: v, lat: null, lng: null, source: 'user' } : null, placeId: null }); }} className={STUDIO_INPUT_CLASS} />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(lanes || []).length > 1 && (
              <label className="block">
                <span className="block text-caption font-medium text-ink-muted mb-1">{t('bookImport.fieldLane')}</span>
                <select value={e.lane || ''} onChange={(ev) => update({ lane: ev.target.value })} className={STUDIO_INPUT_CLASS}>
                  {lanes.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                </select>
              </label>
            )}
            <div>
              <span className="block text-caption font-medium text-ink-muted mb-1">{t('bookImport.fieldPeople')}</span>
              <div className="flex flex-wrap gap-1">
                {(e.people || []).map((pid) => (
                  <span key={pid} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-surface-sunken border border-line" dir="auto">
                    {castById[pid]?.name || pid}
                    <button type="button" onClick={() => update({ people: e.people.filter((x) => x !== pid) })} aria-label={t('common.remove')} className="text-ink-subtle hover:text-danger"><X className="w-3 h-3" /></button>
                  </span>
                ))}
                {(e.unresolvedPeople || []).map((n) => <span key={n} className="text-xs px-2 py-0.5 rounded-full border border-dashed border-warning/50 text-warning" dir="auto" title={t('bookImport.unresolvedPerson')}>{n}</span>)}
                <select value="" onChange={(ev) => { if (ev.target.value) update({ people: [...(e.people || []), ev.target.value] }); }} className="text-xs bg-surface-sunken border border-line rounded-full px-2 py-0.5" aria-label={t('bookImport.addPerson')}>
                  <option value="">+ {t('bookImport.addPerson')}</option>
                  {Object.values(castById).filter((c) => !(e.people || []).includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
          </div>
          <label className="block">
            <span className="block text-caption font-medium text-ink-muted mb-1">{t('bookImport.fieldSummary')}</span>
            <textarea defaultValue={e.summary || ''} rows={2} dir="auto" onBlur={(ev) => { if (ev.target.value !== (e.summary || '')) update({ summary: ev.target.value }); }} className={`${STUDIO_INPUT_CLASS} resize-y`} />
          </label>
          <label className="block">
            <span className="block text-caption font-medium text-ink-muted mb-1">{t('bookImport.fieldStory')}</span>
            <textarea defaultValue={e.narrative || ''} rows={4} dir="auto" onBlur={(ev) => { if (ev.target.value !== (e.narrative || '')) update({ narrative: ev.target.value }); }} className={`${STUDIO_INPUT_CLASS} resize-y leading-relaxed`} />
          </label>

          {(e.photos || []).length > 0 && (
            <div>
              <span className="block text-caption font-medium text-ink-muted mb-1">{t('bookImport.fieldPhotos', { count: e.photos.length })}</span>
              <ul className="flex flex-wrap gap-2">
                {e.photos.map((p, i) => (
                  <li key={p.photoId} className="relative group">
                    {photoAssets?.[p.photoId]?.thumb
                      ? <img src={photoAssets[p.photoId].thumb} alt="" loading="lazy" className={`w-20 h-20 object-cover rounded-control border ${i === 0 ? 'border-accent' : 'border-line'}`} />
                      : <span className="w-20 h-20 rounded-control bg-surface-sunken border border-line inline-flex items-center justify-center"><ImageIcon className="w-4 h-4 text-ink-subtle" /></span>}
                    {i === 0 && <span className="absolute top-1 start-1 text-caption px-1 rounded bg-accent text-accent-fg">{t('bookImport.cover')}</span>}
                    <div className="absolute bottom-1 inset-x-1 flex justify-between opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                      {i > 0 && <button type="button" onClick={() => movePhoto(i, -i)} className="p-0.5 rounded bg-surface-raised/90 text-ink" title={t('bookImport.makeCover')} aria-label={t('bookImport.makeCover')}><Star className="w-3 h-3" /></button>}
                      <button type="button" onClick={() => dispatch({ op: 'photo.unassign', photoIds: [p.photoId] })} className="p-0.5 rounded bg-surface-raised/90 text-danger ms-auto" title={t('bookImport.toTray')} aria-label={t('bookImport.toTray')}><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {rejected ? (
              <button type="button" onClick={() => dispatch({ op: 'event.setStatus', ids: [e.id], status: 'accepted' })} className="inline-flex items-center gap-1 text-xs px-3 py-1 rounded-control border border-line text-ink hover:bg-surface-hover cursor-pointer"><RotateCcw className="w-3.5 h-3.5" />{t('bookImport.restore')}</button>
            ) : (
              <button type="button" onClick={() => dispatch({ op: 'event.setStatus', ids: [e.id], status: 'rejected' })} className="inline-flex items-center gap-1 text-xs px-3 py-1 rounded-control border border-line text-danger hover:bg-danger/10 cursor-pointer" data-testid="book-event-reject"><X className="w-3.5 h-3.5" />{t('bookImport.reject')}</button>
            )}
            {e.needsReview && !rejected && (
              <button type="button" onClick={() => dispatch({ op: 'event.markReviewed', ids: [e.id] })} className="inline-flex items-center gap-1 text-xs px-3 py-1 rounded-control border border-success/40 text-success hover:bg-success/10 cursor-pointer" data-testid="book-event-reviewed"><Check className="w-3.5 h-3.5" />{t('bookImport.looksRight')}</button>
            )}
            {(e.flags || []).includes('hebrew_mismatch') && <span className="inline-flex items-center gap-1 text-caption text-danger"><AlertTriangle className="w-3 h-3" />{t('bookImport.hebrewMismatchHint')}</span>}
          </div>
        </div>
      )}
    </li>
  );
}

export default memo(EventCard);

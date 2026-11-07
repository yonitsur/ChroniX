import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Check, X, Loader2, AlertTriangle, Images, FileText, Users, Layers, Trash2, ArrowLeft, ArrowRight, CheckCircle2,
} from '../../icons/ThemeIcons';
import { useLanguage } from '../../../context/LanguageContext';
import { useHostedConfirm } from '../../storyStudio/StudioFeedback';
import { getBookImportDraft, postBookImportDraftOps } from '../../../api';
import {
  applyOps, groupedEvents, filterCounts, FILTERS, trayPhotos, finalizeSummary, eventById,
} from '../../../utils/bookImport/draftModel';
import { createDraftSync } from '../../../utils/bookImport/draftSync';
import EventCard from './EventCard';
import SourcePane from './SourcePane';
import PhotoTray from './PhotoTray';
import FinalizeDialog from './FinalizeDialog';

export const BOOK_PHOTO_MIME = 'application/x-chronix-book-photo';

/**
 * Review workspace for a big book draft: chapters on the side, events grouped by chapter in the
 * middle, the source page / photo tray on the other side. Every edit is applied locally at once and
 * synced to the server as a small operation (draftSync); Create finalizes on the server.
 */
export default function BookReviewWorkspace({ importId, initial, onFinalize, onDiscard, onExit }) {
  const { t, language, isRtl } = useLanguage();
  const confirm = useHostedConfirm();
  const lang = language === 'he' ? 'he' : 'en';
  const [draft, setDraft] = useState(initial.draft);
  const [assets, setAssets] = useState(initial.assets || { photos: {}, units: {} });
  const [syncState, setSyncState] = useState({ state: 'saved' });
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [laneId, setLaneId] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const [sideTab, setSideTab] = useState('source');
  const [mobileTab, setMobileTab] = useState('events');
  const [showFinalize, setShowFinalize] = useState(false);
  const [error, setError] = useState('');
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const syncRef = useRef(null);
  if (!syncRef.current) {
    syncRef.current = createDraftSync({
      rev: initial.rev,
      send: (baseRev, ops) => postBookImportDraftOps(importId, baseRev, ops),
      reload: async () => {
        const fresh = await getBookImportDraft(importId);
        setAssets(fresh.assets || { photos: {}, units: {} });
        return fresh;
      },
      applyOps: (serverDraft, pending) => {
        try { setDraft(applyOps(serverDraft, pending)); } catch { setDraft(serverDraft); }
      },
      onChange: (s) => setSyncState(s),
    });
  }
  useEffect(() => () => syncRef.current?.dispose(), []);

  // Signed photo links expire: refresh them before they do.
  useEffect(() => {
    const ttl = Number(initial.assets?.expiresIn || 21600) * 1000;
    const h = setInterval(() => {
      getBookImportDraft(importId).then((d) => setAssets(d.assets || {})).catch(() => {});
    }, Math.max(60_000, ttl * 0.8));
    return () => clearInterval(h);
  }, [importId, initial.assets?.expiresIn]);

  // Leaving with unsent edits: send them first (the browser may still cut a closing tab short).
  useEffect(() => {
    const onUnload = (e) => {
      if (syncRef.current?.pendingCount) {
        syncRef.current.flush().catch(() => {});
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  const dispatch = useCallback((ops) => {
    const list = Array.isArray(ops) ? ops : [ops];
    try {
      setDraft((d) => applyOps(d, list));
      syncRef.current.push(list);
      setError('');
    } catch (e) {
      setError(e?.message || t('bookImport.errorGeneric'));
    }
  }, [t]);

  const castById = useMemo(() => Object.fromEntries((draft.cast || []).map((c) => [c.id, c])), [draft.cast]);
  const eventsById = useMemo(() => eventById(draft), [draft]);
  const groups = useMemo(() => groupedEvents(draft, { filter, query, laneId: laneId || null }), [draft, filter, query, laneId]);
  const counts = useMemo(() => filterCounts(draft), [draft]);
  const tray = useMemo(() => trayPhotos(draft), [draft]);
  const summary = useMemo(() => finalizeSummary(draft), [draft]);
  const selected = selectedId ? eventsById[selectedId] : null;
  const sortedEvents = useMemo(
    () => (draft.events || []).filter((e) => e.status !== 'rejected').slice().sort((a, b) => (a.from?.year ?? 99999) - (b.from?.year ?? 99999)),
    [draft.events],
  );
  const chapterCounts = useMemo(() => {
    const out = {};
    for (const e of draft.events || []) {
      if (e.status === 'rejected') continue;
      const c = (out[e.chapterId || ''] ||= { total: 0, review: 0 });
      c.total += 1;
      if (e.needsReview) c.review += 1;
    }
    return out;
  }, [draft.events]);

  const toggleCheck = useCallback((id) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const selectEvent = useCallback((id) => {
    setSelectedId(id);
    setSideTab('source');
  }, []);

  const bulk = async (kind, extra = {}) => {
    const ids = [...checked];
    if (!ids.length) return;
    if (kind === 'accept') dispatch({ op: 'event.setStatus', ids, status: 'accepted' });
    else if (kind === 'reject') dispatch({ op: 'event.setStatus', ids, status: 'rejected' });
    else if (kind === 'reviewed') dispatch({ op: 'event.markReviewed', ids });
    else if (kind === 'lane') dispatch(ids.map((id) => ({ op: 'event.update', id, patch: { lane: extra.lane } })));
    else if (kind === 'merge' && ids.length > 1) {
      if (!(await confirm({
        body: t('bookImport.mergeConfirm', { count: ids.length }),
        confirmLabel: t('bookImport.bulkMerge'),
        cancelLabel: t('common.cancel'),
      }))) return;
      const target = ids.map((id) => eventsById[id]).filter(Boolean).sort((a, b) => (b.narrative || '').length - (a.narrative || '').length)[0];
      dispatch({ op: 'event.merge', targetId: target.id, sourceIds: ids.filter((id) => id !== target.id) });
      setSelectedId(target.id);
    }
    setChecked(new Set());
  };

  const finalize = async (options = {}) => {
    const rev = await syncRef.current.flush();
    await onFinalize(rev, options);
  };

  const saveLabel = {
    saved: t('bookImport.saved'), pending: t('bookImport.saving'), saving: t('bookImport.saving'), error: t('bookImport.saveError'),
  }[syncState.state] || '';

  const filterLabel = (f) => t(`bookImport.filter_${f}`);

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="book-review" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Toolbar */}
      <div className="shrink-0 border-b border-line bg-surface-raised px-3 sm:px-4 py-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={onExit} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-ink-muted hover:text-ink rounded-control hover:bg-surface-hover cursor-pointer">
            {isRtl ? <ArrowRight className="w-3.5 h-3.5" /> : <ArrowLeft className="w-3.5 h-3.5" />}{t('bookImport.backToStudio')}
          </button>
          <input
            value={draft.title || ''}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            onBlur={(e) => dispatch({ op: 'timeline.update', title: e.target.value })}
            dir="auto"
            aria-label={t('bookImport.timelineTitle')}
            className="flex-1 min-w-[10rem] bg-transparent text-base font-semibold text-ink px-1 py-0.5 rounded-control border border-transparent hover:border-line focus:border-accent outline-none"
            data-testid="book-review-title"
          />
          <span className={`text-caption ${syncState.state === 'error' ? 'text-danger' : 'text-ink-subtle'}`} data-testid="book-review-sync">{saveLabel}</span>
          <button type="button" onClick={onDiscard} className="hidden sm:inline-flex items-center gap-1 px-2 py-2 text-xs text-ink-muted hover:text-danger rounded-control hover:bg-surface-hover cursor-pointer">
            <Trash2 className="w-3.5 h-3.5" />{t('bookImport.discardBtn')}
          </button>
          <button
            type="button"
            onClick={() => setShowFinalize(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-accent-fg bg-accent hover:bg-accent-hover rounded-control shadow-control cursor-pointer"
            data-testid="book-review-create"
          >
            <CheckCircle2 className="w-4 h-4" />{t('bookImport.createBtn', { count: summary.events })}
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="relative flex-1 min-w-[12rem] max-w-sm">
            <Search className="w-4 h-4 text-ink-subtle absolute top-1/2 -translate-y-1/2 start-2.5" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              dir="auto"
              placeholder={t('bookImport.searchPlaceholder')}
              aria-label={t('bookImport.searchPlaceholder')}
              className="w-full bg-surface-sunken text-ink text-sm ps-8 pe-3 py-2 rounded-control border border-line outline-none focus:border-accent"
              data-testid="book-review-search"
            />
          </label>
          <div className="flex items-center gap-1 overflow-x-auto" role="tablist" aria-label={t('bookImport.filtersLabel')}>
            {FILTERS.filter((f) => f === 'all' || counts[f] > 0).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={`shrink-0 text-xs px-3 py-1 rounded-full border transition-colors cursor-pointer ${filter === f ? 'border-accent bg-accent-soft text-accent font-semibold' : 'border-line text-ink-muted hover:text-ink'}`}
                data-testid={`book-filter-${f}`}
              >
                {filterLabel(f)} <span className="tabular-nums opacity-70">{counts[f]}</span>
              </button>
            ))}
          </div>
          {(draft.lanes || []).length > 1 && (
            <select value={laneId} onChange={(e) => setLaneId(e.target.value)} className="text-xs bg-surface-sunken border border-line rounded-control px-2 py-1 text-ink" aria-label={t('bookImport.laneFilter')}>
              <option value="">{t('bookImport.allLanes')}</option>
              {draft.lanes.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
            </select>
          )}
        </div>
        {checked.size > 0 && (
          <div className="flex items-center gap-2 flex-wrap p-2 rounded-control bg-accent-soft/60 border border-accent/30" data-testid="book-bulk-bar">
            <span className="text-xs font-semibold text-ink">{t('bookImport.selectedCount', { count: checked.size })}</span>
            <button type="button" onClick={() => bulk('reviewed')} className="text-xs px-2 py-1 rounded-control hover:bg-surface-hover text-ink cursor-pointer"><Check className="w-3.5 h-3.5 inline" /> {t('bookImport.bulkReviewed')}</button>
            <button type="button" onClick={() => bulk('reject')} className="text-xs px-2 py-1 rounded-control hover:bg-surface-hover text-danger cursor-pointer" data-testid="book-bulk-reject"><X className="w-3.5 h-3.5 inline" /> {t('bookImport.bulkReject')}</button>
            <button type="button" onClick={() => bulk('accept')} className="text-xs px-2 py-1 rounded-control hover:bg-surface-hover text-ink cursor-pointer">{t('bookImport.bulkAccept')}</button>
            {checked.size > 1 && <button type="button" onClick={() => bulk('merge')} className="text-xs px-2 py-1 rounded-control hover:bg-surface-hover text-ink cursor-pointer">{t('bookImport.bulkMerge')}</button>}
            {(draft.lanes || []).length > 1 && (
              <select defaultValue="" onChange={(e) => { if (e.target.value) bulk('lane', { lane: e.target.value }); e.target.value = ''; }} className="text-xs bg-surface-sunken border border-line rounded-control px-2 py-1" aria-label={t('bookImport.bulkLane')}>
                <option value="">{t('bookImport.bulkLane')}</option>
                {draft.lanes.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
              </select>
            )}
            <button type="button" onClick={() => setChecked(new Set())} className="ms-auto text-xs px-2 py-1 text-ink-muted hover:text-ink cursor-pointer">{t('common.cancel')}</button>
          </div>
        )}
        {error && <p className="text-caption text-danger flex items-center gap-1" role="alert"><AlertTriangle className="w-3.5 h-3.5" />{error}</p>}
      </div>

      {/* Mobile tabs */}
      <div className="lg:hidden shrink-0 flex border-b border-line bg-surface-raised" role="tablist">
        {[['events', t('bookImport.tabEvents', { count: counts.all })], ['photos', t('bookImport.tabPhotos', { count: tray.length })], ['source', t('bookImport.tabSource')]].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={mobileTab === k} onClick={() => setMobileTab(k)} className={`flex-1 text-xs py-2 ${mobileTab === k ? 'text-accent font-semibold border-b-2 border-accent' : 'text-ink-muted'}`}>{label}</button>
        ))}
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_minmax(320px,420px)]">
        {/* Chapters, people, lanes */}
        <nav className="hidden lg:block min-h-0 overflow-y-auto border-e border-line bg-surface-overlay/40 p-3 space-y-4" aria-label={t('bookImport.chapters')}>
          <section>
            <h3 className="text-caption font-semibold uppercase tracking-wide text-ink-subtle mb-2 flex items-center gap-1"><Layers className="w-3.5 h-3.5" />{t('bookImport.chapters')}</h3>
            <ul className="space-y-0.5">
              {(draft.chapters || []).map((ch) => {
                const c = chapterCounts[ch.id] || { total: 0, review: 0 };
                const rejected = ch.status === 'rejected';
                return (
                  <li key={ch.id} className="group flex items-center gap-1">
                    <a href={`#book-ch-${ch.id}`} className={`flex-1 min-w-0 text-xs px-2 py-1 rounded-control hover:bg-surface-hover truncate ${rejected ? 'line-through text-ink-subtle' : 'text-ink'}`} dir="auto">{ch.title}</a>
                    <span className="text-caption tabular-nums text-ink-subtle">{c.total}</span>
                    {c.review > 0 && !rejected && <span className="text-caption tabular-nums text-warning" title={t('bookImport.needsReviewCount', { count: c.review })}>•{c.review}</span>}
                    <button
                      type="button"
                      onClick={() => dispatch({ op: 'chapter.setStatus', chapterId: ch.id, status: rejected ? 'accepted' : 'rejected' })}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-caption px-1 text-ink-muted hover:text-ink"
                      title={rejected ? t('bookImport.chapterRestore') : t('bookImport.chapterSkip')}
                      aria-label={rejected ? t('bookImport.chapterRestore') : t('bookImport.chapterSkip')}
                    >
                      {rejected ? '↺' : '×'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
          <section>
            <h3 className="text-caption font-semibold uppercase tracking-wide text-ink-subtle mb-2 flex items-center gap-1"><Users className="w-3.5 h-3.5" />{t('bookImport.people')}</h3>
            <ul className="space-y-0.5 max-h-72 overflow-y-auto">
              {(draft.cast || []).map((c) => (
                <li key={c.id}>
                  <input
                    defaultValue={c.name}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) dispatch({ op: 'person.rename', id: c.id, name: v }); }}
                    dir="auto"
                    title={(c.aliases || []).join(', ')}
                    aria-label={t('bookImport.renamePerson')}
                    className="w-full text-xs bg-transparent px-2 py-1 rounded-control border border-transparent hover:border-line focus:border-accent outline-none text-ink"
                  />
                </li>
              ))}
            </ul>
          </section>
          {draft.instructionsApplied && (
            <p className="text-caption text-ink-muted leading-snug" dir="auto">{draft.instructionsApplied}</p>
          )}
        </nav>

        {/* Events */}
        <main className={`${mobileTab === 'events' ? 'block' : 'hidden'} lg:block min-h-0 overflow-y-auto p-3 sm:p-4`} data-testid="book-events">
          {groups.length === 0 && <p className="text-sm text-ink-muted p-4 text-center">{t('bookImport.noMatches')}</p>}
          {groups.map((g) => (
            <section key={g.chapter?.id || 'none'} id={g.chapter ? `book-ch-${g.chapter.id}` : undefined} className="mb-5">
              <h3 className="sticky top-0 z-[1] bg-surface/95 backdrop-blur-sm py-2 text-sm font-semibold text-ink flex items-center gap-2" dir="auto">
                {g.chapter?.title || t('bookImport.noChapter')}
                <span className="text-caption font-normal text-ink-subtle">{g.events.length}</span>
              </h3>
              <ul className="space-y-2">
                {g.events.map((e) => (
                  <EventCard
                    key={e.id}
                    event={e}
                    lang={lang}
                    castById={castById}
                    lanes={draft.lanes}
                    photoAssets={assets.photos}
                    photosById={null}
                    selected={selectedId === e.id}
                    checked={checked.has(e.id)}
                    onSelect={selectEvent}
                    onCheck={toggleCheck}
                    dispatch={dispatch}
                  />
                ))}
              </ul>
            </section>
          ))}
        </main>

        {/* Source / photos */}
        <aside className={`${mobileTab === 'events' ? 'hidden' : 'flex'} lg:flex min-h-0 flex-col border-s border-line bg-surface-overlay/40`}>
          <div className="hidden lg:flex shrink-0 border-b border-line" role="tablist">
            {[['source', FileText, t('bookImport.tabSource')], ['photos', Images, t('bookImport.tabPhotos', { count: tray.length })]].map(([k, Icon, label]) => (
              <button key={k} type="button" role="tab" aria-selected={sideTab === k} onClick={() => setSideTab(k)} className={`flex-1 inline-flex items-center justify-center gap-2 text-xs py-2 ${sideTab === k ? 'text-accent font-semibold border-b-2 border-accent' : 'text-ink-muted hover:text-ink'}`} data-testid={`book-side-${k}`}>
                <Icon className="w-3.5 h-3.5" />{label}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {/* Desktop: the side tabs decide; mobile: the bottom-level tabs (events hides this pane). */}
            {(mobileTab === 'events' ? sideTab : mobileTab) === 'photos' ? (
              <PhotoTray
                draft={draft}
                assets={assets}
                events={sortedEvents}
                selectedEvent={selected}
                dispatch={dispatch}
              />
            ) : (
              <SourcePane
                importId={importId}
                draft={draft}
                event={selected}
                assets={assets}
                onSelectEvent={selectEvent}
              />
            )}
          </div>
        </aside>
      </div>

      {showFinalize && (
        <FinalizeDialog
          summary={summary}
          onClose={() => setShowFinalize(false)}
          onConfirm={finalize}
        />
      )}
      {syncState.state === 'saving' && <span className="sr-only" aria-live="polite"><Loader2 className="w-3 h-3" /></span>}
    </div>
  );
}

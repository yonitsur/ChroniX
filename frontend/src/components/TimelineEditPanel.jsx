import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
  Pencil, X, Plus, Trash2, Search, Undo2, Check, Images, Eye, FileText, Calendar, Layers, Tag,
  ArrowUp, BookUser, ArrowRight, ArrowLeft,
} from './icons/ThemeIcons';
import { useLanguage } from '../context/LanguageContext';
import { getTextDir } from '../utils/textDirection';
import { EVENT_DRAWER_MIN_WIDTH, EVENT_DRAWER_KEY_STEP, clampEventDrawerWidth } from '../utils/drawerLayout';
import { filterEventsByQuery } from '../utils/photoTray';
import { getDistinctCategories, getCategoryColor } from '../data/laneColors';
import {
  updateTimelineMeta, addLane, renameLane, setLaneColor, moveLane, deleteLane,
  countEventsInLane, listTopics, renameTopic, deleteTopic,
  deleteEvents, setTopicForEvents, setLaneForEvents,
} from '../utils/timelineEditing';
import PanelNavButtons from './PanelNavButtons';
import AiPolishButton from './AiPolishButton';
import PhotoTrayPanel from './PhotoTrayPanel';
import useIsMobileViewport from '../hooks/useIsMobileViewport';

const TABS = [
  { id: 'details', Icon: FileText },
  { id: 'events', Icon: Calendar },
  { id: 'organize', Icon: Layers },
  { id: 'photos', Icon: Images },
];
// Older callers may still ask for the pre-merge tab names.
const TAB_ALIASES = { overview: 'details', lanes: 'organize', topics: 'organize' };

const inputCls =
  'w-full min-w-0 rounded-control border border-line bg-surface-raised px-3 py-2 text-sm text-ink placeholder-ink-faint ' +
  'outline-none focus:border-accent focus:ring-2 focus:ring-accent-ring/20 shadow-control transition-colors';
const btnCls =
  'inline-flex items-center justify-center gap-2 rounded-control border border-line bg-surface-raised px-3 py-2 text-xs font-medium text-ink ' +
  'hover:bg-surface-hover hover:border-line-strong cursor-pointer disabled:opacity-40 disabled:cursor-default transition-colors';
const primaryBtnCls =
  'inline-flex items-center justify-center gap-2 rounded-control bg-accent px-3 py-2 text-xs font-semibold text-accent-fg ' +
  'hover:bg-accent-hover shadow-control cursor-pointer disabled:opacity-40 disabled:cursor-default transition-colors';
const iconBtnCls =
  'w-8 h-8 inline-flex items-center justify-center rounded-control text-ink-subtle hover:text-ink hover:bg-surface-hover ' +
  'cursor-pointer disabled:opacity-25 disabled:cursor-default transition-colors';
const dangerIconBtnCls = `${iconBtnCls} hover:!text-danger hover:!bg-danger-soft`;
const cardCls = 'rounded-panel border border-line bg-surface-raised/60 shadow-2xs';

function SectionTitle({ Icon, title, hint, children }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          {Icon && <Icon className="w-4 h-4 text-ink-subtle shrink-0" />}
          {title}
        </h3>
        {hint && <p className="mt-0.5 text-caption text-ink-subtle">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function FieldLabel({ label, count, max, children }) {
  return (
    <span className="flex items-center justify-between gap-2 mb-2 text-xs font-medium text-ink-muted">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        {children}
        {max != null && <span className="text-caption text-ink-subtle tabular-nums">{count}/{max}</span>}
      </span>
    </span>
  );
}

function CountBadge({ value, title }) {
  return (
    <span title={title} className="shrink-0 min-w-[1.75rem] px-2 py-0.5 rounded-full bg-surface-active text-ink-muted text-caption font-semibold tabular-nums text-center">
      {value}
    </span>
  );
}

// Sticky bar at the bottom of the scroll area for tabs that save explicitly.
function SaveBar({ visible, onDiscard, onSave, canSave = true }) {
  const { t } = useLanguage();
  if (!visible) return null;
  return (
    <div className="sticky bottom-0 -mx-4 mt-4 px-4 py-3 border-t border-line bg-surface-overlay/95 backdrop-blur-md flex items-center gap-2 animate-in fade-in slide-in-from-bottom-1 duration-150">
      <span className="flex-1 min-w-0 truncate text-caption font-medium text-ink-muted flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-warning shrink-0" />
        {t('editPanel.unsavedChanges')}
      </span>
      <button type="button" className={btnCls} onClick={onDiscard}>{t('editPanel.discard')}</button>
      <button type="button" className={primaryBtnCls} onClick={onSave} disabled={!canSave} data-testid="edit-details-save">
        <Check className="w-3.5 h-3.5" /> {t('editPanel.save')}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Details (title, description, overview)
// ---------------------------------------------------------------------------------------------

function DetailsTab({ timeline, onApply }) {
  const { t, isRtl } = useLanguage();
  const initial = {
    title: timeline.title || '',
    description: timeline.description || '',
    overview: timeline.overview || '',
  };
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [overview, setOverview] = useState(initial.overview);
  const [mode, setMode] = useState('write');
  useEffect(() => {
    setTitle(timeline.title || '');
    setDescription(timeline.description || '');
    setOverview(timeline.overview || '');
  }, [timeline.id, timeline.title, timeline.description, timeline.overview]);

  const dirty = title !== initial.title || description !== initial.description || overview !== initial.overview;
  const discard = () => {
    setTitle(initial.title);
    setDescription(initial.description);
    setOverview(initial.overview);
  };
  const save = () => onApply(updateTimelineMeta(timeline, { title: title.trim(), description, overview }));

  return (
    <div className="space-y-4">
      <section className={`${cardCls} p-4 space-y-4`}>
        <SectionTitle Icon={FileText} title={t('editPanel.basicsSection')} />
        <div>
          <FieldLabel label={t('editPanel.titleLabel')} count={title.length} max={600}>
            <AiPolishButton variant="icon" field="timeline_title" value={title} onChange={setTitle} context={description.slice(0, 300)} maxLength={600} timelineId={timeline.id} />
          </FieldLabel>
          <input
            className={`${inputCls} text-base font-semibold`}
            dir={getTextDir(title, isRtl)}
            value={title}
            maxLength={600}
            aria-label={t('editPanel.titleLabel')}
            onChange={(e) => setTitle(e.target.value)}
            data-testid="edit-title"
          />
        </div>
        <div>
          <FieldLabel label={t('editPanel.descriptionLabel')} count={description.length} max={6000}>
            <AiPolishButton field="timeline_description" value={description} onChange={setDescription} context={title} maxLength={6000} timelineId={timeline.id} />
          </FieldLabel>
          <textarea
            className={`${inputCls} resize-y leading-relaxed`}
            dir={getTextDir(description, isRtl)}
            rows={3}
            maxLength={6000}
            aria-label={t('editPanel.descriptionLabel')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </section>

      <section className={`${cardCls} p-4`}>
        <SectionTitle Icon={Eye} title={t('editPanel.overviewSection')} hint={t('editPanel.overviewHint')}>
          <div className="flex items-center gap-2 shrink-0">
          {mode === 'write' && (
            <AiPolishButton field="timeline_overview" value={overview} onChange={setOverview} context={title} maxLength={80000} timelineId={timeline.id} />
          )}
          <div className="inline-flex p-0.5 rounded-control bg-surface-sunken border border-line shrink-0" role="tablist">
            {['write', 'preview'].map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 rounded-[6px] text-xs font-medium cursor-pointer transition-colors ${
                  mode === m ? 'bg-surface-raised text-ink shadow-control' : 'text-ink-subtle hover:text-ink'
                }`}
              >
                {m === 'write' ? t('editPanel.write') : t('editPanel.preview')}
              </button>
            ))}
          </div>
          </div>
        </SectionTitle>
        {mode === 'preview' ? (
          <div
            className="rounded-control border border-line bg-surface-sunken p-3 text-sm text-ink min-h-[260px] leading-relaxed [&_p]:mb-3 [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:list-decimal [&_ol]:ps-5 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-bold [&_h3]:font-semibold [&_h1]:mb-2 [&_h2]:mb-2 [&_h3]:mb-2"
            dir={getTextDir(overview, isRtl)}
          >
            {overview.trim()
              ? <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={{ img: () => null }}>{overview}</ReactMarkdown>
              : <p className="text-ink-subtle italic">{t('editPanel.overviewEmpty')}</p>}
          </div>
        ) : (
          <textarea
            className={`${inputCls} min-h-[260px] resize-y font-mono text-xs leading-relaxed`}
            dir={getTextDir(overview, isRtl)}
            maxLength={80000}
            value={overview}
            onChange={(e) => setOverview(e.target.value)}
            data-testid="edit-overview"
          />
        )}
      </section>

      <SaveBar visible={dirty} onDiscard={discard} onSave={save} canSave={Boolean(title.trim())} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------

function EventsTab({ timeline, onApply, onEditEvent, onAddEvent }) {
  const { t, isRtl, formatDatePart } = useLanguage();
  const [query, setQuery] = useState('');
  const [noPhotoOnly, setNoPhotoOnly] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkLane, setBulkLane] = useState('');
  const [topicDraft, setTopicDraft] = useState('');
  const articles = timeline.articles || [];
  const lanes = timeline.lanes || [];
  const categories = useMemo(() => getDistinctCategories(articles), [articles]);
  const hasPhoto = (a) => typeof a.imageUrl === 'string' && Boolean(a.imageUrl.trim());
  const noPhotoCount = useMemo(() => articles.filter((a) => !hasPhoto(a)).length, [articles]);
  const visible = useMemo(() => {
    const found = filterEventsByQuery(articles, query);
    return noPhotoOnly ? found.filter((a) => !hasPhoto(a)) : found;
  }, [articles, query, noPhotoOnly]);

  // Drop selections for events that no longer exist.
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(articles.map((a) => String(a.id)));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [articles]);

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    const key = String(id);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const allVisibleSelected = visible.length > 0 && visible.every((a) => selected.has(String(a.id)));
  const someVisibleSelected = !allVisibleSelected && visible.some((a) => selected.has(String(a.id)));
  const selectAllRef = useRef(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someVisibleSelected;
  }, [someVisibleSelected]);
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((a) => String(a.id))));
  const laneOf = (a) => lanes.find((l) => String(l.id) === String(a.lane)) || null;

  const deleteSelected = () => {
    if (!selected.size || !window.confirm(t('editPanel.deleteEventsConfirm', { count: selected.size }))) return;
    onApply(deleteEvents(timeline, selected), { removedEventIds: [...selected] });
    setSelected(new Set());
  };
  const deleteOne = (a) => {
    if (!window.confirm(t('eventDrawer.deleteConfirm'))) return;
    onApply(deleteEvents(timeline, [a.id]), { removedEventIds: [String(a.id)] });
  };
  const applyLane = () => {
    if (bulkLane === '') return;
    onApply(setLaneForEvents(timeline, selected, bulkLane === '__none__' ? null : bulkLane));
    setBulkLane('');
  };

  if (articles.length === 0) {
    return (
      <div className="flex flex-col items-center text-center py-12 px-4">
        <div className="w-14 h-14 rounded-full bg-accent-soft text-accent flex items-center justify-center mb-4">
          <Calendar className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-ink">{t('editPanel.eventsEmptyTitle')}</h3>
        <p className="mt-1 mb-4 text-xs text-ink-subtle max-w-[16rem]">{t('editPanel.eventsEmptyBody')}</p>
        <button type="button" className={`${primaryBtnCls} px-4 py-2`} onClick={onAddEvent} data-testid="edit-add-event">
          <Plus className="w-3.5 h-3.5" /> {t('editPanel.addEvent')}
        </button>
      </div>
    );
  }

  const filterChip = (active) =>
    `inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border cursor-pointer transition-colors ${
      active ? 'bg-accent-soft border-accent/50 text-accent' : 'bg-surface-raised border-line text-ink-muted hover:text-ink hover:border-line-strong'
    }`;

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex items-center gap-2 mb-3">
        <label className="flex-1 min-w-0 flex items-center gap-2 rounded-control border border-line bg-surface-raised px-3 py-2 shadow-control focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-ring/20 transition-colors">
          <Search className="w-4 h-4 text-ink-subtle shrink-0" />
          <input
            type="search"
            className="flex-1 min-w-0 bg-transparent text-sm outline-none text-ink placeholder-ink-faint [&::-webkit-search-cancel-button]:hidden"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('photoTray.searchPlaceholder')}
            data-testid="edit-events-search"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="p-0.5 rounded text-ink-subtle hover:text-ink cursor-pointer" aria-label={t('editPanel.clearSearch')}>
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </label>
        <button type="button" className={`${primaryBtnCls} py-2`} onClick={onAddEvent} data-testid="edit-add-event">
          <Plus className="w-3.5 h-3.5" /> {t('editPanel.addEvent')}
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <button type="button" className={filterChip(!noPhotoOnly)} onClick={() => setNoPhotoOnly(false)} aria-pressed={!noPhotoOnly}>
            {t('editPanel.filterAll')} <span className="tabular-nums opacity-70">{articles.length}</span>
          </button>
          <button type="button" className={filterChip(noPhotoOnly)} onClick={() => setNoPhotoOnly(true)} aria-pressed={noPhotoOnly} disabled={noPhotoCount === 0 && !noPhotoOnly}>
            <Images className="w-3 h-3" /> {t('editPanel.filterNoPhoto')} <span className="tabular-nums opacity-70">{noPhotoCount}</span>
          </button>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-ink-muted cursor-pointer select-none">
          <input ref={selectAllRef} type="checkbox" className="w-3.5 h-3.5 accent-[rgb(var(--accent))] cursor-pointer" checked={allVisibleSelected} onChange={toggleAll} />
          {t('editPanel.selectAll', { count: visible.length })}
        </label>
      </div>

      <ul className={`${cardCls} divide-y divide-line overflow-hidden`} data-testid="edit-events-list">
        {visible.length === 0 && (
          <li className="py-8 px-4 text-center">
            <p className="text-xs text-ink-subtle">{t('photoTray.noResults')}</p>
            {query && (
              <button type="button" className="mt-2 text-xs font-medium text-accent hover:underline cursor-pointer" onClick={() => setQuery('')}>
                {t('editPanel.clearSearch')}
              </button>
            )}
          </li>
        )}
        {visible.map((a) => {
          const isSelected = selected.has(String(a.id));
          const lane = laneOf(a);
          const topic = String(a.category ?? '').trim();
          const year = a.from ? formatDatePart(a.from) : '';
          return (
            <li
              key={a.id}
              className={`group flex items-center gap-3 px-3 py-2 transition-colors ${isSelected ? 'bg-accent-soft/50' : 'hover:bg-surface-hover/70'}`}
            >
              <input
                type="checkbox"
                className="w-3.5 h-3.5 shrink-0 accent-[rgb(var(--accent))] cursor-pointer"
                checked={isSelected}
                onChange={() => toggle(a.id)}
                aria-label={a.title}
              />
              <button
                type="button"
                onClick={() => onEditEvent(a)}
                className="flex-1 min-w-0 flex items-center gap-3 text-start cursor-pointer"
                title={t('editPanel.editEvent')}
              >
                <span className="w-10 h-10 shrink-0 rounded-lg overflow-hidden bg-surface-sunken border border-line flex items-center justify-center">
                  {hasPhoto(a)
                    ? <img src={a.imageUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
                    : <Images className="w-4 h-4 text-ink-subtle" />}
                </span>
                <span className="flex-1 min-w-0" dir={getTextDir(a.title || '', isRtl)}>
                  <span className="block truncate text-sm font-medium text-ink group-hover:text-accent transition-colors">{a.title}</span>
                  <span className="flex items-center gap-2 mt-0.5 min-w-0 text-caption text-ink-subtle">
                    {year && <span className="shrink-0 tabular-nums">{year}</span>}
                    {lane && (
                      <span className="inline-flex items-center gap-1 min-w-0">
                        {year && <span className="text-ink-subtle">·</span>}
                        <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: lane.color || '#2563a2' }} />
                        <span className="truncate">{lane.title}</span>
                      </span>
                    )}
                    {topic && (
                      <span className="inline-flex items-center gap-1 min-w-0">
                        {(year || lane) && <span className="text-ink-subtle">·</span>}
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: getCategoryColor(topic, categories) }} />
                        <span className="truncate">{topic}</span>
                      </span>
                    )}
                  </span>
                </span>
              </button>
              <span className="flex items-center shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <button type="button" className={iconBtnCls} onClick={() => onEditEvent(a)} title={t('editPanel.editEvent')} aria-label={t('editPanel.editEvent')}>
                  <Pencil className="w-4 h-4" />
                </button>
                <button type="button" className={dangerIconBtnCls} onClick={() => deleteOne(a)} title={t('common.delete')} aria-label={t('common.delete')}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      {selected.size > 0 && (
        <div className="sticky bottom-0 -mx-4 mt-3 px-4 py-3 border-t border-line bg-surface-overlay/95 backdrop-blur-md space-y-2 animate-in fade-in slide-in-from-bottom-1 duration-150" data-testid="edit-bulk-bar">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-ink">{t('editPanel.selectedCount', { count: selected.size })}</span>
            <span className="flex items-center gap-1">
              <button type="button" className={`${btnCls} !text-danger hover:!bg-danger-soft hover:!border-danger/40`} onClick={deleteSelected} data-testid="edit-bulk-delete">
                <Trash2 className="w-3.5 h-3.5" /> {t('common.delete')}
              </button>
              <button type="button" className={iconBtnCls} onClick={() => setSelected(new Set())} title={t('editPanel.clearSelection')} aria-label={t('editPanel.clearSelection')}>
                <X className="w-4 h-4" />
              </button>
            </span>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <select className={`${inputCls} py-2 text-xs cursor-pointer`} value={bulkLane} onChange={(e) => setBulkLane(e.target.value)} aria-label={t('editPanel.moveToLane')}>
              <option value="">{t('editPanel.moveToLane')}</option>
              <option value="__none__">{t('editPanel.noLane')}</option>
              {lanes.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
            </select>
            <button type="button" className={btnCls} onClick={applyLane} disabled={bulkLane === ''}>{t('editPanel.apply')}</button>
            <input
              className={`${inputCls} py-2 text-xs`}
              value={topicDraft}
              onChange={(e) => setTopicDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onApply(setTopicForEvents(timeline, selected, topicDraft));
                }
              }}
              placeholder={t('editPanel.topicPlaceholder')}
              list="edit-topic-options"
            />
            <datalist id="edit-topic-options">{listTopics(timeline).map((tp) => <option key={tp.name} value={tp.name} />)}</datalist>
            <button type="button" className={btnCls} onClick={() => onApply(setTopicForEvents(timeline, selected, topicDraft))}>
              {topicDraft.trim() ? t('editPanel.setTopic') : t('editPanel.clearTopic')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Organize: lanes + topics
// ---------------------------------------------------------------------------------------------

function InlineRename({ value, onCommit, onCancel }) {
  const { isRtl } = useLanguage();
  const [draft, setDraft] = useState(value);
  return (
    <input
      autoFocus
      className={`${inputCls} py-1 text-sm`}
      dir={getTextDir(draft, isRtl)}
      value={draft}
      maxLength={300}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(draft);
        else if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
    />
  );
}

function RenameableName({ name, hint, onClick }) {
  const { isRtl } = useLanguage();
  return (
    <button
      type="button"
      className="group/name flex-1 min-w-0 flex items-center gap-2 text-start text-sm font-medium text-ink cursor-text rounded px-1 -mx-1 py-0.5 hover:bg-surface-hover"
      dir={getTextDir(name || '', isRtl)}
      onClick={onClick}
      title={hint}
    >
      <span className="truncate">{name}</span>
      <Pencil className="w-3 h-3 shrink-0 text-ink-subtle opacity-0 group-hover/name:opacity-100 transition-opacity" />
    </button>
  );
}

function LanesSection({ timeline, onApply }) {
  const { t } = useLanguage();
  const lanes = timeline.lanes || [];
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [moveTo, setMoveTo] = useState('');

  const commitRename = (laneId, value) => {
    if (value.trim()) onApply(renameLane(timeline, laneId, value));
    setEditingId(null);
  };

  return (
    <section>
      <SectionTitle Icon={Layers} title={t('editPanel.lanesSection')} hint={t('editPanel.lanesHint')} />
      <div className={`${cardCls} overflow-hidden`}>
        {lanes.length === 0 && <p className="px-4 py-5 text-center text-xs text-ink-subtle">{t('editPanel.noLanes')}</p>}
        <ul className="divide-y divide-line" data-testid="edit-lanes-list">
          {lanes.map((lane, idx) => {
            const count = countEventsInLane(timeline, lane.id);
            const color = /^#[0-9a-f]{6}$/i.test(lane.color || '') ? lane.color : '#2563a2';
            const isDeleting = deletingId != null && String(deletingId) === String(lane.id);
            return (
              <li key={lane.id} className="group">
                <div className="flex items-center gap-2 px-3 py-2">
                  <label
                    className="relative w-6 h-6 shrink-0 rounded-md border border-black/10 shadow-2xs cursor-pointer overflow-hidden ring-offset-1 hover:ring-2 hover:ring-line-strong"
                    style={{ backgroundColor: color }}
                    title={t('editPanel.laneColor')}
                  >
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => onApply(setLaneColor(timeline, lane.id, e.target.value))}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      aria-label={t('editPanel.laneColor')}
                    />
                  </label>
                  {editingId != null && String(editingId) === String(lane.id) ? (
                    <InlineRename value={lane.title || ''} onCommit={(v) => commitRename(lane.id, v)} onCancel={() => setEditingId(null)} />
                  ) : (
                    <RenameableName name={lane.title} hint={t('editPanel.clickToRename')} onClick={() => setEditingId(lane.id)} />
                  )}
                  <CountBadge value={count} title={t('editPanel.eventsCount', { count })} />
                  <span className="flex items-center shrink-0">
                    <button type="button" className={iconBtnCls} disabled={idx === 0} onClick={() => onApply(moveLane(timeline, lane.id, -1))} aria-label={t('editPanel.moveUp')} title={t('editPanel.moveUp')}>
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" className={iconBtnCls} disabled={idx === lanes.length - 1} onClick={() => onApply(moveLane(timeline, lane.id, 1))} aria-label={t('editPanel.moveDown')} title={t('editPanel.moveDown')}>
                      <ArrowUp className="w-3.5 h-3.5 rotate-180" />
                    </button>
                    <button
                      type="button"
                      className={dangerIconBtnCls}
                      onClick={() => { setDeletingId(isDeleting ? null : lane.id); setMoveTo(''); }}
                      aria-label={t('common.delete')}
                      title={t('common.delete')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </div>
                {isDeleting && (
                  <div className="mx-3 mb-3 p-3 rounded-control border border-danger/30 bg-danger-soft/60 space-y-2 animate-in fade-in duration-150" data-testid="edit-lane-delete-confirm">
                    {count > 0 ? (
                      <label className="block">
                        <span className="block mb-1 text-xs text-ink">{t('editPanel.laneDeleteMove', { count })}</span>
                        <select className={`${inputCls} py-2 text-xs cursor-pointer`} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                          <option value="">{t('editPanel.noLane')}</option>
                          {lanes.filter((l) => String(l.id) !== String(lane.id)).map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                        </select>
                      </label>
                    ) : (
                      <p className="text-xs text-ink">{t('editPanel.laneDeleteEmpty')}</p>
                    )}
                    <div className="flex justify-end gap-2">
                      <button type="button" className={btnCls} onClick={() => setDeletingId(null)}>{t('common.cancel')}</button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 rounded-control bg-danger px-3 py-2 text-xs font-semibold text-danger-fg hover:opacity-90 cursor-pointer shadow-control"
                        onClick={() => { onApply(deleteLane(timeline, lane.id, moveTo || null)); setDeletingId(null); }}
                      >
                        <Trash2 className="w-3.5 h-3.5" /> {t('editPanel.confirmDelete')}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <form
          className="flex items-center gap-2 px-3 py-2 border-t border-line bg-surface-sunken/40"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) {
              onApply(addLane(timeline, newName));
              setNewName('');
            }
          }}
        >
          <span className="w-6 h-6 shrink-0 rounded-md border border-dashed border-line-strong flex items-center justify-center text-ink-subtle">
            <Plus className="w-3.5 h-3.5" />
          </span>
          <input
            className="flex-1 min-w-0 bg-transparent text-sm text-ink placeholder-ink-faint outline-none py-1"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('editPanel.newLanePlaceholder')}
            maxLength={300}
            data-testid="edit-new-lane"
          />
          {newName.trim() && (
            <button type="submit" className={primaryBtnCls}>{t('editPanel.addLane')}</button>
          )}
        </form>
      </div>
    </section>
  );
}

function TopicsSection({ timeline, onApply }) {
  const { t } = useLanguage();
  const topics = useMemo(() => listTopics(timeline), [timeline]);
  const categories = useMemo(() => getDistinctCategories(timeline.articles || []), [timeline.articles]);
  const [editing, setEditing] = useState(null);
  const commit = (value) => {
    if (editing && value.trim() && value.trim() !== editing) onApply(renameTopic(timeline, editing, value));
    setEditing(null);
  };
  return (
    <section>
      <SectionTitle Icon={Tag} title={t('editPanel.topicsSection')} hint={t('editPanel.topicsHint')} />
      <div className={`${cardCls} overflow-hidden`}>
        {topics.length === 0 && <p className="px-4 py-5 text-center text-xs text-ink-subtle">{t('editPanel.noTopics')}</p>}
        <ul className="divide-y divide-line" data-testid="edit-topics-list">
          {topics.map((tp) => (
            <li key={tp.name} className="group flex items-center gap-2 px-3 py-2">
              <span className="w-6 h-6 shrink-0 flex items-center justify-center">
                <span className="w-3 h-3 rounded-full ring-1 ring-black/10 dark:ring-white/20" style={{ backgroundColor: getCategoryColor(tp.name, categories) }} />
              </span>
              {editing === tp.name ? (
                <InlineRename value={tp.name} onCommit={commit} onCancel={() => setEditing(null)} />
              ) : (
                <RenameableName name={tp.name} hint={t('editPanel.topicRenameHint')} onClick={() => setEditing(tp.name)} />
              )}
              <CountBadge value={tp.count} title={t('editPanel.eventsCount', { count: tp.count })} />
              <button
                type="button"
                className={dangerIconBtnCls}
                onClick={() => { if (window.confirm(t('editPanel.deleteTopicConfirm', { name: tp.name }))) onApply(deleteTopic(timeline, tp.name)); }}
                aria-label={t('common.delete')}
                title={t('common.delete')}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function OrganizeTab({ timeline, onApply }) {
  return (
    <div className="space-y-6">
      <LanesSection timeline={timeline} onApply={onApply} />
      <TopicsSection timeline={timeline} onApply={onApply} />
    </div>
  );
}

/**
 * Docked "Edit Timeline" side panel: details & overview, events, lanes & topics, and the photo
 * tray. All edits flow through `onApply(nextTimeline, meta)`, which persists them.
 */
export default function TimelineEditPanel({
  timeline,
  isOpen,
  onClose,
  panelNav = null,
  style,
  width = null,
  onWidthChange,
  onApply,
  onUndo,
  canUndo = false,
  onEditEvent,
  onAddEvent,
  photos,
  setPhotos,
  onAssignPhoto,
  onUndoPhoto,
  canUndoPhoto = false,
  initialTab = 'details',
  onOpenStoryStudio = null,
}) {
  const { t, isRtl } = useLanguage();
  const isMobile = useIsMobileViewport();
  const [tab, setTab] = useState(TAB_ALIASES[initialTab] || initialTab);
  const articles = timeline?.articles || [];
  const scrollRef = useRef(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  // Drag-to-resize (desktop), same behavior as the overview panel; width is shared via onWidthChange.
  const drawerRef = useRef(null);
  const resizeDragRef = useRef(null);
  const [liveWidth, setLiveWidth] = useState(null);
  const canResize = Boolean(onWidthChange) && !isMobile;

  const handleResizePointerDown = (e) => {
    if (e.button !== 0 || !drawerRef.current) return;
    e.preventDefault();
    const startWidth = drawerRef.current.getBoundingClientRect().width;
    resizeDragRef.current = { startX: e.clientX, startWidth, width: startWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
    setLiveWidth(startWidth);
  };
  const handleResizePointerMove = (e) => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    drag.width = clampEventDrawerWidth(drag.startWidth + e.clientX - drag.startX);
    setLiveWidth(drag.width);
  };
  const handleResizePointerEnd = () => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    resizeDragRef.current = null;
    setLiveWidth(null);
    if (Math.abs(drag.width - drag.startWidth) >= 1) onWidthChange(drag.width);
  };
  const handleResizeKeyDown = (e) => {
    const current = drawerRef.current?.getBoundingClientRect().width || EVENT_DRAWER_MIN_WIDTH;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? EVENT_DRAWER_KEY_STEP : -EVENT_DRAWER_KEY_STEP;
      onWidthChange(clampEventDrawerWidth(current + delta));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onWidthChange(null);
    }
  };
  const effectiveWidth = liveWidth ?? (width ? clampEventDrawerWidth(width) : null);

  return (
    <aside
      ref={drawerRef}
      style={isMobile ? undefined : { ...style, ...(effectiveWidth ? { width: effectiveWidth } : {}) }}
      dir={isRtl ? 'rtl' : 'ltr'}
      role="complementary"
      inert={!isOpen}
      aria-label={t('editPanel.title')}
      data-testid="timeline-edit-panel"
      className={`chronix-side-drawer ${
        isMobile
          ? 'fixed inset-x-0 bottom-0 w-full h-[80vh] rounded-t-3xl border-t overflow-hidden'
          : 'absolute inset-y-0 left-[calc(52px+env(safe-area-inset-left,0px))] right-auto w-[340px] md:w-[380px] lg:w-[440px] max-w-[calc(100vw-56px-env(safe-area-inset-left,0px))] h-full rounded-none border-r'
      } border-line bg-surface-overlay shadow-2xl flex flex-col font-sans ${
        liveWidth != null ? 'select-none' : 'transition-all duration-300 ease-in-out'
      } z-50 ${
        isOpen
          ? (isMobile ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-x-0 opacity-100 pointer-events-auto')
          : (isMobile ? 'translate-y-full opacity-0 pointer-events-none' : '-translate-x-full opacity-0 pointer-events-none')
      }`}
    >
      {canResize && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('eventDrawer.resize')}
          title={t('eventDrawer.resize')}
          tabIndex={0}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerEnd}
          onPointerCancel={handleResizePointerEnd}
          onDoubleClick={() => onWidthChange(null)}
          onKeyDown={handleResizeKeyDown}
          style={{ touchAction: 'none' }}
          className="group/resize absolute top-0 bottom-0 -right-1.5 w-3 z-30 flex items-center justify-center cursor-col-resize focus-visible:outline-none"
        >
          <span
            className={`h-full w-0.5 transition-colors ${
              liveWidth != null ? 'bg-ink-subtle' : 'bg-transparent group-hover/resize:bg-line-strong group-focus-visible/resize:bg-ink-subtle'
            }`}
          />
          <span
            className={`absolute top-1/2 -translate-y-1/2 h-10 w-1.5 rounded-full border border-line bg-surface-raised shadow-control transition-opacity ${
              liveWidth != null ? 'opacity-100' : 'opacity-0 group-hover/resize:opacity-100 group-focus-visible/resize:opacity-100'
            }`}
          />
        </div>
      )}
      {isMobile && (
        <div className="w-full flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-line-strong" />
        </div>
      )}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-line shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {panelNav && (<><PanelNavButtons nav={panelNav} className="-ms-2" /><span className="w-px h-5 bg-line shrink-0" aria-hidden="true" /></>)}
          <span className="w-8 h-8 shrink-0 rounded-control bg-accent-soft text-accent flex items-center justify-center">
            <Pencil className="w-4 h-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-base font-semibold text-ink leading-tight">{t('editPanel.title')}</span>
            <span className="block truncate text-caption text-ink-subtle" dir={getTextDir(timeline?.title || '', isRtl)}>
              {timeline?.title || t('editPanel.untitled')}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {canUndo && (
            <button type="button" className={btnCls} onClick={onUndo} data-testid="edit-undo" title={t('editPanel.undo')}>
              <Undo2 className="w-3.5 h-3.5" /> {t('editPanel.undo')}
            </button>
          )}
          <button type="button" onClick={onClose} className="min-w-[40px] min-h-[40px] flex items-center justify-center p-2 text-ink-subtle hover:text-ink hover:bg-surface-hover rounded-full cursor-pointer" title={t('common.close')} aria-label={t('common.close')}>
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {onOpenStoryStudio && (
        <button
          type="button"
          onClick={onOpenStoryStudio}
          data-testid="edit-open-story-studio"
          className="group flex items-center gap-3 mx-3 mt-3 px-3 py-3 rounded-panel border border-accent/30 bg-accent-soft/60 hover:bg-accent-soft text-start transition-colors cursor-pointer shrink-0"
        >
          <span className="w-8 h-8 shrink-0 rounded-control bg-surface-raised text-accent flex items-center justify-center">
            <BookUser className="w-4 h-4" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-xs font-semibold text-ink">{t('storyStudio.openInStudio')}</span>
            <span className="block text-caption text-ink-muted leading-snug">{t('storyStudio.openInStudioDesc')}</span>
          </span>
          {isRtl ? <ArrowLeft className="w-4 h-4 text-accent shrink-0" /> : <ArrowRight className="w-4 h-4 text-accent shrink-0" />}
        </button>
      )}

      <div role="tablist" className="flex items-stretch gap-1 px-3 border-b border-line shrink-0 select-none">
        {TABS.map(({ id, Icon }) => {
          const isActive = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(id)}
              data-testid={`edit-tab-${id}`}
              className={`flex-1 min-w-0 flex items-center justify-center gap-2 px-2 py-3 -mb-px border-b-2 text-xs font-semibold transition-colors cursor-pointer ${
                isActive ? 'border-accent text-ink' : 'border-transparent text-ink-subtle hover:text-ink'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-accent' : ''}`} />
              <span className="truncate">{t(`editPanel.tabs.${id}`)}</span>
              {id === 'events' && (
                <span className={`px-2 rounded-full text-caption tabular-nums ${isActive ? 'bg-accent-soft text-accent' : 'bg-surface-active text-ink-muted'}`}>
                  {articles.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-4 text-start">
        {timeline && tab === 'details' && <DetailsTab timeline={timeline} onApply={onApply} />}
        {timeline && tab === 'events' && <EventsTab timeline={timeline} onApply={onApply} onEditEvent={onEditEvent} onAddEvent={onAddEvent} />}
        {timeline && tab === 'organize' && <OrganizeTab timeline={timeline} onApply={onApply} />}
        {timeline && tab === 'photos' && (
          <PhotoTrayPanel
            photos={photos}
            setPhotos={setPhotos}
            articles={articles}
            onAssign={onAssignPhoto}
            onUndo={onUndoPhoto}
            canUndo={canUndoPhoto}
          />
        )}
      </div>
    </aside>
  );
}

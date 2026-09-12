import React, { useState, useEffect } from 'react';
import { X, BookUser, FileText, LayoutTemplate, Users, User, Network, ShieldCheck, Layers, Plus, Trash2 } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { PERSONAL_TEMPLATE_META, PERSONAL_TITLE_IDEAS, buildPersonalTimeline, getTemplateLanes } from '../data/personalTemplates';

const TEMPLATE_ICONS = { Users, User, Network };

// Blank-canvas default topics list (one empty lane the user can name).
const blankLanes = () => [{ id: 'main', title: '' }];

/**
 * "Build Your Own Timeline" creation modal.
 * Collects a title/description, an editable topics (lanes) list, and a start point
 * (blank canvas or a starter template), then hands a fully-built, ready-to-edit
 * personal TimelineData object to onCreate.
 */
export default function PersonalTimelineModal({ isOpen, onClose, onCreate }) {
  const { t, language, isRtl } = useLanguage();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startMode, setStartMode] = useState('blank'); // 'blank' | template key
  const [lanes, setLanes] = useState(blankLanes);
  const [error, setError] = useState('');

  // Reset the form each time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setDescription('');
      setStartMode('blank');
      setLanes(blankLanes());
      setError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const usingTemplate = startMode !== 'blank';

  // Switch start point, seeding the editable topics list from the chosen source.
  const selectStartMode = (mode) => {
    setStartMode(mode);
    setLanes(mode === 'blank' ? blankLanes() : getTemplateLanes(mode, language));
    if (error) setError('');
  };

  const updateLaneTitle = (idx, value) => {
    setLanes((prev) => prev.map((l, i) => (i === idx ? { ...l, title: value } : l)));
  };
  const addLane = () => setLanes((prev) => [...prev, { id: '', title: '' }]);
  const removeLane = (idx) => setLanes((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  // Localized example chips fall back to the English ideas if a locale omits them.
  const titleIdeas = t('buildOwn.exampleChips');
  const chips = Array.isArray(titleIdeas) ? titleIdeas : PERSONAL_TITLE_IDEAS;

  const handleSubmit = (e) => {
    e.preventDefault();
    // A title is required for a blank canvas; templates supply their own default title.
    if (!usingTemplate && !title.trim()) {
      setError(t('buildOwn.titleRequired'));
      return;
    }
    const data = buildPersonalTimeline({
      title,
      description,
      templateKey: usingTemplate ? startMode : null,
      lang: language,
      lanes,
    });
    onCreate(data);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div
        className={`bg-surface-raised border border-line rounded-sheet w-full max-w-lg overflow-hidden shadow-panel flex flex-col max-h-[88vh] ${
          isRtl ? 'text-right' : 'text-left'
        }`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-surface-raised">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded-control bg-accent-soft text-accent shrink-0">
              <BookUser className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-base text-ink truncate">
                {t('buildOwn.modalTitle')}
              </h3>
              <p className="text-xs text-ink-muted line-clamp-2">
                {t('buildOwn.modalSubtitle')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-ink-subtle hover:text-ink p-1 rounded-control hover:bg-surface-hover transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Title */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-ink mb-1.5">
              <FileText className="w-3.5 h-3.5 text-ink-subtle" />
              {t('buildOwn.titleLabel')}
              {!usingTemplate && <span className="text-danger">*</span>}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (error) setError('');
              }}
              maxLength={120}
              placeholder={t('buildOwn.titlePlaceholder')}
              className="w-full bg-surface-sunken text-ink placeholder-ink-subtle text-sm px-3 py-2 rounded-control border border-line outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
            />
            {error && <p className="text-[11px] text-danger mt-1">{error}</p>}

            {/* Title idea chips */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {chips.map((idea) => (
                <button
                  key={idea}
                  type="button"
                  onClick={() => {
                    setTitle(idea);
                    if (error) setError('');
                  }}
                  className="text-[11px] px-2.5 py-1 rounded-full bg-surface-sunken hover:bg-surface-hover text-ink-muted hover:text-accent border border-line transition-colors cursor-pointer"
                >
                  {idea}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-ink mb-1.5">
              <FileText className="w-3.5 h-3.5 text-ink-subtle" />
              {t('buildOwn.descLabel')}
              <span className="text-[10px] font-normal text-ink-subtle">({t('common.optional')})</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={280}
              rows={2}
              placeholder={t('buildOwn.descPlaceholder')}
              className="w-full bg-surface-sunken text-ink placeholder-ink-subtle text-sm px-3 py-2 rounded-control border border-line outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors resize-none"
            />
          </div>

          {/* Start point */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-ink mb-2">
              <LayoutTemplate className="w-3.5 h-3.5 text-ink-subtle" />
              {t('buildOwn.startPoint')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {/* Blank canvas */}
              <button
                type="button"
                onClick={() => selectStartMode('blank')}
                className={`flex flex-col items-start gap-1 p-3 rounded-panel border text-start transition-colors ${
                  startMode === 'blank'
                    ? 'border-accent bg-accent-soft ring-1 ring-accent/30'
                    : 'border-line hover:border-line-strong bg-surface-sunken hover:bg-surface-hover'
                }`}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  <BookUser className="w-4 h-4 text-ink-subtle" />
                  {t('buildOwn.blankOption')}
                </span>
                <span className="text-[11px] text-ink-muted leading-snug">
                  {t('buildOwn.blankOptionDesc')}
                </span>
              </button>

              {/* Template cards */}
              {PERSONAL_TEMPLATE_META.map(({ key, icon }) => {
                const Icon = TEMPLATE_ICONS[icon] || Users;
                const active = startMode === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => selectStartMode(key)}
                    className={`flex flex-col items-start gap-1 p-3 rounded-panel border text-start transition-colors ${
                      active
                        ? 'border-accent bg-accent-soft ring-1 ring-accent/30'
                        : 'border-line hover:border-line-strong bg-surface-sunken hover:bg-surface-hover'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                      <Icon className="w-4 h-4 text-ink-subtle" />
                      {t(`buildOwn.templates.${key}.name`)}
                    </span>
                    <span className="text-[11px] text-ink-muted leading-snug">
                      {t(`buildOwn.templates.${key}.desc`)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Topics / lanes editor */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-ink mb-1">
              <Layers className="w-3.5 h-3.5 text-ink-subtle" />
              {t('buildOwn.topicsLabel')}
            </label>
            <p className="text-[11px] text-ink-muted mb-2 leading-snug">
              {t('buildOwn.topicsHint')}
            </p>
            <div className="space-y-1.5">
              {lanes.map((l, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={l.title}
                    onChange={(e) => updateLaneTitle(idx, e.target.value)}
                    maxLength={60}
                    placeholder={t('buildOwn.topicPlaceholder')}
                    className="flex-1 bg-surface-sunken text-ink placeholder-ink-subtle text-sm px-3 py-1.5 rounded-control border border-line outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
                  />
                  {lanes.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLane(idx)}
                      aria-label={t('buildOwn.removeTopic')}
                      title={t('buildOwn.removeTopic')}
                      className="p-1.5 text-ink-subtle hover:text-danger rounded-control hover:bg-surface-hover transition-colors shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addLane}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent-hover px-2 py-1 rounded-control hover:bg-surface-hover transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              {t('buildOwn.addTopic')}
            </button>
          </div>

          {/* Manual reassurance note */}
          <div className="flex items-start gap-2 p-2.5 rounded-control bg-surface-sunken border border-line">
            <ShieldCheck className="w-4 h-4 text-success shrink-0 mt-0.5" />
            <p className="text-[11px] text-ink-muted leading-snug">
              {t('buildOwn.manualNote')}
            </p>
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-line bg-surface-raised">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-ink-muted hover:text-ink rounded-control hover:bg-surface-hover transition-colors cursor-pointer"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="px-4 py-2 text-sm font-semibold text-accent-fg bg-accent hover:bg-accent-hover rounded-control shadow-control transition-colors cursor-pointer active:scale-[0.98]"
          >
            {t('buildOwn.createBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}

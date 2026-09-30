import React, { useRef, useState, useEffect } from 'react';
import { X, BookUser, FileText, LayoutTemplate, Users, User, Network, ShieldCheck, Layers, Plus, Trash2, Upload, Image as ImageIcon, Loader2, AlertTriangle, Type } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import useModalAnimation from '../hooks/useModalAnimation';
import { PERSONAL_TEMPLATE_META, PERSONAL_TITLE_IDEAS, buildPersonalTimeline, getTemplateLanes } from '../data/personalTemplates';

const TEMPLATE_ICONS = { Users, User, Network };

// Blank-canvas default topics list (one empty lane the user can name).
const blankLanes = () => [{ id: 'main', title: '' }];

const ACCEPTED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
const MAX_UPLOAD_FILES = 20;
const MAX_UPLOAD_FILE_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_TOTAL_BYTES = 30 * 1024 * 1024;
const MAX_PASTE_TEXT_CHARS = 20000;

const formatBytes = (bytes) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * "Build Your Own Timeline" creation modal.
 * Collects a title/description, an editable topics (lanes) list, and a start point:
 * blank canvas, a starter template, uploading photos/PDFs, or pasting raw text -
 * the latter two are AI-extraction modes.
 * Blank/template modes hand a fully-built, manual TimelineData object to onCreate.
 * The AI modes instead await onGenerateFromFiles(files, context, rawText), which
 * performs the extraction - errors are caught here and shown inline so the modal stays open.
 */
export default function PersonalTimelineModal({ isOpen, onClose, onCreate, onGenerateFromFiles, isGeneratingFromFiles }) {
  const { t, language, isRtl } = useLanguage();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startMode, setStartMode] = useState(null); // null | 'blank' | 'uploadFiles' | 'pasteText' | template key
  const [lanes, setLanes] = useState(blankLanes);
  const [error, setError] = useState('');
  const [files, setFiles] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const fileInputRef = useRef(null);

  // Reset the form each time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setDescription('');
      setStartMode(null);
      setLanes(blankLanes());
      setError('');
      setFiles([]);
      setIsDragOver(false);
      setPasteText('');
    }
  }, [isOpen]);

  const isUploadMode = startMode === 'uploadFiles';
  const isPasteMode = startMode === 'pasteText';
  const isAiMode = isUploadMode || isPasteMode;
  const usingTemplate = startMode !== null && !isAiMode && startMode !== 'blank';

  // Switch start point, seeding the editable topics list from the chosen source.
  const selectStartMode = (mode) => {
    setStartMode(mode);
    if (mode !== 'uploadFiles' && mode !== 'pasteText') {
      setLanes(mode === 'blank' ? blankLanes() : getTemplateLanes(mode, language));
    }
    if (error) setError('');
  };

  const updateLaneTitle = (idx, value) => {
    setLanes((prev) => prev.map((l, i) => (i === idx ? { ...l, title: value } : l)));
  };
  const addLane = () => setLanes((prev) => [...prev, { id: '', title: '' }]);
  const removeLane = (idx) => setLanes((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    const rejected = [];
    const accepted = [];
    for (const f of incoming) {
      if (!ACCEPTED_UPLOAD_TYPES.includes(f.type) || f.size > MAX_UPLOAD_FILE_BYTES) {
        rejected.push(f.name);
        continue;
      }
      accepted.push(f);
    }

    setFiles((prev) => {
      const combined = [...prev, ...accepted].slice(0, MAX_UPLOAD_FILES);
      const totalBytes = combined.reduce((sum, f) => sum + f.size, 0);
      if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
        setError(t('uploadTimeline.errorTotalSize'));
        return prev;
      }
      return combined;
    });

    if (rejected.length) {
      setError(t('uploadTimeline.errorRejected'));
    } else if (error) {
      setError('');
    }
  };

  const removeFile = (idx) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    addFiles(e.dataTransfer?.files);
  };

  // Localized example chips fall back to the English ideas if a locale omits them.
  const titleIdeas = t('buildOwn.exampleChips');
  const chips = Array.isArray(titleIdeas) ? titleIdeas : PERSONAL_TITLE_IDEAS;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isGeneratingFromFiles || startMode === null) return;

    if (isUploadMode) {
      if (!files.length) {
        setError(t('uploadTimeline.errorNoFiles'));
        return;
      }
      setError('');
      try {
        await onGenerateFromFiles(files, (title || description).trim());
      } catch (err) {
        setError(err?.message || t('uploadTimeline.errorFailed'));
      }
      return;
    }

    if (isPasteMode) {
      if (!pasteText.trim()) {
        setError(t('uploadTimeline.errorNoText'));
        return;
      }
      setError('');
      try {
        await onGenerateFromFiles([], (title || description).trim(), pasteText.trim());
      } catch (err) {
        setError(err?.message || t('uploadTimeline.errorFailed'));
      }
      return;
    }

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

  const totalUploadBytes = files.reduce((sum, f) => sum + f.size, 0);

  const { isRendered, isVisible, handleClose, dragHandleProps } = useModalAnimation(isOpen, onClose, { duration: 250 });

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isGeneratingFromFiles) handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose, isGeneratingFromFiles]);

  if (!isRendered) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-5 bg-black/60 dark:bg-black/75 backdrop-blur-md transition-opacity duration-250 ease-out ${isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isGeneratingFromFiles) handleClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`bg-surface-overlay border border-line rounded-t-3xl sm:rounded-2xl rounded-b-none sm:rounded-b-2xl w-full max-w-lg overflow-hidden shadow-glass-lg flex flex-col max-h-[88vh] transition-all duration-250 ease-out pb-[max(0.75rem,env(safe-area-inset-bottom))] ${isVisible
            ? 'translate-y-0 opacity-100 sm:scale-100'
            : 'translate-y-full opacity-0 sm:translate-y-0 sm:scale-95'
          } ${isRtl ? 'text-right' : 'text-left'
          }`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Mobile Drag Indicator */}
        <div
          className="sm:hidden flex justify-center pt-3 pb-2 bg-surface-raised/80 shrink-0 cursor-grab active:cursor-grabbing touch-none select-none"
          {...dragHandleProps}
        >
          <div className="w-12 h-1.5 rounded-full bg-line-strong/60" />
        </div>

        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b border-line bg-surface-overlay/80 backdrop-blur-sm select-none"
          {...dragHandleProps}
        >
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
            onClick={handleClose}
            disabled={isGeneratingFromFiles}
            aria-label={t('common.close')}
            className="text-ink-subtle hover:text-ink p-1 rounded-control hover:bg-surface-hover transition-colors shrink-0 disabled:opacity-40 disabled:cursor-default"
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
              {!usingTemplate && !isAiMode && <span className="text-danger">*</span>}
              {isAiMode && <span className="text-caption font-normal text-ink-subtle">({t('common.optional')})</span>}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (error) setError('');
              }}
              maxLength={120}
              disabled={isGeneratingFromFiles}
              placeholder={t('buildOwn.titlePlaceholder')}
              className="w-full bg-surface-sunken text-ink placeholder-ink-subtle text-sm px-3 py-2 rounded-control border border-line outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors disabled:opacity-60"
            />

            {/* Title idea chips (manual modes only) */}
            {!isAiMode && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {chips.map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    onClick={() => {
                      setTitle(idea);
                      if (error) setError('');
                    }}
                    className="text-caption px-2.5 py-1 rounded-full bg-surface-sunken hover:bg-surface-hover text-ink-muted hover:text-accent border border-line transition-colors cursor-pointer"
                  >
                    {idea}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Description (manual modes only - AI modes use the context field instead) */}
          {!isAiMode && (
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-ink mb-1.5">
                <FileText className="w-3.5 h-3.5 text-ink-subtle" />
                {t('buildOwn.descLabel')}
                <span className="text-caption font-normal text-ink-subtle">({t('common.optional')})</span>
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
          )}

          {/* Start point */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-ink mb-2">
              <LayoutTemplate className="w-3.5 h-3.5 text-ink-subtle" />
              {t('buildOwn.startPoint')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {/* Upload files */}
              <button
                type="button"
                onClick={() => selectStartMode('uploadFiles')}
                disabled={isGeneratingFromFiles}
                className={`flex flex-col items-start gap-1 p-3 rounded-panel border text-start transition-colors disabled:opacity-50 disabled:cursor-default ${isUploadMode
                    ? 'border-accent bg-accent-soft ring-1 ring-accent/30'
                    : 'border-line hover:border-line-strong bg-surface-sunken hover:bg-surface-hover'
                  }`}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  <Upload className="w-4 h-4 text-ink-subtle" />
                  {t('uploadTimeline.homeBtn')}
                </span>
                <span className="text-caption text-ink-muted leading-snug">
                  {t('uploadTimeline.startOptionDesc')}
                </span>
              </button>

              {/* Paste text */}
              <button
                type="button"
                onClick={() => selectStartMode('pasteText')}
                disabled={isGeneratingFromFiles}
                className={`flex flex-col items-start gap-1 p-3 rounded-panel border text-start transition-colors disabled:opacity-50 disabled:cursor-default ${isPasteMode
                    ? 'border-accent bg-accent-soft ring-1 ring-accent/30'
                    : 'border-line hover:border-line-strong bg-surface-sunken hover:bg-surface-hover'
                  }`}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  <Type className="w-4 h-4 text-ink-subtle" />
                  {t('uploadTimeline.pasteTextOption')}
                </span>
                <span className="text-caption text-ink-muted leading-snug">
                  {t('uploadTimeline.pasteTextOptionDesc')}
                </span>
              </button>

              {/* Blank canvas */}
              <button
                type="button"
                onClick={() => selectStartMode('blank')}
                disabled={isGeneratingFromFiles}
                className={`flex flex-col items-start gap-1 p-3 rounded-panel border text-start transition-colors disabled:opacity-50 disabled:cursor-default ${startMode === 'blank'
                    ? 'border-accent bg-accent-soft ring-1 ring-accent/30'
                    : 'border-line hover:border-line-strong bg-surface-sunken hover:bg-surface-hover'
                  }`}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  <BookUser className="w-4 h-4 text-ink-subtle" />
                  {t('buildOwn.blankOption')}
                </span>
                <span className="text-caption text-ink-muted leading-snug">
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
                    disabled={isGeneratingFromFiles}
                    className={`flex flex-col items-start gap-1 p-3 rounded-panel border text-start transition-colors disabled:opacity-50 disabled:cursor-default ${active
                        ? 'border-accent bg-accent-soft ring-1 ring-accent/30'
                        : 'border-line hover:border-line-strong bg-surface-sunken hover:bg-surface-hover'
                      }`}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                      <Icon className="w-4 h-4 text-ink-subtle" />
                      {t(`buildOwn.templates.${key}.name`)}
                    </span>
                    <span className="text-caption text-ink-muted leading-snug">
                      {t(`buildOwn.templates.${key}.desc`)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {startMode !== null && (isAiMode ? (
            <>
              {isUploadMode ? (
                <>
                  {/* Upload dropzone */}
                  <div
                    onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => !isGeneratingFromFiles && fileInputRef.current?.click()}
                    className={`flex flex-col items-center justify-center gap-1.5 p-5 rounded-panel border-2 border-dashed text-center cursor-pointer transition-colors ${isDragOver ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong bg-surface-sunken'
                      } ${isGeneratingFromFiles ? 'opacity-60 pointer-events-none' : ''}`}
                  >
                    <Upload className="w-6 h-6 text-ink-subtle" />
                    <p className="text-sm font-medium text-ink">{t('uploadTimeline.dropzoneTitle')}</p>
                    <p className="text-caption text-ink-muted">{t('uploadTimeline.dropzoneHint')}</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept={ACCEPTED_UPLOAD_TYPES.join(',')}
                      className="hidden"
                      onChange={(e) => {
                        addFiles(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </div>

                  {/* Selected files list */}
                  {files.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-ink">
                          {t('uploadTimeline.filesSelected', { count: files.length })}
                        </span>
                        <span className="text-caption text-ink-subtle">{formatBytes(totalUploadBytes)}</span>
                      </div>
                      <div className="space-y-1 max-h-40 overflow-y-auto pe-1">
                        {files.map((f, idx) => (
                          <div
                            key={`${f.name}-${idx}`}
                            className="flex items-center gap-2 px-2.5 py-1.5 rounded-control bg-surface-sunken border border-line"
                          >
                            {f.type === 'application/pdf' ? (
                              <FileText className="w-4 h-4 text-ink-subtle shrink-0" />
                            ) : (
                              <ImageIcon className="w-4 h-4 text-ink-subtle shrink-0" />
                            )}
                            <span className="flex-1 min-w-0 text-xs text-ink truncate">{f.name}</span>
                            <span className="text-caption text-ink-subtle shrink-0">{formatBytes(f.size)}</span>
                            <button
                              type="button"
                              onClick={() => removeFile(idx)}
                              disabled={isGeneratingFromFiles}
                              aria-label={t('common.remove')}
                              className="p-1 text-ink-subtle hover:text-danger rounded-control hover:bg-surface-hover transition-colors shrink-0 disabled:opacity-40"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-ink mb-1.5">
                    <Type className="w-3.5 h-3.5 text-ink-subtle" />
                    {t('uploadTimeline.pasteTextLabel')}
                  </label>
                  <textarea
                    value={pasteText}
                    onChange={(e) => {
                      setPasteText(e.target.value);
                      if (error) setError('');
                    }}
                    maxLength={MAX_PASTE_TEXT_CHARS}
                    rows={8}
                    disabled={isGeneratingFromFiles}
                    placeholder={t('uploadTimeline.pasteTextPlaceholder')}
                    className="w-full bg-surface-sunken text-ink placeholder-ink-subtle text-sm px-3 py-2 rounded-control border border-line outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors resize-y disabled:opacity-60"
                  />
                  <p className="text-caption text-ink-subtle mt-1 text-right">
                    {pasteText.length}/{MAX_PASTE_TEXT_CHARS}
                  </p>
                </div>
              )}

              {/* Context */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-ink mb-1.5">
                  <FileText className="w-3.5 h-3.5 text-ink-subtle" />
                  {t('uploadTimeline.contextLabel')}
                  <span className="text-caption font-normal text-ink-subtle">({t('common.optional')})</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={280}
                  rows={2}
                  disabled={isGeneratingFromFiles}
                  placeholder={t('uploadTimeline.contextPlaceholder')}
                  className="w-full bg-surface-sunken text-ink placeholder-ink-subtle text-sm px-3 py-2 rounded-control border border-line outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors resize-none disabled:opacity-60"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 p-2.5 rounded-control bg-danger/10 border border-danger/30">
                  <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                  <p className="text-caption text-danger leading-snug">{error}</p>
                </div>
              )}

              {/* AI reassurance note */}
              <div className="flex items-start gap-2 p-2.5 rounded-control bg-surface-sunken border border-line">
                <ShieldCheck className="w-4 h-4 text-success shrink-0 mt-0.5" />
                <p className="text-caption text-ink-muted leading-snug">
                  {t('uploadTimeline.reviewNote')}
                </p>
              </div>
            </>
          ) : (
            <>
              {/* Topics / lanes editor */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-ink mb-1">
                  <Layers className="w-3.5 h-3.5 text-ink-subtle" />
                  {t('buildOwn.topicsLabel')}
                </label>
                <p className="text-caption text-ink-muted mb-2 leading-snug">
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

              {error && <p className="text-caption text-danger">{error}</p>}

              {/* Manual reassurance note */}
              <div className="flex items-start gap-2 p-2.5 rounded-control bg-surface-sunken border border-line">
                <ShieldCheck className="w-4 h-4 text-success shrink-0 mt-0.5" />
                <p className="text-caption text-ink-muted leading-snug">
                  {t('buildOwn.manualNote')}
                </p>
              </div>
            </>
          ))}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-line bg-surface-raised">
          <button
            type="button"
            onClick={onClose}
            disabled={isGeneratingFromFiles}
            className="px-4 py-2 text-sm font-medium text-ink-muted hover:text-ink rounded-control hover:bg-surface-hover transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isGeneratingFromFiles || startMode === null || (isUploadMode && !files.length) || (isPasteMode && !pasteText.trim())}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-accent-fg bg-accent hover:bg-accent-hover rounded-control shadow-control transition-colors cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-default"
          >
            {isGeneratingFromFiles && <Loader2 className="w-4 h-4 animate-spin" />}
            {isAiMode
              ? (isGeneratingFromFiles ? t('uploadTimeline.generating') : t('uploadTimeline.generateBtn'))
              : t('buildOwn.createBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}

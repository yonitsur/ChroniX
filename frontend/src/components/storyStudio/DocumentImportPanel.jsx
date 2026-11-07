import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Upload, Type, FileText, Image as ImageIcon, Trash2, Loader2, AlertTriangle, ShieldCheck, ArrowUp, BookOpen,
} from '../icons/ThemeIcons';
import { useLanguage } from '../../context/LanguageContext';
import { useHostedConfirm } from './StudioFeedback';
import { PROMPT_FILE_ACCEPT, classifyAttachmentFile } from '../../utils/fileUploadValidation';
import { STUDIO_INPUT_CLASS } from './FuzzyDateInput';
import {
  fetchBookImportLimits, createBookImport, uploadBookImportSource, startBookImport, fetchUserQuota,
} from '../../api';
import {
  BOOK_IMPORT_ACCEPT, classifyBookFile, planBookFiles, prepareBookFile, sortBookFiles,
} from '../../utils/bookImport/uploadPlan';
import { encodePhotoBlob } from '../../utils/photoImport/photoFiles';

const MAX_UPLOAD_FILES = 20;
const MAX_UPLOAD_FILE_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_TEXT_FILE_BYTES = 256 * 1024;
const MAX_UPLOAD_TOTAL_BYTES = 30 * 1024 * 1024;
const MAX_PASTE_TEXT_CHARS = 20000;
const UPLOAD_CONCURRENCY = 3;

const formatBytes = (bytes) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Story Studio: start from documents. Files (scans, photos of pages, PDFs, TXT/MD) or pasted
 * text go to the AI, and the timeline it extracts opens in the Studio for review before it is
 * created. `onGenerate(files, context, rawText, signal)` resolves the extracted TimelineData.
 *
 * Book mode (`onStartBookImport` given, the server has book import on and the account may use it):
 * long books, Word files and page photos go straight to storage and the durable book-import
 * pipeline; `onStartBookImport(importId)` hands over to its progress / review screens.
 */
export default function DocumentImportPanel({ initialTab = 'files', initialContext = '', onBack, onGenerate, onGenerated, onStartBookImport }) {
  const { t, isRtl } = useLanguage();
  const confirm = useHostedConfirm();
  const [tab, setTab] = useState(initialTab === 'paste' ? 'paste' : 'files');
  const [files, setFiles] = useState([]);
  const [pasteText, setPasteText] = useState('');
  const [context, setContext] = useState(initialContext || '');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [book, setBook] = useState(null); // book-import limits when book mode is available
  // Why book mode is off for this account ('needs_key' / 'verify_key' = a personal key unlocks it).
  const [bookReason, setBookReason] = useState(null);
  // The caller's AI entitlements (tier, max_file_events) - for the own-key note.
  const [entitlements, setEntitlements] = useState(null);
  const [outputLanguage, setOutputLanguage] = useState('auto');
  const [uploadProgress, setUploadProgress] = useState(null); // { done, total, bytes, totalBytes }
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);

  // Leaving the panel (or the Studio) cancels a running extraction.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!onStartBookImport) return undefined;
    let cancelled = false;
    fetchBookImportLimits().then((limits) => {
      if (cancelled) return;
      if (limits?.enabled && limits.entitled) setBook(limits);
      else if (limits?.enabled) setBookReason(limits.reason || null);
    });
    return () => { cancelled = true; };
  }, [onStartBookImport]);

  useEffect(() => {
    let cancelled = false;
    fetchUserQuota().then((q) => { if (!cancelled) setEntitlements(q?.entitlements || null); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const bookMode = Boolean(book);
  // Not admin and no (verified) own key: the regular path's limits apply - say a key lifts them.
  const showOwnKeyNote = !bookMode && entitlements != null && entitlements.tier !== 'unlimited';
  const keyUnlocksBook = bookReason === 'needs_key' || bookReason === 'verify_key';
  const pasteMax = bookMode ? (book.pasteMaxChars || 200000) : MAX_PASTE_TEXT_CHARS;
  const contextMax = bookMode ? (book.instructionsMaxChars || 10000) : 2800;

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    if (bookMode) {
      const plan = planBookFiles([...files, ...incoming], book);
      if (plan.error === 'tooMany') { setError(t('bookImport.errorTooManyFiles', { max: book.maxFiles })); return; }
      if (plan.error === 'tooLarge') { setError(t('uploadTimeline.errorTotalSize')); return; }
      setFiles(sortBookFiles(plan.accepted));
      setError(plan.rejected.length ? t('uploadTimeline.errorRejected') : '');
      return;
    }
    const accepted = [];
    let rejected = 0;
    for (const f of incoming) {
      const info = classifyAttachmentFile(f);
      const maxBytes = info.kind === 'text' ? MAX_UPLOAD_TEXT_FILE_BYTES : MAX_UPLOAD_FILE_BYTES;
      if (info.kind === 'unsupported' || f.size <= 0 || f.size > maxBytes) rejected += 1;
      else accepted.push(f);
    }
    const combined = [...files, ...accepted].slice(0, MAX_UPLOAD_FILES);
    if (combined.reduce((sum, f) => sum + f.size, 0) > MAX_UPLOAD_TOTAL_BYTES) {
      setError(t('uploadTimeline.errorTotalSize'));
      return;
    }
    setFiles(combined);
    setError(rejected ? t('uploadTimeline.errorRejected') : '');
  };

  const moveFile = (idx, delta) => {
    setFiles((prev) => {
      const next = [...prev];
      const to = idx + delta;
      if (to < 0 || to >= next.length) return prev;
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
  };

  const canGenerate = tab === 'files' ? files.length > 0 : Boolean(pasteText.trim());
  const isDirty = files.length > 0 || Boolean(pasteText.trim());

  const handleBack = async () => {
    if (isGenerating) {
      const stop = await confirm({
        body: t('docImport.cancelConfirm'),
        confirmLabel: t('docImport.stopDraftingBtn'),
        cancelLabel: t('docImport.keepDrafting'),
        danger: true,
      });
      if (!stop) return;
      abortRef.current?.abort();
    } else if (isDirty) {
      const leave = await confirm({
        body: t('docImport.discardConfirm'),
        confirmLabel: t('docImport.goBackBtn'),
        cancelLabel: t('storyStudio.keepEditing'),
        danger: true,
      });
      if (!leave) return;
    }
    onBack();
  };

  const runBookImport = async (signal) => {
    const sending = tab === 'files' ? files : [];
    // Prepare first (page photos are re-encoded) so the server knows the real sizes.
    const prepared = [];
    setUploadProgress({ phase: 'prepare', done: 0, total: sending.length, bytes: 0, totalBytes: 0 });
    for (const [i, f] of sending.entries()) {
      if (signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      // eslint-disable-next-line no-await-in-loop
      prepared.push({ ...(await prepareBookFile(f, { encodeImage: encodePhotoBlob })), clientId: `f${i}` });
      setUploadProgress((p) => ({ ...p, done: i + 1 }));
    }
    const { import: created, uploads } = await createBookImport({
      files: prepared.map((p) => ({ clientId: p.clientId, name: p.name, size: p.size, mime: p.mime })),
      pastedText: tab === 'paste' ? pasteText.trim() : '',
      instructions: context.trim(),
      outputLanguage,
    }, signal);
    const totalBytes = prepared.reduce((s, p) => s + p.size, 0);
    const loaded = new Array(prepared.length).fill(0);
    setUploadProgress({ phase: 'upload', done: 0, total: prepared.length, bytes: 0, totalBytes });
    const byClient = Object.fromEntries(prepared.map((p, i) => [p.clientId, i]));
    let next = 0;
    let finished = 0;
    const worker = async () => {
      while (next < uploads.length) {
        const target = uploads[next];
        next += 1;
        const idx = byClient[target.clientId];
        // eslint-disable-next-line no-await-in-loop
        await uploadBookImportSource(target, prepared[idx].blob, {
          signal,
          onProgress: (b) => {
            loaded[idx] = b;
            setUploadProgress((p) => ({ ...p, bytes: loaded.reduce((s, x) => s + x, 0) }));
          },
        });
        loaded[idx] = prepared[idx].size;
        finished += 1;
        setUploadProgress((p) => ({ ...p, done: finished, bytes: loaded.reduce((s, x) => s + x, 0) }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, uploads.length) }, worker));
    if (uploads.length) await startBookImport(created.id);
    return created.id;
  };

  const generate = async () => {
    if (isGenerating) return;
    if (!canGenerate) {
      setError(t(tab === 'files' ? 'uploadTimeline.errorNoFiles' : 'uploadTimeline.errorNoText'));
      return;
    }
    setError('');
    setIsGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (bookMode) {
        const importId = await runBookImport(controller.signal);
        if (controller.signal.aborted) return;
        onStartBookImport(importId);
        return;
      }
      const data = await onGenerate(
        tab === 'files' ? files : [],
        context.trim(),
        tab === 'paste' ? pasteText.trim() : '',
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!data?.articles?.length) throw new Error(t('docImport.noEvents'));
      onGenerated(data);
    } catch (err) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      if (err?.code === 'import_in_progress' && err?.body?.detail?.importId && onStartBookImport) {
        onStartBookImport(err.body.detail.importId);
        return;
      }
      setError(err?.message || t('uploadTimeline.errorFailed'));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsGenerating(false);
      setUploadProgress(null);
    }
  };

  const tabClass = (active) => `flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-control transition-colors cursor-pointer disabled:cursor-default ${active
    ? 'bg-surface-raised text-ink shadow-sm'
    : 'text-ink-muted hover:text-ink'}`;
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const fileIcon = (f) => ((bookMode ? classifyBookFile(f) === 'image' : classifyAttachmentFile(f).kind === 'image')
    ? <ImageIcon className="w-4 h-4 text-ink-subtle shrink-0" />
    : <FileText className="w-4 h-4 text-ink-subtle shrink-0" />);

  return (
    <div className="space-y-5" data-testid="doc-import" data-book-mode={bookMode ? 'true' : 'false'}>
      <div>
        <button type="button" onClick={handleBack} className="inline-flex items-center gap-1 -ms-2 mb-2 px-2 py-1 text-xs font-medium text-ink-muted hover:text-ink rounded-control hover:bg-surface-hover cursor-pointer" data-testid="doc-import-back">
          {isRtl ? <ArrowRight className="w-3.5 h-3.5" /> : <ArrowLeft className="w-3.5 h-3.5" />}{t('storyStudio.backToStart')}
        </button>
        <h2 className="text-xl sm:text-2xl font-semibold tracking-tight leading-tight text-ink">{t('docImport.title')}</h2>
        <p className="text-sm text-ink-muted mt-1 leading-relaxed">{t(bookMode ? 'bookImport.panelSubtitle' : 'docImport.subtitle')}</p>
        {bookMode && (
          <p className="mt-2 inline-flex items-center gap-2 text-caption text-accent" data-testid="doc-import-book-badge">
            <BookOpen className="w-3.5 h-3.5" />{t('bookImport.panelBadge')}
          </p>
        )}
        {showOwnKeyNote && (
          <p className="mt-2 flex items-start gap-2 text-caption text-ink-muted" data-testid="doc-import-own-key-note">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{t('docImport.ownKeyNote', {
              events: entitlements.max_file_events ? t('docImport.ownKeyNoteEvents', { count: entitlements.max_file_events }) : '',
              book: keyUnlocksBook ? t('docImport.ownKeyNoteBook') : '',
            })}</span>
          </p>
        )}
      </div>

      <div className="flex gap-1 p-1 rounded-panel bg-surface-sunken border border-line" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'files'} disabled={isGenerating} onClick={() => { setTab('files'); setError(''); }} className={tabClass(tab === 'files')} data-testid="doc-import-tab-files">
          <Upload className="w-4 h-4" />{t('docImport.tabFiles')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'paste'} disabled={isGenerating} onClick={() => { setTab('paste'); setError(''); }} className={tabClass(tab === 'paste')} data-testid="doc-import-tab-paste">
          <Type className="w-4 h-4" />{t('docImport.tabPaste')}
        </button>
      </div>

      {tab === 'files' ? (
        <div className="space-y-3">
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragOver(false); if (!isGenerating) addFiles(e.dataTransfer?.files); }}
            onClick={() => !isGenerating && fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-2 p-6 rounded-panel border-2 border-dashed text-center cursor-pointer transition-colors ${isDragOver ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent/60 bg-surface-sunken/50'} ${isGenerating ? 'opacity-60 pointer-events-none' : ''}`}
            data-testid="doc-import-dropzone"
          >
            <Upload className="w-6 h-6 text-accent" />
            <p className="text-sm font-medium text-ink">{t('uploadTimeline.dropzoneTitle')}</p>
            <p className="text-caption text-ink-muted">{t(bookMode ? 'bookImport.dropzoneHint' : 'uploadTimeline.dropzoneHint')}</p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={bookMode ? BOOK_IMPORT_ACCEPT : PROMPT_FILE_ACCEPT}
              className="hidden"
              data-testid="doc-import-input"
              onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
            />
          </div>
          {files.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-ink">{t('uploadTimeline.filesSelected', { count: files.length })}</span>
                <span className="text-caption text-ink-subtle">{formatBytes(totalBytes)}</span>
              </div>
              {bookMode && files.length > 1 && <p className="text-caption text-ink-subtle mb-2">{t('bookImport.orderHint')}</p>}
              <ul className="space-y-1 max-h-48 overflow-y-auto pe-1">
                {files.map((f, idx) => (
                  <li key={`${f.name}-${idx}`} className="flex items-center gap-2 px-3 py-2 rounded-control bg-surface-sunken border border-line">
                    {fileIcon(f)}
                    <span className="flex-1 min-w-0 text-xs text-ink truncate" dir="auto">{f.name}</span>
                    <span className="text-caption text-ink-subtle shrink-0">{formatBytes(f.size)}</span>
                    {bookMode && idx > 0 && (
                      <button type="button" onClick={() => moveFile(idx, -1)} disabled={isGenerating} aria-label={t('bookImport.moveUp')} className="p-1 text-ink-subtle hover:text-ink rounded-control hover:bg-surface-hover shrink-0 disabled:opacity-40">
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                      disabled={isGenerating}
                      aria-label={t('common.remove')}
                      className="p-1 text-ink-subtle hover:text-danger rounded-control hover:bg-surface-hover transition-colors shrink-0 disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div>
          <textarea
            value={pasteText}
            onChange={(e) => { setPasteText(e.target.value); if (error) setError(''); }}
            maxLength={pasteMax}
            rows={10}
            disabled={isGenerating}
            dir="auto"
            placeholder={t('uploadTimeline.pasteTextPlaceholder')}
            aria-label={t('uploadTimeline.pasteTextLabel')}
            className={`${STUDIO_INPUT_CLASS} resize-y leading-relaxed disabled:opacity-60`}
            data-testid="doc-import-text"
          />
          <p className="text-caption text-ink-subtle mt-1 text-end tabular-nums">{pasteText.length}/{pasteMax}</p>
        </div>
      )}

      <label className="block">
        <span className="block text-xs font-medium text-ink-muted mb-1">{t(bookMode ? 'bookImport.instructionsLabel' : 'uploadTimeline.contextLabel')}</span>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          maxLength={contextMax}
          rows={bookMode ? 4 : 3}
          disabled={isGenerating}
          dir="auto"
          placeholder={t(bookMode ? 'bookImport.instructionsPlaceholder' : 'uploadTimeline.contextPlaceholder')}
          className={`${STUDIO_INPUT_CLASS} resize-y disabled:opacity-60`}
          data-testid="doc-import-context"
        />
      </label>

      {bookMode && (
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          <span>{t('bookImport.outputLanguage')}</span>
          <select value={outputLanguage} onChange={(e) => setOutputLanguage(e.target.value)} disabled={isGenerating} className="text-xs bg-surface-sunken border border-line rounded-control px-2 py-1 text-ink" data-testid="doc-import-language">
            <option value="auto">{t('bookImport.languageAuto')}</option>
            <option value="he">עברית</option>
            <option value="en">English</option>
          </select>
        </label>
      )}

      {uploadProgress && (
        <div className="space-y-1" role="status" aria-live="polite" data-testid="doc-import-upload-progress">
          <p className="text-caption text-ink-muted">
            {uploadProgress.phase === 'prepare'
              ? t('bookImport.preparing', { done: uploadProgress.done, total: uploadProgress.total })
              : t('bookImport.uploading', { done: uploadProgress.done, total: uploadProgress.total })}
          </p>
          <div className="h-1.5 rounded-full bg-surface-sunken overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${uploadProgress.phase === 'prepare'
                ? Math.round(100 * uploadProgress.done / Math.max(1, uploadProgress.total))
                : Math.round(100 * uploadProgress.bytes / Math.max(1, uploadProgress.totalBytes))}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-control bg-danger/10 border border-danger/30">
          <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
          <p className="text-caption text-danger leading-snug">{error}</p>
        </div>
      )}

      <div className="flex items-start gap-2 p-3 rounded-control bg-surface-sunken border border-line">
        <ShieldCheck className="w-4 h-4 text-success shrink-0 mt-0.5" />
        <p className="text-caption text-ink-muted leading-snug">{t(bookMode ? 'bookImport.reviewNote' : 'docImport.reviewNote')}</p>
      </div>

      <div className="sticky -bottom-6 sm:-bottom-8 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 border-t border-line bg-surface flex items-center justify-between gap-3">
        <button type="button" onClick={handleBack} className="px-3 py-2 text-sm text-ink-muted hover:text-ink rounded-control hover:bg-surface-hover cursor-pointer">
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={generate}
          disabled={isGenerating || !canGenerate}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-accent-fg bg-accent hover:bg-accent-hover rounded-control shadow-control transition-colors cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-default"
          data-testid="doc-import-generate"
        >
          {isGenerating && <Loader2 className="w-4 h-4 animate-spin" />}
          {isGenerating ? t(bookMode ? 'bookImport.startingBtn' : 'uploadTimeline.generating') : t(bookMode ? 'bookImport.startBtn' : 'docImport.generateBtn')}
        </button>
      </div>
    </div>
  );
}

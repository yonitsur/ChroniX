import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, AlertTriangle, ArrowLeft, ArrowRight } from '../icons/ThemeIcons';
import { useLanguage } from '../../context/LanguageContext';
import { useHostedConfirm } from '../storyStudio/StudioFeedback';
import {
  getBookImport, getBookImportDraft, resumeBookImport, cancelBookImport, deleteBookImport, finalizeBookImport, getApiKey,
} from '../../api';
import { createProgressPoller } from '../../utils/bookImport/progressPoller';
import BookImportProgress from './BookImportProgress';

const BookReviewWorkspace = lazy(() => import('./review/BookReviewWorkspace'));

/**
 * One book import inside Story Studio: progress while the server works, the review workspace once
 * the draft is ready, then Create (finalize) and open the new timeline. The server keeps everything,
 * so leaving and coming back (or reloading) resumes where it was.
 */
export default function BookImportFlow({ importId, onExit, onOpenTimeline }) {
  const { t, isRtl } = useLanguage();
  const confirm = useHostedConfirm();
  const [status, setStatus] = useState(null);
  const [draftData, setDraftData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pollerRef = useRef(null);
  const autoResumedRef = useRef(false);

  const startPolling = useCallback(() => {
    pollerRef.current?.stop();
    const poller = createProgressPoller({
      fetchStatus: async () => (await getBookImport(importId)).import,
      onUpdate: (s) => { setStatus(s); setError(''); },
      onError: (err, n) => { if (n >= 3 || err?.status === 404) setError(err?.message || t('bookImport.errorGeneric')); },
    });
    pollerRef.current = poller;
    poller.start();
  }, [importId, t]);

  useEffect(() => {
    setStatus(null);
    setDraftData(null);
    autoResumedRef.current = false;
    startPolling();
    return () => pollerRef.current?.stop();
  }, [importId, startPolling]);

  // After a server restart a personal-key import waits for the key: send it once, automatically.
  useEffect(() => {
    if (status?.status !== 'paused' || status?.pausedReason !== 'needs_key' || autoResumedRef.current || !getApiKey()) return;
    autoResumedRef.current = true;
    resumeBookImport(importId).then((r) => { setStatus(r.import); pollerRef.current?.poke(); }).catch(() => {});
  }, [status, importId]);

  // Draft ready: load it once.
  useEffect(() => {
    if (status?.status !== 'review' || draftData) return;
    let cancelled = false;
    getBookImportDraft(importId).then((d) => { if (!cancelled) setDraftData(d); }).catch((e) => setError(e?.message || t('bookImport.errorGeneric')));
    return () => { cancelled = true; };
  }, [status, importId, draftData, t]);

  // Created: open the timeline.
  useEffect(() => {
    if (status?.status === 'completed' && status.timelineId) onOpenTimeline?.(status.timelineId);
  }, [status, onOpenTimeline]);

  const resume = async () => {
    setBusy(true);
    try {
      const r = await resumeBookImport(importId);
      setStatus(r.import);
      startPolling();
    } catch (e) {
      setError(e?.message || t('bookImport.errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!(await confirm({
      body: t('bookImport.cancelConfirm'),
      confirmLabel: t('bookImport.cancelBtn'),
      cancelLabel: t('common.cancel'),
      danger: true,
    }))) return;
    setBusy(true);
    try {
      await cancelBookImport(importId);
      await deleteBookImport(importId).catch(() => {});
      onExit?.();
    } catch (e) {
      setError(e?.message || t('bookImport.errorGeneric'));
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!(await confirm({
      body: t('bookImport.discardConfirm'),
      confirmLabel: t('bookImport.discardBtn'),
      cancelLabel: t('common.cancel'),
      danger: true,
    }))) return;
    await deleteBookImport(importId).catch(() => {});
    onExit?.();
  };

  const finalize = async (rev, options = {}) => {
    const r = await finalizeBookImport(importId, rev, options);
    setDraftData(null);
    setStatus(r.import);
    startPolling();
  };

  const back = (
    <button type="button" onClick={onExit} className="inline-flex items-center gap-1 -ms-2 px-2 py-1 text-xs font-medium text-ink-muted hover:text-ink rounded-control hover:bg-surface-hover cursor-pointer" data-testid="book-import-exit">
      {isRtl ? <ArrowRight className="w-3.5 h-3.5" /> : <ArrowLeft className="w-3.5 h-3.5" />}{t('bookImport.backToStudio')}
    </button>
  );

  if (status?.status === 'review' && draftData) {
    return (
      <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>}>
        <BookReviewWorkspace
          importId={importId}
          initial={draftData}
          onFinalize={finalize}
          onDiscard={discard}
          onExit={onExit}
        />
      </Suspense>
    );
  }

  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(400px,480px)_1fr]" data-testid="book-import-flow">
      <div className="min-h-0 flex flex-col border-e border-line bg-surface-overlay/40 overflow-y-auto px-4 sm:px-6 py-5">
        <div className="space-y-4">
          {back}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-control bg-danger/10 border border-danger/30" role="alert">
              <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <p className="text-caption text-danger leading-snug">{error}</p>
            </div>
          )}
          {!status ? (
            <div className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="w-4 h-4 animate-spin" />{t('bookImport.loading')}</div>
          ) : (
            <BookImportProgress status={status} busy={busy} onResume={resume} onCancel={cancel} onDiscard={discard} />
          )}
        </div>
      </div>
      <div className="hidden lg:flex min-h-0 flex-col items-center justify-center bg-surface-sunken/40 px-6 text-center">
        <p className="text-sm text-ink-muted" dir="auto">{t('bookImport.progressSubtitle')}</p>
      </div>
    </div>
  );
}

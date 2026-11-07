import React from 'react';
import { Loader2, CheckCircle2, AlertTriangle, Clock, RefreshCw, Trash2, Info } from '../icons/ThemeIcons';
import { useLanguage } from '../../context/LanguageContext';

const STAGE_KEYS = ['parse', 'read', 'map', 'extract', 'fast_extract', 'reconcile', 'finalize'];

/** Stage list with live counts, plus what to do when the import paused or failed. */
export default function BookImportProgress({ status, busy, onResume, onCancel, onDiscard }) {
  const { t } = useLanguage();
  const s = status?.status;
  const running = ['queued', 'running', 'finalizing', 'awaiting_upload'].includes(s);
  const stages = (status?.stages || []).filter((st) => STAGE_KEYS.includes(st.key));
  const pausedReason = status?.pausedReason;

  return (
    <div className="space-y-4" data-testid="book-import-progress">
      <div>
        <h2 className="text-xl font-semibold text-ink" dir="auto">
          {s === 'finalizing' ? t('bookImport.creatingTitle') : t('bookImport.progressTitle')}
        </h2>
        <p className="text-sm text-ink-muted mt-1 leading-relaxed">
          {s === 'finalizing' ? t('bookImport.creatingSubtitle') : t('bookImport.progressSubtitle')}
        </p>
        {status?.title && <p className="text-caption text-ink-subtle mt-1 truncate" dir="auto">{status.title}</p>}
      </div>

      <ol className="space-y-2" aria-live="polite">
        {stages.map((st) => {
          const done = st.status === 'done';
          const active = st.status === 'active' && running;
          return (
            <li key={st.key} className={`flex items-center gap-3 px-3 py-2 rounded-control border ${active ? 'border-accent/50 bg-accent-soft/50' : 'border-line bg-surface-sunken/50'}`} data-testid={`book-stage-${st.key}`} data-status={st.status}>
              {done ? <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                : active ? <Loader2 className="w-4 h-4 text-accent animate-spin shrink-0" />
                  : <Clock className="w-4 h-4 text-ink-subtle shrink-0" />}
              <span className={`flex-1 text-sm ${done || active ? 'text-ink' : 'text-ink-muted'}`}>{t(`bookImport.stage_${st.key}`)}</span>
              {st.total > 1 && (active || done) && (
                <span className="text-caption text-ink-muted tabular-nums">{t('bookImport.stageCount', { done: Math.min(st.done, st.total), total: st.total })}</span>
              )}
            </li>
          );
        })}
      </ol>

      {status?.counts?.units ? (
        <p className="text-caption text-ink-muted">{t('bookImport.countsLine', { units: status.counts.units, photos: status.counts.photos || 0 })}</p>
      ) : null}

      {s === 'paused' && (
        <div className="p-3 rounded-control border border-warning/40 bg-warning/10 space-y-2" role="status" data-testid="book-import-paused">
          <p className="text-sm text-ink flex items-start gap-2"><AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />{t(`bookImport.paused_${pausedReason || 'retry_later'}`, {}) || t('bookImport.paused_retry_later')}</p>
          <button type="button" onClick={onResume} disabled={busy} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold text-accent-fg bg-accent hover:bg-accent-hover rounded-control disabled:opacity-60 cursor-pointer">
            <RefreshCw className="w-4 h-4" />{t('bookImport.resumeBtn')}
          </button>
        </div>
      )}

      {s === 'failed' && (
        <div className="p-3 rounded-control border border-danger/40 bg-danger/10 space-y-2" role="alert" data-testid="book-import-failed">
          <p className="text-sm text-ink" dir="auto">{status?.error?.message || t('bookImport.errorGeneric')}</p>
          <div className="flex gap-2">
            {['stage_failed', 'retrying'].includes(status?.error?.code) && (
              <button type="button" onClick={onResume} disabled={busy} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold text-accent-fg bg-accent hover:bg-accent-hover rounded-control disabled:opacity-60 cursor-pointer">
                <RefreshCw className="w-4 h-4" />{t('bookImport.retryBtn')}
              </button>
            )}
            <button type="button" onClick={onDiscard} className="inline-flex items-center gap-2 px-3 py-2 text-sm text-ink-muted hover:text-danger rounded-control hover:bg-surface-hover cursor-pointer">
              <Trash2 className="w-4 h-4" />{t('bookImport.discardBtn')}
            </button>
          </div>
        </div>
      )}

      {status?.error?.code === 'retrying' && s === 'queued' && (
        <p className="text-caption text-warning" role="status">{t('bookImport.retrying')}</p>
      )}

      {running && (
        <>
          <div className="flex items-start gap-2 p-3 rounded-control bg-surface-sunken border border-line">
            <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
            <p className="text-caption text-ink-muted leading-snug">{status?.keyTier === 'custom' && !status?.keyHeld ? t('bookImport.keepOpenHint') : t('bookImport.canCloseHint')}</p>
          </div>
          {s !== 'finalizing' && (
            <button type="button" onClick={onCancel} disabled={busy} className="text-sm text-ink-muted hover:text-danger px-2 py-1 rounded-control hover:bg-surface-hover cursor-pointer" data-testid="book-import-cancel">
              {t('bookImport.cancelBtn')}
            </button>
          )}
        </>
      )}
    </div>
  );
}

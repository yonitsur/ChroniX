import React, { useState } from 'react';
import { Loader2, AlertTriangle, CheckCircle2, X } from '../../icons/ThemeIcons';
import { useLanguage } from '../../../context/LanguageContext';

/** Confirms Create: what will be created, what's still flagged, and where the photos will live. */
export default function FinalizeDialog({ summary, onClose, onConfirm }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // A Wikimedia picture of the place (marked illustrative) on events without a photo.
  const [placePictures, setPlacePictures] = useState(true);

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm({ illustrativeImages: placePictures });
    } catch (e) {
      const code = e?.code || e?.body?.detail?.code;
      if (code === 'photo_quota') {
        const d = e.body?.detail || {};
        setError(t('bookImport.errorPhotoQuota', { needed: d.needed ?? '?', remaining: d.remaining ?? '?' }));
      } else if (code === 'too_many_events') {
        setError(t('bookImport.errorTooManyEvents'));
      } else if (code === 'no_events') {
        setError(t('bookImport.errorNoEvents'));
      } else {
        setError(e?.message || t('bookImport.errorGeneric'));
      }
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="book-finalize-title" data-testid="book-finalize">
      <div className="w-full max-w-md rounded-panel bg-surface-raised border border-line shadow-xl p-5 space-y-4">
        <div className="flex items-start gap-2">
          <h2 id="book-finalize-title" className="flex-1 text-lg font-semibold text-ink">{t('bookImport.finalizeTitle')}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label={t('common.close')} className="p-1 text-ink-subtle hover:text-ink rounded-control"><X className="w-4 h-4" /></button>
        </div>
        <ul className="space-y-2 text-sm text-ink">
          <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-success" />{t('bookImport.finalizeEvents', { count: summary.events })}</li>
          <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-success" />{t('bookImport.finalizePhotos', { count: summary.photos })}</li>
          {summary.flagged > 0 && <li className="flex items-center gap-2 text-warning"><AlertTriangle className="w-4 h-4" />{t('bookImport.finalizeFlagged', { count: summary.flagged })}</li>}
          {summary.undatedSkipped > 0 && <li className="flex items-center gap-2 text-ink-muted"><AlertTriangle className="w-4 h-4" />{t('bookImport.finalizeUndated', { count: summary.undatedSkipped })}</li>}
          {summary.trayLeft > 0 && <li className="flex items-center gap-2 text-ink-muted"><AlertTriangle className="w-4 h-4" />{t('bookImport.finalizeTray', { count: summary.trayLeft })}</li>}
        </ul>
        <label className="flex items-start gap-2 text-sm text-ink cursor-pointer select-none">
          <input
            type="checkbox"
            checked={placePictures}
            onChange={(e) => setPlacePictures(e.target.checked)}
            disabled={busy}
            className="mt-0.5 w-4 h-4 shrink-0 accent-[rgb(var(--accent))] cursor-pointer"
            data-testid="book-finalize-pictures"
          />
          <span>
            {t('storyStudio.placePictures')}
            <span className="block text-caption text-ink-muted">{t('storyStudio.placePicturesHint')}</span>
          </span>
        </label>
        <p className="text-caption text-ink-muted leading-snug">{t('bookImport.finalizeLinks')}</p>
        <p className="text-caption text-ink-muted leading-snug">{t('bookImport.finalizePrivacy')}</p>
        {error && <p className="text-caption text-danger" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-2 text-sm text-ink-muted hover:text-ink rounded-control hover:bg-surface-hover">{t('bookImport.keepReviewing')}</button>
          <button type="button" onClick={confirm} disabled={busy || summary.events === 0} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-accent-fg bg-accent hover:bg-accent-hover rounded-control disabled:opacity-60" data-testid="book-finalize-confirm">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('bookImport.finalizeConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

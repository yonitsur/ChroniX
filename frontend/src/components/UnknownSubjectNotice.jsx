import React from 'react';
import { SearchX, Upload, Type, BookUser, X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

/**
 * Shown instead of a generated timeline when the AI honestly reports it has no reliable
 * public information about the prompt's subject (backend `insufficient_info`), typically a
 * private person. Rather than a fabricated biography, it offers the three fact-based paths:
 * upload documents/photos, paste text, or start a blank hand-built timeline.
 */
export default function UnknownSubjectNotice({ subject, onUpload, onPaste, onManual, onDismiss }) {
  const { t, isRtl } = useLanguage();

  const actionClass =
    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control text-caption font-semibold transition-colors whitespace-nowrap shadow-control cursor-pointer active:scale-95';

  return (
    <div
      id="unknown-subject-notice"
      role="status"
      aria-live="polite"
      dir={isRtl ? 'rtl' : 'ltr'}
      className={`absolute top-24 left-1/2 -translate-x-1/2 z-30 w-[calc(100%-2rem)] max-w-xl bg-surface-overlay/95 backdrop-blur-md border border-line text-ink px-4 py-3.5 rounded-panel shadow-card animate-in fade-in slide-in-from-top-2 duration-300 ${isRtl ? 'text-right' : 'text-left'}`}
    >
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-control bg-surface-raised border border-line shrink-0">
          <SearchX className="w-4 h-4 text-ink-subtle" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-ink mb-1">{t('unknownSubject.title')}</h2>
          <p className="text-xs text-ink-muted leading-relaxed">
            {t('unknownSubject.body', { subject })}
          </p>
          <p className="text-xs font-medium text-ink mt-2.5 mb-1.5">{t('unknownSubject.cta')}</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              id="unknown-subject-upload-btn"
              type="button"
              onClick={onUpload}
              className={`${actionClass} bg-accent hover:bg-accent-hover text-accent-fg`}
            >
              <Upload className="w-3.5 h-3.5 shrink-0" />
              {t('unknownSubject.upload')}
            </button>
            <button
              id="unknown-subject-paste-btn"
              type="button"
              onClick={onPaste}
              className={`${actionClass} bg-surface-raised hover:bg-surface-sunken border border-line text-ink`}
            >
              <Type className="w-3.5 h-3.5 shrink-0" />
              {t('unknownSubject.paste')}
            </button>
            <button
              id="unknown-subject-manual-btn"
              type="button"
              onClick={onManual}
              className={`${actionClass} bg-surface-raised hover:bg-surface-sunken border border-line text-ink`}
            >
              <BookUser className="w-3.5 h-3.5 shrink-0" />
              {t('unknownSubject.manual')}
            </button>
          </div>
        </div>
        <button
          id="unknown-subject-dismiss-btn"
          type="button"
          onClick={onDismiss}
          aria-label={t('unknownSubject.dismiss')}
          title={t('unknownSubject.dismiss')}
          className="p-1 rounded-control text-ink-subtle hover:text-ink transition-colors shrink-0 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

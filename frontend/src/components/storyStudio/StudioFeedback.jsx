import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { RotateCcw, X } from '../icons/ThemeIcons';

// In-app feedback for the Story Studio, replacing the browser's confirm() dialogs:
//  - useStudioConfirm: a small promise-based confirm dialog for truly destructive steps.
//  - useUndoToast: "Moment removed · Undo" for reversible ones, so nothing needs a question.
// Both render inside the Studio (so they inherit its theme and direction).

export function useStudioConfirm() {
  const [request, setRequest] = useState(null);
  const confirmButtonRef = useRef(null);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    setRequest({ ...opts, resolve });
  }), []);

  const settle = useCallback((value) => {
    setRequest((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!request) return undefined;
    confirmButtonRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        settle(false);
      }
    };
    // Capture phase: the Studio's own Escape handler must not also close the Studio.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [request, settle]);

  const element = request ? (
    <div className="absolute inset-0 z-[60] flex items-end sm:items-center justify-center p-4 bg-ink/30 motion-safe:animate-fade-in" onMouseDown={(e) => { if (e.target === e.currentTarget) settle(false); }}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={request.title ? 'studio-confirm-title' : 'studio-confirm-body'}
        aria-describedby={request.title && request.body ? 'studio-confirm-body' : undefined}
        className="w-full max-w-sm rounded-sheet bg-surface-raised border border-line shadow-panel p-6 motion-safe:animate-scale-in"
      >
        {request.title && <h2 id="studio-confirm-title" className="text-lg font-semibold text-ink">{request.title}</h2>}
        {request.body && <p id="studio-confirm-body" className={request.title ? 'mt-2 text-base text-ink-muted leading-relaxed' : 'text-base text-ink leading-relaxed'}>{request.body}</p>}
        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={() => settle(false)}
            className="h-11 px-4 rounded-control text-sm font-medium text-ink hover:bg-surface-hover transition-colors duration-150 cursor-pointer"
          >
            {request.cancelLabel}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={() => settle(true)}
            className={`h-11 px-4 rounded-control text-sm font-semibold transition-colors duration-150 cursor-pointer ${request.danger
              ? 'bg-danger hover:bg-danger-hover text-danger-fg'
              : 'bg-accent hover:bg-accent-hover text-accent-fg'}`}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return [confirm, element];
}

// Lets the panels the Studio hosts (photo, document and book import, the overview draft) ask
// through the Studio's own dialog. Outside a Studio it falls back to the browser's confirm().
const StudioConfirmContext = createContext(null);
export const StudioConfirmProvider = StudioConfirmContext.Provider;

export function useHostedConfirm() {
  const confirm = useContext(StudioConfirmContext);
  return useCallback((opts) => (confirm
    ? confirm(opts)
    : Promise.resolve(window.confirm(opts.body || opts.title))), [confirm]);
}

const UNDO_MS = 7000;

export function useUndoToast({ undoLabel, dismissLabel }) {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  const clear = useCallback(() => {
    clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  const show = useCallback((message, onUndo) => {
    clearTimeout(timerRef.current);
    setToast({ message, onUndo, key: Date.now() });
    timerRef.current = setTimeout(() => setToast(null), UNDO_MS);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const element = (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 z-50 flex justify-center px-4" aria-live="polite">
      {toast && (
        <div key={toast.key} className="pointer-events-auto flex items-center gap-1 ps-4 pe-1 py-1 rounded-pill bg-ink text-surface shadow-pop motion-safe:animate-slide-up">
          <span className="text-sm">{toast.message}</span>
          <button
            type="button"
            onClick={() => { toast.onUndo?.(); clear(); }}
            className="inline-flex items-center gap-1 h-9 px-3 ms-2 rounded-pill text-sm font-semibold text-memory-soft hover:bg-surface/10 transition-colors duration-150 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />{undoLabel}
          </button>
          <button
            type="button"
            onClick={clear}
            aria-label={dismissLabel}
            className="inline-flex items-center justify-center w-9 h-9 rounded-pill text-surface/70 hover:text-surface hover:bg-surface/10 transition-colors duration-150 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );

  return { show, clear, element };
}

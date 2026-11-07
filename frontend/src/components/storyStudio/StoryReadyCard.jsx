import React, { useEffect, useRef, useState } from 'react';
import { Check, X, Loader2, AlertTriangle, RefreshCw, Share2 } from '../icons/ThemeIcons';
import { useLanguage } from '../../context/LanguageContext';
import { fireConfetti } from '../../utils/confetti';
import { copyToClipboard } from '../../utils/timelineExport';

// The moment a Story Studio timeline is created: a small, warm card over the new timeline
// ("Your story is ready"), with what was made and what to do next, plus a short, restrained
// confetti burst once it is saved (skipped for reduced motion). A failed save is never silent:
// the card says so and offers Try again, and stays until it is resolved or dismissed.
// Once saved it also offers "Share with family": the device's share sheet where there is one,
// otherwise the link is copied.
//   ready = { title, events, chapters, status: 'saving' | 'saved' | 'error' }
//   onShare() -> Promise<url> (turns sharing on and returns the link); omitted, no share button.
const AUTO_DISMISS_MS = 14000;
const CONFETTI_COLORS = ['#925434', '#dea078', '#f6ece3', '#b87326', '#2e6b56'];

export default function StoryReadyCard({ ready, onDismiss, onRetry, onShare }) {
  const { t, isRtl } = useLanguage();
  const celebratedRef = useRef(false);
  const primaryRef = useRef(null);
  const status = ready?.status;
  const [share, setShare] = useState('idle'); // idle | working | copied | error
  const readyId = ready?.id;
  useEffect(() => { setShare('idle'); }, [readyId]);

  const handleShare = async () => {
    if (!onShare || share === 'working') return;
    setShare('working');
    try {
      const url = await onShare();
      if (!url) throw new Error('No link');
      const data = { title: ready?.title || 'ChroniX', url };
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(data))) {
        try {
          await navigator.share(data);
          setShare('idle');
          return;
        } catch (err) {
          if (err?.name === 'AbortError') { setShare('idle'); return; }
        }
      }
      const copied = await copyToClipboard(url);
      setShare(copied === false ? 'error' : 'copied');
    } catch {
      setShare('error');
    }
  };

  useEffect(() => {
    if (!ready) {
      celebratedRef.current = false;
      return undefined;
    }
    if (status !== 'saved') return undefined;
    if (!celebratedRef.current) {
      celebratedRef.current = true;
      fireConfetti({
        particleCount: 70,
        spread: 75,
        startVelocity: 32,
        origin: { y: 0.65 },
        colors: CONFETTI_COLORS,
        disableForReducedMotion: true,
      });
    }
    if (share !== 'idle') return undefined; // they're sharing: let them finish
    const timer = setTimeout(() => onDismiss?.(), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [ready, status, onDismiss, share]);

  useEffect(() => {
    if (!ready) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && status !== 'saving') onDismiss?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ready, status, onDismiss]);

  if (!ready) return null;
  const isError = status === 'error';
  const isSaving = status === 'saving';

  return (
    <div className="theme-memory fixed inset-x-0 top-20 sm:top-auto sm:bottom-24 z-[95] flex justify-center px-4 pointer-events-none" dir={isRtl ? 'rtl' : 'ltr'}>
      <section
        role={isError ? 'alert' : 'status'}
        aria-live="polite"
        aria-labelledby="story-ready-title"
        className="pointer-events-auto w-full max-w-md rounded-sheet bg-surface-raised border border-line shadow-panel p-5 motion-safe:animate-slide-up"
      >
        <div className="flex items-start gap-4">
          <span className={`flex items-center justify-center w-10 h-10 rounded-full shrink-0 ${isError ? 'bg-danger-soft text-danger' : 'bg-accent text-accent-fg'}`} aria-hidden="true">
            {isError ? <AlertTriangle className="w-5 h-5" /> : isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
          </span>
          <div className="flex-1 min-w-0">
            <h2 id="story-ready-title" className="text-sm font-semibold text-accent">{t('storyStudio.readyTitle')}</h2>
            <p className="mt-1 text-lg font-semibold leading-snug text-ink" dir="auto">{ready.title}</p>
            <p className="mt-1 text-sm text-ink-muted">
              {[
                t(ready.events === 1 ? 'storyStudio.countMomentsOne' : 'storyStudio.countMoments', { count: ready.events }),
                ready.chapters > 0 && t(ready.chapters === 1 ? 'storyStudio.countChaptersOne' : 'storyStudio.countChapters', { count: ready.chapters }),
              ].filter(Boolean).join(' · ')}
              {!isError && (
                <>
                  <span aria-hidden="true"> · </span>
                  {t(isSaving ? 'storyStudio.readySaving' : 'storyStudio.readySaved')}
                </>
              )}
            </p>
          </div>
          {!isSaving && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label={t('common.close')}
              className="-mt-2 -me-2 inline-flex items-center justify-center w-10 h-10 rounded-control text-ink-subtle hover:text-ink hover:bg-surface-hover transition-colors duration-150 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <p className={`mt-4 text-sm leading-relaxed ${isError ? 'text-danger' : 'text-ink-muted'}`}>
          {t(isError ? 'storyStudio.readyError' : onShare ? 'storyStudio.readyNextShare' : 'storyStudio.readyNext')}
        </p>
        <p className="sr-only" aria-live="polite">{share === 'copied' ? t('storyStudio.readyLinkCopied') : ''}</p>
        {share === 'error' && <p className="mt-2 text-sm text-danger">{t('storyStudio.readyShareError')}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {status === 'saved' && onShare && (
            <button
              type="button"
              onClick={handleShare}
              disabled={share === 'working'}
              className="inline-flex items-center gap-2 h-11 px-4 rounded-control border border-line-input bg-surface-raised text-ink text-sm font-medium hover:bg-surface-hover transition-colors duration-150 cursor-pointer disabled:opacity-60 disabled:cursor-default"
              data-testid="story-ready-share"
            >
              {share === 'working' ? <Loader2 className="w-4 h-4 animate-spin" /> : share === 'copied' ? <Check className="w-4 h-4 text-success" /> : <Share2 className="w-4 h-4" />}
              {t(share === 'copied' ? 'storyStudio.readyLinkCopied' : 'storyStudio.readyShare')}
            </button>
          )}
          {isError ? (
            <button
              ref={primaryRef}
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-2 h-11 px-4 rounded-control bg-accent hover:bg-accent-hover text-accent-fg text-sm font-semibold transition-colors duration-150 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />{t('storyStudio.readyRetry')}
            </button>
          ) : (
            <button
              ref={primaryRef}
              type="button"
              onClick={onDismiss}
              disabled={isSaving}
              className="h-11 px-4 rounded-control bg-accent hover:bg-accent-hover text-accent-fg text-sm font-semibold transition-colors duration-150 cursor-pointer disabled:opacity-60 disabled:cursor-default"
            >
              {t('storyStudio.readyDone')}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

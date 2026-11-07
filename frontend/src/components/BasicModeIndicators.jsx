import React, { useCallback, useEffect, useState } from 'react';
import { Leaf, Key, LogIn, X } from './icons/ThemeIcons';
import { useLanguage } from '../context/LanguageContext';
import useAiMode from '../hooks/useAiMode';
import { basicNoticeStorageKey, formatResetTime, isCapacityErrorMessage } from '../utils/aiMode';

// Basic-mode UI, in three intensities:
//   BasicModeNotice — one-time (per credit day) heads-up at the moment of the switch
//   BasicModePill   — quiet, persistent label so the state is never a mystery
//   BasicModeHint   — a single line at the moment it matters (waiting on AI, or an AI error)
// All render nothing outside basic mode (own key, admin, or fast credits remaining).

/** Persistent toolbar label. Clicking opens the key / quota settings. */
export function BasicModePill({ onClick }) {
  const { t, language } = useLanguage();
  const mode = useAiMode();
  if (!mode.isBasic) return null;
  const backAt = formatResetTime(mode.resetsAt, language);
  const tooltip = backAt ? t('quota.badgeBasicUntil', { time: backAt }) : t('quota.freeModeNotice');
  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip}
      aria-label={tooltip}
      className="inline-flex items-center gap-1 px-2 py-1 min-h-[28px] rounded-full text-caption font-semibold bg-warning-soft text-warning border border-warning/40 hover:bg-warning-soft/80 transition-colors cursor-pointer shrink-0 active:scale-95 touch-manipulation"
    >
      <Leaf className="w-3.5 h-3.5 shrink-0" />
      <span className="hidden sm:inline whitespace-nowrap">{t('quota.badgeBasicShort')}</span>
    </button>
  );
}

/**
 * Slim, dismissible heads-up shown once per credit day when the person enters basic mode.
 * Guests whose sign-up unlocks fast credits get "Sign in" as the primary action; everyone gets
 * "Use my own key". While an AI request is in flight the sign-in action is hidden (it redirects
 * away from the page and would abandon the request).
 */
export function BasicModeNotice({ onOpenKeySettings, onSignIn, isBusy = false, registeredMode, registeredLimit }) {
  const { t, language } = useLanguage();
  const mode = useAiMode();
  const storageKey = mode.isBasic ? basicNoticeStorageKey(mode) : null;
  const [dismissedKey, setDismissedKey] = useState(() => readSeen(storageKey));

  useEffect(() => {
    setDismissedKey(readSeen(storageKey));
  }, [storageKey]);

  const dismiss = useCallback(() => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, '1'); } catch { }
    setDismissedKey(storageKey);
  }, [storageKey]);

  if (!mode.isBasic || !storageKey || dismissedKey === storageKey) return null;

  const backAt = formatResetTime(mode.resetsAt, language);
  const title = mode.reason === 'site'
    ? t('quota.basicNoticeTitleSite')
    : mode.reason === 'pool'
      ? t('quota.basicNoticeTitlePool')
      : t('quota.basicNoticeTitleCredits');
  const signInUnlocksFast = mode.isGuest && registeredMode && registeredMode !== 'free' && onSignIn;
  const showSignIn = signInUnlocksFast && !isBusy;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto w-[calc(100%-24px)] sm:w-fit max-w-[min(40rem,calc(100%-24px))] px-4 py-3 rounded-panel bg-surface-raised/95 border border-warning/40 backdrop-blur-md shadow-card flex flex-col sm:flex-row items-start sm:items-center gap-3 text-start animate-in fade-in slide-in-from-top-2 duration-300"
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className="p-2 rounded-control bg-warning-soft text-warning shrink-0 mt-0.5">
          <Leaf className="w-3.5 h-3.5" />
        </div>
        <div className="text-xs space-y-0.5 min-w-0">
          <div className="font-semibold text-ink">{title}</div>
          <div className="text-ink-muted leading-relaxed">
            {t('quota.basicNoticeBody')}
            {backAt && mode.reason !== 'site' ? ` ${t('quota.basicNoticeBack', { time: backAt })}` : ''}
            {signInUnlocksFast && registeredMode === 'limited' && registeredLimit > 0
              ? ` ${t('quota.basicNoticeSignIn', { registeredLimit })}`
              : ''}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
        {showSignIn && (
          <button
            type="button"
            onClick={() => { dismiss(); onSignIn(); }}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-control bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-xs transition-colors shadow-control cursor-pointer whitespace-nowrap"
          >
            <LogIn className="w-3.5 h-3.5" />
            {t('quota.bannerSignInBtn')}
          </button>
        )}
        <button
          type="button"
          onClick={() => { dismiss(); onOpenKeySettings?.(); }}
          className={`inline-flex items-center gap-1 px-3 py-2 rounded-control font-semibold text-xs transition-colors cursor-pointer whitespace-nowrap ${showSignIn
            ? 'border border-line text-ink-muted hover:text-ink hover:bg-surface-hover'
            : 'bg-accent hover:bg-accent-hover text-accent-fg shadow-control'}`}
        >
          <Key className="w-3.5 h-3.5" />
          {t('quota.basicNoticeKeyBtn')}
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="px-2 py-2 text-xs text-ink-subtle hover:text-ink hover:bg-surface-hover rounded-control transition-colors cursor-pointer whitespace-nowrap"
          title={t('quota.basicNoticeGotIt')}
        >
          <span className="hidden sm:inline">{t('quota.basicNoticeGotIt')}</span>
          <X className="w-4 h-4 sm:hidden" aria-label={t('quota.basicNoticeGotIt')} />
        </button>
      </div>
    </div>
  );
}

function readSeen(storageKey) {
  if (!storageKey) return null;
  try {
    return localStorage.getItem(storageKey) === '1' ? storageKey : null;
  } catch {
    return null;
  }
}

/**
 * One-line, in-context explanation.
 *  variant="loading" — under an AI spinner: "this may take a little longer"
 *  variant="error"   — under an AI error, only when it looks like shared-key capacity/rate limits
 */
export function BasicModeHint({ variant = 'loading', errorMessage = '', className = '' }) {
  const { t, language } = useLanguage();
  const mode = useAiMode();
  if (!mode.isBasic) return null;
  if (variant === 'error' && !isCapacityErrorMessage(errorMessage)) return null;

  let text;
  if (variant === 'error') {
    const backAt = mode.reason === 'site' ? '' : formatResetTime(mode.resetsAt, language);
    text = backAt ? t('quota.basicErrorHint', { time: backAt }) : t('quota.basicErrorHintNoTime');
  } else {
    text = t('quota.basicLoadingHint');
  }
  return (
    <p className={`flex items-start gap-2 text-caption leading-snug ${variant === 'error' ? 'text-danger/90' : 'text-ink-subtle'} ${className}`}>
      <Leaf className="w-3 h-3 shrink-0 mt-0.5" />
      <span>{text}</span>
    </p>
  );
}

import React, { useState, useEffect } from 'react';
import { X, Sparkles, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import ChroniXLogo from './ChroniXLogo';

export default function QuickAuthPrompt({ onOpenAuth, disabled = false }) {
  const { isGuest, loginWithGoogle } = useAuth();
  const { t, isRtl } = useLanguage();
  const [isVisible, setIsVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // If Google One Tap is active, let Google One Tap handle the native prompt without competing
    if (import.meta.env.VITE_GOOGLE_CLIENT_ID) {
      setIsVisible(false);
      return;
    }

    // Only show for guest users who haven't dismissed it, and when not disabled
    if (!isGuest || disabled) {
      setIsVisible(false);
      return;
    }

    try {
      const dismissed = localStorage.getItem('chronix_quick_auth_dismissed');
      if (dismissed) return;
    } catch {
      // ignore storage access errors
    }

    // Smooth delay before entrance
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 1400);

    return () => clearTimeout(timer);
  }, [isGuest, disabled]);

  const handleDismiss = () => {
    setIsVisible(false);
    try {
      localStorage.setItem('chronix_quick_auth_dismissed', '1');
    } catch {}
  };

  const handleGoogleClick = async () => {
    try {
      setLoading(true);
      setError('');
      await loginWithGoogle();
    } catch (err) {
      setError(err.message || t('auth.googleFailed'));
      setLoading(false);
    }
  };

  if (!isVisible || !isGuest) return null;

  return (
    <aside
      aria-label="Quick sign in prompt"
      className="fixed top-14 right-4 sm:right-8 z-40 w-[calc(100vw-2rem)] sm:w-80 bg-surface-raised/95 backdrop-blur-xl border border-line shadow-panel rounded-sheet p-4 animate-in fade-in slide-in-from-top-3 duration-300 transition-all select-none"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Close button */}
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute top-3 end-3 p-1 rounded-control text-ink-subtle hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
        aria-label={t('common.close')}
      >
        <X className="w-4 h-4" />
      </button>

      {/* Header with mini logo */}
      <div className="flex items-center gap-2 mb-2 pe-6">
        <div className="scale-75 origin-start -my-1 -ms-1">
          <ChroniXLogo size="xs" />
        </div>
        <div className="flex items-center gap-1.5 text-xs font-bold text-ink">
          <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
          <span>{t('auth.quickAuthTitle') || 'Quick Sign In'}</span>
        </div>
      </div>

      {/* Subtitle */}
      <p className="text-xs text-ink-muted mb-3.5 leading-relaxed">
        {t('auth.quickAuthSubtitle') || t('auth.quickAuthDesc') || 'Sign in with one click to keep your timelines and sync across your devices.'}
      </p>

      {/* Error message if any */}
      {error && (
        <p className="text-caption text-danger mb-2.5 leading-tight">{error}</p>
      )}

      {/* Google Sign In Button */}
      <button
        type="button"
        onClick={handleGoogleClick}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2.5 px-3.5 py-2 bg-surface hover:bg-surface-hover text-ink font-medium text-xs rounded-control border border-line shadow-control transition-all hover:border-line-strong disabled:opacity-50 cursor-pointer mb-2.5"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin text-accent" />
        ) : (
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
        )}
        <span>{t('auth.googleBtn')}</span>
      </button>

      {/* Secondary button: more options */}
      <div className="text-center">
        <button
          type="button"
          onClick={() => {
            handleDismiss();
            onOpenAuth?.('signin');
          }}
          className="text-caption text-accent hover:underline cursor-pointer font-medium"
        >
          {t('auth.quickAuthMore') || 'More sign-in options'}
        </button>
      </div>
    </aside>
  );
}

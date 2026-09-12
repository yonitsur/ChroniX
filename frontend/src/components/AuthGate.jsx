import React, { useState, useEffect } from 'react';
import {
  Mail,
  Lock,
  User as UserIcon,
  Loader2,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  Globe,
  Clock,
  Compass,
  ChevronDown,
  Check,
  Heart,
  UserRound,
  Sun,
  Moon
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import ChroniXLogo from './ChroniXLogo';
import FeaturesView from './public/FeaturesView';
import PrivacyView from './public/PrivacyView';
import TermsView from './public/TermsView';
import { fetchUserQuota } from '../api';

export default function AuthGate({ theme, onToggleTheme }) {
  const { loginWithGoogle, loginWithEmail, signUpWithEmail, loginAsGuest } = useAuth();
  const { t, language, setLanguage, supportedLanguages, activeLanguageInfo, isRtl } = useLanguage();

  const [internalTheme, setInternalTheme] = useState(() => {
    if (theme) return theme;
    if (typeof document !== 'undefined') {
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    }
    return 'light';
  });

  const isDark = (theme || internalTheme) === 'dark';

  const handleToggleTheme = () => {
    if (onToggleTheme) {
      onToggleTheme();
    } else {
      const next = isDark ? 'light' : 'dark';
      setInternalTheme(next);
      if (next === 'dark') {
        document.documentElement.classList.add('dark');
        localStorage.setItem('vt_theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('vt_theme', 'light');
      }
    }
  };

  const [isLangOpen, setIsLangOpen] = useState(false);
  const langRef = React.useRef(null);

  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [guestLimits, setGuestLimits] = useState({ timelines: 5, chats: 15 });

  useEffect(() => {
    let isMounted = true;
    fetchUserQuota()
      .then((q) => {
        if (isMounted && q) {
          setGuestLimits({
            timelines: q.daily_paid_limit > 0 ? q.daily_paid_limit : 5,
            chats: q.guest_daily_chat_limit > 0 ? q.guest_daily_chat_limit : 15,
          });
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  // Client-side view state for 0ms instant jump-free navigation
  const [currentView, setCurrentView] = useState(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname.toLowerCase();
      const hash = window.location.hash.toLowerCase();
      if (path.includes('features') || hash.includes('features')) return 'features';
      if (path.includes('privacy') || hash.includes('privacy')) return 'privacy';
      if (path.includes('terms') || hash.includes('terms')) return 'terms';
    }
    return 'home';
  });

  useEffect(() => {
    const handleUrlChange = () => {
      const path = window.location.pathname.toLowerCase();
      const hash = window.location.hash.toLowerCase();
      if (path.includes('features') || hash.includes('features')) setCurrentView('features');
      else if (path.includes('privacy') || hash.includes('privacy')) setCurrentView('privacy');
      else if (path.includes('terms') || hash.includes('terms')) setCurrentView('terms');
      else setCurrentView('home');
    };
    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleUrlChange);
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (langRef.current && !langRef.current.contains(e.target)) {
        setIsLangOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // The Google/OAuth redirect navigates away from the page; if the user hits "back"
  // before finishing sign-in, the browser restores this page from bfcache with the
  // loading spinner frozen mid-flight (no re-render ever fires to clear it). Reset it.
  useEffect(() => {
    const handlePageShow = (e) => {
      if (e.persisted) {
        setLoading(false);
        setGuestLoading(false);
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  const navigateTo = (view) => {
    setCurrentView(view);
    const targetUrl = view === 'home' ? '/' : `/${view}`;
    window.history.pushState(null, '', targetUrl);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      setError('');
      await loginWithGoogle();
    } catch (err) {
      setError(err.message || t('auth.googleFailed'));
      setLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    try {
      setGuestLoading(true);
      setError('');
      await loginAsGuest();
    } catch (err) {
      setError(err.message || t('auth.guestFailed'));
      setGuestLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError(t('auth.fillRequired'));
      return;
    }

    try {
      setLoading(true);
      setError('');
      setSuccessMsg('');

      if (mode === 'signin') {
        await loginWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password, displayName);
        setSuccessMsg(t('auth.accountCreatedSuccess'));
        setMode('signin');
      }
    } catch (err) {
      setError(err.message || t('auth.authFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="auth-gate-bg fixed inset-0 w-full h-full h-[100dvh] text-ink flex flex-col selection:bg-accent-soft selection:text-accent bg-cover overflow-y-auto overflow-x-hidden overscroll-y-contain"
      style={{
        WebkitOverflowScrolling: 'touch',
        touchAction: 'pan-y'
      }}
    >
      <div className="public-page-wrapper flex-1">
        {/* Top Navigation Header - Stationary across all views with identical height & positioning */}
        <header className="public-top-header" dir={isRtl ? 'rtl' : 'ltr'}>
          <button
            type="button"
            onClick={() => navigateTo('home')}
            className="public-logo"
            title="ChroniX Home"
          >
            <ChroniXLogo size="sm" minimal={true} variant={isDark ? 'dark' : 'light'} />
          </button>

          <div className="public-header-actions">
            <button
              type="button"
              onClick={handleToggleTheme}
              title={isDark ? t('toolbar.switchThemeLight') : t('toolbar.switchThemeDark')}
              aria-label={isDark ? t('toolbar.switchThemeLight') : t('toolbar.switchThemeDark')}
              className="public-btn-icon"
            >
              {isDark ? (
                <Sun className="w-4 h-4 text-amber-400 hover:rotate-45 transition-transform" />
              ) : (
                <Moon className="w-4 h-4 text-ink-muted hover:-rotate-12 transition-transform" />
              )}
            </button>
            <div className="relative" ref={langRef}>
              <button
                type="button"
                onClick={() => setIsLangOpen((prev) => !prev)}
                title={t('settings.languageHeading')}
                aria-label={t('settings.languageHeading')}
                className="public-btn-lang"
              >
                <Globe className="w-3.5 h-3.5 text-accent" />
                <span>{activeLanguageInfo?.nativeLabel || language}</span>
                <ChevronDown className={`w-3 h-3 text-ink-subtle transition-transform ${isLangOpen ? 'rotate-180' : ''}`} />
              </button>

              {isLangOpen && (
                <div
                  className={`absolute top-full mt-2 ${isRtl ? 'left-0' : 'right-0'} w-48 py-1 bg-surface-overlay border border-line rounded-panel shadow-pop z-50 animate-in fade-in zoom-in-95 duration-150`}
                >
                  <div className="max-h-60 overflow-y-auto py-1">
                    {supportedLanguages.map((l) => {
                      const isSelected = l.code === language;
                      return (
                        <button
                          key={l.code}
                          type="button"
                          onClick={() => {
                            setLanguage(l.code);
                            setIsLangOpen(false);
                          }}
                          className={`w-full px-3 py-1.5 text-xs flex items-center justify-between transition-colors cursor-pointer text-start ${
                            isSelected
                              ? 'bg-accent-soft text-accent font-semibold'
                              : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-5 text-center font-mono text-[10px] px-1 py-0.5 rounded-control bg-surface-sunken text-ink-subtle">
                              {l.badge}
                            </span>
                            <span>{l.nativeLabel}</span>
                          </div>
                          {isSelected && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* View Switcher: Instant 0ms transition with NO page reload or shift */}
        {currentView === 'features' && (
          <FeaturesView onEnter={() => navigateTo('home')} />
        )}

        {currentView === 'privacy' && (
          <PrivacyView />
        )}

        {currentView === 'terms' && (
          <TermsView />
        )}

        {currentView === 'home' && (
          <>
            <main className="w-full flex-1 flex flex-col">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-start">

                {/* Left Column: Narrative Introduction & Public Info */}
                <div className={`lg:col-span-7 flex flex-col ${isRtl ? 'text-right' : 'text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>
                  <div className="flex flex-wrap items-center gap-3.5 mb-6">
                    <div className="inline-flex items-center gap-2 text-accent font-bold text-sm sm:text-base tracking-wide">
                      <Sparkles className="w-5 h-5 text-accent shrink-0" />
                      <span>{t('auth.landingHeroBadge')}</span>
                    </div>
                    <span className="text-ink-subtle text-sm">•</span>
                    <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-emerald-500/10 dark:bg-emerald-500/10 border border-emerald-500/20 dark:border-emerald-400/25 backdrop-blur-xl shadow-sm transition-all">
                      <div className="w-6 h-6 rounded-full bg-emerald-500/15 dark:bg-emerald-500/15 border border-emerald-500/25 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
                        <Heart className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 fill-emerald-500/20 dark:fill-emerald-400/20" />
                      </div>
                      <span className="text-emerald-950 dark:text-emerald-300 font-bold text-sm sm:text-base">
                        {t('auth.freeNonProfitBadge')}
                      </span>
                    </div>
                  </div>

                  <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black text-ink tracking-tight leading-[1.12] mb-6 sm:mb-7">
                    {t('auth.landingHeroTitle')}
                  </h1>

                  <p className="text-lg sm:text-xl md:text-2xl text-ink leading-relaxed mb-6 max-w-2xl font-medium">
                    {t('auth.landingHeroSubtitle')}
                  </p>
                </div>

                {/* Right Column: Sign In & Registration Card */}
                <div className="lg:col-span-5 flex justify-center w-full">
                  <div
                    id="auth-card"
                    className="w-full max-w-md bg-white/60 dark:bg-white/[0.10] backdrop-blur-2xl border border-white/60 dark:border-white/25 rounded-sheet p-5 sm:p-8 shadow-2xl shadow-black/5 dark:shadow-[0_8px_32px_0_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.2)] transition-all"
                    dir={isRtl ? 'rtl' : 'ltr'}
                  >
                    {/* Card Header */}
                    <div className="flex flex-col items-center text-center mb-5 sm:mb-6">
                      <div className="mb-2 scale-105">
                        <ChroniXLogo size="md" variant={isDark ? 'dark' : 'light'} />
                      </div>
                      <h2 className="text-xl sm:text-2xl font-semibold text-ink tracking-tight" dir={isRtl ? 'rtl' : 'ltr'}>
                        {mode === 'signin' ? t('auth.signInTitle') : t('auth.signUpTitle')}
                      </h2>
                      <p className="text-xs sm:text-sm text-ink-muted mt-1 max-w-xs">
                        {t('auth.tagline')}
                      </p>
                    </div>

                    {/* Google Social Login — Primary Fast Auth */}
                    <div className="mb-4">
                      <button
                        type="button"
                        onClick={handleGoogleLogin}
                        disabled={loading || guestLoading}
                        className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white/60 hover:bg-white/80 dark:bg-white/5 dark:hover:bg-white/10 text-ink font-semibold text-sm rounded-control border border-line/60 dark:border-white/10 shadow-sm backdrop-blur-sm transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                      >
                        <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
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
                        <span>{t('auth.googleBtn')}</span>
                      </button>
                    </div>

                    {/* Divider */}
                    <div className="relative flex items-center justify-center mb-4">
                      <div className="border-t border-line/60 dark:border-white/10 w-full" />
                      <span className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-sm border border-line/40 dark:border-white/10 px-3 text-[11px] uppercase tracking-wider text-ink-subtle font-medium shrink-0 rounded-full">
                        {t('auth.orEmail')}
                      </span>
                      <div className="border-t border-line/60 dark:border-white/10 w-full" />
                    </div>

                    {/* Feedback alerts */}
                    {error && (
                      <div className="mb-4 p-3 rounded-control bg-danger-soft border border-danger/30 text-danger text-xs flex items-start gap-2.5">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span className={`flex-1 ${isRtl ? 'text-right' : 'text-left'}`}>{error}</span>
                      </div>
                    )}

                    {successMsg && (
                      <div className="mb-4 p-3 rounded-control bg-success-soft border border-success/30 text-success text-xs flex items-start gap-2.5">
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                        <span className={`flex-1 ${isRtl ? 'text-right' : 'text-left'}`}>{successMsg}</span>
                      </div>
                    )}

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-3.5">
                      {mode === 'signup' && (
                        <div>
                          <label className={`block text-xs font-medium text-ink mb-1 ${isRtl ? 'text-right' : 'text-left'}`}>
                            {t('auth.fullNameLabel')}
                          </label>
                          <div className="relative">
                            <UserIcon className={`w-4 h-4 absolute ${isRtl ? 'right-3.5' : 'left-3.5'} top-1/2 -translate-y-1/2 text-ink-subtle pointer-events-none`} />
                            <input
                              type="text"
                              dir={isRtl ? 'rtl' : 'ltr'}
                              value={displayName}
                              onChange={(e) => setDisplayName(e.target.value)}
                              placeholder={t('auth.fullNamePlaceholder')}
                              className={`w-full ${isRtl ? 'pr-10 pl-3.5 text-right' : 'pl-10 pr-3.5 text-left'} py-2.5 bg-white/50 dark:bg-slate-900/60 border border-line/60 dark:border-white/10 rounded-control text-sm text-ink placeholder-ink-subtle focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent backdrop-blur-sm transition-colors`}
                            />
                          </div>
                        </div>
                      )}

                      <div>
                        <label className={`block text-xs font-medium text-ink mb-1 ${isRtl ? 'text-right' : 'text-left'}`}>
                          {t('auth.emailLabel')}
                        </label>
                        <div className="relative">
                          <Mail className={`w-4 h-4 absolute ${isRtl ? 'right-3.5' : 'left-3.5'} top-1/2 -translate-y-1/2 text-ink-subtle pointer-events-none`} />
                          <input
                            type="email"
                            dir="ltr"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder={t('auth.emailPlaceholder')}
                            className={`w-full ${isRtl ? 'pr-10 pl-3.5 text-right' : 'pl-10 pr-3.5 text-left'} py-2.5 bg-white/50 dark:bg-slate-900/60 border border-line/60 dark:border-white/10 rounded-control text-sm text-ink placeholder-ink-subtle focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent backdrop-blur-sm transition-colors`}
                          />
                        </div>
                      </div>

                      <div>
                        <label className={`block text-xs font-medium text-ink mb-1 ${isRtl ? 'text-right' : 'text-left'}`}>
                          {t('auth.passwordLabel')}
                        </label>
                        <div className="relative">
                          <Lock className={`w-4 h-4 absolute ${isRtl ? 'right-3.5' : 'left-3.5'} top-1/2 -translate-y-1/2 text-ink-subtle pointer-events-none`} />
                          <input
                            type="password"
                            dir="ltr"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder={t('auth.passwordPlaceholder')}
                            minLength={6}
                            className={`w-full ${isRtl ? 'pr-10 pl-3.5 text-right' : 'pl-10 pr-3.5 text-left'} py-2.5 bg-white/50 dark:bg-slate-900/60 border border-line/60 dark:border-white/10 rounded-control text-sm text-ink placeholder-ink-subtle focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent backdrop-blur-sm transition-colors`}
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={loading || guestLoading}
                        className="w-full mt-3 py-3 px-4 bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-sm rounded-control shadow-control transition-colors flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60 cursor-pointer"
                      >
                        {loading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ArrowRight className={`w-4 h-4 ${isRtl ? 'rotate-180' : ''}`} />
                        )}
                        <span>{mode === 'signin' ? t('auth.signInBtn') : t('auth.signUpBtn')}</span>
                      </button>
                    </form>

                    {/* Switch Signin / Signup */}
                    <div className="mt-4 sm:mt-5 text-center text-xs text-ink-muted">
                      {mode === 'signin' ? (
                        <span>
                          {t('auth.noAccount')}{' '}
                          <button
                            type="button"
                            onClick={() => {
                              setMode('signup');
                              setError('');
                            }}
                            className="text-accent font-semibold hover:underline cursor-pointer"
                          >
                            {t('auth.signUpLink')}
                          </button>
                        </span>
                      ) : (
                        <span>
                          {t('auth.hasAccount')}{' '}
                          <button
                            type="button"
                            onClick={() => {
                              setMode('signin');
                              setError('');
                            }}
                            className="text-accent font-semibold hover:underline cursor-pointer"
                          >
                            {t('auth.signInLink')}
                          </button>
                        </span>
                      )}
                    </div>

                    {/* Divider for Guest Option */}
                    <div className="relative flex items-center justify-center my-4 sm:my-5">
                      <div className="border-t border-line/60 dark:border-white/10 w-full" />
                      <span className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-sm border border-line/40 dark:border-white/10 px-3 text-[11px] uppercase tracking-wider text-ink-subtle font-medium shrink-0 rounded-full">
                        {t('auth.guestDivider')}
                      </span>
                      <div className="border-t border-line/60 dark:border-white/10 w-full" />
                    </div>

                    {/* Continue as Guest — subtle, secondary option at the bottom */}
                    <div>
                      <button
                        type="button"
                        onClick={handleGuestLogin}
                        disabled={guestLoading || loading}
                        className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 bg-white/40 hover:bg-white/60 dark:bg-white/5 dark:hover:bg-white/10 text-ink font-medium text-xs sm:text-sm rounded-control border border-line/60 dark:border-white/10 shadow-sm backdrop-blur-sm transition-colors active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                      >
                        {guestLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <UserRound className="w-4 h-4 shrink-0 text-ink-subtle" />
                        )}
                        <span>{t('auth.guestBtn')}</span>
                      </button>
                      <p className="mt-2 text-[11px] text-ink-subtle text-center leading-relaxed">
                        {t('auth.guestCaption', {
                          timelines: guestLimits.timelines,
                          chats: guestLimits.chats
                        })}
                      </p>
                    </div>
                  </div>
                </div>

              </div>
            </main>

            {/* Feature Showcase Section */}
            <section id="features-showcase" className="w-full border-t border-line py-16 sm:py-24 mt-12" dir={isRtl ? 'rtl' : 'ltr'}>
              <div className="max-w-[1160px] mx-auto px-4 sm:px-6 lg:px-8">
                <div className="text-center max-w-3xl mx-auto mb-16" dir={isRtl ? 'rtl' : 'ltr'}>
                  <h2 className="text-3xl sm:text-5xl font-extrabold text-ink tracking-tight mb-4">
                    {t('auth.featuresShowcaseTitle')}
                  </h2>
                  <p className="text-base sm:text-xl text-ink-muted leading-relaxed max-w-2xl mx-auto font-normal">
                    {t('auth.featuresShowcaseSubtitle')}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10" dir={isRtl ? 'rtl' : 'ltr'}>
                  {/* Card 1 */}
                  <div
                    className={`flex flex-col p-1 sm:p-2 ${isRtl ? 'text-right items-start' : 'text-left items-start'}`}
                    dir={isRtl ? 'rtl' : 'ltr'}
                  >
                    <div className="text-accent mb-4 shrink-0">
                      <Clock className="w-7 h-7 sm:w-8 sm:h-8" />
                    </div>
                    <h3 className={`text-lg sm:text-xl md:text-2xl font-bold text-ink mb-2.5 w-full ${isRtl ? 'text-right' : 'text-left'}`}>{t('auth.feature1Title')}</h3>
                    <p className={`text-sm sm:text-base md:text-lg text-ink-muted leading-relaxed w-full ${isRtl ? 'text-right' : 'text-left'}`}>{t('auth.feature1Desc')}</p>
                  </div>

                  {/* Card 2 */}
                  <div
                    className={`flex flex-col p-1 sm:p-2 ${isRtl ? 'text-right items-start' : 'text-left items-start'}`}
                    dir={isRtl ? 'rtl' : 'ltr'}
                  >
                    <div className="text-accent mb-4 shrink-0">
                      <Sparkles className="w-7 h-7 sm:w-8 sm:h-8" />
                    </div>
                    <h3 className={`text-lg sm:text-xl md:text-2xl font-bold text-ink mb-2.5 w-full ${isRtl ? 'text-right' : 'text-left'}`}>{t('auth.feature2Title')}</h3>
                    <p className={`text-sm sm:text-base md:text-lg text-ink-muted leading-relaxed w-full ${isRtl ? 'text-right' : 'text-left'}`}>{t('auth.feature2Desc')}</p>
                  </div>

                  {/* Card 3 */}
                  <div
                    className={`flex flex-col p-1 sm:p-2 ${isRtl ? 'text-right items-start' : 'text-left items-start'}`}
                    dir={isRtl ? 'rtl' : 'ltr'}
                  >
                    <div className="text-accent mb-4 shrink-0">
                      <Compass className="w-7 h-7 sm:w-8 sm:h-8" />
                    </div>
                    <h3 className={`text-lg sm:text-xl md:text-2xl font-bold text-ink mb-2.5 w-full ${isRtl ? 'text-right' : 'text-left'}`}>{t('auth.feature3Title')}</h3>
                    <p className={`text-sm sm:text-base md:text-lg text-ink-muted leading-relaxed w-full ${isRtl ? 'text-right' : 'text-left'}`}>{t('auth.feature3Desc')}</p>
                  </div>

                  {/* Card 4 */}
                  <div
                    className={`flex flex-col p-1 sm:p-2 ${isRtl ? 'text-right items-start' : 'text-left items-start'}`}
                    dir={isRtl ? 'rtl' : 'ltr'}
                  >
                    <div className="text-accent mb-4 shrink-0">
                      <ShieldCheck className="w-7 h-7 sm:w-8 sm:h-8" />
                    </div>
                    <h3 className={`text-lg sm:text-xl md:text-2xl font-bold text-ink mb-2.5 w-full ${isRtl ? 'text-right' : 'text-left'}`}>{t('auth.feature4Title')}</h3>
                    <p className={`text-sm sm:text-base md:text-lg text-ink-muted leading-relaxed w-full ${isRtl ? 'text-right' : 'text-left'}`}>{t('auth.feature4Desc')}</p>
                  </div>
                </div>

                {/* Free & Non-Profit Callout */}
                <div className="mt-10 p-6 sm:p-8 rounded-3xl bg-emerald-500/10 dark:bg-emerald-500/10 border border-emerald-500/20 dark:border-emerald-400/25 backdrop-blur-xl shadow-md transition-all" dir={isRtl ? 'rtl' : 'ltr'}>
                  <h3 className={`flex items-center gap-2.5 sm:gap-3 text-lg sm:text-2xl font-bold text-emerald-950 dark:text-emerald-300 mb-2 ${isRtl ? 'text-right' : 'text-left'}`}>
                    <Heart className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-700 dark:text-emerald-400 fill-emerald-500/20 dark:fill-emerald-400/20 shrink-0" />
                    <span>{t('auth.freeNonProfitTitle')}</span>
                  </h3>
                  <p className={`text-sm sm:text-base md:text-lg text-emerald-950/85 dark:text-slate-300 leading-relaxed ${isRtl ? 'text-right' : 'text-left'}`}>
                    {t('auth.freeNonProfitDesc')}
                  </p>
                </div>
              </div>
            </section>
          </>
        )}

        {/* Unified Public Footer across all views */}
        <footer className="public-footer" dir={isRtl ? 'rtl' : 'ltr'}>
          <div className="flex items-center gap-2">
            <ChroniXLogo size="sm" variant={isDark ? 'dark' : 'light'} />
            <span>&copy; 2026 ChroniX. {t('auth.copyright')}</span>
          </div>

          <div className="public-footer-links">
            <button type="button" onClick={() => navigateTo('home')}>
              {t('auth.navHome')}
            </button>
            <span>&bull;</span>
            <button type="button" onClick={() => navigateTo('features')}>
              {t('auth.navFeatures')}
            </button>
            <span>&bull;</span>
            <button type="button" onClick={() => navigateTo('privacy')}>
              {t('auth.privacyPolicyLink')}
            </button>
            <span>&bull;</span>
            <button type="button" onClick={() => navigateTo('terms')}>
              {t('auth.termsLink')}
            </button>
            <span>&bull;</span>
            <a href="mailto:chronix.ai.com@gmail.com">
              {t('auth.supportContact')}
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}

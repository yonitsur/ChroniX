import React, { useState } from 'react';
import {
  Mail,
  Lock,
  User as UserIcon,
  Loader2,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  History,
  Layers,
  Globe
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import ChroniXLogo from './ChroniXLogo';

export default function AuthGate() {
  const { loginWithGoogle, loginWithEmail, signUpWithEmail } = useAuth();
  const { t, language, toggleLanguage, isRtl } = useLanguage();

  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

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
      className="min-h-screen w-full bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 relative overflow-hidden"
    >
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] bg-sky-900/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-sky-950/20 rounded-full blur-2xl pointer-events-none" />

      {/* Language Switcher in top corner */}
      <div className={`absolute ${isRtl ? 'top-4 left-4 sm:top-6 sm:left-6' : 'top-4 right-4 sm:top-6 sm:right-6'} z-20`}>
        <button
          type="button"
          onClick={toggleLanguage}
          title={language === 'en' ? t('toolbar.switchLanguageToHebrew') : t('toolbar.switchLanguageToEnglish')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 shadow-lg backdrop-blur-md transition-all text-xs font-medium cursor-pointer"
        >
          <Globe className="w-3.5 h-3.5 text-sky-400" />
          <span className="font-semibold text-slate-200">
            {language === 'en' ? 'עברית' : 'English'}
          </span>
        </button>
      </div>

      {/* Main card */}
      <div
        className={`relative z-10 w-full max-w-md bg-slate-900/80 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-black/60 animate-fade-in ${
          isRtl ? 'text-right' : 'text-left'
        }`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Top Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="mb-3 scale-110">
            <ChroniXLogo size="lg" variant="dark" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            {mode === 'signin' ? t('auth.signInTitle') : t('auth.signUpTitle')}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1.5 max-w-xs">
            {t('auth.tagline')}
          </p>
        </div>

        {/* Social Logins */}
        <div className="space-y-3 mb-6">
          {/* Google */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white hover:bg-slate-100 text-slate-800 font-semibold text-sm rounded-2xl shadow-md hover:shadow-lg transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
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
        <div className="relative flex items-center justify-center mb-6">
          <div className="border-t border-slate-800 w-full" />
          <span className="bg-slate-900 px-3 text-[11px] uppercase tracking-wider text-slate-500 font-medium">
            {t('auth.orEmail')}
          </span>
          <div className="border-t border-slate-800 w-full" />
        </div>

        {/* Feedback alerts */}
        {error && (
          <div className="mb-4 p-3 rounded-2xl bg-red-950/50 border border-red-800/60 text-red-300 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
            <span className={`flex-1 ${isRtl ? 'text-right' : 'text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 rounded-2xl bg-emerald-950/50 border border-emerald-800/60 text-emerald-300 text-xs flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
            <span className={`flex-1 ${isRtl ? 'text-right' : 'text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>{successMsg}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          {mode === 'signup' && (
            <div>
              <label
                dir={isRtl ? 'rtl' : 'ltr'}
                className={`block text-xs font-medium text-slate-300 mb-1 ${
                  isRtl ? 'text-right' : 'text-left'
                }`}
              >
                {t('auth.fullNameLabel')}
              </label>
              <div className="relative">
                <UserIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  dir={isRtl ? 'rtl' : 'ltr'}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t('auth.fullNamePlaceholder')}
                  className={`w-full pl-10 pr-3 py-2.5 bg-slate-800/70 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all ${
                    isRtl ? 'text-right' : 'text-left'
                  }`}
                />
              </div>
            </div>
          )}

          <div>
            <label
              dir={isRtl ? 'rtl' : 'ltr'}
              className={`block text-xs font-medium text-slate-300 mb-1 ${
                isRtl ? 'text-right' : 'text-left'
              }`}
            >
              {t('auth.emailLabel')}
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                type="email"
                dir={isRtl ? 'rtl' : 'ltr'}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder')}
                className={`w-full pl-10 pr-3 py-2.5 bg-slate-800/70 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all ${
                  isRtl ? 'text-right' : 'text-left'
                }`}
              />
            </div>
          </div>

          <div>
            <label
              dir={isRtl ? 'rtl' : 'ltr'}
              className={`block text-xs font-medium text-slate-300 mb-1 ${
                isRtl ? 'text-right' : 'text-left'
              }`}
            >
              {t('auth.passwordLabel')}
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                type="password"
                dir={isRtl ? 'rtl' : 'ltr'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.passwordPlaceholder')}
                minLength={6}
                className={`w-full pl-10 pr-3 py-2.5 bg-slate-800/70 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all ${
                  isRtl ? 'text-right' : 'text-left'
                }`}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-3 py-3 px-4 bg-sky-600 hover:bg-sky-500 text-white font-medium text-sm rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60 cursor-pointer"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowRight className={`w-4 h-4 ${isRtl ? 'rotate-180' : ''}`} />
            )}
            <span>{mode === 'signin' ? t('auth.signInBtn') : t('auth.signUpBtn')}</span>
          </button>
        </form>

        {/* Switch mode */}
        <div className="mt-5 text-center text-xs text-slate-400">
          {mode === 'signin' ? (
            <span>
              {t('auth.noAccount')}{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('signup');
                  setError('');
                }}
                className="text-sky-400 font-semibold hover:underline"
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
                className="text-sky-400 font-semibold hover:underline"
              >
                {t('auth.signInLink')}
              </button>
            </span>
          )}
        </div>
      </div>

      {/* Feature highlights footer */}
      <div className="relative z-10 mt-8 flex flex-wrap items-center justify-center gap-6 text-xs text-slate-400">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-sky-400" />
          <span>{t('auth.badgeAi')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Layers className="w-4 h-4 text-indigo-400" />
          <span>{t('auth.badgeMultiLane')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>{t('auth.badgeCloud')}</span>
        </div>
      </div>
    </div>
  );
}


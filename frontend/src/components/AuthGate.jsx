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
  ShieldCheck,
  Layers,
  Globe,
  MapPin,
  Clock,
  Compass,
  FileText,
  ExternalLink
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
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex flex-col overflow-y-auto selection:bg-sky-500/30 selection:text-sky-200">
      {/* Background ambient lighting */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-sky-600/10 rounded-full blur-[140px] pointer-events-none -z-10" />
      <div className="fixed bottom-0 right-10 w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[140px] pointer-events-none -z-10" />

      {/* Top Navigation Bar */}
      <header className="w-full border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ChroniXLogo size="md" variant="dark" />
          </div>

          <div className="flex items-center gap-3 sm:gap-6">
            <nav className="hidden md:flex items-center gap-6 text-sm text-slate-400 font-medium">
              <a href="#features" className="hover:text-white transition-colors">
                {language === 'he' ? 'תכונות' : 'Features'}
              </a>
              <a href="/privacy.html" className="hover:text-white transition-colors">
                {t('auth.privacyPolicyLink')}
              </a>
              <a href="/terms.html" className="hover:text-white transition-colors">
                {t('auth.termsLink')}
              </a>
            </nav>

            <button
              type="button"
              onClick={toggleLanguage}
              title={language === 'en' ? t('toolbar.switchLanguageToHebrew') : t('toolbar.switchLanguageToEnglish')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 shadow-md backdrop-blur-md transition-all text-xs font-semibold cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5 text-sky-400" />
              <span>{language === 'en' ? 'עברית' : 'English'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-16 flex flex-col justify-center">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
          
          {/* Left Column: Narrative Introduction & Public Info */}
          <div className={`lg:col-span-7 flex flex-col ${isRtl ? 'text-right' : 'text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-sky-950/70 border border-sky-800/60 text-sky-300 text-xs font-semibold w-fit mb-6 shadow-sm">
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              <span>{t('auth.landingHeroBadge')}</span>
            </div>

            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight leading-[1.15] mb-6">
              {t('auth.landingHeroTitle')}
            </h1>

            <p className="text-base sm:text-lg text-slate-300 leading-relaxed mb-8 max-w-2xl font-normal">
              {t('auth.landingHeroSubtitle')}
            </p>

            {/* Value Props Bullet Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 mb-4">
              <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-slate-900/40 border border-slate-800/60 backdrop-blur-sm">
                <div className="p-2 rounded-xl bg-sky-500/10 text-sky-400 shrink-0">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white mb-0.5">
                    {language === 'he' ? 'ציר זמן קרטזי' : 'Cartesian Timeline'}
                  </h4>
                  <p className="text-xs text-slate-400 leading-normal">
                    {language === 'he' ? 'ניווט חלק על פני אלפי שנות היסטוריה.' : 'Navigate fluidly across millennia and eras.'}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-slate-900/40 border border-slate-800/60 backdrop-blur-sm">
                <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 shrink-0">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white mb-0.5">
                    {language === 'he' ? 'השוואת מסלולים' : 'Parallel Lanes'}
                  </h4>
                  <p className="text-xs text-slate-400 leading-normal">
                    {language === 'he' ? 'השוואת תרבויות ואירועים במקביל.' : 'Compare cultures and events side-by-side.'}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-slate-900/40 border border-slate-800/60 backdrop-blur-sm">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 shrink-0">
                  <MapPin className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white mb-0.5">
                    {language === 'he' ? 'מיפוי גלובלי' : 'Geospatial Maps'}
                  </h4>
                  <p className="text-xs text-slate-400 leading-normal">
                    {language === 'he' ? 'איתור מוקדי האירועים במפת עולם.' : 'Pinpoint where milestones unfolded globally.'}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-slate-900/40 border border-slate-800/60 backdrop-blur-sm">
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 shrink-0">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white mb-0.5">
                    {language === 'he' ? 'סנכרון מאובטח' : 'Cloud Research'}
                  </h4>
                  <p className="text-xs text-slate-400 leading-normal">
                    {language === 'he' ? 'שמירת צירי זמן והערות אישיות.' : 'Save custom timelines and private annotations.'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Sign In & Registration Card */}
          <div className="lg:col-span-5 flex justify-center w-full">
            <div
              className="w-full max-w-md bg-slate-900/90 backdrop-blur-2xl border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-black/80"
              dir="ltr"
            >
              {/* Card Header */}
              <div className="flex flex-col items-center text-center mb-6">
                <div className="mb-2 scale-105">
                  <ChroniXLogo size="md" variant="dark" />
                </div>
                <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  {mode === 'signin' ? t('auth.signInTitle') : t('auth.signUpTitle')}
                </h2>
                <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-xs">
                  {t('auth.tagline')}
                </p>
              </div>

              {/* Google Social Login */}
              <div className="mb-5">
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white hover:bg-slate-100 text-slate-900 font-bold text-sm rounded-2xl shadow-md hover:shadow-lg transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
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
              <div className="relative flex items-center justify-center mb-5">
                <div className="border-t border-slate-800 w-full" />
                <span className="bg-slate-900 px-3 text-[11px] uppercase tracking-wider text-slate-500 font-medium shrink-0">
                  {t('auth.orEmail')}
                </span>
                <div className="border-t border-slate-800 w-full" />
              </div>

              {/* Feedback alerts */}
              {error && (
                <div className="mb-4 p-3 rounded-2xl bg-red-950/60 border border-red-800/70 text-red-300 text-xs flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
                  <span className="flex-1 text-left">{error}</span>
                </div>
              )}

              {successMsg && (
                <div className="mb-4 p-3 rounded-2xl bg-emerald-950/60 border border-emerald-800/70 text-emerald-300 text-xs flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                  <span className="flex-1 text-left">{successMsg}</span>
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-3.5">
                {mode === 'signup' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1 text-left">
                      {t('auth.fullNameLabel')}
                    </label>
                    <div className="relative">
                      <UserIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder={t('auth.fullNamePlaceholder')}
                        className="w-full pl-10 pr-3.5 py-2.5 bg-slate-800/70 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all text-left"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1 text-left">
                    {t('auth.emailLabel')}
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={t('auth.emailPlaceholder')}
                      className="w-full pl-10 pr-3.5 py-2.5 bg-slate-800/70 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all text-left"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1 text-left">
                    {t('auth.passwordLabel')}
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('auth.passwordPlaceholder')}
                      minLength={6}
                      className="w-full pl-10 pr-3.5 py-2.5 bg-slate-800/70 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all text-left"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-3 py-3 px-4 bg-sky-600 hover:bg-sky-500 text-white font-semibold text-sm rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60 cursor-pointer"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ArrowRight className="w-4 h-4" />
                  )}
                  <span>{mode === 'signin' ? t('auth.signInBtn') : t('auth.signUpBtn')}</span>
                </button>
              </form>

              {/* Switch Signin / Signup */}
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
          </div>

        </div>
      </main>

      {/* Feature Showcase Section – Directly satisfies Google Home Page public info requirement */}
      <section id="features" className="w-full border-t border-slate-800/80 bg-slate-900/30 py-16 sm:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight mb-4">
              {language === 'he' ? 'חוויית חקר היסטורית מהדור הבא' : 'Next-Generation Historical Exploration'}
            </h2>
            <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
              {language === 'he' 
                ? 'ChroniX משלבת טכנולוגיות ויזואליזציה מתקדמות עם בינה מלאכותית כדי לפענח את זרימת הזמן והקשרים בין תרבויות.'
                : 'ChroniX unifies advanced data visualization with artificial intelligence to reveal the flow of human history and cross-cultural milestones.'}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Card 1 */}
            <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 hover:border-sky-500/40 transition-all shadow-xl">
              <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center mb-5">
                <Clock className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">{t('auth.feature1Title')}</h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">{t('auth.feature1Desc')}</p>
            </div>

            {/* Card 2 */}
            <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 hover:border-indigo-500/40 transition-all shadow-xl">
              <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mb-5">
                <Sparkles className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">{t('auth.feature2Title')}</h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">{t('auth.feature2Desc')}</p>
            </div>

            {/* Card 3 */}
            <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 hover:border-emerald-500/40 transition-all shadow-xl">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-5">
                <Compass className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">{t('auth.feature3Title')}</h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">{t('auth.feature3Desc')}</p>
            </div>

            {/* Card 4 */}
            <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 hover:border-amber-500/40 transition-all shadow-xl">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mb-5">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">{t('auth.feature4Title')}</h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">{t('auth.feature4Desc')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Privacy Transparency Callout */}
      <section className="w-full py-12 border-t border-slate-800/60 bg-slate-950">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-800/60 text-emerald-400 text-xs font-semibold mb-4">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>{t('auth.privacyCommitmentTitle')}</span>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 leading-relaxed max-w-2xl mx-auto mb-6">
            {t('auth.privacyCommitmentDesc')}
          </p>
          <div className="flex items-center justify-center gap-6 text-xs text-sky-400 font-medium">
            <a href="/privacy.html" className="hover:underline inline-flex items-center gap-1">
              <FileText className="w-3.5 h-3.5" />
              <span>{t('auth.privacyPolicyLink')}</span>
            </a>
            <span className="text-slate-700">&bull;</span>
            <a href="/terms.html" className="hover:underline inline-flex items-center gap-1">
              <ExternalLink className="w-3.5 h-3.5" />
              <span>{t('auth.termsLink')}</span>
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full border-t border-slate-800/80 bg-slate-950 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <ChroniXLogo size="sm" variant="dark" />
            <span className="ml-2">&copy; 2026 ChroniX. {t('auth.copyright')}</span>
          </div>

          <div className="flex items-center gap-6">
            <a href="/privacy.html" className="hover:text-slate-300 transition-colors">
              {t('auth.privacyPolicyLink')}
            </a>
            <a href="/terms.html" className="hover:text-slate-300 transition-colors">
              {t('auth.termsLink')}
            </a>
            <a href="mailto:support@chronix-ai.com" className="hover:text-slate-300 transition-colors">
              {t('auth.supportContact')}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

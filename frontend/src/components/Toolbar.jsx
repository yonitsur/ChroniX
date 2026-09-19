import React, { useState, useEffect, useRef } from 'react';
import {
  Sun,
  Moon,
  ChevronDown,
  Check,
  LogIn,
  LogOut,
  UserRound,
  Info,
  Zap,
  ShieldCheck,
  Key,
  Loader2,
  Trash2,
  Globe,
  FolderOpen,
  AlertTriangle,
  Sparkles,
  FileText,
  Compass,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { getQuotaPolicyText } from '../utils/quotaPolicy';
import { getApiKey } from '../api';

export default function Toolbar({
  theme = 'light',
  onToggleTheme,
  onOpenSaved,
  onOpenAdmin,
  onOpenDisclaimer,
  onOpenAbout,
  onGoHome,
  onOpenAuth,
  onOpenPublicRoute,
  quota,
  onOpenQuota,
  onStartGuide,
}) {
  const isDark = theme === 'dark';
  const { user, logout, deleteAccount, isGuest } = useAuth();
  const { language, setLanguage, supportedLanguages, activeLanguageInfo, isRtl, t } = useLanguage();

  const effectiveIsGuest = Boolean(isGuest || !user || user?.is_anonymous || quota?.is_guest);

  const activeQuota = quota || {
    is_admin: false,
    is_guest: effectiveIsGuest,
    mode: 'limited',
    daily_paid_limit: 5,
    remaining_paid: 5,
    used_today: 0,
    registered_mode: 'limited',
    registered_daily_limit: 15,
  };

  // True once the user has fallen back to the shared free key for this quota cycle
  // (daily paid-prompt quota exhausted in 'limited' mode) — surfaced as a small dot on the avatar.
  const isOnFreeTierNow = Boolean(
    quota &&
    !quota.is_admin &&
    !getApiKey() &&
    quota.mode === 'limited' &&
    quota.daily_paid_limit !== -1 &&
    (quota.remaining_paid ?? 0) <= 0
  );

  // Dropdown states
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deleteInputText, setDeleteInputText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const langMenuRef = useRef(null);
  const deleteConfirmWord = t('settings.deleteAccountConfirmWord') || 'DELETE';

  const handleDeleteAccount = async () => {
    if (deleteInputText.trim().toLowerCase() !== deleteConfirmWord.toLowerCase()) return;
    setIsDeleting(true);
    setDeleteError('');
    try {
      await deleteAccount();
      setIsDeleteConfirmOpen(false);
      setDeleteInputText('');
    } catch (error) {
      console.error('Account deletion error:', error);
      setDeleteError(error.message || t('settings.deleteAccountError'));
    } finally {
      setIsDeleting(false);
    }
  };

  // Close menus on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setIsUserMenuOpen(false);
      }
      if (langMenuRef.current && !langMenuRef.current.contains(event.target)) {
        setIsLangMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="w-full select-none z-40 transition-colors" dir="ltr" style={{ direction: 'ltr' }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-5 sm:pt-7">
        <div className="public-top-header justify-end" dir="ltr" style={{ direction: 'ltr', justifyContent: 'flex-end' }}>
          {/* Right: Actions */}
          <div className="public-header-actions" dir="ltr" style={{ direction: 'ltr' }}>
            {/* Theme switcher */}
            <button
              type="button"
              onClick={onToggleTheme}
              title={isDark ? t('toolbar.switchThemeLight') : t('toolbar.switchThemeDark')}
              aria-label={isDark ? t('toolbar.switchThemeLight') : t('toolbar.switchThemeDark')}
              className="public-btn-icon cursor-pointer shrink-0"
            >
              {isDark ? (
                <Sun className="w-4 h-4 text-amber-400 hover:rotate-45 transition-transform" />
              ) : (
                <Moon className="w-4 h-4 text-ink-muted hover:-rotate-12 transition-transform" />
              )}
            </button>

            {/* Language dropdown */}
            <div className="relative shrink-0" ref={langMenuRef}>
              <button
                type="button"
                onClick={() => setIsLangMenuOpen((prev) => !prev)}
                title={t('settings.languageHeading')}
                aria-label={t('settings.languageHeading')}
                className="public-btn-lang cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5 text-accent shrink-0" />
                <span>{activeLanguageInfo?.nativeLabel || language}</span>
                <ChevronDown className={`w-3 h-3 text-ink-subtle shrink-0 transition-transform ${isLangMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {isLangMenuOpen && (
                <div
                  className="absolute top-full mt-2 right-0 w-52 py-1.5 bg-surface-overlay border border-line rounded-panel shadow-pop z-50 animate-in fade-in zoom-in-95 duration-150"
                  dir={isRtl ? 'rtl' : 'ltr'}
                >
                  <div className="max-h-64 overflow-y-auto py-0.5">
                    {supportedLanguages.map((l) => {
                      const isSelected = l.code === language;
                      return (
                        <button
                          key={l.code}
                          type="button"
                          onClick={() => {
                            setLanguage(l.code);
                            setIsLangMenuOpen(false);
                          }}
                          className={`w-full px-3 py-1.5 text-xs flex items-center justify-between transition-colors cursor-pointer text-start ${
                            isSelected
                              ? 'bg-accent-soft text-accent font-bold'
                              : 'text-ink-muted hover:bg-surface-hover'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-5 text-center font-mono text-caption px-1 py-0.5 rounded bg-surface-sunken text-ink-muted">
                              {l.badge}
                            </span>
                            <span className="truncate">{l.nativeLabel}</span>
                            <span className="text-caption text-ink-subtle">({l.label})</span>
                          </div>
                          {isSelected && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* User Profile / Unified Account & App Menu */}
            {user ? (
              <div className="relative shrink-0" ref={userMenuRef}>
                <button
                  id="guide-more-actions"
                  type="button"
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                  className="public-btn-lang cursor-pointer"
                  title={isGuest ? t('toolbar.guestLabel') : user.email}
                >
                  <div className="relative shrink-0">
                    {user.user_metadata?.avatar_url || user.user_metadata?.picture ? (
                      <img
                        src={user.user_metadata.avatar_url || user.user_metadata?.picture}
                        alt="Avatar"
                        className="w-5 h-5 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-5 h-5 rounded-md bg-accent flex items-center justify-center text-accent-fg text-caption font-bold uppercase shrink-0">
                        {isGuest ? <UserRound className="w-3.5 h-3.5" /> : (user.user_metadata?.full_name || user.email || 'U')[0]}
                      </div>
                    )}
                    {isOnFreeTierNow && (
                      <span
                        className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-warning border border-surface-overlay"
                        title={t('quota.badgeFreeTier')}
                        aria-label={t('quota.badgeFreeTier')}
                      />
                    )}
                  </div>
                  <span className="max-w-[100px] truncate text-xs font-semibold">
                    {isGuest ? t('toolbar.guestLabel') : user.user_metadata?.full_name || user.email?.split('@')[0]}
                  </span>
                  <ChevronDown className={`w-3 h-3 text-ink-subtle shrink-0 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {isUserMenuOpen && (
                  <div
                    className="absolute top-full mt-2 right-0 w-60 bg-surface-overlay border border-line rounded-panel shadow-pop py-1.5 z-50 text-xs text-start animate-in fade-in duration-150"
                    dir={isRtl ? 'rtl' : 'ltr'}
                  >
                    {/* Header: User details */}
                    <div className="px-3 py-2 border-b border-line text-start">
                      <p className="font-semibold text-ink truncate text-start">
                        {isGuest ? t('toolbar.guestLabel') : user.user_metadata?.full_name || 'User'}
                      </p>
                      {!isGuest && (
                        <p className="text-ink-subtle truncate text-caption text-start">
                          {user.email}
                        </p>
                      )}
                    </div>

                    {isGuest && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onOpenAuth?.('signin');
                        }}
                        className="w-full text-start px-3 py-2.5 flex items-center gap-2.5 text-accent hover:bg-accent-soft transition-colors cursor-pointer border-b border-line font-medium"
                      >
                        <LogIn className="w-4 h-4 shrink-0" />
                        <span>{t('toolbar.signInOrRegister') || t('toolbar.signIn')}</span>
                      </button>
                    )}

                    {/* Daily Quota Summary */}
                    <div
                      id="guide-menu-quota"
                      data-guide="menu-quota"
                      className="px-3 py-2 border-b border-line bg-surface-sunken/70"
                    >
                      <div className="text-caption font-semibold mb-1">
                        <div className="flex items-center justify-between">
                          <span className="text-ink-muted flex items-center gap-1">
                            <Zap className="w-3 h-3 text-accent shrink-0" />
                            <span>{activeQuota.is_admin ? t('quota.tierAdmin') : t('quota.timelineQuotaTitle')}</span>
                          </span>
                          {!activeQuota.is_admin && activeQuota.mode === 'limited' && (
                            <span className="text-caption font-bold text-accent">
                              {activeQuota.remaining_paid ?? 0}/{activeQuota.daily_paid_limit ?? 5}
                            </span>
                          )}
                        </div>
                        <div className="flex justify-start mt-1">
                          <button
                            id="guide-menu-api-key"
                            data-guide="menu-api-key"
                            type="button"
                            onClick={() => {
                              setIsUserMenuOpen(false);
                              onOpenQuota?.();
                            }}
                            className="flex items-center gap-1 text-caption text-accent hover:underline cursor-pointer"
                          >
                            <Key className="w-3 h-3" />
                            {t('toolbar.apiKeySettings')}
                          </button>
                        </div>
                      </div>

                      {!activeQuota.is_admin && (
                        effectiveIsGuest ? (
                          <div className="space-y-1.5 my-1.5 pt-0.5">
                            <p className="text-caption text-ink-muted leading-relaxed text-start">
                              {getQuotaPolicyText(t, 'guest', activeQuota.mode || 'limited', {
                                used: activeQuota.used_today ?? 0,
                                total: activeQuota.daily_paid_limit ?? 5,
                                registeredMode: activeQuota.registered_mode ?? 'limited',
                                registeredLimit: activeQuota.registered_daily_limit ?? 15,
                              })}
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-1.5 my-1.5 pt-0.5">
                            {activeQuota.mode === 'limited' && (
                              <div className="w-full bg-surface-active h-1.5 rounded-full overflow-hidden my-1">
                                <div
                                  className="bg-accent h-full rounded-full transition-all duration-300"
                                  style={{
                                    width: `${Math.min(
                                      100,
                                      Math.max(0, ((activeQuota.remaining_paid ?? 0) / (activeQuota.daily_paid_limit || 15)) * 100)
                                    )}%`
                                  }}
                                />
                              </div>
                            )}
                            <p className="text-caption text-ink-muted leading-relaxed text-start">
                              {getQuotaPolicyText(t, 'registered', activeQuota.mode || 'limited', {
                                used: activeQuota.used_today ?? 0,
                                total: activeQuota.daily_paid_limit ?? 15,
                              })}
                            </p>
                          </div>
                        )
                      )}
                    </div>

                    {/* Section: Timeline & Content */}
                    <div className="py-1 border-b border-line">
                      <div className="px-3 pt-1 pb-0.5 text-caption font-bold text-ink-subtle uppercase tracking-wider text-start">
                        {t('toolbar.timelineSection')}
                      </div>

                      <button
                        id="guide-menu-saved"
                        type="button"
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onOpenSaved?.();
                        }}
                        className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
                      >
                        <FolderOpen className="w-4 h-4 text-ink-subtle shrink-0" />
                        <span className="font-medium">{t('toolbar.savedTimelines')}</span>
                      </button>

                      {quota?.is_admin && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            onOpenAdmin?.();
                          }}
                          className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
                        >
                          <ShieldCheck className="w-4 h-4 text-success shrink-0" />
                          <span className="font-medium">Admin Panel</span>
                        </button>
                      )}
                    </div>

                    {/* Section: System & Help (In-App Modals) */}
                    <div className="py-1 border-b border-line">
                      <div className="px-3 pt-1 pb-0.5 text-caption font-bold text-ink-subtle uppercase tracking-wider text-start">
                        {t('toolbar.systemSection')}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onOpenAbout?.();
                        }}
                        className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
                      >
                        <Info className="w-4 h-4 text-ink-subtle shrink-0" />
                        <span className="font-medium">{t('toolbar.aboutChronix')}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onOpenDisclaimer?.();
                        }}
                        className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
                      >
                        <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                        <span className="font-medium">{t('toolbar.aiDisclaimer')}</span>
                      </button>

                      {onStartGuide && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            onStartGuide?.();
                          }}
                          className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
                        >
                          <Compass className="w-4 h-4 text-ink-subtle shrink-0" />
                          <span className="font-medium">{t('tour.start')}</span>
                        </button>
                      )}
                    </div>

                    {/* Section: Platform & Legal (Public Pages) */}
                    <div className={`py-1 ${!isGuest ? 'border-b border-line' : ''}`}>
                      <div className="px-3 pt-1 pb-0.5 text-caption font-bold text-ink-subtle uppercase tracking-wider text-start">
                        {t('toolbar.legalSection')}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onOpenPublicRoute?.('features');
                        }}
                        className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
                      >
                        <Sparkles className="w-4 h-4 text-accent shrink-0" />
                        <span className="font-medium">{t('toolbar.features') || t('auth.navFeatures') || 'Features'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onOpenPublicRoute?.('privacy');
                        }}
                        className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
                      >
                        <ShieldCheck className="w-4 h-4 text-ink-subtle shrink-0" />
                        <span className="font-medium">{t('toolbar.privacyPolicy') || t('auth.privacyPolicyLink') || 'Privacy Policy'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onOpenPublicRoute?.('terms');
                        }}
                        className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
                      >
                        <FileText className="w-4 h-4 text-ink-subtle shrink-0" />
                        <span className="font-medium">{t('toolbar.termsOfService') || t('auth.termsLink') || 'Terms of Service'}</span>
                      </button>
                    </div>

                    {/* Section: Account Actions */}
                    {!isGuest && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            setDeleteError('');
                            setDeleteInputText('');
                            setIsDeleteConfirmOpen(true);
                          }}
                          className="w-full text-start px-3 py-2 flex items-center gap-2 text-danger hover:bg-danger-soft transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>{t('toolbar.deleteAccount')}</span>
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            setIsUserMenuOpen(false);
                            await logout();
                          }}
                          className="w-full text-start px-3 py-2 flex items-center gap-2 text-ink-muted hover:bg-surface-hover transition-colors cursor-pointer"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>{t('toolbar.signOut')}</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onOpenAuth?.('signin')}
                className="public-btn-enter cursor-pointer"
                title={t('toolbar.signIn')}
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>{t('toolbar.signIn')}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/70 animate-in fade-in duration-150">
          <div
            className={`bg-surface-raised border border-danger/40 rounded-sheet w-full max-w-sm p-5 shadow-panel space-y-4 ${
              isRtl ? 'text-right' : 'text-left'
            }`}
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            <div className="flex items-center gap-2.5 text-danger">
              <div className="p-2 rounded-control bg-danger-soft text-danger border border-danger/30">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-sm text-ink">
                  {t('settings.deleteAccountConfirmTitle')}
                </h4>
                <p className="text-caption text-danger font-medium">
                  {user?.email}
                </p>
              </div>
            </div>

            <p className="text-xs text-ink-muted leading-relaxed">
              {t('settings.deleteAccountConfirmText')}
            </p>

            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                {t('settings.deleteAccountTypeConfirm', { word: `"${deleteConfirmWord}"` })}
              </label>
              <input
                type="text"
                value={deleteInputText}
                onChange={(event) => setDeleteInputText(event.target.value)}
                placeholder={deleteConfirmWord}
                disabled={isDeleting}
                className="w-full bg-surface-sunken border border-danger/40 rounded-control px-3 py-2 text-xs text-ink outline-none focus:border-danger font-mono shadow-control"
              />
            </div>

            {deleteError && (
              <p className="text-xs text-danger font-medium">
                {deleteError}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                onClick={() => {
                  setIsDeleteConfirmOpen(false);
                  setDeleteInputText('');
                  setDeleteError('');
                }}
                disabled={isDeleting}
                className="px-3.5 py-1.5 rounded-control text-ink-muted hover:text-ink hover:bg-surface-hover text-xs font-medium transition-colors cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={deleteInputText.trim().toLowerCase() !== deleteConfirmWord.toLowerCase() || isDeleting}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-control bg-danger hover:bg-danger-hover disabled:opacity-40 disabled:cursor-default text-danger-fg font-semibold text-xs shadow-control transition-all cursor-pointer"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{t('settings.deleteAccountProcessing')}</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{t('settings.deleteAccountBtn')}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

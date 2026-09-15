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
  Trash2,
  Globe,
  FolderOpen,
  AlertTriangle,
  Sparkles,
  MessageSquare
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { getQuotaPolicyText } from '../utils/quotaPolicy';

export default function Toolbar({
  theme = 'light',
  onToggleTheme,
  onOpenSaved,
  onOpenAdmin,
  onOpenDisclaimer,
  onOpenAbout,
  onGoHome,
  onOpenAuth,
  quota,
  onOpenQuota,
}) {
  const isDark = theme === 'dark';
  const { user, logout, isGuest } = useAuth();
  const { language, setLanguage, supportedLanguages, activeLanguageInfo, isRtl, t } = useLanguage();

  // Dropdown states
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const langMenuRef = useRef(null);

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
                            <span className="w-5 text-center font-mono text-[10px] px-1 py-0.5 rounded bg-surface-sunken text-ink-muted">
                              {l.badge}
                            </span>
                            <span className="truncate">{l.nativeLabel}</span>
                            <span className="text-[10px] text-ink-subtle">({l.label})</span>
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
                  {user.user_metadata?.avatar_url || user.user_metadata?.picture ? (
                    <img
                      src={user.user_metadata.avatar_url || user.user_metadata?.picture}
                      alt="Avatar"
                      className="w-5 h-5 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-5 h-5 rounded-md bg-accent flex items-center justify-center text-accent-fg text-[10px] font-bold uppercase shrink-0">
                      {isGuest ? <UserRound className="w-3.5 h-3.5" /> : (user.user_metadata?.full_name || user.email || 'U')[0]}
                    </div>
                  )}
                  <span className="max-w-[100px] truncate text-xs font-semibold">
                    {isGuest ? t('toolbar.guestLabel') : user.user_metadata?.full_name || user.email?.split('@')[0]}
                  </span>
                  <ChevronDown className={`w-3 h-3 text-ink-subtle shrink-0 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {isUserMenuOpen && (
                  <div
                    className="absolute top-full mt-2 right-0 w-60 bg-surface-overlay border border-line rounded-panel shadow-pop py-1.5 z-50 text-xs animate-in fade-in duration-150"
                    dir={isRtl ? 'rtl' : 'ltr'}
                  >
                    {/* Header: User details */}
                    <div className="px-3 py-2 border-b border-line">
                      <p className="font-semibold text-ink truncate">
                        {isGuest ? t('toolbar.guestLabel') : user.user_metadata?.full_name || 'User'}
                      </p>
                      <p className="text-ink-subtle truncate text-[11px]">
                        {isGuest
                          ? quota?.mode === 'free'
                            ? t('auth.guestCaptionFree')
                            : quota?.mode === 'unlimited'
                            ? t('auth.guestCaptionUnlimited')
                            : t('auth.guestCaption', {
                                timelines: quota?.daily_paid_limit > 0 ? quota.daily_paid_limit : 5,
                                chats: quota?.guest_daily_chat_limit > 0 ? quota.guest_daily_chat_limit : 15
                              })
                          : user.email}
                      </p>
                    </div>

                    {isGuest && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onOpenAuth?.();
                        }}
                        className="w-full text-start px-3 py-2 flex items-center gap-2 text-accent hover:bg-accent-soft transition-colors cursor-pointer border-b border-line font-medium"
                      >
                        <UserRound className="w-3.5 h-3.5" />
                        <span>{t('toolbar.guestSaveAccount')}</span>
                      </button>
                    )}

                    {/* Daily Quota Summary */}
                    {quota && (
                      <div className="px-3 py-2 border-b border-line bg-surface-sunken/70">
                        <div className="flex items-center justify-between text-[11px] font-semibold mb-1">
                          <span className="text-ink-muted flex items-center gap-1">
                            <Zap className="w-3 h-3 text-accent shrink-0" />
                            <span>{quota.is_admin ? t('quota.tierAdmin') : t('quota.modalTitle')}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setIsUserMenuOpen(false);
                              onOpenQuota?.();
                            }}
                            className="text-[10px] text-accent hover:underline cursor-pointer"
                          >
                            {t('common.learnMore')}
                          </button>
                        </div>
                        {!quota.is_admin && (
                          quota.is_guest ? (
                            <div className="space-y-1.5 my-1.5 pt-0.5">
                              {quota.mode === 'limited' && (
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="text-ink-muted flex items-center gap-1.5">
                                    <Sparkles className="w-3 h-3 text-accent shrink-0" />
                                    {t('quota.timelineQuotaTitle')}
                                  </span>
                                  <span className="font-bold text-accent">
                                    {quota.remaining_paid ?? 0}/{quota.daily_paid_limit}
                                  </span>
                                </div>
                              )}
                              {quota.mode === 'limited' && quota.guest_daily_chat_limit > 0 && (
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="text-ink-muted flex items-center gap-1.5">
                                    <MessageSquare className="w-3 h-3 text-accent shrink-0" />
                                    {t('quota.chatQuotaTitle')}
                                  </span>
                                  <span className="font-bold text-accent">
                                    {quota.guest_chat_remaining ?? 0}/{quota.guest_daily_chat_limit}
                                  </span>
                                </div>
                              )}
                              <p className="text-[11px] text-ink-muted leading-relaxed">
                                {getQuotaPolicyText(t, 'guest', quota.mode, {
                                  used: quota.used_today,
                                  total: quota.daily_paid_limit
                                })}
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-1.5 my-1.5 pt-0.5">
                              {quota.mode === 'limited' && (
                                <>
                                  <div className="w-full bg-surface-active h-1.5 rounded-full overflow-hidden my-1">
                                    <div
                                      className="bg-accent h-full rounded-full transition-all duration-300"
                                      style={{
                                        width: `${Math.min(
                                          100,
                                          Math.max(0, ((quota.remaining_paid ?? 0) / (quota.daily_paid_limit || 15)) * 100)
                                        )}%`
                                      }}
                                    />
                                  </div>
                                  <div className="flex items-center justify-between text-[10px] text-ink-subtle font-medium">
                                    <span>{t('quota.statusUsed', { used: quota.used_today ?? 0, limit: quota.daily_paid_limit })}</span>
                                    <span className="font-bold text-accent">
                                      {quota.remaining_paid > 0 ? `${quota.remaining_paid}` : t('quota.tierFree')}
                                    </span>
                                  </div>
                                </>
                              )}
                              <p className="text-[11px] text-ink-muted leading-relaxed">
                                {getQuotaPolicyText(t, 'registered', quota.mode, {
                                  used: quota.used_today,
                                  total: quota.daily_paid_limit
                                })}
                              </p>
                            </div>
                          )
                        )}
                      </div>
                    )}

                    {/* Section: Timeline & Content */}
                    <div className="py-1 border-b border-line">
                      <div className="px-3 pt-1 pb-0.5 text-[10px] font-bold text-ink-subtle uppercase tracking-wider">
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

                    {/* Section: System & About */}
                    <div className="py-1 border-b border-line">
                      <div className="px-3 pt-1 pb-0.5 text-[10px] font-bold text-ink-subtle uppercase tracking-wider">
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
                    </div>

                    {/* Section: Account Actions */}
                    <div className="pt-1">
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

                      {!isGuest && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            onOpenQuota?.();
                          }}
                          className="w-full text-start px-3 py-2 flex items-center gap-2 text-danger hover:bg-danger-soft transition-colors cursor-pointer border-t border-line"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>{t('toolbar.deleteAccount')}</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={onOpenAuth}
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
    </header>
  );
}

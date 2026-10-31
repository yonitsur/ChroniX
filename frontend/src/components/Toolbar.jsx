import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
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
  Languages,
  FolderOpen,
  AlertTriangle,
  Palette,
  HelpCircle,
} from './icons/ThemeIcons';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { getQuotaPolicyText } from '../utils/quotaPolicy';
import { isExtraVisualThemesEnabled } from '../utils/featureFlags';
import { getApiKey } from '../api';
import { AGE_OPTIONS, getThemeOptions, ThemeSwatch } from './ExperienceControls';
import { CommunityCupIcon } from './KofiSupportButton';
import CreditCostsModal from './CreditCostsModal';

export default function Toolbar({
  theme = 'light',
  onToggleTheme,
  visualTheme = 'classic',
  onChangeVisualTheme,
  onOpenSaved,
  onOpenAdmin,
  onOpenDisclaimer,
  onOpenAbout,
  onOpenCommunitySupport,
  onGoHome,
  onOpenAuth,
  onOpenPublicRoute,
  quota,
  onOpenQuota,
  onStartGuide,
}) {
  const isDark = theme === 'dark';
  const { user, logout, deleteAccount, isGuest } = useAuth();
  const { language, setLanguage, supportedLanguages, activeLanguageInfo, isRtl, t, contentMode, setContentMode } = useLanguage();

  const effectiveIsGuest = Boolean(isGuest || !user || user?.is_anonymous || quota?.is_guest);

  const activeQuota = quota || {
    is_admin: false,
    is_guest: effectiveIsGuest,
    mode: 'limited',
    daily_paid_limit: effectiveIsGuest ? 10 : 25,
    remaining_paid: effectiveIsGuest ? 10 : 25,
    used_today: 0,
    registered_mode: 'limited',
    registered_daily_limit: 25,
  };

  // True once the user has fallen back to the shared free key for this quota cycle
  // (daily paid-prompt quota exhausted in 'limited' mode) - surfaced as a small dot on the avatar.
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
  const [isUserMenuThemeOpen, setIsUserMenuThemeOpen] = useState(false);
  const [isCreditCostsOpen, setIsCreditCostsOpen] = useState(false);
  const userMenuRef = useRef(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deleteInputText, setDeleteInputText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const langMenuRef = useRef(null);
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const themeMenuRef = useRef(null);
  const [userMenuMaxHeight, setUserMenuMaxHeight] = useState(null);
  const [langMenuMaxHeight, setLangMenuMaxHeight] = useState(null);
  const [themeMenuMaxHeight, setThemeMenuMaxHeight] = useState(null);
  const [highlightModeToggle, setHighlightModeToggle] = useState(false);
  const deleteConfirmWord = t('settings.deleteAccountConfirmWord') || 'DELETE';
  const themeOptions = getThemeOptions();
  const showThemePicker = isExtraVisualThemesEnabled();
  const currentThemeOption = themeOptions.find((opt) => opt.id === visualTheme) || themeOptions[0];

  useEffect(() => {
    const onHighlight = () => {
      setHighlightModeToggle(true);
      const timer = setTimeout(() => setHighlightModeToggle(false), 1800);
      return () => clearTimeout(timer);
    };
    window.addEventListener('chronix:highlight-mode-toggle', onHighlight);
    return () => window.removeEventListener('chronix:highlight-mode-toggle', onHighlight);
  }, []);

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
        setIsUserMenuThemeOpen(false);
      }
      if (langMenuRef.current && !langMenuRef.current.contains(event.target)) {
        setIsLangMenuOpen(false);
      }
      if (themeMenuRef.current && !themeMenuRef.current.contains(event.target)) {
        setIsThemeMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Dynamically clamp open dropdown heights to the *visible* viewport (visualViewport / innerHeight)
  // so mobile browser address/navigation bars never clip bottom menu items (e.g. "Sign out").
  useLayoutEffect(() => {
    if (!isUserMenuOpen && !isLangMenuOpen && !isThemeMenuOpen) return undefined;

    const updateDropdownHeights = () => {
      const vv = window.visualViewport;
      const visibleBottom = vv
        ? Math.min(window.innerHeight, vv.offsetTop + vv.height)
        : window.innerHeight;
      const menuGap = 8; // matches mt-2
      const bottomMargin = 16;

      if (isUserMenuOpen && userMenuRef.current) {
        const rect = userMenuRef.current.getBoundingClientRect();
        setUserMenuMaxHeight(Math.max(140, Math.floor(visibleBottom - rect.bottom - menuGap - bottomMargin)));
      }
      if (isLangMenuOpen && langMenuRef.current) {
        const rect = langMenuRef.current.getBoundingClientRect();
        setLangMenuMaxHeight(Math.max(120, Math.floor(visibleBottom - rect.bottom - menuGap - bottomMargin - 12)));
      }
      if (isThemeMenuOpen && themeMenuRef.current) {
        const rect = themeMenuRef.current.getBoundingClientRect();
        setThemeMenuMaxHeight(Math.max(120, Math.floor(visibleBottom - rect.bottom - menuGap - bottomMargin)));
      }
    };

    updateDropdownHeights();
    window.addEventListener('resize', updateDropdownHeights);
    window.addEventListener('orientationchange', updateDropdownHeights);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', updateDropdownHeights);
    vv?.addEventListener('scroll', updateDropdownHeights);
    return () => {
      window.removeEventListener('resize', updateDropdownHeights);
      window.removeEventListener('orientationchange', updateDropdownHeights);
      vv?.removeEventListener('resize', updateDropdownHeights);
      vv?.removeEventListener('scroll', updateDropdownHeights);
    };
  }, [isUserMenuOpen, isLangMenuOpen, isThemeMenuOpen]);

  return (
    <header className="toolbar-header w-full select-none z-40 transition-colors pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-6 px-3 sm:px-6" dir="ltr" style={{ direction: 'ltr' }}>
      <div className="max-w-6xl mx-auto flex items-center justify-end">
        {/* Floating Navigation Island Dock */}
        <div
          className="floating-dock-glass inline-flex items-center gap-1 sm:gap-1.5 p-1 sm:p-1.5 rounded-full transition-colors duration-200"
          dir="ltr"
          style={{ direction: 'ltr' }}
        >
          {/* Theme switcher */}
          <button
            type="button"
            onClick={onToggleTheme}
            title={isDark ? t('toolbar.switchThemeLight') : t('toolbar.switchThemeDark')}
            aria-label={isDark ? t('toolbar.switchThemeLight') : t('toolbar.switchThemeDark')}
            className="w-9 h-9 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors duration-150 cursor-pointer active:scale-95 shrink-0 dock-btn-luminescent touch-manipulation"
          >
            {isDark ? (
              <Sun className="w-4 h-4 text-amber-400 hover:rotate-45 transition-transform" />
            ) : (
              <Moon className="w-4 h-4 text-ink-muted hover:-rotate-12 transition-transform" />
            )}
          </button>

          {/* Hairline divider */}
          <div className="w-px h-4 bg-line-strong/70 shrink-0 mx-0.5" />

          {/* Age group (content + tone) and design (look only) */}
          {onChangeVisualTheme && (
            <>
              <div
                role="radiogroup"
                aria-label={t('toolbar.ageModeSection')}
                title={t('toolbar.ageModeSwitchTooltip')}
                dir={isRtl ? 'rtl' : 'ltr'}
                className={`seg-track hidden sm:inline-flex items-center p-0.5 rounded-full gap-0.5 shrink-0 transition-all duration-300 ${
                  highlightModeToggle ? 'ring-2 ring-amber-400 scale-105' : ''
                }`}
              >
                {AGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={contentMode === opt.id}
                    onClick={() => setContentMode?.(opt.id)}
                    title={t(opt.rangeKey)}
                    className={`seg-item inline-flex items-center justify-center px-2 sm:px-2.5 py-1 min-h-[28px] sm:min-h-0 rounded-full text-xs font-medium cursor-pointer transition-all touch-manipulation ${
                      contentMode === opt.id
                        ? 'seg-item-active text-ink font-semibold shadow-2xs'
                        : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    <span>{t(opt.labelKey)}</span>
                  </button>
                ))}
              </div>

              {/* Design picker (behind the EXTRA_VISUAL_THEMES flag) */}
              {showThemePicker && (
              <div className="relative shrink-0 hidden sm:block" ref={themeMenuRef}>
                <button
                  type="button"
                  onClick={() => setIsThemeMenuOpen((prev) => !prev)}
                  title={`${t('toolbar.visualThemeSection')} – ${t('toolbar.visualThemeSwitchTooltip')}`}
                  aria-label={t('toolbar.visualThemeSection')}
                  aria-haspopup="menu"
                  aria-expanded={isThemeMenuOpen}
                  className="w-9 h-9 sm:w-8 sm:h-8 rounded-full flex items-center justify-center hover:bg-surface-hover transition-colors duration-150 cursor-pointer active:scale-95 shrink-0 touch-manipulation"
                >
                  <ThemeSwatch theme={visualTheme} size={16} />
                </button>

                {isThemeMenuOpen && (
                  <div
                    role="menu"
                    className="absolute top-full mt-2 right-0 w-52 max-h-[calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-5.25rem)] overflow-y-auto overscroll-contain touch-pan-y menu-scroller p-1.5 bg-surface-overlay rounded-xl border border-line shadow-pop z-50 animate-in fade-in zoom-in-95 duration-150"
                    style={
                      themeMenuMaxHeight != null
                        ? { maxHeight: `calc(${themeMenuMaxHeight}px - env(safe-area-inset-bottom, 0px))` }
                        : undefined
                    }
                    dir={isRtl ? 'rtl' : 'ltr'}
                  >
                    <div className="px-2 pt-1 pb-1.5">
                      <div className="text-xs font-semibold text-ink">{t('toolbar.visualThemeSection')}</div>
                      <div className="text-caption text-ink-subtle leading-snug">{t('toolbar.visualThemeSwitchTooltip')}</div>
                    </div>
                    {themeOptions.map((opt) => {
                      const isSelected = visualTheme === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={isSelected}
                          onClick={() => {
                            onChangeVisualTheme(opt.id);
                            setIsThemeMenuOpen(false);
                          }}
                          className={`w-full px-2.5 py-1.5 text-xs rounded-lg flex items-center justify-between gap-2 transition-colors cursor-pointer text-start ${isSelected
                              ? 'bg-accent-soft text-ink font-semibold'
                              : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
                            }`}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <ThemeSwatch theme={opt.id} size={16} />
                            <span className="truncate">{t(opt.labelKey)}</span>
                          </span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              )}

              {/* Hairline divider */}
              <div className="w-px h-4 bg-line-strong/70 shrink-0 mx-0.5 hidden sm:block" />
            </>
          )}

          {/* Language dropdown */}
          <div className="relative shrink-0" ref={langMenuRef}>
            <button
              type="button"
              onClick={() => setIsLangMenuOpen((prev) => !prev)}
              title={t('settings.languageHeading')}
              aria-label={t('settings.languageHeading')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 sm:py-1 min-h-[36px] sm:min-h-0 rounded-full text-xs font-medium text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors duration-150 cursor-pointer active:scale-95 dock-btn-luminescent touch-manipulation"
            >
              <Languages className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
              <span className="font-medium">{activeLanguageInfo?.nativeLabel || language}</span>
              <ChevronDown className={`w-3 h-3 text-ink-subtle shrink-0 transition-transform duration-200 ${isLangMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {isLangMenuOpen && (
              <div
                className="absolute top-full mt-2 right-0 w-44 max-w-[calc(100vw-1.5rem)] p-1.5 bg-surface-overlay rounded-xl border border-line shadow-pop z-50 animate-in fade-in zoom-in-95 duration-150"
                dir={isRtl ? 'rtl' : 'ltr'}
              >
                <div
                  className="max-h-64 overflow-y-auto overscroll-contain touch-pan-y py-0.5 menu-scroller"
                  style={
                    langMenuMaxHeight != null
                      ? { maxHeight: `min(16rem, calc(${langMenuMaxHeight}px - env(safe-area-inset-bottom, 0px)))` }
                      : undefined
                  }
                >
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
                        className={`w-full px-2.5 py-1.5 text-xs rounded-lg flex items-center justify-between transition-colors cursor-pointer text-start ${isSelected
                            ? 'bg-accent-soft text-ink font-semibold'
                            : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
                          }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className="w-5 text-center font-mono text-caption px-1 py-0.5 rounded-md bg-surface-hover text-ink-muted font-medium">
                            {l.badge}
                          </span>
                          <span className="truncate">{l.nativeLabel}</span>
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Hairline divider */}
          <div className="w-px h-4 bg-line-strong/70 shrink-0 mx-0.5" />

          {/* Community Support & Transparency Modal Trigger */}
          <button
            type="button"
            onClick={() => onOpenCommunitySupport?.()}
            title={t('toolbar.communityTopTooltip')}
            aria-label={t('toolbar.communityTopTooltip')}
            className="w-9 h-9 sm:w-auto sm:h-auto inline-flex items-center justify-center gap-1.5 px-0 sm:px-2.5 py-0 sm:py-1 rounded-full text-xs font-medium text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors duration-150 cursor-pointer active:scale-95 shrink-0 dock-btn-luminescent touch-manipulation"
          >
            <CommunityCupIcon className="w-[22px] h-[22px] sm:w-[19px] sm:h-[19px] shrink-0" />
            <span className="font-medium hidden sm:inline">{t('toolbar.communityTopBtn')}</span>
          </button>

          {/* Hairline divider */}
          <div className="w-px h-4 bg-line-strong/70 shrink-0 mx-0.5" />

          {/* Quick Sign-in Button for Guests */}
          {isGuest && (
            <button
              type="button"
              onClick={() => onOpenAuth?.('signin')}
              className="flex items-center gap-1.5 px-3 py-1.5 sm:py-1 min-h-[36px] sm:min-h-0 rounded-full text-xs font-semibold bg-accent text-accent-fg hover:bg-accent-hover transition-colors cursor-pointer shadow-control shrink-0 active:scale-95 touch-manipulation"
              title={t('toolbar.signInOrRegister') || 'Sign in or register'}
            >
              <LogIn className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">{t('toolbar.signIn') || 'Sign in'}</span>
            </button>
          )}

          {/* User Profile / Unified Account & App Settings Menu */}
          <div className="relative shrink-0" ref={userMenuRef}>
            <button
              id="guide-more-actions"
              type="button"
              onClick={() => {
                setIsUserMenuOpen(!isUserMenuOpen);
                setIsUserMenuThemeOpen(false);
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 sm:py-1 min-h-[36px] sm:min-h-0 rounded-full text-xs font-medium text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors duration-150 cursor-pointer active:scale-95 dock-btn-luminescent touch-manipulation"
              title={effectiveIsGuest ? t('toolbar.guestLabel') : (user?.email || t('toolbar.moreActions'))}
            >
              <div className="relative shrink-0">
                {user?.user_metadata?.avatar_url || user?.user_metadata?.picture ? (
                  <img
                    src={user.user_metadata.avatar_url || user.user_metadata?.picture}
                    alt="Avatar"
                    className="w-5 h-5 rounded-full object-cover shrink-0 ring-1 ring-line"
                  />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center text-accent-fg text-[10px] font-bold uppercase shrink-0 shadow-sm">
                    {effectiveIsGuest ? <UserRound className="w-3.5 h-3.5" /> : (user?.user_metadata?.full_name || user?.email || 'U')[0]}
                  </div>
                )}
                {isOnFreeTierNow && (
                  <span
                    className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-warning border border-surface-overlay"
                    title={t('quota.badgeFreeTier')}
                    aria-label={t('quota.badgeFreeTier')}
                  />
                )}
              </div>
              <span className="max-w-[100px] truncate text-xs font-semibold hidden sm:inline">
                {effectiveIsGuest ? t('toolbar.guestLabel') : (user?.user_metadata?.full_name || user?.email?.split('@')[0])}
              </span>
              <ChevronDown className={`w-3 h-3 text-ink-subtle shrink-0 transition-transform duration-200 ${isUserMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {isUserMenuOpen && (
              <div
                role="menu"
                className="absolute top-full mt-2 right-0 w-68 max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-5.25rem)] overflow-y-auto overscroll-contain touch-pan-y menu-scroller bg-surface-overlay rounded-xl border border-line shadow-pop p-1.5 pb-2.5 z-50 text-xs text-start animate-in fade-in zoom-in-95 duration-150"
                style={
                  userMenuMaxHeight != null
                    ? { maxHeight: `calc(${userMenuMaxHeight}px - env(safe-area-inset-bottom, 0px))` }
                    : undefined
                }
                dir={isRtl ? 'rtl' : 'ltr'}
              >
                {/* Header: User details */}
                <div className="px-3 py-2 rounded-lg bg-surface-hover/50 border border-line/70 mb-1 text-start">
                  <p className="font-semibold text-ink truncate text-start">
                    {effectiveIsGuest ? t('toolbar.guestLabel') : (user?.user_metadata?.full_name || 'User')}
                  </p>
                  {!effectiveIsGuest && user?.email && (
                    <p className="text-ink-subtle truncate text-caption text-start">
                      {user.email}
                    </p>
                  )}
                </div>

                {effectiveIsGuest && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onOpenAuth?.('signin');
                    }}
                    className="w-full text-start px-2.5 py-2 rounded-xl flex items-center gap-2.5 text-accent hover:bg-accent-soft transition-colors cursor-pointer font-medium mb-1"
                  >
                    <LogIn className="w-4 h-4 shrink-0" />
                    <span>{t('toolbar.signInOrRegister') || t('toolbar.signIn')}</span>
                  </button>
                )}

                {/* Daily Quota Summary */}
                <div
                  id="guide-menu-quota"
                  data-guide="menu-quota"
                  className="p-2.5 rounded-lg border border-line bg-surface-hover/50 mb-1"
                >
                  <div className="text-caption font-semibold mb-1">
                    <div className="flex items-center justify-between">
                      <span className="text-ink-muted flex items-center gap-1">
                        <Zap className="w-3 h-3 text-accent shrink-0" />
                        <span>{activeQuota.is_admin ? t('quota.tierAdmin') : t('quota.timelineQuotaTitle')}</span>
                      </span>
                      {!activeQuota.is_admin && activeQuota.mode === 'limited' && (
                        <span className="text-caption font-bold text-accent">
                          {activeQuota.remaining_paid ?? 0}/{activeQuota.daily_paid_limit ?? (effectiveIsGuest ? 10 : 25)}
                        </span>
                      )}
                    </div>
                  </div>

                  {!activeQuota.is_admin && (
                    <div className="space-y-2 my-1 pt-0.5">
                      {(activeQuota.mode || 'limited') === 'limited' ? (
                        <>
                          <div className="w-full bg-surface-active h-1.5 rounded-full overflow-hidden">
                            <div
                              className="bg-accent h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${Math.min(
                                  100,
                                  Math.max(
                                    0,
                                    ((activeQuota.remaining_paid ?? 0) /
                                      (activeQuota.daily_paid_limit || (effectiveIsGuest ? 10 : 25))) *
                                      100,
                                  ),
                                )}%`,
                              }}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setIsUserMenuOpen(false);
                              setIsCreditCostsOpen(true);
                            }}
                            className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-surface-sunken/80 border border-line/60 text-[11px] text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
                          >
                            <span className="flex items-center gap-1.5 text-start">
                              <HelpCircle className="w-3.5 h-3.5 text-accent shrink-0" />
                              <span className="font-medium">{t('creditCosts.menuButton')}</span>
                            </span>
                            <ChevronDown className={`w-3 h-3 shrink-0 text-ink-subtle ${isRtl ? 'rotate-90' : '-rotate-90'}`} />
                          </button>
                          <p className="text-caption text-ink-muted leading-relaxed text-start">
                            {effectiveIsGuest
                              ? (activeQuota.registered_mode ?? 'limited') === 'unlimited'
                                ? t('quota.menuGuestLimitedToUnlimitedNote')
                                : (activeQuota.registered_mode ?? 'limited') === 'limited' &&
                                    (activeQuota.registered_daily_limit ?? 25) >
                                      (activeQuota.daily_paid_limit ?? 10)
                                  ? t('quota.menuGuestLimitedNote', {
                                      registeredLimit: activeQuota.registered_daily_limit ?? 25,
                                    })
                                  : t('quota.menuGuestLimitedToSaveNote')
                              : t('quota.menuUserLimitedNote')}
                          </p>
                        </>
                      ) : (
                        <p className="text-caption text-ink-muted leading-relaxed text-start">
                          {effectiveIsGuest
                            ? getQuotaPolicyText(t, 'guest', activeQuota.mode, {
                                used: activeQuota.used_today ?? 0,
                                total: activeQuota.daily_paid_limit ?? 10,
                                registeredMode: activeQuota.registered_mode ?? 'limited',
                                registeredLimit: activeQuota.registered_daily_limit ?? 25,
                              })
                            : getQuotaPolicyText(t, 'registered', activeQuota.mode, {
                                used: activeQuota.used_today ?? 0,
                                total: activeQuota.daily_paid_limit ?? 25,
                              })}
                        </p>
                      )}
                      {activeQuota.community_pool_exhausted && (
                        <p className="text-caption text-warning leading-snug text-start pt-0.5">
                          {t('quota.communityPoolExhausted')}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Section: API Key */}
                <div className="py-1 border-t border-line/60">
                  <div className="px-2.5 pt-1 pb-0.5 text-caption font-bold text-ink-subtle uppercase tracking-wider text-start">
                    {t('toolbar.apiKeySection')}
                  </div>
                  <button
                    id="guide-menu-api-key"
                    data-guide="menu-api-key"
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onOpenQuota?.();
                    }}
                    className="w-full text-start px-2.5 py-1.5 rounded-xl flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover/80 transition-colors cursor-pointer"
                  >
                    <Key className="w-4 h-4 text-accent shrink-0" />
                    <span className="font-medium">{t('toolbar.apiKeySettings')}</span>
                  </button>
                </div>

                {/* Section: Timeline & Content */}
                <div className="py-1 border-t border-line/60">
                  <div className="px-2.5 pt-1 pb-0.5 text-caption font-bold text-ink-subtle uppercase tracking-wider text-start">
                    {t('toolbar.timelineSection')}
                  </div>

                  <button
                    id="guide-menu-saved"
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onOpenSaved?.();
                    }}
                    className="w-full text-start px-2.5 py-1.5 rounded-xl flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover/80 transition-colors cursor-pointer"
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
                      className="w-full text-start px-2.5 py-1.5 rounded-xl flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover/80 transition-colors cursor-pointer"
                    >
                      <ShieldCheck className="w-4 h-4 text-success shrink-0" />
                      <span className="font-medium">Admin Panel</span>
                    </button>
                  )}
                </div>

                {/* Section: Age group (content + tone) */}
                <div className="py-1 border-t border-line/60">
                  <div className="px-2.5 pt-1 pb-1 text-caption font-bold text-ink-subtle uppercase tracking-wider text-start flex items-center gap-1.5">
                    <UserRound className="w-3.5 h-3.5 text-accent shrink-0" />
                    <span>{t('toolbar.ageModeSection')}</span>
                  </div>

                  <div className="space-y-1 px-1">
                    {AGE_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setContentMode?.(opt.id)}
                        className={`w-full text-start px-2.5 py-1.5 rounded-xl flex items-center justify-between gap-2 transition-all cursor-pointer ${
                          contentMode === opt.id
                            ? 'bg-accent-soft text-ink font-semibold border border-accent/40'
                            : 'text-ink-muted hover:text-ink hover:bg-surface-hover/80 border border-transparent'
                        }`}
                      >
                        <span className="flex items-baseline gap-1.5 truncate leading-tight">
                          <span className="truncate">{t(opt.labelKey)}</span>
                          <span className="text-caption text-ink-subtle font-normal truncate">{t(opt.rangeKey)}</span>
                        </span>
                        {contentMode === opt.id && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Section: Design (look only) Dropdown Submenu */}
                {showThemePicker && (
                <div className="py-0.5 border-t border-line/60">
                  <button
                    type="button"
                    onClick={() => setIsUserMenuThemeOpen((prev) => !prev)}
                    className="w-full text-start px-2.5 py-1.5 rounded-xl flex items-center justify-between text-ink-muted hover:text-ink hover:bg-surface-hover/80 transition-colors cursor-pointer font-medium"
                    aria-expanded={isUserMenuThemeOpen}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Palette className="w-4 h-4 text-accent shrink-0" />
                      <span className="truncate">{t('toolbar.visualThemeSection')}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-caption text-ink-subtle shrink-0">
                      <span className="flex items-center gap-1.5 font-medium truncate max-w-[95px]">
                        <ThemeSwatch theme={visualTheme} size={13} />
                        <span className="truncate">{t(currentThemeOption.labelKey)}</span>
                      </span>
                      <ChevronDown
                        className={`w-3.5 h-3.5 transition-transform duration-150 ${
                          isUserMenuThemeOpen ? 'rotate-180 text-accent' : ''
                        }`}
                      />
                    </span>
                  </button>

                  {isUserMenuThemeOpen && (
                    <div className="mx-1 my-1 p-1 bg-surface-hover/60 rounded-xl border border-line flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100">
                      {themeOptions.map((opt) => {
                        const isSelected = visualTheme === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              onChangeVisualTheme?.(opt.id);
                              setIsUserMenuThemeOpen(false);
                            }}
                            className={`w-full px-2.5 py-1.5 text-xs rounded-lg flex items-center justify-between gap-2 transition-colors cursor-pointer text-start ${
                              isSelected
                                ? 'bg-accent-soft text-accent font-bold'
                                : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
                            }`}
                          >
                            <span className="flex items-center gap-2 truncate">
                              <ThemeSwatch theme={opt.id} size={14} />
                              <span className="truncate">{t(opt.labelKey)}</span>
                            </span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                )}

                {/* Section: System & Help (In-App Modals) */}
                <div className="py-1 border-t border-line/60">
                  <div className="px-2.5 pt-1 pb-0.5 text-caption font-bold text-ink-subtle uppercase tracking-wider text-start">
                    {t('toolbar.systemSection')}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onOpenAbout?.();
                    }}
                    className="w-full text-start px-2.5 py-1.5 rounded-xl flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover/80 transition-colors cursor-pointer"
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
                    className="w-full text-start px-2.5 py-1.5 rounded-xl flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover/80 transition-colors cursor-pointer"
                  >
                    <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                    <span className="font-medium">{t('toolbar.aiDisclaimer')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onOpenCommunitySupport?.();
                    }}
                    className="w-full text-start px-2.5 py-1.5 rounded-xl flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover/80 transition-colors cursor-pointer"
                  >
                    <CommunityCupIcon className="w-[18px] h-[18px] text-ink-subtle shrink-0" />
                    <span className="font-medium">{t('toolbar.communityMenuRow')}</span>
                  </button>
                </div>

                {/* Section: Account Actions */}
                {!effectiveIsGuest && (
                  <div className="pt-1 border-t border-line/60">
                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        setDeleteError('');
                        setDeleteInputText('');
                        setIsDeleteConfirmOpen(true);
                      }}
                      className="w-full text-start px-2.5 py-2 sm:py-1.5 rounded-xl flex items-center gap-2 text-danger hover:bg-danger-soft transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5 shrink-0" />
                      <span>{t('toolbar.deleteAccount')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        setIsUserMenuOpen(false);
                        await logout();
                      }}
                      className="w-full text-start px-2.5 py-2 sm:py-1.5 rounded-xl flex items-center gap-2 text-ink-muted hover:bg-surface-hover/80 transition-colors cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5 shrink-0" />
                      <span>{t('toolbar.signOut')}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/70 animate-in fade-in duration-150">
          <div
            className={`bg-surface-raised border border-danger/40 rounded-sheet w-full max-w-sm p-5 shadow-panel space-y-4 ${isRtl ? 'text-right' : 'text-left'
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

      <CreditCostsModal
        isOpen={isCreditCostsOpen}
        onClose={() => setIsCreditCostsOpen(false)}
        quota={activeQuota}
        isGuest={effectiveIsGuest}
        onOpenSettings={onOpenQuota}
      />
    </header>
  );
}

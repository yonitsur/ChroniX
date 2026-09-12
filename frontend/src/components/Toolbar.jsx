import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Sparkles,
  FolderOpen,
  Download,
  Sun,
  Moon,
  AlertTriangle,
  ChevronDown,
  Check,
  LogIn,
  LogOut,
  UserRound,
  MoreVertical,
  User as UserIcon,
  Info,
  Languages,
  Zap,
  ShieldCheck,
  Leaf,
  Trash2,
  Compass,
  MessageSquare
} from 'lucide-react';
import ChroniXLogo from './ChroniXLogo';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { FLOATING_Z } from '../utils/floatingFocus';

export default function Toolbar({
  timelineData,
  onZoomIn,
  onZoomOut,
  onFitAll,
  onOpenSaved,
  onOpenAdmin,
  onOpenExport,
  onExportJson,
  onExportImage,
  onOpenDisclaimer,
  onOpenAbout,
  onStartGuide,
  isGenerating,
  onStopGenerate,
  theme = 'light',
  onToggleTheme,
  onGenerate,
  onGoHome,
  onOpenAuth,
  activePrompt,
  quota,
  onOpenQuota
}) {
  const isDark = theme === 'dark';
  const { user, logout, isGuest } = useAuth();
  const { language, setLanguage, supportedLanguages, activeLanguageInfo, isRtl, t } = useLanguage();
  
  // Dropdown states
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef(null);

  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const langMenuRef = useRef(null);

  // Close menus on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setIsUserMenuOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target)) {
        setIsMoreMenuOpen(false);
      }
      if (langMenuRef.current && !langMenuRef.current.contains(event.target)) {
        setIsLangMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const rightControlsRef = useRef(null);
  const toolbarContainerRef = useRef(null);
  const logoRef = useRef(null);

  // Clear any legacy custom prompt size keys from storage
  useEffect(() => {
    try {
      localStorage.removeItem('vt_prompt_custom_width');
      localStorage.removeItem('vt_prompt_expanded');
    } catch (e) {}
  }, []);

  // Granular one-by-one room detection for top bar controls:
  // zoom is always kept on desktop/tablet when timelineData exists,
  // language -> theme can collapse gracefully if width is constrained.
  const [visibleIcons, setVisibleIcons] = useState({
    zoom: true,
    language: true,
    theme: true
  });

  const updateRoomAvailability = useCallback(() => {
    if (!toolbarContainerRef.current) return;
    const containerWidth = toolbarContainerRef.current.clientWidth;

    // Mobile viewport (< 768px): row has logo & core controls
    if (containerWidth < 768) {
      setVisibleIcons({
        zoom: false,
        language: containerWidth >= 360,
        theme: containerWidth >= 300
      });
      return;
    }

    const logoWidth = logoRef.current?.offsetWidth || 130;
    // Permanent controls: More Menu (38px with gap) + User Profile / Sign In (52px or 86px with gap)
    const permanentWidth = 38 + (user ? 52 : 86);
    const zoomWidth = timelineData ? 104 : 0;
    const paddingAndGaps = 32 + 16 + 16 + 10;

    // Ordered list of collapsible items from first to remove to last to remove as container gets tighter:
    const collapsibleItems = [
      { id: 'theme', width: 38, isEligible: true },
      { id: 'language', width: 90, isEligible: true },
    ];

    const eligibleItems = collapsibleItems.filter((it) => it.isEligible);
    const availableSpace = containerWidth - (logoWidth + permanentWidth + zoomWidth + paddingAndGaps);

    const newVisible = {
      zoom: Boolean(timelineData),
      language: false,
      theme: false,
    };

    // Calculate cumulative widths from each eligible item to the end
    eligibleItems.forEach((item, index) => {
      const neededFromHere = eligibleItems.slice(index).reduce((sum, curr) => sum + curr.width, 0);
      newVisible[item.id] = availableSpace >= neededFromHere;
    });

    setVisibleIcons(newVisible);
  }, [timelineData, user]);

  useEffect(() => {
    updateRoomAvailability();
    if (!toolbarContainerRef.current) return;

    let resizeObserver;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateRoomAvailability();
      });
      resizeObserver.observe(toolbarContainerRef.current);
    }

    window.addEventListener('resize', () => updateRoomAvailability());

    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', () => updateRoomAvailability());
    };
  }, [updateRoomAvailability, timelineData, user, language]);

  return (
    <header
      dir="ltr"
      className="relative w-full bg-surface border-b border-line select-none transition-colors z-40"
      style={
        isMoreMenuOpen || isUserMenuOpen || isLangMenuOpen
          ? { zIndex: FLOATING_Z.ALWAYS_ON_TOP }
          : undefined
      }
    >
      <div
        ref={toolbarContainerRef}
        className="px-3 sm:px-4 py-2 flex items-center justify-between gap-2 sm:gap-4 text-ink-muted"
      >
        
        {/* Left: Branding & Home button */}
        <div ref={logoRef} className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => {
              onGoHome?.();
            }}
            className="flex items-center cursor-pointer transition-transform duration-200 hover:scale-105 active:scale-95 focus:outline-none rounded-lg group"
            title={t('toolbar.goHome')}
            aria-label={t('toolbar.goHome')}
          >
            <ChroniXLogo mode="minimal" size="md" className="h-8 sm:h-9 w-auto shrink-0 transition-opacity group-hover:opacity-90" />
          </button>
        </div>

        {/* Right: Core Actions & More Dropdown */}
        <div
          ref={rightControlsRef}
          className="flex items-center gap-1 sm:gap-1.5 shrink-0 min-w-0 ml-auto transition-all duration-200"
        >
          {/* Zoom Controls (Desktop only - only when timeline exists) - Unified Segmented Control */}
          {timelineData && visibleIcons.zoom && (
            <div className="hidden md:flex items-center h-8 bg-surface-raised rounded-control border border-line shadow-control overflow-hidden shrink-0">
              <button
                type="button"
                onClick={onZoomIn}
                className="h-full w-8 flex items-center justify-center text-ink-muted hover:text-accent hover:bg-surface-hover transition-colors cursor-pointer border-r border-line active:bg-surface-active select-none"
                title={t('toolbar.zoomIn')}
                aria-label={t('toolbar.zoomIn')}
              >
                <ZoomIn className="w-3.5 h-3.5 shrink-0" />
              </button>
              <button
                type="button"
                onClick={onZoomOut}
                className="h-full w-8 flex items-center justify-center text-ink-muted hover:text-accent hover:bg-surface-hover transition-colors cursor-pointer border-r border-line active:bg-surface-active select-none"
                title={t('toolbar.zoomOut')}
                aria-label={t('toolbar.zoomOut')}
              >
                <ZoomOut className="w-3.5 h-3.5 shrink-0" />
              </button>
              <button
                type="button"
                onClick={onFitAll}
                className="h-full w-8 flex items-center justify-center text-ink-muted hover:text-accent hover:bg-surface-hover transition-colors cursor-pointer active:bg-surface-active select-none"
                title={t('toolbar.fitAll')}
                aria-label={t('toolbar.fitAll')}
              >
                <Maximize2 className="w-3.5 h-3.5 shrink-0" />
              </button>
            </div>
          )}

          {/* Dedicated Language Selector Dropdown (11 Languages) */}
          {visibleIcons.language && (
            <div className="relative" ref={langMenuRef}>
              <button
                type="button"
                onClick={() => setIsLangMenuOpen((prev) => !prev)}
                className="h-8 shrink-0 whitespace-nowrap select-none flex items-center justify-center gap-1.5 px-2.5 bg-surface-raised hover:bg-surface-hover text-ink-muted hover:text-ink rounded-control border border-line shadow-control transition-all active:scale-95 cursor-pointer text-xs font-semibold"
                title={t('settings.languageHeading')}
                aria-label={t('settings.languageHeading')}
                aria-expanded={isLangMenuOpen}
              >
                <Languages className="w-3.5 h-3.5 text-accent shrink-0" />
                <span className="whitespace-nowrap tracking-wide leading-none inline-flex items-center gap-1">
                  <strong className="text-accent font-bold">{activeLanguageInfo?.badge || language.toUpperCase()}</strong>
                </span>
                <ChevronDown className={`w-3 h-3 text-ink-subtle transition-transform ${isLangMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {isLangMenuOpen && (
                <div
                  className={`absolute top-full mt-1.5 ${isRtl ? 'left-0' : 'right-0'} w-52 py-1.5 bg-surface-raised rounded-panel shadow-panel border border-line z-50 animate-in fade-in zoom-in-95 duration-150`}
                >
                  <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-subtle border-b border-line mb-1">
                    {t('toolbar.language')}
                  </div>
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
          )}

          {/* Light / Dark Mode Toggle Button */}
          {visibleIcons.theme && (
            <button
              type="button"
              onClick={onToggleTheme}
              className="h-8 w-8 shrink-0 flex items-center justify-center bg-surface-raised hover:bg-surface-hover text-ink-muted rounded-control border border-line shadow-control transition-all active:scale-95 cursor-pointer"
              title={isDark ? t('toolbar.switchThemeLight') : t('toolbar.switchThemeDark')}
              aria-label={isDark ? t('toolbar.switchThemeLight') : t('toolbar.switchThemeDark')}
            >
              {isDark ? (
                <Sun className="w-4 h-4 text-amber-400 hover:rotate-45 transition-transform" />
              ) : (
                <Moon className="w-4 h-4 text-ink-muted hover:-rotate-12 transition-transform" />
              )}
            </button>
          )}

          {/* More Actions Dropdown Menu */}
          <div className="relative shrink-0" ref={moreMenuRef}>
            <button
              id="guide-more-actions"
              type="button"
              onClick={() => setIsMoreMenuOpen((prev) => !prev)}
              className={`h-8 w-8 shrink-0 flex items-center justify-center rounded-control border shadow-control transition-all active:scale-95 cursor-pointer ${
                isMoreMenuOpen
                  ? 'bg-surface-active border-line-strong text-ink'
                  : 'bg-surface-raised hover:bg-surface-hover text-ink-muted hover:text-ink border-line'
              }`}
              title={t('toolbar.moreActions')}
              aria-label={t('toolbar.moreActions')}
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {isMoreMenuOpen && (
              <div
                className={`absolute right-0 mt-2 w-60 max-h-[calc(100vh-5rem)] overflow-y-auto overscroll-contain bg-surface-raised rounded-panel shadow-panel border border-line py-1.5 z-50 text-xs animate-in fade-in duration-150 ${
                  isRtl ? 'text-right' : 'text-left'
                }`}
                dir={isRtl ? 'rtl' : 'ltr'}
              >
                
                {/* Timeline Actions */}
                <div className="px-3 py-1.5 text-[10px] font-bold text-ink-subtle uppercase tracking-wider">
                  {t('toolbar.timelineSection')}
                </div>

                <button
                  id="guide-menu-saved"
                  type="button"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onOpenSaved();
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
                      setIsMoreMenuOpen(false);
                      onOpenAdmin?.();
                    }}
                    className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4 text-success shrink-0" />
                    <span className="font-medium">Admin Panel</span>
                  </button>
                )}

                {/* Export Options */}
                <div className="my-1 border-t border-line" />
                <div className="px-3 py-1.5 text-[10px] font-bold text-ink-subtle uppercase tracking-wider">
                  {t('toolbar.exportSection')}
                </div>

                <button
                  type="button"
                  disabled={!timelineData}
                  onClick={() => {
                    if (!timelineData) return;
                    setIsMoreMenuOpen(false);
                    onOpenExport?.();
                  }}
                  className={`w-full text-start px-3 py-2 flex items-center gap-2.5 transition-colors ${
                    timelineData
                      ? 'text-ink hover:text-accent hover:bg-surface-hover cursor-pointer'
                      : 'text-ink-subtle opacity-40 cursor-not-allowed pointer-events-none select-none'
                  }`}
                >
                  <Download className={`w-4 h-4 shrink-0 ${timelineData ? 'text-accent' : 'text-ink-subtle'}`} />
                  <span className={timelineData ? 'font-semibold' : 'font-medium'}>{t('toolbar.exportModal')}</span>
                </button>

                {/* System Settings & Info */}
                <div className="my-1 border-t border-line" />
                <div className="px-3 py-1.5 text-[10px] font-bold text-ink-subtle uppercase tracking-wider">
                  {t('toolbar.systemSection')}
                </div>

                {onStartGuide && timelineData && (
                  <button
                    type="button"
                    id="guide-dock-tour"
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      onStartGuide?.();
                    }}
                    className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
                    title={t('tour.startTooltip')}
                  >
                    <Compass className="w-4 h-4 text-accent shrink-0" />
                    <span className="font-medium">{t('tour.start')}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
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
                    setIsMoreMenuOpen(false);
                    onOpenDisclaimer();
                  }}
                  className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
                >
                  <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                  <span className="font-medium">{t('toolbar.aiDisclaimer')}</span>
                </button>
              </div>
            )}
          </div>

          {/* User Auth Profile / Login Button */}
          {user ? (
            <div className="relative shrink-0" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="h-8 flex items-center gap-1.5 px-1 bg-surface-raised hover:bg-surface-hover rounded-control border border-line shadow-control transition-all cursor-pointer"
                title={isGuest ? t('toolbar.guestLabel') : user.email}
              >
                {user.user_metadata?.avatar_url || user.user_metadata?.picture ? (
                  <img
                    src={user.user_metadata.avatar_url || user.user_metadata.picture}
                    alt="Avatar"
                    className="w-6 h-6 rounded-md object-cover"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-md bg-accent flex items-center justify-center text-accent-fg text-[11px] font-bold uppercase">
                    {isGuest ? <UserRound className="w-3.5 h-3.5" /> : (user.user_metadata?.full_name || user.email || 'U')[0]}
                  </div>
                )}
                <ChevronDown className="w-3 h-3 text-ink-subtle mr-0.5" />
              </button>

              {isUserMenuOpen && (
                <div
                  className={`absolute right-0 mt-2 w-56 bg-surface-raised rounded-panel shadow-panel border border-line py-1.5 z-50 text-xs animate-in fade-in duration-150 ${
                    isRtl ? 'text-right' : 'text-left'
                  }`}
                  dir={isRtl ? 'rtl' : 'ltr'}
                >
                  <div className="px-3 py-2 border-b border-line">
                    <p className="font-semibold text-ink truncate">
                      {isGuest ? t('toolbar.guestLabel') : user.user_metadata?.full_name || 'User'}
                    </p>
                    <p className="text-ink-subtle truncate text-[11px]">
                      {isGuest ? t('auth.guestCaption') : user.email}
                    </p>
                  </div>

                  {isGuest && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onOpenAuth?.();
                      }}
                      className="w-full text-start px-3 py-2 flex items-center gap-2 text-accent hover:bg-accent-soft transition-colors cursor-pointer border-b border-line"
                    >
                      <UserRound className="w-3.5 h-3.5" />
                      <span>{t('toolbar.guestSaveAccount')}</span>
                    </button>
                  )}

                  {/* Daily Quota Summary in User Menu */}
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
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-ink-muted flex items-center gap-1.5">
                                <Sparkles className="w-3 h-3 text-accent shrink-0" />
                                {t('quota.timelineQuotaTitle')}
                              </span>
                              <span className="font-bold text-accent">
                                {quota.remaining_paid ?? 0}/{quota.daily_paid_limit || 5}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-ink-muted flex items-center gap-1.5">
                                <MessageSquare className="w-3 h-3 text-accent shrink-0" />
                                {t('quota.chatQuotaTitle')}
                              </span>
                              <span className="font-bold text-accent">
                                {quota.guest_chat_remaining ?? 0}/{quota.guest_daily_chat_limit || 15}
                              </span>
                            </div>
                            <p className="text-[10px] text-ink-subtle pt-1 border-t border-line leading-tight">
                              {t('quota.guestFallbackNotice')}
                            </p>
                          </div>
                        ) : quota.daily_paid_limit === -1 ? (
                          <div className="text-[10px] font-bold text-accent">
                            {t('quota.badgeUnlimited')}
                          </div>
                        ) : (
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
                              <span>{t('quota.statusUsed', { used: quota.used_today ?? 0, limit: quota.daily_paid_limit || 15 })}</span>
                              <span className="font-bold text-accent">
                                {quota.remaining_paid > 0 ? `${quota.remaining_paid}` : t('quota.tierFree')}
                              </span>
                            </div>
                          </>
                        )
                      )}
                    </div>
                  )}

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
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenAuth}
              className="h-8 shrink-0 whitespace-nowrap flex items-center gap-1.5 px-3 bg-surface-raised hover:bg-surface-hover text-ink-muted hover:text-ink rounded-control text-xs font-semibold border border-line shadow-control transition-all active:scale-95 cursor-pointer"
              title={t('toolbar.signIn')}
            >
              <LogIn className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline whitespace-nowrap">{t('toolbar.signIn')}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}


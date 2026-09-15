import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import {
  Filter,
  LayoutList,
  Play,
  Star,
  Check,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ChevronsDownUp,
  X,
  BookOpen,
  Menu,
  Home,
  FolderOpen,
  Download,
  ShieldCheck,
  Sun,
  Moon,
  Languages,
  Compass,
  Info,
  AlertTriangle,
  UserRound,
  LogOut,
  LogIn,
  Copy,
  FileText,
  FileCode,
  Table,
  Printer,
  Image as ImageIcon,
  Code2,
  Share2,
  Send,
  Mail,
  Loader2,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { FLOATING_Z } from '../utils/floatingFocus';
import { getLaneColor, getDistinctCategories, getCategoryColor } from '../data/laneColors';
import {
  generateTimelineText,
  generateTimelineMarkdown,
  generateTimelineCsv,
  downloadFile,
  copyToClipboard,
  printTimelinePdf,
  sanitizeFilename,
} from '../utils/timelineExport';

/**
 * Modern dual-mode timeline navigation:
 * - Desktop (>= 768px): Fixed full-height slim rail (52px width) pinned to the left edge.
 *   Zero occlusion, no drag handles, rock-solid muscle memory.
 * - Mobile (< 768px): Sleek floating horizontal dock pill anchored within thumb-reach
 *   above the bottom scrubber. Zero horizontal obstruction of the timeline canvas.
 */
export default function LeftDockMenu({
  timelineData,
  activeFilter = null,
  onFilterSelect,
  isCardsListOpen = false,
  onToggleCardsList,
  isExploring = false,
  onStartExplore,
  onExploreNext,
  onExplorePrev,
  onExitExplore,
  exploreProgress = null,
  filterStarredOnly = false,
  onToggleFilterStarredOnly,
  starredCount = 0,
  hasOverview = false,
  isOverviewOpen = false,
  onToggleOverview,
  onRectChange,
  onGoHome,
  onOpenSaved,
  onExportImage,
  onExportJson,
  onOpenAdmin,
  onOpenAbout,
  onOpenDisclaimer,
  onStartGuide,
  theme,
  onToggleTheme,
  quota,
  onOpenQuota,
  onOpenAuth,
  isReadOnlyView = false,
  canShare = false,
  isShared = false,
  onGetShareLink,
}) {
  const { language, setLanguage, supportedLanguages, activeLanguageInfo, t, isRtl } = useLanguage();
  const { user, logout, isGuest } = useAuth();

  // Active popover: 'actions' | 'filter' | null
  const [openMenu, setOpenMenu] = useState(null);
  const [isLangSubmenuOpen, setIsLangSubmenuOpen] = useState(false);
  const [isExportSubmenuOpen, setIsExportSubmenuOpen] = useState(false);
  const [copiedType, setCopiedType] = useState(null); // 'text' | null
  const [isShareSubmenuOpen, setIsShareSubmenuOpen] = useState(false);
  const [shareLink, setShareLink] = useState(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState(null);

  // Viewport tracking for responsive popover placement & Tour ID binding
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  // Mobile dock collapse state
  const [mobileCollapsed, setMobileCollapsed] = useState(() => {
    try {
      return localStorage.getItem('chronix_mobile_dock_collapsed') === 'true';
    } catch (e) {
      return false;
    }
  });
  const toggleMobileCollapsed = () => {
    setOpenMenu(null);
    setIsLangSubmenuOpen(false);
    setIsExportSubmenuOpen(false);
    setIsShareSubmenuOpen(false);
    setMobileCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('chronix_mobile_dock_collapsed', String(next));
      } catch (e) {}
      return next;
    });
  };

  // If tour exploration starts, auto-expand so navigation controls are immediately visible
  useEffect(() => {
    if (isExploring && mobileCollapsed) {
      setMobileCollapsed(false);
    }
  }, [isExploring]);

  // Mobile vertical drag position
  const [mobilePosY, setMobilePosY] = useState(() => {
    try {
      const saved = localStorage.getItem('chronix_mobile_dock_top');
      const n = saved != null ? Number(saved) : NaN;
      return Number.isFinite(n) ? n : null;
    } catch (e) {
      return null;
    }
  });
  const mobileDragRef = useRef({ startY: 0, initialTop: 0, moved: false });

  const clampMobileTop = (y) => {
    const h = mobileDockRef.current?.offsetHeight || 280;
    return Math.max(56, Math.min(window.innerHeight - h - 76, y));
  };

  const handleMobileDragPointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const rect = mobileDockRef.current?.getBoundingClientRect();
    if (!rect) return;
    mobileDragRef.current = { startY: e.clientY, initialTop: rect.top, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}

    const onMove = (moveEvent) => {
      const dy = moveEvent.clientY - mobileDragRef.current.startY;
      if (Math.abs(dy) > 3) mobileDragRef.current.moved = true;
      setMobilePosY(clampMobileTop(mobileDragRef.current.initialTop + dy));
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (mobileDragRef.current.moved) {
        setMobilePosY((finalY) => {
          try {
            if (finalY != null) localStorage.setItem('chronix_mobile_dock_top', String(Math.round(finalY)));
          } catch (err) {}
          return finalY;
        });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const rootRef = useRef(null);
  const desktopRailRef = useRef(null);
  const mobileDockRef = useRef(null);
  const desktopActionsRef = useRef(null);
  const mobileActionsRef = useRef(null);
  const [actionsMaxHeight, setActionsMaxHeight] = useState(null);

  useEffect(() => {
    if (openMenu !== 'actions') {
      setActionsMaxHeight(null);
      return;
    }
    const updateMaxHeight = () => {
      const activeRef = isMobile ? mobileActionsRef.current : desktopActionsRef.current;
      if (!activeRef) return;
      const rect = activeRef.getBoundingClientRect();
      const available = Math.max(160, Math.floor(window.innerHeight - rect.top - 16));
      setActionsMaxHeight(Math.min(500, available));
    };
    updateMaxHeight();
    window.addEventListener('resize', updateMaxHeight);
    return () => window.removeEventListener('resize', updateMaxHeight);
  }, [openMenu, isMobile, mobilePosY]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Close menus on outside click
  useEffect(() => {
    if (!openMenu) return;
    const handleClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpenMenu(null);
        setIsLangSubmenuOpen(false);
        setIsExportSubmenuOpen(false);
        setIsShareSubmenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openMenu]);

  const toggle = (name) => {
    setOpenMenu((prev) => {
      if (prev === name) {
        setIsLangSubmenuOpen(false);
        setIsExportSubmenuOpen(false);
        setIsShareSubmenuOpen(false);
        return null;
      }
      return name;
    });
  };

  // Keep mobile dock on screen when window resizes
  useEffect(() => {
    const onResize = () => {
      setMobilePosY((prev) => (prev == null ? prev : clampMobileTop(prev)));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Report the rail/dock bounds to other components (like chat panel / drawers)
  useLayoutEffect(() => {
    if (!onRectChange) return;
    const measure = () => {
      if (!isMobile) {
        onRectChange({ left: 0, top: 0, right: 52, bottom: window.innerHeight, width: 52, height: window.innerHeight });
      } else if (mobileDockRef.current) {
        const r = mobileDockRef.current.getBoundingClientRect();
        onRectChange({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [isMobile, mobilePosY, mobileCollapsed, onRectChange]);

  // Reset the cached share link whenever the active timeline changes.
  useEffect(() => {
    setShareLink(null);
    setShareError(null);
    setIsShareSubmenuOpen(false);
  }, [timelineData?.id]);

  // Filterable lane/theme items
  const lanesArr = useMemo(() => timelineData?.lanes || [], [timelineData]);
  const isSingleTimeline = lanesArr.length <= 1;
  const legendCategories = useMemo(
    () => (isSingleTimeline ? getDistinctCategories(timelineData?.articles || []) : []),
    [isSingleTimeline, timelineData]
  );
  const useThemeMode = isSingleTimeline && legendCategories.length >= 2;
  const filterItems = useMemo(() => {
    const articles = timelineData?.articles || [];
    if (useThemeMode) {
      return legendCategories.map((name) => {
        const key = name.toLowerCase();
        const count = articles.filter(
          (a) => (a?.category ?? '').toString().trim().toLowerCase() === key
        ).length;
        return { id: name, name, color: getCategoryColor(name, legendCategories), count };
      });
    }
    return lanesArr.map((lane, idx) => {
      const matchKeys = [];
      if (lane.id !== undefined && lane.id !== null) matchKeys.push(lane.id);
      if (lane.title) matchKeys.push(lane.title);
      const normalizedKeys = matchKeys.map((k) => String(k).toLowerCase().trim());
      const count = articles.filter((a) =>
        normalizedKeys.includes(String(a?.lane ?? '').toLowerCase().trim())
      ).length;
      return {
        id: String(lane.id ?? lane.title ?? idx),
        name: lane.title || lane.name || `Lane ${idx + 1}`,
        color: getLaneColor(lane, idx, lanesArr),
        count,
      };
    });
  }, [useThemeMode, legendCategories, lanesArr, timelineData]);
  const canFilter = filterItems.length >= 2;

  const hasArticles = (timelineData?.articles?.length ?? 0) > 0;
  const atStart = !exploreProgress || exploreProgress.current <= 1;
  const atEnd = !exploreProgress || exploreProgress.current >= exploreProgress.total;

  // Tour play hint pulse
  const [showTourHint, setShowTourHint] = useState(false);
  const timelineSigRef = useRef(null);
  useEffect(() => {
    if (!hasArticles) {
      setShowTourHint(false);
      timelineSigRef.current = null;
      return;
    }
    const sig = `${timelineData?.title ?? ''}|${timelineData?.articles?.length ?? 0}`;
    if (sig !== timelineSigRef.current) {
      timelineSigRef.current = sig;
      setShowTourHint(!isExploring);
    }
  }, [hasArticles, timelineData, isExploring]);
  useEffect(() => {
    if (isExploring) setShowTourHint(false);
  }, [isExploring]);

  // Shared button styles: Frameless, minimal and mature — only the icon is visible by default
  const railBtn =
    'relative w-9 h-9 shrink-0 flex items-center justify-center rounded-lg transition-all duration-150 cursor-pointer select-none active:scale-95 group';
  const railIdle =
    'text-ink-muted/80 hover:text-ink hover:bg-ink/[0.06] dark:hover:bg-white/[0.08]';
  const railActive =
    'text-accent bg-accent/10 dark:bg-accent/15 font-semibold';

  const navPrev =
    'text-accent hover:bg-accent/10 rounded-lg disabled:opacity-30 disabled:cursor-default';
  const navNext =
    'bg-accent text-accent-fg shadow-sm hover:bg-accent-hover rounded-lg disabled:opacity-30 disabled:cursor-default';

  // Popover base style for desktop (opens downwards and to the right)
  const desktopPopoverBase =
    'absolute left-full top-0 ml-2 w-64 max-h-[min(500px,calc(100vh-3.5rem))] menu-scroller shadow-panel rounded-sheet border border-line bg-surface-overlay py-1.5 text-xs origin-top-left animate-in fade-in zoom-in-95 duration-150 z-40';

  // Popover base style for mobile side dock (opens downwards and to the right)
  const mobileSidePopoverBase =
    'absolute left-full top-0 ml-2.5 w-60 max-w-[calc(100vw-4.5rem)] max-h-[70vh] menu-scroller shadow-pop rounded-sheet border border-line bg-surface-overlay py-2 text-xs origin-top-left z-50 animate-in fade-in zoom-in-95 duration-150';

  // --------------------------------------------------------------------------
  // SHARED POPOVER CONTENTS & EXPORT HANDLERS
  // --------------------------------------------------------------------------

  const baseFilename = useMemo(() => {
    return sanitizeFilename(timelineData?.title || 'timeline');
  }, [timelineData?.title]);

  const handleExportText = () => {
    if (!timelineData) return;
    const text = generateTimelineText(timelineData, language);
    downloadFile(text, `${baseFilename}.txt`, 'text/plain;charset=utf-8');
    setOpenMenu(null);
    setIsExportSubmenuOpen(false);
  };

  const handleExportMarkdown = () => {
    if (!timelineData) return;
    const md = generateTimelineMarkdown(timelineData, language);
    downloadFile(md, `${baseFilename}.md`, 'text/markdown;charset=utf-8');
    setOpenMenu(null);
    setIsExportSubmenuOpen(false);
  };

  const handleExportCsv = () => {
    if (!timelineData) return;
    const csv = generateTimelineCsv(timelineData, language);
    downloadFile(csv, `${baseFilename}.csv`, 'text/csv;charset=utf-8;');
    setOpenMenu(null);
    setIsExportSubmenuOpen(false);
  };

  const handleCopyText = async () => {
    if (!timelineData) return;
    const text = generateTimelineText(timelineData, language);
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedType('text');
      setTimeout(() => setCopiedType(null), 2200);
    }
  };

  const handlePrintPdf = () => {
    if (!timelineData) return;
    printTimelinePdf(timelineData, language, isRtl);
    setOpenMenu(null);
    setIsExportSubmenuOpen(false);
  };

  // Ensures sharing is enabled + resolves the "/t/<id>" link, caching it locally.
  const resolveShareLink = async () => {
    if (shareLink) return shareLink;
    setShareLoading(true);
    setShareError(null);
    try {
      const url = await onGetShareLink?.();
      setShareLink(url);
      return url;
    } catch (e) {
      setShareError(e?.message || 'Failed to create share link');
      return null;
    } finally {
      setShareLoading(false);
    }
  };

  const canUseNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const handleShareTimeline = async () => {
    setIsExportSubmenuOpen(false);
    setIsLangSubmenuOpen(false);
    setShareError(null);

    if (!canUseNativeShare) {
      // Desktop browsers without Web Share get the app-specific choices immediately.
      setIsShareSubmenuOpen(true);
      await resolveShareLink();
      return;
    }

    // Start enabling the link, but invoke Web Share in the original click task so
    // browsers retain the transient user activation required by navigator.share().
    const readyLink = resolveShareLink();
    const immediateUrl = shareLink
      || `${window.location.origin}/t/${encodeURIComponent(timelineData?.id || '')}`;
    try {
      await navigator.share({
        title: timelineData?.title || t('toolbar.shareTimeline'),
        url: immediateUrl,
      });
      await readyLink;
    } catch (e) {
      if (e?.name !== 'AbortError') {
        setShareError(e?.message || 'Unable to open sharing options');
        setIsShareSubmenuOpen(true);
      }
    }
  };

  const renderActionsMenu = (isMobileVariant = false) => (
    <>
      {/* Saved Timelines */}
      <button
        id={(!isMobile && !isMobileVariant) || (isMobile && isMobileVariant) ? 'guide-menu-saved' : undefined}
        data-guide="menu-saved"
        type="button"
        onClick={() => {
          setOpenMenu(null);
          setIsExportSubmenuOpen(false);
          setIsLangSubmenuOpen(false);
          setIsShareSubmenuOpen(false);
          onOpenSaved?.();
        }}
        className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
      >
        <FolderOpen className="w-4 h-4 text-ink-subtle shrink-0" />
        <span className="font-medium">{t('toolbar.savedTimelines')}</span>
      </button>

      {/* Share Timeline: native share sheet, or direct app fallbacks when unavailable */}
      {canShare && (
        <div>
          <button
            type="button"
            onClick={handleShareTimeline}
            disabled={shareLoading}
            className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer disabled:opacity-50"
          >
            {shareLoading ? (
              <Loader2 className="w-4 h-4 text-accent shrink-0 animate-spin" />
            ) : (
              <Share2 className="w-4 h-4 text-accent shrink-0" />
            )}
            <span className="font-medium">{t('toolbar.shareTimeline')}</span>
          </button>

          {isShareSubmenuOpen && (
            <div className="mx-2 mb-2 p-1 bg-surface-sunken/60 rounded-control border border-line flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100">
              {shareError && (
                <p className="px-2.5 py-1.5 text-[11px] text-danger">{shareError}</p>
              )}
              {shareLoading && (
                <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-ink-subtle">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                  <span>{t('toolbar.shareVia')}</span>
                </div>
              )}
              {shareLink && (
                <>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(shareLink)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full px-2.5 py-1.5 text-xs rounded flex items-center gap-2 text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
                  >
                    <Send className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                    <span className="truncate">WhatsApp</span>
                  </a>
                  <a
                    href={`https://t.me/share/url?url=${encodeURIComponent(shareLink)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full px-2.5 py-1.5 text-xs rounded flex items-center gap-2 text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
                  >
                    <Send className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                    <span className="truncate">Telegram</span>
                  </a>
                  <a
                    href={`mailto:?subject=${encodeURIComponent(timelineData?.title || 'ChroniX Timeline')}&body=${encodeURIComponent(shareLink)}`}
                    className="w-full px-2.5 py-1.5 text-xs rounded flex items-center gap-2 text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
                  >
                    <Mail className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                    <span className="truncate">{t('toolbar.shareEmail')}</span>
                  </a>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Export Timeline Dropdown Submenu */}
      <div>
        <button
          type="button"
          onClick={() => {
            setIsExportSubmenuOpen((prev) => !prev);
            setIsLangSubmenuOpen(false);
            setIsShareSubmenuOpen(false);
          }}
          className="w-full text-start px-3 py-2 flex items-center justify-between text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
          aria-expanded={isExportSubmenuOpen}
        >
          <span className="flex items-center gap-2.5">
            <Download className="w-4 h-4 text-ink-subtle shrink-0" />
            <span className="font-medium">{t('toolbar.exportModal')}</span>
          </span>
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform duration-150 ${
              isExportSubmenuOpen ? 'rotate-180 text-accent' : 'text-ink-subtle'
            }`}
          />
        </button>

        {isExportSubmenuOpen && (
          <div className="mx-2 mb-2 p-1 bg-surface-sunken/60 rounded-control border border-line flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100">
            {/* Quick Copy to Clipboard */}
            <button
              type="button"
              onClick={handleCopyText}
              className={`w-full px-2.5 py-1.5 text-xs rounded flex items-center justify-between transition-colors cursor-pointer text-start ${
                copiedType === 'text'
                  ? 'bg-success/15 text-success font-semibold'
                  : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                {copiedType === 'text' ? (
                  <Check className="w-3.5 h-3.5 text-success shrink-0" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                )}
                <span className="truncate">
                  {copiedType === 'text'
                    ? t('exportModal.copiedNotification')
                    : t('exportModal.copyTitle')}
                </span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-overlay text-ink-subtle font-medium shrink-0 ms-1">
                {copiedType === 'text' ? '✓' : (t('exportModal.quickShareBadge') || 'Copy')}
              </span>
            </button>

            {/* PNG Image */}
            <button
              type="button"
              onClick={() => {
                setOpenMenu(null);
                setIsExportSubmenuOpen(false);
                onExportImage?.();
              }}
              className="w-full px-2.5 py-1.5 text-xs rounded flex items-center justify-between text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-2 truncate">
                <ImageIcon className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                <span className="truncate">{t('exportModal.pngTitle')}</span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-overlay text-ink-subtle font-semibold shrink-0 ms-1">
                .PNG
              </span>
            </button>

            {/* Print / PDF */}
            <button
              type="button"
              onClick={handlePrintPdf}
              className="w-full px-2.5 py-1.5 text-xs rounded flex items-center justify-between text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-2 truncate">
                <Printer className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                <span className="truncate">{t('exportModal.printTitle')}</span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-overlay text-ink-subtle font-semibold shrink-0 ms-1">
                .PDF
              </span>
            </button>

            {/* Markdown */}
            <button
              type="button"
              onClick={handleExportMarkdown}
              className="w-full px-2.5 py-1.5 text-xs rounded flex items-center justify-between text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-2 truncate">
                <FileCode className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                <span className="truncate">{t('exportModal.mdTitle')}</span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-overlay text-ink-subtle font-semibold shrink-0 ms-1">
                .MD
              </span>
            </button>

            {/* Plain Text */}
            <button
              type="button"
              onClick={handleExportText}
              className="w-full px-2.5 py-1.5 text-xs rounded flex items-center justify-between text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-2 truncate">
                <FileText className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                <span className="truncate">{t('exportModal.txtTitle')}</span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-overlay text-ink-subtle font-semibold shrink-0 ms-1">
                .TXT
              </span>
            </button>

            {/* Excel / CSV */}
            <button
              type="button"
              onClick={handleExportCsv}
              className="w-full px-2.5 py-1.5 text-xs rounded flex items-center justify-between text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-2 truncate">
                <Table className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                <span className="truncate">{t('exportModal.csvTitle')}</span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-overlay text-ink-subtle font-semibold shrink-0 ms-1">
                .CSV
              </span>
            </button>

            {/* JSON Data */}
            <button
              type="button"
              onClick={() => {
                setOpenMenu(null);
                setIsExportSubmenuOpen(false);
                onExportJson?.();
              }}
              className="w-full px-2.5 py-1.5 text-xs rounded flex items-center justify-between text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-2 truncate">
                <Code2 className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                <span className="truncate">{t('exportModal.jsonTitle')}</span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-overlay text-ink-subtle font-semibold shrink-0 ms-1">
                .JSON
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Admin Panel (if admin) */}
      {quota?.is_admin && (
        <button
          type="button"
          onClick={() => {
            setOpenMenu(null);
            setIsExportSubmenuOpen(false);
            setIsLangSubmenuOpen(false);
            onOpenAdmin?.();
          }}
          className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
        >
          <ShieldCheck className="w-4 h-4 text-success shrink-0" />
          <span className="font-medium">Admin Panel</span>
        </button>
      )}

      <div className="my-1 border-t border-line" />

      {/* Theme toggle */}
      <button
        type="button"
        onClick={() => onToggleTheme?.()}
        className="w-full text-start px-3 py-2 flex items-center justify-between text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-2.5">
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400 shrink-0" />
          ) : (
            <Moon className="w-4 h-4 text-ink-subtle shrink-0" />
          )}
          <span className="font-medium">
            {theme === 'dark' ? t('toolbar.switchThemeLight') : t('toolbar.switchThemeDark')}
          </span>
        </span>
        <span className="text-[10px] text-ink-subtle uppercase font-mono">
          {theme === 'dark' ? 'Dark' : 'Light'}
        </span>
      </button>

      {/* Language Selector (Submenu Dropdown) */}
      <div className="border-t border-line">
        <button
          type="button"
          onClick={() => {
            setIsLangSubmenuOpen((prev) => !prev);
            setIsExportSubmenuOpen(false);
            setIsShareSubmenuOpen(false);
          }}
          className="w-full text-start px-3 py-2 flex items-center justify-between text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
          aria-expanded={isLangSubmenuOpen}
        >
          <span className="flex items-center gap-2.5">
            <Languages className="w-4 h-4 text-accent shrink-0" />
            <span className="font-medium">{t('toolbar.language')}</span>
          </span>
          <span className="flex items-center gap-1 text-[11px] text-ink-subtle">
            <span className="truncate max-w-[85px] font-medium">{activeLanguageInfo?.nativeLabel || language}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${isLangSubmenuOpen ? 'rotate-180 text-accent' : ''}`} />
          </span>
        </button>

        {isLangSubmenuOpen && (
          <div className="mx-2 mb-2 p-1 bg-surface-sunken/60 rounded-control border border-line max-h-44 overflow-y-auto overscroll-contain">
            <div className="flex flex-col gap-0.5">
              {supportedLanguages.map((l) => {
                const isSelected = l.code === language;
                return (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => {
                      setLanguage(l.code);
                      setIsLangSubmenuOpen(false);
                      setIsExportSubmenuOpen(false);
                      setOpenMenu(null);
                    }}
                    className={`w-full px-2.5 py-1.5 text-xs rounded flex items-center justify-between transition-colors cursor-pointer text-start ${
                      isSelected
                        ? 'bg-accent-soft text-accent font-bold'
                        : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-5 text-center font-mono text-[10px] px-1 py-0.5 rounded bg-surface-overlay text-ink-muted">
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

      {/* Guided Tour */}
      {onStartGuide && (
        <button
          type="button"
          id="guide-dock-tour"
          onClick={() => {
            setOpenMenu(null);
            onStartGuide?.();
          }}
          className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-ink-muted hover:text-accent hover:bg-surface-hover transition-colors cursor-pointer border-t border-line"
          title={t('tour.startTooltip')}
        >
          <Compass className="w-4 h-4 text-accent shrink-0" />
          <span className="font-medium">{t('tour.start')}</span>
        </button>
      )}

      {/* About & Disclaimer */}
      <button
        type="button"
        onClick={() => {
          setOpenMenu(null);
          onOpenAbout?.();
        }}
        className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer border-t border-line"
      >
        <Info className="w-4 h-4 text-ink-subtle shrink-0" />
        <span className="font-medium">{t('toolbar.aboutChronix')}</span>
      </button>

      <button
        type="button"
        onClick={() => {
          setOpenMenu(null);
          onOpenDisclaimer?.();
        }}
        className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
      >
        <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
        <span className="font-medium">{t('toolbar.aiDisclaimer')}</span>
      </button>

      {/* User Account / Quota */}
      <div className="my-1 border-t border-line" />
      {user ? (
        <div className="px-3 py-2 bg-surface-sunken/60 rounded-b-md">
          <div className="flex items-center justify-between text-[11px] font-semibold text-ink truncate mb-1">
            <span className="truncate">{isGuest ? t('toolbar.guestLabel') : user.user_metadata?.full_name || user.email}</span>
            {quota && !quota.is_admin && quota.mode === 'limited' && (
              <span className="text-accent text-[10px] shrink-0 font-mono">
                {quota.remaining_paid ?? 0}/{quota.daily_paid_limit}
              </span>
            )}
            {quota && !quota.is_admin && quota.mode === 'unlimited' && (
              <span className="text-accent text-[10px] shrink-0 font-mono uppercase">
                {t('quota.badgeUnlimited')}
              </span>
            )}
            {quota && !quota.is_admin && quota.mode === 'free' && (
              <span className="text-success text-[10px] shrink-0 font-mono uppercase">
                {t('quota.badgeFreeMode')}
              </span>
            )}
          </div>
          {isGuest && (
            <button
              type="button"
              onClick={() => {
                setOpenMenu(null);
                onOpenAuth?.();
              }}
              className="text-[11px] text-accent hover:underline mb-1 flex items-center gap-1 cursor-pointer"
            >
              <UserRound className="w-3 h-3" />
              <span>{t('toolbar.guestSaveAccount')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              setOpenMenu(null);
              await logout();
            }}
            className="text-[11px] text-ink-subtle hover:text-danger flex items-center gap-1.5 pt-1 border-t border-line/60 w-full cursor-pointer transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{t('toolbar.signOut')}</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setOpenMenu(null);
            onOpenAuth?.();
          }}
          className="w-full text-start px-3 py-2 flex items-center gap-2.5 text-accent hover:bg-accent-soft transition-colors cursor-pointer font-semibold"
        >
          <LogIn className="w-4 h-4 shrink-0" />
          <span>{t('toolbar.signIn')}</span>
        </button>
      )}
    </>
  );

  const renderFilterMenu = () => {
    const isAllActive = !activeFilter?.items?.length;

    return (
      <div className="p-1.5 space-y-1">
        <div className="px-2.5 py-1 text-[10px] font-bold text-ink-subtle uppercase tracking-wider flex items-center justify-between">
          <span>
            {useThemeMode
              ? (t('toolbar.filterByTheme') !== 'toolbar.filterByTheme' ? t('toolbar.filterByTheme') : t('legend.filterByTheme'))
              : (t('toolbar.filterByLane') !== 'toolbar.filterByLane' ? t('toolbar.filterByLane') : t('legend.filterByLane'))}
          </span>
          <span className="text-[9px] font-mono text-ink-faint">{filterItems.length}</span>
        </div>

        {/* All items toggle button */}
        <button
          type="button"
          onClick={() => {
            onFilterSelect?.(null);
          }}
          className={`w-full px-2.5 py-1.5 text-xs rounded-control flex items-center justify-between transition-colors cursor-pointer text-start ${
            isAllActive
              ? 'bg-accent-soft text-accent font-semibold'
              : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
          }`}
        >
          <span className="flex items-center gap-2 min-w-0">
            <span
              className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border transition-all ${
                isAllActive
                  ? 'bg-accent border-accent text-accent-fg shadow-xs'
                  : 'border-line bg-surface-sunken/60 text-transparent'
              }`}
            >
              <Check className={`w-3 h-3 stroke-[2.5] ${isAllActive ? 'opacity-100' : 'opacity-0'}`} />
            </span>
            <span className="truncate">
              {useThemeMode
                ? (t('toolbar.allThemes') !== 'toolbar.allThemes' ? t('toolbar.allThemes') : t('legend.allThemes'))
                : (t('toolbar.allLanes') !== 'toolbar.allLanes' ? t('toolbar.allLanes') : t('legend.allLanes'))}
            </span>
          </span>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-surface-sunken text-ink-subtle ms-2 shrink-0">
            {timelineData?.articles?.length ?? 0}
          </span>
        </button>

        <div className="my-1 border-t border-line" />

        {/* Individual tracks/themes */}
        <div className="space-y-0.5">
          {filterItems.map((item) => {
            const isActive = Boolean(
              activeFilter?.items?.some((selected) => {
                if (!selected) return false;
                const selId = typeof selected === 'object' ? selected.id : selected;
                return String(selId) === String(item.id);
              })
            );

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onFilterSelect?.(item);
                }}
                className={`w-full px-2.5 py-1.5 text-xs rounded-control flex items-center justify-between transition-colors cursor-pointer text-start ${
                  isActive
                    ? 'bg-accent-soft text-accent font-semibold'
                    : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border transition-all ${
                      isActive
                        ? 'bg-accent border-accent text-accent-fg shadow-xs'
                        : 'border-line bg-surface-sunken/60 text-transparent'
                    }`}
                  >
                    <Check className={`w-3 h-3 stroke-[2.5] ${isActive ? 'opacity-100' : 'opacity-0'}`} />
                  </span>
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="truncate">{item.name}</span>
                </span>
                <span className="flex items-center gap-1.5 shrink-0 ms-2">
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-surface-sunken text-ink-subtle">
                    {item.count ?? 0}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div ref={rootRef}>
      {/* ========================================================================= */}
      {/* 1. DESKTOP FIXED LEFT RAIL (>= 768px)                                      */}
      {/* ========================================================================= */}
      <aside
        ref={desktopRailRef}
        id="chronix-left-dock"
        dir="ltr"
        style={{ zIndex: FLOATING_Z.ALWAYS_ON_TOP }}
        className="fixed left-0 top-0 bottom-0 w-[52px] h-full bg-surface/85 dark:bg-surface-raised/60 backdrop-blur-xl border-r border-line/60 z-30 hidden md:flex flex-col items-center justify-between py-3.5 select-none"
      >
        {/* Top Section */}
        <div className="flex flex-col items-center gap-1.5 w-full px-1.5">
          {/* 1. בית - Quick Return to Home Button */}
          <button
            id={!isMobile ? 'guide-dock-home' : undefined}
            type="button"
            onClick={() => onGoHome?.()}
            className={`${railBtn} ${railIdle}`}
            title={t('toolbar.goHome')}
            aria-label={t('toolbar.goHome')}
          >
            <Home className="w-5 h-5 shrink-0" strokeWidth={1.8} />
          </button>

          {/* 2. סקירה - Narrative overview */}
          {hasOverview && (
            <button
              id={!isMobile ? 'guide-dock-overview' : undefined}
              type="button"
              onClick={() => onToggleOverview?.()}
              className={`${railBtn} ${isOverviewOpen ? railActive : railIdle}`}
              title={t('overview.buttonTooltip')}
              aria-label={t('overview.title')}
              aria-pressed={isOverviewOpen}
            >
              <BookOpen className="w-5 h-5 shrink-0" strokeWidth={1.8} />
            </button>
          )}

          {/* 3. סינון - Filter by Theme/Lane */}
          {canFilter && (
            <div className="relative">
              <button
                id={!isMobile ? 'guide-dock-filter' : undefined}
                type="button"
                onClick={() => toggle('filter')}
                className={`${railBtn} ${openMenu === 'filter' || activeFilter?.items?.length ? railActive : railIdle}`}
                title={t('toolbar.filterOptions')}
                aria-label={t('toolbar.filterOptions')}
                aria-haspopup="true"
                aria-expanded={openMenu === 'filter'}
              >
                <Filter className="w-5 h-5 shrink-0" strokeWidth={1.8} />
                {activeFilter?.items?.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-accent" />
                )}
              </button>

              {openMenu === 'filter' && (
                <div
                  className="absolute left-full top-0 ml-2 w-64 max-h-[calc(100vh-4rem)] overflow-y-auto overscroll-contain shadow-panel rounded-sheet border border-line bg-surface-overlay py-1.5 text-xs animate-in fade-in zoom-in-95 duration-150 z-40"
                  dir={isRtl ? 'rtl' : 'ltr'}
                >
                  {renderFilterMenu()}
                </div>
              )}
            </div>
          )}

          {/* 4. סיור מודרך - Guided exploration active controls or Play button */}
          {hasArticles && isExploring && (
            <div className="flex flex-col items-center gap-1 p-0.5 rounded-xl bg-surface-sunken/80 border border-line/60 my-0.5 animate-in fade-in zoom-in-95 duration-150">
              <button
                type="button"
                onClick={() => onExplorePrev?.()}
                disabled={atStart}
                className={`${railBtn} ${navPrev} !w-8 !h-8`}
                title={`${t('explore.prev')} (←)`}
                aria-label={t('explore.prev')}
              >
                <ChevronUp className="w-4 h-4 shrink-0" strokeWidth={2} />
              </button>
              <button
                id={!isMobile ? 'guide-dock-explore' : undefined}
                type="button"
                onClick={() => onExitExplore?.()}
                className={`${railBtn} text-ink-muted hover:text-danger hover:bg-danger/10 !w-8 !h-8`}
                title={t('explore.exit')}
                aria-label={t('explore.exit')}
              >
                <X className="w-4 h-4 shrink-0" strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => onExploreNext?.()}
                disabled={atEnd}
                className={`${railBtn} ${navNext} !w-8 !h-8`}
                title={`${t('explore.next')} (→)`}
                aria-label={t('explore.next')}
              >
                <ChevronDown className="w-4 h-4 shrink-0" strokeWidth={2} />
              </button>
            </div>
          )}

          {hasArticles && !isExploring && (
            <button
              id={!isMobile ? 'guide-dock-explore' : undefined}
              type="button"
              onClick={() => onStartExplore?.()}
              className={`${railBtn} text-accent hover:text-accent hover:bg-accent/10 dark:hover:bg-accent/15${showTourHint ? ' tour-play-hint' : ''}`}
              title={t('explore.startTooltip')}
              aria-label={t('explore.start')}
            >
              <Play className="w-[19px] h-[19px] fill-current shrink-0 translate-x-px" />
            </button>
          )}

          {/* 5. רשימת כרטיסיות - Event list / Cards drawer */}
          <button
            id={!isMobile ? 'guide-dock-cards' : undefined}
            type="button"
            onClick={() => onToggleCardsList?.()}
            className={`${railBtn} ${isCardsListOpen ? railActive : railIdle}`}
            title={isCardsListOpen ? (t('toolbar.cardsListCloseTitle') || t('common.close')) : (t('toolbar.cardsListTitle') || t('cardsList.title'))}
            aria-label={t('toolbar.cardsList') || t('cardsList.title')}
            aria-pressed={isCardsListOpen}
          >
            <LayoutList className="w-5 h-5 shrink-0" strokeWidth={1.8} />
          </button>

          {/* 6. כוכב - Star / favorites filter */}
          <button
            id={!isMobile ? 'guide-dock-star' : undefined}
            type="button"
            onClick={() => onToggleFilterStarredOnly?.()}
            className={`${railBtn} ${
              filterStarredOnly
                ? 'bg-amber-500/15 text-amber-500 dark:text-amber-400'
                : railIdle
            }`}
            title={filterStarredOnly ? t('toolbar.filterStarredActive') : t('toolbar.filterStarred')}
            aria-label={filterStarredOnly ? t('toolbar.filterStarredActive') : t('toolbar.filterStarred')}
            aria-pressed={filterStarredOnly}
          >
            <Star className={`w-5 h-5 shrink-0 ${filterStarredOnly ? 'fill-current' : ''}`} strokeWidth={1.8} />
            {starredCount > 0 && (
              <span className="absolute top-0.5 right-0.5 min-w-[14px] h-[14px] px-0.5 text-[9px] font-bold rounded-full bg-amber-500 text-white flex items-center justify-center leading-none">
                {starredCount}
              </span>
            )}
          </button>

          <div className="w-5 border-t border-line/60 my-1" />

          {/* 7. פעולות נוספות והגדרות - Main Menu & Actions popover button */}
          <div className="relative" ref={desktopActionsRef}>
            <button
              id={!isMobile ? 'guide-more-actions' : undefined}
              data-guide="more-actions"
              type="button"
              onClick={() => toggle('actions')}
              className={`${railBtn} ${openMenu === 'actions' ? railActive : railIdle}`}
              title={t('toolbar.moreActions')}
              aria-label={t('toolbar.moreActions')}
              aria-haspopup="true"
              aria-expanded={openMenu === 'actions'}
            >
              <Menu className="w-5 h-5 shrink-0" strokeWidth={1.8} />
            </button>

            {openMenu === 'actions' && (
              <div
                className={`${desktopPopoverBase}`}
                style={actionsMaxHeight ? { maxHeight: `${actionsMaxHeight}px` } : undefined}
                dir={isRtl ? 'rtl' : 'ltr'}
              >
                {renderActionsMenu(false)}
              </div>
            )}
          </div>
        </div>

        {/* Bottom Section */}
        <div className="flex flex-col items-center gap-2 w-full px-1.5">
          {/* Quick theme toggle */}
          <button
            type="button"
            onClick={onToggleTheme}
            className={`${railBtn} ${railIdle}`}
            title={theme === 'dark' ? t('toolbar.switchThemeLight') : t('toolbar.switchThemeDark')}
            aria-label={theme === 'dark' ? t('toolbar.switchThemeLight') : t('toolbar.switchThemeDark')}
          >
            {theme === 'dark' ? (
              <Sun className="w-5 h-5 text-amber-400 hover:rotate-45 transition-transform" strokeWidth={1.8} />
            ) : (
              <Moon className="w-5 h-5 text-ink-muted hover:-rotate-12 transition-transform" strokeWidth={1.8} />
            )}
          </button>
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* 2. MOBILE FLOATING VERTICAL SIDE DOCK (< 768px)                           */}
      {/* ========================================================================= */}
      <nav
        ref={mobileDockRef}
        id="chronix-mobile-dock"
        dir="ltr"
        style={{
          zIndex: FLOATING_Z.ALWAYS_ON_TOP,
          top: mobilePosY != null ? `${mobilePosY}px` : '18%',
        }}
        className="fixed left-2 z-30 flex md:hidden flex-col items-center select-none"
      >
        {/* COLLAPSED STATE: Sleek floating glass circle */}
        {mobileCollapsed ? (
          <button
            type="button"
            onClick={toggleMobileCollapsed}
            className="w-10 h-10 rounded-full bg-surface-overlay/95 dark:bg-surface-raised/90 backdrop-blur-xl border border-line/70 shadow-pop flex items-center justify-center text-ink-muted hover:text-ink cursor-pointer active:scale-95 transition-all"
            title={t('leftDock.expand') || 'Expand menu'}
            aria-label={t('leftDock.expand') || 'Expand menu'}
          >
            {isExploring ? (
              <Play className="w-4 h-4 fill-current text-accent" />
            ) : (
              <ChevronsUpDown className="w-4 h-4 text-ink-subtle" strokeWidth={2} />
            )}
          </button>
        ) : (
          /* EXPANDED STATE: Slim vertical floating glass pill */
          <div className="relative flex flex-col items-center gap-1 p-1 rounded-2xl bg-surface-overlay/95 dark:bg-surface-raised/90 backdrop-blur-xl border border-line/70 shadow-pop animate-in fade-in zoom-in-95 duration-150">
            {/* Minimalist Drag Capsule Handle */}
            <div
              onPointerDown={handleMobileDragPointerDown}
              style={{ touchAction: 'none' }}
              className="w-full flex flex-col items-center pt-1.5 pb-1 cursor-grab active:cursor-grabbing group select-none"
              title={t('legend.drag') || 'Drag to move'}
              aria-label={t('legend.drag') || 'Drag to move'}
            >
              <div className="w-5 h-1 rounded-full bg-ink/20 group-hover:bg-ink/40 transition-colors" />
            </div>

            {/* Collapse Toggle */}
            <button
              type="button"
              onClick={toggleMobileCollapsed}
              className={`${railBtn} !w-8 !h-7 text-ink-subtle hover:text-ink`}
              title={t('leftDock.collapse') || 'Collapse menu'}
              aria-label={t('leftDock.collapse') || 'Collapse menu'}
            >
              <ChevronsDownUp className="w-3.5 h-3.5" strokeWidth={2} />
            </button>

            <div className="w-5 border-t border-line/60 my-0.5" />

            {/* 1. בית - Home */}
            <button
              id={isMobile ? 'guide-dock-home' : undefined}
              type="button"
              onClick={() => onGoHome?.()}
              className={`${railBtn} ${railIdle}`}
              title={t('toolbar.goHome')}
              aria-label={t('toolbar.goHome')}
            >
              <Home className="w-5 h-5 shrink-0" strokeWidth={1.8} />
            </button>

            {/* 2. סקירה - Overview (if present) */}
            {hasOverview && (
              <button
                id={isMobile ? 'guide-dock-overview' : undefined}
                type="button"
                onClick={() => onToggleOverview?.()}
                className={`${railBtn} ${
                  isOverviewOpen
                    ? railActive
                    : railIdle
                }`}
                title={t('overview.title')}
                aria-label={t('overview.title')}
              >
                <BookOpen className="w-5 h-5 shrink-0" strokeWidth={1.8} />
              </button>
            )}

            {/* 3. סינון - Filter */}
            {canFilter && (
              <div className="relative">
                <button
                  id={isMobile ? 'guide-dock-filter' : undefined}
                  type="button"
                  onClick={() => toggle('filter')}
                  className={`${railBtn} ${
                    openMenu === 'filter' || activeFilter?.items?.length
                      ? railActive
                      : railIdle
                  }`}
                  title={t('toolbar.filterOptions')}
                  aria-label={t('toolbar.filterOptions')}
                >
                  <Filter className="w-5 h-5 shrink-0" strokeWidth={1.8} />
                  {activeFilter?.items?.length > 0 && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent" />
                  )}
                </button>

                {openMenu === 'filter' && (
                  <div
                    className={mobileSidePopoverBase}
                    dir={isRtl ? 'rtl' : 'ltr'}
                  >
                    {renderFilterMenu()}
                  </div>
                )}
              </div>
            )}

            {/* 4. סיור מודרך - Tour Play / Active Exploration Navigation Cluster */}
            {hasArticles && isExploring && (
              <div className="flex flex-col items-center gap-1 p-0.5 rounded-xl bg-surface-sunken/80 border border-line/60 my-0.5 animate-in fade-in zoom-in-95 duration-150">
                <button
                  type="button"
                  onClick={() => onExplorePrev?.()}
                  disabled={atStart}
                  className={`${railBtn} ${navPrev} !w-8 !h-8`}
                  title={`${t('explore.prev')} (\u2190)`}
                  aria-label={t('explore.prev')}
                >
                  <ChevronUp className="w-4 h-4 shrink-0" strokeWidth={2} />
                </button>
                <button
                  id={isMobile ? 'guide-dock-explore' : undefined}
                  type="button"
                  onClick={() => onExitExplore?.()}
                  className={`${railBtn} text-ink-muted hover:text-danger hover:bg-danger/10 !w-8 !h-8`}
                  title={t('explore.exit')}
                  aria-label={t('explore.exit')}
                >
                  <X className="w-4 h-4 shrink-0" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={() => onExploreNext?.()}
                  disabled={atEnd}
                  className={`${railBtn} ${navNext} !w-8 !h-8`}
                  title={`${t('explore.next')} (\u2192)`}
                  aria-label={t('explore.next')}
                >
                  <ChevronDown className="w-4 h-4 shrink-0" strokeWidth={2} />
                </button>
              </div>
            )}

            {/* Tour Play (when not exploring) */}
            {hasArticles && !isExploring && (
              <button
                id={isMobile ? 'guide-dock-explore' : undefined}
                type="button"
                onClick={() => onStartExplore?.()}
                className={`${railBtn} text-accent hover:bg-accent/10 dark:hover:bg-accent/15${showTourHint ? ' tour-play-hint' : ''}`}
                title={t('explore.startTooltip')}
                aria-label={t('explore.start')}
              >
                <Play className="w-[18px] h-[18px] fill-current shrink-0 translate-x-px" />
              </button>
            )}

            {/* 5. רשימת כרטיסיות - Cards list */}
            <button
              id={isMobile ? 'guide-dock-cards' : undefined}
              type="button"
              onClick={() => onToggleCardsList?.()}
              className={`${railBtn} ${
                isCardsListOpen
                  ? railActive
                  : railIdle
              }`}
              title={t('toolbar.cardsList')}
              aria-label={t('toolbar.cardsList')}
            >
              <LayoutList className="w-5 h-5 shrink-0" strokeWidth={1.8} />
            </button>

            {/* 6. כוכב - Starred */}
            <button
              id={isMobile ? 'guide-dock-star' : undefined}
              type="button"
              onClick={() => onToggleFilterStarredOnly?.()}
              className={`${railBtn} ${
                filterStarredOnly
                  ? 'bg-amber-500/15 text-amber-500'
                  : railIdle
              }`}
              title={filterStarredOnly ? t('toolbar.filterStarredActive') : t('toolbar.filterStarred')}
              aria-label={filterStarredOnly ? t('toolbar.filterStarredActive') : t('toolbar.filterStarred')}
            >
              <Star className={`w-5 h-5 shrink-0 ${filterStarredOnly ? 'fill-current' : ''}`} strokeWidth={1.8} />
              {starredCount > 0 && (
                <span className="absolute top-0.5 right-0.5 min-w-[14px] h-[14px] px-0.5 text-[8px] font-bold rounded-full bg-amber-500 text-white flex items-center justify-center leading-none">
                  {starredCount}
                </span>
              )}
            </button>

            <div className="w-5 border-t border-line/60 my-0.5" />

            {/* 7. פעולות נוספות והגדרות - Menu & Actions popover button */}
            <div className="relative" ref={mobileActionsRef}>
              <button
                id={isMobile ? 'guide-more-actions' : undefined}
                data-guide="more-actions"
                type="button"
                onClick={() => toggle('actions')}
                className={`${railBtn} ${
                  openMenu === 'actions'
                    ? railActive
                    : railIdle
                }`}
                title={t('toolbar.moreActions')}
                aria-label={t('toolbar.moreActions')}
              >
                <Menu className="w-5 h-5 shrink-0" strokeWidth={1.8} />
              </button>

              {openMenu === 'actions' && (
                <div
                  className={mobileSidePopoverBase}
                  style={actionsMaxHeight ? { maxHeight: `${actionsMaxHeight}px` } : undefined}
                  dir={isRtl ? 'rtl' : 'ltr'}
                >
                  {renderActionsMenu(true)}
                </div>
              )}
            </div>
          </div>
        )}
      </nav>
    </div>
  );
}

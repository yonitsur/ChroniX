import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import {
  Filter,
  Pencil,
  LayoutList,
  LayoutGrid,
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
  Layers,
  BookOpen,
  Menu,
  Home,
  FolderOpen,
  Download,
  ShieldCheck,
  Sun,
  Moon,
  Languages,
  Map,
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
  PanelLeftOpen,
  PanelLeftClose,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import MobileActionSheet from './MobileActionSheet';
import { FLOATING_Z } from '../utils/floatingFocus';
import { getDistinctCategories, getCategoryColor } from '../data/laneColors';
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
 * - Mobile (< 768px): Sleek floating horizontal dock pill anchored within thumb-reach.
 *   Zero horizontal obstruction of the timeline canvas.
 */
function WhatsAppIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2zm.01 1.67c2.2 0 4.26.86 5.82 2.42a8.225 8.225 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23-1.48 0-2.93-.39-4.19-1.14l-.3-.18-3.12.82.83-3.04-.2-.32a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24zm-3.52 3.66c-.16 0-.43.06-.66.31-.22.25-.85.84-.85 2.04 0 1.21.88 2.38 1 2.54.12.16 1.72 2.63 4.17 3.69.58.25 1.04.4 1.39.51.59.19 1.12.16 1.55.1.47-.07 1.45-.59 1.65-1.17.2-.58.2-1.07.14-1.18-.06-.1-.22-.16-.47-.29-.24-.12-1.43-.71-1.65-.79-.22-.08-.39-.12-.55.13-.16.25-.63.79-.77.95-.14.17-.28.19-.53.07-.24-.13-1.02-.38-1.95-1.2-.72-.65-1.21-1.45-1.35-1.69-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.53-1.27-.73-1.75-.19-.46-.39-.4-.54-.41-.14-.01-.31-.01-.56-.01z" />
    </svg>
  );
}

function TelegramIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18.24.24 0 0 0-.21-.02c-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" />
    </svg>
  );
}

export default function LeftDockMenu({
  timelineData,
  activeFilter = null,
  onFilterSelect,
  onRenameFilterItem,
  isCardsListOpen = false,
  onToggleCardsList,
  isExploring = false,
  onStartExplore,
  onExploreNext,
  onExplorePrev,
  onExitExplore,
  exploreProgress = null,
  isTourDetailsMinimized = false,
  onToggleTourDetails,
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
  onOpenPublicRoute,
  isReadOnlyView = false,
  canShare = false,
  onGetShareLink,
  densityMode = 'auto',
  onToggleDensityMode,
  mapTileProvider = 'esri',
  onMapTileProviderChange,
}) {
  const { language, setLanguage, supportedLanguages, activeLanguageInfo, t, isRtl } = useLanguage();
  const { user, logout, isGuest } = useAuth();

  // Active popover: 'actions' | 'filter' | null
  const [openMenu, setOpenMenu] = useState(null);
  const [isSheetClosing, setIsSheetClosing] = useState(false);
  const [renderedMenu, setRenderedMenu] = useState(null);

  useEffect(() => {
    if (openMenu) {
      setRenderedMenu(openMenu);
      setIsSheetClosing(false);
    } else if (renderedMenu) {
      setIsSheetClosing(true);
      const timer = setTimeout(() => {
        setRenderedMenu(null);
        setIsSheetClosing(false);
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [openMenu, renderedMenu]);

  const closeMobileMenu = useCallback(() => {
    setIsSheetClosing(true);
    setTimeout(() => {
      setOpenMenu(null);
      setIsExportSubmenuOpen(false);
      setIsLangSubmenuOpen(false);
      setIsShareSubmenuOpen(false);
      setRenderedMenu(null);
      setIsSheetClosing(false);
    }, 250);
  }, []);

  const touchSheetStartYRef = useRef(0);
  const handleSheetTouchStart = (e) => {
    if (e.touches && e.touches[0]) {
      touchSheetStartYRef.current = e.touches[0].clientY;
    }
  };
  const handleSheetTouchEnd = (e) => {
    if (e.changedTouches && e.changedTouches[0]) {
      const deltaY = e.changedTouches[0].clientY - touchSheetStartYRef.current;
      if (deltaY > 50) {
        closeMobileMenu();
      }
    }
    touchSheetStartYRef.current = 0;
  };

  const [isLangSubmenuOpen, setIsLangSubmenuOpen] = useState(false);
  const [isExportSubmenuOpen, setIsExportSubmenuOpen] = useState(false);
  const [copiedType, setCopiedType] = useState(null); // 'text' | null
  const [isShareSubmenuOpen, setIsShareSubmenuOpen] = useState(false);
  const [shareLink, setShareLink] = useState(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState(null);
  const [isLinkCopied, setIsLinkCopied] = useState(false);

  // Inline rename state for filter topics (categories) & tracks (lanes)
  const [editingTarget, setEditingTarget] = useState(null); // { dimension, id, name, item } | null
  const [editingValue, setEditingValue] = useState('');
  const editInputRef = useRef(null);

  const canEdit = !isReadOnlyView && timelineData?.isOwner !== false;

  const startEditing = (dimension, item) => {
    setEditingTarget({ dimension, id: item.id, name: item.name, item });
    setEditingValue(item.name);
  };

  const cancelEditing = () => {
    setEditingTarget(null);
    setEditingValue('');
  };

  const handleSaveEdit = (e) => {
    if (e) e.preventDefault();
    if (!editingTarget) return;
    const trimmed = editingValue.trim();
    if (!trimmed || trimmed === editingTarget.name) {
      cancelEditing();
      return;
    }
    onRenameFilterItem?.(editingTarget.dimension, editingTarget.item, trimmed);
    cancelEditing();
  };

  useEffect(() => {
    if (editingTarget && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTarget]);

  // Reset editing mode whenever filter popover closes or timeline changes
  useEffect(() => {
    if (openMenu !== 'filter') {
      cancelEditing();
    }
  }, [openMenu]);

  useEffect(() => {
    cancelEditing();
  }, [timelineData?.id]);

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
      } catch (e) { }
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
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { }

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
          } catch (err) { }
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
  const desktopFilterRef = useRef(null);
  const mobileActionsRef = useRef(null);

  // Viewport-aware clamped positioning for desktop rail popovers (More Actions, Filter)
  // Ensures they NEVER overflow below or above the viewport, especially in mobile landscape
  const [popoverPosStyle, setPopoverPosStyle] = useState({});

  useLayoutEffect(() => {
    if (isMobile || !openMenu) {
      setPopoverPosStyle({});
      return;
    }
    const updatePosition = () => {
      const isActions = openMenu === 'actions';
      const targetRef = isActions ? desktopActionsRef.current : desktopFilterRef.current;
      if (!targetRef) return;
      const rect = targetRef.getBoundingClientRect();
      const vh = window.innerHeight;
      const maxH = Math.min(520, vh - 24);

      // Clamp vertically so the popover is guaranteed to be at least 12px from the top
      // and at least 12px from the bottom of the screen.
      const top = Math.max(12, Math.min(rect.top, vh - maxH - 12));

      setPopoverPosStyle({
        position: 'fixed',
        left: `${rect.right + 10}px`,
        top: `${top}px`,
        maxHeight: `${maxH}px`,
        zIndex: 70,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [openMenu, isMobile]);

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
      if (!isMobile && desktopRailRef.current) {
        const r = desktopRailRef.current.getBoundingClientRect();
        onRectChange({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
      } else {
        // On mobile, the dock is at the bottom, so there is no side rail displacement
        onRectChange(null);
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [isMobile, onRectChange]);

  // Reset the cached share link whenever the active timeline changes.
  useEffect(() => {
    setShareLink(null);
    setShareError(null);
    setIsShareSubmenuOpen(false);
  }, [timelineData?.id]);

  // Filterable items for the two independent filter dimensions: topic (`category`, always
  // drives event color) and timeline track (`lane`, always drives placement). Both are
  // computed unconditionally so the menu can offer simultaneous filtering by either or both.
  const lanesArr = useMemo(() => timelineData?.lanes || [], [timelineData]);
  const legendCategories = useMemo(
    () => getDistinctCategories(timelineData?.articles || []),
    [timelineData]
  );

  // Match-key lists, independent of any active selection - used to render each dimension's
  // items and, cross-wise, to narrow the OTHER dimension's counts.
  const laneMatchList = useMemo(() => {
    if (lanesArr.length < 2) return [];
    return lanesArr.map((lane, idx) => {
      const matchKeys = [];
      if (lane.id !== undefined && lane.id !== null) matchKeys.push(lane.id);
      if (lane.title) matchKeys.push(lane.title);
      return {
        id: String(lane.id ?? lane.title ?? idx),
        name: lane.title || lane.name || `Lane ${idx + 1}`,
        color: null,
        matchKeys,
      };
    });
  }, [lanesArr]);

  const categoryMatchList = useMemo(() => {
    if (legendCategories.length < 1) return [];
    return legendCategories.map((name) => ({
      id: name,
      name,
      color: getCategoryColor(name, legendCategories),
      matchKeys: [name],
    }));
  }, [legendCategories]);

  // Category counts reflect the CURRENTLY selected lane(s) (if any), so switching to a
  // specific timeline/track updates the topic counts to match what's actually visible.
  const categoryFilterItems = useMemo(() => {
    const allArticles = timelineData?.articles || [];
    if (categoryMatchList.length === 0) return [];
    const selectedLaneIds = (activeFilter?.laneItems || []).map((item) => String(item.id ?? item));
    const selectedLaneItems = laneMatchList.filter((item) => selectedLaneIds.includes(item.id));
    const articles = selectedLaneItems.length
      ? allArticles.filter((a) => selectedLaneItems.some((item) => item.matchKeys.includes(a?.lane)))
      : allArticles;
    return categoryMatchList.map((item) => {
      const key = item.name.toLowerCase();
      const count = articles.filter(
        (a) => (a?.category ?? '').toString().trim().toLowerCase() === key
      ).length;
      return { ...item, count };
    });
  }, [categoryMatchList, laneMatchList, activeFilter?.laneItems, timelineData]);

  // Lane counts likewise reflect the CURRENTLY selected topic(s) (if any).
  const laneFilterItems = useMemo(() => {
    const allArticles = timelineData?.articles || [];
    if (laneMatchList.length === 0) return [];
    const selectedCategoryIds = (activeFilter?.categoryItems || []).map((item) => String(item.id ?? item));
    const selectedCategoryItems = categoryMatchList.filter((item) => selectedCategoryIds.includes(item.id));
    const articles = selectedCategoryItems.length
      ? allArticles.filter((a) => selectedCategoryItems.some((item) => item.matchKeys.includes(a?.category ?? '')))
      : allArticles;
    return laneMatchList.map((item) => {
      const normalizedKeys = item.matchKeys.map((k) => String(k).toLowerCase().trim());
      const count = articles.filter((a) =>
        normalizedKeys.includes(String(a?.lane ?? '').toLowerCase().trim())
      ).length;
      return { ...item, count };
    });
  }, [laneMatchList, categoryMatchList, activeFilter?.categoryItems, timelineData]);
  const canFilter = categoryFilterItems.length >= 1 || laneFilterItems.length >= 2;
  const activeFilterCount = (activeFilter?.laneItems?.length || 0) + (activeFilter?.categoryItems?.length || 0);


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

  // Shared button styles: frameless rail buttons with neutral hover/selected fills
  const railBtn =
    'relative w-9 h-9 shrink-0 flex items-center justify-center rounded-lg transition-colors duration-150 cursor-pointer select-none active:scale-95 group dock-btn-luminescent dock-rail-btn';
  const railIdle =
    'text-ink-muted hover:text-ink hover:bg-surface-hover';
  const railActive =
    'text-ink bg-surface-active';

  const navPrev =
    'text-ink-muted hover:text-ink hover:bg-surface-hover rounded-lg disabled:opacity-30 disabled:cursor-default';
  const navNext =
    'bg-accent text-accent-fg shadow-control hover:bg-accent-hover rounded-lg disabled:opacity-30 disabled:cursor-default';

  // Popover base style for desktop (opens downwards and to the right as floating solid island)
  const desktopPopoverBase =
    'absolute left-full top-0 ml-3 w-68 max-h-[min(520px,calc(100vh-3.5rem))] menu-scroller bg-surface-overlay rounded-xl border border-line shadow-pop p-1.5 text-xs origin-top-left animate-in fade-in zoom-in-95 duration-150 z-50';

  // Popover base style for mobile side dock (opens downwards and to the right as floating solid island)
  const mobileSidePopoverBase =
    'absolute left-full top-0 ml-3 w-64 max-w-[calc(100vw-4.5rem)] max-h-[70vh] menu-scroller bg-surface-overlay rounded-xl border border-line shadow-pop p-1.5 text-xs origin-top-left z-50 animate-in fade-in zoom-in-95 duration-150';

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

  const handleCopyShareLink = async () => {
    try {
      const url = await resolveShareLink();
      if (url) {
        await copyToClipboard(url);
        setIsLinkCopied(true);
        setTimeout(() => setIsLinkCopied(false), 2000);
      }
    } catch (e) {
      // ignore
    }
  };

  const handleNativeShare = async (urlToShare = null) => {
    try {
      const url = urlToShare || (await resolveShareLink());
      if (!url) return false;
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        const shareTitle = timelineData?.title?.trim() || 'ChroniX Timeline';
        const shareData = {
          title: shareTitle,
          url: url,
        };
        if (!navigator.canShare || navigator.canShare(shareData)) {
          await navigator.share(shareData);
          setOpenMenu(null);
          setIsShareSubmenuOpen(false);
          return true;
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        return true; // Cancelled by user, intentional
      }
      console.warn('Native share failed:', err);
    }
    return false;
  };

  const handleShareTimeline = async (forceSubmenu = false) => {
    setIsExportSubmenuOpen(false);
    setIsLangSubmenuOpen(false);
    setShareError(null);

    const hasNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    if (hasNativeShare && !forceSubmenu) {
      const shared = await handleNativeShare();
      if (shared) return;
    }

    setIsShareSubmenuOpen((prev) => !prev);
    await resolveShareLink();
  };

  const renderActionsMenu = (isMobileVariant = false) => (
    <div className="p-1 flex flex-col gap-0.5">
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
        className="w-full text-start px-2.5 py-1.5 rounded-xl flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover/80 transition-colors cursor-pointer font-medium"
      >
        <FolderOpen className="w-4 h-4 text-ink-subtle shrink-0" />
        <span>{t('toolbar.savedTimelines')}</span>
      </button>

      {/* Share Timeline: native share sheet, or direct app fallbacks when unavailable */}
      {canShare && (
        <div>
          <div className="w-full rounded-xl flex items-center justify-between text-ink-muted hover:text-ink hover:bg-surface-hover/80 transition-colors font-medium">
            <button
              type="button"
              onClick={() => handleShareTimeline(false)}
              disabled={shareLoading}
              className="flex-1 text-start px-2.5 py-1.5 flex items-center gap-2.5 cursor-pointer disabled:opacity-50 min-w-0"
            >
              {shareLoading ? (
                <Loader2 className="w-4 h-4 text-accent shrink-0 animate-spin" />
              ) : (
                <Share2 className="w-4 h-4 text-accent shrink-0" />
              )}
              <span className="truncate">{t('toolbar.shareTimeline')}</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleShareTimeline(true);
              }}
              title={t('toolbar.shareVia') || 'Share options'}
              aria-label={t('toolbar.shareVia') || 'Share options'}
              className="px-2 py-1.5 cursor-pointer text-ink-subtle hover:text-ink transition-colors shrink-0"
            >
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-200 ${isShareSubmenuOpen ? 'rotate-180 text-accent' : ''
                  }`}
              />
            </button>
          </div>

          {isShareSubmenuOpen && (
            <div className="mx-1 mb-1 p-2 bg-surface-hover/60 rounded-xl border border-line flex flex-col gap-1.5 animate-in fade-in zoom-in-95 duration-100">
              {shareError && (
                <p className="px-2 py-1 text-caption text-danger">{shareError}</p>
              )}

              {shareLoading && (
                <div className="flex items-center gap-2 px-2 py-1 text-xs text-ink-subtle">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                  <span>{t('toolbar.shareVia')}</span>
                </div>
              )}

              {shareLink && (
                <div className="flex flex-col gap-0.5">
                  {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
                    <button
                      type="button"
                      onClick={() => handleNativeShare(shareLink)}
                      className="w-full px-2 py-1.5 text-xs rounded-lg flex items-center gap-2 text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start font-medium"
                    >
                      <Share2 className="w-3.5 h-3.5 text-accent shrink-0" />
                      <span className="truncate">{t('toolbar.shareDevice')}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleCopyShareLink}
                    className={`w-full px-2 py-1.5 text-xs rounded-lg flex items-center justify-between transition-colors cursor-pointer text-start ${isLinkCopied
                        ? 'bg-success/15 text-success font-semibold'
                        : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
                      }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      {isLinkCopied ? (
                        <Check className="w-3.5 h-3.5 text-success shrink-0" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                      )}
                      <span className="truncate">
                        {isLinkCopied
                          ? (t('toolbar.shareLinkCopied') || t('exportModal.copiedNotification') || 'Copied!')
                          : (t('toolbar.shareCopyLink') || t('common.copyLink') || 'Copy Share Link')}
                      </span>
                    </span>
                    <span className="text-[10px] text-ink-subtle font-mono shrink-0">
                      {isLinkCopied ? '✓' : '/t/...'}
                    </span>
                  </button>

                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(shareLink)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full px-2 py-1.5 text-xs rounded-lg flex items-center gap-2 text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
                  >
                    <WhatsAppIcon className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                    <span className="truncate">WhatsApp</span>
                  </a>
                  <a
                    href={`https://t.me/share/url?url=${encodeURIComponent(shareLink)}&text=${encodeURIComponent(
                      timelineData?.title?.trim() ? `${timelineData.title.trim()} | ChroniX` : 'ChroniX'
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full px-2 py-1.5 text-xs rounded-lg flex items-center gap-2 text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
                  >
                    <TelegramIcon className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                    <span className="truncate">Telegram</span>
                  </a>
                  <a
                    href={`mailto:?subject=${encodeURIComponent(timelineData?.title || 'ChroniX Timeline')}&body=${encodeURIComponent(
                      `${timelineData?.title?.trim() ? `${timelineData.title.trim()} | ChroniX\n\n` : ''}${shareLink}`
                    )}`}
                    className="w-full px-2 py-1.5 text-xs rounded-lg flex items-center gap-2 text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
                  >
                    <Mail className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                    <span className="truncate">{t('toolbar.shareEmail')}</span>
                  </a>
                </div>
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
          className="w-full text-start px-2.5 py-1.5 rounded-xl flex items-center justify-between text-ink-muted hover:text-ink hover:bg-surface-hover/80 transition-colors cursor-pointer font-medium"
          aria-expanded={isExportSubmenuOpen}
        >
          <span className="flex items-center gap-2.5">
            <Download className="w-4 h-4 text-ink-subtle shrink-0" />
            <span>{t('toolbar.exportModal')}</span>
          </span>
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform duration-150 ${isExportSubmenuOpen ? 'rotate-180 text-accent' : 'text-ink-subtle'
              }`}
          />
        </button>

        {isExportSubmenuOpen && (
          <div className="mx-1 mb-1 p-1 bg-surface-hover/60 rounded-xl border border-line flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100">
            {/* Quick Copy to Clipboard */}
            <button
              type="button"
              onClick={handleCopyText}
              className={`w-full px-2 py-1.5 text-xs rounded-lg flex items-center justify-between transition-colors cursor-pointer text-start ${copiedType === 'text'
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
              <span className="text-caption font-mono px-1.5 py-0.5 rounded bg-surface-overlay text-ink-subtle font-medium shrink-0 ms-1">
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
              className="w-full px-2 py-1.5 text-xs rounded-lg flex items-center justify-between text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-2 truncate">
                <ImageIcon className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                <span className="truncate">{t('exportModal.pngTitle')}</span>
              </div>
              <span className="text-caption font-mono px-1.5 py-0.5 rounded bg-surface-overlay text-ink-subtle font-semibold shrink-0 ms-1">
                .PNG
              </span>
            </button>

            {/* Print / PDF */}
            <button
              type="button"
              onClick={handlePrintPdf}
              className="w-full px-2 py-1.5 text-xs rounded-lg flex items-center justify-between text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-2 truncate">
                <Printer className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                <span className="truncate">{t('exportModal.printTitle')}</span>
              </div>
              <span className="text-caption font-mono px-1.5 py-0.5 rounded bg-surface-overlay text-ink-subtle font-semibold shrink-0 ms-1">
                .PDF
              </span>
            </button>

            {/* Markdown */}
            <button
              type="button"
              onClick={handleExportMarkdown}
              className="w-full px-2 py-1.5 text-xs rounded-lg flex items-center justify-between text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-2 truncate">
                <FileCode className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                <span className="truncate">{t('exportModal.mdTitle')}</span>
              </div>
              <span className="text-caption font-mono px-1.5 py-0.5 rounded bg-surface-overlay text-ink-subtle font-semibold shrink-0 ms-1">
                .MD
              </span>
            </button>

            {/* Plain Text */}
            <button
              type="button"
              onClick={handleExportText}
              className="w-full px-2 py-1.5 text-xs rounded-lg flex items-center justify-between text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-2 truncate">
                <FileText className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                <span className="truncate">{t('exportModal.txtTitle')}</span>
              </div>
              <span className="text-caption font-mono px-1.5 py-0.5 rounded bg-surface-overlay text-ink-subtle font-semibold shrink-0 ms-1">
                .TXT
              </span>
            </button>

            {/* Excel / CSV */}
            <button
              type="button"
              onClick={handleExportCsv}
              className="w-full px-2 py-1.5 text-xs rounded-lg flex items-center justify-between text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-2 truncate">
                <Table className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                <span className="truncate">{t('exportModal.csvTitle')}</span>
              </div>
              <span className="text-caption font-mono px-1.5 py-0.5 rounded bg-surface-overlay text-ink-subtle font-semibold shrink-0 ms-1">
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
              className="w-full px-2 py-1.5 text-xs rounded-lg flex items-center justify-between text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-2 truncate">
                <Code2 className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                <span className="truncate">{t('exportModal.jsonTitle')}</span>
              </div>
              <span className="text-caption font-mono px-1.5 py-0.5 rounded bg-surface-overlay text-ink-subtle font-semibold shrink-0 ms-1">
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
          className="w-full text-start px-2.5 py-1.5 rounded-xl flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover/80 transition-colors cursor-pointer font-medium"
        >
          <ShieldCheck className="w-4 h-4 text-success shrink-0" />
          <span>Admin Panel</span>
        </button>
      )}

      <div className="my-0.5 border-t border-line/60" />

      {/* Card layout selector */}
      <div className="px-2.5 pt-2 pb-1.5 space-y-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <LayoutGrid className="w-4 h-4 text-ink-subtle shrink-0" />
          <span className="text-xs font-medium text-ink truncate">{t('density.label') || 'Card Layout'}</span>
        </div>
        <div className="seg-track grid grid-cols-2 p-0.5 rounded-lg gap-0.5" role="radiogroup" aria-label={t('density.label') || 'Card Layout'}>
          {[
            ['auto', t('density.automatic') || 'Automatic', t('density.automaticDesc') || 'Adapts cards to available space'],
            ['large', t('density.large') || 'Large', t('density.largeDesc') || 'Full card with image below'],
            ['small', t('density.small') || 'Small', t('density.smallDesc') || 'Short card with image beside'],
            ['compact', t('density.compact') || 'Compact', t('density.compactDesc') || 'Titles only, clean view'],
          ].map(([mode, label, description]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={densityMode === mode}
              onClick={() => onToggleDensityMode?.(mode)}
              className={`seg-item min-h-[30px] px-2 py-1.5 rounded-md text-[11px] font-medium cursor-pointer truncate ${densityMode === mode ? 'seg-item-active' : ''
                }`}
              title={description}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Map Basemap Provider selector */}
      <div className="px-2.5 pt-1.5 pb-2 space-y-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <Map className="w-4 h-4 text-ink-subtle shrink-0" />
          <span className="text-xs font-medium text-ink truncate">{t('toolbar.mapProviderSection') || 'Basemap Style'}</span>
        </div>
        <div className="seg-track grid grid-cols-2 p-0.5 rounded-lg gap-0.5" role="radiogroup" aria-label={t('toolbar.mapProviderSection') || 'Basemap Style'}>
          {[
            ['esri', 'Esri', t('settings.mapProviderEsriDesc') || 'Esri World Canvas (English)'],
            ['osm', 'OSM', t('settings.mapProviderOsmDesc') || 'OpenStreetMap (local languages)'],
          ].map(([provider, label, description]) => (
            <button
              key={provider}
              type="button"
              role="radio"
              aria-checked={mapTileProvider === provider}
              onClick={() => onMapTileProviderChange?.(provider)}
              className={`seg-item min-h-[30px] px-2 py-1.5 rounded-md text-[11px] font-medium cursor-pointer text-center truncate ${mapTileProvider === provider ? 'seg-item-active' : ''
                }`}
              title={description}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Theme toggle */}
      <button
        type="button"
        onClick={() => onToggleTheme?.()}
        className="w-full text-start px-2.5 py-1.5 rounded-xl flex items-center justify-between text-ink-muted hover:text-ink hover:bg-surface-hover/80 transition-colors cursor-pointer font-medium"
      >
        <span className="flex items-center gap-2.5">
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400 shrink-0" />
          ) : (
            <Moon className="w-4 h-4 text-ink-subtle shrink-0" />
          )}
          <span>
            {theme === 'dark' ? t('toolbar.switchThemeLight') : t('toolbar.switchThemeDark')}
          </span>
        </span>
        <span className="text-caption text-ink-subtle uppercase font-mono">
          {theme === 'dark' ? 'Dark' : 'Light'}
        </span>
      </button>

      {/* Language Selector (Submenu Dropdown) */}
      <div className="border-t border-line/60 pt-0.5">
        <button
          type="button"
          onClick={() => {
            setIsLangSubmenuOpen((prev) => !prev);
            setIsExportSubmenuOpen(false);
            setIsShareSubmenuOpen(false);
          }}
          className="w-full text-start px-2.5 py-1.5 rounded-xl flex items-center justify-between text-ink-muted hover:text-ink hover:bg-surface-hover/80 transition-colors cursor-pointer font-medium"
          aria-expanded={isLangSubmenuOpen}
        >
          <span className="flex items-center gap-2.5">
            <Languages className="w-4 h-4 text-accent shrink-0" />
            <span>{t('toolbar.language')}</span>
          </span>
          <span className="flex items-center gap-1 text-caption text-ink-subtle">
            <span className="truncate max-w-[85px] font-medium">{activeLanguageInfo?.nativeLabel || language}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${isLangSubmenuOpen ? 'rotate-180 text-accent' : ''}`} />
          </span>
        </button>

        {isLangSubmenuOpen && (
          <div className="mx-1 mb-1 p-1 bg-surface-hover/60 rounded-xl border border-line max-h-44 overflow-y-auto overscroll-contain">
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
                    className={`w-full px-2.5 py-1.5 text-xs rounded-lg flex items-center justify-between transition-colors cursor-pointer text-start ${isSelected
                        ? 'bg-accent-soft text-accent font-bold'
                        : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
                      }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-5 text-center font-mono text-caption px-1 py-0.5 rounded bg-surface-overlay text-ink-muted">
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

      {/* User Account / Quota */}
      <div className="my-0.5 border-t border-line/60" />
      {user ? (
        <div className="p-2 bg-surface-hover/50 rounded-xl border border-line">
          <div className="flex items-center justify-between text-caption font-semibold text-ink truncate mb-1">
            <span className="truncate">{isGuest ? t('toolbar.guestLabel') : user.user_metadata?.full_name || user.email}</span>
            {quota && !quota.is_admin && quota.mode === 'limited' && (
              <span className="text-accent text-caption shrink-0 font-mono">
                {quota.remaining_paid ?? 0}/{quota.daily_paid_limit}
              </span>
            )}
            {quota && !quota.is_admin && quota.mode === 'unlimited' && (
              <span className="text-accent text-caption shrink-0 font-mono uppercase">
                {t('quota.badgeUnlimited')}
              </span>
            )}
            {quota && !quota.is_admin && quota.mode === 'free' && (
              <span className="text-success text-caption shrink-0 font-mono uppercase">
                {t('quota.badgeFreeMode')}
              </span>
            )}
          </div>
          {isGuest && (
            <button
              type="button"
              onClick={() => {
                setOpenMenu(null);
                onOpenAuth?.('signin');
              }}
              className="text-caption text-accent hover:underline mb-1.5 flex items-center gap-1.5 cursor-pointer font-medium"
            >
              <LogIn className="w-3.5 h-3.5 text-accent shrink-0" />
              <span>{t('toolbar.signInOrRegister') || t('toolbar.signIn')}</span>
            </button>
          )}
          {!isGuest && (
            <button
              type="button"
              onClick={async () => {
                setOpenMenu(null);
                await logout();
              }}
              className="text-caption text-ink-subtle hover:text-danger flex items-center gap-1.5 pt-1 border-t border-line/60 w-full cursor-pointer transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{t('toolbar.signOut')}</span>
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setOpenMenu(null);
            onOpenAuth?.('signin');
          }}
          className="w-full text-start px-2.5 py-2 rounded-xl flex items-center gap-2.5 text-accent hover:bg-accent-soft transition-colors cursor-pointer font-semibold"
        >
          <LogIn className="w-4 h-4 shrink-0" />
          <span>{t('toolbar.signIn')}</span>
        </button>
      )}
    </div>
  );

  // Renders one filter dimension's section ('lane' | 'category'): header + "All" reset +
  // individual multi-select items. Both dimensions render independently and simultaneously,
  // so a user can combine a topic selection with a timeline/track selection at once.
  const renderFilterSection = (dimension, items, activeItems, allLabel, headerLabel) => {
    const isAllActive = !activeItems?.length;

    return (
      <div className="space-y-0.5">
        <div className="px-2.5 py-1 text-caption font-bold text-ink-subtle uppercase tracking-wider flex items-center justify-between">
          <span>{headerLabel}</span>
          <span className="text-caption font-mono text-ink-faint">{items.length}</span>
        </div>

        {/* All items toggle button (resets just this dimension) */}
        <button
          type="button"
          onClick={() => onFilterSelect?.(dimension, null)}
          className={`w-full px-2.5 py-1.5 text-xs rounded-xl flex items-center justify-between transition-colors cursor-pointer text-start ${isAllActive
              ? 'bg-accent-soft text-accent font-semibold'
              : 'text-ink-muted hover:bg-surface-hover/80 hover:text-ink'
            }`}
        >
          <span className="flex items-center gap-2 min-w-0">
            <span
              className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0 border transition-all ${isAllActive
                  ? 'bg-accent border-accent text-accent-fg shadow-xs'
                  : 'border-line bg-surface-sunken/60 text-transparent'
                }`}
            >
              <Check className={`w-3 h-3 stroke-[2.5] ${isAllActive ? 'opacity-100' : 'opacity-0'}`} />
            </span>
            <span className="truncate">{allLabel}</span>
          </span>
          <span className="text-caption font-semibold px-1.5 py-0.5 rounded-full bg-surface-sunken text-ink-subtle ms-2 shrink-0">
            {timelineData?.articles?.length ?? 0}
          </span>
        </button>

        <div className="space-y-0.5">
          {items.map((item) => {
            const isEditingThis = editingTarget?.dimension === dimension && String(editingTarget?.id) === String(item.id);
            const isActive = Boolean(
              activeItems?.some((selected) => {
                if (!selected) return false;
                const selId = typeof selected === 'object' ? selected.id : selected;
                return String(selId) === String(item.id);
              })
            );

            if (isEditingThis) {
              return (
                <div
                  key={item.id}
                  className="w-full px-1.5 py-1 rounded-xl bg-surface-sunken/90 border border-accent/60 shadow-xs animate-in fade-in duration-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <form
                    onSubmit={handleSaveEdit}
                    className="flex items-center gap-1.5 w-full"
                  >
                    {dimension === 'lane' ? (
                      <Layers className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                    ) : (
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs"
                        style={{ backgroundColor: item.color }}
                      />
                    )}
                    <input
                      ref={editInputRef}
                      type="text"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.stopPropagation();
                          cancelEditing();
                        }
                      }}
                      className="flex-1 min-w-0 px-1.5 py-0.5 text-xs bg-surface text-ink border border-line rounded-lg focus:outline-none focus:border-accent font-normal"
                      maxLength={60}
                      placeholder={item.name}
                      aria-label={t('common.edit') || 'Edit'}
                    />
                    <button
                      type="submit"
                      disabled={!editingValue.trim() || editingValue.trim() === item.name}
                      className="p-1 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors disabled:opacity-30 disabled:cursor-default shrink-0 cursor-pointer"
                      title={t('common.save') || 'Save'}
                      aria-label={t('common.save') || 'Save'}
                    >
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditing}
                      className="p-1 rounded-md text-ink-subtle hover:text-ink hover:bg-surface-overlay transition-colors shrink-0 cursor-pointer"
                      title={t('common.cancel') || 'Cancel'}
                      aria-label={t('common.cancel') || 'Cancel'}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </form>
                </div>
              );
            }

            return (
              <div
                key={item.id}
                className={`group relative flex items-center justify-between w-full px-2 py-1 text-xs rounded-xl transition-colors ${isActive
                    ? 'bg-accent-soft text-accent font-semibold'
                    : 'text-ink-muted hover:bg-surface-hover/80 hover:text-ink'
                  }`}
              >
                <button
                  type="button"
                  onClick={() => onFilterSelect?.(dimension, item)}
                  className="flex items-center gap-2 min-w-0 flex-1 text-start cursor-pointer py-0.5 focus:outline-none"
                >
                  <span
                    className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border transition-all ${isActive
                        ? 'bg-accent border-accent text-accent-fg shadow-xs'
                        : 'border-line bg-surface-sunken/60 text-transparent'
                      }`}
                  >
                    <Check className={`w-3 h-3 stroke-[2.5] ${isActive ? 'opacity-100' : 'opacity-0'}`} />
                  </span>
                  {dimension === 'lane' ? (
                    <Layers className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                  ) : (
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs"
                      style={{ backgroundColor: item.color }}
                    />
                  )}
                  <span className="truncate" title={item.name}>
                    {item.name}
                  </span>
                </button>

                <div className="flex items-center gap-1 shrink-0 ms-1.5">
                  <span className="text-caption font-semibold px-1.5 py-0.5 rounded-full bg-surface-sunken text-ink-subtle">
                    {item.count ?? 0}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditing(dimension, item);
                      }}
                      className="p-1 rounded text-ink-subtle hover:text-accent hover:bg-surface-sunken/80 transition-colors opacity-70 group-hover:opacity-100 focus:opacity-100 cursor-pointer"
                      title={dimension === 'lane' ? (t('toolbar.editLaneName') || t('common.edit') || 'Edit lane name') : (t('toolbar.editThemeName') || t('common.edit') || 'Edit theme name')}
                      aria-label={dimension === 'lane' ? (t('toolbar.editLaneName') || t('common.edit') || 'Edit lane name') : (t('toolbar.editThemeName') || t('common.edit') || 'Edit theme name')}
                    >
                      <Pencil className="w-3 h-3 shrink-0" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderFilterMenu = () => {
    const themeLabel = t('toolbar.filterByTheme') !== 'toolbar.filterByTheme' ? t('toolbar.filterByTheme') : t('legend.filterByTheme');
    const laneLabel = t('toolbar.filterByLane') !== 'toolbar.filterByLane' ? t('toolbar.filterByLane') : t('legend.filterByLane');
    const allThemesLabel = t('toolbar.allThemes') !== 'toolbar.allThemes' ? t('toolbar.allThemes') : t('legend.allThemes');
    const allLanesLabel = t('toolbar.allLanes') !== 'toolbar.allLanes' ? t('toolbar.allLanes') : t('legend.allLanes');

    return (
      <div className="p-1.5 space-y-2">
        {categoryFilterItems.length >= 1 &&
          renderFilterSection('category', categoryFilterItems, activeFilter?.categoryItems, allThemesLabel, themeLabel)}

        {categoryFilterItems.length >= 1 && laneFilterItems.length >= 2 && (
          <div className="border-t border-line" />
        )}

        {laneFilterItems.length >= 2 &&
          renderFilterSection('lane', laneFilterItems, activeFilter?.laneItems, allLanesLabel, laneLabel)}
      </div>
    );
  };

  return (
    <div ref={rootRef}>
      {/* ========================================================================= */}
      {/* 1. DESKTOP FIXED VERTICAL LEFT BAR (>= 768px)                             */}
      {/* ========================================================================= */}
      <aside
        ref={desktopRailRef}
        id="chronix-left-dock"
        dir="ltr"
        style={{ zIndex: FLOATING_Z.ALWAYS_ON_TOP }}
        className="chronix-desktop-rail fixed inset-y-0 left-0 w-[52px] h-full bg-surface/85 backdrop-blur-2xl border-r border-line z-30 hidden md:flex flex-col items-center justify-between py-3 px-1 select-none transition-colors duration-200"
      >
        {/* Top Section: Navigation & Tools */}
        <div className="flex flex-col items-center gap-1.5 w-full dock-rail-section">
          {/* 1. Home - Quick Return to Home Button */}
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

          {/* 2. Overview - Narrative overview */}
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

          {/* 3. Filter - Filter by Theme/Lane */}
          {canFilter && (
            <div className="relative" ref={desktopFilterRef}>
              <button
                id={!isMobile ? 'guide-dock-filter' : undefined}
                type="button"
                onClick={() => toggle('filter')}
                className={`${railBtn} ${openMenu === 'filter' || activeFilterCount > 0 ? railActive : railIdle}`}
                title={t('toolbar.filterOptions')}
                aria-label={t('toolbar.filterOptions')}
                aria-haspopup="true"
                aria-expanded={openMenu === 'filter'}
              >
                <Filter className="w-5 h-5 shrink-0" strokeWidth={1.8} />
                {activeFilterCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-accent" />
                )}
              </button>
            </div>
          )}

          {/* 4. Guided Tour - Guided exploration active controls or Play button */}
          {hasArticles && isExploring && (
            <div className="flex flex-col items-center gap-1 p-0.5 rounded-xl bg-surface-hover/60 border border-line my-0.5 animate-in fade-in zoom-in-95 duration-150">
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
                type="button"
                onClick={() => onExitExplore?.()}
                className={`${railBtn} ${railIdle} !w-8 !h-8 text-ink-subtle hover:text-danger`}
                title={`${t('explore.exit')} (Esc)`}
                aria-label={t('explore.exit')}
              >
                <X className="w-3.5 h-3.5 shrink-0" />
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
              {onToggleTourDetails && (
                <button
                  type="button"
                  onClick={() => onToggleTourDetails()}
                  className={`${railBtn} ${isTourDetailsMinimized ? railIdle : railActive} !w-8 !h-8`}
                  title={isTourDetailsMinimized ? t('explore.showDetails') : t('explore.minimizeDetails')}
                  aria-label={isTourDetailsMinimized ? t('explore.showDetails') : t('explore.minimizeDetails')}
                  aria-pressed={!isTourDetailsMinimized}
                >
                  {isTourDetailsMinimized
                    ? <PanelLeftOpen className="w-4 h-4 shrink-0" strokeWidth={1.8} />
                    : <PanelLeftClose className="w-4 h-4 shrink-0" strokeWidth={1.8} />}
                </button>
              )}
            </div>
          )}

          {hasArticles && !isExploring && (
            <button
              id={!isMobile ? 'guide-dock-explore' : undefined}
              type="button"
              onClick={() => onStartExplore?.()}
              className={`${railBtn} ${showTourHint ? 'text-ink bg-surface-active tour-play-hint' : railIdle}`}
              title={t('explore.startTooltip')}
              aria-label={t('explore.start')}
            >
              <Play className="w-[19px] h-[19px] fill-current shrink-0 translate-x-px" />
            </button>
          )}

          {/* 5. Cards Drawer - Event list / Cards drawer */}
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

          {/* 6. Star - Favorites filter */}
          <button
            id={!isMobile ? 'guide-dock-star' : undefined}
            type="button"
            onClick={() => onToggleFilterStarredOnly?.()}
            className={`${railBtn} ${filterStarredOnly
                ? 'bg-star/15 text-star'
                : railIdle
              }`}
            title={filterStarredOnly ? t('toolbar.filterStarredActive') : t('toolbar.filterStarred')}
            aria-label={filterStarredOnly ? t('toolbar.filterStarredActive') : t('toolbar.filterStarred')}
            aria-pressed={filterStarredOnly}
          >
            <Star className={`w-5 h-5 shrink-0 ${filterStarredOnly ? 'fill-current' : ''}`} strokeWidth={1.8} />
            {starredCount > 0 && (
              <span className="absolute top-0.5 right-0.5 min-w-[16px] h-[16px] px-1 text-caption font-bold rounded-full bg-star text-white flex items-center justify-center leading-none">
                {starredCount}
              </span>
            )}
          </button>

          {/* 6.5 Divider */}
          <div className="w-5 border-t border-line my-0.5" />

          {/* 7. More Actions & Settings - Main Menu & Actions popover button */}
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
          </div>
        </div>

        {/* Bottom Section: Utilities (Theme toggle) */}
        <div className="flex flex-col items-center gap-1.5 w-full dock-rail-section">
          <div className="w-5 border-t border-line my-0.5" />

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

      {/* 1.1 Desktop Floating Rail Popovers (Rendered as root children to avoid any clipping from aside stacking context) */}
      {!isMobile && openMenu === 'filter' && (
        <div
          className="w-68 max-w-[calc(100vw-4.5rem)] overflow-y-auto overscroll-contain menu-scroller bg-surface-overlay rounded-xl border border-line shadow-pop p-1.5 text-xs animate-in fade-in zoom-in-95 duration-150"
          style={popoverPosStyle}
          dir={isRtl ? 'rtl' : 'ltr'}
        >
          {renderFilterMenu()}
        </div>
      )}

      {!isMobile && openMenu === 'actions' && (
        <div
          className="w-72 max-w-[calc(100vw-4.5rem)] overflow-y-auto overscroll-contain menu-scroller bg-surface-overlay rounded-xl border border-line shadow-pop p-1.5 text-xs animate-in fade-in zoom-in-95 duration-150"
          style={popoverPosStyle}
          dir={isRtl ? 'rtl' : 'ltr'}
        >
          {renderActionsMenu(false)}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. MOBILE BOTTOM COMMAND BAR (< 768px)                                   */}
      {/* ========================================================================= */}
      <nav
        ref={mobileDockRef}
        id="chronix-mobile-bottom-dock"
        dir="ltr"
        className="mobile-bottom-command-bar fixed bottom-0 inset-x-0 z-[49] flex md:hidden items-start justify-between px-3 sm:px-4 pt-2 select-none"
        style={{
          paddingBottom: 'max(8px, env(safe-area-inset-bottom, 0px))',
        }}
      >
        {/* 1. Home - Quick Return to Home Button */}
        <button
          id="guide-dock-home"
          type="button"
          onClick={() => onGoHome?.()}
          className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 p-1.5 text-ink-muted hover:text-ink active:scale-90 transition-all rounded-full cursor-pointer shrink-0"
          title={t('toolbar.goHome')}
          aria-label={t('toolbar.goHome')}
        >
          <Home className="w-[18px] h-[18px] sm:w-5 sm:h-5 shrink-0" strokeWidth={1.8} />
        </button>

        {/* 2. Filter - Filter by Theme/Lane (hidden during active tour) */}
        {canFilter && !isExploring && (
          <button
            id="guide-dock-filter"
            type="button"
            onClick={() => toggle('filter')}
            className={`flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 p-1.5 relative active:scale-90 transition-all rounded-full cursor-pointer shrink-0 ${openMenu === 'filter' || activeFilterCount > 0 ? 'text-accent bg-accent/15' : 'text-ink-muted hover:text-ink'
              }`}
            title={t('toolbar.filterOptions')}
            aria-label={t('toolbar.filterOptions')}
          >
            <Filter className="w-[18px] h-[18px] sm:w-5 sm:h-5 shrink-0" strokeWidth={1.8} />
            {activeFilterCount > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-accent ring-2 ring-surface shadow-xs" />
            )}
          </button>
        )}

        {/* 3. Star - Starred Favorites Filter (hidden during active tour) */}
        {!isExploring && (
          <button
            id="guide-dock-star"
            type="button"
            onClick={() => onToggleFilterStarredOnly?.()}
            className={`flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 p-1.5 relative active:scale-90 transition-all rounded-full cursor-pointer shrink-0 ${filterStarredOnly ? 'text-star bg-star/15' : 'text-ink-muted hover:text-ink'
              }`}
            title={filterStarredOnly ? t('toolbar.filterStarredActive') : t('toolbar.filterStarred')}
            aria-label={filterStarredOnly ? t('toolbar.filterStarredActive') : t('toolbar.filterStarred')}
          >
            <Star className={`w-[18px] h-[18px] sm:w-5 sm:h-5 shrink-0 ${filterStarredOnly ? 'fill-current' : ''}`} strokeWidth={1.8} />
            {starredCount > 0 && (
              <span className="absolute top-0.5 right-0.5 min-w-[14px] h-[14px] px-0.5 text-[8px] font-bold rounded-full bg-star text-white flex items-center justify-center">
                {starredCount}
              </span>
            )}
          </button>
        )}

        {/* 4. Guided Tour - Active Exploration Controls or Play Button */}
        {hasArticles && (
          isExploring ? (
            <div className="flex items-center gap-1 sm:gap-1.5 px-2 py-1 rounded-full bg-surface-raised border border-line shadow-pop shrink-0 select-none">
              {/* Previous button: on the far left */}
              <button
                type="button"
                onClick={() => onExplorePrev?.()}
                disabled={atStart}
                className="w-8 h-8 flex items-center justify-center rounded-full text-ink hover:bg-surface-hover disabled:opacity-25 active:scale-90 transition-colors cursor-pointer touch-manipulation"
                title={`${t('explore.prev')} (←)`}
                aria-label={t('explore.prev')}
              >
                <ChevronLeft className="w-4 h-4 shrink-0" strokeWidth={2.2} />
              </button>

              {/* Center cluster: Counter + Divider + Exit (X) */}
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface-hover/70 border border-line">
                <span className="text-[11px] font-bold text-ink-muted tabular-nums">
                  {exploreProgress ? `${exploreProgress.current}/${exploreProgress.total}` : ''}
                </span>

                <div className="w-px h-3.5 bg-line-strong/70" />

                {/* Exit tour button: centered, clearly isolated from Next */}
                <button
                  type="button"
                  onClick={() => onExitExplore?.()}
                  className="w-6 h-6 flex items-center justify-center rounded-full text-ink-subtle hover:text-danger hover:bg-danger-soft active:scale-90 transition-all cursor-pointer touch-manipulation"
                  title={`${t('explore.exit')} (Esc)`}
                  aria-label={t('explore.exit')}
                >
                  <X className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                </button>
              </div>

              {/* Next button: on the far right (Primary Accent action) */}
              <button
                type="button"
                onClick={() => onExploreNext?.()}
                disabled={atEnd}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-25 active:scale-90 shadow-xs transition-all cursor-pointer touch-manipulation"
                title={`${t('explore.next')} (→)`}
                aria-label={t('explore.next')}
              >
                <ChevronRight className="w-4 h-4 shrink-0" strokeWidth={2.5} />
              </button>
            </div>
          ) : (
            <button
              id="guide-dock-explore"
              type="button"
              onClick={() => onStartExplore?.()}
              className={`mobile-bottom-command-primary flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 p-1.5 text-ink rounded-full active:scale-90 transition-all cursor-pointer shrink-0 ${showTourHint ? 'tour-play-hint' : ''
                } ${showTourHint && isOverviewOpen ? 'tour-play-hint-paused' : ''}`}
              title={t('explore.startTooltip')}
              aria-label={t('explore.start')}
            >
              <Play className="w-[18px] h-[18px] fill-current shrink-0" />
            </button>
          )
        )}

        {/* 5. Overview (hidden during active tour to preserve bar space) */}
        {hasOverview && !isExploring && (
          <button
            id="guide-dock-overview"
            type="button"
            onClick={() => onToggleOverview?.()}
            className={`flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 p-1.5 active:scale-90 transition-all rounded-full cursor-pointer shrink-0 ${isOverviewOpen ? 'text-accent bg-accent/15' : 'text-ink-muted hover:text-ink'
              }`}
            title={t('overview.title')}
            aria-label={t('overview.title')}
          >
            <BookOpen className="w-[18px] h-[18px] sm:w-5 sm:h-5 shrink-0" strokeWidth={1.8} />
          </button>
        )}

        {/* 6. Theme Toggle - Day / Night mode (hidden during active tour) */}
        {!isExploring && (
          <button
            id="guide-dock-theme"
            type="button"
            onClick={() => onToggleTheme?.()}
            className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 p-1.5 text-ink-muted hover:text-ink active:scale-90 transition-all rounded-full cursor-pointer shrink-0"
            title={theme === 'dark' ? t('toolbar.switchThemeLight') : t('toolbar.switchThemeDark')}
            aria-label={theme === 'dark' ? t('toolbar.switchThemeLight') : t('toolbar.switchThemeDark')}
          >
            {theme === 'dark' ? (
              <Sun className="w-[18px] h-[18px] sm:w-5 sm:h-5 text-amber-400 hover:rotate-45 transition-transform shrink-0" strokeWidth={1.8} />
            ) : (
              <Moon className="w-[18px] h-[18px] sm:w-5 sm:h-5 text-ink-muted hover:-rotate-12 transition-transform shrink-0" strokeWidth={1.8} />
            )}
          </button>
        )}

        {/* 7. Settings / More Actions - More Menu */}
        <button
          id="guide-more-actions"
          data-guide="more-actions"
          type="button"
          onClick={() => toggle('actions')}
          className={`flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 p-1.5 active:scale-90 transition-all rounded-full cursor-pointer shrink-0 ${openMenu === 'actions' ? 'text-accent bg-accent/15' : 'text-ink-muted hover:text-ink'
            }`}
          title={t('toolbar.moreActions')}
          aria-label={t('toolbar.moreActions')}
        >
          <Menu className="w-[18px] h-[18px] sm:w-5 sm:h-5 shrink-0" strokeWidth={1.8} />
        </button>
      </nav>

      {/* ========================================================================= */}
      {/* 3. MOBILE ACTION SHEET (Bottom Sheet modal for Filter & More Actions)      */}
      {/* ========================================================================= */}
      <MobileActionSheet
        isOpen={isMobile && Boolean(openMenu || renderedMenu)}
        isClosing={isSheetClosing}
        title={(renderedMenu || openMenu) === 'filter' ? (t('toolbar.filterOptions') || 'Filter') : (t('toolbar.moreActions') || 'More Actions')}
        onClose={closeMobileMenu}
        onTouchStart={handleSheetTouchStart}
        onTouchEnd={handleSheetTouchEnd}
        isRtl={isRtl}
      >
        {(renderedMenu || openMenu) === 'filter' ? renderFilterMenu() : renderActionsMenu(true)}
      </MobileActionSheet>
    </div>
  );
}

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, ExternalLink, Edit, Trash2, Calendar, Layers, Tag, Image as ImageIcon, AlertTriangle, MapPin, Star, ChevronLeft, ChevronRight, Globe, MessageSquare, Maximize2, Minus, Plus, Move, Check, Quote, Images, Play, Pause, Pencil, FileText, BookOpen, Film, Map as MapIcon, Sparkles, Loader2, ChevronDown, Lock, Zap, LayoutGrid, useIsToyTheme } from './icons/ThemeIcons';
import { getDistinctCategories, getCategoryColor } from '../data/laneColors';
import { useLanguage } from '../context/LanguageContext';
import { translations } from '../locales/translations';
import { normalizeAdditionalImages, isSameArticleId } from '../utils/timelineArticles';
import MathMarkdown from './MathMarkdown';
import PanelNavButtons from './PanelNavButtons';
import useAutoFocalPoint from '../hooks/useAutoFocalPoint';
import useIsMobileViewport from '../hooks/useIsMobileViewport';
import { containsMath } from '../utils/mathUtils';
import { WikipediaPanel, VideosPanel, toEmbeddableWikiUrl, getWikiLang, sanitizeVideos, buildEventVideoQuery } from './EventMediaTabs';
import { appendTimeOfDay, formatSpanWithTimes } from '../utils/dateTime';
import { areTextsRtl, getTextDir } from '../utils/textDirection';
import { linksOfKind, illustrativeCover } from '../utils/personalEnrichment';
import {
  normalizeAnimatedMediaUrl,
  getDrawerImageUrl,
  getDrawerImageCandidates,
  getLightboxImageCandidates,
} from '../utils/wikimediaImageUrl';
import { generateEventImage, getApiKey } from '../api';
import { isAiImageEventDrawerEnabled } from '../utils/featureFlags';
import InlineEventEditor from './eventEditor/InlineEventEditor';
import PhotoCollageDialog from './PhotoCollageDialog';
import {
  formatAiModelName,
  formatUsdDigits,
  getCreditCosts,
  getRemainingPaidCredits,
  isGeminiModel,
  isPremiumCreditsExhausted,
} from '../utils/modelUtils';

import {
  EVENT_DRAWER_MIN_WIDTH,
  EVENT_DRAWER_KEY_STEP,
  clampEventDrawerWidth,
} from '../utils/drawerLayout';

export { normalizeAnimatedMediaUrl, EVENT_DRAWER_MIN_WIDTH, EVENT_DRAWER_KEY_STEP, clampEventDrawerWidth };

const IMAGE_MIN_SCALE = 1;
const IMAGE_MAX_SCALE = 5;
const IMAGE_ZOOM_STEP = 0.5;
// How long each photo stays on screen during the slideshow.
const SLIDESHOW_INTERVAL_MS = 4000;
// Events with several photos play them in the drawer by default; pausing once turns that off
// (remembered) until the user presses play again. Reduced-motion users never get autoplay.
const SLIDESHOW_AUTOPLAY_KEY = 'chronix_event_slideshow_autoplay_v1';
function shouldAutoplaySlideshow() {
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
    return localStorage.getItem(SLIDESHOW_AUTOPLAY_KEY) !== '0';
  } catch {
    return false;
  }
}
function rememberSlideshowAutoplay(on) {
  try {
    localStorage.setItem(SLIDESHOW_AUTOPLAY_KEY, on ? '1' : '0');
  } catch {
    // ignore (private mode / storage disabled)
  }
}

const SWIPE_NAV_MIN_DISTANCE = 60;
const SWIPE_NAV_MAX_DURATION = 800;

function isInHorizontalScroller(node, boundary) {
  for (let el = node; el && el !== boundary; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const { overflowX } = window.getComputedStyle(el);
      if (overflowX === 'auto' || overflowX === 'scroll') return true;
    }
  }
  return false;
}

export function formatDatePart(d, lang = 'en') {
  if (!d) return '';
  if (typeof d === 'number') return String(d);
  if (typeof d === 'string') return d;
  if (d.year === undefined || d.year === null) return '';
  const y = Number(d.year);
  if (isNaN(y)) return String(d.year);

  const dict = translations[lang]?.dates || translations.en.dates;

  if (d.precision === 'million-years' || Math.abs(y) >= 1000000) {
    const ma = Math.abs(y / 1000000);
    const maStr = ma % 1 === 0 ? ma.toFixed(0) : ma.toFixed(1);
    return `${maStr} ${dict.millionYearsAgo}`;
  }

  if (y < 0) {
    const absY = Math.abs(y);
    if (lang === 'ja' || lang === 'zh') return `${dict.bce} ${absY}年`;
    if (lang === 'ko') return `${dict.bce} ${absY}년`;
    return `${absY} ${dict.bce}`;
  }

  const monthIdx = Number(d.month) - 1;
  const monthName = dict.months?.[monthIdx] || d.month;

  if (d.month && d.day) {
    const fmt = dict.formatDate || "{month} {day}, {year}";
    return appendTimeOfDay(fmt.replace('{day}', d.day).replace('{month}', monthName).replace('{year}', y), d);
  }

  if (d.month) {
    return `${monthName} ${y}`;
  }

  return `${y}`;
}

export function formatTimeSpan(from, to, isToPresent, lang = 'en') {
  const dict = translations[lang]?.dates || translations.en.dates;
  return formatSpanWithTimes(from, to, isToPresent, (d) => formatDatePart(d, lang), dict.present);
}

export default function EventDrawer({
  article,
  lanes = [],
  articles = [],
  timelineId = null,
  timelineTitle = '',
  timelineTags = [],
  timelineTimeScale = 'calendar',
  isTimelineFictional = false,
  // Personal timelines (family, trips, a life story): a YouTube search on "Our first apartment"
  // only finds strangers' videos, so the Videos tab is offered only for events linked to Wikipedia.
  isTimelinePersonal = false,
  grounding = null,
  isStarred = false,
  onToggleStar,
  onClose,
  // Side panel Back/Forward descriptor (see PanelNavButtons); null when there's no history.
  panelNav = null,
  onEdit,
  onDelete,
  onAskAi,
  onImagePositionChange,
  onEventImageGenerated,
  onSetCoverImage,
  // (dataUrl, { asCover }) => Promise — saves a generated photo (the collage) on the event.
  onAddEventPhoto,
  quota = null,
  onRefreshQuota,
  onVideosFound,
  onShowOnMap,
  // Owner removes a wrong Wikipedia link: (url, eventId) - eventId null for a place link, which
  // goes from every event at that place.
  onDismissContextLink,
  // { current, total } position of this event in the visible chronological order.
  navProgress = null,
  onNavigateNext,
  onNavigatePrev,
  readOnly = false,
  width = null,
  onWidthChange,
  // In-place editing: when `onSaveEdit` is given, Edit switches the drawer into edit mode
  // instead of calling `onEdit`. `isNew` opens the drawer as an empty "new event" form.
  onSaveEdit,
  isNew = false,
  // Asks the drawer to enter edit mode for this article id (e.g. from the Edit Timeline panel).
  editRequestId = null,
  onEditRequestHandled,
  // Reports whether the in-place editor has unsaved changes (lets the app guard navigation).
  onEditDirtyChange,
  // Stacking level for the full-screen photo viewer (portaled to <body>). Hosts that sit above
  // the default z-[70] layer, like the Story Studio preview, pass their own.
  lightboxZIndex = null,
  style
}) {
  const { language, isRtl, t, formatTimeSpan: localizedTimeSpan } = useLanguage();
  useIsToyTheme();
  const [isImageOpen, setIsImageOpen] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  // Which of the event's photos the drawer's media frame shows (0 = the main image).
  const [heroIndex, setHeroIndex] = useState(0);
  const [isSlideshowPlaying, setIsSlideshowPlaying] = useState(false);
  // Inline slideshow: the drawer's own media frame cycles through the photos.
  const [isHeroPlaying, setIsHeroPlaying] = useState(shouldAutoplaySlideshow);
  // The slide being faded out underneath the incoming one ({ url, position, key }).
  const [heroUnderlay, setHeroUnderlay] = useState(null);
  const [isCollageOpen, setIsCollageOpen] = useState(false);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [drawerCandidateIdx, setDrawerCandidateIdx] = useState(0);
  const [lightboxCandidateIdx, setLightboxCandidateIdx] = useState(0);
  const [isPositioningImage, setIsPositioningImage] = useState(false);
  const [imagePosition, setImagePosition] = useState({
    x: article?.imagePositionX ?? 50,
    y: article?.imagePositionY ?? 50
  });
  const [imageView, setImageView] = useState({ scale: 1, x: 0, y: 0 });
  const [isGifPaused, setIsGifPaused] = useState(false);
  const [pausedFrameDataUrl, setPausedFrameDataUrl] = useState(null);
  const [isGeneratingAiImage, setIsGeneratingAiImage] = useState(false);
  const [showAiImageOptions, setShowAiImageOptions] = useState(false);
  const [aiImageCustomPrompt, setAiImageCustomPrompt] = useState('');
  const [aiImageStyle, setAiImageStyle] = useState('auto');
  const [aiImageEngine, setAiImageEngine] = useState('free');
  const [lastGeneratedImageCost, setLastGeneratedImageCost] = useState(null);
  const [aiImageError, setAiImageError] = useState(null);
  // The chosen tab persists across events (like stepping Prev/Next on the Videos tab).
  const [activeTab, setActiveTab] = useState('details');
  // Iframes stay mounted once opened for an event, so switching tabs doesn't reload them.
  const [visitedTabs, setVisitedTabs] = useState({ articleId: null, tabs: [] });
  // { articleId, url }: the context link (place / historical event) the Wikipedia tab shows.
  const [wikiChoice, setWikiChoice] = useState(null);

  const isMobile = useIsMobileViewport();

  const canEditInPlace = Boolean(onSaveEdit) && !readOnly;
  const [isEditing, setIsEditing] = useState(Boolean(isNew && canEditInPlace));
  const [editSession, setEditSession] = useState(0);
  const editDirtyRef = useRef(false);
  const handleEditorDirtyChange = useCallback((dirty) => {
    editDirtyRef.current = dirty;
    onEditDirtyChange?.(dirty);
  }, [onEditDirtyChange]);
  const startEditing = useCallback(() => {
    setEditSession((n) => n + 1);
    setIsEditing(true);
  }, []);
  const stopEditing = useCallback(() => {
    editDirtyRef.current = false;
    onEditDirtyChange?.(false);
    setIsEditing(false);
  }, [onEditDirtyChange]);

  // Switching to another event (or into/out of the "new event" form) leaves edit mode.
  useEffect(() => {
    editDirtyRef.current = false;
    setIsEditing(Boolean(isNew && canEditInPlace));
    if (isNew) setEditSession((n) => n + 1);
  }, [article?.id, isNew]);

  useEffect(() => {
    if (editRequestId == null || !article || String(article.id) !== String(editRequestId)) return;
    if (canEditInPlace) startEditing();
    onEditRequestHandled?.();
  }, [editRequestId, article?.id]);

  const touchStartYRef = useRef(0);
  const touchStartXRef = useRef(0);
  const swipeNavRef = useRef(null);
  const [isClosing, setIsClosing] = useState(false);

  const drawerRef = useRef(null);
  const resizeDragRef = useRef(null);
  const [liveWidth, setLiveWidth] = useState(null);
  const canResize = Boolean(onWidthChange) && !isMobile;

  const handleResizePointerDown = (e) => {
    if (e.button !== 0 || !drawerRef.current) return;
    e.preventDefault();
    const startWidth = drawerRef.current.getBoundingClientRect().width;
    resizeDragRef.current = { startX: e.clientX, startWidth, width: startWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
    setLiveWidth(startWidth);
  };
  const handleResizePointerMove = (e) => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    drag.width = clampEventDrawerWidth(drag.startWidth + e.clientX - drag.startX);
    setLiveWidth(drag.width);
  };
  const handleResizePointerEnd = () => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    resizeDragRef.current = null;
    setLiveWidth(null);
    if (Math.abs(drag.width - drag.startWidth) >= 1) onWidthChange(drag.width);
  };
  const handleResizeKeyDown = (e) => {
    const current = drawerRef.current?.getBoundingClientRect().width || EVENT_DRAWER_MIN_WIDTH;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? EVENT_DRAWER_KEY_STEP : -EVENT_DRAWER_KEY_STEP;
      onWidthChange(clampEventDrawerWidth(current + delta));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onWidthChange(null);
    }
  };

  const animateOut = useCallback((callback) => {
    setIsClosing(true);
    setTimeout(() => {
      callback?.();
      setIsClosing(false);
    }, 280);
  }, []);
  const handleAnimatedClose = useCallback(() => {
    if (isEditing && editDirtyRef.current && !window.confirm(t('eventEditor.discardConfirm'))) return;
    if (isEditing) {
      editDirtyRef.current = false;
      onEditDirtyChange?.(false);
    }
    setAiImageEngine('free');
    animateOut(onClose);
  }, [animateOut, onClose, isEditing, onEditDirtyChange, t]);

  const handleTouchStart = (e) => {
    if (e.touches && e.touches[0]) {
      touchStartYRef.current = e.touches[0].clientY;
      touchStartXRef.current = e.touches[0].clientX;
    }
  };
  const handleTouchEnd = (e) => {
    if (e.changedTouches && e.changedTouches[0]) {
      const deltaY = e.changedTouches[0].clientY - touchStartYRef.current;
      const deltaX = e.changedTouches[0].clientX - touchStartXRef.current;
      // Horizontal swipes belong to event navigation, not dismissal.
      if (deltaY > 50 && deltaY > Math.abs(deltaX)) {
        handleAnimatedClose();
      }
    }
    touchStartYRef.current = 0;
  };

  // Swipe left = next, swipe right = previous, matching the LTR Prev/Next strip.
  const canSwipeNavigate = isMobile && Boolean(navProgress) && !isEditing;
  const handleSwipeNavStart = (e) => {
    swipeNavRef.current = null;
    if (!canSwipeNavigate || isImageOpen || isPositioningImage || e.touches.length !== 1) return;
    if (isInHorizontalScroller(e.target, e.currentTarget)) return;
    const touch = e.touches[0];
    swipeNavRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  };
  const handleSwipeNavEnd = (e) => {
    const start = swipeNavRef.current;
    swipeNavRef.current = null;
    const touch = e.changedTouches?.[0];
    if (!start || !touch || !navProgress) return;
    if (Date.now() - start.time > SWIPE_NAV_MAX_DURATION) return;
    if (window.getSelection?.()?.isCollapsed === false) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < SWIPE_NAV_MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) {
      if (navProgress.current < navProgress.total) onNavigateNext?.();
    } else if (navProgress.current > 1) {
      onNavigatePrev?.();
    }
  };
  const handleSwipeNavCancel = () => {
    swipeNavRef.current = null;
  };

  // Keyboard stepping: → next, ← previous (matching the LTR Prev/Next strip).
  useEffect(() => {
    if (!navProgress || isImageOpen || isPositioningImage || isEditing) return undefined;
    const handleKeyDown = (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target;
      if (el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)) return;
      if (el?.closest?.('[role="separator"], [role="tablist"], [role="slider"]')) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (e.key === 'ArrowRight' && navProgress.current < navProgress.total) {
        e.preventDefault();
        onNavigateNext?.();
      } else if (e.key === 'ArrowLeft' && navProgress.current > 1) {
        e.preventDefault();
        onNavigatePrev?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navProgress?.current, navProgress?.total, isImageOpen, isPositioningImage, isEditing, onNavigateNext, onNavigatePrev]);

  // Cooldown to prevent double-tap or tap-through from immediately triggering image viewer
  const mountTimeRef = useRef(Date.now());
  useEffect(() => {
    mountTimeRef.current = Date.now();
  }, [article?.id]);

  const drawerImageCandidates = useMemo(
    () => getDrawerImageCandidates(article?.imageUrl),
    [article?.imageUrl]
  );

  useEffect(() => {
    setDrawerCandidateIdx(0);
    setLightboxCandidateIdx(0);
  }, [article?.id, article?.imageUrl]);

  const displayImageUrl =
    drawerImageCandidates[drawerCandidateIdx] ||
    drawerImageCandidates[0] ||
    normalizeAnimatedMediaUrl(article?.imageUrl);

  // Without a saved focal point the photo is cropped around an automatically detected
  // subject. Analysed once the preview has loaded (same CORS request, so it's cached).
  const previewFrameRef = useRef(null);
  const [previewLoadedUrl, setPreviewLoadedUrl] = useState(null);
  const hasSavedImagePosition = article?.imagePositionX != null && article?.imagePositionY != null;
  const autoImagePosition = useAutoFocalPoint(
    displayImageUrl,
    previewFrameRef,
    !hasSavedImagePosition && previewLoadedUrl === displayImageUrl
  );

  const isGif = article?.mediaType === 'gif' || (
    typeof article?.imageUrl === 'string' && (
      article.imageUrl.toLowerCase().endsWith('.gif') ||
      article.imageUrl.toLowerCase().includes('.gif?')
    )
  );

  useEffect(() => {
    setIsGifPaused(false);
    setPausedFrameDataUrl(null);
  }, [article?.id, article?.imageUrl]);

  useEffect(() => {
    setIsGeneratingAiImage(false);
    setShowAiImageOptions(false);
    setAiImageCustomPrompt('');
    setAiImageStyle('auto');
    setAiImageEngine('free');
    setLastGeneratedImageCost(null);
    setAiImageError(null);
    try {
      localStorage.removeItem('chronix_ai_image_engine_v1');
    } catch {
      // ignore
    }
  }, [article?.id]);

  const isAdmin = quota?.is_admin === true;
  const [hasCustomApiKey, setHasCustomApiKey] = useState(() => Boolean(getApiKey()));
  useEffect(() => {
    const sync = () => setHasCustomApiKey(Boolean(getApiKey()));
    window.addEventListener('focus', sync);
    window.addEventListener('storage', sync);
    window.addEventListener('chronix-api-key-change', sync);
    return () => {
      window.removeEventListener('focus', sync);
      window.removeEventListener('storage', sync);
      window.removeEventListener('chronix-api-key-change', sync);
    };
  }, []);
  const isPremiumImageFreeKey = !isAdmin && !hasCustomApiKey;
  const imageCreditCost = getCreditCosts(quota).gemini_image;
  const remainingPaidCredits = getRemainingPaidCredits(quota);
  const isGeminiImageBlocked = isPremiumCreditsExhausted(quota, {
    isAdmin,
    hasCustomKey: hasCustomApiKey,
    requiredCredits: imageCreditCost,
  });
  const effectiveAiImageEngine = isGeminiImageBlocked ? 'free' : aiImageEngine;

  const handleSelectAiImageEngine = (nextEngine) => {
    if (nextEngine === 'premium' && isGeminiImageBlocked) return;
    setAiImageEngine(nextEngine);
  };

  const handleGenerateAiImageInDrawer = async () => {
    if (!article?.title && !aiImageCustomPrompt.trim()) return;
    setIsGeneratingAiImage(true);
    setAiImageError(null);
    try {
      const parsedFromYear =
        article?.from?.year !== undefined && article?.from?.year !== null && !isNaN(Number(article.from.year))
          ? parseInt(article.from.year, 10)
          : null;
      const res = await generateEventImage({
        title: article?.title || aiImageCustomPrompt.trim(),
        subtitle: article?.subtitle || '',
        extract: article?.extract || '',
        fromYear: parsedFromYear,
        timelineTopic: timelineTitle || '',
        timeScale: timelineTimeScale || 'calendar',
        locationName: article?.locationName || '',
        isFictional: Boolean(article?.isFictional || isTimelineFictional),
        customPrompt: aiImageCustomPrompt.trim() || undefined,
        style: aiImageStyle || 'auto',
        engine: effectiveAiImageEngine,
        timelineId,
        source: 'event_drawer',
      });
      if (res?.imageUrl) {
        const genCost = Number(res.imageCostUsd ?? res.tokenUsage?.estimatedCostUsd ?? 0);
        const hasGeminiCost = genCost > 0 && isGeminiModel(res.model);
        setLastGeneratedImageCost(hasGeminiCost ? genCost : null);
        setAiImageEngine('free');
        onEventImageGenerated?.(
          article.id,
          res.imageUrl,
          res.imageSource || 'ai',
          res.model || null,
          hasGeminiCost ? genCost : null
        );
      }
      onRefreshQuota?.();
    } catch (err) {
      if (err?.status === 402) onRefreshQuota?.();
      setAiImageError(err?.message || t('eventDrawer.aiImageFailed'));
    } finally {
      setIsGeneratingAiImage(false);
    }
  };

  const toggleGifPlayback = (e) => {
    e.stopPropagation();
    if (isGifPaused) {
      setIsGifPaused(false);
      setPausedFrameDataUrl(null);
    } else {
      try {
        const img = previewImageRef.current;
        if (img && img.naturalWidth && img.naturalHeight) {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const dataUrl = canvas.toDataURL('image/png');
          setPausedFrameDataUrl(dataUrl);
          setIsGifPaused(true);
        } else {
          setIsGifPaused(true);
        }
      } catch {
        setIsGifPaused(true);
      }
    }
  };

  const additionalImages = normalizeAdditionalImages(article?.additionalImages);
  const allImages = [
    displayImageUrl
      ? {
          url: displayImageUrl,
          lightboxCandidates: getLightboxImageCandidates(article?.imageUrl),
          caption: article.title,
          isCover: true
        }
      : null,
    ...additionalImages.map((img, idx) => ({
      additionalIndex: idx,
      ...img,
      url: getDrawerImageUrl(img.url),
      lightboxCandidates: getLightboxImageCandidates(img.url)
    }))
  ].filter(Boolean);
  const previewImageRef = useRef(null);
  const cropDragRef = useRef(null);
  const imagePositionRef = useRef(imagePosition);
  const imageRef = useRef(null);
  const imageViewportRef = useRef(null);
  const imageViewRef = useRef(imageView);
  const activePointersRef = useRef(new Map());
  const gestureRef = useRef(null);
  const suppressBackdropClickRef = useRef(false);

  imageViewRef.current = imageView;
  imagePositionRef.current = imagePosition;

  const handleCropPointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const image = previewImageRef.current;
    if (!image?.naturalWidth || !image?.naturalHeight) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    cropDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      position: imagePositionRef.current,
      moved: false
    };
  };

  const handleCropPointerMove = (event) => {
    const drag = cropDragRef.current;
    const image = previewImageRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !image) return;

    const rect = image.getBoundingClientRect();
    const coverScale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
    const overflowX = Math.max(0, image.naturalWidth * coverScale - rect.width);
    const overflowY = Math.max(0, image.naturalHeight * coverScale - rect.height);
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;

    const next = {
      x: overflowX > 0
        ? Math.max(0, Math.min(100, drag.position.x - dx / overflowX * 100))
        : drag.position.x,
      y: overflowY > 0
        ? Math.max(0, Math.min(100, drag.position.y - dy / overflowY * 100))
        : drag.position.y
    };
    imagePositionRef.current = next;
    setImagePosition(next);
  };

  const handleCropPointerEnd = (event) => {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    cropDragRef.current = null;
    if (drag.moved) onImagePositionChange?.(imagePositionRef.current);
  };

  const clampImageOffset = (x, y, scale) => {
    const image = imageRef.current;
    if (!image || scale <= IMAGE_MIN_SCALE) return { x: 0, y: 0 };

    const maxX = Math.max(0, image.offsetWidth * (scale - 1) / 2);
    const maxY = Math.max(0, image.offsetHeight * (scale - 1) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y))
    };
  };

  const updateImageView = (updater) => {
    setImageView((previous) => {
      const next = typeof updater === 'function' ? updater(previous) : updater;
      imageViewRef.current = next;
      return next;
    });
  };

  const changeImageScale = (requestedScale, focalPoint = null) => {
    updateImageView((previous) => {
      const scale = Math.max(IMAGE_MIN_SCALE, Math.min(IMAGE_MAX_SCALE, requestedScale));
      if (scale === previous.scale) return previous;

      const viewport = imageViewportRef.current?.getBoundingClientRect();
      let x = previous.x * (scale / previous.scale);
      let y = previous.y * (scale / previous.scale);
      if (focalPoint && viewport) {
        const focalX = focalPoint.clientX - (viewport.left + viewport.width / 2);
        const focalY = focalPoint.clientY - (viewport.top + viewport.height / 2);
        x = focalX - (focalX - previous.x) * (scale / previous.scale);
        y = focalY - (focalY - previous.y) * (scale / previous.scale);
      }

      return { scale, ...clampImageOffset(x, y, scale) };
    });
  };

  const openImageViewer = (index = 0) => {
    const safeIndex = typeof index === 'number' && Number.isFinite(index) ? index : 0;
    const maxIdx = Math.max(0, allImages.length - 1);
    const clampedIndex = Math.max(0, Math.min(maxIdx, safeIndex));
    setActiveImageIndex(clampedIndex);
    setLightboxCandidateIdx(0);
    updateImageView({ scale: 1, x: 0, y: 0 });
    setImageLoadFailed(false);
    setIsImageOpen(true);
  };

  const safeHeroIndex = heroIndex > 0 && heroIndex < allImages.length ? heroIndex : 0;
  // null while the frame shows the main image (which keeps its crop, GIF and AI controls).
  const heroExtraImage = safeHeroIndex > 0 ? allImages[safeHeroIndex] : null;
  const heroSlideAt = (index) => (index > 0 && allImages[index]
    ? { url: allImages[index].url, position: '50% 50%' }
    : { url: displayImageUrl, position: `${imagePosition.x}% ${imagePosition.y}%` });
  const stepHero = (delta) => {
    if (allImages.length <= 1) return;
    setHeroUnderlay({ ...heroSlideAt(safeHeroIndex), key: Date.now() });
    setHeroIndex((safeHeroIndex + delta + allImages.length) % allImages.length);
    setIsPositioningImage(false);
  };
  const stepHeroRef = useRef(stepHero);
  stepHeroRef.current = stepHero;
  const setHeroPlayback = (on) => {
    setIsHeroPlaying(on);
    rememberSlideshowAutoplay(on);
  };

  const handlePrevImage = () => {
    if (allImages.length <= 1) return;
    setActiveImageIndex((prev) => {
      const current = typeof prev === 'number' && Number.isFinite(prev) ? prev : 0;
      return current > 0 ? current - 1 : allImages.length - 1;
    });
    setLightboxCandidateIdx(0);
    updateImageView({ scale: 1, x: 0, y: 0 });
    setImageLoadFailed(false);
  };

  const handleNextImage = () => {
    if (allImages.length <= 1) return;
    setActiveImageIndex((prev) => {
      const current = typeof prev === 'number' && Number.isFinite(prev) ? prev : 0;
      return current < allImages.length - 1 ? current + 1 : 0;
    });
    setLightboxCandidateIdx(0);
    updateImageView({ scale: 1, x: 0, y: 0 });
    setImageLoadFailed(false);
  };

  const handleImageWheel = (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.18 : 1 / 1.18;
    changeImageScale(imageViewRef.current.scale * factor, event);
  };

  const handleImagePointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    suppressBackdropClickRef.current = false;

    const pointers = [...activePointersRef.current.values()];
    if (pointers.length === 2) {
      const [first, second] = pointers;
      gestureRef.current = {
        type: 'pinch',
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
        view: imageViewRef.current
      };
    } else {
      gestureRef.current = {
        type: 'pan',
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY
      };
    }
  };

  const handleImagePointerMove = (event) => {
    if (!activePointersRef.current.has(event.pointerId)) return;
    const previousPointer = activePointersRef.current.get(event.pointerId);
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pointers = [...activePointersRef.current.values()];

    if (pointers.length === 2) {
      if (gestureRef.current?.type !== 'pinch') return;
      const [first, second] = pointers;
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const initial = gestureRef.current;
      const scale = Math.max(IMAGE_MIN_SCALE, Math.min(
        IMAGE_MAX_SCALE,
        initial.view.scale * distance / Math.max(initial.distance, 1)
      ));
      const viewport = imageViewportRef.current?.getBoundingClientRect();
      const centerX = viewport ? viewport.left + viewport.width / 2 : 0;
      const centerY = viewport ? viewport.top + viewport.height / 2 : 0;
      const focalX = initial.midpoint.x - centerX;
      const focalY = initial.midpoint.y - centerY;
      const x = focalX - (focalX - initial.view.x) * (scale / initial.view.scale)
        + midpoint.x - initial.midpoint.x;
      const y = focalY - (focalY - initial.view.y) * (scale / initial.view.scale)
        + midpoint.y - initial.midpoint.y;
      suppressBackdropClickRef.current = true;
      updateImageView({ scale, ...clampImageOffset(x, y, scale) });
      return;
    }

    if (gestureRef.current?.type === 'pan') {
      const totalDx = event.clientX - gestureRef.current.startX;
      const totalDy = event.clientY - gestureRef.current.startY;
      if (Math.abs(totalDx) + Math.abs(totalDy) > 5) {
        suppressBackdropClickRef.current = true;
      }
      if (imageViewRef.current.scale > IMAGE_MIN_SCALE) {
        const dx = event.clientX - previousPointer.x;
        const dy = event.clientY - previousPointer.y;
        updateImageView((previous) => ({
          scale: previous.scale,
          ...clampImageOffset(previous.x + dx, previous.y + dy, previous.scale)
        }));
      }
    }
  };

  const handleImagePointerEnd = (event) => {
    const panGesture = gestureRef.current?.type === 'pan' ? gestureRef.current : null;
    activePointersRef.current.delete(event.pointerId);
    const remaining = [...activePointersRef.current.values()];
    gestureRef.current = remaining.length === 1
      ? {
          type: 'pan',
          startX: remaining[0].x,
          startY: remaining[0].y,
          lastX: remaining[0].x,
          lastY: remaining[0].y
        }
      : null;

    // Mobile swipe gestures when image is at 1x default zoom
    if (panGesture && imageViewRef.current.scale <= IMAGE_MIN_SCALE) {
      const dx = event.clientX - panGesture.startX;
      const dy = event.clientY - panGesture.startY;

      // Swipe down to dismiss
      if (dy > 80 && Math.abs(dx) < 80) {
        setIsImageOpen(false);
        return;
      }

      // Horizontal swipe to navigate between images
      if (Math.abs(dx) > 50 && Math.abs(dy) < 80 && allImages.length > 1) {
        if (dx > 0) {
          if (isRtl) handleNextImage(); else handlePrevImage();
        } else {
          if (isRtl) handlePrevImage(); else handleNextImage();
        }
      }
    }
  };

  useEffect(() => {
    if (!isImageOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault(); // handled: closes the photo, not the panel
        setIsImageOpen(false);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (isRtl) {
          handleNextImage();
        } else {
          handlePrevImage();
        }
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (isRtl) {
          handlePrevImage();
        } else {
          handleNextImage();
        }
      } else if (event.key === ' ' && allImages.length > 1) {
        event.preventDefault();
        setIsSlideshowPlaying((playing) => !playing);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isImageOpen, allImages.length, isRtl]);

  // Slideshow: advance after each interval. Keyed on the photo, so stepping manually restarts
  // the countdown; zooming in holds the current photo until it's reset.
  const isSlideshowRunning = isImageOpen && isSlideshowPlaying && allImages.length > 1;
  useEffect(() => {
    if (!isSlideshowRunning || imageView.scale > IMAGE_MIN_SCALE) return undefined;
    const timer = setTimeout(handleNextImage, SLIDESHOW_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [isSlideshowRunning, activeImageIndex, imageView.scale, allImages.length]);

  // Warm the next photo's cache so the slideshow doesn't flash a blank frame.
  useEffect(() => {
    if (!isSlideshowRunning) return;
    const next = allImages[(activeImageIndex + 1) % allImages.length];
    const url = next?.lightboxCandidates?.[0] || next?.url;
    if (url) new Image().src = url;
  }, [isSlideshowRunning, activeImageIndex]);

  useEffect(() => {
    if (!isImageOpen) setIsSlideshowPlaying(false);
  }, [isImageOpen]);

  useEffect(() => {
    setHeroIndex(0);
    setHeroUnderlay(null);
    setIsHeroPlaying(shouldAutoplaySlideshow());
    setIsCollageOpen(false);
  }, [article?.id]);

  // Inline slideshow timer. Keyed on the slide, so stepping by hand restarts the countdown; it
  // holds while the full-screen viewer, the crop tool, the editor or another tab is in use.
  const isHeroSlideshowRunning = isHeroPlaying && allImages.length > 1 && !isImageOpen
    && !isPositioningImage && !isEditing && !isCollageOpen && activeTab === 'details';
  useEffect(() => {
    if (!isHeroSlideshowRunning) return undefined;
    const timer = setTimeout(() => stepHeroRef.current(1), SLIDESHOW_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [isHeroSlideshowRunning, heroIndex, allImages.length]);

  // Warm the next photo's cache so the crossfade never shows a blank frame.
  useEffect(() => {
    if (!isHeroSlideshowRunning) return;
    const next = allImages[(heroIndex + 1) % allImages.length];
    if (next?.url) new Image().src = next.url;
  }, [isHeroSlideshowRunning, heroIndex]);

  // The main image changed (e.g. "Set as main image"): show it.
  useEffect(() => {
    setHeroIndex(0);
  }, [article?.imageUrl]);

  useEffect(() => {
    setIsImageOpen(false);
    setActiveImageIndex(0);
    setImageLoadFailed(false);
    setIsPositioningImage(false);
    updateImageView({ scale: 1, x: 0, y: 0 });
  }, [article?.id, article?.imageUrl, article?.imagePositionX, article?.imagePositionY]);

  useEffect(() => {
    if (cropDragRef.current) return;
    const nextPosition = {
      x: article?.imagePositionX ?? autoImagePosition?.x ?? 50,
      y: article?.imagePositionY ?? autoImagePosition?.y ?? 50
    };
    imagePositionRef.current = nextPosition;
    setImagePosition(nextPosition);
  }, [article?.id, article?.imageUrl, article?.imagePositionX, article?.imagePositionY, autoImagePosition?.x, autoImagePosition?.y]);

  if (!article) return null;

  const laneIndex = lanes.findIndex((l) => l.id === article.lane);
  const laneObj = laneIndex >= 0 ? lanes[laneIndex] : null;
  const timeSpan = localizedTimeSpan(article.from, article.to, article.isToPresent);

  // Topic (`category`) drives color coding, independent of which lane/track an event sits in.
  const categories = getDistinctCategories(articles);
  const themeLabel = (article.category || '').toString().trim();
  const themeColor = themeLabel ? getCategoryColor(themeLabel, categories) : null;
  const showLaneBadge = lanes.length > 1 && Boolean(laneObj);
  const isEdited = Boolean(article.isEdited || article.is_edited || article.isManuallyEdited || article.is_manually_edited);

  // Content direction follows the language of the text itself; the interface
  // direction (isRtl) is only a fallback for directionally neutral text.
  const hasRtl = (str) => /[\u0590-\u05FF\u0600-\u06FF]/.test(str || '');
  const isTitleRtl = areTextsRtl([article.title, article.subtitle], isRtl);
  const titleDir = isTitleRtl ? 'rtl' : 'ltr';
  const laneDir = getTextDir(laneObj?.title || '', isRtl);
  const themeDir = getTextDir(themeLabel, isRtl);
  const extractDir = getTextDir(article.extract || '', isTitleRtl);

  const sourceUrl = article.sourceUrl || article.wikiUrl || '';
  const isWikiUrl = Boolean(sourceUrl && sourceUrl.toLowerCase().includes('wikipedia.org'));
  const sourceName = article.sourceName || (isWikiUrl ? 'Wikipedia' : (sourceUrl ? 'Web' : null));
  const isWiki = Boolean((sourceName && sourceName.toLowerCase().includes('wiki')) || isWikiUrl);

  const displayWikiTitle = article.wikiTitle || (() => {
    if (!sourceUrl || !isWikiUrl) return '';
    try {
      const parts = sourceUrl.split('/wiki/');
      if (parts[1]) {
        return decodeURIComponent(parts[1]).replace(/_/g, ' ');
      }
    } catch {
      // ignore
    }
    return article.title || '';
  })();

  const hasWikiEmbed = isWikiUrl && Boolean(toEmbeddableWikiUrl(sourceUrl));
  const placeLink = linksOfKind(article, 'place')[0] || null;
  const historyLinks = linksOfKind(article, 'event');
  const contextLinks = placeLink ? [placeLink, ...historyLinks] : historyLinks;
  // The event's own article wins, unless the user opened one of its context links.
  const chosenLink = (wikiChoice && isSameArticleId(wikiChoice.articleId, article.id)
    ? contextLinks.find((l) => l.url === wikiChoice.url)
    : null) || (hasWikiEmbed ? null : contextLinks[0] || null);
  const wikiPanel = chosenLink
    ? { url: chosenLink.url, title: chosenLink.title, description: chosenLink.description || '', link: chosenLink }
    : (hasWikiEmbed ? { url: sourceUrl, title: displayWikiTitle, description: '', link: null } : null);
  const openContextLink = (link) => {
    setWikiChoice({ articleId: article.id, url: link.url });
    selectTab('wiki');
  };
  const coverIllustration = illustrativeCover(article);
  const currentTab = isEditing || (activeTab === 'wiki' && !wikiPanel) ? 'details' : activeTab;
  const isTabMounted = (tab) => currentTab === tab
    || (visitedTabs.articleId === article.id && visitedTabs.tabs.includes(tab));
  const { query: builtVideoQuery, context: videoContext } = buildEventVideoQuery(article, {
    displayWikiTitle,
    timelineTitle,
    timelineTags,
    articles,
  });
  const videoQuery = isTimelinePersonal && !isWikiUrl ? '' : builtVideoQuery;
  const videoLang = (isWikiUrl && getWikiLang(sourceUrl)) || language;
  const savedVideos = article.videosQuery === videoQuery ? sanitizeVideos(article.videos) : null;
  const tabs = [
    { id: 'details', label: t('eventDrawer.tabDetails'), Icon: FileText },
    ...(wikiPanel ? [{ id: 'wiki', label: t('eventDrawer.tabWikipedia'), Icon: BookOpen }] : []),
    ...(videoQuery ? [{ id: 'videos', label: t('eventDrawer.tabVideos'), Icon: Film }] : []),
  ];
  const selectTab = (tab) => {
    setActiveTab(tab);
    setVisitedTabs((prev) => {
      const previous = prev.articleId === article.id ? prev.tabs : [];
      return { articleId: article.id, tabs: previous.includes(tab) ? previous : [...previous, tab] };
    });
  };

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isMobile && (
        <div
          className={`fixed inset-0 bg-black/60 backdrop-blur-xs z-40 transition-opacity duration-250 ease-out ${
            isClosing ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'
          }`}
          onClick={handleAnimatedClose}
        />
      )}
      <div
        ref={drawerRef}
        className={`chronix-side-drawer ${
          isMobile
            ? 'fixed inset-x-0 bottom-0 w-full h-[86vh] max-h-[90vh] rounded-t-3xl border-t'
            : 'absolute inset-y-0 left-[calc(52px+env(safe-area-inset-left,0px))] right-auto w-[340px] md:w-[380px] lg:w-[440px] max-w-[calc(100vw-56px-env(safe-area-inset-left,0px))] h-full max-h-full rounded-none border-r'
        } bg-surface-overlay border-line shadow-panel flex flex-col ${
          liveWidth != null ? 'select-none [&_iframe]:pointer-events-none' : 'transition-all duration-300 ease-in-out'
        } font-sans z-50 ${
          isClosing
            ? (isMobile ? 'translate-y-full opacity-0 pointer-events-none' : '-translate-x-full opacity-0 pointer-events-none')
            : (isMobile ? 'translate-y-0 opacity-100' : 'translate-x-0 opacity-100')
        } ${
          isRtl ? 'text-right' : 'text-left'
        }`}
        style={isMobile ? undefined : {
          ...style,
          ...(canResize && (liveWidth ?? width) ? { width: liveWidth ?? clampEventDrawerWidth(width) } : {}),
        }}
        dir={isRtl ? 'rtl' : 'ltr'}
        onTouchStart={canSwipeNavigate ? handleSwipeNavStart : undefined}
        onTouchEnd={canSwipeNavigate ? handleSwipeNavEnd : undefined}
        onTouchCancel={canSwipeNavigate ? handleSwipeNavCancel : undefined}
      >
        {canResize && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('eventDrawer.resize')}
            title={t('eventDrawer.resize')}
            tabIndex={0}
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerEnd}
            onPointerCancel={handleResizePointerEnd}
            onDoubleClick={() => onWidthChange(null)}
            onKeyDown={handleResizeKeyDown}
            style={{ touchAction: 'none' }}
            className="group/resize absolute top-0 bottom-0 -right-1.5 w-3 z-20 flex items-center justify-center cursor-col-resize focus-visible:outline-none"
          >
            <span
              className={`h-full w-0.5 transition-colors ${
                liveWidth != null ? 'bg-ink-subtle' : 'bg-transparent group-hover/resize:bg-line-strong group-focus-visible/resize:bg-ink-subtle'
              }`}
            />
            <span
              className={`absolute top-1/2 -translate-y-1/2 h-10 w-1.5 rounded-full border border-line bg-surface-raised shadow-control transition-opacity ${
                liveWidth != null ? 'opacity-100' : 'opacity-0 group-hover/resize:opacity-100 group-focus-visible/resize:opacity-100'
              }`}
            />
          </div>
        )}
        {/* Mobile Native Drag Handle */}
        {isMobile && (
          <div
            className="w-full flex flex-col items-center pt-3 pb-1 cursor-grab active:cursor-grabbing shrink-0 touch-none select-none"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div className="w-10 h-1 rounded-full bg-line-strong" />
          </div>
        )}
      {/* Editorial Header */}
      <div
        className="flex items-center justify-between px-5 py-4 border-b border-line bg-surface-overlay/85 backdrop-blur-md shrink-0 select-none"
        onTouchStart={isMobile ? handleTouchStart : undefined}
        onTouchEnd={isMobile ? handleTouchEnd : undefined}
      >
        <div className="flex items-center gap-2 min-w-0">
          {panelNav && (
            <>
              <PanelNavButtons nav={panelNav} className="-ms-2" />
              <span className="w-px h-5 bg-line shrink-0" aria-hidden="true" />
            </>
          )}
          {isEditing ? (
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent-soft text-accent border border-accent/30 text-caption font-semibold truncate">
              {isNew ? <Plus className="w-3 h-3 shrink-0" /> : <Pencil className="w-3 h-3 shrink-0" />}
              <span className="truncate">{isNew ? t('eventEditor.newEvent') : t('eventEditor.editingEvent')}</span>
            </span>
          ) : (
          <div className="flex items-center gap-2 truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-ink-faint shrink-0" />
            <span className="text-caption font-semibold uppercase tracking-wider text-ink-subtle truncate">
              {themeLabel ? `${themeLabel} • ` : ''}{t('eventDrawer.title')}
            </span>
            {isEdited && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-soft text-accent text-caption font-medium border border-accent/30 shrink-0"
                title={article.editedAt ? (t('eventDrawer.manuallyEditedDate', { date: new Date(article.editedAt).toLocaleDateString() }) || t('eventDrawer.manuallyEditedTooltip')) : t('eventDrawer.manuallyEditedTooltip')}
              >
                <Pencil className="w-2.5 h-2.5 shrink-0" />
                <span>{t('eventDrawer.manuallyEdited')}</span>
              </span>
            )}
          </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isEditing && onToggleStar && (
          <button
            type="button"
            onClick={() => onToggleStar(article.id)}
            className={`min-w-[40px] min-h-[40px] flex items-center justify-center p-2 rounded-full transition-all cursor-pointer active:scale-95 touch-manipulation ${
              isStarred
                ? 'text-star bg-star/15 ring-1 ring-star/40'
                : 'text-ink-subtle hover:text-star hover:bg-surface-hover'
            }`}
            title={isStarred ? t('eventDrawer.unstarEvent') : t('eventDrawer.starEvent')}
            aria-label={isStarred ? t('eventDrawer.unstarEvent') : t('eventDrawer.starEvent')}
          >
            <Star className={`w-4 h-4 ${isStarred ? 'fill-star text-star' : ''}`} />
          </button>
          )}
          <button
            type="button"
            onClick={handleAnimatedClose}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center p-2 text-ink-subtle hover:text-ink hover:bg-surface-hover rounded-full transition-all cursor-pointer active:scale-95 touch-manipulation"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Prev/Next event navigation strip (sequential stepping through visible events) */}
      {navProgress && !isEditing && (
        <div
          dir="ltr"
          className="flex items-center justify-between gap-2 px-3 py-1 border-b border-line select-none"
        >
          <button
            type="button"
            onClick={onNavigatePrev}
            disabled={navProgress.current <= 1}
            title={`${t('explore.prev')} (←)`}
            aria-label={t('explore.prev')}
            className="flex items-center gap-1 h-9 ps-2 pe-3 rounded-full text-sm font-medium text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors duration-150 cursor-pointer disabled:opacity-30 disabled:cursor-default"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>{t('explore.prev')}</span>
          </button>

          <div className="text-sm text-ink-subtle">
            <span className="tabular-nums">
              {`${navProgress.current} / ${navProgress.total}`}
            </span>
          </div>

          <button
            type="button"
            onClick={onNavigateNext}
            disabled={navProgress.current >= navProgress.total}
            title={`${t('explore.next')} (→)`}
            aria-label={t('explore.next')}
            className="flex items-center gap-1 h-9 ps-3 pe-2 rounded-full text-sm font-medium text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors duration-150 cursor-pointer disabled:opacity-30 disabled:cursor-default"
          >
            <span>{t('explore.next')}</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {tabs.length > 1 && !isEditing && (
        <div role="tablist" className="flex items-stretch gap-1 px-3 border-b border-line shrink-0 select-none">
          {tabs.map(({ id, label, Icon }) => {
            const isActive = currentTab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => selectTab(id)}
                className={`flex-1 flex items-center justify-center gap-2 px-2 py-3 -mb-px border-b-2 text-xs font-semibold transition-colors cursor-pointer ${
                  isActive ? 'border-ink text-ink' : 'border-transparent text-ink-subtle hover:text-ink'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>
      )}

      {wikiPanel && isTabMounted('wiki') && (
        <div role="tabpanel" className={currentTab === 'wiki' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
          <WikipediaPanel
            key={wikiPanel.url}
            url={wikiPanel.url}
            title={wikiPanel.title}
            description={wikiPanel.description}
            action={wikiPanel.link && !readOnly && onDismissContextLink ? (
              <button
                type="button"
                onClick={() => {
                  const isPlace = wikiPanel.link.kind === 'place';
                  onDismissContextLink(wikiPanel.url, isPlace ? null : article.id);
                  setWikiChoice(null);
                  selectTab('details');
                }}
                className="shrink-0 text-caption font-medium text-ink-subtle hover:text-danger underline-offset-2 hover:underline cursor-pointer"
                title={t(wikiPanel.link.kind === 'place' ? 'eventDrawer.notThisPlaceTooltip' : 'eventDrawer.notRelatedTooltip')}
              >
                {t(wikiPanel.link.kind === 'place' ? 'eventDrawer.notThisPlace' : 'eventDrawer.notRelated')}
              </button>
            ) : null}
          />
        </div>
      )}

      {videoQuery && isTabMounted('videos') && (
        <div role="tabpanel" className={currentTab === 'videos' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
          <VideosPanel
            key={`${videoLang}|${videoQuery}`}
            query={videoQuery}
            lang={videoLang}
            context={videoContext}
            savedVideos={savedVideos}
            onVideosFound={!readOnly && onVideosFound ? (items) => onVideosFound(article.id, videoQuery, items) : undefined}
          />
        </div>
      )}

      {isEditing && (
        <InlineEventEditor
          key={`${isNew ? 'new' : article.id}-${editSession}`}
          initialEvent={isNew ? null : article}
          isNew={isNew}
          lanes={lanes}
          articles={articles}
          timelineTitle={timelineTitle}
          timeScale={timelineTimeScale}
          timelineId={timelineId}
          isTimelineFictional={isTimelineFictional}
          quota={quota}
          onRefreshQuota={onRefreshQuota}
          isMobile={isMobile}
          onDirtyChange={handleEditorDirtyChange}
          onCancel={() => {
            if (isNew) {
              editDirtyRef.current = false;
              onEditDirtyChange?.(false);
              onClose?.();
            } else {
              stopEditing();
            }
          }}
          onSave={(saved) => {
            editDirtyRef.current = false;
            onEditDirtyChange?.(false);
            onSaveEdit(saved);
            if (!isNew) setIsEditing(false);
          }}
        />
      )}

      {/* Content scroll area */}
      <div
        key={article.id}
        role="tabpanel"
        className={`flex-1 overflow-y-auto px-5 py-5 space-y-5 text-ink overscroll-contain selection:bg-accent/20 animate-in fade-in duration-200 ${
          currentTab === 'details' && !isEditing ? '' : 'hidden'
        }`}
      >
        {/* Magazine Media Frame */}
        {article.imageUrl ? (
          <div className="relative w-full group/media">
            <div
              ref={previewFrameRef}
              className={`relative w-full aspect-[16/10] max-h-[280px] event-drawer-media rounded-xl overflow-hidden bg-surface-sunken border border-line group shadow-card ${
                !isPositioningImage ? 'cursor-pointer' : ''
              }`}
              onClick={!isPositioningImage ? (e) => {
                // Cooldown: prevent accidental tap-through when drawer just opened
                if (Date.now() - mountTimeRef.current < 450) {
                  e.stopPropagation();
                  return;
                }
                openImageViewer(safeHeroIndex);
              } : undefined}
            >
              {heroUnderlay?.url && (
                <img
                  key={heroUnderlay.key}
                  src={heroUnderlay.url}
                  alt=""
                  aria-hidden="true"
                  draggable="false"
                  className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none bg-white"
                  style={{ objectPosition: heroUnderlay.position }}
                />
              )}
              {heroExtraImage ? (
                <img
                  key={`extra-${safeHeroIndex}`}
                  src={heroExtraImage.url}
                  alt={heroExtraImage.caption || article.title}
                  draggable="false"
                  className={`relative w-full h-full object-cover select-none pointer-events-none bg-white transition-transform duration-500 ease-out group-hover:scale-102 ${heroUnderlay ? 'animate-fade-in' : ''}`}
                  style={heroUnderlay ? { animationDuration: '700ms', animationTimingFunction: 'ease-in-out' } : undefined}
                  onAnimationEnd={() => setHeroUnderlay(null)}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              ) : (
              <img
                key="cover"
                ref={previewImageRef}
                crossOrigin="anonymous"
                src={isGifPaused && pausedFrameDataUrl ? pausedFrameDataUrl : displayImageUrl}
                alt={article.title}
                draggable="false"
                className={`relative w-full h-full object-cover select-none pointer-events-none bg-white ${
                  isPositioningImage ? 'transition-none' : 'transition-[transform,object-position] duration-500 ease-out group-hover:scale-102'
                } ${heroUnderlay ? 'animate-fade-in' : ''}`}
                style={{
                  objectPosition: `${imagePosition.x}% ${imagePosition.y}%`,
                  ...(heroUnderlay ? { animationDuration: '700ms', animationTimingFunction: 'ease-in-out' } : {}),
                }}
                onAnimationEnd={() => setHeroUnderlay(null)}
                onLoad={(e) => {
                  if (!e.currentTarget.src.startsWith('data:')) setPreviewLoadedUrl(displayImageUrl);
                }}
                onError={(e) => {
                  if (drawerCandidateIdx + 1 < drawerImageCandidates.length) {
                    setDrawerCandidateIdx((idx) => idx + 1);
                  } else {
                    e.currentTarget.style.display = 'none';
                  }
                }}
              />
              )}

              {/* Browse the event's photos in place */}
              {allImages.length > 1 && !isPositioningImage && (
                <>
                  {[-1, 1].map((delta) => {
                    // Visual left steps back in LTR and forward in RTL.
                    const isLeft = (delta === -1) !== isRtl;
                    return (
                      <button
                        key={delta}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          stepHero(delta);
                        }}
                        className={`absolute top-1/2 -translate-y-1/2 ${isLeft ? 'left-2' : 'right-2'} z-10 flex items-center justify-center w-8 h-8 rounded-full bg-black/55 hover:bg-black/80 backdrop-blur-md text-white border border-white/20 shadow-pop transition-all cursor-pointer opacity-90 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100`}
                        title={t(delta === -1 ? 'eventDrawer.prevImage' : 'eventDrawer.nextImage')}
                        aria-label={t(delta === -1 ? 'eventDrawer.prevImage' : 'eventDrawer.nextImage')}
                        data-testid={delta === -1 ? 'event-hero-prev' : 'event-hero-next'}
                      >
                        {isLeft ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                    );
                  })}
                  <span className="absolute bottom-2.5 start-2.5 z-10 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-white/90 text-caption font-semibold tabular-nums border border-white/15 pointer-events-none">
                    {t('eventDrawer.imageCounter', { current: safeHeroIndex + 1, total: allImages.length })}
                  </span>
                  {isHeroSlideshowRunning && (
                    <div className="absolute z-10 bottom-0 inset-x-0 h-1 bg-black/25 pointer-events-none" data-testid="event-hero-slideshow-progress">
                      <div
                        key={safeHeroIndex}
                        className={`h-full bg-white/85 animate-slideshow-progress ${isRtl ? 'origin-right' : 'origin-left'}`}
                        style={{ animationDuration: `${SLIDESHOW_INTERVAL_MS}ms` }}
                      />
                    </div>
                  )}
                </>
              )}

              {/* Promote the photo on screen to the event's main image */}
              {heroExtraImage && typeof heroExtraImage.additionalIndex === 'number' && !readOnly && onSetCoverImage && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetCoverImage(heroExtraImage.additionalIndex);
                    setHeroIndex(0);
                  }}
                  className="absolute top-2.5 end-2.5 z-10 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-black/65 hover:bg-black/85 backdrop-blur-md text-white text-caption font-medium border border-white/20 shadow-pop transition-colors cursor-pointer"
                  title={t('eventDrawer.setAsCover')}
                  data-testid="event-hero-set-main"
                >
                  <Star className="w-3 h-3 text-warning shrink-0" />
                  <span>{t('eventDrawer.setAsCover')}</span>
                </button>
              )}

              {/* Adjust Image Crop / Position Button (always clean & unobstructed at top-start) */}
              {!readOnly && onImagePositionChange && !heroExtraImage && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsPositioningImage((value) => !value);
                  }}
                  className={`absolute top-2.5 start-2.5 flex items-center justify-center rounded-full border transition-all cursor-pointer backdrop-blur-md shadow-pop z-10 ${
                    isPositioningImage
                      ? 'px-3 py-1 h-8 bg-accent text-accent-fg border-accent font-medium text-xs gap-2 shadow-md'
                      : 'w-8 h-8 bg-black/65 text-white border-white/20 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/85'
                  }`}
                  title={isPositioningImage ? t('common.confirm') : t('eventDrawer.adjustImagePosition')}
                  aria-label={isPositioningImage ? t('common.confirm') : t('eventDrawer.adjustImagePosition')}
                  aria-pressed={isPositioningImage}
                >
                  {isPositioningImage ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>{t('common.confirm') || 'Done'}</span>
                    </>
                  ) : (
                    <Move className="w-3.5 h-3.5" />
                  )}
                </button>
              )}

              {/* Illustrative picture of the place (Wikimedia Commons), not the family's own photo */}
              {coverIllustration && !heroExtraImage && (
                <a
                  href={coverIllustration.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="absolute top-2.5 end-2.5 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-white/90 hover:text-white text-caption font-medium border border-white/15"
                  title={t('eventDrawer.illustrativeTooltip', { place: coverIllustration.place || '' })}
                >
                  <ImageIcon className="w-2.5 h-2.5 shrink-0" />
                  <span>{t('eventDrawer.illustrativeBadge')}</span>
                </a>
              )}

              {/* AI-Generated Image Badge */}
              {article.imageSource === 'ai' && !heroExtraImage && (
                <span className="absolute top-2.5 end-2.5 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-white/90 text-caption font-medium border border-white/15 pointer-events-none">
                  <Sparkles className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                  <span>
                    {(() => {
                      const effectiveCost = Number(article.imageCostUsd ?? lastGeneratedImageCost ?? 0);
                      const hasCost = effectiveCost > 0 && isGeminiModel(article.imageModel);
                      if (article.imageModel && hasCost) {
                        return t('eventDrawer.aiImageBadgeWithCost', {
                          model: formatAiModelName(article.imageModel),
                          cost: formatUsdDigits(effectiveCost),
                        });
                      }
                      if (article.imageModel) {
                        return t('eventDrawer.aiImageBadgeWithModel', { model: formatAiModelName(article.imageModel) });
                      }
                      return t('eventDrawer.aiImageBadge');
                    })()}
                  </span>
                </span>
              )}

              {/* Positioning interactive drag overlay */}
              {isPositioningImage ? (
                <div
                  className="absolute inset-0 touch-none cursor-move bg-black/20 backdrop-blur-[1px]"
                  role="application"
                  aria-label={t('eventDrawer.dragImageToPosition')}
                  onPointerDown={handleCropPointerDown}
                  onPointerMove={handleCropPointerMove}
                  onPointerUp={handleCropPointerEnd}
                  onPointerCancel={handleCropPointerEnd}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="absolute left-1/2 bottom-3 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/75 backdrop-blur-md px-3 py-2 text-caption font-semibold text-white pointer-events-none shadow-pop border border-white/20">
                    {t('eventDrawer.dragImageToPosition')}
                  </span>
                </div>
              ) : (
                /* Bottom Action Bar: Play/Pause for motion GIFs and View Full Image */
                <div className="absolute bottom-2.5 end-2.5 flex items-center gap-2 z-10">
                  {allImages.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setHeroPlayback(!isHeroPlaying);
                      }}
                      aria-pressed={isHeroPlaying}
                      className="flex items-center justify-center w-7 h-7 rounded-full bg-black/65 hover:bg-black/85 backdrop-blur-md text-white border border-white/20 shadow-pop transition-all cursor-pointer opacity-90 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
                      title={t(isHeroPlaying ? 'eventDrawer.pauseSlideshow' : 'eventDrawer.playSlideshow')}
                      aria-label={t(isHeroPlaying ? 'eventDrawer.pauseSlideshow' : 'eventDrawer.playSlideshow')}
                      data-testid="event-hero-slideshow"
                    >
                      {isHeroPlaying
                        ? <Pause className="w-3 h-3 fill-current" />
                        : <Play className="w-3 h-3 fill-current translate-x-[0.5px]" />}
                    </button>
                  )}
                  {isGif && !heroExtraImage && (
                    <button
                      type="button"
                      onClick={toggleGifPlayback}
                      className="flex items-center justify-center w-7 h-7 rounded-full bg-black/65 hover:bg-black/85 backdrop-blur-md text-white border border-white/20 shadow-pop transition-all cursor-pointer opacity-90 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
                      title={isGifPaused ? (t('eventDrawer.playMotion') || 'Play') : (t('eventDrawer.pauseMotion') || 'Pause')}
                      aria-label={isGifPaused ? (t('eventDrawer.playMotion') || 'Play') : (t('eventDrawer.pauseMotion') || 'Pause')}
                    >
                      {isGifPaused ? <Play className="w-3 h-3 fill-white translate-x-[0.5px]" /> : <Pause className="w-3 h-3 fill-white" />}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openImageViewer(safeHeroIndex);
                    }}
                    className="flex items-center gap-2 px-3 py-2 rounded-full bg-black/65 backdrop-blur-md text-white text-caption font-medium border border-white/20 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/85 transition-all shadow-pop cursor-pointer"
                    title={t('eventDrawer.viewFullImage')}
                    aria-label={`${t('eventDrawer.viewFullImage')}: ${article.title}`}
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>{t('eventDrawer.viewFullImage')}</span>
                  </button>
                </div>
              )}
            </div>
            {article.imageSource === 'ai' && Number(lastGeneratedImageCost) > 0 && isGeminiModel(article.imageModel) && (
              <p className="mt-2 text-caption text-ink-muted flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-accent shrink-0" />
                <span>{t('eventDrawer.aiImageCostNotice', { cost: formatUsdDigits(lastGeneratedImageCost) })}</span>
              </p>
            )}
          </div>
        ) : !readOnly && onEventImageGenerated && isAiImageEventDrawerEnabled() ? (
          <div className="rounded-xl border border-dashed border-line bg-surface-sunken/70 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-accent-soft text-accent flex items-center justify-center shrink-0">
                  <ImageIcon className="w-3.5 h-3.5" />
                </div>
                <span className={`text-xs text-ink-muted truncate ${isTimelinePersonal && (onEdit || canEditInPlace) ? 'sr-only' : ''}`}>
                  {t(isTimelinePersonal ? 'eventDrawer.personalAddPhotoHint' : 'eventDrawer.generateAiImageHint')}
                </span>
              </div>
              {/* A real family moment: invite a real photo first; an AI illustration stays available. */}
              {isTimelinePersonal && (onEdit || canEditInPlace) && (
                <button
                  type="button"
                  onClick={() => (canEditInPlace ? startEditing() : onEdit?.(article))}
                  className="theme-memory flex items-center gap-2 px-3 py-2 rounded-control border border-accent/40 bg-accent-soft/60 text-xs font-semibold text-accent hover:bg-accent-soft transition-colors shadow-control shrink-0 cursor-pointer"
                >
                  <ImageIcon className="w-3.5 h-3.5 shrink-0" />
                  <span>{t('eventDrawer.addPhoto')}</span>
                </button>
              )}
              <div className={`inline-flex items-stretch rounded-control border shadow-control shrink-0 overflow-hidden ${isTimelinePersonal ? 'border-line bg-surface-raised [&_button]:text-ink-muted' : 'border-accent/40 bg-accent-soft/60'}`}>
                <button
                  type="button"
                  onClick={handleGenerateAiImageInDrawer}
                  disabled={isGeneratingAiImage}
                  className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent-soft transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isGeneratingAiImage ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>
                    {isGeneratingAiImage
                      ? t('eventDrawer.generatingAiImage')
                      : t('eventDrawer.generateAiImage')}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowAiImageOptions((v) => !v)}
                  disabled={isGeneratingAiImage}
                  title={t('eventEditModal.aiImageStyleLabel')}
                  aria-expanded={showAiImageOptions}
                  className="px-2 border-s border-accent/25 text-accent hover:bg-accent-soft transition-colors cursor-pointer flex items-center justify-center"
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAiImageOptions ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>

            {showAiImageOptions && (
              <div className="pt-2 border-t border-line/60 space-y-2 animate-in fade-in duration-150">
                <input
                  type="text"
                  value={aiImageCustomPrompt}
                  onChange={(e) => setAiImageCustomPrompt(e.target.value)}
                  placeholder={t('eventDrawer.aiImagePromptPlaceholder')}
                  disabled={isGeneratingAiImage}
                  className="w-full bg-surface-raised border border-line rounded-control px-3 py-2 text-ink placeholder-ink-faint outline-none focus:border-accent text-xs shadow-control"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-caption font-medium text-ink-muted me-1">
                    {t('eventEditModal.aiImageEngineLabel')}:
                  </span>
                  <button
                    type="button"
                    onClick={() => handleSelectAiImageEngine('free')}
                    disabled={isGeneratingAiImage}
                    title={t('eventEditModal.aiImageEngineFreeHint')}
                    className={`inline-flex items-center gap-1 px-3 py-0.5 rounded-full text-caption font-medium border transition-colors cursor-pointer ${
                      effectiveAiImageEngine === 'free'
                        ? 'bg-accent text-accent-fg border-accent'
                        : 'bg-surface-raised text-ink-muted border-line hover:text-ink'
                    }`}
                  >
                    <Zap className="w-3 h-3 shrink-0" />
                    <span>{t('eventEditModal.aiImageEngineFree')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectAiImageEngine('premium')}
                    disabled={isGeneratingAiImage || isGeminiImageBlocked}
                    title={
                      isGeminiImageBlocked
                        ? remainingPaidCredits > 0
                          ? t('eventEditModal.aiImageEngineInsufficientCreditsHint', {
                              credits: imageCreditCost,
                              remaining: remainingPaidCredits,
                            })
                          : t('eventEditModal.aiImageEngineQuotaExhaustedHint')
                        : isPremiumImageFreeKey
                          ? t('eventEditModal.aiImageEnginePremiumCreditHint', { credits: imageCreditCost })
                          : t('eventEditModal.aiImageEnginePremiumHint')
                    }
                    className={`inline-flex items-center gap-1 px-3 py-0.5 rounded-full text-caption font-medium border transition-colors ${
                      isGeminiImageBlocked
                        ? 'bg-surface-raised text-ink-subtle border-line opacity-50 cursor-not-allowed'
                        : effectiveAiImageEngine === 'premium'
                          ? 'bg-accent text-accent-fg border-accent cursor-pointer'
                          : 'bg-surface-raised text-ink-muted border-line hover:text-ink cursor-pointer'
                    }`}
                  >
                    {isGeminiImageBlocked ? (
                      <Lock className="w-3 h-3 text-amber-500 shrink-0" />
                    ) : (
                      <Sparkles className="w-3 h-3 shrink-0" />
                    )}
                    <span>
                      {t('eventEditModal.aiImageEnginePremium')}
                      {isPremiumImageFreeKey ? ` · ${imageCreditCost}` : ''}
                    </span>
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-caption font-medium text-ink-muted me-1">
                    {t('eventEditModal.aiImageStyleLabel')}:
                  </span>
                  {['auto', 'historical', 'illustration', 'painting', 'cinematic'].map((styleKey) => (
                    <button
                      key={styleKey}
                      type="button"
                      onClick={() => setAiImageStyle(styleKey)}
                      disabled={isGeneratingAiImage}
                      className={`px-2 py-0.5 rounded-full text-caption font-medium border transition-colors cursor-pointer ${
                        aiImageStyle === styleKey
                          ? 'bg-accent text-accent-fg border-accent'
                          : 'bg-surface-raised text-ink-muted border-line hover:text-ink'
                      }`}
                    >
                      {t(`eventEditModal.aiImageStyles.${styleKey}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {aiImageError && (
              <p className="text-xs text-danger">{aiImageError}</p>
            )}
          </div>
        ) : null}

        {/* Title and Subtitle with Editorial Typography */}
        <div
          dir={titleDir}
          className={`space-y-2 ${isTitleRtl ? 'text-right' : 'text-left'}`}
        >
          <h2 className="event-drawer-title text-xl sm:text-2xl font-semibold font-serif text-ink tracking-tight leading-snug break-words">
            {containsMath(article.title)
              ? <MathMarkdown content={article.title} inline />
              : article.title}
          </h2>
          {article.subtitle && (
            <MathMarkdown
              content={article.subtitle}
              className="text-sm font-normal text-ink-muted leading-relaxed font-sans"
            />
          )}
        </div>

        {/* Stylized Category Chips & Metadata Badges */}
        {(timeSpan || themeLabel || showLaneBadge || isEdited || article.locationName || (article.lat != null && article.lng != null)) && (
          <div className="space-y-3">
            {/* Chips row */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {/* Date chip */}
              {timeSpan && (
                <span className="inline-flex items-center gap-2 font-medium text-ink bg-surface-hover border border-line px-3 py-1 rounded-full">
                  <Calendar className="w-3.5 h-3.5 shrink-0 text-ink-subtle" />
                  <span className="tabular-nums">{timeSpan}</span>
                </span>
              )}

              {/* Topic chip */}
              {themeLabel && (
                <span className="inline-flex items-center gap-2 max-w-full font-medium text-ink bg-surface-raised border border-line px-3 py-1 rounded-2xl">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/10 dark:ring-white/20"
                    style={{ backgroundColor: themeColor }}
                  />
                  <span dir={themeDir} className="min-w-0 break-words leading-snug">
                    {themeLabel}
                  </span>
                </span>
              )}

              {/* Lane chip */}
              {showLaneBadge && (
                <span className="inline-flex items-center gap-2 max-w-full font-medium text-ink-muted bg-surface-raised border border-line px-3 py-1 rounded-2xl">
                  <Layers className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                  <span dir={laneDir} className="min-w-0 break-words leading-snug">
                    {laneObj.title}
                  </span>
                </span>
              )}

              {/* Manually Edited chip */}
              {isEdited && (
                <span
                  className="inline-flex items-center gap-2 font-medium text-ink-muted bg-surface-raised border border-line px-3 py-1 rounded-full shadow-2xs transition-colors hover:text-ink hover:border-line-strong cursor-default"
                  title={article.editedAt ? (t('eventDrawer.manuallyEditedDate', { date: new Date(article.editedAt).toLocaleDateString() }) || t('eventDrawer.manuallyEditedTooltip')) : t('eventDrawer.manuallyEditedTooltip')}
                >
                  <Pencil className="w-3.5 h-3.5 text-accent shrink-0" />
                  <span>{t('eventDrawer.manuallyEdited')}</span>
                </span>
              )}
            </div>

            {/* Location row */}
            {(article.locationName || (article.lat != null && article.lng != null)) ? (
              <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-surface-hover/40 border border-line text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <MapPin className="w-3.5 h-3.5 text-danger shrink-0" />
                  <span
                    dir={getTextDir(article.locationName || '', isRtl)}
                    className="leading-snug break-words min-w-0 font-medium text-ink"
                    title={article.lat != null && article.lng != null && !isNaN(Number(article.lat)) && !isNaN(Number(article.lng))
                      ? `${Number(article.lat).toFixed(2)}°, ${Number(article.lng).toFixed(2)}°`
                      : undefined}
                  >
                    {article.locationName || `${Number(article.lat).toFixed(2)}°, ${Number(article.lng).toFixed(2)}°`}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {placeLink && (
                    <button
                      type="button"
                      onClick={() => openContextLink(placeLink)}
                      className="flex items-center gap-1 px-3 py-1 rounded-full border border-line bg-surface-raised text-ink hover:bg-surface-hover font-medium text-caption shadow-2xs transition-all active:scale-95 cursor-pointer max-w-[11rem]"
                      title={placeLink.description || placeLink.title}
                    >
                      <BookOpen className="w-3 h-3 shrink-0" />
                      <span className="truncate" dir="auto">{t('eventDrawer.aboutPlace', { place: placeLink.name || placeLink.title })}</span>
                    </button>
                  )}
                  {onShowOnMap && article.lat != null && article.lng != null && !isNaN(Number(article.lat)) && !isNaN(Number(article.lng)) && (
                    <button
                      type="button"
                      onClick={() => onShowOnMap(article)}
                      className="flex items-center gap-1 px-3 py-1 rounded-full bg-accent text-accent-fg hover:bg-accent-hover font-medium text-caption shadow-2xs transition-all active:scale-95 cursor-pointer"
                      title={t('eventDrawer.showOnMapTooltip') || 'הצג במפת ChroniX'}
                    >
                      <MapIcon className="w-3 h-3 shrink-0" />
                      <span>{t('eventDrawer.showOnMap') || 'הצג במפה'}</span>
                    </button>
                  )}
                  {article.googleMapsUrl && (
                    <a
                      href={article.googleMapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 shrink-0 px-2 py-1 rounded-full bg-surface-raised hover:bg-surface-hover text-ink font-medium text-caption border border-line shadow-2xs transition-colors cursor-pointer"
                      title={t('eventDrawer.mapsTitle')}
                    >
                      <span>{t('eventDrawer.googleMaps')}</span>
                      <ExternalLink className="w-3 h-3 text-ink-subtle shrink-0" />
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-hover/40 border border-line text-xs">
                <div className="flex items-center justify-center w-5 h-5 rounded-full bg-surface-hover text-ink-muted shrink-0 ring-1 ring-line">
                  <Globe className="w-3 h-3" />
                </div>
                <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
                  <span className="font-semibold text-ink/90">
                    {t('eventDrawer.globalEvent')}
                  </span>
                  <span className="text-caption text-ink-subtle">
                    - {t('eventDrawer.globalEventDesc')}
                  </span>
                </div>
              </div>
            )}

            {/* Public history this event is part of (checked Wikipedia articles) */}
            {historyLinks.length > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-surface-hover/40 border border-line text-xs">
                <BookOpen className="w-3.5 h-3.5 mt-1 text-ink-muted shrink-0" />
                <div className="min-w-0">
                  <span className="block text-caption font-medium text-ink-muted mb-1.5">{t('eventDrawer.historicalContext')}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {historyLinks.map((link) => (
                      <button
                        key={link.url}
                        type="button"
                        onClick={() => openContextLink(link)}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-full border border-line bg-surface-raised text-ink hover:bg-surface-hover font-medium text-caption shadow-2xs transition-all active:scale-95 cursor-pointer max-w-full"
                        title={link.description || link.title}
                      >
                        <span className="truncate" dir="auto">{link.name || link.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Discuss this event with AI chat */}
        {onAskAi && !readOnly && (
          <button
            type="button"
            onClick={() => onAskAi(article)}
            className="flex items-center justify-between w-full p-3 rounded-xl bg-surface-raised hover:bg-surface-hover border border-line hover:border-line-strong text-xs font-medium text-ink shadow-control transition-colors group cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 shrink-0 text-ink-subtle group-hover:text-ink transition-colors" />
              <span>{t('chat.askAboutEvent')}</span>
            </span>
            <ChevronRight className={`w-4 h-4 text-ink-subtle transition-transform group-hover:translate-x-0.5 ${isRtl ? 'rotate-180 group-hover:-translate-x-0.5' : ''}`} />
          </button>
        )}

        {/* Historical Summary / Description (Magazine Editorial Body) */}
        {/* Wikipedia text has its own tab; this stays for hand-written summaries and non-Wikipedia sources. */}
        {article.extract && (!hasWikiEmbed || article.extractIsCustom) ? (
          <div
            dir={extractDir}
            className={`bg-surface-hover/40 border border-line rounded-xl p-4 sm:p-5 text-sm sm:text-[14.5px] text-ink leading-relaxed sm:leading-relaxed space-y-4 ${
              extractDir === 'rtl' ? 'text-right' : 'text-left'
            }`}
          >
            {sourceName && !hasWikiEmbed && (
              <div
                dir={hasRtl(sourceName + ' ' + displayWikiTitle) ? 'rtl' : (isRtl ? 'rtl' : 'ltr')}
                className="flex items-center gap-2 pb-3 border-b border-line text-xs text-ink-subtle"
              >
                {isWiki ? (
                  <Globe className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                ) : sourceUrl ? (
                  <ExternalLink className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                ) : (
                  <Quote className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                )}
                <span className="text-caption text-ink-muted">
                  {t('eventDrawer.source')}:
                </span>
                <span className="font-semibold text-ink truncate">
                  {isWiki && displayWikiTitle ? `${sourceName}: ${displayWikiTitle}` : sourceName}
                </span>
              </div>
            )}

            <MathMarkdown
              content={article.extract}
              className="text-ink leading-relaxed font-sans"
            />

            {sourceUrl && !hasWikiEmbed && (
              <div
                dir={isRtl ? 'rtl' : 'ltr'}
                className="pt-2 border-t border-line flex items-center justify-end"
              >
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-raised hover:bg-surface-hover border border-line hover:border-line-strong text-xs font-medium text-ink transition-colors group cursor-pointer"
                >
                  <span>
                    {isWiki
                      ? t('eventDrawer.continueReading')
                      : t('eventDrawer.continueReadingOn', { source: sourceName || 'source' })}
                  </span>
                  <ExternalLink className={`w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 ${isRtl ? 'rotate-180 group-hover:-translate-x-0.5' : ''}`} />
                </a>
              </div>
            )}
          </div>
        ) : hasWikiEmbed ? null : sourceUrl ? (
          <div
            dir={isRtl ? 'rtl' : 'ltr'}
            className="bg-surface-hover/40 border border-line rounded-xl p-4 flex items-center justify-between text-xs"
          >
            <div className="flex items-center gap-2 min-w-0">
              {isWiki ? (
                <Globe className="w-4 h-4 text-ink-subtle shrink-0" />
              ) : (
                <ExternalLink className="w-4 h-4 text-ink-subtle shrink-0" />
              )}
              <div className="truncate">
                <span className="text-ink-subtle block text-caption">{t('eventDrawer.source')}</span>
                <strong className="text-ink font-semibold block truncate">
                  {isWiki && displayWikiTitle ? `${sourceName}: ${displayWikiTitle}` : (sourceName || sourceUrl)}
                </strong>
              </div>
            </div>
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-3 py-2 rounded-full bg-surface-raised hover:bg-surface-hover text-ink font-semibold text-caption border border-line shadow-control transition-colors cursor-pointer shrink-0 ml-2"
            >
              <span>
                {isWiki
                  ? t('eventDrawer.continueReading')
                  : t('eventDrawer.continueReadingOn', { source: sourceName || 'source' })}
              </span>
              <ExternalLink className="w-3 h-3 text-ink-subtle" />
            </a>
          </div>
        ) : (
          <p className="text-xs text-ink-subtle italic">
            {t('eventDrawer.noSummary')}
          </p>
        )}


        {/* Additional Photos Section */}
        {additionalImages.length > 0 && (
          <div className="rounded-xl border border-line bg-surface-hover/40 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-ink">
                <Images className="w-4 h-4 text-ink-subtle" />
                <span>{t('eventDrawer.additionalPhotos')}</span>
                <span className="px-2 py-0.5 rounded-full bg-surface-active text-ink-muted text-caption font-semibold tabular-nums">
                  {additionalImages.length}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {allImages.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        if (isHeroPlaying) {
                          setHeroPlayback(false);
                          return;
                        }
                        setHeroPlayback(true);
                        previewFrameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                      }}
                      aria-pressed={isHeroPlaying}
                      className="inline-flex items-center gap-1 text-caption font-medium text-accent hover:text-accent-hover hover:underline cursor-pointer"
                      data-testid="event-photos-slideshow"
                    >
                      {isHeroPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                      <span>{t(isHeroPlaying ? 'eventDrawer.pauseSlideshow' : 'eventDrawer.slideshowBtn')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCollageOpen(true)}
                      className="inline-flex items-center gap-1 text-caption font-medium text-accent hover:text-accent-hover hover:underline cursor-pointer"
                      data-testid="event-photos-collage"
                    >
                      <LayoutGrid className="w-3 h-3" />
                      <span>{t('eventDrawer.collageBtn')}</span>
                    </button>
                  </>
                )}
                {!readOnly && (onEdit || canEditInPlace) && (
                  <button
                    type="button"
                    onClick={() => (canEditInPlace ? startEditing() : onEdit(article))}
                    className="inline-flex items-center gap-1 text-caption font-medium text-accent hover:text-accent-hover hover:underline cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>{t('eventDrawer.addPhotosBtn')}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {additionalImages.map((img, idx) => {
                const globalIndex = idx + (article.imageUrl ? 1 : 0);
                return (
                  <div
                    key={idx}
                    className="group relative flex flex-col rounded-lg overflow-hidden border border-line hover:border-line-strong bg-surface-raised text-left transition-colors duration-200 hover:shadow-control"
                  >
                    <button
                      type="button"
                      onClick={() => openImageViewer(globalIndex)}
                      className="w-full text-left cursor-pointer flex-1 flex flex-col"
                    >
                      <div className="relative w-full aspect-[4/3] overflow-hidden bg-surface-sunken">
                        <img
                          src={img.url}
                          alt={img.caption || `${article.title} - photo ${idx + 1}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 bg-white"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 flex items-center justify-center transition-colors">
                          <Maximize2 className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                      {img.caption && (
                        <div
                          className="px-2 py-1 text-caption text-ink-muted truncate w-full text-start"
                          dir={getTextDir(img.caption, isTitleRtl)}
                          title={img.caption}
                        >
                          {img.caption}
                        </div>
                      )}
                    </button>
                    {!readOnly && onSetCoverImage && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSetCoverImage(idx);
                        }}
                        title={t('eventDrawer.setAsCover') || t('eventEditModal.setAsCover')}
                        className="w-full flex items-center justify-center gap-1 px-2 py-2 border-t border-line bg-surface-hover/60 hover:bg-accent-soft text-caption font-medium text-ink-muted hover:text-accent transition-colors cursor-pointer"
                      >
                        <Star className="w-3 h-3 text-warning shrink-0" />
                        <span className="truncate">{t('eventDrawer.setAsCover') || t('eventEditModal.setAsCover')}</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Google Grounding Sources */}
        {grounding?.is_grounded && grounding.sources && grounding.sources.length > 0 && (
          <div className="rounded-xl border border-line bg-surface-hover/40 p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-ink">
              <span className="flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-success" />
                <span>{t('eventDrawer.groundingSources')}</span>
              </span>
              <span className="text-caption font-semibold tabular-nums px-2 py-0.5 rounded-full bg-surface-active text-ink-muted">
                {grounding.sources.length}
              </span>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              {grounding.sources.slice(0, 5).map((src, idx) => (
                <a
                  key={idx}
                  href={src.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between text-caption p-2 rounded-lg bg-surface-raised hover:bg-surface-hover border border-line text-ink transition-colors group"
                >
                  <span className="truncate max-w-[240px] sm:max-w-[280px] font-medium">{src.title || src.url}</span>
                  <ExternalLink className="w-3 h-3 text-ink-subtle group-hover:text-ink shrink-0 ml-2" />
                </a>
              ))}
            </div>

            {/* Google Search Queries Chips */}
            {grounding.search_queries && grounding.search_queries.length > 0 && (
              <div className="pt-2 border-t border-line/60">
                <span className="text-caption font-medium text-ink-subtle block mb-1">
                  {t('eventDrawer.groundingQueries')}
                </span>
                <div className="flex flex-wrap gap-1">
                  {grounding.search_queries.map((q, qIdx) => (
                    <a
                      key={qIdx}
                      href={`https://www.google.com/search?q=${encodeURIComponent(q)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-caption px-3 py-0.5 rounded-full bg-surface-raised border border-line text-ink-muted hover:text-ink hover:border-line-strong transition-colors inline-flex items-center gap-1"
                    >
                      <span className="truncate max-w-[180px]">{q}</span>
                      <ExternalLink className="w-2.5 h-2.5 text-ink-subtle" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Frosted Action Dock (Footer) */}
      {!readOnly && currentTab === 'details' && !isEditing && (
        <div
          style={{
            paddingBottom: isMobile ? 'max(14px, calc(env(safe-area-inset-bottom, 0px) + 14px))' : undefined,
          }}
          className="px-5 py-4 border-t border-line flex items-center justify-between gap-3 bg-surface-overlay/95 backdrop-blur-md shrink-0"
        >
          <button
            type="button"
            onClick={() => (canEditInPlace ? startEditing() : onEdit?.(article))}
            className="flex-1 flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-accent-fg px-4 py-3 rounded-xl text-xs font-semibold shadow-control transition-all cursor-pointer"
          >
            <Edit className="w-3.5 h-3.5" />
            <span>{t('eventDrawer.editEvent')}</span>
          </button>

          <button
            type="button"
            onClick={() => onDelete?.(article.id)}
            className="event-drawer-delete-btn flex items-center justify-center gap-2 bg-surface-raised hover:bg-danger-soft text-ink-muted hover:text-danger border border-line hover:border-danger/30 p-3 rounded-xl text-xs font-medium transition-colors cursor-pointer"
            title={t('eventDrawer.deleteEvent')}
            aria-label={t('eventDrawer.deleteEvent')}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}

      {isCollageOpen && allImages.length > 1 && (
        <PhotoCollageDialog
          photos={allImages}
          title={article.title}
          onClose={() => setIsCollageOpen(false)}
          onSave={!readOnly && onAddEventPhoto
            ? async (dataUrl, options) => {
                await onAddEventPhoto(dataUrl, { ...options, caption: t('photoCollage.caption') });
                if (options?.asCover) setHeroIndex(0);
              }
            : undefined}
          zIndex={lightboxZIndex}
        />
      )}

      {isImageOpen && allImages.length > 0 && (() => {
        const activeImg = (typeof activeImageIndex === 'number' && Number.isFinite(activeImageIndex) && allImages[activeImageIndex])
          ? allImages[activeImageIndex]
          : allImages[0];
        const currentImgIndex = allImages.indexOf(activeImg) !== -1 ? allImages.indexOf(activeImg) : 0;
        const activeLightboxCandidates = activeImg?.lightboxCandidates?.length
          ? activeImg.lightboxCandidates
          : (activeImg?.url ? [activeImg.url] : []);
        const activeLightboxUrl =
          activeLightboxCandidates[lightboxCandidateIdx] ||
          activeLightboxCandidates[0] ||
          activeImg?.url;

        return createPortal(
          <div
            className="fixed inset-0 z-[70] bg-black/90 overflow-hidden select-none"
            style={lightboxZIndex != null ? { zIndex: lightboxZIndex } : undefined}
            role="dialog"
            aria-modal="true"
            aria-label={t('eventDrawer.viewFullImage')}
            onClick={() => setIsImageOpen(false)}
          >
            {/* Slideshow countdown to the next photo */}
            {isSlideshowRunning && imageView.scale <= IMAGE_MIN_SCALE && (
              <div className="absolute z-20 top-0 inset-x-0 h-1 bg-white/10 pointer-events-none">
                <div
                  key={currentImgIndex}
                  className={`h-full bg-accent animate-slideshow-progress ${isRtl ? 'origin-right' : 'origin-left'}`}
                  style={{ animationDuration: `${SLIDESHOW_INTERVAL_MS}ms` }}
                />
              </div>
            )}

            {/* Top Bar: Counter & Caption */}
            <div
              className="absolute z-10 top-4 start-4 flex items-center gap-3 max-w-[calc(100vw-6rem)]"
              onClick={(e) => e.stopPropagation()}
            >
              {allImages.length > 1 && (
                <button
                  type="button"
                  onClick={() => setIsSlideshowPlaying((playing) => !playing)}
                  aria-pressed={isSlideshowPlaying}
                  className={`inline-flex items-center gap-2 px-3 py-1 rounded-control border text-xs font-semibold shadow-pop transition-colors cursor-pointer shrink-0 ${
                    isSlideshowPlaying
                      ? 'bg-accent text-accent-fg border-accent'
                      : 'bg-black/65 hover:bg-black/85 text-white border-white/20'
                  }`}
                  title={`${t(isSlideshowPlaying ? 'eventDrawer.pauseSlideshow' : 'eventDrawer.playSlideshow')} (${t('eventDrawer.slideshowSpaceHint')})`}
                  data-testid="lightbox-slideshow-toggle"
                >
                  {isSlideshowPlaying
                    ? <Pause className="w-3.5 h-3.5 fill-current" />
                    : <Play className="w-3.5 h-3.5 fill-current" />}
                  <span>{t(isSlideshowPlaying ? 'eventDrawer.pauseSlideshow' : 'eventDrawer.slideshowBtn')}</span>
                </button>
              )}
              {allImages.length > 1 && (
                <span className="px-3 py-1 rounded-control bg-black/65 text-white/90 border border-white/20 text-xs font-semibold tabular-nums shadow-pop">
                  {t('eventDrawer.imageCounter', { current: currentImgIndex + 1, total: allImages.length })}
                </span>
              )}
              {activeImg?.caption && (
                <div
                  dir={getTextDir(activeImg.caption, isTitleRtl)}
                  className="px-3 py-1 rounded-control bg-black/65 text-white border border-white/20 text-xs font-medium truncate shadow-pop max-w-[240px] sm:max-w-md"
                  title={activeImg.caption}
                >
                  {activeImg.caption}
                </div>
              )}
              {!activeImg?.isCover && typeof activeImg?.additionalIndex === 'number' && !readOnly && onSetCoverImage && (
                <button
                  type="button"
                  onClick={() => {
                    onSetCoverImage(activeImg.additionalIndex);
                    setActiveImageIndex(0);
                    setLightboxCandidateIdx(0);
                    setImageLoadFailed(false);
                  }}
                  title={t('eventDrawer.setAsCover') || t('eventEditModal.setAsCover')}
                  className="inline-flex items-center gap-2 px-3 py-1 rounded-control bg-black/65 hover:bg-black/85 text-white border border-white/20 text-xs font-semibold shadow-pop transition-colors cursor-pointer shrink-0"
                >
                  <Star className="w-3.5 h-3.5 text-warning shrink-0" />
                  <span>{t('eventDrawer.setAsCover') || t('eventEditModal.setAsCover')}</span>
                </button>
              )}
            </div>

            {/* Close button */}
            <button
              type="button"
              onClick={() => setIsImageOpen(false)}
              className="absolute z-10 top-4 end-4 flex items-center justify-center w-10 h-10 rounded-control bg-black/65 text-white hover:bg-black/85 border border-white/20 transition-colors shadow-pop cursor-pointer"
              title={t('common.close')}
              aria-label={t('common.close')}
            >
              <X className="w-6 h-6" />
            </button>

            {/* Prev/Next buttons */}
            {allImages.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isRtl) handleNextImage();
                    else handlePrevImage();
                  }}
                  className="absolute z-10 start-3 sm:start-6 top-1/2 -translate-y-1/2 flex items-center justify-center w-11 h-11 rounded-full bg-black/65 text-white hover:bg-black/90 border border-white/20 transition-transform active:scale-95 shadow-pop cursor-pointer"
                  title={t('eventDrawer.prevImage')}
                  aria-label={t('eventDrawer.prevImage')}
                >
                  {isRtl ? <ChevronRight className="w-6 h-6" /> : <ChevronLeft className="w-6 h-6" />}
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isRtl) handlePrevImage();
                    else handleNextImage();
                  }}
                  className="absolute z-10 end-3 sm:end-6 top-1/2 -translate-y-1/2 flex items-center justify-center w-11 h-11 rounded-full bg-black/65 text-white hover:bg-black/90 border border-white/20 transition-transform active:scale-95 shadow-pop cursor-pointer"
                  title={t('eventDrawer.nextImage')}
                  aria-label={t('eventDrawer.nextImage')}
                >
                  {isRtl ? <ChevronLeft className="w-6 h-6" /> : <ChevronRight className="w-6 h-6" />}
                </button>
              </>
            )}

            {/* Viewport for zoom/pan */}
            <div
              ref={imageViewportRef}
              className="absolute inset-0 flex items-center justify-center overflow-hidden touch-none p-4 sm:p-12"
              onWheel={handleImageWheel}
              onPointerDown={handleImagePointerDown}
              onPointerMove={handleImagePointerMove}
              onPointerUp={handleImagePointerEnd}
              onPointerCancel={handleImagePointerEnd}
              onClick={(event) => {
                if (suppressBackdropClickRef.current) {
                  suppressBackdropClickRef.current = false;
                  event.stopPropagation();
                }
              }}
            >
              {imageLoadFailed ? (
                <div className="flex flex-col items-center justify-center gap-2 p-6 rounded-panel bg-black/65 border border-white/20 text-white/80 max-w-sm text-center shadow-pop">
                  <ImageIcon className="w-10 h-10 opacity-50" />
                  <span className="text-sm font-medium">{t('eventDrawer.noImage')}</span>
                </div>
              ) : (
                <img
                  key={currentImgIndex}
                  ref={imageRef}
                  src={activeLightboxUrl}
                  alt={activeImg?.caption || article.title}
                  draggable="false"
                  className={`block max-w-full max-h-full w-auto h-auto object-contain select-none transition-transform duration-75 bg-white rounded-lg shadow-2xl ${isSlideshowPlaying ? 'animate-fade-in' : ''} ${imageView.scale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
                  style={{
                    transform: `translate3d(${imageView.x}px, ${imageView.y}px, 0) scale(${imageView.scale})`,
                    ...(isSlideshowPlaying ? { animationDuration: '700ms' } : {})
                  }}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (imageView.scale > 1) {
                      updateImageView({ scale: 1, x: 0, y: 0 });
                    } else {
                      changeImageScale(2, event);
                    }
                  }}
                  onError={() => {
                    if (lightboxCandidateIdx + 1 < activeLightboxCandidates.length) {
                      setLightboxCandidateIdx((idx) => idx + 1);
                    } else {
                      setImageLoadFailed(true);
                    }
                  }}
                />
              )}
            </div>

            {/* Bottom Thumbnails Carousel (when multi-image) */}
            {allImages.length > 1 && (
              <div
                className="absolute z-10 bottom-16 left-1/2 -translate-x-1/2 flex items-center gap-2 p-1 rounded-control bg-black/70 border border-white/20 overflow-x-auto max-w-[85vw] shadow-pop"
                onClick={(event) => event.stopPropagation()}
              >
                {allImages.map((img, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setActiveImageIndex(i);
                      setLightboxCandidateIdx(0);
                      setImageLoadFailed(false);
                      updateImageView({ scale: 1, x: 0, y: 0 });
                    }}
                    className={`relative w-9 h-9 sm:w-11 sm:h-11 rounded overflow-hidden shrink-0 border transition-all cursor-pointer ${
                      i === currentImgIndex
                        ? 'border-accent ring-2 ring-accent scale-105 opacity-100'
                        : 'border-white/20 opacity-50 hover:opacity-90'
                    }`}
                    title={img.caption || `Photo ${i + 1}`}
                  >
                    <img src={img.url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            {/* Zoom Controls */}
            <div
              className="absolute z-10 bottom-4 left-1/2 -translate-x-1/2 flex items-center h-10 rounded-control bg-black/65 text-white border border-white/20 overflow-hidden shadow-pop"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => changeImageScale(imageViewRef.current.scale - IMAGE_ZOOM_STEP)}
                disabled={imageView.scale <= IMAGE_MIN_SCALE}
                className="w-10 h-10 flex items-center justify-center hover:bg-white/15 disabled:opacity-35 disabled:cursor-default transition-colors cursor-pointer"
                title={t('toolbar.zoomOut')}
                aria-label={t('toolbar.zoomOut')}
              >
                <Minus className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => updateImageView({ scale: 1, x: 0, y: 0 })}
                className="w-16 h-10 border-x border-white/20 text-xs font-semibold tabular-nums hover:bg-white/15 transition-colors cursor-pointer"
                aria-label={t('eventDrawer.resetImageZoom')}
              >
                {Math.round(imageView.scale * 100)}%
              </button>
              <button
                type="button"
                onClick={() => changeImageScale(imageViewRef.current.scale + IMAGE_ZOOM_STEP)}
                disabled={imageView.scale >= IMAGE_MAX_SCALE}
                className="w-10 h-10 flex items-center justify-center hover:bg-white/15 disabled:opacity-35 disabled:cursor-default transition-colors cursor-pointer"
                title={t('toolbar.zoomIn')}
                aria-label={t('toolbar.zoomIn')}
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>,
          document.body
        );
      })()}
    </div>
    </>
  );
}

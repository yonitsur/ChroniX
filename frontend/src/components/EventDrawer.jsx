import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ExternalLink, Edit, Trash2, Calendar, Layers, Tag, Image as ImageIcon, AlertTriangle, MapPin, Star, ChevronLeft, ChevronRight, Compass, Globe, MessageSquare, Maximize2, Minus, Plus, Move, Check, Quote, Images } from 'lucide-react';
import { getLaneColor, getDistinctCategories, getCategoryColor } from '../data/laneColors';
import { useLanguage } from '../context/LanguageContext';
import { translations } from '../locales/translations';
import { normalizeAdditionalImages } from './EventEditModal';

const IMAGE_MIN_SCALE = 1;
const IMAGE_MAX_SCALE = 5;
const IMAGE_ZOOM_STEP = 0.5;

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
    switch (lang) {
      case 'ja':
      case 'zh':
        return `${y}年${d.month}月${d.day}日`;
      case 'ko':
        return `${y}년 ${d.month}월 ${d.day}일`;
      case 'he':
        return `${d.day} ב${monthName} ${y}`;
      case 'ar':
        return `${d.day} ${monthName} ${y}`;
      case 'de':
        return `${d.day}. ${monthName} ${y}`;
      case 'es':
      case 'pt':
        return `${d.day} de ${monthName} de ${y}`;
      case 'fr':
      case 'hi':
        return `${d.day} ${monthName} ${y}`;
      default:
        return `${monthName} ${d.day}, ${y}`;
    }
  }

  if (d.month) {
    switch (lang) {
      case 'ja':
      case 'zh':
        return `${y}年${d.month}月`;
      case 'ko':
        return `${y}년 ${d.month}월`;
      case 'es':
      case 'pt':
        return `${monthName} de ${y}`;
      default:
        return `${monthName} ${y}`;
    }
  }

  if (lang === 'ja' || lang === 'zh') return `${y}年`;
  if (lang === 'ko') return `${y}년`;

  return `${y}`;
}

export function formatTimeSpan(from, to, isToPresent, lang = 'en') {
  const dict = translations[lang]?.dates || translations.en.dates;
  const fromStr = formatDatePart(from, lang);
  if (isToPresent) return fromStr ? `${fromStr} – ${dict.present}` : dict.present;
  if (!to) return fromStr;
  const toStr = formatDatePart(to, lang);
  if (!fromStr) return toStr;
  if (fromStr === toStr) return fromStr;
  return `${fromStr} – ${toStr}`;
}

export default function EventDrawer({
  article,
  lanes = [],
  articles = [],
  grounding = null,
  isStarred = false,
  onToggleStar,
  onClose,
  onBackToList,
  onEdit,
  onDelete,
  onAskAi,
  onImagePositionChange,
  isExploring = false,
  exploreProgress = null,
  onExploreNext,
  onExplorePrev,
  readOnly = false,
  style
}) {
  const { language, isRtl, t, formatTimeSpan: localizedTimeSpan } = useLanguage();
  const [isImageOpen, setIsImageOpen] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [isPositioningImage, setIsPositioningImage] = useState(false);
  const [imagePosition, setImagePosition] = useState({
    x: article?.imagePositionX ?? 50,
    y: article?.imagePositionY ?? 50
  });
  const [imageView, setImageView] = useState({ scale: 1, x: 0, y: 0 });

  const additionalImages = normalizeAdditionalImages(article?.additionalImages);
  const allImages = [
    article?.imageUrl ? { url: article.imageUrl, caption: article.title, isCover: true } : null,
    ...additionalImages
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
    updateImageView({ scale: 1, x: 0, y: 0 });
    setImageLoadFailed(false);
    setIsImageOpen(true);
  };

  const handlePrevImage = () => {
    if (allImages.length <= 1) return;
    setActiveImageIndex((prev) => {
      const current = typeof prev === 'number' && Number.isFinite(prev) ? prev : 0;
      return current > 0 ? current - 1 : allImages.length - 1;
    });
    updateImageView({ scale: 1, x: 0, y: 0 });
    setImageLoadFailed(false);
  };

  const handleNextImage = () => {
    if (allImages.length <= 1) return;
    setActiveImageIndex((prev) => {
      const current = typeof prev === 'number' && Number.isFinite(prev) ? prev : 0;
      return current < allImages.length - 1 ? current + 1 : 0;
    });
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
      gestureRef.current = { type: 'pan', lastX: event.clientX, lastY: event.clientY };
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

    if (gestureRef.current?.type === 'pan' && imageViewRef.current.scale > IMAGE_MIN_SCALE) {
      const dx = event.clientX - previousPointer.x;
      const dy = event.clientY - previousPointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) suppressBackdropClickRef.current = true;
      updateImageView((previous) => ({
        scale: previous.scale,
        ...clampImageOffset(previous.x + dx, previous.y + dy, previous.scale)
      }));
    }
  };

  const handleImagePointerEnd = (event) => {
    activePointersRef.current.delete(event.pointerId);
    const remaining = [...activePointersRef.current.values()];
    gestureRef.current = remaining.length === 1
      ? { type: 'pan', lastX: remaining[0].x, lastY: remaining[0].y }
      : null;
  };

  useEffect(() => {
    if (!isImageOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
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
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isImageOpen, allImages.length, isRtl]);

  useEffect(() => {
    setIsImageOpen(false);
    setActiveImageIndex(0);
    setImageLoadFailed(false);
    setIsPositioningImage(false);
    const nextPosition = {
      x: article?.imagePositionX ?? 50,
      y: article?.imagePositionY ?? 50
    };
    imagePositionRef.current = nextPosition;
    setImagePosition(nextPosition);
    updateImageView({ scale: 1, x: 0, y: 0 });
  }, [article?.id]);

  if (!article) return null;

  const laneIndex = lanes.findIndex((l) => l.id === article.lane);
  const laneObj = laneIndex >= 0 ? lanes[laneIndex] : null;
  const laneColor = laneObj ? getLaneColor(laneObj, laneIndex, lanes) : null;
  const timeSpan = localizedTimeSpan(article.from, article.to, article.isToPresent);

  // Topic (`category`) drives color coding, independent of which lane/track an event sits in.
  const categories = getDistinctCategories(articles);
  const themeLabel = (article.category || '').toString().trim();
  const themeColor = themeLabel ? getCategoryColor(themeLabel, categories) : null;
  const showLaneBadge = lanes.length > 1 && Boolean(laneObj);

  const hasRtl = (str) => /[\u0590-\u05FF\u0600-\u06FF]/.test(str || '');
  const isTitleRtl = hasRtl((article.title || '') + ' ' + (article.subtitle || ''));
  const isLaneRtl = hasRtl(laneObj?.title || '');
  const isThemeRtl = hasRtl(themeLabel);

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

  return (
    <div
      className={`fixed md:absolute inset-y-0 left-0 md:left-[52px] w-full sm:w-[400px] max-w-[calc(100vw-52px)] bg-surface-overlay border-r border-line shadow-panel flex flex-col transition-transform duration-300 ease-in-out font-sans ${
        isRtl ? 'text-right' : 'text-left'
      }`}
      style={style}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-line">
        <div className="flex items-center gap-2 min-w-0">
          {onBackToList && (
            <button
              type="button"
              onClick={onBackToList}
              className="p-1 -ms-1 text-ink-subtle hover:text-ink hover:bg-surface-hover rounded-control transition-colors cursor-pointer shrink-0"
              title={t('cardsList.title')}
              aria-label={t('cardsList.title')}
            >
              {isRtl ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          )}
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-subtle font-sans truncate">
            {t('eventDrawer.title')}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onToggleStar?.(article.id)}
            className={`p-1.5 rounded-control transition-colors cursor-pointer ${
              isStarred
                ? 'text-star bg-star/10'
                : 'text-ink-subtle hover:text-star hover:bg-surface-hover'
            }`}
            title={isStarred ? t('eventDrawer.unstarEvent') : t('eventDrawer.starEvent')}
            aria-label={isStarred ? t('eventDrawer.unstarEvent') : t('eventDrawer.starEvent')}
          >
            <Star className={`w-4 h-4 ${isStarred ? 'fill-star text-star' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-ink-subtle hover:text-ink hover:bg-surface-hover rounded-control transition-colors cursor-pointer"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Prev/Next event navigation strip. Always shown so the user can step between
          events straight from the details pane, not only during a guided tour.
          Kept LTR so Prev/Next match the canvas time direction. */}
      {exploreProgress && (
        <div
          dir="ltr"
          className="flex items-center justify-between gap-2 px-4 py-2 border-b border-line bg-surface-sunken select-none animate-in fade-in duration-200"
        >
          <button
            type="button"
            onClick={onExplorePrev}
            disabled={!exploreProgress || exploreProgress.current <= 1}
            title={`${t('explore.prev')} (←)`}
            aria-label={t('explore.prev')}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-control text-xs font-semibold text-accent bg-accent-soft hover:bg-accent-soft/80 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>{t('explore.prev')}</span>
          </button>

          <div className="flex items-center gap-1.5 text-caption font-bold text-ink-muted">
            <Compass className="w-3.5 h-3.5 text-accent" />
            <span className="tabular-nums whitespace-nowrap">
              {exploreProgress ? `${exploreProgress.current} / ${exploreProgress.total}` : ''}
            </span>
          </div>

          <button
            type="button"
            onClick={onExploreNext}
            disabled={!exploreProgress || exploreProgress.current >= exploreProgress.total}
            title={`${t('explore.next')} (→)`}
            aria-label={t('explore.next')}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-control text-xs font-semibold text-accent-fg bg-accent hover:bg-accent-hover shadow-control transition-all cursor-pointer active:scale-95 disabled:opacity-30 disabled:cursor-default"
          >
            <span>{t('explore.next')}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Content scroll area */}
      <div
        key={article.id}
        className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-ink animate-in fade-in duration-200"
      >
        {/* Banner image */}
        {article.imageUrl ? (
          <div
            className={`w-full h-52 rounded-panel overflow-hidden bg-surface-sunken border border-line relative group shadow-control ${
              !isPositioningImage ? 'cursor-pointer' : ''
            }`}
            onClick={!isPositioningImage ? () => openImageViewer(0) : undefined}
          >
            <img
              ref={previewImageRef}
              src={article.imageUrl}
              alt={article.title}
              draggable="false"
              className="w-full h-full object-cover select-none pointer-events-none"
              style={{ objectPosition: `${imagePosition.x}% ${imagePosition.y}%` }}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            {isPositioningImage ? (
              <div
                className="absolute inset-0 touch-none cursor-move bg-black/10"
                role="application"
                aria-label={t('eventDrawer.dragImageToPosition')}
                onPointerDown={handleCropPointerDown}
                onPointerMove={handleCropPointerMove}
                onPointerUp={handleCropPointerEnd}
                onPointerCancel={handleCropPointerEnd}
                onClick={(e) => e.stopPropagation()}
              >
                <span className="absolute left-1/2 bottom-3 -translate-x-1/2 whitespace-nowrap rounded-control bg-black/70 px-2.5 py-1.5 text-caption font-semibold text-white pointer-events-none">
                  {t('eventDrawer.dragImageToPosition')}
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openImageViewer(0);
                }}
                className="absolute bottom-2 left-2 flex items-center justify-center w-8 h-8 rounded-control bg-black/65 text-white border border-white/20 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring transition-opacity cursor-pointer"
                title={t('eventDrawer.viewFullImage')}
                aria-label={`${t('eventDrawer.viewFullImage')}: ${article.title}`}
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            )}
            {!readOnly && onImagePositionChange && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsPositioningImage((value) => !value);
                }}
                className={`absolute top-2 left-2 flex items-center justify-center w-8 h-8 rounded-control border transition-colors cursor-pointer ${
                  isPositioningImage
                    ? 'bg-accent text-accent-fg border-accent'
                    : 'bg-black/65 text-white border-white/20 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/85'
                }`}
                title={isPositioningImage ? t('common.confirm') : t('eventDrawer.adjustImagePosition')}
                aria-label={isPositioningImage ? t('common.confirm') : t('eventDrawer.adjustImagePosition')}
                aria-pressed={isPositioningImage}
              >
                {isPositioningImage ? <Check className="w-4 h-4" /> : <Move className="w-4 h-4" />}
              </button>
            )}
          </div>
        ) : (
          <div className="w-full h-28 rounded-panel bg-surface-sunken border border-line flex flex-col items-center justify-center text-ink-subtle gap-1">
            <ImageIcon className="w-6 h-6 opacity-40" />
            <span className="text-xs">{t('eventDrawer.noImage')}</span>
          </div>
        )}

        {/* Title and Subtitle */}
        <div
          dir={isTitleRtl ? 'rtl' : (isRtl ? 'rtl' : 'ltr')}
          className={isTitleRtl ? 'text-right' : (isRtl ? 'text-right' : 'text-left')}
        >
          <h2 className="text-xl font-bold text-ink tracking-tight leading-snug">
            {article.title}
          </h2>
          {article.subtitle && (
            <p className="text-sm text-ink-muted mt-1 leading-relaxed">
              {article.subtitle}
            </p>
          )}
        </div>

        {/* Event Details: Date, Topic, Lane, Location on separate lines */}
        {(timeSpan || themeLabel || showLaneBadge || article.locationName || (article.lat != null && article.lng != null)) && (
          <div className="p-3 rounded-panel bg-surface-sunken border border-line space-y-2.5 text-xs">
            {/* Line 1: Date */}
            {timeSpan && (
              <div className="flex items-center">
                <span className="inline-flex items-center gap-1.5 font-medium text-accent bg-accent-soft border border-accent/20 px-2.5 py-0.5 rounded-control">
                  <Calendar className="w-3.5 h-3.5 shrink-0" />
                  <span>{timeSpan}</span>
                </span>
              </div>
            )}

            {/* Line 2: Topic (label icon + topic color + full topic text) */}
            {themeLabel && (
              <div className="flex items-center gap-2 text-ink font-medium">
                <Tag className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0 shadow-2xs ring-1 ring-black/10 dark:ring-white/15"
                  style={{ backgroundColor: themeColor }}
                />
                <span dir={isThemeRtl ? 'rtl' : (isRtl ? 'rtl' : 'ltr')} className="leading-snug break-words">
                  {themeLabel}
                </span>
              </div>
            )}

            {/* Line 3: Lane (lane icon + lane color + full lane text) */}
            {showLaneBadge && (
              <div className="flex items-center gap-2 text-ink font-medium">
                <Layers className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                {laneColor && (
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 shadow-2xs ring-1 ring-black/10 dark:ring-white/15"
                    style={{ backgroundColor: laneColor }}
                  />
                )}
                <span dir={isLaneRtl ? 'rtl' : (isRtl ? 'rtl' : 'ltr')} className="leading-snug break-words">
                  {laneObj.title}
                </span>
              </div>
            )}

            {/* Line 4: Location (location icon + full location text + Maps link) */}
            {(article.locationName || (article.lat != null && article.lng != null)) && (
              <div className="flex items-center justify-between gap-2 text-ink">
                <div className="flex items-center gap-2 min-w-0">
                  <MapPin className="w-3.5 h-3.5 text-danger shrink-0" />
                  <span className="leading-snug break-words font-medium">
                    {article.locationName || `${Number(article.lat).toFixed(2)}, ${Number(article.lng).toFixed(2)}`}
                  </span>
                  {article.lat != null && article.lng != null && !isNaN(Number(article.lat)) && !isNaN(Number(article.lng)) && (
                    <span className="text-caption text-ink-subtle shrink-0">
                      ({Number(article.lat).toFixed(4)}°, {Number(article.lng).toFixed(4)}°)
                    </span>
                  )}
                </div>
                {article.googleMapsUrl && (
                  <a
                    href={article.googleMapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 shrink-0 px-2 py-1 rounded-control bg-surface-raised hover:bg-surface-hover text-ink font-medium text-caption border border-line shadow-control transition-colors cursor-pointer"
                    title={t('eventDrawer.mapsTitle')}
                  >
                    <span>{t('eventDrawer.googleMaps')}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        {/* Discuss this event with the AI chat */}
        {onAskAi && !readOnly && (
          <button
            type="button"
            onClick={() => onAskAi(article)}
            className="flex items-center justify-between w-full bg-accent-soft hover:bg-accent-soft/80 border border-accent/20 rounded-panel p-3 text-xs font-semibold text-accent transition-colors group cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 shrink-0" />
              {t('chat.askAboutEvent')}
            </span>
            <ChevronRight className={`w-4 h-4 transition-transform group-hover:translate-x-0.5 ${isRtl ? 'rotate-180' : ''}`} />
          </button>
        )}

        {/* Historical Summary / Description & Multi-Source Attribution */}
        {article.extract ? (
          <div
            dir={hasRtl(article.extract) ? 'rtl' : (isRtl ? 'rtl' : 'ltr')}
            className={`bg-surface-sunken border border-line rounded-panel p-4 text-sm text-ink leading-relaxed ${
              hasRtl(article.extract) ? 'text-right' : (isRtl ? 'text-right' : 'text-left')
            }`}
          >
            {sourceName && (
              <div
                dir={hasRtl(sourceName + ' ' + displayWikiTitle) ? 'rtl' : (isRtl ? 'rtl' : 'ltr')}
                className="flex items-center gap-2 pb-2.5 mb-3 border-b border-line/60 text-xs text-ink-subtle"
              >
                {isWiki ? (
                  <Globe className="w-3.5 h-3.5 text-accent shrink-0" />
                ) : sourceUrl ? (
                  <ExternalLink className="w-3.5 h-3.5 text-accent shrink-0" />
                ) : (
                  <Quote className="w-3.5 h-3.5 text-accent shrink-0" />
                )}
                <span className="text-caption text-ink-muted">
                  {t('eventDrawer.source')}:
                </span>
                <span className="font-semibold text-ink truncate">
                  {isWiki && displayWikiTitle ? `${sourceName}: ${displayWikiTitle}` : sourceName}
                </span>
              </div>
            )}

            <p className="whitespace-pre-line">{article.extract}</p>

            {sourceUrl && (
              <div
                dir={isRtl ? 'rtl' : 'ltr'}
                className="pt-2.5 mt-3 border-t border-line/60 flex items-center justify-end"
              >
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent-hover hover:underline transition-colors group cursor-pointer"
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
        ) : sourceUrl ? (
          <div
            dir={isRtl ? 'rtl' : 'ltr'}
            className="bg-surface-sunken border border-line rounded-panel p-3.5 flex items-center justify-between text-xs"
          >
            <div className="flex items-center gap-2 min-w-0">
              {isWiki ? (
                <Globe className="w-4 h-4 text-accent shrink-0" />
              ) : (
                <ExternalLink className="w-4 h-4 text-accent shrink-0" />
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
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-control bg-surface-raised hover:bg-surface-hover text-ink font-medium text-caption border border-line shadow-control transition-colors cursor-pointer shrink-0 ml-2"
            >
              <span>
                {isWiki
                  ? t('eventDrawer.continueReading')
                  : t('eventDrawer.continueReadingOn', { source: sourceName || 'source' })}
              </span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        ) : (
          <p className="text-xs text-ink-faint italic">
            {t('eventDrawer.noSummary')}
          </p>
        )}

        {/* Additional Photos Section */}
        {additionalImages.length > 0 && (
          <div className="rounded-panel border border-line bg-surface-sunken p-3.5 space-y-2.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                <Images className="w-3.5 h-3.5 text-accent" />
                <span>{t('eventDrawer.additionalPhotos')}</span>
                <span className="px-1.5 py-0.5 rounded-full bg-surface-raised border border-line text-caption font-bold text-ink-muted">
                  {additionalImages.length}
                </span>
              </div>
              {!readOnly && onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(article)}
                  className="inline-flex items-center gap-1 text-caption font-medium text-accent hover:text-accent-hover hover:underline cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>{t('eventDrawer.addPhotosBtn')}</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {additionalImages.map((img, idx) => {
                const globalIndex = idx + (article.imageUrl ? 1 : 0);
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => openImageViewer(globalIndex)}
                    className="group relative flex flex-col rounded-control overflow-hidden border border-line hover:border-accent bg-surface-raised text-left transition-all duration-150 cursor-pointer shadow-2xs hover:shadow-control"
                  >
                    <div className="relative w-full aspect-4/3 overflow-hidden bg-surface-sunken">
                      <img
                        src={img.url}
                        alt={img.caption || `${article.title} - photo ${idx + 1}`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 flex items-center justify-center transition-colors">
                        <Maximize2 className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                    {img.caption && (
                      <div
                        className="px-1.5 py-1 text-caption text-ink-muted truncate w-full"
                        dir={hasRtl(img.caption) ? 'rtl' : (isRtl ? 'rtl' : 'ltr')}
                        title={img.caption}
                      >
                        {img.caption}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Google Grounding Sources */}
        {grounding?.is_grounded && grounding.sources && grounding.sources.length > 0 && (
          <div className="rounded-panel border border-accent/25 bg-accent-soft/40 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-accent">
              <span className="flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-accent" />
                <span>{t('eventDrawer.groundingSources')}</span>
              </span>
              <span className="text-caption font-bold px-1.5 py-0.5 rounded bg-accent-soft text-accent">
                {grounding.sources.length}
              </span>
            </div>

            <div className="flex flex-col gap-1.5 pt-1">
              {grounding.sources.slice(0, 5).map((src, idx) => (
                <a
                  key={idx}
                  href={src.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between text-caption p-2 rounded-control bg-surface-raised hover:bg-surface-hover border border-line text-ink hover:text-accent transition-colors shadow-control group"
                >
                  <span className="truncate max-w-[220px] sm:max-w-[260px] font-medium">{src.title || src.url}</span>
                  <ExternalLink className="w-3 h-3 text-ink-subtle group-hover:text-accent shrink-0 ml-1.5" />
                </a>
              ))}
            </div>

            {/* Google Search Queries Chips */}
            {grounding.search_queries && grounding.search_queries.length > 0 && (
              <div className="pt-1 border-t border-line">
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
                      className="text-caption px-2 py-0.5 rounded-full bg-surface-raised border border-line text-ink-muted hover:text-accent hover:border-accent/40 transition-colors inline-flex items-center gap-1"
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

      {/* Footer Actions */}
      {!readOnly && (
      <div className="px-5 py-4 border-t border-line flex items-center justify-between gap-3 bg-surface-overlay">
        <button
          type="button"
          onClick={() => onEdit?.(article)}
          className="flex-1 flex items-center justify-center gap-2 bg-surface-raised hover:bg-surface-hover text-ink border border-line px-4 py-2.5 rounded-control text-xs font-semibold shadow-control transition-colors cursor-pointer"
        >
          <Edit className="w-3.5 h-3.5" />
          <span>{t('eventDrawer.editEvent')}</span>
        </button>

        <button
          type="button"
          onClick={() => onDelete?.(article.id)}
          className="flex items-center justify-center gap-1.5 bg-surface-raised hover:bg-danger-soft text-ink-muted hover:text-danger border border-line hover:border-danger/30 px-3.5 py-2.5 rounded-control text-xs font-medium transition-colors cursor-pointer"
          title={t('eventDrawer.deleteEvent')}
          aria-label={t('eventDrawer.deleteEvent')}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      )}

      {isImageOpen && allImages.length > 0 && (() => {
        const activeImg = (typeof activeImageIndex === 'number' && Number.isFinite(activeImageIndex) && allImages[activeImageIndex])
          ? allImages[activeImageIndex]
          : allImages[0];
        const currentImgIndex = allImages.indexOf(activeImg) !== -1 ? allImages.indexOf(activeImg) : 0;

        return createPortal(
          <div
            className="fixed inset-0 z-[70] bg-black/90 overflow-hidden select-none"
            role="dialog"
            aria-modal="true"
            aria-label={t('eventDrawer.viewFullImage')}
            onClick={() => setIsImageOpen(false)}
          >
            {/* Top Bar: Counter & Caption */}
            <div
              className="absolute z-10 top-4 start-4 flex items-center gap-2.5 max-w-[calc(100vw-6rem)]"
              onClick={(e) => e.stopPropagation()}
            >
              {allImages.length > 1 && (
                <span className="px-2.5 py-1 rounded-control bg-black/65 text-white/90 border border-white/20 text-xs font-semibold tabular-nums shadow-pop">
                  {t('eventDrawer.imageCounter', { current: currentImgIndex + 1, total: allImages.length })}
                </span>
              )}
              {activeImg?.caption && (
                <div
                  dir={hasRtl(activeImg.caption) ? 'rtl' : (isRtl ? 'rtl' : 'ltr')}
                  className="px-3 py-1 rounded-control bg-black/65 text-white border border-white/20 text-xs font-medium truncate shadow-pop max-w-[240px] sm:max-w-md"
                  title={activeImg.caption}
                >
                  {activeImg.caption}
                </div>
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
                  ref={imageRef}
                  src={activeImg?.url}
                  alt={activeImg?.caption || article.title}
                  draggable="false"
                  className={`block max-w-full max-h-full w-auto h-auto object-contain select-none transition-transform duration-75 ${imageView.scale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
                  style={{ transform: `translate3d(${imageView.x}px, ${imageView.y}px, 0) scale(${imageView.scale})` }}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (imageView.scale > 1) {
                      updateImageView({ scale: 1, x: 0, y: 0 });
                    } else {
                      changeImageScale(2, event);
                    }
                  }}
                  onError={() => setImageLoadFailed(true)}
                />
              )}
            </div>

            {/* Bottom Thumbnails Carousel (when multi-image) */}
            {allImages.length > 1 && (
              <div
                className="absolute z-10 bottom-16 left-1/2 -translate-x-1/2 flex items-center gap-1.5 p-1 rounded-control bg-black/70 border border-white/20 overflow-x-auto max-w-[85vw] shadow-pop"
                onClick={(event) => event.stopPropagation()}
              >
                {allImages.map((img, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setActiveImageIndex(i);
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
  );
}

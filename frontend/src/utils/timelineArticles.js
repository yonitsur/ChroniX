import { compareDateParts } from './dateTime.js';
import { getCanvasImageUrl } from './wikimediaImageUrl.js';

export function isSameArticleId(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

export function isRtlText(value) {
  return typeof value === 'string' && /[\u0590-\u05FF\u0600-\u06FF]/.test(value);
}

export function compareEventDates(a, b, useEndA = false, useEndB = false) {
  const dateA = useEndA && a?.to ? a.to : (a?.from || {});
  const dateB = useEndB && b?.to ? b.to : (b?.from || {});
  return compareDateParts(dateA, dateB);
}

export function getTimelineAnchorArticleIds(articles = []) {
  const anchorIds = new Set();
  if (!Array.isArray(articles) || articles.length === 0) return anchorIds;

  const addBoundaryIds = (items) => {
    let earliest = items[0];
    let latest = items[0];

    for (let index = 1; index < items.length; index += 1) {
      const article = items[index];
      if (compareEventDates(article, earliest) < 0) earliest = article;
      if (compareEventDates(article, latest, true, true) > 0) latest = article;
    }

    if (earliest?.id != null) anchorIds.add(String(earliest.id));
    if (latest?.id != null) anchorIds.add(String(latest.id));
  };

  addBoundaryIds(articles);

  const articlesByLane = new Map();
  articles.forEach((article) => {
    const laneKey = String(article.lane || 'default');
    const laneArticles = articlesByLane.get(laneKey) || [];
    laneArticles.push(article);
    articlesByLane.set(laneKey, laneArticles);
  });

  if (articlesByLane.size > 1) {
    articlesByLane.forEach(addBoundaryIds);
  }

  return anchorIds;
}

export function normalizeAdditionalImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .map((img) => {
      if (!img) return null;
      if (typeof img === 'string' && img.trim()) {
        return { url: img.trim(), caption: '' };
      }
      if (typeof img === 'object' && img.url && typeof img.url === 'string' && img.url.trim()) {
        return {
          url: img.url.trim(),
          caption: typeof img.caption === 'string' ? img.caption.trim() : '',
          ...(typeof img.imageSource === 'string' && img.imageSource ? { imageSource: img.imageSource } : {}),
        };
      }
      return null;
    })
    .filter(Boolean);
}

export function formatYearRangeLabel(minYear, maxYear, timeScale, t, isRtl) {
  if (minYear == null && maxYear == null) return '';
  const fmtOne = (yr) => {
    if (yr == null) return '';
    if (timeScale === 'prehistoric' && Math.abs(yr) >= 1_000_000) {
      const mya = Math.round((Math.abs(yr) / 1_000_000) * 10) / 10;
      return isRtl ? `${mya} מיליון לפנה״ס` : `${mya}M BCE`;
    }
    if (yr < 0) {
      return `${Math.abs(yr).toLocaleString()} ${t('dates.bce') || 'BCE'}`;
    }
    return String(yr);
  };
  const a = fmtOne(minYear);
  const b = fmtOne(maxYear);
  if (!a) return b;
  if (!b || a === b) return a;
  return `${a} – ${b}`;
}

export function computeTimelineCanvasArticlesSignature(articles) {
  if (!Array.isArray(articles) || articles.length === 0) return '';
  const dateSig = (d) => (d ? `${d.year}_${d.month}_${d.day}_${d.hour ?? ''}_${d.minute ?? ''}_${d.precision || ''}` : '');
  return articles
    .map((a) => `${a.id}_${a.title}_${a.subtitle || ''}_${dateSig(a.from)}_${dateSig(a.to)}_${a.isToPresent ? 1 : 0}_${a.lane || ''}_${a.category || ''}_${a.rank || ''}`)
    .join('|');
}

export function updateCanvasArticleImageInPlace(tl, timelineData, articleId, imageFields = {}, hooks = {}) {
  const srcArt = timelineData?.articles?.find((a) => a && isSameArticleId(a.id, articleId));
  if (srcArt && imageFields && typeof imageFields === 'object') {
    Object.assign(srcArt, imageFields);
  }

  const art = tl?.articles?.find((a) => a && isSameArticleId(a.id, articleId));
  if (!tl || !art) return false;

  const rawImageUrl = typeof imageFields?.imageUrl === 'string' && imageFields.imageUrl.trim()
    ? imageFields.imageUrl.trim()
    : undefined;
  const resolveCanvasUrl = hooks.getCanvasImageUrl || getCanvasImageUrl;
  const canvasImageUrl = (rawImageUrl ? resolveCanvasUrl(rawImageUrl) : undefined) || undefined;
  const nextMediaType = imageFields?.mediaType || (
    typeof rawImageUrl === 'string' && (
      rawImageUrl.toLowerCase().startsWith('data:image/gif') ||
      rawImageUrl.toLowerCase().endsWith('.gif') ||
      rawImageUrl.toLowerCase().includes('.gif?')
    )
      ? 'gif'
      : 'image'
  );

  art._chronixFailedImageUrl = null;
  art._chronixRetryAfter = 0;
  art._lensMeasure = null;

  if (typeof art._imageCancel === 'function') {
    try { art._imageCancel(); } catch { }
    art._imageCancel = null;
  }
  art._pendingImageKey = null;
  if (typeof art._releaseImageResource === 'function') {
    try { art._releaseImageResource({ keepState: false, skipRedraw: true }); } catch { }
  }
  art.image = null;
  art.imageLoaded = false;
  art._loadedImageKey = null;

  if (art.data) {
    if (imageFields && typeof imageFields === 'object') {
      Object.assign(art.data, imageFields);
    }
    art.data.rawImageUrl = rawImageUrl;
    art.data.imageUrl = canvasImageUrl;
    art.data.mediaType = nextMediaType;
    if (imageFields && 'isEdited' in imageFields) {
      art.data.isEdited = Boolean(imageFields.isEdited);
    }
  }

  art.rawImageUrl = rawImageUrl;
  art.imageUrl = canvasImageUrl;
  art.mediaType = nextMediaType;
  if (imageFields && 'isEdited' in imageFields) {
    art.isEdited = Boolean(imageFields.isEdited);
    art.editedAt = imageFields.editedAt;
  }

  if (typeof art.initialiseStyles === 'function') {
    try { art.initialiseStyles(art.data); } catch { }
  }
  if (typeof art.invalidateCaches === 'function') {
    art.invalidateCaches();
  }
  if (typeof art.updateCachedSize === 'function') {
    try { art.updateCachedSize(); } catch { }
  }

  if (typeof hooks.syncLayouts === 'function') {
    hooks.syncLayouts(tl, art);
  }

  if (canvasImageUrl) {
    if (!tl._chronixPendingRestackIds) tl._chronixPendingRestackIds = new Set();
    tl._chronixPendingRestackIds.add(String(art.id));
  } else {
    tl._chronixPendingRestackIds?.delete?.(String(art.id));
  }

  if (typeof art.setImage === 'function') {
    art.setImage();
  } else if (canvasImageUrl && typeof tl.enqueueImageLoad === 'function') {
    tl.enqueueImageLoad(art);
  }

  if (typeof tl.defaultRedraw === 'function') {
    tl.defaultRedraw();
  } else {
    tl.redraw?.();
  }

  return true;
}

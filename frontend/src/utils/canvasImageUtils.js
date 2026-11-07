// Canvas image decoding, usability validation, and HistropediaJS lifecycle cleanup helpers.

export function isDataUrl(url) {
  return typeof url === 'string' && /^data:/i.test(url.trim());
}

export function isDataSvgUrl(url) {
  return typeof url === 'string' && /^data:image\/svg\+xml\b/i.test(url.trim());
}

export function decodeDataUrlToBlob(dataUrl) {
  if (!isDataUrl(dataUrl)) {
    throw new Error('Not a data URL');
  }
  const trimmed = dataUrl.trim();
  const commaIdx = trimmed.indexOf(',');
  if (commaIdx === -1) {
    throw new Error('Malformed data URL');
  }
  const meta = trimmed.slice(5, commaIdx);
  const rawPayload = trimmed.slice(commaIdx + 1);
  const parts = meta.split(';');
  const firstPart = (parts[0] || '').trim();
  const mime = firstPart && firstPart.includes('/') ? firstPart : 'application/octet-stream';
  const isBase64 = parts.some((p) => p.trim().toLowerCase() === 'base64');

  if (isBase64) {
    let clean = rawPayload.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    const mod = clean.length % 4;
    if (mod === 2) clean += '==';
    else if (mod === 3) clean += '=';
    else if (mod === 1) throw new Error('Invalid base64 data URL length');

    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  }

  const decoded = decodeURIComponent(rawPayload);
  return new Blob([decoded], { type: mime });
}

/**
 * Returns true only when `img` is a non-detached, non-broken drawable canvas image source.
 * When an `ImageBitmap` has `.close()` called on it, its `width` and `height` become `0`
 * and `ctx.drawImage(img, ...)` throws `InvalidStateError: The image source is detached`.
 */
export function isUsableCanvasImage(img) {
  if (!img || typeof img !== 'object') return false;
  if ('complete' in img && img.complete === false) return false;
  const isImgElement = 'naturalWidth' in img && 'complete' in img;
  const width = isImgElement ? img.naturalWidth : img.width;
  const height = isImgElement ? img.naturalHeight : img.height;
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;
}

/**
 * Ensures no Histropedia `Article` retains a reference to an evicted `ImageBitmap`
 * before `entry.close()` detaches it.
 */
export function scrubDetachedEntryFromArticles(key, entry) {
  if (!entry) return;
  if (entry.articles instanceof Set) {
    for (const art of Array.from(entry.articles)) {
      if (!art) continue;
      if (art.image === entry.image || (key && art._loadedImageKey === key)) {
        art.image = null;
        art.imageLoaded = false;
      }
      if (key && art._loadedImageKey === key) {
        art._loadedImageKey = null;
      }
      if (art._closeImage && (!key || art._closeImage._key === key)) {
        art._closeImage = null;
      }
    }
    entry.articles.clear();
  }
}

/**
 * Tears down all timers, global `window` PointerTracker listeners, animations,
 * article image references, and ImageBitmap caches for a Histropedia `Timeline` instance.
 */
export function disposeHistropediaTimeline(tl) {
  if (!tl) return;
  tl._chronixDisposed = true;
  tl._chronixDeferImageEnqueue = true;

  if (tl._chronixInitFrame != null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(tl._chronixInitFrame);
    tl._chronixInitFrame = null;
  }
  if (tl._chronixInitFitTimer) {
    clearTimeout(tl._chronixInitFitTimer);
    tl._chronixInitFitTimer = null;
  }
  if (tl._chronixGifTimer) {
    clearTimeout(tl._chronixGifTimer);
    tl._chronixGifTimer = null;
  }

  // Destroy Histropedia's PointerTracker so leaked `window` pointermove/pointerup/pointercancel
  // handlers never fire `redraw()` or `updateMouseoverArticle()` on a disposed timeline.
  if (tl._dragPointerTracker && typeof tl._dragPointerTracker.destroy === 'function') {
    try {
      tl._dragPointerTracker.destroy();
    } catch {
      // ignore teardown errors
    }
    tl._dragPointerTracker = null;
  }

  try { tl.stopAnimation?.(); } catch { }
  try { tl.stopPanAnimation?.(); } catch { }
  try { tl.stopZoomAnimation?.(); } catch { }

  if (tl.animation?.wheelZoomFrame != null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(tl.animation.wheelZoomFrame);
    tl.animation.wheelZoomFrame = null;
  }
  if (tl._navigationRequest) {
    tl._navigationRequest.cancelled = true;
    if (tl._navigationRequest.frame != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(tl._navigationRequest.frame);
    }
    tl._navigationRequest = null;
  }
  if (tl.canvas && tl._wheelHandler && typeof tl.canvas.removeEventListener === 'function') {
    try {
      tl.canvas.removeEventListener('wheel', tl._wheelHandler);
      tl.canvas.removeEventListener('DOMMouseScroll', tl._wheelHandler);
    } catch {
      // ignore
    }
  }

  if (Array.isArray(tl.articles)) {
    for (let i = 0; i < tl.articles.length; i += 1) {
      const art = tl.articles[i];
      if (!art) continue;
      if (typeof art._imageCancel === 'function') {
        try { art._imageCancel(); } catch { }
        art._imageCancel = null;
      }
      if (typeof art._releaseImageResource === 'function') {
        try { art._releaseImageResource({ keepState: false, skipRedraw: true }); } catch { }
      }
      art.image = null;
      art.imageLoaded = false;
      art._loadedImageKey = null;
      art._pendingImageKey = null;
      art._closeImage = null;
      if (typeof art.invalidateCaches === 'function') {
        try { art.invalidateCaches(); } catch { }
      }
    }
  }

  const loader = tl.imageLoader;
  if (loader) {
    if (Array.isArray(loader.queue)) {
      for (let i = 0; i < loader.queue.length; i += 1) {
        if (loader.queue[i]) loader.queue[i].cancelled = true;
      }
      loader.queue.length = 0;
    }
    if (loader.inflight?.values) {
      for (const entry of loader.inflight.values()) {
        if (Array.isArray(entry?.requests)) {
          for (let i = 0; i < entry.requests.length; i += 1) {
            if (entry.requests[i]) entry.requests[i].cancelled = true;
          }
        }
        try { entry?.controller?.abort?.(); } catch { }
      }
      loader.inflight.clear?.();
    }
    if (loader.cache?.entries && typeof loader._evictEntry === 'function') {
      for (const [key, entry] of Array.from(loader.cache.entries())) {
        scrubDetachedEntryFromArticles(key, entry);
        try { loader._evictEntry(key, entry); } catch { }
      }
    }
  }
}

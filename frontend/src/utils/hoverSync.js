/**
 * Lightweight imperative cross-hover channel between TimelineView (canvas)
 * and GeoMapView (Leaflet markers), avoiding full-tree React re-renders in App
 * on every pointer enter/leave across timeline cards or map pins.
 */
let currentHoveredArticleId = null;
const listeners = new Set();

export function getHoveredArticleId() {
  return currentHoveredArticleId;
}

export function setHoveredArticleId(articleId) {
  const next = articleId ?? null;
  if (
    currentHoveredArticleId === next ||
    (currentHoveredArticleId != null && next != null && String(currentHoveredArticleId) === String(next))
  ) {
    return;
  }
  currentHoveredArticleId = next;
  for (const listener of listeners) {
    try {
      listener(next);
    } catch {
      // ignore listener errors
    }
  }
}

export function clearHoveredArticleId() {
  setHoveredArticleId(null);
}

export function subscribeHoveredArticleId(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

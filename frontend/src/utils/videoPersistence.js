// The Videos tab caches its YouTube search results on the event (videos + videosQuery), so the
// next opening needs no search (P-10). That write used to save the whole timeline every time the
// tab found results. Now it is stored only when the list differs from the stored one, and the save
// is debounced, so opening several events' Videos tabs in a row costs one save.

const videoKey = (v) => {
  if (!v || typeof v !== 'object') return String(v ?? '');
  return String(v.videoId || v.id || v.url || '');
};

/** True when `items` for `query` differ from what the event already stores. */
export function videosChanged(article, query, items) {
  if (!article || typeof article !== 'object') return false;
  if ((article.videosQuery ?? null) !== (query ?? null)) return true;
  const stored = Array.isArray(article.videos) ? article.videos : null;
  const next = Array.isArray(items) ? items : null;
  if (!stored || !next) return stored !== next;
  if (stored.length !== next.length) return true;
  return stored.some((v, i) => videoKey(v) !== videoKey(next[i]));
}

export const VIDEO_SAVE_DEBOUNCE_MS = 1500;

/**
 * Per-timeline trailing debounce: `schedule(id, getLatest)` saves `getLatest()` once, `delayMs`
 * after the last call for that id, and only while it is still the same timeline.
 */
export function createDebouncedTimelineSaver(save, {
  delayMs = VIDEO_SAVE_DEBOUNCE_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle),
} = {}) {
  const timers = new Map();
  return {
    schedule(timelineId, getLatest) {
      if (timelineId == null) return;
      const key = String(timelineId);
      if (timers.has(key)) clearTimer(timers.get(key));
      timers.set(key, setTimer(() => {
        timers.delete(key);
        const latest = getLatest();
        if (latest && String(latest.id) === key) save(latest);
      }, delayMs));
    },
    cancelAll() {
      for (const handle of timers.values()) clearTimer(handle);
      timers.clear();
    },
    pending() {
      return timers.size;
    },
  };
}

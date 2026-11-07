// Chat-edit undo (B-08). Pure: no React / browser imports.
//
// Only the latest AI edit can be undone, and only while the timeline is still exactly what that
// edit produced: undoing an older edit (or after other changes) would restore a whole-timeline
// snapshot over newer work. The snapshot is kept in memory only, without inline data: media —
// that media is restored from the current timeline by event id when undoing.

// Fields a cosmetic / automatic save touches (Videos-tab cache, drag-to-reframe): changing them
// doesn't block undo, and undo keeps their current values.
const COSMETIC_ARTICLE_KEYS = new Set(['videos', 'videosQuery', 'imagePositionX', 'imagePositionY']);
const CONTENT_TIMELINE_KEYS = ['id', 'title', 'description', 'overview', 'timeScale', 'lanes', 'timeBands'];
const MEDIA_KEYS = ['imageUrl', 'additionalImages'];

export const MEDIA_FROM_CURRENT = '__chronix_media_from_current__';

const isDataUrl = (val) => typeof val === 'string' && val.startsWith('data:');

const hasInlineMedia = (val) => (
  isDataUrl(val) ||
  (Array.isArray(val) && val.some((item) => isDataUrl(typeof item === 'string' ? item : item?.url)))
);

function sameMedia(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((item, i) => {
    const other = b[i];
    if (item === other) return true;
    if (typeof item === 'string' || typeof other === 'string') return item === other;
    return item?.url === other?.url && item?.caption === other?.caption;
  });
}

const byId = (articles) => {
  const map = new Map();
  for (const art of Array.isArray(articles) ? articles : []) {
    if (art && art.id != null && !map.has(String(art.id))) map.set(String(art.id), art);
  }
  return map;
};

/**
 * The pre-edit timeline without inline data: media that the edit left in place (it is restored
 * from the current timeline on undo). Media of events the edit removed is kept, since it can't be
 * restored from anywhere else. Every event is copied, so later in-place updates can't reach it.
 */
export function stripSnapshotMedia(before, after) {
  if (!before || typeof before !== 'object') return before;
  const afterById = byId(after?.articles);
  const articles = (Array.isArray(before.articles) ? before.articles : []).map((art) => {
    if (!art || typeof art !== 'object') return art;
    const copy = { ...art };
    const afterArt = art.id != null ? afterById.get(String(art.id)) : null;
    if (afterArt) {
      for (const key of MEDIA_KEYS) {
        if (hasInlineMedia(art[key]) && sameMedia(art[key], afterArt[key])) copy[key] = MEDIA_FROM_CURRENT;
      }
    }
    return copy;
  });
  const { quiz: _q, whoami: _w, podcast: _p, ...rest } = before;
  return { ...rest, articles, _keptFromCurrent: ['quiz', 'whoami', 'podcast'] };
}

/** Rebuilds the full pre-edit timeline from a stripped snapshot plus the current timeline. */
export function restoreSnapshotMedia(snapshot, current) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const currentById = byId(current?.articles);
  const { _keptFromCurrent: kept = [], ...rest } = snapshot;
  const restored = { ...rest };
  for (const key of kept) {
    if (current && current[key] !== undefined) restored[key] = current[key];
  }
  restored.articles = (Array.isArray(rest.articles) ? rest.articles : []).map((art) => {
    if (!art || typeof art !== 'object') return art;
    const cur = art.id != null ? currentById.get(String(art.id)) : null;
    const next = { ...art };
    for (const key of MEDIA_KEYS) {
      if (next[key] === MEDIA_FROM_CURRENT) {
        if (cur && cur[key] !== undefined) next[key] = cur[key];
        else delete next[key];
      }
    }
    if (cur) {
      // Cosmetic data cached after the edit (e.g. a Videos-tab search) is not rolled back.
      for (const key of COSMETIC_ARTICLE_KEYS) {
        if (cur[key] !== undefined) next[key] = cur[key];
      }
    }
    return next;
  });
  return restored;
}

function sameArticleIgnoringCosmetic(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (COSMETIC_ARTICLE_KEYS.has(key)) continue;
    if (a[key] !== b[key] && !(a[key] == null && b[key] == null)) return false;
  }
  return true;
}

/** True when `current` is still the state the edit produced (cosmetic event fields aside). */
export function isTimelineUnchangedSince(current, after) {
  if (!current || !after) return false;
  if (current === after) return true;
  for (const key of CONTENT_TIMELINE_KEYS) {
    if (current[key] !== after[key]) return false;
  }
  const a = Array.isArray(current.articles) ? current.articles : [];
  const b = Array.isArray(after.articles) ? after.articles : [];
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((art, i) => sameArticleIgnoringCosmetic(art, b[i]));
}

/**
 * Undo record for the latest AI edit: `before` is the state just before the edit was applied
 * (so concurrent edits are not rolled back), `after` the state it produced.
 */
export function createChatUndoEntry({ messageId, timelineId, before, after }) {
  if (!messageId || !before || !after) return null;
  return { messageId, timelineId: timelineId ?? after.id ?? null, snapshot: stripSnapshotMedia(before, after), after };
}

/** The one message whose Undo is available right now, or null. */
export function undoableChatMessageId(entry, currentTimeline) {
  if (!entry || !currentTimeline) return null;
  if (String(entry.timelineId) !== String(currentTimeline.id)) return null;
  return isTimelineUnchangedSince(currentTimeline, entry.after) ? entry.messageId : null;
}

// Navigation trail for the left side panel (bottom sheet on mobile). The panel is one
// container whose content switches between sections - event details, events list,
// overview, games - so it keeps a browser-like history that powers its Back/Forward
// controls. Entries are plain objects:
//   { kind: 'event', id }      event details
//   { kind: 'list' }           events list
//   { kind: 'overview' }       timeline overview
//   { kind: 'games', game }    games hub ('hub') or a specific game
// `index === -1` means the panel is closed.

export const PANEL_HISTORY_LIMIT = 30;

export const EMPTY_PANEL_HISTORY = Object.freeze({ entries: Object.freeze([]), index: -1 });

export function isSamePanelEntry(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'event') return String(a.id) === String(b.id);
  if (a.kind === 'games') return (a.game || 'hub') === (b.game || 'hub');
  return true;
}

export function getCurrentPanel(history) {
  if (!history || history.index < 0) return null;
  return history.entries[history.index] || null;
}

export function getPreviousPanel(history) {
  if (!history || history.index < 1) return null;
  return history.entries[history.index - 1] || null;
}

export function getNextPanel(history) {
  if (!history || history.index < 0) return null;
  return history.entries[history.index + 1] || null;
}

// Drops consecutive duplicates (left behind by removals) while keeping `index` on the same entry.
function collapse(entries, index) {
  const out = [];
  let nextIndex = -1;
  entries.forEach((entry, i) => {
    if (out.length && isSamePanelEntry(out[out.length - 1], entry)) {
      if (i === index) nextIndex = out.length - 1;
      return;
    }
    out.push(entry);
    if (i === index) nextIndex = out.length - 1;
  });
  return { entries: out, index: out.length ? nextIndex : -1 };
}

// Opens `entry` as a new step. Forward entries are discarded (like a browser). Moving from one
// event straight to another (Prev/Next, picking another card) swaps the open event in place, so
// Back always returns to a different context instead of walking through every event viewed.
// Re-visiting a destination already in the trail moves it to the top rather than duplicating it.
export function pushPanel(history, entry) {
  if (!entry) return history;
  const current = getCurrentPanel(history);
  if (current && isSamePanelEntry(current, entry)) return history;

  const kept = history.entries.slice(0, history.index + 1);
  if (current && current.kind === 'event' && entry.kind === 'event') {
    kept[kept.length - 1] = entry;
  } else {
    kept.push(entry);
  }

  const lastIndex = kept.length - 1;
  const deduped = kept.filter((item, i) => i === lastIndex || !isSamePanelEntry(item, entry));
  const { entries } = collapse(deduped, deduped.length - 1);
  const trimmed = entries.length > PANEL_HISTORY_LIMIT
    ? entries.slice(entries.length - PANEL_HISTORY_LIMIT)
    : entries;
  return { entries: trimmed, index: trimmed.length - 1 };
}

export function canGoBack(history) {
  return Boolean(history && history.index > 0);
}

export function canGoForward(history) {
  return Boolean(history && history.index >= 0 && history.index < history.entries.length - 1);
}

export function goBackPanel(history) {
  return canGoBack(history) ? { entries: history.entries, index: history.index - 1 } : history;
}

export function goForwardPanel(history) {
  return canGoForward(history) ? { entries: history.entries, index: history.index + 1 } : history;
}

// Removes entries matching `predicate` (e.g. a deleted event). If the current entry is removed,
// the panel falls back to the nearest earlier entry (or closes when none is left).
export function removePanelEntries(history, predicate) {
  if (!history || history.index < 0) return history;
  if (!history.entries.some(predicate)) return history;
  const entries = [];
  let index = -1;
  history.entries.forEach((entry, i) => {
    const removed = predicate(entry);
    if (!removed) entries.push(entry);
    if (i <= history.index && !removed) index = entries.length - 1;
  });
  if (index < 0) return EMPTY_PANEL_HISTORY;
  return collapse(entries, index);
}

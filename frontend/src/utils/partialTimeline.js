// A generation's preview (P-03): the timeline's titles, dates and lanes, shown read-only while the
// job is still adding Wikipedia images and links. It is never saved (the save queue refuses any
// timeline with `isPartial`), and the finished result replaces it.
import { isPartialTimeline } from './saveQueue.js';

export { isPartialTimeline };

/** The read-only preview for a job's `partial` payload, or null when there is nothing to show. */
export function toPartialPreview(partial) {
  if (!partial || typeof partial !== 'object' || !Array.isArray(partial.articles) || partial.articles.length === 0) {
    return null;
  }
  return { ...partial, isPartial: true };
}

/**
 * Tracks the preview of one generation.
 *  - getCurrent() / setCurrent(t): the open timeline (App's ref-backed state).
 *  - isActive(): false once this generation was superseded or stopped.
 * show(partial) displays a preview (never after finish()/discard()); finish() is called when the
 * final result arrives; discard() removes a preview that is still on screen (job failed or was
 * stopped) and puts back whatever was open before it.
 */
export function createPartialPreviewTracker({ getCurrent, setCurrent, isActive = () => true }) {
  let shown = null;
  let previous = null;
  let settled = false;

  const isShowing = () => {
    const current = getCurrent();
    return Boolean(shown && isPartialTimeline(current) && String(current.id) === String(shown.id));
  };

  return {
    show(partial) {
      if (settled || !isActive()) return null;
      const preview = toPartialPreview(partial);
      if (!preview) return null;
      if (!shown) previous = getCurrent() ?? null;
      const replacingOwnPreview = isShowing();
      shown = preview;
      setCurrent(preview, { replacingOwnPreview });
      return preview;
    },
    /** True while this generation's preview is the open timeline. */
    isShowing,
    /** The id of the preview on screen, if any. */
    shownId() {
      return isShowing() ? shown.id : null;
    },
    finish() {
      settled = true;
    },
    discard() {
      settled = true;
      const wasShowing = isShowing();
      shown = null;
      if (wasShowing) setCurrent(isPartialTimeline(previous) ? null : previous, { restoring: true });
      return wasShowing;
    },
  };
}

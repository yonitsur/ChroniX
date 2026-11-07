// Split-pane (map above, timeline below) geometry and drag helpers.

export const SPLIT_RATIO_MIN = 15;
export const SPLIT_RATIO_MAX = 85;

// Height of the divider bar (h-6 on narrow screens, h-3.5 otherwise) that the timeline pane gives up.
export function getTimelinePaneHeight(ratio, isNarrowViewport) {
  return `calc(${100 - ratio}% - ${isNarrowViewport ? 24 : 14}px)`;
}

// Map pane share (%) for a pointer at clientY inside the split container, clamped; null when
// the container has no usable height.
export function computeSplitRatioFromClientY(container, clientY, getStyle) {
  if (!container) return null;
  const rect = container.getBoundingClientRect();
  const style = (getStyle || window.getComputedStyle)(container);
  const topPad = parseFloat(style.paddingTop) || 0;
  const bottomPad = parseFloat(style.paddingBottom) || 0;
  const usableHeight = rect.height - topPad - bottomPad;
  if (!(usableHeight > 0) || !Number.isFinite(clientY)) return null;
  const percent = ((clientY - rect.top - topPad) / usableHeight) * 100;
  return Math.min(Math.max(percent, SPLIT_RATIO_MIN), SPLIT_RATIO_MAX);
}

// Coalesces drag updates to one apply() per animation frame. flush() applies a pending value
// right away (used on pointer-up so the committed ratio matches what was last shown).
export function createFrameThrottle(apply, {
  requestFrame = (cb) => requestAnimationFrame(cb),
  cancelFrame = (id) => cancelAnimationFrame(id),
} = {}) {
  let frame = 0;
  let pending = null;
  let hasPending = false;
  const run = () => {
    frame = 0;
    if (!hasPending) return;
    hasPending = false;
    apply(pending);
  };
  return {
    schedule(value) {
      pending = value;
      hasPending = true;
      if (!frame) frame = requestFrame(run);
    },
    flush() {
      if (frame) {
        cancelFrame(frame);
        frame = 0;
      }
      run();
    },
    cancel() {
      if (frame) cancelFrame(frame);
      frame = 0;
      hasPending = false;
    },
  };
}

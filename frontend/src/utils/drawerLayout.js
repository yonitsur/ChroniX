export const EVENT_DRAWER_MIN_WIDTH = 380;
export const EVENT_DRAWER_MAX_WIDTH = 1000;
export const EVENT_DRAWER_KEY_STEP = 24;

// Leaves room for the 52px left dock plus a usable slice of the timeline.
export function clampEventDrawerWidth(width) {
  if (typeof window === 'undefined') {
    return Math.round(Math.max(EVENT_DRAWER_MIN_WIDTH, Math.min(width, EVENT_DRAWER_MAX_WIDTH)));
  }
  const viewportMax = Math.max(280, window.innerWidth - 52 - 220);
  const minW = Math.min(EVENT_DRAWER_MIN_WIDTH, viewportMax);
  return Math.round(Math.max(minW, Math.min(width, EVENT_DRAWER_MAX_WIDTH, viewportMax)));
}

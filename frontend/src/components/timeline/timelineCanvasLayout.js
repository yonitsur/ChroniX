// Static height thresholds for card layouts. Automatic mode is normally decided by the
// density-aware planner in `cardLayoutPlanner.js`; these breakpoints are only the
// Histropedia fallback (`options.article.cardLayoutBreakpoints`) before the first plan
// exists, and the basis of the local canFit* helpers.
export const AUTO_COMPACT_MAX_HEIGHT = 120;
export const AUTO_LANDSCAPE_MAX_HEIGHT = 500;

// A single isolated card (tap-to-expand in Compact/Small mode) only has to fit itself,
// not a stack of rows, so it uses looser clearances than the breakpoints above.
export const SINGLE_LARGE_CARD_MIN_HEIGHT = 280;
export const SINGLE_LANDSCAPE_CARD_MIN_HEIGHT = 110;

// The engine picks the first rule whose `maxHeight` is >= the available height and
// falls back to `defaultCardLayout` ('portrait') when none match.
export const VISUAL_CARD_LAYOUT_BREAKPOINTS = [
  { maxHeight: AUTO_COMPACT_MAX_HEIGHT, layout: 'compact' },
  { maxHeight: AUTO_LANDSCAPE_MAX_HEIGHT, layout: 'landscape' },
];

// "Focus Lens" layout planner for narrow (mobile) timelines.
//
// Every in-range event gets a tier based on its distance from the screen centre:
//   focus  - the single event nearest the centre, drawn as a large card above the axis
//   chip   - small title pill for on-screen events
//   bubble - round image / initial marker
//   dot    - tiny marker sitting on the axis (never collides)
// Cards are packed in 2D around the axis so that no card overlaps another card or
// another card's stem. Coordinates are canvas pixels; vertical values are relative
// to the axis (negative = above).

export const LENS_DEFAULTS = Object.freeze({
  focusRadiusRatio: 0.32,
  hysteresisPx: 24,
  maxChips: 6,
  padding: 6,
  edgeMargin: 8,
  stemInset: 10,
  offscreenMarginRatio: 0.5,
});

export const LENS_TIERS = Object.freeze(['focus', 'focusRow', 'chip', 'bubble', 'dot']);

function distance(item, centerX) {
  return Math.abs(item.x - centerX);
}

function comparePriority(a, b) {
  return (b.priority || 0) - (a.priority || 0);
}

// Picks the focus event: nearest to the centre within the focus radius. The previous
// focus is kept unless another event is closer by more than `hysteresisPx`.
export function pickFocus(items, { width, centerX, previousFocusId = null, options = {} } = {}) {
  const opts = { ...LENS_DEFAULTS, ...options };
  const radius = width * opts.focusRadiusRatio;
  let best = null;
  let bestDist = Infinity;
  let previous = null;
  for (const item of items) {
    const d = distance(item, centerX);
    if (d > radius) continue;
    if (item.id === previousFocusId) previous = item;
    if (d < bestDist - 0.5 || (Math.abs(d - bestDist) <= 0.5 && best && comparePriority(item, best) < 0)) {
      best = item;
      bestDist = d;
    }
  }
  if (previous && best && previous !== best && distance(previous, centerX) <= bestDist + opts.hysteresisPx) {
    return previous;
  }
  return best;
}

function rectsOverlap(a, b, pad) {
  return a.left < b.left + b.width + pad
    && a.left + a.width + pad > b.left
    && a.top < b.top + b.height + pad
    && a.top + a.height + pad > b.top;
}

function stemHitsRect(stem, rect, pad) {
  if (stem.x < rect.left - pad || stem.x > rect.left + rect.width + pad) return false;
  const y1 = Math.min(stem.y1, stem.y2);
  const y2 = Math.max(stem.y1, stem.y2);
  return y2 > rect.top - pad && y1 < rect.top + rect.height + pad;
}

// Horizontal placement: centred on the anchor, kept on screen, and always keeping the
// anchor (stem) inside the card so the stem can drop straight down to the axis.
export function placeHorizontally(x, cardWidth, width, { edgeMargin = LENS_DEFAULTS.edgeMargin, stemInset = LENS_DEFAULTS.stemInset } = {}) {
  let left = x - cardWidth / 2;
  const minLeft = edgeMargin;
  const maxLeft = width - edgeMargin - cardWidth;
  if (maxLeft >= minLeft) left = Math.min(Math.max(left, minLeft), maxLeft);
  const inset = Math.min(stemInset, cardWidth / 2);
  left = Math.min(Math.max(left, x - cardWidth + inset), x - inset);
  return left;
}

function rectForOffset(side, offset, left, size) {
  const top = side === 'above' ? -(offset + size.height) : offset;
  return { left, top, width: size.width, height: size.height };
}

function stemForRect(side, x, rect, axisGap) {
  return side === 'above'
    ? { x, y1: -axisGap, y2: rect.top + rect.height }
    : { x, y1: axisGap, y2: rect.top };
}

class SidePacker {
  constructor(side, { minOffset, maxExtent, axisGap = 0 }, padding) {
    this.side = side;
    this.minOffset = minOffset;
    this.maxExtent = maxExtent;
    this.axisGap = axisGap;
    this.padding = padding;
    this.rects = [];
    this.stems = [];
  }

  tryPlace(x, left, size) {
    const candidates = [this.minOffset];
    for (const r of this.rects) {
      const far = this.side === 'above' ? -r.top : r.top + r.height;
      candidates.push(far + this.padding);
    }
    candidates.sort((a, b) => a - b);
    for (const offset of candidates) {
      if (offset < this.minOffset) continue;
      if (offset + size.height > this.maxExtent) break;
      const rect = rectForOffset(this.side, offset, left, size);
      const stem = stemForRect(this.side, x, rect, this.axisGap);
      if (this.rects.some((r) => rectsOverlap(rect, r, this.padding))) continue;
      if (this.stems.some((s) => stemHitsRect(s, rect, this.padding / 2))) continue;
      if (this.rects.some((r) => stemHitsRect(stem, r, 1))) continue;
      this.rects.push(rect);
      this.stems.push(stem);
      return { ...rect, offset };
    }
    return null;
  }
}

/**
 * @param {object} params
 * @param {Array<{id:string|number,x:number,priority?:number,chronoIndex?:number}>} params.items
 * @param {number} params.width          canvas width
 * @param {number} [params.centerX]      lens centre (defaults to width / 2)
 * @param {{above:{minOffset:number,maxExtent:number,axisGap?:number}, below?:{minOffset:number,maxExtent:number,axisGap?:number}|null}} params.sides
 * @param {string|number|null} [params.previousFocusId]
 * @param {string|number|null} [params.forcedFocusId] event that must be the focus (e.g. during a pan-to animation)
 * @param {(item:object, tier:string)=>{width:number,height:number}} params.measure
 * @param {(item:object)=>'above'|'below'} [params.assignSide] fixed side for non-focus events
 *   when both sides exist (default: alternate by chronological index)
 * @returns {{focusId:string|number|null, placements:Map}}
 */
export function planFocusLens({
  items,
  width,
  centerX = width / 2,
  sides,
  previousFocusId = null,
  forcedFocusId = null,
  measure,
  assignSide = null,
  options = {},
}) {
  const opts = { ...LENS_DEFAULTS, ...options };
  const placements = new Map();
  const above = new SidePacker('above', sides.above, opts.padding);
  const below = sides.below ? new SidePacker('below', sides.below, opts.padding) : null;

  const forced = forcedFocusId != null ? items.find((i) => i.id === forcedFocusId) : null;
  const focus = forced || pickFocus(items, { width, centerX, previousFocusId, options: opts });

  const placeDot = (item) => {
    const size = measure(item, 'dot');
    placements.set(item.id, {
      tier: 'dot',
      side: 'axis',
      left: item.x - size.width / 2,
      top: -size.height / 2,
      width: size.width,
      height: size.height,
      offset: 0,
    });
  };

  if (focus) {
    let placed = null;
    for (const tier of ['focus', 'focusRow']) {
      const size = measure(focus, tier);
      const left = placeHorizontally(focus.x, size.width, width, opts);
      const rect = above.tryPlace(focus.x, left, size);
      if (rect) {
        placed = { tier, side: 'above', ...rect };
        break;
      }
    }
    if (placed) placements.set(focus.id, placed);
  }

  const offscreen = width * opts.offscreenMarginRatio;
  const rest = items
    .filter((item) => item !== focus)
    .sort((a, b) => distance(a, centerX) - distance(b, centerX) || comparePriority(a, b));

  let chips = 0;
  for (const item of rest) {
    const onScreen = item.x >= 0 && item.x <= width;
    const nearScreen = item.x >= -offscreen && item.x <= width + offscreen;
    if (!nearScreen) {
      placeDot(item);
      continue;
    }
    let packer = above;
    if (below) {
      const side = assignSide ? assignSide(item) : ((item.chronoIndex ?? 0) % 2 === 0 ? 'above' : 'below');
      packer = side === 'below' ? below : above;
    }
    const tiers = onScreen && chips < opts.maxChips ? ['chip', 'bubble'] : ['bubble'];
    let placed = null;
    for (const tier of tiers) {
      const size = measure(item, tier);
      const left = placeHorizontally(item.x, size.width, width, opts);
      const rect = packer.tryPlace(item.x, left, size);
      if (rect) {
        placed = { tier, side: packer.side, ...rect };
        break;
      }
    }
    if (!placed) {
      placeDot(item);
      continue;
    }
    if (placed.tier === 'chip') chips += 1;
    placements.set(item.id, placed);
  }

  return { focusId: focus && placements.has(focus.id) ? focus.id : null, placements };
}

// Nearest event to the centre within `maxDistance` px (used for snap-after-drag).
export function findNearestItem(items, centerX, maxDistance = Infinity) {
  let best = null;
  let bestDist = Infinity;
  for (const item of items) {
    const d = distance(item, centerX);
    if (d <= maxDistance && (d < bestDist || (d === bestDist && best && comparePriority(item, best) < 0))) {
      best = item;
      bestDist = d;
    }
  }
  return best;
}

export const LENS_SWIPE_DEFAULTS = Object.freeze({
  // A release shorter than this only counts as a swipe if it was also a quick flick.
  minStepPx: 18,
  minStepVelocity: 0.25, // px/ms
  // Drags longer than min(maxStepPx, maxStepRatio * width) scroll the timeline freely.
  maxStepRatio: 0.35,
  maxStepPx: 180,
});

// Classifies a finished horizontal drag on the lens. `dx` and `velocity` are positive
// when the content moved left (towards later events).
//   step   - short deliberate swipe: move exactly one event in `direction` (+1 / -1)
//   scroll - long, pronounced swipe: free pan with momentum, then snap
//   settle - too small to be a swipe: just snap back to the nearest event
export function classifyLensSwipe({ dx = 0, velocity = 0, width = 0, options = {} } = {}) {
  const opts = { ...LENS_SWIPE_DEFAULTS, ...options };
  const distancePx = Math.abs(Number(dx) || 0);
  const speed = Number(velocity) || 0;
  const maxStep = Math.min(opts.maxStepPx, Math.max(0, width) * opts.maxStepRatio || opts.maxStepPx);
  if (distancePx > maxStep) return { kind: 'scroll' };
  if (distancePx >= opts.minStepPx) return { kind: 'step', direction: dx > 0 ? 1 : -1 };
  if (Math.abs(speed) >= opts.minStepVelocity) return { kind: 'step', direction: speed > 0 ? 1 : -1 };
  return { kind: 'settle' };
}

// Chronological neighbour of `currentId` in direction `dir` (+1 next, -1 previous).
// Items must be sorted chronologically. With no current item, picks the first event
// beyond the centre in the requested direction.
export function findAdjacentItem(sortedItems, currentId, dir, centerX = null) {
  if (!sortedItems.length) return null;
  const index = sortedItems.findIndex((item) => item.id === currentId);
  if (index >= 0) {
    const next = sortedItems[index + dir];
    return next || null;
  }
  if (centerX == null) return dir > 0 ? sortedItems[0] : sortedItems[sortedItems.length - 1];
  if (dir > 0) return sortedItems.find((item) => item.x > centerX + 1) || null;
  for (let i = sortedItems.length - 1; i >= 0; i -= 1) {
    if (sortedItems[i].x < centerX - 1) return sortedItems[i];
  }
  return null;
}

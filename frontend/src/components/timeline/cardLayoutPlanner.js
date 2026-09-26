// Pure, engine-independent card layout planning for the desktop timeline canvas.
//
// A "slot" is one lane body (split timelines) or the whole canvas (single timeline).
// For every candidate layout the planner measures what the slot's cards would DEMAND:
// how many cascaded rows their horizontal overlap forces, how tall the tallest card is,
// and how much clearance the axis needs (period-line band + connector arrow). The
// richest layout whose demand fits the slot wins, and the same plan then dictates the
// distance from the axis to the first row and the spacing between rows, so the layout
// choice, the reserved space and the stacking can never disagree.

// Richest first. Every tier shows an image (compact cards carry a thumbnail).
export const CARD_LAYOUT_TIERS = ['portrait', 'landscape', 'compact'];

// minReveal:     smallest row offset that still shows a legible strip of the card behind
//                (portrait: its whole title header, landscape/compact: the first title line).
// rowGap:        gap between rows once there is room to show every card in full.
// baseClearance: minimum space between a card bottom and the axis (connector + arrow).
// bandClearance: space kept above the stacked period-line band when it is taller.
// maxLift:       most spare height used to lift the cards off the axis, so a sparse
//                slot is not left with all its cards sunk at the bottom.
export const LAYOUT_METRICS = {
  portrait: { minReveal: 56, rowGap: 10, baseClearance: 56, bandClearance: 26, maxLift: 110, score: 3 },
  landscape: { minReveal: 30, rowGap: 10, baseClearance: 46, bandClearance: 22, maxLift: 80, score: 2 },
  compact: { minReveal: 26, rowGap: 8, baseClearance: 32, bandClearance: 18, maxLift: 56, score: 1 },
};

// Upgrading to a richer layout needs this much room to spare, and the current layout is
// kept until it overflows by half of it, so a slot never flickers between two layouts.
export const LAYOUT_HYSTERESIS = 24;
// Score of a slot whose cards do not fit even in its poorest layout (squeezed rows).
export const OVERFLOW_SCORE = -2;
const LIFT_RATIO = 0.35;
const MIN_ROW_SPACING = 12;

function tierIndex(layout) {
  const index = CARD_LAYOUT_TIERS.indexOf(layout);
  return index < 0 ? CARD_LAYOUT_TIERS.length : index;
}

// First-fit row assignment, mirroring Histropedia's `stack()`: a card joins the first row
// in which it overlaps no card horizontally (edges touching count as overlap).
// `cards` must already be in stacking priority order. Returns each card's row index.
export function assignStackRows(cards) {
  const rows = [];
  const assigned = new Array(cards.length);
  for (let i = 0; i < cards.length; i++) {
    const left = cards[i].left;
    const right = left + cards[i].width;
    let rowIndex = -1;
    for (let r = 0; r < rows.length && rowIndex < 0; r++) {
      const occupied = rows[r];
      let free = true;
      for (let k = 0; k < occupied.length; k++) {
        if (occupied[k].right >= left && right >= occupied[k].left) {
          free = false;
          break;
        }
      }
      if (free) rowIndex = r;
    }
    if (rowIndex < 0) {
      rowIndex = rows.length;
      rows.push([]);
    }
    rows[rowIndex].push({ left, right });
    assigned[i] = rowIndex;
  }
  return assigned;
}

export function countStackRows(cards) {
  return assignStackRows(cards).reduce((max, row) => Math.max(max, row + 1), 0);
}

// Height a slot needs to show `cards` in `layout` with every row at least legible.
// Independent of the slot's actual height, so demands can be compared across lanes.
// `baseHeight` is how far the cards reach below the first row's top: a tall card in a
// raised row is lifted by at least its row offset, so it does not need the full band.
export function measureLayoutDemand({ cards, layout, periodBandHeight = 0, topGap = 0 }) {
  const metrics = LAYOUT_METRICS[layout];
  const assigned = assignStackRows(cards);
  let rows = 0;
  let tallest = 0;
  let baseHeight = 0;
  for (let i = 0; i < cards.length; i++) {
    rows = Math.max(rows, assigned[i] + 1);
    tallest = Math.max(tallest, cards[i].height);
    baseHeight = Math.max(baseHeight, cards[i].height - assigned[i] * metrics.minReveal);
  }
  const clearance = Math.max(metrics.baseClearance, periodBandHeight + metrics.bandClearance);
  const need = rows === 0 ? 0 : topGap + baseHeight + clearance + (rows - 1) * metrics.minReveal;
  return { layout, rows, tallest, baseHeight, clearance, need, topGap };
}

export function chooseCardLayout({
  availableHeight,
  demands,
  candidates = CARD_LAYOUT_TIERS,
  previous = null,
  hysteresis = LAYOUT_HYSTERESIS,
}) {
  const usable = candidates.filter((layout) => demands[layout]);
  if (usable.length === 0) return candidates[candidates.length - 1] || 'portrait';
  // Nothing to place (e.g. panned over an empty stretch): keep the current layout
  // rather than flipping to the richest one and back as events scroll in again.
  if (previous && usable.includes(previous) && usable.every((layout) => demands[layout].rows === 0)) {
    return previous;
  }
  for (let i = 0; i < usable.length; i++) {
    const layout = usable[i];
    let margin = 0;
    if (previous && usable.includes(previous)) {
      if (tierIndex(layout) < tierIndex(previous)) margin = hysteresis;
      else if (layout === previous) margin = -hysteresis / 2;
    }
    if (demands[layout].need + margin <= availableHeight) return layout;
  }
  return usable[usable.length - 1];
}

// Row offset for `rows` cascaded rows once the first row sits `distance` above the axis:
// spread to fill the slot, but never further apart than needed to show every card whole.
export function resolveRowSpacing({ availableHeight, distance, topGap = 0, rows, layout, tallest = 0 }) {
  const metrics = LAYOUT_METRICS[layout] || LAYOUT_METRICS.portrait;
  const fullReveal = Math.max(metrics.minReveal, Math.round(tallest + metrics.rowGap));
  if (!(rows > 1)) return fullReveal;
  const stackingSpace = availableHeight - topGap - distance;
  return Math.max(MIN_ROW_SPACING, Math.min(fullReveal, Math.floor(stackingSpace / (rows - 1))));
}

// Full plan for one slot: layout + distance from the axis to the top of the first row.
// Spare height first spreads the rows apart (up to full reveal) and only what is left
// lifts the whole group off the axis.
export function planSlot({ availableHeight, demands, candidates = CARD_LAYOUT_TIERS, previous = null }) {
  const layout = chooseCardLayout({ availableHeight, demands, candidates, previous });
  const demand = demands[layout];
  const metrics = LAYOUT_METRICS[layout];
  const base = demand.baseHeight + demand.clearance;
  let lift = 0;
  const slack = availableHeight - demand.need;
  if (demand.rows > 0 && slack > 0) {
    const fullReveal = Math.max(metrics.minReveal, demand.tallest + metrics.rowGap);
    const spreadUse = demand.rows > 1 ? Math.min(slack, (fullReveal - metrics.minReveal) * (demand.rows - 1)) : 0;
    lift = Math.min(metrics.maxLift, Math.round((slack - spreadUse) * LIFT_RATIO));
  }
  const ceiling = availableHeight - demand.topGap;
  const distance = Math.round(Math.max(Math.min(base + lift, ceiling), demand.baseHeight + 8));
  return {
    layout,
    distance,
    rows: demand.rows,
    tallest: demand.tallest,
    clearance: demand.clearance,
    topGap: demand.topGap,
    availableHeight,
    overflow: demand.need > availableHeight,
    demands,
  };
}

// Splits the lane body height between lanes according to what their cards need.
// Equal lanes are the default; heights are only redistributed when doing so lets the
// timeline show richer cards overall (or stops a lane from overflowing), e.g. a sparse
// lane can hand space to a crowded one. Returns `{ heights, layouts }` (body heights and
// the layout each lane was sized for, aligned with `lanes`), or null to keep equal lanes.
export function allocateLaneHeights({
  totalHeight,
  lanes,
  candidates = CARD_LAYOUT_TIERS,
  minHeight = 84,
  hysteresis = LAYOUT_HYSTERESIS,
  maxLanes = 6,
}) {
  const count = Array.isArray(lanes) ? lanes.length : 0;
  if (count < 2 || count > maxLanes || !(totalHeight > 0)) return null;
  const equalHeight = totalHeight / count;
  const options = lanes.map((lane) => candidates
    .filter((layout) => lane?.demands?.[layout])
    .map((layout) => {
      const need = lane.demands[layout].need;
      return {
        layout,
        need,
        required: Math.max(minHeight, need + hysteresis),
        score: LAYOUT_METRICS[layout].score,
      };
    }));
  if (options.some((laneOptions) => laneOptions.length === 0)) return null;

  // Judge the equal split by the same margin the lanes need to actually switch layout.
  const equalScore = options.reduce((sum, laneOptions) => {
    const fit = laneOptions.find((option) => option.required <= equalHeight);
    return sum + (fit ? fit.score : OVERFLOW_SCORE);
  }, 0);

  // Among equally rich combinations prefer the most even split, so lanes only become
  // as unequal as the gain requires.
  let best = null;
  const picks = new Array(count);
  const walk = (index, used, score, deviation) => {
    if (used > totalHeight) return;
    if (index === count) {
      if (!best || score > best.score || (score === best.score && deviation < best.deviation)) {
        best = { score, used, deviation, picks: picks.slice() };
      }
      return;
    }
    const laneOptions = options[index];
    for (let i = 0; i < laneOptions.length; i++) {
      const option = laneOptions[i];
      picks[index] = option;
      walk(
        index + 1,
        used + option.required,
        score + option.score,
        Math.max(deviation, Math.abs(option.required - equalHeight)),
      );
    }
  };
  walk(0, 0, 0, 0);

  if (!best) {
    // Not even the smallest cards fit everywhere. If an equal split squeezes some lane,
    // share the height in proportion to what each lane needs at its smallest layout, so
    // every lane is squeezed by the same fraction instead of one lane piling up.
    const smallest = options.map((laneOptions) => laneOptions[laneOptions.length - 1]);
    if (smallest.every((option) => option.required <= equalHeight)) return null;
    const totalRequired = smallest.reduce((sum, option) => sum + option.required, 0);
    return {
      heights: smallest.map((option) => Math.round((option.required * totalHeight) / totalRequired)),
      layouts: smallest.map((option) => option.layout),
    };
  }
  if (best.score <= equalScore) return null;
  const spare = (totalHeight - best.used) / count;
  return {
    heights: best.picks.map((option) => Math.round(option.required + spare)),
    layouts: best.picks.map((option) => option.layout),
  };
}

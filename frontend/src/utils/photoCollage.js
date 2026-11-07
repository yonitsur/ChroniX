// Pure layout math for the event photo collage. The dialog draws these rects onto a canvas;
// keeping them here makes the layouts testable without a DOM.

export const COLLAGE_MAX_PHOTOS = 9;
export const COLLAGE_LAYOUTS = ['grid', 'featured', 'polaroid'];
export const COLLAGE_WIDTH = 1440;
export const COLLAGE_HEIGHT = 900;

// Splits `n` photos into rows as evenly as possible, larger rows last (e.g. 5 -> [2, 3]).
export function collageRowCounts(n) {
  if (n <= 0) return [];
  const rows = n <= 3 ? 1 : n <= 6 ? 2 : 3;
  const base = Math.floor(n / rows);
  const extra = n % rows;
  return Array.from({ length: rows }, (_, i) => base + (i >= rows - extra ? 1 : 0));
}

function gridCells(n, x0, y0, w, h, gap) {
  const counts = collageRowCounts(n);
  const rowH = (h - gap * (counts.length - 1)) / counts.length;
  const cells = [];
  counts.forEach((count, r) => {
    const cellW = (w - gap * (count - 1)) / count;
    for (let c = 0; c < count; c += 1) {
      cells.push({ x: x0 + c * (cellW + gap), y: y0 + r * (rowH + gap), w: cellW, h: rowH, rotation: 0 });
    }
  });
  return cells;
}

// Deterministic jitter so the polaroid layout looks hand-placed but is stable between renders.
function jitter(i, salt) {
  const v = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return (v - Math.floor(v)) * 2 - 1; // -1..1
}

/**
 * Cell rectangles for `n` photos on a `width` x `height` canvas.
 * Each cell is { x, y, w, h, rotation } (rotation in radians, around the cell centre).
 */
export function computeCollageCells(layout, n, width = COLLAGE_WIDTH, height = COLLAGE_HEIGHT, gap = 12) {
  const count = Math.max(0, Math.min(COLLAGE_MAX_PHOTOS, n));
  if (!count) return [];
  const inner = { x: gap, y: gap, w: width - gap * 2, h: height - gap * 2 };

  if (layout === 'featured' && count > 1) {
    const rest = count - 1;
    const heroW = (inner.w - gap) * (rest <= 2 ? 0.62 : 0.55);
    const cells = [{ x: inner.x, y: inner.y, w: heroW, h: inner.h, rotation: 0 }];
    const sideX = inner.x + heroW + gap;
    const sideW = inner.w - heroW - gap;
    const cols = rest <= 3 ? 1 : 2;
    const rows = Math.ceil(rest / cols);
    const cellH = (inner.h - gap * (rows - 1)) / rows;
    for (let r = 0; r < rows; r += 1) {
      const inRow = Math.min(cols, rest - r * cols);
      const cellW = (sideW - gap * (inRow - 1)) / inRow;
      for (let c = 0; c < inRow; c += 1) {
        cells.push({ x: sideX + c * (cellW + gap), y: inner.y + r * (cellH + gap), w: cellW, h: cellH, rotation: 0 });
      }
    }
    return cells;
  }

  if (layout === 'polaroid') {
    // Same slots as the grid, shrunk and tilted so neighbours overlap a little.
    return gridCells(count, inner.x, inner.y, inner.w, inner.h, gap).map((cell, i) => {
      const scale = count === 1 ? 0.8 : 0.9;
      const w = cell.w * scale;
      const h = cell.h * scale;
      return {
        x: cell.x + (cell.w - w) / 2 + jitter(i, 1) * cell.w * 0.06,
        y: cell.y + (cell.h - h) / 2 + jitter(i, 2) * cell.h * 0.06,
        w,
        h,
        rotation: jitter(i, 3) * 0.09,
      };
    });
  }

  return gridCells(count, inner.x, inner.y, inner.w, inner.h, gap);
}

/** Source rect that "cover"-fits an image of iw x ih into a w x h box (centre crop). */
export function coverCrop(iw, ih, w, h) {
  if (!iw || !ih || !w || !h) return { sx: 0, sy: 0, sw: iw || 0, sh: ih || 0 };
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  return { sx: (iw - sw) / 2, sy: (ih - sh) / 2, sw, sh };
}

/** Toggles `index` in an ordered selection; new picks go to the end, capped at the max. */
export function toggleCollageSelection(selection, index, max = COLLAGE_MAX_PHOTOS) {
  if (selection.includes(index)) return selection.filter((i) => i !== index);
  if (selection.length >= max) return selection;
  return [...selection, index];
}

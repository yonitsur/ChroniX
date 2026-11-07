// First-fit row packing for the timeline's patched stack().
//
// Each card is put in the lowest row where its header span [left, left + width] does not
// touch (closed intervals, same test as Histropedia's `headerOverlapsWith`) any card
// already in that row; otherwise a new row is opened. Cards arrive in priority order
// (selected, starred, then chronological), so a row is not sorted by `left` and a later
// card may fit into a gap between two earlier ones.
//
// The original loop compared a card against every card of every row it tried and called
// getWidth() twice per comparison: O(n^2) width lookups per stack(). Here each row keeps
// its spans sorted by left edge. Spans in one row never overlap, so their right edges are
// sorted too, and a card overlaps the row exactly when the last span starting at or before
// its right edge ends at or after its left edge: one binary search per row tried. The
// result is identical to the pairwise test; batch6aStackRows.test.mjs checks that against
// the old loop on randomized input.

function lastIndexStartingAtOrBefore(lefts, value) {
  let lo = 0;
  let hi = lefts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lefts[mid] <= value) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

function insertAt(array, index, value) {
  array.splice(index, 0, value);
}

/**
 * Creates a packer. `place(item, left, width)` puts `item` in its first free row and
 * returns the row index; `rows` holds the items of each row in insertion order (the same
 * arrays the old loop built).
 */
export function createStackRowPacker() {
  const rows = [];
  // Per row: spans with left <= right, sorted by left (parallel arrays), plus degenerate
  // spans (right < left) that break the sorted-rights property and are checked one by one.
  const lefts = [];
  const rights = [];
  const odd = [];

  const overlapsRow = (r, left, right) => {
    const rowLefts = lefts[r];
    const idx = lastIndexStartingAtOrBefore(rowLefts, right);
    if (idx >= 0 && rights[r][idx] >= left) return true;
    const extra = odd[r];
    for (let i = 0; i < extra.length; i++) {
      const span = extra[i];
      if (span.right >= left && right >= span.left) return true;
    }
    return false;
  };

  const place = (item, left, width) => {
    const right = left + width;
    let row = rows.length;
    for (let r = 0; r < rows.length; r++) {
      if (!overlapsRow(r, left, right)) {
        row = r;
        break;
      }
    }
    if (row === rows.length) {
      rows.push([]);
      lefts.push([]);
      rights.push([]);
      odd.push([]);
    }
    rows[row].push(item);
    // NaN never overlaps anything (every comparison is false), so it needs no entry.
    if (!Number.isNaN(left) && !Number.isNaN(right)) {
      if (right >= left) {
        const at = lastIndexStartingAtOrBefore(lefts[row], left) + 1;
        insertAt(lefts[row], at, left);
        insertAt(rights[row], at, right);
      } else {
        odd[row].push({ left, right });
      }
    }
    return row;
  };

  return { rows, place };
}

/**
 * Packs `items` (already in priority order) into rows. `getLeft(item)` and
 * `getWidth(item)` are read once per item.
 */
export function packStackRows(items, getLeft, getWidth) {
  const packer = createStackRowPacker();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    packer.place(item, getLeft(item), getWidth(item));
  }
  return packer.rows;
}

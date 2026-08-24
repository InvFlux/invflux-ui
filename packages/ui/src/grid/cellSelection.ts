/**
 * Pure cell-selection state machine for the spreadsheet grid (§11.1).
 *
 * Coordinates are (row, col) integer indices into the *selectable* grid: row = index into
 * the displayed row model, col = index into the selectable (non-checkbox) columns. The grid
 * component owns the mapping to/from DOM; this module is pure + unit-tested.
 *
 * Selection has an `active` cell (keyboard target / range focus), an `anchor` (where the
 * current range started), and a list of `ranges` (rectangles). The last range is the one
 * being extended; earlier ranges are disjoint multi-range selections.
 */

export interface CellCoord {
  row: number;
  col: number;
}

/** Inclusive, normalized rectangle (r1 ≤ r2, c1 ≤ c2). */
export interface SelectionRect {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface SelectionState {
  active: CellCoord | null;
  anchor: CellCoord | null;
  ranges: SelectionRect[];
}

export const EMPTY_SELECTION: SelectionState = { active: null, anchor: null, ranges: [] };

function rectOf(a: CellCoord, b: CellCoord): SelectionRect {
  return {
    r1: Math.min(a.row, b.row),
    c1: Math.min(a.col, b.col),
    r2: Math.max(a.row, b.row),
    c2: Math.max(a.col, b.col),
  };
}

export function rectContains(rect: SelectionRect, row: number, col: number): boolean {
  return row >= rect.r1 && row <= rect.r2 && col >= rect.c1 && col <= rect.c2;
}

export function isSelected(state: SelectionState, row: number, col: number): boolean {
  return state.ranges.some((rect) => rectContains(rect, row, col));
}

export function isActive(state: SelectionState, row: number, col: number): boolean {
  return state.active !== null && state.active.row === row && state.active.col === col;
}

/** True when the selection covers more than a single cell (any range wider/taller than 1×1). */
export function isMultiCell(state: SelectionState): boolean {
  return state.ranges.some((rect) => rect.r1 !== rect.r2 || rect.c1 !== rect.c2);
}

/**
 * Whether the selected cells exactly fill a single rectangle (no gaps) — the shape copy/paste needs.
 *
 * This is geometric, not a count of ranges: a multi-range selection built with Ctrl-click can still
 * be rectangular (e.g. two adjacent blocks, or adding then removing cells that leaves a filled
 * rectangle). We take the bounding box of all ranges and confirm every cell in it is selected — done
 * by counting the distinct selected cells and comparing to the box area (all cells lie within the box,
 * so equal counts ⟺ the box is completely filled).
 */
export function isRectangularSelection(state: SelectionState): boolean {
  const ranges = state.ranges;
  if (ranges.length <= 1) return true; // empty or a single rect is trivially rectangular

  let r1 = Infinity;
  let c1 = Infinity;
  let r2 = -Infinity;
  let c2 = -Infinity;
  for (const rect of ranges) {
    r1 = Math.min(r1, rect.r1);
    c1 = Math.min(c1, rect.c1);
    r2 = Math.max(r2, rect.r2);
    c2 = Math.max(c2, rect.c2);
  }

  const width = c2 - c1 + 1;
  const area = (r2 - r1 + 1) * width;
  const seen = new Set<number>();
  for (const rect of ranges) {
    for (let r = rect.r1; r <= rect.r2; r++) {
      for (let c = rect.c1; c <= rect.c2; c++) {
        seen.add((r - r1) * width + (c - c1)); // packed index, dedupes overlaps
      }
    }
  }

  return seen.size === area;
}

/** Which sides of a selected cell sit on the outer boundary of the selected region. */
export interface CellEdges {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

/**
 * Outline edges for `(row, col)`: a side is an edge when the cell is selected and the
 * neighbour on that side is not — so a contiguous region (single or multi-range) is framed by
 * a single thin outline, with no internal borders between adjacent selected cells.
 */
export function selectionEdges(state: SelectionState, row: number, col: number): CellEdges {
  if (!isSelected(state, row, col)) {
    return { top: false, right: false, bottom: false, left: false };
  }

  return {
    top: !isSelected(state, row - 1, col),
    right: !isSelected(state, row, col + 1),
    bottom: !isSelected(state, row + 1, col),
    left: !isSelected(state, row, col - 1),
  };
}

export function clampCoord(coord: CellCoord, rows: number, cols: number): CellCoord {
  return {
    row: Math.max(0, Math.min(rows - 1, coord.row)),
    col: Math.max(0, Math.min(cols - 1, coord.col)),
  };
}

/** Single-cell selection (click, arrow without shift). */
export function selectCell(coord: CellCoord): SelectionState {
  return { active: coord, anchor: coord, ranges: [rectOf(coord, coord)] };
}

/** Extend the current range from the anchor to `coord` (shift+click, shift+arrow). */
export function extendTo(state: SelectionState, coord: CellCoord): SelectionState {
  const anchor = state.anchor ?? coord;
  const ranges = state.ranges.length > 0 ? state.ranges.slice(0, -1) : [];
  ranges.push(rectOf(anchor, coord));

  return { active: coord, anchor, ranges };
}

/** Begin a new disjoint range at `coord` (ctrl/cmd+click). */
export function addRange(state: SelectionState, coord: CellCoord): SelectionState {
  return { active: coord, anchor: coord, ranges: [...state.ranges, rectOf(coord, coord)] };
}

/**
 * Ctrl/Cmd+click: toggle a single cell's membership. Not selected → start a new disjoint range there
 * (like {@link addRange}). Already selected → remove exactly that cell, decomposing any rectangle that
 * contains it into the surrounding bands. Either way the clicked cell stays the active/anchor point.
 */
export function toggleCell(state: SelectionState, coord: CellCoord): SelectionState {
  if (!isSelected(state, coord.row, coord.col)) {
    return addRange(state, coord);
  }
  const ranges: SelectionRect[] = [];
  for (const rect of state.ranges) {
    if (!rectContains(rect, coord.row, coord.col)) {
      ranges.push(rect);
      continue;
    }
    // Split the containing rect into up to four bands that exclude exactly (coord.row, coord.col).
    if (coord.row > rect.r1) ranges.push({ r1: rect.r1, c1: rect.c1, r2: coord.row - 1, c2: rect.c2 }); // above
    if (coord.row < rect.r2) ranges.push({ r1: coord.row + 1, c1: rect.c1, r2: rect.r2, c2: rect.c2 }); // below
    if (coord.col > rect.c1) ranges.push({ r1: coord.row, c1: rect.c1, r2: coord.row, c2: coord.col - 1 }); // left of cell
    if (coord.col < rect.c2) ranges.push({ r1: coord.row, c1: coord.col + 1, r2: coord.row, c2: rect.c2 }); // right of cell
  }

  return { active: coord, anchor: coord, ranges };
}

/** Move the active cell by (dRow, dCol), clamped; extend the range when `extend` is true. */
export function moveActive(
  state: SelectionState,
  dRow: number,
  dCol: number,
  rows: number,
  cols: number,
  extend: boolean,
): SelectionState {
  if (rows <= 0 || cols <= 0) return state;
  const base = state.active ?? { row: 0, col: 0 };
  const next = clampCoord({ row: base.row + dRow, col: base.col + dCol }, rows, cols);

  return extend ? extendTo(state, next) : selectCell(next);
}

/** Select the whole grid as one range with the active cell at the origin. */
export function selectAll(rows: number, cols: number): SelectionState {
  if (rows <= 0 || cols <= 0) return EMPTY_SELECTION;

  return {
    active: { row: 0, col: 0 },
    anchor: { row: 0, col: 0 },
    ranges: [{ r1: 0, c1: 0, r2: rows - 1, c2: cols - 1 }],
  };
}

/** Select every row of a single column as one range, active at the top cell. */
export function selectColumn(col: number, rows: number): SelectionState {
  if (rows <= 0 || col < 0) return EMPTY_SELECTION;

  return {
    active: { row: 0, col },
    anchor: { row: 0, col },
    ranges: [{ r1: 0, c1: col, r2: rows - 1, c2: col }],
  };
}

/** Select entire columns c1..c2 across all rows (Excel Ctrl+Space over the selection's column span). */
export function selectColumns(c1: number, c2: number, rows: number): SelectionState {
  if (rows <= 0) return EMPTY_SELECTION;
  const lo = Math.max(0, Math.min(c1, c2));
  const hi = Math.max(c1, c2);

  return { active: { row: 0, col: lo }, anchor: { row: 0, col: lo }, ranges: [{ r1: 0, c1: lo, r2: rows - 1, c2: hi }] };
}

/** Select entire rows r1..r2 across all columns (Excel Shift+Space over the selection's row span). */
export function selectRows(r1: number, r2: number, cols: number): SelectionState {
  if (cols <= 0) return EMPTY_SELECTION;
  const lo = Math.max(0, Math.min(r1, r2));
  const hi = Math.max(r1, r2);

  return { active: { row: lo, col: 0 }, anchor: { row: lo, col: 0 }, ranges: [{ r1: lo, c1: 0, r2: hi, c2: cols - 1 }] };
}

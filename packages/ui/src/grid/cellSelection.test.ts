import { describe, expect, it } from 'vitest';
import {
  addRange,
  clampCoord,
  EMPTY_SELECTION,
  extendTo,
  isActive,
  isMultiCell,
  isRectangularSelection,
  isSelected,
  moveActive,
  selectAll,
  selectCell,
  selectColumn,
  selectColumns,
  selectionEdges,
  selectRows,
  toggleCell,
} from './cellSelection';

describe('cellSelection', () => {
  it('selectCell sets a single 1×1 range, active + anchor', () => {
    const s = selectCell({ row: 2, col: 3 });
    expect(s.active).toEqual({ row: 2, col: 3 });
    expect(s.anchor).toEqual({ row: 2, col: 3 });
    expect(isActive(s, 2, 3)).toBe(true);
    expect(isSelected(s, 2, 3)).toBe(true);
    expect(isSelected(s, 2, 4)).toBe(false);
  });

  it('extendTo builds a normalized rect from the anchor', () => {
    const s = extendTo(selectCell({ row: 4, col: 4 }), { row: 2, col: 1 });
    expect(s.active).toEqual({ row: 2, col: 1 });
    expect(s.anchor).toEqual({ row: 4, col: 4 });
    expect(s.ranges).toEqual([{ r1: 2, c1: 1, r2: 4, c2: 4 }]);
    expect(isSelected(s, 3, 2)).toBe(true);
    expect(isSelected(s, 1, 1)).toBe(false);
  });

  it('extendTo replaces only the current (last) range', () => {
    const s = addRange(selectCell({ row: 0, col: 0 }), { row: 5, col: 5 });
    const extended = extendTo(s, { row: 6, col: 6 });
    expect(extended.ranges).toEqual([
      { r1: 0, c1: 0, r2: 0, c2: 0 },
      { r1: 5, c1: 5, r2: 6, c2: 6 },
    ]);
  });

  it('addRange appends a disjoint range and moves anchor/active', () => {
    const s = addRange(selectCell({ row: 0, col: 0 }), { row: 3, col: 3 });
    expect(s.ranges).toHaveLength(2);
    expect(isSelected(s, 0, 0)).toBe(true);
    expect(isSelected(s, 3, 3)).toBe(true);
    expect(s.active).toEqual({ row: 3, col: 3 });
  });

  it('clampCoord keeps coords within bounds', () => {
    expect(clampCoord({ row: -1, col: 9 }, 3, 4)).toEqual({ row: 0, col: 3 });
    expect(clampCoord({ row: 5, col: -2 }, 3, 4)).toEqual({ row: 2, col: 0 });
  });

  it('moveActive moves and clamps; extend keeps the anchor', () => {
    const s0 = selectCell({ row: 1, col: 1 });
    const right = moveActive(s0, 0, 1, 5, 5, false);
    expect(right.active).toEqual({ row: 1, col: 2 });
    expect(right.ranges).toEqual([{ r1: 1, c1: 2, r2: 1, c2: 2 }]);

    const extendedDown = moveActive(s0, 2, 0, 5, 5, true);
    expect(extendedDown.active).toEqual({ row: 3, col: 1 });
    expect(extendedDown.anchor).toEqual({ row: 1, col: 1 });
    expect(extendedDown.ranges).toEqual([{ r1: 1, c1: 1, r2: 3, c2: 1 }]);
  });

  it('moveActive from empty selection starts at origin', () => {
    const s = moveActive(EMPTY_SELECTION, 0, 0, 5, 5, false);
    expect(s.active).toEqual({ row: 0, col: 0 });
  });

  it('moveActive is a no-op on a zero-sized grid', () => {
    expect(moveActive(EMPTY_SELECTION, 1, 1, 0, 0, false)).toBe(EMPTY_SELECTION);
  });

  it('selectAll covers the whole grid', () => {
    const s = selectAll(3, 2);
    expect(s.ranges).toEqual([{ r1: 0, c1: 0, r2: 2, c2: 1 }]);
    expect(isSelected(s, 2, 1)).toBe(true);
    expect(selectAll(0, 5)).toBe(EMPTY_SELECTION);
  });

  it('selectColumn spans every row of one column, active at the top', () => {
    const s = selectColumn(2, 4);
    expect(s.ranges).toEqual([{ r1: 0, c1: 2, r2: 3, c2: 2 }]);
    expect(s.active).toEqual({ row: 0, col: 2 });
    expect(s.anchor).toEqual({ row: 0, col: 2 });
    expect(isSelected(s, 0, 2)).toBe(true);
    expect(isSelected(s, 3, 2)).toBe(true);
    expect(isSelected(s, 1, 1)).toBe(false);
    // Empty grid or negative column index → no selection.
    expect(selectColumn(2, 0)).toBe(EMPTY_SELECTION);
    expect(selectColumn(-1, 4)).toBe(EMPTY_SELECTION);
  });

  it('isMultiCell is false for a single cell and true for any larger range', () => {
    expect(isMultiCell(EMPTY_SELECTION)).toBe(false);
    expect(isMultiCell(selectCell({ row: 1, col: 1 }))).toBe(false);
    expect(isMultiCell(extendTo(selectCell({ row: 1, col: 1 }), { row: 1, col: 2 }))).toBe(true);
    expect(isMultiCell(extendTo(selectCell({ row: 1, col: 1 }), { row: 3, col: 1 }))).toBe(true);
  });

  it('selectionEdges frames the boundary of a range with no internal borders', () => {
    // 2×2 range over rows 1–2, cols 1–2.
    const s = extendTo(selectCell({ row: 1, col: 1 }), { row: 2, col: 2 });
    expect(selectionEdges(s, 1, 1)).toEqual({ top: true, right: false, bottom: false, left: true });
    expect(selectionEdges(s, 1, 2)).toEqual({ top: true, right: true, bottom: false, left: false });
    expect(selectionEdges(s, 2, 1)).toEqual({ top: false, right: false, bottom: true, left: true });
    expect(selectionEdges(s, 2, 2)).toEqual({ top: false, right: true, bottom: true, left: false });
    // Unselected cell → no edges.
    expect(selectionEdges(s, 0, 0)).toEqual({ top: false, right: false, bottom: false, left: false });
  });

  it('selectionEdges frames a 1×1 selection on all four sides', () => {
    const s = selectCell({ row: 2, col: 2 });
    expect(selectionEdges(s, 2, 2)).toEqual({ top: true, right: true, bottom: true, left: true });
  });

  it('toggleCell adds an unselected cell as a new disjoint range', () => {
    const s = toggleCell(selectCell({ row: 0, col: 0 }), { row: 2, col: 2 });
    expect(isSelected(s, 0, 0)).toBe(true);
    expect(isSelected(s, 2, 2)).toBe(true);
    expect(s.ranges).toHaveLength(2);
    expect(s.active).toEqual({ row: 2, col: 2 });
  });

  it('toggleCell removes an already-selected single cell', () => {
    const s = toggleCell(addRange(selectCell({ row: 0, col: 0 }), { row: 2, col: 2 }), { row: 2, col: 2 });
    expect(isSelected(s, 0, 0)).toBe(true);
    expect(isSelected(s, 2, 2)).toBe(false);
  });

  it('toggleCell punches a cell out of the middle of a rectangle, keeping the rest', () => {
    // 3×3 block rows 0–2, cols 0–2; remove the centre (1,1).
    const block = extendTo(selectCell({ row: 0, col: 0 }), { row: 2, col: 2 });
    const s = toggleCell(block, { row: 1, col: 1 });
    expect(isSelected(s, 1, 1)).toBe(false);
    // Every other cell of the block stays selected.
    for (let r = 0; r <= 2; r++) {
      for (let c = 0; c <= 2; c++) {
        if (r === 1 && c === 1) continue;
        expect(isSelected(s, r, c)).toBe(true);
      }
    }
    // Nothing outside the block leaked in.
    expect(isSelected(s, 3, 3)).toBe(false);
  });

  it('selectColumns spans full rows over the column range', () => {
    const s = selectColumns(1, 3, 5);
    expect(s.ranges).toEqual([{ r1: 0, c1: 1, r2: 4, c2: 3 }]);
    expect(isSelected(s, 0, 1)).toBe(true);
    expect(isSelected(s, 4, 3)).toBe(true);
    expect(isSelected(s, 4, 0)).toBe(false);
  });

  it('selectRows spans full columns over the row range', () => {
    const s = selectRows(2, 2, 4);
    expect(s.ranges).toEqual([{ r1: 2, c1: 0, r2: 2, c2: 3 }]);
    expect(isSelected(s, 2, 0)).toBe(true);
    expect(isSelected(s, 2, 3)).toBe(true);
    expect(isSelected(s, 1, 0)).toBe(false);
  });

  it('isRectangularSelection: a single dragged range is rectangular', () => {
    expect(isRectangularSelection(selectCell({ row: 1, col: 1 }))).toBe(true);
    expect(isRectangularSelection(extendTo(selectCell({ row: 1, col: 1 }), { row: 3, col: 3 }))).toBe(true);
  });

  it('isRectangularSelection: two Ctrl-click ranges that tile a rectangle ARE rectangular', () => {
    // Two adjacent 1×1 cells forming a 1×2, and two stacked cells forming a 2×1.
    const horiz = addRange(selectCell({ row: 0, col: 0 }), { row: 0, col: 1 });
    expect(isRectangularSelection(horiz)).toBe(true);
    const vert = addRange(selectCell({ row: 0, col: 0 }), { row: 1, col: 0 });
    expect(isRectangularSelection(vert)).toBe(true);
  });

  it('isRectangularSelection: adding a cell that completes a 2×2 block is rectangular', () => {
    // Three corners of a 2×2, then the fourth via Ctrl-click → filled 2×2.
    let s = extendTo(selectCell({ row: 0, col: 0 }), { row: 1, col: 0 }); // left column
    s = addRange(s, { row: 0, col: 1 });
    s = addRange(s, { row: 1, col: 1 });
    expect(isRectangularSelection(s)).toBe(true);
  });

  it('isRectangularSelection: disjoint cells with a gap are NOT rectangular', () => {
    const s = addRange(selectCell({ row: 0, col: 0 }), { row: 0, col: 2 }); // hole at (0,1)
    expect(isRectangularSelection(s)).toBe(false);
  });

  it('isRectangularSelection: punching a hole in a block (toggleCell) is NOT rectangular', () => {
    const block = extendTo(selectCell({ row: 0, col: 0 }), { row: 2, col: 2 });
    expect(isRectangularSelection(toggleCell(block, { row: 1, col: 1 }))).toBe(false);
  });

  it('isRectangularSelection: removing a cell that leaves a filled rectangle IS rectangular', () => {
    // A 2×3 block plus a stray cell below it; Ctrl-click the stray away → back to the filled 2×3.
    const block = extendTo(selectCell({ row: 0, col: 0 }), { row: 1, col: 2 });
    const withStray = addRange(block, { row: 2, col: 0 });
    expect(isRectangularSelection(withStray)).toBe(false);
    expect(isRectangularSelection(toggleCell(withStray, { row: 2, col: 0 }))).toBe(true);
  });
});

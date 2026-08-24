import { describe, expect, it } from 'vitest';
import { addRange, extendTo, selectCell, EMPTY_SELECTION } from './cellSelection';
import { buildClipboard, selectionBounds } from './clipboard';

const fmt = (r: number, c: number) => `r${r}c${c}`;

describe('clipboard', () => {
  it('selectionBounds is null with no selection', () => {
    expect(selectionBounds(EMPTY_SELECTION)).toBeNull();
  });

  it('builds a TSV grid for a rectangular range', () => {
    const sel = extendTo(selectCell({ row: 0, col: 0 }), { row: 1, col: 2 });
    const { tsv, grid } = buildClipboard(sel, fmt);
    expect(grid).toEqual([
      ['r0c0', 'r0c1', 'r0c2'],
      ['r1c0', 'r1c1', 'r1c2'],
    ]);
    expect(tsv).toBe('r0c0\tr0c1\tr0c2\nr1c0\tr1c1\tr1c2');
  });

  it('copies a single cell', () => {
    expect(buildClipboard(selectCell({ row: 2, col: 1 }), fmt).tsv).toBe('r2c1');
  });

  it('emits empty for unselected cells inside a multi-range bounding box', () => {
    // Two disjoint single cells at (0,0) and (2,2): bbox is 3×3, only the corners filled.
    const sel = addRange(selectCell({ row: 0, col: 0 }), { row: 2, col: 2 });
    const { grid } = buildClipboard(sel, fmt);
    expect(grid).toEqual([
      ['r0c0', '', ''],
      ['', '', ''],
      ['', '', 'r2c2'],
    ]);
  });
});

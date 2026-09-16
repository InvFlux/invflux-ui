import { describe, expect, it } from 'vitest';
import { addRange, extendTo, selectCell, EMPTY_SELECTION } from './cellSelection';
import { buildClipboard, cellCopyValue, selectionBounds } from './clipboard';

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

  describe('cellCopyValue — copy mirrors the screen', () => {
    it('copies the staged value of a dirty cell, not the baseline', () => {
      expect(cellCopyValue({ staged: true, value: 42 }, 7)).toBe(42);
    });

    it('copies the persisted value when nothing is staged', () => {
      expect(cellCopyValue({ staged: false, value: undefined }, 7)).toBe(7);
    });

    it('ignores the carried value when the cell is not staged', () => {
      // The dirty model may leave a stale `value` behind on a cell it no longer considers staged
      // (a reverted edit); `staged` is the flag that decides, never the presence of a value.
      expect(cellCopyValue({ staged: false, value: 42 }, 7)).toBe(7);
    });

    it('copies a staged empty string rather than falling back to the baseline', () => {
      // A cleared cell is a real edit. Anything testing the value for truthiness instead of reading
      // `staged` copies the old text back, which is the one case an operator cannot see is wrong.
      expect(cellCopyValue({ staged: true, value: '' }, 'was here')).toBe('');
    });

    it('copies a staged null the same way', () => {
      expect(cellCopyValue({ staged: true, value: null }, 12)).toBeNull();
    });
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

import { describe, expect, it } from 'vitest';
import { createRoot } from 'solid-js';
import { useDirtyCells, pendingCellKey, type DirtyCellsStore } from './useDirtyCells';

/** Run a synchronous test body against a fresh store inside a reactive root, then dispose. */
function withStore(body: (store: DirtyCellsStore) => void): void {
  createRoot((dispose) => {
    body(useDirtyCells());
    dispose();
  });
}

describe('useDirtyCells', () => {
  it('starts clean', () => {
    withStore((s) => {
      expect(s.isDirty()).toBe(false);
      expect(s.dirtyCells().size).toBe(0);
      expect(s.edit(1, 'price')).toBeUndefined();
      expect(s.isCellDirty(1, 'price')).toBe(false);
      expect(s.stagedValue(1, 'price', '9.99')).toBe('9.99');
    });
  });

  it('patch stages an edit and reflects it across the readers', () => {
    withStore((s) => {
      s.patch(1, 'price', '9.99', '12.00', 'Widget', 'W-1');
      expect(s.isDirty()).toBe(true);
      expect(s.isCellDirty(1, 'price')).toBe(true);
      expect(s.edit(1, 'price')).toEqual({ original: '9.99', new: '12.00' });
      expect(s.stagedValue(1, 'price', '9.99')).toBe('12.00');
      const row = s.dirtyCells().get(1);
      expect(row?.name).toBe('Widget');
      expect(row?.sku).toBe('W-1');
    });
  });

  it('a round-trip to the original clears the cell and prunes the row', () => {
    withStore((s) => {
      s.patch(1, 'price', '9.99', '12.00', 'Widget', 'W-1');
      s.patch(1, 'price', '9.99', '9.99', 'Widget', 'W-1');
      expect(s.isCellDirty(1, 'price')).toBe(false);
      expect(s.dirtyCells().has(1)).toBe(false);
      expect(s.isDirty()).toBe(false);
    });
  });

  it('keeps sibling cells when one round-trips clean', () => {
    withStore((s) => {
      s.patch(1, 'price', '9.99', '12.00', 'Widget', 'W-1');
      s.patch(1, 'sku', 'W-1', 'W-2', 'Widget', 'W-1');
      s.patch(1, 'price', '9.99', '9.99', 'Widget', 'W-1'); // revert price only
      expect(s.isCellDirty(1, 'price')).toBe(false);
      expect(s.isCellDirty(1, 'sku')).toBe(true);
      expect(s.dirtyCells().get(1)?.cells.size).toBe(1);
    });
  });

  it('revert drops only the named cells, pruning emptied rows', () => {
    withStore((s) => {
      s.patch(1, 'price', '9.99', '12.00', 'Widget', 'W-1');
      s.patch(1, 'weight', '1', '2', 'Widget', 'W-1');
      s.patch(2, 'price', '5.00', '6.00', 'Gadget', 'G-1');
      s.revert([
        { subjectId: 1, columnId: 'price' },
        { subjectId: 2, columnId: 'price' },
      ]);
      expect(s.isCellDirty(1, 'price')).toBe(false);
      expect(s.isCellDirty(1, 'weight')).toBe(true);
      expect(s.dirtyCells().has(2)).toBe(false); // row 2 emptied → pruned
    });
  });

  it('discardAll clears edits and pending', () => {
    withStore((s) => {
      s.patch(1, 'price', '9.99', '12.00', 'Widget', 'W-1');
      s.setPending(new Set([pendingCellKey(1, 'price')]));
      s.discardAll();
      expect(s.isDirty()).toBe(false);
      expect(s.pendingCells().size).toBe(0);
    });
  });

  it('tracks the optimistic pending set', () => {
    withStore((s) => {
      expect(s.isPending(1, 'price')).toBe(false);
      s.setPending(new Set([pendingCellKey(1, 'price'), pendingCellKey(2, 'sku')]));
      expect(s.isPending(1, 'price')).toBe(true);
      expect(s.isPending(2, 'sku')).toBe(true);
      expect(s.isPending(1, 'sku')).toBe(false);
      s.clearPending();
      expect(s.isPending(1, 'price')).toBe(false);
    });
  });

  it('pendingCellKey composes subject + column', () => {
    expect(pendingCellKey(7, 'total')).toBe('7:total');
  });
});

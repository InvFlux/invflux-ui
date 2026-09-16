import { describe, expect, it } from 'vitest';
import { createRoot } from 'solid-js';
import { useDirtyCells, pendingCellKey, type DirtyCellsStore } from './useDirtyCells';

/**
 * ⚠ This package's vitest config is `environment: 'node'`, so `solid-js` resolves to its SERVER
 * build: signals work as plain storage, and **`createEffect` never runs**. Verified 2026-09-05 — an
 * effect-based assertion here does not fail, it simply never executes, which reads as a passing
 * test. Anything that needs real reactivity belongs in a jsdom/browser config, not this file.
 */

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

  it('patchMany stages a whole selection with the same semantics as patch', () => {
    withStore((s) => {
      s.patchMany([
        {
          subjectId: 1,
          columnId: 'price',
          original: '9.99',
          next: '12.00',
          name: 'Widget',
          sku: 'W-1',
        },
        { subjectId: 1, columnId: 'weight', original: '1', next: '2', name: 'Widget', sku: 'W-1' },
        {
          subjectId: 2,
          columnId: 'price',
          original: '5.00',
          next: '6.00',
          name: 'Gadget',
          sku: 'G-1',
        },
      ]);
      expect(s.dirtyCells().size).toBe(2);
      expect(s.dirtyCells().get(1)?.cells.size).toBe(2);
      expect(s.edit(1, 'weight')).toEqual({ original: '1', new: '2' });
      expect(s.edit(2, 'price')).toEqual({ original: '5.00', new: '6.00' });
      expect(s.dirtyCells().get(2)?.name).toBe('Gadget');
    });
  });

  it('patchMany prunes a cell that round-trips clean inside the same batch', () => {
    withStore((s) => {
      s.patch(1, 'price', '9.99', '12.00', 'Widget', 'W-1');
      s.patchMany([
        { subjectId: 1, columnId: 'weight', original: '1', next: '2', name: 'Widget', sku: 'W-1' },
        {
          subjectId: 1,
          columnId: 'price',
          original: '9.99',
          next: '9.99',
          name: 'Widget',
          sku: 'W-1',
        },
        { subjectId: 2, columnId: 'sku', original: 'G-1', next: 'G-1', name: 'Gadget', sku: 'G-1' },
      ]);
      expect(s.isCellDirty(1, 'price')).toBe(false); // round-tripped within the batch
      expect(s.isCellDirty(1, 'weight')).toBe(true); // sibling from the same batch survives
      expect(s.dirtyCells().has(2)).toBe(false); // never became dirty at all
    });
  });

  it('patchMany leaves the previous map untouched (no mutation through the row copies)', () => {
    withStore((s) => {
      s.patch(1, 'price', '9.99', '12.00', 'Widget', 'W-1');
      const before = s.dirtyCells();
      const cellsBefore = before.get(1)!.cells;
      s.patchMany([
        { subjectId: 1, columnId: 'weight', original: '1', next: '2', name: 'Widget', sku: 'W-1' },
        { subjectId: 1, columnId: 'sku', original: 'W-1', next: 'W-2', name: 'Widget', sku: 'W-1' },
      ]);
      expect(cellsBefore.size).toBe(1); // the row map captured earlier never grew
      expect(s.dirtyCells().get(1)?.cells.size).toBe(3);
    });
  });

  it('patchMany stages a wide selection in one pass', () => {
    withStore((s) => {
      s.patchMany(
        Array.from({ length: 250 }, (_, i) => ({
          subjectId: i,
          columnId: 'price',
          original: '1.00',
          next: '2.00',
          name: `Row ${i}`,
          sku: `S-${i}`,
        })),
      );
      expect(s.dirtyCells().size).toBe(250);
      expect(s.edit(249, 'price')).toEqual({ original: '1.00', new: '2.00' });
    });
  });

  it('discardAll clears edits and pending', () => {
    withStore((s) => {
      s.patch(1, 'price', '9.99', '12.00', 'Widget', 'W-1');
      s.addPending([pendingCellKey(1, 'price')]);
      s.discardAll();
      expect(s.isDirty()).toBe(false);
      expect(s.pendingCells().size).toBe(0);
    });
  });

  it('tracks the optimistic pending set', () => {
    withStore((s) => {
      expect(s.isPending(1, 'price')).toBe(false);
      s.addPending([pendingCellKey(1, 'price'), pendingCellKey(2, 'sku')]);
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

  // ── Several submissions outstanding at once ──
  // These are the guard that keeps `original` off an unconfirmed value: an unlocked cell accepts an
  // edit, and a stock correction derives its movement from `original`, so a premature unlock writes
  // the wrong movement with nothing raised anywhere.

  it('addPending accumulates instead of replacing', () => {
    withStore((s) => {
      s.addPending([pendingCellKey(1, 'price')]);
      s.addPending([pendingCellKey(2, 'sku')]);
      expect(s.isPending(1, 'price')).toBe(true);
      expect(s.isPending(2, 'sku')).toBe(true);
      expect(s.pendingCells().size).toBe(2);
    });
  });

  it('one request settling releases only its own cells', () => {
    withStore((s) => {
      const first = [pendingCellKey(1, 'price'), pendingCellKey(1, 'sku')];
      const second = [pendingCellKey(2, 'price')];
      s.addPending(first);
      s.addPending(second);

      s.resolvePending(first);

      expect(s.isPending(1, 'price')).toBe(false);
      expect(s.isPending(1, 'sku')).toBe(false);
      // The other request is untouched — this is the whole point of add/remove over replace.
      expect(s.isPending(2, 'price')).toBe(true);
      expect(s.hasPending()).toBe(true);
    });
  });

  it('resolving cells that were never pending is a no-op, not a corruption', () => {
    withStore((s) => {
      s.addPending([pendingCellKey(1, 'price')]);
      s.resolvePending([pendingCellKey(9, 'price'), pendingCellKey(1, 'sku')]);
      expect(s.isPending(1, 'price')).toBe(true);
      expect(s.pendingCells().size).toBe(1);
    });
  });

  it('hasPending reports the whole set, not one request', () => {
    withStore((s) => {
      expect(s.hasPending()).toBe(false);
      s.addPending([pendingCellKey(1, 'price')]);
      expect(s.hasPending()).toBe(true);
      s.resolvePending([pendingCellKey(1, 'price')]);
      expect(s.hasPending()).toBe(false);
    });
  });

  // ── Row-level save block ──

  it('isRowPending is true while any cell on the row is outstanding', () => {
    withStore((s) => {
      expect(s.isRowPending(1)).toBe(false);
      s.addPending([pendingCellKey(1, 'price')]);
      expect(s.isRowPending(1)).toBe(true);
      // A different cell on the same row is free to edit, but the ROW still cannot be submitted.
      expect(s.isPending(1, 'sku')).toBe(false);
      expect(s.isRowPending(2)).toBe(false);
    });
  });

  it('a row stays blocked until its LAST outstanding cell settles', () => {
    withStore((s) => {
      s.addPending([pendingCellKey(1, 'price'), pendingCellKey(1, 'total')]);
      s.resolvePending([pendingCellKey(1, 'price')]);
      expect(s.isRowPending(1)).toBe(true);
      s.resolvePending([pendingCellKey(1, 'total')]);
      expect(s.isRowPending(1)).toBe(false);
    });
  });

  it('row ids do not collide on a shared prefix', () => {
    // The pending key is `${subjectId}:${columnId}`, so subject 1 and subject 12 share a leading
    // character. Deriving the row set by prefix rather than by the separator would block row 1
    // whenever row 12 was saving — a row the merchant could never submit, with no way to see why.
    withStore((s) => {
      s.addPending([pendingCellKey(12, 'price')]);
      expect(s.isRowPending(12)).toBe(true);
      expect(s.isRowPending(1)).toBe(false);
    });
  });

  it('clearPending releases every request at once', () => {
    withStore((s) => {
      s.addPending([pendingCellKey(1, 'price'), pendingCellKey(2, 'sku')]);
      s.clearPending();
      expect(s.hasPending()).toBe(false);
      expect(s.isRowPending(1)).toBe(false);
      expect(s.isRowPending(2)).toBe(false);
    });
  });

  describe('claimRows', () => {
    const row = (subjectId: number, ...columnIds: string[]) => ({ subjectId, columnIds });

    it('accepts free rows, locks their cells, and reports the keys it took', () => {
      withStore((s) => {
        const claim = s.claimRows([row(1, 'price', 'sku'), row(2, 'total')]);
        expect(claim.accepted).toEqual([1, 2]);
        expect(claim.refused).toEqual([]);
        expect([...claim.keys].sort()).toEqual(
          [pendingCellKey(1, 'price'), pendingCellKey(1, 'sku'), pendingCellKey(2, 'total')].sort(),
        );
        expect(s.isRowPending(1)).toBe(true);
        expect(s.isPending(1, 'sku')).toBe(true);
        expect(s.isRowPending(2)).toBe(true);
      });
    });

    it('refuses a row that already has a request outstanding, through any of its cells', () => {
      withStore((s) => {
        s.addPending([pendingCellKey(1, 'price')]);
        // Claimed through a DIFFERENT column than the one in flight: the save unit is the row.
        const claim = s.claimRows([row(1, 'sku'), row(2, 'total')]);
        expect(claim.accepted).toEqual([2]);
        expect(claim.refused).toEqual([1]);
        expect(claim.keys).toEqual(new Set([pendingCellKey(2, 'total')]));
        // The refused row's untouched cell must NOT have been locked as a side effect.
        expect(s.isPending(1, 'sku')).toBe(false);
      });
    });

    it('refuses the second of two claims in the SAME TICK', () => {
      // The re-entrancy guard behind the bulk apply. Ctrl+Enter reaches the review modal's confirm
      // through two keydown listeners that never consult the disabled button, so two claims can land
      // in one tick with no await between them.
      //
      // On Solid 1 this passes either way — a signal write is visible to the very next read, so a
      // check-then-set would also survive it. It is a CONTRACT test today and becomes the
      // discriminating one on a runtime with deferred reads; the test below is what pins the
      // mechanism in the meantime.
      withStore((s) => {
        const first = s.claimRows([row(1, 'price'), row(2, 'sku')]);
        const second = s.claimRows([row(1, 'price'), row(2, 'sku')]);

        expect(first.accepted).toEqual([1, 2]);
        expect(second.accepted).toEqual([]);
        expect(second.refused).toEqual([1, 2]);
        expect(second.keys.size).toBe(0);
      });
    });

    it('an all-refused claim publishes nothing', () => {
      withStore((s) => {
        s.addPending([pendingCellKey(1, 'price')]);
        const before = s.pendingCells();
        expect(s.claimRows([row(1, 'sku')]).accepted).toEqual([]);
        // Same set instance: a rejected claim must not publish a new pending snapshot, or every
        // refused Ctrl+Enter would re-render every cell in the grid for nothing.
        expect(s.pendingCells()).toBe(before);
      });
    });

    it('a settled claim frees its rows for the next one', () => {
      withStore((s) => {
        const first = s.claimRows([row(1, 'price')]);
        expect(s.claimRows([row(1, 'price')]).refused).toEqual([1]);
        s.resolvePending(first.keys);
        expect(s.isRowPending(1)).toBe(false);
        expect(s.claimRows([row(1, 'price')]).accepted).toEqual([1]);
      });
    });
  });
});

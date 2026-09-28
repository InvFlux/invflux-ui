import { describe, it, expect } from 'vitest';
import {
  isPinLocked,
  isPinned,
  mergePinnedColumns,
  movePinnedColumn,
  pinColumn,
  pinDropAction,
  pinnedLeafOrder,
  pinnedWidthExceeded,
  unpinColumn,
} from './columnPinning';

describe('mergePinnedColumns', () => {
  it('keeps a stored id the available set has not caught up with', () => {
    // The regression this guards, learned once already as a column-order bug: server columns arrive
    // across ticks, so filtering the stored list against what is loaded drops a pin that is merely
    // late — and drops it silently, which is how it survives to a bug report.
    expect(mergePinnedColumns(['name', 'not_loaded_yet'])).toEqual(['name', 'not_loaded_yet']);
  });

  it('seeds a locked id at the front of the group', () => {
    expect(mergePinnedColumns(['sku'], ['name'])).toEqual(['name', 'sku']);
  });

  it('does not duplicate a locked id the merchant had already pinned', () => {
    expect(mergePinnedColumns(['name', 'sku'], ['name'])).toEqual(['name', 'sku']);
  });

  it('drops duplicates in stored state without reordering the survivors', () => {
    expect(mergePinnedColumns(['sku', 'name', 'sku'])).toEqual(['sku', 'name']);
  });

  it('never stores the checkbox column', () => {
    expect(mergePinnedColumns(['select', 'name'], ['select'])).toEqual(['name']);
  });
});

describe('pinnedLeafOrder', () => {
  it('puts the checkbox in front once anything is pinned', () => {
    expect(pinnedLeafOrder(['name'])).toEqual(['select', 'name']);
  });

  it('pins nothing at all when the merchant has pinned nothing', () => {
    // Not `['select']`: with no pins the grid should look exactly as it does today, and a lone
    // sticky checkbox column is a visible change nobody asked for.
    expect(pinnedLeafOrder([])).toEqual([]);
  });
});

describe('isPinned', () => {
  it('reports the checkbox as pinned only while something else is', () => {
    expect(isPinned(['name'], 'select')).toBe(true);
    expect(isPinned([], 'select')).toBe(false);
  });

  it('reports an ordinary column by membership', () => {
    expect(isPinned(['name'], 'name')).toBe(true);
    expect(isPinned(['name'], 'sku')).toBe(false);
  });
});

describe('isPinLocked', () => {
  it('reports only the ids the surface locked', () => {
    expect(isPinLocked(['name'], 'name')).toBe(true);
    expect(isPinLocked(['name'], 'sku')).toBe(false);
  });

  it('locks nothing when the surface asserts nothing', () => {
    expect(isPinLocked([], 'name')).toBe(false);
  });
});

describe('pinColumn', () => {
  it('appends, so an existing group keeps the order the merchant arranged', () => {
    expect(pinColumn(['name', 'sku'], 'atp')).toEqual(['name', 'sku', 'atp']);
  });

  it('is a no-op for an already-pinned column rather than a move', () => {
    expect(pinColumn(['name', 'sku'], 'name')).toEqual(['name', 'sku']);
  });

  it('refuses the checkbox, which is implicit', () => {
    expect(pinColumn(['name'], 'select')).toEqual(['name']);
  });
});

describe('unpinColumn', () => {
  it('removes an ordinary pin', () => {
    expect(unpinColumn(['name', 'sku'], 'sku')).toEqual(['name']);
  });

  it('refuses a column the surface locked, returning the list unchanged', () => {
    expect(unpinColumn(['name', 'sku'], 'name', ['name'])).toEqual(['name', 'sku']);
  });

  it('refuses the checkbox', () => {
    expect(unpinColumn(['name'], 'select')).toEqual(['name']);
  });
});

describe('movePinnedColumn', () => {
  it('reorders within the group', () => {
    expect(movePinnedColumn(['name', 'sku', 'atp'], 'atp', 0)).toEqual(['atp', 'name', 'sku']);
  });

  it('clamps an index past the end, which is what dropping below the last row means', () => {
    expect(movePinnedColumn(['name', 'sku'], 'name', 99)).toEqual(['sku', 'name']);
  });

  it('leaves an unpinned column alone', () => {
    expect(movePinnedColumn(['name'], 'sku', 0)).toEqual(['name']);
  });
});

describe('pinDropAction', () => {
  const pinned = ['name', 'sku'];

  it('reorders within the pinned group when both ends are pinned', () => {
    expect(pinDropAction(pinned, 'sku', 'name')).toEqual({
      kind: 'reorder-pinned',
      columnId: 'sku',
      toIndex: 0,
    });
  });

  it('pins a free column dropped onto a pinned one, at that position', () => {
    expect(pinDropAction(pinned, 'atp', 'sku')).toEqual({
      kind: 'pin',
      columnId: 'atp',
      atIndex: 1,
    });
  });

  it('unpins a pinned column dropped below the divider', () => {
    expect(pinDropAction(pinned, 'name', 'atp')).toEqual({ kind: 'unpin', columnId: 'name' });
  });

  it('is an ordinary reorder when neither end is pinned', () => {
    expect(pinDropAction(pinned, 'atp', 'total')).toEqual({
      kind: 'reorder-free',
      columnId: 'atp',
      targetId: 'total',
    });
  });

  it('reads a drop with nothing pinned as a plain reorder', () => {
    expect(pinDropAction([], 'atp', 'total')).toEqual({
      kind: 'reorder-free',
      columnId: 'atp',
      targetId: 'total',
    });
  });
});

describe('pinnedWidthExceeded', () => {
  const widths = { name: 300, sku: 200 };

  it('allows a group well inside the budget', () => {
    expect(pinnedWidthExceeded(['name'], widths, 1200, 100)).toBe(false);
  });

  it('refuses a group past half the viewport', () => {
    expect(pinnedWidthExceeded(['name', 'sku'], widths, 800, 100)).toBe(true);
  });

  it('charges an unmeasured column the default width rather than nothing', () => {
    // Otherwise a column whose width has not been measured yet is free, and the budget is a
    // formality that passes right up until the layout settles.
    expect(pinnedWidthExceeded(['name', 'unmeasured'], { name: 300 }, 700, 100)).toBe(true);
  });

  it('does not refuse before the viewport has been measured', () => {
    expect(pinnedWidthExceeded(['name', 'sku'], widths, 0, 100)).toBe(false);
  });
});

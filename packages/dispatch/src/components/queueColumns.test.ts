import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadHiddenColumns,
  moveColumn,
  orderColumns,
  QUEUE_COLUMNS,
  saveHiddenColumns,
  type QueueColumnId,
} from './queueColumns';

describe('default-hidden columns', () => {
  // The suite runs without a DOM, so give it a storage to read and write.
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('starts shipping classes hidden for an operator who never chose', () => {
    expect(loadHiddenColumns()).toEqual(['shipping_class']);
  });

  it('keeps it hidden for an operator whose saved choice predates the column', () => {
    // A hidden set written before the flag existed says nothing about this column.
    store.set('invflux:dispatch-columns', JSON.stringify(['age']));

    expect(loadHiddenColumns().sort()).toEqual(['age', 'shipping_class']);
  });

  it('remembers an operator who chose to show it', () => {
    saveHiddenColumns(['age']);

    expect(loadHiddenColumns()).toEqual(['age']);
  });

  it('hides it again when the operator puts it back', () => {
    saveHiddenColumns(['age']);
    saveHiddenColumns(['age', 'shipping_class']);

    expect(loadHiddenColumns().sort()).toEqual(['age', 'shipping_class']);
  });
});

const DEFAULT_IDS = QUEUE_COLUMNS.map((c) => c.id);
const ids = (order: readonly QueueColumnId[]): QueueColumnId[] =>
  orderColumns(order).map((c) => c.id);

describe('orderColumns', () => {
  it('yields the shipped defaults when nothing is stored', () => {
    expect(ids([])).toEqual(DEFAULT_IDS);
  });

  it('yields the shipped defaults when every column is stored in its default place', () => {
    expect(ids(DEFAULT_IDS)).toEqual(DEFAULT_IDS);
  });

  it('keeps a stored order the operator chose', () => {
    const chosen = [...DEFAULT_IDS].reverse();

    expect(ids(chosen)).toEqual(chosen);
  });

  it('drops an id no release defines', () => {
    // The shape a removed column leaves behind in an old browser's storage.
    expect(ids([...DEFAULT_IDS, 'retired-column' as QueueColumnId])).toEqual(DEFAULT_IDS);
  });

  it('ignores a repeated id rather than rendering the column twice', () => {
    expect(ids(['age', 'age', ...DEFAULT_IDS])).toEqual([
      'age',
      ...DEFAULT_IDS.filter((id) => id !== 'age'),
    ]);
  });

  /**
   * The case the whole function exists for: an order saved before a column shipped says nothing
   * about where that column goes, and appending it would put a new column off the right edge of
   * every customised queue — where it reads as missing rather than as new.
   */
  it('lands a column the stored order never knew about after its default predecessor', () => {
    // `customer` follows `age` by default; a stored order from before it existed omits it.
    const stored = DEFAULT_IDS.filter((id) => id !== 'customer');

    expect(ids(stored)).toEqual(DEFAULT_IDS);
  });

  it('lands a new first column at the front, not after whatever happens to be there', () => {
    const stored = DEFAULT_IDS.filter((id) => id !== 'order');

    expect(ids(stored)[0]).toBe('order');
  });

  it('places a new column beside its default neighbour even in a reordered queue', () => {
    // `edt` and `stock` dragged to the front, and `progress` — which follows `stock` by default —
    // unknown to the stored order. It must land beside `stock` at the front, not trail the list,
    // which is what makes this stronger than the cases above: appending would also satisfy a
    // neighbour that happened to sit at the end.
    const stored: QueueColumnId[] = [
      'edt',
      'stock',
      ...DEFAULT_IDS.filter((id) => id !== 'edt' && id !== 'stock' && id !== 'progress'),
    ];

    expect(ids(stored).slice(0, 3)).toEqual(['edt', 'stock', 'progress']);
  });
});

describe('moveColumn', () => {
  const FOUR: QueueColumnId[] = ['order', 'age', 'customer', 'payment'];

  it('moves a column down into the target slot', () => {
    // `order` lands at the index `customer` held; `customer` shifts up to make room.
    expect(moveColumn(FOUR, 'order', 'customer')).toEqual(['age', 'customer', 'order', 'payment']);
  });

  it('moves a column up into the target slot', () => {
    expect(moveColumn(FOUR, 'payment', 'age')).toEqual(['order', 'payment', 'age', 'customer']);
  });

  /** Down then back up returns the original — the property that says the two directions agree. */
  it('is reversed by the opposite move', () => {
    const down = moveColumn(FOUR, 'order', 'customer');

    expect(moveColumn(down, 'order', 'age')).toEqual(FOUR);
  });

  it('leaves the order alone when either id is absent, or when they are the same', () => {
    const start: QueueColumnId[] = ['order', 'age'];

    expect(moveColumn(start, 'order', 'edt')).toEqual(start);
    expect(moveColumn(start, 'edt', 'order')).toEqual(start);
    expect(moveColumn(start, 'order', 'order')).toEqual(start);
  });

  it('does not mutate the order it was given', () => {
    moveColumn(FOUR, 'order', 'customer');

    expect(FOUR).toEqual(['order', 'age', 'customer', 'payment']);
  });
});

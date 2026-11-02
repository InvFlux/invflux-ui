import { describe, it, expect } from 'vitest';
import { orderIndex, orderRows, sameSort } from './serverOrder';
import type { WorkbenchRow } from '../workbenchGridTypes';

/** A row carrying only what the ordering reads. */
const row = (subjectId: number, matched?: boolean): WorkbenchRow =>
  ({
    subjectId,
    wcProductId: subjectId,
    wcVariationId: null,
    ...(matched === undefined ? {} : { matched }),
  }) as WorkbenchRow;

/** A variation of product `productId` (a parent is `row(productId, …)`: its own product id). */
const variation = (subjectId: number, productId: number, matched?: boolean): WorkbenchRow =>
  ({
    ...row(subjectId, matched),
    wcProductId: productId,
    wcVariationId: subjectId,
  }) as WorkbenchRow;

const ids = (rows: WorkbenchRow[]): number[] => rows.map((r) => r.subjectId);

describe('orderRows', () => {
  it('puts the matched rows in the server order', () => {
    const rows = [row(1, true), row(2, true), row(3, true)];
    expect(ids(orderRows(rows, orderIndex([3, 1, 2])))).toEqual([3, 1, 2]);
  });

  it('reads a row with no matched flag as matched', () => {
    expect(ids(orderRows([row(1), row(2)], orderIndex([2, 1])))).toEqual([2, 1]);
  });

  it('slots a brought-in parent immediately before its first variation in the new order', () => {
    // Parent 100 came along as context for its matched variations 101 and 102.
    const rows = [
      row(100, false),
      variation(101, 100, true),
      row(1, true),
      variation(102, 100, true),
    ];
    expect(ids(orderRows(rows, orderIndex([1, 102, 101])))).toEqual([1, 100, 102, 101]);
  });

  it('slots a brought-in variation right after the last row of its family', () => {
    // Matched parent 100 brought in its non-matching variation 103 (bring children).
    const rows = [
      row(100, true),
      variation(101, 100, true),
      variation(103, 100, false),
      row(1, true),
    ];
    expect(ids(orderRows(rows, orderIndex([101, 1, 100])))).toEqual([101, 1, 100, 103]);
  });

  it('anchors a brought-in variation on a brought-in parent', () => {
    const rows = [
      row(100, false),
      variation(101, 100, true),
      variation(103, 100, false),
      row(1, true),
    ];
    expect(ids(orderRows(rows, orderIndex([1, 101])))).toEqual([1, 100, 101, 103]);
  });

  it('puts a context row with nothing to anchor on last, parents before variations', () => {
    const rows = [variation(201, 200, false), row(1, true), row(300, false), row(2, true)];
    expect(ids(orderRows(rows, orderIndex([2, 1])))).toEqual([2, 1, 300, 201]);
  });

  it('places a matched row the order does not know after the ones it does', () => {
    // A row that changed since the order was taken stays visible rather than vanishing.
    const rows = [row(5, true), row(1, true), row(2, true)];
    expect(ids(orderRows(rows, orderIndex([2, 1])))).toEqual([2, 1, 5]);
  });

  it('ignores ids the grid does not hold', () => {
    expect(ids(orderRows([row(1, true), row(2, true)], orderIndex([9, 2, 8, 1])))).toEqual([2, 1]);
  });

  it('leaves the input untouched', () => {
    const rows = [row(1, true), row(2, true)];
    orderRows(rows, orderIndex([2, 1]));
    expect(ids(rows)).toEqual([1, 2]);
  });
});

describe('sameSort', () => {
  it('is true for the same levels', () => {
    expect(
      sameSort(
        [
          { id: 'total', desc: true },
          { id: 'sku', desc: false },
        ],
        [
          { id: 'total', desc: true },
          { id: 'sku', desc: false },
        ],
      ),
    ).toBe(true);
  });

  it('tells a direction apart', () => {
    expect(sameSort([{ id: 'total', desc: true }], [{ id: 'total', desc: false }])).toBe(false);
  });

  it('tells precedence apart', () => {
    expect(
      sameSort(
        [
          { id: 'total', desc: true },
          { id: 'sku', desc: false },
        ],
        [
          { id: 'sku', desc: false },
          { id: 'total', desc: true },
        ],
      ),
    ).toBe(false);
  });
});

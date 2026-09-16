import { describe, expect, it } from 'vitest';
import { mergeRefreshedRows, rowsToRefresh, type RefreshableRow } from './rowRefresh';

const simple = (subjectId: number, wcProductId = subjectId): RefreshableRow => ({
  subjectId,
  role: 'simple',
  productType: 'simple',
  wcProductId,
  wcVariationId: null,
});
const parent = (subjectId: number, wcProductId: number): RefreshableRow => ({
  subjectId,
  role: 'parent',
  productType: 'variable',
  wcProductId,
  wcVariationId: null,
});
const variation = (subjectId: number, parentProductId: number, own: number): RefreshableRow => ({
  subjectId,
  role: 'variation',
  productType: 'variation',
  wcProductId: parentProductId,
  wcVariationId: own,
});

describe('rowsToRefresh', () => {
  it('re-reads only the saved rows when none of them is a parent', () => {
    const loaded = [simple(1), simple(2), simple(3)];
    expect(rowsToRefresh([3, 1], loaded)).toEqual([1, 3]);
  });

  it('adds every loaded variation of a saved parent — they display its inherited fields', () => {
    const loaded = [parent(10, 500), variation(11, 500, 501), variation(12, 500, 502), simple(20)];
    expect(rowsToRefresh([10], loaded)).toEqual([10, 11, 12]);
  });

  it('does not add the parent of a saved variation, nor its siblings', () => {
    const loaded = [parent(10, 500), variation(11, 500, 501), variation(12, 500, 502)];
    expect(rowsToRefresh([11], loaded)).toEqual([11]);
  });

  it('leaves out saved ids the grid has not loaded, and variations of other parents', () => {
    const loaded = [
      parent(10, 500),
      variation(11, 500, 501),
      parent(30, 700),
      variation(31, 700, 701),
    ];
    expect(rowsToRefresh([10, 999], loaded)).toEqual([10, 11]);
  });

  it('lists each id once, in the grid order, when a variation is both saved and inherited', () => {
    const loaded = [parent(10, 500), variation(11, 500, 501)];
    expect(rowsToRefresh([11, 10], loaded)).toEqual([10, 11]);
  });

  it('recognises parents and variations by type when the server sends no role', () => {
    const loaded: RefreshableRow[] = [
      { subjectId: 10, productType: 'variable', wcProductId: 500, wcVariationId: null },
      { subjectId: 11, productType: 'variation', wcProductId: 500, wcVariationId: 501 },
    ];
    expect(rowsToRefresh([10], loaded)).toEqual([10, 11]);
  });

  it('is empty for nothing saved', () => {
    expect(rowsToRefresh([], [simple(1)])).toEqual([]);
  });
});

describe('mergeRefreshedRows', () => {
  type Row = { subjectId: number; price: string; matched?: boolean };
  type Page = { products: Row[]; total: number };

  it('replaces re-read rows in place and keeps every other page and row as the same object', () => {
    const untouched: Page = {
      products: [{ subjectId: 1, price: '1.00', matched: true }],
      total: 3,
    };
    const row2: Row = { subjectId: 2, price: '2.00', matched: true };
    const row3: Row = { subjectId: 3, price: '3.00', matched: true };
    const touched: Page = { products: [row2, row3], total: 3 };
    const out = mergeRefreshedRows(
      [untouched, touched],
      new Map<number, Row>([[3, { subjectId: 3, price: '3.50', matched: true }]]),
    );
    expect(out[0]).toBe(untouched);
    expect(out[1]!.products[0]).toBe(row2);
    expect(out[1]!.products[1]).toEqual({ subjectId: 3, price: '3.50', matched: true });
    expect(out[1]!.total).toBe(3);
  });

  it("keeps the page's matched flag: a context row stays context", () => {
    const page: Page = { products: [{ subjectId: 10, price: '0', matched: false }], total: 1 };
    const out = mergeRefreshedRows(
      [page],
      new Map<number, Row>([[10, { subjectId: 10, price: '9', matched: true }]]),
    );
    expect(out[0]!.products[0]).toEqual({ subjectId: 10, price: '9', matched: false });
  });

  it('does not invent a matched flag the loaded row did not have', () => {
    const page: Page = { products: [{ subjectId: 1, price: '1' }], total: 1 };
    const out = mergeRefreshedRows(
      [page],
      new Map<number, Row>([[1, { subjectId: 1, price: '2', matched: true }]]),
    );
    expect(out[0]!.products[0]).toEqual({ subjectId: 1, price: '2' });
  });
});

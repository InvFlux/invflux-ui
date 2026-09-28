import { describe, it, expect } from 'vitest';
import { countMatched, nextPageParam, type PagedRows } from './matchedPaging';
import type { WorkbenchRow } from '../workbenchGridTypes';

/** A row carrying only what this arithmetic reads. */
const row = (matched?: boolean): WorkbenchRow =>
  ({ ...(matched === undefined ? {} : { matched }) }) as WorkbenchRow;

/** A page of `matched` matched rows plus `context` brought-with rows, out of `total` overall. */
const page = (matched: number, context: number, total: number): PagedRows => ({
  products: [
    ...Array.from({ length: matched }, () => row(true)),
    ...Array.from({ length: context }, () => row(false)),
  ],
  total,
});

describe('countMatched', () => {
  it('counts rows flagged as matched', () => {
    expect(countMatched([row(true), row(true), row(false)])).toBe(2);
  });

  it('counts a row with no flag as matched', () => {
    // An endpoint without a brought-with pass omits the field entirely; every row it returns is a
    // match. Reading the absent flag as `false` would report zero progress forever.
    expect(countMatched([row(), row(), row()])).toBe(3);
  });

  it('is zero for an empty page', () => {
    expect(countMatched([])).toBe(0);
  });
});

describe('nextPageParam', () => {
  it('asks for the next page while matched rows remain', () => {
    const first = page(50, 6, 24443);
    expect(nextPageParam(first, [first])).toBe(2);
  });

  it('does not count context rows towards progress', () => {
    // 50 matched per page against a total of 100: the second page completes the set, even though
    // 112 rows have been received by then. Counting rows instead would stop after the first.
    const pages = [page(50, 6, 100), page(50, 6, 100)];
    expect(nextPageParam(pages[0], [pages[0]])).toBe(2);
    expect(nextPageParam(pages[1], pages)).toBeUndefined();
  });

  it('reaches the last page of a heavily-expanded set', () => {
    // The failure this guards: with context rows counted, a view pulling in 6 extra rows per 50
    // stops around 88% of the way through and silently omits the tail.
    const pages: PagedRows[] = [];
    let guard = 0;
    for (;;) {
      const nextPage: PagedRows = page(50, 6, 1000);
      pages.push(nextPage);
      if (nextPageParam(nextPage, pages) === undefined) break;
      if (++guard > 100) throw new Error('paging did not terminate');
    }
    expect(countMatched(pages.flatMap((p) => p.products))).toBe(1000);
    expect(pages).toHaveLength(20);
  });

  it('stops when the whole result set is loaded', () => {
    const only = page(40, 0, 40);
    expect(nextPageParam(only, [only])).toBeUndefined();
  });

  it('stops on a page with no matched rows rather than re-requesting the same offset', () => {
    // `total` can grow under a scroll. The offset only advances over matched rows, so a page
    // without any cannot move it — asking again would return this same page indefinitely.
    const pages = [page(50, 0, 500), page(0, 3, 500)];
    expect(nextPageParam(pages[1], pages)).toBeUndefined();
  });

  it('pages a grid whose rows carry no matched flag at all', () => {
    const unflagged = (n: number, total: number): PagedRows => ({
      products: Array.from({ length: n }, () => row()),
      total,
    });
    const first = unflagged(25, 50);
    expect(nextPageParam(first, [first])).toBe(2);
    expect(nextPageParam(first, [first, unflagged(25, 50)])).toBeUndefined();
  });
});

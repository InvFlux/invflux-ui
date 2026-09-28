import type { WorkbenchRow } from '../workbenchGridTypes';

/**
 * Progress through a paged result set whose pages carry more rows than the page asked for.
 *
 * A grid page holds two populations: the rows that **matched** the active filters, and rows brought
 * in as **context** — the parent a matched variation folds under, the siblings of a matched parent.
 * Only the first is paginated. The server counts matched rows into `total` and pages by offset over
 * that same set, while context rows ride along on whichever page produced them.
 *
 * So progress is measured in matched rows, and the array length is not that measure. This module is
 * the pure core of that arithmetic, kept out of the component so the boundaries are testable.
 */

/** The fields of a grid page this arithmetic reads; a full page carries much more. */
export interface PagedRows {
  products: readonly WorkbenchRow[];
  /** Size of the filter's result set — matched rows only, across every page. */
  total: number;
}

/**
 * How many of these rows matched the filters, as opposed to being brought in as context.
 *
 * `matched` is optional on the wire: a grid whose endpoint has no brought-with pass omits it, and
 * every row of such a page is a match. So only an explicit `false` discounts a row — reading an
 * absent flag as "not matched" would make such a grid page forever, never reaching its own total.
 */
export function countMatched(rows: readonly WorkbenchRow[]): number {
  return rows.reduce((n, row) => (row.matched === false ? n : n + 1), 0);
}

/**
 * The next page number to request, or `undefined` when the result set is fully loaded.
 *
 * Counting whole arrays here instead of matched rows advances the numerator faster than the server
 * advances its offset, which ends the sequence early and silently drops the tail of the result set.
 * The inflation is proportional to how much context the view pulls in, so it grows with exactly the
 * settings a merchant turns on to see more.
 */
export function nextPageParam(
  lastPage: PagedRows,
  allPages: readonly PagedRows[],
): number | undefined {
  // A page carrying no matched row cannot have advanced the offset, so asking again would re-request
  // the same one. Guards the sequence against a `total` that grew under it mid-scroll.
  if (countMatched(lastPage.products) === 0) return undefined;

  const loadedMatched = allPages.reduce((n, page) => n + countMatched(page.products), 0);

  return loadedMatched < lastPage.total ? allPages.length + 1 : undefined;
}

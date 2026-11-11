import { getLocale } from '@invflux/i18n';
import type { Column, Row, Table } from '@tanstack/table-core';

/**
 * The order two sort keys compare in. Numbers are numeric, text follows the UI locale with digit runs
 * read as numbers (`A2` before `A10`), and a missing key sorts last in either direction (see
 * {@link sortNilLast}).
 */
export function compareSortKeys(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;

  return collator().compare(String(a), String(b));
}

let cached: { locale: string | undefined; collator: Intl.Collator } | null = null;

/** One collator per locale: a sort compares a row against many others, and building one is not free. */
function collator(): Intl.Collator {
  const locale = getLocale();
  if (null === cached || cached.locale !== locale) {
    cached = {
      locale,
      collator: new Intl.Collator(getLocale(), { numeric: true, sensitivity: 'base' }),
    };
  }

  return cached.collator;
}

/** A TanStack sorting function over {@link compareSortKeys}. Missing keys are left to `sortUndefined`. */
export function sortKeyFn<TRow>(rowA: Row<TRow>, rowB: Row<TRow>, columnId: string): number {
  return compareSortKeys(rowA.getValue(columnId), rowB.getValue(columnId));
}

/** The `sortUndefined` setting that keeps a missing key last, ascending or descending. */
export const sortNilLast = 'last' as const;

/**
 * A header click, spreadsheet-style. A plain click makes that column the whole sort: a column
 * already sorting alone cycles its direction, any other click replaces every level with this
 * column in its first direction. Shift+click (multi-sort tables) adds the column as the next level,
 * or cycles it where it already is. TanStack's own handler differs on one case — a plain click on
 * the LAST of several levels only flips that level — which reads as the click not having taken.
 */
export function sortFromHeader<TRow>(
  table: Table<TRow>,
  column: Column<TRow, unknown>,
  event: MouseEvent,
  multiSort: boolean,
): void {
  const sorting = table.getState().sorting;
  const alone = sorting.length === 1 && sorting[0].id === column.id;
  if ((multiSort && event.shiftKey) || alone || sorting.length === 0) {
    column.getToggleSortingHandler()?.(event);
    return;
  }
  table.setSorting([{ id: column.id, desc: column.getFirstSortDir() === 'desc' }]);
}

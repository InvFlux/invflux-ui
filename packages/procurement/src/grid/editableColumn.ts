import type { GridColumnMeta } from '@invflux/ui';

/**
 * The id of the **left-most editable column** for `row`, in the grid's current display order — the
 * column a single-match quick-filter Enter should drop onto ("the first thing you'd type into":
 * Received for reception, Qty for a draft, and Invoiced/Expected once those land). Derived from the
 * host's own `canEdit` guard + live column order, so it's not hard-coded and respects user reordering.
 *
 * @param orderedColumnIds visible selectable column ids in display order (DataGridApi.getSelectableColumnIds()).
 */
export function firstEditableColumnId<TRow>(
  row: TRow,
  columnMetas: GridColumnMeta[],
  canEdit: (row: TRow, meta: GridColumnMeta) => boolean,
  orderedColumnIds: string[],
): string | undefined {
  const metaById = new Map(columnMetas.map((m) => [m.id, m]));
  for (const id of orderedColumnIds) {
    const meta = metaById.get(id);
    if (undefined !== meta && canEdit(row, meta)) return id;
  }
  return undefined;
}

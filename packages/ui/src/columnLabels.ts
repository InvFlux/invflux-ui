import type { GridColumnMeta } from './types';

/**
 * Client-side helpers for merchant-authored column names.
 *
 * A column carries both names: `label` is what to render (the override where one is set) and
 * `defaultLabel` is the shipped translation. Everything here is derived from that pair, so there is
 * no separate "which columns are renamed" state to keep in step with the payload.
 */

/** The shipped name — `defaultLabel` where the surface supplies one, else the label itself. */
export function shippedLabel(column: GridColumnMeta): string {
  return column.defaultLabel ?? column.label;
}

/** Whether a merchant has renamed this column. */
export function isRenamedColumn(column: GridColumnMeta): boolean {
  return column.label !== shippedLabel(column);
}

/**
 * Every override currently in force, as the save endpoint expects it.
 *
 * **The endpoint replaces the whole map for the caller's locale — it is a put, not a patch.** So a
 * body carrying only the column just edited would clear every other rename in the store, silently
 * and for everyone. That is the trap this function exists to make hard to fall into: callers ask
 * for the full set and add their edit to it, rather than assembling a body by hand.
 *
 * `edit` is applied last and wins, including when its value is `''` — the server reads empty as
 * "remove this override", which is how the picker expresses a reset without a second control.
 */
export function columnOverridesForSave(
  columns: readonly GridColumnMeta[],
  edit?: { columnId: string; label: string },
): Record<string, string> {
  const body: Record<string, string> = {};
  for (const column of columns) {
    if (isRenamedColumn(column)) body[column.id] = column.label;
  }
  if (edit) body[edit.columnId] = edit.label;

  return body;
}

/**
 * Recompute every column's rendered name from the override map the server just stored.
 *
 * Driven by the response rather than by the text that was typed, deliberately. The server owns the
 * normalisation — trimming, collapsing whitespace, capping length, dropping a blank, dropping one
 * equal to the shipped name — and re-deriving any of that here would be a second copy of those
 * rules, wrong the moment either side changed. A column missing from the map has no override and
 * falls back to its shipped name, which is also how a reset propagates.
 */
export function applyColumnOverrides(
  columns: readonly GridColumnMeta[],
  overrides: Record<string, string>,
): GridColumnMeta[] {
  return columns.map((column) => ({
    ...column,
    label: overrides[column.id] ?? shippedLabel(column),
  }));
}

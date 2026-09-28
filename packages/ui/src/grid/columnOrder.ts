import type { ColumnOrderState } from '@tanstack/solid-table';

/**
 * Reconciling a merchant's saved column order with the columns that actually exist.
 */

/** The checkbox column, which is always first and is never something the merchant arranged. */
const SELECT_COLUMN = 'select';

/**
 * Merge the saved order with the canonical one, keeping the merchant's arrangement.
 *
 * **The saved order is never filtered against `canonical`.** That list can be transiently incomplete
 * — server columns arrive asynchronously and the available set is rebuilt across ticks — so an id
 * that has not loaded *yet* is indistinguishable from one that is gone. Dropping it loses the saved
 * position and then re-appends the column as "new" at the far end, which is the column-order-
 * doesn't-persist bug. An id that really has been removed is harmless: nothing renders for it.
 *
 * **A column the merchant has never seen is inserted beside its canonical neighbour, not appended.**
 * Appending is the obvious implementation and it is wrong in a specific, quiet way: ship a new column
 * into the middle of the canonical order and every existing merchant finds it at the far right,
 * detached from the columns it belongs with, looking like a bug in the new column rather than in the
 * merge. Walking *backwards* from its canonical position to the nearest column already placed puts it
 * where it was meant to go, and degrades to appending only when none of its predecessors is present.
 *
 * Idempotent once every canonical id is present, so a settled order is returned unchanged.
 */
export function mergeColumnOrder(
  saved: ColumnOrderState,
  canonical: readonly string[],
): ColumnOrderState {
  const hasSelect = canonical.includes(SELECT_COLUMN) || saved.includes(SELECT_COLUMN);
  const placed = saved.filter((id) => id !== SELECT_COLUMN);
  const movableCanonical = canonical.filter((id) => id !== SELECT_COLUMN);

  movableCanonical.forEach((id, index) => {
    if (placed.includes(id)) return;

    let insertAt = placed.length;
    for (let before = index - 1; before >= 0; before--) {
      const predecessor = placed.indexOf(movableCanonical[before]);
      if (predecessor >= 0) {
        insertAt = predecessor + 1;
        break;
      }
    }
    placed.splice(insertAt, 0, id);
  });

  return [...(hasSelect ? [SELECT_COLUMN] : []), ...placed];
}

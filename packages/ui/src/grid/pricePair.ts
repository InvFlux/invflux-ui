/**
 * The regular and the sale price as one pair. WooCommerce blanks a sale price at or above the regular
 * price on save, and still reports the save as a success, so the grid holds the pair to that rule
 * before anything is sent:
 *
 * - **A sale price at or above the regular price, or with no regular price, is a field error** on the
 *   sale price cell. WooCommerce would always discard it, so there is nothing to save.
 * - **A regular price lowered to or below the current sale price stages the sale price cleared**, as
 *   an edit linked to the regular price's. Dropping the regular price to end a sale is a reasonable
 *   intent, and staging the clear shows it instead of letting it happen unseen.
 *
 * A linked clear belongs to the regular price: un-staging either un-stages both (the dirty store's
 * `linkedTo`), and the regular price going back above the sale price drops it. A sale price the
 * merchant stages themselves (typed, pasted, bulk-set, an empty one included) is their own edit, and
 * a regular price edit never touches it.
 *
 * Variable and grouped parents are exempt, as WooCommerce exempts them: their prices are their
 * children's.
 */

import { __ } from '@invflux/i18n';
import type { DirtyEdit, WorkbenchRow } from '../workbenchGridTypes';
import type { CellPatch } from './useDirtyCells';
import { workbenchValueFor } from './workbenchValueFor';

export const REGULAR_PRICE_COLUMN = 'price';
export const SALE_PRICE_COLUMN = 'sale_price';

const isEmpty = (value: unknown): boolean => value === null || value === undefined || value === '';

/** Whether the row's product is held to the pair: everything but a variable or grouped parent. */
export function heldToPricePair(row: WorkbenchRow): boolean {
  return row.role !== 'parent' && row.productType !== 'grouped';
}

/** Whether WooCommerce would blank this sale price on save: at or above the regular price, or with none. */
export function salePriceRejected(regular: unknown, sale: unknown): boolean {
  return !isEmpty(sale) && (isEmpty(regular) || Number(sale) >= Number(regular));
}

/**
 * The field error for the sale price cell of a row, given the staged-or-persisted value of each price,
 * or undefined when the pair is valid.
 */
export function salePriceError(
  row: WorkbenchRow,
  regular: unknown,
  sale: unknown,
): string | undefined {
  if (!heldToPricePair(row) || !salePriceRejected(regular, sale)) return undefined;

  return isEmpty(regular)
    ? __('A sale price needs a regular price.')
    : __('The sale price must be below the regular price.');
}

/**
 * The edits a set of staged edits brings with it: for each regular price staged at or below the
 * product's sale price, that sale price staged cleared and linked to it; for each regular price that
 * no longer needs a linked clear, the clear dropped. Pass the result to the dirty store in the same
 * write as the edits themselves.
 *
 * @param patches the edits being staged, as the merchant made them
 * @param rowOf   the grid row of a subject, for its saved prices
 * @param editOf  the edit already staged for a cell, before `patches`
 */
export function pricePairFollowUps(
  patches: readonly CellPatch[],
  rowOf: (subjectId: number) => WorkbenchRow | undefined,
  editOf: (subjectId: number, columnId: string) => DirtyEdit | undefined,
): CellPatch[] {
  // A sale price staged in this same write is the merchant's own, whatever order the cells arrive in.
  const ownSale = new Set(
    patches
      .filter((p) => p.columnId === SALE_PRICE_COLUMN && p.linkedTo === undefined)
      .map((p) => p.subjectId),
  );
  const out: CellPatch[] = [];
  for (const patch of patches) {
    if (patch.columnId !== REGULAR_PRICE_COLUMN || ownSale.has(patch.subjectId)) continue;
    const row = rowOf(patch.subjectId);
    if (row === undefined || !heldToPricePair(row)) continue;
    const staged = editOf(patch.subjectId, SALE_PRICE_COLUMN);
    if (staged !== undefined && staged.linkedTo === undefined) continue;

    const saved = workbenchValueFor(row, SALE_PRICE_COLUMN);
    const base = {
      subjectId: patch.subjectId,
      columnId: SALE_PRICE_COLUMN,
      original: saved,
      name: patch.name,
      sku: patch.sku,
    };
    if (salePriceRejected(patch.next, saved)) {
      if (staged === undefined) out.push({ ...base, next: '', linkedTo: REGULAR_PRICE_COLUMN });
    } else if (staged !== undefined) {
      // Staging the saved value back is how the store drops a cell.
      out.push({ ...base, next: saved });
    }
  }

  return out;
}

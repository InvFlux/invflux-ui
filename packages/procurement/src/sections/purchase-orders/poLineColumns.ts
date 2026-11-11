import { __, _x } from '@invflux/i18n';
import type { PickableColumn } from '@invflux/ui';

/**
 * The purchase order's read-only lines table: which columns exist, and which may be turned off.
 *
 * **Visibility only — this table does not reorder.** Its cells are a hand-written template rather
 * than a column model, so an order could be stored and never honored. {@link ColumnPicker} takes
 * that as the absence of an `onMove`, and drops its drag handles accordingly. Reordering becomes
 * available the day the table renders from this list instead of alongside it.
 *
 * Labels are getters, not strings — this module is imported at chunk load, and a `__()` evaluated
 * then resolves before the locale is in place.
 */
export type PoLineColumnId =
  | 'image'
  | 'product'
  | 'sku'
  | 'supplier_sku'
  | 'gtin'
  | 'ordered'
  | 'expected'
  | 'received'
  | 'damaged'
  | 'open'
  | 'invoiced'
  | 'status'
  | 'unit_cost'
  | 'invoiced_cost'
  | 'line_total';

/**
 * Every column in render order.
 *
 * `product` is required: hiding it leaves rows identified only by codes, and a buyer reading a
 * supplier's order confirmation is matching names. The three codes beside it are each optional
 * precisely because which one matters is the reader's business — ours on a stock question, the
 * supplier's against their packing slip, the GTIN against a scanner.
 */
export const PO_LINE_COLUMNS: PickableColumn<PoLineColumnId>[] = [
  { id: 'image', label: () => __('Image') },
  { id: 'product', label: () => __('Product'), required: true },
  { id: 'sku', label: () => __('SKU') },
  { id: 'supplier_sku', label: () => __('Supplier SKU') },
  { id: 'gtin', label: () => __('GTIN') },
  { id: 'ordered', label: () => __('Ordered') },
  { id: 'expected', label: () => __('Expected') },
  { id: 'received', label: () => __('Received') },
  { id: 'damaged', label: () => __('Damaged') },
  { id: 'open', label: () => _x('Open', 'quantity remaining to receive') },
  { id: 'invoiced', label: () => _x('Invoiced', 'quantity the supplier has billed') },
  { id: 'status', label: () => __('Status') },
  { id: 'unit_cost', label: () => __('Unit cost') },
  { id: 'invoiced_cost', label: () => _x('Invoiced cost', 'unit price on the supplier invoice') },
  { id: 'line_total', label: () => __('Line total') },
];

/**
 * The columns that carry a delivery's outcome, and so exist only once one can have happened.
 *
 * Absent rather than hidden before reception: an empty Received column on an order still in transit
 * reads as "none arrived", which is a different claim from "nothing has been counted yet". They are
 * withheld from the picker too, so its list matches the headers on screen.
 */
const DELIVERY_COLUMNS: PoLineColumnId[] = ['received', 'damaged', 'open'];

/**
 * What the supplier billed, shown once an invoice is recorded on the order — before that, two
 * empty columns would say nothing on every order of a merchant who never records invoices. Plain
 * figures beside ordered and received: no comparison is made here.
 */
const INVOICE_COLUMNS: PoLineColumnId[] = ['invoiced', 'invoiced_cost'];

/** The columns this order can show at its current stage, in render order. */
export function availablePoLineColumns(
  preReception: boolean,
  invoiced = false,
): PickableColumn<PoLineColumnId>[] {
  return PO_LINE_COLUMNS.filter(
    (c) =>
      !(preReception && DELIVERY_COLUMNS.includes(c.id)) &&
      !(!invoiced && INVOICE_COLUMNS.includes(c.id)),
  );
}

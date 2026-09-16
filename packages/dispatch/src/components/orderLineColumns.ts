import { __, _x } from '@invflux/i18n';
import type { PickableColumn } from '@invflux/ui';

/**
 * The order page's line-table columns, in the order the table renders them.
 *
 * Only two can be put away: **Price** and **Shipping class**. Everything else is what a packer
 * needs to do the job — what the item is, how to identify it, how many, what state it is in, what
 * is wrong with it — so it stays, and the picker shows it checked-and-disabled rather than leaving
 * it out, so the list matches the headers.
 *
 * Price is public data, visible on the storefront; hiding it is a convenience for someone who
 * wants only operational information on screen, never access control. Shipping class matters to
 * some floors and not others, even on a store that uses several.
 *
 * No `onMove`: the table renders from a fixed template, so a stored order could not be honoured and
 * drag handles would be a control that does nothing.
 */
export type OrderLineColumnId =
  'product' | 'sku' | 'price' | 'qty' | 'shipping_class' | 'stock' | 'stage';

export const ORDER_LINE_COLUMNS: PickableColumn<OrderLineColumnId>[] = [
  { id: 'product', label: () => __('Product'), required: true },
  {
    id: 'sku',
    label: () =>
      `${_x('SKU', 'WooCommerce product field: SKU (stock keeping unit)')} / ${_x('GTIN', 'product barcode number: GTIN (Global Trade Item Number — EAN, UPC)')}`,
    required: true,
  },
  { id: 'price', label: () => _x('Price', 'order line column') },
  { id: 'qty', label: () => _x('Qty', 'order line column'), required: true },
  { id: 'shipping_class', label: () => __('Shipping class') },
  { id: 'stock', label: () => _x('Stock concerns', 'order line column'), required: true },
  { id: 'stage', label: () => _x('Stage', 'order line column'), required: true },
];

const STORAGE_KEY = 'invflux:dispatch-order-line-columns';

/**
 * Per browser, in `localStorage`, beside the queue's own column choices and for the same reason: a
 * floor station is often a shared machine, and "this screen hides prices" is the useful unit — not
 * a server-side setting that would reshape the page for everyone.
 *
 * Stored as the **hidden** set, so a column added in a later release appears by default instead of
 * being silently absent for everyone who ever opened the picker. Unknown and required ids are
 * dropped on read: a stored id no release defines is a removed column, and a required one cannot
 * be hidden however it got there.
 */
export function loadHiddenOrderLineColumns(): OrderLineColumnId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const hideable = new Set(
      ORDER_LINE_COLUMNS.filter((c) => c.required !== true).map((c) => c.id),
    );
    return parsed.filter(
      (id): id is OrderLineColumnId =>
        typeof id === 'string' && hideable.has(id as OrderLineColumnId),
    );
  } catch {
    // A private window, cleared site data, or storage the browser refuses: show everything rather
    // than fail the page over a preference.
    return [];
  }
}

export function saveHiddenOrderLineColumns(hidden: OrderLineColumnId[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hidden));
  } catch {
    // The session keeps its in-memory choice; the next one starts from defaults.
  }
}

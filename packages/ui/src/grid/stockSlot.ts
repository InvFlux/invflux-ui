import type { GridColumnMeta } from '../types';

/**
 * The stock-`kind` seam — the single predicate that decides "this column is a stock cell". Kept in its
 * own Kobalte-free module (not in the JSX-heavy `workbenchColumns.tsx`) so it can be unit-tested under
 * the `node` vitest environment without pulling client-only component imports into the test graph.
 */

/** A native stock slot the grid renders specially (colour + on-hand cascade). */
export type StockSlot = 'atp' | 'res' | 'ctd' | 'total';

const STOCK_SLOT_IDS = new Set<StockSlot>(['atp', 'res', 'ctd', 'total']);

/**
 * The stock slot a column represents, or `null` if it isn't a stock column. Today it keys off the bare
 * base id; a faceted id (`atp@wh1`, `atp·web`) strips its location / channel suffix to the base slot so
 * it renders through the same path. A future `stock:*` dataType tag would slot in here too.
 */
export function stockSlotOf(meta: GridColumnMeta): StockSlot | null {
  // Future: if (meta.dataType.startsWith("stock:")) return baseSlotOf(meta.dataType.slice(6));
  const base = meta.id.split(/[@·]/, 1)[0];
  return STOCK_SLOT_IDS.has(base as StockSlot) ? (base as StockSlot) : null;
}

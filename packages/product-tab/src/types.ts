export interface ProductTabContext {
  apiRoot: string;
  nonce: string;
  /** Public URL to the InvFlux mark SVG (square) — shown on the InvFlux governance segment. */
  markUrl?: string;
  /**
   * WordPress's locale for this admin user, as a BCP 47 tag (`fr-FR`). Every date and number the tab
   * formats goes through it; absent (a dev harness), the browser's locale decides.
   */
  locale?: string;
  /** How many apply requests a large save may have in flight at once; absent ⇒ the grid's default. */
  applyConcurrency?: number;
}

export interface InventorySettings {
  /** Null when the product has no InvFlux subject yet (pre-reconciliation). */
  subject_id: number | null;
  product_type: string;
  /**
   * For variations: the parent variable product's post ID, so the UI can link to the
   * parent's edit screen (stock_managed is a parent-level policy). Null for simple
   * and variable parent posts.
   */
  parent_post_id: number | null;
  /** Human product/variation name from `WC_Product::get_name()` — for the modal heading. */
  name: string;
  /** Whether InvFlux governs this product's stock (= `stock_management === 'invflux'`). Kept for the
   *  lock logic + the grid's read-only Total. */
  stock_managed: boolean;
  /** Tri-state governance: 'invflux' (InvFlux governs), 'external' (WooCommerce/another plugin manages
   *  the quantity), 'none' (untracked). Reflects both `ivfx_governed` + WC's `_manage_stock`. */
  stock_management: 'invflux' | 'external' | 'none';
  ledger_entry_count: number;
  /** For-sale slice. Null when unmanaged or no subject. */
  atp: number | null;
  /** Reserved-in-cart slice. Null when unmanaged or no subject. */
  res: number | null;
  /** Sold-not-dispatched slice. Null when unmanaged or no subject. */
  ctd: number | null;
  /**
   * `ctd` deficit cap (= sum(qty_outstanding) − ctd, floored at 0) for the cascade-allocator's
   * positive-delta path. Always present; 0 when no deficit / unmanaged.
   */
  stock_deficit_qty: number;
  reorder_threshold: number | null;
  /** WC `_backorders` policy: 'no' rejects, 'notify' allows + flags, 'yes' allows silently. */
  backorders: 'no' | 'notify' | 'yes';
  sku: string;
  gtin: string;
  /**
   * Current WC `_stock` postmeta value. Surfaced so the product-tab can power the
   * re-enable confirmation ("InvFlux will adopt WC's current stock value of N as the
   * for-sale quantity"), AND to seed the unmanaged-path quantity input. Null when WC
   * has no `_stock` (e.g., never been stock-managed).
   */
  wc_stock: number | null;
  /** WC `_stock_status` availability radio — operative on the unmanaged path. */
  wc_stock_status: 'instock' | 'outofstock' | 'onbackorder';
  /** Server-evaluated `OnHandCorrectionPolicy::allows(current user)` result. */
  allow_onhand_correct: boolean;
  /**
   * Pro stock-tracking lock (`StockTrackingLockPolicy`): whether tracking is enforced store-wide
   * (the toggle is locked on), and whether the current user may override the lock to untrack this
   * product. Both false at Essentials (the feature fails closed).
   */
  enforce_tracking: boolean;
  can_override_lock: boolean;
}

/** Single-row payload for POST /workbench/apply with surface='product_inventory_tab'. */
export interface StockAdjustPayload {
  surface: 'product_inventory_tab';
  reason: string;
  /** What the correction reflects — sign-aware disposition (missing/damaged/… | found/recount_up/…). */
  disposition: string;
  /** How the correction was noticed (one_off / stock_take / other). */
  discovery_context: string;
  rows: Array<{
    subject_id: number;
    edits: Array<{
      column_id: 'total';
      original: number;
      new: number;
    }>;
  }>;
}

/** Subset of /workbench/apply's response shape that the product-tab cares about. */
export interface StockAdjustResponse {
  applied: Array<{ subject_id: number; column_ids_applied: string[] }>;
  conflicts: Array<{
    subject_id: number;
    column_id: string;
    reason: string;
    expected?: unknown;
    actual?: unknown;
  }>;
}

export interface SavePayload {
  stock_management: 'invflux' | 'external' | 'none';
  reorder_threshold: number | null;
  backorders: 'no' | 'notify' | 'yes';
  sku: string;
  gtin: string;
}

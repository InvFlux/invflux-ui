/**
 * Shared row + patch types for `WorkbenchGrid` — the reusable, operator-facing, subject-centric
 * data grid that mounts on any surface where merchants view + edit merchandise data. It's the
 * pillar component of the InvFlux Central Workbench WP admin page, and it also embeds in the WC
 * product inventory tab, future dispatch / procurement grids, and any add-on surface that
 * declares its own column set. The domain intentionally spans catalog / stock / analytics /
 * supplier catalog / dispatch concerns / costing — the grid stays type-blind and any column
 * family the server registers can appear.
 *
 * This file is deliberately transport-agnostic: it defines the row shape the grid consumes, the
 * page shape the fetch endpoint returns, and the row-patch shape a {@link LiveUpdatesTransport}
 * emits — nothing about *how* those flow to the grid. The transport shape lives in `./liveUpdates`.
 *
 * These are the only definitions of those shapes; `@invflux/workbench` consumes them rather than
 * declaring its own.
 */

import type { GridColumnMeta, TaxonomySpace } from './types';
import type { GridFilterMeta } from './filterBridge';
import type { ProductLink } from './productActionsMenu';

// ---------------------------------------------------------------------------
// Grid row
// ---------------------------------------------------------------------------

/** Where the subject stands relative to its reorder threshold. */
export type ReorderStatus = 'below' | 'at' | 'above' | 'none';

/**
 * One row in the workbench grid — a stock-bearing subject with its catalogue, stock, and taxonomy
 * columns already resolved by the server. Fields are grouped by concern; nullable fields carry
 * `null` when the underlying data is unknown or the concern doesn't apply to the row.
 *
 * The grid stays type-blind (DataGrid consumes `TRow` opaquely); this shape is the concrete host
 * type surfaces bind to.
 */
export interface WorkbenchRow {
  // ── Identity ──
  subjectId: number;
  /** WP post id — surfaced by the hidden `post_id` column (read-only machine reference). */
  postId?: number;
  wcProductId: number;
  wcVariationId: number | null;
  productType: string;
  role?: 'simple' | 'parent' | 'variation';
  editUrl?: string;
  /** Host-native product links (WC editor, storefront) for the name-cell actions menu; the ledger
   *  route is appended client-side. Same `{label, url, kind}` shape as a dispatch order line. */
  links?: ProductLink[];

  // ── Catalogue (some editable, some read-only depending on the surface) ──
  name: string;
  sku: string;
  /** GTIN / UPC / EAN / ISBN — WC `_global_unique_id`. Server column id `gtin`. */
  gtin: string | null;
  imageUrl: string | null;
  price: string | null;
  salePrice: string | null;
  taxStatus: 'taxable' | 'shipping' | 'none' | null;
  taxClass: string | null;
  shippingClass: string | null;
  weight: string | null;
  soldIndividually: boolean;
  /** WC `_backorders` policy (per-post — a variation carries its own). Defaults 'no'. */
  backorders: 'no' | 'notify' | 'yes';

  // ── Visibility (catalogVisibility + featured are parent-level; postStatus is per-post) ──
  catalogVisibility: string;
  featured: boolean;
  postStatus: string;

  // ── Inventory state ──
  reorderThreshold: number | null;
  reorderStatus: ReorderStatus;
  stockConcerns?: number;
  stockDeficitQty?: number;
  wac?: string | null;
  stockValue?: string | null;
  uncommittedValue?: string | null;
  committedValue?: string | null;
  stockManaged?: boolean;
  /** Tri-state governance for the editable "Stock managed" enum column (mirrors the PHP row):
   *  'invflux' (we govern), 'external' (WC/another plugin manages _stock), 'none' (untracked). */
  stockManagement?: 'invflux' | 'external' | 'none';
  wcStock?: number | null;
  atp: number;
  res: number;
  ctd: number;
  total: number;

  // ── Taxonomy + extension ──
  taxonomy?: Record<string, number[]>;
  /** Non-core / add-on column values keyed by column id (§8). The native "Orders" column rides here
   *  as `extra.orders` (an open-order count), rendered by the generic `link` datatype view. */
  extra?: Record<string, unknown>;

  // ── Row-level presentation flags ──
  /** Column ids inheriting from the parent product (variation rows only) — rendered faded. */
  inherited?: string[];
  /** Column ids forced read-only on this row regardless of the column's own editability. */
  readOnlyColumns?: string[];
  /** For a `parent` row: total variation count in the catalog. Feeds sub-row count badges. */
  childCount?: number;
  /** True when this row primary-matched the active filter, false when brought-in as context. */
  matched?: boolean;
}

// ---------------------------------------------------------------------------
// Server response shape
// ---------------------------------------------------------------------------

/**
 * One page of grid rows plus the server-emitted metadata the grid needs to build columns / filters
 * / taxonomy resolvers. `subscription` is the opaque token identifying the tracked-set the server
 * maintains on behalf of this client session (see `./liveUpdates` for how transports consume it).
 */
export interface WorkbenchPage {
  products: WorkbenchRow[];
  columns: GridColumnMeta[];
  /** Localized section titles for the column-manager groups — server-provided so the UI
   *  hard-codes no host vocabulary (a missing key degrades to a title-cased group key). */
  columnGroups?: Array<{ key: string; label: string }>;
  total: number;
  page: number;
  perPage: number;
  search?: string | null;
  taxonomySpace?: TaxonomySpace;
  filters?: GridFilterMeta[];
  /** Opaque token — client sends this on subsequent fetch + update calls; server tracks watched-set. */
  subscription?: string;
  /** Cursor for delta-tracking live updates (server monotonic timestamp / seq). */
  cursor?: string;
}

// ---------------------------------------------------------------------------
// Live-update patch shape (transport-agnostic)
// ---------------------------------------------------------------------------

/**
 * A field-level patch for one row, emitted by whichever {@link LiveUpdatesTransport} the surface
 * uses (default polling, future WebSockets, SSE, …). `fields` is deliberately opaque so the wire
 * shape doesn't hardcode "this is a stock update" — when the future audit system starts emitting
 * non-stock updates (price, sku, …), the transport contract doesn't move.
 *
 * The grid's merge policy: **staged edits win**. A field patch that lands on a cell the operator
 * has dirty is silently dropped from the visible value; the underlying `original` still updates so
 * a subsequent save-review can compare against the fresh baseline. This is MVP behaviour; a later
 * pass can add a "server value changed" indicator on staged cells.
 */
export interface RowPatch {
  subject_id: number;
  fields: Record<string, unknown>;
  /** Monotonic cursor of this patch — surfaces the transport advance since the last poll / event. */
  cursor?: string;
}

// ---------------------------------------------------------------------------
// Dirty model (staged, not-yet-saved edits)
// ---------------------------------------------------------------------------

/** One staged edit on a single cell: the persisted value it was staged against + the staged value. */
export interface DirtyEdit {
  original: unknown;
  new: unknown;
}

/** All staged edits for one subject (row), keyed by column id. `name`/`sku` are snapshotted for the
 *  save-review modal's per-row display (so the review reads correctly even if the row scrolls away). */
export interface DirtyRow {
  name: string;
  sku: string;
  cells: Map<string, DirtyEdit>;
}

// ---------------------------------------------------------------------------
// Apply endpoint (POST /workbench/apply) — the generic staged-edit commit contract
// ---------------------------------------------------------------------------

export interface WorkbenchApplyEdit {
  column_id: string;
  original: unknown;
  new: unknown;
  /** Sign-aware disposition for the on-hand `total` edit (v3); null / absent for catalogue edits. */
  disposition?: string | null;
}

export interface WorkbenchApplyRow {
  subject_id: number;
  edits: WorkbenchApplyEdit[];
}

export interface WorkbenchApplyRequest {
  reason: string;
  /** On-hand-correction discovery context (v3); null when no on-hand edit is in the batch. */
  discovery_context?: string | null;
  rows: WorkbenchApplyRow[];
}

export interface WorkbenchApplyConflict {
  subject_id: number;
  column_id: string;
  reason: string;
  expected: unknown;
  actual: unknown;
}

export interface WorkbenchApplyResponse {
  applied: Array<{ subject_id: number; column_ids_applied: string[] }>;
  conflicts: WorkbenchApplyConflict[];
}

// ---------------------------------------------------------------------------
// Imperative handles the grid registers back to its host
// ---------------------------------------------------------------------------

/**
 * The imperative handles `WorkbenchGrid` hands back to its host via `apiRef` — used to focus the
 * grid, drive column visibility from an external toolbar, jump-scroll, and read the current cell
 * selection geometry for bulk operations. Superset of DataGrid's imperative surface: everything
 * DataGrid offers PLUS workbench-level operations (open save-review, kick a live-update refresh).
 */
export interface WorkbenchHandles {
  focus: () => void;
  openColumnManager: () => void;
  scrollToTop: () => void;
  /** Force a fresh live-update pull, ignoring the transport's cadence — useful after a save. */
  refreshLiveUpdates: () => void;
  /** Open the save-review modal even without a keystroke (e.g. host toolbar button). */
  openSaveReview: () => void;
  /** The cells currently in the DataGrid selection (row + column id) — for host features that act on
   *  the selection, e.g. the shell's `*`-fold-over-selection. */
  getSelectedCells: () => Array<{ row: WorkbenchRow; columnId: string }>;
  /** Whether the grid has unsaved staged edits — drives host Save-button state / unload prompts. */
  isDirty: () => boolean;
  /** Fetch every remaining page (for a host "Load all" affordance before an all-rows export/sweep). */
  loadAllPages: () => Promise<void>;
  /** Set the cell selection to span these subjects' rows (all columns), grouping contiguous rows into
   *  ranges; empties it when none are visible. For a host that re-targets the selection after changing
   *  the displayed set — e.g. keeping the selection on the rows just folded/unfolded. */
  selectSubjectRows: (subjectIds: number[]) => void;
  /** Toggle the table ⇄ record layout (for a host rendering its own Record-view button). */
  toggleLayout: () => void;
}

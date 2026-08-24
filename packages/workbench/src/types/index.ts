// Taxonomy types live in the shared @invflux/ui package (datatype components consume them);
// imported for local use here and re-exported so existing `../types` importers keep working
import type {
  GridColumnKind,
  GridColumnMeta,
  GridFilterMeta,
  TaxonomySpace,
  TaxonomySpaceTaxonomy,
  TaxonomySpaceValue,
} from '@invflux/ui';

export type { GridFilterMeta, TaxonomySpace, TaxonomySpaceTaxonomy, TaxonomySpaceValue };

/**
 * Context props the workbench shell passes to `workbench.toolbar` slot contributions
 * Plug-ins register a toolbar action via
 * `window.invflux.workbench.registerSlot('workbench.toolbar', { id, component, order?, enabled? })`.
 */
export interface WorkbenchToolbarSlotProps {
  /** Subject ids of the currently row-selected products. */
  selectedSubjectIds: number[];
}

/**
 * Context props the workbench shell passes to `workbench.settings` slot contributions — each renders
 * as its own **section** inside the workbench Settings modal (opened from the contextual gear). The
 * contribution's `label()` is the section heading. An add-on registers a settings panel via
 * `window.invflux.workbench.registerSlot('workbench.settings', { id, label, component, order?, enabled? })`,
 * completing the trio of workbench add-on seams (columns, toolbar, settings) alongside bulk actions.
 */
export interface WorkbenchSettingsSlotProps {
  /**
   * Whether the modal is committing (the user pressed Save). A section that owns its own persistence
   * can ignore this and save on its own controls; the flag lets a section flush deferred edits in
   * step with the built-in Save when it prefers to.
   */
  saving: boolean;
}

// ---------------------------------------------------------------------------
// Grid row
// ---------------------------------------------------------------------------

export type ReorderStatus = 'below' | 'at' | 'above' | 'none';

// ---------------------------------------------------------------------------
// Column registration metadata (server-emitted, §8)
// ---------------------------------------------------------------------------

// The grid column contract now lives in @invflux/ui (GridColumnKind / GridColumnMeta) so the
// generic DataGrid owns it; re-exported under the historical names so existing importers keep
// working.
export type WorkbenchColumnKind = GridColumnKind;
export type WorkbenchColumnMeta = GridColumnMeta;

/** Option for a select/multiselect filter chip (the `depth` drives hierarchical indentation). */
export interface WorkbenchFilterOption {
  value: string;
  label: string;
  depth?: number;
}

/** A worksheet as returned by the management endpoints (Track 10). */
export interface WorkbenchWorksheet {
  id: number;
  name: string;
  description: string | null;
  visibility: string;
  itemCount: number;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface WorkbenchFilters {
  search?: string;
  taxonomy?: Record<string, string[]>;
  reorderStatus?: ReorderStatus | 'all';
  worksheetId?: number;
  worksheetMembership?: 'in' | 'not_in';
  page?: number;
  perPage?: number;
}

// ---------------------------------------------------------------------------
// Staged diff / stock adjustment
// ---------------------------------------------------------------------------

export interface StagedEdit {
  original: number;
  delta: number;
}

export interface StockAdjustItem {
  subject_id: number;
  original_atp: number;
  new_atp: number;
  name: string;
  sku: string;
}

export interface StockAdjustRequest {
  items: StockAdjustItem[];
  reason: string;
  thresholds: Array<{ subject_id: number; threshold: number | null }>;
}

export interface StockAdjustConflict {
  subject_id: number;
  name: string;
  sku: string;
  expected_atp: number;
  actual_atp: number;
  new_atp: number;
  reason: string;
}

export interface StockAdjustResponse {
  applied: number[];
  conflicts: StockAdjustConflict[];
}

// Generic apply endpoint (§4) — POST /workbench/apply
export interface WorkbenchApplyEdit {
  column_id: string;
  original: unknown;
  new: unknown;
  /** Sign-aware disposition for the on-hand `total` edit (the backend groups items by it). The UI
   *  stamps each edit with the disposition chosen for its delta's sign; null = unspecified. */
  disposition?: string | null;
}

export interface WorkbenchApplyRow {
  subject_id: number;
  edits: WorkbenchApplyEdit[];
}

export interface WorkbenchApplyRequest {
  reason: string;
  /** Optional structured disposition for on-hand-correction's `total` column (sign-independent
   *  enum union; sign-aware filtering happens in the UI layer); null = unspecified. */
  disposition?: string | null;
  /** Optional structured discovery context for on-hand-correction's `total` column; null = unspecified. */
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
// SPA bootstrap contract — what the WP entrypoint passes via window
// ---------------------------------------------------------------------------

export interface WorkbenchCapabilities {
  viewStock: boolean;
  onhandCorrect: boolean;
  /** Edit WC catalogue data (e.g. grouped product members via the Type drill-down). */
  editProducts: boolean;
}

/** Role a registered component plays for a datatype (§5.4). Codecs are not merchant-choosable. */
export type ComponentRole = 'view' | 'edit' | 'drilldown';

export interface WorkbenchContext {
  apiRoot: string;
  nonce: string;
  currentUser: { id: number; name: string };
  capabilities: WorkbenchCapabilities;
  /** Tier-gated UI affordances (greyed-out + upgrade tooltip). The REST layer re-checks server-side. */
  entitlements?: WorkbenchEntitlements;
  /** Per-datatype merchant choice of component, `{ dataType: { role: componentId } }` (§5.5). */
  componentChoices?: Record<string, Partial<Record<ComponentRole, string>>>;
}

/** Pro/Scale UI affordances the bootstrap advertises. Absent ⇒ treat every flag as `false` (Essentials). */
export interface WorkbenchEntitlements {
  /** The Pro JSON / JSONL / XML export formats (Essentials ships CSV + XLSX only). */
  exportStructured: boolean;
}

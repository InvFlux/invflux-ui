/** Stage of a product line in the packing workflow. */
export type StageCode = '' | 'M' | 'W' | 'E';

/**
 * Subject-tied stock concerns as a bitmask. The OR-aggregate at the order
 * level is the union of every line's concern bits. `0` means no concern is
 * flagged. Bit positions are stable across tiers — higher-tier bits stay
 * `0` until the tier-specific drainer step populates them.
 *
 * The bit vocabulary is mirrored from `invflux-core`
 * `Domain\Subject\StockConcernBits`; see {@link StockConcernBits} below.
 */
export type StockConcerns = number;

/** Mirror of the PHP `StockConcernBits` constants. Keep in lockstep. */
export const StockConcernBits = {
  STOCK_DEFICIT: 0x01,
  SUBJECT_INACTIVE: 0x02,
  QUALITY_HOLD: 0x04,
  BATCH_EXPIRED: 0x08,
  BATCH_EXPIRY_RISK: 0x10,
  LOC_AT_RISK: 0x20,
} as const;

export interface DispatchUser {
  id: number;
  name: string;
}

/**
 * Minimal column/field descriptor a datatype component needs (the SPA-agnostic subset of any
 * SPA's richer column metadata). A datatype `view`/`edit`/`codec`/`drilldown`/`diffPreview`
 * component reads only these; a host's full column meta (e.g. the Workbench's
 * `WorkbenchColumnMeta`) is structurally assignable.
 */
export interface FieldMeta {
  /** Open-vocabulary datatype slug (`number`, `decimal:money`, `term-picker:taxonomy`, …). */
  dataType: string;
  /** Per-field config consumed by the component/codec (e.g. `{ taxonomy }`, `{ min, max }`). */
  editorConfig: Record<string, unknown>;
}

/** Column kind: read-only, single-value editable, or multi-value editable (§11). */
export type GridColumnKind = 'read_only' | 'editable' | 'editable_multi';

/**
 * Full column descriptor the generic DataGrid renders from — server-declarative column metadata
 * Extends the datatype-component subset {@link FieldMeta}
 * (`dataType` + `editorConfig`) with grid-level concerns: sort/copy/paste, drill-down,
 * save-review prompts, and layout. A host's richer column meta is structurally assignable.
 */
export interface GridColumnMeta extends FieldMeta {
  id: string;
  label: string;
  /** Optional header tooltip — the SPA-owned description shown on hover, preferred over the DataGrid's
   *  built-in acronym glossary. Lets each grid document its own columns without touching the shared map. */
  description?: string;
  kind: GridColumnKind;
  /** Resolved server-side for the current user (kind + the column's capability): may THIS user
   *  edit THIS column? The cell editor gates on this — an editable-kind column the user lacks the
   *  capability for arrives read-only. The write handler re-checks server-side. */
  editable: boolean;
  sortable: boolean;
  copyable: boolean;
  pasteable: boolean;
  /** Reason prompt collected per column section in the save-review modal (§11.10.3); null = none. */
  bulkSaveReason: { required: boolean; label: string } | null;
  /** Whether a per-cell drill-down is available for this column (§11.7). */
  hasDrilldown: boolean;
  /** Optional Tailwind max-width class for this column's drill-down modal (e.g. `"max-w-md"`);
   *  omitted → the default `max-w-lg`. Lets a compact drill-down (e.g. a short on-order table) opt
   *  into a narrower frame without affecting other columns' drill-downs. */
  drilldownMaxWidth?: string;
  /** Optional structured "disposition" choices (why) collected in the save-review modal — sign-aware
   *  (negative deltas → Missing/Damaged/…, positive → Found/Recount-up/…); null = no disposition prompt. */
  dispositionOptions: Array<{ value: string; label: string; sign: 'negative' | 'positive' }> | null;
  /** Optional "discovery context" choices (how it was found: One-off / Stock-take / …) collected
   *  batch-level alongside disposition; null = no discovery-context prompt. */
  discoveryContextOptions: Array<{ value: string; label: string }> | null;
  group: string | null;
  priority: number;
  visibleByDefault: boolean;
  defaultWidth: number;
  /** Footer aggregate for this column over the loaded rows: "sum" totals an additive numeric column
   *  (quantities, money values) in the grid's footer row; null = no footer total (e.g. per-unit cost,
   *  price, threshold — summing them is meaningless). */
  aggregate?: 'sum' | null;
}

/** One value within a taxonomy (term), as exposed to datatype components. */
export interface TaxonomySpaceValue {
  id: number;
  code: string;
  name: string;
  parentId: number | null;
  depth: number;
}

/** A taxonomy and its term values, keyed by code, as exposed to datatype components. */
export interface TaxonomySpaceTaxonomy {
  code: string;
  name: string;
  hierarchical: boolean;
  enabled: boolean;
  values: Record<string, TaxonomySpaceValue>;
}

/** Map of taxonomy name → taxonomy, for term-picker render/codec lookups. */
export type TaxonomySpace = Record<string, TaxonomySpaceTaxonomy>;

/**
 * A user with presence on an order — either passively viewing (`looking`) or
 * holding the Pro write-lock (`locked`). Matches
 * heartbeat + detail-viewers response shape.
 */
export interface OrderViewer {
  userId: number;
  userName: string;
  status: 'looking' | 'locked';
  lastSeen: string | null; // ISO 8601 ms-precision UTC
}

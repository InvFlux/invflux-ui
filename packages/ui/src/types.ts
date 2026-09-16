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
  /**
   * Display name, where the host has one — what an editor renders for this field can use to name
   * itself. Optional here and required on {@link GridColumnMeta}, so a grid-hosted editor always
   * has it: a cell editor with no accessible name is otherwise announced as a bare text box, and
   * the datatype contract is the only place the name can come from.
   */
  label?: string;
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
  /** The name to render: the merchant's override where one is set, else the shipped translation. */
  label: string;
  /**
   * The shipped translation — what `label` would be with no merchant override.
   *
   * Carried alongside rather than derived, because the picker needs both: to show what a renamed
   * column was called, to match a search against either name, and to recognise "typed the original
   * back" as a reset. `label !== defaultLabel` is also the only thing that has to be true for a
   * column to read as renamed, so there is no second piece of state to keep in step.
   *
   * Optional, and absent means "same as `label`". Only the workbench's server-driven columns can be
   * renamed; the grids that build their own metadata (the PO grids, supplier products, the
   * correction review) have no second name for a column and should not have to invent one.
   */
  defaultLabel?: string;
  /** Optional header tooltip shown on hover. Server-provided with the column definition (absent = no
   *  tooltip), so the grid, the column manager and any add-on-contributed column speak one description. */
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
  /**
   * Whether applying this column's write twice leaves the same result as applying it once.
   *
   * True for a column whose handler writes the value it was given (a price, a SKU, a visibility);
   * false for one deriving a change from the prior state — the on-hand correction sends
   * `new − original` as a stock movement, so a repeat invents stock.
   *
   * Only used to decide **how a large edit is transmitted**: a row may be sent apart from its
   * neighbours, and retried, only when every column it edits is retry-safe. It relaxes no check the
   * server makes on arrival.
   *
   * Optional, and **absent means unsafe** — the grids that build their own column metadata declare
   * nothing, and a missing flag must never read as permission to retry. Same reasoning as the
   * server-side default: forgetting costs speed, and the opposite default would cost stock.
   */
  retrySafe?: boolean;
  /**
   * The filter that constrains what this column shows, so its header menu can offer "Filter…".
   *
   * Declared by the server rather than derived from the ids: barely any column shares its filter's
   * id (`price` is filtered by `price_range`, `product_type` by `subject_kind`), and several
   * columns legitimately share one filter — `atp`, `res`, `ctd` and `total` all open `stock_level`,
   * which measures whichever slots its own scope selector names.
   *
   * **A hint to be checked, never a promise.** The named filter may not exist in this install: a
   * global attribute's column is always present, while its filter only appears once the merchant
   * enables that taxonomy. Look it up before offering the menu item.
   */
  filterId?: string | null;
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

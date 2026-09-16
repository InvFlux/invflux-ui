/**
 * DataGrid — the generic spreadsheet grid extracted from WorkbenchGrid.
 *
 * The design seam between the generic grid and its host. The grid logic
 * (TanStack table + virtualization + render loop + cell selection + per-cell edit + copy/paste +
 * context menu + drill-down + column resize/reorder) lives here, behind the prop contract below. It
 * lives in packages/workbench for now; it relocates to @invflux/ui once the extraction completes.
 *
 * The grid is TYPE-BLIND: a row is the generic `TRow` (today `WorkbenchRow`), addressed only
 * through `getRowId` + `getValue`. Everything that needs the typed row — the bespoke stock/name
 * renderers, the edit guards, inheritance — is host-supplied (a `ColumnDef` the grid renders
 * opaquely via `flexRender`, or one of the host callbacks below). The grid never imports the row
 * type. This is how the generic-row sub-goal is met WITHOUT a server change: the prop boundary,
 * not an id-keyed value bag.
 */
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { IconButton } from '../IconButton';
import { SegmentedControl } from '../SegmentedControl';
import { Button } from '../Button';
import { Dynamic } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { createVirtualizer } from '@tanstack/solid-virtual';
import {
  createColumnHelper,
  createSolidTable,
  flexRender,
  getCoreRowModel,
  type ColumnDef,
  type ColumnOrderState,
  type SortingState,
  type VisibilityState,
  type RowSelectionState,
} from '@tanstack/solid-table';
import type { Cell, Column, Row, RowData, Table } from '@tanstack/table-core';
import { GearIcon, PencilIcon } from '../icons';
import {
  Modal,
  MODAL_BAR_TINT,
  ModalDragHandle,
  ModalFooter,
  ModalHeader,
  ModalPanel,
} from '../Modal';
import { createDragReorder } from '../dragReorder';
import { SettingsSection } from '../SettingsSection';
import { surfaceSettingsRegistry } from '../surfaceSettings';
import { useSurface } from '../surfaceCtx';
import {
  codecRegistry,
  drilldownRegistry,
  editRegistry,
  type EditMove,
} from '../datatypes/registry';
import { makeGenericColumn } from './genericColumn';
import {
  clampCoord,
  EMPTY_SELECTION,
  extendTo,
  isActive as cellIsActive,
  isMultiCell,
  isRectangularSelection as selectionIsRectangular,
  isSelected as cellIsSelected,
  moveActive,
  selectAll,
  selectCell,
  selectColumn,
  selectColumns,
  selectionEdges,
  selectRows,
  toggleCell,
  type CellCoord,
  type SelectionState,
} from './cellSelection';
import { buildClipboard, cellCopyValue, selectionBounds } from './clipboard';
import { pasteTargets, resolvePastedCell } from './paste';
import { parseSpreadsheetTsv } from '../excel-tsv-parser';
import type { GridColumnMeta, TaxonomySpace } from '../types';
import { __, _n, _x, sprintf } from '@invflux/i18n';
import { iconButtonClass, menuItemClass } from '../primitives';
import { ErrorBanner } from '../ErrorBanner';

// Single owner of the `align` column-meta augmentation (moved verbatim from WorkbenchGrid).
declare module '@tanstack/table-core' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: 'right';
  }
}

const RIGHT_ALIGNED = new Set([
  'price',
  'sale_price',
  'weight',
  'reorder_threshold',
  'atp',
  'res',
  'ctd',
  'total',
]);

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  if (item === undefined) return items;
  next.splice(toIndex, 0, item);

  return next;
}

function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function mergeColumnOrder(
  currentOrder: ColumnOrderState,
  availableColumnIds: string[],
): ColumnOrderState {
  // `availableColumnIds` can be transiently INCOMPLETE during load (server columns arrive async, and
  // the set is rebuilt across ticks). So preserve the saved order verbatim — filtering it down to the
  // currently-available ids would DROP an id that simply hasn't loaded yet, and it would then
  // re-append as "missing" at the end, silently losing its saved position (the column-reorder-doesn't-
  // persist bug). A genuinely-removed id lingering in the order is harmless: TanStack ignores unknown
  // columnOrder ids and the reorder UI filters to existing columns. We only APPEND newly-seen ids.
  const hasSelect = availableColumnIds.includes('select') || currentOrder.includes('select');
  const orderedMovableIds = currentOrder.filter((id) => id !== 'select');
  const seen = new Set(orderedMovableIds);
  const missingMovableIds = availableColumnIds.filter((id) => id !== 'select' && !seen.has(id));

  return [...(hasSelect ? ['select'] : []), ...orderedMovableIds, ...missingMovableIds];
}

/** Section title for a column `group` key: the host-provided label (server payload / host map),
 *  else a generic degradation — title-cased key, or "Other" for the ungrouped bucket. The grid
 *  deliberately knows no group names of its own: host vocabulary always travels with the data. */
function columnGroupLabel(
  group: string | null | undefined,
  labels: Record<string, string>,
): string {
  const key = group ?? '';
  return labels[key] ?? (key === '' ? __('Other') : key.charAt(0).toUpperCase() + key.slice(1));
}

/**
 * Grid layout. `"grid"` is the normal horizontal spreadsheet (rows = records, columns = fields).
 * `"record"` transposes it into a matrix: fields become rows, and each RECORD becomes a column
 * (its header is the record's immutable key, via `recordKeyLabel`) — so a handful of records show
 * side-by-side with horizontal scroll for more. The cells keep their `(dataRow, dataCol)` coords, so
 * selection / staged-bg / editing / drill-down / copy-paste all work identically; only the DOM layout
 * and the arrow-key axis transpose.
 */
export type DataGridLayout = 'grid' | 'record';

// ── Grid display settings (density / wrap / text size) — grid-internal, persisted per `settingsKey` ──
export type GridDensity = 'compact' | 'normal' | 'large';
export type GridWrap = 'wrap' | 'no-wrap';
export type GridTextSize = 'small' | 'normal' | 'large';
export interface GridSettings {
  density: GridDensity;
  wrap: GridWrap;
  textSize: GridTextSize;
  /** How many lines a column name may occupy, 1–{@link MAX_HEADER_LINES}. `1` is the single-line
   *  default; above that the name wraps and is clamped to that many lines, so a long name in a
   *  narrow column costs a bounded amount of height instead of however much it happens to need. */
  headerLines: number;
  /** Per-column override of {@link GridSettings.wrap}; a column absent here follows the grid-wide
   *  setting. One long free-text column among twenty numeric ones is the case this exists for —
   *  flipping the whole grid to wrap to read that one column costs height on every other. */
  columnWrap: Record<string, GridWrap>;
}

const DEFAULT_GRID_SETTINGS: GridSettings = {
  density: 'normal',
  wrap: 'no-wrap',
  textSize: 'normal',
  headerLines: 1,
  columnWrap: {},
};
/** The ceiling on {@link GridSettings.headerLines}. Past three the header stops being a label and
 *  starts being a paragraph, and the height it costs is charged to every screen of rows. */
const MAX_HEADER_LINES = 3;
const DENSITY_PADDING: Record<GridDensity, string> = {
  compact: 'py-1',
  normal: 'py-2',
  large: 'py-3',
};
const TEXT_SIZE_CLASS: Record<GridTextSize, string> = {
  small: 'text-xs',
  normal: 'text-sm',
  large: 'text-base',
};
// One step down from the cell size, for a wrapped header. A column name is read once and then
// recognised by shape; the rows under it are read continuously — so the two lines a wrapped name
// costs should be cheaper than two lines of data, not the same price.
const TEXT_SIZE_CLASS_SMALLER: Record<GridTextSize, string> = {
  small: 'text-2xs',
  normal: 'text-xs',
  large: 'text-sm',
};
// Approximate single-line row height (px) per density × text size, for the virtualizer estimate
// (1px border + vertical padding + content/line). Wrapped rows are taller — accepted as today (the
// fixed-estimate virtualizer is "good enough" for wrap; overscan absorbs the slack).
const DENSITY_BASE_PX: Record<GridDensity, number> = { compact: 38, normal: 49, large: 60 };
const TEXT_SIZE_BUMP_PX: Record<GridTextSize, number> = { small: -2, normal: 0, large: 4 };

function loadGridSettings(key: string | undefined, defaults?: Partial<GridSettings>): GridSettings {
  const base: GridSettings = { ...DEFAULT_GRID_SETTINGS, ...defaults };
  if (key === undefined) return base;
  try {
    const raw = localStorage.getItem(`invflux:grid-settings:${key}`);
    // Stored user preference wins over the surface default, which wins over the global default.
    if (raw !== null) {
      const stored = JSON.parse(raw) as Partial<GridSettings>;
      const merged = { ...base, ...stored };
      // A blob written before per-column wrapping existed carries no map, and a hand-edited one may
      // carry anything; both must still yield an indexable object.
      if (merged.columnWrap === null || typeof merged.columnWrap !== 'object')
        merged.columnWrap = {};
      // Same for the line count: it reaches CSS and a row height, so clamp rather than trust it.
      merged.headerLines = Number.isFinite(merged.headerLines)
        ? Math.min(MAX_HEADER_LINES, Math.max(1, Math.round(merged.headerLines)))
        : 1;

      return merged;
    }
  } catch {
    /* ignore unavailable / malformed storage */
  }
  return base;
}

function saveGridSettings(key: string, settings: GridSettings): void {
  try {
    localStorage.setItem(`invflux:grid-settings:${key}`, JSON.stringify(settings));
  } catch {
    /* ignore quota / private-mode failures */
  }
}

/** Record-layout column widths (field-label column + the uniform record columns), persisted per key. */
function loadRecordWidth(
  key: string | undefined,
  which: 'field' | 'col',
  fallback: number,
): number {
  if (key === undefined) return fallback;
  try {
    const raw = localStorage.getItem(`invflux:record-width:${key}:${which}`);
    const n = raw !== null ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= 60 ? n : fallback;
  } catch {
    return fallback;
  }
}

function saveRecordWidth(key: string, which: 'field' | 'col', width: number): void {
  try {
    localStorage.setItem(`invflux:record-width:${key}:${which}`, String(Math.round(width)));
  } catch {
    /* ignore */
  }
}

/** A staged (dirty, not-yet-saved) edit on a cell, as the host's dirty model reports it. */
export interface StagedCell {
  staged: boolean;
  /** The staged new value when `staged`; ignored otherwise. */
  value: unknown;
  /** The edit has been submitted and is awaiting the server's reconcile: the cell keeps showing the
   *  staged value (optimistic), but rendered faded + spinner and locked read-only in the meantime. */
  pending?: boolean;
}

/** A context-menu item the host contributes (e.g. Save / Revert / domain actions). */
export interface DataGridMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  /** Native tooltip — typically the reason a `disabled` item is disabled. */
  title?: string;
  /** Renders the same `✓` the grid marks its own current-state items with. For an item that names a
   *  setting's value (one arm of a three-way choice), not for a command. */
  checked?: boolean;
  /** Leaf action. Omit for a submenu parent (carries `children`); a parent with BOTH runs on click. */
  run?: () => void;
  /** Present ⇒ this item is a submenu parent (hover-opens `children`). */
  children?: DataGridMenuItem[];
}

/** Role a datatype component plays — mirrors @invflux/ui's ComponentRole. */
export type DataGridComponentRole = 'view' | 'edit' | 'drilldown';

/**
 * Per-row presentation a host attaches to a `<tr>`.
 *
 * `data` publishes the row's *meaning* (keys are emitted as `data-<key>`), which `class` and
 * `title` cannot: a utility class is a styling choice that may change for visual reasons, and
 * `title` is translated. Anything that needs to identify a row's state — a test, an add-on, a
 * stylesheet that should not depend on the design's current palette — reads `data`.
 */
export interface RowAttrs {
  class?: string;
  title?: string;
  data?: Record<string, string>;
}

export interface DataGridProps<TRow> {
  // ── Data + identity ────────────────────────────────────────────────────────
  /** Already display-filtered + ordered rows (the host owns fetch, search, aggregate, sort-request). */
  rows: () => TRow[];
  /** Opaque, stable row identity (today: String(subjectId)). */
  getRowId: (row: TRow) => string;
  /** Server-declarative column metadata, in display order (before user reorder). */
  columnMetas: () => GridColumnMeta[];
  /** Localized section titles for the column-manager groups, keyed by the columns' `group` keys.
   *  Host-provided (the workbench forwards the server payload's `columnGroups`; a grid that builds
   *  its own column metas names its own groups) — the grid itself hard-codes no group vocabulary.
   *  A key with no entry degrades to a title-cased key; `""`/absent groups collect under "Other". */
  groupLabels?: () => Record<string, string>;
  /** THE value seam (replaces the direct valueFor import): column id → cell value. */
  getValue: (row: TRow, columnId: string) => unknown;

  // ── Bespoke (host-rendered) columns ─────────────────────────────────────────
  /** Host-owned ColumnDefs by id — the checkbox, name+fold, image, stock cells, ledger/orders.
   *  These keep the typed row; the grid renders them opaquely. Any column id NOT here gets a
   *  generic datatype-view column built by the grid. */
  bespokeColumns: Map<string, ColumnDef<TRow, unknown>>;
  /** Always-first column ids (e.g. ["select"]). */
  leadingColumnIds?: string[];
  /** Always-last structural column ids (e.g. ["orders"]). */
  trailingColumnIds?: string[];

  // ── Datatype registries / component choice ──────────────────────────────────
  componentChoiceId?: (dataType: string, role: DataGridComponentRole) => string | undefined;
  taxonomySpace?: () => TaxonomySpace | undefined;

  // ── Editing / dirty (host owns the dirty model + save flow) ──────────────────
  /** Host edit-guard: the three domain guards (readOnlyColumns, variable-parent Total, unmanaged
   *  Total) + `meta.editable` live here. Replaces canEditCoord's body. */
  canEdit: (row: TRow, meta: GridColumnMeta) => boolean;
  /** Staged value the cell should display (green-tinted) instead of the persisted one. */
  getStagedValue: (row: TRow, columnId: string) => StagedCell;
  /** The value the editor opens on / compares against (inheritance: a variation may show the
   *  parent's value). Defaults to getValue when omitted. */
  resolvePersistedValue?: (row: TRow, meta: GridColumnMeta) => unknown;
  /** Inheritance-aware "cleared" value for a cell (Clear / Cut). `{ok:false}` = not clearable. */
  resolveClearedValue?: (row: TRow, meta: GridColumnMeta) => { ok: boolean; value: unknown };
  /** Per-row editor-meta tweak (e.g. inject the "Same as parent" inherit option on variations). */
  resolveEditorMeta?: (meta: GridColumnMeta, row: TRow) => GridColumnMeta;
  /** Whether a cell's `<td>` renders faded ("inherited from parent") — the per-cell italic-grey
   *  wash (was `row.inherited?.includes(columnId)`). */
  isInherited?: (row: TRow, columnId: string) => boolean;
  /** Whether a GENERIC (datatype-view) column's value renders faded inside its own span — the
   *  term-picker-on-a-variation case (was the genericColumn-specific `dataType + variation` check).
   *  Distinct from `isInherited` (the boundary map flags they can differ). */
  isGenericColumnInherited?: (row: TRow, meta: GridColumnMeta) => boolean;
  /** Stage an edit into the host dirty model (was patchDirtyCell). */
  onStageEdit: (row: TRow, columnId: string, original: unknown, next: unknown) => void;
  /** Clear a set of cells (Clear / Cut / paste-empty). */
  onClearCells: (cells: Array<{ row: TRow; columnId: string }>) => void;
  /** Open the host's bulk-edit modal for the cells spanned by the selection. The grid supplies the
   *  per-column row groups (it owns the column geometry); the host maps each to its typed bulk-edit
   *  column. Used both for a multi-cell range (F2 / right-click "Edit selection…") and for a single
   *  `editable_multi` (term-picker) cell — which has no in-cell editor (a one-column, one-row group).
   *  Returns true when a modal was opened; false → the grid falls back to inline edit. */
  onEditMulti?: (
    groups: Array<{ columnId: string; meta: GridColumnMeta; rows: TRow[] }>,
  ) => boolean;
  /** Called after a cell commits via its editor, with the navigation move the commit requested
   *  (Enter→"down", Tab→"right", …; null on blur). Return true to take over focus — the grid then skips
   *  its default active-cell move and focus-restore. Lets a host build a commit→elsewhere loop (e.g. the
   *  reception scanner: Enter on the qty returns to the quick-filter). Default: grid moves as usual. */
  onCommitNavigate?: (row: TRow, columnId: string, move: EditMove) => boolean;

  // ── Copy / paste ────────────────────────────────────────────────────────────
  /** Gate paste (e.g. a capability check). Defaults to always-allowed. */
  canPaste?: () => boolean;
  onPasteError?: (message: string) => void;
  /** A completed clipboard action (copy / paste) with a ready-to-show, localized message — the
   *  success counterpart of {@link onPasteError}. The host decides how to surface it (e.g. a toast). */
  onClipboardSuccess?: (message: string) => void;

  // ── Drill-down / context menu ───────────────────────────────────────────────
  /** Fetch a cell's drill-down payload (replaces the hardcoded REST path). */
  fetchDrilldown?: (
    columnId: string,
    row: TRow,
  ) => Promise<{ title?: () => JSX.Element; detail: unknown; subtitle?: () => JSX.Element }>;
  /** Persist a drill-down edit (POST). When provided, writable drill-down components receive a `save`
   *  callback; the host refreshes the open detail from the response. Absent → drill-downs are read-only. */
  saveDrilldown?: (
    columnId: string,
    subjectId: number,
    payload: unknown,
  ) => Promise<{ detail: unknown }>;
  /** Async option source for pickers inside a drill-down (e.g. product search), passed through to the
   *  drill-down component as `searchOptions`. */
  drilldownSearchOptions?: (query: string) => Promise<Array<{ value: string; label: string }>>;
  /** Host-contributed context-menu items appended to the built-ins (Save / Revert / domain). */
  contextMenuExtras?: (args: {
    coord: CellCoord;
    row: TRow;
    meta: GridColumnMeta;
  }) => DataGridMenuItem[];
  /**
   * Host-contributed items appended to a COLUMN HEADER's menu — the header counterpart of
   * {@link contextMenuExtras}, and the seam for an action that belongs to one column rather than to
   * grids in general (the workbench's variation-name form lives on the Product column and nowhere
   * else). Called per column, so returning `[]` for every id but one is the normal shape.
   *
   * `meta` is the server column metadata, absent for a structural column the grid owns (`select`) or
   * one the host renders bespoke without a meta. Match on `columnId` when the identity is what
   * matters; on `meta` when the *datatype* is.
   */
  headerMenuExtras?: (args: {
    columnId: string;
    meta: GridColumnMeta | undefined;
  }) => DataGridMenuItem[];
  /** Gate the "Copy ▸ As JSON" context-menu item (a Pro feature in the host). Returns false ⇒ the item
   *  is shown disabled with {@link copyAsJsonUpgradeHint} as a tooltip. Default: always enabled. */
  copyAsJsonAllowed?: () => boolean;
  /** Tooltip shown on a disabled "Copy ▸ As JSON" (e.g. "Upgrade to InvFlux Pro"). */
  copyAsJsonUpgradeHint?: string;
  /** Host-owned GLOBAL keybindings, tried BEFORE the grid-focus guard (work anywhere the workbench
   *  is mounted): e.g. Ctrl/Cmd+S save, `/` focus-search, Shift+`/` focus-grid. Return true if handled. */
  keyHandlers?: Array<(e: KeyboardEvent, active: CellCoord | null) => boolean>;
  /** Host-owned keybindings tried AFTER the focus/edit/control guards (grid focused, not editing):
   *  e.g. Ctrl/Cmd+Enter save, `*` group-fold. Return true if handled. */
  keyHandlersInGrid?: Array<(e: KeyboardEvent, active: CellCoord | null) => boolean>;

  // ── Controlled table state (host owns persistence) ──────────────────────────
  sorting: () => SortingState;
  onSortingChange: (next: SortingState) => void;
  columnVisibility: () => VisibilityState;
  setColumnVisibility: (updater: (prev: VisibilityState) => VisibilityState) => void;
  columnOrder: () => ColumnOrderState;
  setColumnOrder: (updater: (prev: ColumnOrderState) => ColumnOrderState) => void;
  columnSizing: () => Record<string, number>;
  setColumnSizing: (updater: (prev: Record<string, number>) => Record<string, number>) => void;
  /** Expanded column-manager section keys (empty = all folded, the default). Host-persisted so the
   *  open/closed sections survive reloads; omit for in-memory-only. */
  expandedColumnSections?: () => string[];
  setExpandedColumnSections?: (updater: (prev: string[]) => string[]) => void;
  /** Reset column visibility / order / sizing to the surface defaults (the host owns what "default"
   *  means). When provided, the column manager shows a "Reset to default" button. */
  onResetColumns?: () => void;
  /** Whether this user may rename columns — a store-wide, per-language change, unlike every other
   *  control in the picker. Forwarded to the column manager; absent means the affordance is hidden. */
  canRenameColumns?: () => boolean;
  /** Persist (or clear) a merchant-authored name for one column. See the column manager's prop. */
  onRenameColumn?: (columnId: string, label: string) => Promise<void> | void;
  /** Row-checkbox selection (drives the host's bulk actions) — distinct from cell selection. */
  rowSelection: () => RowSelectionState;
  setRowSelection: (updater: (prev: RowSelectionState) => RowSelectionState) => void;

  // ── Cell selection (grid-owned, exposed so the host can read/clear it) ───────
  cellSelection: () => SelectionState;
  setCellSelection: (updater: SelectionState | ((s: SelectionState) => SelectionState)) => void;

  /** Empty-state / loading slot rendered in place of rows. */
  fallback?: JSX.Element;

  /** Fired when the last virtual row is within 20 of the end — the host appends the next page
   *  (it owns the infinite query; the grid owns the scroll position that triggers it). */
  onScrollNearEnd?: () => void;

  /** Per-row presentation hook (e.g. mute a brought-with context row + add its title). The grid
   *  stays type-blind; the host reads its typed fields. Returned class is appended; title is set. */
  rowAttrs?: (row: TRow) => RowAttrs;
  /** Click anywhere in a leading (non-selectable, e.g. checkbox) cell — used to toggle row selection
   *  when the click misses the checkbox itself. The grid can't read the typed row to do this. */
  onLeadingCellClick?: (row: TRow, columnId: string, event: MouseEvent) => void;

  /** Persist the grid display settings (density / wrap / text size) under this key in localStorage.
   *  Omit for in-memory-only (resets each mount). The settings modal + their effect are grid-internal. */
  settingsKey?: string;
  /** Surface-level default display settings, applied when nothing is stored yet (a compact embed
   *  wants density:"compact" / textSize:"small" out of the box). Stored user prefs still win. */
  defaultGridSettings?: Partial<GridSettings>;
  /** Layout: horizontal spreadsheet ("grid", default) or the transposed record matrix ("record").
   *  See {@link DataGridLayout}. An accessor so the host can toggle it reactively. */
  layout?: () => DataGridLayout;
  /** In "record" layout, the header shown above each record's column — its immutable key (e.g.
   *  `#1037` from the post id). Falls back to `getRowId(row)`. */
  recordKeyLabel?: (row: TRow) => JSX.Element | string;

  /** One-time handoff of the grid's imperative handles to the host (the grid owns the scroll
   *  element + column geometry; the host needs focus, the column manager, scroll-reset, and the
   *  selection-geometry readers its dirty-model ops use). Called once during setup. */
  apiRef?: (api: DataGridApi<TRow>) => void;
}

/** Imperative handles the grid hands back to its host via {@link DataGridProps.apiRef}. */
export interface DataGridApi<TRow> {
  /** Focus the grid scroll container so keyboard cell-nav resumes (e.g. after a modal closes). */
  focusGrid: () => void;
  /** Programmatically begin editing the active cell, optionally seeded with text (as if the seed had
   *  been typed). Lets a host bind a custom key/button to edit-entry — e.g. a domain "fill" shortcut —
   *  through keyHandlersInGrid, instead of the grid special-casing the key. No-op if no editable active cell. */
  enterEdit: (seed?: string) => void;
  /** Focus a cell addressed by (rowId, columnId), scroll it into view, and optionally enter edit mode.
   *  Lets a host drive the active cell after a data change it owns — e.g. jumping into the qty editor of
   *  a freshly-added line. No-op if the row/column isn't found (or, in edit mode, isn't editable). */
  focusCellById: (rowId: string, columnId: string, editMode?: boolean) => void;
  /** Toggle the column-manager modal (the host's toolbar opens it). */
  openColumnManager: () => void;
  /** Open the grid display-settings modal (density / wrap / text size). */
  openGridSettings: () => void;
  /** Reset the scroll viewport to the top — the host calls this on a result-set change
   *  (search / sort / filter / page-size), which it owns. */
  scrollToTop: () => void;
  /** Distinct (row, columnId) cells covered by the current cell selection — the host reads them
   *  for dirty-model ops (e.g. Revert). */
  getSelectedCells: () => Array<{ row: TRow; columnId: string }>;
  /** Selectable column ids in live display order (visible leaf columns minus the checkbox) — the
   *  host orders its save-review sections by this. */
  getSelectableColumnIds: () => string[];
}

/**
 * Subsequence fuzzy match (case-insensitive): the indices in `text` matched by `query`'s chars in
 * order, or null when they don't all appear. Empty query → [] (matches everything, no highlight).
 */
function fuzzyMatchIndices(text: string, query: string): number[] | null {
  if (query === '') return [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const out: number[] = [];
  let hi = 0;
  for (const ch of needle) {
    let hit = -1;
    while (hi < haystack.length) {
      const cur = haystack[hi];
      hi += 1;
      if (cur === ch) {
        hit = hi - 1;
        break;
      }
    }
    if (hit === -1) return null;
    out.push(hit);
  }
  return out;
}

/** Render `text` with the given (subsequence-matched) char positions highlighted. */
function highlightLabel(text: string, indices: number[]): JSX.Element {
  if (indices.length === 0) return <>{text}</>;
  const hit = new Set(indices);
  return (
    <>
      {Array.from(text, (ch, i) =>
        hit.has(i) ? <span class="rounded-sm bg-yellow-200 text-text">{ch}</span> : ch,
      )}
    </>
  );
}

/**
 * Column manager. Two tabs:
 *  - Select — every hideable column, in foldable sections grouped by `group` (its source), each with
 *    a per-column checkbox + a section select-all; ordered by the server priority within a section.
 *    A quick-filter narrows to matching columns (subsequence fuzzy, group-name aware).
 *  - Reorder — only the currently-visible columns, drag-to-reorder (the same move the header drag does).
 */
export function ColumnManagerModal<TRow>(props: {
  table: Table<TRow>;
  columnOrder: ColumnOrderState;
  columns: GridColumnMeta[];
  /**
   * Filter text the picker opens with, pre-selected so one Backspace clears it.
   *
   * Set when the picker is opened from a *column's* context menu: the operator arrived from one
   * column, so opening on the whole list makes them find it again. Selected rather than merely
   * filled because the narrowed view is a starting point, not a destination — widening back out
   * has to cost one keystroke, or the preload is a cage.
   */
  initialQuery?: string;
  /** Host-provided localized section titles by group key (see {@link DataGridProps.groupLabels}). */
  groupLabels?: () => Record<string, string>;
  onMoveColumn: (sourceId: string, targetId: string) => void;
  /** Persisted set of expanded section keys (empty = all folded, the default). Controlled by the
   *  host so it survives reloads; falls back to in-memory state when not provided. */
  expandedSections?: () => string[];
  setExpandedSections?: (updater: (prev: string[]) => string[]) => void;
  /** Reset column visibility / order / sizing to this surface's defaults. Shown as a footer button
   *  when provided; the host owns what "default" means (it knows its default-visible set). */
  onReset?: () => void;
  /**
   * Whether this user may rename columns. Unlike every other control here, a rename is **store-wide
   * and per-language**, so it is gated where the others are not — see {@link onRenameColumn}.
   */
  canRenameColumns?: () => boolean;
  /**
   * Persist a merchant-authored name for one column, or clear it.
   *
   * Send the trimmed text; an empty string, or the column's own `defaultLabel`, both mean "no
   * override" and the server drops them. Rejecting resolves the caller's promise — the row reverts
   * and says so, because a blur-triggered save happens after the eye has moved on.
   */
  onRenameColumn?: (columnId: string, label: string) => Promise<void> | void;
  onClose: () => void;
}) {
  // Focus return (to the Columns button, or to the grid container when opened with Ctrl+M from a
  // cell) is the enclosing Modal's job — it captures the opener at render and restores on close.

  const [tab, setTab] = createSignal<'select' | 'reorder'>('select');
  // Sections are folded by default; only the keys in this set are open. Host-persisted when the
  // controlled props are supplied, else an in-memory fallback.
  const [internalExpanded, setInternalExpanded] = createSignal<string[]>([]);
  const expandedList = (): string[] => props.expandedSections?.() ?? internalExpanded();
  const isExpanded = (key: string): boolean => filtering() || expandedList().includes(key);
  // Drag-to-reorder the visible columns — the shared @invflux/ui primitive (same one the app's tab
  // strips use). onReorder moves the dragged column to the drop target's slot.
  const columnReorder = createDragReorder(props.onMoveColumn);

  const metaById = createMemo(() => new Map(props.columns.map((c) => [c.id, c])));
  const priorityOf = (col: Column<TRow>): number => metaById().get(col.id)?.priority ?? 1000;
  const labelOf = (col: Column<TRow>): string =>
    metaById().get(col.id)?.label ??
    (typeof col.columnDef.header === 'string' ? col.columnDef.header : col.id);
  /** The shipped name. Equal to {@link labelOf} unless a merchant has renamed the column. */
  const defaultLabelOf = (col: Column<TRow>): string =>
    metaById().get(col.id)?.defaultLabel ?? labelOf(col);
  const isRenamed = (col: Column<TRow>): boolean => labelOf(col) !== defaultLabelOf(col);
  const canRename = (): boolean =>
    props.onRenameColumn !== undefined && (props.canRenameColumns?.() ?? false);

  // ── Inline rename ─────────────────────────────────────────────────────────
  // `pristine` is the name the input OPENED with — the override if there is one — and is what
  // dirty-checking compares against. It is not `defaultLabel`, which is the shipped name and means
  // something else entirely here: typing *that* is how a merchant removes an override. The two
  // coincide only on a column nobody has renamed yet, and conflating them breaks both directions.
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal('');
  const [pristine, setPristine] = createSignal('');
  const [savingRename, setSavingRename] = createSignal(false);
  const [renameError, setRenameError] = createSignal<{ id: string; message: string } | null>(null);

  const beginRename = (col: Column<TRow>): void => {
    setPristine(labelOf(col));
    setDraft(labelOf(col));
    setRenameError(null);
    setEditingId(col.id);
  };

  /**
   * Cancel by putting the pristine value back, rather than by raising a "cancelled" flag.
   *
   * Escape blurs, and blur commits — so a flag only works if it is set before blur fires, which is
   * a race with an input that may unmount first and never fire blur at all. Restoring the value
   * instead makes every ordering correct: the commit below sees nothing changed and does nothing.
   */
  const cancelRename = (): void => {
    setDraft(pristine());
    setEditingId(null);
  };

  const commitRename = async (col: Column<TRow>): Promise<void> => {
    // One save at a time. Committing disables the input while the request is in flight, and
    // disabling a FOCUSED input fires blur — which re-enters here before the await resolves, with
    // `pristine` not yet moved, so the edit still looks dirty and posts a second time. Those two
    // requests then race for the same settings row: both take `SELECT … FOR UPDATE` on it and
    // deadlock, one gets rolled back, and the grid recomputes its labels from whichever response
    // won. Not a harmless duplicate — it is how a save came back showing the name it replaced.
    if (savingRename()) return;
    // Compare the SIGNAL, not the input's DOM value: Escape restores the signal, and reading the
    // element instead would reintroduce the timing question this design exists to remove.
    const next = draft().trim();
    if (next === pristine().trim()) {
      setEditingId(null);

      return;
    }
    setSavingRename(true);
    try {
      await props.onRenameColumn?.(col.id, next);
      // Adopt the saved text as the new pristine BEFORE closing. Committing unmounts the input,
      // which fires blur, which commits again — and against the pre-save pristine that second pass
      // still looks dirty, so every Enter posted twice. Idempotent, but two store writes per
      // rename. Moving pristine forward makes the blur a no-op by the same rule that makes Escape
      // one: nothing changed, so nothing is sent.
      setPristine(next);
      setEditingId(null);
    } catch (err) {
      // A blur-triggered save lands after the eye has moved on, so a failure has to be visible and
      // has to put the old name back — silence would leave the row showing a name that was refused.
      setRenameError({
        id: col.id,
        message: err instanceof Error ? err.message : __('Could not save that name.'),
      });
      setDraft(pristine());
    } finally {
      setSavingRename(false);
    }
  };

  const hideable = createMemo(() =>
    props.table.getAllLeafColumns().filter((col) => col.getCanHide()),
  );

  // Select tab: columns bucketed by group, sections ordered by their lowest column priority.
  const sections = createMemo(() => {
    const buckets = new Map<string, Column<TRow>[]>();
    for (const col of hideable()) {
      const key = metaById().get(col.id)?.group ?? '';
      (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(col);
    }
    return [...buckets.entries()]
      .map(([key, cols]) => ({
        key,
        label: columnGroupLabel(key, props.groupLabels?.() ?? {}),
        cols: [...cols].sort((a, b) => priorityOf(a) - priorityOf(b)),
      }))
      .sort((a, b) => Math.min(...a.cols.map(priorityOf)) - Math.min(...b.cols.map(priorityOf)));
  });

  // Quick filter (Select tab): subsequence-fuzzy over column labels, and group names (a group-name
  // match surfaces the whole group). Matching sections force-expand + zero-match sections drop out;
  // the user's expanded set is untouched, so it's restored the moment the query clears.
  // Read once: the modal unmounts on close, so each open re-runs this with that open's own value.
  const [query, setQuery] = createSignal(props.initialQuery ?? '');
  const filtering = (): boolean => query().trim() !== '';
  const filteredSections = createMemo(() => {
    const q = query().trim();
    return sections()
      .map((section) => {
        if (q === '')
          return { ...section, shownCols: section.cols, groupMatch: [] as number[] | null };
        const groupMatch = fuzzyMatchIndices(section.label, q);
        if (groupMatch !== null) return { ...section, shownCols: section.cols, groupMatch };
        // Both names, so a renamed column is still findable by what the docs and support call it —
        // and so is a colleague's rename you have not learned yet.
        const shownCols = section.cols.filter(
          (col) =>
            fuzzyMatchIndices(labelOf(col), q) !== null ||
            fuzzyMatchIndices(defaultLabelOf(col), q) !== null,
        );
        return { ...section, shownCols, groupMatch: null as number[] | null };
      })
      .filter((section) => section.shownCols.length > 0);
  });

  // Reorder tab: the visible columns only, in the live grid order.
  const visibleOrdered = createMemo(() => {
    const byId = new Map(hideable().map((col) => [col.id, col]));
    return props.columnOrder
      .map((id) => byId.get(id))
      .filter((col): col is Column<TRow> => col !== undefined && col.getIsVisible());
  });

  const toggleSection = (key: string): void => {
    const update = (prev: string[]): string[] =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
    if (props.setExpandedSections) props.setExpandedSections(update);
    else setInternalExpanded(update);
  };

  const visibleCount = (cols: Column<TRow>[]): number =>
    cols.filter((c) => c.getIsVisible()).length;
  const toggleSectionAll = (cols: Column<TRow>[]): void => {
    const target = visibleCount(cols) < cols.length; // show all unless already all shown → hide all
    for (const col of cols) {
      if (col.getIsVisible() !== target) col.toggleVisibility(target);
    }
  };

  const tabClass = (active: boolean): string =>
    `-mb-px cursor-pointer rounded-t border-b-2 px-3 py-1.5 text-sm font-medium ${
      active
        ? 'border-primary bg-surface text-primary'
        : 'border-transparent bg-surface-hover text-text-muted hover:text-text'
    }`;

  // Up/Down move focus through the modal's focusables, mirroring Tab/Shift+Tab (combobox-like).
  let panelRef: HTMLDivElement | undefined;
  let filterInputRef: HTMLInputElement | undefined;
  const FOCUSABLE =
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const moveFocus = (dir: 1 | -1): void => {
    if (!panelRef) return;
    const items = Array.from(panelRef.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null,
    );
    if (items.length === 0) return;
    const root = panelRef.getRootNode() as Document | ShadowRoot;
    const active = root.activeElement as HTMLElement | null;
    const i = active ? items.indexOf(active) : -1;
    const next =
      i === -1 ? (dir === 1 ? 0 : items.length - 1) : (i + dir + items.length) % items.length;
    items[next]?.focus();
  };

  // Esc owned at document-capture so it fires from ANY focused control in the modal (e.g. a
  // just-toggled checkbox, not only the filter input): clear + refocus the quick filter when it has
  // text, else close. Modal's own Esc is disabled (closeOnEsc=false) to defer to this.
  onMount(() => {
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      // An open rename claims Escape first: it abandons the edit and keeps the dialog, its filter
      // and the rest of the list. Escape reaching past an inline edit to close the whole manager is
      // a reported bug from the tag rename — see ESC_LOCAL_ATTR in Modal.
      if (editingId() !== null) {
        cancelRename();
      } else if (tab() === 'select' && filtering()) {
        setQuery('');
        filterInputRef?.focus();
      } else {
        props.onClose();
      }
    };
    document.addEventListener('keydown', onEsc, true);
    onCleanup(() => document.removeEventListener('keydown', onEsc, true));
  });

  return (
    <Modal
      onClose={props.onClose}
      closeOnEsc={false}
      backdropClass="flex items-start justify-center bg-black/30 p-6 pt-16"
      label={__('Columns')}
    >
      <ModalPanel
        ref={panelRef}
        size="md"
        onKeyDown={(e) => {
          // Esc = Done (keep state + close) is handled by Modal's document-capture closeOnEsc, so it
          // fires from any focused control here (e.g. a just-toggled checkbox). This handler adds:
          if (e.key === 'ArrowDown') {
            // Up/Down navigate focus like Tab/Shift+Tab (combobox-like).
            e.preventDefault();
            moveFocus(1);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            moveFocus(-1);
          } else if (
            e.key === '/' &&
            tab() === 'select' &&
            filterInputRef &&
            e.target !== filterInputRef
          ) {
            // "/" jumps back to the quick filter (matches the grid's "/"=focus-search) unless already in it.
            e.preventDefault();
            filterInputRef.focus();
          } else if (
            e.key === 'Enter' &&
            e.target instanceof HTMLInputElement &&
            e.target.type === 'checkbox'
          ) {
            // Enter toggles a focused checkbox too (native checkboxes only respond to Space).
            e.preventDefault();
            e.target.click();
          }
        }}
      >
        <ModalDragHandle
          class={`flex items-center gap-1 border-b border-border px-3 pt-2 ${MODAL_BAR_TINT}`}
        >
          <button
            type="button"
            class={tabClass(tab() === 'select')}
            onClick={() => setTab('select')}
          >
            {__('Select')}
          </button>
          <button
            type="button"
            class={tabClass(tab() === 'reorder')}
            onClick={() => setTab('reorder')}
          >
            {/* Context-tagged: "Reorder" here means rearrange columns, not the stock "Reorder"
                (reorder_threshold) column — which shares the bare msgid and mistranslates in fr. */}
            {_x('Reorder', 'column manager tab: rearrange the visible columns')}
          </button>
        </ModalDragHandle>

        <div class="flex-1 overflow-auto p-3">
          {/* ── Select: quick filter + foldable per-source sections ── */}
          <Show when={tab() === 'select'}>
            <input
              type="text"
              value={query()}
              ref={(el) => {
                filterInputRef = el;
                queueMicrotask(() => {
                  el.focus();
                  // Selected, not just focused: a preloaded filter has to be dismissable with one
                  // Backspace. Harmless when the field is empty.
                  el.select();
                });
              }}
              placeholder={__('Filter columns…')}
              aria-label={__('Filter columns')}
              data-testid="column-manager-filter"
              class="mb-2 w-full rounded border border-border bg-surface px-2 py-1 text-sm"
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
            <For
              each={filteredSections()}
              fallback={
                <div class="px-2 py-4 text-center text-sm text-text-muted">
                  {__('No matching columns.')}
                </div>
              }
            >
              {(section) => {
                const expanded = (): boolean => isExpanded(section.key);
                return (
                  <div class="mb-2">
                    <div
                      class="flex items-center gap-2 rounded bg-gray-50 px-2 py-1"
                      classList={{ 'cursor-pointer': !filtering() }}
                      onClick={() => {
                        if (!filtering()) toggleSection(section.key);
                      }}
                    >
                      <button
                        type="button"
                        class="w-4 cursor-pointer select-none text-text-muted disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label={__('Toggle section')}
                        disabled={filtering()}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSection(section.key);
                        }}
                      >
                        {expanded() ? '▾' : '▸'}
                      </button>
                      <input
                        type="checkbox"
                        // Named per section, not "Select all": the picker renders one of these per
                        // group, so a shared name would announce every one of them identically.
                        aria-label={sprintf(__('Select all columns in %s'), section.label)}
                        ref={(el) =>
                          createEffect(() => {
                            const shown = visibleCount(section.shownCols);
                            el.indeterminate = shown > 0 && shown < section.shownCols.length;
                          })
                        }
                        checked={visibleCount(section.shownCols) === section.shownCols.length}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleSectionAll(section.shownCols)}
                      />
                      <span class="flex-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                        {section.groupMatch && section.groupMatch.length > 0
                          ? highlightLabel(section.label, section.groupMatch)
                          : section.label}
                      </span>
                      <span class="text-xs text-text-muted">
                        {visibleCount(section.shownCols)}/{section.shownCols.length}
                      </span>
                    </div>
                    <Show when={expanded()}>
                      <ul class="mt-1 space-y-0.5 pl-6">
                        <For each={section.shownCols}>
                          {(col) => {
                            const idx = (): number[] | null =>
                              fuzzyMatchIndices(labelOf(col), query().trim());
                            // Shown only when the SHIPPED name is what matched. Surfacing it on
                            // every renamed row while filtering would be noise with nothing to
                            // highlight; here its presence is the explanation for the row's.
                            const defaultIdx = (): number[] | null =>
                              filtering() && isRenamed(col) && idx() === null
                                ? fuzzyMatchIndices(defaultLabelOf(col), query().trim())
                                : null;
                            const editing = (): boolean => editingId() === col.id;
                            const failed = (): string | null =>
                              renameError()?.id === col.id
                                ? (renameError()?.message ?? null)
                                : null;

                            return (
                              <li
                                class="rounded px-2 py-1 text-sm hover:bg-gray-100"
                                data-testid={`column-row-${col.id}`}
                              >
                                <div class="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    id={`col-${col.id}`}
                                    checked={col.getIsVisible()}
                                    onChange={() => col.toggleVisibility()}
                                  />
                                  <Show
                                    when={!editing()}
                                    fallback={
                                      <input
                                        type="text"
                                        class="min-w-0 flex-1 rounded border border-primary bg-surface px-1 py-0.5 text-sm"
                                        data-testid={`column-rename-input-${col.id}`}
                                        // The shipped name, so emptying the field shows what it
                                        // will fall back to. That makes the reset rule legible
                                        // from the control itself rather than only from the
                                        // tooltip — clear it and you can already see the result.
                                        placeholder={defaultLabelOf(col)}
                                        value={draft()}
                                        disabled={savingRename()}
                                        aria-label={__('Column name')}
                                        // Says what it is for, not what to beware of: one team, one
                                        // vocabulary, is the reason this control exists at all.
                                        title={__(
                                          'The name your whole team sees, in this language. Clear it to restore the original.',
                                        )}
                                        ref={(el) => queueMicrotask(() => el.select())}
                                        onInput={(e) => setDraft(e.currentTarget.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            e.preventDefault();
                                            void commitRename(col);
                                          }
                                          // Escape is handled by the modal's document-capture
                                          // listener, which cancels the edit and keeps the dialog.
                                        }}
                                        onBlur={() => void commitRename(col)}
                                      />
                                    }
                                  >
                                    <label
                                      class="min-w-0 flex-1 cursor-pointer truncate"
                                      for={`col-${col.id}`}
                                    >
                                      {(() => {
                                        const hits = idx();
                                        return hits && hits.length > 0
                                          ? highlightLabel(labelOf(col), hits)
                                          : labelOf(col);
                                      })()}
                                    </label>
                                    <Show when={canRename()}>
                                      <Show
                                        when={isRenamed(col)}
                                        fallback={
                                          <IconButton
                                            size="sm"
                                            label={__('Rename column')}
                                            data-testid={`column-rename-${col.id}`}
                                            onClick={() => beginRename(col)}
                                          >
                                            <PencilIcon class="h-3.5 w-3.5" />
                                          </IconButton>
                                        }
                                      >
                                        <button
                                          type="button"
                                          class="shrink-0 cursor-pointer truncate text-2xs text-text-muted hover:text-text hover:underline"
                                          data-testid={`column-rename-${col.id}`}
                                          title={sprintf(
                                            __('Original name: %s'),
                                            defaultLabelOf(col),
                                          )}
                                          onClick={() => beginRename(col)}
                                        >
                                          {(() => {
                                            const hits = defaultIdx();
                                            if (hits && hits.length > 0) {
                                              // A prefix rather than a `%s` placeholder: the name
                                              // arrives as marked-up nodes (the match is
                                              // highlighted), which no format string can carry.
                                              return (
                                                <>
                                                  {_x(
                                                    'original:',
                                                    'column manager: label before the shipped name a renamed column matched on',
                                                  )}{' '}
                                                  {highlightLabel(defaultLabelOf(col), hits)}
                                                </>
                                              );
                                            }

                                            return _x(
                                              '(edited)',
                                              'column manager: this column carries a merchant-chosen name',
                                            );
                                          })()}
                                        </button>
                                      </Show>
                                    </Show>
                                  </Show>
                                </div>
                                <Show when={failed()}>
                                  <div class="pl-6 text-2xs text-red-700">{failed()}</div>
                                </Show>
                              </li>
                            );
                          }}
                        </For>
                      </ul>
                    </Show>
                  </div>
                );
              }}
            </For>
          </Show>

          {/* ── Reorder: drag the visible columns ── */}
          <Show when={tab() === 'reorder'}>
            <ul class="space-y-1">
              <For
                each={visibleOrdered()}
                fallback={
                  <li class="px-2 py-1 text-sm text-text-muted">{__('No visible columns.')}</li>
                }
              >
                {(col) => (
                  <>
                    <Show when={columnReorder.isDropTarget(col.id)}>
                      <li class="h-0.5 rounded bg-primary" aria-hidden="true" />
                    </Show>
                    <li
                      class="flex cursor-move items-center gap-2 rounded border border-border px-2 py-1 text-sm hover:bg-gray-100"
                      classList={{ 'opacity-50': columnReorder.isDragging(col.id) }}
                      {...columnReorder.itemProps(col.id)}
                    >
                      <span class="w-4 select-none text-text-muted" aria-hidden="true">
                        ⋮⋮
                      </span>
                      <span class="min-w-0 flex-1 truncate">{labelOf(col)}</span>
                    </li>
                  </>
                )}
              </For>
            </ul>
          </Show>
        </div>

        <ModalFooter layout="between">
          <Show when={props.onReset} fallback={<span />}>
            <Button variant="ghost" onClick={() => props.onReset?.()}>
              {__('Reset to default')}
            </Button>
          </Show>
          <Button variant="secondary" onClick={props.onClose}>
            {__('Done')}
          </Button>
        </ModalFooter>
      </ModalPanel>
    </Modal>
  );
}

interface ContextMenuItem {
  key: string;
  label: string;
  shortcut?: string;
  /** Leaf action. Omitted for a submenu parent (which carries `children` instead). */
  run?: () => void;
  /** Present ⇒ this item is a submenu parent (hover-opens a flyout of `children`); `run` is ignored. */
  children?: ContextMenuItem[];
  /** Disabled items render greyed, don't run, and show `title` as a tooltip (e.g. a Pro upgrade hint). */
  disabled?: boolean;
  title?: string;
}

/**
 * A host-contributed {@link DataGridMenuItem} as an internal menu item. Recursive, so an extra may be
 * a submenu parent. Shared by the cell menu and the header menu — the two differ in *what* they hand
 * the host, never in how a contribution is rendered.
 *
 * `checked` becomes the same `✓` the grid's own three-way choices use, rather than exposing the
 * internal `shortcut` slot: a host contributing a settings-style submenu should get the grid's mark,
 * not have to spell a glyph into its label and hope it lines up.
 */
function toContextMenuItem(m: DataGridMenuItem): ContextMenuItem {
  return {
    key: m.id,
    label: m.label,
    disabled: m.disabled,
    title: m.title,
    shortcut: m.checked === true ? '✓' : undefined,
    run: m.run,
    children: m.children?.map(toContextMenuItem),
  };
}

export function DataGrid<TRow>(props: DataGridProps<TRow>) {
  const ch = createColumnHelper<TRow>();

  let scrollContainerRef!: HTMLDivElement;

  // Header drag-reorder vs resize coordination + drop indicator.
  const [resizingActive, setResizingActive] = createSignal(false); // true from grip press to mouseup
  const [draggingColId, setDraggingColId] = createSignal<string | null>(null); // column being dragged
  const [dropTargetId, setDropTargetId] = createSignal<string | null>(null); // column the cursor is over

  const [draggingSelection, setDraggingSelection] = createSignal(false);
  // Per-cell edit (6b.4): which cell is currently being edited, and the typed-char seed.
  const [editingCell, setEditingCell] = createSignal<CellCoord | null>(null);
  const [editEntryText, setEditEntryText] = createSignal<string | undefined>(undefined);
  // Right-click context menu (6b.5): viewport position + the cell it was opened on.
  // The right-click menu serves cells (a CellCoord) and column headers (a columnId); the render is
  // shared, item-building branches on which is present.
  const [contextMenu, setContextMenu] = createSignal<
    | { x: number; y: number; coord: CellCoord; columnId?: undefined }
    | { x: number; y: number; coord?: undefined; columnId: string }
    | null
  >(null);
  // Open submenu key PER DEPTH (0 = top level). Lets an ancestor chain stay open while siblings close,
  // so the context menu supports arbitrary submenu nesting.
  const [openByDepth, setOpenByDepth] = createSignal<Record<number, string>>({});
  // Hovering an item at `depth`: open its submenu (or clear, for a leaf), keeping ancestors (shallower
  // depths) open and dropping any deeper-open submenus.
  const hoverAt = (depth: number, key: string | null): void => {
    setOpenByDepth((prev) => {
      const next: Record<number, string> = {};
      for (const [d, k] of Object.entries(prev)) if (Number(d) < depth) next[Number(d)] = k;
      if (key !== null) next[depth] = key;
      return next;
    });
  };
  // Per-cell drill-down (6b.7): the open detail view's column/subject + fetched payload.
  const [drilldown, setDrilldown] = createSignal<{
    columnId: string;
    meta: GridColumnMeta | undefined;
    subjectId: number;
    /** Header title render fn — defaults to the column label; a drill-down may override with richer
     *  JSX. An accessor (not eager JSX) so it renders in the header's owner, not the fetch callback. */
    title: (() => JSX.Element) | undefined;
    /** Optional second header line under the title (e.g. the drill-down subject's name). */
    subtitle: (() => JSX.Element) | undefined;
    detail: unknown;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const [showColManager, setShowColManager] = createSignal(false);
  // Filter the picker should open with. Only the header context menu sets one; every other entry
  // point (Ctrl+M, the toolbar, the gear) opens on the full list, so each of those clears it —
  // otherwise the last right-click would still be narrowing the picker two openings later.
  const [colManagerQuery, setColManagerQuery] = createSignal('');
  const openColumnManager = (initialQuery = ''): void => {
    setColManagerQuery(initialQuery);
    setShowColManager(true);
  };
  /**
   * A column's SHIPPED name — the picker's filter matches that even on a renamed column, and it is
   * the name the operator will recognise from the header they just right-clicked.
   */
  const shippedNameOf = (columnId: string): string => {
    const meta = columnMetaById().get(columnId);
    if (meta !== undefined) return meta.defaultLabel ?? meta.label;
    const header = table.getColumn(columnId)?.columnDef.header;

    return 'string' === typeof header ? header : columnId;
  };
  const [showGridSettings, setShowGridSettings] = createSignal(false);
  const [showGearMenu, setShowGearMenu] = createSignal(false);
  let gearRef: HTMLDivElement | undefined;

  // Grid display settings (density / wrap / text size) — grid-internal, persisted per props.settingsKey.
  const [gridSettings, setGridSettings] = createSignal<GridSettings>(
    loadGridSettings(props.settingsKey, props.defaultGridSettings),
  );
  createEffect(() => {
    const key = props.settingsKey;
    const s = gridSettings();
    if (key !== undefined) saveGridSettings(key, s);
  });

  // Inside the unified app shell, contribute a "Data Grid" section to the active surface's gear popover
  // (§11.4) instead of the standalone display modal — so grid display settings live where every other
  // page setting does. Outside the shell (standalone admin page / embedded product-tab grid) `surface`
  // is undefined and the local `Ctrl+,` modal is used instead. Registered for the grid's lifetime.
  const surface = useSurface();
  if (surface) {
    onCleanup(
      surfaceSettingsRegistry.register({
        surfaceId: surface.surfaceId,
        id: 'datagrid-display',
        order: 90, // after the surface's own settings panel
        label: () => __('Data Grid'),
        component: () => (
          <SettingsSection title={__('Data Grid')}>
            <GridDisplaySettingsControls settings={gridSettings()} onChange={setGridSettings} />
          </SettingsSection>
        ),
      }),
    );
  }

  // Record-layout column widths (field-label column + the uniform record columns), drag-resizable.
  const [recordFieldWidth, setRecordFieldWidth] = createSignal(
    loadRecordWidth(props.settingsKey, 'field', 200),
  );
  const [recordColWidth, setRecordColWidth] = createSignal(
    loadRecordWidth(props.settingsKey, 'col', 190),
  );
  createEffect(() => {
    if (props.settingsKey !== undefined)
      saveRecordWidth(props.settingsKey, 'field', recordFieldWidth());
  });
  createEffect(() => {
    if (props.settingsKey !== undefined)
      saveRecordWidth(props.settingsKey, 'col', recordColWidth());
  });
  // Drag a record-layout column edge — the field-label column, or the (uniform) record columns.
  // Uses POINTER CAPTURE on the grip element itself: once captured, all pointermove/up events are
  // delivered to the grip regardless of where the cursor travels — which is what makes this work
  // inside the embed's shadow DOM (document-level listeners were missing the events). Resizing one
  // record column resizes them all (they share `recordColWidth`).
  const startRecordResize = (
    which: 'field' | 'col',
    e: PointerEvent & { currentTarget: HTMLElement },
  ): void => {
    e.preventDefault();
    e.stopPropagation();
    const grip = e.currentTarget;
    const startX = e.clientX;
    const startWidth = which === 'field' ? recordFieldWidth() : recordColWidth();
    setResizingActive(true);
    const onMove = (ev: PointerEvent | MouseEvent): void => {
      const w = Math.max(60, startWidth + (ev.clientX - startX));
      if (which === 'field') setRecordFieldWidth(w);
      else setRecordColWidth(w);
    };
    const onUp = (): void => {
      setResizingActive(false);
      try {
        grip.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may not have been set */
      }
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // Belt-and-suspenders: pointer-capture on the grip AND document/window listeners — whichever the
    // (shadow-DOM) environment actually delivers wins; all are torn down together.
    try {
      grip.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  // Reactive cell classes derived from the settings. Density drives vertical padding, text size the font,
  // wrap toggles single-line-truncate vs the default wrapping.
  const cellDensityText = (): string =>
    `${DENSITY_PADDING[gridSettings().density]} ${TEXT_SIZE_CLASS[gridSettings().textSize]}`;
  /** The wrap mode in force for one column: its own override, else the grid-wide setting. */
  const wrapForColumn = (columnId: string): GridWrap =>
    gridSettings().columnWrap[columnId] ?? gridSettings().wrap;
  // No-wrap truncates the cell's direct children (block content like the product name/sub-lines) — a
  // `text-ellipsis` on the <td> can't reach nested blocks, so target the children instead.
  const cellWrapClass = (columnId: string): string =>
    wrapForColumn(columnId) === 'no-wrap' ? ' whitespace-nowrap [&>*]:truncate' : '';
  // Header classes. The size step is chosen here rather than appended to `cellDensityText()`: two
  // font-size utilities on one element are resolved by stylesheet order, not by the order they were
  // concatenated in, so "append a smaller one to win" is a coin flip that happens to land right.
  const headerLines = (): number => gridSettings().headerLines;
  const headerDensityText = (): string =>
    `${DENSITY_PADDING[gridSettings().density]} ${
      headerLines() > 1
        ? TEXT_SIZE_CLASS_SMALLER[gridSettings().textSize]
        : TEXT_SIZE_CLASS[gridSettings().textSize]
    }`;
  // Centred when wrapping, matching the single-line case (a table cell's default) and the sort
  // affordance, so a one-line name beside a two-line one reads as one row of labels rather than as
  // text at two different heights. `hyphens-auto` first and `break-words` only as the fallback: a
  // column narrower than its own one-word name is common here ("Disponible", "Réservé"), and a
  // hyphenated break reads as language while a bare mid-word split reads as damage. Hyphenation
  // follows the document language, which the host sets.
  const headerWrapClass = (): string =>
    headerLines() > 1
      ? 'whitespace-normal hyphens-auto break-words align-middle leading-tight'
      : 'whitespace-nowrap';
  /**
   * Bound the header content to the allowed number of lines; the rest is clipped.
   *
   * A height cap on a block wrapper, not `-webkit-line-clamp`. The clamp is the obvious tool and it
   * is wrong here twice: `max-height` does not apply to a `table-cell` so it needs a wrapper either
   * way, and a clamp box is *inline-level*, so it shares a line box with the header's own strut and
   * the sort arrows — which reserves close to an extra line (measured: 61px of cell for two 15px
   * lines of text, i.e. a visible third line's worth of empty space). A block box is laid out from
   * its own content and has no such interaction.
   *
   * `em` rather than `px` so one expression covers all three text sizes, and 1.25 to match the
   * `leading-tight` the wrapping header sets. Inline style because the count is runtime state —
   * Tailwind only emits classes it can read in the source.
   */
  const headerBoundStyle = (): JSX.CSSProperties | undefined =>
    headerLines() > 1 ? { 'max-height': `calc(${headerLines()} * 1.25em)` } : undefined;

  /** Pin one column's wrap mode against the grid-wide default, or (`null`) hand it back to it. */
  function setColumnWrap(columnId: string, wrap: GridWrap | null): void {
    setGridSettings((prev) => {
      const columnWrap = { ...prev.columnWrap };
      if (wrap === null) delete columnWrap[columnId];
      else columnWrap[columnId] = wrap;

      return { ...prev, columnWrap };
    });
  }

  // Close the gear menu on an outside click (shadow-DOM aware — the SPA mounts in a shadow root).
  createEffect(() => {
    if (!showGearMenu()) return;
    const root = (gearRef?.getRootNode() ?? document) as Document | ShadowRoot;
    const onDown = (e: Event): void => {
      if (gearRef && !e.composedPath().includes(gearRef)) setShowGearMenu(false);
    };
    root.addEventListener('pointerdown', onDown, true);
    onCleanup(() => root.removeEventListener('pointerdown', onDown, true));
  });

  const componentChoiceId = (dataType: string, role: DataGridComponentRole): string | undefined =>
    props.componentChoiceId?.(dataType, role);
  const taxonomySpace = (): TaxonomySpace | undefined => props.taxonomySpace?.();

  const leadingColumnIds = (): string[] => props.leadingColumnIds ?? ['select'];
  const layout = (): DataGridLayout => props.layout?.() ?? 'grid';
  const trailingColumnIds = (): string[] => props.trailingColumnIds ?? ['orders'];

  // Generic column for a server datatype that has no bespoke def (taxonomy / add-on columns) — the
  // shared factory (also used by the transposed RecordView) so datatype cells render identically.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function genericColumn(meta: GridColumnMeta): ColumnDef<TRow, any> {
    return makeGenericColumn<TRow>(ch, meta, {
      getValue: props.getValue,
      getStagedValue: props.getStagedValue,
      isGenericColumnInherited: props.isGenericColumnInherited,
      componentChoiceId: props.componentChoiceId,
      taxonomySpace,
      wrap: () => gridSettings().wrap,
    });
  }

  // Server-driven column list: leading + (server columns mapped to bespoke-or-generic) +
  // trailing structural. Before metadata arrives, fall back to the bespoke columns (in their
  // leading/trailing order) so the first paint is unchanged.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns = createMemo<ColumnDef<TRow, any>[]>(() => {
    const serverColumns = props.columnMetas();
    const bespoke = props.bespokeColumns;
    if (serverColumns.length === 0) return [...bespoke.values()];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ordered: ColumnDef<TRow, any>[] = [];
    for (const id of leadingColumnIds()) {
      const def = bespoke.get(id);
      if (def) ordered.push({ ...def, size: 44, enableResizing: false });
    }

    // Seed each data column's width from the server-declared defaultWidth; the user's resize
    // overrides live in columnSizing state (getSize() prefers it).
    for (const meta of serverColumns) {
      const def = bespoke.get(meta.id) ?? genericColumn(meta);
      ordered.push({ ...def, size: meta.defaultWidth });
    }

    for (const id of trailingColumnIds()) {
      const def = bespoke.get(id);
      if (def) ordered.push({ ...def, size: 130 });
    }

    return ordered;
  });
  const availableColumnIds = createMemo(() =>
    columns()
      .map((column) => column.id)
      .filter((id): id is string => typeof id === 'string' && id !== ''),
  );

  function moveColumn(sourceId: string, targetId: string): void {
    props.setColumnOrder((prev) => {
      const order = mergeColumnOrder(prev, availableColumnIds());
      const fromIndex = order.indexOf(sourceId);
      const toIndex = order.indexOf(targetId);
      if (fromIndex <= 0 || toIndex <= 0 || fromIndex === toIndex) return order;

      return moveArrayItem(order, fromIndex, fromIndex < toIndex ? toIndex - 1 : toIndex);
    });
  }

  createEffect(() => {
    const merged = mergeColumnOrder(props.columnOrder(), availableColumnIds());
    if (!sameStringArray(props.columnOrder(), merged)) {
      props.setColumnOrder(() => merged);
    }
  });

  // Seed default visibility from server metadata: columns flagged visibleByDefault: false
  // (e.g. taxonomy columns) start hidden until the merchant opts in via the column picker.
  // Only columns not already in the persisted visibility state are touched.
  createEffect(() => {
    const serverColumns = props.columnMetas();
    if (serverColumns.length === 0) return;

    props.setColumnVisibility((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const column of serverColumns) {
        if (!column.visibleByDefault && !(column.id in next)) {
          next[column.id] = false;
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  });

  const table = createSolidTable({
    get data() {
      return props.rows();
    },
    get columns() {
      return columns();
    },
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    enableMultiSort: false,
    enableRowSelection: true,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    defaultColumn: { minSize: 48, size: 140, maxSize: 800 },
    getRowId: (row) => props.getRowId(row),
    state: {
      get sorting() {
        return props.sorting();
      },
      get columnVisibility() {
        return props.columnVisibility();
      },
      get rowSelection() {
        return props.rowSelection();
      },
      get columnOrder() {
        return props.columnOrder();
      },
      get columnSizing() {
        return props.columnSizing();
      },
    },
    onColumnSizingChange: (updater) => {
      props.setColumnSizing((prev) => (typeof updater === 'function' ? updater(prev) : updater));
    },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(props.sorting()) : updater;
      props.onSortingChange(next);
    },
    onColumnVisibilityChange: (updater) => {
      props.setColumnVisibility((prev) =>
        typeof updater === 'function' ? updater(prev) : updater,
      );
    },
    onColumnOrderChange: (updater) => {
      props.setColumnOrder((prev) => (typeof updater === 'function' ? updater(prev) : updater));
    },
    onRowSelectionChange: (updater) => {
      props.setRowSelection((prev) => (typeof updater === 'function' ? updater(prev) : updater));
    },
  });

  const visibleRows = createMemo(() => table.getRowModel().rows);

  // Virtual scroll. Row-height estimate tracks the density + text-size settings (border + padding +
  // line); wrapped rows run taller, accepted as before. Re-measure when the settings change.
  const virtualizer = createVirtualizer({
    get count() {
      return visibleRows().length;
    },
    getScrollElement: () => scrollContainerRef,
    estimateSize: () =>
      DENSITY_BASE_PX[gridSettings().density] + TEXT_SIZE_BUMP_PX[gridSettings().textSize],
    overscan: 10,
  });
  createEffect(() => {
    gridSettings(); // re-measure when density / text size changes the row height
    virtualizer.measure();
  });

  // ─── Cell selection geometry ──────────────────────────────────────────────
  // Selectable columns = visible leaf columns minus the checkbox column. Cell coords are
  // (rowIndex into visibleRows, colIndex into this list).
  const selectableColumnIds = createMemo(() =>
    table
      .getVisibleLeafColumns()
      .map((column) => column.id)
      .filter((id) => id !== 'select'),
  );
  const colIndexById = createMemo(() => {
    const map = new Map<string, number>();
    selectableColumnIds().forEach((id, index) => map.set(id, index));
    return map;
  });
  const columnMetaById = createMemo(
    () => new Map(props.columnMetas().map((column) => [column.id, column])),
  );
  // Right-align numeric columns: the explicit set (bespoke columns) OR a number/decimal dataType
  // (server-declared generic columns, e.g. the valuation group) OR a count (`…:count`, e.g. the
  // orders / in-orders link columns — a count reads as a number). Keeps header + body cells aligned.
  const isRightAlignedCol = (columnId: string): boolean => {
    if (RIGHT_ALIGNED.has(columnId)) return true;
    const dt = columnMetaById().get(columnId)?.dataType ?? '';
    return dt.startsWith('number') || dt.startsWith('decimal') || dt.endsWith(':count');
  };

  // ─── Footer totals ────────────────────────────────────────────────────────
  // Columns whose meta declares aggregate "sum" are totalled in a sticky footer row. The sum spans
  // the LOADED rows only (the grid is virtualised + server-paginated), so it's a running subtotal —
  // labelled with the loaded-row count, not a server grand total.
  const hasFooter = createMemo(() =>
    table.getVisibleLeafColumns().some((c) => columnMetaById().get(c.id)?.aggregate === 'sum'),
  );
  // Cell to host the "Σ N" loaded-rows label: the leftmost visible column that's neither the select
  // box nor a summed column (so the label never overwrites a total).
  const footerLabelColId = createMemo(
    () =>
      table
        .getVisibleLeafColumns()
        .find((c) => c.id !== 'select' && columnMetaById().get(c.id)?.aggregate !== 'sum')?.id,
  );
  const columnSum = (columnId: string): number => {
    let sum = 0;
    for (const row of visibleRows()) {
      const v = props.getValue(row.original, columnId);
      const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
      if (Number.isFinite(n)) sum += n;
    }
    return sum;
  };
  const formatFooter = (columnId: string): string => {
    const meta = columnMetaById().get(columnId);
    if (!meta) return '';
    const codec = codecRegistry.resolve(meta.dataType);
    const sum = columnSum(columnId);
    return codec
      ? codec.format(sum, { config: meta.editorConfig, taxonomySpace: taxonomySpace() })
      : String(sum);
  };
  const selRowCount = (): number => visibleRows().length;
  const selColCount = (): number => selectableColumnIds().length;

  /** Whether keyboard cell-nav should act: grid focused, not editing, not inside a control. */
  function gridHasFocus(): boolean {
    if (!scrollContainerRef) return false;
    const root = scrollContainerRef.getRootNode() as Document | ShadowRoot;
    const active = root.activeElement;
    return (
      active === scrollContainerRef || (active !== null && scrollContainerRef.contains(active))
    );
  }

  function focusGrid(): void {
    scrollContainerRef?.focus({ preventScroll: true });
  }

  /**
   * Minimal scroll-to-visible for the active cell (spreadsheet semantics): scroll only enough to
   * bring it back into view when it's outside the viewport on either axis — never recenter.
   * Driven by keyboard navigation (a clicked cell is already visible, so clicks never scroll).
   */
  function scrollActiveCellIntoView(): void {
    const active = props.cellSelection().active;
    const el = scrollContainerRef;
    if (active === null || !el) return;

    const cellEl = el.querySelector(
      `[data-cell-row="${active.row}"][data-cell-col="${active.col}"]`,
    ) as HTMLElement | null;
    if (cellEl === null) {
      // Row far off / not yet rendered — let the virtualizer bring it near, then it's on-screen.
      virtualizer.scrollToIndex(active.row, { align: 'center' });
      return;
    }

    // Live geometry (not the virtualizer's scroll-derived cache, which lags within a key burst).
    const headerH = el.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    const cell = cellEl.getBoundingClientRect();
    const view = el.getBoundingClientRect();
    if (cell.top < view.top + headerH) {
      el.scrollTop -= view.top + headerH - cell.top; // hidden above / under the sticky header
    } else if (cell.bottom > view.bottom) {
      el.scrollTop += cell.bottom - view.bottom; // below the viewport
    }
    if (cell.left < view.left) {
      el.scrollLeft -= view.left - cell.left; // off the left edge
    } else if (cell.right > view.right) {
      el.scrollLeft += cell.right - view.right; // off the right edge
    }
  }

  function handleCellMouseDown(event: MouseEvent, rowIndex: number, colIndex: number): void {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, button, a')) return; // let controls handle it

    const coord = { row: rowIndex, col: colIndex };
    if (event.shiftKey) {
      props.setCellSelection((s) => extendTo(s, coord));
    } else if (event.ctrlKey || event.metaKey) {
      // Ctrl/Cmd+click toggles the cell: add it if new, remove it if already selected.
      props.setCellSelection((s) => toggleCell(s, coord));
    } else {
      props.setCellSelection(selectCell(coord));
      setDraggingSelection(true);
    }
    focusGrid();
  }

  function handleCellMouseEnter(rowIndex: number, colIndex: number): void {
    if (!draggingSelection()) return;
    props.setCellSelection((s) => extendTo(s, { row: rowIndex, col: colIndex }));
  }

  // ─── Drag-select edge auto-scroll ─────────────────────────────────────────
  // While marquee-selecting, scroll the grid when the pointer nears an edge and extend the
  // selection to whatever cell ends up under it — so a drag can reach off-screen rows/columns.
  let dragPointer: { x: number; y: number } | null = null;
  let dragScrollFrame: number | null = null;

  function extendSelectionToPoint(x: number, y: number): void {
    const root = scrollContainerRef?.getRootNode() as (Document | ShadowRoot) | undefined;
    const hit = root?.elementFromPoint(x, y) as HTMLElement | null;
    const cell = hit?.closest('[data-cell-row][data-cell-col]') as HTMLElement | null;
    if (cell === null || cell === undefined) return;
    const row = Number(cell.dataset.cellRow);
    const col = Number(cell.dataset.cellCol);
    if (Number.isInteger(row) && Number.isInteger(col)) {
      props.setCellSelection((s) => extendTo(s, { row, col }));
    }
  }

  function dragAutoScrollTick(): void {
    dragScrollFrame = null;
    const el = scrollContainerRef;
    if (!draggingSelection() || dragPointer === null || !el) return;

    const view = el.getBoundingClientRect();
    const EDGE = 44;
    const STEP = 18;
    let dx = 0;
    let dy = 0;
    if (dragPointer.x < view.left + EDGE) dx = -STEP;
    else if (dragPointer.x > view.right - EDGE) dx = STEP;
    if (dragPointer.y < view.top + EDGE) dy = -STEP;
    else if (dragPointer.y > view.bottom - EDGE) dy = STEP;

    if (dx !== 0 || dy !== 0) {
      el.scrollLeft += dx;
      el.scrollTop += dy;
      extendSelectionToPoint(dragPointer.x, dragPointer.y); // grab the cell now under the pointer
      dragScrollFrame = requestAnimationFrame(dragAutoScrollTick);
    }
  }

  // Copy the selection to the clipboard as TSV (Excel/Sheets/etc. interop, §11.5). Each cell
  // is formatted via its datatype codec; non-copyable columns emit an empty cell.
  // Format one selected cell as its copy string (datatype codec; empty for non-copyable columns).
  // Shared by every copy variant (plain / with-headers / JSON) so they render values identically.
  // Copy mirrors the screen: a staged edit copies as the staged value — see `cellCopyValue`.
  function cellText(rowIndex: number, colIndex: number): string {
    const columnId = selectableColumnIds()[colIndex];
    const row = visibleRows()[rowIndex]?.original;
    if (columnId === undefined || row === undefined) return '';
    const meta = columnMetaById().get(columnId);
    if (meta?.copyable === false) return '';
    const value = cellCopyValue(props.getStagedValue(row, columnId), props.getValue(row, columnId));
    const codec = meta ? codecRegistry.resolve(meta.dataType) : null;
    if (codec && meta)
      return codec.format(value, { config: meta.editorConfig, taxonomySpace: taxonomySpace() });
    return value === null || value === undefined ? '' : String(value);
  }

  /** Column labels (display headers) for the selection's column span, left→right. */
  function selectedColumnLabels(): string[] {
    const bounds = selectionBounds(props.cellSelection());
    if (bounds === null) return [];
    const colIds = selectableColumnIds();
    const metaById = columnMetaById();
    const labels: string[] = [];
    for (let c = bounds.c1; c <= bounds.c2; c++) {
      const id = colIds[c];
      labels.push(id === undefined ? '' : (metaById.get(id)?.label ?? id));
    }
    return labels;
  }

  function requireRectangularForClipboard(): boolean {
    // A gap-free rectangle is the only shape copy/paste can act on coherently. The check is geometric,
    // so a Ctrl-click multi-range selection that still fills a rectangle is allowed — only a genuinely
    // holed / disjoint selection is blocked. Read-only columns inside the rectangle don't affect this:
    // copy reads their displayed text and paste skips them; the rule is purely about shape.
    if (selectionIsRectangular(props.cellSelection())) return true;
    props.onPasteError?.(
      __(
        'Copy and paste need a single rectangular selection — drag or Shift-click instead of Ctrl-click.',
      ),
    );
    return false;
  }

  /**
   * Localized "Copied/Pasted N cell(s)" success line. When the acted-on cells form a clean rectangle
   * larger than one cell, the shape is appended — "Copied 12 (3 × 4) cells" (rows × cols). A lone cell,
   * or a set that doesn't tile a full rectangle (paste skipping read-only columns), shows the plain count.
   */
  function clipboardSuccessMessage(
    verb: 'copied' | 'pasted',
    count: number,
    shape?: { rows: number; cols: number },
  ): string {
    const withShape = shape !== undefined && count > 1 && shape.rows * shape.cols === count;
    if (verb === 'copied') {
      return withShape
        ? sprintf(
            _n('Copied %1$d (%2$d × %3$d) cell', 'Copied %1$d (%2$d × %3$d) cells', count),
            count,
            shape.rows,
            shape.cols,
          )
        : sprintf(_n('Copied %d cell', 'Copied %d cells', count), count);
    }
    return withShape
      ? sprintf(
          _n('Pasted %1$d (%2$d × %3$d) cell', 'Pasted %1$d (%2$d × %3$d) cells', count),
          count,
          shape.rows,
          shape.cols,
        )
      : sprintf(_n('Pasted %d cell', 'Pasted %d cells', count), count);
  }

  /** Rows × cols of the current selection's bounding box (rectangular by the copy guard), or null. */
  function selectionShape(): { rows: number; cols: number; count: number } | null {
    const b = selectionBounds(props.cellSelection());
    if (b === null) return null;
    const rows = b.r2 - b.r1 + 1;
    const cols = b.c2 - b.c1 + 1;
    return { rows, cols, count: rows * cols };
  }

  /**
   * Whether there is a selection to copy at all.
   *
   * Deliberately asks the *selection*, never the produced text. An empty cell is content — it
   * copies to the empty string, which a "did this produce anything" guard reads as nothing and
   * skips, writing no clipboard and reporting no toast. Worse through `cutCell`, which copies and
   * then clears: the clear ran, the copy did not, and the clipboard kept its previous contents
   * while the operator believed they had cut.
   */
  function hasClipboardSelection(): boolean {
    return props.cellSelection().active !== null && selectionBounds(props.cellSelection()) !== null;
  }

  // Resolves to whether the selection actually reached the clipboard — `cutCell` gates its clear on it.
  async function handleCopy(): Promise<boolean> {
    if (!hasClipboardSelection()) return false;
    if (!requireRectangularForClipboard()) return false;
    const { tsv } = buildClipboard(props.cellSelection(), cellText);
    if (!(await writeClipboardText(tsv))) return false;
    const s = selectionShape();
    props.onClipboardSuccess?.(clipboardSuccessMessage('copied', s?.count ?? 0, s ?? undefined));
    return true;
  }

  // Copy with a TAB-separated header row (the copied columns' labels) prepended before the data rows.
  async function handleCopyWithHeaders(): Promise<void> {
    if (!hasClipboardSelection()) return;
    if (!requireRectangularForClipboard()) return;
    const { tsv } = buildClipboard(props.cellSelection(), cellText);
    await writeClipboardText(selectedColumnLabels().join('\t') + '\n' + tsv);
    const s = selectionShape();
    props.onClipboardSuccess?.(clipboardSuccessMessage('copied', s?.count ?? 0, s ?? undefined));
  }

  // Copy the selection as a JSON array of row objects keyed by column label (as-displayed values).
  async function handleCopyAsJson(): Promise<void> {
    if (props.cellSelection().active === null) return;
    if (!requireRectangularForClipboard()) return;
    const bounds = selectionBounds(props.cellSelection());
    if (bounds === null) return;
    const labels = selectedColumnLabels();
    const rows: Array<Record<string, string>> = [];
    for (let r = bounds.r1; r <= bounds.r2; r++) {
      const obj: Record<string, string> = {};
      for (let c = bounds.c1; c <= bounds.c2; c++) {
        obj[labels[c - bounds.c1] ?? ''] = cellText(r, c);
      }
      rows.push(obj);
    }
    await writeClipboardText(JSON.stringify(rows, null, 2));
    const s = selectionShape();
    props.onClipboardSuccess?.(clipboardSuccessMessage('copied', s?.count ?? 0, s ?? undefined));
  }

  // Copy the selection as JSON Lines (one compact object per row, newline-separated).
  async function handleCopyAsJsonl(): Promise<void> {
    if (props.cellSelection().active === null) return;
    if (!requireRectangularForClipboard()) return;
    const bounds = selectionBounds(props.cellSelection());
    if (bounds === null) return;
    const labels = selectedColumnLabels();
    const lines: string[] = [];
    for (let r = bounds.r1; r <= bounds.r2; r++) {
      const obj: Record<string, string> = {};
      for (let c = bounds.c1; c <= bounds.c2; c++) {
        obj[labels[c - bounds.c1] ?? ''] = cellText(r, c);
      }
      lines.push(JSON.stringify(obj));
    }
    await writeClipboardText(lines.join('\n'));
    const s = selectionShape();
    props.onClipboardSuccess?.(clipboardSuccessMessage('copied', s?.count ?? 0, s ?? undefined));
  }

  /** Row indices that actually own a selected cell — the union of each range's row span, NOT the
   *  bounding box. A disjoint selection (two separate rectangles) must not sweep in the untouched
   *  rows that merely sit between them, so we walk the ranges rather than `selectionBounds`. */
  function selectedRowIndices(): number[] {
    const state = props.cellSelection();
    const set = new Set<number>();
    for (const rect of state.ranges) {
      const lo = Math.min(rect.r1, rect.r2);
      const hi = Math.max(rect.r1, rect.r2);
      for (let r = lo; r <= hi; r++) set.add(r);
    }
    return [...set].sort((a, b) => a - b);
  }

  // Toggle the bulk-action (checkbox) selection for every selectable row that has a selected cell.
  // If they're all already selected → deselect them; otherwise select them all.
  function toggleRowSelectionForSelection(): void {
    const rows = visibleRows();
    const covered = [];
    for (const r of selectedRowIndices()) {
      const row = rows[r];
      if (row?.getCanSelect()) covered.push(row);
    }
    if (covered.length === 0) return;
    const allSelected = covered.every((r) => r.getIsSelected());
    for (const row of covered) row.toggleSelected(!allSelected);
  }

  /** Number of selectable rows that own a selected cell, and whether they're all selected —
   *  drives the "Select N rows" / "Deselect N rows" context-menu label. */
  function selectionRowToggleState(): { count: number; allSelected: boolean } {
    const rows = visibleRows();
    let count = 0;
    let allSelected = true;
    for (const r of selectedRowIndices()) {
      const row = rows[r];
      if (row?.getCanSelect()) {
        count++;
        if (!row.getIsSelected()) allSelected = false;
      }
    }
    return { count, allSelected: count > 0 && allSelected };
  }

  // Write text to the clipboard, falling back to the legacy execCommand path when the async Clipboard
  // API is unavailable — `navigator.clipboard` only exists in a secure context (https / localhost), so
  // on a plain-http dev host (e.g. http://*.test) it is undefined and copy would silently no-op.
  // Returns whether the text reached the clipboard. `cutCell` needs that answer: it clears the cell
  // after copying, so a write that failed and said nothing would destroy the value while leaving the
  // clipboard on its previous contents — a cut whose data went nowhere.
  async function writeClipboardText(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText !== undefined) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* fall through to the execCommand path below */
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      focusGrid(); // execCommand stole focus to the textarea — hand it back so cell-nav resumes
      return ok;
    } catch {
      return false;
    }
  }

  // Place already-obtained clipboard TSV into the selection (§11.5): parse → place from the active
  // cell (or fill on a 1×1 clipboard) → type-strict validate every editable+pasteable target (any
  // failure aborts the whole paste, v1) → stage into the dirty model. Commit happens on save. Shared
  // by the native `paste` event (keyboard Ctrl+V — robust across browsers) and the context-menu item.
  function pasteText(text: string): void {
    if (props.canPaste && !props.canPaste()) return;
    const active = props.cellSelection().active;
    if (active === null) return;
    if (text === '') {
      // Says so rather than returning quietly. The OS clipboard is a plain string, so "one empty
      // cell was copied" and "nothing has ever been copied" arrive here identically — and guessing
      // the first would clear a cell nobody asked to clear. Del is the affordance for that intent.
      props.onPasteError?.(__('Nothing to paste — the clipboard is empty.'));
      return;
    }
    if (!requireRectangularForClipboard()) return;

    const { rows: grid } = parseSpreadsheetTsv(text);
    if (grid.length === 0) return;

    const bounds = selectionBounds(props.cellSelection());
    // Paste anchors at the selection's TOP-LEFT (not the active cell, which may be any corner of the
    // range), matching a spreadsheet.
    const anchor = bounds !== null ? { row: bounds.r1, col: bounds.c1 } : active;

    // Clipboard bigger than a multi-cell selection → confirm before overflowing it (LibreOffice Calc
    // behaviour + wording). A 1×1 clipboard fills the range and is never "bigger"; a single-cell
    // selection is the normal "paste a block here" case and isn't gated.
    if (bounds !== null) {
      const selRows = bounds.r2 - bounds.r1 + 1;
      const selCols = bounds.c2 - bounds.c1 + 1;
      const clipRows = grid.length;
      const clipCols = grid.reduce((max, line) => Math.max(max, line.length), 0);
      const isRange = selRows > 1 || selCols > 1;
      const isSingleValue = clipRows === 1 && clipCols === 1;
      if (isRange && !isSingleValue && (clipRows > selRows || clipCols > selCols)) {
        const ok =
          typeof window !== 'undefined' && typeof window.confirm === 'function'
            ? window.confirm(
                __(
                  'The content of the clipboard is bigger than the range selected.\nDo you want to insert it anyway?',
                ),
              )
            : true;
        if (!ok) return;
      }
    }

    const colIds = selectableColumnIds();
    const rows = visibleRows();
    const metaById = columnMetaById();
    const space = taxonomySpace();
    const targets = pasteTargets(grid, anchor, bounds, selRowCount(), selColCount());

    type Staged = {
      columnId: string;
      original: unknown;
      value: unknown;
      row: TRow;
      r: number;
      c: number;
    };
    const staged: Staged[] = [];
    for (const target of targets) {
      const columnId = colIds[target.col];
      const row = rows[target.row]?.original;
      if (columnId === undefined || row === undefined) continue;
      const meta = metaById.get(columnId);
      if (!meta || meta.kind === 'read_only' || meta.pasteable === false) continue; // skip non-editable

      const codec = codecRegistry.resolve(meta.dataType);
      const outcome = resolvePastedCell(
        target.text,
        clearedValueForRow(meta, row),
        codec ? (t) => codec.parse(t, { config: meta.editorConfig, taxonomySpace: space }) : null,
      );
      if (outcome.kind === 'skip') continue;
      if (outcome.kind === 'reject') {
        // Naming which column and why: "invalid value" over a blank cell sent the last reader
        // looking for a malformed number that was never there.
        props.onPasteError?.(
          outcome.reason === 'not-clearable'
            ? sprintf(__('Cannot empty %s — this column has no blank value.'), meta.label)
            : sprintf(
                __('Cannot paste "%1$s" into %2$s — invalid value.'),
                target.text,
                meta.label,
              ),
        );
        return; // abort: no cell is mutated
      }
      staged.push({
        columnId,
        original: props.getValue(row, columnId),
        value: outcome.value,
        row,
        r: target.row,
        c: target.col,
      });
    }
    if (staged.length === 0) return;

    for (const entry of staged) {
      props.onStageEdit(entry.row, entry.columnId, entry.original, entry.value);
    }
    props.onPasteError?.('');
    // Shape the toast when the written cells tile a full rectangle (they won't if read-only columns
    // were skipped in the middle — then it's a plain count).
    const rowSpan = new Set(staged.map((s) => s.r)).size;
    const colSpan = new Set(staged.map((s) => s.c)).size;
    props.onClipboardSuccess?.(
      clipboardSuccessMessage('pasted', staged.length, { rows: rowSpan, cols: colSpan }),
    );
  }

  // Context-menu Paste: there's no ClipboardEvent to read, so fall back to the async Clipboard API's
  // readText(). That is unsupported in Firefox web content and permission-gated in Chrome — the common
  // keyboard Ctrl/Cmd+V path goes through the native `paste` event instead (listener in onMount below),
  // which needs no permission and works cross-browser.
  async function handlePasteFromClipboard(): Promise<void> {
    if (props.canPaste && !props.canPaste()) return;
    if (props.cellSelection().active === null) return;
    let text: string;
    try {
      text = (await navigator.clipboard?.readText()) ?? '';
    } catch {
      props.onPasteError?.(
        __("Paste from the menu isn't available in this browser — use Ctrl/Cmd+V instead."),
      );
      return;
    }
    pasteText(text);
  }

  // Native paste event — the robust keyboard-paste path. Fires on Ctrl/Cmd+V (and the browser's own
  // Paste menu) with clipboardData in hand: no readText() permission, works in every browser. Gated to
  // when the grid is focused and not in a cell editor / input.
  onMount(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if (!gridHasFocus() || editingCell() !== null) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable]')) return;
      if (props.cellSelection().active === null) return;
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (text === '') return;
      event.preventDefault();
      pasteText(text);
    };
    document.addEventListener('paste', onPaste, true);
    onCleanup(() => document.removeEventListener('paste', onPaste, true));
  });

  // ─── Per-cell edit (6b.4) ─────────────────────────────────────────────────
  function editorColumn(
    coord: CellCoord,
  ): { columnId: string; meta: GridColumnMeta; row: TRow } | null {
    const columnId = selectableColumnIds()[coord.col];
    const row = visibleRows()[coord.row]?.original;
    if (columnId === undefined || row === undefined) return null;
    const meta = columnMetaById().get(columnId);
    if (!meta) return null;
    return { columnId, meta, row };
  }

  function canEditCoord(coord: CellCoord): boolean {
    const target = editorColumn(coord);
    if (!target) return false;
    // A submitted-but-unreconciled cell is locked: no edit entry, paste, clear or ± while in-flight
    // (selection/copy/nav still work — the staged value is real data). Kills the second-edit-races-
    // first-apply race so reconcile always lands on a known prior state.
    if (props.getStagedValue(target.row, target.columnId).pending === true) return false;
    if (!props.canEdit(target.row, target.meta)) return false;
    // Multi-value columns (term pickers) edit through the bulk modal (a roomy Combobox form) rather
    // than an in-cell editor — an inline dropdown would be clipped by the cell's overflow.
    if (target.meta.kind === 'editable_multi') return true;
    return editRegistry.has(target.meta.dataType);
  }

  function isEditingCoord(rowIndex: number, colIndex: number): boolean {
    const cell = editingCell();
    return cell !== null && cell.row === rowIndex && cell.col === colIndex;
  }

  function enterEdit(initialText?: string): void {
    const active = props.cellSelection().active;
    if (active === null || !canEditCoord(active)) return;
    // Multi-value columns have no in-cell editor — F2 / double-click / "Edit" open the bulk modal
    // (which handles a single row fine); a typed character is ignored rather than opening it.
    const target = editorColumn(active);
    if (target?.meta.kind === 'editable_multi') {
      if (initialText === undefined) {
        props.onEditMulti?.([{ columnId: target.columnId, meta: target.meta, rows: [target.row] }]);
      }
      return;
    }
    setEditEntryText(initialText);
    setEditingCell(active);
  }

  /** The persisted value as the editor should compare against (inheritance-aware via the host). */
  function persistedEditorValue(row: TRow, columnId: string, meta: GridColumnMeta): unknown {
    return props.resolvePersistedValue
      ? props.resolvePersistedValue(row, meta)
      : props.getValue(row, columnId);
  }

  function commitEdit(value: unknown, move: EditMove): void {
    const cell = editingCell();
    setEditingCell(null);
    setEditEntryText(undefined);
    let committed: { row: TRow; columnId: string } | null = null;
    if (cell !== null) {
      const target = editorColumn(cell);
      if (target) {
        props.onStageEdit(
          target.row,
          target.columnId,
          persistedEditorValue(target.row, target.columnId, target.meta),
          value,
        );
        committed = { row: target.row, columnId: target.columnId };
      }
    }
    // Host may take over focus after a commit (e.g. a scanner loop back to a filter); if so, skip the
    // default move + focus-restore.
    if (committed !== null && props.onCommitNavigate?.(committed.row, committed.columnId, move)) {
      return;
    }
    if (move !== null) {
      let [dRow, dCol] =
        move === 'down' ? [1, 0] : move === 'up' ? [-1, 0] : move === 'right' ? [0, 1] : [0, -1];
      // Record layout transposes the axes: a "down" commit (Enter) advances to the next field (col+1).
      if (layout() === 'record') [dRow, dCol] = [dCol, dRow];
      props.setCellSelection((s) => moveActive(s, dRow, dCol, selRowCount(), selColCount(), false));
    }
    focusGrid();
  }

  function cancelEdit(): void {
    setEditingCell(null);
    setEditEntryText(undefined);
    focusGrid();
  }

  // ─── Per-cell drill-down (6b.7, §11.7) ────────────────────────────────────
  /** Whether the column at `coord` exposes a drill-down. */
  function canDrilldownCoord(coord: CellCoord): boolean {
    return editorColumn(coord)?.meta.hasDrilldown === true;
  }

  /** Open the drill-down detail view for a cell: fetch the endpoint, then render via the registry. */
  async function openDrilldown(coord: CellCoord): Promise<void> {
    const target = editorColumn(coord);
    if (!target || target.meta.hasDrilldown !== true || !props.fetchDrilldown) return;
    const { columnId, meta, row } = target;
    const subjectId = Number(props.getRowId(row));
    setDrilldown({
      columnId,
      meta,
      subjectId,
      title: undefined,
      subtitle: undefined,
      detail: null,
      loading: true,
      error: null,
    });
    try {
      const res = await props.fetchDrilldown(columnId, row);
      setDrilldown((d) =>
        d
          ? { ...d, title: res.title, subtitle: res.subtitle, detail: res.detail, loading: false }
          : d,
      );
    } catch (error) {
      setDrilldown((d) =>
        d
          ? { ...d, loading: false, error: error instanceof Error ? error.message : String(error) }
          : d,
      );
    }
  }

  /** Persist an edit from the open drill-down and refresh its detail in place (writable drill-downs). */
  async function saveDrilldownDetail(payload: unknown): Promise<void> {
    const dd = drilldown();
    if (!dd || !props.saveDrilldown) return;
    const res = await props.saveDrilldown(dd.columnId, dd.subjectId, payload);
    setDrilldown((d) => (d ? { ...d, detail: res.detail } : d));
  }

  // ─── Clear / cut ──────────────────────────────────────────────────────────
  function clearedValueForRow(meta: GridColumnMeta, row: TRow): { ok: boolean; value: unknown } {
    return props.resolveClearedValue
      ? props.resolveClearedValue(row, meta)
      : { ok: false, value: null };
  }

  function isClearable(meta: GridColumnMeta | undefined, row: TRow | undefined): boolean {
    return meta !== undefined && row !== undefined && clearedValueForRow(meta, row).ok;
  }

  /** Stage a column's cleared value into a cell (Clear / the clear half of Cut). */
  function clearCell(coord: CellCoord): void {
    const target = editorColumn(coord);
    if (!target || !canEditCoord(coord)) return;
    props.onClearCells([{ row: target.row, columnId: target.columnId }]);
  }

  /** Clear every editable, clearable cell in the selection (the Del key). */
  function clearSelection(): void {
    const sel = props.cellSelection();
    const colIds = selectableColumnIds();
    const rows = visibleRows();
    const metaById = columnMetaById();
    const seen = new Set<string>();
    const cells: Array<{ row: TRow; columnId: string }> = [];
    for (const rect of sel.ranges) {
      for (let r = rect.r1; r <= rect.r2; r++) {
        const product = rows[r]?.original;
        if (product === undefined) continue;
        for (let c = rect.c1; c <= rect.c2; c++) {
          const columnId = colIds[c];
          const meta = columnId === undefined ? undefined : metaById.get(columnId);
          if (columnId === undefined || meta === undefined) continue;
          const key = `${props.getRowId(product)}|${columnId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (!canEditCoord({ row: r, col: c })) continue;
          if (!clearedValueForRow(meta, product).ok) continue;
          cells.push({ row: product, columnId });
        }
      }
    }
    if (cells.length > 0) props.onClearCells(cells);
  }

  // Clear only once the value is safely on the clipboard. Cut is the one clipboard action that
  // destroys something, so it must not proceed on a copy that failed — that turns a move into a
  // deletion, with the clipboard still holding whatever was cut before it.
  async function cutCell(coord: CellCoord): Promise<void> {
    if (!(await handleCopy())) return;
    clearCell(coord);
  }

  /**
   * Increment/decrement a selected number cell's staged value directly (no editor). Returns false
   * when the active cell isn't an editable number cell (so the key can fall through to typed-char
   * edit-entry). Drives +/- over a selected stock cell (§2 keys). Clamps to the SAME per-row bounds
   * the editor enforces — `resolveEditorMeta` injects `editorConfig.min` / `.max` (e.g. a receipt
   * Damaged cell capped at this session's Received), so +/- can never stage a value typing couldn't.
   * Defaults to `min` 0 / no upper bound when the column declares neither.
   */
  function adjustActiveNumberCell(step: 1 | -1): boolean {
    const active = props.cellSelection().active;
    if (active === null || !canEditCoord(active)) return false;
    const target = editorColumn(active);
    if (!target || !target.meta.dataType.startsWith('number')) return false;

    const persisted = props.getValue(target.row, target.columnId);
    const staged = props.getStagedValue(target.row, target.columnId);
    const stagedNum = staged.staged ? staged.value : undefined;
    const currentNum =
      typeof stagedNum === 'number' ? stagedNum : typeof persisted === 'number' ? persisted : 0;
    const cfg = (
      props.resolveEditorMeta ? props.resolveEditorMeta(target.meta, target.row) : target.meta
    ).editorConfig;
    const min = typeof cfg.min === 'number' ? cfg.min : 0;
    const max = typeof cfg.max === 'number' ? cfg.max : Infinity;
    props.onStageEdit(
      target.row,
      target.columnId,
      persisted,
      Math.min(max, Math.max(min, currentNum + step)),
    );
    return true;
  }

  // ─── Bulk edit entry (multi-cell selection → host modal) ───────────────────
  /** Per-column row groups spanned by the selection, in visible-column order. Mirrors the host's
   *  former `bulkEditColumnsFromSelection` geometry (rect-precise: a column's rows are only those
   *  whose cell is actually within a selected rect for that column). The host filters to its
   *  bulk-eligible columns + maps each to a typed bulk-edit column. */
  function bulkGroupsFromSelection(): Array<{
    columnId: string;
    meta: GridColumnMeta;
    rows: TRow[];
  }> {
    const sel = props.cellSelection();
    const colIds = selectableColumnIds();
    const rows = visibleRows();
    const metaById = columnMetaById();
    const byColumn = new Map<string, Map<string, TRow>>();
    for (const rect of sel.ranges) {
      for (let c = rect.c1; c <= rect.c2; c++) {
        const columnId = colIds[c];
        if (columnId === undefined || !metaById.has(columnId)) continue;
        for (let r = rect.r1; r <= rect.r2; r++) {
          const product = rows[r]?.original;
          if (product === undefined) continue;
          let perColumn = byColumn.get(columnId);
          if (!perColumn) {
            perColumn = new Map();
            byColumn.set(columnId, perColumn);
          }
          perColumn.set(props.getRowId(product), product);
        }
      }
    }
    const out: Array<{ columnId: string; meta: GridColumnMeta; rows: TRow[] }> = [];
    for (const columnId of colIds) {
      const perColumn = byColumn.get(columnId);
      const meta = metaById.get(columnId);
      if (!perColumn || !meta) continue;
      out.push({ columnId, meta, rows: [...perColumn.values()] });
    }
    return out;
  }

  /** Open the host's bulk editor with the selection; fall back to inline edit when the host opens
   *  nothing (no eligible columns). */
  function openBulkEdit(): void {
    if (props.onEditMulti && props.onEditMulti(bulkGroupsFromSelection())) return;
    enterEdit();
  }

  /** Distinct (row, columnId) cells covered by the current selection (host dirty-model ops). */
  function selectedCellRefs(): Array<{ row: TRow; columnId: string }> {
    const sel = props.cellSelection();
    const colIds = selectableColumnIds();
    const rows = visibleRows();
    const out: Array<{ row: TRow; columnId: string }> = [];
    const seen = new Set<string>();
    for (const rect of sel.ranges) {
      for (let r = rect.r1; r <= rect.r2; r++) {
        const product = rows[r]?.original;
        if (product === undefined) continue;
        for (let c = rect.c1; c <= rect.c2; c++) {
          const columnId = colIds[c];
          if (columnId === undefined) continue;
          const key = `${props.getRowId(product)}|${columnId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ row: product, columnId });
        }
      }
    }
    return out;
  }
  // Hand the grid's imperative handles to the host in one go (replaces the per-handle register*).
  function focusCellById(rowId: string, columnId: string, editMode = false): void {
    const rowIdx = visibleRows().findIndex((r) => props.getRowId(r.original) === rowId);
    const colIdx = colIndexById().get(columnId);
    if (rowIdx < 0 || colIdx === undefined) return;
    props.setCellSelection(selectCell({ row: rowIdx, col: colIdx }));
    focusGrid();
    scrollActiveCellIntoView();
    if (editMode) enterEdit();
  }

  props.apiRef?.({
    focusGrid,
    enterEdit: (seed) => enterEdit(seed),
    focusCellById,
    openColumnManager: () => {
      setColManagerQuery('');
      setShowColManager((v) => !v);
    },
    openGridSettings: () => (surface ? surface.openSettings() : setShowGridSettings((v) => !v)),
    scrollToTop: () => {
      if (scrollContainerRef) scrollContainerRef.scrollTop = 0;
    },
    getSelectedCells: selectedCellRefs,
    getSelectableColumnIds: () => selectableColumnIds(),
  });

  // ─── Right-click context menu (6b.5) ──────────────────────────────────────
  /** Build the per-cell menu, items gated by column kind + registrations (§11.9 table). */
  function contextMenuItems(coord: CellCoord): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];
    const target = editorColumn(coord);
    const meta = target?.meta;
    const editable = canEditCoord(coord);
    const pasteable = editable && meta?.pasteable !== false;
    const clearable = editable && isClearable(meta, target?.row);

    if (isMultiCell(props.cellSelection())) {
      // Multi-cell selection → bulk-edit the eligible columns it spans (keeps the range intact).
      items.push({
        key: 'bulk-edit',
        label: __('Edit selection…'),
        shortcut: 'F2',
        run: () => openBulkEdit(),
      });
    } else if (editable) {
      items.push({
        key: 'edit',
        label: __('Edit'),
        shortcut: 'F2',
        run: () => {
          props.setCellSelection(selectCell(coord));
          enterEdit();
        },
      });
      // Force the bulk-edit modal on a single cell (its numeric ops — e.g. ±% on a price — aren't
      // reachable inline). Only when the column is bulk-eligible (no per-edit reason gate), so this
      // never falls back to the inline editor and read as a no-op.
      if (meta?.bulkSaveReason == null) {
        items.push({
          key: 'bulk-edit',
          label: __('Bulk edit…'),
          shortcut: 'Shift+F2',
          run: () => {
            props.setCellSelection(selectCell(coord));
            openBulkEdit();
          },
        });
      }
    }
    if (canDrilldownCoord(coord)) {
      items.push({
        key: 'drilldown',
        label: __('Drill down'),
        shortcut: 'Alt+Enter',
        run: () => void openDrilldown(coord),
      });
    }
    if (meta?.copyable !== false) {
      // "Copy" both acts (click / Ctrl+C = plain copy) AND opens a submenu of variants on hover, so
      // the path reads "Copy ▸ With headers / as JSON / as JSON Lines". The JSON variants are Pro-gated.
      const jsonAllowed = props.copyAsJsonAllowed?.() ?? true;
      const jsonTitle = jsonAllowed ? undefined : props.copyAsJsonUpgradeHint;
      items.push({
        key: 'copy',
        label: __('Copy'),
        shortcut: 'Ctrl+C',
        run: () => void handleCopy(),
        children: [
          {
            key: 'copy-headers',
            label: __('With headers'),
            run: () => void handleCopyWithHeaders(),
          },
          {
            key: 'copy-json',
            label: __('as JSON'),
            disabled: !jsonAllowed,
            title: jsonTitle,
            run: () => void handleCopyAsJson(),
          },
          {
            key: 'copy-jsonl',
            label: __('as JSON Lines'),
            disabled: !jsonAllowed,
            title: jsonTitle,
            run: () => void handleCopyAsJsonl(),
          },
        ],
      });
    }
    if (pasteable && clearable) {
      items.push({
        key: 'cut',
        label: __('Cut'),
        shortcut: 'Ctrl+X',
        run: () => void cutCell(coord),
      });
    }
    if (pasteable) {
      items.push({
        key: 'paste',
        label: __('Paste'),
        shortcut: 'Ctrl+V',
        run: () => void handlePasteFromClipboard(),
      });
    }
    if (clearable) {
      items.push({
        key: 'clear',
        label: __('Clear'),
        shortcut: 'Del',
        run: () => clearCell(coord),
      });
    }
    // Toggle the bulk-action checkbox selection for the row(s) the selection covers (when selectable).
    const rowToggle = selectionRowToggleState();
    if (rowToggle.count > 0) {
      items.push({
        key: 'toggle-select',
        label: sprintf(
          rowToggle.allSelected
            ? _n('Deselect %d row', 'Deselect %d rows', rowToggle.count)
            : _n('Select %d row', 'Select %d rows', rowToggle.count),
          rowToggle.count,
        ),
        run: () => toggleRowSelectionForSelection(),
      });
    }
    // Host-contributed extras (Save / Revert / domain actions / a Bulk-actions submenu). Mapped
    // recursively so an extra can be a submenu parent (children) with disabled + tooltip.
    if (target) {
      for (const extra of props.contextMenuExtras?.({
        coord,
        row: target.row,
        meta: target.meta,
      }) ?? []) {
        items.push(toContextMenuItem(extra));
      }
    }
    return items;
  }

  function handleCellContextMenu(event: MouseEvent, rowIndex: number, colIndex: number): void {
    event.preventDefault();
    const coord = { row: rowIndex, col: colIndex };
    // Right-clicking outside the current selection selects just that cell (Excel behaviour);
    // right-clicking inside it keeps the range but moves the active cell to the target.
    if (cellIsSelected(props.cellSelection(), rowIndex, colIndex)) {
      props.setCellSelection((s) => ({
        active: coord,
        anchor: s.anchor ?? coord,
        ranges: s.ranges,
      }));
    } else {
      props.setCellSelection(selectCell(coord));
    }
    focusGrid();
    // Clamp so the menu stays on-screen (rough size estimate; flips near the right/bottom edge).
    const MENU_W = 200;
    const MENU_H = 8 + contextMenuItems(coord).length * 32;
    const x = Math.min(event.clientX, window.innerWidth - MENU_W - 4);
    const y = Math.min(event.clientY, window.innerHeight - MENU_H - 4);
    setContextMenu({ x: Math.max(4, x), y: Math.max(4, y), coord });
  }

  /** Build the column-header menu: select-whole-column, sort controls (when sortable) + Hide. */
  function headerMenuItems(columnId: string): ContextMenuItem[] {
    const column = table.getColumn(columnId);
    if (!column) return [];
    const items: ContextMenuItem[] = [];
    // Select every cell in this column — feeds the multi-cell bulk-edit (F2 / right-click) so a whole
    // column can be edited in one pass. Row span is the loaded set (server-paginated), same as Ctrl+A.
    const colIndex = colIndexById().get(columnId);
    if (colIndex !== undefined && selRowCount() > 0) {
      items.push({
        key: 'select-column',
        label: __('Select all cells in column'),
        run: () => props.setCellSelection(selectColumn(colIndex, selRowCount())),
      });
    }
    if (column.getCanSort()) {
      const sorted = column.getIsSorted();
      items.push({
        key: 'sort-asc',
        label: __('Sort ascending'),
        shortcut: sorted === 'asc' ? '✓' : undefined,
        run: () => column.toggleSorting(false),
      });
      items.push({
        key: 'sort-desc',
        label: __('Sort descending'),
        shortcut: sorted === 'desc' ? '✓' : undefined,
        run: () => column.toggleSorting(true),
      });
      if (sorted !== false) {
        items.push({
          key: 'sort-clear',
          label: __('Clear sort'),
          run: () => column.clearSorting(),
        });
      }
    }
    // Per-column text wrapping, as a three-way choice rather than a toggle plus a conditional reset.
    //
    // The toggle could not show its own state honestly: a checkmark on "wrap" meant either this
    // column's own override or the grid default showing through, and those differ on the next reset
    // — so the item was phrased as an action and the state was left unsaid. Three explicit options
    // have somewhere to put the mark, and it now reflects what is STORED: an override either way,
    // or none at all. It also stops the reset appearing and disappearing from the menu, which moved
    // every item below it depending on a state the operator could not see.
    const pinned = gridSettings().columnWrap[columnId];
    items.push({
      key: 'wrap-column',
      label: __('Wrap column contents'),
      children: [
        {
          key: 'wrap-yes',
          label: __('Yes'),
          shortcut: 'wrap' === pinned ? '✓' : undefined,
          run: () => setColumnWrap(columnId, 'wrap'),
        },
        {
          key: 'wrap-no',
          label: __('No'),
          shortcut: 'no-wrap' === pinned ? '✓' : undefined,
          run: () => setColumnWrap(columnId, 'no-wrap'),
        },
        {
          key: 'wrap-inherit',
          label: __('Follow grid'),
          shortcut: undefined === pinned ? '✓' : undefined,
          run: () => setColumnWrap(columnId, null),
        },
      ],
    });
    // Host contributions for THIS column, above the generic tail: Hide and Columns… are the menu's
    // escape hatches and belong last, where the operator learns to find them regardless of which
    // column was right-clicked. An item that only exists on one column is content, not footer.
    for (const extra of props.headerMenuExtras?.({
      columnId,
      meta: columnMetaById().get(columnId),
    }) ?? []) {
      items.push(toContextMenuItem(extra));
    }
    if (column.getCanHide()) {
      items.push({
        key: 'hide',
        label: __('Hide column'),
        run: () => column.toggleVisibility(false),
      });
    }
    // Always offer the full column picker (same as Ctrl+M / the toolbar Columns button).
    // Opened from a column, so it opens filtered to that column — by its shipped name, which the
    // filter matches whether or not the merchant has renamed it.
    items.push({
      key: 'columns',
      label: __('Columns…'),
      run: () => openColumnManager(shippedNameOf(columnId)),
    });
    return items;
  }

  function handleHeaderContextMenu(event: MouseEvent, columnId: string): void {
    event.preventDefault();
    const items = headerMenuItems(columnId);
    if (items.length === 0) return; // nothing actionable (e.g. the select column) → native menu
    const MENU_W = 200;
    const MENU_H = 8 + items.length * 32;
    const x = Math.min(event.clientX, window.innerWidth - MENU_W - 4);
    const y = Math.min(event.clientY, window.innerHeight - MENU_H - 4);
    setContextMenu({ x: Math.max(4, x), y: Math.max(4, y), columnId });
  }

  function closeContextMenu(): void {
    setContextMenu(null);
    setOpenByDepth({});
  }

  // Dismiss the context menu on Escape, scroll, or resize (outside-click is handled by the backdrop).
  createEffect(() => {
    if (contextMenu() === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();
      }
    };
    const onScrollOrResize = (): void => closeContextMenu();
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onScrollOrResize);
    scrollContainerRef?.addEventListener('scroll', onScrollOrResize, { passive: true });
    onCleanup(() => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onScrollOrResize);
      scrollContainerRef?.removeEventListener('scroll', onScrollOrResize);
    });
  });

  const virtualItems = createMemo(() => virtualizer.getVirtualItems());
  /**
   * The visible window, as the **TanStack `Row` objects themselves** — deliberately not wrapped.
   *
   * `<For>` keys on reference identity, and TanStack memoizes its row model on the `data` array, so
   * yielding the rows directly means a scroll tick that shifts the window re-uses every row that is
   * still on screen and builds only the one or two that entered. Wrapping each row in a fresh
   * `{ virtualRow, row }` literal — as this did — gave `<For>` all-new references every tick and
   * tore down and rebuilt every visible row's `<tr>` on every frame. Measured at 37x the work.
   *
   * So: never map this window through an object literal, and don't reach for `<Index>` either —
   * `renderCellTd` snapshots `row.index` non-reactively, which stays correct under reference-keyed
   * `<For>` over stable rows and goes stale under position-keyed `<Index>`. The virtualizer's own
   * items stay available as {@link virtualItems} for the padding rows, which are what actually need
   * `start` / `end`.
   */
  const virtualRows = createMemo(() =>
    virtualItems()
      .map((virtualRow) => visibleRows()[virtualRow.index])
      .filter((row): row is Row<TRow> => row !== undefined),
  );
  const paddingTop = createMemo(() => virtualItems()[0]?.start ?? 0);
  const paddingBottom = createMemo(() => {
    const items = virtualItems();
    return Math.max(0, virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0));
  });

  // Re-measure whenever the row set changes (the host's `rows` accessor drives this memo).
  createEffect(() => {
    props.rows();
    virtualizer.measure();
  });

  // Notify the host when the last visible row is within 20 rows of the end (infinite-scroll seam).
  createEffect(() => {
    const items = virtualItems();
    const totalRows = visibleRows().length;
    if (items.length > 0 && totalRows > 0 && items[items.length - 1].index >= totalRows - 20) {
      props.onScrollNearEnd?.();
    }
  });

  const colSpan = createMemo(() => table.getVisibleLeafColumns().length);

  // End cell-drag selection on any mouseup; stop any in-flight edge auto-scroll.
  createEffect(() => {
    const handler = () => {
      setDraggingSelection(false);
      dragPointer = null;
      if (dragScrollFrame !== null) {
        cancelAnimationFrame(dragScrollFrame);
        dragScrollFrame = null;
      }
    };
    document.addEventListener('mouseup', handler);
    onCleanup(() => document.removeEventListener('mouseup', handler));
  });

  // Track the pointer during a marquee drag and kick the edge auto-scroll loop near the edges.
  createEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!draggingSelection()) return;
      dragPointer = { x: event.clientX, y: event.clientY };
      if (dragScrollFrame === null) dragScrollFrame = requestAnimationFrame(dragAutoScrollTick);
    };
    document.addEventListener('mousemove', handler);
    onCleanup(() => document.removeEventListener('mousemove', handler));
  });

  // Spreadsheet keyboard navigation (read mode). Active only when the grid is focused and the
  // event isn't inside a control; edit-mode keeps its own input navigation (unified in 6b.4).
  createEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // A cell editor handles its own keys with preventDefault() (commit/cancel/navigate). Solid's
      // delegated dispatch across the Shadow-DOM boundary doesn't reliably stop this document-level
      // bubble listener, and the editor clears `editingCell` synchronously on commit — so by the time
      // the event bubbles here the edit-state guard below no longer catches it. Skipping any event the
      // editor already consumed prevents a double-handle (e.g. Enter moving the active cell twice).
      if (event.defaultPrevented) return;
      // "/" (main or numpad, no Shift) focuses the search box (GitHub-style) — host keybinding.
      // Run host key handlers before the focus guard (so global keys like "/" work anywhere).
      const active = props.cellSelection().active;
      for (const kh of props.keyHandlers ?? []) {
        if (kh(event, active)) return;
      }
      // Ctrl/Cmd+M (column manager) and Ctrl/Cmd+, (display settings) are grid built-ins — run after host
      // keys (so a host can still intercept them), so every consumer gets them without wiring; the gear
      // menu offers both too.
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        (event.key === 'm' || event.key === 'M')
      ) {
        event.preventDefault();
        setColManagerQuery('');
        setShowColManager((v) => !v);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        if (surface) surface.openSettings();
        else setShowGridSettings((v) => !v);
        return;
      }
      if (!gridHasFocus()) return;
      // While a cell editor is open it owns the keyboard (typing, cursor keys, native copy/paste).
      // The closest('input') guard below is defeated in the Shadow DOM (events are retargeted to
      // the host before reaching this document-level listener), so gate on the edit state instead.
      if (editingCell() !== null) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable]')) return;

      // Copy whenever the grid (not an input) is focused, read or edit mode. Paste is NOT handled here:
      // Ctrl/Cmd+V fires a native `paste` event (listener in onMount) that reads clipboardData directly
      // — no readText() permission, cross-browser. Handling it here too would paste twice.
      if ((event.ctrlKey || event.metaKey) && (event.key === 'c' || event.key === 'C')) {
        event.preventDefault();
        void handleCopy();
        return;
      }

      // Host keybindings that require the grid to be focused (e.g. Ctrl/Cmd+Enter save, `*` fold).
      for (const kh of props.keyHandlersInGrid ?? []) {
        if (kh(event, props.cellSelection().active)) return;
      }

      const rows = selRowCount();
      const cols = selColCount();
      if (rows === 0 || cols === 0) return;

      // Excel-style structural selection: Ctrl+Space = whole column(s) of the selection, Shift+Space =
      // whole row(s), Ctrl+Shift+Space = the entire grid. Uses the current selection's span (falling
      // back to the active cell). Only with a modifier — a bare Space falls through to edit-entry.
      if (event.key === ' ' || event.code === 'Space') {
        const sel = props.cellSelection();
        if (sel.active === null) return;
        const b = selectionBounds(sel) ?? {
          r1: sel.active.row,
          c1: sel.active.col,
          r2: sel.active.row,
          c2: sel.active.col,
        };
        if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
          event.preventDefault();
          props.setCellSelection(selectAll(rows, cols));
          return;
        }
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          props.setCellSelection(selectColumns(b.c1, b.c2, rows));
          return;
        }
        if (event.shiftKey) {
          event.preventDefault();
          props.setCellSelection(selectRows(b.r1, b.r2, cols));
          return;
        }
      }

      const extend = event.shiftKey;
      // Ctrl/Cmd jumps to the data-block edge (the grid is contiguous, so "edge" = first/last row or
      // column); composable with Shift to extend the selection there. PgUp/PgDn move by a viewport.
      const jump = event.ctrlKey || event.metaKey;
      const active0: CellCoord = props.cellSelection().active ?? { row: 0, col: 0 };
      const go = (coord: CellCoord): void => {
        props.setCellSelection((s) => {
          const c = clampCoord(coord, rows, cols);
          return extend ? extendTo(s, c) : selectCell(c);
        });
      };
      const pageRows = (): number => {
        const h = scrollContainerRef?.clientHeight ?? 0;
        return Math.max(1, Math.floor(h / 49) - 1); // ~row height; keep one row of context
      };

      // Alt+Enter opens the active cell's drill-down (§11.7), where one is registered.
      if (event.altKey && event.key === 'Enter') {
        const a = props.cellSelection().active;
        if (a !== null && canDrilldownCoord(a)) {
          event.preventDefault();
          void openDrilldown(a);
        }
        return;
      }
      // Per-cell edit entry (6b.4): F2 preserves the current value; a typed character seeds
      // the editor with that character. A multi-cell selection opens the bulk-edit modal instead.
      // Shift+F2 forces the bulk modal even on a single cell — its numeric ops (e.g. ±% on a price)
      // have no inline-editor equivalent, so this is the one way to reach them for one cell.
      if (event.key === 'F2') {
        event.preventDefault();
        if (event.shiftKey || isMultiCell(props.cellSelection())) openBulkEdit();
        else enterEdit();
        return;
      }
      // +/- over a selected number (stock) cell adjusts the staged delta directly, without
      // opening the editor.
      if (event.key === '+' || event.key === '=') {
        if (adjustActiveNumberCell(1)) {
          event.preventDefault();
          return;
        }
      }
      if (event.key === '-') {
        if (adjustActiveNumberCell(-1)) {
          event.preventDefault();
          return;
        }
      }
      // Delete clears the selection. Handled before the printable-char branch so the numpad Del key
      // works regardless of Num Lock: it reports key="Delete" (Num Lock off) or key="." with
      // code="NumpadDecimal" (Num Lock on) — the latter would otherwise start a "." edit. A host that
      // wants "." as an editor shortcut intercepts it in keyHandlersInGrid (which runs first) and calls
      // api.enterEdit(".") — the grid stays domain-agnostic.
      if (event.key === 'Delete' || event.code === 'NumpadDecimal') {
        event.preventDefault();
        clearSelection();
        return;
      }
      // Typed printable character → start editing seeded with it. Exclude C0/C1 control chars
      // (e.g. NUL "\x00", which some input setups emit for Shift+wheel) so they never open the
      // editor with empty content.
      if (
        event.key.length === 1 &&
        event.key >= ' ' &&
        event.key !== '\x7f' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        const a = props.cellSelection().active;
        if (a !== null && canEditCoord(a)) {
          event.preventDefault();
          enterEdit(event.key);
        }
        return;
      }

      // In "record" layout the display axes are transposed: ↓ walks fields (data col), → walks records
      // (data row). Remap the arrow keys so the data-coord switch below (incl. its Ctrl-jump `go()`
      // cases) moves along the right axis; Enter/Tab swap their row/col delta inline.
      const key =
        layout() === 'record'
          ? ((
              {
                ArrowUp: 'ArrowLeft',
                ArrowDown: 'ArrowRight',
                ArrowLeft: 'ArrowUp',
                ArrowRight: 'ArrowDown',
              } as Record<string, string>
            )[event.key] ?? event.key)
          : event.key;

      switch (key) {
        case 'Enter': {
          const [dr, dc] =
            layout() === 'record' ? [0, event.shiftKey ? -1 : 1] : [event.shiftKey ? -1 : 1, 0];
          props.setCellSelection((s) => moveActive(s, dr, dc, rows, cols, false));
          break;
        }
        case 'ArrowUp':
          if (jump) go({ row: 0, col: active0.col });
          else props.setCellSelection((s) => moveActive(s, -1, 0, rows, cols, extend));
          break;
        case 'ArrowDown':
          if (jump) go({ row: rows - 1, col: active0.col });
          else props.setCellSelection((s) => moveActive(s, 1, 0, rows, cols, extend));
          break;
        case 'ArrowLeft':
          if (jump) go({ row: active0.row, col: 0 });
          else props.setCellSelection((s) => moveActive(s, 0, -1, rows, cols, extend));
          break;
        case 'Tab': {
          // Spreadsheet UX: Tab → next column, Shift+Tab → previous (mirrors Enter / Shift+Enter). In
          // record layout it walks records (display-right) instead of fields.
          const [dr, dc] =
            layout() === 'record' ? [event.shiftKey ? -1 : 1, 0] : [0, event.shiftKey ? -1 : 1];
          props.setCellSelection((s) => moveActive(s, dr, dc, rows, cols, false));
          break;
        }
        case 'ArrowRight':
          if (jump) go({ row: active0.row, col: cols - 1 });
          else props.setCellSelection((s) => moveActive(s, 0, 1, rows, cols, extend));
          break;
        case 'PageDown':
          go({ row: active0.row + pageRows(), col: active0.col });
          break;
        case 'PageUp':
          go({ row: active0.row - pageRows(), col: active0.col });
          break;
        case 'Home':
          // Ctrl+Home → top-left corner; Home → start of the current row.
          go({ row: jump ? 0 : active0.row, col: 0 });
          break;
        case 'End':
          // Ctrl+End → bottom-right corner; End → end of the current row.
          go({ row: jump ? rows - 1 : active0.row, col: cols - 1 });
          break;
        case 'Escape':
          // When cell-nav is engaged (a cell is active), ignore Esc: clearing the active cell drops
          // to a non-obvious state where the next arrow jumps to the top-left corner. Leave it as-is.
          if (active !== null) return;
          props.setCellSelection(EMPTY_SELECTION);
          break;
        case 'a':
        case 'A':
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            props.setCellSelection(selectAll(rows, cols));
          }
          return;
        default:
          return;
      }
      event.preventDefault();
      scrollActiveCellIntoView();
    };
    document.addEventListener('keydown', handler);
    onCleanup(() => document.removeEventListener('keydown', handler));
  });

  // One data cell's <td> — the selectable / editable / staged / drillable cell. Shared by the
  // horizontal grid loop and the transposed record loop: both pass the cell's data (row, column), and
  // the td keeps `(dataRow, dataCol)` coords, so selection / nav / staged-bg / editing work in either
  // layout — only where the td sits in the DOM differs.
  const renderCellTd = (row: Row<TRow>, cell: Cell<TRow, unknown>): JSX.Element => {
    const rowIndex = row.index;
    const colIndex = (): number | undefined => colIndexById().get(cell.column.id);
    const selectable = (): boolean => colIndex() !== undefined;
    // Vertical padding / text size / wrap come from the grid display settings
    // (appended reactively in the class below); base keeps the horizontal pad + align.
    // `px-2` throughout, matching the header: this grid runs 20+ columns wide, so
    // horizontal padding is bought with the one axis the operator is short of.
    // `text-right`, physical and deliberate — NOT the logical `text-end` the header uses.
    //
    // Digits run left-to-right in every script, so a figure's ones place is on its right edge
    // whatever the surrounding direction. Aligning a numeric column by its logical end would, under
    // RTL, line the figures up by their MOST significant digit and leave the ones column ragged —
    // which removes the only reason numbers are aligned in the first place, and gets worse as the
    // magnitudes spread. So this one stays physical while the header aligns to the reading start:
    // where a label sits is a property of the language, where a digit sits is a property of the
    // number.
    const base =
      cell.column.id === 'select'
        ? 'cursor-pointer overflow-hidden px-2'
        : isRightAlignedCol(cell.column.id)
          ? 'overflow-hidden px-2 text-right'
          : 'overflow-hidden px-2';
    // One lookup per cell, shared by `isDirtyCell` and `pending` — both of
    // which are then read several times each (the class template, `bg()`,
    // `aria-busy`, the state attributes). As plain arrows that was four to six
    // `getStagedValue` calls per cell per render; a memo makes it one.
    const stagedState = createMemo(() =>
      selectable() ? props.getStagedValue(row.original, cell.column.id) : undefined,
    );
    const isDirtyCell = (): boolean => stagedState()?.staged === true;
    const isSel = (): boolean =>
      selectable() && cellIsSelected(props.cellSelection(), rowIndex, colIndex()!);
    const isAct = (): boolean =>
      selectable() && cellIsActive(props.cellSelection(), rowIndex, colIndex()!);
    // An open editor fills the whole cell (no padding) — spreadsheet feel.
    const editing = (): boolean => selectable() && isEditingCoord(rowIndex, colIndex()!);
    // Read-only = not editable for this cell (read-only column, missing
    // capability, or a per-row guard like a variable parent's Total).
    const readOnly = (): boolean =>
      selectable() && !canEditCoord({ row: rowIndex, col: colIndex()! });
    // Submitted-but-unreconciled: keep showing the staged value, faded + spinner.
    const pending = (): boolean => stagedState()?.pending === true;
    // Cells with a drill-down (e.g. Total → stock breakdown) flag a corner marker.
    const drillable = (): boolean =>
      selectable() && columnMetaById().get(cell.column.id)?.hasDrilldown === true;
    // Variation cells whose value is inherited from the parent product are
    // shown faded (the value still displays — it's just not the row's own).
    const inheritedCell = (): boolean =>
      selectable() && (props.isInherited?.(row.original, cell.column.id) ?? false);
    // Dirty cells keep their amber background even inside a multi-cell selection
    // (they don't get the light-blue selection wash).
    //
    // A read-only cell never loses its own colour to an interaction state — the
    // hue *mixes* instead. Read-only is red and selection is blue, so a selected
    // read-only cell is purple, which is legible as "both of those at once"
    // rather than as a third arbitrary status. Row hover, which is transient and
    // carries no meaning of its own, is a step of intensity within red
    // (50 resting → 100 hovered).
    //
    // The alternative — letting the blue selection wash win outright, as the
    // branch order once did — makes "you cannot edit this" vanish at exactly the
    // moment the user is trying to act on the cell, which is when they need it.
    //
    // The hover step rides the row's **named** `group/row`, never a bare
    // `group-hover:` — the grid wrapper is itself a `group`, so the unnamed form
    // fires for a pointer anywhere in the grid and lights every read-only cell
    // at once. The selected branch pins its own hover step because
    // `group-hover/row:` carries `:hover` specificity and would otherwise
    // *lighten* a selected cell back to the hover shade as the pointer arrives.
    const bg = (): string =>
      pending()
        ? ' bg-gray-50'
        : isDirtyCell()
          ? ' bg-yellow-100'
          : readOnly()
            ? isSel()
              ? ' bg-purple-200 group-hover/row:bg-purple-200'
              : ' bg-red-50 group-hover/row:bg-red-100'
            : isSel()
              ? ' bg-blue-100'
              : '';
    // A thin outline frames a multi-cell selection: each selected cell
    // shadows only the sides that sit on the region boundary (no internal
    // borders), so a contiguous range reads as one rectangle. The active
    // cell keeps its solid ring; single-cell selections need no outline.
    const outlineStyle = (): string | undefined => {
      if (isAct() || !isSel() || !isMultiCell(props.cellSelection())) return undefined;
      const e = selectionEdges(props.cellSelection(), rowIndex, colIndex()!);
      // Edges come back in DATA space (row/col). In record layout the axes are
      // transposed on screen — records run across (data row → display col), fields
      // run down (data col → display row) — so map data top/bottom → display
      // left/right and data left/right → display top/bottom.
      const rec = layout() === 'record';
      const top = rec ? e.left : e.top;
      const bottom = rec ? e.right : e.bottom;
      const left = rec ? e.top : e.left;
      const right = rec ? e.bottom : e.right;
      const c = '#3b82f6';
      const parts: string[] = [];
      if (top) parts.push(`inset 0 1px 0 0 ${c}`);
      if (bottom) parts.push(`inset 0 -1px 0 0 ${c}`);
      if (left) parts.push(`inset 1px 0 0 0 ${c}`);
      if (right) parts.push(`inset -1px 0 0 0 ${c}`);
      return parts.length > 0 ? parts.join(', ') : undefined;
    };

    return (
      <td
        data-cell-row={selectable() ? rowIndex : undefined}
        data-cell-col={selectable() ? colIndex() : undefined}
        data-col-id={selectable() ? cell.column.id : undefined}
        data-subject-id={selectable() ? props.getRowId(row.original) : undefined}
        /*
                                Cell state, published as attributes rather than left to be read off
                                the Tailwind classes below. A test asserting `bg-blue-100` is
                                asserting a colour and inferring a state from it: the assertion
                                breaks on a restyle while the behaviour is fine, and — worse — it
                                keeps passing if the state is right but the colour token changes
                                meaning. These names say what is true; the classes stay free to
                                express it however the design wants.

                                Written as six separate attributes, never one `{...{…}}` spread:
                                a spread is dynamic, so Solid routes it through the generic props
                                machinery (a merged proxy, `splitProps`, a key walk) and re-runs all
                                six getters whenever any one of them changes. Static names compile
                                to six narrow effects that each touch one attribute. Same markup,
                                and this is a hot path — 15 of these per row, ~8 new rows a frame.
                              */
        data-selected={isSel() ? '' : undefined}
        data-active={isAct() ? '' : undefined}
        data-staged={isDirtyCell() ? '' : undefined}
        data-pending={pending() ? '' : undefined}
        data-readonly={readOnly() ? '' : undefined}
        data-inherited={inheritedCell() ? '' : undefined}
        style={outlineStyle() ? { 'box-shadow': outlineStyle() } : undefined}
        aria-busy={pending() ? 'true' : undefined}
        class={`border-r border-gray-200 ${editing() ? 'overflow-hidden p-0' : `${base} ${cellDensityText()}${cellWrapClass(cell.column.id)}`}${bg()}${
          isAct() && !editing() ? ' ring-2 ring-inset ring-blue-500' : ''
        }${drillable() || pending() ? ' relative' : ''}${
          drillable() && readOnly() ? ' cursor-zoom-in' : ''
        }${inheritedCell() && !editing() ? ' italic text-text-muted' : ''}`}
        onClick={
          leadingColumnIds().includes(cell.column.id) && props.onLeadingCellClick
            ? (e) => props.onLeadingCellClick!(row.original, cell.column.id, e)
            : undefined
        }
        onMouseDown={
          selectable() ? (e) => handleCellMouseDown(e, rowIndex, colIndex()!) : undefined
        }
        onMouseEnter={selectable() ? () => handleCellMouseEnter(rowIndex, colIndex()!) : undefined}
        onDblClick={
          selectable()
            ? () => {
                const coord = { row: rowIndex, col: colIndex()! };
                props.setCellSelection(selectCell(coord));
                // Editable cells edit; read-only cells with a drill-down drill down.
                if (canEditCoord(coord)) {
                  enterEdit();
                } else if (canDrilldownCoord(coord)) {
                  void openDrilldown(coord);
                }
              }
            : undefined
        }
        onContextMenu={
          selectable() ? (e) => handleCellContextMenu(e, rowIndex, colIndex()!) : undefined
        }
      >
        {/* Drill-down marker: a small corner flag signalling "more detail
                                  here" (double-click on read-only cells, Alt+Enter / menu otherwise). */}
        <Show when={drillable() && !editing()}>
          <span
            class="pointer-events-none absolute bottom-0 right-0 h-0 w-0 border-b-[6px] border-l-[6px] border-b-slate-400 border-l-transparent"
            aria-hidden="true"
            title={__('Has a drill-down view')}
          />
        </Show>
        {/* In-flight overlay: a translucent wash mutes the (still-shown) staged value
                                  and a centred spinner signals "submitted, awaiting server". */}
        <Show when={pending()}>
          <span
            class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-gray-100/60"
            aria-hidden="true"
          >
            <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
          </span>
        </Show>
        <Show
          when={
            selectable() &&
            isEditingCoord(rowIndex, colIndex()!) &&
            canEditCoord({ row: rowIndex, col: colIndex()! })
          }
          fallback={flexRender(cell.column.columnDef.cell, cell.getContext())}
        >
          {(() => {
            const meta = columnMetaById().get(cell.column.id);
            const editor = meta
              ? editRegistry.resolve(meta.dataType, componentChoiceId(meta.dataType, 'edit'))
              : null;
            if (!meta || !editor) {
              return flexRender(cell.column.columnDef.cell, cell.getContext());
            }
            const staged = props.getStagedValue(row.original, cell.column.id);
            // `column` and `ctx` are read only inside the editor's commit — which
            // runs from a raw `blur` (clicking another cell steals focus), where
            // there is no reactive owner. Passed as inline JSX expressions they
            // become lazy prop memos created on that first access, i.e. outside a
            // root ("computations created outside a `createRoot`"). The editor is
            // short-lived and neither value changes under it, so compute them
            // eagerly here (under the owning render) and pass static props.
            const editorMeta = props.resolveEditorMeta
              ? props.resolveEditorMeta(meta, row.original)
              : meta;
            const editorCtx = { taxonomySpace: taxonomySpace() };
            return (
              <Dynamic
                component={editor}
                value={
                  staged.staged
                    ? staged.value
                    : persistedEditorValue(row.original, cell.column.id, meta)
                }
                column={editorMeta}
                ctx={editorCtx}
                initialText={editEntryText()}
                onCommit={(value: unknown, move: EditMove) => commitEdit(value, move)}
                onCancel={() => cancelEdit()}
              />
            );
          })()}
        </Show>
      </td>
    );
  };

  // ── Record ("transposed") layout helpers ──
  // Records become columns; the visible fields (leaf columns, minus the checkbox) become rows.
  const recordRows = (): Row<TRow>[] => visibleRows();
  const recordFields = (): Column<TRow>[] =>
    table.getVisibleLeafColumns().filter((c) => c.id !== 'select');
  const fieldLabelOf = (col: Column<TRow>): string => {
    const meta = columnMetaById().get(col.id);
    if (meta) return meta.label;
    const header = col.columnDef.header;
    return typeof header === 'string' ? header : col.id;
  };
  /** The record row's cell for a given field column (they share the visible-column set + order). */
  const cellFor = (row: Row<TRow>, fieldId: string): Cell<TRow, unknown> | undefined =>
    row.getVisibleCells().find((c) => c.column.id === fieldId);

  return (
    <>
      {/* ── Column visibility modal ── */}
      <Show when={showColManager()}>
        <ColumnManagerModal
          table={table}
          columnOrder={props.columnOrder()}
          columns={props.columnMetas()}
          groupLabels={props.groupLabels}
          onMoveColumn={moveColumn}
          expandedSections={props.expandedColumnSections}
          setExpandedSections={props.setExpandedColumnSections}
          onReset={props.onResetColumns}
          canRenameColumns={props.canRenameColumns}
          onRenameColumn={props.onRenameColumn}
          initialQuery={colManagerQuery()}
          onClose={() => setShowColManager(false)}
        />
      </Show>

      {/* ── Grid display settings (density / wrap / text size) ── */}
      <Show when={!surface && showGridSettings()}>
        <GridSettingsModal
          settings={gridSettings()}
          onChange={setGridSettings}
          onClose={() => setShowGridSettings(false)}
        />
      </Show>

      {/* ── Per-cell drill-down (6b.7, §11.7) ── */}
      <Show when={drilldown()}>
        {(dd) => {
          const Component = (): ReturnType<typeof drilldownRegistry.resolve> =>
            dd().meta
              ? drilldownRegistry.resolve(
                  dd().meta!.dataType,
                  componentChoiceId(dd().meta!.dataType, 'drilldown'),
                )
              : null;
          return (
            <Modal onClose={() => setDrilldown(null)} label={__('Details')}>
              <ModalPanel size="none" class={dd().meta?.drilldownMaxWidth ?? 'max-w-lg'}>
                {/* Title defaults to the column label; a drill-down may override with a richer JSX
                    render fn (e.g. "On order - {SKU}"). The fns run inside the header, in its owner,
                    so any JSX they build is disposed with it. */}
                <ModalHeader
                  title={dd().title ? dd().title!() : (dd().meta?.label ?? dd().columnId)}
                  subtitle={dd().subtitle?.()}
                />
                <div class="p-4">
                  <Show
                    when={!dd().loading}
                    fallback={<p class="text-sm text-text-muted">{__('Loading…')}</p>}
                  >
                    <Show
                      when={dd().error === null}
                      fallback={<ErrorBanner class="text-sm">{dd().error}</ErrorBanner>}
                    >
                      <Show
                        when={Component() && dd().meta}
                        fallback={
                          <pre class="overflow-auto rounded bg-gray-50 p-3 text-xs text-text">
                            {JSON.stringify(dd().detail, null, 2)}
                          </pre>
                        }
                      >
                        <Dynamic
                          component={Component()!}
                          detail={dd().detail}
                          column={dd().meta!}
                          subjectId={dd().subjectId}
                          ctx={{ taxonomySpace: taxonomySpace() }}
                          save={props.saveDrilldown ? saveDrilldownDetail : undefined}
                          searchOptions={props.drilldownSearchOptions}
                        />
                      </Show>
                    </Show>
                  </Show>
                </div>
                <ModalFooter>
                  <Button variant="secondary" onClick={() => setDrilldown(null)}>
                    {__('Close')}
                  </Button>
                </ModalFooter>
              </ModalPanel>
            </Modal>
          );
        }}
      </Show>

      {/* ── Right-click context menu (6b.5, §11.9) ── */}
      <Show when={contextMenu()}>
        {(menu) => {
          const items = (): ContextMenuItem[] => {
            const m = menu();
            return m.columnId !== undefined
              ? headerMenuItems(m.columnId)
              : contextMenuItems(m.coord);
          };
          // Flyout direction: open submenus to the left when the menu sits in the right ~third of the
          // viewport, so a right-anchored submenu doesn't run off-screen.
          const submenuOnLeft = menu().x > window.innerWidth * 0.62;
          // Keep a submenu fully on-screen vertically: shift up by any bottom overflow. Measured in a
          // rAF (not synchronously in the ref) so the flyout's children are laid out and its true height
          // is known; the shift is clamped so a taller-than-viewport submenu doesn't run off the top.
          const positionSubmenu = (el: HTMLUListElement): void => {
            requestAnimationFrame(() => {
              if (!el.isConnected) return;
              el.style.top = '0px';
              const rect = el.getBoundingClientRect();
              const bottomOverflow = rect.bottom - (window.innerHeight - 8);
              if (bottomOverflow > 0) el.style.top = `${-Math.min(bottomOverflow, rect.top - 8)}px`;
            });
          };
          const btnClass = (item: ContextMenuItem): string =>
            menuItemClass(false, !!item.disabled, 'justify-between gap-6');
          // Recursive item render supporting arbitrary submenu nesting (`depth` keys the open state).
          const renderItem = (item: ContextMenuItem, depth: number): JSX.Element => {
            if (!item.children || item.children.length === 0) {
              return (
                <li onMouseEnter={() => hoverAt(depth, null)}>
                  <button
                    type="button"
                    role="menuitem"
                    // aria-disabled (not the native attr) so the item still receives hover + `title`.
                    aria-disabled={item.disabled ? 'true' : undefined}
                    title={item.title}
                    class={btnClass(item)}
                    onClick={() => {
                      if (item.disabled) return;
                      closeContextMenu();
                      item.run?.();
                    }}
                  >
                    <span>{item.label}</span>
                    <Show when={item.shortcut}>
                      <span class="text-xs text-text-muted">{item.shortcut}</span>
                    </Show>
                  </button>
                </li>
              );
            }
            return (
              <li class="relative" onMouseEnter={() => hoverAt(depth, item.key)}>
                <button
                  type="button"
                  role="menuitem"
                  aria-haspopup="true"
                  aria-disabled={item.disabled ? 'true' : undefined}
                  title={item.title}
                  class={btnClass(item)}
                  // A parent that ALSO carries `run` (e.g. "Copy") acts on click; a pure parent toggles.
                  onClick={() => {
                    if (item.disabled) return;
                    if (item.run) {
                      closeContextMenu();
                      item.run();
                    } else {
                      hoverAt(depth, openByDepth()[depth] === item.key ? null : item.key);
                    }
                  }}
                >
                  <span>{item.label}</span>
                  <span class="flex items-center gap-2">
                    <Show when={item.shortcut}>
                      <span class="text-xs text-text-muted">{item.shortcut}</span>
                    </Show>
                    <span class="text-xs text-text-muted" aria-hidden="true">
                      ▸
                    </span>
                  </span>
                </button>
                <Show when={openByDepth()[depth] === item.key}>
                  <ul
                    role="menu"
                    ref={positionSubmenu}
                    class={`absolute top-0 z-submenu min-w-44 rounded-md border border-border bg-surface py-1 shadow-lg ${submenuOnLeft ? 'right-full' : 'left-full'}`}
                  >
                    <For each={item.children}>{(child) => renderItem(child, depth + 1)}</For>
                  </ul>
                </Show>
              </li>
            );
          };
          return (
            <>
              {/* Transparent backdrop: any click (or another right-click) dismisses the menu. */}
              <div
                class="fixed inset-0 z-menu-backdrop"
                onMouseDown={closeContextMenu}
                onContextMenu={(e) => {
                  e.preventDefault();
                  closeContextMenu();
                }}
              />
              <ul
                role="menu"
                class="fixed z-menu min-w-44 rounded-md border border-border bg-surface py-1 text-sm shadow-lg"
                style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <For
                  each={items()}
                  fallback={<li class="px-3 py-1.5 text-text-muted">{__('No actions')}</li>}
                >
                  {(item) => renderItem(item, 0)}
                </For>
              </ul>
            </>
          );
        }}
      </Show>

      {/* ── Scrollable table (hover-revealed settings gear straddles the top-right corner) ── */}
      <div class="group relative flex min-h-0 flex-1 flex-col">
        {/* Settings gear — absolute over the top-right corner (outside the scroll clip so it straddles
            the border), fades + slides in left-to-right on grid hover/focus. The discoverable entry to
            Columns + Grid display; the keyboard shortcuts stay for power users. */}
        <div ref={gearRef} class="absolute -right-1 -top-2 z-40">
          <button
            type="button"
            class={iconButtonClass(
              'md',
              false,
              // The gear is hover-revealed: it slides in from under the grid's right edge and
              // fades up, so it carries motion + a card border the plain icon button has no
              // reason to.
              '-translate-x-3 rounded-md border border-border bg-surface opacity-0 shadow-sm transition duration-300 ease-in group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100',
            )}
            aria-label={__('Grid options')}
            title={__('Grid options')}
            onClick={() => setShowGearMenu((v) => !v)}
          >
            <GearIcon />
          </button>
          <Show when={showGearMenu()}>
            <ul class="absolute right-0 top-full mt-1 min-w-44 rounded-md border border-border bg-surface py-1 text-sm shadow-lg">
              <li>
                <button
                  type="button"
                  class={menuItemClass(false, false, 'justify-between gap-6')}
                  onClick={() => {
                    setShowGearMenu(false);
                    openColumnManager();
                  }}
                >
                  {__('Columns')}
                  <span class="text-xs text-text-muted">Ctrl+M</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  class={menuItemClass(false, false, 'justify-between gap-6')}
                  onClick={() => {
                    setShowGearMenu(false);
                    if (surface) surface.openSettings();
                    else setShowGridSettings(true);
                  }}
                >
                  {__('Grid display')}
                  <span class="text-xs text-text-muted">Ctrl+,</span>
                </button>
              </li>
            </ul>
          </Show>
        </div>
        <div
          ref={scrollContainerRef}
          tabindex="0"
          class="min-h-0 flex-1 select-none overflow-auto rounded border border-border bg-surface shadow-sm outline-none"
          onWheel={(event) => {
            // Shift+wheel → horizontal scroll. Browsers vary: some report it on deltaY, others remap to
            // deltaX; notched mice report line/page deltaMode. Take the dominant axis, normalise, consume.
            if (!event.shiftKey) return;
            const raw =
              Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            if (raw === 0) return;
            const perLine = 16;
            const factor =
              event.deltaMode === 1
                ? perLine
                : event.deltaMode === 2
                  ? event.currentTarget.clientWidth
                  : 1;
            event.currentTarget.scrollLeft += raw * factor;
            event.preventDefault();
          }}
        >
          <Show
            when={layout() === 'grid'}
            fallback={
              // ── Transposed record matrix: fields = rows, records = columns (header = record key). ──
              // `table-fixed` treats per-cell widths as *ratios* of the table's own width, so without an
              // explicit table width the browser squeezes every column into the container and lets content
              // stretch them. Pinning the table width to the exact sum of column widths makes each column
              // honour its px width and lets the scroll container overflow horizontally.
              <table
                class="table-fixed border-collapse text-left text-sm"
                style={{
                  width: `${recordFieldWidth() + recordRows().length * recordColWidth()}px`,
                }}
              >
                <thead>
                  <tr>
                    <th
                      class={`sticky left-0 top-0 z-30 border-b border-r border-border bg-surface-raised px-3 ${DENSITY_PADDING[gridSettings().density]}`}
                      style={{ width: `${recordFieldWidth()}px` }}
                    >
                      <span
                        class="absolute top-0 right-0 z-10 h-full w-2 cursor-col-resize touch-none select-none hover:bg-blue-400/60"
                        onPointerDown={(e) => startRecordResize('field', e)}
                      />
                    </th>
                    <For each={recordRows()}>
                      {(rr) => (
                        <th
                          class={`sticky top-0 z-20 border-b border-l border-border bg-surface-raised px-4 ${DENSITY_PADDING[gridSettings().density]} text-left font-semibold text-text`}
                          style={{ width: `${recordColWidth()}px` }}
                        >
                          <span class="block truncate">
                            {props.recordKeyLabel
                              ? props.recordKeyLabel(rr.original)
                              : props.getRowId(rr.original)}
                          </span>
                          <span
                            class="absolute top-0 right-0 z-10 h-full w-2 cursor-col-resize touch-none select-none hover:bg-blue-400/60"
                            onPointerDown={(e) => startRecordResize('col', e)}
                          />
                        </th>
                      )}
                    </For>
                  </tr>
                </thead>
                <tbody>
                  <For each={recordFields()}>
                    {(fieldCol) => (
                      <tr class="border-t border-border">
                        {/* Field-label cell doubles as the row's drag handle: dragging it reorders the
                          fields, which is the same columnOrder state table-mode header drag moves — so a
                          reorder in either layout is reflected in the other. Drop bar sits on the top edge
                          (fields stack vertically) mirroring the table-mode left-edge bar. */}
                        <th
                          // Density-driven vertical padding (not a fixed py-2): in record mode this
                          // field-label cell is the row header, so a fixed padding would cap the whole
                          // row's height and swallow the compact↔normal difference the data cells make.
                          class={`sticky left-0 z-10 cursor-move select-none border-r border-border bg-surface-raised px-3 ${DENSITY_PADDING[gridSettings().density]} text-left align-top text-sm font-medium text-text-muted`}
                          draggable={true}
                          onDragStart={(event) => {
                            setDraggingColId(fieldCol.id);
                            event.dataTransfer?.setData('text/x-invflux-col', fieldCol.id);
                            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragOver={(event) => {
                            const src = draggingColId();
                            if (src === null || src === fieldCol.id) return;
                            event.preventDefault();
                            setDropTargetId(fieldCol.id);
                          }}
                          onDragLeave={() => {
                            if (dropTargetId() === fieldCol.id) setDropTargetId(null);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const sourceId =
                              draggingColId() ??
                              event.dataTransfer?.getData('text/x-invflux-col') ??
                              '';
                            if (sourceId && sourceId !== fieldCol.id)
                              moveColumn(sourceId, fieldCol.id);
                            setDraggingColId(null);
                            setDropTargetId(null);
                          }}
                          onDragEnd={() => {
                            setDraggingColId(null);
                            setDropTargetId(null);
                          }}
                          title={fieldLabelOf(fieldCol)}
                        >
                          <Show when={dropTargetId() === fieldCol.id}>
                            <div
                              data-drop-target
                              class="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 bg-blue-500"
                            />
                          </Show>
                          {/* Record layout transposes the grid, so this row header carries a *column*
                            name — it answers to the header-lines setting, not the cell one. */}
                          <span
                            class={
                              headerLines() > 1
                                ? 'block overflow-hidden hyphens-auto break-words'
                                : 'block truncate'
                            }
                            style={headerBoundStyle()}
                          >
                            {fieldLabelOf(fieldCol)}
                          </span>
                        </th>
                        <For each={recordRows()}>
                          {(rr) => {
                            const cell = cellFor(rr, fieldCol.id);
                            return cell ? (
                              renderCellTd(rr, cell)
                            ) : (
                              <td class="border-l border-gray-200" />
                            );
                          }}
                        </For>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            }
          >
            <table
              class="table-fixed border-collapse text-left text-sm"
              style={{ width: `${table.getTotalSize()}px`, 'min-width': '100%' }}
            >
              {/* Column widths (table-fixed honours these); getSize() is live during a resize. */}
              <colgroup>
                <For each={table.getVisibleLeafColumns()}>
                  {(col) => <col style={{ width: `${col.getSize()}px` }} />}
                </For>
              </colgroup>
              <thead class="sticky top-0 z-10 bg-surface-raised text-xs font-semibold uppercase text-text-muted">
                <For each={table.getHeaderGroups()}>
                  {(hg) => (
                    <tr>
                      <For each={hg.headers}>
                        {(header) => {
                          const canSort = header.column.getCanSort();
                          // No `isRightAlignedCol` here: that answers for the column's *data*, and
                          // the header no longer follows it — names align to the reading start, and
                          // the sort affordance is pinned to the logical end regardless.
                          const isSelectCol = header.column.id === 'select';
                          return (
                            <th
                              data-col-id={header.column.id}
                              scope="col"
                              // The sort state, spoken. Without it a screen reader announces the
                              // column name and nothing about which column the table is ordered by
                              // — the one thing the arrows convey visually. `none` on the other
                              // sortable columns is what makes them announce as sortable at all.
                              aria-sort={
                                !canSort
                                  ? undefined
                                  : 'asc' === header.column.getIsSorted()
                                    ? 'ascending'
                                    : 'desc' === header.column.getIsSorted()
                                      ? 'descending'
                                      : 'none'
                              }
                              title={columnMetaById().get(header.column.id)?.description}
                              class={[
                                `relative select-none overflow-hidden ${headerWrapClass()} ${headerDensityText()}`,
                                'border-r border-border last:border-r-0',
                                'px-2', // same as the data cells, so a label sits over its column's values
                                // Header names align to the reading start regardless of the column's
                                // own alignment: a numeric column right-aligns its *figures* so
                                // digits line up, which is a property of the data, not of its label.
                                // Logical (`text-start`, not `text-left`) so an RTL locale flips it.
                                'text-start',
                                canSort || isSelectCol
                                  ? ' cursor-pointer hover:bg-surface-hover'
                                  : '',
                                // NAMED, not a bare `group`: `group-hover:` answers to ANY ancestor
                                // carrying `group`, and this component's outer wrapper is one — so
                                // a plain variant on the sort arrows lights up every header's
                                // arrows whenever the pointer is anywhere in the grid.
                                canSort ? 'group/sort' : '',
                              ].join(' ')}
                              // Not draggable while a resize is in progress — flipped off
                              // synchronously on grip-press so a leftward narrowing drag can't be
                              // hijacked into a native header drag before it starts.
                              draggable={!isSelectCol && !resizingActive()}
                              onDragStart={(event) => {
                                if (resizingActive() || header.column.getIsResizing()) {
                                  event.preventDefault();
                                  return;
                                }
                                setDraggingColId(header.column.id);
                                event.dataTransfer?.setData('text/x-invflux-col', header.column.id);
                                if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
                              }}
                              onDragOver={(event) => {
                                const src = draggingColId();
                                if (isSelectCol || src === null || src === header.column.id) return;
                                event.preventDefault(); // allow drop
                                setDropTargetId(header.column.id);
                              }}
                              onDragLeave={() => {
                                if (dropTargetId() === header.column.id) setDropTargetId(null);
                              }}
                              onDrop={(event) => {
                                event.preventDefault();
                                const sourceId =
                                  draggingColId() ??
                                  event.dataTransfer?.getData('text/x-invflux-col') ??
                                  '';
                                if (sourceId && sourceId !== header.column.id)
                                  moveColumn(sourceId, header.column.id);
                                setDraggingColId(null);
                                setDropTargetId(null);
                              }}
                              onDragEnd={() => {
                                setDraggingColId(null);
                                setDropTargetId(null);
                              }}
                              onClick={
                                isSelectCol
                                  ? () => table.toggleAllPageRowsSelected()
                                  : canSort
                                    ? (event) => {
                                        // The affordance is a real button now, for the keyboard.
                                        // Clicking it would otherwise toggle twice — once on the
                                        // button, once here as it bubbles — landing back where it
                                        // started, so the control would look broken to a mouse.
                                        if ((event.target as HTMLElement).closest('button')) return;
                                        header.column.getToggleSortingHandler()?.(event);
                                      }
                                    : undefined
                              }
                              onContextMenu={
                                isSelectCol
                                  ? undefined
                                  : (e) => handleHeaderContextMenu(e, header.column.id)
                              }
                            >
                              {/* Drop-insertion cursor: a reordered column always lands immediately
                              before the column under the pointer, so the bar sits on its left edge. */}
                              <Show when={dropTargetId() === header.column.id}>
                                <div
                                  data-drop-target
                                  class="pointer-events-none absolute inset-y-0 left-0 z-20 w-0.5 bg-blue-500"
                                />
                              </Show>
                              {/* A wrapped header pins its sort affordance to the cell corner and
                              reserves a strip for it; only the NAME is height-capped.
                              Both alternatives are worse, and both were measured: leaving the
                              arrows inline inside the capped box clips them away entirely on a name
                              that overruns its budget (a sortable column with no sort indicator —
                              "Disponible (ATP)" at two lines), while making them a flex sibling
                              charges their width to EVERY line of the name, not just the last, which
                              is enough to shred a narrow column into "DIS-/PO-". Out of flow, the
                              affordance costs one fixed strip and the name keeps the rest.
                              At one line none of this applies and the markup is as it always was. */}
                              {/* No padding reserved for the sort affordance. Reserving a strip on
                              every sortable header charges the columns that can least afford it —
                              it turned "ATP (Disponible)" into "ATP (DIS" and "Réservé" into
                              "Réser". The affordance overlays instead, on its own opaque ground, so
                              a name that fits is untouched and only one that overruns is occluded,
                              at the very edge, where it is already being clipped by the cell. */}
                              <div>
                                <span
                                  class={headerLines() > 1 ? 'block overflow-hidden' : undefined}
                                  style={headerBoundStyle()}
                                >
                                  {flexRender(header.column.columnDef.header, header.getContext())}
                                </span>
                                {/* Sort indicator — the WooCommerce/WP Products-table look: a stacked
                              up/down triangle pair. The active direction is solid; the idle pair is
                              faint and brightens on header hover (so a sortable-but-unsorted column
                              still hints it's clickable). asc = up, desc = down. */}
                                <Show when={canSort}>
                                  <button
                                    type="button"
                                    // The keyboard's way in. The `<th>` click sorts for a mouse, but
                                    // a table header takes no focus and fires no key event, so
                                    // without this the whole sort feature was pointer-only. It is
                                    // this element rather than a wrapper around the name because the
                                    // cell is `draggable` for column reorder, and the name is where
                                    // people grab to drag.
                                    aria-label={sprintf(
                                      /* translators: %s is a column name. */
                                      __('Sort by %s'),
                                      // Same fallback chain the column manager uses. Server meta
                                      // carries the merchant's own name where there is one, but it
                                      // does not cover every column, and dropping straight to the id
                                      // announces "Sort by name" for a column headed "Produit".
                                      columnMetaById().get(header.column.id)?.label ??
                                        ('string' === typeof header.column.columnDef.header
                                          ? header.column.columnDef.header
                                          : header.column.id),
                                    )}
                                    onClick={(event) =>
                                      header.column.getToggleSortingHandler()?.(event)
                                    }
                                    // Always at the cell's right edge, out of flow, at every line
                                    // count. Inline, it is the first thing a narrow column clips —
                                    // which is how a sortable column ends up showing no sort
                                    // indicator at all. `right-2` clears the resize grip's 6px.
                                    //
                                    // Anchored to the `<th>`, never to the name wrapper: the
                                    // wrapper's box follows the name and can run past the cap, so
                                    // anchoring there would drag the arrows out of the cell with it.
                                    // The th is the nearest positioned ancestor (it carries
                                    // `relative`) and the wrapper sets no `position`, so this holds
                                    // — but it holds *by omission*, so do not add positioning to
                                    // that div without moving this.
                                    //
                                    // `bottom-0` + the cell's own vertical padding rather than a
                                    // fixed offset: that lands the arrows on the text's last line
                                    // instead of the cell floor, and keeps them there when the
                                    // density setting changes the padding under them.
                                    // `bg-surface-raised` is the occlusion: the same ground the header row
                                    // paints, so an overrunning name reads as running underneath the
                                    // affordance rather than colliding with it.
                                    //
                                    // Anchored to the cell edge, NOT inset. An inset leaves a gutter
                                    // beyond the occluder that the clipped name shows through, so the
                                    // name appears to resume after the arrows ("ATP (D⇅SI"). The
                                    // ground has to reach the edge; `px-1` is what keeps the glyphs
                                    // off it and off the name. Logical `end-0`, so it stays where the
                                    // name runs out rather than sitting over its start under RTL.
                                    //
                                    // `inset-y-0` + `justify-center` rather than a centred glyph:
                                    // the occluder has to span the FULL cell height or a two- and
                                    // three-line name shows above and below a band-shaped ground.
                                    // Spanning it also centres the glyphs for free, at every
                                    // density, with no offset to keep in step with the padding.
                                    // Not <Button>/<IconButton>: this sits on the header's own ground
                                    // and inherits its colour, where every Button variant commits to
                                    // one. It still owes the suite's rules, so the pointer and the
                                    class="absolute inset-y-0 end-0 inline-flex shrink-0 cursor-pointer flex-col items-center justify-center bg-surface-raised pe-1 ps-0.5 leading-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                  >
                                    <svg
                                      viewBox="0 0 8 5"
                                      class="h-1 w-2 fill-current transition-opacity"
                                      classList={{
                                        'opacity-90': header.column.getIsSorted() === 'asc',
                                        'opacity-20 group-hover/sort:opacity-60':
                                          header.column.getIsSorted() !== 'asc',
                                      }}
                                    >
                                      <path d="M4 0 8 5 0 5Z" />
                                    </svg>
                                    <svg
                                      viewBox="0 0 8 5"
                                      class="mt-[2px] h-1 w-2 fill-current transition-opacity"
                                      classList={{
                                        'opacity-90': header.column.getIsSorted() === 'desc',
                                        'opacity-20 group-hover/sort:opacity-60':
                                          header.column.getIsSorted() !== 'desc',
                                      }}
                                    >
                                      <path d="M0 0 8 0 4 5Z" />
                                    </svg>
                                  </button>
                                </Show>
                              </div>
                              {/* Resize grip: drag to size; double-click to reset to the default. */}
                              <Show when={header.column.getCanResize()}>
                                <div
                                  role="separator"
                                  aria-orientation="vertical"
                                  class={`absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-blue-400/60${
                                    header.column.getIsResizing() ? ' bg-blue-500' : ''
                                  }`}
                                  onMouseDown={(event) => {
                                    event.stopPropagation();
                                    // Block header drag for this whole gesture (any direction), reset on release.
                                    setResizingActive(true);
                                    window.addEventListener(
                                      'mouseup',
                                      () => setResizingActive(false),
                                      { once: true },
                                    );
                                    header.getResizeHandler()(event);
                                  }}
                                  onTouchStart={(event) => {
                                    event.stopPropagation();
                                    setResizingActive(true);
                                    window.addEventListener(
                                      'touchend',
                                      () => setResizingActive(false),
                                      { once: true },
                                    );
                                    header.getResizeHandler()(event);
                                  }}
                                  onClick={(event) => event.stopPropagation()}
                                  onDblClick={(event) => {
                                    event.stopPropagation();
                                    props.setColumnSizing((prev) => {
                                      const next = { ...prev };
                                      delete next[header.column.id];
                                      return next;
                                    });
                                  }}
                                />
                              </Show>
                            </th>
                          );
                        }}
                      </For>
                    </tr>
                  )}
                </For>
              </thead>
              <tbody>
                <Show
                  when={visibleRows().length > 0}
                  fallback={
                    <tr>
                      <td class="px-4 py-8 text-center text-text-muted" colSpan={colSpan()}>
                        {props.fallback}
                      </td>
                    </tr>
                  }
                >
                  <tr>
                    <td style={{ height: `${paddingTop()}px` }} colSpan={colSpan()} />
                  </tr>
                  <For each={virtualRows()}>
                    {(row) => {
                      const attrs = (): RowAttrs => props.rowAttrs?.(row.original) ?? {};
                      return (
                        <tr
                          // `bg-blue-100` for the selected row: `bg-blue-60` was not a class — Tailwind's
                          // blue scale has no 60 and no theme token defines one — so a checkbox-selected
                          // row has been rendering with no highlight at all.
                          // A **named** group so a cell can react to *row* hover — read-only cells paint
                          // their own background over the row's, so they need the variant to see it at
                          // all. It must be named: the grid's own wrapper at the top of this component
                          // is a bare `group`, so a plain `group-hover:` on a cell answers to "pointer
                          // anywhere in the grid" instead of "pointer on this row".
                          class={`group/row border-t border-border hover:bg-blue-50${row.getIsSelected() ? ' bg-blue-100' : ''}`}
                          classList={attrs().class ? { [attrs().class!]: true } : undefined}
                          title={attrs().title}
                          // A host may publish row state as `data-*` alongside the class it styles with.
                          // Without this the only machine-readable handle on a row's meaning is the
                          // utility class the design happens to use, and `title` is translated.
                          {...Object.fromEntries(
                            Object.entries(attrs().data ?? {}).map(([k, v]) => [`data-${k}`, v]),
                          )}
                        >
                          <For each={row.getVisibleCells()}>
                            {(cell) => renderCellTd(row, cell)}
                          </For>
                        </tr>
                      );
                    }}
                  </For>
                  <tr>
                    <td style={{ height: `${paddingBottom()}px` }} colSpan={colSpan()} />
                  </tr>
                </Show>
              </tbody>
              <Show when={hasFooter() && visibleRows().length > 0}>
                <tfoot>
                  <tr class="sticky bottom-0 z-10 border-t-2 border-border bg-gray-100 font-semibold">
                    <For each={table.getVisibleLeafColumns()}>
                      {(col) => {
                        const isSum = (): boolean =>
                          columnMetaById().get(col.id)?.aggregate === 'sum';
                        return (
                          <td
                            class={`overflow-hidden bg-gray-100 px-2 py-2 ${
                              isRightAlignedCol(col.id) ? 'text-right tabular-nums' : 'text-left'
                            }`}
                            title={
                              isSum()
                                ? sprintf(
                                    _n(
                                      'Total over %d loaded row (scroll to load more)',
                                      'Total over %d loaded rows (scroll to load more)',
                                      visibleRows().length,
                                    ),
                                    visibleRows().length,
                                  )
                                : undefined
                            }
                          >
                            <Show
                              when={isSum()}
                              fallback={
                                col.id === footerLabelColId() ? (
                                  <span
                                    class="font-normal text-text-muted text-nowrap"
                                    title={sprintf(
                                      _n(
                                        'Totals over %d loaded row (scroll to load more)',
                                        'Totals over %d loaded rows (scroll to load more)',
                                        visibleRows().length,
                                      ),
                                      visibleRows().length,
                                    )}
                                  >
                                    {__('Σ totals')}
                                  </span>
                                ) : null
                              }
                            >
                              {formatFooter(col.id)}
                            </Show>
                          </td>
                        );
                      }}
                    </For>
                  </tr>
                </tfoot>
              </Show>
            </table>
          </Show>
        </div>
      </div>
    </>
  );
}

/** A labelled row of mutually-exclusive choices — the shared control plus its caption. */
function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onSelect: (value: T) => void;
}): JSX.Element {
  return (
    <div>
      <div class="mb-1 text-sm font-medium text-text">{props.label}</div>
      <SegmentedControl
        ariaLabel={props.label}
        options={props.options}
        value={props.value}
        onChange={(v: T) => props.onSelect(v)}
      />
    </div>
  );
}

/**
 * Grid display settings — density, text wrapping, and text size. Grid-internal + persisted (per the
 * host's `settingsKey`); a sibling to the column manager. Pure presentation, so the host never sees it.
 */
/**
 * The grid display-settings controls (row height / text wrapping / text size). Shared by the
 * standalone {@link GridSettingsModal} (used outside the unified app) and the "Data Grid" section the
 * grid contributes to the app shell's gear popover.
 */
function GridDisplaySettingsControls(props: {
  settings: GridSettings;
  onChange: (next: GridSettings) => void;
}): JSX.Element {
  const set = <K extends keyof GridSettings>(key: K, value: GridSettings[K]): void =>
    props.onChange({ ...props.settings, [key]: value });

  return (
    <div class="space-y-4">
      <Segmented
        label={__('Row height')}
        value={props.settings.density}
        options={[
          { value: 'compact', label: __('Compact') },
          { value: 'normal', label: __('Normal') },
          { value: 'large', label: __('Large') },
        ]}
        onSelect={(v) => set('density', v)}
      />
      <Segmented
        label={__('Text wrapping')}
        value={props.settings.wrap}
        options={[
          { value: 'no-wrap', label: __('No wrap') },
          { value: 'wrap', label: __('Wrap') },
        ]}
        onSelect={(v) => set('wrap', v)}
      />
      {/* A line budget rather than an on/off, and separate from cell wrapping on purpose. A header
          is a fixed label read once, a cell holds data of unknown length, so wanting one to wrap
          says nothing about wanting the other to — and unlike a cell, a header's height is paid
          once but occupies the top of every screen, which is what the budget bounds. `1` is the
          single-line default; above it the name wraps and is clamped, with an ellipsis. */}
      <Segmented
        label={__('Column name lines')}
        value={String(props.settings.headerLines)}
        options={Array.from({ length: MAX_HEADER_LINES }, (_, i) => ({
          value: String(i + 1),
          label: String(i + 1),
        }))}
        onSelect={(v) => set('headerLines', Number(v))}
      />
      <Segmented
        label={__('Text size')}
        value={props.settings.textSize}
        options={[
          { value: 'small', label: __('Small') },
          { value: 'normal', label: __('Normal') },
          { value: 'large', label: __('Large') },
        ]}
        onSelect={(v) => set('textSize', v)}
      />
    </div>
  );
}

function GridSettingsModal(props: {
  settings: GridSettings;
  onChange: (next: GridSettings) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <Modal
      onClose={props.onClose}
      backdropClass="flex items-start justify-center bg-black/30 p-6 pt-16"
      label={__('Grid display')}
    >
      <ModalPanel size="sm">
        <ModalHeader
          title={__('Grid display')}
          actions={
            <IconButton size="sm" label={__('Close')} onClick={props.onClose}>
              ✕
            </IconButton>
          }
        />
        <div class="p-4">
          <GridDisplaySettingsControls settings={props.settings} onChange={props.onChange} />
        </div>
      </ModalPanel>
    </Modal>
  );
}

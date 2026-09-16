/**
 * WorkbenchGrid — the reusable, operator-facing, subject-centric data grid that mounts on any
 * surface where merchants view + edit merchandise data. It is the pillar component of the InvFlux
 * Central Workbench WP admin page, and it also embeds in the WooCommerce product inventory tab
 * (one product family per mount), future dispatch / procurement grids, and any add-on surface.
 *
 * ## Relationship to DataGrid
 *
 * {@link DataGrid} is the type-blind spreadsheet primitive: it renders/edits/selects rows and owns
 * nothing about *what* a row is or *where* it comes from. WorkbenchGrid is the workbench-shaped host
 * around it — it owns the concerns every workbench surface shares:
 *
 *   - **fetch** — the paged `/workbench/products` query (+ the live-stock subscription token);
 *   - **the value seam** — {@link workbenchValueFor} (column id → row field / taxonomy / extra bag);
 *   - **controlled grid state** — column visibility / order / sizing / sections / sort, persisted in
 *     localStorage under a caller-supplied `storageKeyPrefix` so each surface keeps its own layout;
 *   - **live updates** — a pluggable {@link LiveUpdatesTransport} (default polling), merged into rows;
 *   - **the dirty model + save flow** — staged edits, save-review, on-hand correction cascade.
 *
 * The two mount sites differ only by props: the Central Workbench passes the full-page config (URL
 * sync on, filter bar, all capabilities); the embedded product tab pins `presetParams` to a single
 * product family, turns URL sync off, and hides the filter chrome.
 *
 * ## Build phasing
 *
 * **v0 (this file, current):** fetch + DataGrid mount + column-picker toolbar + Save button shell.
 * Read-only — no cell editing, no dirty model, no live-update merge yet. Proves the
 * fetch → server-column-metadata → DataGrid pipeline end-to-end on a fresh surface.
 *
 * v1 bespoke cell renderers (name/stock/image) · v2 dirty-cell store + save-review · v3 on-hand
 * correction cascade · v4 row + cell selection wiring · v5 live-updates transport + RowPatch merge.
 * The Central Workbench shell is rip-and-replaced onto this once v5 lands.
 */

import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
  untrack,
  type JSX,
} from 'solid-js';
import { Button } from './Button';
import { TableViewIcon, RecordViewIcon, ColumnsSettingsIcon } from './icons';
import { createInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/solid-query';
import type {
  ColumnOrderState,
  SortingState,
  VisibilityState,
  RowSelectionState,
} from '@tanstack/solid-table';
import { __, _n, _x, formatNumber, sprintf } from '@invflux/i18n';
import {
  DataGrid,
  type StagedCell,
  type GridSettings,
  type DataGridComponentRole,
  type DataGridMenuItem,
  type RowAttrs,
} from './grid/DataGrid';
import {
  EMPTY_SELECTION,
  selectionRectsFromCells,
  type SelectionState,
  type CellCoord,
} from './grid/cellSelection';
import { workbenchValueFor, applyRowPatch } from './grid/workbenchValueFor';
import { buildWorkbenchColumns, buildStockColumns } from './grid/workbenchColumns';
import { useHostNav } from './hostNav';
import { applyColumnOverrides, columnOverridesForSave } from './columnLabels';
import { describeConflicts as describeConflictsFor } from './workbenchConflicts';
import { qk } from './api/queryKeys';
import { pollingTransport, type LiveUpdatesTransport } from './liveUpdates';
import { pendingCellKey, useDirtyCells } from './grid/useDirtyCells';
import { mergeRefreshedRows, rowsToRefresh } from './grid/rowRefresh';
import { cascadeAllocate, type SlotDeltas } from './onHandCascade';
import { CorrectionReviewModal } from './CorrectionReviewModal';
import type {
  CorrectionReviewGroup,
  CorrectionReviewRow,
  CorrectionDispositions,
  ReviewNote,
} from './CorrectionReviewModal';
import { BulkEditModal, type BulkEditColumn, type BulkEditResult } from './BulkEditModal';
import { usePortalRootOptional } from './portal';
import {
  applyBatches,
  cellsToClearAfterApply,
  sendConcurrently,
  splitSubmittableRows,
  type SubmittedCell,
} from './grid/applyPartition';
import { IconButton } from './IconButton';
import { Spinner } from './Spinner';
import { toast } from './toast';
import type {
  WorkbenchRow,
  WorkbenchPage,
  WorkbenchHandles,
  WorkbenchApplyConflict,
  WorkbenchApplyRequest,
  WorkbenchApplyResponse,
  RowPatch,
  DirtyRow,
} from './workbenchGridTypes';
import type { GridColumnMeta, TaxonomySpace } from './types';
import type { GridFilterMeta } from './filterBridge';

// ---------------------------------------------------------------------------
// Surface configuration contract
// ---------------------------------------------------------------------------

/** Capability flags the grid honours (paste gating, drill-down writes, …). Superset-safe: a surface
 *  that can't do a thing passes `false` and the corresponding affordance degrades to read-only. */
export interface WorkbenchGridCapabilities {
  viewStock: boolean;
  onhandCorrect: boolean;
  /** Edit WC catalogue data (e.g. grouped-product members via the Type drill-down). */
  editProducts: boolean;
  /**
   * Manage store-wide settings — gates renaming a column in the picker.
   *
   * Optional, defaulting to "no": the surfaces that build this object by hand (the product tab,
   * the PO grids) have no rename affordance to gate, and should not have to assert a capability
   * they never use. Absent therefore means the pen never appears, which is the safe direction.
   */
  manageSettings?: boolean;
}

/** The WordPress bootstrap context every surface hands the grid: REST root + nonce + capabilities. */
export interface WorkbenchGridContext {
  apiRoot: string;
  nonce: string;
  capabilities: WorkbenchGridCapabilities;
  /**
   * How many apply requests a large save may have in flight at once. Absent means the default of 3.
   * The bound protects the host's PHP workers, which the storefront shares, so it is the merchant's
   * setting to raise rather than the grid's.
   */
  applyConcurrency?: number;
}

export interface WorkbenchGridProps {
  /** REST root + nonce + capability flags from the host's page bootstrap. */
  ctx: WorkbenchGridContext;
  /**
   * Namespaces every localStorage key the grid persists (column visibility / order / sizing /
   * sections + the DataGrid display settings). Distinct per surface so the embedded product tab and
   * the Central Workbench keep independent layouts — e.g. `"central-workbench"` vs `"product-tab"`.
   */
  storageKeyPrefix: string;
  /**
   * Path of the paged products endpoint, relative to `{apiRoot}/invflux/v1`. Defaults to the
   * workbench's `/workbench/products`. A surface with a bespoke feed (a dispatch-scoped grid) can
   * point elsewhere as long as the response matches {@link WorkbenchPage}.
   */
  productsEndpoint?: string;
  /**
   * Non-user-editable query params folded into every fetch (and the subscription watched-set upsert).
   * The embedded product tab pins `{ post_ids: "1036", bring_children: "1" }` here so the grid only
   * ever shows one product family; the Central Workbench passes nothing (the filter bar owns the query).
   */
  presetParams?: Record<string, string>;
  /** Rows requested per page (server `per_page`). Default 100. */
  loadSize?: number;
  /** Show the leading row-selection checkbox column. Default true; set false on surfaces with no
   *  bulk row actions (the embedded product tab) to reclaim horizontal space. */
  showRowSelection?: boolean;
  /** Show the "loaded / total" footer counter. Default true; set false on a surface that already
   *  shows the same count in its own chrome (the Central Workbench's readout beside Refresh), where
   *  the footer is redundant and its row is pure vertical cost. */
  showFooterCount?: boolean;
  /** Show the grid's built-in toolbar row (Columns / Record-view / Save). Default true. A host with its
   *  own chrome (the Central Workbench) sets false and drives those from its own bar via the
   *  `openColumnManager` / `toggleLayout` / `openSaveReview` handles + `onDirtyChange` / `onLayoutChange`. */
  showToolbar?: boolean;
  /** Reactive dirty-state mirror, for a host rendering its own Save button. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Reactive busy-state mirror (initial load, a refetch, or a save still sending), for a host
   *  rendering its own Refresh spinner. Pushed rather than pulled because a host's plain handle
   *  binding isn't reactive. */
  onFetchingChange?: (fetching: boolean) => void;
  /** Reactive save-progress mirror, for a host rendering its own progress indicator while a save is
   *  sending. `multiChunk` is true when the save went out as more than one request (so a host can
   *  show progress only for a save large enough to be worth a bar); null once no save is active. */
  onSaveProgressChange?: (
    progress: { done: number; total: number; multiChunk: boolean } | null,
  ) => void;
  /** Reactive layout mirror, for a host rendering its own Record/Table toggle (`canToggle` = small set). */
  onLayoutChange?: (info: { layout: 'grid' | 'record'; canToggle: boolean }) => void;
  /** Column ids visible by default when nothing is stored yet — overrides the server's
   *  `visibleByDefault` for this surface; every other column starts hidden. Stored prefs still win. */
  defaultVisibleColumnIds?: string[];
  /** Surface-level default display settings (density / wrap / text size) applied when nothing is
   *  stored. Stored user prefs still win. */
  defaultGridSettings?: Partial<GridSettings>;
  /** Initial state of the variation-name form: strip the parent product's name prefix from a
   *  variation's name (the common "Parent - Attribute" case) so read mode shows just the
   *  distinguishing part. Edit mode always shows the full name, and so does a variation whose parent
   *  is not in the loaded set. A DEFAULT only — the merchant switches it from the Product column's
   *  header menu, and their choice persists per surface. */
  compactVariationNames?: boolean;
  /**
   * Initial table/record layout. `"auto"` (default) flips to the transposed record view for a small
   * record set (right for the product-tab embed's single family); `"grid"` pins the horizontal table
   * (the Central Workbench wants table by default — record only on the explicit toolbar toggle).
   */
  defaultLayout?: 'auto' | 'grid' | 'record';
  /** Collapse/expand affordance for grouping rows (a variable parent's variations). The host owns the
   *  fold — it drives the displayed row set via {@link transformRows}; this renders the ▸/▾ toggle in
   *  the name cell and calls back on click. `state(row) === "none"` ⇒ no caret for that row. */
  fold?: {
    state: (row: WorkbenchRow) => 'none' | 'collapsed' | 'expanded';
    toggle: (row: WorkbenchRow) => void;
  };
  /**
   * Opt-in live updates. When provided, the grid subscribes a {@link LiveUpdatesTransport} (default:
   * polling at `intervalMs`, typically a plugin-level setting) that delivers {@link RowPatch}es; they
   * merge into rows with **staged-edits-win** (a patch updates the live baseline, but a dirty cell
   * keeps showing its staged value — stock stays correct because its staging is delta-first). Omit
   * for no live updates. Swapping polling → WebSocket/SSE is just a different `transport` here.
   */
  liveUpdates?: {
    /** Transport factory; defaults to {@link pollingTransport} at `intervalMs`. */
    transport?: LiveUpdatesTransport;
    /** Polling cadence (ms) for the default transport — from the plugin-level setting. Default 30000. */
    intervalMs?: number;
    /** Poll endpoint override (relative to `apiRoot`) for the default transport. */
    endpoint?: string;
    /** Gate the transport on/off (e.g. only while stock columns are visible). Default: always on. */
    enabled?: () => boolean;
  };
  /** One-time handoff of the grid's imperative handles to the host (focus, open column manager, …). */
  apiRef?: (api: WorkbenchHandles) => void;
  /** Fired with the selected subject ids whenever the row-checkbox selection changes. Lets a host
   *  (e.g. the Central Workbench chrome) build its own bulk-action bar over the current selection —
   *  the grid stays free of surface-specific actions (worksheets, supplier assign, …). */
  onSelectionChange?: (subjectIds: number[]) => void;
  /** Fired after a save that persisted at least one row (i.e. not every submitted row conflicted),
   *  once the grid has refetched its own data. Lets a host resync state it derives from the same
   *  subjects — e.g. the product tab's inventory-settings form (sku/gtin/threshold are grid-owned;
   *  the form refetches so its hidden WC inputs + save payload reflect the grid's edit). */
  onApplied?: () => void;
  /** Rendered in place of rows while the first page loads / when the result set is empty. */
  fallback?: JSX.Element;
  /** Host-supplied toolbar content rendered on the left, after the layout toggle (before the
   *  right-aligned Columns + Save cluster). The product tab uses it for its icon-sized "manage
   *  variations in workbench" link. */
  toolbarExtra?: JSX.Element;
  /** Host-native product-link `kind`s to omit from the name-cell actions menu (forwarded to the column
   *  factory). The embedded product tab passes `["catalog-edit"]` — it already lives on the WooCommerce
   *  product screen, so "Edit in WooCommerce" there just links back to the current page. */
  suppressProductLinkKinds?: readonly string[];
  /**
   * Reactive extra query params merged into every products fetch (and folded into the query key so a
   * change refetches). Unlike {@link presetParams} (flat, static), this drives the Central Workbench
   * filter bar — it can express multi-value arrays (`taxonomy_x: ["a","b"]` → repeated params) and
   * literal bracket keys (`"fmod[id][key]": "v"`). Scalars are `set`, arrays are `append`ed.
   */
  queryParams?: () => Record<string, string | string[]>;
  /**
   * Controlled sort. When provided the grid renders this sort and reports every change via
   * {@link onSortChange} (so the host can mirror it into the URL); omitted ⇒ the grid owns sort internally.
   */
  sort?: () => SortState;
  /** Fired whenever the sort changes (both controlled and internal modes) — for URL sync / derived state. */
  onSortChange?: (sort: SortState) => void;
  /**
   * Transform the fetched + live-merged rows before render. Lets a host insert a display layer — e.g. the
   * Central Workbench's variable-parent aggregation, collapse/expand fold, and brought-with hiding — while
   * the grid keeps owning fetch + live-merge. Identity when omitted.
   */
  transformRows?: (rows: WorkbenchRow[]) => WorkbenchRow[];
  /** Per-datatype view/edit component choice, forwarded to the DataGrid (plug-in component selection). */
  componentChoiceId?: (dataType: string, role: DataGridComponentRole) => string | undefined;
  /** Per-row `<tr>` attributes — e.g. grey/annotate brought-with context rows (`matched === false`). */
  rowAttrs?: (row: WorkbenchRow) => RowAttrs;
  /** Host-contributed right-click context-menu items, appended after the grid's own Save/Revert (e.g. a
   *  "Bulk actions" submenu scoped to the cell selection). Items may be submenu parents (`children`). */
  contextMenuExtras?: (args: {
    coord: CellCoord;
    row: WorkbenchRow;
    meta: GridColumnMeta;
  }) => DataGridMenuItem[];
  /** Host-contributed items for one COLUMN's header menu, appended after the grid's own (which
   *  already contribute the Product column's variation-name form). Called per column: return `[]`
   *  for every id the host has nothing to say about. */
  headerMenuExtras?: (args: {
    columnId: string;
    meta: GridColumnMeta | undefined;
  }) => DataGridMenuItem[];
  /** Gate the DataGrid "Copy ▸ As JSON" item (a Pro feature); disabled with the hint when it returns false. */
  copyAsJsonAllowed?: () => boolean;
  copyAsJsonUpgradeHint?: string;
  /** Host key handlers appended to the grid's own — `extraKeyHandlers` run before the grid-focus guard
   *  (global: `/`-focus-search, Ctrl+F…), `extraInGridKeyHandlers` after it (in-grid: `*`-fold-selection). */
  extraKeyHandlers?: Array<(e: KeyboardEvent, active: CellCoord | null) => boolean>;
  extraInGridKeyHandlers?: Array<(e: KeyboardEvent, active: CellCoord | null) => boolean>;
  /** Called after a save whose response carried conflicts, with the raw conflict list, so a host can
   *  render its own affordance (e.g. a sticky reject-all toast). The grid also surfaces them inline. */
  onConflicts?: (conflicts: WorkbenchApplyResponse['conflicts']) => void;
  /**
   * Fired reactively with the server metadata that rides the products fetch (filter metas, column metas,
   * taxonomy space) plus the result counts. Lets a host shell drive its filter bar / export / `s/l/t`
   * indicator off the grid's own single fetch — no second query. Fires whenever any of these change.
   */
  onMeta?: (meta: {
    filters: GridFilterMeta[];
    columns: GridColumnMeta[];
    taxonomySpace: TaxonomySpace | undefined;
    total: number;
    loaded: number;
  }) => void;
}

const DEFAULT_LOAD_SIZE = 100;
const DEFAULT_PRODUCTS_ENDPOINT = '/workbench/products';

/**
 * Integer formatter shared by the stock cells (via {@link buildWorkbenchColumns}), in the host's
 * locale.
 *
 * Seven stock-cell renderers call this for every row on screen, so it must not construct an
 * `Intl.NumberFormat` per call (~60us against ~1.3us through an existing instance — roughly 36ms of
 * every paint at 100 rows). `formatNumber` without options reuses one instance per bound locale;
 * pass no options here.
 */
const fmt = (n: number): string => formatNumber(n);

/** Strip a leading parent-name prefix (+ any separator) from a variation's full name for compact
 *  display — "Cool Tee - Blue / L" → "Blue / L". Falls back to the full name when it doesn't start
 *  with the parent name, or when stripping would leave nothing. */
function stripParentPrefix(full: string, parent: string): string {
  if (parent === '' || !full.startsWith(parent)) return full;
  const rest = full.slice(parent.length).replace(/^[\s\-–—,:/|]+/, '');
  return rest === '' ? full : rest;
}

// ---------------------------------------------------------------------------
// Persistence (namespaced by storageKeyPrefix)
// ---------------------------------------------------------------------------

function readJson<T>(key: string, fallback: T, validate: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    return validate(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota / private-mode failures */
  }
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');
const isNumberRecord = (v: unknown): v is Record<string, number> =>
  typeof v === 'object' && v !== null && Object.values(v).every((n) => typeof n === 'number');
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
const isVisibility = (v: unknown): v is VisibilityState =>
  typeof v === 'object' && v !== null && Object.values(v).every((b) => typeof b === 'boolean');

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

interface SortState {
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

function buildProductsUrl(
  ctx: WorkbenchGridContext,
  endpoint: string,
  presetParams: Record<string, string>,
  queryParams: Record<string, string | string[]>,
  sort: SortState,
  loadSize: number,
  page: number,
  subscriptionId: string,
): URL {
  const url = new URL(`${ctx.apiRoot.replace(/\/$/, '')}/invflux/v1${endpoint}`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', String(loadSize));
  url.searchParams.set('sort_by', sort.sortBy);
  url.searchParams.set('sort_dir', sort.sortDir);
  if (subscriptionId !== '') url.searchParams.set('subscription', subscriptionId);
  for (const [key, value] of Object.entries(presetParams)) url.searchParams.set(key, value);
  // Host-driven query (filter bar): scalars set, arrays append (repeated params), bracket keys verbatim.
  for (const [key, value] of Object.entries(queryParams)) {
    if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, item);
    else url.searchParams.set(key, value);
  }
  return url;
}

/** POST JSON to `{apiRoot}/invflux/v1{path}`, surfacing the server's `error`/`message` on failure. */
async function postJson<T>(ctx: WorkbenchGridContext, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${ctx.apiRoot.replace(/\/$/, '')}/invflux/v1${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-WP-Nonce': ctx.nonce,
    },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const error = (await res.json()) as { error?: string; message?: string };
      message = error.error ?? error.message ?? message;
    } catch {
      /* keep status message */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

/** GET JSON from `{apiRoot}/invflux/v1{path}` with optional query params. */
async function getJson<T>(
  ctx: WorkbenchGridContext,
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${ctx.apiRoot.replace(/\/$/, '')}/invflux/v1${path}`);
  if (params !== undefined)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'X-WP-Nonce': ctx.nonce },
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

/** A client-minted subscription id (UUIDv7 ideal; any UUID accepted). Falls back when crypto absent. */
function mintSubscriptionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* secure-context / availability fallback below */
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Editable tri-state stock-management column; its wire enum values (see the server-side column). */
const STOCK_MANAGEMENT_COLUMN_ID = 'stock_management';

/**
 * Governance changes shift who owns a product's stock, so the save-review flags them the way the
 * product tab's confirm modal does: amber when adopting (InvFlux takes over), red when un-governing
 * (InvFlux hands back to WooCommerce / no one). Keyed on the wire enum values.
 */
function governanceReviewNotes(rows: CorrectionReviewRow[]): ReviewNote[] {
  const adoptCount = rows.filter((r) => r.newValue === 'invflux').length;
  const ungovCount = rows.filter((r) => r.newValue === 'external' || r.newValue === 'none').length;
  const notes: ReviewNote[] = [];
  if (adoptCount > 0) {
    notes.push({
      tone: 'warn',
      text: withCount(
        _n(
          "InvFlux will start managing %d product's stock, adopting WooCommerce's current quantity as the starting for-sale amount.",
          "InvFlux will start managing %d products' stock, adopting WooCommerce's current quantity as the starting for-sale amount.",
          adoptCount,
        ),
        adoptCount,
      ),
    });
  }
  if (ungovCount > 0) {
    notes.push({
      tone: 'danger',
      text: withCount(
        _n(
          "InvFlux will stop managing %d product's stock — WooCommerce (or no one) takes over. Recorded stock history is preserved.",
          "InvFlux will stop managing %d products' stock — WooCommerce (or no one) takes over. Recorded stock history is preserved.",
          ungovCount,
        ),
        ungovCount,
      ),
    });
  }
  return notes;
}

/** Render a translated `%d` template with the count in bold weight. */
function withCount(template: string, count: number): JSX.Element {
  const [before, after = ''] = template.split('%d');
  return (
    <>
      {before}
      <strong>{count}</strong>
      {after}
    </>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WorkbenchGrid(props: WorkbenchGridProps): JSX.Element {
  const loadSize = (): number => props.loadSize ?? DEFAULT_LOAD_SIZE;
  const endpoint = (): string => props.productsEndpoint ?? DEFAULT_PRODUCTS_ENDPOINT;
  const presetParams = (): Record<string, string> => props.presetParams ?? {};
  const queryParams = (): Record<string, string | string[]> => props.queryParams?.() ?? {};
  // Optional shared portal root — when the host provides a PortalCtx (an embedded surface in a
  // shadow root under transformed ancestors), the grid's modals portal to it so `position: fixed`
  // stays viewport-relative. Full-page hosts provide none → modals render in place, unchanged.
  const portalRoot = usePortalRootOptional();

  // One subscription token per mount — threaded through every fetch (server maintains the watched-set
  // against it) and, from v5, through the live-updates transport. Minted once, stable for the mount.
  const subscriptionId = mintSubscriptionId();

  // localStorage keys, namespaced by the surface prefix.
  const key = (suffix: string): string =>
    `invflux:workbench-grid:${props.storageKeyPrefix}:${suffix}`;

  // ── Sort (server-driven). Controlled when `props.sort` is provided (the host owns it, e.g. for URL
  // sync); otherwise internal. Either way every change is reported via `onSortChange`. ──
  const [internalSort, setInternalSort] = createSignal<SortState>(
    props.sort?.() ?? { sortBy: 'name', sortDir: 'asc' },
  );
  const sort = (): SortState => props.sort?.() ?? internalSort();
  const setSort = (next: SortState): void => {
    setInternalSort(next);
    props.onSortChange?.(next);
  };
  const tableSorting = (): SortingState => [{ id: sort().sortBy, desc: sort().sortDir === 'desc' }];

  // ── Controlled DataGrid state (persisted per surface) ──
  const [columnVisibility, setColumnVisibility] = createSignal<VisibilityState>(
    readJson(key('cols'), {}, isVisibility),
  );
  const [columnOrder, setColumnOrder] = createSignal<ColumnOrderState>(
    readJson(key('col_order'), [], isStringArray),
  );
  const [columnSizing, setColumnSizing] = createSignal<Record<string, number>>(
    readJson(key('col_sizing'), {}, isNumberRecord),
  );
  const [expandedColSections, setExpandedColSections] = createSignal<string[]>(
    readJson(key('col_sections'), [], isStringArray),
  );
  // Variation names: full `Parent - Attribute` or just the distinguishing part. The prop is the
  // surface's DEFAULT (the product tab embeds one family, where the parent's name on every row is
  // pure noise); a merchant's own choice from the Product column's header menu overrides it and
  // persists, the same way stored visibility beats `defaultVisibleColumnIds`.
  const [compactVariations, setCompactVariations] = createSignal<boolean>(
    // Read once, at mount, like every other seed above it: this is the initial value of a signal the
    // merchant then owns, so tracking the prop would let a re-render overwrite their choice.
    // eslint-disable-next-line solid/reactivity -- one-shot seed for a user-owned signal.
    readJson(key('varnames_compact'), props.compactVariationNames ?? false, isBoolean),
  );
  const [rowSelection, setRowSelection] = createSignal<RowSelectionState>({});
  const [cellSelection, setCellSelection] = createSignal<SelectionState>(EMPTY_SELECTION);

  createEffect(() => writeJson(key('varnames_compact'), compactVariations()));
  createEffect(() => writeJson(key('cols'), columnVisibility()));
  createEffect(() => writeJson(key('col_order'), columnOrder()));
  createEffect(() => writeJson(key('col_sizing'), columnSizing()));
  createEffect(() => writeJson(key('col_sections'), expandedColSections()));

  // ── Fetch: infinite query over the paged products endpoint ──
  const queryClient = useQueryClient();
  /** The products query's cache key for the current view — shared by the query and by in-place merges. */
  const gridQueryKey = (): ReturnType<typeof qk.workbench.grid> =>
    qk.workbench.grid(
      props.ctx.apiRoot,
      endpoint(),
      presetParams(),
      queryParams(),
      sort(),
      loadSize(),
    );
  const query = createInfiniteQuery<WorkbenchPage>(() => ({
    queryKey: gridQueryKey(),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const url = buildProductsUrl(
        props.ctx,
        endpoint(),
        presetParams(),
        queryParams(),
        sort(),
        loadSize(),
        pageParam as number,
        subscriptionId,
      );
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'X-WP-Nonce': props.ctx.nonce },
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return (await res.json()) as WorkbenchPage;
    },
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.products.length, 0);
      return loaded < lastPage.total ? allPages.length + 1 : undefined;
    },
  }));

  // Live-update overlay: subjectId → latest patched fields (keyed by column id). Folded onto the
  // query-cache rows in `rows()` so live stock (and future audit) deltas surface without mutating the
  // cache. Absolute values (not deltas), so a fresh full refetch supersedes them — cleared on refetch.
  const [livePatches, setLivePatches] = createSignal<Map<number, Record<string, unknown>>>(
    new Map(),
  );

  /** Merge received patches into the overlay (latest value wins per field). `[]` is a legal no-op tick. */
  function applyPatches(patches: RowPatch[]): void {
    if (patches.length === 0) return;
    setLivePatches((prev) => {
      const next = new Map(prev);
      for (const p of patches)
        next.set(p.subject_id, { ...(next.get(p.subject_id) ?? {}), ...p.fields });
      return next;
    });
  }

  const rows = createMemo<WorkbenchRow[]>(() => {
    const data = query.data as InfiniteData<WorkbenchPage> | undefined;
    if (!data) return [];
    const base = data.pages.flatMap((p) => p.products);
    const overlay = livePatches();
    const merged =
      overlay.size === 0
        ? base
        : base.map((row) => {
            const patch = overlay.get(row.subjectId);
            return patch ? applyRowPatch(row, patch) : row;
          });
    // Host display layer (variable-parent aggregation / collapse / brought-with hiding) sits between
    // fetch+live-merge and render; identity when the host provides none.
    return props.transformRows ? props.transformRows(merged) : merged;
  });

  /** Refetch the products query and drop the live overlay (the fresh base is now authoritative). */
  async function refetchAndResetLive(): Promise<void> {
    await query.refetch();
    setLivePatches(new Map());
  }

  /**
   * Ids per by-id read-back request. Each request costs about a second whatever it carries (the list
   * query's fixed work), so fewer, bigger requests win: 500 six-digit ids is ~3.5 KB of URL, well
   * inside a web server's usual 8 KB request-line limit.
   */
  const REFRESH_IDS_PER_REQUEST = 500;

  /**
   * Re-read just the rows a save touched and merge them into the loaded pages in place — never a
   * reload of every loaded page, whose cost (the list query's catalogue-wide work, then every row
   * again over the wire) has nothing to do with what was saved. Which rows: see `rowsToRefresh`.
   *
   * Read by id with the page's filters and the host's preset left out: a saved row that no longer
   * matches the filter is still brought up to date where it sits (it moves or drops out on the next
   * full load), and the product tab's `post_ids` preset would otherwise drop the variations it shows
   * as brought-with context. No subscription is sent, so the live-updates watched set is untouched.
   * The re-read rows' overlay entries go too — the fresh rows are authoritative for them.
   *
   * Any failure falls back to the full reload: slower, never less correct.
   */
  async function refreshRows(saved: readonly number[], inFlight: number): Promise<void> {
    const data = query.data as InfiniteData<WorkbenchPage> | undefined;
    const ids = rowsToRefresh(saved, data?.pages.flatMap((page) => page.products) ?? []);
    if (ids.length === 0) return;
    const wanted = new Set(ids);
    const fresh = new Map<number, WorkbenchRow>();
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += REFRESH_IDS_PER_REQUEST)
      chunks.push(ids.slice(i, i + REFRESH_IDS_PER_REQUEST));
    try {
      // Side by side under the same bound as the save: a large save's read-back is several
      // requests, and one at a time they would add up to more than the reload this replaces.
      await sendConcurrently(chunks, inFlight, async (chunk) => {
        const url = buildProductsUrl(
          props.ctx,
          endpoint(),
          {},
          { subject_ids: chunk.join('-'), bring_parents: '0' },
          sort(),
          chunk.length,
          1,
          '',
        );
        const res = await fetch(url, {
          headers: { Accept: 'application/json', 'X-WP-Nonce': props.ctx.nonce },
          credentials: 'same-origin',
        });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const page = (await res.json()) as WorkbenchPage;
        for (const row of page.products)
          if (wanted.has(row.subjectId)) fresh.set(row.subjectId, row);
      });
    } catch {
      await refetchAndResetLive();
      return;
    }
    queryClient.setQueryData<InfiniteData<WorkbenchPage>>(gridQueryKey(), (prev) =>
      undefined === prev ? prev : { ...prev, pages: mergeRefreshedRows(prev.pages, fresh) },
    );
    setLivePatches((prev) => {
      if (![...fresh.keys()].some((id) => prev.has(id))) return prev;
      const next = new Map(prev);
      for (const id of fresh.keys()) next.delete(id);
      return next;
    });
  }

  // Live-updates transport (opt-in). Instantiated once; the returned cleanup fires on unmount. The
  // default polling transport reads the subscription token the fetch layer already threads to the
  // server, so it asks only "diffs since cursor X for subscription Y" — no watched-set in the URL.
  if (props.liveUpdates) {
    const lu = props.liveUpdates;
    const transport =
      lu.transport ??
      pollingTransport({ intervalMs: lu.intervalMs ?? 30_000, endpoint: lu.endpoint });
    onCleanup(
      transport({
        apiRoot: props.ctx.apiRoot,
        nonce: props.ctx.nonce,
        subscriptionId: () => subscriptionId,
        enabled: lu.enabled ?? (() => true),
        onUpdate: applyPatches,
        onError: () => {},
      }),
    );
  }

  // Column / taxonomy metadata arrives with the first page. Keep the last non-empty value stable so a
  // background refetch never blanks the columns mid-render (matches the workbench's stable* signals).
  const [stableColumns, setStableColumns] = createSignal<GridColumnMeta[]>([]);
  const [stableTaxonomySpace, setStableTaxonomySpace] = createSignal<TaxonomySpace | undefined>();
  const [stableFilters, setStableFilters] = createSignal<GridFilterMeta[]>([]);
  // Column-manager section titles, keyed by group — server-provided vocabulary (see WorkbenchPage).
  const [stableGroupLabels, setStableGroupLabels] = createSignal<Record<string, string>>({});
  createEffect(() => {
    const data = query.data as InfiniteData<WorkbenchPage> | undefined;
    const first = data?.pages[0];
    if (first?.columns && first.columns.length > 0) setStableColumns(first.columns);
    if (first?.taxonomySpace) setStableTaxonomySpace(first.taxonomySpace);
    if (first?.filters) setStableFilters(first.filters);
    if (first?.columnGroups && first.columnGroups.length > 0) {
      setStableGroupLabels(Object.fromEntries(first.columnGroups.map((g) => [g.key, g.label])));
    }
  });

  const loadedCount = (): number => rows().length;
  const totalCount = (): number => {
    const data = query.data as InfiniteData<WorkbenchPage> | undefined;
    return data?.pages[0]?.total ?? 0;
  };

  // Surface server metadata + counts to a host shell (filter bar, export, s/l/t indicator) — reactively,
  // off the grid's single fetch, so the shell never issues a duplicate products query.
  createEffect(() => {
    props.onMeta?.({
      filters: stableFilters(),
      columns: stableColumns(),
      taxonomySpace: stableTaxonomySpace(),
      total: totalCount(),
      loaded: loadedCount(),
    });
  });

  // Column metadata indexed by id (drives edit guards, clear-family, save-review ordering).
  const columnMetaById = createMemo(() => new Map(stableColumns().map((c) => [c.id, c])));

  // Surface default column visibility: when this surface names a default-visible set AND the user has
  // no stored preference yet, seed an EXPLICIT visibility map once the server columns arrive (every id
  // set true/false) — this supersedes the DataGrid's `visibleByDefault` seeding (which only fills ids
  // not already present). Structural trailing columns (orders/ledger) are included so the whitelist is
  // exhaustive; the `select` checkbox can't be hidden.
  const hadStoredVisibility = (() => {
    try {
      return localStorage.getItem(key('cols')) !== null;
    } catch {
      return false;
    }
  })();
  let appliedDefaultVisibility = false;
  createEffect(() => {
    const cols = stableColumns();
    const whitelist = props.defaultVisibleColumnIds;
    if (
      appliedDefaultVisibility ||
      hadStoredVisibility ||
      whitelist === undefined ||
      cols.length === 0
    )
      return;
    const visible = new Set(whitelist);
    const next: VisibilityState = {};
    for (const id of [...cols.map((c) => c.id), 'orders']) next[id] = visible.has(id);
    setColumnVisibility(next);
    appliedDefaultVisibility = true;
  });

  // Parent product name by wcProductId — feeds the variation-name compaction (strip the parent prefix
  // in read mode). Only variable parents contribute a name, which is also what keeps the compaction
  // honest: a variation whose parent is NOT in the loaded set finds no entry and falls back to its
  // full name, so an orphan row never loses the only context that identifies it. That is a structural
  // guarantee, not a check to remember — nothing here has to ask whether the parent is on screen.
  const parentNameByProductId = createMemo(() => {
    const map = new Map<number, string>();
    for (const r of rows()) if (r.wcVariationId === null) map.set(r.wcProductId, r.name);
    return map;
  });
  const displayName = (row: WorkbenchRow, full: string): string => {
    if (!compactVariations() || row.wcVariationId === null) return full;
    const parent = parentNameByProductId().get(row.wcProductId);
    return parent ? stripParentPrefix(full, parent) : full;
  };

  /**
   * Persist a merchant-authored name for one column, or clear it with an empty string.
   *
   * **Sends every override in force, not just the edited one.** The endpoint replaces the whole map
   * for the caller's locale — it is a put, not a patch — so a body carrying one entry would clear
   * every other rename in the store. The set is rebuilt here from the columns themselves, where a
   * rename is exactly `label !== defaultLabel`.
   *
   * The response carries the map the server actually stored, and the labels are recomputed from
   * that rather than from the text that was typed. The server owns the normalisation — trimming,
   * dropping a blank, dropping one equal to the shipped name — and re-deriving it here would be a
   * second copy of those rules, drifting the moment either side changed.
   */
  async function renameColumn(columnId: string, label: string): Promise<void> {
    const res = await postJson<{ labels?: Record<string, string> }>(
      props.ctx,
      '/workbench/settings/column-labels',
      columnOverridesForSave(stableColumns(), { columnId, label }),
    );
    setStableColumns((prev) => applyColumnOverrides(prev, res.labels ?? {}));
  }

  /** Reset column visibility / order / sizing to this surface's defaults (the "Reset to default"
   *  button in the column manager). Visibility → the surface whitelist (or empty, letting the grid
   *  re-seed from the server's `visibleByDefault`); order + sizing → cleared. */
  function resetColumns(): void {
    const whitelist = props.defaultVisibleColumnIds;
    if (whitelist) {
      const visible = new Set(whitelist);
      const next: VisibilityState = {};
      for (const id of [...stableColumns().map((c) => c.id), 'orders']) next[id] = visible.has(id);
      setColumnVisibility(next);
    } else {
      setColumnVisibility({});
    }
    setColumnOrder([]);
    setColumnSizing({});
  }

  // ── Dirty model (staged edits) ──
  const hostNav = useHostNav();
  const dirty = useDirtyCells();
  // Warn before navigating away with unsaved staged edits — the grid owns the dirty model, so the
  // guard lives here (every mount surface inherits it) rather than in each host shell.
  const beforeUnloadGuard = (e: BeforeUnloadEvent): void => {
    // Staged edits OR a submission still outstanding. The second is not covered by the first: an
    // apply lives in this browser, so closing the tab abandons whatever has not been answered yet
    // and leaves the store partially updated with no record of what was intended — and a submitted
    // row is precisely the one whose staged edit is about to be dropped.
    if (dirty.isDirty() || dirty.hasPending()) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', beforeUnloadGuard);
  onCleanup(() => window.removeEventListener('beforeunload', beforeUnloadGuard));
  const [saveError, setSaveError] = createSignal<string | null>(null);

  // ── Save status (the strip under the grid) ──
  // What the operator sees of an apply once the review has closed: progress while its requests go
  // out, then how it ended. It replaces the toasts a save used to raise, and it never re-opens the
  // review by itself — an unbidden dialog would re-block the grid at the moment the operator has
  // moved on. Submissions that overlap share one strip, which reports their combined rows.
  interface ApplyStatus {
    /** Submissions still sending; the strip shows progress while this is above zero. */
    active: number;
    /** Rows sent so far, against the rows the strip covers. */
    done: number;
    total: number;
    saved: number;
    /** Rows refused (a conflict) or never answered (a failed request). Still staged, retryable. */
    notSaved: number;
    /** What went wrong, when something did. */
    detail: string | null;
    /** True once any submission covered by this strip went out as more than one request — lets a host
     *  show a progress bar only for a save big enough to warrant one. Sticky while the strip is up. */
    multiChunk: boolean;
  }
  /** How long a result with nothing left to act on stays up; one with unsaved rows stays until dismissed. */
  const APPLY_STATUS_FADE_MS = 4000;
  const [applyStatus, setApplyStatus] = createSignal<ApplyStatus | null>(null);
  let applyStatusFade: number | undefined;
  onCleanup(() => clearTimeout(applyStatusFade));
  const beginApplyStatus = (rows: number, multiChunk: boolean): void => {
    clearTimeout(applyStatusFade);
    setApplyStatus((s) =>
      s !== null && s.active > 0
        ? // Overlapping submissions merge; OR the flag so a small save started during a big one
          // never hides the big one's bar.
          {
            ...s,
            active: s.active + 1,
            total: s.total + rows,
            multiChunk: s.multiChunk || multiChunk,
          }
        : { active: 1, done: 0, total: rows, saved: 0, notSaved: 0, detail: null, multiChunk },
    );
  };
  const advanceApplyStatus = (rows: number): void => {
    setApplyStatus((s) => (s === null ? s : { ...s, done: s.done + rows }));
  };
  const endApplyStatus = (saved: number, notSaved: number, detail: string | null): void => {
    const next = ((s): ApplyStatus | null =>
      s === null
        ? null
        : {
            ...s,
            active: s.active - 1,
            saved: s.saved + saved,
            notSaved: s.notSaved + notSaved,
            detail: s.detail ?? detail,
          })(applyStatus());
    setApplyStatus(next);
    if (next !== null && next.active === 0 && next.notSaved === 0 && next.detail === null) {
      applyStatusFade = window.setTimeout(() => setApplyStatus(null), APPLY_STATUS_FADE_MS);
    }
  };
  const [showReviewModal, setShowReviewModal] = createSignal(false);
  // Per-subject save conflict: the live on-hand total moved under a staged correction. Keyed by
  // subjectId; drives the Total cell's red ring + tooltip. Cleared when the cell is re-staged.
  const [conflicts, setConflicts] = createSignal<Map<number, { expected: number; actual: number }>>(
    new Map(),
  );

  /** Server-resolved editability (`meta.editable` is resolved per column + current user) + the per-row
   *  read-only overrides + the two on-hand `total` guards (aggregate parent, unmanaged). */
  function canEdit(row: WorkbenchRow, meta: GridColumnMeta): boolean {
    if (!meta.editable) return false;
    if (row.readOnlyColumns?.includes(meta.id)) return false;
    const isVariableParent = row.productType === 'variable' && row.wcVariationId === null;
    if (meta.id === 'total') {
      // A variable parent's Total is an aggregate of its variations — correct the variations instead.
      if (isVariableParent) return false;
      // Unmanaged subjects have no InvFlux slots — enable stock management to correct the on-hand total.
      if (row.stockManaged === false) return false;
    }
    // A variable parent has no price/cost of its own — those live on each variation (and WC ignores a
    // parent price). `reorder_threshold` stays editable: it's the variations' default. Slot columns are
    // already covered by the `total` guard above.
    if (
      isVariableParent &&
      (meta.id === 'price' || meta.id === 'sale_price' || meta.id === 'wac')
    ) {
      return false;
    }
    return true;
  }

  /** The value a cell displays / the editor opens on: the staged edit when present, plus the
   *  optimistic `pending` flag that locks a submitted cell through the in-flight + refetch window.
   *  Stock is delta-first: the staged `total` value re-bases the FROZEN delta over the LIVE baseline,
   *  so re-editing a staged total under a background stock-sync stays correct. */
  function getStagedValue(row: WorkbenchRow, columnId: string): StagedCell {
    const pending = dirty.isPending(row.subjectId, columnId);
    const edit = dirty.edit(row.subjectId, columnId);
    if (edit === undefined) return { staged: false, value: undefined, pending };
    if (columnId === 'total' && typeof edit.new === 'number' && typeof edit.original === 'number') {
      return { staged: true, value: row.total + (edit.new - edit.original), pending };
    }
    return { staged: true, value: edit.new, pending };
  }

  // ── On-hand correction cascade (drives the stock cells + the review modal's onHand base) ──
  /** The staged on-hand correction allocated across slots (mirrors the PHP OnHandCascade). Null when
   *  the row has no staged `total` edit. The frozen delta is cascaded over the LIVE breakdown. */
  function stagedTotalCascade(row: WorkbenchRow): SlotDeltas | null {
    const edit = dirty.edit(row.subjectId, 'total');
    if (!edit || typeof edit.new !== 'number' || typeof edit.original !== 'number') return null;
    const delta = edit.new - edit.original;
    if (delta === 0) return null;
    return cascadeAllocate(delta, row.atp, row.res, row.ctd, row.stockDeficitQty ?? 0);
  }

  /** The frozen `total` delta (staged new − original), 0 when none. */
  function totalDelta(row: WorkbenchRow): number {
    const edit = dirty.edit(row.subjectId, 'total');
    return edit && typeof edit.new === 'number' && typeof edit.original === 'number'
      ? edit.new - edit.original
      : 0;
  }

  const conflictFor = (row: WorkbenchRow): { expected: number; actual: number } | undefined =>
    conflicts().get(row.subjectId);

  // ── Inheritance: a variation cell may resolve / clear against its parent product ──
  /** The persisted value the editor compares against. An inheriting variation cell for a column with
   *  an inherit sentinel (tax_class → 'parent') logically holds that sentinel, even though the display
   *  shows the parent's resolved value — so re-selecting "Same as parent" isn't staged as a no-op. */
  function persistedEditorValue(row: WorkbenchRow, meta: GridColumnMeta): unknown {
    const inheritValue = meta.editorConfig.inheritValue;
    if (inheritValue !== undefined && (row.inherited?.includes(meta.id) ?? false))
      return inheritValue;
    return workbenchValueFor(row, meta.id);
  }

  const isInherited = (row: WorkbenchRow, columnId: string): boolean =>
    row.inherited?.includes(columnId) ?? false;

  const isGenericColumnInherited = (row: WorkbenchRow, meta: GridColumnMeta): boolean =>
    meta.dataType === 'term-picker:wc-taxonomy' && row.wcVariationId !== null;

  /** The value a "clear" (Del / Cut / paste-empty) stages, by datatype. `ok:false` = not clearable.
   *  Reason-gated columns (the on-hand `total`) are never cleared this way. */
  function clearedValueFor(meta: GridColumnMeta): { ok: boolean; value: unknown } {
    if (meta.bulkSaveReason !== null) return { ok: false, value: null };
    if (meta.editorConfig.clearValue !== undefined)
      return { ok: true, value: meta.editorConfig.clearValue };
    const dt = meta.dataType;
    if (dt === 'bool') return { ok: true, value: false };
    if (dt.startsWith('number')) return { ok: true, value: null };
    if (dt.startsWith('decimal')) return { ok: true, value: '' };
    if (dt === 'text') return { ok: true, value: '' };
    if (dt === 'term-picker:wc-taxonomy') return { ok: true, value: [] };
    if (dt === 'enum') {
      // Clearable only when "" is a real option (tax_class "Standard"); tax_status has no empty.
      const options = Array.isArray(meta.editorConfig.options) ? meta.editorConfig.options : [];
      const hasEmpty = options.some(
        (o) => o !== null && typeof o === 'object' && (o as { value?: unknown }).value === '',
      );
      return hasEmpty ? { ok: true, value: '' } : { ok: false, value: null };
    }
    return { ok: false, value: null };
  }

  /** Row-aware cleared value: a variation cell for an inheritable column clears to "inherit". */
  function clearedValueForRow(
    meta: GridColumnMeta,
    row: WorkbenchRow,
  ): { ok: boolean; value: unknown } {
    const inheritValue = meta.editorConfig.inheritValue;
    if (row.wcVariationId !== null && inheritValue !== undefined)
      return { ok: true, value: inheritValue };
    return clearedValueFor(meta);
  }

  /** On a variation, prepend an "inherit from parent" option to an inheritable enum so it's re-selectable. */
  function editorMetaForRow(meta: GridColumnMeta, row: WorkbenchRow): GridColumnMeta {
    const inheritValue = meta.editorConfig.inheritValue;
    if (row.wcVariationId === null || inheritValue === undefined || meta.dataType !== 'enum')
      return meta;
    const options = Array.isArray(meta.editorConfig.options) ? meta.editorConfig.options : [];
    if (
      options.some(
        (o) =>
          o !== null && typeof o === 'object' && (o as { value?: unknown }).value === inheritValue,
      )
    ) {
      return meta;
    }
    const inheritLabel =
      typeof meta.editorConfig.inheritLabel === 'string'
        ? meta.editorConfig.inheritLabel
        : __('Same as parent');
    return {
      ...meta,
      editorConfig: {
        ...meta.editorConfig,
        options: [{ value: inheritValue, label: inheritLabel }, ...options],
      },
    };
  }

  /** Treat null / undefined / "" (and empty arrays) as one "empty" so a clear on an already-empty
   *  cell is a no-op, not a phantom null→"" edit. */
  function clearEquivalent(a: unknown, b: unknown): boolean {
    const empty = (v: unknown): boolean => v === null || v === undefined || v === '';
    if (empty(a) && empty(b)) return true;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === 0 && b.length === 0;
    return a === b;
  }

  /** Stage a clear for one cell, pruning no-ops (already-cleared → nothing; back-to-persisted → revert). */
  function stageClear(row: WorkbenchRow, columnId: string, cleared: unknown): void {
    const inheriting = row.inherited?.includes(columnId) ?? false;
    const persisted = inheriting ? cleared : workbenchValueFor(row, columnId);
    const staged = dirty.edit(row.subjectId, columnId);
    const current = staged ? staged.new : persisted;
    if (clearEquivalent(current, cleared)) return;
    const newVal = clearEquivalent(persisted, cleared) ? persisted : cleared;
    dirty.patch(row.subjectId, columnId, persisted, newVal, row.name, row.sku);
  }

  function onClearCells(cells: Array<{ row: WorkbenchRow; columnId: string }>): void {
    for (const { row, columnId } of cells) {
      const meta = columnMetaById().get(columnId);
      if (!meta) continue;
      const cleared = clearedValueForRow(meta, row);
      if (!cleared.ok) continue;
      stageClear(row, columnId, cleared.value);
    }
  }

  // ── Save-review + apply ──
  // Column display order, read from the DataGrid api once mounted — orders the review-modal sections.
  let apiSelectableColumnIds: () => string[] = () => [];

  // A staged `wac` (cost) edit that seeds a real, non-negative basis (not a clear / not garbage).
  const stagesValidCost = (staged: unknown): boolean =>
    staged != null && staged !== '' && Number.isFinite(Number(staged)) && Number(staged) >= 0;

  /**
   * Subjects with at least one staged cell that is NOT already in flight — the rows a review would
   * actually be about. A row whose every dirty cell is pending has nothing new to confirm.
   */
  const reviewableSubjectIds = (): number[] => {
    const out: number[] = [];
    for (const [subjectId, row] of dirty.dirtyCells()) {
      for (const columnId of row.cells.keys()) {
        if (!dirty.isPending(subjectId, columnId)) {
          out.push(subjectId);
          break;
        }
      }
    }

    return out;
  };

  const reviewGroups = createMemo<CorrectionReviewGroup[]>(() => {
    const byColumn = new Map<string, CorrectionReviewGroup['rows']>();
    const rowById = new Map(rows().map((r) => [r.subjectId, r]));
    for (const [subjectId, row] of dirty.dirtyCells()) {
      for (const [columnId, edit] of row.cells) {
        // A cell with a request outstanding is IN FLIGHT, not awaiting review. It stays in the dirty
        // model until the server answers (that is what re-bases it on a conflict), but listing it as
        // a change to apply would ask the operator to confirm something already sent.
        if (dirty.isPending(subjectId, columnId)) continue;
        const list = byColumn.get(columnId) ?? [];
        if (
          columnId === 'total' &&
          typeof edit.new === 'number' &&
          typeof edit.original === 'number'
        ) {
          // On-hand is delta-first: show the FROZEN delta over the LIVE baseline (old = current total,
          // new = current + delta) so the review agrees with the grid even after a background sync, and
          // carry the live per-slot base + deficit so the modal computes its own cascade + warnings.
          const delta = edit.new - edit.original;
          const live = rowById.get(subjectId);
          const liveTotal = live?.total ?? edit.original;
          const onHand = live
            ? { atp: live.atp, res: live.res, ctd: live.ctd, deficit: live.stockDeficitQty ?? 0 }
            : undefined;
          list.push({
            subjectId,
            name: row.name,
            sku: row.sku,
            oldValue: liveTotal,
            newValue: liveTotal + delta,
            delta,
            onHand,
            // Effective cost basis (wac = weighted_avg_cost ?? seed_cost); null → uncosted, drives
            // the A3.5 warn-on-inventory-in nudge. Only meaningful when the live row is present.
            // A cost seeded in THIS SAME save (a staged `wac` edit) counts too: the server applies
            // the seed before the stock movement, so the added units WILL be valued — don't nudge to
            // "seed the cost first" when the operator is already doing exactly that in one operation.
            hasCostBasis: live
              ? live.wac != null || stagesValidCost(row.cells.get('wac')?.new)
              : undefined,
          });
        } else {
          list.push({
            subjectId,
            name: row.name,
            sku: row.sku,
            oldValue: edit.original,
            newValue: edit.new,
          });
        }
        byColumn.set(columnId, list);
      }
    }
    const metaById = columnMetaById();
    const order = apiSelectableColumnIds();
    return [...byColumn.entries()]
      .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([columnId, groupRows]) => ({
        columnId,
        meta: metaById.get(columnId),
        rows: groupRows,
      }));
  });

  // Governance advisories for the save-review banner: computed from the staged stock-management group,
  // shown always (below the tabs), independent of the Per-SKU / Per-field view.
  const governanceNotes = createMemo<ReviewNote[]>(() => {
    const group = reviewGroups().find((g) => g.columnId === STOCK_MANAGEMENT_COLUMN_ID);
    return group ? governanceReviewNotes(group.rows) : [];
  });

  function openSaveReview(): void {
    setSaveError(null);
    if (!dirty.isDirty()) return;
    // Everything staged is already in flight — there is nothing new to confirm, so opening an empty
    // review would be the dialog asking about work the operator has already sent.
    const reviewable = reviewableSubjectIds();
    if (reviewable.length === 0) return;
    // Refuse only where the overlap is real: a row that has a save outstanding AND fresh edits on
    // top of it. Two different rows saving and being edited at once endanger nothing — they share
    // no baseline — so blocking those would be a rule paid for by every operator to protect a case
    // that does not exist.
    //
    // The dangerous one is same-row: a row's edits are submitted together, so re-reviewing a row
    // whose previous save has not been confirmed stages new intent over a baseline the server has
    // not agreed to. The copy names the situation and the remedy; "the review is unavailable" would
    // say the dialog is broken, when what is blocked is the save.
    const { held } = splitSubmittableRows(reviewable, dirty.isRowPending);
    if (held.length > 0) {
      toast.error(
        sprintf(
          /* translators: %d: number of rows whose previous save has not finished yet */
          _n(
            '%d row is still saving. Wait for it to finish, then review your changes.',
            '%d rows are still saving. Wait for them to finish, then review your changes.',
            held.length,
          ),
          held.length,
        ),
      );
      return;
    }
    setShowReviewModal(true);
  }

  // Ctrl/Cmd+S opens the save-review from anywhere the grid is mounted (tried before the grid-focus
  // guard). Ctrl/Cmd+Enter does the same from within the grid (after the focus/edit guards).
  const saveKeyHandler = (e: KeyboardEvent): boolean => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      if (dirty.isDirty()) openSaveReview();
      return true;
    }
    return false;
  };
  const inGridSaveKeyHandler = (e: KeyboardEvent): boolean => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (dirty.isDirty()) openSaveReview();
      return true;
    }
    return false;
  };
  // Backspace reverts the selected cells' staged edits back to pristine (Delete, by contrast, stages
  // a clear-to-empty — a DataGrid built-in). Runs before the grid's own key branches.
  const backspaceRevertHandler = (e: KeyboardEvent): boolean => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      revertSelection();
      return true;
    }
    return false;
  };

  /**
   * Close the save-review modal and hand keyboard control back to the grid.
   *
   * Every close goes through here. It used to be per-call-site, and the successful-save path was
   * the one that forgot: cancel and discard restored focus, saving left it on a button that no
   * longer existed, so cell navigation was dead until the operator clicked a cell. A modal that
   * took focus owes it back on *every* exit, not on the exits someone remembered.
   *
   * `queueMicrotask`, not a direct call: the panel is still mounted when this runs, and its own
   * teardown would immediately undo a focus moved now.
   */
  function closeSaveReview(): void {
    setShowReviewModal(false);
    queueMicrotask(() => apiFocusGrid());
  }

  function discardAll(): void {
    dirty.discardAll();
    setConflicts(new Map());
    setSaveError(null);
    closeSaveReview();
  }

  /** Human summary of a save's conflicts — see `workbenchConflicts.ts` for why each refusal code
   *  gets its own message rather than a shared "review and retry". */
  function describeConflicts(conflicts: WorkbenchApplyResponse['conflicts']): string {
    const metaById = columnMetaById();
    return describeConflictsFor(conflicts, (columnId) => metaById.get(columnId)?.label ?? columnId);
  }

  /**
   * Rows per request for the retry-safe part of an apply (rows that are not retry-safe go together),
   * by how many requests run at once. One at a time, bigger chunks win: each request boots
   * WordPress, so fewer of them is faster. Side by side, smaller chunks win: they fill the slots
   * evenly instead of leaving the last wave half empty, and each request is half as long — less work
   * lost if one fails, further from a host's execution timeout, and spinners that clear sooner.
   */
  const APPLY_CHUNK_ROWS_ONE_AT_A_TIME = 100;
  const APPLY_CHUNK_ROWS_SIDE_BY_SIDE = 50;
  /** Requests in flight when the host sets no bound: the "Balanced" level of the merchant's setting. */
  const APPLY_CONCURRENCY = 3;
  /** Gap between the opening requests of a save, so they do not reach the host in one burst. */
  const APPLY_STAGGER_MS = 200;

  /** Serialise the dirty cells into the generic apply shape, send it as the requests `applyBatches`
   *  plans, then reconcile once: refetch so applied cells' baseline becomes the new value, drop the
   *  cells that were accepted, keep refused and unanswered rows staged so the operator can retry.
   *  On-hand `total` edits carry a SIGN-AWARE disposition (negative delta → a "decreases"
   *  disposition, positive → "increases"); discovery context rides every request of the batch. */
  async function commitSave(reason: string, dispositions: CorrectionDispositions): Promise<void> {
    setSaveError(null);

    // Rows with a request already outstanding are REFUSED, never re-sent. This is the re-entrancy
    // guard — per row rather than per grid — and it is a correctness boundary, not politeness:
    // `TotalAdjustHandler` derives a stock movement from `original`, so re-submitting a row whose
    // baseline the server has not confirmed writes the wrong movement silently. It also covers the
    // double-submit the old blanket `saving()` flag existed for: Ctrl+Enter reaches the modal's
    // confirm through two keydown listeners that never look at the disabled button, so two calls
    // can land in one tick.
    //
    // `claimRows` decides and marks in a SINGLE call. The check and the mark cannot be separated by
    // anything, so the second call is refused whether or not the first one's write has become
    // visible to a reactive read yet — the guard does not rest on scheduler timing.
    const staged = new Map<number, DirtyRow>(dirty.dirtyCells());
    const {
      accepted,
      refused,
      keys: pendingKeys,
    } = dirty.claimRows(
      [...staged].map(([subjectId, row]) => ({ subjectId, columnIds: row.cells.keys() })),
    );
    const sendable: Array<[number, DirtyRow]> = accepted.map((subjectId) => [
      subjectId,
      staged.get(subjectId)!,
    ]);

    const applyRows: WorkbenchApplyRequest['rows'] = sendable
      .map(([subjectId, dirtyRow]) => ({
        subject_id: subjectId,
        edits: [...dirtyRow.cells.entries()].map(([columnId, edit]) => {
          if (
            columnId === 'total' &&
            typeof edit.new === 'number' &&
            typeof edit.original === 'number'
          ) {
            const delta = edit.new - edit.original;
            const disposition =
              delta < 0 ? dispositions.negative : delta > 0 ? dispositions.positive : null;
            return { column_id: columnId, original: edit.original, new: edit.new, disposition };
          }
          return { column_id: columnId, original: edit.original, new: edit.new };
        }),
      }))
      .filter((r) => r.edits.length > 0);
    if (applyRows.length === 0) {
      // Nothing is going out, so release the lock the claim just took — otherwise these rows stay
      // unsaveable for the rest of the session with nothing on screen to explain it.
      if (pendingKeys.size > 0) dirty.resolvePending(pendingKeys);
      // Everything the operator asked to save is already in flight. Say so, rather than letting
      // Apply look like it did nothing.
      if (refused.length > 0) {
        toast.error(
          sprintf(
            /* translators: %d: number of rows whose previous save has not finished yet */
            _n(
              '%d row is still saving. Wait for it to finish, then save again.',
              '%d rows are still saving. Wait for them to finish, then save again.',
              refused.length,
            ),
            refused.length,
          ),
        );
      }
      return;
    }

    // Exactly the cells this submission carries — the same set `claimRows` locked above and the one
    // `resolvePending` clears when it settles. Derived from `sendable` rather than from `applyRows`
    // so the correspondence is structural: both are "the accepted rows × their staged cells", and a
    // future filter over `applyRows` cannot silently leave part of the lock behind.
    // Re-deriving it from the row's dirty cells at settle time instead would sweep up whatever was
    // staged on those rows in the meantime, which the pending lock deliberately allows.
    const submittedCells: SubmittedCell[] = sendable.flatMap(([subjectId, row]) =>
      [...row.cells.keys()].map((columnId) => ({ subjectId, columnId })),
    );

    // Hand the grid back NOW. The batch is sent; holding the modal over it buys the operator
    // nothing but a dialog to watch, and on a large apply that is the whole point of the exercise.
    // Each submitted cell stays locked and faded until the request carrying it answers, so nothing
    // pretends to have settled — what closes is the dialog, not the transaction. Progress and the
    // outcome show in the status strip.
    closeSaveReview();

    // The requests this batch goes out as: rows that are not retry-safe together first, then the
    // retry-safe rows in chunks, a row's edits never split (see `applyBatches`). A column the grid
    // has no metadata for counts as unsafe, so an unknown column is only ever slower.
    const metaById = columnMetaById();
    const inFlight = props.ctx.applyConcurrency ?? APPLY_CONCURRENCY;
    const batches = applyBatches(
      applyRows,
      (columnId) => metaById.get(columnId)?.retrySafe === true,
      inFlight > 1 ? APPLY_CHUNK_ROWS_SIDE_BY_SIDE : APPLY_CHUNK_ROWS_ONE_AT_A_TIME,
    );
    beginApplyStatus(applyRows.length, batches.length > 1);

    const conflicts: WorkbenchApplyConflict[] = [];
    const unanswered = new Set<number>();
    let requestError: string | null = null;
    // This submission's locks not yet released. A row settles as soon as the request carrying it
    // answers, and may then be edited and saved again — so every later release names only what is
    // still held here, never `pendingKeys` whole, which could free a newer save's lock on that row.
    const stillLocked = new Set(pendingKeys);

    // A request's accepted rows settle the moment it answers. Their confirmed values go into the live
    // overlay first — the grid's underlying data, exactly where a live update puts a value the server
    // confirmed — and only then do the staged edits drop and the cells unlock. So `original` is never
    // an unconfirmed value: a cell takes a new edit only once its baseline is what the server just
    // accepted. A refused row keeps its edits staged and its lock until the batch's refetch re-bases it.
    const settleConfirmed = (
      rows: WorkbenchApplyRequest['rows'],
      refusedRows: ReadonlySet<number>,
    ): void => {
      const sent = new Set(rows.map((row) => row.subject_id));
      const cells = cellsToClearAfterApply(
        submittedCells.filter((cell) => sent.has(cell.subjectId)),
        refusedRows,
      );
      if (cells.length === 0) return;
      const fields = new Map<number, Record<string, unknown>>();
      for (const { subjectId, columnId } of cells) {
        const edit = staged.get(subjectId)?.cells.get(columnId);
        if (edit === undefined) continue;
        fields.set(subjectId, { ...(fields.get(subjectId) ?? {}), [columnId]: edit.new });
      }
      const keys = cells.map((cell) => pendingCellKey(cell.subjectId, cell.columnId));
      batch(() => {
        applyPatches([...fields].map(([subject_id, patch]) => ({ subject_id, fields: patch })));
        dirty.revert(cells);
        dirty.resolvePending(keys);
      });
      for (const key of keys) stillLocked.delete(key);
    };

    // Up to `applyConcurrency` requests in flight, started in plan order so the serial request goes
    // out first, and the opening ones staggered so they do not reach the host in the same instant.
    // The rows of different requests never overlap, so how they interleave on the server does not
    // matter; what the bound protects is the host's worker pool.
    await sendConcurrently(
      batches,
      inFlight,
      async (rows) => {
        try {
          const response = await postJson<WorkbenchApplyResponse>(props.ctx, '/workbench/apply', {
            reason,
            discovery_context: dispositions.discoveryContext,
            rows,
          });
          conflicts.push(...response.conflicts);
          settleConfirmed(rows, new Set(response.conflicts.map((c) => c.subject_id)));
        } catch (err) {
          // Its rows stay staged and are reported as not saved. They are not re-sent automatically:
          // a request that failed in transit may still have been applied, and for a row that is not
          // retry-safe a second send would repeat its stock movement.
          for (const row of rows) unanswered.add(row.subject_id);
          requestError ??= err instanceof Error ? err.message : String(err);
        }
        advanceApplyStatus(rows.length);
      },
      APPLY_STAGGER_MS,
    );
    const conflicted = new Set(conflicts.map((c) => c.subject_id));
    const notSaved = new Set([...conflicted, ...unanswered]);
    const saved = applyRows.filter((r) => !notSaved.has(r.subject_id)).length;
    const detail =
      [conflicts.length > 0 ? describeConflicts(conflicts) : null, requestError]
        .filter((part): part is string => part !== null)
        .join(' ') || null;

    try {
      // Map on-hand `total` conflicts (the live total moved) onto the per-subject conflict ring.
      const nextConflicts = new Map<number, { expected: number; actual: number }>();
      for (const c of conflicts) {
        if (c.column_id !== 'total') continue;
        nextConflicts.set(c.subject_id, {
          expected: typeof c.expected === 'number' ? c.expected : 0,
          actual: typeof c.actual === 'number' ? c.actual : 0,
        });
      }
      setConflicts(nextConflicts);
      // Hand the raw conflict list to the host (if any) so it can render its own affordance (e.g. a
      // sticky reject-all toast); the grid still surfaces them inline + on the Total cell ring below.
      if (conflicts.length > 0) props.onConflicts?.(conflicts);
      // Re-read the rows this save sent — plus the variations of any saved parent, which show its
      // inherited fields — and merge them in place: the server may have normalised a value it
      // accepted, and a column derived from an edited one only changes here. Stock is delta-first,
      // so the frozen delta re-bases over the refreshed live total for conflicted rows. Unanswered
      // rows are read back too: their request may have applied anyway.
      if (unanswered.size < applyRows.length)
        await refreshRows(
          applyRows.map((r) => r.subject_id),
          inFlight,
        );
      // Accepted cells settled as their requests answered. What is still locked is the rows refused
      // or never answered, which stay staged for the operator to review and save again.
      dirty.resolvePending(stillLocked);

      // Notify the host if any submitted row actually persisted (some may have conflicted) — after the
      // refetch, so a host that re-reads the same subjects sees the grid's fresh baseline.
      if (saved > 0) props.onApplied?.();

      // The review stays reachable for what was not saved (the strip's Review), and conflicts stay
      // on their rows (the Total cell's ring) for as long as they matter.
      setSaveError(detail);
      endApplyStatus(saved, notSaved.size, detail);
    } catch (err) {
      // Release only what THIS submission still holds: a failure here says nothing about another
      // submission still in flight, and unlocking its cells would let an edit be staged against a
      // baseline the server has not confirmed.
      dirty.resolvePending(stillLocked);
      const msg = err instanceof Error ? err.message : String(err);
      // The review is already closed, so the message has to come to where the operator is: the
      // strip, which stays up until dismissed because the edits are still staged — silence here
      // would read as "saved".
      setSaveError(msg);
      endApplyStatus(saved, notSaved.size, msg);
    }
  }

  // ── Imperative handles (host toolbar drives these) ──
  let apiFocusGrid: () => void = () => {};
  let apiOpenColumnManager: () => void = () => {};
  let apiScrollToTop: () => void = () => {};
  let apiGetSelectedCells: () => Array<{ row: WorkbenchRow; columnId: string }> = () => [];

  // ── Layout: horizontal grid vs transposed "record" mode (fields → rows, records → columns). ──
  // 'auto' → record mode for a small record set (the embed's one product family — a simple product,
  // or a variable parent + its handful of variations side-by-side); horizontal for many records. The
  // toolbar toggle overrides. Record mode is a DataGrid layout, so all its cell behaviour carries over.
  const RECORD_MODE_MAX = 12;
  const [layoutPref, setLayoutPref] = createSignal<'auto' | 'grid' | 'record'>(
    props.defaultLayout ?? 'auto',
  );
  const effectiveLayout = (): 'grid' | 'record' => {
    const count = rows().length;
    if (count === 0) return 'grid';
    const pref = layoutPref();
    if (pref !== 'auto') return pref;
    return count <= RECORD_MODE_MAX ? 'record' : 'grid';
  };
  const layoutToggleable = (): boolean => rows().length >= 1 && rows().length <= RECORD_MODE_MAX;
  const toggleLayout = (): void => {
    setLayoutPref(effectiveLayout() === 'record' ? 'grid' : 'record');
  };

  // Reactive callbacks for a host that renders its own Save / Record-view controls (the Central
  // Workbench, which hides the grid's toolbar) — mirror the grid's dirty + layout state to the shell.
  createEffect(() => props.onDirtyChange?.(dirty.isDirty()));
  // A save in progress counts as busy until its last request has answered and the batch has
  // refetched — not only while a query fetch runs, which would drop the spinner between requests.
  createEffect(() =>
    props.onFetchingChange?.(query.isFetching || (applyStatus()?.active ?? 0) > 0),
  );
  // Mirror live save progress to a host that renders its own indicator (null once no save is active).
  createEffect(() => {
    const s = applyStatus();
    props.onSaveProgressChange?.(
      s !== null && s.active > 0
        ? { done: s.done, total: s.total, multiChunk: s.multiChunk }
        : null,
    );
  });
  createEffect(() =>
    props.onLayoutChange?.({ layout: effectiveLayout(), canToggle: layoutToggleable() }),
  );

  /** Stage one cell edit into the dirty model + clear any stale conflict ring on that subject. Shared
   *  by the DataGrid and the RecordView so editing behaves identically in either layout. */
  function stageEdit(row: WorkbenchRow, columnId: string, original: unknown, next: unknown): void {
    dirty.patch(row.subjectId, columnId, original, next, row.name, row.sku);
    if (conflicts().has(row.subjectId)) {
      setConflicts((prev) => {
        const nextMap = new Map(prev);
        nextMap.delete(row.subjectId);
        return nextMap;
      });
    }
  }

  // ── Selection (row cascade + cell-selection operations) ──
  /** Toggle a row's checkbox; a variable parent also toggles all its (loaded) variation children, so
   *  selecting a parent selects the family. Called from the checkbox and from a leading-cell click. */
  function toggleRow(row: WorkbenchRow, willSelect?: boolean): void {
    const rowId = String(row.subjectId);
    const isParent = row.productType === 'variable' && row.wcVariationId === null;
    const selecting = willSelect ?? rowSelection()[rowId] !== true;
    setRowSelection((prev) => {
      const next = { ...prev };
      const set = (id: string): void => {
        if (selecting) next[id] = true;
        else delete next[id];
      };
      set(rowId);
      if (isParent) {
        for (const child of rows()) {
          if (child.wcProductId === row.wcProductId && child.wcVariationId !== null)
            set(String(child.subjectId));
        }
      }
      return next;
    });
  }

  // Shift-range anchor for the checkbox column — the row a plain leading-cell click last targeted.
  // Reactive so the column factory outlines the anchor row's checkbox.
  const [rowAnchorId, setRowAnchorId] = createSignal<string | null>(null);

  // Trim the row (bulk-action) selection to the members that still match when the filter/search
  // changes. A selection the new result set no longer shows is a footgun: the bulk bar keeps counting
  // and acting on rows the operator can't see (select 3, filter to a disjoint 6, and it still reads
  // "3 products"). Membership is server-side and paged, so it can't be decided from the loaded rows
  // alone — a still-matching selected row may sit on an unfetched page — so we ask the server which of
  // the selected ids the new query returns (via the `subject_ids` grid filter, a dash-joined id list)
  // and keep only those. Only `queryParams` is watched: sort is a separate signal and paging uses the
  // infinite-query cursor, so reordering or scrolling changes neither the signature nor the match set.
  let lastQuerySig: string | undefined;
  let reconcileAbort: AbortController | undefined;
  createEffect(() => {
    const sig = JSON.stringify(queryParams());
    const changed = lastQuerySig !== undefined && sig !== lastQuerySig;
    lastQuerySig = sig;
    if (!changed) return;

    // Read untracked: `queryParams` is the sole trigger — a selection change must not re-run this.
    const sel = untrack(rowSelection);
    const selected = Object.keys(sel).filter((id) => sel[id]);
    reconcileAbort?.abort();
    if (selected.length === 0) {
      setRowAnchorId(null);
      return;
    }
    reconcileAbort = new AbortController();
    void trimSelectionToMatches(selected, sig, reconcileAbort.signal);
  });

  /** Keep only the selected subjects that still match the (just-changed) query. On any failure fall
   *  back to the safe blunt drop rather than keep counting rows we can't confirm are visible. */
  async function trimSelectionToMatches(
    ids: string[],
    sig: string,
    signal: AbortSignal,
  ): Promise<void> {
    // Restrict the current view to exactly the selected subjects — no brought-with context (a parent
    // or child pulled in for fold context would falsely read as "still matches"), no subscription (it
    // must not rewrite the live-updates watched set), one page big enough for the whole selection.
    // Dash-joined: `subject_ids` is a `numeric_ids` grid filter, whose URL/wire encoding is dash-joined.
    const params: Record<string, string | string[]> = {
      ...queryParams(),
      subject_ids: ids.join('-'),
    };
    params['bring_parents'] = '0';
    delete params['bring_children'];
    delete params['hide_parents'];
    delete params['hide_children'];
    const url = buildProductsUrl(
      props.ctx,
      endpoint(),
      presetParams(),
      params,
      sort(),
      Math.min(10000, ids.length),
      1,
      '',
    );
    const superseded = (): boolean => signal.aborted || JSON.stringify(queryParams()) !== sig;
    let matched: Set<number>;
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'X-WP-Nonce': props.ctx.nonce },
        credentials: 'same-origin',
        signal,
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const page = (await res.json()) as WorkbenchPage;
      matched = new Set(page.products.map((p) => p.subjectId));
    } catch {
      if (superseded()) return; // a newer filter change owns the selection now
      setRowSelection({});
      setRowAnchorId(null);
      return;
    }
    if (superseded()) return;
    setRowSelection((prev) => {
      const next: RowSelectionState = {};
      for (const [id, on] of Object.entries(prev))
        if (on && matched.has(Number(id))) next[id] = true;
      return next;
    });
    setRowAnchorId((prev) => (prev !== null && matched.has(Number(prev)) ? prev : null));
  }

  /** Leading (checkbox) cell click — the whole cell is the target (the checkbox itself is
   *  pointer-events-none). A plain click toggles the row and makes it the anchor; a Shift+click fills
   *  the displayed range from the anchor to this row with this row's resulting state (select OR
   *  deselect), the spreadsheet convention. */
  function handleLeadingCellClick(row: WorkbenchRow, event: MouseEvent): void {
    const anchor = rowAnchorId();
    if (event.shiftKey && anchor !== null) {
      const display = rows();
      const from = display.findIndex((r) => String(r.subjectId) === anchor);
      const to = display.findIndex((r) => r.subjectId === row.subjectId);
      if (from !== -1 && to !== -1) {
        const target = rowSelection()[String(row.subjectId)] !== true; // this row's resulting state
        const lo = Math.min(from, to);
        const hi = Math.max(from, to);
        for (let i = lo; i <= hi; i++) toggleRow(display[i], target);
        return; // keep the anchor so successive shift-clicks re-extend from it
      }
    }
    toggleRow(row);
    setRowAnchorId(String(row.subjectId));
  }

  const selectionHasDirty = (): boolean =>
    apiGetSelectedCells().some((c) => dirty.isCellDirty(c.row.subjectId, c.columnId));

  /** Drop the staged edits for the currently-selected cells (a select-and-revert stand-in for undo). */
  function revertSelection(): void {
    const targets = apiGetSelectedCells()
      .filter((c) => dirty.isCellDirty(c.row.subjectId, c.columnId))
      .map((c) => ({ subjectId: c.row.subjectId, columnId: c.columnId }));
    if (targets.length > 0) dirty.revert(targets);
  }

  // Bulk-edit from a multi-cell selection (F2 / right-click "Edit selection…").
  const [bulkEditColumns, setBulkEditColumns] = createSignal<BulkEditColumn[] | null>(null);

  /** Map the grid-supplied per-column selection groups to bulk-edit columns: keep only editable,
   *  non-reason-gated columns (the on-hand `total` keeps its per-cell flow) and snapshot each target's
   *  current (staged-or-persisted) value. Returns true when a modal opened. */
  function openBulkEditFromGroups(
    groups: Array<{ columnId: string; meta: GridColumnMeta; rows: WorkbenchRow[] }>,
  ): boolean {
    const out: BulkEditColumn[] = [];
    for (const group of groups) {
      const meta = group.meta;
      if (!meta.editable || meta.bulkSaveReason !== null) continue;
      out.push({
        meta,
        targets: group.rows.map((row) => {
          const staged = dirty.edit(row.subjectId, group.columnId);
          return {
            subjectId: row.subjectId,
            row,
            value: staged ? staged.new : workbenchValueFor(row, group.columnId),
          };
        }),
      });
    }
    if (out.length === 0) return false;
    setBulkEditColumns(out);
    return true;
  }

  function closeBulkEdit(): void {
    setBulkEditColumns(null);
    // Deferred for the same reason as closeSaveReview(): the panel is still mounted here.
    queueMicrotask(() => apiFocusGrid());
  }

  function applyBulkEdits(edits: BulkEditResult[]): void {
    // One write for the whole selection, not one per cell: `patch()` in a loop makes the grid
    // re-render once per edited cell, which is what made a few-hundred-cell apply sit there.
    //
    // `original` is the PERSISTED value, not the modal's — the modal tracks against the staged
    // value so reopening continues from it, but the dirty model prunes a cell by comparing against
    // what is saved. Passing the staged value leaves an edit that stages the saved value back over
    // itself: visibly dirty, and a pointless write on save. A bulk edit that returns a column to
    // where it started (raise 10%, then undo it) is exactly that case.
    dirty.patchMany(
      edits.map((e) => ({
        subjectId: e.subjectId,
        columnId: e.columnId,
        original: workbenchValueFor(e.row, e.columnId),
        next: e.newValue,
        name: e.row.name,
        sku: e.row.sku,
      })),
    );
    closeBulkEdit();
  }

  /** Right-click extras: Revert (when the selection carries staged edits) + Save (when dirty). */
  function ownContextMenuExtras(): DataGridMenuItem[] {
    const extras: DataGridMenuItem[] = [];
    if (selectionHasDirty())
      extras.push({ id: 'revert', label: __('Revert'), run: revertSelection });
    if (dirty.isDirty()) extras.push({ id: 'save', label: __('Save'), run: openSaveReview });
    return extras;
  }

  /**
   * The Product column's own header-menu entry: how a variation names itself.
   *
   * It lives here rather than in the display settings because it is a property of ONE column, and a
   * page-level setting whose effect is confined to a single column has to be found by elimination.
   * On the header it is where the operator is already looking when the names read wrong.
   *
   * Shown whenever the column is, including on a catalogue with no variable products: it is a stored
   * preference, not a command against the loaded rows, and gating it on what happens to be on screen
   * would make it appear and disappear as the operator folds a family open.
   */
  function ownHeaderMenuExtras(columnId: string): DataGridMenuItem[] {
    if (columnId !== 'name') return [];
    return [
      {
        id: 'variation-names',
        label: __('Variation names'),
        children: [
          {
            id: 'variation-names-full',
            // Deliberately the WooCommerce words a merchant sees on the product screen, not the
            // domain's: this row is a variation of a variable product, never an "aggregate member".
            label: __('Full product name'),
            checked: !compactVariations(),
            run: () => setCompactVariations(false),
          },
          {
            id: 'variation-names-attrs',
            label: __('Attributes only'),
            checked: compactVariations(),
            run: () => setCompactVariations(true),
          },
        ],
      },
    ];
  }

  // Surface the row-checkbox selection (as subject ids) to the host so it can build its own bulk-action
  // bar — the grid stays free of surface-specific actions (worksheets, supplier assign, …).
  createEffect(() => {
    const sel = rowSelection();
    props.onSelectionChange?.(
      Object.keys(sel)
        .filter((k) => sel[k])
        .map(Number),
    );
  });

  const handles: WorkbenchHandles = {
    focus: () => apiFocusGrid(),
    openColumnManager: () => apiOpenColumnManager(),
    scrollToTop: () => apiScrollToTop(),
    // Force a fresh pull, ignoring the transport cadence (e.g. after a save) — refetches the base and
    // resets the overlay so the grid shows authoritative server state immediately.
    refreshLiveUpdates: () => void refetchAndResetLive(),
    openSaveReview: () => openSaveReview(),
    getSelectedCells: () => apiGetSelectedCells(),
    isDirty: () => dirty.isDirty(),
    loadAllPages: async () => {
      while (query.hasNextPage && !query.isFetchingNextPage) await query.fetchNextPage();
    },
    getActiveCell: () => {
      const active = cellSelection().active;
      if (active === null) return null;
      const subjectId = rows()[active.row]?.subjectId;
      const columnId = apiSelectableColumnIds()[active.col];

      return subjectId === undefined || columnId === undefined ? null : { subjectId, columnId };
    },
    selectCells: (cells, active) => {
      const rowIndexBySubject = new Map<number, number>();
      rows().forEach((row, index) => rowIndexBySubject.set(row.subjectId, index));
      const colIndexById = new Map<string, number>();
      apiSelectableColumnIds().forEach((id, index) => colIndexById.set(id, index));

      // Cells whose row or column is no longer on screen simply fail to resolve and drop out. That
      // is the whole of the collapse case: the host re-applies what it had, and the rows that went
      // away take their selection with them.
      const coords: CellCoord[] = [];
      for (const cell of cells) {
        const row = rowIndexBySubject.get(cell.subjectId);
        const col = colIndexById.get(cell.columnId);
        if (row !== undefined && col !== undefined) coords.push({ row, col });
      }
      if (coords.length === 0) {
        setCellSelection(EMPTY_SELECTION);

        return;
      }

      let cursor: CellCoord | null = null;
      if (active) {
        const row = rowIndexBySubject.get(active.subjectId);
        const col = colIndexById.get(active.columnId);
        if (row !== undefined && col !== undefined) cursor = { row, col };
      }
      // Fallback: the selection's top-left, so the cursor lands somewhere the user can see rather
      // than wherever the caller happened to list first.
      cursor ??= coords.reduce((best, c) =>
        c.row < best.row || (c.row === best.row && c.col < best.col) ? c : best,
      );

      setCellSelection({
        active: cursor,
        anchor: cursor,
        ranges: selectionRectsFromCells(coords),
      });
    },
    toggleLayout: () => toggleLayout(),
  };
  props.apiRef?.(handles);

  // Static bespoke (host-rendered) columns — checkbox, name+link, image, catalogue/pricing scalars.
  // (Orders is NOT here — it's a generic `link`-datatype server column now. The ledger link lives in
  // the name cell's product-actions menu, not a column.) Editable scalars + name render their staged
  // value in amber via the dirty store.
  const staticBespoke = buildWorkbenchColumns({
    hostNav,
    stagedValue: dirty.stagedValue,
    isCellDirty: dirty.isCellDirty,
    displayName,
    // The ▸/▾ caret is a transient affordance, not a destination. Its click stops propagation so
    // folding doesn't also move the cell selection — which leaves focus parked on the button, and
    // keyboard cell-nav dead until the user clicks a cell. Hand focus back on the way out, the same
    // way the modals above do. (A microtask, because the toggle rewrites the visible row set.)
    fold: props.fold && {
      state: (row) => props.fold?.state(row) ?? 'none',
      toggle: (row) => {
        props.fold?.toggle(row);
        queueMicrotask(() => apiFocusGrid());
      },
    },
    anchorRowId: rowAnchorId,
    suppressLinkKinds: props.suppressProductLinkKinds,
  });
  // Stock cells are derived from the server column list via the stock-`kind` seam (stockSlotOf), not a
  // hardcoded atp/res/ctd/total list — so faceted per-warehouse / -channel stock flows through the
  // same renderer with no client change. The merged map
  // rebuilds only when the server column list changes; cell reactivity to staging / conflicts is
  // intrinsic (the cells read those signals). Any id in neither map → generic datatype-view column.
  const stockDeps = {
    fmt,
    stagedCascade: stagedTotalCascade,
    totalDelta,
    conflict: conflictFor,
  };
  const bespokeColumns = createMemo(() => {
    const merged = new Map(staticBespoke);
    for (const [id, def] of buildStockColumns(stableColumns(), stockDeps)) merged.set(id, def);
    // A bespoke def's grid header is the server's canonical label — the one name the column manager,
    // the tooltip and a per-language admin rename all speak, so the grid never disagrees with them.
    // (The defs still carry a header string, but only as the pre-metadata first-paint fallback; once
    // the column list arrives this assignment supersedes it.) A merchant who wants a column narrower
    // renames it, and that flows through here too, since a rename is just a different `meta.label`.
    // Generic datatype-view and stock columns already build their header from `meta.label`, so this
    // re-asserts what they have; it exists for the bespoke defs, whose built-in header it replaces.
    for (const meta of stableColumns()) {
      const def = merged.get(meta.id);
      if (def !== undefined) merged.set(meta.id, { ...def, header: meta.label });
    }

    return merged;
  });

  return (
    // `min-h-0 flex-1` (not `h-full`): fills a bounded flex-col parent (the full-page Central Workbench
    // → internal scroll) while staying auto-height in a plain block parent (the product-tab embed →
    // grows with the page). A percentage `h-full` doesn't reliably resolve against a `flex-1` ancestor.
    <div class="flex min-h-0 flex-1 flex-col">
      {/* ── Toolbar ── (optional: a host with its own chrome — the Central Workbench — hides it via
          `showToolbar={false}` and drives Columns/Record-view/Save from its own bar via the handles +
          onDirtyChange/onLayoutChange callbacks.) */}
      <Show when={props.showToolbar !== false}>
        {/* Left: the layout toggle + the host's toolbarExtra (the "manage product in workbench" link),
            both icon-sized so they fit inline at any width. Right cluster (ml-auto): Columns — its
            natural neighbour is Save — then Save. flex-wrap is a safety net for an extreme-narrow embed. */}
        <div class="flex flex-wrap items-center gap-2 py-2">
          {/* Layout toggle — flips the horizontal table ⇄ transposed record matrix. The icon shows the
              layout you'll switch TO. Shown for a small record set, where record mode reads best. */}
          <Show when={rows().length >= 1 && rows().length <= RECORD_MODE_MAX}>
            <Button
              variant="secondary"
              class="px-2!"
              aria-label={
                effectiveLayout() === 'record'
                  ? __('Switch to table view')
                  : __('Switch to record view')
              }
              title={
                effectiveLayout() === 'record'
                  ? __('Switch to table view')
                  : __('Switch to record view')
              }
              onClick={() => toggleLayout()}
            >
              {effectiveLayout() === 'record' ? (
                <TableViewIcon class="h-5 w-5" />
              ) : (
                <RecordViewIcon class="h-5 w-5" />
              )}
            </Button>
          </Show>
          {props.toolbarExtra}
          <div class="ml-auto flex items-center gap-2">
            <Button disabled={!dirty.isDirty()} onClick={() => openSaveReview()}>
              {__('Save')}
            </Button>
            <Button
              variant="secondary"
              class="px-2!"
              aria-label={`${__('Columns')} (Ctrl+M)`}
              title={`${__('Columns')} (Ctrl+M)`}
              onClick={() => handles.openColumnManager()}
            >
              <ColumnsSettingsIcon class="h-5 w-5" />
            </Button>
          </div>
        </div>
      </Show>

      {/* ── Grid ── (flex-col, not a bare block: the DataGrid root fills via flex-1, so the grid
          scrolls internally inside a bounded parent instead of growing the page.) */}
      <div class="flex min-h-0 flex-1 flex-col">
        <DataGrid<WorkbenchRow>
          rows={rows}
          getRowId={(row) => String(row.subjectId)}
          settingsKey={props.storageKeyPrefix}
          columnMetas={() => stableColumns()}
          groupLabels={stableGroupLabels}
          getValue={workbenchValueFor}
          bespokeColumns={bespokeColumns()}
          leadingColumnIds={props.showRowSelection === false ? [] : ['select']}
          trailingColumnIds={['orders']}
          defaultGridSettings={props.defaultGridSettings}
          layout={effectiveLayout}
          recordKeyLabel={(row) => `#${row.wcVariationId ?? row.wcProductId}`}
          taxonomySpace={() => stableTaxonomySpace()}
          // ── Editing (v2): non-stock columns are editable; the dirty store owns staging. ──
          canEdit={canEdit}
          getStagedValue={getStagedValue}
          resolvePersistedValue={(row, meta) => persistedEditorValue(row, meta)}
          resolveClearedValue={(row, meta) => clearedValueForRow(meta, row)}
          resolveEditorMeta={(meta, row) => editorMetaForRow(meta, row)}
          isInherited={isInherited}
          isGenericColumnInherited={isGenericColumnInherited}
          onStageEdit={stageEdit}
          onClearCells={onClearCells}
          onEditMulti={(groups) => openBulkEditFromGroups(groups)}
          fetchDrilldown={async (columnId, row) => {
            const res = await getJson<{ detail: unknown }>(
              props.ctx,
              `/workbench/drilldown/${encodeURIComponent(columnId)}/${row.subjectId}`,
            );
            return { title: () => row.name, detail: res.detail };
          }}
          saveDrilldown={
            props.ctx.capabilities.editProducts
              ? async (columnId, subjectId, payload) => {
                  const res = await postJson<{ detail: unknown }>(
                    props.ctx,
                    `/workbench/drilldown/${encodeURIComponent(columnId)}/${subjectId}`,
                    payload,
                  );
                  return { detail: res.detail };
                }
              : undefined
          }
          drilldownSearchOptions={
            props.ctx.capabilities.editProducts
              ? async (q) => {
                  const res = await getJson<{
                    products: Array<{ postId: number; name: string; sku: string }>;
                  }>(props.ctx, '/products/search', { q, limit: '20' });
                  return res.products.map((p) => ({
                    value: String(p.postId),
                    label: p.sku ? `${p.name} (${p.sku})` : p.name,
                  }));
                }
              : undefined
          }
          canPaste={() => props.ctx.capabilities.editProducts}
          onPasteError={(message) => {
            if (message !== '') toast.error(message);
          }}
          onClipboardSuccess={(message) => toast.success(message)}
          contextMenuExtras={(args) => [
            ...(props.contextMenuExtras?.(args) ?? []),
            ...ownContextMenuExtras(),
          ]}
          headerMenuExtras={(args) => [
            ...(props.headerMenuExtras?.(args) ?? []),
            ...ownHeaderMenuExtras(args.columnId),
          ]}
          componentChoiceId={props.componentChoiceId}
          rowAttrs={props.rowAttrs}
          copyAsJsonAllowed={props.copyAsJsonAllowed}
          copyAsJsonUpgradeHint={props.copyAsJsonUpgradeHint}
          keyHandlers={[saveKeyHandler, ...(props.extraKeyHandlers ?? [])]}
          keyHandlersInGrid={[
            inGridSaveKeyHandler,
            backspaceRevertHandler,
            ...(props.extraInGridKeyHandlers ?? []),
          ]}
          // ── Controlled state ──
          sorting={tableSorting}
          onSortingChange={(next) => {
            const [first] = next;
            if (first) setSort({ sortBy: first.id, sortDir: first.desc ? 'desc' : 'asc' });
            else setSort({ sortBy: 'name', sortDir: 'asc' });
          }}
          columnVisibility={columnVisibility}
          setColumnVisibility={(updater) => setColumnVisibility((prev) => updater(prev))}
          columnOrder={columnOrder}
          setColumnOrder={(updater) => setColumnOrder((prev) => updater(prev))}
          columnSizing={columnSizing}
          setColumnSizing={(updater) => setColumnSizing((prev) => updater(prev))}
          expandedColumnSections={expandedColSections}
          setExpandedColumnSections={(updater) => setExpandedColSections((prev) => updater(prev))}
          onResetColumns={resetColumns}
          canRenameColumns={() => props.ctx.capabilities.manageSettings === true}
          onRenameColumn={renameColumn}
          rowSelection={rowSelection}
          setRowSelection={(updater) => setRowSelection((prev) => updater(prev))}
          cellSelection={cellSelection}
          setCellSelection={setCellSelection}
          onLeadingCellClick={(row, _colId, event) => handleLeadingCellClick(row, event)}
          onScrollNearEnd={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
          fallback={
            props.fallback ??
            (query.isPending ? <>{__('Loading…')}</> : <>{__('No products found.')}</>)
          }
          apiRef={(api) => {
            apiFocusGrid = api.focusGrid;
            apiOpenColumnManager = api.openColumnManager;
            apiScrollToTop = api.scrollToTop;
            apiSelectableColumnIds = api.getSelectableColumnIds;
            apiGetSelectedCells = api.getSelectedCells;
          }}
        />
      </div>

      {/* ── Save status: progress while an apply goes out, then how it ended ── */}
      <Show when={applyStatus()}>
        {(status) => (
          <div
            role="status"
            aria-live="polite"
            class="flex shrink-0 items-center gap-3 border-t border-border px-1 pt-2 text-sm"
          >
            <Show
              when={status().active > 0}
              fallback={
                <>
                  <span
                    class={
                      status().notSaved > 0 || status().detail !== null
                        ? 'min-w-0 flex-1 truncate text-red-700'
                        : 'min-w-0 flex-1 truncate text-text-muted'
                    }
                    title={status().detail ?? undefined}
                  >
                    {[
                      status().saved > 0
                        ? sprintf(
                            /* translators: %d: number of product rows saved */
                            _n('%d row saved', '%d rows saved', status().saved),
                            status().saved,
                          )
                        : null,
                      status().notSaved > 0
                        ? sprintf(
                            /* translators: %d: number of product rows the save did not apply */
                            _n('%d row not saved', '%d rows not saved', status().notSaved),
                            status().notSaved,
                          )
                        : null,
                      status().detail,
                    ]
                      .filter((part): part is string => part !== null && part !== '')
                      .join(' · ')}
                  </span>
                  <Show when={status().notSaved > 0}>
                    <Button variant="secondary" size="sm" onClick={() => openSaveReview()}>
                      {_x(
                        'Review',
                        'workbench save status: open the review of unsaved rows, button',
                      )}
                    </Button>
                  </Show>
                  <IconButton
                    label={_x('Dismiss', 'workbench save status: close the strip, button')}
                    onClick={() => setApplyStatus(null)}
                  >
                    ✕
                  </IconButton>
                </>
              }
            >
              <Spinner />
              <span class="tabular-nums text-text-muted">
                {sprintf(
                  /* translators: 1: rows sent so far, 2: rows in the save (the plural follows it) */
                  _n('Saving %1$d of %2$d row…', 'Saving %1$d of %2$d rows…', status().total),
                  status().done,
                  status().total,
                )}
              </span>
            </Show>
          </div>
        )}
      </Show>

      {/* ── Footer ── */}
      <Show when={props.showFooterCount !== false}>
        <div class="flex shrink-0 items-center justify-between py-2 text-sm text-text-muted">
          <Show when={query.data} fallback={<span>—</span>}>
            <span>
              {loadedCount()} / {totalCount()}
            </span>
          </Show>
          <Show when={query.isFetchingNextPage}>
            <span>{__('Loading more…')}</span>
          </Show>
        </div>
      </Show>

      {/* ── Save-review (shared modal; v2 shows non-stock edit groups, v3 adds the on-hand group) ── */}
      <Show when={showReviewModal() && dirty.isDirty()}>
        <CorrectionReviewModal
          groups={reviewGroups()}
          governanceNotes={governanceNotes()}
          space={stableTaxonomySpace()}
          error={saveError()}
          mount={portalRoot}
          onConfirm={(reason, dispositions) => void commitSave(reason, dispositions)}
          onCancel={closeSaveReview}
          onDiscard={discardAll}
        />
      </Show>

      {/* ── Bulk edit (multi-cell selection → one control per column) ── */}
      <Show when={bulkEditColumns()}>
        {(columns) => (
          <BulkEditModal
            columns={columns()}
            taxonomySpace={stableTaxonomySpace()}
            mount={portalRoot}
            onApply={applyBulkEdits}
            onClose={closeBulkEdit}
          />
        )}
      </Show>
    </div>
  );
}

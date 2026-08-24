import { windowUrlPort, type UrlParamsPort } from '../urlPort';
import { useHostNav } from '@invflux/ui';
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, untrack } from 'solid-js';
import { Dynamic } from 'solid-js/web';
// Built-in datatype components register themselves as a side effect of importing @invflux/ui, which
// also provides the shared datatype registries + the reusable WorkbenchGrid (arch-ui-principles §3.2).
import {
  DropdownMenu,
  FilterBar,
  Button,
  IconButton,
  Modal,
  ToastRegion,
  WorkbenchGrid as WorkbenchGridBase,
  bulkActionRegistry,
  drilldownRegistry,
  editRegistry,
  SettingsSection,
  slotRegistry,
  surfaceSettingsRegistry,
  viewRegistry,
  gridFiltersToDescriptors,
  readUnreservedFilterValuesFromParams,
  deleteUnreservedFilterParams,
  writeFilterValuesToParams,
  readFilterModifiersFromParams,
  writeFilterModifiersToParams,
  deleteFilterModifierParams,
  workbenchValueFor,
  FilterModeToggle,
  FilterScopePicker,
  RefreshIcon,
  TableViewIcon,
  RecordViewIcon,
  ColumnsSettingsIcon,
  toast,
  type BulkActionContext,
  type DataGridMenuItem,
  type DropdownMenuItem,
  type FilterDescriptor,
  type GridFilterMeta,
  type RegistrationInfo,
  type WorkbenchRow,
  type WorkbenchHandles,
} from '@invflux/ui';
import { __, _n, sprintf } from '@invflux/i18n';
import { useWorkbench } from '../context';
import type {
  ComponentRole,
  ReorderStatus,
  TaxonomySpace,
  WorkbenchColumnMeta,
  WorkbenchWorksheet,
  WorkbenchFilterOption,
  WorkbenchToolbarSlotProps,
  WorkbenchSettingsSlotProps,
} from '../types';

/** Compact chip summary for a filter. Range filters show "min – max" / "≥ min" / "≤ max";
 *  select/multiselect show "Label" or "Label +N". */
function summarizeSelected(
  values: string[],
  options: WorkbenchFilterOption[],
  meta?: GridFilterMeta,
): string {
  // An empty-means-all filter with nothing selected matches every option → read "All".
  if (values.length === 0) return meta?.emptyMeansAll ? __('All') : '';
  if (meta?.type === 'range') {
    const [min, max] = [values[0] ?? '', values[1] ?? ''];
    if (min !== '' && max !== '') return `${min} – ${max}`;
    if (min !== '') return `≥ ${min}`;
    if (max !== '') return `≤ ${max}`;
    return '';
  }
  const labelFor = (v: string): string => options.find((o) => o.value === v)?.label ?? v;
  if (values.length <= 2) return values.map(labelFor).join(', ');
  return `${labelFor(values[0])} +${values.length - 1}`;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LOAD_SIZE_OPTIONS = [50, 100, 200, 500, 1000, 2000];

/** Columns whose value is meaningful only on unit (sellable) subjects — variable parents are
 *  value-less for them, so sorting by one auto-engages "hide brought-in parents" (the parents would
 *  otherwise clump at one end as a value-less block). */
const UNIT_ONLY_SORT_COLUMNS = ['price'];

/** Server-search debounce: re-query the server this long after the last keystroke. */
const SEARCH_DEBOUNCE_MS = 300;
const LOAD_SIZE_STORAGE_KEY = 'invflux_workbench_load_size';
const COLLAPSED_STORAGE_KEY = 'invflux_workbench_collapsed';
const DEFAULT_LOAD_SIZE = 500;

/** The prefix the reusable grid namespaces its persisted column state under (storageKeyPrefix =
 *  "central-workbench"). The shell reads these keys directly when building the export column set so
 *  the export matches what's on screen — the single point where the shell couples to the grid's
 *  localStorage layout (kept out of the grid's imperative surface for now). */
const GRID_STORAGE_PREFIX = 'invflux:workbench-grid:central-workbench:';

/* Live-stock delta polling is DISABLED. The backend landed (adapter 298b195) but the "SPA
 * poll/apply" half never did: the reusable grid's default polling transport
 * targets `/workbench/stock-updates?subscription=…`, a route that was never registered (the server
 * exposes `/workbench/subscriptions/{id}/updates`), and the response envelope differs too
 * (`{updates:[{subjectId,atp,res,ctd,total}]}` vs the client's `{patches: RowPatch[]}`). So the
 * poller only produced a 404 every 30s per open Workbench and never delivered an update — stock
 * still refreshes on each products fetch. Passing no `liveUpdates` prop leaves the transport
 * uninstantiated. BACKLOG: finish the poll/apply integration (URL + envelope + mapping the server
 * aggregates onto the grid's stock-column field ids) — not needed for the wp.org submission.

// ─── Query helpers ────────────────────────────────────────────────────────────

type QueryState = {
  search: string;
  loadSize: number;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  /** Registry-driven filter values keyed by filter id (incl. `taxonomy_<name>`, `stock_status`, …). */
  filterValues: Record<string, string[]>;
  /** Per-filter scalar modifiers keyed by filter id (e.g. `{ supplier: { mode: "all" } }`). */
  filterModifiers: Record<string, Record<string, string>>;
  /** "Related rows" → hide brought-in parents: a CLIENT-side display filter that hides variable-parent
   *  rows present only as context (brought-with, `matched===false`) or value-less for the active sort.
   *  Parents are still loaded (fold home); this only hides them. Auto-engaged for a unit-only sort. */
  hideBroughtParents: boolean;
  /** "Related rows" → bring in variations: a SERVER opt-in (downward brought-with pass). When on, the
   *  variations of a matched parent are loaded even if they don't match (as `matched===false` context).
   *  Affects what the server returns → part of the server query key. */
  bringChildren: boolean;
  /** "Related rows" → hide brought-in children: CLIENT-side, hides those brought-with variations
   *  (`matched===false`). Only meaningful (and only shown) while {@link bringChildren} is on. */
  hideBroughtChildren: boolean;
};

/** Surface-bespoke array params handled explicitly (none currently) — never treated as registry
 *  filters. (`tax_filters[name][]` uses a bracketed-name shape the registry reader already skips.) */
const RESERVED_FILTER_PARAMS: string[] = [];

async function postJson<T>(
  ctx: { apiRoot: string; nonce: string },
  path: string,
  body: unknown,
  method = 'POST',
): Promise<T> {
  const res = await fetch(`${ctx.apiRoot.replace(/\/$/, '')}/invflux/v1${path}`, {
    method,
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

async function getJson<T>(
  ctx: { apiRoot: string; nonce: string },
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  // Build through `new URL` so query params merge into the existing query string — under plain
  // permalinks apiRoot already carries `?rest_route=…`, so a raw `?q=` would be a second `?` and
  // break the route. Pass params here, never embed them in `path`.
  const url = new URL(`${ctx.apiRoot.replace(/\/$/, '')}/invflux/v1${path}`);
  if (params !== undefined) {
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  }
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json', 'X-WP-Nonce': ctx.nonce },
    credentials: 'same-origin',
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

/** Whether focus is in an editable field — resolved through nested Shadow DOMs (the SPA mounts in
 *  one, so document.activeElement is only the host). Used to let "/" type normally while editing. */
function isTypingInField(): boolean {
  if (typeof document === 'undefined') return false;
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  if (el === null) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    (el as HTMLElement).isContentEditable
  );
}

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmt = (n: number) => new Intl.NumberFormat().format(n);

function reorderStatusFor(atp: number, threshold: number | null): ReorderStatus {
  if (threshold === null) return 'none';
  if (atp > threshold) return 'above';
  if (atp === threshold) return 'at';
  return 'below';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type SupplierOption = { id: number; displayName: string };

/** Bulk "Add to supplier": pick a supplier; selected subjects are added to its catalogue. */
function SupplierAssignModal(props: {
  ctx: { apiRoot: string; nonce: string };
  subjectIds: number[];
  onClose: () => void;
  /** Fired after products were actually added, so the host can refetch (the Suppliers column back-fills). */
  onAssigned?: () => void;
}) {
  const [suppliers, setSuppliers] = createSignal<SupplierOption[]>([]);
  const [supplierId, setSupplierId] = createSignal<number | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);

  createEffect(() => {
    void (async () => {
      try {
        const res = await getJson<{ suppliers: SupplierOption[] }>(props.ctx, '/procurement/suppliers');
        setSuppliers(res.suppliers);
        if (res.suppliers[0]) setSupplierId(res.suppliers[0].id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoaded(true);
      }
    })();
  });

  async function assign(): Promise<void> {
    const id = supplierId();
    if (id === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await postJson<{ created: number; skipped: number }>(
        props.ctx,
        `/procurement/suppliers/${id}/products/bulk`,
        { subject_ids: props.subjectIds },
      );
      const name = suppliers().find((s) => s.id === id)?.displayName ?? '';
      toast.success(
        sprintf(
          /* translators: 1: number added, 2: supplier name, 3: number already linked */
          __('Added %1$d product(s) to %2$s — %3$d already linked.'),
          res.created,
          name,
          res.skipped,
        ),
      );
      // Refetch so the in-view Suppliers column reflects the new links (nothing changed if 0 added).
      if (res.created > 0) props.onAssigned?.();
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      onClose={props.onClose}
      closeOnBackdrop={false}
      backdropClass="flex items-center justify-center bg-black/30 p-6"
      label={__('Add to supplier catalog')}
    >
      <div class="flex w-full max-w-md flex-col rounded border border-border bg-surface shadow-xl">
        <div class="border-b border-border p-5">
          <h2 class="text-lg font-semibold text-text">{__('Add to supplier catalog')}</h2>
          <p class="text-sm text-text-muted">
            {sprintf(
              /* translators: %d: number of selected products */
              __("Add %d selected product(s) to a supplier's catalogue."),
              props.subjectIds.length,
            )}
          </p>
        </div>

        <div class="flex-1 p-5">
          <Show when={error()}>
            <p class="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error()}</p>
          </Show>
          <Show
            when={loaded() && suppliers().length > 0}
            fallback={
              <p class="text-sm text-text-muted">
                {loaded()
                  ? __('No suppliers yet — create one in Procurement first.')
                  : __('Loading suppliers…')}
              </p>
            }
          >
            <label class="mb-1 block text-sm font-medium text-text">{__('Supplier')}</label>
            <select
              class="h-9 w-full rounded border border-border bg-surface px-3 text-sm shadow-sm"
              disabled={busy()}
              value={supplierId() ?? ''}
              onChange={(e) => setSupplierId(e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
            >
              <For each={suppliers()}>{(s) => <option value={s.id}>{s.displayName}</option>}</For>
            </select>
          </Show>
        </div>

        <div class="flex items-center justify-end gap-2 border-t border-border p-5">
          <Button
            variant="secondary"
            onClick={props.onClose}
          >
            {__('Cancel')}
          </Button>
          <Button
            disabled={busy() || supplierId() === null}
            onClick={() => void assign()}
          >
            {sprintf(__('Add %d'), props.subjectIds.length)}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Bulk "Create replenishment PO": available only when a **single** supplier is filtered (so supplier X
 * is unambiguous). Generates a draft PO covering the chosen products — the selected rows, else all
 * visible ones — by reusing the server replenishment suggester (short = at/below reorder threshold or
 * carrying the deficit concern). Only products that actually need ordering become lines, so a
 * scoped-but-none-short request creates nothing and says so. On success it hands off to the
 * Procurement app's draft for review + submit (the deficit → what-to-buy → PO loop, free-po-management §9).
 */
function GeneratePoModal(props: {
  ctx: { apiRoot: string; nonce: string };
  supplierId: number;
  subjectIds: number[];
  /** True when the rows were an explicit user selection ("order these"), false for an all-visible sweep. */
  explicit: boolean;
  onClose: () => void;
}) {
  const hostNav = useHostNav();
  const [supplierName, setSupplierName] = createSignal<string>('');
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  createEffect(() => {
    void (async () => {
      try {
        const res = await getJson<{ suppliers: SupplierOption[] }>(props.ctx, '/procurement/suppliers');
        setSupplierName(res.suppliers.find((s) => s.id === props.supplierId)?.displayName ?? '');
      } catch {
        /* the name is cosmetic — a failed lookup must not block PO creation */
      }
    })();
  });

  async function generate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await postJson<{ purchaseOrder: { id: number } | null }>(
        props.ctx,
        '/procurement/purchase-orders/replenish',
        { supplier_id: props.supplierId, subject_ids: props.subjectIds, explicit: props.explicit },
      );
      if (res.purchaseOrder === null) {
        // Explicit selection → the only null case is "none are in this supplier's catalogue".
        // Sweep → nothing in view currently needs reordering.
        toast.info(
          props.explicit
            ? __("None of the selected products are in this supplier's catalogue.")
            : __('Nothing to replenish — nothing in view needs reordering right now.'),
        );
        props.onClose();
        return;
      }
      // Cross-SPA hand-off: land on the new draft in the Procurement app for review + submit.
      // Cross-surface hand-off through the host port: a separate admin page standalone, an
      // in-app route when embedded (assigning a `#/…` href just moves the shell router).
      window.location.href = hostNav.routeHref(`/procurement/purchase-orders/${res.purchaseOrder.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      onClose={props.onClose}
      closeOnBackdrop={false}
      backdropClass="flex items-center justify-center bg-black/30 p-6"
      label={__('Create replenishment PO')}
    >
      <div class="flex w-full max-w-md flex-col rounded border border-border bg-surface shadow-xl">
        <div class="border-b border-border p-5">
          <h2 class="text-lg font-semibold text-text">{__('Create replenishment PO')}</h2>
          <p class="mt-1 text-sm text-text-muted">
            {props.explicit
              ? sprintf(
                  /* translators: 1: supplier name, 2: number of selected products */
                  __('Generate a draft purchase order for %1$s with the %2$d selected product(s).'),
                  supplierName() || __('the filtered supplier'),
                  props.subjectIds.length,
                )
              : sprintf(
                  /* translators: 1: supplier name, 2: number of products in view */
                  __('Generate a draft purchase order for %1$s from the %2$d product(s) in view.'),
                  supplierName() || __('the filtered supplier'),
                  props.subjectIds.length,
                )}
          </p>
          <p class="mt-2 text-xs text-text-muted">
            {props.explicit
              ? __('Each selected product is added at a suggested quantity (its shortfall, or the minimum order quantity). You review and edit the draft before submitting.')
              : __("Only products that need reordering (below reorder point, or oversold beyond what's on order) are added, at suggested quantities. You review and edit the draft before submitting.")}
          </p>
        </div>

        <Show when={error()}>
          <div class="px-5 pt-4">
            <p class="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error()}</p>
          </div>
        </Show>

        <div class="flex items-center justify-end gap-2 border-t border-border p-5">
          <Button
            variant="secondary"
            onClick={props.onClose}
          >
            {__('Cancel')}
          </Button>
          <Button
            disabled={busy()}
            onClick={() => void generate()}
          >
            {busy() ? __('Creating…') : __('Create draft PO')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── URL state helpers ────────────────────────────────────────────────────────

const INVFLUX_URL_PARAMS = ['search', 'sort_by', 'sort_dir', 'hide_parents', 'bring_children', 'hide_children', 'worksheet_id'] as const;

function readQueryFromUrl(
  defaults: QueryState,
  metas: ReadonlyArray<GridFilterMeta> = [],
  port: UrlParamsPort = windowUrlPort,
): QueryState {
  const params = port.read();

  const sortDir = params.get('sort_dir');

  // Registry filters (taxonomy_<name>, stock_status, supplier, …) prime generically from any
  // unreserved `{id}[]` param; the WP indexed form is handled by the reader. When `metas` is
  // provided, filter types with bespoke encodings (`numeric_ids` → dash-joined `?post_ids=1-2-3`)
  // are decoded via their own reader on top of the array sweep.
  const filterValues = readUnreservedFilterValuesFromParams(params, RESERVED_FILTER_PARAMS, metas);
  // Single-value deep-link alias: ?worksheet_id=<id> primes the (single-select) Worksheet filter —
  // e.g. an "open in workbench" link from worksheet management. Normalized to worksheet[] on sync.
  const worksheetId = params.get('worksheet_id');
  if (worksheetId !== null && worksheetId !== '' && filterValues.worksheet === undefined) {
    filterValues.worksheet = [worksheetId];
  }

  return {
    search: params.get('search') ?? defaults.search,
    loadSize: defaults.loadSize, // loadSize lives in localStorage, not URL
    sortBy: params.get('sort_by') ?? defaults.sortBy,
    sortDir: sortDir === 'desc' ? 'desc' : sortDir === 'asc' ? 'asc' : defaults.sortDir,
    filterValues,
    filterModifiers: readFilterModifiersFromParams(params),
    hideBroughtParents: params.get('hide_parents') === '1' || defaults.hideBroughtParents,
    bringChildren: params.get('bring_children') === '1' || defaults.bringChildren,
    // Only meaningful while bringing children in; ignore a stale flag otherwise.
    hideBroughtChildren:
      (params.get('bring_children') === '1' || defaults.bringChildren) &&
      (params.get('hide_children') === '1' || defaults.hideBroughtChildren),
  };
}

function syncQueryToUrl(
  q: QueryState,
  metas: ReadonlyArray<GridFilterMeta> = [],
  port: UrlParamsPort = windowUrlPort,
): void {
  // Start from the params the host owns so non-filter keys (standalone: WordPress's `page`) survive
  // — we only delete/set the filter keys the grid manages.
  const current = { searchParams: port.read() };

  for (const key of INVFLUX_URL_PARAMS) current.searchParams.delete(key);
  // Clear stale registry-filter params before rewriting (reserved array params kept). `metas`
  // lets the delete pass scrub bespoke encodings (`?post_ids=…` dash-joined) too — without it,
  // a stale bare key would survive into the next write.
  deleteUnreservedFilterParams(current.searchParams, RESERVED_FILTER_PARAMS, metas);
  deleteFilterModifierParams(current.searchParams);

  if (q.search.trim()) current.searchParams.set('search', q.search.trim());
  if (q.sortBy !== 'name' || q.sortDir !== 'asc') {
    current.searchParams.set('sort_by', q.sortBy);
    current.searchParams.set('sort_dir', q.sortDir);
  }
  writeFilterValuesToParams(current.searchParams, q.filterValues, metas);
  writeFilterModifiersToParams(current.searchParams, q.filterModifiers);
  if (q.hideBroughtParents) current.searchParams.set('hide_parents', '1');
  if (q.bringChildren) current.searchParams.set('bring_children', '1');
  if (q.bringChildren && q.hideBroughtChildren) current.searchParams.set('hide_children', '1');

  port.replace(current.searchParams);
}

// ─── Persistence helpers ──────────────────────────────────────────────────────

function loadLoadSize(): number {
  try {
    const raw = localStorage.getItem(LOAD_SIZE_STORAGE_KEY);
    if (raw) {
      const n = Number(raw);
      if (LOAD_SIZE_OPTIONS.includes(n)) return n;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_LOAD_SIZE;
}

function loadCollapsedProductIds(): Set<number> {
  try {
    const raw = sessionStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();

    return new Set(parsed.filter((value): value is number => Number.isInteger(value)));
  } catch {
    return new Set();
  }
}

function saveCollapsedProductIds(collapsed: Set<number>): void {
  sessionStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...collapsed]));
}

/** The reusable grid persists column visibility + order under its own namespaced localStorage keys;
 *  the export builder reads them at click time (never reactively) so the file matches what's shown. */
function readGridVisibility(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(`${GRID_STORAGE_PREFIX}cols`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'boolean') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function readGridColumnOrder(): string[] {
  try {
    const raw = localStorage.getItem(`${GRID_STORAGE_PREFIX}col_order`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string' && v !== '');
  } catch {
    return [];
  }
}

// One (datatype, role) that has ≥2 registered components → a merchant choice (§5.6).
type ComponentChoiceEntry = {
  key: string;
  dataType: string;
  role: ComponentRole;
  options: RegistrationInfo[];
};

/** Datatype/role pairs with more than one registered component — nothing until plug-ins contend. */
function choosableComponentEntries(): ComponentChoiceEntry[] {
  const registries: [ComponentRole, { dataTypes(): string[]; list(dt: string): RegistrationInfo[] }][] = [
    ['view', viewRegistry],
    ['edit', editRegistry],
    ['drilldown', drilldownRegistry],
  ];
  const entries: ComponentChoiceEntry[] = [];
  for (const [role, reg] of registries) {
    for (const dataType of reg.dataTypes()) {
      const options = reg.list(dataType);
      if (options.length >= 2) entries.push({ key: `${role}:${dataType}`, dataType, role, options });
    }
  }
  return entries;
}

/** Merchant-facing label for a component option (built-in default reads as such). */
function optionLabel(option: RegistrationInfo): string {
  if (option.label !== option.id) return option.label;
  return option.isDefault ? __('Default (built-in)') : option.id;
}

/**
 * Workbench settings panel — mounted by the app shell's contextual gear (`surfaceSettingsRegistry`,
 * §11.4) as an anchored popover, not a modal. Renders foldable {@link SettingsSection} groups:
 * **Display** (page size, applied instantly — localStorage, not the save flow) followed by one section
 * per `workbench.settings` add-on contribution (§3.4 — completes the add-on seam trio with
 * `workbench.toolbar` + the column/bulk-action registries). The niche **Cell components** chooser is a
 * separate, last-ordered panel ({@link CellComponentsPanel}) that only appears when an add-on actually
 * contends with a built-in.
 */
function WorkbenchSettingsPanel(props: {
  loadSize: number;
  loadSizeOptions: number[];
  onLoadSize: (n: number) => void;
}) {
  const settingsSections = slotRegistry.get<WorkbenchSettingsSlotProps>('workbench.settings');

  return (
    <>
      <SettingsSection title={__('Display')}>
        <label class="flex items-center justify-between gap-4">
          <span class="text-sm text-text">{__('Page size')}</span>
          <select
            class="h-9 min-w-44 rounded border border-border bg-surface px-2 text-sm shadow-sm"
            value={props.loadSize}
            onChange={(e) => props.onLoadSize(Number(e.currentTarget.value))}
          >
            <For each={props.loadSizeOptions}>{(opt) => <option value={opt}>{fmt(opt)}</option>}</For>
          </select>
        </label>
      </SettingsSection>

      {/* Add-on settings sections — each `workbench.settings` contribution gets its own foldable
          section. Empty on a core install (no add-on registered). */}
      <For each={settingsSections}>
        {(section) => (
          <Show when={section.enabled?.() ?? true}>
            <SettingsSection title={section.label?.() ?? section.id}>
              <Dynamic component={section.component} saving={false} />
            </SettingsSection>
          </Show>
        )}
      </For>
    </>
  );
}

/**
 * The §5.6 per-(datatype, role) cell-component chooser, as its own gear panel. Registered last
 * (order 100, after Data Grid) and gated so it appears **only when an add-on actually supplies an
 * alternative component** for some (datatype, role) — a niche control that's noise on a core install.
 * Save commits the choices under `workbench.component_choices` and closes the popover.
 */
function CellComponentsPanel(props: {
  entries: ComponentChoiceEntry[];
  choices: Record<string, Partial<Record<ComponentRole, string>>>;
  onSave: (next: Record<string, Partial<Record<ComponentRole, string>>>) => void;
  onRequestClose: () => void;
}) {
  const initialFor = (e: ComponentChoiceEntry): string =>
    props.choices[e.dataType]?.[e.role] ?? e.options.find((o) => o.isDefault)?.id ?? e.options[0].id;
  const [draft, setDraft] = createSignal<Record<string, string>>(
    Object.fromEntries(props.entries.map((e) => [e.key, initialFor(e)])),
  );

  function build(): Record<string, Partial<Record<ComponentRole, string>>> {
    const next: Record<string, Partial<Record<ComponentRole, string>>> = {};
    for (const e of props.entries) {
      const id = draft()[e.key];
      const isDefault = e.options.find((o) => o.isDefault)?.id === id;
      if (!isDefault) {
        next[e.dataType] = { ...(next[e.dataType] ?? {}), [e.role]: id };
      }
    }
    return next;
  }

  const roleLabel = (role: ComponentRole): string =>
    role === 'view'
      ? __('Display')
      : role === 'edit'
        ? __('Editor')
        : __('Drill-down');

  return (
    <SettingsSection title={__('Cell components')}>
      <div class="space-y-3">
        <For each={props.entries}>
          {(entry) => (
            <label class="flex items-center justify-between gap-4">
              <span class="text-sm text-text">
                {entry.dataType} <span class="text-text-muted">· {roleLabel(entry.role)}</span>
              </span>
              <select
                class="h-9 min-w-44 rounded border border-border bg-surface px-2 text-sm shadow-sm"
                value={draft()[entry.key]}
                onChange={(e) => setDraft((d) => ({ ...d, [entry.key]: e.currentTarget.value }))}
              >
                <For each={entry.options}>
                  {(option) => <option value={option.id}>{optionLabel(option)}</option>}
                </For>
              </select>
            </label>
          )}
        </For>
      </div>
      <div class="flex justify-end pt-3">
        <Button
          onClick={() => {
            props.onSave(build());
            props.onRequestClose();
          }}
        >
          {__('Save')}
        </Button>
      </div>
    </SettingsSection>
  );
}

/**
 * Worksheet management modal (Track 10). Lists worksheets (with item counts) and supports
 * create / rename / delete. When opened from the "Add to worksheet" bulk action, `subjectIds` is
 * non-empty and each worksheet (plus a freshly created one) shows an "Add N" affordance that
 * posts the selected subjects.
 */
function WorksheetsModal(props: {
  ctx: { apiRoot: string; nonce: string };
  subjectIds: number[];
  /** What the per-worksheet action does with the selection: add / remove / replace items, or pure
   *  manage (no selection — rename/delete/create only). */
  mode: 'add' | 'remove' | 'replace' | 'manage';
  /** Filter the grid down to a worksheet's members (sets the Worksheet filter) + close. */
  onFilterOn: (worksheetId: number) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [worksheets, setWorksheets] = createSignal<WorkbenchWorksheet[]>([]);
  const [newName, setNewName] = createSignal('');
  const [filterText, setFilterText] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const filtered = createMemo(() => {
    const q = filterText().trim().toLowerCase();
    return q === '' ? worksheets() : worksheets().filter((w) => w.name.toLowerCase().includes(q));
  });

  // Whether a per-worksheet item action (add/remove/replace the selection) is offered.
  const itemMode = (): boolean => props.mode !== 'manage';
  const verb = (): string =>
    props.mode === 'remove'
      ? __('Remove')
      : props.mode === 'replace'
        ? __('Replace')
        : __('Add');
  const itemMethod = (): 'POST' | 'DELETE' | 'PUT' =>
    props.mode === 'remove' ? 'DELETE' : props.mode === 'replace' ? 'PUT' : 'POST';

  async function reload(): Promise<void> {
    try {
      const res = await getJson<{ worksheets: WorkbenchWorksheet[] }>(props.ctx, '/workbench/worksheets');
      setWorksheets(res.worksheets);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  createEffect(() => {
    void reload();
  });

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
      props.onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Create + apply for add/replace (a fresh worksheet is empty, so a plain add == replace); remove
  // and manage just create the (empty) worksheet.
  const createApplies = (): boolean => props.mode === 'add' || props.mode === 'replace';

  async function createWorksheet(): Promise<void> {
    const name = newName().trim();
    if (name === '') return;
    await run(async () => {
      const res = await postJson<{ worksheet: WorkbenchWorksheet }>(props.ctx, '/workbench/worksheets', { name });
      setNewName('');
      if (createApplies()) {
        await postJson(props.ctx, `/workbench/worksheets/${res.worksheet.id}/items`, {
          subject_ids: props.subjectIds,
        });
      }
    });
    if (createApplies()) props.onClose();
  }

  const applyTo = (id: number): Promise<void> => {
    if (
      props.mode === 'replace' &&
      !window.confirm(
        sprintf(
          __("Replace this worksheet's contents with the %d selected product(s)?"),
          props.subjectIds.length,
        ),
      )
    ) {
      return Promise.resolve();
    }
    return run(async () => {
      await postJson(props.ctx, `/workbench/worksheets/${id}/items`, { subject_ids: props.subjectIds }, itemMethod());
    }).then(() => props.onClose());
  };

  const rename = (w: WorkbenchWorksheet): Promise<void> | void => {
    const name = window.prompt(__('Rename worksheet'), w.name);
    if (name === null || name.trim() === '' || name.trim() === w.name) return;
    return run(() => postJson(props.ctx, `/workbench/worksheets/${w.id}`, { name: name.trim() }, 'PATCH'));
  };

  const remove = (w: WorkbenchWorksheet): Promise<void> | void => {
    // An empty worksheet has nothing to lose → delete without a prompt; confirm only if it has items.
    if (w.itemCount > 0 && !window.confirm(__('Delete this worksheet?'))) return;
    return run(() => postJson(props.ctx, `/workbench/worksheets/${w.id}`, {}, 'DELETE'));
  };

  return (
    <Modal
      onClose={props.onClose}
      closeOnBackdrop={true}
      backdropClass="flex items-center justify-center bg-black/30 p-6"
      label={__('Worksheets')}
    >
      <div class="flex max-h-[80vh] w-full max-w-lg flex-col rounded border border-border bg-surface shadow-xl">
        <div class="border-b border-border p-5">
          <h2 class="text-lg font-semibold text-text">{__('Worksheets')}</h2>
          <Show when={itemMode()}>
            <p class="text-sm text-text-muted">
              {props.mode === 'remove'
                ? sprintf(
                    __('Remove %d selected product(s) from a worksheet'),
                    props.subjectIds.length,
                  )
                : props.mode === 'replace'
                  ? sprintf(
                      __("Replace a worksheet's contents with %d selected product(s)"),
                      props.subjectIds.length,
                    )
                  : sprintf(
                      __('Add %d selected product(s) to a worksheet'),
                      props.subjectIds.length,
                    )}
            </p>
          </Show>
        </div>

        {/* Create (top) + quick-filter, above the list. */}
        <div class="flex flex-col gap-3 border-b border-border p-5">
          <div class="flex items-center gap-2">
            <input
              class="h-9 flex-1 rounded border border-border bg-surface px-3 text-sm shadow-sm"
              placeholder={__('New worksheet name')}
              value={newName()}
              disabled={busy()}
              onInput={(e) => setNewName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createWorksheet();
              }}
            />
            <Button
              disabled={busy() || newName().trim() === ''}
              onClick={() => void createWorksheet()}
            >
              {createApplies() ? __('Create + add') : __('Create')}
            </Button>
          </div>
          <input
            class="h-9 w-full rounded border border-border bg-surface px-3 text-sm shadow-sm"
            placeholder={__('Filter worksheets…')}
            value={filterText()}
            onInput={(e) => setFilterText(e.currentTarget.value)}
          />
        </div>

        <div class="flex-1 overflow-auto p-5">
          <Show when={error()}>
            <p class="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error()}</p>
          </Show>
          <ul class="divide-y divide-border rounded border border-border">
            <For
              each={filtered()}
              fallback={
                <li class="px-3 py-2 text-sm text-text-muted">
                  {worksheets().length === 0
                    ? __('No worksheets yet.')
                    : __('No matching worksheets.')}
                </li>
              }
            >
              {(w) => (
                <li class="flex items-center justify-between gap-3 px-3 py-2">
                  <span class="min-w-0 flex-1 truncate text-sm text-text">
                    {w.name} <span class="text-text-muted">({w.itemCount})</span>
                  </span>
                  <div class="flex shrink-0 gap-2">
                    <Show when={itemMode()}>
                      <Button
                        variant={props.mode === 'remove' ? 'danger' : 'primary'}
                        weight={props.mode === 'remove' ? 'outline' : 'solid'}
                        size="sm"
                        disabled={busy()}
                        onClick={() => void applyTo(w.id)}
                      >
                        {verb()} {props.subjectIds.length}
                      </Button>
                    </Show>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy()}
                      onClick={() => props.onFilterOn(w.id)}
                      title={__("Filter the grid to this worksheet's members")}
                    >
                      {__('Filter on')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy()}
                      onClick={() => void rename(w)}
                    >
                      {__('Rename')}
                    </Button>
                    <Button
                      variant="danger"
                      weight="outline"
                      size="sm"
                      disabled={busy()}
                      onClick={() => void remove(w)}
                    >
                      {__('Delete')}
                    </Button>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </div>

        <div class="flex items-center justify-end gap-2 border-t border-border p-5">
          <Button
            variant="secondary"
            onClick={props.onClose}
          >
            {__('Close')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * The Central Workbench SPA shell. It owns the page chrome — header, filter bar + URL sync, search,
 * bulk-action menu, export, related-rows aggregation, and the surface-specific modals — and MOUNTS
 * the reusable `@invflux/ui` WorkbenchGrid for everything grid-shaped (fetch, dirty model, save +
 * on-hand correction review, live stock updates, column-state persistence, cell/row selection,
 * drill-down, bespoke columns, bulk-edit). The two communicate through the grid's prop surface:
 * the shell feeds `queryParams`/`sort`/`transformRows` in, and reads `onMeta`/`onSelectionChange`/
 * `onConflicts` + the imperative `apiRef` handles back out.
 */
export function WorkbenchGrid(
  props: {
    onDirtyChange?: (dirty: boolean) => void;
    /**
     * Where filter state lives in the address bar. Defaults to the page's real query string;
     * the unified app passes a port bound to its hash search instead.
     */
     urlPort?: UrlParamsPort;
  } = {},
) {
  const urlPort = (): UrlParamsPort => props.urlPort ?? windowUrlPort;
  const ctx = useWorkbench();

  // Merchant's chosen component id for a (datatype, role), if any (§5.4 step 1). Threaded into the
  // grid so a merchant-picked plug-in component wins over the built-in default. Held in a signal
  // (seeded from the bootstrap) so the settings panel's save reflects live.
  const [componentChoices, setComponentChoices] = createSignal<
    Record<string, Partial<Record<ComponentRole, string>>>
  >(ctx.componentChoices ?? {});
  const componentChoiceId = (dataType: string, role: ComponentRole): string | undefined =>
    componentChoices()[dataType]?.[role];
  // Worksheets modal (Track 10): null = closed; subjectIds non-empty = opened via the
  // "Add to worksheet" bulk action, empty = opened via the toolbar in manage mode.
  const [worksheetsModal, setWorksheetsModal] = createSignal<{
    subjectIds: number[];
    mode: 'add' | 'remove' | 'replace' | 'manage';
  } | null>(null);
  const [supplierAssignModal, setSupplierAssignModal] = createSignal<{ subjectIds: number[] } | null>(null);
  const [generatePoModal, setGeneratePoModal] = createSignal<{ supplierId: number; subjectIds: number[]; explicit: boolean } | null>(null);

  // Imperative handles the reusable grid registers back to the shell (apiRef).
  let focusGrid: () => void = () => {};
  let openColumnManager: () => void = () => {};
  let scrollGridToTop: () => void = () => {};
  // Reactive fetching mirror pushed from the base grid (onFetchingChange) — drives the Refresh spinner.
  const [isRefreshing, setIsRefreshing] = createSignal(false);
  let refreshGrid: () => void = () => {};
  let getSelectedCells: () => Array<{ row: WorkbenchRow; columnId: string }> = () => [];
  let loadAllPagesHandle: () => Promise<void> = async () => {};
  let selectSubjectRows: (subjectIds: number[]) => void = () => {};
  let toggleLayout: () => void = () => {};
  let openSaveReview: () => void = () => {};

  // Contribute the workbench's settings panel to the app shell's contextual gear (§11.4): while the
  // Workbench surface is active, the gear popover mounts this panel (foldable Display / Cell components
  // / add-on sections). The component closure reads this view's live state — valid because the view is
  // kept-alive, so its signals still track when the gear renders the panel in the shell's scope.
  // Registered for the view's lifetime, disposed on unmount. Harmless in the standalone page host
  // (no gear reads the registry there).
  onCleanup(
    surfaceSettingsRegistry.register({
      surfaceId: 'workbench',
      id: 'settings',
      order: 10,
      label: () => __('Settings'),
      component: () => (
        <WorkbenchSettingsPanel
          loadSize={query().loadSize}
          loadSizeOptions={LOAD_SIZE_OPTIONS}
          onLoadSize={(n) => setQuery((q) => ({ ...q, loadSize: n }))}
        />
      ),
    }),
  );
  // The §5.6 cell-component chooser is a separate, LAST panel (order 100, after the DataGrid section at
  // 90) shown only when an add-on actually supplies an alternative component — niche, so it stays out
  // of the way on a core install.
  onCleanup(
    surfaceSettingsRegistry.register({
      surfaceId: 'workbench',
      id: 'cell-components',
      order: 100,
      label: () => __('Cell components'),
      enabled: () => choosableComponentEntries().length > 0,
      component: (panelProps) => (
        <CellComponentsPanel
          entries={choosableComponentEntries()}
          choices={componentChoices()}
          onSave={(next) => void saveComponentChoices(next)}
          onRequestClose={panelProps.onRequestClose}
        />
      ),
    }),
  );

  // The empty QueryState — every URL-absent field resets to this. loadSize is a display pref (lives
  // in localStorage, not the URL), so it is carried, not reset.
  const baseDefaults = (loadSize: number): QueryState => ({
    search: '',
    loadSize,
    sortBy: 'name',
    sortDir: 'asc',
    filterValues: {},
    filterModifiers: {},
    hideBroughtParents: false,
    bringChildren: false,
    hideBroughtChildren: false,
  });
  const initialQuery = readQueryFromUrl(baseDefaults(loadLoadSize()), [], urlPort());
  const [searchInput, setSearchInput] = createSignal(initialQuery.search);
  let searchRef: HTMLInputElement | undefined;

  // One-step "undo the hand-off": when a cross-surface deep-link (a "See in workbench" link) replaces
  // a non-default filter in an ALREADY-OPEN Workbench, we snapshot the pre-hand-off state here so a
  // chip can restore it. Deliberately NOT a full history stack — just the single filter the hand-off
  // overwrote, cleared once restored / dismissed / superseded by the next hand-off.
  const [priorFilter, setPriorFilter] = createSignal<QueryState | null>(null);
  const restorePriorFilter = (): void => {
    const prev = priorFilter();
    if (null === prev) return;
    setQuery(prev);
    setSearchInput(prev.search);
    setPriorFilter(null);
    focusGrid();
  };
  // The toolbar form scopes the FilterBar keyboard cycle so it spans Search + the display toggles +
  // the Add-filter slot + chips (one contained Tab loop; Escape exits to the grid).
  let toolbarRef: HTMLFormElement | undefined;
  const [query, setQuery] = createSignal<QueryState>(initialQuery);
  const [collapsedProductIds, setCollapsedProductIds] = createSignal<Set<number>>(loadCollapsedProductIds());

  // Server metadata + result counts surfaced by the grid's single fetch via `onMeta` — the shell
  // relies on that one fetch and runs no products query of its own. Kept stable (last non-empty) so
  // a background refetch never blanks the filter bar / columns mid-render.
  const [stableFilters, setStableFilters] = createSignal<GridFilterMeta[]>([]);
  const [stableTaxonomySpace, setStableTaxonomySpace] = createSignal<TaxonomySpace>();
  const [stableColumns, setStableColumns] = createSignal<WorkbenchColumnMeta[]>([]);
  const [totalCount, setTotalCount] = createSignal(0);
  const [loadedCount, setLoadedCount] = createSignal(0);
  // Mirrors of grid state the shell renders in its own bar (the grid's toolbar is hidden here).
  const [gridDirty, setGridDirty] = createSignal(false);
  const [layoutInfo, setLayoutInfo] = createSignal<{ layout: 'grid' | 'record'; canToggle: boolean }>({
    layout: 'grid',
    canToggle: false,
  });
  // The row-checkbox selection (as subject ids), surfaced by the grid via `onSelectionChange`.
  const [selectedSubjectIds, setSelectedSubjectIds] = createSignal<number[]>([]);
  // The grid's fetched + live-merged row set, captured inside `transformRows` (deferred write, so we
  // never mutate a signal mid-computation). Drives the shell-only derivations that need the raw rows:
  // the `*`-fold family lookup + the replenishment-PO all-visible sweep.
  const [loadedRows, setLoadedRows] = createSignal<WorkbenchRow[]>([]);

  createEffect(() => {
    localStorage.setItem(LOAD_SIZE_STORAGE_KEY, String(query().loadSize));
  });
  // Snapshot the URL at mount so the bespoke re-read below sees the original deep-link state even
  // after the sync effect has overwritten the live URL.
  const initialUrlParams = urlPort().read();

  // One-shot re-read when server metadata first arrives: filters with bespoke URL encodings
  // (`numeric_ids` → dash-joined) couldn't be parsed at initial mount because the encoding requires
  // knowing the filter's type. Re-decode the snapshot with the metas now in hand and merge any
  // newly-discovered values into the query state. REGISTERED BEFORE THE SYNC EFFECT so that when
  // both fire on the same stableFilters change, this one runs first and the sync sees an updated
  // query state instead of stripping the URL on its way to writing nothing back.
  let bespokeRereadDone = false;
  let settled = false;
  createEffect(() => {
    const metas = stableFilters();
    if (bespokeRereadDone || metas.length === 0) return;
    bespokeRereadDone = true;
    // Mount settle is complete: the deep-link's bespoke filters have had their one chance to decode.
    // The external-resync watch below stays inert until now, so it never re-applies the URL that the
    // sync effect transiently wipes to empty during mount (which would clobber this very merge).
    settled = true;
    const bespokeTypes = new Set(['numeric_ids']);
    const relevant = metas.filter((m) => bespokeTypes.has(m.type));
    if (relevant.length === 0) return;
    const decoded = readUnreservedFilterValuesFromParams(initialUrlParams, RESERVED_FILTER_PARAMS, relevant);
    const missing: Record<string, string[]> = {};
    for (const m of relevant) {
      const vals = decoded[m.id];
      if (vals !== undefined && vals.length > 0 && (query().filterValues[m.id] ?? []).length === 0) {
        missing[m.id] = vals;
      }
    }
    if (Object.keys(missing).length === 0) return;
    setQuery((q) => ({ ...q, filterValues: { ...q.filterValues, ...missing } }));
  });

  // Remember our own last write so the external-resync effect below can tell an outside change
  // (a cross-surface deep-link into an already-open Workbench) from our own echo.
  let lastWritten = '';
  createEffect(() => {
    // Track ONLY the query + server metas. syncQueryToUrl reads the live params (to preserve foreign
    // keys) and writes the URL — if that read were tracked, an EXTERNAL url change (a cross-surface
    // deep-link into an already-open Workbench) would re-fire this effect with the still-stale query
    // and clobber the incoming URL back to empty before the watch effect below can apply it. So the
    // read+write run untracked: this effect is one-directional, query → URL.
    const q = query();
    const metas = stableFilters();
    const port = urlPort();
    untrack(() =>
      syncQueryToUrl(q, metas, {
        read: port.read,
        replace: (params) => {
          lastWritten = params.toString();
          port.replace(params);
        },
      }),
    );
  });

  // Embedded hosts can change our params from the outside while we stay mounted (keep-alive) — a
  // cross-surface deep-link into an already-open Workbench. Re-read and re-apply when that happens.
  // `watch` is absent standalone, where the URL only changes via us.
  //
  // This effect must react to the URL ONLY. Reading `query()` in a tracked position would make it
  // re-run on its own `setQuery`, and since `readQueryFromUrl` allocates a fresh object every time
  // (never ===), that is an unconditional infinite loop — surfaced by the router as "Too many
  // redirects" once the sync effect starts firing a navigate per turn. So `query()` is read only
  // under `untrack`, and we skip the write unless the incoming URL genuinely decodes to a different
  // query than the one we already hold.
  const querySig = (q: QueryState): string =>
    JSON.stringify([q.search, q.sortBy, q.sortDir, q.filterValues, q.filterModifiers, q.hideBroughtParents, q.bringChildren, q.hideBroughtChildren]);
  createEffect(
    on(
      // Track the URL ONLY — not query() (self-write loop) nor stableFilters() (would re-fire on
      // metas load and re-apply a transiently-wiped URL over the mount one-shot's merge).
      () => urlPort().watch?.(),
      (incoming) => {
        if (!settled || undefined === incoming || incoming === lastWritten) return;
        untrack(() => {
          // Pass BASE defaults, not query(): readQueryFromUrl falls back to `defaults` for any
          // URL-absent field (search / sort / bring_children), so passing the current query would
          // PRESERVE those (merge) instead of clearing them. An external nav is a full replace — the
          // incoming URL is the whole intended state — so absent fields must reset to base. (Registry
          // filters already replace, being read fresh from the URL with no defaults fallback.)
          const next = readQueryFromUrl(baseDefaults(query().loadSize), stableFilters(), {
            read: () => new URLSearchParams(incoming),
            replace: () => {},
          });
          if (querySig(next) !== querySig(query())) {
            // If the filter being overwritten was non-default, this is a hand-off worth undoing —
            // snapshot it so the "Restore previous filter" chip can bring it back one step. (Compared
            // via querySig, which ignores loadSize, so a mere page-size change never counts as a
            // filter.) A fresh-mount hand-off never reaches here — the watch stays inert until
            // `settled` — so we only snapshot when an already-open Workbench's filter is replaced.
            const current = query();
            if (querySig(current) !== querySig(baseDefaults(current.loadSize))) {
              setPriorFilter(current);
            }
            setQuery(next);
            // `search` lives in an independent draft signal (the debounced input box); resetting only
            // `query` would leave the stale draft to re-inject the old search on its next tick — so an
            // external nav that clears/changes search (a "See in workbench" hand-off, browser Back)
            // would silently keep the previous SKU and intersect it with the incoming filter, often
            // to an empty grid. Reset the draft to match the incoming URL.
            setSearchInput(next.search);
          }
        });
      },
    ),
  );
  createEffect(() => {
    saveCollapsedProductIds(collapsedProductIds());
  });

  // Scroll to top whenever the result set changes (search / sort / filters / page size) — NOT for
  // client-only display toggles like hideBroughtParents (which would otherwise jump the user back
  // to the top on every check).
  const scrollResetKey = createMemo(() => {
    const q = query();
    return JSON.stringify([q.search, q.sortBy, q.sortDir, q.loadSize, q.filterValues, q.filterModifiers, q.bringChildren]);
  });
  createEffect(
    on(scrollResetKey, () => {
      scrollGridToTop();
    }, { defer: true }),
  );

  // Re-query the server SEARCH_DEBOUNCE_MS after the last keystroke (the transformRows loaded-set
  // filter gives instant feedback in the meantime). Enter still applies immediately via the form submit.
  createEffect(
    on(searchInput, (draft) => {
      const trimmed = draft.trim();
      if (trimmed === query().search.trim()) return;
      const timer = setTimeout(() => setQuery((q) => ({ ...q, search: trimmed })), SEARCH_DEBOUNCE_MS);
      onCleanup(() => clearTimeout(timer));
    }),
  );

  // ── Query params for the grid's fetch — the EXACT encoding the server expects ──
  // Registry filter values via the shared bridge writer (numeric_ids → dash-joined `post_ids`,
  // everything else → array shape), plus `search` and the `bring_children` server opt-in, plus the
  // literal-bracket `fmod[id][key]` modifiers. Sort is passed separately (`sort` prop); the
  // client-side `hide_parents`/`hide_children` display toggles are NOT sent (transformRows owns them).
  const buildQueryParams = (): Record<string, string | string[]> => {
    const q = query();
    const params: Record<string, string | string[]> = {};
    const tmp = new URLSearchParams();
    writeFilterValuesToParams(tmp, q.filterValues, stableFilters());
    for (const key of new Set(tmp.keys())) {
      const all = tmp.getAll(key);
      params[key] = all.length > 1 ? all : (all[0] ?? '');
    }
    if (q.search.trim() !== '') params['search'] = q.search.trim();
    if (q.bringChildren) params['bring_children'] = '1';
    for (const [id, mods] of Object.entries(q.filterModifiers)) {
      for (const [key, value] of Object.entries(mods)) params[`fmod[${id}][${key}]`] = value;
    }
    return params;
  };

  // ── Related-rows display transform (variable-parent aggregation + collapse/expand fold +
  // brought-with hiding). The grid owns fetch + live-merge and calls this on the merged rows; the
  // shell keeps the collapse state + the fold toggles here. Operates on WorkbenchRow (the grid's row
  // type) — every field it reads (atp/res/ctd/total, wcProductId/wcVariationId, productType,
  // reorderThreshold, extra.orders, matched, name, sku) is present on WorkbenchRow. ──
  const isVariableParent = (p: WorkbenchRow): boolean =>
    p.productType === 'variable' && p.wcVariationId === null;

  // A "unit" is a sellable/purchasable leaf — a simple product or a single variation. Variable parents,
  // grouped and external products are NOT purchasable (only their variations, or nothing, are), so
  // they can't be added to a supplier catalog or a replenishment PO.
  const isPurchasableUnit = (p: WorkbenchRow): boolean =>
    p.productType === 'simple' || p.role === 'variation';

  // Narrow an arbitrary subject-id scope to the purchasable units within it (drops variable parents,
  // groups, externals). Used by the supplier-catalog / PO actions so they work off whatever scope the
  // caller passes — the row selection (toolbar) OR the cell-derived scope (right-click on selected cells).
  const unitSubjectIdsFrom = (ids: number[]): number[] => {
    const byId = new Map(loadedRows().map((r) => [r.subjectId, r]));
    return ids.filter((id) => {
      const r = byId.get(id);
      return r !== undefined && isPurchasableUnit(r);
    });
  };

  // The current row-selection narrowed to purchasable units (toolbar bulk-action variant).
  const selectedUnitSubjectIds = createMemo<number[]>(() => unitSubjectIdsFrom(selectedSubjectIds()));

  function transformDisplayRows(input: WorkbenchRow[]): WorkbenchRow[] {
    // Pagination can split a variable-product group across a page boundary, so the server re-includes the
    // parent as a brought-with CONTEXT row (matched=false) on the later page so its variations there have
    // a fold-home. Drop those duplicate parent rows — keep ONE parent per product (preferring the matched
    // primary) — so the group renders once with all its variations flowing under the single parent.
    const hasMatchedParent = new Set<number>();
    for (const p of input) if (p.wcVariationId === null && p.matched !== false) hasMatchedParent.add(p.wcProductId);
    const seenParent = new Set<number>();
    const rows: WorkbenchRow[] = [];
    for (const p of input) {
      if (p.wcVariationId === null) {
        if (seenParent.has(p.wcProductId)) continue; // already emitted this parent
        if (hasMatchedParent.has(p.wcProductId) && p.matched === false) continue; // wait for the matched one
        seenParent.add(p.wcProductId);
      }
      rows.push(p);
    }

    const childrenMap = new Map<number, WorkbenchRow[]>();
    for (const p of rows) {
      if (p.wcVariationId === null) continue;
      const list = childrenMap.get(p.wcProductId) ?? [];
      list.push(p);
      childrenMap.set(p.wcProductId, list);
    }

    const collapsed = collapsedProductIds();
    const q = query();
    const sortBy = q.sortBy;
    // "Hide brought-in parents": effective when the user toggles it OR a unit-only sort is active.
    const hideParentsActive = q.hideBroughtParents || UNIT_ONLY_SORT_COLUMNS.includes(sortBy);
    // Aggregate / non-unit rows: variable parents AND grouped products — neither is a sellable unit
    // and both are value-less for a unit-only sort (price).
    const isAggregateRow = (p: WorkbenchRow): boolean =>
      p.wcVariationId === null && (p.productType === 'variable' || p.productType === 'grouped');
    const sortNull = (p: WorkbenchRow): boolean => {
      const v = workbenchValueFor(p, sortBy);
      return v === null || v === undefined || v === '';
    };
    const isHiddenParent = (p: WorkbenchRow): boolean =>
      hideParentsActive && isAggregateRow(p) && (p.matched === false || sortNull(p));
    const isHiddenChild = (p: WorkbenchRow): boolean =>
      q.hideBroughtChildren && p.wcVariationId !== null && p.matched === false;

    // Instant client narrowing on the loaded set (before the debounced server re-query lands).
    const needle = searchInput().trim().toLowerCase();
    const matchesNeedle = (p: WorkbenchRow): boolean =>
      p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle);
    const hiddenParentIds = new Set(rows.filter(isHiddenParent).map((p) => p.wcProductId));
    const parentMatchesNeedle = new Set(
      needle === ''
        ? []
        : rows.filter((p) => p.wcVariationId === null && matchesNeedle(p)).map((p) => p.wcProductId),
    );

    const aggregateParent = (product: WorkbenchRow): WorkbenchRow => {
      const children = childrenMap.get(product.wcProductId) ?? [];
      if (children.length === 0) return product;
      const atp = children.reduce((sum, c) => sum + c.atp, 0);
      const res = children.reduce((sum, c) => sum + c.res, 0);
      const ctd = children.reduce((sum, c) => sum + c.ctd, 0);
      // Roll the children's open-order counts up onto the synthetic parent row. The count rides in the
      // `extra` bag under the "orders" column id (generic `link` datatype). A parent has no single sku
      // or subject of its own, so its Orders link filters the dispatch queue by ALL its variations'
      // subject ids (`orders_subject_ids`, dash-joined) — the LinkView builds that query client-side.
      const orderChildren = children.filter((c) => typeof c.extra?.orders === 'number' && c.extra.orders > 0);
      const totalOrderCount = orderChildren.reduce((sum, c) => sum + (c.extra?.orders as number), 0);
      const orderSubjectIds = orderChildren.map((c) => c.subjectId).join('-');
      return {
        ...product,
        atp,
        res,
        ctd,
        total: atp + res + ctd,
        reorderStatus: reorderStatusFor(atp, product.reorderThreshold),
        extra: {
          ...(product.extra ?? {}),
          orders: totalOrderCount > 0 ? totalOrderCount : undefined,
          orders_subject_ids: totalOrderCount > 0 ? orderSubjectIds : undefined,
        },
      };
    };

    return rows
      .filter((product) => {
        if (product.wcVariationId === null) return !isHiddenParent(product); // hide context parents
        if (isHiddenChild(product)) return false; // hide brought-in (context) variations
        // A variation is hidden by collapse ONLY when its parent is shown; under a hidden parent it
        // shows flat.
        return !collapsed.has(product.wcProductId) || hiddenParentIds.has(product.wcProductId);
      })
      .filter((product) => {
        if (needle === '' || matchesNeedle(product)) return true;
        // Keep a variable parent whose any loaded variation matches (the group anchor survives the
        // instant client filter during an active search).
        if (isVariableParent(product)) {
          return (childrenMap.get(product.wcProductId) ?? []).some(matchesNeedle);
        }
        // Keep a loaded variation whose parent matches the needle (a parent-SKU search + bring-in).
        if (product.wcVariationId !== null) return parentMatchesNeedle.has(product.wcProductId);
        return false;
      })
      .map((product) => (isVariableParent(product) ? aggregateParent(product) : product));
  }

  // The prop the grid calls: capture the raw merged rows for the shell (deferred so we don't write a
  // signal during the grid's `rows` memo), then return the display set.
  const transformRows = (rows: WorkbenchRow[]): WorkbenchRow[] => {
    queueMicrotask(() => setLoadedRows(rows));
    return transformDisplayRows(rows);
  };

  // ── Collapse / fold (shell-owned) ──
  const childrenByProductId = createMemo(() => {
    const map = new Map<number, WorkbenchRow[]>();
    for (const product of loadedRows()) {
      if (product.wcVariationId === null) continue;
      const children = map.get(product.wcProductId) ?? [];
      children.push(product);
      map.set(product.wcProductId, children);
    }
    return map;
  });

  /** `*` — expand-biased fold toggle over the selection's parents: a variation → its parent, a
   *  variable parent (with loaded children) → itself; if any target is collapsed, expand all,
   *  otherwise collapse all. Reads the grid's current cell selection via the apiRef handle. */
  // Fold/unfold a set of variable parents (expand-biased: if any is collapsed, expand all; else
  // collapse all), then re-target the cell selection to exactly the rows just folded/unfolded — each
  // parent, plus its variations when expanding — once the changed display set has re-rendered.
  function applyFold(parentProductIds: number[]): void {
    if (parentProductIds.length === 0) return;
    const collapsed = collapsedProductIds();
    const expand = parentProductIds.some((id) => collapsed.has(id));
    setCollapsedProductIds((current) => {
      const next = new Set(current);
      for (const id of parentProductIds) {
        if (expand) next.delete(id);
        else next.add(id);
      }
      return next;
    });
    const kids = childrenByProductId();
    const parentRowByPid = new Map<number, WorkbenchRow>();
    for (const r of loadedRows()) if (r.wcVariationId === null) parentRowByPid.set(r.wcProductId, r);
    const targets: number[] = [];
    for (const pid of parentProductIds) {
      const parent = parentRowByPid.get(pid);
      if (parent) targets.push(parent.subjectId);
      if (expand) for (const c of kids.get(pid) ?? []) targets.push(c.subjectId);
    }
    // After the collapse change re-renders the row set (Solid runs the grid's rows memo synchronously),
    // set the selection to those rows' new indices.
    queueMicrotask(() => selectSubjectRows(targets));
  }

  function toggleFoldSelection(): void {
    const ids = new Set<number>();
    for (const { row } of getSelectedCells()) {
      if (row.wcVariationId !== null) {
        ids.add(row.wcProductId); // variation → its (foldable) parent
      } else if (row.productType === 'variable' && (childrenByProductId().get(row.wcProductId)?.length ?? 0) > 0) {
        ids.add(row.wcProductId); // variable parent
      }
    }
    applyFold([...ids]);
  }

  // ── Export (visible columns, in order, matching what's on screen) ──
  const exportColumnIds = (): string[] => {
    const metaById = new Map(stableColumns().map((m) => [m.id, m]));
    const vis = readGridVisibility();
    const ordered = readGridColumnOrder().filter((id) => metaById.has(id) && vis[id] !== false);
    const seen = new Set(ordered);
    for (const m of stableColumns()) {
      if (!seen.has(m.id) && vis[m.id] !== false) ordered.push(m.id);
    }
    return ordered.filter((id) => id !== 'select' && id !== 'orders');
  };

  // Build the nonce'd export URL from the grid's CURRENT view (same filter/search/sort encoding as
  // the fetch) + format + visible columns + the optional selection.
  const buildExportUrl = (format: 'csv' | 'xlsx' | 'json' | 'jsonl', subjectIds: number[]): string => {
    const url = new URL(`${ctx.apiRoot.replace(/\/$/, '')}/invflux/v1/workbench/export`);
    url.searchParams.set('format', format);
    const cols = exportColumnIds();
    if (cols.length > 0) url.searchParams.set('columns', cols.join(','));
    if (subjectIds.length > 0) url.searchParams.set('subject_ids', subjectIds.join(','));
    const state = query();
    if (state.search.trim() !== '') url.searchParams.set('search', state.search.trim());
    url.searchParams.set('sort_by', state.sortBy);
    url.searchParams.set('sort_dir', state.sortDir);
    // Mirror the grid's brought-in display state so the export row set matches what's on screen.
    if (state.bringChildren) url.searchParams.set('bring_children', '1');
    if (state.hideBroughtParents) url.searchParams.set('hide_parents', '1');
    if (state.hideBroughtChildren) url.searchParams.set('hide_children', '1');
    writeFilterValuesToParams(url.searchParams, state.filterValues, stableFilters());
    for (const [id, mods] of Object.entries(state.filterModifiers)) {
      for (const [key, value] of Object.entries(mods)) url.searchParams.append(`fmod[${id}][${key}]`, value);
    }
    url.searchParams.set('_wpnonce', ctx.nonce);
    return url.toString();
  };

  const triggerDownload = (url: string): void => {
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // Fetch every remaining page (so loaded === total) — e.g. before a full-selection or a
  // what-you-see export. Delegates to the grid's `loadAllPages` handle.
  const [loadingAllPages, setLoadingAllPages] = createSignal(false);
  const loadAll = async (): Promise<void> => {
    if (loadingAllPages()) return;
    setLoadingAllPages(true);
    try {
      await loadAllPagesHandle();
    } finally {
      setLoadingAllPages(false);
    }
  };

  // ── Bulk actions (§2): register the workbench's own through the shared registry ──
  const needsSelection = (bctx: BulkActionContext): string | undefined =>
    bctx.selectedSubjectIds.length > 0 ? undefined : __('Select one or more products first');
  bulkActionRegistry.register({
    id: 'add-to-worksheet',
    label: __('Add to worksheet…'),
    order: 100,
    disabledReason: needsSelection,
    run: (bctx) => setWorksheetsModal({ subjectIds: bctx.selectedSubjectIds, mode: 'add' }),
  });
  bulkActionRegistry.register({
    id: 'remove-from-worksheet',
    label: __('Remove from worksheet…'),
    order: 101,
    disabledReason: needsSelection,
    run: (bctx) => setWorksheetsModal({ subjectIds: bctx.selectedSubjectIds, mode: 'remove' }),
  });
  bulkActionRegistry.register({
    id: 'replace-worksheet',
    label: __('Replace worksheet content…'),
    order: 102,
    disabledReason: needsSelection,
    run: (bctx) => setWorksheetsModal({ subjectIds: bctx.selectedSubjectIds, mode: 'replace' }),
  });
  bulkActionRegistry.register({
    id: 'add-to-supplier',
    label: __('Add to supplier catalog…'),
    // Ordered after the worksheet group (100–102) so the three worksheet actions stay together.
    order: 110,
    // Only purchasable units can be sourced from a supplier; enabled when the selection has ≥1 unit
    // (non-units are dropped on run). Disabled with a hint when nothing (or only non-units) is selected.
    disabledReason: (bctx) => {
      if (bctx.selectedSubjectIds.length === 0) return __('Select one or more products first');
      return unitSubjectIdsFrom(bctx.selectedSubjectIds).length > 0
        ? undefined
        : __('Only sellable units can be added to a supplier catalog (not variable parents, groups or externals)');
    },
    run: (bctx) => setSupplierAssignModal({ subjectIds: unitSubjectIdsFrom(bctx.selectedSubjectIds) }),
  });
  // "Create replenishment PO" — only when a **single** supplier is filtered (so supplier X is
  // unambiguous). Scope = selected rows, else all visible rows. Reuses the server replenishment
  // suggester + review-draft path (free-po-management §9 Path A/B).
  bulkActionRegistry.register({
    id: 'generate-po',
    label: __('Create replenishment PO…'),
    order: 120,
    disabledReason: () => {
      const vals = query().filterValues['supplier'];
      return !!vals && vals.length === 1 ? undefined : __('Filter on a single supplier first');
    },
    run: (bctx) => {
      const vals = query().filterValues['supplier'];
      if (!vals || vals.length !== 1) return;
      const supplierId = Number(vals[0]);
      if (!Number.isFinite(supplierId)) return;
      // Selected rows = an explicit "order these" (include each, MOQ-floored even if not short).
      // No selection = an all-visible replenishment sweep (only what's short/in-deficit).
      // Either way, restrict to purchasable units — variable parents / groups / externals can't be POed.
      const explicit = bctx.selectedSubjectIds.length > 0;
      const subjectIds = explicit
        ? selectedUnitSubjectIds()
        : [...new Set(loadedRows().filter((p) => p.matched !== false && isPurchasableUnit(p)).map((p) => p.subjectId))];
      if (subjectIds.length === 0) {
        toast.error(__("No purchasable units in the selection — variable parents, groups and externals can't be ordered."));
        return;
      }
      setGeneratePoModal({ supplierId, subjectIds, explicit });
    },
  });
  bulkActionRegistry.register({
    id: 'export',
    label: __('Export…'),
    order: 130,
    // Available with NO selection too — the scope is then the whole filtered view.
    isEnabled: () => totalCount() > 0,
    // The menu renders "export" as a format submenu (Excel / CSV), so `run` is never invoked for it
    // (bulkMenuItems special-cases the id). Kept for registry completeness / non-menu callers.
    run: () => {},
  });
  const bulkCtx = createMemo<BulkActionContext>(() => ({
    selectedSubjectIds: selectedSubjectIds(),
    activeFilters: {
      filterValues: query().filterValues,
      filterModifiers: query().filterModifiers,
      search: query().search,
    },
  }));
  const availableBulkActions = createMemo(() =>
    bulkActionRegistry.list().filter((a) => (a.isEnabled ? a.isEnabled(bulkCtx()) : true)),
  );
  // Applicable bulk actions → DropdownMenu items. Two actions are presented as submenus:
  //   • the three worksheet actions collapse into "Act on worksheet ▸ Add to / Remove from / Replace",
  //   • "export" becomes a format submenu (Excel / CSV free; JSON / JSONL Pro-gated).
  // Build the bulk-action menu tree for a given subject scope. Used both by the toolbar menu (scope =
  // the checkbox row selection) and the right-click context menu (scope = the cell-selected rows).
  const buildBulkMenuItems = (scopeIds: number[]): DropdownMenuItem[] => {
    const worksheetLabels: Record<string, string> = {
      'add-to-worksheet': __('Add to…'),
      'remove-from-worksheet': __('Remove from…'),
      'replace-worksheet': __('Replace content of…'),
    };
    const ctxNow: BulkActionContext = {
      selectedSubjectIds: scopeIds,
      activeFilters: {
        filterValues: query().filterValues,
        filterModifiers: query().filterModifiers,
        search: query().search,
      },
    };
    const structuredAllowed = ctx.entitlements?.exportStructured ?? false;
    const upgradeTip = __('Upgrade to InvFlux Pro');
    const items: DropdownMenuItem[] = [];
    let worksheetEmitted = false;
    for (const action of availableBulkActions()) {
      const reason = action.disabledReason?.(ctxNow);
      if (action.id in worksheetLabels) {
        // Emit the grouped submenu once, at the position of the first worksheet action (order 100).
        if (worksheetEmitted) continue;
        worksheetEmitted = true;
        items.push({
          id: 'worksheet',
          label: __('Act on worksheet…'),
          disabled: !!reason,
          tooltip: reason,
          children: availableBulkActions()
            .filter((a) => a.id in worksheetLabels)
            .map((a): DropdownMenuItem => ({
              id: a.id,
              label: worksheetLabels[a.id],
              run: () => a.run(ctxNow),
            })),
        });
        continue;
      }
      if (action.id === 'export') {
        const scope = (): number[] => scopeIds;
        const proLeaf = (id: string, label: string, format: 'json' | 'jsonl'): DropdownMenuItem => ({
          id,
          label,
          disabled: !structuredAllowed,
          tooltip: structuredAllowed ? undefined : upgradeTip,
          run: () => triggerDownload(buildExportUrl(format, scope())),
        });
        items.push({
          id: 'export',
          label:
            scopeIds.length > 0
              ? __('Export to…')
              : sprintf(__('Export all %d…'), loadedCount()),
          children: [
            {
              id: 'export-xlsx',
              label: __('Excel (.xlsx)'),
              run: () => triggerDownload(buildExportUrl('xlsx', scope())),
            },
            {
              id: 'export-csv',
              label: __('CSV (.csv)'),
              run: () => triggerDownload(buildExportUrl('csv', scope())),
            },
            proLeaf('export-json', __('JSON (.json)'), 'json'),
            proLeaf('export-jsonl', __('JSON Lines (.jsonl)'), 'jsonl'),
          ],
        });
        continue;
      }
      items.push({
        id: action.id,
        label: action.label,
        disabled: !!reason,
        tooltip: reason,
        run: () => action.run(ctxNow),
      });
    }
    return items;
  };
  const bulkMenuItems = createMemo<DropdownMenuItem[]>(() => buildBulkMenuItems(selectedSubjectIds()));

  // Convert the toolbar bulk-menu tree (DropdownMenuItem) to the context-menu shape (DataGridMenuItem),
  // recursively (tooltip → title). Lets the right-click "Bulk actions ▸" reuse the SAME nested tree
  // (Act on worksheet ▸ …, Export ▸ …) as the toolbar menu.
  const toMenuItem = (d: DropdownMenuItem): DataGridMenuItem => ({
    id: d.id,
    label: d.label,
    disabled: d.disabled,
    title: d.tooltip,
    run: d.run,
    children: d.children?.map(toMenuItem),
  });

  // ── Filter bar descriptors (registry-driven, via the shared bridge) ──
  const filterChips = createMemo<FilterDescriptor[]>(() =>
    gridFiltersToDescriptors(
      stableFilters(),
      () => query().filterValues,
      (id, values) => setQuery((qq) => ({ ...qq, filterValues: { ...qq.filterValues, [id]: values } })),
      {
        summarize: summarizeSelected,
        optionsFor: (meta) => {
          if (!meta.id.startsWith('taxonomy_')) return meta.options;
          const tax = stableTaxonomySpace()?.[meta.id.slice('taxonomy_'.length)];
          if (!tax) return [];
          return Object.values(tax.values).map((v) => ({ value: v.code, label: v.name, depth: v.depth }));
        },
        modifiers: () => query().filterModifiers,
        setModifier: (id, key, value) =>
          setQuery((qq) => ({
            ...qq,
            filterModifiers: { ...qq.filterModifiers, [id]: { ...qq.filterModifiers[id], [key]: value } },
          })),
        // A chip can carry match logic (any/all/none), a measurement scope (which slots a stock
        // level counts), or neither — never both today, but rendering both keeps the seam open.
        // eslint-disable-next-line solid/no-destructure -- render-prop callback parameter, not component props.
        extraFor: ({ meta, mode, setMode, scopes, setScopes }) => (
          <>
            <Show when={(meta.modes?.length ?? 0) > 0}>
              <FilterModeToggle modes={meta.modes ?? []} value={mode} onChange={setMode} />
            </Show>
            <Show when={(meta.scopes?.length ?? 0) > 0}>
              <FilterScopePicker scopes={meta.scopes ?? []} value={scopes} onChange={setScopes} />
            </Show>
          </>
        ),
      },
    ),
  );

  // ── Sticky conflict toast (from the grid's onConflicts) ──
  // The grid owns the dirty model + retry, so this is a host-level heads-up: a sticky toast summarising
  // how many rows need review. (Dropping the staged edits is the grid's own concern; there's no
  // host API into its dirty model, so the action just dismisses the toast.)
  let conflictToastId: number | null = null;
  function clearConflictToast(): void {
    if (conflictToastId !== null) {
      toast.dismiss(conflictToastId);
      conflictToastId = null;
    }
  }
  function handleConflicts(conflicts: ReadonlyArray<{ subject_id: number }>): void {
    clearConflictToast();
    if (conflicts.length === 0) return;
    const n = new Set(conflicts.map((c) => c.subject_id)).size;
    conflictToastId = toast.error(
      sprintf(
        /* translators: %d = number of rows whose values changed on the server and need review. */
        _n(
          '%d change needs review — the value changed on the server; adjust and save again.',
          '%d changes need review — values changed on the server; adjust and save again.',
          n,
        ),
        n,
      ),
      { duration: 0, action: { label: __('Dismiss'), onClick: () => clearConflictToast() } },
    );
  }

  // Persist the merchant's component choices (§5.6) and reflect them live in the grid.
  async function saveComponentChoices(
    next: Record<string, Partial<Record<ComponentRole, string>>>,
  ): Promise<void> {
    try {
      await postJson(ctx, '/workbench/settings/component-choices', next);
      setComponentChoices(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  function submitSearch(e: SubmitEvent): void {
    e.preventDefault();
    setQuery((q) => ({ ...q, search: searchInput() }));
  }

  return (
    <div
      class="invflux-workbench flex flex-col bg-surface-raised text-text"
      style={{'height':'calc(100vh - 46px)'}}
    >
      {/* No title bar: the surface name lives on the active tab / WP menu, so a header that only
          repeated it was pure vertical cost. Its former controls now sit in their natural homes —
          Refresh on the filter row, Worksheets + Columns + the plug-in toolbar slot on the bulk bar,
          and Settings (⚙) in the app shell's contextual gear (registered above via
          surfaceSettingsRegistry). */}

      {/* ── Worksheets management / add-to-worksheet (Track 10) ── */}
      <Show when={worksheetsModal()}>
        {(modal) => (
          <WorksheetsModal
            ctx={ctx}
            subjectIds={modal().subjectIds}
            mode={modal().mode}
            onFilterOn={(worksheetId) => {
              setQuery((q) => ({
                ...q,
                filterValues: { ...q.filterValues, worksheet: [String(worksheetId)] },
              }));
              setWorksheetsModal(null);
            }}
            onClose={() => setWorksheetsModal(null)}
            onChanged={() => refreshGrid()}
          />
        )}
      </Show>

      {/* ── Add selected products to a supplier's catalogue ── */}
      <Show when={supplierAssignModal()}>
        {(modal) => (
          <SupplierAssignModal
            ctx={ctx}
            subjectIds={modal().subjectIds}
            onClose={() => setSupplierAssignModal(null)}
            onAssigned={() => refreshGrid()}
          />
        )}
      </Show>

      {/* ── Create a replenishment PO for the single filtered supplier ── */}
      <Show when={generatePoModal()}>
        {(modal) => (
          <GeneratePoModal
            ctx={ctx}
            supplierId={modal().supplierId}
            subjectIds={modal().subjectIds}
            explicit={modal().explicit}
            onClose={() => setGeneratePoModal(null)}
          />
        )}
      </Show>

      {/* Component-choice settings (§5.6) now live in the app shell's gear popover — the workbench
          registers `WorkbenchSettingsPanel` via surfaceSettingsRegistry (see the registration above),
          so there's no in-view modal to render here. */}

      {/* ── Search + related-rows bar ── */}
      <form
        ref={toolbarRef}
        class="flex flex-wrap items-start gap-3 border-b border-border bg-surface px-5 py-3 shrink-0"
        onSubmit={submitSearch}
      >
        <input
          ref={searchRef}
          data-fb-cycle
          class="h-9 w-80 self-end rounded border border-border bg-surface px-3 text-sm shadow-sm"
          type="search"
          value={searchInput()}
          aria-label={__('Filter on product name or SKU')}
          placeholder={__('Filter on product name or SKU')}
          onInput={(e) => setSearchInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            // Esc returns focus to the grid (a second way back, alongside Shift+numpad-/).
            if (e.key === 'Escape') {
              e.preventDefault();
              focusGrid();
            }
          }}
        />
        {/* Page size lives in the ⚙ Settings menu. Related rows: "Hide brought-in parents/children"
            are CLIENT-side display filters over context rows (brought-with `matched===false` /
            value-less for the sort); parents always load as the fold home. "Bring in variations" is
            the one SERVER opt-in. A unit-only sort (price) auto-engages hide-parents. */}
        <label
          class="flex items-center gap-2 self-end pb-1.5 text-sm"
          title={__('Also load the variations of a matched parent (downward brought-with pass)')}
        >
          <input
            type="checkbox"
            data-fb-related="bring-children"
            data-fb-cycle
            class="h-4 w-4 rounded border-border"
            checked={query().bringChildren}
            onChange={(e) =>
              setQuery((q) => ({
                ...q,
                bringChildren: e.currentTarget.checked,
                // Reset the dependent hide bit when turning the pass off, so it can't linger.
                hideBroughtChildren: e.currentTarget.checked ? q.hideBroughtChildren : false,
              }))
            }
          />
          {__('Bring in variations')}
        </label>
        {/* The two "Hide brought-in" display toggles stack vertically in one group. */}
        <div class="flex flex-col gap-1 self-end pb-1.5">
          <label
            class="flex items-center gap-2 text-sm"
            title={__('Hide variable parents shown only as context (brought-with / value-less for the sort)')}
          >
            <input
              type="checkbox"
              data-fb-related="parents"
              data-fb-cycle
              class="h-4 w-4 rounded border-border"
              checked={query().hideBroughtParents}
              onChange={(e) => setQuery((q) => ({ ...q, hideBroughtParents: e.currentTarget.checked }))}
            />
            {__('Hide brought-in parents')}
          </label>
          <Show when={query().bringChildren}>
            <label
              class="flex items-center gap-2 text-sm"
              title={__('Hide the brought-in (context) variations, keeping the matched ones')}
            >
              <input
                type="checkbox"
                data-fb-related="children"
                data-fb-cycle
                class="h-4 w-4 rounded border-border"
                checked={query().hideBroughtChildren}
                onChange={(e) => setQuery((q) => ({ ...q, hideBroughtChildren: e.currentTarget.checked }))}
              />
              {__('Hide brought-in children')}
            </label>
          </Show>
        </div>
        {/* Filter bar (shared @invflux/ui component): "Add filter" + a chip per active filter. */}
        <FilterBar
          filters={filterChips}
          cycleScope={() => toolbarRef}
          onEditorClosed={() => focusGrid()}
          onExit={() => focusGrid()}
        />
        {/* One-step "undo the hand-off": restore the filter a cross-surface deep-link overwrote. */}
        <Show when={priorFilter()}>
          <div class="inline-flex items-center gap-1 self-center rounded-full border border-amber-300 bg-amber-50 py-1 pl-2.5 pr-1 text-sm text-amber-800">
            {/* Inherits the amber chip's colour rather than committing to a variant, so it stays
                a raw button — it only ever owed the cursor rule. */}
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 hover:underline"
              onClick={restorePriorFilter}
              title={__('Restore the filter that was active before this product was opened here')}
            >
              <span aria-hidden="true">↶</span>
              {__('Restore previous filter')}
            </button>
            <IconButton
              size="xs"
              label={__('Dismiss')}
              class="ml-0.5 h-4 w-4 rounded-full text-amber-500 hover:bg-amber-200 hover:text-amber-800"
              onClick={() => setPriorFilter(null)}
            >
              ×
            </IconButton>
          </div>
        </Show>
        {/* Refresh refetches the currently filtered view — its natural home is beside the filters.
            `ml-auto` pushes it to the right edge of the (wrapping) filter row. Icon-only; while a
            (re-)query is in flight it takes a grey background and the icon spins. */}
        <Button
          variant="secondary"
          class="ml-auto h-9 self-end"
          classList={{ 'bg-muted': isRefreshing() }}
          disabled={isRefreshing()}
          aria-label={__('Refresh')}
          title={__('Refresh')}
          onClick={() => refreshGrid()}
        >
          <RefreshIcon class={`h-4 w-4${isRefreshing() ? ' animate-spin' : ''}`} />
        </Button>
      </form>

      {/* ── Table area ── */}
      <div class="flex flex-col min-h-0 flex-1 px-5 py-4">
        {/* Bulk action toolbar */}
        <div class="mb-3 flex items-center gap-3 rounded border border-border bg-amber-50 px-4 py-2 text-sm shrink-0">
          <div class="flex flex-col leading-tight">
            <span
              class="font-medium tabular-nums"
              title={sprintf(
                __('Selected: %d, Loaded: %d, Total: %d'),
                selectedSubjectIds().length,
                loadedCount(),
                totalCount(),
              )}
            >
              {selectedSubjectIds().length}/{loadedCount()}/{totalCount()}
            </span>
            <Show when={loadedCount() < totalCount()}>
              <Button
                variant="link"
                size="sm"
                class="text-left"
                disabled={loadingAllPages()}
                onClick={() => void loadAll()}
              >
                {loadingAllPages() ? __('Loading…') : __('Load all pages')}
              </Button>
            </Show>
          </div>
          {/* Bulk-action menu (shared @invflux/ui DropdownMenu). Enabled whenever any action applies
              (some — e.g. Export — act on the whole filtered view with no selection). */}
          <DropdownMenu
            ariaLabel={__('Bulk actions')}
            disabled={availableBulkActions().length === 0}
            items={bulkMenuItems()}
            triggerClass="inline-flex h-8 items-center gap-1 rounded border border-border bg-white px-3 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
            trigger={
              <>
                {sprintf(
                  __('Bulk actions (%d products)…'),
                  selectedSubjectIds().length > 0 ? selectedSubjectIds().length : loadedCount(),
                )}
                <span aria-hidden="true" class="text-text-muted">
                  ▾
                </span>
              </>
            }
          />
          {/* Worksheets is a selection/curation operation → grouped with the bulk-action menu. */}
          <Button
            variant="secondary"
            class="h-8"
            onClick={() => setWorksheetsModal({ subjectIds: [], mode: 'manage' })}
          >
            {__('Worksheets')}
          </Button>
          {/* Right cluster — plug-in toolbar slot, then the grid's own table controls (layout toggle,
              Columns, Save). Record-view toggle + Save were already moved off the grid's (hidden)
              toolbar onto this bar; Columns joins them here (its natural neighbour is Save). */}
          <div class="flex-1" />
          {/* Plug-in toolbar slot (arch-ui-principles §3.4): the shell renders registered
              contributions, ordered by `order` and gated by their `enabled` predicate. */}
          <For each={slotRegistry.get<WorkbenchToolbarSlotProps>('workbench.toolbar')}>
            {(slot) => (
              <Show when={slot.enabled?.() ?? true}>
                <Dynamic component={slot.component} selectedSubjectIds={selectedSubjectIds()} />
              </Show>
            )}
          </For>
          <Show when={layoutInfo().canToggle}>
            <Button
              variant="secondary"
              class="h-8 px-2!"
              aria-label={layoutInfo().layout === 'record' ? __('Switch to table view') : __('Switch to record view')}
              title={layoutInfo().layout === 'record' ? __('Switch to table view') : __('Switch to record view')}
              onClick={() => toggleLayout()}
            >
              {layoutInfo().layout === 'record'
                ? <TableViewIcon class="h-5 w-5" />
                : <RecordViewIcon class="h-5 w-5" />}
            </Button>
          </Show>
          <Button
            variant="secondary"
            class="h-8 px-2!"
            aria-label={`${__('Columns')} (Ctrl+M)`}
            title={`${__('Columns')} (Ctrl+M)`}
            onClick={() => openColumnManager()}
          >
            <ColumnsSettingsIcon class="h-5 w-5" />
          </Button>
          <Button
            class="h-8"
            disabled={!gridDirty()}
            onClick={() => openSaveReview()}
          >
            {__('Save')}
          </Button>
        </div>

        {/* ── The reusable WorkbenchGrid: owns fetch / dirty model / save + correction review /
            cascade / live stock updates / column-state persistence / cell+row selection / drilldown /
            bespoke columns / bulk-edit. The shell feeds query + sort + display-transform in and reads
            metadata / selection / conflicts + imperative handles back out. ── */}
        <div class="flex min-h-0 flex-1 flex-col">
          <WorkbenchGridBase
            ctx={ctx}
            storageKeyPrefix="central-workbench"
            loadSize={query().loadSize}
            showRowSelection={true}
            showToolbar={false}
            defaultLayout="grid"
            onDirtyChange={(d) => {
              setGridDirty(d);
              // Surface dirty state to an embedder (the unified app's nav guard + tab signal).
              props.onDirtyChange?.(d);
            }}
            onLayoutChange={setLayoutInfo}
            queryParams={buildQueryParams}
            sort={() => ({ sortBy: query().sortBy, sortDir: query().sortDir })}
            onSortChange={(s) => setQuery((q) => ({ ...q, sortBy: s.sortBy, sortDir: s.sortDir }))}
            transformRows={transformRows}
            fold={{
              // A variable parent with loaded variations gets a ▸/▾ caret; the shell owns the state.
              state: (row) => {
                if (row.wcVariationId !== null) return 'none';
                if ((childrenByProductId().get(row.wcProductId)?.length ?? 0) === 0) return 'none';
                return collapsedProductIds().has(row.wcProductId) ? 'collapsed' : 'expanded';
              },
              toggle: (row) => applyFold([row.wcProductId]),
            }}
            componentChoiceId={componentChoiceId}
            rowAttrs={(row) =>
              row.matched === false
                ? {
                    class: 'opacity-50',
                    title: __('Shown for context (not a match for the current filters)'),
                    // The class is a styling choice and the title is translated; this is the
                    // stable handle on "this row is context, not a result".
                    data: { 'context-row': '' },
                  }
                : {}
            }
            copyAsJsonAllowed={() => ctx.entitlements?.exportStructured ?? false}
            copyAsJsonUpgradeHint={__('Upgrade to InvFlux Pro')}
            contextMenuExtras={({ row }) => {
              // Bulk actions on the rows under the cell selection (fall back to the right-clicked row).
              const cells = getSelectedCells();
              const subjectIds = cells.length > 0 ? [...new Set(cells.map((c) => c.row.subjectId))] : [row.subjectId];
              const children = buildBulkMenuItems(subjectIds).map(toMenuItem);
              if (children.length === 0) return [];
              return [
                {
                  id: 'bulk-actions',
                  label: sprintf(
                    _n('Bulk action on %d row…', 'Bulk action on %d rows…', subjectIds.length),
                    subjectIds.length,
                  ),
                  children,
                },
              ];
            }}
            onMeta={(m) => {
              setStableFilters(m.filters);
              setStableColumns(m.columns);
              setStableTaxonomySpace(m.taxonomySpace);
              setTotalCount(m.total);
              setLoadedCount(m.loaded);
            }}
            onSelectionChange={(ids) => setSelectedSubjectIds(ids)}
            onFetchingChange={(fetching) => setIsRefreshing(fetching)}
            onApplied={() => clearConflictToast()}
            onConflicts={(conflicts) => handleConflicts(conflicts)}
            apiRef={(h: WorkbenchHandles) => {
              focusGrid = h.focus;
              openColumnManager = h.openColumnManager;
              scrollGridToTop = h.scrollToTop;
              refreshGrid = h.refreshLiveUpdates;
              getSelectedCells = h.getSelectedCells;
              loadAllPagesHandle = h.loadAllPages;
              selectSubjectRows = h.selectSubjectRows;
              toggleLayout = h.toggleLayout;
              openSaveReview = h.openSaveReview;
            }}
            extraInGridKeyHandlers={[
              // `*` — expand/collapse the variable products in the selection (Windows-TreeView convention).
              (event) => {
                if (event.key === '*') {
                  event.preventDefault();
                  toggleFoldSelection();
                  return true;
                }
                return false;
              },
            ]}
            extraKeyHandlers={[
              (event) => {
                // "/" (no Shift) focuses the search box (GitHub-style), unless already typing.
                if (event.key === '/' && !event.shiftKey && !isTypingInField()) {
                  event.preventDefault();
                  searchRef?.focus();
                  searchRef?.select();
                  return true;
                }
                // Shift+"/" returns focus to the grid (the numpad pairing).
                if (event.shiftKey && event.key === '/') {
                  event.preventDefault();
                  focusGrid();
                  return true;
                }
                return false;
              },
            ]}
          />
        </div>
      </div>
      {/* Transient-notification host for the SPA shell (arch-ui-principles §3). One per shell;
          inside the workbench root so it shares the shadow root's Tailwind + scoping. */}
      <ToastRegion />
    </div>
  );
}

import { __, sprintf } from '@invflux/i18n';
import { Button, ErrorBanner, useHostNav } from '@invflux/ui';
import {
  DataGrid,
  type DataGridMenuItem,
  EMPTY_SELECTION,
  type GridColumnMeta,
  COMMON_ALIASES,
  fetchImportAliases,
  ImportWizard,
  type ImportField,
  learnImportAlias,
  type MappedRow,
  parseImportFile,
  type ResolvedRow,
  type SearchSelectOption,
  type SelectionState,
  type StagedCell,
  toast,
} from '@invflux/ui';
import { useNavigate } from '@solidjs/router';
import { type ColumnDef, createColumnHelper } from '@tanstack/solid-table';
import type {
  ColumnOrderState,
  RowSelectionState,
  SortingState,
  VisibilityState,
} from '@tanstack/solid-table';
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query';
import { createEffect, createMemo, createSignal, type JSX, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useProcurement } from '../../context';
import { firstEditableColumnId } from '../../grid/editableColumn';
import { fuzzyMatches } from '../../grid/fuzzyMatch';
import { persistedSignal } from '../../grid/persistedSignal';
import { registerProductSearchEditor } from '../../grid/productSearchEditor';
import { isTypingInField, QuickFilter } from '../../grid/QuickFilter';
import { createApi } from '../../lib/api';
import { usePortalRoot } from '../../portal';
import type { ProductSearchResponse, SupplierProduct, SupplierProductsResponse } from './types';

/** Sentinel id for the always-present append row (real link ids are positive). */
const DRAFT_ID = 0;
/** Custom editor datatype for the append-row's product cell (the async product search). */
const PRODUCT_EDITOR_TYPE = 'text:product-search';

/** Staged edits to one catalogue link (column id → value), merged onto the row's current terms on Save. */
interface DirtyPatch {
  supplier_sku?: string | null;
  unit_price?: string | null;
  moq?: number | null;
  case_pack?: number | null;
  lead_time_days?: number | null;
}

/** Editable column id → the patch/body key it writes (lead_time → lead_time_days; others identical). */
const PATCH_KEY: Record<string, keyof DirtyPatch> = {
  supplier_sku: 'supplier_sku',
  unit_price: 'unit_price',
  moq: 'moq',
  case_pack: 'case_pack',
  lead_time: 'lead_time_days',
};

const COLUMN_ORDER = [
  'image',
  'product',
  'sku',
  'supplier_sku',
  'unit_price',
  'moq',
  'case_pack',
  'lead_time',
];

/** Effective fallbacks for blank terms: MOQ/case-pack = 1; lead-time inherits the supplier's. */
interface Defaults {
  moq: number;
  casePack: number;
  leadTime: number | null;
}

/** GridColumnMeta with catalogue-grid defaults filled in; all columns share the one group. */
function colMeta(
  over: Partial<GridColumnMeta> & { id: string; label: string; dataType: string },
): GridColumnMeta {
  return {
    kind: 'read_only',
    editable: false,
    sortable: false,
    copyable: false,
    pasteable: false,
    bulkSaveReason: null,
    hasDrilldown: false,
    dispositionOptions: null,
    discoveryContextOptions: null,
    group: 'supplier-products',
    priority: 0,
    visibleByDefault: true,
    defaultWidth: 110,
    editorConfig: {},
    ...over,
  };
}

/**
 * A supplier's product catalogue on the shared DataGrid (Workbench-style: edits stage into a dirty
 * model, tinted green, and persist together on **Save**). The product is immutable on existing rows —
 * only the supplier terms (SKU / unit price / MOQ / case pack / lead time) edit, with blank terms
 * inheriting the supplier/global defaults (shown lighter, an override in bold). Row selection drives
 * "Create PO draft from selection"; right-click deletes the selected rows.
 *
 * Checkpoint 1: display + staged edit + Save + selection + filter + delete. Adding a product (the
 * MS-Access append row with the async product search) lands in checkpoint 2.
 */
export function SupplierProducts(props: {
  supplierId: number;
  supplierLeadTime: number | null;
  supplierCostDecimals: number;
  saveSlot?: HTMLElement;
}): JSX.Element {
  const hostNav = useHostNav();
  const ctx = useProcurement();
  const api = createApi(ctx);
  // Bulk supplier-SKU *capture* (match-and-write from a pasted price list) is the ops-maturity signal, so
  // Pro. Manual SKU entry in the grid stays Essentials; the import still matches on supplier SKU at Essentials.
  const isPro = ctx.hasPro;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const portalRoot = usePortalRoot();
  registerProductSearchEditor();
  const key = (): [string, string, number, string] => [
    'procurement',
    'suppliers',
    props.supplierId,
    'products',
  ];

  const query = createQuery(() => ({
    queryKey: key(),
    queryFn: () =>
      api.get<SupplierProductsResponse>(`/procurement/suppliers/${props.supplierId}/products`),
  }));
  const products = (): SupplierProduct[] => query.data?.products ?? [];
  const defaults = (): Defaults => ({ moq: 1, casePack: 1, leadTime: props.supplierLeadTime });

  // ── Staged dirty model ──────────────────────────────────────────────────────────────────────────
  const [dirty, setDirty] = createSignal<Record<number, DirtyPatch>>({});
  const dirtyCount = (): number => Object.keys(dirty()).length;
  const stagedFor = (
    row: SupplierProduct,
    columnId: string,
  ): { staged: boolean; value: unknown } => {
    const k = PATCH_KEY[columnId];
    const d = dirty()[row.id];
    if (undefined !== k && undefined !== d && k in d) return { staged: true, value: d[k] };
    return { staged: false, value: undefined };
  };

  // ── Quick filter ────────────────────────────────────────────────────────────────────────────────
  const [filterText, setFilterText] = createSignal('');
  // ── Display order ───────────────────────────────────────────────────────────────────────────────
  // Sort state (column headers, asc/desc/none) — declared here so the visibleProducts memo (eager) can
  // read it; the grid drives it through onSortingChange below.
  const [sorting, setSorting] = createSignal<SortingState>([]);
  // Client sort-index per link (not persisted): the first load is seeded in SKU-ASC order, and a
  // freshly-added product gets max+1 so it lands at the end (above the append row) rather than sorting
  // into place. Sortable column headers (asc/desc/none) override this; "none" = this insertion order.
  const [orderIdx, setOrderIdx] = createSignal<Record<number, number>>({});
  const skuCmp = (a: SupplierProduct, b: SupplierProduct): number =>
    (a.sku ?? '￿').toLowerCase().localeCompare((b.sku ?? '￿').toLowerCase());
  createEffect(() => {
    const list = products();
    setOrderIdx((prev) => {
      const fresh = list.filter((p) => !(p.id in prev));
      if (0 === fresh.length) return prev;
      const first = 0 === Object.keys(prev).length;
      const ordered = first ? [...fresh].sort(skuCmp) : fresh; // seed by SKU on first load; else append
      let max = first ? -1 : Math.max(...Object.values(prev));
      const next = { ...prev };
      for (const p of ordered) next[p.id] = max += 1;
      return next;
    });
  });

  // Sort key for a column (terms use their effective value — raw or inherited default; nulls last).
  const sortKey = (p: SupplierProduct, columnId: string): string | number => {
    switch (columnId) {
      case 'product':
        return (p.productLabel ?? '').toLowerCase();
      case 'sku':
        return (p.sku ?? '￿').toLowerCase();
      case 'supplier_sku':
        return (p.supplierSku ?? '￿').toLowerCase();
      case 'unit_price':
        return null === p.unitPrice ? Number.POSITIVE_INFINITY : Number(p.unitPrice);
      case 'moq':
        return p.moq ?? defaults().moq ?? Number.POSITIVE_INFINITY;
      case 'case_pack':
        return p.casePack ?? defaults().casePack ?? Number.POSITIVE_INFINITY;
      case 'lead_time':
        return p.leadTimeDays ?? defaults().leadTime ?? Number.POSITIVE_INFINITY;
      default:
        return 0;
    }
  };
  const compareBy = (a: SupplierProduct, b: SupplierProduct, columnId: string): number => {
    const ka = sortKey(a, columnId);
    const kb = sortKey(b, columnId);
    return typeof ka === 'string' && typeof kb === 'string'
      ? ka.localeCompare(kb)
      : (ka as number) - (kb as number);
  };

  const visibleProducts = createMemo<SupplierProduct[]>(() => {
    const filtered =
      '' === filterText().trim()
        ? products()
        : products().filter((p) =>
            fuzzyMatches(filterText(), [p.productLabel, p.sku, p.supplierSku, p.gtin]),
          );
    const s = sorting()[0];
    const arr = [...filtered];
    if (undefined === s) {
      const idx = orderIdx();
      arr.sort((a, b) => (idx[a.id] ?? 0) - (idx[b.id] ?? 0)); // insertion order — new products at the end
    } else {
      const dir = s.desc ? -1 : 1;
      arr.sort((a, b) => dir * compareBy(a, b, s.id));
    }
    return arr;
  });

  // ── Append row (Essentials new-product entry) ─────────────────────────────────────────────────────────
  // A synthetic link (id = DRAFT_ID) always appended last; only its product cell is editable, through
  // the grid's own editor (the async product-search picker). Picking a product creates the catalogue
  // link and drops focus into the new row's first editable term.
  const draftLine = (): SupplierProduct => ({
    id: DRAFT_ID,
    supplierId: props.supplierId,
    subjectId: 0,
    postId: null,
    name: null,
    sku: null,
    supplierSku: null,
    gtin: null,
    imageUrl: null,
    productLabel: '',
    exists: true,
    unitPrice: null,
    currency: null,
    moq: null,
    casePack: null,
    leadTimeDays: null,
    priority: 0,
    createdAt: null,
    updatedAt: null,
  });
  const isDraft = (l: SupplierProduct): boolean => DRAFT_ID === l.id;
  const gridRows = createMemo<SupplierProduct[]>(() => [...visibleProducts(), draftLine()]);

  // Server product search for the picker (all WC products; the server owns matching + ranking).
  // Products already in this supplier's catalogue are filtered out so they can't be re-added (422).
  const productSearch = async (q: string): Promise<SearchSelectOption[]> => {
    const res = await api.get<ProductSearchResponse>('/procurement/products/search', { q });
    const inCatalogue = new Set(
      products()
        .map((p) => p.postId)
        .filter((id): id is number => null !== id),
    );
    return res.products
      .filter((p) => !inCatalogue.has(p.postId))
      .map((p) => ({
        value: String(p.postId),
        label:
          null === p.sku ? (p.name ?? `#${p.postId}`) : `${p.name ?? `#${p.postId}`} · ${p.sku}`,
      }));
  };

  // Pick → create the catalogue link (blank terms inherit defaults), reload, then drop into the new
  // row's first editable term. Awaited (not optimistic) so focus lands on a settled, real row.
  const addProduct = async (postId: number): Promise<void> => {
    try {
      const { product } = await api.post<{ product: SupplierProduct }>(
        `/procurement/suppliers/${props.supplierId}/products`,
        { woo_post_id: postId },
      );
      await queryClient.invalidateQueries({ queryKey: key() });
      queueMicrotask(() => {
        const row = products().find((p) => p.id === product.id);
        const colId =
          undefined === row
            ? undefined
            : firstEditableColumnId(
                row,
                columnMetas(),
                canEdit,
                gridApi?.getSelectableColumnIds() ?? [],
              );
        if (undefined !== colId) gridApi?.focusCellById(String(product.id), colId, true);
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  // Deep-link to the Central Workbench, pre-filtered to this supplier (filterBridge reads `{id}[]=value`).
  const workbenchUrl = (): string =>
    hostNav.routeHref('/workbench', `supplier[]=${encodeURIComponent(String(props.supplierId))}`);

  // ── Columns ─────────────────────────────────────────────────────────────────────────────────────
  const columnMetas = createMemo<GridColumnMeta[]>(() => [
    colMeta({ id: 'image', label: __('Image'), dataType: 'text', defaultWidth: 56 }),
    colMeta({
      id: 'product',
      label: __('Product'),
      dataType: PRODUCT_EDITOR_TYPE,
      sortable: true,
      copyable: true,
      defaultWidth: 280,
    }),
    colMeta({
      id: 'sku',
      label: __('SKU'),
      dataType: 'text',
      sortable: true,
      copyable: true,
      defaultWidth: 120,
    }),
    colMeta({
      id: 'supplier_sku',
      label: __('Supplier SKU'),
      dataType: 'text',
      kind: 'editable',
      editable: true,
      sortable: true,
      copyable: true,
      pasteable: true,
      defaultWidth: 150,
    }),
    colMeta({
      id: 'unit_price',
      label: __('Unit price'),
      dataType: 'decimal:money',
      kind: 'editable',
      editable: true,
      sortable: true,
      copyable: true,
      pasteable: true,
      defaultWidth: 120,
    }),
    colMeta({
      id: 'moq',
      label: __('MOQ'),
      dataType: 'number',
      kind: 'editable',
      editable: true,
      sortable: true,
      copyable: true,
      pasteable: true,
      defaultWidth: 80,
    }),
    colMeta({
      id: 'case_pack',
      label: __('Case pack'),
      dataType: 'number',
      kind: 'editable',
      editable: true,
      sortable: true,
      copyable: true,
      pasteable: true,
      defaultWidth: 96,
    }),
    colMeta({
      id: 'lead_time',
      label: __('Lead time'),
      dataType: 'number',
      kind: 'editable',
      editable: true,
      sortable: true,
      copyable: true,
      pasteable: true,
      defaultWidth: 96,
    }),
  ]);

  const ch = createColumnHelper<SupplierProduct>();
  const money = (v: unknown): string =>
    null === v || undefined === v || '' === v ? '—' : Number(v).toFixed(props.supplierCostDecimals);
  const bespokeColumns = new Map<string, ColumnDef<SupplierProduct, unknown>>([
    [
      'select',
      ch.display({
        id: 'select',
        header: (info) => (
          <input
            aria-label={__('Select all')}
            type="checkbox"
            class="cursor-pointer"
            checked={info.table.getIsAllRowsSelected()}
            title={__('Select all')}
            onChange={info.table.getToggleAllRowsSelectedHandler()}
          />
        ),
        cell: (info) => (
          <Show when={!isDraft(info.row.original)}>
            <input
              aria-label={__('Select row')}
              type="checkbox"
              class="cursor-pointer"
              checked={info.row.getIsSelected()}
              onChange={info.row.getToggleSelectedHandler()}
              onClick={(e) => e.stopPropagation()}
            />
          </Show>
        ),
      }) as ColumnDef<SupplierProduct, unknown>,
    ],
    [
      'image',
      ch.display({
        id: 'image',
        header: () => __('Image'),
        cell: (info) => (
          <Show when={!isDraft(info.row.original)}>
            <Show
              when={info.row.original.imageUrl}
              fallback={<div class="h-9 w-9 rounded bg-slate-100" />}
            >
              {(u) => <img src={u()} alt="" class="h-9 w-9 rounded object-cover" />}
            </Show>
          </Show>
        ),
      }) as ColumnDef<SupplierProduct, unknown>,
    ],
    [
      'product',
      ch.accessor((r) => r.productLabel, {
        id: 'product',
        enableSorting: true,
        header: () => __('Product'),
        cell: (info) => (
          <Show
            when={!isDraft(info.row.original)}
            fallback={<span class="italic text-text-muted">{__('＊ Add a product ＊')}</span>}
          >
            <ProductCell link={info.row.original} />
          </Show>
        ),
      }) as ColumnDef<SupplierProduct, unknown>,
    ],
    [
      'sku',
      ch.accessor((r) => r.sku, {
        id: 'sku',
        enableSorting: true,
        header: () => __('SKU'),
        cell: (info) => (
          <Show
            when={!isDraft(info.row.original) && info.row.original.sku}
            fallback={
              <Show when={!isDraft(info.row.original)}>
                <span class="text-slate-300">—</span>
              </Show>
            }
          >
            {(s) => <span class="block font-mono text-slate-500">{s()}</span>}
          </Show>
        ),
      }) as ColumnDef<SupplierProduct, unknown>,
    ],
    [
      'supplier_sku',
      ch.accessor((r) => r.supplierSku, {
        id: 'supplier_sku',
        enableSorting: true,
        header: () => __('Supplier SKU'),
        cell: (info) => {
          if (isDraft(info.row.original)) return null;
          // Use a lazy accessor so reads of dirty() happen inside JSX effects (reactive in SolidJS).
          const getS = (): { staged: boolean; value: unknown } =>
            stagedFor(info.row.original, 'supplier_sku');
          const value = (): string | null =>
            (getS().staged ? getS().value : info.row.original.supplierSku) as string | null;
          return (
            <Show
              when={null !== value() && '' !== value()}
              fallback={<span class="text-slate-300">—</span>}
            >
              <span
                classList={{ 'text-green-700': getS().staged, 'text-slate-700': !getS().staged }}
              >
                {value()}
              </span>
            </Show>
          );
        },
      }) as ColumnDef<SupplierProduct, unknown>,
    ],
    [
      'unit_price',
      ch.accessor((r) => r.unitPrice, {
        id: 'unit_price',
        enableSorting: true,
        header: () => __('Unit price'),
        cell: (info) => {
          if (isDraft(info.row.original)) return null;
          // Use a lazy accessor so reads of dirty() happen inside JSX effects (reactive in SolidJS).
          const getS = (): { staged: boolean; value: unknown } =>
            stagedFor(info.row.original, 'unit_price');
          const value = (): unknown => (getS().staged ? getS().value : info.row.original.unitPrice);
          return (
            <span
              class="block text-right tabular-nums"
              classList={{
                'text-green-700': getS().staged,
                'font-semibold text-slate-800':
                  !getS().staged && null !== info.row.original.unitPrice,
                'text-slate-300': !getS().staged && null === info.row.original.unitPrice,
              }}
            >
              {money(value())}
            </span>
          );
        },
      }) as ColumnDef<SupplierProduct, unknown>,
    ],
    [
      'moq',
      ch.accessor((r) => r.moq, {
        id: 'moq',
        enableSorting: true,
        header: () => __('MOQ'),
        cell: (info) => (
          <Show when={!isDraft(info.row.original)}>
            <TermCell
              s={() => stagedFor(info.row.original, 'moq')}
              value={info.row.original.moq}
              fallback={defaults().moq}
            />
          </Show>
        ),
      }) as ColumnDef<SupplierProduct, unknown>,
    ],
    [
      'case_pack',
      ch.accessor((r) => r.casePack, {
        id: 'case_pack',
        enableSorting: true,
        header: () => __('Case pack'),
        cell: (info) => (
          <Show when={!isDraft(info.row.original)}>
            <TermCell
              s={() => stagedFor(info.row.original, 'case_pack')}
              value={info.row.original.casePack}
              fallback={defaults().casePack}
            />
          </Show>
        ),
      }) as ColumnDef<SupplierProduct, unknown>,
    ],
    [
      'lead_time',
      ch.accessor((r) => r.leadTimeDays, {
        id: 'lead_time',
        enableSorting: true,
        header: () => __('Lead time'),
        cell: (info) => (
          <Show when={!isDraft(info.row.original)}>
            <TermCell
              s={() => stagedFor(info.row.original, 'lead_time')}
              value={info.row.original.leadTimeDays}
              fallback={defaults().leadTime}
              suffix=" d"
            />
          </Show>
        ),
      }) as ColumnDef<SupplierProduct, unknown>,
    ],
  ]);

  // ── DataGrid state ──────────────────────────────────────────────────────────────────────────────
  const [columnVisibility, setColumnVisibility] = persistedSignal<VisibilityState>(
    'invflux:supplier-products:colvis',
    {},
  );
  const [columnOrder, setColumnOrder] = persistedSignal<ColumnOrderState>(
    'invflux:supplier-products:colorder',
    COLUMN_ORDER,
  );
  const [columnSizing, setColumnSizing] = persistedSignal<Record<string, number>>(
    'invflux:supplier-products:colsize',
    {},
  );
  const [expandedColumnSections, setExpandedColumnSections] = persistedSignal<string[]>(
    'invflux:supplier-products:colsections',
    ['supplier-products'],
  );
  const [rowSelection, setRowSelection] = createSignal<RowSelectionState>({});
  const [cellSelection, setCellSelection] = createSignal<SelectionState>(EMPTY_SELECTION);

  const getValue = (row: SupplierProduct, columnId: string): unknown => {
    if (isDraft(row)) return undefined; // the append row renders its own picker; no grid value
    switch (columnId) {
      case 'image':
        return row.imageUrl;
      case 'product':
        return row.productLabel;
      case 'sku':
        return row.sku;
      case 'supplier_sku':
        return row.supplierSku;
      case 'unit_price':
        return row.unitPrice;
      case 'moq':
        return row.moq;
      case 'case_pack':
        return row.casePack;
      case 'lead_time':
        return row.leadTimeDays;
      default:
        return undefined;
    }
  };
  const getStagedValue = (row: SupplierProduct, columnId: string): StagedCell => {
    const s = stagedFor(row, columnId);
    return { staged: s.staged, value: s.value };
  };
  // The append row is editable only at its product cell (the picker); real rows edit their terms.
  const canEdit = (row: SupplierProduct, meta: GridColumnMeta): boolean =>
    isDraft(row) ? 'product' === meta.id : undefined !== PATCH_KEY[meta.id];
  const resolveClearedValue = (
    _row: SupplierProduct,
    meta: GridColumnMeta,
  ): { ok: boolean; value: unknown } =>
    undefined !== PATCH_KEY[meta.id] ? { ok: true, value: null } : { ok: false, value: null };
  // The product cell's editor needs the server search + portal target; inject for the append row only.
  const resolveEditorMeta = (meta: GridColumnMeta, row: SupplierProduct): GridColumnMeta =>
    isDraft(row) && 'product' === meta.id
      ? { ...meta, editorConfig: { search: productSearch, portalRoot } }
      : meta;

  const stageEdit = (row: SupplierProduct, columnId: string, next: unknown): void => {
    const k = PATCH_KEY[columnId];
    if (undefined === k) return;
    const blank = null === next || undefined === next || '' === next;
    const value: string | number | null = blank
      ? null
      : 'supplier_sku' === columnId || 'unit_price' === columnId
        ? String(next)
        : Number(next);
    // Compare against the row's persisted value (coerced the same way) to avoid marking cells dirty
    // when the user enters and leaves without changing anything.
    const rawPersisted: unknown = (
      {
        supplier_sku: row.supplierSku,
        unit_price: row.unitPrice,
        moq: row.moq,
        case_pack: row.casePack,
        lead_time: row.leadTimeDays,
      } as Record<string, unknown>
    )[columnId];
    const persistedCoerced: string | number | null =
      null === rawPersisted || undefined === rawPersisted
        ? null
        : 'supplier_sku' === columnId || 'unit_price' === columnId
          ? String(rawPersisted)
          : Number(rawPersisted);
    if (value === persistedCoerced) {
      // Value unchanged (or reverted to original) — remove from dirty if it was previously staged.
      setDirty((prev) => {
        const patch = prev[row.id];
        if (undefined === patch || !(k in patch)) return prev;
        const updated: DirtyPatch = { ...patch };
        delete updated[k];
        if (0 === Object.keys(updated).length) {
          const outer = { ...prev };
          delete outer[row.id];
          return outer;
        }
        return { ...prev, [row.id]: updated };
      });
      return;
    }
    setDirty((prev) => ({ ...prev, [row.id]: { ...prev[row.id], [k]: value } }));
  };
  const onStageEdit = (
    row: SupplierProduct,
    columnId: string,
    _original: unknown,
    next: unknown,
  ): void => {
    if (isDraft(row) && 'product' === columnId) {
      const opt = next as SearchSelectOption | null;
      if (null !== opt) void addProduct(Number(opt.value));
      return;
    }
    stageEdit(row, columnId, next);
  };
  // After committing the append-row product the host drives focus to the new row itself.
  const onCommitNavigate = (row: SupplierProduct, columnId: string): boolean =>
    isDraft(row) && 'product' === columnId;
  const onClearCells = (cells: Array<{ row: SupplierProduct; columnId: string }>): void => {
    for (const { row, columnId } of cells) stageEdit(row, columnId, null);
  };

  let focusFilter: (() => void) | undefined;
  let gridApi:
    | {
        focusGrid: () => void;
        focusCellById: (rowId: string, columnId: string, editMode?: boolean) => void;
        getSelectedCells: () => Array<{ row: SupplierProduct; columnId: string }>;
        getSelectableColumnIds: () => string[];
        openColumnManager: () => void;
        openGridSettings: () => void;
      }
    | undefined;

  // The product cell is the only useful cell on the append row → bounce any selection that lands on
  // another of its cells (arrow / click / Tab) straight there. The draft row is appended last.
  createEffect(() => {
    const active = cellSelection().active;
    if (null === active || active.row !== visibleProducts().length) return;
    const productCol = (gridApi?.getSelectableColumnIds() ?? []).indexOf('product');
    if (productCol >= 0 && active.col !== productCol)
      gridApi?.focusCellById(String(DRAFT_ID), 'product', false);
  });

  // ── Mutations ───────────────────────────────────────────────────────────────────────────────────
  // Save: one PATCH per dirty link (the update endpoint replaces all terms, so each body merges the
  // staged fields onto the row's current values). Parallel + a single reconcile; no bulk endpoint yet.
  const save = createMutation(() => ({
    mutationFn: async () => {
      const d = dirty();
      const byId = new Map(products().map((p) => [p.id, p]));
      await Promise.all(
        Object.keys(d).map((idStr) => {
          const id = Number(idStr);
          const link = byId.get(id);
          if (undefined === link) return Promise.resolve();
          const patch = d[id];
          return api.patch(`/procurement/suppliers/${props.supplierId}/products/${id}`, {
            supplier_sku: 'supplier_sku' in patch ? patch.supplier_sku : (link.supplierSku ?? null),
            unit_price: 'unit_price' in patch ? patch.unit_price : (link.unitPrice ?? null),
            moq: 'moq' in patch ? patch.moq : (link.moq ?? null),
            case_pack: 'case_pack' in patch ? patch.case_pack : (link.casePack ?? null),
            lead_time_days:
              'lead_time_days' in patch ? patch.lead_time_days : (link.leadTimeDays ?? null),
          });
        }),
      );
    },
    onSuccess: () => {
      const n = dirtyCount();
      setDirty({});
      void queryClient.invalidateQueries({ queryKey: key() });
      toast.success(sprintf(__('Saved %d product(s).'), n));
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : String(err)),
  }));

  const delMany = createMutation(() => ({
    mutationFn: (ids: number[]) =>
      Promise.all(
        ids.map((id) => api.del(`/procurement/suppliers/${props.supplierId}/products/${id}`)),
      ),
    onSuccess: (_res, ids: number[]) => {
      setDirty((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: key() });
      toast.success(__('Products removed.'));
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : String(err)),
  }));

  // ── Selection → Create PO draft ─────────────────────────────────────────────────────────────────
  const selectedIds = (): number[] =>
    Object.entries(rowSelection())
      .filter(([, v]) => v)
      .map(([k]) => Number(k))
      .filter((id) => DRAFT_ID !== id);
  const createPo = createMutation(() => ({
    mutationFn: () => {
      const chosen = new Set(selectedIds());
      const lines = products()
        .filter((p) => chosen.has(p.id))
        .map((p) => ({ subject_id: p.subjectId, qty_requested: 0, unit_cost: p.unitPrice }));
      return api.post<{ purchaseOrder: { id: number } }>('/procurement/purchase-orders', {
        supplier_id: props.supplierId,
        lines,
      });
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['procurement', 'purchase-orders'] });
      toast.success(__('Draft purchase order created.'));
      navigate(`/purchase-orders/${data.purchaseOrder.id}`);
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : String(err)),
  }));

  // ── Bulk paste import (shared ImportWizard) ───────────────────────────────────────────────────────
  // A bulk version of grid entry: paste a supplier price list, match each row to a product (by our SKU,
  // the supplier's own SKU, or barcode), and upsert the catalogue terms. Bulk supplier-SKU *capture* is
  // Pro (the field is match-only at Essentials — `keyOnly: !isPro` — so a pasted code matches but is never
  // written); bulk price/MOQ/pack/lead-time upsert is Essentials, as is manual SKU entry in the grid. The
  // product key alone is a valid row (adds the link with defaults), so no value column is required.
  const [importing, setImporting] = createSignal(false);
  // Merchant-taught header aliases (global), fed to the wizard's auto-mapper; "Remember" teaches more.
  const aliasesQuery = createQuery(() => ({
    queryKey: ['procurement', 'import-aliases'],
    queryFn: () => fetchImportAliases(ctx),
    staleTime: 5 * 60 * 1000,
  }));
  const learnAlias = (concept: string, header: string): void => {
    void learnImportAlias(ctx, concept, header)
      .then((map) => queryClient.setQueryData(['procurement', 'import-aliases'], map))
      .catch((e: unknown) =>
        toast.error(e instanceof Error ? e.message : __('Could not save the alias.')),
      );
  };
  const fmtPrice = (v: string): string =>
    '' === v || '-' === v || Number.isNaN(Number(v))
      ? v
      : Number(v).toFixed(props.supplierCostDecimals);
  const importFields: ImportField[] = [
    // Identifiers (match keys). Our WC SKU and the barcode are read-only (key-only) — they identify a
    // product but aren't written back. The supplier's own SKU is a key candidate always; at Pro it is
    // also a capture target (non-key → its value is written onto the product), at Essentials it stays
    // match-only (`keyOnly`), so a pasted code matches a row but is never written in bulk.
    // Built-in aliases: shared concepts from COMMON_ALIASES + catalogue-specific extras (MOQ / pack /
    // lead time). Raw literals, not translated — see COMMON_ALIASES.
    {
      key: 'sku',
      label: __('SKU'),
      aliases: [...COMMON_ALIASES.sku],
      keyCandidate: true,
      keyPriority: 1,
      keyOnly: true,
    },
    {
      key: 'supplier_sku',
      label: __('Supplier SKU'),
      aliases: [...COMMON_ALIASES.supplier_sku],
      keyCandidate: true,
      keyPriority: 2,
      keyOnly: !isPro,
    },
    {
      key: 'gtin',
      label: __('Barcode (GTIN/EAN)'),
      aliases: [...COMMON_ALIASES.gtin],
      keyCandidate: true,
      keyPriority: 3,
      keyOnly: true,
    },
    {
      key: 'unit_price',
      label: __('Unit price'),
      aliasKey: 'cost',
      aliases: [...COMMON_ALIASES.cost],
      numeric: true,
      format: fmtPrice,
    },
    {
      key: 'moq',
      label: __('MOQ'),
      aliases: [
        'min order',
        'minimum order',
        'min qty',
        'minimum',
        'quantité minimum',
        'minimum de commande',
      ],
      numeric: true,
    },
    {
      key: 'case_pack',
      label: __('Case pack'),
      aliases: ['pack', 'pack size', 'carton', 'colisage', 'conditionnement', 'unités par carton'],
      numeric: true,
    },
    {
      key: 'lead_time_days',
      label: __('Lead time (days)'),
      aliases: ['lead time', 'leadtime', 'delay', 'délai', 'délai livraison', 'delai'],
      numeric: true,
    },
  ];

  /**
   * Resolve pasted rows to products by the chosen key (our SKU / supplier SKU / barcode) via the shared
   * batch endpoint, then mark each as a new catalogue link or an update of an existing one (carrying the
   * current terms for the diff). Per cell: empty leaves a value as-is, '-' clears it, a value sets it.
   */
  const resolveImport = async (rows: MappedRow[], keyField: string): Promise<ResolvedRow[]> => {
    const keys = rows.map((r) => (r[keyField] ?? '').trim()).filter((k) => '' !== k);
    const { resolved } = await api.post<{
      resolved: Record<
        string,
        {
          postId: number | null;
          isVariation: boolean;
          name: string;
          subjectId: number | null;
          supplierSku?: string | null;
        }
      >;
    }>('/procurement/products/resolve', { keyType: keyField, keys, supplier_id: props.supplierId });
    const linkBySubject = new Map(products().map((l) => [l.subjectId, l]));
    return rows.map((r): ResolvedRow => {
      const k = (r[keyField] ?? '').trim();
      const hit = resolved[k];
      if (!hit) return { key: k, label: k, status: 'unmatched', note: __('No matching product') };

      // Product identity: a WC post (resolved by SKU/barcode) or a subject (supplier-SKU match).
      const data: Record<string, unknown> =
        null !== hit.postId
          ? { woo_post_id: hit.postId, is_variation: hit.isVariation }
          : { subject_id: hit.subjectId };
      const num = (field: string): void => {
        if (!(field in r)) return;
        const c = (r[field] ?? '').trim();
        if ('' !== c) data[field] = '-' === c ? null : Number(c) || 0;
      };
      if ('unit_price' in r) {
        const c = (r.unit_price ?? '').trim();
        if ('' !== c) data.unit_price = '-' === c ? null : c;
      }
      num('moq');
      num('case_pack');
      num('lead_time_days');
      const supSku =
        'supplier_sku' in r && 'supplier_sku' !== keyField
          ? (r.supplier_sku ?? '').trim()
          : undefined;
      if (undefined !== supSku && '' !== supSku) data.supplier_sku = '-' === supSku ? '' : supSku;

      // An existing catalogue link supplies the current per-field values for the diff (raw; the wizard
      // formats). Only set when the product is already in this supplier's catalogue, so a brand-new link
      // reads as an add, not an update.
      const link = null !== hit.subjectId ? linkBySubject.get(hit.subjectId) : undefined;
      const result: ResolvedRow = { key: k, label: hit.name || k, status: 'matched', data };
      if (link) {
        const existing: Record<string, string> = {};
        if ('unit_price' in r)
          existing.unit_price = null === link.unitPrice ? '' : String(link.unitPrice);
        if ('moq' in r) existing.moq = null === link.moq ? '' : String(link.moq);
        if ('case_pack' in r)
          existing.case_pack = null === link.casePack ? '' : String(link.casePack);
        if ('lead_time_days' in r)
          existing.lead_time_days = null === link.leadTimeDays ? '' : String(link.leadTimeDays);
        // Current scoped supplier SKU, so re-importing the same code reads unchanged (not a green add).
        if ('supplier_sku' in r && 'supplier_sku' !== keyField)
          existing.supplier_sku = hit.supplierSku ?? '';
        result.existing = existing;
      }
      return result;
    });
  };

  /** Commit the matched rows in one round-trip — the server upserts each link, then we reconcile. */
  const commitImport = async (matched: ResolvedRow[]): Promise<void> => {
    const { added, updated } = await api.post<{ added: number; updated: number }>(
      `/procurement/suppliers/${props.supplierId}/products/import`,
      { rows: matched.map((m) => m.data) },
    );
    void queryClient.invalidateQueries({ queryKey: key() });
    toast.success(sprintf(__('Import done — %1$d added, %2$d updated.'), added, updated));
  };

  const contextMenuExtras = (): DataGridMenuItem[] => {
    const cells = (gridApi?.getSelectedCells() ?? []).filter((c) => !isDraft(c.row));
    const ids = [...new Set(cells.map((c) => c.row.id))];
    const hasDirty = cells.some(({ row, columnId }) => {
      const k = PATCH_KEY[columnId];
      return undefined !== k && k in (dirty()[row.id] ?? {});
    });
    const extras: DataGridMenuItem[] = [];
    if (hasDirty) extras.push({ id: 'revert', label: __('Revert'), run: () => revertSelection() });
    if (ids.length > 0)
      extras.push({
        id: 'delete-rows',
        label: sprintf(__('Delete %d selected row(s)'), ids.length),
        run: () => {
          delMany.mutate(ids);
          setCellSelection(EMPTY_SELECTION);
        },
      });
    return extras;
  };

  /** Drop staged edits for the currently selected cells (Backspace / Revert — does not touch persisted data). */
  function revertSelection(): void {
    const cells = (gridApi?.getSelectedCells() ?? []).filter((c) => !isDraft(c.row));
    if (0 === cells.length) return;
    setDirty((prev) => {
      const next = { ...prev };
      for (const { row, columnId } of cells) {
        const k = PATCH_KEY[columnId];
        if (undefined === k || !(row.id in next) || !(k in (next[row.id] ?? {}))) continue;
        const updated: DirtyPatch = { ...next[row.id] };
        delete updated[k];
        if (0 === Object.keys(updated).length) delete next[row.id];
        else next[row.id] = updated;
      }
      return next;
    });
  }

  const inGridKeyHandlers = [
    (e: KeyboardEvent): boolean => {
      if ('Escape' === e.key) {
        e.preventDefault();
        focusFilter?.();
        return true;
      }
      // Backspace → revert (un-stage) dirty cells in selection; always consumed to prevent
      // browser back-navigation. No-op when nothing is dirty (mirrors Workbench behaviour).
      if ('Backspace' === e.key) {
        e.preventDefault();
        revertSelection();
        return true;
      }
      return false;
    },
  ];
  const globalKeyHandlers = [
    (e: KeyboardEvent): boolean => {
      if ('/' === e.key && !e.shiftKey && !isTypingInField()) {
        e.preventDefault();
        focusFilter?.();
        return true;
      }
      // Insert jumps into the append-row product picker (add another product).
      if ('Insert' === e.key && !isTypingInField()) {
        e.preventDefault();
        gridApi?.focusCellById(String(DRAFT_ID), 'product', true);
        return true;
      }
      // Ctrl/Cmd+Enter and Ctrl/Cmd+S both save staged term edits.
      if (('Enter' === e.key || 's' === e.key) && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (dirtyCount() > 0 && !save.isPending) save.mutate();
        return true;
      }
      return false;
    },
  ];

  // Filter-Enter with a single match → that row's left-most editable cell (Supplier SKU here).
  const onFilterLeave = (key2: 'Enter' | 'Escape'): void => {
    if ('Enter' === key2 && 1 === visibleProducts().length) {
      const row = visibleProducts()[0];
      const colId = firstEditableColumnId(
        row,
        columnMetas(),
        canEdit,
        gridApi?.getSelectableColumnIds() ?? [],
      );
      if (undefined !== colId) {
        gridApi?.focusCellById(String(row.id), colId);
        return;
      }
    }
    gridApi?.focusGrid();
  };

  // Rendered into the supplier header (next to "Create replenishment PO") via the saveSlot portal; the
  // dirty model stays here. Falls back to an inline button if no slot is supplied.
  const saveButton = (): JSX.Element => (
    <Button disabled={0 === dirtyCount() || save.isPending} onClick={() => save.mutate()}>
      <Show when={dirtyCount() > 0} fallback={__('Save')}>
        {sprintf(__('Save %d change(s)'), dirtyCount())}
      </Show>
    </Button>
  );

  return (
    <section>
      <Show when={query.isPending}>
        <p class="text-slate-500">{__('Loading products…')}</p>
      </Show>
      <Show when={query.isError}>
        <ErrorBanner>{__('Failed to load products.')}</ErrorBanner>
      </Show>

      <Show when={query.isSuccess}>
        {/* Save renders into the supplier header (beside "Create replenishment PO") via the slot. */}
        <Show when={props.saveSlot} fallback={<div class="mb-2">{saveButton()}</div>}>
          {(slot) => <Portal mount={slot()}>{saveButton()}</Portal>}
        </Show>

        <Show when={selectedIds().length > 0}>
          <div class="mb-2 flex items-center gap-3 rounded bg-blue-50 px-3 py-2 text-sm">
            <span class="text-slate-700">{sprintf(__('%d selected'), selectedIds().length)}</span>
            <Button size="sm" disabled={createPo.isPending} onClick={() => createPo.mutate()}>
              {__('Create PO draft from selection')}
            </Button>
            <Button variant="quiet" size="xs" onClick={() => setRowSelection({})}>
              {__('Clear')}
            </Button>
          </div>
        </Show>

        <div class="mb-2 flex items-center gap-3">
          <div class="w-full max-w-md">
            <QuickFilter
              value={filterText}
              onInput={setFilterText}
              onLeave={onFilterLeave}
              ref={(focus) => (focusFilter = focus)}
              placeholder={__('Filter — name / SKU / supplier SKU…')}
            />
          </div>
          <Button variant="secondary" size="sm" onClick={() => setImporting(true)}>
            {__('Import / paste')}
          </Button>
          <div class="flex-1" />
          <a
            href={workbenchUrl()}
            target="_blank"
            rel="noopener"
            class="text-sm text-primary hover:underline"
          >
            {__('See products in Workbench →')}
          </a>
        </div>

        <Show when={importing()}>
          <ImportWizard
            title={__('Import supplier products')}
            fields={importFields}
            onResolve={resolveImport}
            onCommit={commitImport}
            onParseFile={(file) => parseImportFile(ctx, file)}
            learnedAliases={aliasesQuery.data}
            onLearnAlias={learnAlias}
            onClose={() => setImporting(false)}
            requireValueColumn={false}
            importColumnTitle={__('Written to the supplier catalogue')}
          />
        </Show>

        <div class="flex max-h-[70vh] flex-col">
          <DataGrid<SupplierProduct>
            rows={gridRows}
            getRowId={(l) => String(l.id)}
            rowAttrs={(l) => (isDraft(l) ? { class: 'bg-primary/5' } : {})}
            columnMetas={columnMetas}
            getValue={getValue}
            bespokeColumns={bespokeColumns}
            canEdit={canEdit}
            getStagedValue={getStagedValue}
            resolveClearedValue={resolveClearedValue}
            resolveEditorMeta={resolveEditorMeta}
            apiRef={(grid) => (gridApi = grid)}
            contextMenuExtras={contextMenuExtras}
            settingsKey="supplier-products"
            keyHandlers={globalKeyHandlers}
            keyHandlersInGrid={inGridKeyHandlers}
            onStageEdit={onStageEdit}
            onCommitNavigate={onCommitNavigate}
            onClearCells={onClearCells}
            sorting={sorting}
            onSortingChange={(next) => setSorting(() => next)}
            columnVisibility={columnVisibility}
            setColumnVisibility={(updater) => setColumnVisibility(updater)}
            columnOrder={columnOrder}
            setColumnOrder={(updater) => setColumnOrder(updater)}
            columnSizing={columnSizing}
            setColumnSizing={(updater) => setColumnSizing(updater)}
            expandedColumnSections={expandedColumnSections}
            setExpandedColumnSections={(updater) => setExpandedColumnSections(updater)}
            rowSelection={rowSelection}
            setRowSelection={(updater) => setRowSelection(updater)}
            cellSelection={cellSelection}
            setCellSelection={(updater) => setCellSelection(updater)}
            fallback={
              <div class="px-3 py-6 text-sm text-slate-500">
                {__('No products in this catalogue yet.')}
              </div>
            }
          />
        </div>
      </Show>
    </section>
  );
}

/** Product label (the product is immutable in the catalogue; SKU is its own column). */
function ProductCell(props: { link: SupplierProduct }): JSX.Element {
  return (
    <div class="font-medium" classList={{ 'text-text-muted italic': !props.link.exists }}>
      {props.link.productLabel}
    </div>
  );
}

/** A numeric term cell: staged (green), an explicit override (bold), or the inherited default (light). */
function TermCell(props: {
  s: () => { staged: boolean; value: unknown };
  value: number | null;
  fallback: number | null;
  suffix?: string;
}): JSX.Element {
  const raw = (): number | null =>
    props.s().staged ? (props.s().value as number | null) : props.value;
  const effective = (): number | null => raw() ?? props.fallback;
  return (
    <Show
      when={null !== effective()}
      fallback={<span class="block text-right text-slate-300">—</span>}
    >
      <span
        class="block text-right tabular-nums"
        classList={{
          'text-green-700': props.s().staged,
          'font-semibold text-slate-800': !props.s().staged && null !== raw(),
          'text-text-muted': !props.s().staged && null === raw(),
        }}
      >
        {effective()}
        {props.suffix ?? ''}
      </span>
    </Show>
  );
}

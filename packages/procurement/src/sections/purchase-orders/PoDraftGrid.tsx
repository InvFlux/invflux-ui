import { __, _n, _x, sprintf } from '@invflux/i18n';
import {
  DataGrid,
  type DataGridMenuItem,
  drilldownRegistry,
  EMPTY_SELECTION,
  type GridColumnMeta,
  type SearchSelectOption,
  type SelectionState,
  type StagedCell,
} from '@invflux/ui';
import { type ColumnDef, createColumnHelper } from '@tanstack/solid-table';
import type {
  ColumnOrderState,
  RowSelectionState,
  SortingState,
  VisibilityState,
} from '@tanstack/solid-table';
import { createEffect, createMemo, createSignal, type JSX, Show } from 'solid-js';
import { useProcurement } from '../../context';
import { createApi } from '../../lib/api';
import { OnOrderDrilldown, type OnOrderResponse } from '../../components/OnOrderDrilldown';
import { registerCataloguePickerEditor } from '../../grid/cataloguePickerEditor';
import { registerReceiptEditor } from '../../grid/receiptEditor';
import { firstEditableColumnId } from '../../grid/editableColumn';
import { fuzzyMatches } from '../../grid/fuzzyMatch';
import { persistedSignal } from '../../grid/persistedSignal';
import { belowMoq, offCasePack } from '../../grid/qtyRules';
import { QuickFilter, isTypingInField } from '../../grid/QuickFilter';
import { usePortalRoot } from '../../portal';
import type { AddOption } from './AddPicker';
import { atSupplierPrecision, formatDiscount } from './linePrice';
import { SkuCell } from './SkuCell';
import type { PoLine } from './types';

// Register the "On order" drill-down once, at module load: double-clicking the green +N cell resolves
// this component by the column's `number:on-order` datatype (grid drill-down mechanism, §11.7).
// Registered WITHOUT `default: true` on purpose: it is the base *fallback* (first registration for the
// datatype becomes the default), so an add-on that contributes a richer body registers WITH
// `default: true` and wins **regardless of load order** — otherwise this module, which loads lazily on
// procurement navigation, would re-assert its default *after* a boot-time add-on registration and
// clobber it.
drilldownRegistry.register('number:on-order', 'core.on-order', OnOrderDrilldown);
// The Qty cell reuses the goods-reception numeric editor so "." auto-fills the per-row suggested qty
// (the `dotDefault` injected via resolveEditorMeta) — same UX as GR's "." → outstanding qty.
registerReceiptEditor();

/** Sentinel id for the always-present append row (real ids are positive; optimistic temps negative). */
const DRAFT_ID = 0;
/** Custom editor datatype for the append-row's product cell (the catalogue search-combobox). */
const PRODUCT_EDITOR_TYPE = 'text:catalogue-add';

/** Patch a single editable field of an existing draft line (immediate, optimistic — the host owns it). */
export interface DraftLinePatch {
  qty_requested?: number;
  /** The price before any discount; `null` returns the line to the catalogue price. */
  unit_cost?: string | null;
  /** The supplier's discount in percent, taken off `unit_cost`; `null` removes it. */
  discount_pct?: string | null;
  note?: string | null;
}

const COLUMN_ORDER = [
  'image',
  'product',
  'sku',
  'supplier_sku',
  'available',
  'on_order',
  'reorder',
  'moq',
  'case_pack',
  'qty_requested',
  'unit_cost',
  'discount_pct',
  'line_total',
  'note',
];

/** GridColumnMeta with draft-editor defaults filled in; all columns share the one "Procurement" group. */
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
    group: 'po-draft',
    priority: 0,
    visibleByDefault: true,
    defaultWidth: 110,
    editorConfig: {},
    ...over,
  };
}

interface PoDraftGridProps {
  lines: PoLine[];
  costDecimals: number;
  /** Catalogue lookups (MOQ / case-pack live on the supplier product, not the PO line). */
  moqFor: (subjectId: number) => number | null;
  casePackFor: (subjectId: number) => number | null;
  /** Addable catalogue products (supplier catalogue minus products already on the PO) for the append row. */
  addOptions: () => AddOption[];
  /** Supplier display/nickname — for the append-row's "all products added" empty state. */
  supplierLabel: string;
  /** Append-row commit: persist a new line for the picked product (server auto-fills qty + cost via
   *  replenishment), resolving to the new line's id (null on failure) so the grid can focus its qty. */
  onAddLine: (subjectId: number) => Promise<number | null>;
  /** Immediate-commit seam: persist one changed field of a line (optimistic). */
  onEdit: (lineId: number, patch: DraftLinePatch) => void;
  /** Remove the given lines (the right-click "Delete N selected rows"). */
  onRemoveMany: (lineIds: number[]) => void;
}

/**
 * The draft PO line editor on the shared DataGrid. Immediate-commit: every cell edit (qty / unit cost /
 * note) persists at once via {@link PoDraftGridProps.onEdit} (optimistic) — no staged dirty model, so the
 * grid reads the freshly-updated value straight back through `getValue`. Quick-filter + persisted column
 * layout mirror the reception grid; the catalogue add-picker + paste import stay around the grid as chrome.
 *
 * Stage 1: existing-line editing. Stage 2 (this file) adds the MS-Access-style append-row: a permanent
 * blank row at the bottom whose product cell is a portaled search-combobox; picking a product focuses
 * the qty, and Enter / Tab-off-the-last-cell persists the line and respawns a fresh blank row (continuous
 * data entry). The `Insert` key jumps focus to the append-row's product picker from anywhere in the grid.
 */
export function PoDraftGrid(props: PoDraftGridProps): JSX.Element {
  const ctx = useProcurement();
  const portalRoot = usePortalRoot();
  const isPro = ctx.hasPro; // barcode (GTIN) matching is Pro; name / SKU / supplier-SKU are Essentials
  const api = createApi(ctx);

  // On-order drill-down data source (only the on_order column carries hasDrilldown). Fetched by the
  // subject (not the line id) — the grid hands us the full row. Tier-gating is server-side (`locked`).
  const fetchDrilldown = async (
    _columnId: string,
    row: PoLine,
  ): Promise<{ title?: () => JSX.Element; detail: unknown; subtitle?: () => JSX.Element }> => {
    const res = await api.get<OnOrderResponse>('/procurement/purchase-orders/on-order', {
      subject_id: row.subjectId,
    });
    // Override the frame's default title (the "On order" column label) with a richer one carrying the
    // SKU (smaller/gray); product name goes on the subtitle line. No SKU → fall back to the plain label.
    return {
      title: row.sku
        ? () => (
            <>
              {__('On order')} <span class="text-xs font-normal text-text-muted">- {row.sku}</span>
            </>
          )
        : undefined,
      subtitle: row.productLabel ? () => row.productLabel : undefined,
      detail: res,
    };
  };

  // Effective cost = the line's own unit cost, or the inherited catalogue price when unset.
  const effectiveCost = (l: PoLine): string | null => l.unitCost ?? l.catalogUnitCost;
  const lineTotalNum = (l: PoLine): number => {
    const cost = effectiveCost(l);
    return null === cost ? 0 : l.qtyRequested * Number(cost);
  };

  // Quick-filter: fuzzy-match the rows on the identifier fields; non-matching lines hide immediately.
  const [filterText, setFilterText] = createSignal('');
  const matchFields = (l: PoLine): Array<string | null> =>
    isPro ? [l.productLabel, l.sku, l.supplierSku, l.gtin] : [l.productLabel, l.sku, l.supplierSku];
  const visibleLines = createMemo<PoLine[]>(() =>
    '' === filterText().trim()
      ? props.lines
      : props.lines.filter((l) => fuzzyMatches(filterText(), matchFields(l))),
  );

  // ── Append row (MS-Access style) ────────────────────────────────────────────────────────────────
  // A synthetic PoLine (id = DRAFT_ID) always appended last, exempt from the quick filter. It's a
  // *native* grid row: only the product cell is editable, through the grid's own editor system (the
  // catalogue picker registered here). Picking a product persists the line — the server auto-fills the
  // quantity + cost via replenishment — and focus jumps into the new line's qty editor.
  registerCataloguePickerEditor();

  const draftLine = (): PoLine => ({
    id: DRAFT_ID,
    subjectId: 0,
    postId: null,
    productLabel: '',
    sku: null,
    supplierSku: null,
    gtin: null,
    imageUrl: null,
    exists: true,
    qtyRequested: 0,
    qtyExpected: null,
    qtyReceived: 0,
    qtyDamagedSoFar: 0,
    qtyClosedShort: 0,
    qtyOpen: 0,
    unitCost: null,
    listUnitCost: null,
    discountPct: null,
    unitCostInvoiced: null,
    qtyInvoiced: 0,
    lineTotal: null,
    available: null,
    onOrder: null,
    reorderThreshold: null,
    suggestedQty: null,
    catalogUnitCost: null,
    note: null,
  });
  const isDraft = (l: PoLine): boolean => DRAFT_ID === l.id;
  const gridRows = createMemo<PoLine[]>(() => [...visibleLines(), draftLine()]);

  // Persist the picked product, then drop into the new line's qty editor once it has rendered (the
  // server filled a sensible replenishment qty + the catalogue cost; the operator tweaks the qty).
  const addAndEdit = async (subjectId: number): Promise<void> => {
    const newId = await props.onAddLine(subjectId);
    if (null === newId) return;
    queueMicrotask(() => gridApi?.focusCellById(String(newId), 'qty_requested', true));
  };

  const columnMetas = createMemo<GridColumnMeta[]>(() => [
    colMeta({
      id: 'image',
      label: __('Image'),
      description: __('Product thumbnail'),
      dataType: 'text',
      defaultWidth: 56,
    }),
    colMeta({
      id: 'product',
      label: __('Product'),
      description: __(
        'Product name. Use the blank bottom row to add another product from the supplier catalogue.',
      ),
      dataType: PRODUCT_EDITOR_TYPE,
      copyable: true,
      defaultWidth: 280,
    }),
    colMeta({
      id: 'sku',
      label: __('SKU'),
      description: __(
        'Our Stock Keeping Unit for this product, with its GTIN beneath where the two differ',
      ),
      dataType: 'text',
      copyable: true,
      defaultWidth: 120,
    }),
    colMeta({
      id: 'supplier_sku',
      label: __('Supplier SKU'),
      description: __('The supplier’s own code for this product'),
      dataType: 'text',
      copyable: true,
      defaultWidth: 130,
    }),
    colMeta({
      id: 'available',
      label: __('Avail'),
      description: __(
        'Available to promise now (on-hand minus reserved). Negative = a deficit already promised beyond stock.',
      ),
      dataType: 'number',
      defaultWidth: 72,
    }),
    colMeta({
      id: 'on_order',
      label: __('On order'),
      description: __(
        'Units already inbound on other submitted purchase orders. Double-click to see which POs.',
      ),
      dataType: 'number:on-order',
      hasDrilldown: true,
      drilldownMaxWidth: 'max-w-[26rem]',
      defaultWidth: 80,
    }),
    colMeta({
      id: 'reorder',
      label: _x(
        'Reorder',
        'column header: the reorder threshold, the stock level that triggers a reorder',
      ),
      description: __(
        'The reorder threshold — replenishment tops the product back up to here when it drops below.',
      ),
      dataType: 'number',
      defaultWidth: 76,
    }),
    colMeta({
      id: 'moq',
      label: __('MOQ'),
      description: __('Minimum order quantity the supplier accepts for this product'),
      dataType: 'number',
      defaultWidth: 64,
    }),
    colMeta({
      id: 'case_pack',
      label: __('Case pack'),
      description: __('Units per case — order quantities should be whole multiples of this'),
      dataType: 'number',
      defaultWidth: 84,
    }),
    colMeta({
      id: 'qty_requested',
      label: __('Qty'),
      description: __(
        'Quantity to order. “.” fills the suggested replenishment quantity; red flags a MOQ / case-pack issue.',
      ),
      dataType: 'number:receipt',
      kind: 'editable',
      editable: true,
      copyable: true,
      pasteable: true,
      defaultWidth: 80,
    }),
    colMeta({
      id: 'unit_cost',
      label: __('Unit cost'),
      description: __(
        'Cost per unit, before any supplier discount. Left blank it inherits the supplier catalogue price (shown faded) and is frozen at submission.',
      ),
      dataType: 'decimal:money',
      kind: 'editable',
      editable: true,
      copyable: true,
      pasteable: true,
      defaultWidth: 110,
    }),
    colMeta({
      id: 'discount_pct',
      label: __('Disc. %'),
      description: __(
        'The supplier’s discount on this line, in percent, taken off the unit cost — the line total is the net. Select the whole column to give every line the same discount.',
      ),
      dataType: 'decimal',
      kind: 'editable',
      editable: true,
      copyable: true,
      pasteable: true,
      defaultWidth: 80,
    }),
    colMeta({
      id: 'line_total',
      label: __('Line total'),
      description: __('Quantity × effective unit cost'),
      dataType: 'decimal:money',
      copyable: true,
      defaultWidth: 110,
    }),
    colMeta({
      id: 'note',
      label: __('Note'),
      description: __('Optional line note — printed on the purchase order sent to the supplier'),
      dataType: 'text',
      kind: 'editable',
      editable: true,
      copyable: true,
      pasteable: true,
      defaultWidth: 220,
    }),
  ]);

  const ch = createColumnHelper<PoLine>();
  const money = (v: number | string | null): string =>
    null === v || '' === v ? '—' : Number(v).toFixed(props.costDecimals);
  const bespokeColumns = new Map<string, ColumnDef<PoLine, unknown>>([
    [
      'image',
      ch.display({
        id: 'image',
        header: () => __('Image'),
        cell: (info) => (
          <Show
            when={!isDraft(info.row.original)}
            fallback={<span class="block text-center text-slate-300">＋</span>}
          >
            <Show
              when={info.row.original.imageUrl}
              fallback={<div class="h-9 w-9 rounded bg-slate-100" />}
            >
              {(u) => <img src={u()} alt="" class="h-9 w-9 rounded object-cover" />}
            </Show>
          </Show>
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'product',
      ch.display({
        id: 'product',
        header: () => __('Product'),
        cell: (info) => (
          <Show
            when={!isDraft(info.row.original)}
            fallback={
              // Display only — the grid swaps in the catalogue-picker editor (PRODUCT_EDITOR_TYPE) on edit.
              <span class="italic text-text-muted">{__('＊ Add a product ＊')}</span>
            }
          >
            <ProductCell line={info.row.original} />
          </Show>
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'sku',
      ch.display({
        id: 'sku',
        header: () => __('SKU'),
        cell: (info) => (
          <Show when={!isDraft(info.row.original)}>
            <SkuCell line={info.row.original} />
          </Show>
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'supplier_sku',
      ch.display({
        id: 'supplier_sku',
        header: () => __('Supplier SKU'),
        cell: (info) => (
          <Show when={!isDraft(info.row.original)}>
            <CodeCell value={info.row.original.supplierSku} />
          </Show>
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'available',
      ch.display({
        id: 'available',
        header: () => __('Avail'),
        cell: (info) => (
          <Show when={!isDraft(info.row.original)}>
            <SignedCell value={info.row.original.available} />
          </Show>
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'on_order',
      ch.display({
        id: 'on_order',
        header: () => __('On order'),
        cell: (info) => (
          <Show when={!isDraft(info.row.original)}>
            <OnOrderCell value={info.row.original.onOrder} />
          </Show>
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'reorder',
      ch.display({
        id: 'reorder',
        header: () =>
          _x(
            'Reorder',
            'column header: the reorder threshold, the stock level that triggers a reorder',
          ),
        cell: (info) => (
          <Show when={!isDraft(info.row.original)}>
            <NumCell value={info.row.original.reorderThreshold} />
          </Show>
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'moq',
      ch.display({
        id: 'moq',
        header: () => __('MOQ'),
        cell: (info) => (
          <Show when={!isDraft(info.row.original)}>
            <MoqCell
              moq={props.moqFor(info.row.original.subjectId)}
              qty={info.row.original.qtyRequested}
            />
          </Show>
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'case_pack',
      ch.display({
        id: 'case_pack',
        header: () => __('Case pack'),
        cell: (info) => (
          <Show when={!isDraft(info.row.original)}>
            <CasePackCell
              casePack={props.casePackFor(info.row.original.subjectId)}
              qty={info.row.original.qtyRequested}
            />
          </Show>
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'qty_requested',
      ch.display({
        id: 'qty_requested',
        header: () => __('Qty'),
        cell: (info) => (
          <Show when={!isDraft(info.row.original)}>
            <QtyCell
              qty={info.row.original.qtyRequested}
              moq={props.moqFor(info.row.original.subjectId)}
              casePack={props.casePackFor(info.row.original.subjectId)}
            />
          </Show>
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'unit_cost',
      ch.display({
        id: 'unit_cost',
        header: () => __('Unit cost'),
        cell: (info) => (
          <Show when={!isDraft(info.row.original)}>
            {/* The price before the discount — what the supplier quoted; the net is in the total. */}
            <UnitCostCell
              own={info.row.original.listUnitCost ?? info.row.original.unitCost}
              inherited={info.row.original.catalogUnitCost}
              fmt={money}
            />
          </Show>
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'discount_pct',
      ch.display({
        id: 'discount_pct',
        header: () => __('Disc. %'),
        cell: (info) => (
          <Show when={!isDraft(info.row.original)}>
            <span class="block text-right tabular-nums">
              {formatDiscount(info.row.original.discountPct)}
            </span>
          </Show>
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'line_total',
      ch.display({
        id: 'line_total',
        header: () => __('Line total'),
        cell: (info) => (
          <Show when={!isDraft(info.row.original)}>
            <span class="block text-right font-medium tabular-nums">
              {money(lineTotalNum(info.row.original))}
            </span>
          </Show>
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'note',
      ch.display({
        id: 'note',
        header: () => __('Note'),
        cell: (info) => (
          <Show when={!isDraft(info.row.original)}>
            <span class="text-slate-600">{info.row.original.note ?? ''}</span>
          </Show>
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
  ]);

  // ── DataGrid state ────────────────────────────────────────────────────────────────────────────
  const [sorting, setSorting] = createSignal<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = persistedSignal<VisibilityState>(
    'invflux:po-draft:colvis',
    {},
  );
  // Versioned: a saved order predating a column would show that column at the far end, away from
  // the neighbours it belongs with. Bump the suffix when a column joins the middle of the order.
  const [columnOrder, setColumnOrder] = persistedSignal<ColumnOrderState>(
    'invflux:po-draft:colorder:v2',
    COLUMN_ORDER,
  );
  const [columnSizing, setColumnSizing] = persistedSignal<Record<string, number>>(
    'invflux:po-draft:colsize',
    {},
  );
  const [expandedColumnSections, setExpandedColumnSections] = persistedSignal<string[]>(
    'invflux:po-draft:colsections',
    ['po-draft'],
  );
  const [rowSelection, setRowSelection] = createSignal<RowSelectionState>({});
  const [cellSelection, setCellSelection] = createSignal<SelectionState>(EMPTY_SELECTION);

  const getValue = (row: PoLine, columnId: string): unknown => {
    if (isDraft(row)) return undefined; // the append row renders its own controls; no grid value
    switch (columnId) {
      case 'image':
        return row.imageUrl;
      case 'product':
        return row.productLabel;
      case 'sku':
        return row.sku;
      case 'supplier_sku':
        return row.supplierSku;
      case 'available':
        return row.available;
      case 'on_order':
        return row.onOrder;
      case 'reorder':
        return row.reorderThreshold;
      case 'moq':
        return props.moqFor(row.subjectId);
      case 'case_pack':
        return props.casePackFor(row.subjectId);
      case 'qty_requested':
        return row.qtyRequested;
      case 'unit_cost':
        // At the supplier's precision, so the cell opens on the figure they quoted, not the stored scale.
        return atSupplierPrecision(row.listUnitCost ?? row.unitCost, props.costDecimals);
      case 'discount_pct':
        return row.discountPct;
      case 'line_total':
        return lineTotalNum(row);
      case 'note':
        return row.note;
      default:
        return undefined;
    }
  };

  // Immediate-commit: no staged dirty model — the optimistic patch updates the cache, the grid re-reads.
  const getStagedValue = (): StagedCell => ({ staged: false, value: undefined });
  const canEdit = (row: PoLine, meta: GridColumnMeta): boolean =>
    // The append row is editable only at its product cell (the catalogue picker); real rows edit
    // qty / cost / note.
    isDraft(row) ? 'product' === meta.id : EDITABLE_COLS.has(meta.id);
  const resolveClearedValue = (
    _row: PoLine,
    meta: GridColumnMeta,
  ): { ok: boolean; value: unknown } =>
    'unit_cost' === meta.id || 'discount_pct' === meta.id || 'note' === meta.id
      ? { ok: true, value: null } // nullable → clear to empty
      : 'qty_requested' === meta.id
        ? { ok: true, value: 0 } // non-nullable → Del sets it to 0
        : { ok: false, value: null };

  // The product cell's editor needs the live catalogue + portal target + supplier label; inject them as
  // editorConfig for the append row only (real rows have no editable product cell).
  const resolveEditorMeta = (meta: GridColumnMeta, row: PoLine): GridColumnMeta => {
    if (isDraft(row) && 'product' === meta.id) {
      return {
        ...meta,
        editorConfig: {
          addOptions: props.addOptions,
          portalRoot,
          supplierLabel: props.supplierLabel,
        },
      };
    }
    // Qty cell: "." on an empty cell fills the per-line replenishment suggestion (mirrors GR's "." →
    // outstanding qty). dotDefault is absent when there's no suggestion, so "." then does nothing.
    if ('qty_requested' === meta.id) {
      return {
        ...meta,
        editorConfig: { dotDefault: row.suggestedQty ?? undefined, ariaLabel: __('Qty') },
      };
    }
    return meta;
  };

  const onStageEdit = (row: PoLine, columnId: string, _original: unknown, next: unknown): void => {
    if (isDraft(row) && 'product' === columnId) {
      // The catalogue picker committed a product → persist the line + jump into its qty.
      const opt = next as SearchSelectOption | null;
      if (null !== opt) void addAndEdit(Number(opt.value));
    } else if ('qty_requested' === columnId) {
      props.onEdit(row.id, {
        qty_requested: null === next || undefined === next ? 0 : Number(next),
      });
    } else if ('unit_cost' === columnId) {
      props.onEdit(row.id, {
        unit_cost: null === next || undefined === next || '' === next ? null : String(next),
      });
    } else if ('discount_pct' === columnId) {
      props.onEdit(row.id, {
        discount_pct: null === next || undefined === next || '' === next ? null : String(next),
      });
    } else if ('note' === columnId) {
      props.onEdit(row.id, {
        note: null === next || undefined === next || '' === next ? null : String(next),
      });
    }
  };
  // After committing the append-row product the host drives focus to the new line's qty itself, so the
  // grid skips its default post-commit move. (Landing on the append row from elsewhere is handled by the
  // selection guard above — it bounces to the product cell in cell-nav mode.)
  const onCommitNavigate = (row: PoLine, columnId: string): boolean =>
    isDraft(row) && 'product' === columnId;
  const onClearCells = (cells: Array<{ row: PoLine; columnId: string }>): void => {
    for (const { row, columnId } of cells) {
      if ('unit_cost' === columnId) props.onEdit(row.id, { unit_cost: null });
      else if ('discount_pct' === columnId) props.onEdit(row.id, { discount_pct: null });
      else if ('note' === columnId) props.onEdit(row.id, { note: null });
      else if ('qty_requested' === columnId) props.onEdit(row.id, { qty_requested: 0 });
    }
  };

  let focusFilter: (() => void) | undefined;
  let gridApi:
    | {
        focusGrid: () => void;
        focusCellById: (rowId: string, columnId: string, editMode?: boolean) => void;
        openColumnManager: () => void;
        openGridSettings: () => void;
        getSelectedCells: () => Array<{ row: PoLine; columnId: string }>;
        getSelectableColumnIds: () => string[];
        enterEdit: (seed?: string) => void;
      }
    | undefined;

  // Editable line columns (the grid edit-guard set for real rows).
  const EDITABLE_COLS = new Set(['qty_requested', 'unit_cost', 'discount_pct', 'note']);
  // The product cell is the only useful cell on the append row, so bounce any selection that lands on
  // another of its cells (arrow / click / Tab / Enter-from-the-last-line) straight there (cell-nav).
  // The draft row is appended last → its index is visibleLines().length.
  createEffect(() => {
    const active = cellSelection().active;
    if (null === active || active.row !== visibleLines().length) return;
    const productCol = (gridApi?.getSelectableColumnIds() ?? []).indexOf('product');
    if (productCol >= 0 && active.col !== productCol)
      gridApi?.focusCellById(String(DRAFT_ID), 'product', false);
  });

  // Right-click "Delete N selected rows" — there's no per-row delete column; deletion is driven off the
  // cell selection (distinct rows that have at least one selected cell), excluding the append row.
  const contextMenuExtras = (): DataGridMenuItem[] => {
    const ids = [...new Set((gridApi?.getSelectedCells() ?? []).map((c) => c.row.id))].filter(
      (id) => DRAFT_ID !== id,
    );
    if (0 === ids.length) return [];
    return [
      {
        id: 'delete-rows',
        label: sprintf(
          _n('Delete %d selected row', 'Delete %d selected rows', ids.length),
          ids.length,
        ),
        run: () => {
          props.onRemoveMany(ids);
          setCellSelection(EMPTY_SELECTION); // the selection pointed at rows that are now gone
        },
      },
    ];
  };
  const inGridKeyHandlers = [
    (e: KeyboardEvent): boolean => {
      if ('Escape' === e.key) {
        e.preventDefault();
        focusFilter?.();
        return true;
      }
      return false;
    },
    (e: KeyboardEvent): boolean => {
      // Numpad "." (Num Lock on → code=NumpadDecimal, key=".") should behave like the main "." key:
      // seed the editor so the Qty cell's dotDefault fills. The grid otherwise treats NumpadDecimal as
      // a clear; Num Lock OFF reports key="Delete", which we leave to the grid's clear (→ 0 for Qty).
      if ('NumpadDecimal' === e.code && '.' === e.key) {
        e.preventDefault();
        gridApi?.enterEdit('.');
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
      // Insert jumps into the append-row product picker (continuous data entry), even when not typing.
      if ('Insert' === e.key && !isTypingInField()) {
        e.preventDefault();
        gridApi?.focusCellById(String(DRAFT_ID), 'product', true);
        return true;
      }
      // Ctrl/Cmd+M (columns) and Ctrl/Cmd+, (grid display) are grid built-ins — no per-consumer wiring.
      return false;
    },
  ];

  // Enter from the filter with a single match jumps straight to that row's left-most editable cell
  // (Qty here — the first editable column in display order); otherwise (multi-match or Esc) cell-nav.
  const onFilterLeave = (key: 'Enter' | 'Escape'): void => {
    if ('Enter' === key && 1 === visibleLines().length) {
      const row = visibleLines()[0];
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

  return (
    <div>
      <div class="mb-2">
        <QuickFilter
          value={filterText}
          onInput={setFilterText}
          onLeave={onFilterLeave}
          ref={(focus) => (focusFilter = focus)}
          placeholder={isPro ? __('Filter — name / SKU / barcode…') : __('Filter — name or SKU…')}
        />
      </div>

      <div class="flex max-h-[70vh] flex-col">
        <DataGrid<PoLine>
          rows={gridRows}
          getRowId={(l) => String(l.id)}
          rowAttrs={(l) => (isDraft(l) ? { class: 'bg-primary/5' } : {})}
          columnMetas={columnMetas}
          getValue={getValue}
          bespokeColumns={bespokeColumns}
          fetchDrilldown={fetchDrilldown}
          canEdit={canEdit}
          getStagedValue={getStagedValue}
          resolveClearedValue={resolveClearedValue}
          resolveEditorMeta={resolveEditorMeta}
          apiRef={(api) => (gridApi = api)}
          contextMenuExtras={contextMenuExtras}
          settingsKey="po-draft"
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
              {__('No lines yet — use + Add to pick from the supplier catalogue.')}
            </div>
          }
        />
      </div>
    </div>
  );
}

/** Product label (the codes have their own columns). */
function ProductCell(props: { line: PoLine }): JSX.Element {
  return (
    <div class="font-medium" classList={{ 'text-text-muted italic': !props.line.exists }}>
      {props.line.productLabel}
    </div>
  );
}

function CodeCell(props: { value: string | null }): JSX.Element {
  return <span class="block font-mono text-slate-500">{props.value ?? '—'}</span>;
}

function NumCell(props: { value: number | null }): JSX.Element {
  return (
    <span class="block text-right tabular-nums text-slate-500">
      {null === props.value ? '—' : props.value}
    </span>
  );
}

/** Qty cell with MOQ / case-pack validation: red + bold when the entered qty breaks either supplier
 *  rule, with a native tooltip carrying one line per broken rule (blank / 0 is never a violation). */
function QtyCell(props: { qty: number; moq: number | null; casePack: number | null }): JSX.Element {
  const tips = (): string[] => {
    const msgs: string[] = [];
    if (belowMoq(props.qty, props.moq)) msgs.push(__('qty < MOQ'));
    if (offCasePack(props.qty, props.casePack)) msgs.push(__('case pack ∤ qty'));
    return msgs;
  };
  return (
    <span
      class="block text-right tabular-nums"
      classList={{ 'font-medium text-red-600': tips().length > 0 }}
      title={tips().length > 0 ? tips().join('\n') : undefined}
    >
      {props.qty}
    </span>
  );
}

/** MOQ cell — reddened when the line's qty is below it (so the offending pair reads red together). */
function MoqCell(props: { moq: number | null; qty: number }): JSX.Element {
  const bad = (): boolean => belowMoq(props.qty, props.moq);
  return (
    <span
      class="block text-right tabular-nums"
      classList={{ 'font-medium text-red-600': bad(), 'text-slate-500': !bad() }}
      title={bad() ? __('qty < MOQ') : undefined}
    >
      {null === props.moq ? '—' : props.moq}
    </span>
  );
}

/** Case-pack cell — reddened when the line's qty is not a whole multiple of it. */
function CasePackCell(props: { casePack: number | null; qty: number }): JSX.Element {
  const bad = (): boolean => offCasePack(props.qty, props.casePack);
  return (
    <span
      class="block text-right tabular-nums"
      classList={{ 'font-medium text-red-600': bad(), 'text-slate-500': !bad() }}
      title={bad() ? __('case pack ∤ qty') : undefined}
    >
      {null === props.casePack ? '—' : props.casePack}
    </span>
  );
}

/** On order: gray "—"/"0" when none is inbound; green **+N** (attention) when stock is coming — a
 *  drill-down (double-click) into the open POs behind it. The double-click is handled by the grid's
 *  drill-down mechanism (the column carries `hasDrilldown`); this cell just styles + hints it. */
function OnOrderCell(props: { value: number | null }): JSX.Element {
  return (
    <Show
      when={null !== props.value && (props.value as number) > 0}
      fallback={
        <span class="block text-right tabular-nums text-text-muted">
          {null === props.value ? '—' : 0}
        </span>
      }
    >
      <span
        class="block cursor-pointer text-right font-medium tabular-nums text-emerald-600 underline decoration-dotted underline-offset-2 hover:text-emerald-700"
        title={__('Double-click to see what’s on order')}
      >
        +{props.value}
      </span>
    </Show>
  );
}

/** Unit cost: the line's own override in normal text; when unset, the inherited catalogue price shown
 *  faded (italic) — or "—" when the catalogue has no price either. Frozen to the catalogue at submit. */
function UnitCostCell(props: {
  own: string | null;
  inherited: string | null;
  fmt: (v: string | number | null) => string;
}): JSX.Element {
  return (
    <Show
      when={null !== props.own}
      fallback={
        <span
          class="block text-right italic tabular-nums text-text-muted"
          title={__('Inherited from the supplier catalogue')}
        >
          {props.fmt(props.inherited)}
        </span>
      }
    >
      <span class="block text-right tabular-nums">{props.fmt(props.own)}</span>
    </Show>
  );
}

/** Signed available — negative (deficit) in red. */
function SignedCell(props: { value: number | null }): JSX.Element {
  return (
    <span
      class="block text-right tabular-nums"
      classList={{
        'text-red-600': null !== props.value && props.value < 0,
        'text-slate-500': null === props.value || props.value >= 0,
      }}
    >
      {null === props.value ? '—' : props.value}
    </span>
  );
}

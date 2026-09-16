import { __, _n, sprintf } from '@invflux/i18n';
import {
  Button,
  COMMON_ALIASES,
  DataGrid,
  EMPTY_SELECTION,
  ImportWizard,
  fetchImportAliases,
  learnImportAlias,
  parseImportFile,
  toast,
  type GridColumnMeta,
  type ImportField,
  type MappedRow,
  type ResolvedRow,
  type SelectionState,
  type StagedCell,
} from '@invflux/ui';
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query';
import { type ColumnDef, createColumnHelper } from '@tanstack/solid-table';
import type {
  ColumnOrderState,
  RowSelectionState,
  SortingState,
  VisibilityState,
} from '@tanstack/solid-table';
import { createMemo, createSignal, type JSX, Show } from 'solid-js';
import { useProcurement } from '../../context';
import { persistedSignal } from '../../grid/persistedSignal';
import { registerReceiptEditor } from '../../grid/receiptEditor';
import { createApi } from '../../lib/api';
import { supplierDocHeading } from './supplierDocKinds';
import { atSupplierPrecision, formatDiscount, netOfDiscount } from './linePrice';
import { SkuCell } from './SkuCell';
import type { PoLine } from './types';

// The numeric editor (blank-start, `.`-fill, clamp) shared with the receive and draft grids.
registerReceiptEditor();

const COLUMN_ORDER = [
  'product',
  'sku',
  'ordered',
  'billed_so_far',
  'qty',
  'unit_cost',
  'discount_pct',
  'line_total',
];

/** GridColumnMeta with capture-friendly defaults; `over` carries the per-column bits. */
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
    group: 'invoice-capture',
    priority: 0,
    visibleByDefault: true,
    defaultWidth: 110,
    editorConfig: {},
    ...over,
  };
}

/** Today in the `YYYY-MM-DD` form `<input type="date">` reads and writes. */
function today(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');

  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Record what the supplier charged: their reference and date, and per line the quantity billed at
 * the price billed.
 *
 * **It records a financial fact and moves nothing.** No stock, no order status, no payable — an
 * invoice arrives before, during or after the delivery and after the order closes, so there is no
 * state this is illegal from and nothing here waits on receiving. What it changes is the two cached
 * figures on each ordered line, and through them the value of anything received *afterwards*.
 *
 * **The price replaces; the quantity accumulates.** A second invoice at a different price is the new
 * rate, never an average of the two — each goods receipt freezes the rate standing when it is posted
 * and the weighted average blends across those, so a part delivery billed at one price and the
 * remainder at another are each valued at what they actually cost. Averaging here would value both
 * at a figure neither was bought at. The consequence worth knowing is the mirror of it: a receipt
 * posted before its invoice keeps the price it froze. Revaluing it afterwards is a separate concern.
 */
export function PoInvoiceCapture(props: {
  poId: number;
  lines: PoLine[];
  /** The order's transaction currency — the default, never a constraint (see {@link currency}). */
  currency: string;
  /** Decimal places this supplier's prices are written in. */
  costDecimals: number;
  onDone: () => void;
}): JSX.Element {
  const ctx = useProcurement();
  const api = createApi(ctx);
  const queryClient = useQueryClient();

  const [reference, setReference] = createSignal('');
  const [invoicedAt, setInvoicedAt] = createSignal(today());
  const [currency, setCurrency] = createSignal(props.currency);
  const [statedTotal, setStatedTotal] = createSignal('');
  const [note, setNote] = createSignal('');
  // Per-line entry. Quantity blank = this invoice does not bill this line; price blank = billed at
  // the rate the line already stands at (shown faded), which is the common case for a plain invoice.
  const [qty, setQty] = createSignal<Record<number, number | null>>({});
  const [rate, setRate] = createSignal<Record<number, string | null>>({});
  // A discount typed here — `null` included, which states "no discount" rather than "not typed" — so
  // presence in the map is what separates the operator's word from the line's standing discount.
  const [discount, setDiscount] = createSignal<Record<number, string | null>>({});

  const qtyFor = (id: number): number | null => qty()[id] ?? null;
  const typedRateFor = (id: number): string | null => rate()[id] ?? null;
  const typedDiscountFor = (id: number): string | null | undefined =>
    id in discount() ? (discount()[id] ?? null) : undefined;

  /**
   * What a unit stands at before this invoice, before any discount: the last invoiced rate if there
   * is one, else the agreed price as the supplier quoted it. With the standing discount below, the
   * same figure the server values a delivery at.
   */
  const standingRate = (line: PoLine): string | null =>
    line.unitCostInvoiced ?? line.listUnitCost ?? line.unitCost ?? line.catalogUnitCost;
  /** The discount the line stands at — the order's, until an invoice has stated a net rate. */
  const standingDiscount = (line: PoLine): string | null =>
    null === line.unitCostInvoiced ? line.discountPct : null;
  /** The rate this invoice will state for a line, before its discount — typed, or the standing one. */
  const effectiveRate = (line: PoLine): string | null =>
    typedRateFor(line.id) ?? standingRate(line);
  const effectiveDiscount = (line: PoLine): string | null => {
    const typed = typedDiscountFor(line.id);
    return undefined === typed ? standingDiscount(line) : typed;
  };
  /** The net a unit is billed at: the rate less the discount. What totals and the server both use. */
  const netRate = (line: PoLine): string | null => {
    const r = effectiveRate(line);
    const d = effectiveDiscount(line);
    return null === r || null === d ? r : netOfDiscount(r, d, props.costDecimals);
  };
  /**
   * A line's total, always as a figure: the quantity this invoice bills, else what was ordered, at
   * the net rate it will state. A blank Qty billed still leaves the line unbilled — the figure shows
   * what the order implies, so the column reads as a whole invoice rather than a row of gaps.
   */
  const lineTotal = (line: PoLine): string | null => {
    const r = netRate(line);
    return null === r ? null : String((qtyFor(line.id) ?? line.qtyRequested) * Number(r));
  };
  /**
   * Whether a line's total leans on something no invoice has stated: a blank Qty billed, where the
   * ordered quantity stands in, or a price neither typed here nor set by an earlier invoice.
   */
  const totalInherited = (line: PoLine): boolean =>
    null === qtyFor(line.id) || (null === typedRateFor(line.id) && null === line.unitCostInvoiced);

  const billedLines = createMemo(() => props.lines.filter((l) => (qtyFor(l.id) ?? 0) > 0));
  // A line billed at no price at all: nothing typed, and nothing on the order to fall back to. The
  // server drops such a line, so it is flagged here rather than silently going missing from a saved
  // invoice — the operator types a price or clears the quantity.
  const unpricedLines = createMemo(() => billedLines().filter((l) => null === effectiveRate(l)));

  const computedTotal = createMemo(() =>
    billedLines().reduce((sum, l) => sum + (qtyFor(l.id) ?? 0) * Number(netRate(l) ?? 0), 0),
  );
  // The supplier's own total against ours. They are allowed to differ — shipping, a rounding, a
  // charge that is not a line — and that is exactly why the stated figure is kept verbatim rather
  // than computed. Surfaced so the difference is seen at entry rather than discovered later.
  const statedDiffers = (): boolean => {
    const stated = statedTotal().trim();
    if ('' === stated || !Number.isFinite(Number(stated))) return false;

    return Math.abs(Number(stated) - computedTotal()) >= 0.005;
  };

  const canSave = (): boolean =>
    '' !== reference().trim() && billedLines().length > 0 && 0 === unpricedLines().length;

  // ── Bulk entry off the document (shared ImportWizard) ─────────────────────────────────────────
  // An invoice arrives as a spreadsheet often enough to be the ordinary case, so its lines are
  // pasted rather than retyped. Lines are fixed on a sent order, so this matches rows to existing
  // lines by SKU / supplier SKU / GTIN and stages both figures into the same maps manual entry
  // writes to — the operator reviews and then records.
  const [importing, setImporting] = createSignal(false);
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
  const importFields: ImportField[] = [
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
      keyOnly: true,
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
      // Unlike an acknowledgement, a bare "Qty" on an invoice **is** the billed quantity — there is
      // no ordered column beside it competing for the word — so the generic terms belong here.
      key: 'qty',
      label: __('Qty billed'),
      aliasKey: 'invoiced_qty',
      aliases: [
        ...COMMON_ALIASES.qty,
        'billed',
        'billed qty',
        'invoiced',
        'invoiced qty',
        'facturé',
        'facturée',
        'quantité facturée',
        'qté facturée',
      ],
      numeric: true,
    },
    {
      key: 'unit_cost',
      label: __('Unit price'),
      aliasKey: 'invoiced_unit_cost',
      aliases: [...COMMON_ALIASES.cost, 'net price', 'prix net', 'p.u.', 'pu ht'],
      numeric: true,
    },
    {
      key: 'discount_pct',
      label: __('Discount %'),
      aliasKey: 'discount',
      aliases: [
        'discount',
        'disc',
        'disc.',
        'disc %',
        'discount %',
        'remise',
        'remise %',
        'rabais',
        'rabatt',
      ],
      numeric: true,
    },
  ];

  /** Index the PO lines by the chosen key field, normalised (trim + case-insensitive), first-wins. */
  const lineIndex = (keyField: string): Map<string, PoLine> => {
    const pick = (l: PoLine): string | null =>
      'supplier_sku' === keyField ? l.supplierSku : 'gtin' === keyField ? l.gtin : l.sku;
    const idx = new Map<string, PoLine>();
    for (const l of props.lines) {
      const v = (pick(l) ?? '').trim().toLowerCase();
      if ('' !== v && !idx.has(v)) idx.set(v, l);
    }

    return idx;
  };

  const resolveImport = async (rows: MappedRow[], keyField: string): Promise<ResolvedRow[]> =>
    rows.map((r): ResolvedRow => {
      const idx = lineIndex(keyField);
      const k = (r[keyField] ?? '').trim();
      const line = idx.get(k.toLowerCase());
      if (!line) {
        return { key: k, label: k, status: 'unmatched', note: __('No matching line on this PO') };
      }
      const qtyCell = ('qty' in r ? (r.qty ?? '') : '').trim();
      const costCell = ('unit_cost' in r ? (r.unit_cost ?? '') : '').trim();
      const discountCell = ('discount_pct' in r ? (r.discount_pct ?? '') : '').trim();

      return {
        key: k,
        label: line.productLabel || k,
        status: 'matched',
        data: {
          poLineId: line.id,
          qty: '' === qtyCell ? null : Number(qtyCell) || 0,
          // A price column the document did not carry leaves the line at its standing rate rather
          // than at nothing, which is what "the invoice only restates the agreed price" looks like.
          unitCost: '' === costCell ? null : costCell,
          // Likewise a discount column: absent leaves the standing discount; "-" states none.
          discountPct: '' === discountCell ? undefined : '-' === discountCell ? null : discountCell,
        },
        existing: {
          qty: null === qtyFor(line.id) ? '' : String(qtyFor(line.id)),
          unit_cost: atSupplierPrecision(standingRate(line), props.costDecimals) ?? '',
          discount_pct: effectiveDiscount(line) ?? '',
        },
      };
    });

  /** Stage the matched figures into the entry maps (yellow), then close — the operator records. */
  const commitImport = (matched: ResolvedRow[]): void => {
    let staged = 0;
    for (const m of matched) {
      const d = m.data as
        | {
            poLineId: number;
            qty: number | null;
            unitCost: string | null;
            discountPct?: string | null;
          }
        | undefined;
      if (!d) continue;
      if (null !== d.qty) setQty((s) => ({ ...s, [d.poLineId]: d.qty }));
      if (null !== d.unitCost) setRate((s) => ({ ...s, [d.poLineId]: d.unitCost }));
      if (undefined !== d.discountPct)
        setDiscount((s) => ({ ...s, [d.poLineId]: d.discountPct ?? null }));
      staged++;
    }
    setImporting(false);
    if (staged > 0) {
      toast.success(
        sprintf(
          _n('%d line staged — review and record.', '%d lines staged — review and record.', staged),
          staged,
        ),
      );
    }
  };

  const money = (v: number | string | null): string =>
    null === v || '' === v ? '—' : Number(v).toFixed(props.costDecimals);

  const save = createMutation(() => ({
    mutationFn: () =>
      api.post(`/procurement/purchase-orders/${props.poId}/invoices`, {
        reference: reference().trim(),
        invoicedAt: invoicedAt() || null,
        currency: currency().trim().toUpperCase(),
        statedTotal: statedTotal().trim() || null,
        note: note().trim() || null,
        lines: billedLines().map((l) => ({
          poLineId: l.id,
          qty: qtyFor(l.id) ?? 0,
          // The rate before the discount, and the discount; the server computes the net from them.
          unitCost: effectiveRate(l),
          discountPct: effectiveDiscount(l),
        })),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['procurement', 'purchase-orders', String(props.poId)],
      });
      void queryClient.invalidateQueries({ queryKey: ['procurement', 'purchase-orders'] });
      toast.success(__('Invoice recorded.'));
      props.onDone();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : __('Could not record the invoice.')),
  }));

  // ── DataGrid wiring ────────────────────────────────────────────────────────────────────────────
  const ch = createColumnHelper<PoLine>();
  const bespokeColumns = new Map<string, ColumnDef<PoLine, unknown>>([
    [
      'product',
      ch.display({
        id: 'product',
        header: () => __('Product'),
        cell: (info) => <ProductCell line={info.row.original} />,
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'sku',
      ch.display({
        id: 'sku',
        header: () => __('SKU'),
        cell: (info) => <SkuCell line={info.row.original} />,
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'ordered',
      ch.display({
        id: 'ordered',
        header: () => __('Ordered'),
        cell: (info) => (
          <span class="block text-right tabular-nums">{info.row.original.qtyRequested}</span>
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'billed_so_far',
      ch.display({
        id: 'billed_so_far',
        header: () => __('Billed so far'),
        cell: (info) => (
          <Show
            when={info.row.original.qtyInvoiced > 0}
            fallback={<span class="block text-right text-slate-300">—</span>}
          >
            <span class="block text-right tabular-nums">{info.row.original.qtyInvoiced}</span>
          </Show>
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'qty',
      ch.display({
        id: 'qty',
        header: () => __('Qty billed'),
        cell: (info) => (
          <span class="block text-right tabular-nums">{qtyFor(info.row.original.id) ?? '—'}</span>
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'unit_cost',
      ch.display({
        id: 'unit_cost',
        header: () => __('Unit price'),
        cell: (info) => (
          <RateCell
            typed={typedRateFor(info.row.original.id)}
            standing={standingRate(info.row.original)}
            billed={(qtyFor(info.row.original.id) ?? 0) > 0}
            format={money}
          />
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'discount_pct',
      ch.display({
        id: 'discount_pct',
        header: () => __('Disc. %'),
        // The standing discount is shown inherited — the order's, until the invoice says otherwise.
        cell: (info) => (
          <span
            class="block text-right tabular-nums"
            classList={{ inherited: undefined === typedDiscountFor(info.row.original.id) }}
          >
            {formatDiscount(effectiveDiscount(info.row.original))}
          </span>
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'line_total',
      ch.display({
        id: 'line_total',
        header: () => __('Line total'),
        // Read through accessors rather than into locals: a cell body runs once, so a figure
        // computed there is frozen at first render and never follows the entry above it.
        cell: (info) => (
          <LineTotalCell
            total={() => lineTotal(info.row.original)}
            inherited={() => totalInherited(info.row.original)}
            format={money}
          />
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
  ]);

  const columnMetas = (): GridColumnMeta[] => [
    colMeta({
      id: 'product',
      label: __('Product'),
      description: __('Product on this PO line'),
      dataType: 'text',
      copyable: true,
      defaultWidth: 300,
    }),
    colMeta({
      id: 'sku',
      label: __('SKU'),
      description: __(
        'Our Stock Keeping Unit for this product, with its GTIN beneath where the two differ',
      ),
      dataType: 'text',
      copyable: true,
      defaultWidth: 130,
    }),
    colMeta({
      id: 'ordered',
      label: __('Ordered'),
      description: __('Quantity ordered on this line — what “.” fills into Qty billed'),
      dataType: 'number',
      copyable: true,
      defaultWidth: 90,
    }),
    colMeta({
      id: 'billed_so_far',
      label: __('Billed so far'),
      description: __('Units already billed by earlier invoices on this line'),
      dataType: 'number',
      copyable: true,
      defaultWidth: 110,
    }),
    colMeta({
      id: 'qty',
      label: __('Qty billed'),
      description: __(
        'Units THIS invoice bills — a different figure from what was shipped, and allowed to differ from it. Blank means this invoice does not bill the line.',
      ),
      dataType: 'number:receipt',
      kind: 'editable',
      editable: true,
      copyable: true,
      pasteable: true,
      defaultWidth: 100,
    }),
    colMeta({
      id: 'unit_cost',
      label: __('Unit price'),
      description: __(
        'What the supplier charges per unit, before any discount. Left blank the line keeps the price it already stands at (shown faded). A new price becomes the rate future deliveries are valued at — it never rewrites what earlier receipts already cost.',
      ),
      dataType: 'decimal:money',
      kind: 'editable',
      editable: true,
      copyable: true,
      pasteable: true,
      defaultWidth: 120,
    }),
    colMeta({
      id: 'discount_pct',
      label: __('Disc. %'),
      description: __(
        'The supplier’s discount on this line, in percent, taken off the unit price. Left blank the line keeps the discount it was ordered at (shown faded); clear it to bill with none. Select the whole column to apply one discount — an early-payment discount, say — to every line.',
      ),
      dataType: 'decimal',
      kind: 'editable',
      editable: true,
      copyable: true,
      pasteable: true,
      defaultWidth: 90,
    }),
    colMeta({
      id: 'line_total',
      label: __('Line total'),
      description: __(
        'Quantity × unit price, less the discount. In faded italics where the invoice has not stated the quantity or the price yet — the ordered figure stands in.',
      ),
      dataType: 'decimal:money',
      copyable: true,
      aggregate: 'sum',
      // Wide enough for the label itself: "Total de la ligne" and its neighbours in other locales
      // are half again the English, and a clipped money header reads as a broken column.
      defaultWidth: 150,
    }),
  ];

  const getValue = (row: PoLine, columnId: string): unknown => {
    switch (columnId) {
      case 'product':
        return row.productLabel;
      case 'sku':
        return row.sku;
      case 'ordered':
        return row.qtyRequested;
      case 'billed_so_far':
        return row.qtyInvoiced;
      case 'qty':
        return qtyFor(row.id);
      case 'unit_cost':
        return typedRateFor(row.id) ?? atSupplierPrecision(standingRate(row), props.costDecimals);
      case 'discount_pct':
        return effectiveDiscount(row);
      case 'line_total':
        // What the footer sums, so it totals exactly the figures the column shows.
        return lineTotal(row);
      default:
        return undefined;
    }
  };

  // Both entry cells stage (yellow) until the invoice is saved — a price shows staged only once it
  // has actually been typed, so the inherited standing rate is not dressed up as an edit.
  const getStagedValue = (row: PoLine, columnId: string): StagedCell => {
    if ('qty' === columnId && null !== qtyFor(row.id)) {
      return { staged: true, value: qtyFor(row.id) };
    }
    if ('unit_cost' === columnId && null !== typedRateFor(row.id)) {
      return { staged: true, value: typedRateFor(row.id) };
    }
    if ('discount_pct' === columnId && undefined !== typedDiscountFor(row.id)) {
      return { staged: true, value: typedDiscountFor(row.id) };
    }

    return { staged: false, value: undefined };
  };

  const EDITABLE = new Set(['qty', 'unit_cost', 'discount_pct']);
  const canEdit = (_row: PoLine, meta: GridColumnMeta): boolean => EDITABLE.has(meta.id);
  const resolveClearedValue = (
    _row: PoLine,
    meta: GridColumnMeta,
  ): { ok: boolean; value: unknown } =>
    EDITABLE.has(meta.id) ? { ok: true, value: null } : { ok: false, value: null };

  // "." on Qty billed fills the ordered quantity — an invoice for the whole order is the ordinary
  // case, so it is the one keystroke worth having.
  const resolveEditorMeta = (meta: GridColumnMeta, row: PoLine): GridColumnMeta =>
    'qty' === meta.id
      ? { ...meta, editorConfig: { dotDefault: row.qtyRequested, ariaLabel: __('Qty billed') } }
      : meta;

  const onStageEdit = (row: PoLine, columnId: string, _original: unknown, next: unknown): void => {
    if ('qty' === columnId) {
      setQty((m) => ({
        ...m,
        [row.id]: null === next || undefined === next ? null : Number(next),
      }));
    } else if ('unit_cost' === columnId) {
      const v = null === next || undefined === next || '' === next ? null : String(next);
      setRate((m) => ({ ...m, [row.id]: v }));
    } else if ('discount_pct' === columnId) {
      // Cleared is a statement too — this invoice bills the line with no discount.
      const v = null === next || undefined === next || '' === next ? null : String(next);
      setDiscount((m) => ({ ...m, [row.id]: v }));
    }
  };
  const onClearCells = (cells: Array<{ row: PoLine; columnId: string }>): void => {
    for (const { row, columnId } of cells) onStageEdit(row, columnId, null, null);
  };

  const [sorting, setSorting] = createSignal<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = persistedSignal<VisibilityState>(
    'invflux:po-invoice:colvis',
    {},
  );
  const [columnOrder, setColumnOrder] = persistedSignal<ColumnOrderState>(
    // Versioned for the same reason as the draft grid's: a saved order would park a new middle
    // column at the far end.
    'invflux:po-invoice:colorder:v2',
    COLUMN_ORDER,
  );
  const [columnSizing, setColumnSizing] = persistedSignal<Record<string, number>>(
    'invflux:po-invoice:colsize',
    {},
  );
  const [expandedColumnSections, setExpandedColumnSections] = persistedSignal<string[]>(
    'invflux:po-invoice:colsections',
    ['invoice-capture'],
  );
  const [rowSelection, setRowSelection] = createSignal<RowSelectionState>({});
  const [cellSelection, setCellSelection] = createSignal<SelectionState>(EMPTY_SELECTION);

  const FIELD =
    'min-w-0 rounded border border-slate-300 bg-surface px-2 py-1 text-sm focus:border-primary focus:outline-none';

  return (
    <div>
      <div class="mb-3 rounded border border-slate-200 bg-slate-50 p-2.5">
        {/* The heading names the document rather than the category — the kind was chosen at the
            entry button, and nothing else in this bar would say which one. */}
        <h3 class="text-sm font-medium text-slate-600">{supplierDocHeading('invoice')}</h3>

        <div class="mt-2 flex flex-wrap items-end gap-x-3 gap-y-2">
          <label class="flex flex-col gap-1">
            <span class="text-xs text-slate-500">{__('Invoice number')}</span>
            <input
              type="text"
              value={reference()}
              onInput={(e) => setReference(e.currentTarget.value)}
              placeholder={__('As printed by the supplier')}
              class={`${FIELD} w-56`}
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-xs text-slate-500">{__('Invoice date')}</span>
            <input
              type="date"
              value={invoicedAt()}
              onInput={(e) => setInvoicedAt(e.currentTarget.value)}
              class={`${FIELD} w-40`}
            />
          </label>
          {/* An invoice raised in a currency other than the order's is a fact, not an error — so the
              order's currency is the default here and never the constraint. */}
          <label class="flex flex-col gap-1">
            <span class="text-xs text-slate-500">{__('Currency')}</span>
            <input
              type="text"
              maxLength={3}
              value={currency()}
              onInput={(e) => setCurrency(e.currentTarget.value.toUpperCase())}
              class={`${FIELD} w-20 uppercase`}
            />
          </label>
          {/* Kept verbatim rather than computed: what the supplier printed is the fact, and the two
              disagreeing is worth seeing rather than averaging away. */}
          <label class="flex flex-col gap-1">
            <span class="text-xs text-slate-500">{__('Invoice total')}</span>
            <input
              type="text"
              inputmode="decimal"
              value={statedTotal()}
              onInput={(e) => setStatedTotal(e.currentTarget.value)}
              placeholder={__('Optional')}
              class={`${FIELD} w-32 text-right`}
            />
          </label>
          <label class="flex min-w-40 flex-1 flex-col gap-1">
            <span class="text-xs text-slate-500">{__('Note (optional)')}</span>
            <input
              type="text"
              value={note()}
              onInput={(e) => setNote(e.currentTarget.value)}
              class={`${FIELD} w-full`}
            />
          </label>
          {/* Right-aligned and allowed to wrap under the fields when the row runs out of room. */}
          <div class="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setImporting(true)}>
              {__('Import / paste')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => props.onDone()}>
              {__('Cancel')}
            </Button>
            <Button size="sm" disabled={!canSave() || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? __('Saving…') : __('Record invoice')}
            </Button>
          </div>
        </div>

        <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span class="text-slate-500">
            {sprintf(
              /* translators: 1: number of lines, 2: total of those lines. */
              _n('%1$d line, %2$s', '%1$d lines, %2$s', billedLines().length),
              billedLines().length,
              `${money(computedTotal())} ${currency()}`,
            )}
          </span>
          <Show when={statedDiffers()}>
            <span class="text-amber-600">
              {__(
                'The supplier’s total differs from the lines — recorded as stated, so the difference stays visible.',
              )}
            </span>
          </Show>
          <Show when={unpricedLines().length > 0}>
            <span class="text-red-600">
              {sprintf(
                _n(
                  '%d billed line has no price — enter one, or clear the quantity.',
                  '%d billed lines have no price — enter one, or clear the quantity.',
                  unpricedLines().length,
                ),
                unpricedLines().length,
              )}
            </span>
          </Show>
          <Show when={'' === reference().trim()}>
            <span class="text-slate-500">
              {__(
                'The supplier’s invoice number is required — it is how this document is found again.',
              )}
            </span>
          </Show>
        </div>
      </div>

      <Show when={importing()}>
        <ImportWizard
          title={__('Import invoice lines')}
          fields={importFields}
          onResolve={resolveImport}
          onCommit={commitImport}
          onParseFile={(file) => parseImportFile(ctx, file)}
          learnedAliases={aliasesQuery.data}
          onLearnAlias={learnAlias}
          onClose={() => setImporting(false)}
          importColumnTitle={__('Recorded on this invoice')}
          valueColumnHint={__('Map the billed quantity and the price charged.')}
        />
      </Show>

      <div class="flex max-h-[70vh] flex-col pt-2">
        <DataGrid<PoLine>
          rows={() => props.lines}
          getRowId={(l) => String(l.id)}
          columnMetas={columnMetas}
          groupLabels={() => ({ 'invoice-capture': __('Invoice Columns') })}
          getValue={getValue}
          bespokeColumns={bespokeColumns}
          canEdit={canEdit}
          getStagedValue={getStagedValue}
          resolveClearedValue={resolveClearedValue}
          resolveEditorMeta={resolveEditorMeta}
          settingsKey="po-invoice-capture"
          onStageEdit={onStageEdit}
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
              {__('No lines on this purchase order.')}
            </div>
          }
        />
      </div>
    </div>
  );
}

/** Product label (the codes have their own column). */
function ProductCell(props: { line: PoLine }): JSX.Element {
  return (
    <div class="font-medium" classList={{ 'text-text-muted italic': !props.line.exists }}>
      {props.line.productLabel}
    </div>
  );
}

/**
 * A line's total as a figure, and a dash only where there is no price anywhere to figure it on. A
 * total the invoice has not fully stated — the ordered quantity or price standing in for one — is
 * shown inherited.
 */
function LineTotalCell(props: {
  total: () => string | null;
  inherited: () => boolean;
  format: (v: string | null) => string;
}): JSX.Element {
  return (
    <span class="block text-right tabular-nums" classList={{ inherited: props.inherited() }}>
      {null === props.total() ? '—' : props.format(props.total())}
    </span>
  );
}

/**
 * Unit-price cell: the typed price, or the rate the line already stands at shown faded. A billed
 * line with no price anywhere reads as a gap rather than a dash, because the difference decides
 * whether the line can be recorded at all.
 */
function RateCell(props: {
  typed: string | null;
  standing: string | null;
  billed: boolean;
  format: (v: string | null) => string;
}): JSX.Element {
  return (
    <Show
      when={null !== props.typed}
      fallback={
        <Show
          when={null !== props.standing}
          fallback={
            <span
              class="block text-right tabular-nums"
              classList={{ 'text-red-600': props.billed, 'text-slate-300': !props.billed }}
              title={__('No price on the order to fall back on — enter what the supplier charged')}
            >
              {props.billed ? __('price?') : '—'}
            </span>
          }
        >
          <span
            class="inherited block text-right tabular-nums"
            title={__('Unchanged — the price this line already stands at')}
          >
            {props.format(props.standing)}
          </span>
        </Show>
      }
    >
      <span class="block text-right tabular-nums">{props.format(props.typed)}</span>
    </Show>
  );
}

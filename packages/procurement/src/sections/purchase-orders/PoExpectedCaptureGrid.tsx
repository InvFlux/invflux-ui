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
import { createSignal, type JSX, Show } from 'solid-js';
import { useProcurement } from '../../context';
import { persistedSignal } from '../../grid/persistedSignal';
import { registerReceiptEditor } from '../../grid/receiptEditor';
import { createApi } from '../../lib/api';
import { supplierDocHeading, type SupplierDocKind } from './supplierDocKinds';
import { SkuCell } from './SkuCell';
import type { PoLine } from './types';

// The numeric editor (blank-start, `.`-fill, clamp) shared with the receive grid.
registerReceiptEditor();

const COLUMN_ORDER = ['product', 'sku', 'ordered', 'expected'];

/** The two documents that speak to the expected quantity; an invoice speaks to a different axis. */
type DocType = Extract<SupplierDocKind, 'oa' | 'asn'>;

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
    group: 'document-capture',
    priority: 0,
    visibleByDefault: true,
    defaultWidth: 110,
    editorConfig: {},
    ...over,
  };
}

/**
 * The supplier-document capture edit-mode: enter the **expected** (supplier-confirmed) quantities off an
 * OA/ASN onto the PO lines, on the shared DataGrid (consistent with draft + GR entry). Only `expected`
 * is editable; `.` fills the ordered qty ("confirmed as ordered"). Saving writes the edited lines via the
 * `/expected` endpoint and records a lightweight document-provenance event — Essentials captures the document's
 * *content*; storing the document itself is a Pro subsystem.
 */
export function PoExpectedCaptureGrid(props: {
  poId: number;
  lines: PoLine[];
  /** Which of the two this is — chosen at the entry button, and what the bar's heading says. */
  docKind: DocType;
  onDone: () => void;
}): JSX.Element {
  const ctx = useProcurement();
  const api = createApi(ctx);
  const queryClient = useQueryClient();

  const [reference, setReference] = createSignal('');
  // Per-line edited expected value (undefined = untouched, null = cleared to "unknown", number = set).
  const [edits, setEdits] = createSignal<Record<number, number | null>>({});
  const editFor = (id: number): number | null | undefined => edits()[id];
  const setEdit = (id: number, v: number | null): void => {
    setEdits((prev) => ({ ...prev, [id]: v }));
  };
  const expectedFor = (line: PoLine): number | null => {
    const e = editFor(line.id);
    return undefined === e ? line.qtyExpected : e;
  };
  const editedLines = (): Array<{ poLineId: number; qtyExpected: number | null }> =>
    Object.entries(edits()).map(([id, v]) => ({ poLineId: Number(id), qtyExpected: v }));
  const hasEdits = (): boolean => Object.keys(edits()).length > 0;

  // ── Bulk import off the supplier document (shared ImportWizard) ───────────────────────────────────
  // Lines are fixed on a sent PO, so this matches pasted/imported rows to existing lines by SKU / GTIN
  // and stages the Expected quantity into the same edits map manual entry uses — the operator then Saves,
  // which records the OA/ASN provenance. Identifiers are match-only (no capture in this flow).
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
    // Built-in aliases from the shared concept dictionary for identifiers. The Expected column adds its
    // own set: "Confirmed"/"Confirmé" → Expected isn't a synonym but the *same quantity named from the
    // other side of the deal* — confirmed by the seller, expected-to-receive by the buyer — which no
    // character-distance fuzz could ever bridge; only an explicit alias can (plus the generic qty terms).
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
      key: 'qty_expected',
      label: __('Expected'),
      // Own concept — learning "Confirmed" here must never leak onto a draft's ordered-qty column.
      // Deliberately NO generic qty aliases: a specific "Confirmed qty" must win over a bare "Qty" (which
      // is usually the ordered reference here, not the supplier's confirmation). The length-aware match
      // score keeps a lone "Qty" below threshold against these specific aliases.
      aliasKey: 'expected',
      aliases: [
        'confirmed',
        'confirmed qty',
        'confirmed quantity',
        'confirmé',
        'confirmée',
        'quantité confirmée',
        'qté confirmée',
        'prévu',
        'quantité prévue',
        'expected qty',
        'expected quantity',
        'oa qty',
        'asn qty',
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

  const resolveImport = async (rows: MappedRow[], keyField: string): Promise<ResolvedRow[]> => {
    const idx = lineIndex(keyField);
    return rows.map((r): ResolvedRow => {
      const k = (r[keyField] ?? '').trim();
      const line = idx.get(k.toLowerCase());
      if (!line)
        return { key: k, label: k, status: 'unmatched', note: __('No matching line on this PO') };
      // Per-cell intent: empty → leave untouched; '-' → clear to unknown; value → set.
      const cell = 'qty_expected' in r ? (r.qty_expected ?? '').trim() : '';
      const qtyExpected =
        '' === cell ? (line.qtyExpected ?? null) : '-' === cell ? null : Number(cell) || 0;
      return {
        key: k,
        label: line.productLabel || k,
        status: 'matched',
        data: { poLineId: line.id, qtyExpected },
        // Current expected drives the diff; null reads as empty so a first capture shows as an addition.
        existing: { qty_expected: null === line.qtyExpected ? '' : String(line.qtyExpected) },
      };
    });
  };

  /** Stage the matched Expected values into the edits map (yellow), then close — the operator Saves. */
  const commitImport = (matched: ResolvedRow[]): void => {
    let staged = 0;
    for (const m of matched) {
      const d = m.data as { poLineId: number; qtyExpected: number | null } | undefined;
      if (!d) continue;
      setEdit(d.poLineId, d.qtyExpected);
      staged++;
    }
    setImporting(false);
    if (staged > 0) {
      toast.success(
        sprintf(
          _n(
            '%d expected quantity staged — review and Save.',
            '%d expected quantities staged — review and Save.',
            staged,
          ),
          staged,
        ),
      );
    }
  };

  const save = createMutation(() => ({
    mutationFn: () =>
      api.put<{ declined?: number[] }>(`/procurement/purchase-orders/${props.poId}/expected`, {
        lines: editedLines(),
        documentType: props.docKind,
        reference: reference().trim() || null,
      }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: ['procurement', 'purchase-orders', String(props.poId)],
      });
      void queryClient.invalidateQueries({ queryKey: ['procurement', 'purchase-orders'] }); // list rollup + activity
      // A line whose expected quantity is held by a stronger source is left alone by design — but
      // silently would be the wrong kind of quiet, since the operator watched their figure go in.
      const declined = data?.declined ?? [];
      if (declined.length > 0) {
        toast.info(
          sprintf(
            _n(
              'Recorded. %d line kept the figure it already had, set from a later document.',
              'Recorded. %d lines kept the figures they already had, set from a later document.',
              declined.length,
            ),
            declined.length,
          ),
        );
      } else {
        toast.success(__('Supplier document recorded.'));
      }
      props.onDone();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : __('Could not record the document.')),
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
      'expected',
      ch.display({
        id: 'expected',
        header: () => __('Expected'),
        cell: (info) => (
          <ExpectedCell
            value={expectedFor(info.row.original)}
            ordered={info.row.original.qtyRequested}
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
      description: __(
        'Quantity ordered — what Expected inherits (faded) when unset. “.” fills it into Expected.',
      ),
      dataType: 'number',
      copyable: true,
      defaultWidth: 90,
    }),
    colMeta({
      id: 'expected',
      label: __('Expected'),
      description: __(
        'The supplier-confirmed quantity from the OA/ASN. “.” fills the ordered qty; blank clears it.',
      ),
      dataType: 'number:receipt',
      kind: 'editable',
      editable: true,
      copyable: true,
      pasteable: true,
      defaultWidth: 120,
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
      case 'expected':
        return expectedFor(row);
      default:
        return undefined;
    }
  };

  // An edited Expected cell shows staged (yellow) until saved.
  const getStagedValue = (row: PoLine, columnId: string): StagedCell =>
    'expected' === columnId && undefined !== editFor(row.id)
      ? { staged: true, value: editFor(row.id) }
      : { staged: false, value: undefined };

  const canEdit = (_row: PoLine, meta: GridColumnMeta): boolean => 'expected' === meta.id;
  const resolveClearedValue = (
    _row: PoLine,
    meta: GridColumnMeta,
  ): { ok: boolean; value: unknown } =>
    'expected' === meta.id ? { ok: true, value: null } : { ok: false, value: null };
  // `.` on Expected fills the ordered qty (confirm as ordered).
  const resolveEditorMeta = (meta: GridColumnMeta, row: PoLine): GridColumnMeta =>
    'expected' === meta.id
      ? { ...meta, editorConfig: { dotDefault: row.qtyRequested, ariaLabel: __('Expected') } }
      : meta;

  const onStageEdit = (row: PoLine, columnId: string, _original: unknown, next: unknown): void => {
    if ('expected' !== columnId) return;
    setEdit(row.id, null === next || undefined === next ? null : Number(next));
  };
  const onClearCells = (cells: Array<{ row: PoLine; columnId: string }>): void => {
    for (const { row, columnId } of cells) {
      if ('expected' === columnId) setEdit(row.id, null);
    }
  };

  // Required DataGrid state (per-operator layout persistence).
  const [sorting, setSorting] = createSignal<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = persistedSignal<VisibilityState>(
    'invflux:po-expected:colvis',
    {},
  );
  const [columnOrder, setColumnOrder] = persistedSignal<ColumnOrderState>(
    'invflux:po-expected:colorder',
    COLUMN_ORDER,
  );
  const [columnSizing, setColumnSizing] = persistedSignal<Record<string, number>>(
    'invflux:po-expected:colsize',
    {},
  );
  const [expandedColumnSections, setExpandedColumnSections] = persistedSignal<string[]>(
    'invflux:po-expected:colsections',
    ['document-capture'],
  );
  const [rowSelection, setRowSelection] = createSignal<RowSelectionState>({});
  const [cellSelection, setCellSelection] = createSignal<SelectionState>(EMPTY_SELECTION);

  return (
    <div>
      {/* The heading names the document, not the category: the kind was chosen back at the entry
          button, and an acknowledgement and a shipping notice write the same field through this same
          grid — so a bar saying only "supplier document" would let the wrong provenance be recorded
          with nothing on screen to notice. */}
      <div class="mb-3 rounded border border-slate-200 bg-slate-50 p-2.5">
        <h3 class="text-sm font-medium text-slate-600">{supplierDocHeading(props.docKind)}</h3>
        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <label class="flex min-w-60 flex-1 items-center gap-2 text-sm text-slate-600">
            {__('Reference')}
            <input
              type="text"
              value={reference()}
              onInput={(e) => setReference(e.currentTarget.value)}
              placeholder={__('Optional')}
              class="min-w-0 flex-1 rounded border border-slate-300 bg-surface px-2 py-1 text-sm focus:border-primary focus:outline-none"
            />
          </label>
          <div class="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setImporting(true)}>
              {__('Import / paste')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => props.onDone()}>
              {__('Cancel')}
            </Button>
            <Button
              size="sm"
              disabled={!hasEdits() || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? __('Saving…') : __('Save')}
            </Button>
          </div>
        </div>
      </div>
      <Show when={importing()}>
        <ImportWizard
          title={__('Import expected quantities')}
          fields={importFields}
          onResolve={resolveImport}
          onCommit={commitImport}
          onParseFile={(file) => parseImportFile(ctx, file)}
          learnedAliases={aliasesQuery.data}
          onLearnAlias={learnAlias}
          onClose={() => setImporting(false)}
          importColumnTitle={__('Recorded as the expected quantity')}
          valueColumnHint={__('Map the supplier-confirmed Expected quantity column.')}
        />
      </Show>
      <div class="flex max-h-[70vh] flex-col pt-2">
        <DataGrid<PoLine>
          rows={() => props.lines}
          getRowId={(l) => String(l.id)}
          columnMetas={columnMetas}
          getValue={getValue}
          bespokeColumns={bespokeColumns}
          canEdit={canEdit}
          getStagedValue={getStagedValue}
          resolveClearedValue={resolveClearedValue}
          resolveEditorMeta={resolveEditorMeta}
          settingsKey="po-expected-capture"
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

/** Expected view cell: the set value, or the inherited ordered qty faded when unset. */
function ExpectedCell(props: { value: number | null; ordered: number }): JSX.Element {
  return (
    <Show
      when={null !== props.value}
      fallback={
        <span
          class="inherited block text-right tabular-nums"
          title={__('Not yet confirmed — inherits the ordered quantity')}
        >
          {props.ordered}
        </span>
      }
    >
      <span class="block text-right tabular-nums">{props.value}</span>
    </Show>
  );
}

import { __ } from '@invflux/i18n';
import {
  DataGrid,
  EMPTY_SELECTION,
  SegmentedControl,
  selectCell,
  type EditMove,
  type GridColumnMeta,
  type SelectionState,
  type StagedCell,
} from '@invflux/ui';
import { type ColumnDef, createColumnHelper } from '@tanstack/solid-table';
import type { ColumnOrderState, RowSelectionState, SortingState, VisibilityState } from '@tanstack/solid-table';
import { type Accessor, createMemo, createSignal, type JSX, Show } from 'solid-js';
import { useProcurement } from '../../context';
import { fuzzyMatches } from '../../grid/fuzzyMatch';
import { persistedSignal } from '../../grid/persistedSignal';
import { QuickFilter, isTypingInField } from '../../grid/QuickFilter';
import { firstEditableColumnId } from '../../grid/editableColumn';
import { registerReceiptEditor } from '../../grid/receiptEditor';
import { baselineQty, type VarianceLens } from '../../lib/variance';
import type { PoLine } from './types';

// The receipt numeric editor (blank-start, `.`-fill, clamp) — registered once before any render.
registerReceiptEditor();

const COLUMN_ORDER = ['image', 'product', 'sku', 'supplier_sku', 'ordered', 'expected', 'received_so_far', 'received', 'damaged', 'good', 'variance'];

/** GR-variance baseline the operator measures against — their choice persists (receiver → expected,
 *  purchasing → ordered). When `expected` is absent the "expected" view falls back to ordered. Shared
 *  with the PO-detail read badge via the core-mirroring {@link VarianceLens}. */
type VarianceBaseline = VarianceLens;

/**
 * Fold any canonical columns missing from a persisted order (e.g. `expected` / `variance`, added after an
 * operator saved their layout) into it at their canonical position — inserted right after their nearest
 * preceding canonical neighbour, so they land where intended rather than appended. Idempotent once every
 * canonical column is present, so a saved order that already has them is returned unchanged.
 */
function reconcileColumnOrder(saved: string[], canonical: string[]): string[] {
  const result = [...saved];
  canonical.forEach((col, i) => {
    if (result.includes(col)) return;
    let insertAt = result.length;
    for (let j = i - 1; j >= 0; j--) {
      const predIdx = result.indexOf(canonical[j]);
      if (predIdx >= 0) {
        insertAt = predIdx + 1;
        break;
      }
    }
    result.splice(insertAt, 0, col);
  });
  return result;
}

/** GridColumnMeta with the reception-friendly defaults filled in; `over` carries the per-column bits. */
function colMeta(over: Partial<GridColumnMeta> & { id: string; label: string; dataType: string }): GridColumnMeta {
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
    // One group for all 8 columns — grouping/folding adds little at this count, so it reads as a single
    // titled, open-by-default section ("Goods Receipt Columns") rather than a bare "Other".
    group: 'goods-receipt',
    priority: 0,
    visibleByDefault: true,
    defaultWidth: 110,
    editorConfig: {},
    ...over,
  };
}

interface PoReceiveGridProps {
  /** The PO id — for persisting expected-qty edits (PUT …/{poId}/expected). */
  poId: number;
  lines: PoLine[];
  /** Staged session counts, keyed by PO-line id (null = not counted yet). */
  received: Accessor<Record<number, number | null>>;
  damaged: Accessor<Record<number, number | null>>;
  setRecv: (id: number, v: number | null) => void;
  setDmg: (id: number, v: number | null) => void;
}

/**
 * The goods-reception line grid on the extracted DataGrid. The receiving session IS the dirty model:
 * every counted Received/Damaged cell shows staged (yellow background) until the parent commits the
 * session ("Confirm receipt"). Received/Damaged edit through the `number:receipt` editor; per-row
 * dotDefault (open qty / received) and max (received) are injected via resolveEditorMeta. Product
 * codes, ordered qty and derived Good are read-only.
 */
export function PoReceiveGrid(props: PoReceiveGridProps): JSX.Element {
  const recvFor = (id: number): number | null => props.received()[id] ?? null;
  const dmgFor = (id: number): number | null => props.damaged()[id] ?? null;
  // Good units in THIS delivery (session): received − damaged. Null when this session's cell is uncounted.
  const sessionGoodFor = (id: number): number | null => {
    const r = recvFor(id);
    return null === r ? null : Math.max(0, r - (dmgFor(id) ?? 0));
  };
  // The Good column is cumulative — prior committed good (received-so-far) + this session's good — so a
  // line that already received stock keeps showing its good total (and hence a variance) even before this
  // session's cell is touched. Blank only when there is nothing at all: no earlier receipt AND uncounted here.
  const goodFor = (row: PoLine): number | null => {
    const s = sessionGoodFor(row.id);
    if (null === s && !row.qtyReceived) return null;
    return row.qtyReceived + (s ?? 0);
  };

  const ctx = useProcurement();
  const isPro = ctx.hasPro; // barcode (GTIN) matching is Pro; name / SKU / supplier-SKU are Essentials

  // ── Expected qty (read-only) ───────────────────────────────────────────────────────────────────
  // The supplier-confirmed baseline — a per-line order property set pre-arrival (ASN / invoice / a
  // separate entry workflow, not at GR). When unset it INHERITS the ordered qty (rendered faded); the
  // variance measures against it. Read straight off the line; there's no editing state here.

  // ── GR variance ────────────────────────────────────────────────────────────────────────────────
  const [baseline, setBaseline] = persistedSignal<VarianceBaseline>('invflux:po-receive:variance-baseline', 'ordered');
  // Cumulative good (prior committed receipts + this session) minus the chosen baseline. Null until the
  // line is counted. In "expected" mode a missing expected falls back to ordered (flagged by the cell).
  const baseFor = (row: PoLine): number => baselineQty(row, baseline());
  const usesFallback = (row: PoLine): boolean => 'expected' === baseline() && null === row.expectedQty;
  const varianceFor = (row: PoLine): number | null => {
    const g = goodFor(row); // cumulative good (received-so-far + this session)
    return null === g ? null : g - baseFor(row);
  };

  // Quick-filter: fuzzy-match the rows on the identifier fields; non-matching lines hide immediately.
  const [filterText, setFilterText] = createSignal('');
  const matchFields = (l: PoLine): Array<string | null> =>
    isPro ? [l.productLabel, l.sku, l.supplierSku, l.gtin] : [l.productLabel, l.sku, l.supplierSku];
  const visibleLines = createMemo<PoLine[]>(() =>
    '' === filterText().trim() ? props.lines : props.lines.filter((l) => fuzzyMatches(filterText(), matchFields(l))),
  );

  const columnMetas = createMemo<GridColumnMeta[]>(() => [
    colMeta({ id: 'image', label: __('Image'), description: __('Product thumbnail'), dataType: 'text', defaultWidth: 56 }),
    colMeta({ id: 'product', label: __('Product'), description: __('Product name (and GTIN) — match the physical goods against it'), dataType: 'text', copyable: true, defaultWidth: 280 }),
    colMeta({ id: 'sku', label: __('SKU'), description: __('Our Stock Keeping Unit for this product'), dataType: 'text', copyable: true, defaultWidth: 120 }),
    colMeta({ id: 'supplier_sku', label: __('Supplier SKU'), description: __('The supplier’s own code for this product (matches their packing slip)'), dataType: 'text', copyable: true, defaultWidth: 130 }),
    colMeta({ id: 'ordered', label: __('Ordered'), description: __('Quantity ordered on this PO line — the variance baseline (and what Expected inherits when unset). The “.” key still fills the outstanding remainder into Received.'), dataType: 'number', copyable: true, defaultWidth: 90 }),
    // Read-only: the supplier-confirmed baseline, set pre-arrival by a separate ASN/invoice workflow.
    // Inherits the ordered qty (shown faded) when unset.
    colMeta({ id: 'expected', label: __('Expected'), description: __('What the supplier confirmed they’d ship (ASN / invoice) — the variance baseline. Inherits the ordered qty (faded) when not set.'), dataType: 'number', copyable: true, defaultWidth: 100 }),
    colMeta({ id: 'received_so_far', label: __('Received so far'), description: __('Good units already committed from earlier deliveries on this PO — any damaged units received earlier show in red parentheses (read-only)'), dataType: 'number', copyable: true, defaultWidth: 120 }),
    colMeta({ id: 'received', label: __('Received'), description: __('Units arriving in THIS delivery (including any damaged). “.” fills the outstanding qty; a negative value corrects a prior over-count.'), dataType: 'number:receipt', kind: 'editable', editable: true, copyable: true, pasteable: true, defaultWidth: 110 }),
    colMeta({ id: 'damaged', label: __('Damaged'), description: __('Of the received units, how many are damaged / unfit — they don’t move into saleable stock'), dataType: 'number:receipt', kind: 'editable', editable: true, copyable: true, pasteable: true, defaultWidth: 110 }),
    colMeta({ id: 'good', label: __('Good'), description: __('Total saleable units so far = received so far + received − damaged'), dataType: 'number', copyable: true, defaultWidth: 90 }),
    colMeta({ id: 'variance', label: __('Variance'), description: __('Good received-so-far minus the chosen baseline (ordered or expected) — short shown red, over amber'), dataType: 'text', copyable: true, defaultWidth: 120 }),
  ]);

  const ch = createColumnHelper<PoLine>();
  const bespokeColumns = new Map<string, ColumnDef<PoLine, unknown>>([
    [
      'image',
      ch.display({
        id: 'image',
        header: () => __('Image'),
        cell: (info) => (
          <Show when={info.row.original.imageUrl} fallback={<div class="h-9 w-9 rounded bg-slate-100" />}>
            {(u) => <img src={u()} alt="" class="h-9 w-9 rounded object-cover" />}
          </Show>
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
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
        cell: (info) => <CodeCell value={info.row.original.sku} />,
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'supplier_sku',
      ch.display({
        id: 'supplier_sku',
        header: () => __('Supplier SKU'),
        cell: (info) => <CodeCell value={info.row.original.supplierSku} />,
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'ordered',
      ch.display({
        id: 'ordered',
        header: () => __('Ordered'),
        cell: (info) => <span class="tabular-nums">{info.row.original.requestedQty}</span>,
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'expected',
      ch.display({
        id: 'expected',
        header: () => __('Expected'),
        cell: (info) => <ExpectedCell expected={info.row.original.expectedQty} ordered={info.row.original.requestedQty} />,
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'received_so_far',
      ch.display({
        id: 'received_so_far',
        header: () => __('Received so far'),
        cell: (info) => <ReceivedSoFarCell good={info.row.original.qtyReceived} damaged={info.row.original.damagedSoFar} />,
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'received',
      ch.display({
        id: 'received',
        header: () => __('Received'),
        cell: (info) => <NumCell value={recvFor(info.row.original.id)} />,
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'damaged',
      ch.display({
        id: 'damaged',
        header: () => __('Damaged'),
        cell: (info) => <NumCell value={dmgFor(info.row.original.id)} />,
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'good',
      ch.display({
        id: 'good',
        header: () => __('Good'),
        cell: (info) => <NumCell value={goodFor(info.row.original)} strong />,
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'variance',
      ch.display({
        id: 'variance',
        header: () => __('Variance'),
        cell: (info) => (
          <VarianceCell
            delta={() => varianceFor(info.row.original)}
            base={() => baseFor(info.row.original)}
            fallback={() => usesFallback(info.row.original)}
          />
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
  ]);

  // ── Required DataGrid state ───────────────────────────────────────────────────────────────────
  const [sorting, setSorting] = createSignal<SortingState>([]);
  // Column layout (visibility / order / sizing) persists per operator; default = all columns shown.
  // Identifier columns can be hidden via the column picker (Ctrl+M); they stay filter match-keys either way.
  const [columnVisibility, setColumnVisibility] = persistedSignal<VisibilityState>('invflux:po-receive:colvis', {});
  const [columnOrder, setColumnOrder] = persistedSignal<ColumnOrderState>('invflux:po-receive:colorder', COLUMN_ORDER);
  // Migrate a pre-existing saved order so newly-added columns (expected / variance) appear at their
  // canonical spot rather than appended. Done synchronously at setup → no flash of the old order.
  {
    const reconciled = reconcileColumnOrder(columnOrder(), COLUMN_ORDER);
    if (reconciled.length !== columnOrder().length) setColumnOrder(reconciled);
  }
  const [columnSizing, setColumnSizing] = persistedSignal<Record<string, number>>('invflux:po-receive:colsize', {});
  // The single column group starts expanded (folding one section of 8 is pointless); the choice persists.
  const [expandedColumnSections, setExpandedColumnSections] = persistedSignal<string[]>('invflux:po-receive:colsections', ['goods-receipt']);
  const [rowSelection, setRowSelection] = createSignal<RowSelectionState>({});
  const [cellSelection, setCellSelection] = createSignal<SelectionState>(EMPTY_SELECTION);

  const getValue = (row: PoLine, columnId: string): unknown => {
    switch (columnId) {
      case 'image':
        return row.imageUrl;
      case 'product':
        return row.productLabel;
      case 'sku':
        return row.sku;
      case 'supplier_sku':
        return row.supplierSku;
      case 'ordered':
        return row.requestedQty;
      case 'expected':
        return row.expectedQty ?? row.requestedQty; // effective baseline (inherits ordered)
      case 'received_so_far':
        return row.qtyReceived;
      case 'received':
        return recvFor(row.id);
      case 'damaged':
        return dmgFor(row.id);
      case 'good':
        return goodFor(row);
      case 'variance':
        return varianceFor(row);
      default:
        return undefined;
    }
  };

  // A counted Received/Damaged cell is "staged" (yellow) until the session is committed.
  const getStagedValue = (row: PoLine, columnId: string): StagedCell => {
    if ('received' === columnId && null !== recvFor(row.id)) {
      return { staged: true, value: recvFor(row.id) };
    }
    if ('damaged' === columnId && null !== dmgFor(row.id)) {
      return { staged: true, value: dmgFor(row.id) };
    }
    return { staged: false, value: undefined };
  };

  const canEdit = (_row: PoLine, meta: GridColumnMeta): boolean => 'received' === meta.id || 'damaged' === meta.id;

  // Received/Damaged clear to blank (Del / Backspace → uncounted again); nothing else is clearable.
  const resolveClearedValue = (_row: PoLine, meta: GridColumnMeta): { ok: boolean; value: unknown } =>
    'received' === meta.id || 'damaged' === meta.id ? { ok: true, value: null } : { ok: false, value: null };

  // Inject per-row editor config the row-blind editor can't compute: `.` fills the open qty (Received)
  // or the current received (Damaged); Damaged is capped at THIS session's received count (receipt-scoped
  // — a delivery can only damage what it delivered; post-receipt damage is a separate correction flow).
  // A BLANK received means nothing arrived this session, so damaged is capped at 0 (not left uncapped) —
  // otherwise damaged could exceed what was received.
  const resolveEditorMeta = (meta: GridColumnMeta, row: PoLine): GridColumnMeta => {
    if ('received' === meta.id) {
      return { ...meta, editorConfig: { dotDefault: row.qtyOpen, ariaLabel: __('Received') } };
    }
    if ('damaged' === meta.id) {
      const recv = recvFor(row.id) ?? 0;
      return { ...meta, editorConfig: { dotDefault: recv, max: recv, ariaLabel: __('Damaged') } };
    }
    return meta;
  };

  const onStageEdit = (row: PoLine, columnId: string, _original: unknown, next: unknown): void => {
    const v = null === next || undefined === next ? null : Number(next);
    if ('received' === columnId) {
      // A typed 0 STAGES (yellow) — for the GR worker it's a progress signal ("checked, none here"),
      // distinct from an unreviewed blank. System-side a staged 0 records no receipt line, same as blank;
      // the difference is purely the worker's review-progress marker.
      props.setRecv(row.id, v);
    } else if ('damaged' === columnId) {
      props.setDmg(row.id, v);
    }
  };

  const clearCell = (row: PoLine, columnId: string): void => {
    if ('received' === columnId) {
      props.setRecv(row.id, null);
    } else if ('damaged' === columnId) {
      props.setDmg(row.id, null);
    }
  };
  const onClearCells = (cells: Array<{ row: PoLine; columnId: string }>): void => {
    for (const { row, columnId } of cells) clearCell(row, columnId);
  };

  // The grid's imperative handle (structural type — avoids importing DataGridApi / touching the shared
  // barrel). Captured once via apiRef. focusFilter is set by the QuickFilter ref.
  let gridApi:
    | {
        enterEdit: (seed?: string) => void;
        getSelectedCells: () => Array<{ row: PoLine; columnId: string }>;
        getSelectableColumnIds: () => string[];
        focusGrid: () => void;
        focusCellById: (rowId: string, columnId: string, editMode?: boolean) => void;
        openColumnManager: () => void;
        openGridSettings: () => void;
      }
    | undefined;
  let focusFilter: (() => void) | undefined;

  // Reception's key quirks, injected so the shared grid stays domain-agnostic. Tried when the grid is
  // focused and not editing:
  //  - Escape → back to the quick-filter (the §4.0 focus loop);
  //  - numpad "." (Num Lock ON: key=".", code="NumpadDecimal") → enter edit seeded with "." = the
  //    fill-open-qty gesture (main "." already enters edit via the grid's printable-char branch);
  //  - Backspace → clear the selected Received/Damaged cells. Reception has no revert/clear split (the
  //    session IS the working state), so Backspace and Delete both mean "back to uncounted".
  const inGridKeyHandlers = [
    (e: KeyboardEvent): boolean => {
      if ('Escape' === e.key) {
        e.preventDefault();
        focusFilter?.();
        return true;
      }
      if ('NumpadDecimal' === e.code && '.' === e.key) {
        e.preventDefault();
        gridApi?.enterEdit('.');
        return true;
      }
      if ('Backspace' === e.key) {
        e.preventDefault();
        for (const { row, columnId } of gridApi?.getSelectedCells() ?? []) clearCell(row, columnId);
        return true;
      }
      return false;
    },
  ];

  // Global keybindings (tried anywhere the grid is mounted, before the focus guard): "/" focuses the
  // filter (but types normally while already in a field); Ctrl/Cmd+M toggles the column picker.
  const globalKeyHandlers = [
    (e: KeyboardEvent): boolean => {
      if ('/' === e.key && !e.shiftKey && !isTypingInField()) {
        e.preventDefault();
        focusFilter?.();
        return true;
      }
      // Ctrl/Cmd+M (columns) and Ctrl/Cmd+, (grid display) are grid built-ins — no per-consumer wiring.
      return false;
    },
  ];

  // Enter from the filter with a single match jumps straight to that row's left-most editable cell
  // (Received here — ready to type a qty or "." to fill); otherwise (multi-match, or Esc) just drop
  // into cell-nav. The target column isn't hard-coded — it's the first editable one in display order.
  const onFilterLeave = (key: 'Enter' | 'Escape'): void => {
    if ('Enter' === key && 1 === visibleLines().length) {
      const row = visibleLines()[0];
      const colId = firstEditableColumnId(row, columnMetas(), canEdit, gridApi?.getSelectableColumnIds() ?? []);
      if (undefined !== colId) {
        gridApi?.focusCellById(String(row.id), colId);
        return;
      }
    }
    gridApi?.focusGrid();
  };

  // Scanner loop: committing the Received/Damaged qty with Enter (move
  // "down") while the filter has narrowed to a single row returns to the filter and resets it — ready
  // for the next scan/type, no wasted keystroke. Tab (→ next column) and multi-row filters keep the
  // grid's default move.
  const onCommitNavigate = (row: PoLine, columnId: string, move: EditMove): boolean => {
    if ('down' === move && ('received' === columnId || 'damaged' === columnId) && '' !== filterText().trim() && 1 === visibleLines().length) {
      setFilterText('');
      // Keep the just-edited line in apparent focus by ID — clearing the filter changed its row index,
      // so re-anchor the active cell to where that same line now sits (not whatever row took index 0).
      const newRow = visibleLines().findIndex((l) => l.id === row.id);
      const col = (gridApi?.getSelectableColumnIds() ?? []).indexOf(columnId);
      if (newRow >= 0 && col >= 0) setCellSelection(selectCell({ row: newRow, col }));
      focusFilter?.();
      return true;
    }
    return false;
  };

  return (
    <div>
      <div class="mb-2 flex items-center gap-3">
        <div class="min-w-0 flex-1">
          <QuickFilter
            value={filterText}
            onInput={setFilterText}
            onLeave={onFilterLeave}
            ref={(focus) => (focusFilter = focus)}
            placeholder={isPro ? __('Filter or scan — name / SKU / barcode…') : __('Filter — name or SKU…')}
          />
        </div>
        {/* GR-variance baseline toggle — the operator's choice persists (receiver vs expected, purchasing
            vs ordered). "Expected" falls back to ordered per-line when no expected is set (flagged in-cell). */}
        <div class="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
          <span>{__('Variance vs')}</span>
          <SegmentedControl
            ariaLabel={__('Variance baseline')}
            size="sm"
            options={[
              { value: 'ordered', label: __('Ordered') },
              { value: 'expected', label: __('Expected') },
            ]}
            value={baseline()}
            onChange={(v: 'ordered' | 'expected') => setBaseline(v)}
          />
        </div>
      </div>
      {/* Flex-column + viewport cap so the grid's internal scroll container (flex-1 min-h-0) gets a
          bounded height and scrolls; pt-6 leaves room for the gear (-top-2), and no overflow-hidden so
          the gear isn't clipped (the scroll container carries its own border). */}
      <div class="flex max-h-[70vh] flex-col pt-2">
        <DataGrid<PoLine>
          rows={visibleLines}
          getRowId={(l) => String(l.id)}
          columnMetas={columnMetas}
          // This grid builds its own column metas, so it names its own group (the shared DataGrid
          // carries no group vocabulary — labels always come from whoever declares the columns).
          groupLabels={() => ({ 'goods-receipt': __('Goods Receipt Columns') })}
          getValue={getValue}
          bespokeColumns={bespokeColumns}
          canEdit={canEdit}
          getStagedValue={getStagedValue}
          resolveClearedValue={resolveClearedValue}
          resolveEditorMeta={resolveEditorMeta}
          apiRef={(api) => (gridApi = api)}
          settingsKey="po-receive"
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
          fallback={<div class="px-3 py-6 text-sm text-slate-500">{__('No lines on this receipt.')}</div>}
        />
      </div>
    </div>
  );
}

/** Product label + the codes a receiver matches physical goods against (our SKU + supplier SKU + GTIN). */
function ProductCell(props: { line: PoLine }): JSX.Element {
  // No wrapper div — label + GTIN are direct cell children so the grid's no-wrap truncation reaches them.
  return (
    <>
      <div class="font-medium" classList={{ 'text-text-muted italic': !props.line.exists }}>
        {props.line.productLabel}
      </div>
      {/* SKU and supplier SKU now have their own columns; GTIN stays here as a sub-line (longest code). */}
      <Show when={props.line.gtin}>
        <div class="text-xs text-text-muted">
          <span class="text-slate-300">{__('GTIN')}:</span> {props.line.gtin}
        </div>
      </Show>
    </>
  );
}

/** Monospaced code view cell (SKU / supplier SKU); blank renders an em dash. */
function CodeCell(props: { value: string | null }): JSX.Element {
  return <span class="block font-mono text-slate-500">{props.value ?? '—'}</span>;
}

/** Right-aligned numeric view cell; blank renders an em dash. */
function NumCell(props: { value: number | null; strong?: boolean }): JSX.Element {
  return (
    <span class="block text-right tabular-nums" classList={{ 'font-medium': props.strong }}>
      {null === props.value ? '—' : props.value}
    </span>
  );
}

/**
 * Received-so-far cell: cumulative *good* committed from earlier deliveries, with any cumulative
 * damaged appended in red parentheses — "90 (5)" = 90 good + 5 damaged received earlier. Blank (em
 * dash) only when nothing at all has been received yet; a good count of 0 with damage still shows "0 (5)".
 */
function ReceivedSoFarCell(props: { good: number; damaged: number }): JSX.Element {
  return (
    <Show when={props.good > 0 || props.damaged > 0} fallback={<span class="block text-right text-slate-300">—</span>}>
      <span class="block text-right tabular-nums">
        {props.good}
        <Show when={props.damaged > 0}>
          <span class="text-red-600" title={__('Damaged units received on earlier deliveries')}>
            {' '}
            ({props.damaged})
          </span>
        </Show>
      </span>
    </Show>
  );
}

/** Expected qty (read-only): the set value in normal text, or the inherited ordered qty faded when unset. */
function ExpectedCell(props: { expected: number | null; ordered: number }): JSX.Element {
  return (
    <span class="block text-right tabular-nums" classList={{ 'text-text-muted italic': null === props.expected, 'text-slate-700': null !== props.expected }}>
      {props.expected ?? props.ordered}
    </span>
  );
}

/**
 * GR variance cell: signed `{abs} ({pct})` of good-so-far vs the chosen baseline — coloured short (red)
 * / over (amber) / on-target (neutral), blank until the line is counted. Guards the percentage against a
 * 0 baseline. A per-line fallback to ordered (when "vs expected" has no expected set) is flagged with a
 * subtle tag, so a `0` never misreads as "matched what they promised".
 */
function VarianceCell(props: { delta: () => number | null; base: () => number; fallback: () => boolean }): JSX.Element {
  const pct = (): number | null => {
    const d = props.delta();
    const b = props.base();
    return null === d || b <= 0 ? null : Math.round((d / b) * 100);
  };
  const sign = (): string => ((props.delta() ?? 0) > 0 ? '+' : '');
  return (
    <Show when={null !== props.delta()} fallback={<span class="block text-right text-slate-300">—</span>}>
      <span
        class="block text-right tabular-nums"
        classList={{
          'text-red-600': (props.delta() ?? 0) < 0,
          'text-amber-600': (props.delta() ?? 0) > 0,
          'text-slate-500': 0 === props.delta(),
        }}
      >
        {sign()}
        {props.delta()}
        <Show when={null !== pct()}>{` (${sign()}${pct()}%)`}</Show>
        <Show when={props.fallback()}>
          <span class="ml-1 text-2xs text-text-muted">{__('vs ordered')}</span>
        </Show>
      </span>
    </Show>
  );
}

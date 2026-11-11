import { __, _n, _x, sprintf } from '@invflux/i18n';
import {
  Button,
  Checkbox,
  ColumnsSettingsIcon,
  DataGrid,
  EMPTY_SELECTION,
  SegmentedControl,
  SettingsSection,
  selectCell,
  surfaceSettingsRegistry,
  ThumbnailZoom,
  toast,
  useSurface,
  type EditMove,
  type GridColumnMeta,
  type SelectionState,
  type StagedCell,
} from '@invflux/ui';
import {
  useScanLoop,
  useScanTarget,
  type Scan,
  type ScanAnswer,
  type ScanReply,
} from '@invflux/ui/scanBus';
import { type ColumnDef, createColumnHelper } from '@tanstack/solid-table';
import type { RowSelectionState, SortingState } from '@tanstack/solid-table';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { fuzzyMatches } from '../../grid/fuzzyMatch';
import { resolveCommitNav } from '../../gridCommitNav';
import {
  codeRefresher,
  resolveReceiveScan,
  scanNamesLine,
  type LineCodes,
} from '../../receiveScan';
import { activeReceiveCapture, isRefusal, type CodeHolderRef } from '../../receiveCapture';
import type {
  ProductCodeEntry,
  ProductCodesDetail,
  RemoveProductCodeRequest,
} from '@invflux/ui/productCodes';
import { persistedSignal } from '../../grid/persistedSignal';
import { PicturePopover } from '../../grid/PicturePopover';
import { QuickFilter, isTypingInField } from '../../grid/QuickFilter';
import { firstEditableColumnId } from '../../grid/editableColumn';
import { registerReceiptEditor } from '../../grid/receiptEditor';
import { baselineQty, orderedQty, type VarianceLens } from '../../lib/variance';
import type { PoLine } from './types';

// The receipt numeric editor (blank-start, `.`-fill, clamp) — registered once before any render.
registerReceiptEditor();

/** This grid's stable id, so a contributed commit-navigation rule can tell it from another grid's. */
const RECEIVE_GRID_ID = 'po.receive';

const COLUMN_ORDER = [
  'image',
  'product',
  'sku',
  'supplier_sku',
  'gtin',
  'ordered',
  'expected',
  'received_so_far',
  'received',
  'damaged',
  'good',
  'variance',
];

/** GR-variance baseline the operator measures against — their choice persists (receiver → expected,
 *  purchasing → ordered). When `expected` is absent the "expected" view falls back to ordered. Shared
 *  with the PO-detail read badge via the core-mirroring {@link VarianceLens}. */
type VarianceBaseline = VarianceLens;

/** GridColumnMeta with the reception-friendly defaults filled in; `over` carries the per-column bits. */
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
  /**
   * Where to show a product, by subject id, or undefined where this user cannot open it. A refused
   * capture links the product that already has the code. Omitted, the refusal names it in words only.
   */
  productLink?: (subjectId: number) => string | undefined;
  /**
   * The quick filter changed to a new, non-empty lookup — typed or scanned. Several workers may be
   * counting this delivery, so this is when the count is worth refreshing: the box the worker is about
   * to fill should show what a coworker already entered.
   */
  onLookup?: () => void;
  /** The active cell moved onto Received or Damaged of another line — worth a refresh while others count. */
  onLineFocus?: () => void;
  /** Add scanned units to a line, sent as an increment. Absent, a scan stages the figure plus one. */
  addRecv?: (id: number, units: number) => void;
  /**
   * The order's codes as the server holds them now, asked for when a scan names no line: the code may
   * have been added since this screen loaded. Absent, such a scan is resolved against the codes loaded.
   */
  lookupCodes?: () => Promise<readonly LineCodes[]>;
  /**
   * A product's barcodes, for the GTIN cell's drill-down (Alt+Enter, the cell menu, or its "+N"). Absent,
   * the cell has no drill-down.
   */
  fetchCodes?: (subjectId: number) => Promise<ProductCodesResponse>;
  /** Take a code off a product. Absent, the codes are shown read-only and a capture has no Undo. */
  removeCode?: (
    subjectId: number,
    request: RemoveProductCodeRequest,
  ) => Promise<RemovedProductCode>;
}

/** `GET /products/{subject}/codes`. */
export interface ProductCodesResponse extends ProductCodesDetail {
  product: { name: string; sku: string | null };
}

/** `POST /products/{subject}/codes/remove`, once removed. */
export interface RemovedProductCode {
  outcome: 'deleted' | 'retired';
  codes: ProductCodeEntry[];
  /** What a scan matches the product by now. */
  scannable: string[];
  /** The product's GTIN now; null once the store's field was emptied. */
  gtin: string | null;
}

/** A refused capture, shown on the line's capture cell until the next capture on it. */
interface CaptureError {
  code: string;
  message: string;
  holder: CodeHolderRef | null;
}

/**
 * The goods-reception line grid on the extracted DataGrid. The receiving session IS the dirty model:
 * every counted Received/Damaged cell shows staged (yellow background) until the parent commits the
 * session ("Confirm receipt"). Received/Damaged edit through the `quantity:receipt` editor; per-row
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
    const s = sessionGoodFor(row.subjectId);
    if (null === s && !row.qtyReceived) return null;
    return row.qtyReceived + (s ?? 0);
  };

  // ── Expected qty (read-only) ───────────────────────────────────────────────────────────────────
  // The supplier-confirmed baseline — a per-line order property set pre-arrival (ASN / invoice / a
  // separate entry workflow, not at GR). When unset it INHERITS the ordered qty (rendered faded); the
  // variance measures against it. Read straight off the line; there's no editing state here.

  // ── GR variance ────────────────────────────────────────────────────────────────────────────────
  const [baseline, setBaseline] = persistedSignal<VarianceBaseline>(
    'invflux:po-receive:variance-baseline',
    'ordered',
  );
  // Cumulative good (prior committed receipts + this session) minus the chosen baseline. Null until the
  // line is counted. In "expected" mode a missing expected falls back to ordered (flagged by the cell).
  const baseFor = (row: PoLine): number => baselineQty(row, baseline());
  const usesFallback = (row: PoLine): boolean =>
    'expected' === baseline() && null === row.qtyExpected;
  const varianceFor = (row: PoLine): number | null => {
    const g = goodFor(row); // cumulative good (received-so-far + this session)
    return null === g ? null : g - baseFor(row);
  };

  // ── Code capture ──────────────────────────────────────────────────────────────────────────────
  // While a capability registers a capture handler, the GTIN column is the capture cell (receiveCapture.ts).
  // A stored code joins its line's match set from the handler's answer, here, so the next scan finds the
  // line without waiting for the order to be read again. A code read again for a scan no line named
  // lands here too.
  const captureOn = (): boolean => undefined !== activeReceiveCapture();
  const [captured, setCaptured] = createSignal<
    Record<number, { codes: string[]; gtin: string | null }>
  >({});
  const [captureErrors, setCaptureErrors] = createSignal<Record<number, CaptureError>>({});
  const [capturing, setCapturing] = createSignal<ReadonlySet<number>>(new Set());
  const lines = createMemo<PoLine[]>(() =>
    props.lines.map((l) => {
      const c = captured()[l.subjectId];
      return undefined === c ? l : { ...l, codes: c.codes, gtin: c.gtin };
    }),
  );

  // Quick-filter: typed text fuzzy-matches the rows on the identifier fields; a scan matches whole codes
  // only (see receiveScan.ts), since a scanned code is never part of the one it means. Non-matching
  // lines hide immediately.
  const [filterText, setFilterTextRaw] = createSignal('');
  createEffect(
    on(
      () => filterText().trim(),
      (text) => {
        if ('' !== text) props.onLookup?.();
      },
      { defer: true },
    ),
  );
  const [filterIsScan, setFilterIsScan] = createSignal(false);
  const setFilterText = (text: string): void => {
    setFilterIsScan(false);
    setFilterTextRaw(text);
  };
  const matchFields = (l: PoLine): Array<string | null> => [
    l.productLabel,
    l.sku,
    l.supplierSku,
    l.gtin,
    ...l.codes,
  ];
  const visibleLines = createMemo<PoLine[]>(() => {
    const text = filterText();
    if ('' === text.trim()) return lines();
    return filterIsScan()
      ? lines().filter((l) => scanNamesLine(l, text))
      : lines().filter((l) => fuzzyMatches(text, matchFields(l)));
  });

  // ── Zoom on filter ─────────────────────────────────────────────────────────────────────────────
  // When the filter narrows the grid to one line, its product's picture hangs under the table, large
  // enough to compare with the goods in hand. Per device, on unless switched off in the gear; its
  // size is the one the operator last dragged it to. Closed with its ×, it stays closed for that line
  // until the filter stops narrowing to it, so a refresh or another scan of the same product does not
  // bring it back, and the next product found does.
  const [zoomOnFilter, setZoomOnFilter] = persistedSignal<boolean>(
    'invflux:po-receive:zoom-on-filter',
    true,
  );
  const [zoomWidth, setZoomWidth] = persistedSignal<number>('invflux:po-receive:zoom-width', 320);
  const [closedFor, setClosedFor] = createSignal<number | null>(null);
  const foundLine = (): PoLine | undefined => {
    if ('' === filterText().trim()) return undefined;
    const visible = visibleLines();
    return 1 === visible.length ? visible[0] : undefined;
  };
  createEffect(
    on(
      () => foundLine()?.subjectId,
      (id) => {
        if (undefined === id) setClosedFor(null);
      },
    ),
  );
  const zoomed = (): PoLine | undefined => {
    const line = foundLine();
    return zoomOnFilter() &&
      undefined !== line &&
      null !== line.imageUrl &&
      closedFor() !== line.subjectId
      ? line
      : undefined;
  };
  // The picture may be as wide as the table it hangs under.
  let tableBox: HTMLDivElement | undefined;
  const [tableWidth, setTableWidth] = createSignal(0);
  onMount(() => {
    if (undefined === tableBox || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setTableWidth(tableBox?.clientWidth ?? 0));
    observer.observe(tableBox);
    onCleanup(() => observer.disconnect());
  });
  const surface = useSurface();
  if (surface) {
    onCleanup(
      surfaceSettingsRegistry.register({
        surfaceId: surface.surfaceId,
        id: 'po-receive-zoom-on-filter',
        // Above the grid's own Data Grid section (90): it is about what this screen shows.
        order: 20,
        label: () => _x('Zoom on filter', 'receiving gear section'),
        component: () => (
          <SettingsSection title={_x('Zoom on filter', 'receiving gear section')}>
            <Checkbox
              checked={zoomOnFilter()}
              onChange={(e) => setZoomOnFilter(e.currentTarget.checked)}
              wrapperClass="gap-2"
              data-testid="po-receive-zoom-toggle"
              label={__('Show the product’s picture when the filter finds a single line')}
            />
          </SettingsSection>
        ),
      }),
    );
  }

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
      description: __('Product name — match the physical goods against it'),
      dataType: 'text',
      copyable: true,
      defaultWidth: 280,
    }),
    colMeta({
      id: 'sku',
      label: __('SKU'),
      description: __('Our Stock Keeping Unit for this product'),
      dataType: 'text',
      copyable: true,
      defaultWidth: 120,
    }),
    colMeta({
      id: 'supplier_sku',
      label: __('Supplier SKU'),
      description: __('The supplier’s own code for this product (matches their packing slip)'),
      dataType: 'text',
      copyable: true,
      defaultWidth: 130,
    }),
    colMeta({
      id: 'gtin',
      label: __('GTIN'),
      description: captureOn()
        ? __(
            'The product’s barcode. Scan or type a barcode here to add it to the product, so the next scan finds this line.',
          )
        : __(
            'The barcode on the carton — the widest of the three codes, so it is the one a scanner reads',
          ),
      // Its own datatype, so it opens the product's codes (the `text:gtin` drill-down) and is otherwise
      // shown and edited as text.
      dataType: 'text:gtin',
      copyable: true,
      hasDrilldown: undefined !== props.fetchCodes,
      ...(captureOn() ? { kind: 'editable' as const, editable: true } : {}),
      defaultWidth: 150,
    }),
    colMeta({
      id: 'ordered',
      label: __('Ordered'),
      description: __(
        'Quantity ordered on this PO line — the variance baseline (and what Expected inherits when unset). The “.” key still fills the outstanding remainder into Received.',
      ),
      dataType: 'integer',
      copyable: true,
      defaultWidth: 90,
    }),
    // Read-only: the supplier-confirmed baseline, set pre-arrival by a separate ASN/invoice workflow.
    // Inherits the ordered qty (shown faded) when unset.
    colMeta({
      id: 'expected',
      label: __('Expected'),
      description: __(
        'What the supplier confirmed they’d ship (ASN / invoice) — the variance baseline. Inherits the ordered qty (faded) when not set.',
      ),
      dataType: 'integer',
      copyable: true,
      defaultWidth: 100,
    }),
    colMeta({
      id: 'received_so_far',
      label: __('Received so far'),
      description: __(
        'Good units already committed from earlier deliveries on this PO — any damaged units received earlier show in red parentheses (read-only)',
      ),
      dataType: 'integer',
      copyable: true,
      defaultWidth: 120,
    }),
    colMeta({
      id: 'received',
      // Not "Received": that is the column beside it, and past tense on the cell you are still
      // filling reads as a figure already banked. This one is what is being counted right now.
      label: _x('Receiving', 'goods-receipt column: units arriving in this delivery'),
      description: __(
        'Units arriving in THIS delivery (including any damaged). “.” fills the outstanding qty; a negative value corrects a prior over-count.',
      ),
      dataType: 'quantity:receipt',
      kind: 'editable',
      editable: true,
      copyable: true,
      pasteable: true,
      defaultWidth: 110,
    }),
    colMeta({
      id: 'damaged',
      label: __('Damaged'),
      description: __(
        'Of the received units, how many are damaged / unfit — they don’t move into saleable stock',
      ),
      dataType: 'quantity:receipt',
      kind: 'editable',
      editable: true,
      copyable: true,
      pasteable: true,
      defaultWidth: 110,
    }),
    colMeta({
      id: 'good',
      label: __('Good'),
      description: __('Total saleable units so far = received so far + received − damaged'),
      dataType: 'integer',
      copyable: true,
      defaultWidth: 90,
    }),
    colMeta({
      id: 'variance',
      label: __('Variance'),
      description: __(
        'Good received-so-far minus the chosen baseline (ordered or expected) — short shown red, over amber',
      ),
      dataType: 'text',
      copyable: true,
      defaultWidth: 120,
    }),
  ]);

  const ch = createColumnHelper<PoLine>();
  const bespokeColumns = new Map<string, ColumnDef<PoLine, unknown>>([
    [
      'image',
      ch.display({
        id: 'image',
        header: () => __('Image'),
        cell: (info) => (
          <ThumbnailZoom
            src={info.row.original.imageUrl}
            alt={info.row.original.productLabel}
            size={36}
          />
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
      'gtin',
      ch.display({
        id: 'gtin',
        header: () => __('GTIN'),
        cell: (info) => (
          <GtinCell
            line={info.row.original}
            error={captureErrors()[info.row.original.subjectId]}
            pending={capturing().has(info.row.original.subjectId)}
            productLink={props.productLink}
            onShowCodes={
              undefined === props.fetchCodes
                ? undefined
                : () => gridApi?.openDrilldownById(String(info.row.original.subjectId), 'gtin')
            }
          />
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'ordered',
      ch.display({
        id: 'ordered',
        header: () => __('Ordered'),
        cell: (info) => <span class="tabular-nums">{info.row.original.qtyRequested}</span>,
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'expected',
      ch.display({
        id: 'expected',
        header: () => __('Expected'),
        cell: (info) => (
          <ExpectedCell
            expected={info.row.original.qtyExpected}
            ordered={orderedQty(info.row.original)}
          />
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'received_so_far',
      ch.display({
        id: 'received_so_far',
        header: () => __('Received so far'),
        cell: (info) => (
          <ReceivedSoFarCell
            good={info.row.original.qtyReceived}
            damaged={info.row.original.qtyDamagedSoFar}
          />
        ),
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'received',
      ch.display({
        id: 'received',
        header: () => _x('Receiving', 'goods-receipt column: units arriving in this delivery'),
        cell: (info) => <NumCell value={recvFor(info.row.original.subjectId)} />,
      }) as ColumnDef<PoLine, unknown>,
    ],
    [
      'damaged',
      ch.display({
        id: 'damaged',
        header: () => __('Damaged'),
        cell: (info) => <NumCell value={dmgFor(info.row.original.subjectId)} />,
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
      case 'gtin':
        return row.gtin;
      case 'ordered':
        return row.qtyRequested;
      case 'expected':
        return row.qtyExpected ?? row.qtyRequested; // effective baseline (inherits ordered)
      case 'received_so_far':
        return row.qtyReceived;
      case 'received':
        return recvFor(row.subjectId);
      case 'damaged':
        return dmgFor(row.subjectId);
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
    if ('received' === columnId && null !== recvFor(row.subjectId)) {
      return { staged: true, value: recvFor(row.subjectId) };
    }
    if ('damaged' === columnId && null !== dmgFor(row.subjectId)) {
      return { staged: true, value: dmgFor(row.subjectId) };
    }
    return { staged: false, value: undefined };
  };

  const canEdit = (_row: PoLine, meta: GridColumnMeta): boolean =>
    'received' === meta.id || 'damaged' === meta.id || ('gtin' === meta.id && captureOn());

  // Received/Damaged clear to blank (Del / Backspace → uncounted again); nothing else is clearable.
  const resolveClearedValue = (
    _row: PoLine,
    meta: GridColumnMeta,
  ): { ok: boolean; value: unknown } =>
    'received' === meta.id || 'damaged' === meta.id
      ? { ok: true, value: null }
      : { ok: false, value: null };

  // Inject per-row editor config the row-blind editor can't compute: `.` fills the open qty (Received)
  // or the current received (Damaged); Damaged is capped at THIS session's received count (receipt-scoped
  // — a delivery can only damage what it delivered; post-receipt damage is a separate correction flow).
  // A BLANK received means nothing arrived this session, so damaged is capped at 0 (not left uncapped) —
  // otherwise damaged could exceed what was received.
  const resolveEditorMeta = (meta: GridColumnMeta, row: PoLine): GridColumnMeta => {
    if ('received' === meta.id) {
      return {
        ...meta,
        editorConfig: {
          dotDefault: row.qtyOpen,
          // The header's own word: an editor announcing a different name than the column it sits in
          // is the one place the distinction matters most, since the header is off-screen by then.
          ariaLabel: _x('Receiving', 'goods-receipt column: units arriving in this delivery'),
        },
      };
    }
    if ('damaged' === meta.id) {
      const recv = recvFor(row.subjectId) ?? 0;
      return { ...meta, editorConfig: { dotDefault: recv, max: recv, ariaLabel: __('Damaged') } };
    }
    if ('gtin' === meta.id) {
      return { ...meta, editorConfig: { ariaLabel: __('Barcode to add to this product') } };
    }
    return meta;
  };

  const onStageEdit = (row: PoLine, columnId: string, _original: unknown, next: unknown): void => {
    const v = null === next || undefined === next ? null : Number(next);
    if ('received' === columnId) {
      // A typed 0 STAGES (yellow) — for the GR worker it's a progress signal ("checked, none here"),
      // distinct from an unreviewed blank. System-side a staged 0 records no receipt line, same as blank;
      // the difference is purely the worker's review-progress marker.
      props.setRecv(row.subjectId, v);
    } else if ('damaged' === columnId) {
      props.setDmg(row.subjectId, v);
    } else if ('gtin' === columnId) {
      // A code typed into the capture cell. Unchanged or blank is nothing to store.
      const code = null === next || undefined === next ? '' : String(next).trim();
      if ('' !== code && code !== row.gtin) void captureCode(row, code);
    }
  };

  const clearCell = (row: PoLine, columnId: string): void => {
    if ('received' === columnId) {
      props.setRecv(row.subjectId, null);
    } else if ('damaged' === columnId) {
      props.setDmg(row.subjectId, null);
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
        cancelEdit: () => void;
        getSelectedCells: () => Array<{ row: PoLine; columnId: string }>;
        getSelectableColumnIds: () => string[];
        focusGrid: () => void;
        focusCellById: (rowId: string, columnId: string, editMode?: boolean) => void;
        openDrilldownById: (rowId: string, columnId: string) => void;
        openColumnManager: () => void;
        openGridSettings: () => void;
      }
    | undefined;
  let focusFilter: (() => void) | undefined;

  // Moving onto an editable cell of another line is the moment its box should show what a coworker
  // already entered there — the parent decides whether a refresh is worth it.
  let lastFocusedLine: number | undefined;
  createEffect(
    on(
      () => cellSelection().active,
      (active) => {
        if (null === active) return;
        const line = visibleLines()[active.row];
        const colId = (gridApi?.getSelectableColumnIds() ?? [])[active.col];
        if (undefined === line || ('received' !== colId && 'damaged' !== colId)) return;
        if (line.subjectId === lastFocusedLine) return;
        lastFocusedLine = line.subjectId;
        props.onLineFocus?.();
      },
      { defer: true },
    ),
  );

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
      // Enter on a quantity cell without editing it leaves the figure as it is, and is asked of the
      // commit-navigation rules as a commit of it would be: a scan that found the line and needs nothing
      // typed closes the same way as one that does. Unclaimed, the grid moves down as it always does.
      if ('Enter' === e.key && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const selected = gridApi?.getSelectedCells() ?? [];
        const only = 1 === selected.length ? selected[0]! : undefined;
        if (
          undefined !== only &&
          ('received' === only.columnId || 'damaged' === only.columnId) &&
          onCommitNavigate(only.row, only.columnId, 'down')
        ) {
          e.preventDefault();
          return true;
        }
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

  /** Focus a row's left-most editable cell (Received here). False when it has none. */
  const focusFirstEditable = (row: PoLine): boolean => {
    const colId = firstEditableColumnId(
      row,
      columnMetas(),
      canEdit,
      gridApi?.getSelectableColumnIds() ?? [],
    );
    if (undefined === colId) return false;
    gridApi?.focusCellById(String(row.subjectId), colId);
    return true;
  };

  // Enter from the filter with a single match jumps straight to that row's left-most editable cell
  // (Received here — ready to type a qty or "." to fill); otherwise (multi-match, or Esc) just drop
  // into cell-nav. The target column isn't hard-coded — it's the first editable one in display order.
  const onFilterLeave = (key: 'Enter' | 'Escape'): void => {
    if ('Enter' === key && 1 === visibleLines().length && focusFirstEditable(visibleLines()[0]!))
      return;
    gridApi?.focusGrid();
  };

  // Scans, through the scan bus: into the filter while it has focus, and to the grid's loop from
  // anywhere else on the screen (a cell, the page). Both answer alike: the base narrows to the lines
  // the code names and, when it names one, goes to its first editable cell, as typing the code and
  // pressing Enter does; a contributed handler may do more (receiveScan.ts). A scan that names no line,
  // or several, shows exactly that, as typing it would, and says nothing more — once the order's codes
  // have been read again, for a code no line names (codeRefresher, receiveScan.ts).
  let filterBox: HTMLDivElement | undefined;
  const byId = createMemo(() => new Map(lines().map((l) => [l.subjectId, l])));
  const named = (code: string): boolean => lines().some((l) => scanNamesLine(l, code));
  const codes = codeRefresher(
    () => props.lookupCodes?.() ?? Promise.resolve([]),
    (fresh) =>
      setCaptured((prev) => {
        const next = { ...prev };
        for (const l of fresh) next[l.subjectId] = { codes: l.codes, gtin: l.gtin };
        return next;
      }),
  );
  const onScan = (scan: Scan): ScanAnswer => {
    const waiting = undefined === props.lookupCodes ? undefined : codes.before(named(scan.code));
    return undefined === waiting ? resolveScan(scan) : waiting.then(() => resolveScan(scan));
  };
  const resolveScan = (scan: Scan): ScanReply =>
    resolveReceiveScan({
      gridId: RECEIVE_GRID_ID,
      code: scan.code,
      source: scan.source,
      lines: lines(),
      matches: lines().filter((l) => scanNamesLine(l, scan.code)),
      received: recvFor,
      setReceived: (id, qty) => props.setRecv(id, qty),
      addReceived: (id, units) =>
        props.addRecv ? props.addRecv(id, units) : props.setRecv(id, (recvFor(id) ?? 0) + units),
      showMatches: () => {
        setFilterTextRaw(scan.code);
        setFilterIsScan(true);
      },
      clearFilter: () => setFilterText(''),
      focusFilter: () => focusFilter?.(),
      focusLine: (id) => {
        const row = byId().get(id);
        if (undefined !== row) focusFirstEditable(row);
      },
    });
  const matchSet = (): string[] => lines().flatMap((l) => [...l.codes, ...(l.sku ? [l.sku] : [])]);

  /**
   * Store a code on a line's product through the capture handler. Accepted, the line's codes are
   * replaced by the answer, and a scan then goes on as any scan of that code would: in scan-to-count it
   * counts the unit it was read from. Refused, the cell keeps the reason, and a toast says it, since a
   * scan's Enter completes the capture unseen.
   */
  const captureCode = async (row: PoLine, code: string, scan?: Scan): Promise<void> => {
    const handler = activeReceiveCapture();
    if (undefined === handler) return;
    const id = row.subjectId;
    // A code the line already answers to is accepted and changes nothing, so there is nothing to undo.
    const adds = !scanNamesLine(row, code);
    setCapturing((prev) => new Set(prev).add(id));
    try {
      const result = await handler.capture({
        gridId: RECEIVE_GRID_ID,
        poId: props.poId,
        subjectId: id,
        code,
      });
      if (isRefusal(result)) {
        const holder = result.holder ?? null;
        setCaptureErrors((prev) => ({ ...prev, [id]: { code, message: result.refused, holder } }));
        const link = null === holder ? undefined : props.productLink?.(holder.subjectId);
        toast.error(result.refused, {
          action:
            undefined === link
              ? undefined
              : { label: __('Show in Workbench'), onClick: () => (window.location.hash = link) },
        });
        return;
      }
      setCaptureErrors((prev) => {
        const { [id]: _cleared, ...rest } = prev;
        return rest;
      });
      setCaptured((prev) => ({
        ...prev,
        [id]: { codes: result.codes, gtin: result.gtin ?? row.gtin },
      }));
      toast.success(
        sprintf(
          /* translators: 1: the barcode just stored, 2: the product it was added to */
          __('%1$s added to %2$s.'),
          code,
          row.productLabel,
        ),
        {
          action:
            !adds || undefined === props.removeCode || undefined === props.fetchCodes
              ? undefined
              : {
                  label: _x('Undo', 'take back a barcode just added'),
                  onClick: () => void undoCapture(row, code),
                },
        },
      );
      if (undefined !== scan) void onScan(scan);
    } catch {
      toast.error(__('The code could not be stored. Try the scan again.'));
    } finally {
      setCapturing((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  // ── The product's codes: the GTIN cell's drill-down, and taking a code off ─────────────────────
  // A removal's answer replaces the line's codes and GTIN as a capture's does, so the next scan already
  // misses a code just removed.
  const fetchDrilldown = async (
    _columnId: string,
    row: PoLine,
  ): Promise<{
    title: () => JSX.Element;
    subtitle: () => JSX.Element;
    detail: ProductCodesDetail;
  }> => {
    if (undefined === props.fetchCodes)
      throw new Error(__('This product’s barcodes cannot be shown here.'));
    const answer = await props.fetchCodes(row.subjectId);
    return {
      title: () => _x('Barcodes', 'drill-down title: every barcode of one product'),
      subtitle: () => answer.product.name,
      detail: {
        codes: answer.codes,
        canRemove: answer.canRemove && undefined !== props.removeCode,
      },
    };
  };
  const removed = (
    row: PoLine | undefined,
    subjectId: number,
    code: string,
    answer: RemovedProductCode,
  ): void => {
    setCaptured((prev) => ({
      ...prev,
      [subjectId]: { codes: answer.scannable, gtin: answer.gtin },
    }));
    toast.success(
      sprintf(
        /* translators: 1: the barcode just removed, 2: the product it was removed from */
        __('%1$s removed from %2$s.'),
        code,
        row?.productLabel ?? '',
      ),
    );
  };
  const saveDrilldown = async (
    _columnId: string,
    subjectId: number,
    payload: unknown,
  ): Promise<{ detail: ProductCodesDetail }> => {
    const request = payload as RemoveProductCodeRequest;
    if (undefined === props.removeCode) throw new Error(__('Codes cannot be removed here.'));
    const answer = await props.removeCode(subjectId, request);
    removed(byId().get(subjectId), subjectId, request.value, answer);
    return { detail: { codes: answer.codes, canRemove: true } };
  };
  /** Take back a code just captured: found among the product's codes by its value, then removed. */
  const undoCapture = async (row: PoLine, code: string): Promise<void> => {
    if (undefined === props.fetchCodes || undefined === props.removeCode) return;
    try {
      const entry = (await props.fetchCodes(row.subjectId)).codes.find((c) => c.value === code);
      if (undefined === entry) {
        toast.error(__('This code is no longer on the product.'));
        return;
      }
      const answer = await props.removeCode(row.subjectId, {
        action: 'remove',
        type: entry.type,
        value: entry.value,
        supplierId: entry.supplierId,
      });
      removed(row, row.subjectId, code, answer);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : __('The code could not be removed.'));
    }
  };

  useScanTarget({ element: () => filterBox, kind: 'product', matchSet, onScan });
  // The grid itself is a target too. A scan with a quantity cell focused opens that cell's editor on its
  // first character and types the rest of the code in as the quantity; the bus recognizes it at the
  // scanner's Enter and stops that Enter, and the grid drops the edit before handling the code as a scan.
  // A person typing a quantity is never a burst, so their edit is untouched.
  let gridBox: HTMLDivElement | undefined;
  useScanTarget({
    element: () => gridBox,
    kind: 'product',
    matchSet,
    onScan: (scan) => {
      gridApi?.cancelEdit();
      // With the capture cell selected, a scan is the code to store on that line, which is why the
      // operator put the cursor there.
      const selected = gridApi?.getSelectedCells() ?? [];
      if (captureOn() && 1 === selected.length && 'gtin' === selected[0]!.columnId) {
        void captureCode(selected[0]!.row, scan.code, scan);
        return undefined;
      }
      return onScan(scan);
    },
  });
  useScanLoop({ kind: 'product', matchSet, onScan });

  // Where focus goes once a Received/Damaged qty is committed. This grid moves the way the editor
  // asked — down on Enter, right on Tab — and decides nothing further on its own; a contributed
  // capability may claim the move instead, composing it from the operations handed over below, each
  // of which this surface already performs for itself (the filter's own input sets its text, Escape
  // and `/` focus it, cell selection is ordinary grid navigation).
  //
  const onCommitNavigate = (row: PoLine, columnId: string, move: EditMove): boolean =>
    resolveCommitNav({
      gridId: RECEIVE_GRID_ID,
      columnId,
      rowId: String(row.subjectId),
      move,
      filterText: filterText(),
      visibleCount: visibleLines().length,
      setFilterText,
      // By id, not index: clearing a filter changes which row sits where, so a rule that clears it
      // first would otherwise re-anchor onto whatever row took the old index.
      selectCellByRowId: (rowId, colId) => {
        const rowIndex = visibleLines().findIndex((l) => String(l.subjectId) === rowId);
        const col = (gridApi?.getSelectableColumnIds() ?? []).indexOf(colId);
        if (rowIndex >= 0 && col >= 0) setCellSelection(selectCell({ row: rowIndex, col }));
      },
      focusFilter: () => focusFilter?.(),
    });

  return (
    <div>
      <div class="flex items-center gap-3">
        <div class="min-w-0 flex-1" ref={filterBox} data-testid="po-receive-filter">
          <QuickFilter
            value={filterText}
            onInput={setFilterText}
            onLeave={onFilterLeave}
            ref={(focus) => (focusFilter = focus)}
            placeholder={__('Filter or scan — name / SKU / barcode…')}
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
        {/* Right-most, after the controls that change what the grid *asks for*: this one changes only
            what it shows. Ctrl+M still opens the same manager — the button is what makes it findable. */}
        <Button
          variant="secondary"
          class="h-8 shrink-0 px-2!"
          aria-label={`${__('Columns')} (Ctrl+M)`}
          title={`${__('Columns')} (Ctrl+M)`}
          onClick={() => gridApi?.openColumnManager()}
        >
          <ColumnsSettingsIcon class="h-5 w-5" />
        </Button>
      </div>
      {/* Flex-column + viewport cap so the grid's internal scroll container (flex-1 min-h-0) gets a
          bounded height and scrolls; pt-6 leaves room for the gear (-top-2), and no overflow-hidden so
          the gear isn't clipped (the scroll container carries its own border). */}
      {/* The table, and the picture that hangs from its bottom edge (zoom on filter). */}
      <div class="relative" ref={tableBox}>
        <div class="flex max-h-[70vh] flex-col pt-2" ref={gridBox}>
          <DataGrid<PoLine>
            rows={visibleLines}
            getRowId={(l) => String(l.subjectId)}
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
            fetchDrilldown={fetchDrilldown}
            saveDrilldown={undefined === props.removeCode ? undefined : saveDrilldown}
            keyHandlers={globalKeyHandlers}
            keyHandlersInGrid={inGridKeyHandlers}
            onStageEdit={onStageEdit}
            onCommitNavigate={onCommitNavigate}
            onClearCells={onClearCells}
            sorting={sorting}
            onSortingChange={(next) => setSorting(() => next)}
            scope="po-receive"
            defaultColumnOrder={COLUMN_ORDER}
            defaultExpandedSections={['goods-receipt']}
            rowSelection={rowSelection}
            setRowSelection={(updater) => setRowSelection(updater)}
            cellSelection={cellSelection}
            setCellSelection={(updater) => setCellSelection(updater)}
            fallback={
              <div class="px-3 py-6 text-sm text-slate-500">{__('No lines on this receipt.')}</div>
            }
          />
        </div>
        <Show when={zoomed()} keyed>
          {(line) => (
            <PicturePopover
              src={line.imageUrl!}
              srcset={line.imageSrcset ?? null}
              alt={line.productLabel}
              width={zoomWidth()}
              maxWidth={tableWidth() > 0 ? tableWidth() : zoomWidth()}
              onResize={setZoomWidth}
              onClose={() => setClosedFor(line.subjectId)}
              closeLabel={__('Close the picture')}
              testId="po-receive-zoom"
            />
          )}
        </Show>
      </div>
    </div>
  );
}

/**
 * The product's name.
 *
 * Each of the three codes a receiver matches against — our SKU, the supplier's, the GTIN — is a
 * column of its own, so this cell carries identity and nothing else. They are still every one of
 * them a filter match-key whether their column is on screen or not, which is what lets a receiver
 * scan a carton against a grid narrowed to the columns they are actually reading.
 */
function ProductCell(props: { line: PoLine }): JSX.Element {
  return (
    <div class="font-medium" classList={{ 'text-text-muted italic': !props.line.exists }}>
      {props.line.productLabel}
    </div>
  );
}

/**
 * The GTIN cell: the product's GTIN, and how many more codes it carries. As the capture cell it also
 * shows a capture in flight, and a refused one: the code read, struck through and ringed, with the reason
 * as its tooltip and, where this user can open it, a link to the product that already has the code.
 */
function GtinCell(props: {
  line: PoLine;
  error: CaptureError | undefined;
  pending: boolean;
  productLink: ((subjectId: number) => string | undefined) | undefined;
  /** Open the product's codes; absent, the count of other codes is shown, not offered. */
  onShowCodes?: (() => void) | undefined;
}): JSX.Element {
  const others = (): number => props.line.codes.filter((c) => c !== props.line.gtin).length;
  const othersLabel = (): string =>
    sprintf(
      /* translators: %d: how many barcodes the product has besides the GTIN shown */
      _n('+%d code', '+%d codes', others()),
      others(),
    );
  const link = (): string | undefined =>
    undefined === props.error?.holder || null === props.error.holder
      ? undefined
      : props.productLink?.(props.error.holder.subjectId);

  return (
    <Show
      when={props.error}
      fallback={
        <span
          class="flex items-center gap-1.5 font-mono text-slate-500"
          classList={{ 'opacity-50': props.pending }}
        >
          <span class="truncate">{props.line.gtin ?? '—'}</span>
          <Show when={others() > 0}>
            <Show
              when={props.onShowCodes}
              fallback={
                <span
                  class="shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-600"
                  title={props.line.codes.join('\n')}
                >
                  {othersLabel()}
                </span>
              }
            >
              {(show) => (
                <button
                  type="button"
                  class="shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                  title={props.line.codes.join('\n')}
                  data-testid="po-receive-codes-chip"
                  // The grid selects a cell on press; the chip opens the codes instead.
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    show()();
                  }}
                >
                  {othersLabel()}
                </button>
              )}
            </Show>
          </Show>
        </span>
      }
    >
      {(error) => (
        <span
          class="flex items-center gap-1.5 rounded px-1 ring-1 ring-red-400"
          title={error().message}
          data-testid="po-receive-capture-error"
        >
          <span class="truncate font-mono text-red-600 line-through">{error().code}</span>
          <Show when={link()}>
            {(href) => (
              <a
                class="shrink-0 text-xs text-primary underline"
                href={`#${href()}`}
                title={error().message}
              >
                {__('Show')}
              </a>
            )}
          </Show>
        </span>
      )}
    </Show>
  );
}

/** Monospaced code view cell (SKU / supplier SKU / GTIN); blank renders an em dash. */
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
    <Show
      when={props.good > 0 || props.damaged > 0}
      fallback={<span class="block text-right text-slate-300">—</span>}
    >
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
    <span
      class="block text-right tabular-nums"
      classList={{
        'text-text-muted italic': null === props.expected,
        'text-slate-700': null !== props.expected,
      }}
    >
      {props.expected ?? props.ordered}
    </span>
  );
}

/**
 * GR variance cell: signed `{abs} ({pct})` of good-so-far vs the chosen baseline — colored short (red)
 * / over (amber) / on-target (neutral), blank until the line is counted. Guards the percentage against a
 * 0 baseline. A per-line fallback to ordered (when "vs expected" has no expected set) is flagged with a
 * subtle tag, so a `0` never misreads as "matched what they promised".
 */
function VarianceCell(props: {
  delta: () => number | null;
  base: () => number;
  fallback: () => boolean;
}): JSX.Element {
  const pct = (): number | null => {
    const d = props.delta();
    const b = props.base();
    return null === d || b <= 0 ? null : Math.round((d / b) * 100);
  };
  const sign = (): string => ((props.delta() ?? 0) > 0 ? '+' : '');
  return (
    <Show
      when={null !== props.delta()}
      fallback={<span class="block text-right text-slate-300">—</span>}
    >
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

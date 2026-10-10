import { __, sprintf } from '@invflux/i18n';
import {
  Button,
  ConfirmModal,
  createViewportFill,
  DataGrid,
  type DataGridMenuItem,
  EMPTY_SELECTION,
  ErrorBanner,
  type GridColumnMeta,
  Input,
  mintReceiptKey,
  type SearchSelectOption,
  type SelectionState,
  Select,
  type StagedCell,
  Textarea,
  toast,
  usePortalRootOptional,
} from '@invflux/ui';
import { STOCK_MOVED } from '@invflux/ui/api';
import { firstEditableColumnId } from '@invflux/procurement/src/grid/editableColumn';
import { registerCatalogPickerEditor } from '@invflux/procurement/src/grid/catalogPickerEditor';
import {
  type ProductSearchAnswer,
  registerProductSearchEditor,
} from '@invflux/procurement/src/grid/productSearchEditor';
import type { AddOption } from '@invflux/procurement/src/sections/purchase-orders/AddPicker';
import { useNavigate } from '@solidjs/router';
import {
  type ColumnDef,
  createColumnHelper,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/solid-table';
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query';
import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { useApp } from '../../context';
import { createApi } from '../../lib/api';
import { costText as formatCost } from './costText';
import { ReceivingCrumbs } from './ReceivingCrumbs';
import type {
  ReceivableProduct,
  ReceivableProductsResponse,
  ReceivingContextResponse,
  RecordedReceipt,
  StandaloneLine,
  StandaloneSessionResponse,
  StandaloneSessionView,
} from './types';

/** Sentinel subject id for the always-present append row (real subject ids are positive). */
const DRAFT_SUBJECT_ID = 0;
/**
 * The append row's product cell: the server-search editor over the shop, or — with a supplier's
 * catalog loaded — the PO draft's catalog picker, which matches in the browser.
 */
const SEARCH_EDITOR_TYPE = 'text:product-search';
const CATALOG_EDITOR_TYPE = 'text:catalog-add';
const HEARTBEAT_MS = 45_000;
const REFRESH_WITH_OTHERS_MS = 15_000;
/** The grid's one column section. */
const GRID_GROUP = 'receiving-standalone';
const COLUMN_ORDER = [
  'product',
  'sku',
  'on_hand',
  'received',
  'damaged',
  'supplier_price',
  'unit_cost',
];
const PURCHASE_WITHOUT_ORDER = 'purchase_without_order';

const DRAFT_LINE: StandaloneLine = {
  subjectId: DRAFT_SUBJECT_ID,
  name: '',
  sku: '',
  onHand: 0,
  received: 0,
  damaged: 0,
  unitCost: null,
  unitCostInherited: false,
  supplierPrice: null,
  supplierPriceInherited: false,
};

/** The server's refusals carry the operator message under `error`, plus what to point at. */
interface ReceiptErrorBody {
  error?: unknown;
  code?: unknown;
  subjectIds?: unknown;
  subjectId?: unknown;
}

const errorBody = (e: unknown): ReceiptErrorBody =>
  e !== null && 'object' === typeof e && 'body' in e && null !== (e as { body: unknown }).body
    ? ((e as { body: ReceiptErrorBody }).body ?? {})
    : {};

const errorMessage = (e: unknown): string => {
  const body = errorBody(e);
  if ('string' === typeof body.error && '' !== body.error) return body.error;
  return e instanceof Error ? e.message : String(e);
};

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
    group: GRID_GROUP,
    priority: 0,
    visibleByDefault: true,
    defaultWidth: 110,
    editorConfig: {},
    ...over,
  };
}

/**
 * A count of stock arriving against no document, saved as it is entered.
 *
 * **Saved on every edit, like a purchase-order draft.** Each committed cell sends the whole count,
 * so a reload, a dropped tablet or a colleague joining finds exactly what has been entered. Nothing
 * moves stock until [Record receipt]: the count is a session, and the receipt is written from it.
 *
 * **The reason is fixed.** It was chosen when the count was opened and decides whether each line
 * asks for a cost, so it is shown, not offered. A different reason is a different count: discard
 * this one and open another.
 */
export function StandaloneSession(props: { id: number }): JSX.Element {
  const app = useApp();
  const api = createApi(app);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const portalRoot = usePortalRootOptional();
  registerProductSearchEditor();
  registerCatalogPickerEditor();

  const key = (): [string, string, number] => ['receiving', 'standalone', props.id];

  const context = createQuery(() => ({
    queryKey: ['receiving', 'context'],
    queryFn: () => api.get<ReceivingContextResponse>('/receiving/context'),
    staleTime: Number.POSITIVE_INFINITY,
  }));

  const session = createQuery(() => ({
    queryKey: key(),
    queryFn: () =>
      api.get<StandaloneSessionResponse>(`/receiving/sessions/${props.id}`).then((r) => r.session),
    // A count is shared work: a colleague's rows appear on focus, and on a timer while anyone else
    // is on it. A refresh is applied only while no save of ours is pending (see `pending`).
    refetchOnWindowFocus: true,
    refetchInterval: (q: { state: { data?: StandaloneSessionView } }) =>
      (q.state.data?.participants.length ?? 0) > 1 ? REFRESH_WITH_OTHERS_MS : false,
    retry: false,
  }));

  // What this screen shows and edits. Seeded from the server and replaced by each save's answer,
  // so the grid never waits on a round trip to show what was just typed.
  const [lines, setLines] = createSignal<StandaloneLine[]>([]);
  const [note, setNote] = createSignal('');
  const [ungoverned, setUngoverned] = createSignal<number[]>([]);
  const [costOffender, setCostOffender] = createSignal<number | null>(null);
  const [error, setError] = createSignal('');
  // Saves outstanding. The server's copy of the lines is taken whenever this is zero — on load, on
  // a refresh, and after each save — so a colleague's rows arrive, and a refresh never rolls back
  // an edit still on its way. The note is taken once: it is a field being typed in.
  const [pending, setPending] = createSignal(0);
  let noteSeeded = false;
  createEffect(() => {
    const s = session.data;
    if (undefined === s || pending() > 0) return;
    setLines(s.lines);
    if (!noteSeeded) {
      noteSeeded = true;
      setNote(s.note ?? '');
    }
  });

  const view = (): StandaloneSessionView | undefined => session.data;
  const costEntry = (): string => view()?.costEntry ?? 'none';
  const canStateCost = (): boolean => context.data?.canStateCost ?? false;
  // The cost column is always shown: what each line will be valued at is part of reading the
  // count, and a reason's cost rule (a literal zero, the product's standing value) is clearest
  // seen on the rows. It is editable only where the reason asks for a figure and this user may
  // state one — pricing an arrival is its own authority.
  const costText = (value: string | number): string =>
    formatCost(value, context.data?.costDecimals ?? 2);
  const cross = (): boolean => view()?.crossCurrency ?? false;
  // Cost columns appear only for someone who may see costs; the server leaves the figures out
  // otherwise, and an empty column would read as "no cost".
  const showsCosts = (): boolean => view()?.showsCosts ?? false;
  // The base cost is stated here only when it is not derived: against a foreign-currency supplier
  // it always comes from the supplier price and the rate.
  const editsBaseCost = (): boolean => editsCost() && !cross();
  const editsCost = (): boolean =>
    canStateCost() && ('required' === costEntry() || 'optional' === costEntry());

  // ── Saving ─────────────────────────────────────────────────────────────────────────────────────
  // One line per request, never the whole list: two people on one count each save their own rows,
  // and a list sent whole would put back whatever its sender last loaded. Requests run one after
  // another, so they land in the order they were made; each answers with the whole count.
  let chain: Promise<void> = Promise.resolve();
  const saving = (): boolean => pending() > 0;

  const enqueue = (send: () => Promise<StandaloneSessionResponse>): Promise<void> => {
    setPending((n) => n + 1);
    chain = chain
      .then(send)
      .then((r) => {
        queryClient.setQueryData(key(), r.session);
      })
      .catch((e: unknown) => {
        if (404 === (e as { status?: number }).status) {
          toast.error(errorMessage(e));
          navigate('/receiving');
          return;
        }
        toast.error(sprintf(__('Could not save the receiving session: %s'), errorMessage(e)));
        // What is on screen may now differ from what is saved: show what is.
        void session.refetch();
      })
      .finally(() => setPending((n) => n - 1));
    return chain;
  };

  const saveLine = (subjectId: number): void => {
    void enqueue(() => {
      // Read when the request goes, not when it was queued: a later edit to the same line rides it.
      const l = lines().find((x) => x.subjectId === subjectId);
      return api.put<StandaloneSessionResponse>(
        `/receiving/sessions/${props.id}/lines/${subjectId}`,
        undefined === l
          ? { received: 0 }
          : {
              received: l.received,
              damaged: l.damaged,
              // Only what was stated here travels: an inherited figure stays inherited, so it keeps
              // following the catalog (and the rate) until the receipt is posted.
              unitCost: l.unitCostInherited ? null : l.unitCost,
              supplierPrice: l.supplierPriceInherited ? null : l.supplierPrice,
            },
      );
    });
  };

  const saveNote = (): void => {
    if (note() === (view()?.note ?? '')) return;
    saveHeader({ note: note() });
  };

  const saveHeader = (patch: {
    note?: string;
    supplierId?: number | null;
    costFxRate?: string | null;
  }): void => {
    void enqueue(() =>
      api.put<StandaloneSessionResponse>(`/receiving/sessions/${props.id}`, patch),
    );
  };

  // The rate is typed into its own field and saved when the field is left.
  const [rateDraft, setRateDraft] = createSignal<string | null>(null);
  const rateShown = (): string => rateDraft() ?? view()?.costFxRate?.replace(/\.?0+$/, '') ?? '';
  const saveRate = (): void => {
    const raw = rateDraft();
    setRateDraft(null);
    if (null === raw) return;
    const n = Number(raw.replace(',', '.'));
    saveHeader({
      costFxRate: '' === raw.trim() || !Number.isFinite(n) || n <= 0 ? null : String(n),
    });
  };

  const patchLine = (subjectId: number, patch: Partial<StandaloneLine>): void => {
    setLines((ls) => ls.map((l) => (l.subjectId === subjectId ? { ...l, ...patch } : l)));
    setError('');
    saveLine(subjectId);
  };

  // ── Presence ───────────────────────────────────────────────────────────────────────────────────
  const beat = setInterval(() => {
    void api.post(`/receiving/sessions/${props.id}/heartbeat`, {}).catch(() => undefined);
  }, HEARTBEAT_MS);
  onCleanup(() => clearInterval(beat));
  const others = (): string[] => {
    const me = app.currentUser.name;
    return (view()?.participants ?? []).map((p) => p.name).filter((n) => n !== me);
  };

  // ── Product search (append row) ────────────────────────────────────────────────────────────────
  // Hits are kept so a picked product shows its name and on-hand figure at once, before the save.
  const found = new Map<number, ReceivableProduct>();
  // With a supplier named, the search starts from their catalog: an unordered delivery still
  // brings the odd product the catalog does not list, so this is a switch, not a rule.
  const [catalogOnly, setCatalogOnly] = createSignal(true);
  const catalogSupplierId = (): number | null =>
    catalogOnly() ? (view()?.supplier?.id ?? null) : null;
  const optionLabel = (p: ReceivableProduct): string =>
    '' === p.sku ? p.name : `${p.name} · ${p.sku}`;

  // The catalog is fetched whole the first time the picker opens, then matched in the browser —
  // one function ranks, filters and highlights, so what is highlighted is what is found. Not loaded
  // with the page: most sessions never open the picker in catalog mode.
  const [catalogWanted, setCatalogWanted] = createSignal(false);
  const catalog = createQuery(() => ({
    queryKey: ['receiving', 'catalog', catalogSupplierId()],
    queryFn: () =>
      api.get<ReceivableProductsResponse>('/receiving/subjects', {
        // `enabled` holds this back until there is a supplier to name.
        supplier_id: catalogSupplierId() ?? 0,
      }),
    enabled: catalogWanted() && null !== catalogSupplierId(),
    staleTime: 5 * 60_000,
  }));
  // A catalog past the server's ceiling comes back incomplete; it is then searched per keystroke
  // like the shop, narrowed to the supplier on the server. A memo, because the column definitions
  // follow it: they must be rebuilt when the answer flips, never merely because the catalog
  // arrived — a rebuild unmounts the picker the operator is typing into.
  const matchesCatalogHere = createMemo(
    (): boolean => null !== catalogSupplierId() && false !== catalog.data?.complete,
  );
  const catalogOptions = (inSession: boolean): AddOption[] => {
    const counted = new Set(lines().map((l) => l.subjectId));
    return (catalog.data?.products ?? [])
      .filter((p) => counted.has(p.subjectId) === inSession)
      .map((p) => {
        found.set(p.subjectId, p);
        return { subjectId: p.subjectId, label: optionLabel(p), unitPrice: null };
      });
  };
  // What the picker says when what was typed finds only products already counted here.
  const takenMessage = (): string => __('Already in this session');

  const productSearch = async (q: string): Promise<ProductSearchAnswer> => {
    const supplierId = catalogSupplierId();
    const res = await api.get<ReceivableProductsResponse>(
      '/receiving/subjects',
      null !== supplierId ? { q, supplier_id: supplierId } : { q },
    );
    const counted = new Set(lines().map((l) => l.subjectId));
    const toOption = (p: ReceivableProduct): SearchSelectOption => {
      found.set(p.subjectId, p);
      return { value: String(p.subjectId), label: optionLabel(p) };
    };
    return {
      options: res.products.filter((p) => !counted.has(p.subjectId)).map(toOption),
      complete: res.complete,
      taken: res.products.filter((p) => counted.has(p.subjectId)).map(toOption),
    };
  };

  let gridApi:
    | {
        focusGrid: () => void;
        focusCellById: (rowId: string, columnId: string, editMode?: boolean) => void;
        getSelectedCells: () => Array<{ row: StandaloneLine; columnId: string }>;
        getSelectableColumnIds: () => string[];
      }
    | undefined;

  const addProduct = (subjectId: number): void => {
    const p = found.get(subjectId);
    if (undefined === p || lines().some((l) => l.subjectId === subjectId)) return;
    setLines((ls) => [
      ...ls,
      {
        subjectId,
        name: p.name,
        sku: p.sku,
        onHand: p.onHand,
        received: 0,
        damaged: 0,
        unitCost: null,
        unitCostInherited: false,
        supplierPrice: null,
        supplierPriceInherited: false,
      },
    ]);
    saveLine(subjectId);
    queueMicrotask(() => gridApi?.focusCellById(String(subjectId), 'received', true));
  };

  const removeLines = (subjectIds: number[]): void => {
    const drop = new Set(subjectIds);
    setLines((ls) => ls.filter((l) => !drop.has(l.subjectId)));
    setCellSelection(EMPTY_SELECTION);
    for (const subjectId of subjectIds) {
      void enqueue(() =>
        api.del<StandaloneSessionResponse>(`/receiving/sessions/${props.id}/lines/${subjectId}`),
      );
    }
  };

  // ── Grid ───────────────────────────────────────────────────────────────────────────────────────
  const isDraft = (l: StandaloneLine): boolean => DRAFT_SUBJECT_ID === l.subjectId;
  const gridRows = createMemo<StandaloneLine[]>(() => [...lines(), DRAFT_LINE]);

  // One label per price column, used by the column picker and the header alike.
  const supplierPriceLabel = (): string =>
    sprintf(
      /* translators: %s is a currency code, e.g. USD. */
      __('%s unit price'),
      view()?.supplier?.currency ?? '',
    );
  const unitCostLabel = (): string =>
    sprintf(
      /* translators: %s is the store's base currency code, e.g. EUR. */
      __('%s unit cost'),
      view()?.baseCurrency ?? context.data?.baseCurrency ?? '',
    );

  const columnMetas = createMemo<GridColumnMeta[]>(() => [
    colMeta({
      id: 'product',
      label: __('Product'),
      dataType: matchesCatalogHere() ? CATALOG_EDITOR_TYPE : SEARCH_EDITOR_TYPE,
      copyable: true,
      defaultWidth: 320,
    }),
    colMeta({ id: 'sku', label: __('SKU'), dataType: 'text', copyable: true, defaultWidth: 140 }),
    colMeta({ id: 'on_hand', label: __('On hand'), dataType: 'number', defaultWidth: 90 }),
    colMeta({
      id: 'received',
      label: __('Received'),
      dataType: 'number',
      kind: 'editable',
      editable: true,
      copyable: true,
      pasteable: true,
      defaultWidth: 100,
    }),
    colMeta({
      id: 'damaged',
      label: __('Damaged'),
      dataType: 'number',
      kind: 'editable',
      editable: true,
      copyable: true,
      pasteable: true,
      defaultWidth: 100,
    }),
    // Against a supplier pricing in another currency, its own price comes first: that is the figure
    // on the invoice, and the base cost beside it is derived from it through the rate.
    ...(cross() && showsCosts()
      ? [
          colMeta({
            id: 'supplier_price',
            label: supplierPriceLabel(),
            dataType: 'decimal:money',
            kind: editsCost() ? 'editable' : 'read_only',
            editable: editsCost(),
            copyable: true,
            pasteable: editsCost(),
            defaultWidth: 130,
          }),
        ]
      : []),
    ...(showsCosts()
      ? [
          colMeta({
            id: 'unit_cost',
            label: unitCostLabel(),
            dataType: 'decimal:money',
            kind: editsBaseCost() ? 'editable' : 'read_only',
            editable: editsBaseCost(),
            copyable: true,
            pasteable: editsBaseCost(),
            defaultWidth: 130,
          }),
        ]
      : []),
  ]);

  const missingCost = (l: StandaloneLine): boolean =>
    'required' === costEntry() && l.received > 0 && null === l.unitCost;

  const ch = createColumnHelper<StandaloneLine>();
  const numberCell = (value: () => number, flagged?: () => boolean): JSX.Element => (
    <span
      class="block text-right tabular-nums"
      classList={{ 'text-red-600 font-semibold': flagged?.() ?? false }}
    >
      {value()}
    </span>
  );
  // A price inherited from the catalog (or derived through the rate) reads light; one stated
  // here reads bold — the same convention as the purchase-order draft and the supplier catalog.
  const priceClasses = (inherited: boolean, flagged: boolean): Record<string, boolean> => ({
    'block text-right tabular-nums': true,
    'text-red-600 font-semibold': flagged,
    'text-slate-400': !flagged && inherited,
    'font-semibold text-slate-800': !flagged && !inherited,
  });
  const bespokeColumns = new Map<string, ColumnDef<StandaloneLine, unknown>>([
    [
      'supplier_price',
      ch.accessor((r) => r.supplierPrice, {
        id: 'supplier_price',
        header: () => supplierPriceLabel(),
        cell: (info) => (
          <Show when={!isDraft(info.row.original)}>
            <span
              classList={priceClasses(
                info.row.original.supplierPriceInherited,
                missingCost(info.row.original) && null === info.row.original.supplierPrice,
              )}
            >
              {null === info.row.original.supplierPrice
                ? '—'
                : costText(info.row.original.supplierPrice)}
            </span>
          </Show>
        ),
      }) as ColumnDef<StandaloneLine, unknown>,
    ],
    [
      'product',
      ch.accessor((r) => r.name, {
        id: 'product',
        header: () => __('Product'),
        cell: (info) => (
          <Show
            when={!isDraft(info.row.original)}
            fallback={<span class="italic text-text-muted">{__('＊ Add a product ＊')}</span>}
          >
            <span
              class="font-medium"
              classList={{ 'text-red-600': ungoverned().includes(info.row.original.subjectId) }}
            >
              {info.row.original.name}
            </span>
          </Show>
        ),
      }) as ColumnDef<StandaloneLine, unknown>,
    ],
    [
      'sku',
      ch.accessor((r) => r.sku, {
        id: 'sku',
        header: () => __('SKU'),
        cell: (info) => (
          <Show when={!isDraft(info.row.original) && '' !== info.row.original.sku}>
            <span class="block font-mono text-slate-500">{info.row.original.sku}</span>
          </Show>
        ),
      }) as ColumnDef<StandaloneLine, unknown>,
    ],
    [
      'on_hand',
      ch.accessor((r) => r.onHand, {
        id: 'on_hand',
        header: () => __('On hand'),
        cell: (info) => (
          <Show when={!isDraft(info.row.original)}>
            <span class="block text-right tabular-nums text-text-muted">
              {info.row.original.onHand}
            </span>
          </Show>
        ),
      }) as ColumnDef<StandaloneLine, unknown>,
    ],
    [
      'received',
      ch.accessor((r) => r.received, {
        id: 'received',
        header: () => __('Received'),
        cell: (info) => (
          <Show when={!isDraft(info.row.original)}>
            {numberCell(() => info.row.original.received)}
          </Show>
        ),
      }) as ColumnDef<StandaloneLine, unknown>,
    ],
    [
      'damaged',
      ch.accessor((r) => r.damaged, {
        id: 'damaged',
        header: () => __('Damaged'),
        cell: (info) => (
          <Show when={!isDraft(info.row.original)}>
            {numberCell(() => info.row.original.damaged)}
          </Show>
        ),
      }) as ColumnDef<StandaloneLine, unknown>,
    ],
    [
      'unit_cost',
      ch.accessor((r) => r.unitCost, {
        id: 'unit_cost',
        header: () => unitCostLabel(),
        cell: (info) => (
          <Show when={!isDraft(info.row.original)}>
            <span
              classList={priceClasses(
                null === info.row.original.unitCost || info.row.original.unitCostInherited,
                missingCost(info.row.original) || costOffender() === info.row.original.subjectId,
              )}
            >
              {'none' === costEntry()
                ? costText(0)
                : null === info.row.original.unitCost
                  ? 'optional' === costEntry()
                    ? __('Standing value')
                    : '—'
                  : costText(info.row.original.unitCost)}
            </span>
          </Show>
        ),
      }) as ColumnDef<StandaloneLine, unknown>,
    ],
  ]);

  const [rowSelection, setRowSelection] = createSignal<RowSelectionState>({});
  const noSorting = (): SortingState => [];
  const [cellSelection, setCellSelection] = createSignal<SelectionState>(EMPTY_SELECTION);

  const getValue = (row: StandaloneLine, columnId: string): unknown => {
    if (isDraft(row)) return undefined;
    switch (columnId) {
      case 'product':
        return row.name;
      case 'sku':
        return row.sku;
      case 'on_hand':
        return row.onHand;
      case 'received':
        return row.received;
      case 'damaged':
        return row.damaged;
      case 'unit_cost':
        return row.unitCost;
      case 'supplier_price':
        return row.supplierPrice;
      default:
        return undefined;
    }
  };
  // Immediate-commit: nothing is staged client-side, the line is saved as soon as a cell commits.
  const getStagedValue = (): StagedCell => ({ staged: false, value: undefined });
  const editableColumn = (columnId: string): boolean =>
    'received' === columnId ||
    'damaged' === columnId ||
    ('unit_cost' === columnId && editsBaseCost()) ||
    ('supplier_price' === columnId && editsCost() && cross());
  const canEdit = (row: StandaloneLine, meta: GridColumnMeta): boolean =>
    isDraft(row) ? 'product' === meta.id : editableColumn(meta.id);
  const resolveClearedValue = (
    _row: StandaloneLine,
    meta: GridColumnMeta,
  ): { ok: boolean; value: unknown } =>
    editableColumn(meta.id) ? { ok: true, value: null } : { ok: false, value: null };
  const resolveEditorMeta = (meta: GridColumnMeta, row: StandaloneLine): GridColumnMeta =>
    isDraft(row) && 'product' === meta.id
      ? {
          ...meta,
          editorConfig: matchesCatalogHere()
            ? {
                addOptions: () => catalogOptions(false),
                taken: () => catalogOptions(true),
                takenMessage: takenMessage(),
                onNeeded: () => setCatalogWanted(true),
                loading: () => catalog.isPending,
                portalRoot,
                supplierLabel: view()?.supplier?.name ?? '',
              }
            : { search: productSearch, portalRoot, takenMessage: takenMessage() },
        }
      : meta;

  const wholeUnits = (next: unknown): number => {
    const n = null === next || undefined === next || '' === next ? 0 : Number(next);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };

  // Damaged is a subset of received: lowering received pulls damaged down with it, and damaged can
  // never be entered above what arrived.
  const applyEdit = (
    row: StandaloneLine,
    columnId: string,
    next: unknown,
  ): Partial<StandaloneLine> | null => {
    if ('received' === columnId) {
      const received = wholeUnits(next);
      return { received, damaged: Math.min(row.damaged, received) };
    }
    if ('damaged' === columnId) return { damaged: Math.min(wholeUnits(next), row.received) };
    // A cleared price goes back to inheriting; the server's answer fills the inherited figure in.
    const price = (): string | null => {
      const blank = null === next || undefined === next || '' === next;
      const n = Number(next);
      return blank || !Number.isFinite(n) || n < 0 ? null : String(next);
    };
    if ('unit_cost' === columnId) {
      const unitCost = price();
      return { unitCost, unitCostInherited: false };
    }
    if ('supplier_price' === columnId) {
      const supplierPrice = price();
      const rate = Number(view()?.costFxRate ?? NaN);
      return {
        supplierPrice,
        supplierPriceInherited: false,
        // Derived at once so the base cost follows the edit before the server answers.
        unitCost:
          null !== supplierPrice && Number.isFinite(rate)
            ? (Number(supplierPrice) * rate).toFixed(4)
            : null,
      };
    }
    return null;
  };

  const onStageEdit = (
    row: StandaloneLine,
    columnId: string,
    _original: unknown,
    next: unknown,
  ): void => {
    if (isDraft(row) && 'product' === columnId) {
      const opt = next as SearchSelectOption | null;
      if (null !== opt) addProduct(Number(opt.value));
      return;
    }
    const patch = applyEdit(row, columnId, next);
    if (null !== patch) patchLine(row.subjectId, patch);
  };
  const onCommitNavigate = (row: StandaloneLine, columnId: string): boolean =>
    isDraft(row) && 'product' === columnId;
  const onClearCells = (cells: Array<{ row: StandaloneLine; columnId: string }>): void => {
    // One save for the whole gesture, however many cells it covers.
    const patches = new Map<number, Partial<StandaloneLine>>();
    for (const { row, columnId } of cells) {
      if (isDraft(row) || !editableColumn(columnId)) continue;
      const current = { ...row, ...(patches.get(row.subjectId) ?? {}) };
      const patch = applyEdit(current, columnId, null);
      if (null !== patch)
        patches.set(row.subjectId, { ...(patches.get(row.subjectId) ?? {}), ...patch });
    }
    if (0 === patches.size) return;
    setLines((ls) => ls.map((l) => ({ ...l, ...(patches.get(l.subjectId) ?? {}) })));
    for (const subjectId of patches.keys()) saveLine(subjectId);
  };

  const contextMenuExtras = (): DataGridMenuItem[] => {
    const ids = [
      ...new Set(
        (gridApi?.getSelectedCells() ?? [])
          .filter((c) => !isDraft(c.row))
          .map((c) => c.row.subjectId),
      ),
    ];
    return 0 === ids.length
      ? []
      : [
          {
            id: 'remove-lines',
            label: sprintf(__('Remove %d line(s)'), ids.length),
            run: () => removeLines(ids),
          },
        ];
  };

  // The append row's only useful cell is its product: bounce a selection landing elsewhere on it.
  createEffect(() => {
    const active = cellSelection().active;
    if (null === active || active.row !== lines().length) return;
    const productCol = (gridApi?.getSelectableColumnIds() ?? []).indexOf('product');
    if (productCol >= 0 && active.col !== productCol)
      gridApi?.focusCellById(String(DRAFT_SUBJECT_ID), 'product', false);
  });

  // A count opened empty starts on its product cell; one handed over with rows starts on the first
  // figure to check. Run once, when the grid hands over its API — it mounts only once the count has
  // loaded, so the rows are there by then.
  let focused = false;
  const focusInitial = (): void => {
    if (focused || undefined === gridApi) return;
    focused = true;
    const first = lines()[0];
    queueMicrotask(() => {
      if (undefined === first) {
        gridApi?.focusCellById(String(DRAFT_SUBJECT_ID), 'product', false);
        return;
      }
      const col = firstEditableColumnId(
        first,
        columnMetas(),
        canEdit,
        gridApi?.getSelectableColumnIds() ?? [],
      );
      if (undefined !== col) gridApi?.focusCellById(String(first.subjectId), col, false);
    });
  };

  // ── Posting and discarding ─────────────────────────────────────────────────────────────────────
  const counted = (): StandaloneLine[] => lines().filter((l) => l.received > 0);
  const missing = (): StandaloneLine[] => counted().filter(missingCost);
  const canPost = (): boolean =>
    counted().length > 0 && 0 === missing().length && !saving() && !record.isPending;

  /** One intent to post, kept across retries of that press and dropped once it lands. */
  let postKey: string | null = null;

  const record = createMutation(() => ({
    mutationFn: async () => {
      // The receipt is written from what the server holds, so the last edit must be there first.
      saveNote();
      await chain;
      postKey ??= mintReceiptKey();
      return api.post<RecordedReceipt>(`/receiving/sessions/${props.id}/receipts`, {
        idempotencyKey: postKey,
      });
    },
    onSuccess: (data) => {
      postKey = null;
      void queryClient.invalidateQueries({ queryKey: STOCK_MOVED });
      void queryClient.invalidateQueries({ queryKey: ['receiving', 'sessions'] });
      toast.success(
        sprintf(
          /* translators: %d is the number of product lines recorded. */
          __('Receipt recorded — %d line(s) into stock.'),
          data.receipt.lineCount,
        ),
      );
      navigate('/receiving');
    },
    onError: (e: unknown) => {
      const body = errorBody(e);
      if ('invflux_receiving_session_gone' === body.code) {
        toast.error(errorMessage(e));
        navigate('/receiving');
        return;
      }
      setError(errorMessage(e));
      setUngoverned(
        Array.isArray(body.subjectIds)
          ? body.subjectIds.filter((v): v is number => 'number' === typeof v)
          : [],
      );
      setCostOffender('number' === typeof body.subjectId ? body.subjectId : null);
    },
  }));

  const [confirmingDiscard, setConfirmingDiscard] = createSignal(false);
  const discard = createMutation(() => ({
    mutationFn: () => api.del(`/receiving/sessions/${props.id}`),
    onSettled: () => {
      setConfirmingDiscard(false);
      void queryClient.invalidateQueries({ queryKey: ['receiving', 'sessions'] });
      navigate('/receiving/new/manual');
    },
  }));

  return (
    <section>
      <header class="mb-3">
        <ReceivingCrumbs
          trail={[
            { label: __('Start a reception'), href: '/receiving/new' },
            { label: __('No document'), href: '/receiving/new/manual' },
            {
              label: sprintf(
                /* translators: %d is a receiving session's internal id. */
                __('Standalone session #%d'),
                props.id,
              ),
            },
          ]}
        />
      </header>

      <Show when={session.isError}>
        <ErrorBanner class="max-w-2xl text-sm">{errorMessage(session.error)}</ErrorBanner>
      </Show>

      <Show when={view()}>
        {(v) => (
          <>
            <div class="mb-3 max-w-3xl">
              <p class="text-sm">
                <span class="font-medium text-slate-600">{__('Reason')}: </span>
                <span data-testid="standalone-reason">{v().reasonLabel}</span>
              </p>
              <p class="mt-0.5 text-xs text-text-muted">{v().reasonHint}</p>
              <Show when={PURCHASE_WITHOUT_ORDER === v().reason}>
                <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  <label class="flex items-center gap-2">
                    <span class="font-medium text-slate-600">{__('Supplier')}:</span>
                    <Select
                      data-testid="standalone-supplier"
                      class="w-64"
                      value={null === v().supplier ? '' : String(v().supplier?.id)}
                      onChange={(e) =>
                        saveHeader({
                          supplierId:
                            '' === e.currentTarget.value ? null : Number(e.currentTarget.value),
                        })
                      }
                    >
                      <option value="">{__('Not recorded')}</option>
                      <For each={context.data?.suppliers ?? []}>
                        {(sup) => <option value={String(sup.id)}>{sup.name}</option>}
                      </For>
                    </Select>
                  </label>
                  <Show when={null !== v().supplier}>
                    <label class="flex items-center gap-1.5 text-xs text-text-muted">
                      <input
                        type="checkbox"
                        data-testid="standalone-catalog-only"
                        checked={catalogOnly()}
                        onChange={(e) => setCatalogOnly(e.currentTarget.checked)}
                      />
                      {__('Only this supplier’s products')}
                    </label>
                  </Show>
                  <Show when={v().crossCurrency && v().showsCosts}>
                    <label class="flex items-center gap-1.5">
                      <span class="text-slate-600">
                        {sprintf(
                          /* translators: %1$s is the supplier's currency code. The rate field and the store's currency code follow this text: "Unit costs converted at 1 USD = [0.92] EUR". */
                          __('Unit costs converted at 1 %1$s ='),
                          v().supplier?.currency ?? '',
                        )}
                      </span>
                      <Input
                        data-testid="standalone-fx-rate"
                        class="w-24 text-right"
                        inputmode="decimal"
                        disabled={!editsCost()}
                        invalid={null === v().costFxRate && v().lines.some((l) => l.received > 0)}
                        value={rateShown()}
                        onInput={(e) => setRateDraft(e.currentTarget.value)}
                        onBlur={() => saveRate()}
                      />
                      <span class="text-slate-600">{v().baseCurrency}</span>
                    </label>
                  </Show>
                </div>
              </Show>
              <Show when={others().length > 0}>
                <p class="mt-1 text-xs text-amber-700">
                  {sprintf(
                    /* translators: %s is a comma-separated list of people's names. */
                    __('Also counting: %s'),
                    others().join(', '),
                  )}
                </p>
              </Show>
            </div>

            <ViewportFilled gutter="7.5rem" class="flex flex-col">
              <DataGrid<StandaloneLine>
                rows={gridRows}
                getRowId={(l) => String(l.subjectId)}
                rowAttrs={(l) => (isDraft(l) ? { class: 'bg-primary/5' } : {})}
                columnMetas={columnMetas}
                getValue={getValue}
                bespokeColumns={bespokeColumns}
                canEdit={canEdit}
                getStagedValue={getStagedValue}
                resolveClearedValue={resolveClearedValue}
                resolveEditorMeta={resolveEditorMeta}
                apiRef={(grid) => {
                  gridApi = grid;
                  focusInitial();
                }}
                contextMenuExtras={contextMenuExtras}
                onStageEdit={onStageEdit}
                onCommitNavigate={onCommitNavigate}
                onClearCells={onClearCells}
                // Lines stay in the order they were counted: no column sorts.
                sorting={noSorting}
                onSortingChange={() => undefined}
                scope="receiving-standalone"
                defaultColumnOrder={COLUMN_ORDER}
                defaultExpandedSections={[GRID_GROUP]}
                rowSelection={rowSelection}
                setRowSelection={(updater) => setRowSelection(updater)}
                cellSelection={cellSelection}
                setCellSelection={(updater) => setCellSelection(updater)}
              />
            </ViewportFilled>

            <Show when={'' !== error()}>
              <ErrorBanner class="mt-4 max-w-2xl text-sm">{error()}</ErrorBanner>
            </Show>

            {/* The note and the actions share a row; on a narrow screen the actions wrap below it. */}
            <div class="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
              <label class="block min-w-64 max-w-2xl flex-1 text-sm font-medium text-slate-600">
                {__('Note (optional)')}
                <Textarea
                  class="mt-1 w-full"
                  autoGrowMaxLines={6}
                  placeholder={__(
                    'e.g. who delivered it, where it was found, what the packing slip said…',
                  )}
                  value={note()}
                  onInput={(e) => setNote(e.currentTarget.value)}
                  onBlur={() => saveNote()}
                />
              </label>

              <div class="ml-auto flex flex-wrap items-center justify-end gap-3">
                <span class="text-xs text-text-muted" aria-live="polite">
                  {saving() ? __('Saving…') : __('Saved')}
                </span>
                <Show when={missing().length > 0}>
                  <span class="text-xs text-amber-600">
                    {__('This reason needs a unit cost on every line.')}
                  </span>
                </Show>
                <Button variant="secondary" onClick={() => setConfirmingDiscard(true)}>
                  {__('Discard this session')}
                </Button>
                <Button
                  data-testid="standalone-record"
                  disabled={!canPost()}
                  onClick={() => record.mutate()}
                >
                  {__('Record receipt')}
                </Button>
              </div>
            </div>
          </>
        )}
      </Show>

      <Show when={confirmingDiscard()}>
        <ConfirmModal
          title={__('Discard this session?')}
          message={
            <p>
              {__(
                'Everything entered here is deleted, and nothing is added to stock. This cannot be undone.',
              )}
            </p>
          }
          confirmLabel={__('Discard this session')}
          variant="danger"
          onConfirm={() => discard.mutate()}
          onCancel={() => setConfirmingDiscard(false)}
        />
      </Show>
    </section>
  );
}

/**
 * A box that fills from where it sits down to the viewport bottom, less `gutter` — room for the note
 * and the buttons below the grid.
 *
 * Its own component because `createViewportFill` measures on mount: the grid renders only once the
 * count has loaded, so measured from the page it would read an element that did not exist yet.
 */
function ViewportFilled(props: {
  gutter: string;
  class?: string;
  children: JSX.Element;
}): JSX.Element {
  let el: HTMLDivElement | undefined;
  const height = createViewportFill(() => el);

  return (
    <div
      ref={(node) => (el = node)}
      class={props.class}
      style={{ height: `calc(${height()} - ${props.gutter})`, 'min-height': '16rem' }}
    >
      {props.children}
    </div>
  );
}

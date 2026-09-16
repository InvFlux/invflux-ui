import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { __, _n, _x, formatDate, formatNumber, sprintf } from '@invflux/i18n';
import { A, useLocation, useNavigate, useSearchParams } from '@solidjs/router';
import { createVirtualizer, type VirtualItem } from '@tanstack/solid-virtual';
import {
  ErrorBanner,
  Button,
  ColumnPicker,
  FILTER_CONTROL_MULTISELECT,
  FILTER_CONTROL_MULTISELECT_ASYNC,
  FILTER_CONTROL_NUMERIC_IDS,
  FilterBar,
  FilterModeToggle,
  StockConcernBadge,
  slotRegistry,
  type ComboboxOption,
  type FilterDescriptor,
  isTypingTarget,
  Pill,
  ColumnsSettingsIcon,
  RefreshIcon,
  SavedFilterControl,
} from '@invflux/ui';
import type { FilterConstraint } from '@invflux/ui';
import { describeConstraint } from '@invflux/ui';
import { createViewportFill } from '@invflux/ui';
import { formatWallClock } from '@invflux/ui';
import type { SavedFilterQuery } from '@invflux/ui/api';
import { toast } from '@invflux/ui/toast';
import { Dynamic } from 'solid-js/web';
import { useDispatch } from '../context';
import { useReplicatedQueue } from '../useWorkingSet';
import { remainingProgress } from '../lineProgress';
import {
  countFacet,
  type FacetCombination,
  matchesLocalFilters,
  needsServerMode,
  pendingActionsOf,
} from '../workingSet';
import { publishQueueSortEntitlements, sortQueue } from '../queueSort';
import { useListStore } from '../listStore';
import {
  BulkTagAssign,
  FILTER_CONTROL_TAGS,
  NoteModal,
  RowContextMenu,
  TagPillRow,
  TagManagerModal,
  tagNeedsNote,
} from '../components/OrderTags';
import { OrderNotesCell } from '../components/OrderNotesCell';
import { PendingActionChips } from '../components/PendingActionChips';
import {
  loadColumnOrder,
  defaultHiddenColumns,
  loadHiddenColumns,
  moveColumn,
  orderColumns,
  QUEUE_COLUMNS,
  type QueueColumn,
  type QueueColumnId,
  saveColumnOrder,
  saveHiddenColumns,
} from '../components/queueColumns';
import { parsePerPage } from '../components/DispatchSettings';
import { OrderStatusChip, STATUS_LABEL } from '../components/OrderStatusChip';
import {
  nativeStatusExplanation,
  nativeStatusLabel as nativeStatusName,
  shippedNativeStatusColor,
} from '../nativeStatus';
import {
  useBulkAssignTagsMutation,
  useDispatchOrdersQuery,
  useSavedFilterMutation,
  useDispatchFacetsQuery,
  useSavedFiltersQuery,
  useSkuSearchLoader,
  useTagsQuery,
  useWorksheetFilterOptionsQuery,
} from '../queries';
import type {
  DispatchOrderSummary,
  DispatchQueueFilters,
  DispatchToolbarSlotProps,
  OrderStatus,
  OrderWorkflowState,
  TagSummary,
} from '../types';

// STATUS_LABEL + the OrderStatusChip live in a shared component (also used by the
// order-detail header). STATUS_LABEL is still needed here for the filter chip summary.

const fmt = (n: number) => formatNumber(n);

/** Server-search debounce: 200ms after last keystroke per F21 UX revision. */
const SEARCH_DEBOUNCE_MS = 200;

/** The dispatch statuses as filter options, worded by `STATUS_LABEL` so the chip and the filter agree. */
const STATUS_OPTIONS = (): ComboboxOption[] =>
  (Object.keys(STATUS_LABEL) as OrderStatus[]).map((value) => ({
    value,
    label: STATUS_LABEL[value](),
  }));

/**
 * Render a short relative-age label (`5m` / `3h` / `2d`) from an ISO
 * datetime. Caps at days — merchants don't reason in weeks/months for
 * dispatch readiness, and "37d" carries the right "very old" signal.
 *
 * Returns `'—'` for null / invalid input so the column never renders an
 * empty cell that's ambiguous with a fresh order.
 */
function relativeAge(iso: string | null): string {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '—';
  const seconds = Math.max(0, (Date.now() - ts) / 1000);
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/**
 * Sentinel value used as a URL filter value to mean **"explicit no
 * filter override"** — distinct from the param being absent (which
 * lets the chip's default apply). Solid Router's `mergeSearchString`
 * collapses `''` and `null` into "delete the param", so we can't use
 * an empty string for this purpose: the user's click to uncheck the
 * last value would silently re-apply the default. The sentinel
 * survives the round-trip.
 *
 * Picked underscore for compactness + URL safety; never a valid
 * status / workflow / WC-status code.
 */
const NO_FILTER_SENTINEL = '_';

/**
 * The `pending_action` token meaning "any kind of waiting work this install registers".
 *
 * **Not {@link NO_FILTER_SENTINEL}, and the difference is the direction.** An absent
 * `pending_action` already means no constraint, so a widening token would say nothing; this one
 * *narrows*, to the orders waiting on a person. It is what the multiselect writes once every option
 * is ticked, so a saved view records the capability rather than today's list — an add-on that
 * contributes "receipts to book" joins such a view, where `manual_refund,corrections` would keep
 * answering the older question under a name that promised otherwise.
 *
 * The adapter resolves it against its live registry per request
 * (`DispatchQueueQuery::ANY_PENDING_ACTION`); this constant is the same string on the client side.
 */
const ANY_PENDING_ACTION = '_any';

function parseStatusList(raw: string | undefined): OrderStatus[] | undefined {
  if (raw === undefined) return undefined;
  if (raw === '' || raw === NO_FILTER_SENTINEL) return [];
  const known = new Set<OrderStatus>(['Untouched', 'Started', 'Staged', 'Shipped', 'Cancelled']);
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is OrderStatus => known.has(s as OrderStatus));
}

/**
 * Parse the URL's `workflow_state` token against the states this install
 * declares (`ctx.workflowState.options`) rather than a list held here — an
 * add-on's state is as real as the adapter's, and the SPA has no basis for
 * ranking them.
 *
 * Unrecognised values are dropped rather than passed through, which keeps a
 * stale link from rendering a checkbox for a state the install cannot answer
 * for. Dropping every value leaves `[]`, i.e. no filter — matching the backend,
 * which falls back to its default instead of widening to everything.
 */
function parseWorkflowList(
  raw: string | undefined,
  known: Set<string>,
): OrderWorkflowState[] | undefined {
  if (raw === undefined) return undefined;
  if (raw === '' || raw === NO_FILTER_SENTINEL) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => known.has(s));
}

function parseNativeStatusList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  if (raw === '' || raw === NO_FILTER_SENTINEL) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Parse a generic comma-separated multi-value URL filter — same contract as the others. */
function parseGenericList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  if (raw === '' || raw === NO_FILTER_SENTINEL) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function OrderList() {
  const ctx = useDispatch();
  const navigate = useNavigate();

  const [searchParams, setSearchParams] = useSearchParams<{
    status?: string;
    workflow_state?: string;
    wc_status?: string;
    worksheet_id?: string;
    sku?: string;
    subject_ids?: string;
    payment_method?: string;
    shipping_class?: string;
    shipping_method?: string;
    tag_id?: string;
    tag_match?: string;
    tag_id_not?: string;
    has_tags?: string;
    has_notes?: string;
    pending_action?: string;
    search?: string;
    per_page?: string;
  }>();

  const [searchDraft, setSearchDraft] = createSignal(searchParams.search ?? '');

  /**
   * Every URL parameter that is part of *what the queue is showing*, and none that is part of how
   * it is shown.
   *
   * A saved view records the first and not the second: `per_page` is a reading preference that
   * belongs to whoever is reading, and baking one operator's choice into shared chrome would
   * re-paginate the queue for everyone who applied it. Search is genuinely filter state — a view
   * of one customer's orders is a legitimate thing to keep.
   *
   * This list is also the erase-set when a saved view is applied: anything named here is cleared
   * first, so applying a view lands on exactly what it stored rather than on it merged with
   * whatever the reader happened to have set.
   */
  const FILTER_PARAM_KEYS = [
    'status',
    'workflow_state',
    'wc_status',
    'worksheet_id',
    'sku',
    'subject_ids',
    'payment_method',
    'shipping_class',
    'shipping_method',
    'tag_id',
    'tag_match',
    'pending_action',
    'search',
  ] as const;

  /** The live filter state as a parameter map — the half of a saved view the URL already carries. */
  const currentQuery = (): SavedFilterQuery => {
    const out: SavedFilterQuery = {};
    for (const key of FILTER_PARAM_KEYS) {
      const value = searchParams[key];
      if (value !== undefined && value !== '') out[key] = value;
    }

    return out;
  };

  /** Replace the queue's filter state with a saved view's, clearing what it does not mention. */
  const applySavedQuery = (query: SavedFilterQuery): void => {
    const patch: Record<string, string | undefined> = {};
    for (const key of FILTER_PARAM_KEYS) patch[key] = undefined;
    for (const [key, value] of Object.entries(query)) {
      // The queue's parameters are all scalars; a list would be an add-on's shape, and joining it
      // is closer to right than dropping it.
      patch[key] = Array.isArray(value) ? value.join(',') : value;
    }
    setSearchParams(patch);
    setSearchDraft(typeof query.search === 'string' ? query.search : '');
  };

  /**
   * Turn a pinned view's own parameters on or off, leaving every other filter alone.
   *
   * A pinned view stands where an ad-hoc toggle button used to, so it behaves like one — and a
   * toggle that reset the whole queue would take a search the operator had already typed down with
   * it. Turning one off returns each of its parameters to *absent*, which for a filter with a
   * default (`workflow_state`) means back to that default rather than to no filter at all.
   */
  const toggleSavedQuery = (query: SavedFilterQuery, on: boolean): void => {
    const patch: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(query)) {
      patch[key] = on ? (Array.isArray(value) ? value.join(',') : value) : undefined;
    }
    setSearchParams(patch);
    if ('search' in query)
      setSearchDraft(on && typeof query.search === 'string' ? query.search : '');
  };

  // Keyboard-driven row focus. -1 means "no row focused" — the user
  // hasn't started navigating yet, so we don't paint anything
  // highlighted. Once they hit ArrowDown (or '/'-then-anything) the
  // index jumps to 0 and stays under their control until they Escape.
  const [focusedIndex, setFocusedIndex] = createSignal(-1);
  // Right-click row menu (tag-assign surface). The assign mutation + tag manager
  // are owned here (not in the menu) so they outlive the menu closing.
  const [rowMenu, setRowMenu] = createSignal<{
    order: DispatchOrderSummary;
    x: number;
    y: number;
  } | null>(null);
  // A tag needing a note (governance RequireNoteOnAdd) opens this modal before assigning.
  const [tagNote, setTagNote] = createSignal<{ tag: TagSummary; orderIds: string[] } | null>(null);
  /**
   * Assign a tag and show it at once, in three stages of increasing authority.
   *
   * 1. **Now** — splice the tag into the rows this client holds, before the request leaves. The
   *    operator sees the chip on the click, which is the whole complaint: from the floor, a tag
   *    added from the queue looked like it had done nothing until the poll interval came round.
   * 2. **On the server's answer** — a failure puts back exactly what stage 1 changed and nothing
   *    else. Success has nothing to add: the bulk route answers with counts, not the resulting
   *    rows, so there is no authoritative list to swap in here. (If it ever returns per-order
   *    tags, this is where they would land.)
   * 3. **On the next delta** — `pollNow()`, which the working set now runs whenever the queue's
   *    key is invalidated. This is the only stage that can settle what the client cannot derive:
   *    workflow state above all, since a suppressing tag has to take the order out of the view
   *    entirely, and no amount of local splicing would ever discover that.
   *
   * Rollback is scoped to the rows that actually GAINED the tag. Re-tagging an order that already
   * carried it is a no-op, and a failure must not then strip a tag this action never added.
   */
  const assignTagOptimistically = (tag: TagSummary, orderIds: string[], note?: string): void => {
    const held = workingSet.orders();
    const gained = orderIds.filter(
      (id) => !(held.get(id)?.tags ?? []).some((t) => t.id === tag.id),
    );
    workingSet.patch(gained, (o) => ({ ...o, tags: [...(o.tags ?? []), tag] }));

    assignTags.mutate(
      { orderIds, tagIds: [tag.id], note },
      {
        // Stage 2: the server's own answer replaces the guess, per order. It can differ — a tag
        // already present, or another lane's change landing between the click and the write.
        onSuccess: (result) => {
          for (const [hexId, tags] of Object.entries(result.assigned)) {
            workingSet.patch([hexId], (o) => ({ ...o, tags }));
          }
        },
        onError: () =>
          workingSet.patch(gained, (o) => ({
            ...o,
            tags: (o.tags ?? []).filter((t) => t.id !== tag.id),
          })),
      },
    );
  };

  const assignTagWithNoteCheck = (tag: TagSummary, orderIds: string[]): void => {
    if (tagNeedsNote(tag, ctx.entitlements.governanceTags)) {
      setTagNote({ tag, orderIds });
      return;
    }
    assignTagOptimistically(tag, orderIds);
  };
  const [tagManagerOpen, setTagManagerOpen] = createSignal(false);
  // Which columns this operator has put away. Per-browser (localStorage), like the DataGrid's own
  // display settings — see queueColumns.ts for why it is not store policy.
  const [hiddenColumns, setHiddenColumns] = createSignal<QueueColumnId[]>(loadHiddenColumns());
  const [columnPickerOpen, setColumnPickerOpen] = createSignal(false);
  const toggleColumn = (id: QueueColumnId): void => {
    setHiddenColumns((prev) => {
      const next = prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id];
      saveHiddenColumns(next);
      return next;
    });
  };
  const columnVisible = (id: QueueColumnId): boolean => !hiddenColumns().includes(id);
  /**
   * The operator's column order, held as a **complete** list of ids.
   *
   * `orderColumns` resolves the stored (possibly partial, possibly stale) list against the shipped
   * defaults once, here — so everything downstream, the picker included, works on a sequence that
   * is known to name every column exactly once, and a reorder is a plain array move.
   */
  const [columnOrder, setColumnOrder] = createSignal<QueueColumnId[]>(
    orderColumns(loadColumnOrder()).map((c) => c.id),
  );
  const orderedColumns = createMemo<QueueColumn[]>(() => orderColumns(columnOrder()));
  const reorderColumn = (sourceId: QueueColumnId, targetId: QueueColumnId): void => {
    const next = moveColumn(columnOrder(), sourceId, targetId);
    setColumnOrder(next);
    saveColumnOrder(next);
  };
  /** Both choices back to shipped defaults — the picker offers one reset because an operator who
   *  wants the queue back does not distinguish "which columns" from "in what order". */
  const resetColumns = (): void => {
    const defaults = QUEUE_COLUMNS.map((c) => c.id);
    // Back to the shipped defaults, which include the columns that start hidden.
    const hiddenByDefault = defaultHiddenColumns();
    setHiddenColumns(hiddenByDefault);
    saveHiddenColumns(hiddenByDefault);
    setColumnOrder(defaults);
    saveColumnOrder(defaults);
  };
  // The surface's title and settings are the shell's to render: it names the surface in its tab
  // strip and carries the contextual gear, whose panel this SPA registers once in its router root
  const toolbarSlots = (): ReturnType<typeof slotRegistry.get<DispatchToolbarSlotProps>> =>
    slotRegistry.get<DispatchToolbarSlotProps>('dispatch.toolbar');
  const assignTags = useBulkAssignTagsMutation();
  let searchInputEl: HTMLInputElement | undefined;
  /** The toolbar row, so the filter bar's Tab ring spans the search box and the chips together. */
  let toolbarEl: HTMLDivElement | undefined;
  let filterGroupEl: HTMLDivElement | undefined;
  /**
   * How many lines the filter group occupies (1, 2, or 3+) — the budget the right-hand group is
   * allowed to spend. One line keeps the readout beside the buttons; two puts the readout on its
   * own line above them; three lets the buttons stack as well. The right group never adds height
   * the toolbar was not already going to have.
   *
   * **The flip back is latched to the toolbar's width, and that is the whole design.** Stacking
   * narrows this group, which frees space, which can un-wrap the filters, which would un-stack and
   * re-wrap them: at one unlucky window size that is a permanent flicker, and a
   * `ResizeObserver loop completed with undelivered notifications` in the console. Recording the
   * width at which we stacked, and refusing to un-stack until the toolbar is genuinely wider than
   * that, breaks it — at a fixed window size the condition can never come true, so the layout
   * settles after one transition. The cost is that in the ambiguous band it stays stacked when it
   * would just fit unstacked, which is invisible; an oscillation is not.
   */
  const [filterLines, setFilterLines] = createSignal(1);
  // Row element refs by index so keyboard nav can scroll the focused
  // row into view. Cleared / rebuilt on every render via the row's ref
  // callback.
  const rowEls = new Map<number, HTMLTableRowElement>();

  /**
   * States this install offers, as advertised by the adapter — never a list held here. Typed from
   * the context rather than as `ComboboxOption[]`: the options carry `includesSuppressed`, which
   * the chip ignores and {@link workflowWideningFor} needs.
   */
  const workflowOptions = createMemo(() => ctx.workflowState.options);
  const knownWorkflowValues = createMemo(() => new Set(workflowOptions().map((o) => o.value)));

  /**
   * Which deliberate filters make the `Active` default *yield* rather than narrow.
   *
   * Only the ones whose meaning spans closure — today, waiting work: a refund settled by a
   * whole-order cancel sits on a closed order, so "refunds owed" under the open-orders floor is a
   * different and misleading number.
   *
   * This was briefly every filter, on the reasoning that the queue sort ranks closed orders last so
   * widening costs nothing. Replication changed the arithmetic: the client holds the *open* set, so
   * widening now means leaving it and paying for a server query. A SKU search wanting live work
   * first was never asking to see three years of history, and now it does not silently buy it.
   */
  const widensPastClosure = (): boolean => pendingActions().length > 0;

  /**
   * The kinds of waiting work currently filtered to, as wire values.
   *
   * Unrecognised values are kept rather than dropped: which actions exist is an install-level
   * question, the server resolves them against what it registered, and a value dropped here would
   * *widen* the union — a work queue silently showing more than was asked for is the failure mode
   * that matters, since a longer backlog looks like a busy day.
   *
   * {@link ANY_PENDING_ACTION} expands to whatever this install advertises, so every consumer here
   * — the chip's summary, the dropdown's ticks, the local predicate — sees a plain list and none of
   * them has to know the token exists. The *URL* keeps the token; only this reading widens it.
   */
  const pendingActions = (): string[] => {
    const raw = searchParams.pending_action;
    if (raw !== undefined && raw.split(',').some((v) => v.trim() === ANY_PENDING_ACTION)) {
      return ctx.pendingAction.options.map((o) => o.value);
    }

    return parseGenericList(raw) ?? [];
  };

  const pendingActionLabel = (value: string): string =>
    ctx.pendingAction.options.find((o) => o.value === value)?.label ?? value;

  const filters = createMemo<DispatchQueueFilters>(() => ({
    status: parseStatusList(searchParams.status),
    // The `Active` default yields to *any* deliberate filter, rather than narrowing it.
    //
    // Nobody chose `Active` — it is what the queue shows when asked nothing — so a real question
    // replaces it instead of intersecting with it (the default-vs-deliberate contract read across
    // filters rather than within one). An operator who set `workflow_state` themselves has made
    // a choice, and a choice is never overridden.
    //
    // What makes this safe rather than overwhelming is the queue's **sort**, not a narrower rule:
    // closed orders always rank last, so a SKU filter answers with live work first and history
    // below it. Excluding them would answer "should this row exist" when the question was "how
    // urgent is it" — and for some filters the exclusion is a lie outright, since a refund settled
    // by a whole-order cancel sits on a *Closed* order.
    //
    // Rendered, not merely applied — the workflow chip shows the widened cut, so this is a
    workflowState:
      parseWorkflowList(searchParams.workflow_state, knownWorkflowValues()) ??
      (widensPastClosure() ? [] : undefined),
    // Bake the adapter-provided default in at parse time so the server
    // receives the same filter the user sees. URL absent → default
    // applies. URL present-but-empty → no filter (explicit override).
    wcStatus: parseNativeStatusList(searchParams.wc_status) ?? ctx.nativeStatus.defaultSelected,
    worksheetIds: parseGenericList(searchParams.worksheet_id),
    skus: parseGenericList(searchParams.sku),
    // Domain-key filter set by the workbench "Orders" link (dash-joined to keep the URL free of
    // encoded commas). Normalise dashes to the shared comma parser; the server accepts both.
    subjectIds: parseGenericList(searchParams.subject_ids?.replace(/-/g, ',')),
    paymentMethods: parseGenericList(searchParams.payment_method),
    shippingClasses: parseGenericList(searchParams.shipping_class),
    shippingMethods: parseGenericList(searchParams.shipping_method),
    tagIds: parseGenericList(searchParams.tag_id),
    tagMatch: searchParams.tag_match === 'all' ? 'all' : undefined,
    tagIdsNot: parseGenericList(searchParams.tag_id_not),
    hasTags: parseGenericList(searchParams.has_tags),
    hasNotes: parseGenericList(searchParams.has_notes),
    pendingActions: pendingActions(),
    search: searchParams.search?.trim() || undefined,
    perPage: parsePerPage(searchParams.per_page),
  }));

  // Worksheet options preload (small + stable enough to fetch once per session).
  const worksheetOptionsQuery = useWorksheetFilterOptionsQuery();
  const tagsQuery = useTagsQuery();
  const skuLoader = useSkuSearchLoader();

  // Live label cache keyed by SKU code so the chip summary keeps the
  // SKU code visible after a navigation away and back. Builds up as
  // the operator picks options from the async dropdown.
  const [skuLabelCache, setSkuLabelCache] = createSignal<Map<string, string>>(new Map());

  /**
   * Whether this view asks something the replicated set cannot answer.
   *
   * SKU, Products and Worksheet are predicates over an order's *lines*, and the queue row carries
   * none — so those three, and only those, fall back to the paged server query.
   */
  const serverMode = createMemo(() => needsServerMode(searchParams));

  /**
   * Every un-closed order, replicated once and kept current by a time-only poll.
   *
   * Owned above the router, so leaving for an order and coming back is a render rather than a
   */
  const workingSet = useReplicatedQueue();

  /*
    Watching is what keeps the set's poll running while the queue is on screen, and what makes
    re-entering it ask what changed, and nothing more. The rows are already on screen — the operator
    may have been reading an order for a minute, so the queue behind it can have moved, but a set
    that is one delta out of date is not a set worth rebuilding. This is the difference between
    "catch up" and "start again", and only the first is warranted when the client already holds
    every row.
  */
  onCleanup(workingSet.watch());

  const query = useDispatchOrdersQuery(filters, () => serverMode());
  const savedFiltersQuery = useSavedFiltersQuery();
  const savedFilterMutation = useSavedFilterMutation();

  createEffect(
    on(searchDraft, (draft) => {
      const trimmed = draft.trim();
      const currentUrl = (searchParams.search ?? '').trim();
      if (trimmed === currentUrl) return;

      const timer = setTimeout(() => {
        setSearchParams({ search: trimmed || undefined });
      }, SEARCH_DEBOUNCE_MS);
      onCleanup(() => clearTimeout(timer));
    }),
  );

  /**
   * The queue's rows: filtered and sorted **here** while the client holds the set, and read from
   * the server's pages when it does not.
   *
   * Sorting locally is not a shortcut — it is what makes the poll honest. A merged row that kept
   * its old position would be correct and in the wrong place, which reads as the queue ignoring
   * the change that just arrived.
   */
  // Hand the queue's sort seam this install's entitlements, so a contributed ranking rule can gate
  // itself on the licence the way the server's fragment does. Read through a getter rather than
  // copied, because the context is fetched lazily and a snapshot taken here would freeze the
  // pre-fetch defaults.
  publishQueueSortEntitlements(() => ctx.entitlements as unknown as Record<string, boolean>);

  const allOrders = createMemo<DispatchOrderSummary[]>(() => {
    if (serverMode()) return (query.data?.pages ?? []).flatMap((p) => p.orders);

    const gateways = ctx.paymentMethods.manualIds ?? [];
    const matching = [...workingSet.orders().values()].filter((o) =>
      matchesLocalFilters(o, filters(), gateways),
    );

    return sortQueue(matching);
  });

  /**
   * Local search filter applied to the loaded set on every keystroke.
   * Lets the merchant see results narrow without waiting for the
   * 200ms debounce + round-trip to land.
   */
  const displayedOrders = createMemo<DispatchOrderSummary[]>(() => {
    const all = allOrders();
    const needle = searchDraft().trim().toLowerCase();
    if (needle === '') return all;
    return all.filter(
      (o) =>
        o.customerName.toLowerCase().includes(needle) ||
        o.customerEmail.toLowerCase().includes(needle) ||
        o.externalId.toLowerCase().includes(needle),
    );
  });

  /**
   * How many orders match — the readout's third number.
   *
   * In server mode that is the server's count over the whole table. Holding the set, it is simply
   * how many rows matched, which is the same number and needs no round trip to learn.
   */
  const totalCount = createMemo(() =>
    serverMode() ? (query.data?.pages[0]?.total ?? 0) : allOrders().length,
  );

  /**
   * A query is in flight for the *current* view — not for the next page.
   *
   * Paging in more rows is not a refresh: the rows on screen are still current, so spinning the
   * refresh control for it would report staleness that is not there.
   */
  const isRefreshing = (): boolean =>
    serverMode() ? query.isFetching && !query.isFetchingNextPage : workingSet.busy();

  /** Nothing to show yet — from whichever source is feeding the table. */
  const loadingFirstRows = (): boolean =>
    allOrders().length === 0 && (serverMode() ? query.isLoading : workingSet.busy());

  /** The failure that stopped rows arriving, whichever path was asked for them. */
  const queueError = (): Error | null =>
    serverMode() ? (query.error ?? null) : workingSet.error();

  /**
   * The readout's third number — and the two modes genuinely mean different things by it.
   *
   * Holding the set, "loaded" and "matching" are the same number, so the third slot says something
   * the other two cannot: how many open orders exist at all. That is the scale a filtered count
   * needs to be read against — 12 of 408 is a different day from 12 of 15.
   *
   * In server mode the client holds a page, not a set, so the numbers keep their paged meaning:
   * how many rows are here, out of how many match. Collapsing the two shapes into one wording
   * would make one of them a lie.
   */
  const readoutTotal = (): number => (serverMode() ? totalCount() : workingSet.total());

  const readoutTitle = (): string =>
    serverMode()
      ? sprintf(
          /* translators: 1: rows selected, 2: rows loaded so far, 3: rows matching the filter */
          __('Selected: %1$d, Loaded: %2$d, Total: %3$d'),
          selectedIds().size,
          displayedOrders().length,
          totalCount(),
        )
      : sprintf(
          /* translators: 1: rows selected, 2: rows matching the filter, 3: open orders in total */
          __('Selected: %1$d, Matching: %2$d, Open orders: %3$d'),
          selectedIds().size,
          displayedOrders().length,
          workingSet.total(),
        );

  // Multi-row selection for bulk actions (currently bulk-tag). Keyed by order hex id.
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());
  const toggleRowSelect = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = (): void => {
    setSelectedIds(new Set<string>());
  };
  const displayedAllSelected = createMemo(() => {
    const ds = displayedOrders();
    return ds.length > 0 && ds.every((o) => selectedIds().has(o.id));
  });
  const toggleSelectAll = (): void => {
    const ds = displayedOrders();
    const all = displayedAllSelected();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const o of ds) {
        if (all) next.delete(o.id);
        else next.add(o.id);
      }
      return next;
    });
  };

  const listStore = useListStore();
  const location = useLocation();
  createEffect(() => {
    listStore.setIds(displayedOrders().map((o) => o.id));
  });
  // Mirror the queue's URL search string into the cross-route store
  // so OrderDetail's "← Queue" back link can restore the operator's
  // filters / search / page-size on return. Empty string when the
  // queue is bare (the back link then sends them to `/`).
  createEffect(() => {
    listStore.setQueueSearch(location.search ?? '');
  });

  /**
   * Land on the row the operator just left, selected.
   *
   * Returning from an order hands its id back through the list store; the queue focuses that row
   * and scrolls it into view, so Escape-then-Enter is a lossless round trip rather than a trip back
   * to the top of a list of four hundred.
   *
   * Waits for the rows: the working set may still be replicating, and the id is consumed only once
   * it has actually been found. An order that no longer matches the filter — shipped while it was
   * open, say — simply is not there, and the queue leaves the selection alone rather than guessing
   * at a neighbour.
   */
  createEffect(() => {
    const wanted = listStore.focusId();
    if (wanted === '') return;

    const index = displayedOrders().findIndex((o) => o.id === wanted);
    if (index < 0) return;

    listStore.setFocusId('');
    focusRow(index, { scroll: true });
  });

  const nativeStatusOptions = createMemo<ComboboxOption[]>(() => {
    const known = new Map<string, ComboboxOption>();
    for (const opt of ctx.nativeStatus.options) known.set(opt.value, opt);
    for (const order of allOrders()) {
      if (order.wcStatus && !known.has(order.wcStatus)) {
        known.set(order.wcStatus, {
          value: order.wcStatus,
          label: nativeStatusName(ctx.nativeStatus.options, order.wcStatus),
        });
      }
    }
    return [...known.values()];
  });

  /**
   * Slug → the colour the merchant configured, read straight from the bootstrap context.
   *
   * Not from `nativeStatusOptions()`: that memo is typed as combobox options and drops the field on
   * the way through, and it also synthesises entries for statuses seen only on a loaded order —
   * which by definition have no policy row and so no colour to carry.
   */
  const nativeStatusColorIds = createMemo(() => {
    const m = new Map<string, number>();
    for (const o of ctx.nativeStatus.options) {
      if (null !== o.colorId && undefined !== o.colorId) m.set(o.value, o.colorId);
    }
    return m;
  });

  /** Configured colour → shipped default → grey. `.get()` result used with `??`, since colour 0 is
   *  Light grey: a real, deliberate choice that a truthiness check would silently discard. */
  function nativeStatusColor(value: string): number {
    return nativeStatusColorIds().get(value) ?? shippedNativeStatusColor(value);
  }

  function nativeStatusLabel(value: string): string {
    for (const opt of nativeStatusOptions()) {
      if (opt.value === value) return opt.label;
    }
    return value;
  }

  // Gateway options come from the adapter (registered WC gateways); augment
  // with any gateway id seen on a loaded order but no longer registered, so a
  // removed/legacy gateway stays filterable (same pattern as wc_status).
  const paymentMethodOptions = createMemo<ComboboxOption[]>(() => {
    const known = new Map<string, ComboboxOption>();
    for (const opt of ctx.paymentMethods.options) known.set(opt.value, opt);
    for (const order of allOrders()) {
      if (order.paymentMethod && !known.has(order.paymentMethod)) {
        known.set(order.paymentMethod, {
          value: order.paymentMethod,
          label: order.paymentMethodTitle ?? order.paymentMethod,
        });
      }
    }
    return [...known.values()];
  });

  function paymentMethodLabel(value: string): string {
    for (const opt of paymentMethodOptions()) {
      if (opt.value === value) return opt.label;
    }
    return value;
  }

  function effectiveWorkflow(): string[] {
    return filters().workflowState ?? ctx.workflowState.defaultSelected;
  }

  function workflowLabel(value: string): string {
    for (const opt of workflowOptions()) {
      if (opt.value === value) return opt.label;
    }
    return value;
  }

  /**
   * Search-param patch that keeps a tag filter from returning nothing.
   *
   * A tag carrying `SuppressActive` takes its orders out of the active queue, so filtering by one
   * while the workflow filter sits on its `Active` default matches zero rows — the two filters
   * describe disjoint sets. This adds the state that *does* cover them (whichever the install
   * advertises as `includesSuppressed`) to the current selection.
   *
   * Only ever **widens**, and only for a tag that actually withholds: picking an ordinary tag must
   * not quietly relax the workflow cut and start showing closed orders. The result is visible in the
   * chip ("Actif, Retiré"), so the operator can see what happened and undo it.
   */
  function workflowWideningFor(tagValues: string[]): { workflow_state?: string } {
    const covering = workflowOptions()
      .filter((o) => o.includesSuppressed)
      .map((o) => o.value);
    if (covering.length === 0) return {}; // no add-on offers such a state on this install

    const picked = (tagsQuery.data ?? []).filter((t) => tagValues.includes(String(t.id)));
    if (!picked.some((t) => t.governanceFlags.includes('SuppressActive'))) return {};

    const current = effectiveWorkflow();
    // Explicit no-filter already shows everything; adding values would *narrow* it.
    if (current.length === 0) return {};
    if (current.some((v) => covering.includes(v))) return {};

    return { workflow_state: [...current, ...covering].join(',') };
  }

  function effectiveNativeStatus(): string[] {
    // `filters().wcStatus` is already defaulted at parse time (see the
    // `filters` memo). This getter just feeds the Combobox.
    return filters().wcStatus ?? [];
  }

  /**
   * Pretty "Label, Label +N" summary for a chip's current selection.
   *
   * Pass `all` and a selection covering every option reads as that label instead. "Corrections to
   * process +2" describes *every* option by naming one of them and counting the rest — so the
   * operator's actual question, is this chip cutting anything, is answered with a number they
   * would have to compare against one the chip never shows. A selection covering everything
   * narrows nothing; say so.
   *
   * The label is per chip rather than a shared "All" because the chips sit in a row: "All" three
   * times over says which chips are open but not what each one is about, while "All states",
   * "All statuses" and "All actions" stay readable at a glance.
   *
   * Only for closed option sets the server advertises. A chip over an open set (tags, SKUs) gets
   * no `all`: its options arrive by fetch, so "all of them" would mean "all we have loaded" —
   * a different and much weaker claim.
   */
  function summarize(
    values: string[],
    lookup: (v: string) => string,
    all?: { of: number; label: string },
  ): string {
    if (values.length === 0) return '';
    // `of > 1` because with a single option the "all" label hides the only thing worth reading.
    if (all !== undefined && all.of > 1 && values.length >= all.of) return all.label;
    const labels = values.map(lookup);
    return labels.length === 1 ? labels[0] : `${labels[0]} +${labels.length - 1}`;
  }

  function worksheetLabel(id: string): string {
    return worksheetOptionsQuery.data?.find((o) => o.value === id)?.label ?? `#${id}`;
  }

  function tagLabel(id: string): string {
    return tagsQuery.data?.find((t) => String(t.id) === id)?.name ?? `#${id}`;
  }

  function skuLabel(sku: string): string {
    // Chip summary shows just the SKU code (not "SKU — Name"), per
    // arch-ui-principles + the user's explicit preference. The fuller
    // form lives inside the dropdown.
    return sku;
  }

  /**
   * The five chips driving the dispatch queue's `<FilterBar>`. Each
   * descriptor declares its `type` (resolved against
   * `filterControlRegistry` in @invflux/ui), live `value`/`options`
   * accessors, and an `onChange` that writes back to the URL via
   * `setSearchParams` — closing the round-trip with the `filters`
   * memo above.
   */
  /**
   * Which filter's control is open, as the *dimension* the server counts by — null when none is,
   * or when the open filter is one that cannot be counted.
   *
   * Counting is affordable per opened control and ruinous per render, so nothing is counted until
   * the operator opens something. Free text, SKU and product ids are absent deliberately: they have
   * no meaningful value list, and the endpoint refuses them rather than answering slowly.
   */
  const FACET_DIMENSIONS: Record<string, string> = {
    status: 'status',
    workflow: 'workflow_state',
    wc_status: 'wc_status',
    pending_action: 'pending_action',
    payment_method: 'payment_method',
    tag: 'tag_id',
  };
  const [openDimension, setOpenDimension] = createSignal<string | null>(null);

  /**
   * Each facet dimension's own filter key — the one self-exclusion removes when counting it.
   */
  const FACET_FILTER_KEY: Record<string, keyof DispatchQueueFilters> = {
    status: 'status',
    workflow_state: 'workflowState',
    wc_status: 'wcStatus',
    pending_action: 'pendingActions',
    payment_method: 'paymentMethods',
    shipping_class: 'shippingClasses',
    shipping_method: 'shippingMethods',
    tag_id: 'tagIds',
    tag_id_not: 'tagIdsNot',
    has_tags: 'hasTags',
    has_notes: 'hasNotes',
  };

  /** What each dimension's values are, read off a row. */
  const FACET_VALUES: Record<
    string,
    (order: DispatchOrderSummary, manualGateways: readonly string[]) => string[]
  > = {
    status: (order) => [order.status],
    workflow_state: (order) => [order.workflowState],
    wc_status: (order) => (order.wcStatus === null ? [] : [order.wcStatus]),
    payment_method: (order) => (order.paymentMethod === null ? [] : [order.paymentMethod]),
    // Every class and every method id on the row, so a mixed or two-package order counts under
    // each — what the server's EXISTS predicates would return for each option.
    shipping_class: (order) => order.shippingClasses ?? [],
    shipping_method: (order) => order.shippingMethods ?? [],
    pending_action: (order, manualGateways) => pendingActionsOf(order, manualGateways),
    tag_id: (order) => (order.tags ?? []).map((tag) => String(tag.id)),
    tag_id_not: (order) => (order.tags ?? []).map((tag) => String(tag.id)),
    has_tags: (order) => [(order.tags?.length ?? 0) > 0 ? 'yes' : 'no'],
    has_notes: (order) => [(order.noteCount ?? 0) > 0 ? 'yes' : 'no'],
  };

  /**
   * Values the working set cannot count, because it never holds the orders that carry them: it
   * replicates un-closed orders only. A tally there is a confident zero about orders it has never
   * seen, so these options go uncounted — no number, which says "not known here" where `0` says
   * "none".
   */
  const WORKING_SET_BLIND: Record<string, ReadonlySet<string>> = {
    workflow_state: new Set(['Closed']),
  };

  /**
   * How each dimension's own values combine — which decides what its counts are measured against.
   *
   * Only the ones that narrow are listed; everything else ORs, which is the default. `tag_id` is
   * the interesting one: the *same* dimension is disjunctive under `any` and conjunctive under
   * `all`, so its combination is read from the live match mode rather than fixed here.
   */
  /**
   * The two values a presence dimension offers. Built per call so the labels follow the locale
   * rather than freezing whatever was loaded at module scope.
   */
  const PRESENCE_OPTIONS = (): ComboboxOption[] => [
    { value: 'yes', label: __('Yes') },
    { value: 'no', label: __('No') },
  ];

  const presenceLabel = (value: string): string => (value === 'yes' ? __('Yes') : __('No'));

  /**
   * Drop from `other` anything just chosen here, as a `setSearchParams` fragment.
   *
   * Include and exclude are one control split across two chips, so a tag may sit in only one of
   * them: holding it in both is a contradiction that returns nothing at all, and an operator who
   * has just ticked it has said which they meant. Returns `{}` when there is no overlap, so the
   * common case writes no parameter and leaves the URL alone.
   */
  const withoutOverlap = (
    param: 'tag_id' | 'tag_id_not',
    current: string[],
    justChosen: string[],
  ): Record<string, string | undefined> => {
    const kept = current.filter((id) => !justChosen.includes(id));

    return kept.length === current.length
      ? {}
      : { [param]: kept.length > 0 ? kept.join(',') : undefined };
  };

  const facetCombination = (dimension: string): FacetCombination => {
    if (dimension === 'tag_id_not') return 'conjunctive';
    if (dimension === 'tag_id') return filters().tagMatch === 'all' ? 'conjunctive' : 'disjunctive';

    return 'disjunctive';
  };

  /**
   * May this dimension be counted from rows already in hand?
   *
   * **Only when the set held is a superset of the set the answer needs** — the rule the whole
   * local/server split rests on. Self-exclusion means a dimension's counts are computed with every
   * filter *but its own*, so the base set is wider than the view exactly when that dimension is
   * filtered. Two ways to satisfy it, and they are not the same strength:
   *
   * - Holding the **working set** — every un-closed order — the rows are a *corpus*, wider than any
   *   view drawn from them. Always countable.
   * - Holding a **completed paged result**, the rows *are* the view. Countable only for a dimension
   *   carrying no filter of its own, where "filters minus this one" is just "filters". Holding all
   *   of the answer is strictly weaker than holding all of the corpus.
   */
  const countsLocally = (dimension: string): boolean => {
    if (!serverMode()) return true;
    // `totalCount()` reads `pages[0].total`, which describes the PREVIOUS filters for a beat after
    // a filter change. Equality is only meaningful once the query has settled — and an unsettled
    // `0 === 0` would read as "we hold everything" and render every option as a confident zero.
    if (query.data === undefined || query.isFetching || totalCount() === 0) return false;
    if (allOrders().length !== totalCount()) return false;

    const own = filters()[FACET_FILTER_KEY[dimension] ?? 'status'];

    return !Array.isArray(own) || own.length === 0;
  };

  /**
   * The dimension the *server* must count, or `null` when the rows in hand can answer it.
   *
   * Gating the request and choosing the numbers off one predicate is deliberate: split them and a
   * view can issue a query whose answer it then discards, or worse, wait on one it never asked for.
   */
  const serverFacetDimension = createMemo<string | null>(() => {
    const dimension = openDimension();

    return dimension === null || countsLocally(dimension) ? null : dimension;
  });
  const facetsQuery = useDispatchFacetsQuery(serverFacetDimension, filters);

  /**
   * Shipping-class options: `none` always, plus every class the client has evidence of.
   *
   * Two sources, because neither is sufficient alone. Loaded rows only know the classes on the
   * page, so a class used exclusively by orders further down the queue would never be offerable.
   * The facet counts know the whole filtered set, but only arrive once the control is opened. The
   * union means the list is usable immediately and complete by the time it matters.
   *
   * `none` is unconditional and first. It is the one option whose absence from the data is not a
   * reason to hide it — "show me what still needs classifying" is worth asking precisely when the
   * answer might be nothing.
   */
  const shippingClassOptions = createMemo<ComboboxOption[]>(() => {
    const known = new Map<string, ComboboxOption>();
    known.set('none', {
      value: 'none',
      label: _x('none', 'shipping class: the order has none (lower case)'),
    });
    for (const order of allOrders()) {
      for (const cls of order.shippingClasses ?? []) {
        if (!known.has(cls)) known.set(cls, { value: cls, label: cls });
      }
    }
    if (openDimension() === 'shipping_class' && facetsQuery.data?.dimension === 'shipping_class') {
      for (const cls of Object.keys(facetsQuery.data.counts)) {
        if (!known.has(cls)) known.set(cls, { value: cls, label: cls });
      }
    }
    return [...known.values()];
  });

  /**
   * Shipping-method options, keyed on the method id and labelled with what customers were shown.
   *
   * Same two sources as the classes above, for the same reason. A row names only its first
   * package's title, so an id seen only as a second package — or only in the facet counts — falls
   * back to the id itself: still selectable, and still the truthful key.
   */
  const shippingMethodOptions = createMemo<ComboboxOption[]>(() => {
    const titles = new Map<string, string>();
    for (const order of allOrders()) {
      if (order.shippingMethod && order.shippingMethodTitle) {
        titles.set(order.shippingMethod, order.shippingMethodTitle);
      }
    }
    const ids = new Set<string>();
    for (const order of allOrders()) for (const id of order.shippingMethods ?? []) ids.add(id);
    if (
      openDimension() === 'shipping_method' &&
      facetsQuery.data?.dimension === 'shipping_method'
    ) {
      for (const id of Object.keys(facetsQuery.data.counts)) ids.add(id);
    }

    return [...ids]
      .map((id) => ({ value: id, label: titles.get(id) ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  /**
   * Attach counts to the options of the control currently open, and to no other.
   *
   * A count belongs to one dimension under one filter state, so wearing another dimension's
   * numbers — or last state's — would be worse than wearing none. An option the server did not
   * mention reads as `0` rather than uncounted: for the dimensions it answers sparsely, absent
   * *means* zero, and §3.3 says show the zero — hiding it makes "matches nothing right now"
   * indistinguishable from "this option does not exist".
   */
  const withFacets = (dimension: string, options: ComboboxOption[]): ComboboxOption[] => {
    if (openDimension() !== dimension) return options;

    // Counting in memory is free and instant, so the endpoint is for the case the rows in hand
    // genuinely cannot answer — not for "server mode" as a category. See `countsLocally`.
    const counts = countsLocally(dimension)
      ? localFacetCounts(dimension)
      : facetsQuery.data?.dimension === dimension
        ? facetsQuery.data.counts
        : undefined;
    if (counts === undefined) return options;

    const blind =
      countsLocally(dimension) && !serverMode() ? WORKING_SET_BLIND[dimension] : undefined;

    return options.map((option) => ({
      ...option,
      count: blind?.has(option.value) ? undefined : (counts[option.value] ?? 0),
    }));
  };

  /**
   * Facet counts from rows the client holds — and the two ways of holding them count differently.
   *
   * Over the **working set** the rows are wider than the view, so every filter but this dimension's
   * own has to be re-applied — that subtraction *is* self-exclusion. Over a **completed paged
   * result** the rows already are the view, and `countsLocally` admits only a dimension carrying no
   * filter, so the base set is exactly what is in hand and a tally is the whole job. Re-filtering
   * there would be worse than redundant: the server applied predicates this client cannot evaluate
   * (a SKU reaches into lines the row does not carry), so a local pass would drop rows that match.
   */
  const localFacetCounts = (dimension: string): Record<string, number> | undefined => {
    const valuesOf = FACET_VALUES[dimension];
    const key = FACET_FILTER_KEY[dimension];
    if (valuesOf === undefined || key === undefined) return undefined;

    const gateways = ctx.paymentMethods.manualIds ?? [];
    if (!serverMode()) {
      return countFacet(
        [...workingSet.orders().values()],
        filters(),
        key,
        (order) => valuesOf(order, gateways),
        gateways,
        facetCombination(dimension),
      );
    }

    const counts: Record<string, number> = {};
    for (const order of allOrders()) {
      for (const value of valuesOf(order, gateways)) counts[value] = (counts[value] ?? 0) + 1;
    }

    return counts;
  };

  const filterChips = createMemo<FilterDescriptor[]>(() => {
    const chips: FilterDescriptor[] = [];

    // Dispatch Status — fully optional. The chip surfaces when the
    // operator explicitly picked at least one status.
    {
      const selected = filters().status ?? [];
      chips.push({
        id: 'status',
        paramKeys: ['status'],
        label: __('Dispatch Status'),
        type: FILTER_CONTROL_MULTISELECT,
        active: selected.length > 0,
        summary: summarize(selected, (v) => STATUS_LABEL[v as OrderStatus]?.() ?? v, {
          of: STATUS_OPTIONS().length,
          label: __('All statuses'),
        }),
        placeholder: _x('All', 'order filter placeholder: nothing chosen, so every value matches'),
        value: () => filters().status ?? [],
        options: () => withFacets('status', STATUS_OPTIONS()),
        onChange: (values) =>
          setSearchParams({ status: values.length > 0 ? values.join(',') : undefined }),
        clear: () => setSearchParams({ status: undefined }),
      });
    }

    // Workflow State — options, labels and default all come from the
    // adapter (`ctx.workflowState`), so an add-on that registers a
    // state server-side gets its option here without this package
    // knowing the state exists. The chip becomes active the moment
    // the URL carries any `workflow_state` token, including the
    // explicit-empty sentinel a shared link may carry — which keeps the
    // chip pill visible so the operator can re-enter the popover.
    // "Show every workflow" is reachable by selecting every state.
    {
      const effective = effectiveWorkflow();
      const overrides = searchParams.workflow_state !== undefined;
      // The `Active` default has yielded to a deliberate filter (see the `filters` memo), so the
      // cut showing is "all states". The chip has to say so: a default the operator cannot see is
      // exactly what this filter bar exists to prevent.
      const widened = !overrides && widensPastClosure();
      chips.push({
        id: 'workflow',
        label: ctx.workflowState.filterLabel,
        paramKeys: ['workflow_state'],
        // Its own, because "no state filter" is a *deliberate* value here and the default
        // rendering would omit it as constraining nothing. A stored view that widened past the
        // `Active` floor has to say so: read back as silence it would be indistinguishable from a
        // view that never mentioned states, which is the ambiguity §0 is about.
        describe: (query): FilterConstraint | null => {
          const raw = query.workflow_state;
          if (raw === undefined) return null;
          const values = (Array.isArray(raw) ? raw : raw.split(',')).map((v) => v.trim());
          if (values.length === 0 || values.every((v) => v === '' || v === NO_FILTER_SENTINEL)) {
            return {
              id: 'workflow',
              label: ctx.workflowState.filterLabel,
              value: __('All states'),
            };
          }

          return describeConstraint(
            { id: 'workflow', label: ctx.workflowState.filterLabel, options: workflowOptions() },
            values,
          );
        },
        type: FILTER_CONTROL_MULTISELECT,
        // Surface the chip whenever a filter is in effect — including the
        // adapter default applied on a silent URL (so the operator sees the
        // cut they're looking at), not only on an explicit override.
        active: overrides || effective.length > 0 || widened,
        // Two different routes to "no state constraint", and both have to say so. `widened` is the
        // Active default yielding to a pending-action filter; the second is the operator having
        // deliberately selected everything, which the URL carries as the explicit-empty sentinel.
        // Without it the chip fell through to FilterBar's "set…" placeholder — the label for a
        // filter nobody has touched yet, on a filter someone had just widened on purpose. The
        // `describe()` above already got this right, so the chip and the saved-view description
        // disagreed about the same URL.
        summary:
          widened || (overrides && effective.length === 0)
            ? __('All states')
            : summarize(effective, workflowLabel, {
                of: workflowOptions().length,
                label: __('All states'),
              }),
        placeholder: widened
          ? __('All states')
          : summarize(ctx.workflowState.defaultSelected, workflowLabel),
        // CRITICAL: `value` must read reactively at call time, not
        // close over the snapshotted `effective`. FilterBar opens
        // the popover via `untrack` so the descriptor object is
        // captured at open-time; only the accessor itself is
        // re-invoked when something changes. A `() => effective`
        // closure returns the stale value forever — checkbox state
        // in the dropdown would never reflect the URL update.
        value: () => effectiveWorkflow(),
        options: () => withFacets('workflow_state', workflowOptions()),
        // A silent URL means nobody has expressed a preference: the selection showing is the
        // adapter's, so its options carry dots and the first click replaces them rather than adding
        // to them. Unchecking the last option reverts here rather than asking for nothing — the
        // control routes that to `clear`.
        isDefault: () => searchParams.workflow_state === undefined,
        // What `clear` restores — `Active`, not "no workflow filter", unless a pending action is
        // holding the floor open. The chip's ✕ says so either way.
        defaultSummary: () =>
          !searchParams.workflow_state && widensPastClosure()
            ? __('All states')
            : summarize(ctx.workflowState.defaultSelected, workflowLabel),
        // What a saved filter must write down. This is the §0 case exactly: on a silent URL the
        // queue is showing `Active` and saying so nowhere, so a view stored without this line
        // re-aims the day that default moves.
        params: (): SavedFilterQuery => {
          const effective = effectiveWorkflow();
          if (effective.length > 0) return { workflow_state: effective.join(',') };
          // Widened by a pending action, so the saved view has to say "every state" outright: the
          // rule that widened it could change, and a view that recorded nothing would then be
          // re-aimed by that change without anybody touching it.
          return widened ? { workflow_state: NO_FILTER_SENTINEL } : {};
        },
        onChange: (values) => setSearchParams({ workflow_state: values.join(',') }),
        clear: () => setSearchParams({ workflow_state: undefined }),
      });
    }

    // Native WC status — adapter-provided defaults apply when the URL
    // is silent (see the `filters` memo). Chip activeness mirrors the
    // workflow chip: any URL token (including the no-filter sentinel)
    // keeps the chip pill visible.
    {
      const effective = effectiveNativeStatus();
      const overrides = searchParams.wc_status !== undefined;
      chips.push({
        id: 'wc_status',
        paramKeys: ['wc_status'],
        label: ctx.nativeStatus.filterLabel,
        type: FILTER_CONTROL_MULTISELECT,
        // As with workflow: show the chip when the adapter default (e.g.
        // `Processing`) is applied on a silent URL, not just on an explicit
        // override — so the default cut is visible, not hidden behind "Add filter".
        active: overrides || effective.length > 0,
        summary: summarize(effective, (v) => nativeStatusLabel(v), {
          of: ctx.nativeStatus.options.length,
          label: __('All statuses'),
        }),
        placeholder: _x('All', 'order filter placeholder: nothing chosen, so every value matches'),
        // Reactive read at call time — see the comment on the
        // workflow chip's `value` for the same reason.
        value: () => effectiveNativeStatus(),
        options: () => withFacets('wc_status', nativeStatusOptions()),
        // Same default-vs-deliberate contract as the workflow chip. This install's default is
        // empty, so there are no dots to show and `clear` genuinely removes the filter — the chip's
        // ✕ keeps saying "remove" because `defaultSummary` is empty.
        isDefault: () => searchParams.wc_status === undefined,
        // Empty on this install, so there is nothing to make explicit — but an install whose
        // adapter default is non-empty writes it down like the workflow chip does.
        params: (): SavedFilterQuery => {
          const effective = effectiveNativeStatus();

          return effective.length > 0 ? { wc_status: effective.join(',') } : {};
        },
        onChange: (values) => setSearchParams({ wc_status: values.join(',') }),
        clear: () => setSearchParams({ wc_status: undefined }),
      });
    }

    // Pending action — what an order is waiting on a *person* to do: a refund to pay out,
    // corrections to process, an offline payment nobody has recorded yet.
    //
    // One filter rather than a checkbox per flag, because these are not exclusive states. An order
    // can be waiting on a refund payout and on corrections at once, and an operator clearing a
    // backlog asks "what needs me", not "which of these booleans is set" — so the values union.
    //
    // The list comes from the adapter (`ctx.pendingAction`) rather than living here: a workflow
    // brings its own queue, so an add-on that introduces goods receipt introduces "receipts to
    // book" with it, and no SPA rebuild should be needed for the option to appear.
    //
    // It is also the *only* writer of `pending_action`, which both shipped views store — "Pending
    // manual refunds" and the broader "Pending actions". A seeded view has to be a shortcut to
    // something the surface can already say: deletion is permanent by design, so a parameter
    // reachable only through one deletable row would take its constraint with it. That is why
    // ticking every option writes `_any` here rather than the expanded list — the seeded view is
    // exactly what this control produces, not a shape only the seeder knows how to make.
    {
      const selected = pendingActions();
      chips.push({
        id: 'pending_action',
        paramKeys: ['pending_action'],
        label: ctx.pendingAction.filterLabel,
        type: FILTER_CONTROL_MULTISELECT,
        active: selected.length > 0,
        summary: summarize(selected, pendingActionLabel, {
          of: ctx.pendingAction.options.length,
          label: __('All actions'),
        }),
        placeholder: _x('Any', 'order filter placeholder: nothing chosen, so every value matches'),
        // A stored `_any` has to describe itself, or a saved view reads back as a raw token the
        // description would then flag as unresolvable — the §1.2 degradation notice, fired on a
        // value that is perfectly well understood.
        describe: (query): FilterConstraint | null => {
          const raw = query.pending_action;
          if (raw === undefined) return null;
          const values = (Array.isArray(raw) ? raw : raw.split(',')).map((v) => v.trim());
          if (values.includes(ANY_PENDING_ACTION)) {
            return {
              id: 'pending_action',
              label: ctx.pendingAction.filterLabel,
              value: __('All actions'),
            };
          }

          return describeConstraint(
            {
              id: 'pending_action',
              label: ctx.pendingAction.filterLabel,
              options: ctx.pendingAction.options,
            },
            values,
          );
        },
        // Reactive read at call time — see the workflow chip's `value` for why a closure over the
        // snapshot would go stale.
        value: () => pendingActions(),
        options: () => withFacets('pending_action', ctx.pendingAction.options),
        // Everything ticked is written as the token, never as the expanded list: the operator asked
        // for *all waiting work*, and an install that grows an action tomorrow should answer the
        // question they actually asked. Guarded on a non-empty option list so an install advertising
        // none cannot write a token that would then resolve to nothing.
        onChange: (values) => {
          const all = ctx.pendingAction.options.length;
          const asks =
            values.length === 0
              ? undefined
              : all > 0 && values.length >= all
                ? ANY_PENDING_ACTION
                : values.join(',');
          setSearchParams({ pending_action: asks });
        },
        clear: () => setSearchParams({ pending_action: undefined }),
      });
    }

    // Payment Method — multi-select, fully optional (no default). Options come
    // from the adapter's registered gateways; OR-matches the order's gateway.
    {
      const selected = filters().paymentMethods ?? [];
      chips.push({
        id: 'payment_method',
        paramKeys: ['payment_method'],
        label: ctx.paymentMethods.filterLabel,
        type: FILTER_CONTROL_MULTISELECT,
        active: selected.length > 0,
        summary: summarize(selected, paymentMethodLabel),
        placeholder: _x('Any', 'order filter placeholder: nothing chosen, so every value matches'),
        value: () => filters().paymentMethods ?? [],
        options: () => withFacets('payment_method', paymentMethodOptions()),
        onChange: (values) =>
          setSearchParams({
            payment_method: values.length > 0 ? values.join(',') : undefined,
          }),
        clear: () => setSearchParams({ payment_method: undefined }),
      });
    }

    // Shipping class — multi-select over the order's *lines*, so an order qualifies when any one
    // line carries a selected class. Disjunctive like the other line-reaching filters: picking a
    // second class widens, because "orders involving any of these" is the question a packer asks.
    {
      const selected = filters().shippingClasses ?? [];
      chips.push({
        id: 'shipping_class',
        paramKeys: ['shipping_class'],
        label: __('Shipping classes'),
        type: FILTER_CONTROL_MULTISELECT,
        active: selected.length > 0,
        summary: summarize(selected, (v) =>
          v === 'none' ? _x('none', 'shipping class: the order has none (lower case)') : v,
        ),
        placeholder: _x('Any', 'order filter placeholder: nothing chosen, so every value matches'),
        value: () => filters().shippingClasses ?? [],
        options: () => withFacets('shipping_class', shippingClassOptions()),
        onChange: (values) =>
          setSearchParams({
            shipping_class: values.length > 0 ? values.join(',') : undefined,
          }),
        clear: () => setSearchParams({ shipping_class: undefined }),
      });
    }

    // Shipping method — multi-select over the order's shipping packages, keyed on the method id so
    // two services sharing a title stay apart. An order qualifies when any package uses a selected
    // method.
    {
      const selected = filters().shippingMethods ?? [];
      const labelOf = (id: string): string =>
        shippingMethodOptions().find((o) => o.value === id)?.label ?? id;
      chips.push({
        id: 'shipping_method',
        paramKeys: ['shipping_method'],
        label: __('Shipping method'),
        type: FILTER_CONTROL_MULTISELECT,
        active: selected.length > 0,
        summary: summarize(selected, labelOf),
        placeholder: _x('Any', 'order filter placeholder: nothing chosen, so every value matches'),
        value: () => filters().shippingMethods ?? [],
        options: () => withFacets('shipping_method', shippingMethodOptions()),
        onChange: (values) =>
          setSearchParams({
            shipping_method: values.length > 0 ? values.join(',') : undefined,
          }),
        clear: () => setSearchParams({ shipping_method: undefined }),
      });
    }

    // Worksheet — multi-select. Pre-loaded options; OR semantics on
    // the server (the chip's `multiselect` control reflects that).
    {
      const selected = filters().worksheetIds ?? [];
      chips.push({
        id: 'worksheet',
        paramKeys: ['worksheet_id'],
        label: __('Worksheet'),
        type: FILTER_CONTROL_MULTISELECT,
        active: selected.length > 0,
        summary: summarize(selected, worksheetLabel),
        placeholder: _x('Any', 'order filter placeholder: nothing chosen, so every value matches'),
        value: () => filters().worksheetIds ?? [],
        options: () =>
          worksheetOptionsQuery.data?.map((o) => ({ value: o.value, label: o.label })) ?? [],
        onChange: (values) =>
          setSearchParams({
            worksheet_id: values.length > 0 ? values.join(',') : undefined,
          }),
        clear: () => setSearchParams({ worksheet_id: undefined }),
      });
    }

    // Tags — OR-match against the order's assigned tags.
    {
      const selected = filters().tagIds ?? [];
      chips.push({
        id: 'tag',
        label: __('Tags'),
        paramKeys: ['tag_id', 'tag_match'],
        // Two parameters, and the second changes what the first means: the same three tags read
        // "any of these" or "all of these", which are different cuts. Describing only `tag_id`
        // would state a constraint the view does not carry.
        describe: (query): FilterConstraint | null => {
          const raw = query.tag_id;
          if (raw === undefined) return null;
          const values = (Array.isArray(raw) ? raw : raw.split(',')).filter((v) => v !== '');
          const line = describeConstraint(
            {
              id: 'tag',
              label: __('Tags'),
              options: (tagsQuery.data ?? []).map((t) => ({
                value: String(t.id),
                label: t.name,
              })),
            },
            values,
          );
          if (line === null) return null;

          return query.tag_match === 'all'
            ? {
                ...line,
                value: sprintf(
                  /* translators: %s: a comma-separated list of tag names */
                  __('all of %s'),
                  line.value,
                ),
              }
            : line;
        },
        // Custom control: the same pill picker the right-click menu uses (colours +
        // usage counts), instead of the plain multiselect dropdown.
        type: FILTER_CONTROL_TAGS,
        active: selected.length > 0,
        summary: summarize(selected, tagLabel),
        placeholder: _x('Any', 'order filter placeholder: nothing chosen, so every value matches'),
        value: () => filters().tagIds ?? [],
        options: () =>
          withFacets(
            'tag_id',
            (tagsQuery.data ?? []).map((t) => ({ value: String(t.id), label: t.name })),
          ),
        // Any/All match-mode toggle on the popover title row.
        extra: () => (
          <FilterModeToggle
            modes={[
              {
                value: 'any',
                label: _x('Any', 'tag filter match mode: orders carrying any of the chosen tags'),
              },
              {
                value: 'all',
                label: _x('All', 'tag filter match mode: orders carrying all of the chosen tags'),
              },
            ]}
            value={() => (searchParams.tag_match === 'all' ? 'all' : 'any')}
            onChange={(m) => setSearchParams({ tag_match: m === 'all' ? 'all' : undefined })}
          />
        ),
        onChange: (values) =>
          setSearchParams({
            tag_id: values.length > 0 ? values.join(',') : undefined,
            ...workflowWideningFor(values),
            // The reciprocal of the exclude chip's rule — a tag lives in one list or the other.
            ...withoutOverlap('tag_id_not', filters().tagIdsNot ?? [], values),
          }),
        clear: () => setSearchParams({ tag_id: undefined, tag_match: undefined }),
      });
    }

    // Tags the order must NOT carry. A second list rather than a third `tag_match` value, because
    // a match *mode* applies to the whole selection: it can say "carries none of these" but never
    // "carries X and not Y" — and the second is the query an operator actually has, since tag
    // vocabularies split into attributes (Express, B2B, VIP) and problem markers (Escalated,
    // Awaiting customer, Chargeback). Attribute-minus-marker is how the workable set gets carved
    {
      const excluded = filters().tagIdsNot ?? [];
      chips.push({
        id: 'tag_not',
        label: __('Without tags'),
        paramKeys: ['tag_id_not'],
        type: FILTER_CONTROL_TAGS,
        active: excluded.length > 0,
        summary: summarize(excluded, tagLabel),
        placeholder: _x('None', 'order filter placeholder: no order tag excluded yet'),
        value: () => filters().tagIdsNot ?? [],
        options: () =>
          withFacets(
            'tag_id_not',
            (tagsQuery.data ?? []).map((t) => ({ value: String(t.id), label: t.name })),
          ),
        // Excluding a tag drops it from the include set, and vice versa: holding one in both lists
        // is a contradiction that always returns nothing, and an operator who ticks a tag here has
        // said what they mean. Two chips behaving as one tri-state control.
        onChange: (values) =>
          setSearchParams({
            tag_id_not: values.length > 0 ? values.join(',') : undefined,
            ...withoutOverlap('tag_id', filters().tagIds ?? [], values),
          }),
        clear: () => setSearchParams({ tag_id_not: undefined }),
      });
    }

    // Presence, not identity: "is this order marked at all", which is the question the sparse
    // column answers at a glance and this makes filterable. Distinct from the two chips above —
    // "unmarked" and "not marked with *that*" are different questions.
    for (const [id, param, label, key] of [
      ['has_tags', 'has_tags', __('Has tags'), 'hasTags'],
      ['has_notes', 'has_notes', __('Has notes'), 'hasNotes'],
    ] as const) {
      const selected = (filters()[key] as string[] | undefined) ?? [];
      chips.push({
        id,
        label,
        paramKeys: [param],
        type: FILTER_CONTROL_MULTISELECT,
        active: selected.length > 0,
        summary: summarize(selected, presenceLabel, {
          of: PRESENCE_OPTIONS().length,
          label: _x('All', 'order filter summary: every option is chosen'),
        }),
        placeholder: _x('Any', 'order filter placeholder: nothing chosen, so every value matches'),
        value: () => (filters()[key] as string[] | undefined) ?? [],
        options: () => withFacets(param, PRESENCE_OPTIONS()),
        onChange: (values) =>
          setSearchParams({ [param]: values.length > 0 ? values.join(',') : undefined }),
        clear: () => setSearchParams({ [param]: undefined }),
      });
    }

    // Products (subject ids) — the affordance for the `subject_ids` filter usually
    // set by the workbench "Orders" link. The `numeric_ids` textarea control lets
    // you view / paste / clear the dash-joined id list.
    {
      const selected = filters().subjectIds ?? [];
      chips.push({
        id: 'subject',
        label: __('Products'),
        paramKeys: ['subject_ids'],
        // Dash-joined on the URL (shorter than encoded commas), so the default comma split would
        // render the whole list as one nonsense token.
        describe: (query): FilterConstraint | null => {
          const raw = query.subject_ids;
          if (typeof raw !== 'string') return null;

          return describeConstraint(
            { id: 'subject', label: __('Products'), options: [] },
            raw.split(/[-,]/).filter((v) => v !== ''),
          );
        },
        type: FILTER_CONTROL_NUMERIC_IDS,
        active: selected.length > 0,
        summary:
          selected.length > 0
            ? sprintf(_n('%d product', '%d products', selected.length), selected.length)
            : '',
        placeholder: __('e.g. 3, 4, 6, 734'),
        value: () => filters().subjectIds ?? [],
        options: () => [],
        onChange: (values) =>
          setSearchParams({
            subject_ids: values.length > 0 ? values.join('-') : undefined,
          }),
        clear: () => setSearchParams({ subject_ids: undefined }),
      });
    }

    // SKU — async multi-select. The `multiselect:async` control owns
    // its own debounce + min-char gate; we just hand it `loadOptions`.
    {
      const selected = filters().skus ?? [];
      chips.push({
        id: 'sku',
        paramKeys: ['sku'],
        label: _x('SKU', 'WooCommerce product field: SKU (stock keeping unit)'),
        type: FILTER_CONTROL_MULTISELECT_ASYNC,
        active: selected.length > 0,
        summary: summarize(selected, skuLabel),
        placeholder: __('Type 3+ characters…'),
        value: () => filters().skus ?? [],
        options: () => [],
        // Hand the live label cache down to the async control so the
        // dropdown's pinned section can render "SKU — Name" even
        // after the popover has been closed and reopened.
        selectedOptions: () => {
          const cache = skuLabelCache();
          return selected.map((sku) => ({ value: sku, label: cache.get(sku) ?? sku }));
        },
        loadOptions: async (q) => {
          const opts = await skuLoader(q);
          // Snapshot labels of fetched options so the chip summary
          // and pinned dropdown rows keep "SKU — Name" visible
          // across navigation.
          if (opts.length > 0) {
            setSkuLabelCache((prev) => {
              const next = new Map(prev);
              for (const o of opts) next.set(o.value, o.label);
              return next;
            });
          }
          return opts;
        },
        onChange: (values) =>
          setSearchParams({
            sku: values.length > 0 ? values.join(',') : undefined,
          }),
        clear: () => setSearchParams({ sku: undefined }),
      });
    }

    return chips;
  });

  /**
   * Row virtualization via TanStack Virtual. Matches the Central
   * Workbench setup (same `createVirtualizer` shape, same overscan
   * window) so the two grids feel uniform under the operator's
   * scroll wheel.
   *
   * Row height estimate is the rendered dispatch row — two-line
   * customer cell + pill row + table padding works out to ~56px.
   * The virtualizer re-measures actual heights once rows render, so
   * the estimate only matters for initial scrollbar positioning.
   */
  let scrollContainerEl: HTMLDivElement | undefined;
  const virtualizer = createVirtualizer({
    get count() {
      return displayedOrders().length;
    },
    getScrollElement: () => scrollContainerEl ?? null,
    estimateSize: () => 56,
    overscan: 10,
  });
  const virtualItems = createMemo(() => virtualizer.getVirtualItems());
  const paddingTop = createMemo(() => virtualItems()[0]?.start ?? 0);
  const paddingBottom = createMemo(() => {
    const items = virtualItems();
    return Math.max(0, virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0));
  });

  /**
   * Auto-load next page when the virtualizer's last rendered row is
   * within 20 of the end of the loaded set. Cleaner than an
   * IntersectionObserver sentinel because the virtualizer already
   * tracks visible row indices — no extra DOM node, no observer
   * lifecycle.
   */
  createEffect(() => {
    const items = virtualItems();
    const total = displayedOrders().length;
    if (
      serverMode() &&
      items.length > 0 &&
      total > 0 &&
      items[items.length - 1].index >= total - 20 &&
      query.hasNextPage &&
      !query.isFetchingNextPage
    ) {
      void query.fetchNextPage();
    }
  });

  /**
   * Keep the focused row in view as the user arrows through. Uses
   * the virtualizer's own scroll API so off-screen rows materialise
   * before scrollIntoView can see them. Skips the scroll for mouse-
   * driven hovers — forcibly scrolling on hover would fight the
   * user's scroll input.
   */
  function focusRow(index: number, options: { scroll?: boolean } = {}) {
    setFocusedIndex(index);
    if (options.scroll && index >= 0) {
      virtualizer.scrollToIndex(index, { align: 'auto' });
    }
  }

  /**
   * Reset the focused row to the top whenever the displayed list shape
   * changes from the user typing — after a keystroke, the top result
   * is what the merchant wants to open with Enter.
   */
  createEffect(
    on(searchDraft, () => {
      if (displayedOrders().length > 0) focusRow(0, { scroll: false });
    }),
  );

  /**
   * Global keyboard nav.
   *
   * - `/` (when not already in a text input) focuses the search box
   *   and pre-selects the top result, mirroring the Combobox UX.
   * - `ArrowDown` / `ArrowUp` move the focus through the displayed
   *   set. Works whether the search box has focus (preventDefault
   *   stops the caret from moving) or not.
   * - `Enter` opens the focused order — from the search box too, mirroring the Combobox UX.
   *   `Space` does the same, but never while typing: there it is a character.
   * - `Escape` blurs the search input and clears the focus highlight.
   *
   * `key` checks instead of `code` so non-QWERTY layouts still hit
   * the right shortcut.
   */
  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      const inEditable = isTypingTarget(e);
      const inSearchBox = e.composedPath().includes(searchInputEl as unknown as EventTarget);
      // Allow the global shortcut set to fire from inside the search
      // input too (arrow keys + Enter); '/' is the only one we filter.
      const isOurInput = inSearchBox;

      if (e.key === '/' && !inEditable) {
        e.preventDefault();
        searchInputEl?.focus();
        if (displayedOrders().length > 0) focusRow(0, { scroll: true });
        return;
      }

      // Don't steal keystrokes from other editable surfaces (filter
      // combobox typeahead, Page-size select, future inline editors).
      if (inEditable && !isOurInput) return;

      const max = displayedOrders().length;
      if (max === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = focusedIndex() < 0 ? 0 : Math.min(focusedIndex() + 1, max - 1);
        focusRow(next, { scroll: true });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const next = focusedIndex() < 0 ? 0 : Math.max(focusedIndex() - 1, 0);
        focusRow(next, { scroll: true });
        return;
      }
      // Space opens a row, but only where space is not a character. Inside the search box it is
      // one — an operator typing a customer's full name would otherwise be thrown into whichever
      // order happened to be highlighted, mid-word. Enter and the arrows stay live there, because
      // neither has a meaning in a text field that this steals.
      // ...and never when a control inside the row already means something by them. A focused
      // button or link answers Enter and Space itself, so without this the notes affordance would
      // open its popover *and* navigate away from the row it belongs to — the shortcut firing on
      // top of the activation rather than instead of it.
      if ((e.key === 'Enter' || e.key === ' ') && activatesItself(e)) return;

      if (e.key === 'Enter' || (e.key === ' ' && !inEditable)) {
        const idx = focusedIndex();
        if (idx < 0 || idx >= max) return;
        e.preventDefault();
        const order = displayedOrders()[idx];
        if (order) navigate(`/${order.id}`);
        return;
      }
      if (e.key === 'Escape' && inSearchBox) {
        e.preventDefault();
        searchInputEl?.blur();
        setFocusedIndex(-1);
      }
    };
    document.addEventListener('keydown', handler);
    onCleanup(() => document.removeEventListener('keydown', handler));
  });

  onMount(() => {
    const group = filterGroupEl;
    const bar = toolbarEl;
    if (!group || !bar) return;
    // Enough of a step that re-flowing cannot cross it on its own; small enough that a deliberate
    // drag of the window edge does.
    const WIDEN_BEFORE_FOLDING_BACK = 24;
    const MAX_LINES = 3;
    let lastChangeWidth: number | null = null;
    const measure = (): void => {
      const kids = [...group.children] as HTMLElement[];
      if (kids.length === 0) return;
      // Distinct BOTTOM edges = flex lines. Not tops: the group is `items-end`, and its children
      // are not the same height (the filter-chip wrapper runs ~6px taller than the search box), so
      // one visual line shows several distinct tops and reads as a wrap that never happened.
      // The aligned edge is the one that identifies the line.
      const bottoms: number[] = [];
      for (const kid of kids) {
        const bottom = kid.offsetTop + kid.offsetHeight;
        if (!bottoms.some((b) => Math.abs(b - bottom) <= 4)) bottoms.push(bottom);
      }
      const lines = Math.min(bottoms.length, MAX_LINES);
      const barWidth = bar.clientWidth;
      const current = filterLines();
      if (lines === current) return;

      // Unfolding is free — the toolbar is already that tall. Folding back is what has to be
      // latched, or our own narrowing frees the space that un-wraps the filters that folds us
      // back, ad infinitum at one unlucky window size.
      if (
        lines > current ||
        lastChangeWidth === null ||
        barWidth > lastChangeWidth + WIDEN_BEFORE_FOLDING_BACK
      ) {
        setFilterLines(lines);
        lastChangeWidth = barWidth;
      }
    };
    measure();
    // Both: the group's own height changes when it wraps, and the bar's width is what makes it.
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    observer.observe(bar);
    onCleanup(() => observer.disconnect());
  });

  // Fill from wherever the queue starts down to the viewport bottom, so the table's own bottom edge
  // and horizontal scrollbar stay on screen and the page itself never scrolls. `h-screen` was 100vh
  // measured from the top of the page, not from where the queue begins below the admin bar and the
  // shell's tab strip, and overhung the viewport by exactly that chrome.
  let queueRootEl: HTMLDivElement | undefined;
  const queueHeight = createViewportFill(() => queueRootEl);

  return (
    <div ref={queueRootEl} class="flex flex-col p-4 bg-surface" style={{ height: queueHeight() }}>
      {/* The shell names the surface in its tab strip and carries the gear, so this row exists only
          to host add-on toolbar contributions — and is absent entirely when there are none, rather
          than reserving space above the filters.
          `registerSlot('dispatch.toolbar', { … })` via `window.invflux.dispatch`; contributions
          render in declared order, gated by their `enabled` predicate. */}
      <Show when={toolbarSlots().length > 0}>
        <div class="mb-4 flex shrink-0 items-center justify-end gap-2">
          <For each={toolbarSlots()}>
            {(slot) => (
              <Show when={slot.enabled?.() ?? true}>
                <Dynamic component={slot.component} />
              </Show>
            )}
          </For>
        </div>
      </Show>

      {/* ── Search + filter bar ──
          Two groups, not one wrapping row, mirroring the workbench: the left group wraps
          internally so the chips ride the search row while there is room and drop to their own
          line when there is not, while the right group is `shrink-0` and keeps its corner. A
          single wrapping row would let the first chip that overflows carry the readout down with
          it. */}
      <div ref={toolbarEl} class="mb-2 flex shrink-0 items-start gap-3">
        <div ref={filterGroupEl} class="flex min-w-0 flex-1 flex-wrap items-end gap-3">
          <input
            ref={searchInputEl}
            data-fb-cycle
            type="search"
            // The keyboard affordances move to the tooltip: at this width the placeholder can
            // state what to type or how to reach it, not both, and what to type is what an
            // operator needs while looking at an empty box.
            title={__(
              'Customer, email, or order number… (press / to focus, ↑↓ to navigate, Enter to open)',
            )}
            aria-label={__('Customer, email, or order number')}
            placeholder={__('Customer, email, or order number')}
            class="h-9 w-80 self-end rounded border border-border px-3 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
            value={searchDraft()}
            onInput={(e) => setSearchDraft(e.currentTarget.value)}
          />
          {/*
            Shared chip bar. The bar owns add-menu + popover + clear; we just declare the chips
            above. `cycleScope` spans the search box and the chips in one Tab loop.
          */}
          <div class="grow">
            <FilterBar
              filters={filterChips}
              cycleScope={() => toolbarEl}
              onEditorOpened={(id) => setOpenDimension(FACET_DIMENSIONS[id] ?? null)}
              // Counting stops with the popover: nothing on screen shows a count once it closes,
              // so a request still in flight for it is work nobody will read.
              onEditorClosed={() => setOpenDimension(null)}
            />
          </div>
          <SavedFilterControl
            savedFilters={() => savedFiltersQuery.data?.savedFilters ?? []}
            canManage={() => savedFiltersQuery.data?.canManage === true}
            currentQuery={currentQuery}
            filters={filterChips}
            // `search` is filter state — a view of one customer's orders is worth saving — but it
            // is a toolbar text input rather than a chip, so no descriptor claims it and it would
            // otherwise be described as a parameter this install cannot account for.
            describeExtra={() => [
              {
                keys: ['search'],
                describe: (query) =>
                  typeof query.search === 'string' && query.search !== ''
                    ? {
                        id: 'search',
                        label: _x('Search', 'saved view summary: free-text search, label (noun)'),
                        value: query.search,
                      }
                    : null,
              },
            ]}
            onApply={applySavedQuery}
            onToggle={toggleSavedQuery}
            onCreate={(name, query, colorId) =>
              savedFilterMutation.mutateAsync({ kind: 'create', name, query, colorId })
            }
            onSetPinned={(filter, pinned) =>
              savedFilterMutation.mutateAsync({ kind: 'pin', id: filter.id, pinned })
            }
            onSetColor={(filter, colorId) =>
              savedFilterMutation.mutateAsync({ kind: 'color', id: filter.id, colorId })
            }
            onDelete={(filter) =>
              savedFilterMutation.mutateAsync({ kind: 'delete', id: filter.id })
            }
            onError={(message) => toast.error(message)}
          />
        </div>

        {/* Result-set readout + Refresh, pinned to the top-right out of the wrapping group. The
            readout describes what the QUERY returned, not what the grid contains — which is why it
            belongs on this bar rather than over the table. */}
        {/* Readout beside the buttons on a single-line toolbar, stacked above them once the filter
            group has wrapped — it may then use the lines the left group has already spent.
            Measured, not styled: the trigger is whether the left group wrapped, which no media or
            container query can express (a height container query needs `container-type: size`, and
            this toolbar's height is content-derived, so size containment would collapse it).

            The stacked gaps are `gap-3` to match the filter group's own line spacing — near enough
            that the rows read as sharing the filters' lines. A tighter gap makes this column look
            cramped against them. The `mt-1.5` is the single-row case only, where it sits the
            readout on the search box's baseline rather than on a filter line. */}
        <div
          class="flex min-w-0 items-end gap-3"
          classList={{ 'flex-col': filterLines() >= 2, 'mt-1.5': filterLines() < 2 }}
        >
          {/* A control-height row (`h-9`) rather than text-height, so stacked it occupies the same
              vertical slot a filter line does and the rows below it stay level with the filters. */}
          <span
            class="flex h-9 items-end font-medium tabular-nums text-text-muted"
            title={readoutTitle()}
          >
            {fmt(selectedIds().size)}/{fmt(displayedOrders().length)}/{fmt(readoutTotal())}
          </span>
          <div
            class="flex"
            classList={{
              'flex-col items-end gap-3': filterLines() >= 3,
              'items-center gap-2': filterLines() < 3,
            }}
          >
            {/* Refetches the currently filtered view, so its home is beside the filters. Icon-only;
              while a query is in flight it takes a grey background and the icon spins — which is
              also where "Refreshing…" now lives, rather than in the footer. */}
            <Button
              variant="secondary"
              class="h-9"
              classList={{ 'bg-muted': isRefreshing() }}
              disabled={isRefreshing()}
              aria-label={__('Refresh')}
              title={__('Refresh')}
              onClick={() => (serverMode() ? void query.refetch() : workingSet.reload())}
            >
              <RefreshIcon class={`h-4 w-4${isRefreshing() ? ' animate-spin' : ''}`} />
            </Button>
            {/* Column visibility for the queue table. Beside Refresh because both act on what the
              table shows rather than on what the query asks for. */}
            <Button
              variant="secondary"
              class="h-9"
              aria-label={__('Columns')}
              title={__('Columns')}
              onClick={() => setColumnPickerOpen(true)}
            >
              <ColumnsSettingsIcon class="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Acts on a selection, so it exists only when there is one — an always-present bar reading
          "0 selected" spends a row saying nothing. The count itself moved to the readout above,
          where it sits beside the two numbers that give it scale. */}
      <Show when={selectedIds().size > 0}>
        <div class="mb-2 flex items-center gap-3">
          <BulkTagAssign orderIds={[...selectedIds()]} />
          <Button variant="quiet" size="xs" class="ml-auto underline" onClick={clearSelection}>
            {__('Clear selection')}
          </Button>
        </div>
      </Show>

      <div
        ref={scrollContainerEl}
        class="min-h-0 flex-1 overflow-auto rounded border border-gray-200 bg-surface"
        tabindex="-1"
      >
        <Switch>
          {/* Loading is "nothing to show yet", from whichever source is feeding the table. Page one
              of the replication arrives before the set completes, so this clears as early as a
              paged queue's would. */}
          <Match when={loadingFirstRows()}>
            <div class="text-center text-text-muted text-sm py-6">
              {__('Loading dispatch queue…')}
            </div>
          </Match>
          <Match when={queueError() !== null}>
            <ErrorBanner as="div" class="text-center text-sm py-6">
              {sprintf(
                __('Failed to load orders: %s'),
                queueError()?.message ?? __('unknown error'),
              )}
              <Button
                variant="link"
                size="xs"
                class="ml-2"
                onClick={() => (serverMode() ? void query.refetch() : workingSet.reload())}
              >
                {__('Retry')}
              </Button>
            </ErrorBanner>
          </Match>
          <Match when={!loadingFirstRows() || allOrders().length > 0}>
            <OrderTable
              orders={displayedOrders()}
              virtualItems={virtualItems()}
              paddingTop={paddingTop()}
              paddingBottom={paddingBottom()}
              nativeColumnLabel={ctx.nativeStatus.columnLabel}
              nativeStatusLabel={nativeStatusLabel}
              nativeStatusColor={nativeStatusColor}
              nativeStatusExplanation={(value) =>
                nativeStatusExplanation(ctx.nativeStatus.options, value)
              }
              onOpen={(id) => navigate(`/${id}`)}
              onContextMenu={(order, x, y) => setRowMenu({ order, x, y })}
              selectedIds={selectedIds()}
              onToggleRow={toggleRowSelect}
              allSelected={displayedAllSelected()}
              onToggleAll={toggleSelectAll}
              focusedIndex={focusedIndex()}
              onHoverRow={(idx) => setFocusedIndex(idx)}
              registerRowEl={(idx, el) => {
                if (el) rowEls.set(idx, el);
                else rowEls.delete(idx);
              }}
              columnVisible={columnVisible}
              columns={orderedColumns()}
              manualGateways={ctx.paymentMethods.manualIds ?? []}
            />
          </Match>
        </Switch>
      </div>

      {/* Only paging progress: it belongs at the edge the operator is scrolling toward. The counts
          and the refreshing state moved to the toolbar readout, where they are read before the
          table rather than after it. */}
      <Show when={query.isFetchingNextPage}>
        <div class="mt-2 shrink-0 text-xs text-text-muted">{__('Loading more…')}</div>
      </Show>

      <Show when={rowMenu()}>
        {(menu) => (
          <RowContextMenu
            order={menu().order}
            x={menu().x}
            y={menu().y}
            onPick={(tag) => {
              assignTagWithNoteCheck(tag, [menu().order.id]);
              setRowMenu(null);
            }}
            onManage={() => {
              setRowMenu(null);
              setTagManagerOpen(true);
            }}
            onClose={() => setRowMenu(null)}
          />
        )}
      </Show>

      <Show when={tagNote()}>
        {(note) => (
          <NoteModal
            tag={note().tag}
            onClose={() => setTagNote(null)}
            onSubmit={(text) => {
              assignTagOptimistically(note().tag, note().orderIds, text);
              setTagNote(null);
            }}
          />
        )}
      </Show>

      <Show when={tagManagerOpen()}>
        <TagManagerModal onClose={() => setTagManagerOpen(false)} />
      </Show>

      <Show when={columnPickerOpen()}>
        <ColumnPicker
          columns={orderedColumns()}
          hidden={hiddenColumns()}
          onToggle={toggleColumn}
          // Passing `onMove` is what turns reordering on: the queue renders its columns from this
          // same ordered list, so a stored order is honoured and the handles are not decorative.
          onMove={reorderColumn}
          onReset={resetColumns}
          onClose={() => setColumnPickerOpen(false)}
          // The store's own wording for the host-status column, so the picker and its header agree.
          labelFor={(c) => ('native' === c.id ? ctx.nativeStatus.columnLabel : undefined)}
        />
      </Show>
    </div>
  );
}

/**
 * The `title` on each column header — the long-form explanation of what the column means.
 *
 * **Getters, not strings**, for the same reason `QUEUE_COLUMNS` uses them: this module is evaluated
 * at chunk load, and a `__()` called there resolves before the locale is installed, freezing the
 * English into the bundle. Calling per render costs nothing and is the only form that translates.
 */
const COLUMN_DESCRIPTIONS: Record<QueueColumnId, () => string> = {
  order: () => __('Source-system order id (linked). Click the row to open the detail view.'),
  age: () =>
    __(
      'How long ago the order was created in WooCommerce. Relative units: seconds, minutes, hours, days.',
    ),
  customer: () => __('Billing name + email recorded at checkout.'),
  annotations: () =>
    __(
      'Signals a normal order does not carry — tags applied to it, work it is waiting on a person to do, and notes written on it. Empty on an ordinary order, which is what makes a marked one stand out.',
    ),
  payment: () => __('Payment gateway title at the time of payment. Hover for the gateway id slug.'),
  dispatch: () =>
    __(
      'InvFlux dispatch readiness: Untouched (fresh in the queue), Started (in-progress or correction-blocked), Staged (ready to ship), Shipped, or Cancelled.',
    ),
  native: () =>
    __(
      "The source system's status for this order — what WooCommerce shows in its own Orders list.",
    ),
  stock: () =>
    __(
      "Exceptions on this order's lines — a shortfall against what is committed, or a line whose stock InvFlux does not track. Empty when there is nothing to flag, and the column hides itself when no order on the page has anything.",
    ),
  progress: () => __('Lines staged vs total lines on this order.'),
  shipping_class: () =>
    __(
      "The shipping classes across this order's lines, which a packer needs before packing rather than at the label printer. An order is not obliged to be uniform: 'none, fragile' means some lines are fragile and the rest are not, and is a different order from one reading only 'fragile'.",
    ),
  shipping_method: () =>
    __(
      'How the order ships — the shipping method the customer chose, as they were shown it. A packer needs it before packing: a contracted service can carry packaging obligations. When the order ships as several packages, +N counts the others; hover for every method.',
    ),
  edt: () =>
    __(
      'The date this order should ship by — the promise it is measured against. It turns red once passed. Unless a rule or a manual change sets it, it is 24 hours after payment, or after the order was placed while it is unpaid.',
    ),
};

/**
 * Whether EDT is in the past, and by how many whole days. Derived client-side
 * from `estDispatch`.
 */
function edtLate(iso: string | null): { isLate: boolean; days: number } {
  if (!iso) return { isLate: false, days: 0 };
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return { isLate: false, days: 0 };
  const diffMs = Date.now() - ts;
  if (diffMs <= 0) return { isLate: false, days: 0 };
  return { isLate: true, days: Math.floor(diffMs / 86_400_000) };
}

/**
 * Render EDT as a relative "in X" / "Xd ago" string, at day resolution.
 */
function relativeEdt(iso: string | null): string {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '—';
  const days = Math.round((ts - Date.now()) / 86_400_000);
  if (days === 0) return _x('today', 'ship-by date: it falls today (lower case)');
  if (days === 1) return _x('tomorrow', 'ship-by date: it falls tomorrow (lower case)');
  if (days === -1) return _x('yesterday', 'ship-by date: it fell yesterday (lower case)');
  return days > 0
    ? sprintf(_n('in %dd', 'in %dd', days), days)
    : sprintf(_n('%dd ago', '%dd ago', -days), -days);
}

/**
 * Shipped or closed: the order has left the queue's work. Its promise date and its stock concerns
 * are history, not alarms — a closed order cannot be made late or short by anything a packer does.
 */
function isSettledOrder(order: DispatchOrderSummary): boolean {
  return order.status === 'Shipped' || order.workflowState === 'Closed';
}

/** A settled order's date, in place of its promise: when it shipped, or when it was closed. */
function settledOn(order: DispatchOrderSummary): string {
  const shipped = order.status === 'Shipped';
  // A shipped order InvFlux did not ship itself — completed in WooCommerce before InvFlux ran, or
  // imported — has no shipment record; the moment it was closed is the nearest honest date.
  const iso = shipped ? (order.shippedAt ?? order.closedAt ?? null) : (order.closedAt ?? null);
  const ts = iso === null ? Number.NaN : Date.parse(iso);
  if (Number.isNaN(ts)) return '—';
  const date = formatDate(ts, '—', { month: 'short', day: 'numeric', year: 'numeric' });
  return shipped
    ? sprintf(
        /* translators: %s: the date the order shipped. */ _x('shipped %s', 'dispatch date column'),
        date,
      )
    : sprintf(
        /* translators: %s: the date the order was closed. */ _x(
          'closed %s',
          'dispatch date column',
        ),
        date,
      );
}

/**
 * The promise date in full, in the host's locale — the cell shows it relative ("3d late"), so the
 * tooltip is where the actual date lives. Day-level, like the promise itself.
 */
function edtTitle(iso: string | null): string | undefined {
  if (!iso) return undefined;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return undefined;

  return formatDate(ts, '', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** When a settled order shipped or closed, to the minute, in the reader's locale. */
function settledTitle(order: DispatchOrderSummary): string | undefined {
  const iso =
    order.status === 'Shipped'
      ? (order.shippedAt ?? order.closedAt ?? null)
      : (order.closedAt ?? null);

  return iso === null ? undefined : formatWallClock(iso);
}

function OrderTable(props: {
  orders: DispatchOrderSummary[];
  /** Virtual rows from the parent's TanStack virtualizer. */
  virtualItems: VirtualItem[];
  paddingTop: number;
  paddingBottom: number;
  nativeColumnLabel: string;
  nativeStatusLabel: (value: string) => string;
  nativeStatusColor: (value: string) => number;
  /** What the status means, for the pill's tooltip. */
  nativeStatusExplanation: (value: string) => string;
  onOpen: (id: string) => void;
  onContextMenu: (order: DispatchOrderSummary, x: number, y: number) => void;
  selectedIds: Set<string>;
  onToggleRow: (id: string) => void;
  allSelected: boolean;
  onToggleAll: () => void;
  /** -1 = no row currently focused. */
  focusedIndex: number;
  onHoverRow: (index: number) => void;
  registerRowEl: (index: number, el: HTMLTableRowElement | null) => void;
  /** Operator's column choices — see queueColumns.ts. */
  columnVisible: (id: QueueColumnId) => boolean;
  /** Every column, in the operator's order. Hiding is still `columnVisible`'s answer, not absence
   *  from this list, so the picker and the table are driven by one sequence. */
  columns: QueueColumn[];
  /**
   * Gateway ids that cannot refund or capture through the API.
   *
   * Passed down rather than read from the dispatch context here, so this component stays a pure
   * function of its props and the queue's one source for "what is this order waiting on" is the
   * caller's — the same value the facet counts are computed against.
   */
  manualGateways: readonly string[];
}) {
  /**
   * Hide the Stock column when nothing on the current page would
   * render anything in it. Concerns are exception markers — most
   * queue rows show no badge, and a column of blank dashes wastes
   * horizontal real estate that the Customer / Payment cells
   * could use. We re-evaluate per render so a refetch that brings
   * a concern back in surfaces the column again automatically.
   */
  const showStockColumn = createMemo(
    () =>
      props.columnVisible('stock') &&
      props.orders.some((o) => o.stockState !== 0 || o.hasUnmanagedLine),
  );
  /**
   * Whether a column renders at all — the operator's choice, plus `stock`'s own emptiness gate.
   *
   * One predicate rather than two, because the header, the cells and the spacers' `colspan` must
   * agree exactly: a column that appears in one and not the others is a table whose columns are
   * offset by one, which reads as every value being wrong rather than as one column missing.
   */
  const visible = (col: QueueColumn): boolean =>
    col.id === 'stock' ? showStockColumn() : props.columnVisible(col.id);

  /** The column's own label — `native` excepted, whose header is the *store's* wording for its own
   *  status field and arrives as a prop. */
  const label = (col: QueueColumn): string =>
    col.id === 'native' ? props.nativeColumnLabel : col.label();

  /**
   * Header count for the full-width rows (empty state, and the virtualizer's two spacers). Derived
   * rather than a constant: it has to follow both gates, and a stale number leaves the spacers
   * short, which shows up as a scroll height that drifts from the row count.
   */
  const colSpan = createMemo(
    () =>
      1 + // the selection checkbox, which is structure and never hidden
      props.columns.filter(visible).length,
  );

  /**
   * One row's cell for one column.
   *
   * Takes the order as an **accessor**, not a value: the cells are created once per row by the
   * `<For>` over columns, so reading the row eagerly here would freeze each cell on the data it
   * first rendered with and a poll would update nothing.
   */
  const cell = (col: QueueColumn, order: () => DispatchOrderSummary): JSX.Element => {
    switch (col.id) {
      case 'order':
        return (
          <td class="px-3 py-2">
            <A
              href={`/${order().id}`}
              class="font-mono text-primary hover:text-primary-hover font-medium"
              onClick={(e) => e.stopPropagation()}
            >
              #{order().externalId}
            </A>
          </td>
        );
      case 'age':
        return (
          <td class="px-3 py-2 text-xs text-gray-500 tabular-nums whitespace-nowrap">
            {relativeAge(order().createdAt)}
          </td>
        );
      case 'customer':
        return (
          <td class="px-3 py-2">
            <div class="font-medium text-gray-800">{order().customerName}</div>
            <div class="text-xs text-text-muted">{order().customerEmail}</div>
          </td>
        );
      case 'annotations':
        return (
          <td class="px-3 py-2">
            <div class="flex flex-col items-start gap-1">
              <Show when={(order().tags?.length ?? 0) > 0}>
                <TagPillRow tags={order().tags} />
              </Show>
              {/*
                Above the notes, because what the order is *waiting on someone to do* outranks what
                someone has already written about it — a row that needs an operator should not have
                to be read past a note to be noticed.
              */}
              <PendingActionChips order={order()} manualGateways={props.manualGateways} />
              <OrderNotesCell order={order()} />
            </div>
          </td>
        );
      case 'payment':
        return (
          <td
            class="px-3 py-2 text-xs text-gray-700 whitespace-nowrap"
            title={order().paymentMethod ?? undefined}
            data-payment-method={order().paymentMethod ?? ''}
          >
            <Show when={order().paymentMethodTitle} fallback={<span class="text-gray-300">—</span>}>
              {order().paymentMethodTitle}
            </Show>
          </td>
        );
      case 'dispatch':
        return (
          <td class="px-3 py-2">
            <OrderStatusChip status={order().status} />
          </td>
        );
      case 'native':
        return (
          <td class="px-3 py-2">
            <Show when={order().wcStatus} fallback={<span class="text-xs text-gray-300">—</span>}>
              <Pill
                colorId={props.nativeStatusColor(order().wcStatus!)}
                title={props.nativeStatusExplanation(order().wcStatus!)}
              >
                {props.nativeStatusLabel(order().wcStatus!)}
              </Pill>
            </Show>
          </td>
        );
      case 'stock':
        return (
          <td class="px-3 py-2">
            <Show when={!isSettledOrder(order())}>
              <StockConcernBadge
                bits={order().stockState}
                unmanaged={order().hasUnmanagedLine}
                shortQty={order().stockShortQty}
              />
            </Show>
          </td>
        );
      case 'progress':
        return (
          <td class="px-3 py-2 text-gray-600 tabular-nums">
            <StagingProgress
              staged={order().stagedCount}
              lines={order().lineCount}
              settled={order().settledCount ?? 0}
            />
          </td>
        );
      case 'shipping_class':
        return (
          <td class="px-3 py-2 text-xs whitespace-nowrap">
            <Show
              when={(order().shippingClasses ?? []).length > 0}
              fallback={<span class="text-gray-300">—</span>}
            >
              {/*
                Joined for reading, never for matching — the filter keys on the lines server-side.
                `none` is muted because it is the *absence* of an obligation: on a mixed order the
                real class is the word a packer has to act on, and giving both equal weight makes
                them hunt for it. It still renders, because "some lines are unclassified" is a fact
                about the parcel and an empty cell would not say it.
              */}
              <For each={order().shippingClasses ?? []}>
                {(cls, i) => (
                  <>
                    <Show when={i() > 0}>
                      <span class="text-gray-300">, </span>
                    </Show>
                    <span classList={{ 'text-gray-400 italic': cls === 'none' }}>
                      {cls === 'none'
                        ? _x('none', 'shipping class: the order has none (lower case)')
                        : cls}
                    </span>
                  </>
                )}
              </For>
            </Show>
          </td>
        );
      case 'shipping_method':
        return (
          <td
            class="px-3 py-2 text-xs text-gray-700 whitespace-nowrap"
            // The id is the key the filter uses; hovering shows it, and every method on a split.
            title={(order().shippingMethods ?? []).join(', ') || undefined}
            data-shipping-method={order().shippingMethod ?? ''}
          >
            <Show
              when={order().shippingMethodTitle}
              fallback={<span class="text-gray-300">—</span>}
            >
              {order().shippingMethodTitle}
              {/* A second package is a fact about the parcel, so it is counted rather than
                  hidden behind the first package's name. */}
              <Show when={(order().shippingCount ?? 0) > 1}>
                <span class="ml-1 text-text-muted">+{(order().shippingCount ?? 1) - 1}</span>
              </Show>
            </Show>
          </td>
        );
      case 'edt':
        return (
          <Show
            when={!isSettledOrder(order())}
            fallback={
              <td
                class="px-3 py-2 text-xs tabular-nums whitespace-nowrap text-text-muted"
                title={settledTitle(order())}
              >
                {settledOn(order())}
              </td>
            }
          >
            <td
              class="px-3 py-2 text-xs tabular-nums whitespace-nowrap"
              classList={{
                'text-red-600 font-medium': edtLate(order().estDispatch).isLate,
                'text-gray-500': !edtLate(order().estDispatch).isLate,
              }}
              title={edtTitle(order().estDispatch)}
            >
              {/* Late says it once: "28d ago · 28d late" gave the same number twice, since both
                  halves were measured from the same date. The date itself is in the title. */}
              {edtLate(order().estDispatch).days > 0
                ? sprintf(
                    /* translators: %d: whole days past the estimated dispatch date. */
                    _x('%dd late', 'dispatch date column'),
                    edtLate(order().estDispatch).days,
                  )
                : relativeEdt(order().estDispatch)}
            </td>
          </Show>
        );
    }
  };

  return (
    /*
      `data-testid` because nothing else here is a stable, locale-independent handle on "the queue
      is up": inside the unified shell this surface renders no heading of its own (the tab strip
      names it), and every visible string is translated. The table is also the sharper landmark —
      it mounts only once the query has settled, so it cannot be satisfied by the loading
      placeholder standing in its place.
    */
    <table class="w-full border-collapse text-sm" data-testid="dispatch-queue">
      <thead class="sticky top-0 z-10 bg-gray-50">
        <tr class="border-b border-gray-200">
          <th class="w-8 px-3 py-2">
            <input
              type="checkbox"
              class="cursor-pointer align-middle"
              checked={props.allSelected}
              title={__('Select all loaded orders')}
              onChange={props.onToggleAll}
            />
          </th>
          {/*
            Headers and cells both loop over the same ordered list, so an operator's reordering
            cannot desynchronise them. One of these columns carries the sparse signal — tags,
            pending actions and notes together, because a normal order carries none of them. Parked
            inside Customer, which has a value on every row, any of them was invisible; the eye
            stops reading a column that is never empty. The pending actions run the same predicates
            as the `pending_action` filter, so a row showing a chip is exactly a row that filter
          */}
          <For each={props.columns}>
            {(col) => (
              <Show when={visible(col)}>
                <Th label={label(col)} title={COLUMN_DESCRIPTIONS[col.id]()} />
              </Show>
            )}
          </For>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
        <Show
          when={props.orders.length > 0}
          fallback={
            <tr>
              <td colspan={colSpan()} class="px-3 py-6 text-center text-text-muted text-sm">
                {__('No orders match.')}
              </td>
            </tr>
          }
        >
          {/*
            Virtualization: the parent's createVirtualizer gives us only
            the slice of rows that fall in the visible window + overscan.
            Two spacer rows preserve the total scroll height — top
            padding pushes the visible slice down to its real offset,
            bottom padding fills the remainder so the scrollbar tracks
            the full dataset. Matches Central Workbench's setup.
          */}
          <tr>
            <td style={{ height: `${props.paddingTop}px` }} colspan={colSpan()} />
          </tr>
          <For each={props.virtualItems}>
            {(virtualRow) => {
              const order = () => props.orders[virtualRow.index];
              const index = virtualRow.index;
              return (
                <Show when={order()}>
                  {(safeOrder) => (
                    <tr
                      ref={(el) => props.registerRowEl(index, el)}
                      class={[
                        'cursor-pointer transition-colors',
                        // Row striping is conditional so the focused row's
                        // highlight reads cleanly even on an odd row. Hover/
                        // keyboard focus are both modelled by `focusedIndex`
                        // — no `hover:` Tailwind class — so the visible
                        // selection follows the mouse OR the arrow keys with
                        // identical paint.
                        props.focusedIndex === index
                          ? 'bg-gray-200'
                          : index % 2 === 1
                            ? 'bg-gray-50'
                            : '',
                      ].join(' ')}
                      onMouseEnter={() => props.onHoverRow(index)}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                        if (e.defaultPrevented) return;
                        props.onOpen(safeOrder().id);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        props.onContextMenu(safeOrder(), e.clientX, e.clientY);
                      }}
                    >
                      <td class="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          aria-label={__('Select row')}
                          type="checkbox"
                          class="cursor-pointer align-middle"
                          checked={props.selectedIds.has(safeOrder().id)}
                          onChange={() => props.onToggleRow(safeOrder().id)}
                        />
                      </td>
                      <For each={props.columns}>
                        {(col) => <Show when={visible(col)}>{cell(col, safeOrder)}</Show>}
                      </For>
                    </tr>
                  )}
                </Show>
              );
            }}
          </For>
          <tr>
            <td style={{ height: `${props.paddingBottom}px` }} colspan={colSpan()} />
          </tr>
        </Show>
      </tbody>
    </table>
  );
}

/**
 * Lines staged out of the order's total, with a slim fill **only while it is part-way**.
 *
 * The count carries the information: it is exact, and "how many lines are left" is the question a
 * picker actually has — a fraction is not, since 2/5 and 4/10 draw the same bar and mean different
 * amounts of work. The fill is a scanning aid layered on top, not a second copy of the number.
 *
 * **Drawn only on the partial rows, and that is the whole design.** Not-started is the overwhelming
 * majority (and a quarter of orders have a single line, where a bar has two states and says less
 * than `0/1` does); complete is already unmissable, carried by the `Staged` chip and by the sort
 * floating those rows to the top. Marking every row would spend ink on the states that need none,
 * in a column that has a value on every row — and it would compete with the sparse-signal column
 * next to it, which exists precisely to be the thing that catches the eye.
 *
 * What is left is the one state nothing else marks: someone is mid-pick on this order right now.
 *
 * **Over the work that remains.** A line with nothing left to do — fully corrected, or fully
 * shipped — leaves both numbers (see `remainingProgress()`), so five lines with two corrected away
 * and three staged read `3/3`, not `5/5`. An order with nothing left to stage shows a dash.
 */
function StagingProgress(props: { staged: number; lines: number; settled: number }) {
  const progress = () => remainingProgress(props.staged, props.lines, props.settled);
  const partial = (): boolean => progress().done > 0 && progress().done < progress().remaining;
  const pct = (): number =>
    progress().remaining > 0 ? Math.round((progress().done / progress().remaining) * 100) : 0;

  return (
    <div class="inline-flex flex-col gap-1">
      <span>{progress().remaining === 0 ? '—' : `${progress().done}/${progress().remaining}`}</span>
      {/*
        `aria-hidden`: the count beside it already says this, and a screen reader reading a
        decorative bar as a second value is noise, not access.
      */}
      <Show when={partial()}>
        <span class="block h-1 w-10 overflow-hidden rounded-full bg-border" aria-hidden="true">
          <span class="block h-full rounded-full bg-primary" style={{ width: `${pct()}%` }} />
        </span>
      </Show>
    </div>
  );
}

/**
 * Whether the event is already headed for something that treats Enter/Space as activation.
 *
 * The queue's row shortcuts are global — they fire wherever focus happens to be — so anything
 * focusable *inside* a row would otherwise get its keypress twice over: once by the control, once
 * by the queue. `isTypingTarget` covers text entry; this covers the other half, the controls that
 * are activated rather than typed into.
 */
function activatesItself(event: Event): boolean {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLButtonElement || node instanceof HTMLAnchorElement) return true;
    if (node instanceof HTMLElement && node.getAttribute('role') === 'button') return true;
  }

  return false;
}

function Th(props: { label: string; title: string }) {
  return (
    <th
      class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide cursor-help"
      title={props.title}
    >
      {props.label}
    </th>
  );
}

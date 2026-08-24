import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from 'solid-js';
import { __ } from '@invflux/i18n';
import { A, useLocation, useNavigate, useSearchParams } from '@solidjs/router';
import { createVirtualizer, type VirtualItem } from '@tanstack/solid-virtual';
import {
  Button,
  FILTER_CONTROL_MULTISELECT,
  FILTER_CONTROL_MULTISELECT_ASYNC,
  FILTER_CONTROL_NUMERIC_IDS,
  FilterBar,
  FilterModeToggle,
  GearIcon,
  Modal,
  StockConcernBadge,
  buttonClass,
  iconButtonClass,
  slotRegistry,
  type ComboboxOption,
  type FilterDescriptor,
  isTypingTarget,
  useSurface,
  Pill,
  WC_ORDER_STATUS_COLOR,
  WC_ORDER_STATUS_FALLBACK_COLOR,
} from '@invflux/ui';
import { Dynamic } from 'solid-js/web';
import { useDispatch } from '../context';
import { useListStore } from '../listStore';
import { BulkTagAssign, FILTER_CONTROL_TAGS, NoteModal, RowContextMenu, TagPillRow, TagManagerModal, tagNeedsNote } from '../components/OrderTags';
import { DEFAULT_PER_PAGE, DispatchSettingsPanel, parsePerPage } from '../components/DispatchSettings';
import { OrderStatusChip, STATUS_LABEL } from '../components/OrderStatusChip';
import {
  useBulkAssignTagsMutation,
  useDispatchOrdersQuery,
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

const fmt = (n: number) => new Intl.NumberFormat().format(n);

/** Server-search debounce: 200ms after last keystroke per F21 UX revision. */
const SEARCH_DEBOUNCE_MS = 200;

const STATUS_OPTIONS: ComboboxOption[] = [
  { value: 'Untouched', label: 'Untouched' },
  { value: 'Started', label: 'Started' },
  { value: 'Staged', label: 'Staged' },
  { value: 'Shipped', label: 'Shipped' },
  { value: 'Cancelled', label: 'Cancelled' },
];

/**
 * The palette entry InvFlux *ships* for a host status, keyed on the unprefixed slug as it lands on
 * the URL. Chosen alongside the InvFlux dispatch status this pill renders next to.
 *
 * This is only the second of three steps — see `nativeStatusColor` in the component, which puts the
 * merchant's own choice ahead of it. On its own it returns grey for any status InvFlux has never
 * heard of, which is exactly why the configured colour has to come first: a merchant running three
 * custom statuses would otherwise read three identical pills on a scan-first surface.
 */
function shippedStatusColor(value: string): number {
  return WC_ORDER_STATUS_COLOR[value] ?? WC_ORDER_STATUS_FALLBACK_COLOR;
}

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
function parseWorkflowList(raw: string | undefined, known: Set<string>): OrderWorkflowState[] | undefined {
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
    tag_id?: string;
    tag_match?: string;
    pending_manual_refund?: string;
    search?: string;
    per_page?: string;
  }>();

  const [searchDraft, setSearchDraft] = createSignal(searchParams.search ?? '');

  // Keyboard-driven row focus. -1 means "no row focused" — the user
  // hasn't started navigating yet, so we don't paint anything
  // highlighted. Once they hit ArrowDown (or '/'-then-anything) the
  // index jumps to 0 and stays under their control until they Escape.
  const [focusedIndex, setFocusedIndex] = createSignal(-1);
  // Right-click row menu (tag-assign surface). The assign mutation + tag manager
  // are owned here (not in the menu) so they outlive the menu closing.
  const [rowMenu, setRowMenu] = createSignal<{ order: DispatchOrderSummary; x: number; y: number } | null>(null);
  // A tag needing a note (governance RequireNoteOnAdd) opens this modal before assigning.
  const [tagNote, setTagNote] = createSignal<{ tag: TagSummary; orderIds: string[] } | null>(null);
  const assignTagWithNoteCheck = (tag: TagSummary, orderIds: string[]): void => {
    if (tagNeedsNote(tag)) {
      setTagNote({ tag, orderIds });
      return;
    }
    assignTags.mutate({ orderIds, tagIds: [tag.id] });
  };
  const [showSettings, setShowSettings] = createSignal(false);
  const [tagManagerOpen, setTagManagerOpen] = createSignal(false);
  // Inside the unified app shell the surface title and settings are the shell's to render — it names
  // the surface in its tab strip and carries the contextual gear (the panel is registered once for
  // the whole surface, in this SPA's router root, so it survives opening an order). Standalone there
  // is no shell, so this view keeps its own heading, gear and modal.
  const surface = useSurface();
  const toolbarSlots = (): ReturnType<typeof slotRegistry.get<DispatchToolbarSlotProps>> =>
    slotRegistry.get<DispatchToolbarSlotProps>('dispatch.toolbar');
  const assignTags = useBulkAssignTagsMutation();
  let searchInputEl: HTMLInputElement | undefined;
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

  const filters = createMemo<DispatchQueueFilters>(() => ({
    status: parseStatusList(searchParams.status),
    workflowState: parseWorkflowList(searchParams.workflow_state, knownWorkflowValues()),
    // Bake the adapter-provided default in at parse time so the server
    // receives the same filter the user sees. URL absent → default
    // applies. URL present-but-empty → no filter (explicit override).
    wcStatus: parseNativeStatusList(searchParams.wc_status)
      ?? ctx.nativeStatus.defaultSelected,
    worksheetIds: parseGenericList(searchParams.worksheet_id),
    skus: parseGenericList(searchParams.sku),
    // Domain-key filter set by the workbench "Orders" link (dash-joined to keep the URL free of
    // encoded commas). Normalise dashes to the shared comma parser; the server accepts both.
    subjectIds: parseGenericList(searchParams.subject_ids?.replace(/-/g, ',')),
    paymentMethods: parseGenericList(searchParams.payment_method),
    tagIds: parseGenericList(searchParams.tag_id),
    tagMatch: searchParams.tag_match === 'all' ? 'all' : undefined,
    pendingManualRefund: searchParams.pending_manual_refund === '1' || undefined,
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

  const query = useDispatchOrdersQuery(filters);

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
   * Flat list of every order across all loaded pages. The infinite
   * query's `pages` array preserves chunk boundaries, but the table
   * doesn't care — it just wants one ordered sequence.
   */
  const allOrders = createMemo<DispatchOrderSummary[]>(() =>
    (query.data?.pages ?? []).flatMap((p) => p.orders),
  );

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
        o.customerName.toLowerCase().includes(needle)
        || o.customerEmail.toLowerCase().includes(needle)
        || o.externalId.toLowerCase().includes(needle),
    );
  });

  const totalCount = createMemo(() => query.data?.pages[0]?.total ?? 0);

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

  const nativeStatusOptions = createMemo<ComboboxOption[]>(() => {
    const known = new Map<string, ComboboxOption>();
    for (const opt of ctx.nativeStatus.options) known.set(opt.value, opt);
    for (const order of allOrders()) {
      if (order.wcStatus && !known.has(order.wcStatus)) {
        known.set(order.wcStatus, { value: order.wcStatus, label: order.wcStatus });
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
    return nativeStatusColorIds().get(value) ?? shippedStatusColor(value);
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
    const covering = workflowOptions().filter((o) => o.includesSuppressed).map((o) => o.value);
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

  function changePerPage(value: number): void {
    setSearchParams({
      per_page: value === DEFAULT_PER_PAGE ? undefined : String(value),
    });
  }

  /** Pretty "Label, Label +N" summary for a chip's current selection. */
  function summarize(values: string[], lookup: (v: string) => string): string {
    if (values.length === 0) return '';
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
  const filterChips = createMemo<FilterDescriptor[]>(() => {
    const chips: FilterDescriptor[] = [];

    // Dispatch Status — fully optional. The chip surfaces when the
    // operator explicitly picked at least one status.
    {
      const selected = filters().status ?? [];
      chips.push({
        id: 'status',
        label: 'Dispatch Status',
        type: FILTER_CONTROL_MULTISELECT,
        active: selected.length > 0,
        summary: summarize(selected, (v) => STATUS_LABEL[v as OrderStatus] ?? v),
        placeholder: 'All',
        value: () => filters().status ?? [],
        options: () => STATUS_OPTIONS,
        onChange: (values) => setSearchParams({ status: values.length > 0 ? values.join(',') : undefined }),
        clear: () => setSearchParams({ status: undefined }),
      });
    }

    // Workflow State — options, labels and default all come from the
    // adapter (`ctx.workflowState`), so an add-on that registers a
    // state server-side gets its option here without this package
    // knowing the state exists. The chip becomes active the moment
    // the URL carries any `workflow_state` token, including the
    // explicit-empty sentinel. The latter lets the operator "show all
    // workflows" (a state the default-applies-when-absent contract
    // can't otherwise express) and keeps the chip pill visible so they
    // can re-enter the popover.
    {
      const effective = effectiveWorkflow();
      const overrides = searchParams.workflow_state !== undefined;
      chips.push({
        id: 'workflow',
        label: ctx.workflowState.filterLabel,
        type: FILTER_CONTROL_MULTISELECT,
        // Surface the chip whenever a filter is in effect — including the
        // adapter default applied on a silent URL (so the operator sees the
        // cut they're looking at), not only on an explicit override.
        active: overrides || effective.length > 0,
        summary: summarize(effective, workflowLabel),
        placeholder: summarize(ctx.workflowState.defaultSelected, workflowLabel),
        // CRITICAL: `value` must read reactively at call time, not
        // close over the snapshotted `effective`. FilterBar opens
        // the popover via `untrack` so the descriptor object is
        // captured at open-time; only the accessor itself is
        // re-invoked when something changes. A `() => effective`
        // closure returns the stale value forever — checkbox state
        // in the dropdown would never reflect the URL update.
        value: () => effectiveWorkflow(),
        options: () => workflowOptions(),
        // Emit the sentinel — not `''` — when the operator unchecks
        // every value. `''` would be stripped by Solid Router's
        // `mergeSearchString` so the URL would lose its
        // `workflow_state` param entirely, and the default would
        // silently re-apply (the user's click would have no
        // visible effect). The sentinel survives the round-trip
        // so the explicit no-filter state is reachable.
        onChange: (values) => setSearchParams({
          workflow_state: values.length > 0 ? values.join(',') : NO_FILTER_SENTINEL,
        }),
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
        label: ctx.nativeStatus.filterLabel,
        type: FILTER_CONTROL_MULTISELECT,
        // As with workflow: show the chip when the adapter default (e.g.
        // `Processing`) is applied on a silent URL, not just on an explicit
        // override — so the default cut is visible, not hidden behind "Add filter".
        active: overrides || effective.length > 0,
        summary: summarize(effective, (v) => nativeStatusLabel(v)),
        placeholder: 'All',
        // Reactive read at call time — see the comment on the
        // workflow chip's `value` for the same reason.
        value: () => effectiveNativeStatus(),
        options: () => nativeStatusOptions(),
        // Sentinel for explicit-empty (see workflow chip).
        onChange: (values) => setSearchParams({
          wc_status: values.length > 0 ? values.join(',') : NO_FILTER_SENTINEL,
        }),
        clear: () => setSearchParams({ wc_status: undefined }),
      });
    }

    // Payment Method — multi-select, fully optional (no default). Options come
    // from the adapter's registered gateways; OR-matches the order's gateway.
    {
      const selected = filters().paymentMethods ?? [];
      chips.push({
        id: 'payment_method',
        label: ctx.paymentMethods.filterLabel,
        type: FILTER_CONTROL_MULTISELECT,
        active: selected.length > 0,
        summary: summarize(selected, paymentMethodLabel),
        placeholder: 'Any',
        value: () => filters().paymentMethods ?? [],
        options: () => paymentMethodOptions(),
        onChange: (values) => setSearchParams({
          payment_method: values.length > 0 ? values.join(',') : undefined,
        }),
        clear: () => setSearchParams({ payment_method: undefined }),
      });
    }

    // Worksheet — multi-select. Pre-loaded options; OR semantics on
    // the server (the chip's `multiselect` control reflects that).
    {
      const selected = filters().worksheetIds ?? [];
      chips.push({
        id: 'worksheet',
        label: 'Worksheet',
        type: FILTER_CONTROL_MULTISELECT,
        active: selected.length > 0,
        summary: summarize(selected, worksheetLabel),
        placeholder: 'Any',
        value: () => filters().worksheetIds ?? [],
        options: () =>
          worksheetOptionsQuery.data?.map((o) => ({ value: o.value, label: o.label })) ?? [],
        onChange: (values) => setSearchParams({
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
        label: 'Tags',
        // Custom control: the same pill picker the right-click menu uses (colours +
        // usage counts), instead of the plain multiselect dropdown.
        type: FILTER_CONTROL_TAGS,
        active: selected.length > 0,
        summary: summarize(selected, tagLabel),
        placeholder: 'Any',
        value: () => filters().tagIds ?? [],
        options: () => (tagsQuery.data ?? []).map((t) => ({ value: String(t.id), label: t.name })),
        // Any/All match-mode toggle on the popover title row.
        extra: () => (
          <FilterModeToggle
            modes={[{ value: 'any', label: 'Any' }, { value: 'all', label: 'All' }]}
            value={() => (searchParams.tag_match === 'all' ? 'all' : 'any')}
            onChange={(m) => setSearchParams({ tag_match: m === 'all' ? 'all' : undefined })}
          />
        ),
        onChange: (values) => setSearchParams({
          tag_id: values.length > 0 ? values.join(',') : undefined,
          ...workflowWideningFor(values),
        }),
        clear: () => setSearchParams({ tag_id: undefined, tag_match: undefined }),
      });
    }

    // Products (subject ids) — the affordance for the `subject_ids` filter usually
    // set by the workbench "Orders" link. The `numeric_ids` textarea control lets
    // you view / paste / clear the dash-joined id list.
    {
      const selected = filters().subjectIds ?? [];
      chips.push({
        id: 'subject',
        label: 'Products',
        type: FILTER_CONTROL_NUMERIC_IDS,
        active: selected.length > 0,
        summary: selected.length > 0 ? `${selected.length} product${selected.length === 1 ? '' : 's'}` : '',
        placeholder: 'e.g. 3, 4, 6, 734',
        value: () => filters().subjectIds ?? [],
        options: () => [],
        onChange: (values) => setSearchParams({
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
        label: 'SKU',
        type: FILTER_CONTROL_MULTISELECT_ASYNC,
        active: selected.length > 0,
        summary: summarize(selected, skuLabel),
        placeholder: 'Type 3+ characters…',
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
        onChange: (values) => setSearchParams({
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
      items.length > 0
      && total > 0
      && items[items.length - 1].index >= total - 20
      && query.hasNextPage
      && !query.isFetchingNextPage
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
   * - `Enter` / `Space` opens the focused order.
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
      if (e.key === 'Enter' || e.key === ' ') {
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

  return (
    <div class="h-screen flex flex-col p-4 bg-white">
      {/* The shell already names the surface in its tab strip and carries the gear, so in the unified
          app this row exists only to host add-on toolbar contributions — and collapses when there are
          none, rather than reserving space for a heading the shell renders. */}
      <Show when={!surface || toolbarSlots().length > 0}>
        <div class="flex items-center justify-between mb-4 shrink-0">
          <Show when={!surface}>
            <h1 class="text-lg font-semibold text-gray-900">{__('Dispatch queue')}</h1>
          </Show>
          {/*
            Plug-in toolbar slot. Add-ons
            target this with `registerSlot('dispatch.toolbar', { … })`
            via `window.invflux.dispatch`. Contributions render in
            declared order, gated by their `enabled` predicate.
          */}
          <div class="flex items-center gap-2 ml-auto">
            <For each={toolbarSlots()}>
              {(slot) => (
                <Show when={slot.enabled?.() ?? true}>
                  <Dynamic component={slot.component} />
                </Show>
              )}
            </For>
            <Show when={!surface}>
              <button
                type="button"
                class={iconButtonClass('md', false, 'h-9 w-9 border border-border bg-surface shadow-sm')}
                onClick={() => setShowSettings(true)}
                aria-label={__('Settings')}
                title={__('Settings')}
              >
                <GearIcon class="h-5 w-5" />
              </button>
            </Show>
          </div>
        </div>
      </Show>

      <div class="mb-2 space-y-2 shrink-0">
        <div class="flex flex-wrap items-end gap-3">
          {/*
            Shared chip bar. Status,
            Workflow, WC, Worksheet, SKU — five chips, three
            multiselect-sync, one multiselect, one multiselect:async.
            The bar owns add-menu + popover + clear; we just declare
            the chips above.
          */}
          <div class="grow">
            <FilterBar filters={filterChips} />
          </div>
          <button
            type="button"
            class={buttonClass(
              'secondary',
              'sm',
              `h-9 self-end ${filters().pendingManualRefund ? 'border-amber-400 bg-amber-50 text-amber-800' : ''}`,
            )}
            title={__('Show only orders with an unsettled manual refund')}
            aria-pressed={filters().pendingManualRefund ? 'true' : 'false'}
            onClick={() => setSearchParams({
              pending_manual_refund: filters().pendingManualRefund ? undefined : '1',
            })}
          >
            {__('Pending manual refunds')}
          </button>
        </div>

        <input
          ref={searchInputEl}
          type="search"
          placeholder={__('Customer, email, or order number… (press / to focus, ↑↓ to navigate, Enter to open)')}
          class="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
          value={searchDraft()}
          onInput={(e) => setSearchDraft(e.currentTarget.value)}
        />
      </div>

      <div class="mb-2 flex items-center gap-3">
        <span class="font-medium text-gray-500 py-1">{selectedIds().size} selected</span>
        <Show when={selectedIds().size > 0}>
          <BulkTagAssign orderIds={[...selectedIds()]} />
          <Button
            variant="quiet"
            size="xs"
            class="ml-auto underline"
            onClick={clearSelection}
          >
            {__('Clear selection')}
          </Button>
        </Show>
      </div>

      <div
        ref={scrollContainerEl}
        class="min-h-0 flex-1 overflow-auto rounded border border-gray-200 bg-white"
        tabindex="-1"
      >
        <Switch>
          <Match when={query.isLoading && allOrders().length === 0}>
            <div class="text-center text-text-muted text-sm py-6">{__('Loading dispatch queue…')}</div>
          </Match>
          <Match when={query.isError}>
            <div class="text-center text-red-600 text-sm py-6">
              Failed to load orders: {query.error?.message ?? 'unknown error'}
              <Button
                variant="link"
                size="xs"
                class="ml-2"
                onClick={() => void query.refetch()}
              >
                {__('Retry')}
              </Button>
            </div>
          </Match>
          <Match when={!query.isLoading || allOrders().length > 0}>
            <OrderTable
              orders={displayedOrders()}
              virtualItems={virtualItems()}
              paddingTop={paddingTop()}
              paddingBottom={paddingBottom()}
              nativeColumnLabel={ctx.nativeStatus.columnLabel}
              nativeStatusLabel={nativeStatusLabel}
              nativeStatusColor={nativeStatusColor}
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
            />
          </Match>
        </Switch>
      </div>

      <div class="flex items-center justify-between mt-2 text-xs text-gray-500 shrink-0">
        <span class="tabular-nums">
          {fmt(displayedOrders().length)} of {fmt(totalCount())} orders loaded
        </span>
        <Show when={query.isFetchingNextPage}>
          <span class="text-text-muted">{__('Loading more…')}</span>
        </Show>
        <Show when={query.isFetching && !query.isFetchingNextPage && !query.isLoading}>
          <span class="text-text-muted">{__('Refreshing…')}</span>
        </Show>
      </div>

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
              assignTags.mutate({ orderIds: note().orderIds, tagIds: [note().tag.id], note: text });
              setTagNote(null);
            }}
          />
        )}
      </Show>

      <Show when={tagManagerOpen()}>
        <TagManagerModal onClose={() => setTagManagerOpen(false)} />
      </Show>

      <Show when={showSettings()}>
        <Modal
          onClose={() => setShowSettings(false)}
          label="Settings"
          backdropClass="flex items-center justify-center bg-black/30 p-6"
        >
          <div class="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl">
            <div class="mb-3 flex items-center justify-between">
              <h2 class="text-sm font-semibold text-gray-800">{__('Settings')}</h2>
              <Button
                variant="quiet"
                size="xs"
                aria-label={__('Close')}
                onClick={() => setShowSettings(false)}
              >
                ×
              </Button>
            </div>
            <DispatchSettingsPanel
              perPage={filters().perPage ?? DEFAULT_PER_PAGE}
              onPerPage={changePerPage}
              onManageTags={() => {
                setShowSettings(false);
                setTagManagerOpen(true);
              }}
            />
          </div>
        </Modal>
      </Show>
    </div>
  );
}

const COLUMN_DESCRIPTIONS = {
  order: 'Source-system order id (linked). Click the row to open the detail view.',
  age: 'How long ago the order was created in WooCommerce. Relative units: seconds, minutes, hours, days.',
  customer: 'Billing name + email recorded at checkout.',
  payment: 'Payment gateway title at the time of payment. Hover for the gateway id slug.',
  dispatch: 'InvFlux dispatch readiness: Untouched (fresh in the queue), Started (in-progress or correction-blocked), Staged (ready to ship), Shipped, or Cancelled.',
  native: "The source system's status for this order — what WooCommerce shows in its own Orders list.",
  stock: 'Stock-allocation state of the order: reserved (pre-confirmation), committed (confirmed, awaiting dispatch), shipped, or mixed.',
  progress: 'Lines staged vs total lines on this order.',
  edt: 'Expected dispatch time — the merchant-side accountability date this order is measured against. Turns red once past due. Default: paid_at (or created_at) + 24h until a rule or manual override writes it.',
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
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days}d` : `${Math.abs(days)}d ago`;
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
    () => props.orders.some((o) => o.stockState !== 0 || o.hasUnmanagedLine),
  );
  const colSpan = createMemo(() => (showStockColumn() ? 11 : 10));

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
          <Th label="Order" title={COLUMN_DESCRIPTIONS.order} />
          <Th label="Age" title={COLUMN_DESCRIPTIONS.age} />
          <Th label="Customer" title={COLUMN_DESCRIPTIONS.customer} />
          <Th label="Payment" title={COLUMN_DESCRIPTIONS.payment} />
          <Th label="Dispatch" title={COLUMN_DESCRIPTIONS.dispatch} />
          <Th label={props.nativeColumnLabel} title={COLUMN_DESCRIPTIONS.native} />
          <Show when={showStockColumn()}>
            <Th label="Stock" title={COLUMN_DESCRIPTIONS.stock} />
          </Show>
          <Th label="Progress" title={COLUMN_DESCRIPTIONS.progress} />
          <Th label="EDT" title={COLUMN_DESCRIPTIONS.edt} />
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
                props.focusedIndex === index ? 'bg-gray-200' : (index % 2 === 1 ? 'bg-gray-50' : ''),
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
                  type="checkbox"
                  class="cursor-pointer align-middle"
                  checked={props.selectedIds.has(safeOrder().id)}
                  onChange={() => props.onToggleRow(safeOrder().id)}
                />
              </td>
              <td class="px-3 py-2">
                <A
                  href={`/${safeOrder().id}`}
                  class="font-mono text-primary hover:text-primary-hover font-medium"
                  onClick={(e) => e.stopPropagation()}
                >
                  #{safeOrder().externalId}
                </A>
              </td>
              <td class="px-3 py-2 text-xs text-gray-500 tabular-nums whitespace-nowrap">
                {relativeAge(safeOrder().createdAt)}
              </td>
              <td class="px-3 py-2">
                <div class="font-medium text-gray-800">{safeOrder().customerName}</div>
                <div class="text-xs text-text-muted">{safeOrder().customerEmail}</div>
                <Show when={(safeOrder().tags?.length ?? 0) > 0}>
                  <div class="mt-1">
                    <TagPillRow tags={safeOrder().tags} />
                  </div>
                </Show>
              </td>
              <td
                class="px-3 py-2 text-xs text-gray-700 whitespace-nowrap"
                title={safeOrder().paymentMethod ?? undefined}
                data-payment-method={safeOrder().paymentMethod ?? ''}
              >
                <Show
                  when={safeOrder().paymentMethodTitle}
                  fallback={<span class="text-gray-300">—</span>}
                >
                  {safeOrder().paymentMethodTitle}
                </Show>
              </td>
              <td class="px-3 py-2">
                <OrderStatusChip status={safeOrder().status} />
              </td>
              <td class="px-3 py-2">
                <Show
                  when={safeOrder().wcStatus}
                  fallback={<span class="text-xs text-gray-300">—</span>}
                >
                  <Pill colorId={props.nativeStatusColor(safeOrder().wcStatus!)}>
                    {props.nativeStatusLabel(safeOrder().wcStatus!)}
                  </Pill>
                </Show>
              </td>
              <Show when={showStockColumn()}>
                <td class="px-3 py-2">
                  <StockConcernBadge bits={safeOrder().stockState} unmanaged={safeOrder().hasUnmanagedLine} />
                </td>
              </Show>
              <td class="px-3 py-2 text-gray-600 tabular-nums">
                {safeOrder().stagedCount}/{safeOrder().lineCount}
              </td>
              {(() => {
                const late = edtLate(safeOrder().estDispatch);
                return (
                  <td
                    class="px-3 py-2 text-xs tabular-nums whitespace-nowrap"
                    classList={{ 'text-red-600 font-medium': late.isLate, 'text-gray-500': !late.isLate }}
                    title={safeOrder().estDispatch ?? undefined}
                  >
                    {relativeEdt(safeOrder().estDispatch)}
                    <Show when={late.days > 0}>
                      {' '}· {late.days}d late
                    </Show>
                  </td>
                );
              })()}
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

import { qk } from '@invflux/ui/api';
import { __, _nx, _x, sprintf } from '@invflux/i18n';
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { A, useNavigate, useParams } from '@solidjs/router';
import { useQueryClient } from '@tanstack/solid-query';
import {
  Button,
  DropdownMenu,
  Modal,
  Pill,
  SplitActionButton,
  StockConcernBadge,
  ThumbnailZoom,
  ViewerBadge,
  buildProductActionItems,
  slotRegistry,
  useHostNav,
  viewRegistry,
  isTypingTarget,
} from '@invflux/ui';
import type { PillTone, StageCode } from '@invflux/ui';
import { Dynamic } from 'solid-js/web';
import { DispatchOrderNotFoundError, fetchDispatchOrderDetail, resolveOrderByExternalId } from '../api';
import { CorrectionModal } from '../components/CorrectionModal';
import { CorrectionsPanel } from '../components/CorrectionsPanel';
import { OrderContextBar } from '../components/OrderContextBar';
import { OrderStatusChip } from '../components/OrderStatusChip';
import { OrderTagsBar } from '../components/OrderTags';
import { CapturePaymentModal } from '../components/CapturePaymentModal';
import { SettleManualRefundModal } from '../components/SettleManualRefundModal';
import { OrderNotesPanel } from '../components/OrderNotesPanel';
import { TimelinePanel } from '../components/TimelinePanel';
import { useDispatch } from '../context';
import { useHeartbeat } from '../heartbeat';
import { useListStore } from '../listStore';
import { useDispatchOrderDetailQuery, useOrderCorrectionsQuery, useShipOrderMutation, useStageLineMutation } from '../queries';
import { registerDispatchOrderActions, type DispatchOrderDetailContext } from './dispatchOrderActions';
import type {
  DispatchOrderLine,
  DispatchOrderSummary,
  OrderDetailActionSlotProps,
  OrderDetailPanelSlotProps,
  OrderDetailToolbarSlotProps,
  OrderStatus,
} from '../types';

/**
 * Resolve once at module load — the datatype views are SPA-agnostic
 * built-ins from `@invflux/ui`, registered on first import. The
 * fallbacks defend against a future where a plug-in unregisters a
 * built-in (won't happen today; the registries are write-once in
 * practice).
 */
const stockConcernsView = viewRegistry.resolve('stock-concerns');
const moneyView = viewRegistry.resolve('decimal:money');

/**
 * Map an order line's quantity state to a {@link StageCode} for display via
 * the shared {@link StagePill}. Essentials dispatch is binary (no partial-staging
 * UI — that's Pro P2-B); a line is either un-staged ('') or fully staged ('M').
 * The intermediate partial-stage cases that drive the Pro partial-staging
 * workflow are deferred to F23+B10 territory.
 */
function lineStage(line: DispatchOrderLine): StageCode {
  const shippable = line.qtyOrdered - line.qtyCorrected;
  if (shippable <= 0) return '';
  if (line.stagedQty >= shippable) return 'M';
  return '';
}

// Register the core dispatch order-detail actions once, at module load. Labels are lazy, so this is
// safe before the request (no early `__()` execution — the trap only bites eager PHP-domain calls).
registerDispatchOrderActions();

export function OrderDetail() {
  const params = useParams<{ hexId: string }>();
  const navigate = useNavigate();
  const listStore = useListStore();
  const ctx = useDispatch();
  const queryClient = useQueryClient();

  // When the hash contains a bare WC order number (e.g. `#/51`), resolve it
  // to the canonical InvFlux hex id and replace the URL. Until the redirect
  // completes all queries are suppressed (empty string disables them via the
  // `enabled: hexId() !== ''` guard in each query hook).
  const hexIdForQuery = createMemo(() => (/^\d+$/.test(params.hexId) ? '' : params.hexId));

  createEffect(() => {
    const id = params.hexId;
    if (!/^\d+$/.test(id)) return;
    void resolveOrderByExternalId(ctx, Number(id)).then(
      (hexId) => navigate('/' + hexId, { replace: true }),
      () => { /* not found — fall through to the normal error state */ },
    );
  });

  const query = useDispatchOrderDetailQuery(() => hexIdForQuery());
  const stageMutation = useStageLineMutation(() => hexIdForQuery());
  const shipMutation = useShipOrderMutation(() => hexIdForQuery());
  const [shipModalOpen, setShipModalOpen] = createSignal(false);
  const [settleModalOpen, setSettleModalOpen] = createSignal(false);
  const [captureModalOpen, setCaptureModalOpen] = createSignal(false);
  // Controlled so a ship action can pop the timeline open — the new
  // ShipmentSent entry is the primary visual confirmation of a ship.
  const [timelineExpanded, setTimelineExpanded] = createSignal(false);

  /**
   * A manual-gateway order awaiting payment (BACS/cheque/COD on hold/pending). For these
   * the merchant records the payment via the InvFlux capture control rather than WC's
   * native screen, so stock is checked before commit. `paymentSupportsRefunds === false`
   * is the manual-gateway signal (refund-capable gateways auto-fire payment_complete).
   */
  function awaitingManualPayment(order: DispatchOrderSummary): boolean {
    return order.paymentSupportsRefunds === false
      && (order.wcStatus === 'on-hold' || order.wcStatus === 'pending');
  }
  const correctionsQuery = useOrderCorrectionsQuery(() => hexIdForQuery());
  /**
   * Modal-open state. `null` = closed; a string (possibly empty) = open,
   * carrying the optional preset `lineId`. An empty string means
   * "open with no preset" — distinct from `null` (closed). The shape
   * lets a single `<Show when>` gate both rendering and prop wiring.
   */
  const [correctionPresetLineId, setCorrectionPresetLineId] = createSignal<string | null>(null);
  useHeartbeat(() => hexIdForQuery());

  function openCorrection(lineId: string | null): void {
    setCorrectionPresetLineId(lineId ?? '');
  }

  function closeCorrection(): void {
    setCorrectionPresetLineId(null);
  }

  /**
   * Global `C` shortcut per D1. Opens the correction modal with no line preset;
   * the operator picks the line
   * from the modal's dropdown. Suppressed when:
   *
   * - any modal is already open (the Modal primitive owns its own
   *   keyboard handling at that point),
   * - focus is in a form control (typing a real `c` in a note,
   *   filter, etc. must not trigger).
   *
   * Listener mounts at the route level so it auto-cleans on
   * navigation. No need for additional teardown on modal close.
   */
  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'c' && e.key !== 'C') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (correctionPresetLineId() !== null) return;
      if (shipModalOpen()) return;
      // Must read the composed path, not `e.target`: this SPA mounts in a shadow root, and
      // retargeting hides the real <input> behind the host before this listener sees the event.
      if (isTypingTarget(e)) return;
      if (!ctx.capabilities.createCorrections) return;
      e.preventDefault();
      openCorrection(null);
    };
    window.addEventListener('keydown', handler);
    onCleanup(() => window.removeEventListener('keydown', handler));
  });

  const prevId = createMemo(() => listStore.getPrevId(hexIdForQuery()));
  const nextId = createMemo(() => listStore.getNextId(hexIdForQuery()));

  /**
   * Prefetch the neighbour orders as soon as the current one is in
   * view. The arrow / Prev/Next buttons then navigate instantly —
   * TanStack Query serves the already-resolved detail before the URL
   * has even triggered the route change.
   *
   * **Cache hit → no fetch.** `prefetchQuery` will re-fetch a stale
   * entry even if it's in cache (its own `staleTime` only suppresses
   * refetch when the data is fresh). We want "if it's in cache at
   * all, don't touch it" semantics — the periodic refetchInterval on
   * the detail query handles freshness when the order is actually
   * being viewed. Checking `getQueryData` first short-circuits the
   * prefetch for any neighbour we've already seen.
   */
  createEffect(() => {
    const detail = query.data;
    if (!detail) return;
    for (const neighbour of [prevId(), nextId()]) {
      if (!neighbour) continue;
      const queryKey = qk.dispatch.orderDetail(neighbour);
      if (queryClient.getQueryData(queryKey) !== undefined) continue;
      void queryClient.prefetchQuery({
        queryKey,
        queryFn: () => fetchDispatchOrderDetail(ctx, neighbour),
      });
    }
  });

  function goPrev() {
    const id = prevId();
    if (id) navigate(`/${id}`);
  }

  function goNext() {
    const id = nextId();
    if (id) navigate(`/${id}`);
  }

  function toggleStage(line: DispatchOrderLine) {
    const shippable = Math.max(0, line.qtyOrdered - line.qtyCorrected - line.qtyShipped);
    if (shippable === 0) return;
    const isFullyStaged = line.stagedQty >= shippable;
    const targetQty = isFullyStaged ? 0 : shippable;
    stageMutation.mutate({
      lineHexId: line.id,
      stagedQty: targetQty,
      source: 'click',
    });
  }

  /**
   * Ship eligibility per the design call:
   * the order must be in `Staged` state — which projects three Essentials-tier
   * prerequisites (all lines staged + workflow Active + no unresolved
   * corrections) into one comparison.
   */
  /**
   * Ship eligibility is derived from the *lines*, not the summary `status`
   * string. `status` is a denormalised readiness projection whose `Staged`
   * bucket can't distinguish "all remaining lines staged" from "some shipped,
   * some staged, some still open" (the partial-dispatch intermediate). Reading
   * the line quantities directly gives one unambiguous source of truth and
   * keeps the two buttons mutually exclusive.
   */
  function shipReadiness(lines: DispatchOrderLine[]): {
    hasOutstanding: boolean;
    hasUnstagedOutstanding: boolean;
    hasStaged: boolean;
  } {
    let hasOutstanding = false;
    let hasUnstagedOutstanding = false;
    let hasStaged = false;
    for (const line of lines) {
      const shippable = Math.max(0, line.qtyOrdered - line.qtyCorrected - line.qtyShipped);
      if (shippable <= 0) continue;
      hasOutstanding = true;
      if (line.stagedQty > 0) hasStaged = true;
      if (line.stagedQty < shippable) hasUnstagedOutstanding = true;
    }
    return { hasOutstanding, hasUnstagedOutstanding, hasStaged };
  }

  function isShippableStatus(order: DispatchOrderSummary): boolean {
    return (
      order.status !== 'Shipped' &&
      order.status !== 'Cancelled' &&
      order.workflowState === 'Active' &&
      order.unprocessedCorrections === 0
    );
  }

  /** Full ship: every still-open line is fully staged (ready to send the lot). */
  function canShip(order: DispatchOrderSummary, lines: DispatchOrderLine[]): boolean {
    const r = shipReadiness(lines);
    return isShippableStatus(order) && r.hasOutstanding && !r.hasUnstagedOutstanding;
  }

  /**
   * Pro partial ship: some lines are staged but not all open lines are — so a
   * full ship isn't yet possible, but the staged subset can go now. Mutually
   * exclusive with `canShip` (which requires no unstaged-outstanding lines).
   */
  function canPartialShip(order: DispatchOrderSummary, lines: DispatchOrderLine[]): boolean {
    if (!ctx.entitlements.dispatchFull) return false;
    const r = shipReadiness(lines);
    return isShippableStatus(order) && r.hasStaged && r.hasUnstagedOutstanding;
  }

  /**
   * Tooltip copy explaining why the Ship button is disabled. Lets the
   * merchant see what they need to do next without scrolling the table.
   */
  function shipBlockedReason(order: DispatchOrderSummary, lines: DispatchOrderLine[]): string {
    if (order.status === 'Shipped') return 'This order has already been shipped.';
    if (order.status === 'Cancelled') return 'Cancelled orders cannot be shipped.';
    if (order.workflowState !== 'Active') {
      return `Workflow is ${order.workflowState}. Resume the order to ship.`;
    }
    if (order.unprocessedCorrections > 0) {
      return `Resolve ${order.unprocessedCorrections} pending correction${order.unprocessedCorrections === 1 ? '' : 's'} before shipping.`;
    }
    const r = shipReadiness(lines);
    if (!r.hasOutstanding) return 'Nothing left to ship on this order.';
    if (r.hasUnstagedOutstanding) {
      return ctx.entitlements.dispatchFull
        ? 'Stage every remaining line to ship the whole order, or use “Ship staged” for the staged ones.'
        : 'Stage the remaining lines before shipping.';
    }
    return 'Order is not ready to ship.';
  }

  function confirmShip(): void {
    setTimelineExpanded(true);
    shipMutation.mutate(undefined, {
      onSuccess: () => setShipModalOpen(false),
    });
  }

  /**
   * Live context for the `dispatch.order.detail` action seam (SplitActionButton). Core "Ship order"
   * reads `canShip`/`blockedReason`/`shipPending`/`openShip`; an add-on's partial-ship action reads
   * `hexId`/`canPartialShip` and calls `onDone` to refresh — the paid partial-ship implementation
   * lives in the add-on, not here.
   */
  function orderActionCtx(order: DispatchOrderSummary, lines: DispatchOrderLine[]): DispatchOrderDetailContext {
    return {
      status: order.status,
      canShip: canShip(order, lines),
      blockedReason: shipBlockedReason(order, lines),
      shipPending: shipMutation.isPending,
      openShip: () => setShipModalOpen(true),
      hexId: params.hexId,
      canPartialShip: canPartialShip(order, lines),
      stagedLines: lines.filter((l) => l.stagedQty > 0).map((l) => ({ label: l.name, qty: l.stagedQty })),
      onDone: () => {
        setTimelineExpanded(true);
        void queryClient.invalidateQueries({ queryKey: qk.dispatch.orderDetail(hexIdForQuery()) });
      },
    };
  }

  return (
    <div class="min-h-screen bg-white">
      <Switch>
        <Match when={query.isLoading}>
          <Header
            backTo={`/${listStore.queueSearch()}`}
            externalId={null}
            shortHex={params.hexId.slice(0, 8)}
            viewers={[]}
            counts={null}
            prevDisabled={true}
            nextDisabled={true}
            onPrev={goPrev}
            onNext={goNext}
          />
          <div class="px-4 py-6 text-sm text-text-muted">{__('Loading order detail…')}</div>
        </Match>

        <Match when={query.error instanceof DispatchOrderNotFoundError}>
          <Header
            backTo={`/${listStore.queueSearch()}`}
            externalId={null}
            shortHex={params.hexId.slice(0, 8)}
            viewers={[]}
            counts={null}
            prevDisabled={prevId() === null}
            nextDisabled={nextId() === null}
            onPrev={goPrev}
            onNext={goNext}
          />
          <div class="px-4 py-6 text-sm text-rose-700">
            {__('Order not found. It may have been pruned (retention window) or never existed.')}
          </div>
        </Match>

        <Match when={query.isError}>
          <Header
            backTo={`/${listStore.queueSearch()}`}
            externalId={null}
            shortHex={params.hexId.slice(0, 8)}
            viewers={[]}
            counts={null}
            prevDisabled={prevId() === null}
            nextDisabled={nextId() === null}
            onPrev={goPrev}
            onNext={goNext}
          />
          <div class="px-4 py-6 text-sm text-red-600">
            Failed to load order: {query.error?.message ?? 'unknown error'}
            <Button
              variant="link"
              size="sm"
              class="ml-2"
              onClick={() => void query.refetch()}
            >
              {__('Retry')}
            </Button>
          </div>
        </Match>

        <Match when={query.data}>
          <Header
            backTo={`/${listStore.queueSearch()}`}
            externalId={query.data!.order.externalId}
            wcOrderEditUrl={query.data!.order.wcOrderEditUrl}
            status={query.data!.order.status}
            shortHex={null}
            viewers={query.data!.viewers}
            tagBar={<OrderTagsBar orderHexId={params.hexId} tags={query.data!.order.tags} />}
            counts={{
              staged: query.data!.order.stagedCount,
              shipped: query.data!.order.shippedCount,
              total: query.data!.order.lineCount,
            }}
            prevDisabled={prevId() === null}
            nextDisabled={nextId() === null}
            onPrev={goPrev}
            onNext={goNext}
          />

          <OrderContextBar
            orderHexId={params.hexId}
            order={query.data!.order}
            awaitingPayment={awaitingManualPayment(query.data!.order)}
            onRecordPayment={() => setCaptureModalOpen(true)}
            onSettleRefund={() => setSettleModalOpen(true)}
          />

          {/*
            Plug-in slot `order.detail.toolbar`. Add-ons inject
            status-line actions here (Park /
            Assign / Tag-edit at Pro). Hidden when no contribution is
            registered so the gap doesn't waste vertical space.
          */}
          <Show when={slotRegistry.get<OrderDetailToolbarSlotProps>('order.detail.toolbar').length > 0}>
            <div class="px-4 py-2 border-b border-gray-200 bg-gray-50/40 flex items-center gap-2">
              <For each={slotRegistry.get<OrderDetailToolbarSlotProps>('order.detail.toolbar')}>
                {(slot) => (
                  <Show when={slot.enabled?.() ?? true}>
                    <Dynamic
                      component={slot.component}
                      orderHexId={params.hexId}
                      order={query.data!.order}
                    />
                  </Show>
                )}
              </For>
            </div>
          </Show>

          <Show when={stageMutation.isError}>
            <div class="px-4 py-2 bg-red-50 border-b border-red-100 text-sm text-red-700 flex items-center gap-3">
              <span class="font-medium">{__('Stage failed:')}</span>
              <span>{stageMutation.error?.message ?? 'Unknown error'}</span>
              <Button
                variant="danger"
                weight="outline"
                size="xs"
                class="ml-auto"
                onClick={() => stageMutation.reset()}
              >
                {__('Dismiss')}
              </Button>
            </div>
          </Show>

          {/* No create-corrections capability → no per-line correction affordance at all
              (LineTable renders the button only when the handler is supplied). */}
          <LineTable
            lines={query.data!.lines}
            onToggleStage={toggleStage}
            onOpenCorrection={ctx.capabilities.createCorrections ? openCorrection : undefined}
            pendingLineId={stageMutation.isPending ? stageMutation.variables?.lineHexId ?? null : null}
          />

          <CorrectionsPanel
            orderHexId={params.hexId}
            order={query.data!.order}
            lines={query.data!.lines}
            onOpenCorrection={openCorrection}
          />

          {/* Pending-manual-refund affordance lives in the Payment card (OrderContextBar)
              alongside the capture-payment CTA — see onSettleRefund above. */}

          <Show when={settleModalOpen()}>
            <SettleManualRefundModal
              orderHexId={params.hexId}
              order={query.data!.order}
              onClose={() => setSettleModalOpen(false)}
            />
          </Show>

          <Show when={captureModalOpen()}>
            <CapturePaymentModal
              orderHexId={params.hexId}
              order={query.data!.order}
              onClose={() => setCaptureModalOpen(false)}
            />
          </Show>

          <OrderNotesPanel orderHexId={params.hexId} orderTags={query.data?.order.tags} />

          <TimelinePanel
            orderHexId={params.hexId}
            expanded={timelineExpanded}
            onToggle={setTimelineExpanded}
          />

          {/*
            Plug-in slot `order.detail.panel` — additional panels
            below corrections, above ShipBar. Customer-history widget,
            supplier-comms recap, batch panel, etc.
          */}
          <For each={slotRegistry.get<OrderDetailPanelSlotProps>('order.detail.panel')}>
            {(slot) => (
              <Show when={slot.enabled?.() ?? true}>
                <Dynamic
                  component={slot.component}
                  orderHexId={params.hexId}
                  order={query.data!.order}
                  lines={query.data!.lines}
                />
              </Show>
            )}
          </For>

          <Show when={shipMutation.isError}>
            <div class="px-4 py-2 bg-red-50 border-y border-red-100 text-sm text-red-700 flex items-center gap-3">
              <span class="font-medium">{__('Ship failed:')}</span>
              <span>{shipMutation.error?.message ?? 'Unknown error'}</span>
              <Button
                variant="danger"
                weight="outline"
                size="xs"
                class="ml-auto"
                onClick={() => shipMutation.reset()}
              >
                {__('Dismiss')}
              </Button>
            </div>
          </Show>

          <ShipBar order={query.data!.order} ctx={orderActionCtx(query.data!.order, query.data!.lines)} />
        </Match>
      </Switch>

      <Show when={shipModalOpen() && query.data}>
        <ShipConfirmModal
          order={query.data!.order}
          lines={query.data!.lines}
          isPending={shipMutation.isPending}
          onConfirm={confirmShip}
          onCancel={() => setShipModalOpen(false)}
        />
      </Show>

      <Show when={correctionPresetLineId() !== null && query.data && correctionsQuery.data}>
        <CorrectionModal
          orderHexId={params.hexId}
          lines={query.data!.lines}
          types={correctionsQuery.data!.types}
          presetLineId={correctionPresetLineId() || null}
          onClose={closeCorrection}
        />
      </Show>
    </div>
  );
}

function Header(props: {
  backTo: string;
  externalId: string | null;
  wcOrderEditUrl?: string | null;
  status?: OrderStatus;
  shortHex: string | null;
  viewers: import('@invflux/ui').OrderViewer[];
  tagBar?: JSX.Element;
  counts: { staged: number; shipped: number; total: number } | null;
  prevDisabled: boolean;
  nextDisabled: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div class="px-4 py-3 border-b border-gray-200 flex items-center gap-3">
      <A href={props.backTo} class="text-sm text-primary hover:text-primary-hover">
        ← Queue
      </A>
      <span class="text-gray-300">/</span>
      <Show when={props.externalId !== null} fallback={
        <span class="font-mono text-xs text-text-muted">{props.shortHex}…</span>
      }>
        <Show
          when={props.wcOrderEditUrl}
          fallback={<span class="font-mono font-medium text-gray-800">#{props.externalId}</span>}
        >
          <a
            href={props.wcOrderEditUrl!}
            target="_blank"
            rel="noopener noreferrer"
            class="font-mono font-medium text-primary hover:text-primary-hover"
            title={__('Open this order in WooCommerce')}
          >
            #{props.externalId} ↗
          </a>
        </Show>
      </Show>
      <Show when={props.status}>
        {(status) => <OrderStatusChip status={status()} />}
      </Show>
      <Show when={props.viewers.length > 0}>
        <ViewerBadge viewers={props.viewers} />
      </Show>
      <Show when={props.tagBar}>{props.tagBar}</Show>
      <div class="ml-auto flex items-center gap-3">
        <Show when={props.counts}>
          <span class="text-sm text-gray-500 tabular-nums">
            {props.counts!.staged + props.counts!.shipped}/{props.counts!.total} ready
          </span>
        </Show>
        <div class="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            disabled={props.prevDisabled}
            onClick={props.onPrev}
            title={__('Previous order in queue')}
          >
            ← Prev
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={props.nextDisabled}
            onClick={props.onNext}
            title={__('Next order in queue')}
          >
            Next →
          </Button>
        </div>
      </div>
    </div>
  );
}

function LineTable(props: {
  lines: DispatchOrderLine[];
  onToggleStage?: (line: DispatchOrderLine) => void;
  /**
   * D1 per-line correction affordance. The table renders the `!` icon
   * only when this callback is provided — keeps the table component
   * reusable in read-only contexts.
   */
  onOpenCorrection?: (lineId: string) => void;
  pendingLineId?: string | null;
}) {
  const hostNav = useHostNav();
  // Hide GTIN when no line on this order carries one. Most
  // catalogs only stamp barcodes on a subset of SKUs; an order of
  // services / digital items / made-to-order goods would render a
  // column of dashes otherwise.
  const showGtinColumn = createMemo(
    () => props.lines.some((l) => l.gtin !== null && l.gtin !== ''),
  );
  const emptyColSpan = createMemo(() => (showGtinColumn() ? 9 : 8));

  return (
    <table class="w-full border-collapse text-sm">
      <thead>
        <tr class="border-b border-gray-200 bg-gray-50">
          <th class="px-3 py-2" />
          <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
            <span class="inline-flex items-center gap-2">
              {__('Product')}
              {/* Open EVERY line of this order in the workbench at once, addressed by subject id —
                  no host id needed, so the hand-off carries no platform assumption. Embedded this
                  navigates in-app; standalone the workbench is another admin page, hence a new tab.
              <Show when={props.lines.length > 0}>
                <a
                  class="text-2xs font-normal normal-case text-primary hover:underline"
                  href={hostNav.routeHref(
                    '/workbench',
                    `subject_ids=${[...new Set(props.lines.map((l) => l.subjectId))].join('-')}&bring_children=1`,
                  )}
                  target={hostNav.opensNewTab ? '_blank' : undefined}
                  rel={hostNav.opensNewTab ? 'noopener' : undefined}
                  title={__("Open this order's products in the workbench")}
                >
                  {__('See in workbench')}
                </a>
              </Show>
            </span>
          </th>
          <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">SKU</th>
          <Show when={showGtinColumn()}>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">GTIN</th>
          </Show>
          <th class="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">{_x('Price', 'order line column')}</th>
          <th class="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Qty</th>
          <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{_x('Stock', 'order line column')}</th>
          <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{_x('Stage', 'order line column')}</th>
          <th class="px-3 py-2" />
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
        <For each={props.lines} fallback={
          <tr>
            <td colspan={emptyColSpan()} class="px-3 py-6 text-center text-text-muted text-sm">
              {__('No lines on this order.')}
            </td>
          </tr>
        }>
          {(line) => {
            const stage = lineStage(line);
            const shippable = Math.max(0, line.qtyOrdered - line.qtyCorrected - line.qtyShipped);
            const isFullyStaged = shippable > 0 && line.stagedQty >= shippable;
            const buttonLabel = isFullyStaged ? 'Un-stage' : 'Stage';
            const isPending = props.pendingLineId === line.id;
            // Disable when there's nothing to ship (fully corrected / already shipped)
            // OR while this specific line's mutation is in flight.
            const isDisabled = shippable === 0 || isPending;
            return (
              <tr class={`group transition-colors ${stage === 'M' ? 'bg-green-50/40' : 'hover:bg-gray-50'}`}>
                <td class="px-3 py-2">
                  <ThumbnailZoom src={line.imageUrl} alt={line.name} />
                </td>
                <td class="px-3 py-2">
                  {/*
                    The product name opens a platform-agnostic links menu (the
                    adapter supplies label+url+kind; the SPA knows nothing about
                    WooCommerce). Falls back to plain text when no links resolved.
                  */}
                  <Show
                    when={line.links.length > 0}
                    fallback={<span class="font-medium text-gray-800">{line.name}</span>}
                  >
                    <DropdownMenu
                      ariaLabel={`Product actions for ${line.name}`}
                      triggerClass="inline-flex items-center gap-1 text-left font-medium text-gray-800 hover:text-primary cursor-pointer decoration-dotted underline-offset-2 hover:underline"
                      trigger={
                        <>
                          {line.name}
                          <span class="text-2xs text-text-muted" aria-hidden="true">▾</span>
                        </>
                      }
                      // Host-platform links (editor, storefront) + the client-built ledger route —
                      // one shared builder so this menu stays identical to the workbench name cell.
                      items={buildProductActionItems({ links: line.links, subjectId: line.subjectId, hostNav })}
                    />
                  </Show>
                </td>
                <td class="px-3 py-2 font-mono text-xs text-gray-500">{line.sku || '—'}</td>
                <Show when={showGtinColumn()}>
                  <td class="px-3 py-2 font-mono text-xs text-gray-500">{line.gtin ?? '—'}</td>
                </Show>
                <td class="px-3 py-2 text-right tabular-nums text-gray-700">
                  {/*
                    Resolve through the shared `decimal:money` view
                    so a future merchant
                    override (e.g. currency-prefixed) lands in every
                    SPA at once instead of needing per-SPA edits.
                  */}
                  <Show when={moneyView} fallback={<span>{line.unitPrice}</span>}>
                    <Dynamic
                      component={moneyView!}
                      value={line.unitPrice}
                      row={line}
                      column={{ dataType: 'decimal:money', editorConfig: {} }}
                      ctx={{}}
                    />
                  </Show>
                </td>
                <td class="px-3 py-2 text-center tabular-nums">
                  <span class={line.qtyOrdered > 1 ? 'font-bold text-base text-gray-900' : 'text-gray-700'}>
                    {line.qtyOrdered}
                  </span>
                  <Show when={line.qtyCorrected > 0}>
                    <span class="ml-1 text-xs text-red-500" title={`${line.qtyCorrected} corrected (cancelled / written-off)`}>
                      −{line.qtyCorrected}
                    </span>
                  </Show>
                  <Show when={line.qtyShipped > 0}>
                    <span class="ml-1 text-xs text-emerald-600" title={`${line.qtyShipped} already shipped`}>
                      ✓{line.qtyShipped}
                    </span>
                  </Show>
                </td>
                <td class="px-3 py-2">
                  {/*
                    Resolve through the shared `stock-concerns` view.
                    The built-in renders
                    a StockConcernBadge; a plug-in can override it
                    once and the new component renders everywhere.
                  */}
                  <Show
                    when={stockConcernsView}
                    fallback={<StockConcernBadge bits={line.stockState} unmanaged={line.unmanaged} />}
                  >
                    <Dynamic
                      component={stockConcernsView!}
                      value={line.stockState}
                      row={line}
                      column={{ dataType: 'stock-concerns', editorConfig: {} }}
                      ctx={{}}
                    />
                  </Show>
                </td>
                <td class="px-3 py-2">
                  {(() => {
                    // Break the ordered qty into its disposition buckets and
                    // show one pill per non-empty bucket (staged + pending +
                    // shipped + corrected always sum to qty_ordered). This
                    // replaces the single "Pending" pill, which read wrong on
                    // a fully shipped / corrected line (nothing outstanding).
                    const pending = Math.max(0, shippable - line.stagedQty);
                    // The count is inside the msgid, not concatenated around it: these labels are
                    // adjectives agreeing with a quantity, so a language that inflects for number
                    // (fr: "1 préparé" / "2 préparés") needs both forms — and one that orders the
                    // number differently needs to place it. English's two forms are identical.
                    const pills = [
                      { text: sprintf(_nx('%d staged', '%d staged', line.stagedQty, 'dispatch line disposition'), line.stagedQty), count: line.stagedQty, tone: 'info' as PillTone },
                      { text: sprintf(_nx('%d pending', '%d pending', pending, 'dispatch line disposition'), pending), count: pending, tone: 'neutral' as PillTone },
                      { text: sprintf(_nx('%d shipped', '%d shipped', line.qtyShipped, 'dispatch line disposition'), line.qtyShipped), count: line.qtyShipped, tone: 'success' as PillTone },
                      { text: sprintf(_nx('%d corrected', '%d corrected', line.qtyCorrected, 'dispatch line disposition'), line.qtyCorrected), count: line.qtyCorrected, tone: 'danger' as PillTone },
                    ].filter((p) => p.count > 0);
                    return (
                      <div class="flex flex-wrap items-center gap-1">
                        <For each={pills} fallback={<span class="text-xs text-text-muted">—</span>}>
                          {(p) => (
                            <Pill tone={p.tone} class="tabular-nums">
                              {p.text}
                            </Pill>
                          )}
                        </For>
                      </div>
                    );
                  })()}
                </td>
                <td class="px-3 py-2 text-right">
                  <div class="inline-flex items-center gap-1.5">
                    {/*
                      D1 per-line correction affordance. Always visible when
                      the line has unresolved stock concerns (red, eye-
                      catching); appears on row hover otherwise (muted
                      grey). Disabled when nothing remains to correct.
                    */}
                    <Show when={props.onOpenCorrection}>
                      {(() => {
                        const hasConcern = line.stockState !== 0;
                        const correctable = shippable > 0;
                        const visibility = hasConcern
                          ? 'opacity-100'
                          : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100';
                        const color = hasConcern
                          ? 'text-red-600 hover:bg-red-50 hover:border-red-300 border-red-200'
                          : 'text-text-muted hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700 border-gray-200';
                        return (
                          <button
                            type="button"
                            class={`px-1.5 py-0.5 text-sm leading-none rounded border font-bold cursor-pointer transition-opacity ${visibility} ${color} disabled:opacity-40 disabled:cursor-not-allowed`}
                            disabled={!correctable}
                            onClick={() => props.onOpenCorrection!(line.id)}
                            title={
                              correctable
                                ? 'Create a correction on this line (C)'
                                : 'Nothing left to correct on this line'
                            }
                            aria-label={__('Create correction on this line')}
                          >
                            !
                          </button>
                        );
                      })()}
                    </Show>
                    <Show when={props.onToggleStage}>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={isDisabled}
                        onClick={() => props.onToggleStage!(line)}
                        title={shippable === 0 ? 'Nothing left to stage on this line' : undefined}
                      >
                        {/*
                          The optimistic mutation already wrote the post-toggle
                          stagedQty into the cache, so `isFullyStaged` (and
                          therefore `buttonLabel`) reflects the *target* state.
                          Showing the destination label directly — with the
                          button kept disabled until the mutation settles —
                          beats a `…` placeholder that flickers the
                          merchant's mental model.
                        */}
                        {buttonLabel}
                      </Button>
                    </Show>
                  </div>
                </td>
              </tr>
            );
          }}
        </For>
      </tbody>
    </table>
  );
}

/**
 * Sticky bar above the line table carrying the Ship action. Lives
 * here (not as a button inside the Header) because Ship is the
 * order's gravity well — the single point of merchant intent that
 * resolves the whole dispatch flow — and deserves a dedicated visual
 * weight separate from navigation chrome.
 */
function ShipBar(props: { order: DispatchOrderSummary; ctx: DispatchOrderDetailContext }) {
  const totalOutstanding = (): number => {
    const o = props.order;
    // Approximation suitable for the bar copy. The detailed per-line
    // breakdown lives in the confirm modal; this just hints at scale.
    return Math.max(0, o.lineCount - o.shippedCount);
  };

  return (
    <div class="px-4 py-3 border-t border-gray-200 bg-gray-50/60 flex items-center gap-3">
      <Show
        when={props.order.status === 'Shipped'}
        fallback={
          <div class="text-sm text-gray-600">
            <Show
              when={props.ctx.canShip}
              fallback={<span>{props.ctx.blockedReason}</span>}
            >
              <span class="font-medium text-gray-800">{__('Ready to ship')}</span>
              <span class="ml-2 text-gray-500">
                — {totalOutstanding()} line{totalOutstanding() === 1 ? '' : 's'} outstanding
              </span>
            </Show>
          </div>
        }
      >
        <div class="text-sm text-emerald-700 font-medium">{__('Order shipped ✓')}</div>
      </Show>

      <Show when={props.order.status !== 'Shipped'}>
        <div class="ml-auto flex items-center gap-2">
          {/*
            Legacy component slot `order.detail.action` — kept for add-on contributions that render
            their own component (needs the shared runtime). Data-only
            actions (Ship, the paid "Ship staged") go through the entity-action seam below instead.
          */}
          <For each={slotRegistry.get<OrderDetailActionSlotProps>('order.detail.action')}>
            {(slot) => (
              <Show when={slot.enabled?.() ?? true}>
                <Dynamic component={slot.component} orderHexId={props.ctx.hexId} order={props.order} />
              </Show>
            )}
          </For>
          {/*
            The core "Ship order" action, plus any add-on-contributed actions (the paid "Ship staged"
            partial-ship), resolved for this order's context. Availability/labels/ordering come from
            the registry — this shell never branches on tier.
          */}
          <SplitActionButton scope="dispatch.order.detail" ctx={props.ctx} overflowLabel="Order actions" />
        </div>
      </Show>
    </div>
  );
}

/**
 * Confirm-Ship modal. The Ship action is irreversible without
 * corrections — surface the consequences explicitly per the
 * design discussion. The bullet list is deliberately short and
 * outcome-focused (not technical) so the merchant absorbs it at a
 * glance.
 *
 * Pro adds a power-user variant with skip checkboxes
 * (Ctrl+Shift+Click on Ship) for the irreversible side effects;
 * Essentials ships the plain confirm modal.
 */
function ShipConfirmModal(props: {
  order: DispatchOrderSummary;
  lines: DispatchOrderLine[];
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Full ship dispatches every line's remaining outstanding qty, so it always completes the order.
  const unitCount = (): number =>
    props.lines.reduce((sum, l) => sum + Math.max(0, l.qtyOrdered - l.qtyCorrected - l.qtyShipped), 0);
  const lineCount = (): number => props.lines.length;

  return (
    <Modal
      onClose={props.onCancel}
      closeOnBackdrop={!props.isPending}
      closeOnEsc={!props.isPending}
      label="Confirm shipment"
      backdropClass="bg-black/30 flex items-center justify-center p-6"
    >
      <div
        class="bg-white rounded-lg shadow-xl max-w-md w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 class="text-base font-semibold text-gray-900 mb-2">{__('Ship this order?')}</h2>
        <p class="text-sm text-gray-600 mb-3">
          Confirming will dispatch{' '}
          <span class="font-medium tabular-nums">{unitCount()}</span>
          {' '}unit{unitCount() === 1 ? '' : 's'} across{' '}
          <span class="font-medium tabular-nums">{lineCount()}</span>
          {' '}line{lineCount() === 1 ? '' : 's'} to {props.order.customerName}.
        </p>
        <ul class="text-xs text-gray-700 space-y-1 mb-4 list-disc pl-5">
          <li>{__('Stock will move out of the quantity held for this order, permanently.')}</li>
          <li>A shipment record is created (its cost-stamped lines carry realized COGS).</li>
          <li>{__('The WooCommerce order will be marked completed and the customer email sent.')}</li>
          <li>{__('This is irreversible without creating corrections.')}</li>
        </ul>
        <div class="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={props.onCancel}
            disabled={props.isPending}
          >
            {__('Cancel')}
          </Button>
          <Button
            variant="success"
            onClick={props.onConfirm}
            disabled={props.isPending}
            autofocus
          >
            <Show when={props.isPending} fallback={<>{__('Confirm ship')}</>}>
              {__('Shipping…')}
            </Show>
          </Button>
        </div>
      </div>
    </Modal>
  );
}

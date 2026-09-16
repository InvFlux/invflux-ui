import { qk } from '@invflux/ui/api';
import { __, _n, _nx, _x, sprintf } from '@invflux/i18n';
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type JSX,
} from 'solid-js';
import { A, useNavigate, useParams } from '@solidjs/router';
import { useQueryClient } from '@tanstack/solid-query';
import {
  ErrorBanner,
  Button,
  DropdownMenu,
  Modal,
  Pill,
  SplitActionButton,
  HourglassIcon,
  HostNavCtx,
  StockConcernBadge,
  ThumbnailZoom,
  ViewerBadge,
  WorkbenchLinkIcon,
  buildProductActionItems,
  buttonClass,
  cx,
  slotRegistry,
  useHostNav,
  viewRegistry,
  isTypingTarget,
  cancelPendingShortcut,
  runWhenTypingStops,
  toast,
  ModalFooter,
  ModalHeader,
  ModalPanel,
  ColumnPicker,
  ColumnsSettingsIcon,
  usePortalRootOptional,
} from '@invflux/ui';
import type { PillTone, StageCode } from '@invflux/ui';
import { Dynamic } from 'solid-js/web';
import { formatWallClock, type DispatchUser } from '@invflux/ui';
import {
  DispatchOrderNotFoundError,
  fetchDispatchOrderDetail,
  correctOrderAddress,
  resolveOrderByExternalId,
} from '../api';
import { AddressEditModal } from '../components/AddressEditModal';
import { CorrectionModal } from '../components/CorrectionModal';
import { CorrectionsPanel } from '../components/CorrectionsPanel';
import { OrderContextBar } from '../components/OrderContextBar';
import { OrderStatusChip } from '../components/OrderStatusChip';
import { nativeStatusColor, nativeStatusExplanation, nativeStatusLabel } from '../nativeStatus';
import { OrderTagsBar } from '../components/OrderTags';
import { CapturePaymentModal } from '../components/CapturePaymentModal';
import { SettleManualRefundModal } from '../components/SettleManualRefundModal';
import { OrderNotesPanel } from '../components/OrderNotesPanel';
import {
  ORDER_LINE_COLUMNS,
  loadHiddenOrderLineColumns,
  saveHiddenOrderLineColumns,
  type OrderLineColumnId,
} from '../components/orderLineColumns';
import { TimelinePanel } from '../components/TimelinePanel';
import { useDispatch } from '../context';
import { standaloneOrderPath, useOrderView } from '../orderView';
import { useHeartbeat } from '../heartbeat';
import { remainingProgress } from '../lineProgress';
import { hasDiscount, netUnitPrice } from '../lineRefund';
import { useListStore } from '../listStore';
import {
  useDispatchOrderDetailQuery,
  useOrderCorrectionsQuery,
  useShipOrderMutation,
  useStageLineMutation,
} from '../queries';
import {
  registerDispatchOrderActions,
  type DispatchOrderDetailContext,
} from './dispatchOrderActions';
import type {
  DispatchOrderLine,
  DispatchOrderSummary,
  NativeStatusContext,
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
  const view = useOrderView();
  const portalRoot = usePortalRootOptional();
  // Not `params.hexId` directly: `useParams()` answers for the route currently matched, so a
  // kept-alive pane behind another tab would read undefined as soon as the URL moved on. The
  // placement supplies the id when it outlives its route; embedded, the route is still the source.
  const routeHexId = (): string => view.hexId?.() ?? params.hexId;
  // `useContext`, not `useHostNav()`: the latter throws where no host is provided, and the promote
  // link is an enhancement — a host that routes nowhere should lose the link, not the order page.
  const host = useContext(HostNavCtx);
  const queryClient = useQueryClient();

  // When the hash contains a bare WC order number (e.g. `#/51`), resolve it
  // to the canonical InvFlux hex id and replace the URL. Until the redirect
  // completes all queries are suppressed (empty string disables them via the
  // `enabled: hexId() !== ''` guard in each query hook).
  const hexIdForQuery = createMemo(() => (/^\d+$/.test(routeHexId()) ? '' : routeHexId()));

  createEffect(() => {
    const id = routeHexId();
    if (!/^\d+$/.test(id)) return;
    void resolveOrderByExternalId(ctx, Number(id)).then(
      (hexId) => navigate(view.orderPath(hexId), { replace: true }),
      () => {
        /* not found — fall through to the normal error state */
      },
    );
  });

  const query = useDispatchOrderDetailQuery(() => hexIdForQuery());
  const stageMutation = useStageLineMutation(() => hexIdForQuery());
  const shipMutation = useShipOrderMutation(() => hexIdForQuery());
  const [shipModalOpen, setShipModalOpen] = createSignal(false);
  /**
   * Which block's Edit was clicked, and whether it was the merged one — or null.
   *
   * Captured when the form opens rather than re-derived when it saves: the card decided it from
   * what was on screen at the moment the operator clicked, and an order refetched in between must
   * not change which scopes the open form is allowed to offer.
   */
  const [editingAddress, setEditingAddress] = createSignal<{
    from: 'billing' | 'shipping';
    merged: boolean;
  } | null>(null);
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
    return (
      order.paymentSupportsRefunds === false &&
      (order.wcStatus === 'on-hold' || order.wcStatus === 'pending')
    );
  }
  const correctionsQuery = useOrderCorrectionsQuery(() => hexIdForQuery());
  /**
   * Corrected units per line still awaiting processing.
   *
   * `undefined` while the corrections query has not resolved, never an empty map: an empty map
   * asserts "nothing is waiting", which would show every correction as settled for as long as the
   * request is in flight — the reassuring answer, arrived at by not knowing.
   */
  const unprocessedCorrectedByLine = createMemo<Map<string, number> | undefined>(() => {
    const corrections = correctionsQuery.data?.corrections;
    if (!corrections) return undefined;
    const byLine = new Map<string, number>();
    for (const c of corrections) {
      if (c.processedAt !== null) continue;
      byLine.set(c.lineId, (byLine.get(c.lineId) ?? 0) + c.qty);
    }
    return byLine;
  });
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
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (correctionPresetLineId() !== null) return;
      if (shipModalOpen()) return;
      // Must read the composed path, not `e.target`: this SPA mounts in a shadow root, and
      // retargeting hides the real <input> behind the host before this listener sees the event.
      if (isTypingTarget(e)) return;
      // A key pressed inside an open overlay (a menu, a popover, a dialog) belongs to it. Escape
      // there closes the overlay; it must not also leave the order. Overlays live in the portal
      // root, and the composed path is the only way to see that from here.
      if (portalRoot && e.composedPath().includes(portalRoot)) return;

      // Escape and `u` both return to the queue: Escape because it already means "get out of what
      // I'm in" everywhere else here and an operator tries it untaught, `u` for the Gmail muscle
      // memory. Both land on the *same* place the visible "← Queue" link does — the link carries
      // `queueSearch`, the filter state built before this order was opened, and a shortcut landing
      // on a bare queue would look like the filters had reset themselves.
      //
      // The order is handed back as the queue's focused row, which is what makes the round trip
      // lossless: Escape returns you to your place in the list, and Enter takes you back in.
      // Promoted out of the queue there is nowhere to go back TO, so the shortcuts that mean
      // "return to the list" simply do not exist here — rather than silently doing nothing, which
      // reads as a dropped keypress.
      const backToQueue = (): void => {
        if (view.standalone) return;
        listStore.setFocusId(hexIdForQuery());
        navigate(`/${listStore.queueSearch()}`);
      };

      // Escape acts at once: no scanner emits it, and delaying the key an operator presses when
      // they want out *now* would be the wrong trade.
      if (e.key === 'Escape') {
        e.preventDefault();
        backToQueue();

        return;
      }

      // The letters wait for the typing to stop. A barcode scanner types into the page when
      // nothing has focus, so `u` inside a barcode would otherwise navigate mid-scan — and the
      // only evidence would be the operator suddenly somewhere else.
      if (e.key === 'u' || e.key === 'U') {
        e.preventDefault();
        runWhenTypingStops(backToQueue);

        return;
      }

      if (e.key !== 'c' && e.key !== 'C') return;
      if (!ctx.capabilities.createCorrections) return;
      e.preventDefault();
      runWhenTypingStops(() => openCorrection(null));
    };
    window.addEventListener('keydown', handler);
    onCleanup(() => {
      window.removeEventListener('keydown', handler);
      // Leaving the page with a shortcut still waiting out its quiet window would fire it into a
      // surface that no longer exists.
      cancelPendingShortcut();
    });
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
    if (id) navigate(view.orderPath(id));
  }

  function goNext() {
    const id = nextId();
    if (id) navigate(view.orderPath(id));
  }

  function toggleStage(line: DispatchOrderLine) {
    const shippable = Math.max(0, line.qtyOrdered - line.qtyCorrected - line.qtyShipped);
    // Releasing a stage is legitimate even when nothing is shippable any more — see the button's
    // own note. Only a line with nothing shippable AND nothing staged has no toggle to make.
    if (shippable === 0 && line.stagedQty === 0) return;
    const isFullyStaged = line.stagedQty > 0 && line.stagedQty >= shippable;
    // An order that cannot ship offers only the way back: whatever the line holds is released.
    const releaseOnly = query.data ? stageBlockedReason(query.data.order) !== undefined : false;
    if (releaseOnly && line.stagedQty === 0) return;
    const targetQty = isFullyStaged || releaseOnly ? 0 : shippable;
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
   * Why no line of this order may be staged, or undefined when staging is open. An order that
   * cannot ship is not prepared for shipping either; the server refuses the same
   * (`invflux_order_not_stageable`). Pending corrections are not a reason — they hold up shipping,
   * not preparing it — and giving a stage back stays open.
   */
  function stageBlockedReason(order: DispatchOrderSummary): string | undefined {
    if (order.status === 'Shipped') return __('This order has already been shipped.');
    if (order.status === 'Cancelled') return __('Cancelled orders cannot be staged.');
    // Closed without shipping or cancelling: completed on the host, the word the merchant knows.
    if (order.workflowState === 'Closed') {
      return __('This order is already completed, so its lines cannot be staged.');
    }
    if (order.workflowState === 'OnHold') {
      return __('This order is on hold. Resume it before staging its lines.');
    }
    if (order.workflowState !== 'Active') {
      return sprintf(
        /* translators: %s: the order's workflow state, as an add-on names it. */
        __('Workflow is %s. Resume the order to stage its lines.'),
        order.workflowState,
      );
    }
    return undefined;
  }

  /**
   * Tooltip copy explaining why the Ship button is disabled. Lets the
   * merchant see what they need to do next without scrolling the table.
   */
  function shipBlockedReason(order: DispatchOrderSummary, lines: DispatchOrderLine[]): string {
    if (order.status === 'Shipped') return __('This order has already been shipped.');
    if (order.status === 'Cancelled') return __('Cancelled orders cannot be shipped.');
    if (order.workflowState !== 'Active') {
      return sprintf(__('Workflow is %s. Resume the order to ship.'), order.workflowState);
    }
    if (order.unprocessedCorrections > 0) {
      return sprintf(
        _n(
          'Resolve %d pending correction before shipping.',
          'Resolve %d pending corrections before shipping.',
          order.unprocessedCorrections,
        ),
        order.unprocessedCorrections,
      );
    }
    const r = shipReadiness(lines);
    if (!r.hasOutstanding) return __('Nothing left to ship on this order.');
    if (r.hasUnstagedOutstanding) {
      return ctx.entitlements.dispatchFull
        ? __(
            'Stage every remaining line to ship the whole order, or send the staged units now as a partial shipment.',
          )
        : __('Stage the remaining lines before shipping.');
    }
    return __('Order is not ready to ship.');
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
  function orderActionCtx(
    order: DispatchOrderSummary,
    lines: DispatchOrderLine[],
  ): DispatchOrderDetailContext {
    return {
      status: order.status,
      canShip: canShip(order, lines),
      blockedReason: shipBlockedReason(order, lines),
      shipPending: shipMutation.isPending,
      openShip: () => setShipModalOpen(true),
      hexId: routeHexId(),
      canPartialShip: canPartialShip(order, lines),
      stagedLines: lines
        .filter((l) => l.stagedQty > 0)
        .map((l) => ({ label: l.name, qty: l.stagedQty })),
      outstandingUnits: lines.reduce(
        (sum, l) => sum + Math.max(0, l.qtyOrdered - l.qtyCorrected - l.qtyShipped),
        0,
      ),
      onDone: () => {
        setTimelineExpanded(true);
        void queryClient.invalidateQueries({ queryKey: qk.dispatch.orderDetail(hexIdForQuery()) });
      },
    };
  }

  // Placement decides the chrome, and every Header below asks the same two questions — so they are
  // answered once here rather than repeated at each call site, where they would drift apart.
  const backTo = (): string | null => (view.standalone ? null : `/${listStore.queueSearch()}`);
  const promoteHref = (): string | null =>
    view.standalone || hexIdForQuery() === '' || !host
      ? null
      : host.routeHref(standaloneOrderPath(hexIdForQuery()));

  return (
    <div class="min-h-screen bg-ground">
      <Switch>
        <Match when={query.isLoading}>
          <Header
            backTo={backTo()}
            promoteHref={promoteHref()}
            neighbours={!view.standalone}
            externalId={null}
            shortHex={routeHexId().slice(0, 8)}
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
            backTo={backTo()}
            promoteHref={promoteHref()}
            neighbours={!view.standalone}
            externalId={null}
            shortHex={routeHexId().slice(0, 8)}
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
            backTo={backTo()}
            promoteHref={promoteHref()}
            neighbours={!view.standalone}
            externalId={null}
            shortHex={routeHexId().slice(0, 8)}
            viewers={[]}
            counts={null}
            prevDisabled={prevId() === null}
            nextDisabled={nextId() === null}
            onPrev={goPrev}
            onNext={goNext}
          />
          <ErrorBanner as="div" class="px-4 py-6 text-sm">
            {sprintf(__('Failed to load order: %s'), query.error?.message ?? __('unknown error'))}
            <Button variant="link" size="sm" class="ml-2" onClick={() => void query.refetch()}>
              {__('Retry')}
            </Button>
          </ErrorBanner>
        </Match>

        <Match when={query.data}>
          <Header
            backTo={backTo()}
            promoteHref={promoteHref()}
            neighbours={!view.standalone}
            externalId={query.data!.order.externalId}
            wcOrderEditUrl={query.data!.order.wcOrderEditUrl}
            status={query.data!.order.status}
            wcStatus={query.data!.order.wcStatus}
            nativeStatusOptions={ctx.nativeStatus.options}
            shortHex={null}
            viewers={query.data!.viewers}
            tagBar={<OrderTagsBar orderHexId={routeHexId()} tags={query.data!.order.tags} />}
            counts={{
              staged: query.data!.order.stagedCount,
              settled: query.data!.order.settledCount ?? 0,
              total: query.data!.order.lineCount,
            }}
            prevDisabled={prevId() === null}
            nextDisabled={nextId() === null}
            onPrev={goPrev}
            onNext={goNext}
          />

          {/* The page's vertical rhythm lives here, as a `gap`, rather than in each band's own
              padding and bottom rule. One number to change, and no section can drift out of step
              with its neighbours. */}
          <div class="flex flex-col gap-2 py-2">
            <OrderContextBar
              orderHexId={routeHexId()}
              order={query.data!.order}
              awaitingPayment={awaitingManualPayment(query.data!.order)}
              onRecordPayment={
                ctx.capabilities.recordPayments ? () => setCaptureModalOpen(true) : undefined
              }
              onSettleRefund={() => setSettleModalOpen(true)}
              onEditAddress={
                ctx.capabilities.editOrderAddress
                  ? (from, merged) => setEditingAddress({ from, merged })
                  : undefined
              }
            />

            {/*
            Plug-in slot `order.detail.toolbar`. Add-ons inject
            status-line actions here (Park /
            Assign / Tag-edit at Pro). Hidden when no contribution is
            registered so the gap doesn't waste vertical space.
          */}
            <Show
              when={
                slotRegistry.get<OrderDetailToolbarSlotProps>('order.detail.toolbar').length > 0
              }
            >
              <div class="px-4 py-2 border-b border-gray-200 bg-gray-50/40 flex items-center gap-2">
                <For each={slotRegistry.get<OrderDetailToolbarSlotProps>('order.detail.toolbar')}>
                  {(slot) => (
                    <Show when={slot.enabled?.() ?? true}>
                      <Dynamic
                        component={slot.component}
                        orderHexId={routeHexId()}
                        order={query.data!.order}
                      />
                    </Show>
                  )}
                </For>
              </div>
            </Show>

            <Show when={stageMutation.isError}>
              <ErrorBanner
                as="div"
                class="px-4 py-2 bg-red-50 border-b border-red-100 text-sm flex items-center gap-3"
              >
                <span class="font-medium">{__('Stage failed:')}</span>
                <span>
                  {stageMutation.error?.code === 'invflux_stage_short_for_order'
                    ? __(
                        'Not enough stock for this line. Record stock found on the shelf with an on-hand correction, or correct the order for the units that cannot ship.',
                      )
                    : (stageMutation.error?.message ?? __('Unknown error'))}
                </span>
                <Button
                  variant="danger"
                  weight="outline"
                  size="xs"
                  class="ml-auto"
                  onClick={() => stageMutation.reset()}
                >
                  {__('Dismiss')}
                </Button>
              </ErrorBanner>
            </Show>

            {/* No create-corrections capability → no per-line correction affordance at all
              (LineTable renders the button only when the handler is supplied). */}
            {/* The lines get NO panel: each row is its own surface on the page ground, so a line is an
              object you can pick out rather than a stripe of text in a slab. Its header band still
              reads because `surface-raised` steps *past* the ground rather than sitting between it
              and white — which is exactly the case that forced that token to move. */}
            <div class="mx-4">
              <LineTable
                lines={query.data!.lines}
                onToggleStage={toggleStage}
                stageBlockedReason={stageBlockedReason(query.data!.order)}
                hideStock={
                  query.data!.order.status === 'Shipped' ||
                  query.data!.order.workflowState === 'Closed'
                }
                onOpenCorrection={ctx.capabilities.createCorrections ? openCorrection : undefined}
                pendingLineId={
                  stageMutation.isPending ? (stageMutation.variables?.lineHexId ?? null) : null
                }
                unprocessedCorrectedByLine={unprocessedCorrectedByLine()}
              />
            </div>

            <div class="mx-4 overflow-hidden rounded-lg border border-border bg-surface">
              <CorrectionsPanel
                orderHexId={routeHexId()}
                order={query.data!.order}
                lines={query.data!.lines}
                onOpenCorrection={openCorrection}
              />

              {/* Pending-manual-refund affordance lives in the Payment card (OrderContextBar)
              alongside the capture-payment CTA — see onSettleRefund above. */}

              <Show when={settleModalOpen()}>
                <SettleManualRefundModal
                  orderHexId={routeHexId()}
                  order={query.data!.order}
                  hostOrderMissing={query.data!.hostOrderMissing === true}
                  onClose={() => setSettleModalOpen(false)}
                />
              </Show>

              <Show when={captureModalOpen()}>
                <CapturePaymentModal
                  orderHexId={routeHexId()}
                  order={query.data!.order}
                  onClose={() => setCaptureModalOpen(false)}
                />
              </Show>

              <Show when={editingAddress()}>
                {(editing) => (
                  <AddressEditModal
                    openedFrom={editing().from}
                    merged={editing().merged}
                    address={
                      'billing' === editing().from
                        ? query.data!.order.billingAddress
                        : query.data!.order.shippingAddress
                    }
                    onSave={async (fields, targets) => {
                      await correctOrderAddress(ctx, routeHexId(), targets, fields);
                      // Reports what was asked for, which the form knows and the server does not have
                      // to be consulted about: `targets` is an instruction, so its length is the
                      // answer.
                      toast.success(
                        targets.length > 1
                          ? __('Both addresses updated in WooCommerce.')
                          : __('Address updated in WooCommerce.'),
                      );
                      // The screen reads WooCommerce's live columns, so the corrected address appears
                      // by refetching the order — there is no projection step to wait on.
                      await queryClient.invalidateQueries({
                        queryKey: qk.dispatch.orderDetail(routeHexId()),
                      });
                      // The correction writes an order event, so the timeline is stale too. Marking it
                      // is enough for both states the panel can be in: open, it refetches now; folded
                      // away, the query is disabled and simply refetches when the operator opens it.
                      void queryClient.invalidateQueries({
                        queryKey: qk.dispatch.orderEvents(routeHexId()),
                      });
                      // A queue row can show where the order is going, so it moved too.
                      void queryClient.invalidateQueries({ queryKey: qk.dispatch.queue() });
                    }}
                    onClose={() => setEditingAddress(null)}
                  />
                )}
              </Show>

              <OrderNotesPanel
                orderHexId={routeHexId()}
                orderTags={query.data?.order.tags}
                onDraftChange={view.onDirtyChange}
              />

              <TimelinePanel
                orderHexId={routeHexId()}
                lines={query.data?.lines}
                corrections={correctionsQuery.data?.corrections}
                correctionTypes={correctionsQuery.data?.types}
                currency={query.data?.order.currency}
                eventCount={query.data?.eventCount}
                expanded={timelineExpanded}
                onToggle={setTimelineExpanded}
              />
            </div>

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
                    orderHexId={routeHexId()}
                    order={query.data!.order}
                    lines={query.data!.lines}
                  />
                </Show>
              )}
            </For>
          </div>

          <Show when={shipMutation.isError}>
            <ErrorBanner
              as="div"
              class="px-4 py-2 bg-red-50 border-y border-red-100 text-sm flex items-center gap-3"
            >
              <span class="font-medium">{__('Ship failed:')}</span>
              <span>
                {shipMutation.error?.code === 'invflux_ship_short_for_order'
                  ? __(
                      'Committed stock no longer covers this order — another order may have shipped first. Record stock found on the shelf with an on-hand correction, or correct the order for the units that cannot ship.',
                    )
                  : (shipMutation.error?.message ?? __('Unknown error'))}
              </span>
              <Button
                variant="danger"
                weight="outline"
                size="xs"
                class="ml-auto"
                onClick={() => shipMutation.reset()}
              >
                {__('Dismiss')}
              </Button>
            </ErrorBanner>
          </Show>

          <ShipBar
            order={query.data!.order}
            ctx={orderActionCtx(query.data!.order, query.data!.lines)}
            neighbours={!view.standalone}
            prevDisabled={prevId() === null}
            nextDisabled={nextId() === null}
            onPrev={goPrev}
            onNext={goNext}
          />
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
          orderHexId={routeHexId()}
          lines={query.data!.lines}
          types={correctionsQuery.data!.types}
          reasons={correctionsQuery.data!.reasons ?? []}
          presetLineId={correctionPresetLineId() || null}
          onClose={closeCorrection}
        />
      </Show>
    </div>
  );
}

function Header(props: {
  /** Where the queue is, or `null` when this order was promoted out of it and nothing sits behind. */
  backTo: string | null;
  /** Link that opens this order in a tab of its own, or `null` when it already is one. */
  promoteHref?: string | null;
  /** Whether the queue's neighbouring orders are reachable from here. */
  neighbours: boolean;
  externalId: string | null;
  wcOrderEditUrl?: string | null;
  status?: OrderStatus;
  /** The order's status in WooCommerce, shown beside the dispatch status; null when unknown. */
  wcStatus?: string | null;
  /** The install's WooCommerce statuses, which name and colour {@link wcStatus}. */
  nativeStatusOptions?: NativeStatusContext['options'];
  shortHex: string | null;
  viewers: import('@invflux/ui').OrderViewer[];
  tagBar?: JSX.Element;
  /** `settled`: lines with nothing left to do, which the readout leaves out (`remainingProgress()`). */
  counts: { staged: number; settled: number; total: number } | null;
  prevDisabled: boolean;
  nextDisabled: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div class="px-4 pt-2 flex items-center gap-3">
      {/* Two pairs, each its own wrapping row rather than four peers in one.
          A narrow viewport has to put this line somewhere, and squeezing five unrelated items
          equally squeezes the ones that cannot take it — an order number and a status word are
          each atomic. `text-nowrap` keeps every item whole and `flex-wrap` breaks BETWEEN them, so
          a pair stacks into two short lines instead of one item hyphenating or being clipped. The
          pairing is by meaning: which order this is, then what state it is in. */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-nowrap">
        <Show when={props.backTo !== null}>
          <A
            href={props.backTo!}
            class="text-sm text-primary hover:text-primary-hover"
            // A shortcut nobody can find is folklore. The link is where an operator looks for the
            // way back, so it is where the key belongs.
            title={__('Back to the queue (u)')}
          >
            ← {_x('Queue', 'order page back link: the dispatch queue')}
          </A>
          <span class="text-gray-300">/</span>
        </Show>
        <Show
          when={props.externalId !== null}
          fallback={<span class="font-mono text-xs text-text-muted">{props.shortHex}…</span>}
        >
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
      </div>
      <Show when={props.status !== undefined || props.wcStatus || props.viewers.length > 0}>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-nowrap">
          <Show when={props.status}>{(status) => <OrderStatusChip status={status()} />}</Show>
          {/* WooCommerce's own status, beside ours: the two answer different questions (how far
              packing has got, and what WooCommerce and the customer see), and they can disagree
              for good reasons. Each pill's tooltip says which is which. */}
          <Show when={props.wcStatus}>
            {(slug) => (
              <Pill
                colorId={nativeStatusColor(props.nativeStatusOptions ?? [], slug())}
                title={nativeStatusExplanation(props.nativeStatusOptions ?? [], slug())}
                data-testid="wc-status-pill"
                data-status={slug()}
              >
                {nativeStatusLabel(props.nativeStatusOptions ?? [], slug())}
              </Pill>
            )}
          </Show>
          <Show when={props.viewers.length > 0}>
            <ViewerBadge viewers={props.viewers} />
          </Show>
        </div>
      </Show>
      <Show when={props.tagBar}>{props.tagBar}</Show>
      <div class="ml-auto flex items-center gap-3">
        {/* Over the work that remains: a fully corrected or fully shipped line is not work, so it
            leaves both numbers — the same readout as the queue's. Absent when nothing is left. */}
        <Show
          when={
            props.counts &&
            remainingProgress(props.counts.staged, props.counts.total, props.counts.settled)
          }
        >
          {(p) => (
            <Show when={p().remaining > 0}>
              <span class="text-sm text-gray-500 tabular-nums">
                {sprintf(
                  /* translators: 1: lines staged, 2: lines still to ship. */
                  __('%1$d/%2$d ready'),
                  p().done,
                  p().remaining,
                )}
              </span>
            </Show>
          )}
        </Show>
        <Show when={props.promoteHref}>
          <a
            href={props.promoteHref!}
            class="text-sm text-primary hover:text-primary-hover no-underline hover:underline"
            title={__('Open this order in its own tab')}
            aria-label={__('Open this order in its own tab')}
          >
            ⧉
          </a>
        </Show>
        <Show when={props.neighbours}>
          <div class="flex items-center gap-1">
            <Button
              variant="secondary"
              size="sm"
              disabled={props.prevDisabled}
              onClick={props.onPrev}
              title={__('Previous order in queue')}
            >
              {_x('← Prev', 'order navigation')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={props.nextDisabled}
              onClick={props.onNext}
              title={__('Next order in queue')}
            >
              {_x('Next →', 'order navigation')}
            </Button>
          </div>
        </Show>
      </div>
    </div>
  );
}

/**
 * Who packed a line and when, for its pills' tooltips — "Staged by Sam, 7 Sep 2027, 13:53" while it
 * waits, "Packed by Sam, 7 Sep 2027, 13:53" once it has shipped.
 *
 * `staged_by` / `staged_at` stay on the line after shipping as the last-packing snapshot, which is
 * what lets the shipped pill still answer "who packed it" once the order has gone. The name comes
 * from the server; a line this user just staged may not carry it until the next refresh, so their own
 * name stands in.
 */
function packedTitle(
  line: DispatchOrderLine,
  as: 'staged' | 'shipped',
  me: DispatchUser,
): string | undefined {
  const name =
    line.stagedByName ?? (line.stagedBy !== null && line.stagedBy === me.id ? me.name : null);
  if (as === 'staged') {
    if (line.stagedQty <= 0 || name === null) return undefined;
    return sprintf(
      /* translators: 1: the packer's name, 2: date and time the line was staged. */
      __('Staged by %1$s, %2$s'),
      name,
      formatWallClock(line.stagedAt),
    );
  }
  // Shipped: who packed it and when they did. Not when it shipped — every line of a shipment went
  // out at the same moment, and the timeline's shipment event already says when.
  if (line.qtyShipped <= 0 || name === null) return undefined;

  return line.stagedAt
    ? sprintf(
        /* translators: 1: the packer's name, 2: date and time they packed the line. */
        __('Packed by %1$s, %2$s'),
        name,
        formatWallClock(line.stagedAt),
      )
    : sprintf(/* translators: %s: the packer's name. */ __('Packed by %s'), name);
}

function LineTable(props: {
  lines: DispatchOrderLine[];
  onToggleStage?: (line: DispatchOrderLine) => void;
  /**
   * Why the order takes no staging (it cannot ship), or undefined when it does. Stage buttons are
   * then disabled with this reason, and a staged line's button releases what it holds.
   */
  stageBlockedReason?: string;
  /** A shipped or closed order: its stock concerns are history, so the column stays away. */
  hideStock?: boolean;
  /**
   * D1 per-line correction affordance. The table renders the `!` icon
   * only when this callback is provided — keeps the table component
   * reusable in read-only contexts.
   */
  onOpenCorrection?: (lineId: string) => void;
  pendingLineId?: string | null;
  /**
   * Corrected units per line that no operator has processed yet, keyed by line id.
   *
   * Splits the corrected disposition into two pills, because "corrected" answers what happened to
   * the units and says nothing about whether anyone still owes an action on them — and on a line
   * carrying both, one pill can only show one of the two. Omitted (a read-only embed with no
   * corrections query) collapses back to a single pill, which is honest: unknown is not zero.
   */
  unprocessedCorrectedByLine?: Map<string, number>;
}) {
  const hostNav = useHostNav();

  // Which optional columns this operator has put away — see `orderLineColumns.ts`.
  const [hiddenColumns, setHiddenColumns] = createSignal<OrderLineColumnId[]>(
    loadHiddenOrderLineColumns(),
  );
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const toggleColumn = (id: OrderLineColumnId): void => {
    const next = hiddenColumns().includes(id)
      ? hiddenColumns().filter((c) => c !== id)
      : [...hiddenColumns(), id];
    setHiddenColumns(next);
    saveHiddenOrderLineColumns(next);
  };
  const chosen = (id: OrderLineColumnId): boolean => !hiddenColumns().includes(id);

  // Two different reasons a column is absent, kept apart. The operator's choice (`chosen`) is a
  // preference; the data test is what stops a column of dashes on an order with nothing to say in
  // it. A column shows only when both allow it.
  const showPrice = createMemo(() => chosen('price'));
  const showShippingClass = createMemo(
    () => chosen('shipping_class') && props.lines.some((l) => (l.shippingClass ?? '') !== ''),
  );
  const me = useDispatch().currentUser;
  // Everything the stock cell can say, not just the concern bits: an unmanaged line or inbound
  // cover renders there too, and hiding the column on the bits alone would hide those with it.
  const showStock = createMemo(
    () =>
      !props.hideStock &&
      props.lines.some(
        (l) => l.stockState !== 0 || l.unmanaged === true || l.inbound !== undefined,
      ),
  );
  // Thumbnail, product, SKU, qty and stage are always there; the rest are counted.
  const emptyColSpan = createMemo(
    () => 5 + Number(showPrice()) + Number(showShippingClass()) + Number(showStock()),
  );

  return (
    /*
      `border-separate` with a row gap, so each line is its OWN surface on the page ground rather
      than a stripe inside one slab — a line becomes an object you can pick out. Note the borders
      move with it: in separate mode a border on `<tr>` is not painted at all, so the header's rule
      lives on its cells instead.
    */
    // Scrolls inside itself, so a narrow screen never scrolls the page sideways.
    <div class="overflow-x-auto">
      <table class="w-full border-separate border-spacing-y-[3px] text-sm">
        <thead>
          {/*
          The fill and the radius live on the CELLS, not on the row. A `<tr>` honours neither
          `border-radius` nor — in `border-separate` mode — a border, so the row can only ever paint
          a square block; the cells can do both. Horizontal spacing is 0, so they abut and the fill
          reads as one continuous band with only its two outer corners rounded.
        */}
          <tr
            class={cx(
              '[&>th]:border-b [&>th]:border-border [&>th]:bg-surface-raised',
              '[&>th:first-child]:rounded-tl-lg [&>th:last-child]:rounded-tr-lg',
            )}
          >
            <th class="px-1.5 py-2" />
            <th class="px-1.5 py-2 text-left text-xs font-medium text-text uppercase tracking-wide">
              <span class="inline-flex items-center gap-2">
                {__('Product')}
                {/* Open EVERY line of this order in the workbench at once, addressed by subject id —
                  no host id needed, so the hand-off carries no platform assumption. Embedded this
                  navigates in-app; standalone the workbench is another admin page, hence a new tab.

                  A glyph button, matching the product tab's hand-off to the same destination: one
                  affordance appearing in two places should look like one affordance, and the icon
                  is what a reader already associates with the workbench. It was a text link, which
                  read as part of the column heading it sits beside and wrapped to two lines on a
                  narrow viewport — a control that looks like a label. The name it loses lives in
                  the accessible name, which is the same sentence the tooltip carries. */}
                <Show when={props.lines.length > 0}>
                  <a
                    class={buttonClass('secondary', 'xs', 'px-1.5!')}
                    href={hostNav.routeHref(
                      '/workbench',
                      `subject_ids=${[...new Set(props.lines.map((l) => l.subjectId))].join('-')}&bring_children=1`,
                    )}
                    target={hostNav.opensNewTab ? '_blank' : undefined}
                    rel={hostNav.opensNewTab ? 'noopener' : undefined}
                    title={__("Open this order's products in the workbench")}
                    aria-label={__("Open this order's products in the workbench")}
                  >
                    <WorkbenchLinkIcon class="h-4 w-4" />
                  </a>
                </Show>
              </span>
            </th>
            <th class="px-1.5 py-2 text-left text-xs font-medium text-text uppercase tracking-wide">
              {_x('SKU', 'WooCommerce product field: SKU (stock keeping unit)')} /{' '}
              <i>
                {_x('GTIN', 'product barcode number: GTIN (Global Trade Item Number — EAN, UPC)')}
              </i>
            </th>
            <Show when={showPrice()}>
              <th class="px-1.5 py-2 text-right text-xs font-medium text-text uppercase tracking-wide">
                {_x('Price', 'order line column')}
              </th>
            </Show>
            <th class="px-1.5 py-2 text-center text-xs font-medium text-text uppercase tracking-wide">
              {_x('Qty', 'order line column')}
            </th>
            <Show when={showShippingClass()}>
              <th class="px-1.5 py-2 text-left text-xs font-medium text-text uppercase tracking-wide">
                {__('Shipping class')}
              </th>
            </Show>
            <Show when={showStock()}>
              <th class="px-1.5 py-2 text-left text-xs font-medium text-text uppercase tracking-wide">
                {_x('Stock concerns', 'order line column')}
              </th>
            </Show>
            {/* The picker lives on the table it controls — the table has no toolbar, and a control
              anywhere else reads as page-wide. It sits in the last header cell, right-aligned like
              the stage cells below it. */}
            <th class="px-1.5 py-2 text-xs font-medium text-text uppercase tracking-wide">
              <div class="flex items-center justify-end gap-2">
                {_x('Stage', 'order line column')}
                <button
                  type="button"
                  class={buttonClass('secondary', 'xs', 'px-1.5!')}
                  title={__('Columns')}
                  aria-label={__('Columns')}
                  onClick={() => setPickerOpen(true)}
                >
                  <ColumnsSettingsIcon class="h-4 w-4" />
                </button>
              </div>
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <For
            each={props.lines}
            fallback={
              <tr>
                <td colspan={emptyColSpan()} class="px-3 py-6 text-center text-text-muted text-sm">
                  {__('No lines on this order.')}
                </td>
              </tr>
            }
          >
            {(line) => {
              const stage = lineStage(line);
              const shippable = Math.max(0, line.qtyOrdered - line.qtyCorrected - line.qtyShipped);
              // `stagedQty > 0`, not `shippable > 0`: a line can hold a stage it is no longer allowed
              // to ship — stage it, then correct away the rest of the quantity, and `shippable` falls
              // to 0 while the units stay staged. Keyed on `shippable` the button flipped back to
              // "Stage" and disabled itself, so the operator could see the staged units and had no way
              // to release them. What decides the label is what is staged, not what is still shippable.
              const isFullyStaged = line.stagedQty > 0 && line.stagedQty >= shippable;
              // On an order that cannot ship, the only move is back: a line holding a stage — even
              // a partial one — releases it, and an unstaged one is disabled with the order's reason.
              const releases = (): boolean =>
                isFullyStaged || (props.stageBlockedReason !== undefined && line.stagedQty > 0);
              const blockedByOrder = (): boolean =>
                props.stageBlockedReason !== undefined && !releases();
              const buttonLabel = (): string =>
                releases() ? _x('Un-stage', 'order line action') : _x('Stage', 'order line action');
              // ACCESSORS, not values. `props.pendingLineId` goes on changing after this row is
              // built, and a plain const captures whatever it happened to be at build time — which
              // is the worst possible instant. The row is rebuilt when `lines` changes identity, and
              // the LAST such rebuild is the one inside `onSuccess`, while the mutation is still
              // pending; settling changes no line, so nothing rebuilt the row again and the button
              // stayed disabled until a reload. Read through a function and it tracks.
              const isPending = (): boolean => props.pendingLineId === line.id;
              // Nothing to ship AND nothing staged means there is no toggle to make. Either one alone
              // still leaves a move available: stage it, or give the stage back.
              // A line committed stock cannot cover is not staged: the server refuses it, and the
              // button says so before the click rather than after. Giving a stage back stays open.
              const blockedByStock = (): boolean => !releases() && (line.stockShortQty ?? 0) > 0;
              const isDisabled = (): boolean =>
                (shippable === 0 && line.stagedQty === 0) ||
                blockedByOrder() ||
                blockedByStock() ||
                isPending();
              return (
                <tr
                  class={`group bg-surface transition-colors ${stage === 'M' ? 'bg-green-50/40' : 'hover:bg-surface-hover'}`}
                >
                  {/* The thumbnail is the tallest thing in the row, so its padding sets the row
                    height for every line. `py-0.5` — the image already carries its own visual
                    padding, and the rows are separated by a gap now, so the cell does not need to
                    provide the breathing room a contiguous table wanted. */}
                  <td class="px-1.5 py-0.5">
                    <ThumbnailZoom src={line.imageUrl} alt={line.name} />
                  </td>
                  <td class="px-1.5 py-2">
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
                        ariaLabel={sprintf(
                          /* translators: %s: the product's name */ __('Product actions for %s'),
                          line.name,
                        )}
                        triggerClass="inline-flex items-center gap-1 text-left font-medium text-gray-800 hover:text-primary cursor-pointer decoration-dotted underline-offset-2 hover:underline"
                        trigger={
                          <>
                            {line.name}
                            <span class="text-2xs text-text-muted" aria-hidden="true">
                              ▾
                            </span>
                          </>
                        }
                        // Host-platform links (editor, storefront) + the client-built ledger route —
                        // one shared builder so this menu stays identical to the workbench name cell.
                        items={buildProductActionItems({
                          links: line.links,
                          subjectId: line.subjectId,
                          hostNav,
                        })}
                      />
                    </Show>
                  </td>
                  <td class="px-1.5 py-2 font-mono text-xs text-gray-500">
                    {line.sku || '—'}
                    {/* Only when it adds something: plenty of stores use the barcode as the SKU, and
                      printing the same digits twice spends a line saying nothing. Compared with
                      leading zeros stripped — a GTIN is zero-padded to a fixed length, so a UPC-12
                      SKU and its EAN-13 form are the same number. */}
                    <Show
                      when={
                        line.gtin && line.gtin.replace(/^0+/, '') !== line.sku.replace(/^0+/, '')
                      }
                    >
                      <div class="text-[11px] italic">{line.gtin}</div>
                    </Show>
                  </td>
                  <Show when={showPrice()}>
                    <td class="px-1.5 py-2 text-right tabular-nums text-gray-700">
                      {/*
                    Resolve through the shared `decimal:money` view
                    so a future merchant
                    override (e.g. currency-prefixed) lands in every
                    SPA at once instead of needing per-SPA edits.
                    The price shown is the one paid; a discounted line keeps its list price above
                    it, struck, so the figures still match the host order's.
                  */}
                      <Show when={hasDiscount(line)}>
                        <s
                          class="block text-[11px] text-text-muted"
                          title={__('Price before discount')}
                        >
                          <Show when={moneyView} fallback={line.unitPrice}>
                            <Dynamic
                              component={moneyView!}
                              value={line.unitPrice}
                              row={line}
                              column={{ dataType: 'decimal:money', editorConfig: {} }}
                              ctx={{}}
                            />
                          </Show>
                        </s>
                      </Show>
                      <Show when={moneyView} fallback={<span>{netUnitPrice(line)}</span>}>
                        <Dynamic
                          component={moneyView!}
                          value={netUnitPrice(line)}
                          row={line}
                          column={{ dataType: 'decimal:money', editorConfig: {} }}
                          ctx={{}}
                        />
                      </Show>
                    </td>
                  </Show>
                  <td class="px-1.5 py-2 text-center tabular-nums">
                    <span
                      class={
                        line.qtyOrdered > 1 ? 'font-bold text-base text-gray-900' : 'text-gray-700'
                      }
                    >
                      {line.qtyOrdered}
                    </span>
                    <Show when={line.qtyCorrected > 0}>
                      <span
                        class="ml-1 text-xs text-red-500"
                        title={sprintf(
                          _n(
                            '%d corrected (cancelled / written-off)',
                            '%d corrected (cancelled / written-off)',
                            line.qtyCorrected,
                          ),
                          line.qtyCorrected,
                        )}
                      >
                        −{line.qtyCorrected}
                      </span>
                    </Show>
                    <Show when={line.qtyShipped > 0}>
                      <span
                        class="ml-1 text-xs text-emerald-600"
                        title={sprintf(
                          _n('%d already shipped', '%d already shipped', line.qtyShipped),
                          line.qtyShipped,
                        )}
                      >
                        ✓{line.qtyShipped}
                      </span>
                    </Show>
                  </td>
                  <Show when={showShippingClass()}>
                    <td class="px-1.5 py-2 text-xs whitespace-nowrap">
                      {/* A dash, as this table prints for a missing SKU. Per line a cell holds one value,
                        so the dash says "no class" unambiguously; the queue's column keeps the word
                        `none` because there it sits inside a list, where a dash reads as punctuation. */}
                      <Show
                        when={line.shippingClass}
                        fallback={<span class="text-gray-300">—</span>}
                      >
                        {line.shippingClass}
                      </Show>
                    </td>
                  </Show>
                  <Show when={showStock()}>
                    <td class="px-1.5 py-2 text-center">
                      {/*
                    Resolve through the shared `stock-concerns` view.
                    The built-in renders
                    a StockConcernBadge; a plug-in can override it
                    once and the new component renders everywhere.
                  */}
                      <Show
                        when={stockConcernsView}
                        fallback={
                          <StockConcernBadge
                            bits={line.stockState}
                            deficitQty={line.stockDeficitQty}
                            unmanaged={line.unmanaged}
                            inbound={line.inbound}
                          />
                        }
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
                  </Show>
                  <td class="px-1.5 py-2">
                    {/*
                      The line's state and the controls that change it share one cell. Pills first,
                      buttons after, in a row that wraps *upward* (`flex-wrap-reverse`): where the
                      row is wide enough they sit side by side, and where it is not the buttons move
                      onto a line above the pills rather than the table growing a column. From `md` up neither
                      row wraps at all (`md:flex-nowrap`): a table gives a cell whose content *can*
                      wrap only its narrowest width, so a wrapping stage cell is the column the
                      table squeezes first — it stacked at 900px with room to spare. Held on one
                      line, it makes the product name give way instead, which is the cheaper trade.

                      Right-aligned in both layouts, so the Stage button lands at the same x on every
                      row whatever the number of pills — it is the control an operator works down the
                      list with, and a target that moves row to row is one they have to look for.
                    */}
                    <div class="flex flex-wrap-reverse items-center justify-end gap-2 md:flex-nowrap">
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
                        const pills: Array<{
                          text: string;
                          count: number;
                          tone: PillTone;
                          /** Awaiting a person: draws the waiting glyph beside the count. */
                          pending?: boolean;
                          title?: string;
                        }> = [
                          {
                            text: sprintf(
                              _nx(
                                '%d staged',
                                '%d staged',
                                line.stagedQty,
                                'dispatch line disposition',
                              ),
                              line.stagedQty,
                            ),
                            count: line.stagedQty,
                            // Yellow-green, one hue short of the emerald `shipped` wears. Staged is
                            // work that is done but not final, so it reads as green-on-the-way rather
                            // than as its own unrelated colour — the row's pills are a progression
                            // (pending → staged → shipped) and should look like one.
                            tone: 'lime' as PillTone,
                            title: packedTitle(line, 'staged', me),
                          },
                          {
                            text: sprintf(
                              _nx('%d pending', '%d pending', pending, 'dispatch line disposition'),
                              pending,
                            ),
                            count: pending,
                            tone: 'neutral' as PillTone,
                          },
                          {
                            text: sprintf(
                              _nx(
                                '%d shipped',
                                '%d shipped',
                                line.qtyShipped,
                                'dispatch line disposition',
                              ),
                              line.qtyShipped,
                            ),
                            count: line.qtyShipped,
                            tone: 'success' as PillTone,
                            title: packedTitle(line, 'shipped', me),
                          },
                          // Corrected splits in two. `unprocessed` is counted from the corrections
                          // themselves; `processed` is the remainder of the line's own total rather
                          // than a second count, so the buckets still sum to qty_ordered even if the
                          // two sources disagree — a visible arithmetic hole would be worse than a
                          // pill that is momentarily one short.
                          ...(() => {
                            const known = props.unprocessedCorrectedByLine;
                            // Not knowing is not "nothing is waiting". Until the corrections resolve,
                            // show the single undifferentiated pill rather than defaulting the unknown
                            // half to zero, which would render every correction as settled — the
                            // reassuring reading, reached by having no data.
                            if (!known) {
                              return [
                                {
                                  text: sprintf(
                                    _nx(
                                      '%d corrected',
                                      '%d corrected',
                                      line.qtyCorrected,
                                      'dispatch line disposition',
                                    ),
                                    line.qtyCorrected,
                                  ),
                                  count: line.qtyCorrected,
                                  tone: 'danger' as PillTone,
                                },
                              ];
                            }
                            const unprocessed = Math.min(
                              line.qtyCorrected,
                              known.get(line.id) ?? 0,
                            );
                            const processed = Math.max(0, line.qtyCorrected - unprocessed);
                            return [
                              {
                                text: sprintf(
                                  _nx(
                                    '%d corrected',
                                    '%d corrected',
                                    processed,
                                    'dispatch line disposition',
                                  ),
                                  processed,
                                ),
                                count: processed,
                                tone: 'danger' as PillTone,
                                pending: false,
                                title: sprintf(
                                  _n(
                                    '%d corrected unit, already processed',
                                    '%d corrected units, already processed',
                                    processed,
                                  ),
                                  processed,
                                ),
                              },
                              {
                                // Same msgid as above: the units are corrected either way, and the
                                // waiting is carried by the tone, the glyph and the tooltip rather
                                // than by a second word a translator would have to keep in step.
                                text: sprintf(
                                  _nx(
                                    '%d corrected',
                                    '%d corrected',
                                    unprocessed,
                                    'dispatch line disposition',
                                  ),
                                  unprocessed,
                                ),
                                count: unprocessed,
                                // Amber is this page's "a person still owes an action" colour — the
                                // same one the corrections panel's Pending chip and the pending-action
                                // filter use. Categorical elsewhere in this row, deliberately stateful
                                // here.
                                tone: 'warning' as PillTone,
                                pending: true,
                                title: sprintf(
                                  _n(
                                    '%d corrected unit, not yet processed',
                                    '%d corrected units, not yet processed',
                                    unprocessed,
                                  ),
                                  unprocessed,
                                ),
                              },
                            ];
                          })(),
                        ].filter((p) => p.count > 0);
                        return (
                          <div class="flex flex-wrap items-center justify-end gap-1 md:flex-nowrap">
                            <For
                              each={pills}
                              fallback={<span class="text-xs text-text-muted">—</span>}
                            >
                              {(p) => (
                                <Pill tone={p.tone} class="tabular-nums" title={p.title}>
                                  {p.text}
                                  <Show when={p.pending}>
                                    {/* The tone alone would carry this, and tone alone is what a
                                    colour-blind operator cannot read — amber against the
                                    neighbouring danger pill is the confusable pair. Decorative to
                                    assistive tech, which reads the pill's title instead. */}
                                    <HourglassIcon class="h-3 w-3 shrink-0" />
                                  </Show>
                                </Pill>
                              )}
                            </For>
                          </div>
                        );
                      })()}
                      <div class="inline-flex shrink-0 items-center gap-1.5">
                        {/*
                      Per-line correction affordance, present on every line rather than revealed by
                      hovering it. A control you cannot see is a control most operators never learn
                      exists, and it is discoverable by mouse only — a keyboard user meets it by
                      tabbing into something invisible. So it rests muted and quiet, and earns
                      emphasis: amber on hover (the colour that means someone owes an action here),
                      red and full strength when the line already has unresolved stock concerns.
                      Disabled when nothing remains to correct.
                    */}
                        <Show when={props.onOpenCorrection}>
                          {(() => {
                            const hasConcern = line.stockState !== 0;
                            const correctable = shippable > 0;
                            // Recessive at rest, full strength under the row's hover. Not `opacity-0`:
                            // the point is that it is always there. `disabled:` outranks this on
                            // specificity, so a line with nothing left to correct still reads as off.
                            const visibility = hasConcern
                              ? 'opacity-100'
                              : 'opacity-70 group-hover:opacity-100 focus-visible:opacity-100';
                            const color = hasConcern
                              ? 'text-red-600 hover:bg-red-50 hover:border-red-300 border-red-200'
                              : 'text-text-muted hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700 border-border';
                            return (
                              <button
                                type="button"
                                class={`px-1.5 py-0.5 text-sm leading-none rounded border font-bold cursor-pointer transition-opacity ${visibility} ${color} disabled:opacity-40 disabled:cursor-not-allowed`}
                                disabled={!correctable}
                                onClick={() => props.onOpenCorrection!(line.id)}
                                title={
                                  correctable
                                    ? __('Create a correction on this line (C)')
                                    : __('Nothing left to correct on this line')
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
                            // Neutral at rest — it is one control among several on a dense row, and a
                            // row of coloured buttons ranks nothing. The colour arrives on hover, when
                            // the pointer has already picked this button out and the only question
                            // left is which way it moves the line: lime to stage (the same "pending a
                            // good change" the staged pill wears, so the button previews the pill it
                            // will produce), red to give the stage back. `secondary`'s own
                            // `hover:bg-surface-raised` stands down for these — see `namesHoverBg`.
                            class={
                              releases()
                                ? 'hover:border-red-300 hover:bg-red-50 hover:text-red-700'
                                : 'hover:border-lime-300 hover:bg-lime-50 hover:text-lime-800'
                            }
                            disabled={isDisabled()}
                            onClick={() => props.onToggleStage!(line)}
                            data-testid="line-stage-toggle"
                            data-stage-blocked={
                              blockedByOrder() ? 'order' : blockedByStock() ? 'stock' : undefined
                            }
                            title={
                              blockedByOrder() && !isPending()
                                ? props.stageBlockedReason
                                : isFullyStaged && shippable === 0
                                  ? __(
                                      'These units are staged but no longer shippable — release them',
                                    )
                                  : blockedByStock() && !isPending()
                                    ? __(
                                        'Not enough stock for this order. Record stock found on the shelf with an on-hand correction, or correct the order (!) for the units that cannot ship.',
                                      )
                                    : isDisabled() && !isPending()
                                      ? __('Nothing left to stage on this line')
                                      : undefined
                            }
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
                            {buttonLabel()}
                          </Button>
                        </Show>
                      </div>
                    </div>
                  </td>
                </tr>
              );
            }}
          </For>
        </tbody>
      </table>
      <Show when={pickerOpen()}>
        <ColumnPicker
          columns={ORDER_LINE_COLUMNS}
          hidden={hiddenColumns()}
          onToggle={toggleColumn}
          onClose={() => setPickerOpen(false)}
        />
      </Show>
    </div>
  );
}

/**
 * Sticky bar above the line table carrying the Ship action. Lives
 * here (not as a button inside the Header) because Ship is the
 * order's gravity well — the single point of merchant intent that
 * resolves the whole dispatch flow — and deserves a dedicated visual
 * weight separate from navigation chrome.
 */
function ShipBar(props: {
  order: DispatchOrderSummary;
  ctx: DispatchOrderDetailContext;
  /** In the queue's context there are orders either side; a promoted tab has none. */
  neighbours: boolean;
  prevDisabled: boolean;
  nextDisabled: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
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
            <Show when={props.ctx.canShip} fallback={<span>{props.ctx.blockedReason}</span>}>
              <span class="font-medium text-gray-800">{__('Ready to ship')}</span>
              <span class="ml-2 text-gray-500">
                —{' '}
                {sprintf(
                  _n('%d line outstanding', '%d lines outstanding', totalOutstanding()),
                  totalOutstanding(),
                )}
              </span>
            </Show>
          </div>
        }
      >
        {/* Shipped: the Ship action is gone, and its place goes to what a packer does next — move
            on. The confirmation itself is a toast (see the ship mutation), so the bar is free for
            the one thing left to do here. */}
        <Show when={props.neighbours}>
          <div class="ml-auto flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={props.prevDisabled}
              onClick={() => props.onPrev()}
              title={__('Previous order in queue')}
            >
              {_x('← Prev', 'order navigation')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={props.nextDisabled}
              onClick={() => props.onNext()}
              title={__('Next order in queue')}
            >
              {_x('Next →', 'order navigation')}
            </Button>
          </div>
        </Show>
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
                <Dynamic
                  component={slot.component}
                  orderHexId={props.ctx.hexId}
                  order={props.order}
                />
              </Show>
            )}
          </For>
          {/*
            The core "Ship order" action, plus any add-on-contributed actions (the paid "Ship staged"
            partial-ship), resolved for this order's context. Availability/labels/ordering come from
            the registry — this shell never branches on tier.
          */}
          <SplitActionButton
            scope="dispatch.order.detail"
            ctx={props.ctx}
            overflowLabel="Order actions"
          />
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
    props.lines.reduce(
      (sum, l) => sum + Math.max(0, l.qtyOrdered - l.qtyCorrected - l.qtyShipped),
      0,
    );
  const lineCount = (): number => props.lines.length;

  return (
    <Modal
      onClose={props.onCancel}
      closeOnBackdrop={!props.isPending}
      closeOnEsc={!props.isPending}
      label={__('Confirm shipment')}
    >
      <ModalPanel size="md">
        <ModalHeader title={__('Ship this order?')} />
        <div class="p-4">
          <p class="text-sm text-gray-600 mb-3">
            {sprintf(
              /* translators: 1: a count of units ("3 units"), 2: a count of lines ("2 lines"), 3: the customer's name. */
              __('Confirming will dispatch %1$s across %2$s to %3$s.'),
              sprintf(_n('%d unit', '%d units', unitCount()), unitCount()),
              sprintf(_n('%d line', '%d lines', lineCount()), lineCount()),
              props.order.customerName,
            )}
          </p>
          <ul class="text-xs text-gray-700 space-y-1 mb-4 list-disc pl-5">
            <li>{__('Stock will move out of the quantity held for this order, permanently.')}</li>
            <li>{__('A shipment record is created, carrying the cost of the goods shipped.')}</li>
            <li>
              {__('The WooCommerce order will be marked completed and the customer email sent.')}
            </li>
            <li>{__('This is irreversible without creating corrections.')}</li>
          </ul>
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={props.onCancel} disabled={props.isPending}>
            {__('Cancel')}
          </Button>
          <Button variant="success" onClick={props.onConfirm} disabled={props.isPending} autofocus>
            <Show when={props.isPending} fallback={<>{__('Confirm ship')}</>}>
              {_x('Shipping…', 'button while busy: the order is being shipped')}
            </Show>
          </Button>
        </ModalFooter>
      </ModalPanel>
    </Modal>
  );
}

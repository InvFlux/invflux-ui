import { __, _x } from '@invflux/i18n';
import { entityActionRegistry, type EntityActionContext, TruckIcon } from '@invflux/ui';

/**
 * Core `dispatch.order.detail` title-bar actions, registered once into the shared entity-action
 * registry. The `ShipBar` supplies a live {@link DispatchOrderDetailContext}
 * each render; these actions are pure (lazy label, conditions + `run` read the context), so an add-on
 * — e.g. the paid "Ship staged" partial-ship action — contributes more `dispatch.order.detail`
 * actions through the same seam without touching this file.
 *
 * The context fields below the divider are the **contract** an add-on action relies on (a partial
 * ship is keyed by `hexId`; `canPartialShip` says a partial is structurally possible; `onDone`
 * refreshes the host's order query after the add-on's mutation — so the add-on needs no access to the
 * host's query client).
 */
export interface DispatchOrderDetailContext extends EntityActionContext {
  /** Dispatch readiness status (Untouched / Started / Staged / Shipped / Cancelled). */
  status: string;
  /** Every still-open line is fully staged — the whole order can ship now. */
  canShip: boolean;
  /** Tooltip explaining why a full ship is blocked, when it is. */
  blockedReason: string;
  /** A ship mutation is in flight — the action shows disabled to prevent a double-fire. */
  shipPending: boolean;
  /** Open the confirm-ship modal (core, Essentials). */
  openShip: () => void;

  // ── Contract read by add-on actions (e.g. the paid partial-ship action) ─────────
  /** Order hex id — add-on REST calls are keyed by hex (`…/orders/{hexId}/shipments`). */
  hexId: string;
  /** Structural: some lines are staged and others still open, so a partial ship is possible. */
  canPartialShip: boolean;
  /** The staged lines (label + staged qty), for an add-on's partial-ship confirm preview. */
  stagedLines: { label: string; qty: number }[];
  /**
   * Units still to send across the whole order (ordered − corrected − shipped, per line), so a
   * partial-ship action can say how much of the order it covers: "3 of 7 units".
   */
  outstandingUnits: number;
  /** Refresh the order detail after an add-on mutation (host owns its own query invalidation). */
  onDone: () => void;
}

const SCOPE = 'dispatch.order.detail';

let registered = false;

/** Idempotent: register the core dispatch order-detail actions once (safe from multiple entry points). */
export function registerDispatchOrderActions(): void {
  if (registered) return;
  registered = true;

  // The canonical headline. `locked` so no add-on can displace Ship from the primary slot; hidden
  // once the order has shipped (the ShipBar then shows its "Order shipped ✓" state instead).
  entityActionRegistry.register<DispatchOrderDetailContext>(SCOPE, {
    owner: 'core',
    id: 'ship',
    label: () => __('Ship order'),
    icon: TruckIcon,
    group: 'primary',
    locked: true,
    isAvailable: (c) => 'Shipped' !== c.status,
    disabledReason: (c) =>
      !c.canShip
        ? c.blockedReason
        : c.shipPending
          ? _x('Shipping…', 'button while busy: the order is being shipped')
          : undefined,
    run: (c) => c.openShip(),
  });
}

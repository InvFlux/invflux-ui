import { __ } from '@invflux/i18n';
import {
  DEFAULT_PRIMARY_WEIGHT,
  entityActionRegistry,
  type EntityActionContext,
} from '@invflux/ui';

/**
 * Core finalize actions for the open receiving-session form, registered once
 * into the shared entity-action registry under the `procurement.po-receive` scope. The form supplies a
 * live {@link PoReceiveActionContext} each render; the shell renders them as a split button.
 *
 * Headline arbitration ({@link EntityAction.promoteWhen}):
 * - **Nothing short** → "Confirm receipt" headlines; the two short resolutions are absent (menu empty).
 * - **A line is short** → the NON-DESTRUCTIVE "Receive & keep open" is promoted to the headline (the
 *   common split-shipment case, and always reversible from the partially_received banner); "Close short"
 *   (the destructive write-off) sits one click deeper in the divided destructive group; "Confirm
 *   receipt" drops into the menu disabled with a tooltip. Biasing the default toward the reversible
 *   action is deliberate — an accidental keep-open just shows the PO as still-owed (a visible nag),
 *   whereas an accidental close-short silently drops the "still owed" signal.
 *
 * Keeping a PO open across deliveries is base behaviour — no tier gate here. The scope stays open as
 * the seam a future advance-shipment-notice add-on registers its own reconcile actions into.
 */
export interface PoReceiveActionContext extends EntityActionContext {
  /** ≥1 line is short of its ordered qty (cumulative received-so-far + this session). */
  isShort: boolean;
  /** How many lines are short — for the amber hint / tooltips. */
  shortCount: number;
  /** The all-open-lines-counted review gate is satisfied (or waived by the lax cap). */
  gateOk: boolean;
  /**
   * Whether this user may finish an order on less than was ordered.
   *
   * A server-enforced authority, mirrored here so the action is not offered where the API would
   * refuse it — a worker who counts a short delivery, presses the only button that finishes it and
   * meets a 403 has been walked through the whole count for nothing. Absent it they still receive
   * what arrived; only the write-off is out of reach.
   */
  canCloseShort: boolean;
  /**
   * This count received at least one unit. A count of zeroes is a real count ("checked, none
   * arrived"), but it has no receipt to confirm and nothing to keep the order open *for* — finishing
   * short is the one outcome it can have.
   */
  anyReceived: boolean;
  /**
   * An earlier delivery already landed on this order. Without one, finishing it short on nothing is
   * not a short delivery but an order that never came, which is cancelling it.
   */
  hasEarlierReceipts: boolean;
  /** A receive/finalize mutation is in flight — every action shows disabled to prevent a double-fire. */
  busy: boolean;
  /** Finalize as fully received (every line received in full). */
  onConfirm: () => void;
  /** Receive what arrived and keep the PO open for the next delivery (→ partially_received). */
  onKeepOpen: () => void;
  /** Receive what arrived and write off the remainder as a recorded short (→ received). */
  onCloseShort: () => void;
}

export const PO_RECEIVE_ACTIONS_SCOPE = 'procurement.po-receive';
const SCOPE = PO_RECEIVE_ACTIONS_SCOPE;

let registered = false;

/** Idempotent: register the core finalize actions once (safe to import from multiple entry points). */
export function registerPoReceiveActions(): void {
  if (registered) return;
  registered = true;
  const reg = entityActionRegistry;
  const core = <const>{ owner: 'core' };

  // Confirm receipt — headlines when nothing is short. When short it declines the headline (promoteWhen
  // false) but stays available, so it drops into the menu DISABLED, routing the worker to one of the two
  // short resolutions. Gated on every open line being counted when it is the finalize (not short).
  reg.register<PoReceiveActionContext>(SCOPE, {
    ...core,
    id: 'confirm-receipt',
    label: () => __('Confirm receipt'),
    group: 'primary',
    promoteWhen: (c) => (c.isShort ? false : DEFAULT_PRIMARY_WEIGHT),
    disabledReason: (c) =>
      c.busy
        ? __('Working…')
        : !c.anyReceived
          ? __('Nothing was counted as arriving — there is no receipt to confirm.')
          : c.isShort
            ? __('Some lines are short — choose Receive & keep open, or Close short.')
            : !c.gateOk
              ? __('Enter a received quantity on every open line (0 is fine) to finalize.')
              : undefined,
    run: (c) => c.onConfirm(),
  });

  // Receive & keep open — the non-destructive short resolution: receive what arrived, the PO stays open
  // for the rest. Promoted to the headline while short. No all-counted gate — a partial delivery
  // legitimately leaves later lines uncounted.
  reg.register<PoReceiveActionContext>(SCOPE, {
    ...core,
    id: 'keep-open',
    label: () => __('Receive & keep open'),
    group: 'primary',
    // Only once something arrived: keeping the order open for "the rest" of a delivery that brought
    // nothing is cancelling the count, which the form offers beside this.
    isAvailable: (c) => c.isShort && c.anyReceived,
    promoteWhen: (c) => (c.isShort ? DEFAULT_PRIMARY_WEIGHT + 100 : false),
    disabledReason: (c) => (c.busy ? __('Working…') : undefined),
    run: (c) => c.onKeepOpen(),
  });

  // Close short — the terminal write-off: receive what arrived and write off the remainder as a recorded
  // short (never a silent drop), ending the PO. Destructive (below the divider); only offered while
  // short, and gated on every open line being counted.
  //
  // Shown-but-disabled rather than hidden when the authority is missing: the worker is looking at a
  // short delivery and needs to know that finishing the order is a thing someone can do, and that it
  // is not them. Hiding it would leave them hunting for a button that is not there.
  reg.register<PoReceiveActionContext>(SCOPE, {
    ...core,
    id: 'close-short',
    label: () => __('Close short'),
    group: 'destructive',
    isAvailable: (c) => c.isShort,
    disabledReason: (c) =>
      c.busy
        ? __('Working…')
        : !c.canCloseShort
          ? __('Finishing an order on less than was ordered needs permission you do not have.')
          : !c.anyReceived && !c.hasEarlierReceipts
            ? __(
                'Nothing has arrived on this order yet — cancel the order rather than finishing it short.',
              )
            : !c.gateOk
              ? __('Enter a received quantity on every open line (0 is fine).')
              : undefined,
    run: (c) => c.onCloseShort(),
  });
}

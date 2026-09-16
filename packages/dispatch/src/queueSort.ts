import type { DispatchOrderSummary } from './types';

/**
 * One ranking rule in the queue's client-side sort — the mirror of the server's
 * `QueueSortFragment`, down to the `order` numbers.
 *
 * The client sorts for real, not as a fallback: the queue loads its working set once and then polls
 * for deltas, so after the first page everything an operator sees was ordered here. A rule that
 * exists on one side and not the other is a queue that disagrees with itself the moment a delta
 * arrives.
 */
export interface QueueSortRule {
  /** Identifier for override — re-registering it replaces this rule in place. */
  name: string;
  /**
   * Ascending position within the contributed middle; ties break on registration order. Use the
   * same number as the server fragment it mirrors, or the two orderings diverge under load.
   */
  order?: number;
  /**
   * Whether this rule currently applies, evaluated at **sort time** — mirroring `SlotContribution`,
   * and mirroring the server, where the add-on's decorator asks the licence gate when the registry
   * resolves rather than when the plugin boots.
   *
   * A contributing add-on's bundle loads whenever its plugin is active, which is a different
   * question from whether its licence allows the feature right now. Read the entitlement here, via
   * {@link queueSortEntitlements}, or a lapsed install ranks by something the server has stopped
   * honouring and the two halves of the queue disagree.
   */
  enabled?: () => boolean;
  /** Negative when `a` ranks first, matching `Array.prototype.sort`. */
  compare: (a: DispatchOrderSummary, b: DispatchOrderSummary, now: number) => number;
}

/**
 * The install's current dispatch entitlements, for a rule's {@link QueueSortRule.enabled}.
 *
 * A plain string→boolean map, deliberately: the base publishes whatever the host handed it and
 * names none of the keys, so no paid-tier feature key appears in this package.
 */
let entitlementSource: () => Record<string, boolean> = () => ({});

/** Host-only. Called once the dispatch context is available; see `OrderList`. */
export function publishQueueSortEntitlements(source: () => Record<string, boolean>): void {
  entitlementSource = source;
}

export function queueSortEntitlements(): Record<string, boolean> {
  return entitlementSource();
}

/**
 * How the queue ranks rows client-side, and what may contribute a rule.
 *
 * **The base registers its own through the same `register()` an add-on uses**, so there is no
 * privileged core path — the same property the server's three registries have.
 *
 * **Two ends of the sort are fixed in {@link sortQueue} and cannot be contributed to**, because they
 * are correctness rather than ranking preference: a closed order never outranks an open one, and the
 * id closes the clause so the ordering is total. See the server's `QueueSortRegistry` for the long
 * form of both arguments.
 *
 * Membership is read at sort time, not captured, so a rule registered by an add-on module that
 * evaluates after this one still takes effect.
 */
class QueueSortRegistry {
  private readonly byName = new Map<string, QueueSortRule>();
  private readonly registeredAt = new Map<string, number>();
  private sequence = 0;

  /** Register a rule, or override one by re-registering its name (keeping its original position). */
  register(rule: QueueSortRule): void {
    const key = rule.name.toLowerCase();
    if (!this.registeredAt.has(key)) this.registeredAt.set(key, this.sequence++);
    this.byName.set(key, rule);
  }

  /** Every rule, ascending by `order` then registration order. */
  all(): QueueSortRule[] {
    return [...this.byName.values()].sort(
      (a, b) =>
        (a.order ?? 100) - (b.order ?? 100) ||
        (this.registeredAt.get(a.name.toLowerCase()) ?? 0) -
          (this.registeredAt.get(b.name.toLowerCase()) ?? 0),
    );
  }
}

export const queueSortRegistry = new QueueSortRegistry();

/**
 * Ready to ship: every line staged, nothing waiting on a correction, and the order actually in the
 * live queue.
 *
 * `workflowState === 'Active'` stands in for the server's `queue_active = 1`. An add-on that
 * registers a state carving rows out of `Active` would need this to learn about it — the one place
 * the client's ordering can drift from the server's, and the reason the server keeps its own ORDER
 * BY for the paged path rather than trusting this to be the only implementation.
 */
function isReady(order: DispatchOrderSummary): boolean {
  return (
    order.stagedCount === order.lineCount &&
    order.workflowState === 'Active' &&
    order.unprocessedCorrections === 0
  );
}

/** The committed dispatch date as a timestamp, or null when there is none to rank by. */
function edtValue(order: DispatchOrderSummary): number | null {
  if (order.estDispatch === null) return null;
  const due = Date.parse(order.estDispatch);

  return Number.isNaN(due) ? null : due;
}

// ── The base install's own rules, registered through the public seam ──────────────────────────

/** Actionable now outranks work that still needs something done to it. */
queueSortRegistry.register({
  name: 'readiness',
  order: 20,
  compare: (a, b) => Number(isReady(b)) - Number(isReady(a)),
});

/**
 * Concern bits that stop an order shipping outright, besides the deficit — whose effect on *this*
 * order the shortfall already states. Mirrors core's `StockConcern` (QualityHold 0x04, BatchExpired
 * 0x08); the advisory bits — inactive product, expiry risk, a warehouse short of its allocation — are
 * deliberately absent.
 */
const SHIP_BLOCKING_BITS = 0x04 | 0x08;

/** Committed stock cannot cover the order, or a concern blocks it: nothing a packer can finish now. */
function cannotShip(order: DispatchOrderSummary): boolean {
  return (order.stockShortQty ?? 0) > 0 || (order.stockState & SHIP_BLOCKING_BITS) !== 0;
}

/**
 * What can ship outranks what cannot. A store-wide deficit alone does not sink an order — it is
 * still coverable on its own — so an order short for itself falls below one that is merely in a
 * store-wide shortage, and lateness then ranks within each. The concern stays visible on the row;
 * floating it to the top only put work nobody could finish above work somebody could.
 */
queueSortRegistry.register({
  name: 'shippable',
  order: 30,
  compare: (a, b) => Number(cannotShip(a)) - Number(cannotShip(b)),
});

/**
 * Due soonest first — the committed dispatch date itself, ascending, so the most overdue leads and
 * the rest follow in the order they come due.
 *
 * The date, not days-late arithmetic. The two are the same ordering wherever a date exists, but a
 * floored day count collapses every not-yet-due order into one bucket and leaves them to be ranked
 * by id, i.e. creation order — on a queue where little is overdue that is most of the page, and the
 * date the merchant is accountable to would have no effect on it at all.
 *
 * Nulls last, matching the server's `est_dispatch IS NULL` term: an order with no committed date
 * must not outrank one that has one.
 */
queueSortRegistry.register({
  name: 'edt',
  order: 40,
  compare: (a, b) => {
    const av = edtValue(a);
    const bv = edtValue(b);
    if (av === null) return bv === null ? 0 : 1;
    if (bv === null) return -1;

    return av - bv;
  },
});

/**
 * The queue order, client-side: the two fixed ends, with every registered rule between them.
 *
 * Sorting here is what makes a delta honest. Splicing a changed row in place would leave an order
 * that just became urgent sitting at row 40 until someone reloaded — the row would be *correct* and
 * in the *wrong place*, which reads as the queue ignoring the change that just arrived.
 */
export function sortQueue(
  orders: readonly DispatchOrderSummary[],
  now: number = Date.now(),
): DispatchOrderSummary[] {
  const rules = queueSortRegistry.all();

  return [...orders].sort((a, b) => {
    // Lifecycle leads: a closed order never outranks an open one. The working set holds none, but
    // server mode sorts through here too, and the rule is the queue's, not the set's.
    const closed = Number(a.closedAt != null) - Number(b.closedAt != null);
    if (closed !== 0) return closed;

    for (const rule of rules) {
      if (rule.enabled?.() === false) continue;
      const verdict = rule.compare(a, b, now);
      if (verdict !== 0) return verdict;
    }

    // Total order, so a paged or polled queue cannot show one row twice and skip another as the
    // boundary moves through a tie.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

import type { DispatchOrderSummary, DispatchQueueFilters } from './types';

/**
 * The dispatch queue as a **replicated working set**: every un-closed order held client-side,
 * filtered and sorted locally, kept current by asking the server only what changed since a cursor.
 *
 * This module is the pure core — merge, sort, and the local filter predicate. No fetching, no
 * reactivity, no DOM, so the rules that decide what an operator sees are testable without a
 * browser. The Solid wiring lives in `queries.ts`; the surface lives in `routes/OrderList.tsx`.
 */

/**
 * Filter parameters no client can answer from the working set, because they are predicates over an
 * order's **lines** and the queue row deliberately carries none.
 *
 * Selecting one switches the surface to server mode. The split is stable rather than incidental: a
 * filter over the order is local, a filter over its contents is a query.
 */
export const SERVER_ONLY_FILTER_KEYS = ['sku', 'subject_ids', 'worksheet_id'] as const;

/**
 * Whether this URL state asks something the working set cannot answer on its own.
 *
 * Three ways to leave the set, and they are the only three:
 *
 * - **A filter over an order's lines** ({@link SERVER_ONLY_FILTER_KEYS}) — the row carries none.
 * - **A state the set does not hold.** Asking for `Closed`, or for every state via the no-filter
 *   token, reaches past closure. Answering that from the open set would return open orders while
 *   the chip said "All states" — the operator asks a wider question and is quietly given a
 *   narrower answer, which is the failure this whole area exists to prevent.
 * - **Waiting work**, because it is the one filter whose meaning spans closure: a refund settled by
 *   a whole-order cancel sits on a *closed* order, so "refunds owed" answered from the open set is
 *   a different and misleading number.
 */
export function needsServerMode(params: Record<string, string | undefined>): boolean {
  const asked = (key: string): boolean => {
    const raw = params[key];

    return raw !== undefined && raw !== '' && raw !== '_';
  };

  if (SERVER_ONLY_FILTER_KEYS.some(asked)) return true;
  if (asked('pending_action')) return true;

  const states = params.workflow_state;
  if (states === undefined) return false; // the default cut is the working set itself
  if (states === '' || states === '_') return true; // "every state" includes the closed ones

  return states.split(',').some((state) => state.trim() === CLOSED_STATE);
}

/**
 * The registered state whose rows the working set excludes, by name.
 *
 * A name rather than a derived fact, because the client cannot see `closed_at` on a state it has
 * only been handed a label for. An add-on registering a second closure-based state would need this
 * to learn about it; until one does, the base install's `Closed` is the whole story.
 */
const CLOSED_STATE = 'Closed';

/**
 * Apply a poll's rows to the set held in memory.
 *
 * **Closure is a departure.** A time-only delta returns every touched order, including those that
 * have left the working set — which is exactly why the poll carries no filter but the cursor. An
 * order that closed comes back with `closedAt` set and is dropped here; nothing needs to tell the
 * client to forget it, and no `removed` channel has to exist.
 *
 * Everything else is an upsert, **including rows the set has never seen**: a fresh order, or one
 * that reopened, belongs in the queue the moment it exists. It lands wherever the sort puts it,
 * rather than waiting behind a "3 new orders" prompt that makes an operator ask for their own work.
 *
 * Idempotent by id, because the cursor is deliberately rewound a little on every poll: merging a
 * boundary write twice costs nothing, and missing it once costs a row that is wrong until reload.
 */
export function mergeDelta(
  current: ReadonlyMap<string, DispatchOrderSummary>,
  incoming: readonly DispatchOrderSummary[],
): { orders: Map<string, DispatchOrderSummary>; added: number; updated: number; removed: number } {
  const orders = new Map(current);
  let added = 0;
  let updated = 0;
  let removed = 0;

  for (const order of incoming) {
    if (order.closedAt !== null && order.closedAt !== undefined) {
      if (orders.delete(order.id)) removed += 1;
      continue;
    }
    if (orders.has(order.id)) updated += 1;
    else added += 1;
    orders.set(order.id, order);
  }

  return { orders, added, updated, removed };
}

/**
 * The next `updated_since` cursor, rewound by a hair.
 *
 * Two writes can share a timestamp, and a row written in the same microsecond the server read its
 * clock would otherwise fall between two polls and never be seen again — a row wrong until the page
 * is reloaded, which is the failure mode this whole design exists to avoid. Overlapping re-delivers
 * a handful of rows the merge is already idempotent about.
 */
export function rewindCursor(serverTime: string, seconds = 2): string {
  const parsed = Date.parse(serverTime.replace(' ', 'T') + 'Z');
  if (Number.isNaN(parsed)) return serverTime;

  return new Date(parsed - seconds * 1000).toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * Whether the order is tag-marked at all — **archived tags included**, deliberately.
 *
 * An archived tag keeps its assignments and still renders, hatched, so the operator looking at a
 * row sees a chip on it. A presence filter that called that row untagged would disagree with the
 * column it sits next to, which is the same wider-question-narrower-answer failure the queue keeps
 * having to design against — and here it would be visible on screen, side by side.
 *
 * Note this is *not* the rule the specific-tag filter follows: an archived tag is not offered in
 * the picker, because you cannot choose what has been retired. "Is this order marked" and "is it
 * marked with *that*" are different questions, and only the second needs the tag to still be
 */
function carriesTag(order: DispatchOrderSummary): boolean {
  return (order.tags?.length ?? 0) > 0;
}

/** Does this order carry an unsettled manual refund / unresolved corrections / an unrecorded payment? */
function matchesPendingAction(
  order: DispatchOrderSummary,
  action: string,
  manualGateways: readonly string[],
): boolean {
  switch (action) {
    case 'manual_refund':
      return order.pendingManualRefunds > 0;
    case 'corrections':
      return order.unprocessedCorrections > 0;
    case 'payment_entry':
      return (
        (order.wcStatus === 'on-hold' || order.wcStatus === 'pending') &&
        order.paymentMethod !== null &&
        manualGateways.includes(order.paymentMethod)
      );
    default:
      // An action this build cannot evaluate matches nothing rather than everything — the same
      // direction the server takes, and the safe one: a work queue that answers an unknown filter
      // by showing *more* reads as a longer backlog, which nobody notices.
      return false;
  }
}

/**
 * Which pending actions this order is waiting on — the value list a facet counts by, and the
 * client-side twin of the server's registered predicates.
 *
 * Only the three the base install registers can be evaluated here. An add-on's action is invisible
 * to this build, which is why it counts as *no* match rather than a match: narrow, never widen.
 */
export function pendingActionsOf(
  order: DispatchOrderSummary,
  manualGateways: readonly string[] = [],
): string[] {
  return ['manual_refund', 'corrections', 'payment_entry'].filter((action) =>
    matchesPendingAction(order, action, manualGateways),
  );
}

/**
 * Whether an order belongs in the current view.
 *
 * Every predicate here is one the server would apply, evaluated against the row the client already
 * holds. Anything it cannot answer lives in {@link SERVER_ONLY_FILTER_KEYS} and never reaches this
 * function — the surface has switched to server mode by then.
 */
export function matchesLocalFilters(
  order: DispatchOrderSummary,
  filters: DispatchQueueFilters,
  manualGateways: readonly string[] = [],
): boolean {
  const {
    status,
    workflowState,
    wcStatus,
    paymentMethods,
    shippingClasses,
    shippingMethods,
    tagIds,
    tagMatch,
    tagIdsNot,
    hasTags,
    hasNotes,
    pendingActions,
  } = filters;

  if (status !== undefined && status.length > 0 && !status.includes(order.status)) return false;

  if (workflowState !== undefined && workflowState.length > 0) {
    if (!workflowState.includes(order.workflowState)) return false;
  }

  if (wcStatus !== undefined && wcStatus.length > 0) {
    if (order.wcStatus === null || !wcStatus.includes(order.wcStatus)) return false;
  }

  if (paymentMethods !== undefined && paymentMethods.length > 0) {
    if (order.paymentMethod === null || !paymentMethods.includes(order.paymentMethod)) return false;
  }

  // The row carries the order's full class set (`none` included) and every method id, so both are
  // answerable here exactly as the server's EXISTS would answer them: any one matching qualifies.
  if (shippingClasses !== undefined && shippingClasses.length > 0) {
    if (!(order.shippingClasses ?? []).some((cls) => shippingClasses.includes(cls))) return false;
  }

  if (shippingMethods !== undefined && shippingMethods.length > 0) {
    if (!(order.shippingMethods ?? []).some((id) => shippingMethods.includes(id))) return false;
  }

  if (tagIds !== undefined && tagIds.length > 0) {
    const carried = new Set((order.tags ?? []).map((tag) => String(tag.id)));
    const matched = tagIds.filter((id) => carried.has(id));
    // `all` is an AND over the selection, `any` (the default) an OR — the same two readings the
    // server offers, and the reason `tag_match` travels with `tag_id` as one dimension.
    if (tagMatch === 'all' ? matched.length !== tagIds.length : matched.length === 0) return false;
  }

  // Always AND-NOT, in both match modes: `tagMatch` governs the include set alone. Carrying any
  // excluded tag disqualifies the order outright.
  if (tagIdsNot !== undefined && tagIdsNot.length > 0) {
    const carried = new Set((order.tags ?? []).map((tag) => String(tag.id)));
    if (tagIdsNot.some((id) => carried.has(id))) return false;
  }

  if (hasTags !== undefined && hasTags.length > 0) {
    if (!hasTags.includes(carriesTag(order) ? 'yes' : 'no')) return false;
  }

  if (hasNotes !== undefined && hasNotes.length > 0) {
    if (!hasNotes.includes((order.noteCount ?? 0) > 0 ? 'yes' : 'no')) return false;
  }

  if (pendingActions !== undefined && pendingActions.length > 0) {
    if (!pendingActions.some((action) => matchesPendingAction(order, action, manualGateways))) {
      return false;
    }
  }

  const needle = filters.search?.trim().toLowerCase() ?? '';
  if (needle !== '') {
    const haystack =
      `${order.customerName} ${order.customerEmail} ${order.externalId}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  return true;
}

/**
 * How a dimension combines its own selected values — which decides what its counts must be
 * measured against.
 *
 * - `disjunctive` (OR): picking another value **widens**, so the base drops the whole dimension.
 *   Keep it applied and every unpicked option reads 0.
 * - `conjunctive` (AND, and AND-NOT): picking another value **narrows**, so the base keeps the
 *   dimension's *other* selections and drops only the option being counted. Drop the whole
 *   dimension and the count promises rows the existing selections have already removed.
 */
export type FacetCombination = 'disjunctive' | 'conjunctive';

/**
 * Count what each option of one dimension would match — the client-side twin of the facets
 * endpoint, and free once the set is in memory.
 *
 * **Self-exclusion is the rule that makes facets work**, so it is the rule here too: a dimension's
 * counts apply every filter *except its own*. Include it and, the moment `Active` is selected,
 * `Closed` reads 0 and the operator can never discover that adding it would return anything.
 *
 * **But "except its own" means different things for the two kinds of dimension**, and getting it
 * wrong is near-invisible: the two bases coincide exactly while the dimension has nothing selected
 * — that is, on first open — and diverge from the first click onward. So it demonstrates perfectly
 * and misleads in use. A conjunctive dimension must therefore exclude only the *option* being
 * counted, keeping its siblings applied; anything else counts rows a sibling has already removed.
 * Excluded tags are the sharpest case, because problem markers correlate: with `Escalated` already
 * excluded, counting `Fraud review` against a base that has forgotten `Escalated` can overstate
 * what excluding it would remove by an order of magnitude.
 */
export function countFacet(
  orders: readonly DispatchOrderSummary[],
  filters: DispatchQueueFilters,
  dimension: keyof DispatchQueueFilters,
  valuesOf: (order: DispatchOrderSummary) => string[],
  manualGateways: readonly string[] = [],
  combination: FacetCombination = 'disjunctive',
): Record<string, number> {
  if (combination === 'conjunctive') {
    return countConjunctiveFacet(orders, filters, dimension, valuesOf, manualGateways);
  }

  const withoutOwn: DispatchQueueFilters = { ...filters, [dimension]: undefined };
  const counts: Record<string, number> = {};

  for (const order of orders) {
    if (!matchesLocalFilters(order, withoutOwn, manualGateways)) continue;
    for (const value of valuesOf(order)) counts[value] = (counts[value] ?? 0) + 1;
  }

  return counts;
}

/**
 * Counts for a dimension whose values narrow rather than widen — `tag_match=all`, and every
 * exclusion.
 *
 * One base per option instead of one for the dimension: the option under test is lifted out while
 * its siblings stay applied, so the number answers *"what would this one change, on top of what is
 * already selected"*. For an exclusion that reads as "what you would get back"; for an AND-matched
 * include, "what would survive adding this".
 *
 * Costs one pass per candidate value rather than one pass total. That is the price of the honest
 * number, and it is small: the candidates are a tag vocabulary, not the order set.
 */
function countConjunctiveFacet(
  orders: readonly DispatchOrderSummary[],
  filters: DispatchQueueFilters,
  dimension: keyof DispatchQueueFilters,
  valuesOf: (order: DispatchOrderSummary) => string[],
  manualGateways: readonly string[],
): Record<string, number> {
  const selected = (filters[dimension] as string[] | undefined) ?? [];

  // Every value in play: those an order carries, plus those already selected — a selected value
  // whose rows have all been filtered out still needs a count, or the option the operator is
  // standing on disappears from its own picker.
  const candidates = new Set<string>(selected);
  for (const order of orders) for (const value of valuesOf(order)) candidates.add(value);

  const counts: Record<string, number> = {};
  for (const value of candidates) {
    const withoutThisOne: DispatchQueueFilters = {
      ...filters,
      [dimension]: selected.filter((v) => v !== value),
    };
    let n = 0;
    for (const order of orders) {
      if (!valuesOf(order).includes(value)) continue;
      if (matchesLocalFilters(order, withoutThisOne, manualGateways)) n += 1;
    }
    counts[value] = n;
  }

  return counts;
}

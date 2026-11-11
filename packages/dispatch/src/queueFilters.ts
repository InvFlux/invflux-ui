import type {
  DispatchContext,
  DispatchOrderSummary,
  DispatchQueueFilters,
  OrderStatus,
  OrderWorkflowState,
} from './types';
import { matchesLocalFilters } from './workingSet';
import { sortQueue } from './queueSort';

/**
 * Reading a queue view's URL parameters as filters, and putting a held set of orders in the queue's
 * order — shared by the queue and by the order page, which needs the same sequence for its
 * previous and next buttons. One reading for both, so the order page can never step through a
 * different list from the one the queue shows.
 */

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
export const NO_FILTER_SENTINEL = '_';

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
export const ANY_PENDING_ACTION = '_any';

/**
 * Rows per fetch when the queue reads from the server (a filter reaching past the open orders). Not
 * a setting: the list scrolls and fetches the next batch as it nears the end, so the batch size
 * only decides how often that happens — the same 500 the open-order set replicates in.
 */
export const SERVER_PAGE_SIZE = 500;

export function parseStatusList(raw: string | undefined): OrderStatus[] | undefined {
  if (raw === undefined) return undefined;
  if (raw === '' || raw === NO_FILTER_SENTINEL) return [];
  const known = new Set<OrderStatus>(['Untouched', 'Started', 'Staged', 'Shipped', 'Canceled']);
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
 * Unrecognized values are dropped rather than passed through, which keeps a
 * stale link from rendering a checkbox for a state the install cannot answer
 * for. Dropping every value leaves `[]`, i.e. no filter — matching the backend,
 * which falls back to its default instead of widening to everything.
 */
export function parseWorkflowList(
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

export function parseNativeStatusList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  if (raw === '' || raw === NO_FILTER_SENTINEL) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Parse a generic comma-separated multi-value URL filter — same contract as the others. */
export function parseGenericList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  if (raw === '' || raw === NO_FILTER_SENTINEL) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** A queue view's URL parameters, by name. */
export type QueueParams = Readonly<Record<string, string | undefined>>;

/** The parameters of a queue search string (`?status=Started&search=amy`, or `''` for none). */
export function queueParamsOf(search: string): QueueParams {
  return Object.fromEntries(new URLSearchParams(search).entries());
}

/**
 * The kinds of waiting work a view filters to, as wire values.
 *
 * Unrecognized values are kept rather than dropped: which actions exist is an install-level
 * question, the server resolves them against what it registered, and a value dropped here would
 * *widen* the union — a work queue silently showing more than was asked for is the failure mode
 * that matters, since a longer backlog looks like a busy day.
 *
 * {@link ANY_PENDING_ACTION} expands to whatever this install advertises, so every consumer — the
 * chip's summary, the dropdown's ticks, the local predicate — sees a plain list and none of them
 * has to know the token exists. The *URL* keeps the token; only this reading widens it.
 */
export function pendingActionFilter(
  raw: string | undefined,
  options: ReadonlyArray<{ value: string }>,
): string[] {
  if (raw !== undefined && raw.split(',').some((v) => v.trim() === ANY_PENDING_ACTION)) {
    return options.map((o) => o.value);
  }

  return parseGenericList(raw) ?? [];
}

/**
 * Whether a view's filters make the `Active` default *yield* rather than narrow.
 *
 * Only the ones whose meaning spans closure — today, waiting work: a refund settled by a
 * whole-order cancel sits on a closed order, so "refunds owed" under the open-orders floor is a
 * different and misleading number. Not every filter: the client holds the *open* set, so widening
 * means leaving it and paying for a server query, and a SKU search wanting live work first is not
 * asking to see three years of history.
 */
export function spansClosure(pendingActions: readonly string[]): boolean {
  return pendingActions.length > 0;
}

/**
 * The filters a queue view asks for.
 *
 * The `Active` default yields to *any* deliberate filter that spans closure, rather than narrowing
 * it ({@link spansClosure}). Nobody chose `Active` — it is what the queue shows when asked nothing
 * — so a real question replaces it instead of intersecting with it (the default-vs-deliberate
 * contract read across filters rather than within one). An operator who set `workflow_state`
 * themselves has made a choice, and a choice is never overridden.
 *
 * What makes widening safe rather than overwhelming is the queue's **sort**, not a narrower rule:
 * closed orders always rank last. Rendered, not merely applied — the workflow chip shows the
 * widened cut, so this is a different default and never an invisible one.
 *
 * The host-status default is baked in here so the server receives the filter the operator sees:
 * absent applies the default, present-but-empty means no filter.
 */
export function parseQueueFilters(
  params: QueueParams,
  ctx: Pick<DispatchContext, 'workflowState' | 'nativeStatus' | 'pendingAction'>,
): DispatchQueueFilters {
  const known = new Set(ctx.workflowState.options.map((o) => o.value));
  const pendingActions = pendingActionFilter(params.pending_action, ctx.pendingAction.options);

  return {
    status: parseStatusList(params.status),
    workflowState:
      parseWorkflowList(params.workflow_state, known) ??
      (spansClosure(pendingActions) ? [] : undefined),
    wcStatus: parseNativeStatusList(params.wc_status) ?? ctx.nativeStatus.defaultSelected,
    worksheetIds: parseGenericList(params.worksheet_id),
    skus: parseGenericList(params.sku),
    // Domain-key filter set by the workbench "Orders" link (dash-joined to keep the URL free of
    // encoded commas). Normalize dashes to the shared comma parser; the server accepts both.
    subjectIds: parseGenericList(params.subject_ids?.replace(/-/g, ',')),
    paymentMethods: parseGenericList(params.payment_method),
    shippingClasses: parseGenericList(params.shipping_class),
    shippingMethods: parseGenericList(params.shipping_method),
    tagIds: parseGenericList(params.tag_id),
    tagMatch: params.tag_match === 'all' ? 'all' : undefined,
    tagIdsNot: parseGenericList(params.tag_id_not),
    hasTags: parseGenericList(params.has_tags),
    hasNotes: parseGenericList(params.has_notes),
    pendingActions,
    search: params.search?.trim() || undefined,
    perPage: SERVER_PAGE_SIZE,
  };
}

/**
 * The orders of a held set that a view shows, in the queue's order.
 *
 * Sorting here is not a shortcut — it is what makes the poll honest. A merged row that kept its old
 * position would be correct and in the wrong place, which reads as the queue ignoring the change
 * that just arrived.
 */
export function localQueue(
  orders: Iterable<DispatchOrderSummary>,
  filters: DispatchQueueFilters,
  manualGateways: readonly string[],
): DispatchOrderSummary[] {
  return sortQueue([...orders].filter((o) => matchesLocalFilters(o, filters, manualGateways)));
}

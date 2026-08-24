import { ApiError, createInvFluxApi, path } from '@invflux/ui/api';
import type {
  CreateCorrectionRequest,
  CreateCorrectionResponse,
  DispatchContext,
  DispatchCorrectionsResponse,
  DispatchOrderDetail,
  DispatchOrderLine,
  DispatchQueueFilters,
  DispatchQueueResponse,
  GovernanceFlag,
  ManageAuthority,
  OrderStatus,
  OrderViewer,
  ProcessCorrectionsPayload,
  TagSummary,
  ArchivedTagName,
  TagListResult,
} from './types';

/** WP REST namespace for dispatch endpoints. Matches the PHP `DispatchController`. */
const NAMESPACE = '/invflux/v1/dispatch';

/**
 * Bound per call — `DispatchContext` is a prop, and the client is a closure over two strings.
 *
 * Dispatch keeps its own route + filter helpers because its query strings are genuinely bespoke
 * (comma-joined multi-value filters; dash-joined subject ids so a workbench deep-link round-trips
 * without encoded commas). What moved to the shared client is the transport underneath: URL forms,
 * abort, timeout, retry, and parsing the error body before checking `ok`.
 */
const api = (ctx: DispatchContext): ReturnType<typeof createInvFluxApi> =>
  createInvFluxApi({ apiRoot: ctx.apiRoot, nonce: ctx.nonce });

/**
 * Re-throw the transport's `ApiError` as one of this surface's typed errors, so call sites keep
 * narrowing with `instanceof StageLineError` and friends.
 *
 * Only a *plain* `ApiError` is converted — a typed error raised deeper is already the more specific
 * answer and passes through untouched.
 */
function typedAs<E extends ApiError>(
  make: (code: string, status: number, message: string) => E,
  fallback: string,
): (error: unknown) => never {
  return (error: unknown): never => {
    if (error instanceof ApiError && error.constructor === ApiError) {
      throw make(
        error.code ?? 'invflux_unknown_error',
        error.status,
        error.message || `${fallback} (${String(error.status)})`,
      );
    }
    throw error;
  };
}

/** A dispatch route, namespace included — the client turns it into a URL. */
function route(p: string): string {
  return `${NAMESPACE}${p}`;
}

/**
 * Translate the camelCase frontend filter spec to the snake_case query string
 * the backend expects.
 */
function filterParams(filters: DispatchQueueFilters): Record<string, string> {
  const p: Record<string, string> = {};
  if (filters.page !== undefined) p['page'] = String(filters.page);
  if (filters.perPage !== undefined) p['per_page'] = String(filters.perPage);
  // Multi-value filters: comma-separated. `[]` is sent as an empty string so the backend reads it
  // as "override the default with no filter" — distinct from omitting the param, which lets the
  // default apply. That is why these test `!== undefined` rather than truthiness.
  if (filters.status !== undefined) p['status'] = filters.status.join(',');
  if (filters.workflowState !== undefined) p['workflow_state'] = filters.workflowState.join(',');
  if (filters.wcStatus !== undefined) p['wc_status'] = filters.wcStatus.join(',');
  if (filters.worksheetIds !== undefined) p['worksheet_id'] = filters.worksheetIds.join(',');
  if (filters.skus !== undefined) p['sku'] = filters.skus.join(',');
  // Dash-joined (not comma) so the deep-link the workbench builds round-trips without encoded commas.
  if (filters.subjectIds !== undefined) p['subject_ids'] = filters.subjectIds.join('-');
  if (filters.paymentMethods !== undefined) p['payment_method'] = filters.paymentMethods.join(',');
  if (filters.tagIds !== undefined) p['tag_id'] = filters.tagIds.join(',');
  if (filters.tagMatch === 'all') p['tag_match'] = 'all';
  if (filters.pendingManualRefund) p['pending_manual_refund'] = '1';
  if (filters.search) p['search'] = filters.search;
  if (filters.updatedSince) p['updated_since'] = filters.updatedSince;

  return p;
}

// ---------------------------------------------------------------------------
// Filter options — GET /dispatch/filter-options/{worksheets,skus}
// ---------------------------------------------------------------------------

export interface FilterOption {
  value: string;
  label: string;
}

export async function fetchWorksheetFilterOptions(
  ctx: DispatchContext,
): Promise<FilterOption[]> {
  const body = await api(ctx).get<{ options: FilterOption[] }>(route('/filter-options/worksheets'));
  return body.options;
}

export async function searchSkuFilterOptions(
  ctx: DispatchContext,
  query: string,
  limit = 20,
): Promise<FilterOption[]> {
  const body = await api(ctx).get<{ options: FilterOption[] }>(route('/filter-options/skus'), {
    params: { q: query, limit },
  });
  return body.options;
}

export async function fetchDispatchOrders(
  ctx: DispatchContext,
  filters: DispatchQueueFilters,
): Promise<DispatchQueueResponse> {
  return api(ctx).get<DispatchQueueResponse>(route('/orders'), { params: filterParams(filters) });
}

export async function fetchDispatchOrderDetail(
  ctx: DispatchContext,
  hexId: string,
): Promise<DispatchOrderDetail> {
  return api(ctx)
    .get<DispatchOrderDetail>(route(path`/orders/${hexId}`))
    .catch((error: unknown) => {
      // A missing order is a routing fact the SPA acts on (it redirects), not a failure to report.
      if (error instanceof ApiError && error.status === 404) throw new DispatchOrderNotFoundError(hexId);
      throw error;
    });
}

/** Thrown when the backend responds 404 to `GET /orders/{id}`. */
export class DispatchOrderNotFoundError extends ApiError {
  constructor(public readonly hexId: string) {
    super(404, { code: 'invflux_order_not_found', message: `Order not found: ${hexId}` });
  }
}

/**
 * Resolve a WooCommerce order ID (integer) to the InvFlux hex id.
 * Used by `OrderDetail` when the hash contains `#/{wcOrderId}` instead of
 * the canonical `#/{hexId}`, so the SPA can redirect to the full hex URL.
 */
export async function resolveOrderByExternalId(
  ctx: DispatchContext,
  wcOrderId: number,
): Promise<string> {
  const data = await api(ctx)
    .get<{ hex_id: string }>(route(path`/orders/ext/${wcOrderId}`))
    // Any failure here means "no InvFlux order for that WooCommerce id" as far as the caller is
    // concerned — it is resolving a redirect target, not reporting on the server.
    .catch(() => {
      throw new DispatchOrderNotFoundError(String(wcOrderId));
    });
  return data.hex_id;
}

// ---------------------------------------------------------------------------
// Stage-line mutation — PATCH /orders/{id}/lines/{lineId}
// ---------------------------------------------------------------------------

export type StageSource = 'scanner' | 'click';

export interface StageLineRequest {
  stagedQty: number;
  source: StageSource;
}

/**
 * The order-level fields returned in every PATCH response per §4.0 — the
 * subset clients need to patch their cached queue rows without a full
 * re-fetch. Mirrors the backend's `StagedOrderCounts` PHP value object.
 */
export interface StageLineOrderSnapshot {
  id: string;
  status: OrderStatus;
  lineCount: number;
  stagedCount: number;
  shippedCount: number;
  unprocessedCorrections: number;
  updatedAt: string | null;
}

export interface StageLineResponse {
  line: DispatchOrderLine;
  order: StageLineOrderSnapshot;
}

/**
 * Thrown for any non-2xx response on the PATCH route. Carries the stable
 * `invflux_*` code so the caller can branch UX on a known error (e.g.,
 * `invflux_staged_qty_out_of_range` is a validation failure that the user
 * can act on; `invflux_order_not_found` means the order vanished — surface
 * differently).
 */
export class StageLineError extends ApiError {
  constructor(code: string, status: number, message: string) {
    super(status, { code, message });
  }
}

// ---------------------------------------------------------------------------
// Viewer heartbeat — POST /orders/{id}/viewers/heartbeat
// ---------------------------------------------------------------------------

export interface HeartbeatResponse {
  viewers: OrderViewer[];
}

/**
 * Send one heartbeat for the current user on this order. The server upserts
 * presence, prunes stale rows, and returns the live viewer list. Body is
 * empty per §4.0 — the user is identified from the auth context.
 */
export async function postHeartbeat(
  ctx: DispatchContext,
  orderHexId: string,
): Promise<HeartbeatResponse> {
  return api(ctx).post<HeartbeatResponse>(route(path`/orders/${orderHexId}/viewers/heartbeat`), {});
}

// ---------------------------------------------------------------------------
// Corrections — GET/POST /orders/{id}/corrections, DELETE /corrections/{id}
// ---------------------------------------------------------------------------

/**
 * Thrown for non-2xx responses on the corrections endpoints. Carries the
 * stable `invflux_*` code so callers can branch UX on validation vs
 * permission errors (e.g. 403 `invflux_correction_not_deletable` is a
 * stale-row hint; 422 `invflux_correction_qty_invalid` is user input).
 */
export class CorrectionApiError extends ApiError {
  constructor(code: string, status: number, message: string) {
    super(status, { code, message });
  }
}

// ---------------------------------------------------------------------------
// Order events — GET /orders/{id}/events
// ---------------------------------------------------------------------------

import type { AnnotationThread, AnnotationVersion, TimelineEvent } from '@invflux/ui';

export interface OrderEventsResponse {
  events: TimelineEvent[];
}

export async function fetchOrderEvents(
  ctx: DispatchContext,
  orderHexId: string,
): Promise<OrderEventsResponse> {
  return api(ctx).get<OrderEventsResponse>(route(path`/orders/${orderHexId}/events`));
}

// ---------------------------------------------------------------------------
// Order annotations — /orders/{id}/annotations (+ /annotations/{threadHex})
// The reusable notes/tag-delta primitive bound to the `order` ref type. Notes-only for now;
// the tag delta lands with the polymorphic tag migration.
// ---------------------------------------------------------------------------

/** Thrown for non-2xx annotation responses; carries the stable `invflux_annotation_*` code. */
export class AnnotationApiError extends ApiError {
  constructor(code: string, status: number, message: string) {
    super(status, { code, message });
  }
}

export interface OrderAnnotationsResponse {
  threads: AnnotationThread[];
}

/**
 * Map the transport's `ApiError` onto this surface's typed one.
 *
 * The annotation routes answer `{ code, error }` where `error` is the **human message**, not a
 * slug — the licence proxy uses the same key for the opposite thing, which is why the shared
 * transport reads only `code` and leaves this to the surface that knows its own contract.
 */
function annotationError(fallback: string): (error: unknown) => never {
  return (error: unknown): never => {
    if (error instanceof ApiError && error.constructor === ApiError) {
      const b = (error.body ?? {}) as { code?: string; error?: string };
      throw new AnnotationApiError(
        b.code ?? 'invflux_unknown_error',
        error.status,
        b.error ?? `${fallback} (${String(error.status)})`,
      );
    }
    throw error;
  };
}

export async function fetchOrderAnnotations(
  ctx: DispatchContext,
  orderHexId: string,
): Promise<OrderAnnotationsResponse> {
  return api(ctx)
    .get<OrderAnnotationsResponse>(route(path`/orders/${orderHexId}/annotations`))
    .catch(annotationError('Annotations request failed'));
}

/** Optional tag delta a note can carry (§5 unification): ids to attach/detach in the same act. */
export interface NoteTagDelta {
  addTags?: number[];
  removeTags?: number[];
}

export async function createOrderAnnotation(
  ctx: DispatchContext,
  orderHexId: string,
  body: string,
  tags?: NoteTagDelta,
): Promise<AnnotationVersion> {
  const res = await api(ctx)
    .post<{ annotation: AnnotationVersion }>(route(path`/orders/${orderHexId}/annotations`), { body, addTags: tags?.addTags, removeTags: tags?.removeTags })
    .catch(annotationError('Add note failed'));
  return res.annotation;
}

export async function editOrderAnnotation(
  ctx: DispatchContext,
  orderHexId: string,
  threadHexId: string,
  body: string,
  tags?: NoteTagDelta,
): Promise<AnnotationVersion> {
  const res = await api(ctx)
    .patch<{ annotation: AnnotationVersion }>(
      route(path`/orders/${orderHexId}/annotations/${threadHexId}`),
      { body, addTags: tags?.addTags, removeTags: tags?.removeTags },
    )
    .catch(annotationError('Edit note failed'));
  return res.annotation;
}

export async function deleteOrderAnnotation(
  ctx: DispatchContext,
  orderHexId: string,
  threadHexId: string,
): Promise<AnnotationVersion> {
  const res = await api(ctx)
    .del<{ annotation: AnnotationVersion }>(route(path`/orders/${orderHexId}/annotations/${threadHexId}`))
    .catch(annotationError('Delete note failed'));
  return res.annotation;
}

export async function fetchOrderCorrections(
  ctx: DispatchContext,
  orderHexId: string,
): Promise<DispatchCorrectionsResponse> {
  return api(ctx).get<DispatchCorrectionsResponse>(
    route(path`/orders/${orderHexId}/corrections`),
  );
}

export async function createCorrection(
  ctx: DispatchContext,
  orderHexId: string,
  request: CreateCorrectionRequest,
): Promise<CreateCorrectionResponse> {
  return api(ctx)
    .post<CreateCorrectionResponse>(route(path`/orders/${orderHexId}/corrections`), request)
    .catch(typedAs((c, st, ms) => new CorrectionApiError(c, st, ms), 'Create correction failed'));
}

export async function deleteCorrection(
  ctx: DispatchContext,
  correctionHexId: string,
): Promise<void> {
  // 204 is the success shape here; the client resolves an empty body as `undefined`.
  await api(ctx)
    .del<void>(route(path`/corrections/${correctionHexId}`))
    .catch(typedAs((c, st, m) => new CorrectionApiError(c, st, m), 'Delete correction failed'));
}

export async function stageLine(
  ctx: DispatchContext,
  orderHexId: string,
  lineHexId: string,
  request: StageLineRequest,
): Promise<StageLineResponse> {
  return api(ctx)
    .patch<StageLineResponse>(route(path`/orders/${orderHexId}/lines/${lineHexId}`), request)
    .catch(typedAs((c, st, ms) => new StageLineError(c, st, ms), 'Stage request failed'));
}

// ---------------------------------------------------------------------------
// Ship — POST /orders/{id}/ship
// ---------------------------------------------------------------------------

/**
 * Order-header subset returned by the Ship endpoint. Same shape as
 * `StageLineOrderSnapshot` — both back-ended by the PHP
 * `StagedOrderCounts` value object — but typed as its own interface so
 * the SPA can grow Ship-specific fields later (e.g. shipment id at Pro)
 * without rippling through stage-related callers.
 */
export interface ShipOrderResponse {
  order: StageLineOrderSnapshot;
}

/**
 * Thrown for any non-2xx response on the Ship route. The `code` field
 * lets the UI distinguish the precondition failures (`invflux_order_
 * not_staged` — 409) from validation (422) and hard-failures (500), and
 * map each to merchant-readable copy.
 */
export class ShipOrderError extends ApiError {
  constructor(code: string, status: number, message: string) {
    super(status, { code, message });
  }
}

// ---------------------------------------------------------------------------
// Process corrections — POST /orders/{id}/corrections/process
// ---------------------------------------------------------------------------

/**
 * Response shape for the batch process endpoint. `processedCount` is `0`
 * on the idempotent no-op path (no pending corrections); positive when
 * the batch fired and the single Decision-tier event landed.
 */
export interface ProcessCorrectionsResponse {
  order: StageLineOrderSnapshot;
  processedCount: number;
}

export async function processCorrections(
  ctx: DispatchContext,
  orderHexId: string,
  payload: ProcessCorrectionsPayload,
): Promise<ProcessCorrectionsResponse> {
  return api(ctx)
    .post<ProcessCorrectionsResponse>(route(path`/orders/${orderHexId}/corrections/process`), payload)
    .catch(typedAs((c, st, ms) => new CorrectionApiError(c, st, ms), 'Process corrections failed'));
}

// ---------------------------------------------------------------------------
// Settle manual refunds — POST /orders/{id}/settle-manual-refund
// ---------------------------------------------------------------------------

export interface SettleManualRefundResponse {
  settledCount: number;
}

/**
 * Settle the order's pending manual refunds (non-refundable gateway). The
 * operator attests (`manualConfirmed: true`) that the money has been / will be
 * moved out-of-band; the backend issues the WC refund record + emits
 * `correction.refund_confirmed(manual_confirmed)` per unsettled manual schedule.
 */
export async function settleManualRefund(
  ctx: DispatchContext,
  orderHexId: string,
): Promise<SettleManualRefundResponse> {
  return api(ctx)
    .post<SettleManualRefundResponse>(route(path`/orders/${orderHexId}/settle-manual-refund`), { manualConfirmed: true })
    .catch(typedAs((c, st, ms) => new CorrectionApiError(c, st, ms), 'Settle manual refund failed'));
}

export type CaptureResolution = 'cancel' | 'hold' | 'capture_refund' | 'capture_choice';

export type CapturePaymentResult =
  | { status: 'captured' | 'cancelled' | 'held' | 'captured_partial' | 'choice_offered' }
  | { status: 'shortfall'; shortfall: number };

/**
 * Record a manual payment for a manual-gateway order (BACS/cheque/COD) and capture its
 * stock. `{status:'captured'}` on a clean capture. On a stock shortfall with no
 * `resolution` the backend replies 409 and we return `{status:'shortfall', shortfall}`
 * so the caller can prompt the merchant; passing `resolution` then resolves it:
 * `cancel` → cancel the order; `hold` → leave it on-hold; `capture_refund` → fulfil the
 * available units + refund the shortfall (`captured_partial`); `capture_choice` → fulfil
 * the available units + let the customer decide (`choice_offered`).
 */
export async function capturePayment(
  ctx: DispatchContext,
  orderHexId: string,
  resolution?: CaptureResolution,
): Promise<CapturePaymentResult> {
  return api(ctx)
    .post<CapturePaymentResult>(
      route(path`/orders/${orderHexId}/capture-payment`),
      resolution ? { resolution } : {},
    )
    .catch((error: unknown) => {
      // 409 is an *outcome* here, not a failure: the gateway captured less than the order needs and
      // the caller resolves the shortfall. Reporting it as an error would hide the number it needs.
      if (error instanceof ApiError && error.status === 409) {
        const body = (error.body ?? {}) as { data?: { shortfall?: number } };
        return { status: 'shortfall', shortfall: body.data?.shortfall ?? 0 } as CapturePaymentResult;
      }
      return typedAs((c, st, m) => new CorrectionApiError(c, st, m), 'Capture payment failed')(error);
    });
}

export async function shipOrder(
  ctx: DispatchContext,
  orderHexId: string,
): Promise<ShipOrderResponse> {
  return api(ctx)
    .post<ShipOrderResponse>(route(path`/orders/${orderHexId}/ship`), {})
    .catch(typedAs((c, st, m) => new ShipOrderError(c, st, m), 'Ship request failed'));
}

// ---------------------------------------------------------------------------
// Order tags — GET/POST/PATCH/DELETE /dispatch/tags, assign on /orders/{id}/tags
// ---------------------------------------------------------------------------

/** List all order-tag definitions. */
/**
 * Live tags in full, plus the *names* of the retired ones.
 *
 * The names ride along on this one request because the manager needs them the moment someone
 * starts typing — to catch a name already taken by a retired tag, and to point out a near-identical
 * one — and a lookup per keystroke is not a thing to do to a server. Their full definitions come
 * from {@link fetchArchivedTags}, on demand.
 */
export async function fetchTags(ctx: DispatchContext): Promise<TagListResult> {
  const body = await api(ctx).get<{ tags: TagSummary[]; archivedNames?: ArchivedTagName[] }>(
    route('/tags'),
  );
  return { tags: body.tags, archivedNames: body.archivedNames ?? [] };
}

/** The retired tags in full — fetched when the merchant opens the retired section. */
export async function fetchArchivedTags(ctx: DispatchContext): Promise<TagSummary[]> {
  const body = await api(ctx).get<{ tags: TagSummary[] }>(route('/tags/archived'));
  return body.tags;
}

/** Bring a retired tag back, with its colour, settings and history. */
export function restoreTag(ctx: DispatchContext, id: number): Promise<TagSummary> {
  return tagWriteJson(ctx, `/tags/${id}/restore`, 'POST', {});
}

/**
 * Map a failed tag write onto a plain `Error` carrying the server's own sentence.
 *
 * Like the annotation routes, these answer `{ error: "<prose>" }` — the same key the licence proxy
 * uses for a *slug*, which is why the shared transport reads only `code` and each surface decodes
 * its own contract here.
 */
function tagError(fallback: string): (error: unknown) => never {
  return (error: unknown): never => {
    if (error instanceof ApiError && error.constructor === ApiError) {
      const b = (error.body ?? {}) as { error?: string };
      throw new Error(b.error ?? `${fallback} (${String(error.status)})`);
    }
    throw error;
  };
}

/**
 * A tag write that failed with something the UI can act on rather than merely display.
 *
 * The motivating case is a name already taken by a **retired** tag: the useful response is to open
 * the retired section on that tag and offer to restore it, which needs the id and the list — not a
 * sentence. Carried on the error rather than returned, so existing callers that only read
 * `.message` keep working unchanged.
 */
export class TagWriteError extends ApiError {
  /**
   * Argument order is `(message, code, …)` rather than the base's `(status, body)` because this one
   * carries domain payload a caller acts on — `conflictId` names the tag already holding the name,
   * `archived` the archived tags offered for revival. `status` is last and optional so that no
   * existing call site has to move.
   */
  constructor(
    message: string,
    code?: string,
    readonly conflictId?: number,
    readonly archived?: TagSummary[],
    status = 0,
  ) {
    super(status, { code, message });
  }
}

async function tagWriteJson(
  ctx: DispatchContext,
  p: string,
  method: 'POST' | 'PATCH',
  body: unknown,
): Promise<TagSummary> {
  const client = api(ctx);
  // Picked before the call, not as a computed access on the previous line — that reads as an index
  // into the return value and trips ASI. The methods are closures over the context, so detaching
  // one from the object is safe.
  const send = method === 'POST' ? client.post : client.patch;
  const res = await send<{ tag: TagSummary }>(route(p), body)
    .catch((error: unknown) => {
      if (error instanceof ApiError && error.constructor === ApiError) {
        const err = (error.body ?? {}) as {
          error?: string; code?: string; conflictId?: number; archived?: TagSummary[];
        };
        throw new TagWriteError(
          err.error ?? `Tag write failed (${String(error.status)})`,
          err.code,
          err.conflictId,
          err.archived,
          error.status,
        );
      }
      throw error;
    });
  return res.tag;
}

export function createTag(
  ctx: DispatchContext,
  input: {
    name: string;
    colorId?: number;
    governanceFlags?: GovernanceFlag[];
    priority?: number;
    manageAuthority?: ManageAuthority;
  },
): Promise<TagSummary> {
  return tagWriteJson(ctx, '/tags', 'POST', input);
}

export function updateTag(
  ctx: DispatchContext,
  id: number,
  input: {
    name?: string;
    colorId?: number;
    governanceFlags?: GovernanceFlag[];
    priority?: number;
    manageAuthority?: ManageAuthority;
  },
): Promise<TagSummary> {
  return tagWriteJson(ctx, `/tags/${id}`, 'PATCH', input);
}

export async function deleteTag(ctx: DispatchContext, id: number): Promise<void> {
  await api(ctx).del<void>(route(path`/tags/${id}`)).catch(tagError('Delete tag failed'));
}

/**
 * Assign tags to one order; returns the order's resulting tag set. `note` is
 * stamped as an annotation — required when a tag carries `RequireNoteOnAdd`.
 * Surfaces the server's typed error (Pro upgrade / note required) as the message.
 */
export async function assignOrderTags(
  ctx: DispatchContext,
  orderHexId: string,
  tagIds: number[],
  note?: string,
): Promise<TagSummary[]> {
  const res = await api(ctx)
    .post<{ tags: TagSummary[] }>(route(path`/orders/${orderHexId}/tags`), { tagIds, note })
    .catch(tagError('Assign tags failed'));
  return res.tags;
}

/** Detach one tag from one order; returns the order's resulting tag set. */
/**
 * Remove a tag from an order, optionally with the note the tag demands on its way out.
 *
 * A POST rather than the DELETE its shape suggests, because the note has to travel in a body: hosts
 * and intermediaries strip DELETE bodies unreliably, and a note in the query string would be
 * recorded in every access log.
 */
export async function unassignOrderTag(
  ctx: DispatchContext,
  orderHexId: string,
  tagId: number,
  note?: string,
): Promise<TagSummary[]> {
  const res = await api(ctx)
    .post<{ tags: TagSummary[] }>(route(path`/orders/${orderHexId}/tags/${tagId}/remove`), { note })
    .catch(tagError('Unassign tag failed'));
  return res.tags;
}

/** Bulk-assign tags across many orders. One shared `note` is stamped on each. */
export async function bulkAssignOrderTags(
  ctx: DispatchContext,
  orderIds: string[],
  tagIds: number[],
  note?: string,
): Promise<void> {
  await api(ctx)
    .post<void>(route('/orders/tags/bulk'), { orderIds, tagIds, note })
    .catch(tagError('Bulk assign tags failed'));
}

import {
  createInvFluxApi,
  createSavedFilter,
  deleteSavedFilter,
  fetchSavedFilters,
  qk,
  SAVED_FILTER_SURFACE,
  STOCK_MOVED,
  updateSavedFilter,
  type SavedFilterIndex,
  type SavedFilterQuery,
} from '@invflux/ui/api';
// Subpath, deliberately: the package barrel pulls the whole component tree into this module.
import { toast } from '@invflux/ui/toast';
import { __ } from '@invflux/i18n';
import { usePaneActive } from '@invflux/ui/pane';
import {
  createInfiniteQuery,
  createMutation,
  createQuery,
  useQueryClient,
  type CreateInfiniteQueryResult,
  type CreateMutationResult,
  type CreateQueryResult,
  type InfiniteData,
} from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import {
  createCorrection,
  deleteCorrection,
  fetchDispatchFacets,
  fetchDispatchOrders,
  fetchDispatchOrderDetail,
  fetchOrderCorrections,
  fetchOrderEvents,
  fetchOrderAnnotations,
  createOrderAnnotation,
  editOrderAnnotation,
  deleteOrderAnnotation,
  fetchWorksheetFilterOptions,
  capturePayment,
  type CaptureResolution,
  type ManualPaymentInput,
  processCorrections,
  settleManualRefund,
  searchSkuFilterOptions,
  shipOrder,
  stageLine,
  type CapturePaymentResult,
  type CorrectionApiError,
  type FilterOption,
  type OrderEventsResponse,
  type OrderAnnotationsResponse,
  type AnnotationApiError,
  type ProcessCorrectionsResponse,
  type SettleManualRefundResponse,
  type ShipOrderError,
  type ShipOrderResponse,
  type StageLineRequest,
  type StageLineResponse,
  type StageLineError,
} from './api';
import {
  assignOrderTags,
  bulkAssignOrderTags,
  type BulkAssignResult,
  createTag,
  deleteTag,
  fetchArchivedTags,
  fetchTags,
  restoreTag,
  unassignOrderTag,
  updateTag,
} from './api';
import { useDispatch } from './context';
import type {
  CreateCorrectionRequest,
  CreateCorrectionResponse,
  DispatchCorrectionsResponse,
  DispatchFacetsResponse,
  DispatchOrderDetail,
  DispatchOrderLine,
  DispatchQueueFilters,
  DispatchQueueResponse,
  GovernanceFlag,
  ManageAuthority,
  ProcessCorrectionsPayload,
  TagSummary,
  ArchivedTagName,
  TagListResult,
} from './types';

/**
 * Live-polled dispatch queue with infinite-scroll pagination. Mirrors the
 * Central Workbench's `createInfiniteQuery` pattern: the `perPage` field
 * is the *chunk size* fetched per page, and the operator scrolls
 * through accumulated pages — there's no prev/next button traversal.
 *
 * 30-second `refetchInterval` mirrors the `WorkbenchGrid` cadence;
 * The query is keyed on the
 * filter spec sans `page` (which the infinite query owns via
 * `pageParam`) so a filter change invalidates the whole roll-up rather
 * than fragmenting the cache per page.
 *
 * **Filter transitions keep the table visible.** `placeholderData`
 * returns the previous query's data while the new key fetches — so
 * typing in the search box (which debounces a URL update at 200ms
 * and changes the query key) doesn't blank the table for the
 * round-trip. The local `displayedOrders` filter keeps narrowing the
 * placeholder rows on every keystroke; when the new server data
 * arrives, the table swaps in the authoritative result without ever
 * passing through an empty state. `query.isFetching` exposes the
 * pending request so the footer can show a quiet "Refreshing…".
 */
export function useDispatchOrdersQuery(
  filters: Accessor<DispatchQueueFilters>,
  /**
   * Off while the surface is serving rows from the replicated working set. The paged query is the
   * fallback for what the set cannot answer, and running both would spend a request per filter
   * change to produce rows nothing renders.
   */
  enabled: Accessor<boolean> = () => true,
): CreateInfiniteQueryResult<InfiniteData<DispatchQueueResponse>, Error> {
  const ctx = useDispatch();
  const queueCadence = pausedWhenHidden(30_000);

  return createInfiniteQuery(() => {
    const { page: _ignoredPage, ...filterKey } = filters();
    return {
      enabled: enabled(),
      queryKey: qk.dispatch.queue(filterKey),
      initialPageParam: 1,
      queryFn: ({ pageParam }) =>
        fetchDispatchOrders(ctx, { ...filters(), page: pageParam as number }),
      getNextPageParam: (lastPage) => {
        const fetched = lastPage.page * lastPage.perPage;
        return fetched < lastPage.total ? lastPage.page + 1 : undefined;
      },
      placeholderData: (previousData) => previousData,
      refetchInterval: queueCadence,
      refetchIntervalInBackground: false,
      staleTime: 20_000,
    };
  });
}

/**
 * A refetch cadence that pauses when this pane is not the one on screen.
 *
 * `refetchIntervalInBackground: false` already stops polling when the *browser* window loses focus.
 * This is the other half: surfaces stay mounted behind the active tab, so without it a queue nobody
 * is looking at keeps fetching pages on a 30s tick for as long as the admin page is open.
 */
function pausedWhenHidden(ms: number): () => number | false {
  const paneActive = usePaneActive();

  return () => (paneActive() ? ms : false);
}

/**
 * Single-order detail. Kept current by the viewer heartbeat rather than a timer of its own: each beat
 * carries a revision of what the page shows, and a moved revision invalidates this query (see
 * `heartbeat.ts`). The slow interval is only a backstop for what the revision does not cover.
 */
export function useDispatchOrderDetailQuery(
  hexId: Accessor<string>,
): CreateQueryResult<DispatchOrderDetail, Error> {
  const ctx = useDispatch();
  const cadence = pausedWhenHidden(5 * 60_000);

  return createQuery(() => ({
    queryKey: qk.dispatch.orderDetail(hexId()),
    queryFn: () => fetchDispatchOrderDetail(ctx, hexId()),
    refetchInterval: cadence,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    enabled: hexId() !== '',
  }));
}

// ---------------------------------------------------------------------------
// PATCH /orders/{id}/lines/{lineId} — staging mutation
// ---------------------------------------------------------------------------

export interface StageLineMutationVariables {
  lineHexId: string;
  stagedQty: number;
  source: StageLineRequest['source'];
}

interface StageLineMutationContext {
  previous: DispatchOrderDetail | undefined;
}

/**
 * Optimistic stage mutation. Applies the target stagedQty to the detail
 * cache immediately on click so the UI feels native; rolls back on error;
 * settles to the server's authoritative response on success and invalidates
 * the queue so the list view picks up any status / staged_count changes.
 */
export function useStageLineMutation(
  orderHexId: Accessor<string>,
): CreateMutationResult<
  StageLineResponse,
  StageLineError,
  StageLineMutationVariables,
  StageLineMutationContext
> {
  const ctx = useDispatch();
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: (variables: StageLineMutationVariables) =>
      stageLine(ctx, orderHexId(), variables.lineHexId, {
        stagedQty: variables.stagedQty,
        source: variables.source,
      }),
    onMutate: async (variables): Promise<StageLineMutationContext> => {
      const queryKey = qk.dispatch.orderDetail(orderHexId());
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<DispatchOrderDetail>(queryKey);
      if (previous) {
        queryClient.setQueryData<DispatchOrderDetail>(
          queryKey,
          applyOptimisticStage(previous, variables, ctx.currentUser.id),
        );
      }
      return { previous };
    },
    onError: (_err, _variables, mutationCtx) => {
      const queryKey = qk.dispatch.orderDetail(orderHexId());
      if (mutationCtx?.previous) {
        queryClient.setQueryData<DispatchOrderDetail>(queryKey, mutationCtx.previous);
      }
    },
    onSuccess: (response) => {
      // Shipping takes units off the shelf, so every surface showing a stock figure is now stale —
      // the Workbench grid most of all, since it has no live path of its own today.
      for (const key of STOCK_MOVED) void queryClient.invalidateQueries({ queryKey: key });
      const queryKey = qk.dispatch.orderDetail(orderHexId());
      queryClient.setQueryData<DispatchOrderDetail>(queryKey, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          order: {
            ...prev.order,
            status: response.order.status,
            lineCount: response.order.lineCount,
            stagedCount: response.order.stagedCount,
            shippedCount: response.order.shippedCount,
            unprocessedCorrections: response.order.unprocessedCorrections,
            updatedAt: response.order.updatedAt ?? prev.order.updatedAt,
          },
          lines: prev.lines.map((line) =>
            line.id === response.line.id ? withStagingFrom(line, response.line) : line,
          ),
        };
      });
      // Queue cache is keyed on FilterSpec; we don't know which is active, so
      // invalidate the whole "dispatch/orders" tree and let TanStack refetch
      // only the active subscriptions.
      void queryClient.invalidateQueries({ queryKey: qk.dispatch.queue() });
    },
  }));
}

// ---------------------------------------------------------------------------
// Filter options — worksheet (pre-loaded) + SKU (async-search)
// ---------------------------------------------------------------------------

/**
 * Worksheet options for the worksheet filter chip. Cacheable for the
 * session — worksheets change rarely. The bar resolves labels on
 * demand via the value↔option map computed alongside the URL state.
 */
export function useWorksheetFilterOptionsQuery(): CreateQueryResult<FilterOption[], Error> {
  const ctx = useDispatch();
  return createQuery(() => ({
    queryKey: qk.dispatch.filterOptions('worksheets'),
    queryFn: () => fetchWorksheetFilterOptions(ctx),
    staleTime: 5 * 60_000,
  }));
}

/**
 * Filter-facet counts for the dimension whose control is currently open — nothing while none is.
 *
 * **Only for the control being opened.** Counting every dimension on every list render is what
 * makes faceted UIs slow; one dimension when the operator opens something is affordable and feels
 * instant. `dimension()` returning null is the closed state, and it disables the query rather than
 * fetching a discarded answer.
 *
 * Counts are an **affordance, not the answer** — the rows are the answer. So this keeps the last
 * numbers on screen while new ones load (`placeholderData`), never blocks on them, and a failure
 * leaves the control working with no counts rather than surfacing an error over a filter list.
 */
export function useDispatchFacetsQuery(
  dimension: Accessor<string | null>,
  filters: Accessor<DispatchQueueFilters>,
): CreateQueryResult<DispatchFacetsResponse, Error> {
  const ctx = useDispatch();

  return createQuery(() => {
    const dim = dimension();
    const { page: _page, perPage: _perPage, ...filterKey } = filters();

    return {
      queryKey: qk.dispatch.facets(dim ?? 'none', JSON.stringify(filterKey)),
      queryFn: ({ signal }) => fetchDispatchFacets(ctx, dim ?? '', filters(), signal),
      enabled: dim !== null,
      placeholderData: (previousData) => previousData,
      // Short, not zero: an operator reopening the same control within a few seconds is looking at
      // the same store, and re-counting it would be a round trip to redraw identical numbers.
      staleTime: 15_000,
      // A count that cannot be had is not worth a retry storm behind a popover.
      retry: false,
    };
  });
}

/**
 * One-shot SKU search. The `multiselect:async` filter control owns
 * its own debounce/min-char gate; this helper just wraps the
 * server call so a chip can pass it as `loadOptions`.
 */
export function useSkuSearchLoader(): (query: string) => Promise<FilterOption[]> {
  const ctx = useDispatch();
  return (query: string) => searchSkuFilterOptions(ctx, query);
}

// ---------------------------------------------------------------------------
// Corrections — GET/POST/DELETE
// ---------------------------------------------------------------------------

/**
 * Live list of corrections for one order. No interval of its own: the viewer heartbeat's revision
 * moves whenever a correction is created, deleted or processed, and invalidates this query then.
 */
export function useOrderCorrectionsQuery(
  hexId: Accessor<string>,
): CreateQueryResult<DispatchCorrectionsResponse, Error> {
  const ctx = useDispatch();

  return createQuery(() => ({
    queryKey: qk.dispatch.orderCorrections(hexId()),
    queryFn: () => fetchOrderCorrections(ctx, hexId()),
    staleTime: 30_000,
    enabled: hexId() !== '',
  }));
}

/**
 * Order event timeline — lazy-fetched on panel expand. Refetches
 * are infrequent (events only append; the timeline is monotonic),
 * so we set a long `staleTime` and skip the `refetchInterval`
 * heartbeat. The panel re-enables when the operator opens it,
 * and the existing detail-route polling captures new events
 * indirectly via the order header counters.
 */
export function useOrderEventsQuery(
  hexId: Accessor<string>,
  enabled: Accessor<boolean>,
): CreateQueryResult<OrderEventsResponse, Error> {
  const ctx = useDispatch();
  return createQuery(() => ({
    queryKey: qk.dispatch.orderEvents(hexId()),
    queryFn: () => fetchOrderEvents(ctx, hexId()),
    staleTime: 60_000,
    enabled: hexId() !== '' && enabled(),
  }));
}

// ---------------------------------------------------------------------------
// Order annotations (notes). The list feeds both the AnnotationsPanel and the
// timeline interleave, so every mutation invalidates the annotations key *and*
// the events key (a note change shifts what the merged timeline shows).
// ---------------------------------------------------------------------------

export function useOrderAnnotationsQuery(
  hexId: Accessor<string>,
  enabled: Accessor<boolean>,
): CreateQueryResult<OrderAnnotationsResponse, Error> {
  const ctx = useDispatch();
  return createQuery(() => ({
    queryKey: qk.dispatch.orderAnnotations(hexId()),
    queryFn: () => fetchOrderAnnotations(ctx, hexId()),
    staleTime: 30_000,
    enabled: hexId() !== '' && enabled(),
  }));
}

/** A note write, optionally carrying a tag delta applied to the order in the same act (§5). */
export interface NoteSubmit {
  body: string;
  addTags?: number[];
  removeTags?: number[];
}

function invalidateAnnotations(
  queryClient: ReturnType<typeof useQueryClient>,
  hexId: string,
  touchedTags = false,
): void {
  void queryClient.invalidateQueries({ queryKey: qk.dispatch.orderAnnotations(hexId) });
  void queryClient.invalidateQueries({ queryKey: qk.dispatch.orderEvents(hexId) });
  if (touchedTags) {
    // A note that changed the order's tags shifts the queue rows + tag usage counts.
    void queryClient.invalidateQueries({ queryKey: qk.dispatch.queue() });
    void queryClient.invalidateQueries({ queryKey: qk.dispatch.tags() });
  }
}

const noteTouchedTags = (v: NoteSubmit): boolean =>
  (v.addTags?.length ?? 0) > 0 || (v.removeTags?.length ?? 0) > 0;

export function useCreateOrderAnnotationMutation(
  hexId: Accessor<string>,
): CreateMutationResult<unknown, AnnotationApiError, NoteSubmit, unknown> {
  const ctx = useDispatch();
  const queryClient = useQueryClient();
  return createMutation(() => ({
    mutationFn: (v: NoteSubmit) =>
      createOrderAnnotation(ctx, hexId(), v.body, { addTags: v.addTags, removeTags: v.removeTags }),
    onSuccess: (_r, v) => invalidateAnnotations(queryClient, hexId(), noteTouchedTags(v)),
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  }));
}

export function useEditOrderAnnotationMutation(
  hexId: Accessor<string>,
): CreateMutationResult<unknown, AnnotationApiError, NoteSubmit & { threadId: string }, unknown> {
  const ctx = useDispatch();
  const queryClient = useQueryClient();
  return createMutation(() => ({
    mutationFn: (v: NoteSubmit & { threadId: string }) =>
      editOrderAnnotation(ctx, hexId(), v.threadId, v.body, {
        addTags: v.addTags,
        removeTags: v.removeTags,
      }),
    onSuccess: (_r, v) => invalidateAnnotations(queryClient, hexId(), noteTouchedTags(v)),
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  }));
}

export function useDeleteOrderAnnotationMutation(
  hexId: Accessor<string>,
): CreateMutationResult<unknown, AnnotationApiError, string, unknown> {
  const ctx = useDispatch();
  const queryClient = useQueryClient();
  return createMutation(() => ({
    mutationFn: (threadId: string) => deleteOrderAnnotation(ctx, hexId(), threadId),
    onSuccess: () => invalidateAnnotations(queryClient, hexId()),
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  }));
}

export function useCreateCorrectionMutation(
  orderHexId: Accessor<string>,
): CreateMutationResult<
  CreateCorrectionResponse,
  CorrectionApiError,
  CreateCorrectionRequest,
  unknown
> {
  const ctx = useDispatch();
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: (request: CreateCorrectionRequest) => createCorrection(ctx, orderHexId(), request),
    onSuccess: (response) => {
      const correctionsKey = qk.dispatch.orderCorrections(orderHexId());
      // Append the new correction to the cache so the panel re-renders
      // without waiting for the refetch. Critical: spread `prev` so the
      // sibling `types` field is preserved — earlier versions of this
      // updater returned `{ corrections: ... }` only, which stripped
      // `types` from the cache and crashed the open CorrectionModal
      // (whose `props.types.find(...)` threw on undefined). That crash
      // is the root cause of the "Adding…" stuck-spinner symptom.
      queryClient.setQueryData<DispatchCorrectionsResponse>(correctionsKey, (prev) => {
        if (!prev) return { corrections: [response.correction], types: [] };
        return { ...prev, corrections: [...prev.corrections, response.correction] };
      });
      // Sync the order header (status / staged_count / unprocessed_corrections /
      // qty_corrected indirectly via lineCount-style fields — qty_corrected on
      // the affected line still needs a refetch to pick up the bump).
      const detailKey = qk.dispatch.orderDetail(orderHexId());
      queryClient.setQueryData<DispatchOrderDetail>(detailKey, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          order: {
            ...prev.order,
            status: response.order.status,
            stagedCount: response.order.stagedCount,
            shippedCount: response.order.shippedCount,
            unprocessedCorrections: response.order.unprocessedCorrections,
            updatedAt: response.order.updatedAt ?? prev.order.updatedAt,
          },
        };
      });
      void queryClient.invalidateQueries({ queryKey: detailKey });
      void queryClient.invalidateQueries({ queryKey: qk.dispatch.queue() });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  }));
}

export function useDeleteCorrectionMutation(
  orderHexId: Accessor<string>,
): CreateMutationResult<
  void,
  CorrectionApiError,
  string,
  { previous: DispatchCorrectionsResponse | undefined }
> {
  const ctx = useDispatch();
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: (correctionHexId: string) => deleteCorrection(ctx, correctionHexId),
    onMutate: async (correctionHexId) => {
      const correctionsKey = qk.dispatch.orderCorrections(orderHexId());
      await queryClient.cancelQueries({ queryKey: correctionsKey });
      const previous = queryClient.getQueryData<DispatchCorrectionsResponse>(correctionsKey);
      if (previous) {
        // Preserve `types` — see CorrectionsResponse comment on the
        // create mutation. Stripping it crashed the open modal via
        // `props.types.find(...)`-on-undefined.
        queryClient.setQueryData<DispatchCorrectionsResponse>(correctionsKey, {
          ...previous,
          corrections: previous.corrections.filter((c) => c.id !== correctionHexId),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, mutationCtx) => {
      const correctionsKey = qk.dispatch.orderCorrections(orderHexId());
      if (mutationCtx?.previous) {
        queryClient.setQueryData<DispatchCorrectionsResponse>(correctionsKey, mutationCtx.previous);
      }
    },
    onSuccess: () => {
      // The DELETE response is 204; backend recounted unprocessed_corrections
      // and status, so refetch order detail + queue to pull the new numbers.
      void queryClient.invalidateQueries({ queryKey: qk.dispatch.orderDetail(orderHexId()) });
      void queryClient.invalidateQueries({ queryKey: qk.dispatch.queue() });
    },
  }));
}

/**
 * Process every unprocessed correction on one order in a single batch.
 * On success, patches the cached order header from the response and
 * invalidates the corrections list so the rows pick up their new
 * `processedAt` timestamps.
 */
export function useProcessCorrectionsMutation(
  orderHexId: Accessor<string>,
): CreateMutationResult<
  ProcessCorrectionsResponse,
  CorrectionApiError,
  ProcessCorrectionsPayload,
  unknown
> {
  const ctx = useDispatch();
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: (payload: ProcessCorrectionsPayload) =>
      processCorrections(ctx, orderHexId(), payload),
    onSuccess: (response) => {
      const detailKey = qk.dispatch.orderDetail(orderHexId());
      queryClient.setQueryData<DispatchOrderDetail>(detailKey, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          order: {
            ...prev.order,
            status: response.order.status,
            stagedCount: response.order.stagedCount,
            shippedCount: response.order.shippedCount,
            unprocessedCorrections: response.order.unprocessedCorrections,
            updatedAt: response.order.updatedAt ?? prev.order.updatedAt,
          },
        };
      });
      // Refetch corrections list (rows now have `processedAt` set) and the
      // queue so the order's stagedCount / status change propagates.
      void queryClient.invalidateQueries({ queryKey: qk.dispatch.orderCorrections(orderHexId()) });
      void queryClient.invalidateQueries({ queryKey: qk.dispatch.queue() });
    },
  }));
}

/**
 * Settle the order's pending manual refunds. On success, refresh the order
 * detail (the `pendingManualRefunds` counter drops), its timeline (fresh
 * `correction.refund_confirmed` events), and the queue (the order may leave the
 * "Pending manual refunds" filter).
 */
export function useSettleManualRefundMutation(
  orderHexId: Accessor<string>,
): CreateMutationResult<SettleManualRefundResponse, CorrectionApiError, void, unknown> {
  const ctx = useDispatch();
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: () => settleManualRefund(ctx, orderHexId()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.dispatch.orderDetail(orderHexId()) });
      void queryClient.invalidateQueries({ queryKey: qk.dispatch.orderEvents(orderHexId()) });
      void queryClient.invalidateQueries({ queryKey: qk.dispatch.queue() });
    },
  }));
}

/**
 * Record a manual payment + capture stock (manual gateways). The mutation variable is the
 * payment entered and the optional shortfall resolution; omit the resolution for the initial
 * capture attempt. A `{status:'shortfall'}` result is NOT an error — the caller prompts the
 * merchant and re-runs with a resolution. Only a fresh capture invalidates the caches.
 */
export function useCapturePaymentMutation(
  orderHexId: Accessor<string>,
): CreateMutationResult<
  CapturePaymentResult,
  CorrectionApiError,
  { payment: ManualPaymentInput; resolution?: CaptureResolution },
  unknown
> {
  const ctx = useDispatch();
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: (vars: { payment: ManualPaymentInput; resolution?: CaptureResolution }) =>
      capturePayment(ctx, orderHexId(), vars.payment, vars.resolution),
    onSuccess: (result) => {
      if (result.status === 'shortfall') return; // not a terminal change — caller prompts
      void queryClient.invalidateQueries({ queryKey: qk.dispatch.orderDetail(orderHexId()) });
      void queryClient.invalidateQueries({ queryKey: qk.dispatch.orderEvents(orderHexId()) });
      void queryClient.invalidateQueries({ queryKey: qk.dispatch.queue() });
    },
  }));
}

/**
 * Compute the cache shape immediately after an optimistic stage operation.
 * Updates the targeted line's qty_staged / staged_by / staged_at / staged_source
 * and recomputes stagedCount + status on the order using the same rule the
 * backend will apply on commit.
 */
/**
 * Take from a stage response only what the stage endpoint is authoritative for.
 *
 * The response is shaped as a whole line, but the endpoint re-reads only the line's own row. What
 * the detail read joins in — stock concerns and the deficit's operands, the unit price, the shipping
 * class, product links, the unmanaged flag — arrives as defaults. Swapping the line in whole showed
 * a line in deficit as clear from the moment it was staged until the next detail refetch. Staging
 * moves no stock and changes none of those, so the line already held is right about all of them.
 */
function withStagingFrom(held: DispatchOrderLine, staged: DispatchOrderLine): DispatchOrderLine {
  return {
    ...held,
    qtyOrdered: staged.qtyOrdered,
    qtyCorrected: staged.qtyCorrected,
    qtyShipped: staged.qtyShipped,
    stagedQty: staged.stagedQty,
    stagedBy: staged.stagedBy,
    stagedAt: staged.stagedAt,
    stagedSource: staged.stagedSource,
  };
}

function applyOptimisticStage(
  prev: DispatchOrderDetail,
  variables: StageLineMutationVariables,
  currentUserId: number,
): DispatchOrderDetail {
  const nowIso = new Date().toISOString();
  const updatedLines = prev.lines.map((line) => {
    if (line.id !== variables.lineHexId) return line;
    const isStaging = variables.stagedQty > 0;
    return {
      ...line,
      stagedQty: variables.stagedQty,
      stagedBy: isStaging ? currentUserId : null,
      stagedAt: isStaging ? nowIso : null,
      stagedSource: isStaging ? variables.source : null,
    };
  });

  // stagedCount = lines where qty_staged == qty_ordered - qty_corrected - qty_shipped
  // (matches the backend's COUNT(*) recount; trivially counts fully-corrected
  // lines as "done" too because both sides equal zero).
  const stagedCount = updatedLines.filter(
    (l) => l.stagedQty === Math.max(0, l.qtyOrdered - l.qtyCorrected - l.qtyShipped),
  ).length;

  const order = prev.order;
  const isReady =
    order.lineCount > 0 &&
    stagedCount + order.shippedCount === order.lineCount &&
    order.unprocessedCorrections === 0 &&
    order.workflowState === 'Active';
  const allShipped = order.lineCount > 0 && order.shippedCount === order.lineCount;
  const anyWorkDone = stagedCount > 0 || order.shippedCount > 0 || order.unprocessedCorrections > 0;
  // Mirror `OrderStatusRecomputer::recompute` on the PHP side. Keep
  // the rule shape identical here so the optimistic update doesn't
  // disagree with the server's commit and flicker through a wrong
  // status pill on settle.
  const newStatus =
    order.status === 'Cancelled'
      ? 'Cancelled'
      : allShipped
        ? 'Shipped'
        : isReady
          ? 'Staged'
          : anyWorkDone
            ? 'Started'
            : 'Untouched';

  return {
    ...prev,
    order: {
      ...order,
      stagedCount,
      status: newStatus,
      updatedAt: nowIso,
    },
    lines: updatedLines,
  };
}

// ---------------------------------------------------------------------------
// Ship — POST /orders/{id}/ship
// ---------------------------------------------------------------------------

interface ShipOrderMutationContext {
  previous: DispatchOrderDetail | undefined;
}

/**
 * Essentials-tier Ship mutation. Optimistically flips the cached order to
 * `Shipped` (line `qty_shipped` += `qty_outstanding`, `qty_staged` → 0,
 * counts updated) so the merchant sees the action take effect the
 * instant they confirm the modal; rolls back on error; settles to the
 * server's authoritative header on success and invalidates the queue
 * so the list view picks up the status change.
 */
export function useShipOrderMutation(
  orderHexId: Accessor<string>,
): CreateMutationResult<ShipOrderResponse, ShipOrderError, void, ShipOrderMutationContext> {
  const ctx = useDispatch();
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: () => shipOrder(ctx, orderHexId()),
    onMutate: async (): Promise<ShipOrderMutationContext> => {
      const queryKey = qk.dispatch.orderDetail(orderHexId());
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<DispatchOrderDetail>(queryKey);
      if (previous) {
        const shippedLines = previous.lines.map((line) => {
          const outstanding = Math.max(0, line.qtyOrdered - line.qtyCorrected - line.qtyShipped);
          if (outstanding <= 0) return line;
          return {
            ...line,
            qtyShipped: line.qtyShipped + outstanding,
            stagedQty: 0,
          };
        });
        queryClient.setQueryData<DispatchOrderDetail>(queryKey, {
          ...previous,
          order: {
            ...previous.order,
            status: 'Shipped',
            shippedCount: previous.order.lineCount,
            stagedCount: 0,
            updatedAt: new Date().toISOString(),
          },
          lines: shippedLines,
        });
      }
      return { previous };
    },
    onError: (_err, _vars, mutationCtx) => {
      const queryKey = qk.dispatch.orderDetail(orderHexId());
      if (mutationCtx?.previous) {
        queryClient.setQueryData<DispatchOrderDetail>(queryKey, mutationCtx.previous);
      }
    },
    onSuccess: (response) => {
      // The confirmation is a toast rather than text in the ship bar, which now offers the next
      // order instead — the one thing a packer does after shipping.
      toast.success(__('Order shipped'));
      const queryKey = qk.dispatch.orderDetail(orderHexId());
      queryClient.setQueryData<DispatchOrderDetail>(queryKey, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          order: {
            ...prev.order,
            status: response.order.status,
            lineCount: response.order.lineCount,
            stagedCount: response.order.stagedCount,
            shippedCount: response.order.shippedCount,
            unprocessedCorrections: response.order.unprocessedCorrections,
            updatedAt: response.order.updatedAt ?? prev.order.updatedAt,
          },
        };
      });
      void queryClient.invalidateQueries({ queryKey: qk.dispatch.queue() });
    },
  }));
}

// ---------------------------------------------------------------------------
// Order tags
// ---------------------------------------------------------------------------

/** All order-tag definitions (filter chip options + management modal source). */
/**
 * The live tags. Backed by a response that also carries retired *names* — see
 * {@link useArchivedTagNamesQuery}, which reads the same cache entry through a different `select`,
 * so the two are one request.
 */
export function useTagsQuery(): CreateQueryResult<TagSummary[], Error> {
  const ctx = useDispatch();
  return createQuery(() => ({
    queryKey: qk.dispatch.tags(),
    queryFn: () => fetchTags(ctx),
    staleTime: 5 * 60_000,
    select: (r: TagListResult) => r.tags,
  }));
}

/** Retired tag names, for collision + near-duplicate checks while typing. Shares the query above. */
export function useArchivedTagNamesQuery(): CreateQueryResult<ArchivedTagName[], Error> {
  const ctx = useDispatch();
  return createQuery(() => ({
    queryKey: qk.dispatch.tags(),
    queryFn: () => fetchTags(ctx),
    staleTime: 5 * 60_000,
    select: (r: TagListResult) => r.archivedNames,
  }));
}

/**
 * The retired tags in full — only fetched once the merchant opens the retired section, or a name
 * collision opens it for them. `enabled` is what keeps an archive nobody asked for off the wire.
 */
export function useArchivedTagsQuery(
  enabled: () => boolean,
): CreateQueryResult<TagSummary[], Error> {
  const ctx = useDispatch();
  return createQuery(() => ({
    queryKey: qk.dispatch.archivedTags(),
    queryFn: () => fetchArchivedTags(ctx),
    staleTime: 5 * 60_000,
    get enabled() {
      return enabled();
    },
  }));
}

/**
 * Tag-definition CRUD. A change to a definition (rename / recolour / delete)
 * reflects on every order chip, so each invalidates both the tag list and the
 * order queries.
 */
export interface TagCreateInput {
  name: string;
  colorId?: number;
  governanceFlags?: GovernanceFlag[];
  priority?: number;
  manageAuthority?: ManageAuthority;
}
export interface TagUpdateInput {
  id: number;
  name?: string;
  colorId?: number;
  governanceFlags?: GovernanceFlag[];
  priority?: number;
  manageAuthority?: ManageAuthority;
}

export function useTagAdminMutations(): {
  create: CreateMutationResult<TagSummary, Error, TagCreateInput>;
  update: CreateMutationResult<TagSummary, Error, TagUpdateInput>;
  remove: CreateMutationResult<void, Error, number>;
  restore: CreateMutationResult<TagSummary, Error, number>;
} {
  const ctx = useDispatch();
  const queryClient = useQueryClient();
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: qk.dispatch.tags() });
    void queryClient.invalidateQueries({ queryKey: qk.dispatch.queue() });
  };
  return {
    create: createMutation(() => ({
      mutationFn: (v: TagCreateInput) => createTag(ctx, v),
      onSuccess: invalidate,
    })),
    update: createMutation(() => ({
      mutationFn: (v: TagUpdateInput) =>
        updateTag(ctx, v.id, {
          name: v.name,
          colorId: v.colorId,
          governanceFlags: v.governanceFlags,
          priority: v.priority,
          manageAuthority: v.manageAuthority,
        }),
      onSuccess: invalidate,
    })),
    restore: createMutation(() => ({
      mutationFn: (id: number) => restoreTag(ctx, id),
      // Restoring moves a tag between the two lists and gives it back its effect on the queue, so
      // both the archived list and the orders have to be refetched, not just the live list.
      onSuccess: () => {
        invalidate();
        void queryClient.invalidateQueries({ queryKey: qk.dispatch.archivedTags() });
      },
    })),
    remove: createMutation(() => ({
      mutationFn: (id: number) => deleteTag(ctx, id),
      onSuccess: () => {
        invalidate();
        void queryClient.invalidateQueries({ queryKey: qk.dispatch.archivedTags() });
      },
    })),
  };
}

/**
 * Assign / unassign tags on one order. The endpoints return the order's
 * resulting tag set; we write it straight onto the cached detail and invalidate
 * the queue so its row chip refreshes.
 */
export function useOrderTagMutations(orderHexId: Accessor<string>): {
  assign: CreateMutationResult<TagSummary[], Error, { tagIds: number[]; note?: string }>;
  unassign: CreateMutationResult<TagSummary[], Error, { tagId: number; note?: string }>;
} {
  const ctx = useDispatch();
  const queryClient = useQueryClient();
  const writeTags = (tags: TagSummary[]): void => {
    const queryKey = qk.dispatch.orderDetail(orderHexId());
    queryClient.setQueryData<DispatchOrderDetail>(queryKey, (prev) =>
      prev ? { ...prev, order: { ...prev.order, tags } } : prev,
    );
    void queryClient.invalidateQueries({ queryKey: qk.dispatch.queue() });
  };
  return {
    assign: createMutation(() => ({
      mutationFn: (v: { tagIds: number[]; note?: string }) =>
        assignOrderTags(ctx, orderHexId(), v.tagIds, v.note),
      onSuccess: writeTags,
    })),
    unassign: createMutation(() => ({
      mutationFn: (v: { tagId: number; note?: string }) =>
        unassignOrderTag(ctx, orderHexId(), v.tagId, v.note),
      onSuccess: writeTags,
    })),
  };
}

/** Bulk-assign tags across a selection of orders; invalidates the queue. */
export function useBulkAssignTagsMutation(): CreateMutationResult<
  BulkAssignResult,
  Error,
  { orderIds: string[]; tagIds: number[]; note?: string }
> {
  const ctx = useDispatch();
  const queryClient = useQueryClient();
  return createMutation(() => ({
    mutationFn: (v: { orderIds: string[]; tagIds: number[]; note?: string }) =>
      bulkAssignOrderTags(ctx, v.orderIds, v.tagIds, v.note),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.dispatch.queue() });
      // refresh tag usage counts
      void queryClient.invalidateQueries({ queryKey: qk.dispatch.tags() });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  }));
}

// ── Saved filters ────────────────────────────────────────────────────────────
//
// The queue's named views. The endpoints and the resolution rule are shared (`@invflux/ui/api`);
// what is dispatch's own is the surface key and the invalidation, which is deliberately narrow:
// saving a view moves no stock and changes no order, so it touches only its own key.

/** This surface's saved views, with whether the caller may change them. */
export function useSavedFiltersQuery(): CreateQueryResult<SavedFilterIndex, Error> {
  const ctx = useDispatch();
  return createQuery(() => ({
    queryKey: qk.savedFilters.forSurface(SAVED_FILTER_SURFACE.dispatch),
    queryFn: ({ signal }) =>
      fetchSavedFilters(
        createInvFluxApi({ apiRoot: ctx.apiRoot, nonce: ctx.nonce }),
        SAVED_FILTER_SURFACE.dispatch,
        signal,
      ),
    staleTime: 5 * 60_000,
  }));
}

/**
 * Create / pin / delete, as one mutation over a discriminated action.
 *
 * One mutation rather than three because they share an invalidation and a failure mode, and the
 * component drives them through one busy flag — three would give three independent in-flight
 * states for a surface that can only be doing one of them at a time.
 */
export function useSavedFilterMutation(): CreateMutationResult<
  unknown,
  Error,
  SavedFilterAction,
  unknown
> {
  const ctx = useDispatch();
  const queryClient = useQueryClient();
  return createMutation(() => ({
    mutationFn: async (action: SavedFilterAction): Promise<unknown> => {
      const api = createInvFluxApi({ apiRoot: ctx.apiRoot, nonce: ctx.nonce });
      const surface = SAVED_FILTER_SURFACE.dispatch;
      if (action.kind === 'create') {
        return createSavedFilter(api, surface, {
          name: action.name,
          query: action.query,
          colorId: action.colorId,
        });
      }
      if (action.kind === 'pin') {
        return updateSavedFilter(api, surface, action.id, { pinned: action.pinned });
      }
      if (action.kind === 'color') {
        return updateSavedFilter(api, surface, action.id, { colorId: action.colorId });
      }

      return deleteSavedFilter(api, surface, action.id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: qk.savedFilters.forSurface(SAVED_FILTER_SURFACE.dispatch),
      });
    },
    // No toast here: the control surfaces its own failure next to the affordance that caused it,
    // where the operator is already looking.
  }));
}

/** What {@link useSavedFilterMutation} can be asked to do. */
export type SavedFilterAction =
  | { kind: 'create'; name: string; query: SavedFilterQuery; colorId: number }
  | { kind: 'pin'; id: number; pinned: boolean }
  | { kind: 'color'; id: number; colorId: number }
  | { kind: 'delete'; id: number };

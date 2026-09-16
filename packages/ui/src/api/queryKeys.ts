/**
 * The query-key vocabulary for every surface, in one place.
 *
 * It lives in the shared package rather than per package for one reason: **invalidation crosses
 * surfaces**. Receiving a purchase order moves stock, and the thing that has to hear about it is the
 * Workbench grid — a different package, in the same never-unmounting client. Procurement cannot
 * invalidate a key it cannot name, so before this the grid was simply never told.
 *
 * Two rules the shapes here encode:
 *
 * **1. A list axis and a detail axis are never nested.** `['dispatch','queue',…]` and
 * `['dispatch','order',id,…]` are siblings, not parent and child. They used to share a
 * `['dispatch','orders']` prefix, so `invalidateQueries(['dispatch','orders'])` — written at eleven
 * sites — took out the queue *and* every open order's detail, corrections, events and annotations.
 * One stage-line click wrote the authoritative detail with `setQueryData` and then invalidated it,
 * refetching what it had just been handed. A twenty-line order turned into roughly 120 requests.
 *
 * **2. Ids are coerced here, not at the call site.** A key of `['…', 7]` and one of `['…', '7']` are
 * different cache entries, and the mismatch is invisible: nothing errors, the write simply lands
 * somewhere the read is not looking. Every id-taking builder stringifies, so the hazard cannot be
 * reintroduced by a caller that happens to hold a number.
 */

/** A key prefix — anything TanStack will match on. */
export type Key = readonly unknown[];

const id = (value: string | number): string => String(value);

export const qk = {
  workbench: {
    /** Everything the Workbench caches. The invalidation target for "stock moved". */
    all: ['workbench'] as const,
    /**
     * The product grid. The remaining parts are the query's own axes (endpoint, filters, sort, page
     * size) — passed through verbatim, because the grid owns what distinguishes one result set from
     * another and this factory should not have an opinion about it.
     */
    grid: (...axes: readonly unknown[]): Key => ['workbench', 'grid', ...axes],
  },

  dispatch: {
    all: ['dispatch'] as const,
    /** The order queue. A sibling of `order`, never its ancestor — see rule 1. */
    queue: (filterKey?: unknown): Key =>
      filterKey === undefined ? ['dispatch', 'queue'] : ['dispatch', 'queue', filterKey],
    /** Everything cached about one order: detail, corrections, events, annotations. */
    order: (hexId: string): Key => ['dispatch', 'order', hexId],
    orderDetail: (hexId: string): Key => ['dispatch', 'order', hexId, 'detail'],
    orderCorrections: (hexId: string): Key => ['dispatch', 'order', hexId, 'corrections'],
    orderEvents: (hexId: string): Key => ['dispatch', 'order', hexId, 'events'],
    orderAnnotations: (hexId: string): Key => ['dispatch', 'order', hexId, 'annotations'],
    tags: (): Key => ['dispatch', 'tags'],
    archivedTags: (): Key => ['dispatch', 'tags', 'archived'],
    filterOptions: (kind: string): Key => ['dispatch', 'filter-options', kind],
    /**
     * Filter-facet counts for one dimension under one filter state. Keyed by both, because the
     * counts *are* a function of both — a cache hit across different filters would answer the
     * operator's question with another question's numbers.
     */
    facets: (dimension: string, filterKey?: string): Key =>
      filterKey === undefined
        ? ['dispatch', 'facets', dimension]
        : ['dispatch', 'facets', dimension, filterKey],
  },

  procurement: {
    all: ['procurement'] as const,
    purchaseOrders: (...axes: readonly unknown[]): Key => [
      'procurement',
      'purchase-orders',
      ...axes,
    ],
    purchaseOrder: (poId: string | number): Key => ['procurement', 'purchase-order', id(poId)],
    suppliers: (): Key => ['procurement', 'suppliers'],
    supplier: (supplierId: string | number): Key => ['procurement', 'suppliers', id(supplierId)],
  },

  /**
   * Saved filters, keyed by the surface that owns them.
   *
   * A top-level axis rather than a branch of each surface, because saved filters are one mechanism
   * with one endpoint and the surface is a parameter of it — nesting them under `dispatch` and
   * `workbench` would mean an invalidation written for "the queue moved" also dropped the queue's
   * saved views, which no stock or order change can affect.
   */
  savedFilters: {
    all: ['saved-filters'] as const,
    forSurface: (surface: string): Key => ['saved-filters', surface],
  },
} as const;

/**
 * Every cache that shows a stock figure.
 *
 * A mutation that **moves stock** invalidates all of these, whichever surface it fired from — a
 * goods receipt in Procurement, a shipment in Dispatch, a correction in the Workbench. The three
 * surfaces sit in one client that never unmounts, so without this a merchant can receive a delivery
 * in one tab and read yesterday's on-hand in another.
 *
 * Focus-refetch is a backstop for this, not a substitute: it reloads the whole products query only
 * when the merchant happens to alt-tab, and the Workbench's delta poller — which was meant to carry
 * stock on its own — is currently disabled.
 *
 * **Only caches that actually display a stock figure**, which is why this is the dispatch *queue*
 * and not `qk.dispatch.all`. The broad prefix would take out every open order's detail too — and a
 * shipment's own `onSuccess` has just written that detail authoritatively from the server's
 * response, so invalidating it would refetch what it was handed. That is the same write-then-refetch
 * waste rule 1 exists to remove; a group that re-creates it inside itself is worse than no group.
 */
export const STOCK_MOVED: readonly Key[] = [qk.workbench.all, qk.dispatch.queue()];

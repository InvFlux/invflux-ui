import { type Accessor, createMemo } from 'solid-js';
import { useDispatch } from './context';
import { useListStore } from './listStore';
import { useDispatchOrdersQuery } from './queries';
import { localQueue, parseQueueFilters, queueParamsOf } from './queueFilters';
import { useReplicatedQueueIfAny } from './useWorkingSet';
import { needsServerMode } from './workingSet';

/** The queue's order sequence as the order page needs it for its previous and next buttons. */
export interface QueueSequence {
  /** Order ids in the queue's order; empty until there is something to read them from. */
  ids: Accessor<readonly string[]>;
  /**
   * How many orders the view holds: the length of {@link ids}, or more when the view is read from
   * the server and only its first pages are on hand.
   */
  total: Accessor<number>;
  /** The sequence is still arriving: the open orders are downloading, or the first page is. */
  loading: Accessor<boolean>;
}

/**
 * The queue's order sequence, for a page that is not the queue.
 *
 * While the queue has been shown since the page loaded, it publishes the sequence it displays, and
 * that is the answer. When it has not — an order opened by a link, or a reload on an order — the
 * sequence is worked out here, from the same view the queue would show: the one the tab last had
 * (`ListStore.queueSearch`, kept across reloads), or the default view in a fresh tab. The rows come
 * from where the queue would take them: the replicated open orders, which the surface downloads
 * whichever page it opens on, or the server's first page for a view the open set cannot answer.
 * The filters and the order are the queue's own functions, so the two cannot disagree.
 *
 * A view read from the server stops at its first page (500 orders): the queue scrolls on for more,
 * an order page has no list to scroll.
 */
export function useQueueSequence(enabled: Accessor<boolean>): QueueSequence {
  const ctx = useDispatch();
  const listStore = useListStore();
  // Absent where no queue exists — an order opened in a tab of its own, which is never enabled.
  const workingSet = useReplicatedQueueIfAny();

  // The queue published a sequence: nothing to work out.
  const published = (): boolean => listStore.ids().length > 0;
  const deriving = (): boolean => enabled() && !published();

  const params = createMemo(() => queueParamsOf(listStore.queueSearch()));
  const filters = createMemo(() => parseQueueFilters(params(), ctx));
  const serverMode = createMemo(() => needsServerMode(params()));
  const query = useDispatchOrdersQuery(filters, () => deriving() && serverMode());

  const derived = createMemo<readonly string[]>(() => {
    if (!deriving()) return [];
    const orders = serverMode()
      ? (query.data?.pages[0]?.orders ?? [])
      : workingSet === undefined
        ? []
        : localQueue(workingSet.orders().values(), filters(), ctx.paymentMethods.manualIds ?? []);

    return orders.map((o) => o.id);
  });

  return {
    ids: () => (published() ? listStore.ids() : derived()),
    total: () => {
      if (published()) return listStore.total();
      const held = derived().length;

      return serverMode() ? Math.max(held, query.data?.pages[0]?.total ?? 0) : held;
    },
    // A failed download is not "still loading": the indicator goes, and the buttons stay disabled.
    loading: () =>
      deriving() &&
      (serverMode()
        ? query.isLoading
        : workingSet !== undefined && !workingSet.complete() && null === workingSet.error()),
  };
}

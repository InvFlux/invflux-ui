import { createContext, createSignal, useContext } from 'solid-js';
import type { Accessor, Setter } from 'solid-js';

/**
 * Cross-route store of the current dispatch queue's order-id sequence.
 *
 * OrderList writes the ids in display order whenever its rows change; OrderDetail reads them for
 * its previous and next buttons. When the queue has not been shown since the page loaded (a
 * deep link, or a reload on an order), the ids are empty and the order page works the sequence out
 * itself, from the queue's view as {@link ListStore.queueSearch} remembers it (`useQueueSequence`).
 */
export interface ListStore {
  ids: Accessor<string[]>;
  setIds: Setter<string[]>;
  /**
   * How many orders the queue's view holds — more than {@link ids} when the view is read from the
   * server a page at a time and only the first pages are loaded. The order page's position readout
   * counts against it, so "12/950" stays true while 500 of the 950 are on hand.
   */
  total: Accessor<number>;
  setTotal: Setter<number>;
  /**
   * The queue's current URL search string (including a leading `?` when present, or `''` when the
   * queue is bare). OrderList writes it as the view changes, so the order page's "← Queue" link
   * returns to the same view and its previous and next buttons step through it.
   *
   * Kept in the tab's session storage, so the view survives a reload — on the queue or on an
   * order. Per tab, not per browser: two tabs on two views do not overwrite each other, and a new
   * tab, or an order link someone sent, starts from the queue's default view.
   */
  queueSearch: Accessor<string>;
  setQueueSearch: Setter<string>;
  /**
   * The order the queue should focus when it next renders, or `''` for none.
   *
   * Set when leaving a detail page for the queue, so the round trip is lossless: the operator lands
   * on the row they were reading, already selected, and `Enter` takes them straight back into it.
   * Without it, Escape would return them to a list with nothing selected — the same filters, but
   * their place in it gone, which is most of what "where was I" means on a queue of 400.
   *
   * Consumed once and cleared: it describes a navigation, not a preference.
   */
  focusId: Accessor<string>;
  setFocusId: Setter<string>;
}

export const ListStoreCtx = createContext<ListStore | undefined>(undefined);

export function useListStore(): ListStore {
  const ctx = useContext(ListStoreCtx);
  if (!ctx) throw new Error('ListStoreCtx not provided');
  return ctx;
}

/** Where {@link ListStore.queueSearch} is kept for the tab. */
const QUEUE_SEARCH_KEY = 'invflux:dispatch:queue-search';

function readQueueSearch(): string {
  try {
    return sessionStorage.getItem(QUEUE_SEARCH_KEY) ?? '';
  } catch {
    // Storage the browser refuses (a sandboxed frame, blocked site data): the default view.
    return '';
  }
}

function writeQueueSearch(search: string): void {
  try {
    if ('' === search) sessionStorage.removeItem(QUEUE_SEARCH_KEY);
    else sessionStorage.setItem(QUEUE_SEARCH_KEY, search);
  } catch {
    // Nothing to do: the view is still remembered until the page reloads.
  }
}

export function createListStore(): ListStore {
  const [ids, setIds] = createSignal<string[]>([]);
  const [total, setTotal] = createSignal<number>(0);
  const [queueSearch, setQueueSearchSignal] = createSignal<string>(readQueueSearch());
  const setQueueSearch = ((value: string | ((prev: string) => string)) => {
    const next = setQueueSearchSignal(value as Parameters<typeof setQueueSearchSignal>[0]);
    writeQueueSearch(next);

    return next;
  }) as Setter<string>;
  const [focusId, setFocusId] = createSignal<string>('');

  return {
    ids,
    setIds,
    total,
    setTotal,
    queueSearch,
    setQueueSearch,
    focusId,
    setFocusId,
  };
}

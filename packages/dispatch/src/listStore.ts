import { createContext, createSignal, useContext } from 'solid-js';
import type { Accessor, Setter } from 'solid-js';

/**
 * Cross-route store of the current dispatch queue's order-id sequence.
 *
 * OrderList writes the ids in display order on every successful fetch;
 * OrderDetail reads them to compute prev/next navigation (per §6.3 of the
 * dispatch plan). When the operator deep-links to a detail page directly
 * (no list visit in this session), the ids signal is empty and the prev/
 * next buttons render disabled — that's the trade-off for cross-route
 * navigation without coupling the detail route to a query refetch.
 */
export interface ListStore {
  ids: Accessor<string[]>;
  setIds: Setter<string[]>;
  /**
   * The queue's current URL search string (including a leading `?`
   * when present, or `''` when the queue is bare). OrderList writes
   * this on every render so OrderDetail's "← Queue" link can
   * restore the filter / search state without forcing the operator
   * to redo their work. Cleared when the operator deep-links into a
   * detail page (the back link then sends them to a bare queue).
   */
  queueSearch: Accessor<string>;
  setQueueSearch: Setter<string>;
  /** Return the order id before `currentId` in the cached sequence, or null. */
  getPrevId(currentId: string): string | null;
  /** Return the order id after `currentId` in the cached sequence, or null. */
  getNextId(currentId: string): string | null;
}

export const ListStoreCtx = createContext<ListStore | undefined>(undefined);

export function useListStore(): ListStore {
  const ctx = useContext(ListStoreCtx);
  if (!ctx) throw new Error('ListStoreCtx not provided');
  return ctx;
}

export function createListStore(): ListStore {
  const [ids, setIds] = createSignal<string[]>([]);
  const [queueSearch, setQueueSearch] = createSignal<string>('');

  function indexOf(currentId: string): number {
    return ids().indexOf(currentId);
  }

  return {
    ids,
    setIds,
    queueSearch,
    setQueueSearch,
    getPrevId(currentId) {
      const i = indexOf(currentId);
      return i > 0 ? ids()[i - 1] : null;
    },
    getNextId(currentId) {
      const i = indexOf(currentId);
      const list = ids();
      return i >= 0 && i < list.length - 1 ? list[i + 1] : null;
    },
  };
}

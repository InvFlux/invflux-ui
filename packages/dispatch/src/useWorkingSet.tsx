import {
  createContext,
  createEffect,
  createSignal,
  on,
  onCleanup,
  untrack,
  useContext,
  type Accessor,
  type ParentProps,
} from 'solid-js';
import { useQueryClient } from '@tanstack/solid-query';
import { usePaneActive } from '@invflux/ui/pane';
import { fetchDispatchOrders } from './api';
import { useDispatch } from './context';
import type { DispatchOrderSummary } from './types';
import { mergeDelta, rewindCursor } from './workingSet';

/**
 * Replicate the dispatch working set and keep it current.
 *
 * Owns three things the pure core deliberately does not: the initial load, the poll, and the
 * request hygiene around both. See `workingSet.ts` for the rules it applies.
 *
 * **Page one first.** The first page renders immediately and the rest of the set completes behind
 * it, so a store with thousands of open orders shows work in the same moment a paged queue would
 * have. Nothing waits for `complete()`; it exists so the surface can say whether a count is final.
 */

/** How often to ask what changed. Cheap: the answer is almost always an empty list. */
const POLL_INTERVAL_MS = 30_000;

/** Rows per request while completing the set. Large enough to finish fast, small enough to stream. */
const REPLICATION_PAGE_SIZE = 500;

/** After a failed poll, wait this many multiples of the interval before trying again. */
const MAX_BACKOFF_STEPS = 8;

export interface WorkingSet {
  /** Every un-closed order this client holds, keyed by id. */
  orders: Accessor<ReadonlyMap<string, DispatchOrderSummary>>;
  /** Whether the initial replication has finished. Counts are provisional until it has. */
  complete: Accessor<boolean>;
  /** Server-reported size of the working set — what `complete()` is counting toward. */
  total: Accessor<number>;
  /** A replication or poll request is in flight. */
  busy: Accessor<boolean>;
  /** The last error, if the set could not be built or refreshed. */
  error: Accessor<Error | null>;
  /** Re-read the whole set from scratch — the refresh control's escape hatch. */
  reload: () => void;
  /**
   * Ask what changed *now*, instead of waiting out the interval.
   *
   * A delta, never a rebuild: the set is already held, so catching up costs one request that is
   * usually empty. For the moment a view is re-entered — the operator has been reading an order for
   * a minute and the queue behind it may have moved — where re-replicating would throw away a
   * correct set to fetch the same rows again.
   */
  pollNow: () => void;
  /**
   * Apply a known change to rows the set already holds, without waiting for the server to confirm
   * what we just watched it do.
   *
   * A mutation's own `invalidateQueries` reaches the paged query, not this set, so before this
   * existed a tag added from the queue simply did not appear until the poll interval came round —
   * reported from the floor as the click having done nothing.
   *
   * **Not speculative.** Callers apply this from a mutation's `onSuccess`, so the server has
   * already accepted the change; what the response does not carry is the resulting row (the bulk
   * tag route answers with counts). Rows this set does not hold are skipped, and `pollNow()` is
   * still the authority — it reconciles anything derived that the caller could not know, workflow
   * state above all, since a suppressing tag has to remove the order from the view entirely.
   */
  patch: (
    ids: readonly string[],
    fn: (order: DispatchOrderSummary) => DispatchOrderSummary,
  ) => void;
  /**
   * Register a view that shows the set, for as long as it is mounted; returns the release.
   *
   * The poll runs only while one is registered and its pane is on screen. An open order does not
   * show the queue, so polling behind it spends a request nobody reads. The first view registered
   * after none were asks what changed at once — the one delta that re-entering the queue needs.
   */
  watch: () => () => void;
}

export function useWorkingSet(enabled: Accessor<boolean>): WorkingSet {
  const ctx = useDispatch();
  const queryClient = useQueryClient();

  /**
   * Treat an invalidation of the queue's query key as "the queue changed", in this mode too.
   *
   * Eleven mutations already call `invalidateQueries({ queryKey: qk.dispatch.queue() })` and every
   * one of them means exactly that — but the key drives the *paged* query, which nothing reads
   * while the set is replicated here. So the intent was landing in server mode and silently
   * missing in this one: a tag added from the queue did not appear until the interval came round.
   *
   * Subscribing once is what keeps that from being eleven edits and a twelfth someone forgets. A
   * delta, never a rebuild — usually an empty request.
   */
  createEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'invalidate') return;
      const key = event.query.queryKey;
      if (Array.isArray(key) && key[0] === 'dispatch' && key[1] === 'queue') runNow?.();
    });
    onCleanup(unsubscribe);
  });

  const [orders, setOrders] = createSignal<ReadonlyMap<string, DispatchOrderSummary>>(new Map());
  const [complete, setComplete] = createSignal(false);
  const [total, setTotal] = createSignal(0);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);
  const [generation, setGeneration] = createSignal(0);
  const [watchers, setWatchers] = createSignal(0);
  const paneActive = usePaneActive();
  /** Someone is looking at the set: a view showing it is mounted, in the pane that is on screen. */
  const watching = (): boolean => watchers() > 0 && paneActive();

  let cursor: string | null = null;
  /**
   * The live effect's "poll now" entry point. Held in a mutable ref rather than exposed directly:
   * the effect is re-created by `reload()`, and a caller holding a stale closure would drive a
   * generation that has already been invalidated.
   */
  let runNow: (() => void) | null = null;
  /**
   * Guards every response against the state it was requested in. A reload, or a switch away from
   * the working set, must not be overwritten by a page that was already in the air — the classic
   * shape of a list that briefly shows what it showed two filters ago.
   */
  let live = 0;

  const isCurrent = (mine: number): boolean => mine === live;

  /**
   * Read the working set, page one first.
   *
   * `workflow_state` is sent as the explicit no-filter token: the queue's `Active` default is a
   * *view* default, and a client replicating the set has to hold held orders too — they are work
   * someone is chasing.
   */
  async function replicate(mine: number, signal: AbortSignal): Promise<void> {
    setBusy(true);
    try {
      const first = await fetchDispatchOrders(
        ctx,
        { scope: 'working', workflowState: [], page: 1, perPage: REPLICATION_PAGE_SIZE },
        signal,
      );
      if (!isCurrent(mine)) return;

      let held = mergeDelta(new Map(), first.orders).orders;
      setOrders(held);
      setTotal(first.total);
      // The cursor is taken from the *first* page, before the later ones are read: anything written
      // while the set is still completing then arrives in the first poll. Taking it at the end
      // would leave a window whose writes nothing ever asks for.
      cursor = rewindCursor(first.serverTime);

      for (let page = 2; (page - 1) * REPLICATION_PAGE_SIZE < first.total; page += 1) {
        const next = await fetchDispatchOrders(
          ctx,
          { scope: 'working', workflowState: [], page, perPage: REPLICATION_PAGE_SIZE },
          signal,
        );
        if (!isCurrent(mine)) return;
        held = mergeDelta(held, next.orders).orders;
        setOrders(held);
      }

      setComplete(true);
      setError(null);
    } catch (cause) {
      if (isCurrent(mine) && !signal.aborted) {
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      }
    } finally {
      if (isCurrent(mine)) setBusy(false);
    }
  }

  /**
   * Ask what changed, and merge it.
   *
   * **Filtered by time and nothing else** — that is what makes departures free: an order that
   * closed comes back and is dropped by the merge, where a filtered poll would simply omit it and
   * leave the row on screen forever.
   */
  async function poll(mine: number, signal: AbortSignal): Promise<void> {
    if (cursor === null) return;
    setBusy(true);
    try {
      const since = cursor;
      let page = 1;
      let held = orders();
      for (;;) {
        const delta = await fetchDispatchOrders(
          ctx,
          { updatedSince: since, page, perPage: REPLICATION_PAGE_SIZE, workflowState: [] },
          signal,
        );
        if (!isCurrent(mine)) return;
        held = mergeDelta(held, delta.orders).orders;
        // Advance from the response, not from the browser: the cursor is the database's clock.
        cursor = rewindCursor(delta.serverTime);
        if (page * REPLICATION_PAGE_SIZE >= delta.total) break;
        page += 1;
      }
      setOrders(held);
      setError(null);
    } catch (cause) {
      if (isCurrent(mine) && !signal.aborted) {
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      }
      throw cause;
    } finally {
      if (isCurrent(mine)) setBusy(false);
    }
  }

  createEffect(() => {
    // Re-reading `generation` is what makes `reload()` restart this effect.
    generation();
    if (!enabled()) return;

    const mine = ++live;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const schedule = (): void => {
      // Exponential-ish backoff on failure: a queue whose server is down should not spend the
      // operator's connection on the same failing request twice a minute.
      const wait = POLL_INTERVAL_MS * Math.min(2 ** failures, MAX_BACKOFF_STEPS);
      timer = setTimeout(() => {
        void run();
      }, wait);
    };

    const run = async (): Promise<void> => {
      if (!isCurrent(mine)) return;
      // Whoever asked, the pending tick is now redundant.
      clearTimeout(timer);
      // Nobody watching, nothing to fetch: a hidden browser tab, a pane behind another, or an order
      // open in the queue's place. A delta nobody reads is a request spent for nothing, and the next
      // watched tick catches up in one go, because the cursor has not moved.
      if (
        !untrack(watching) ||
        (typeof document !== 'undefined' && document.visibilityState === 'hidden')
      ) {
        schedule();

        return;
      }
      try {
        await poll(mine, controller.signal);
        failures = 0;
      } catch {
        failures = Math.min(failures + 1, 3);
      }
      if (isCurrent(mine)) schedule();
    };

    setComplete(false);
    void replicate(mine, controller.signal).then(() => {
      if (isCurrent(mine)) schedule();
    });

    // Only polls once the set exists: before that, the replication in flight is already the
    // freshest possible answer, and a delta against a null cursor is a no-op anyway.
    runNow = () => {
      if (isCurrent(mine) && cursor !== null) void run();
    };

    // A tab returning to the foreground has a stale set and an operator looking at it, so it polls
    // at once rather than waiting out the interval it spent hidden.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && isCurrent(mine)) {
        clearTimeout(timer);
        void run();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    onCleanup(() => {
      runNow = null;
      live += 1; // invalidate anything already in the air
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    });
  });

  // Coming back into view — the queue remounting, or its pane brought to the front — asks what
  // changed at once, instead of waiting out an interval that was spent not polling.
  createEffect(
    on(
      watching,
      (now, before) => {
        if (now && before === false) runNow?.();
      },
      { defer: true },
    ),
  );

  return {
    orders,
    complete,
    total,
    busy,
    error,
    reload: () => {
      cursor = null;
      setOrders(new Map());
      setGeneration((n) => n + 1);
    },
    pollNow: () => runNow?.(),
    patch: (ids, fn) => {
      setOrders((held) => {
        let next: Map<string, DispatchOrderSummary> | null = null;
        for (const id of ids) {
          const row = held.get(id);
          if (row === undefined) continue; // not replicated here — the poll will bring it
          next ??= new Map(held);
          next.set(id, fn(row));
        }

        // Same identity when nothing matched, so an unrelated patch cannot churn the memo that
        // filters and sorts the whole set.
        return next ?? held;
      });
    },
    watch: () => {
      setWatchers((n) => n + 1);
      let released = false;

      return () => {
        if (released) return;
        released = true;
        setWatchers((n) => n - 1);
      };
    },
  };
}

/**
 * The working set is owned **above the router**, not by the queue route.
 *
 * A replicated set that a route owns is destroyed the moment the operator opens an order, and
 * rebuilt when they come back — which is the one thing this model exists to avoid. The symptom is
 * precise and was reported from the floor: an order opens instantly (small payload), and returning
 * to the queue shows an empty table for the length of a full replication before the rows reappear.
 * Nothing was stale; the set had simply been thrown away and re-fetched.
 *
 * Held here, going back to the queue is a render and one delta, never a rebuild: the rows are
 * already in memory. The poll itself runs only while a view is watching (see `watch()`). `enabled` is not conditional for the same reason — a set
 * that stops replicating while the view happens to be in server mode has to be rebuilt on the way
 * back, and rebuilding is the cost being removed.
 */
const WorkingSetCtx = createContext<WorkingSet>();

export function WorkingSetProvider(props: ParentProps) {
  const workingSet = useWorkingSet(() => true);

  return <WorkingSetCtx.Provider value={workingSet}>{props.children}</WorkingSetCtx.Provider>;
}

/** The replicated set, from whichever ancestor owns it. */
export function useReplicatedQueue(): WorkingSet {
  const set = useContext(WorkingSetCtx);
  if (set === undefined) throw new Error('WorkingSetProvider is not in scope');

  return set;
}

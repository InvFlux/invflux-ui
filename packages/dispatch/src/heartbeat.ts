import { qk } from '@invflux/ui/api';
import { createEffect, on, onCleanup } from 'solid-js';
import { useQueryClient } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { postHeartbeat } from './api';
import { usePaneActive } from '@invflux/ui/pane';
import { useDispatch } from './context';
import type { DispatchOrderDetail } from './types';

/**
 * Fire-and-forget viewer heartbeat for the current order. Pings the
 * `POST /orders/{id}/viewers/heartbeat` endpoint on mount and every
 * `intervalMs` thereafter, but only while `document.visibilityState ===
 * 'visible'` (per and the §2.4 design note —
 * background tabs must not flap presence between orders). On every
 * successful response, the live viewer list is patched into the cached
 * detail query so `ViewerBadge` reacts without waiting for the 60s
 * detail-refetch tick.
 *
 * Drops silently on transient errors — presence is best-effort UX, not
 * a correctness mechanism. The server's stale-window guarantees the UI
 * eventually converges.
 *
 * **It is also the order page's only poll.** Each response carries a revision of
 * what the page shows — the order, its corrections, its products' stock concerns —
 * and a revision that moved invalidates the detail and corrections queries, which
 * otherwise sit still. One request a beat instead of three, and a change made by
 * someone else shows within one beat rather than whenever a timer next came round.
 * The first beat only records: the page fetched its data on mount, moments ago.
 *
 * **Keyed on the order id and nothing else.** A beat reads the pane's activity
 * before its first await, so an effect that sent it directly would also re-run —
 * and beat again — whenever that read's source notified, answer unchanged: going
 * to the next order moved both the id and the shell's active tab, and sent two
 * heartbeats for one order.
 */
export function useHeartbeat(hexId: Accessor<string>, intervalMs = 60_000): void {
  const ctx = useDispatch();
  const queryClient = useQueryClient();
  const paneActive = usePaneActive();
  /** Sends one beat for the current order now; null while there is none. */
  let beatNow: (() => void) | null = null;

  createEffect(
    on(hexId, (id) => {
      if (id === '') return;

      let cancelled = false;
      let timer: ReturnType<typeof setInterval> | null = null;
      /** The revision the page last saw; `undefined` until the first beat. */
      let seenRevision: string | null | undefined;

      const tick = async () => {
        if (cancelled) return;
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
        // Mounted is not watched. A kept-alive order behind another tab would otherwise keep
        // announcing a viewer, and the rest of the staff would see someone working an order nobody
        // is looking at — presence would be stating something false rather than merely stale.
        if (!paneActive()) return;
        try {
          const response = await postHeartbeat(ctx, id);
          if (cancelled) return;
          queryClient.setQueryData<DispatchOrderDetail>(qk.dispatch.orderDetail(id), (prev) =>
            prev ? { ...prev, viewers: response.viewers } : prev,
          );
          const revision = response.revision ?? null;
          if (seenRevision !== undefined && revision !== seenRevision) {
            void queryClient.invalidateQueries({ queryKey: qk.dispatch.orderDetail(id) });
            void queryClient.invalidateQueries({ queryKey: qk.dispatch.orderCorrections(id) });
          }
          seenRevision = revision;
        } catch {
          // Best-effort. Next tick will retry; the server prunes stale rows
          // independently so missed heartbeats self-heal within the stale
          // window (5 min).
        }
      };

      // Fire one immediately so the viewer badge updates without waiting
      // a full interval, then schedule the steady-state cadence.
      beatNow = () => void tick();
      void tick();
      timer = setInterval(() => void tick(), intervalMs);

      onCleanup(() => {
        cancelled = true;
        beatNow = null;
        if (timer !== null) clearInterval(timer);
      });
    }),
  );

  // Brought back to the front: announce presence at once rather than up to a beat later. Decided on
  // the value, not the notification — the same answer recomputed is not a return.
  createEffect(
    on(
      paneActive,
      (active, was) => {
        if (active && was === false) beatNow?.();
      },
      { defer: true },
    ),
  );
}

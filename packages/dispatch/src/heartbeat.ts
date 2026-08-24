import { qk } from '@invflux/ui/api';
import { createEffect, onCleanup } from 'solid-js';
import { useQueryClient } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { postHeartbeat } from './api';
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
 */
export function useHeartbeat(hexId: Accessor<string>, intervalMs = 60_000): void {
  const ctx = useDispatch();
  const queryClient = useQueryClient();

  createEffect(() => {
    const id = hexId();
    if (id === '') return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      try {
        const response = await postHeartbeat(ctx, id);
        if (cancelled) return;
        queryClient.setQueryData<DispatchOrderDetail>(
          qk.dispatch.orderDetail(id),
          (prev) => (prev ? { ...prev, viewers: response.viewers } : prev),
        );
      } catch {
        // Best-effort. Next tick will retry; the server prunes stale rows
        // independently so missed heartbeats self-heal within the stale
        // window (5 min).
      }
    };

    // Fire one immediately so the viewer badge updates without waiting
    // a full interval, then schedule the steady-state cadence.
    void tick();
    timer = setInterval(() => void tick(), intervalMs);

    onCleanup(() => {
      cancelled = true;
      if (timer !== null) clearInterval(timer);
    });
  });
}

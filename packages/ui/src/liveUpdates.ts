/**
 * Live-updates transport abstraction — the seam that lets `InventoryGrid` receive row deltas from
 * the server without knowing (or caring) *how* they arrive. The current implementation ships a
 * default polling transport; a future WebSocket or SSE transport becomes a one-line swap at the
 * mount site with zero changes inside the grid.
 *
 * ## Contract
 *
 * A transport is a factory that takes a runtime config and returns a cleanup / unsubscribe
 * function. The factory is called once inside a `createEffect` / `onCleanup` chain in the grid;
 * the cleanup fires on unmount or config invalidation.
 *
 * ```
 * type LiveUpdatesTransport = (config) => cleanup;
 * ```
 *
 * The transport receives the subscription token as an accessor (not a snapshot) so it can react
 * to token rotation without the grid having to re-instantiate it. Same for `enabled` — flipping
 * the transport on/off is a signal write, not a factory rebuild.
 *
 * ## Watched-set model
 *
 * The transport does **not** ship a watched-set of IDs on every poll — that would put thousands
 * of numbers in a GET URL which HTTP servers cap at ~8KB. Instead the server maintains the
 * tracked-set stateful-side, keyed by an opaque subscription token that the client mints once and
 * threads through every fetch + update request. The fetch endpoint (out of scope for this file)
 * adds returned subjects to the tracked-set as a side-effect of every fetch; the transport just
 * asks "give me the diffs since cursor X for subscription Y."
 *
 * ## Polling cadence
 *
 * The default polling transport reads its interval from the caller (typically a plugin-level
 * setting surfaced through the UI bootstrap context) — not a hardcoded 30 seconds. Admins tune
 * cadence once; every surface using the default transport picks it up. Custom transports
 * (WebSocket / SSE) don't have a cadence concept so this doesn't apply.
 */

import { onCleanup } from 'solid-js';
import type { RowPatch } from './workbenchGridTypes';

/**
 * Config the grid hands to the transport factory. Signals (not snapshots) so the transport can
 * react to changes without rebuild.
 */
export interface LiveUpdatesTransportConfig {
  apiRoot: string;
  nonce: string;
  /** Opaque token minted by the fetch layer; server tracks the watched-set against it. */
  subscriptionId: () => string;
  /** True to run the transport (poll / connect / listen), false to pause. */
  enabled: () => boolean;
  /** Where to deliver received patches. Called with `[]` is legal (heartbeat / no-op tick). */
  onUpdate: (patches: RowPatch[]) => void;
  /** Where to report a transport-level error (network failure, WS drop, …). Non-fatal. */
  onError?: (error: unknown) => void;
}

/**
 * A transport factory. Called once by the grid inside a reactive scope; the returned function is
 * invoked on cleanup (unmount / config invalidation) to release the transport's resources.
 */
export type LiveUpdatesTransport = (config: LiveUpdatesTransportConfig) => () => void;

/**
 * Response shape from the default polling endpoint. Only the transport cares about this — the
 * grid consumes `RowPatch[]` directly. Kept exported so custom callers can reuse the shape when
 * writing their own transports against the same endpoint.
 */
export interface LiveUpdatesPollResponse {
  patches: RowPatch[];
  /** Server-monotonic cursor to send back on the next poll (delta boundary). */
  cursor: string;
}

/**
 * Configuration for the built-in polling transport factory.
 */
export interface PollingTransportConfig {
  /** Polling interval in milliseconds — usually threaded from a plugin-level setting. */
  intervalMs: number;
  /**
   * Relative URL to the poll endpoint, appended to `apiRoot`. Defaults to the workbench's
   * historical `/invflux/v1/workbench/stock-updates` — a future refactor may rename to something
   * generic (`/inventory/updates`) once the audit-driven non-stock updates land.
   */
  endpoint?: string;
  /**
   * Initial cursor to send on the first poll. Empty string (default) means "give me everything
   * since the subscription was created."
   */
  initialCursor?: string;
}

/**
 * Build a polling transport at a given cadence. The returned transport factory is the value you'd
 * pass to `InventoryGrid` via `liveUpdates.transport`. Cadence is a caller-supplied number rather
 * than being read here to keep the module WP-context-agnostic — a settings-aware default lives at
 * the mount site (typically the bootstrap that reads `invflux.grid.pollIntervalMs`).
 *
 * The transport advances its `cursor` on each successful response so the server can emit the
 * next window's diffs. On error (network or non-2xx), the transport backs off one full interval
 * and retries; the cursor stays at its last-good value so nothing is silently missed.
 */
export function pollingTransport(cfg: PollingTransportConfig): LiveUpdatesTransport {
  const intervalMs = Math.max(1_000, cfg.intervalMs);
  const endpoint = cfg.endpoint ?? '/invflux/v1/workbench/stock-updates';

  return (runtime) => {
    let cursor = cfg.initialCursor ?? '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const schedule = (delayMs: number): void => {
      if (stopped) return;
      timer = setTimeout(() => {
        timer = null;
        void tick();
      }, delayMs);
    };

    const tick = async (): Promise<void> => {
      if (stopped) return;
      if (!runtime.enabled()) {
        schedule(intervalMs);
        return;
      }
      const url = new URL(`${runtime.apiRoot.replace(/\/$/, '')}${endpoint}`);
      url.searchParams.set('subscription', runtime.subscriptionId());
      if (cursor !== '') url.searchParams.set('cursor', cursor);

      try {
        const res = await fetch(url, {
          headers: { Accept: 'application/json', 'X-WP-Nonce': runtime.nonce },
          credentials: 'same-origin',
        });
        if (!res.ok) throw new Error(`live-updates poll failed (${res.status})`);
        const body = (await res.json()) as LiveUpdatesPollResponse;
        cursor = body.cursor ?? cursor;
        runtime.onUpdate(body.patches ?? []);
      } catch (err) {
        runtime.onError?.(err);
      } finally {
        schedule(intervalMs);
      }
    };

    // Fire the first tick on next microtask so the caller can finish setup before the network
    // round-trip runs. Small delay is a courtesy; the interval itself governs the steady state.
    schedule(0);

    return () => {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
  };
}

/**
 * Convenience: build a polling transport AND wire its cleanup into the current Solid owner.
 * Prefer this over calling {@link pollingTransport} + manual cleanup when composing inside a
 * component setup — it's a one-liner and safer.
 *
 * ```
 * useLiveUpdates({
 *   apiRoot, nonce,
 *   subscriptionId: () => currentSubscription(),
 *   enabled: () => stockColumnsVisible(),
 *   intervalMs: 30_000,
 *   onUpdate: (patches) => applyPatches(patches),
 * });
 * ```
 */
export function useLiveUpdates(
  opts: LiveUpdatesTransportConfig & { intervalMs: number; endpoint?: string },
): void {
  const transport = pollingTransport({ intervalMs: opts.intervalMs, endpoint: opts.endpoint });
  const cleanup = transport({
    apiRoot: opts.apiRoot,
    nonce: opts.nonce,
    subscriptionId: opts.subscriptionId,
    enabled: opts.enabled,
    onUpdate: opts.onUpdate,
    onError: opts.onError,
  });
  onCleanup(cleanup);
}

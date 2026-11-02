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
 * (WebSocket / SSE) don't have a cadence concept so this doesn't apply. It does not poll while the
 * page is hidden: nobody is looking, and a background tab would otherwise poll all day.
 *
 * ## Cursor
 *
 * The rows were loaded at a point in the stock ledger — the snapshot cursor the products response
 * carries. The transport asks for what changed after it, and moves its own cursor forward with each
 * answer. When the rows are loaded again (a new query, a refresh) the snapshot moves, and the
 * transport starts over from the new one; an answer to a poll that a reload overtook is dropped,
 * since it describes rows the grid no longer holds. With no snapshot yet it waits: an empty cursor
 * would ask for the watched rows' whole history.
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
  /** The ledger cursor the rows were loaded at; `''` until they are, and the transport waits. */
  cursor: () => string;
  /** True to run the transport (poll / connect / listen), false to pause. */
  enabled: () => boolean;
  /**
   * Where to deliver received patches. Called with `[]` is legal (heartbeat / no-op tick). A patch
   * with no fields names a row that changed in a way the transport cannot describe; re-read it.
   */
  onUpdate: (patches: RowPatch[]) => void;
  /**
   * The server no longer knows the subscription (reaped after a long pause, or never minted). The
   * remedy is the grid's: load the rows again, which mints it anew under the same token.
   */
  onGone?: () => void;
  /** Where to report a transport-level error (network failure, WS drop, …). Non-fatal. */
  onError?: (error: unknown) => void;
}

/**
 * A transport factory. Called once by the grid inside a reactive scope; the returned function is
 * invoked on cleanup (unmount / config invalidation) to release the transport's resources.
 */
export type LiveUpdatesTransport = (config: LiveUpdatesTransportConfig) => () => void;

/**
 * Response shape of the default polling endpoint. Only the transport reads it — the grid consumes
 * `RowPatch[]` directly. Exported so a custom transport against the same endpoint can reuse it.
 */
export interface LiveUpdatesPollResponse {
  /** Server-monotonic cursor to send back on the next poll (delta boundary). */
  cursor: string;
  /** The current stock totals of every watched subject that moved since the cursor. */
  updates: Array<{ subjectId: number; atp: number; res: number; ctd: number; total: number }>;
  /** Subjects to re-read rather than patch; reserved by the server, not emitted yet. */
  resync?: number[];
}

/** The poll endpoint answered something other than success. */
export class LiveUpdatesHttpError extends Error {
  constructor(public readonly status: number) {
    super(`live-updates poll failed (${status})`);
  }
}

/**
 * Configuration for the built-in polling transport factory.
 */
export interface PollingTransportConfig {
  /** Polling interval in milliseconds — usually threaded from a plugin-level setting. */
  intervalMs: number;
  /** The poll path for a subscription, appended to `apiRoot`. Defaults to the workbench's. */
  endpoint?: (subscriptionId: string) => string;
}

const workbenchUpdatesPath = (subscriptionId: string): string =>
  `/invflux/v1/workbench/subscriptions/${encodeURIComponent(subscriptionId)}/updates`;

/** The stock columns a poll answer fills, keyed by column id. */
function toPatches(body: LiveUpdatesPollResponse): RowPatch[] {
  const patches: RowPatch[] = (body.updates ?? []).map((u) => ({
    subject_id: u.subjectId,
    fields: { atp: u.atp, res: u.res, ctd: u.ctd, total: u.total },
    cursor: body.cursor,
  }));
  for (const subjectId of body.resync ?? []) patches.push({ subject_id: subjectId, fields: {} });
  return patches;
}

const pageHidden = (): boolean =>
  typeof document !== 'undefined' && document.visibilityState === 'hidden';

/**
 * Build a polling transport at a given cadence. The returned transport factory is the value you'd
 * pass to `InventoryGrid` via `liveUpdates.transport`. Cadence is a caller-supplied number rather
 * than being read here to keep the module WP-context-agnostic — a settings-aware default lives at
 * the mount site.
 *
 * On error (network or non-2xx) the transport waits one full interval and retries from the same
 * cursor, so nothing is silently missed. A 410 is reported through `onGone`, not `onError`.
 */
export function pollingTransport(cfg: PollingTransportConfig): LiveUpdatesTransport {
  const intervalMs = Math.max(1_000, cfg.intervalMs);
  const endpoint = cfg.endpoint ?? workbenchUpdatesPath;

  return (runtime) => {
    let snapshot = '';
    let cursor = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let stopped = false;

    const schedule = (delayMs: number): void => {
      if (stopped) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void tick();
      }, delayMs);
    };

    // Every path, a bail-out or a throw included, ends by scheduling the next tick: a loop that
    // stopped on one bad tick would go quiet with nothing to show for it.
    const tick = async (): Promise<void> => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const loadedAt = runtime.cursor();
        if (!runtime.enabled() || pageHidden() || loadedAt === '') return;
        if (loadedAt !== snapshot) {
          snapshot = loadedAt;
          cursor = loadedAt;
        }
        const url = new URL(
          `${runtime.apiRoot.replace(/\/$/, '')}${endpoint(runtime.subscriptionId())}`,
        );
        url.searchParams.set('cursor', cursor);

        const res = await fetch(url, {
          headers: { Accept: 'application/json', 'X-WP-Nonce': runtime.nonce },
          credentials: 'same-origin',
        });
        if (res.status === 410) {
          runtime.onGone?.();
          return;
        }
        if (!res.ok) throw new LiveUpdatesHttpError(res.status);
        const body = (await res.json()) as LiveUpdatesPollResponse;
        // The rows were loaded again while this poll was out: it describes rows the grid no longer
        // holds, so it neither patches nor moves the cursor.
        if (stopped || runtime.cursor() !== loadedAt) return;
        cursor = body.cursor ?? cursor;
        runtime.onUpdate(toPatches(body));
      } catch (err) {
        runtime.onError?.(err);
      } finally {
        inFlight = false;
        schedule(intervalMs);
      }
    };

    // Back in view after a while: catch up now rather than at the end of the interval.
    const onVisibility = (): void => {
      if (!pageHidden() && !inFlight) schedule(0);
    };
    if (typeof document !== 'undefined')
      document.addEventListener('visibilitychange', onVisibility);

    // Fire the first tick on next microtask so the caller can finish setup before the network
    // round-trip runs. Small delay is a courtesy; the interval itself governs the steady state.
    schedule(0);

    return () => {
      stopped = true;
      if (typeof document !== 'undefined')
        document.removeEventListener('visibilitychange', onVisibility);
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
 *   cursor: () => loadedAtCursor(),
 *   enabled: () => stockColumnsVisible(),
 *   intervalMs: 30_000,
 *   onUpdate: (patches) => applyPatches(patches),
 * });
 * ```
 */
export function useLiveUpdates(opts: LiveUpdatesTransportConfig & PollingTransportConfig): void {
  const { intervalMs, endpoint, ...runtime } = opts;
  onCleanup(pollingTransport({ intervalMs, endpoint })(runtime));
}

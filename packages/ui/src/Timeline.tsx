import { For, Show, type JSX } from 'solid-js';
import { createComponentRegistry, type ComponentRegistry } from './datatypes/registry';

/**
 * Shared event-timeline primitive (`@invflux/ui`) — reusable by
 * the dispatch OrderEvent panel today and the procurement
 * PO-event panel later, with the SAME registry handling the
 * per-type renderers from both surfaces. See
 * for the registry-with-parent-chain
 * pattern this reuses (a renderer for `refund.executed` can fall
 * back to one registered against `refund`, mirroring how
 * `decimal:money` falls back to `decimal` in the view registry).
 */

/** One event row as the timeline consumes it. */
export interface TimelineEvent {
  id: string;
  /** Event-type slug — `order.created`, `correction.created`, … */
  type: string;
  /** Tier (lifecycle | decision | execution | ancillary). */
  tier: string;
  /** ISO 8601 timestamp the event was emitted. May be null on stale rows. */
  occurredAt: string | null;
  actor: {
    /** `user` | `admin` | `system` | `plugin` | `supplier` | … */
    kind: string | null;
    /** Free-text reference: user id, plugin slug, system component name, … */
    ref: string | null;
  };
  surface: {
    /** `admin_page` | `api` | `cli` | `plugin` | `system` | `import` | `job` */
    kind: string | null;
    /** Per-surface key — `dispatch`, `checkout`, … */
    key: string | null;
  };
  /** Event-type-specific. Each registered renderer narrows its own shape. */
  payload: unknown;
  note: string | null;
  correlationId: string | null;
}

/** Props a registered row component receives. */
export interface TimelineRowProps {
  event: TimelineEvent;
}

export type TimelineRowComponent = (props: TimelineRowProps) => JSX.Element;

/**
 * The app-wide timeline-row registry. Built-in fallback registers
 * itself on first import below. Hosts (dispatch, procurement)
 * register their event-type-specific renderers on SPA bootstrap.
 */
export const timelineRowRegistry: ComponentRegistry<TimelineRowComponent> =
  createComponentRegistry<TimelineRowComponent>();

/**
 * Vertical event timeline. Newest-first by default — callers pre-
 * sort their events array. Renders one row per event, dispatching
 * each through `timelineRowRegistry.resolve(event.type)` with the
 * parent-chain fallback. Empty state shows a muted hint instead
 * of nothing so the operator knows the panel is alive.
 */
export function Timeline(props: { events: TimelineEvent[] }): JSX.Element {
  return (
    <Show
      when={props.events.length > 0}
      fallback={
        <div class="px-3 py-6 text-center text-xs text-text-muted">
          No events on this order yet.
        </div>
      }
    >
      <ol class="divide-y divide-gray-100">
        <For each={props.events}>
          {(event) => {
            const Row = timelineRowRegistry.resolve(event.type) ?? FallbackTimelineRow;
            return (
              <li class="px-3 py-2">
                <Row event={event} />
              </li>
            );
          }}
        </For>
      </ol>
    </Show>
  );
}

/**
 * Generic fallback row — used when nothing matches the event's
 * type in the registry. Renders the type slug, time, actor, and a
 * truncated JSON preview of the payload so the operator can still
 * see *something* useful.
 */
export function FallbackTimelineRow(props: TimelineRowProps): JSX.Element {
  return (
    <div class="flex items-start gap-2 text-xs">
      <span class="text-text-muted mt-0.5">●</span>
      <div class="min-w-0 flex-1">
        <div class="flex items-center justify-between gap-2 text-gray-700">
          <span class="font-mono text-2xs truncate">{props.event.type}</span>
          <span class="text-text-muted shrink-0 tabular-nums">
            {formatRelative(props.event.occurredAt)}
          </span>
        </div>
        <Show when={props.event.actor.kind || props.event.actor.ref}>
          <div class="text-gray-500 mt-0.5 truncate">
            {props.event.actor.kind ?? '—'}
            {props.event.actor.ref ? `:${props.event.actor.ref}` : ''}
          </div>
        </Show>
        <Show when={props.event.payload}>
          <pre class="mt-1 text-2xs text-gray-500 bg-gray-50 rounded p-1 overflow-x-auto whitespace-pre-wrap break-all">
            {previewJson(props.event.payload)}
          </pre>
        </Show>
      </div>
    </div>
  );
}

// Register the fallback row under its sentinel slug so callers
// without a matching registered renderer still get something
// useful out of `Timeline`.
timelineRowRegistry.register(
  'core.timeline.fallback',
  'core.timeline.fallback',
  FallbackTimelineRow,
  { default: true },
);

/** Compact relative-time formatter — "5m ago", "3d ago", …. */
export function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '—';
  const delta = Date.now() - ts;
  if (delta < 0) return 'in future';
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

/**
 * Absolute wall-clock formatter in the **browser's local timezone**. Pair it
 * with {@link formatRelative} so a row reads "1m ago · 27 May 2026, 14:32".
 * Relies on the backend sending UTC-unambiguous ISO 8601 (with `Z`/offset);
 * `Date` then converts to the client's zone automatically — no manual tz math.
 */
export function formatWallClock(iso: string | null): string {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '—';
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function previewJson(value: unknown): string {
  try {
    const s = JSON.stringify(value, null, 2);
    return s.length > 240 ? s.slice(0, 240) + '…' : s;
  } catch {
    return String(value);
  }
}

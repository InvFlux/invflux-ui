import { For, Show, createSignal, type JSX } from 'solid-js';
import { _n, __, formatDateTime, sprintf } from '@invflux/i18n';
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
    /**
     * Display name for the person behind `ref`, resolved at read time.
     *
     * Present only for `user` actors the host could resolve; absent for a plugin or system actor,
     * whose `ref` already reads as a name, and for a user who no longer exists. A renderer falls
     * back to `ref` rather than inventing a placeholder — the reference is the one identifying
     * thing the record still holds.
     */
    name?: string | null;
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

/**
 * Whether timeline timestamps read as "11h ago" or as a wall-clock date.
 *
 * One preference for every timeline rather than per row or per panel: the question a reader is
 * answering ("how long ago" vs "exactly when") belongs to the reader, not to the event they happen
 * to be looking at, and a row that remembered its own mode would leave a column reading half one
 * way and half the other.
 *
 * Persisted per browser. Reads and writes are guarded because storage throws outright in some
 * contexts (a private window, a thumbnail capture, a browser set to block site data), and a
 * timestamp that cannot remember a preference is a far smaller problem than a timeline that
 * refuses to render.
 */
const TIME_MODE_KEY = 'invflux:timeline:time-mode';
export type TimelineTimeMode = 'relative' | 'absolute';

function readTimeMode(): TimelineTimeMode {
  try {
    return localStorage.getItem(TIME_MODE_KEY) === 'absolute' ? 'absolute' : 'relative';
  } catch {
    return 'relative';
  }
}

const [timelineTimeMode, setTimelineTimeModeSignal] =
  createSignal<TimelineTimeMode>(readTimeMode());

/** The current timestamp mode. Reactive — every mounted timeline re-renders on a change. */
export { timelineTimeMode };

/** Flip every timeline's timestamps between relative and absolute, and remember the choice. */
export function toggleTimelineTimeMode(): void {
  const next: TimelineTimeMode = timelineTimeMode() === 'relative' ? 'absolute' : 'relative';
  setTimelineTimeModeSignal(next);
  try {
    localStorage.setItem(TIME_MODE_KEY, next);
  } catch {
    /* preference is not persistable here; the session still honours it */
  }
}

/** The timestamp as the reader currently wants it. */
export function formatEventTime(iso: string | null): string {
  return timelineTimeMode() === 'absolute' ? formatWallClock(iso) : formatRelative(iso);
}

/**
 * Compact relative-time formatter — "5m ago", "3d ago", "in 2d".
 *
 * Both directions, at the same resolution. An event timeline only ever looks backwards, so this
 * used to answer a single flat "in future" for anything ahead of now — which is the whole answer
 * for a *deadline*, and deadlines read through here too: an order's estimated dispatch is the
 * number an operator is working against, and "in future" is exactly the part they already knew.
 */
export function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '—';
  const delta = Date.now() - ts;
  const ahead = delta < 0;
  const sec = Math.floor(Math.abs(delta) / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  // The unit letters are inside the msgid, not concatenated onto a number: they abbreviate words
  // that differ per language, and several languages place the number differently. Ahead and behind
  // are separate msgids for the same reason — "in %dd" is not "%dd ago" with a word swapped.
  if (sec < 60)
    return ahead
      ? sprintf(_n('in %ds', 'in %ds', sec), sec)
      : sprintf(_n('%ds ago', '%ds ago', sec), sec);
  if (min < 60)
    return ahead
      ? sprintf(_n('in %dm', 'in %dm', min), min)
      : sprintf(_n('%dm ago', '%dm ago', min), min);
  if (hr < 24)
    return ahead
      ? sprintf(_n('in %dh', 'in %dh', hr), hr)
      : sprintf(_n('%dh ago', '%dh ago', hr), hr);

  return ahead
    ? sprintf(_n('in %dd', 'in %dd', day), day)
    : sprintf(_n('%dd ago', '%dd ago', day), day);
}

/**
 * A timestamp that flips between elapsed and wall-clock on click, and takes every other timestamp
 * on the page with it.
 *
 * One control, not three copies of it: the two timeline row shells and the order header's Timeline
 * card all want the same affordance, and the mode they toggle is a single page-wide preference
 * ({@link toggleTimelineTimeMode}), so a divergent copy would be a control that looks like the
 * others and reads a different instant.
 */
export function EventTime(props: { at: string | null; class?: string }): JSX.Element {
  return (
    <button
      type="button"
      class={`cursor-pointer whitespace-nowrap tabular-nums decoration-dotted underline-offset-2 hover:text-gray-700 hover:underline ${props.class ?? 'shrink-0 text-xs text-text-muted'}`}
      title={
        timelineTimeMode() === 'relative'
          ? formatWallClock(props.at)
          : __('Show the time as an interval')
      }
      aria-label={__('Switch between elapsed time and the date')}
      onClick={() => toggleTimelineTimeMode()}
    >
      {formatEventTime(props.at)}
    </button>
  );
}

/**
 * Absolute wall-clock formatter in the **browser's local timezone**.
 *
 * The alternative to {@link formatRelative}, not a companion to it: a row shows one or the other,
 * chosen by the reader via {@link toggleTimelineTimeMode}. Use {@link formatEventTime} to render
 * whichever they picked.
 * Relies on the backend sending UTC-unambiguous ISO 8601 (with `Z`/offset);
 * `Date` then converts to the client's zone automatically — no manual tz math.
 */
export function formatWallClock(iso: string | null): string {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '—';
  return formatDateTime(ts, '—', {
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

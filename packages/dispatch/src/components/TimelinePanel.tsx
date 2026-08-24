import { For, Show, createMemo, createSignal, type JSX } from 'solid-js';
import { __ } from '@invflux/i18n';
import {
  FoldingSection,
  Timeline,
  formatRelativeTime,
  formatWallClock,
  latestLiveVersion,
  timelineRowRegistry,
  type AnnotationThread,
  type TagChipResolver,
  type TimelineEvent,
  type TimelineRowProps,
  PencilIcon,
} from '@invflux/ui';
import { useOrderAnnotationsQuery, useOrderEventsQuery, useTagsQuery } from '../queries';

/**
 * Collapsible OrderEvent timeline rendered below the corrections
 * panel. Lazy-fetches its events the first time the operator
 * expands the panel (the events query is gated by the expanded
 * signal) so the cost stays off the cold path of order-detail
 * loads.
 *
 * Dispatch-specific event-type renderers register themselves
 * once on module import (see the bottom of this file). Each
 * narrows its own payload shape; the fallback in `@invflux/ui`
 * handles types we don't recognise.
 */
export function TimelinePanel(props: {
  orderHexId: string;
  /** Optional controlled expand state — lets the parent open the panel (e.g. on ship). */
  expanded?: () => boolean;
  onToggle?: (next: boolean) => void;
}): JSX.Element {
  const [internalExpanded, setInternalExpanded] = createSignal(false);
  const expanded = (): boolean => (props.expanded ? props.expanded() : internalExpanded());
  const setExpanded = (next: boolean): void => {
    if (props.onToggle) props.onToggle(next);
    else setInternalExpanded(next);
  };
  const query = useOrderEventsQuery(() => props.orderHexId, expanded);
  const annQuery = useOrderAnnotationsQuery(() => props.orderHexId, expanded);
  const tagsQuery = useTagsQuery();
  // Resolve a tag id → {name, colorId} for rendering tag-delta annotations as chips. Includes
  // retired tags the query still returns; unknown ids fall back to `#id` in the row.
  const resolveTag: TagChipResolver = (id) => {
    const t = (tagsQuery.data ?? []).find((tag) => tag.id === id);
    return t ? { name: t.name, colorId: t.colorId } : undefined;
  };

  // Interleave annotation threads: map each thread to a synthetic `annotation.note` event at its
  // latest version's time, merge with the order
  // events, and re-sort newest-first. The AnnotationTimelineRow (registered by @invflux/ui)
  // renders it.
  const events = createMemo<TimelineEvent[]>(() => {
    const base = query.data?.events ?? [];
    const notes = (annQuery.data?.threads ?? []).map((t) => threadToEvent(t, resolveTag));
    return [...base, ...notes].sort(
      (a, b) => (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''),
    );
  });

  return (
    <FoldingSection
      title={__('Timeline')}
      aside={
        <Show when={expanded() && events().length > 0}>
          {events().length} event{events().length === 1 ? '' : 's'}
        </Show>
      }
      open={expanded()}
      onOpenChange={setExpanded}
      // The rows carry their own padding, and the Timeline is full-bleed.
      bodyClass=""
    >
      <Show
        when={!query.isLoading}
        fallback={<div class="px-4 py-3 text-xs text-text-muted">{__('Loading timeline…')}</div>}
      >
        <Show
          when={!query.isError}
          fallback={
            <div class="px-4 py-3 text-xs text-red-700">
              Timeline failed to load:{' '}
              {query.error?.message ?? 'unknown error'}
            </div>
          }
        >
          <Timeline events={events()} />
        </Show>
      </Show>
    </FoldingSection>
  );
}

// ---------------------------------------------------------------------------
// Dispatch-side built-in renderers.
//
// One renderer per real event type we emit today. Each owns its
// row layout — icon, label, summary text built from the typed
// payload. Add-ons can override any of these by registering
// against the same type with a higher-precedence id.
// ---------------------------------------------------------------------------

/** Map an annotation thread to a synthetic timeline event (rendered by AnnotationTimelineRow).
 * `resolveTag` lets the row render tag-delta annotations (tag apply/remove) as coloured chips. */
function threadToEvent(thread: AnnotationThread, resolveTag: TagChipResolver): TimelineEvent {
  const live = latestLiveVersion(thread) ?? thread.versions[thread.versions.length - 1];
  return {
    id: thread.threadId,
    type: 'annotation.note',
    tier: 'ancillary',
    occurredAt: live?.occurredAt ?? null,
    actor: {
      kind: 'user',
      ref: live?.authorActorId != null ? String(live.authorActorId) : null,
    },
    surface: { kind: null, key: null },
    payload: { thread, resolveTag },
    note: null,
    correlationId: null,
  };
}

interface RowShellProps {
  icon: JSX.Element;
  /** Tier-colour ring around the icon. Lifecycle = blue, Decision = violet, Execution = emerald, Ancillary = gray. */
  tone: 'lifecycle' | 'decision' | 'execution' | 'ancillary';
  label: string;
  detail?: JSX.Element;
  event: TimelineEvent;
}

const TONE_CLASS: Record<RowShellProps['tone'], string> = {
  lifecycle: 'bg-blue-50 text-blue-700 ring-blue-100',
  decision: 'bg-violet-50 text-violet-700 ring-violet-100',
  execution: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  ancillary: 'bg-gray-50 text-gray-600 ring-gray-100',
};

/** Shared row chrome — icon medallion + header line + detail. */
function RowShell(p: RowShellProps): JSX.Element {
  const actorLabel = (): string => {
    const k = p.event.actor.kind;
    const r = p.event.actor.ref;
    if (!k && !r) return '';
    if (k === 'user' && r) return `user #${r}`;
    if (k === 'plugin' && r) return r;
    if (k === 'system' && r) return r;
    return k ? `${k}${r ? `:${r}` : ''}` : (r ?? '');
  };
  return (
    <div class="flex items-start gap-3">
      <span
        class={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-2 text-xs font-medium ${TONE_CLASS[p.tone]}`}
      >
        {p.icon}
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-2 text-sm">
          <span class="font-medium text-gray-800 truncate">{p.label}</span>
          {/* Time sits immediately after the label (left-aligned, no wide-screen
              gap): relative + the full wall-clock in the viewer's local zone. */}
          <span
            class="text-xs text-text-muted shrink-0 whitespace-nowrap tabular-nums"
            title={formatWallClock(p.event.occurredAt)}
          >
            {formatRelativeTime(p.event.occurredAt)}
            <span class="text-gray-300"> · </span>
            {formatWallClock(p.event.occurredAt)}
          </span>
        </div>
        <Show when={p.detail}>
          <div class="text-xs text-gray-600 mt-0.5">{p.detail}</div>
        </Show>
        <Show when={actorLabel()}>
          <div class="text-2xs text-text-muted mt-0.5">by {actorLabel()}</div>
        </Show>
      </div>
    </div>
  );
}

// ---- order.* ----------------------------------------------------

function OrderCreatedRow(props: TimelineRowProps): JSX.Element {
  const p = props.event.payload as { external_id?: string; line_count?: number } | null;
  return (
    <RowShell
      event={props.event}
      tone="lifecycle"
      icon={<>＋</>}
      label="Order created"
      detail={
        <Show when={p}>
          <span>
            #{p?.external_id ?? '—'}
            <Show when={typeof p?.line_count === 'number'}>
              {' '}· {p!.line_count} line{p!.line_count === 1 ? '' : 's'}
            </Show>
          </span>
        </Show>
      }
    />
  );
}

function OrderParkedRow(props: TimelineRowProps): JSX.Element {
  return <RowShell event={props.event} tone="lifecycle" icon={<>⏸</>} label="Order parked" />;
}

function OrderUnparkedRow(props: TimelineRowProps): JSX.Element {
  return <RowShell event={props.event} tone="lifecycle" icon={<>▶</>} label="Order unparked" />;
}

// ---- shipment.* -------------------------------------------------

interface ShipmentLine {
  subject_id?: number;
  sku?: string;
  name?: string;
  qty_shipped?: number;
}

function ShipmentSentRow(props: TimelineRowProps): JSX.Element {
  const p = props.event.payload as { lines?: ShipmentLine[]; final?: boolean } | null;
  const lines = (): ShipmentLine[] => (Array.isArray(p?.lines) ? p!.lines : []);
  // A partial shipment leaves the order open; the final one closes it. Older events (emitted before
  // the `final` flag) carry no flag, so they fall back to the generic label.
  const label = (): string =>
    p?.final === true ? 'Final shipment sent' : p?.final === false ? 'Partial shipment sent' : 'Shipment sent';
  // SKU is the primary label; fall back to the product name, then the subject id
  // (older shipment events emitted before the sku/name snapshot landed).
  const lineLabel = (l: ShipmentLine): string =>
    l.sku || l.name || (l.subject_id != null ? `#${l.subject_id}` : '—');
  return (
    <RowShell
      event={props.event}
      tone="lifecycle"
      icon={<>✓</>}
      label={label()}
      detail={
        <Show when={lines().length > 0}>
          <ul class="mt-0.5 space-y-0.5">
            <For each={lines()}>
              {(l) => (
                <li class="flex items-baseline gap-1.5 tabular-nums">
                  <span class="font-mono text-2xs text-gray-700">{lineLabel(l)}</span>
                  <span class="text-text-muted">×</span>
                  <span class="text-gray-700">{l.qty_shipped ?? 0}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      }
    />
  );
}

// ---- correction.* / corrections.* -------------------------------

function CorrectionCreatedRow(props: TimelineRowProps): JSX.Element {
  const p = props.event.payload as { type_name?: string; qty?: number } | null;
  return (
    <RowShell
      event={props.event}
      tone="lifecycle"
      icon={<>!</>}
      label="Correction created"
      detail={
        <Show when={p}>
          <span>
            {p?.type_name ?? '—'}
            <Show when={typeof p?.qty === 'number'}> · qty {p!.qty}</Show>
          </span>
        </Show>
      }
    />
  );
}

function CorrectionEditedRow(props: TimelineRowProps): JSX.Element {
  const p = props.event.payload as { fields_changed?: string[] } | null;
  const fields = Array.isArray(p?.fields_changed) ? p!.fields_changed.join(', ') : '';
  return (
    <RowShell
      event={props.event}
      tone="lifecycle"
      icon={<PencilIcon class="h-3.5 w-3.5" />}
      label="Correction edited"
      detail={<Show when={fields}><span>{fields}</span></Show>}
    />
  );
}

function CorrectionUnprocessedRow(props: TimelineRowProps): JSX.Element {
  return <RowShell event={props.event} tone="lifecycle" icon={<>↺</>} label="Correction unprocessed" />;
}

function CorrectionsProcessedRow(props: TimelineRowProps): JSX.Element {
  const p = props.event.payload as { count?: number } | null;
  return (
    <RowShell
      event={props.event}
      tone="decision"
      icon={<>✓</>}
      label="Corrections processed"
      detail={
        <Show when={typeof p?.count === 'number'}>
          <span>{p!.count} correction{p!.count === 1 ? '' : 's'} committed in a single batch</span>
        </Show>
      }
    />
  );
}

// ---- lpsc.* -----------------------------------------------------

function LpscResolvedRow(props: TimelineRowProps): JSX.Element {
  const p = props.event.payload as { branch?: string } | null;
  return (
    <RowShell
      event={props.event}
      tone="decision"
      icon={<>?</>}
      label="LPSC resolved"
      detail={<Show when={p?.branch}><span>branch: {p!.branch}</span></Show>}
    />
  );
}

// ---- refund.* ---------------------------------------------------

interface MonetaryPayload {
  amount?: string;
  currency?: string;
}

function RefundScheduledRow(props: TimelineRowProps): JSX.Element {
  const p = props.event.payload as { total?: string; mode?: string } | null;
  return (
    <RowShell
      event={props.event}
      tone="decision"
      icon={<>⏱</>}
      label="Refund scheduled"
      detail={
        <Show when={p?.total}>
          <span>{p!.total}{p?.mode ? ` · ${p.mode}` : ''}</span>
        </Show>
      }
    />
  );
}

function RefundConfirmedRow(props: TimelineRowProps): JSX.Element {
  const p = props.event.payload as { refund_total?: string; refund_mode?: string } | null;
  return (
    <RowShell
      event={props.event}
      tone="lifecycle"
      icon={<>$</>}
      label="Refund confirmed"
      detail={
        <Show when={p?.refund_total}>
          <span>{p!.refund_total}{p?.refund_mode ? ` · ${p.refund_mode}` : ''}</span>
        </Show>
      }
    />
  );
}

function RefundExternalRow(props: TimelineRowProps): JSX.Element {
  const p = props.event.payload as { refund_total?: string; currency?: string } | null;
  return (
    <RowShell
      event={props.event}
      tone="lifecycle"
      icon={<>$</>}
      label="Refund in WooCommerce"
      detail={
        <Show when={p?.refund_total}>
          <span>
            {p!.refund_total}{p?.currency ? ` ${p.currency}` : ''} · outside Dispatch
          </span>
        </Show>
      }
    />
  );
}

function RefundFailedRow(props: TimelineRowProps): JSX.Element {
  const p = props.event.payload as MonetaryPayload | null;
  return (
    <RowShell
      event={props.event}
      tone="execution"
      icon={<>✗</>}
      label="Refund failed"
      detail={
        <Show when={p?.amount}>
          <span class="text-red-700">{p!.amount} {p?.currency ?? ''}</span>
        </Show>
      }
    />
  );
}

function RefundCancelledRow(props: TimelineRowProps): JSX.Element {
  return (
    <RowShell
      event={props.event}
      tone="execution"
      icon={<>⊘</>}
      label="Refund cancelled"
    />
  );
}

// Register every dispatch-side renderer once on import. Hosts that
// don't want the dispatch defaults can override by registering
// against the same type slugs after this module has loaded.
const REGISTRATIONS: Array<[string, string, (p: TimelineRowProps) => JSX.Element]> = [
  ['order.created', 'dispatch.order.created', OrderCreatedRow],
  ['order.parked', 'dispatch.order.parked', OrderParkedRow],
  ['order.unparked', 'dispatch.order.unparked', OrderUnparkedRow],
  ['shipment.sent', 'dispatch.shipment.sent', ShipmentSentRow],
  ['correction.created', 'dispatch.correction.created', CorrectionCreatedRow],
  ['correction.edited', 'dispatch.correction.edited', CorrectionEditedRow],
  ['correction.unprocessed', 'dispatch.correction.unprocessed', CorrectionUnprocessedRow],
  ['corrections.processed', 'dispatch.corrections.processed', CorrectionsProcessedRow],
  ['lpsc.resolved', 'dispatch.lpsc.resolved', LpscResolvedRow],
  ['refund.scheduled', 'dispatch.refund.scheduled', RefundScheduledRow],
  ['correction.refund_confirmed', 'dispatch.refund.confirmed', RefundConfirmedRow],
  ['refund.external', 'dispatch.refund.external', RefundExternalRow],
  ['refund.failed', 'dispatch.refund.failed', RefundFailedRow],
  ['refund.cancelled', 'dispatch.refund.cancelled', RefundCancelledRow],
];

// Avoid the unused-binding warning by iterating with `For` at
// module scope — we just use a plain loop.
for (const [type, id, component] of REGISTRATIONS) {
  timelineRowRegistry.register(type, id, component, { default: true });
}

// Suppress the unused-Solid-import warning when none of the
// renderers above happen to use `For` directly (they don't today).
// The import stays for future renderers that need it.
void For;

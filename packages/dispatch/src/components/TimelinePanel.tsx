import { For, Show, createMemo, createSignal, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { __, _n, _x, sprintf } from '@invflux/i18n';
import {
  ErrorBanner,
  EventTime,
  FoldingSection,
  Timeline,
  latestLiveVersion,
  timelineRowRegistry,
  viewRegistry,
  type AnnotationThread,
  type TagChipResolver,
  type TimelineEvent,
  type TimelineRowProps,
  PencilIcon,
} from '@invflux/ui';
import { useOrderAnnotationsQuery, useOrderEventsQuery, useTagsQuery } from '../queries';
import type { CorrectionType, DispatchCorrection, DispatchOrderLine } from '../types';
import { differenceReasonLabel, paymentSourceLabel } from '../paymentLabels';
import { formatMoney, toCents } from '../money';

/** Resolved once at module load, like every other consumer of the shared datatype views. */
const moneyView = viewRegistry.resolve('decimal:money');

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
  /**
   * The order's lines and corrections, so a correction entry can name the item it concerns.
   *
   * The events themselves carry ids, not names — correctly, since an event is a durable record and
   * a product's name is not. Resolving here rather than widening the event payload also means
   * entries written long before this existed gain the item name too.
   *
   * Both optional: without them the entries render exactly as they did, naming the correction type
   * and quantity but not the item.
   */
  lines?: DispatchOrderLine[];
  corrections?: DispatchCorrection[];
  /**
   * The correction-type catalogue, as a second way to name a type.
   *
   * A correction can be deleted while the event recording its creation remains — the event is the
   * durable record, the correction is not — so resolving the name through the correction alone
   * leaves exactly those entries showing a raw code. The catalogue answers by code and outlives
   * any individual correction.
   */
  correctionTypes?: CorrectionType[];
  /** The order's currency, so amounts in the entries carry a unit. */
  currency?: string | null;
  /** Optional controlled expand state — lets the parent open the panel (e.g. on ship). */
  expanded?: () => boolean;
  onToggle?: (next: boolean) => void;
  /**
   * How many order events this order has, from the detail payload.
   *
   * Only for the heading, and only while shut: the events themselves are fetched on first open, so
   * without this the one section whose size a reader most wants before opening it was the one
   * section that could not say. Note threads are added on top here, because they render in this
   * list too and the client already holds them.
   */
  eventCount?: number;
}): JSX.Element {
  const [internalExpanded, setInternalExpanded] = createSignal(false);
  const expanded = (): boolean => (props.expanded ? props.expanded() : internalExpanded());
  const setExpanded = (next: boolean): void => {
    if (props.onToggle) props.onToggle(next);
    else setInternalExpanded(next);
  };
  const query = useOrderEventsQuery(() => props.orderHexId, expanded);
  // Not gated on `expanded`, unlike the events: the Notes section fetches these eagerly under the
  // same query key, so this reads a cache entry that is already there — no second request — and the
  // heading can count the note threads it will interleave before anyone opens it.
  const annQuery = useOrderAnnotationsQuery(
    () => props.orderHexId,
    () => true,
  );
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
  /** Line id → line, and correction id → the line it was raised against. */
  const lineById = createMemo(() => {
    const m = new Map<string, DispatchOrderLine>();
    for (const l of props.lines ?? []) m.set(l.id, l);
    return m;
  });
  const lineByCorrectionId = createMemo(() => {
    const m = new Map<string, DispatchOrderLine>();
    for (const c of props.corrections ?? []) {
      const line = lineById().get(c.lineId);
      if (line) m.set(c.id, line);
    }
    return m;
  });
  /**
   * Correction id → the type's human name.
   *
   * Older entries recorded only the type *code*, so the row would read `cancel_customer` where the
   * corrections panel two sections above reads "Cancelled by customer" — the same fact, named two
   * ways on one screen. The name is looked up rather than back-filled into the event, because the
   * event is the record and the name is presentation.
   */
  const typeNameByCorrectionId = createMemo(() => {
    const m = new Map<string, string>();
    for (const c of props.corrections ?? []) {
      if (c.typeName !== '') m.set(c.id, c.typeName);
    }
    return m;
  });
  /** Type code → its display name, for entries whose correction is gone. */
  const typeNameByCode = createMemo(() => {
    const m = new Map<string, string>();
    // Corrections first, then the catalogue: a correction carries the name as it was recorded
    // against that order, which is the more specific answer where both exist.
    for (const t of props.correctionTypes ?? []) if (t.name !== '') m.set(t.code, t.name);
    for (const c of props.corrections ?? []) if (c.typeName !== '') m.set(c.typeCode, c.typeName);
    return m;
  });

  /** A line as a timeline entry names it: the SKU when there is one, else the product name. */
  const nameOf = (line: DispatchOrderLine): string => (line.sku !== '' ? line.sku : line.name);

  /**
   * Give correction entries the item they concern.
   *
   * The event is copied rather than mutated — it belongs to the query cache, and writing into it
   * would have the enrichment survive into unrelated readers of the same data.
   */
  const withItems = (event: TimelineEvent): TimelineEvent => {
    const payload = event.payload;
    if (payload === null || typeof payload !== 'object') return event;

    // The order's currency, unless the event recorded its own — a refund mirrored from the host
    // carries the currency it was actually issued in, which is the one that belongs on that row.
    const withCurrency = <T extends object>(p: T): T =>
      'currency' in p && (p as { currency?: unknown }).currency
        ? p
        : props.currency
          ? { ...p, currency: props.currency }
          : p;

    const single = (payload as { line_id?: unknown }).line_id;
    if (typeof single === 'string') {
      const correctionId = (payload as { correction_id?: unknown }).correction_id;
      const line = lineById().get(single);
      const code = (payload as { type_code?: unknown }).type_code;
      const typeName =
        (typeof correctionId === 'string'
          ? typeNameByCorrectionId().get(correctionId)
          : undefined) ?? (typeof code === 'string' ? typeNameByCode().get(code) : undefined);
      return {
        ...event,
        payload: withCurrency({
          ...payload,
          ...(line ? { items: [nameOf(line)] } : {}),
          ...(typeName !== undefined ? { type_name: typeName } : {}),
        }),
      };
    }

    const ids = (payload as { correction_ids?: unknown }).correction_ids;
    if (Array.isArray(ids)) {
      // Distinct, because one batch commonly holds several corrections against one line and
      // repeating a SKU says nothing.
      const items = [
        ...new Set(
          ids
            .filter((id): id is string => typeof id === 'string')
            .map((id) => lineByCorrectionId().get(id))
            .filter((l): l is DispatchOrderLine => l !== undefined)
            .map(nameOf),
        ),
      ];
      if (items.length > 0) return { ...event, payload: withCurrency({ ...payload, items }) };
    }
    return { ...event, payload: withCurrency({ ...payload }) };
  };

  const events = createMemo<TimelineEvent[]>(() => {
    const base = (query.data?.events ?? []).map(withItems);
    const notes = (annQuery.data?.threads ?? []).map((t) => threadToEvent(t, resolveTag));
    return [...base, ...notes].sort((a, b) =>
      (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''),
    );
  });

  /**
   * What the heading states — the rendered list once it exists, the server's count plus the notes
   * before that.
   *
   * Preferring the rendered list matters: the two are computed from different places, and a number
   * that changed the moment you opened the section would be worse than no number at all. This way
   * the estimate is only ever on screen while there is nothing to compare it against.
   */
  const headingCount = createMemo<number>(() => {
    const notes = annQuery.data?.threads.length ?? 0;
    if (query.data !== undefined) return events().length;

    return (props.eventCount ?? 0) + notes;
  });

  return (
    <FoldingSection
      // "Timeline (12 events)" — the count in parentheses like its sibling sections, but keeping
      // the unit, because a bare number after Timeline reads as a date or a version before it
      // reads as a tally.
      title={
        headingCount() > 0
          ? sprintf(
              _n('Timeline (%d event)', 'Timeline (%d events)', headingCount()),
              headingCount(),
            )
          : __('Timeline')
      }
      open={expanded()}
      onOpenChange={setExpanded}
      testId="order-timeline"
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
            <ErrorBanner as="div" class="px-4 py-3 text-xs">
              {sprintf(
                __('Timeline failed to load: %s'),
                query.error?.message ?? __('unknown error'),
              )}
            </ErrorBanner>
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

/**
 * The items a correction entry concerns, appended to its detail line.
 *
 * Capped, because a batch can hold dozens and a timeline row is a summary, not a manifest — the
 * corrections panel above is where the full list belongs. Renders nothing at all when the lines
 * were not available to resolve, rather than an empty bracket.
 */
const ITEMS_SHOWN = 3;

/**
 * @param separator Printed before the list. Empty where the caller has already placed the item in a
 *                  sentence ("1 × 'SKU' Cancelled by customer"); ` · ` where it is appended to one.
 */
function ItemList(props: { items?: string[]; separator?: string }): JSX.Element {
  const shown = (): string[] => (props.items ?? []).slice(0, ITEMS_SHOWN);
  const extra = (): number => Math.max(0, (props.items?.length ?? 0) - ITEMS_SHOWN);
  return (
    <Show when={(props.items?.length ?? 0) > 0}>
      {props.separator ?? ' · '}
      {/* Quoted, because a SKU sits inside a sentence here and `PACK-TRAIL-18 Cancelled by
          customer` reads as one run-on phrase without something to close the name. */}
      <span class="text-gray-500">
        {shown()
          .map((i) => `'${i}'`)
          .join(', ')}
      </span>
      <Show when={extra() > 0}>
        <span class="text-text-muted">
          {' '}
          {sprintf(_n('+%d more', '+%d more', extra()), extra())}
        </span>
      </Show>
    </Show>
  );
}

/**
 * A monetary amount, through the shared `decimal:money` view.
 *
 * Not `{amount}` interpolated into the sentence: these are prices in the merchant's currency and a
 * bare "11.80" does not say which. Going through the registry means the store's formatting — symbol,
 * placement, separators — is decided once and every surface follows, including this one.
 */
function Money(props: { value?: string | null; currency?: string | null }): JSX.Element {
  return (
    <Show when={props.value !== null && props.value !== undefined && props.value !== ''}>
      <Show when={moneyView} fallback={<span>{props.value}</span>}>
        <Dynamic
          component={moneyView!}
          value={props.value}
          row={{}}
          column={{ dataType: 'decimal:money', editorConfig: {} }}
          ctx={{}}
        />
      </Show>
      {/* The code sits beside the amount rather than inside the shared view: a table column says
          its currency once in the header, and repeating it down every cell is noise. A timeline
          entry is a sentence with no header to lean on, so it carries its own unit. */}
      <Show when={props.currency}>
        <span class="text-text-muted"> {props.currency}</span>
      </Show>
    </Show>
  );
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
    const name = p.event.actor.name;
    if (!k && !r) return '';
    // A resolved display name is always the best thing to show. Falling back to `user #3` rather
    // than to nothing keeps the record legible when the host cannot resolve the id — a deleted
    // account still did the thing, and the reference is the only trace of who.
    if (k === 'user') return name ?? (r ? sprintf(_x('user #%s', 'timeline actor'), r) : '');
    if (k === 'plugin' && r) return r;
    if (k === 'system' && r) return r;
    return k ? `${k}${r ? `:${r}` : ''}` : (r ?? '');
  };
  return (
    // `data-event-type` names the row for browser and E2E checks, whatever language it renders in.
    <div class="flex items-center gap-3" data-event-type={p.event.type}>
      <span
        class={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-2 text-xs font-medium ${TONE_CLASS[p.tone]}`}
      >
        {p.icon}
      </span>
      {/* ONE line — `Correction created by Sam 31m ago: 1 × 'PACK-TRAIL-18' Cancelled by customer`.
          The detail used to sit on a second line, which halved the number of events on screen while
          leaving most of a wide panel empty: the label and the detail are one sentence, and a
          timeline is read by scanning down it, so the cost of the wrap was paid on every row.

          `flex-wrap`, not `truncate`: the row still has to survive a narrow panel, and there it
          breaks between its parts rather than cutting a SKU in half. `gap-y-0` because a wrapped
          continuation is the same sentence, not a new line of it. */}
      <div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0 text-sm">
        <span class="font-medium text-gray-800">{p.label}</span>
        {/* Who, then when — the byline reads as part of the sentence the label starts. */}
        <Show when={actorLabel()}>
          <span class="text-2xs text-text-muted">
            {sprintf(_x('by %s', 'timeline event author'), actorLabel())}
          </span>
        </Show>
        {/* One timestamp, not both. Showing "11h ago" beside the wall clock spends a third of the
            row restating the same instant; which of the two a reader wants depends on what they
            are doing, so it is theirs to choose and the choice persists.

            Left-aligned with the label rather than pushed right: on a wide panel `ml-auto` parks
            it against the far edge, yards from the event it belongs to — and off-screen entirely
            once the panel is narrow.

            The colon rides WITH the time rather than leading the detail, so the flex gap does not
            open up before it and leave the punctuation floating. */}
        <span class="inline-flex shrink-0 items-baseline whitespace-pre">
          <EventTime at={p.event.occurredAt} />
          {/* Punctuation is not universal: French sets a narrow no-break space before a colon, so
              this is a string a translator owns rather than a literal in the markup. `whitespace-pre`
              on the wrapper is what lets that leading space survive — HTML would otherwise collapse
              it. Use U+202F (narrow no-break space) in the French msgstr, not a plain space, so the
              colon can never wrap onto the next line alone. */}
          <Show when={p.detail}>
            {_x(':', 'punctuation joining a timeline entry to its detail')}
          </Show>
        </span>
        <Show when={p.detail}>
          <span class="min-w-0 text-xs text-gray-600">{p.detail}</span>
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
      label={__('Order created')}
      detail={
        <Show when={p}>
          <span>
            #{p?.external_id ?? '—'}
            <Show when={typeof p?.line_count === 'number'}>
              {' · '}
              {sprintf(_n('%d line', '%d lines', p!.line_count!), p!.line_count!)}
            </Show>
          </span>
        </Show>
      }
    />
  );
}

/**
 * The WooCommerce order was permanently deleted. `released` (units handed back to stock, per
 * subject) and `refunds_owed` (manual refunds still unsettled) are absent on older events.
 */
interface OrderSourceDeletedPayload {
  external_id?: string;
  released?: Array<{ subject_id?: number; qty?: number }>;
  refunds_owed?: Array<{ total?: string; currency?: string | null }>;
}

function OrderSourceDeletedRow(props: TimelineRowProps): JSX.Element {
  const p = props.event.payload as OrderSourceDeletedPayload | null;
  const releasedUnits = (): number =>
    (Array.isArray(p?.released) ? p!.released : []).reduce((sum, r) => sum + (r.qty ?? 0), 0);
  const refundsOwed = (): NonNullable<OrderSourceDeletedPayload['refunds_owed']> =>
    Array.isArray(p?.refunds_owed) ? p!.refunds_owed : [];
  return (
    <RowShell
      event={props.event}
      tone="lifecycle"
      icon={<>✕</>}
      label={__('Order deleted in WooCommerce')}
      detail={
        <Show when={p}>
          <span>
            #{p?.external_id ?? '—'}
            <Show when={releasedUnits() > 0}>
              {' · '}
              {sprintf(
                /* translators: %d: number of units put back into available stock */
                _n('%d unit back in stock', '%d units back in stock', releasedUnits()),
                releasedUnits(),
              )}
            </Show>
            <For each={refundsOwed()}>
              {(refund) => (
                <Show when={toCents(refund.total)}>
                  {(cents) => (
                    <>
                      {' · '}
                      <span class="text-red-700">
                        {sprintf(
                          /* translators: %s: amount with currency, e.g. "€26.50" */
                          __('Refund still owed: %s'),
                          formatMoney(cents(), refund.currency),
                        )}
                      </span>
                    </>
                  )}
                </Show>
              )}
            </For>
          </span>
        </Show>
      }
    />
  );
}

function OrderParkedRow(props: TimelineRowProps): JSX.Element {
  return <RowShell event={props.event} tone="lifecycle" icon={<>⏸</>} label={__('Order parked')} />;
}

function OrderUnparkedRow(props: TimelineRowProps): JSX.Element {
  return (
    <RowShell event={props.event} tone="lifecycle" icon={<>▶</>} label={__('Order unparked')} />
  );
}

// ---- order.address_corrected ------------------------------------

/**
 * One address's stated facts, sparse: the postal parts nested under `address`, everything else at
 * the top level. The event stores only what moved, in that shape, so each side is a patch.
 */
interface AddressFacts {
  address?: Record<string, unknown>;
  [key: string]: unknown;
}

/** What one address's correction recorded: who it was and became, and what moved. */
interface AddressChange {
  party?: { from?: number | null; to?: number | null };
  changes?: { from?: AddressFacts; to?: AddressFacts };
}

/**
 * What each stated field is called, in the words the correction form uses.
 *
 * Deliberately the same strings: an operator reading "Address line 2" here has just typed into a
 * box with that label, and a timeline that renamed the fields would make them work out the mapping.
 */
const ADDRESS_FIELD_LABEL: Record<string, () => string> = {
  firstName: () => __('First name'),
  lastName: () => __('Last name'),
  company: () => __('Company'),
  address_1: () => __('Address'),
  address_2: () => __('Address line 2'),
  postcode: () => __('Postcode'),
  city: () => __('City'),
  state: () => __('State / region'),
  country: () => __('Country code'),
  contactEmail: () => __('Email'),
  contactPhone: () => __('Phone'),
};

/** A patch flattened to `field → value`, which is the shape a diff list reads from. */
function flattenPatch(patch: AddressFacts | undefined): Record<string, string> {
  const address = (patch?.address ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...(patch ?? {}), ...address })) {
    if ('address' === key) continue;
    out[key] = null == value ? '' : String(value).trim();
  }

  return out;
}

/** One rendered diff, and the addresses it speaks for. */
interface AddressDiffGroup {
  types: string[];
  fields: { field: string; before: string; after: string }[];
}

/**
 * Group the addresses whose patch is identical on both sides.
 *
 * The ordinary order is billed and shipped to one place, so both entries record the same move —
 * and printing that twice inside one entry would only relocate the duplication the single event
 * exists to remove. Where they genuinely differ (an operator conforming one address to the other),
 * the groups separate and each is labelled with its own addresses.
 */
function groupAddressDiffs(addresses: Record<string, AddressChange>): AddressDiffGroup[] {
  const groups = new Map<string, AddressDiffGroup>();
  for (const [type, change] of Object.entries(addresses)) {
    const before = flattenPatch(change.changes?.from);
    const after = flattenPatch(change.changes?.to);
    // `name` is dropped because it is derived: it is first and last joined, so a name change would
    // be reported twice, once under a field the operator never typed into. It stays in the stored
    // patch — the content hash covers it, so a patch missing it would not reconstruct.
    const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((f) => 'name' !== f)
      .map((field) => ({ field, before: before[field] ?? '', after: after[field] ?? '' }));
    const key = JSON.stringify(fields);
    const existing = groups.get(key);
    if (existing) existing.types.push(type);
    else groups.set(key, { types: [type], fields });
  }

  return [...groups.values()];
}

function addressTypeLabel(type: string): string {
  return 'billing' === type ? __('Bill to') : __('Ship to');
}

/**
 * Both address entries render from one component, because they store one payload shape.
 *
 * What differs is provenance, and provenance is the whole reason they are separate event types: an
 * address corrected here and one changed through WooCommerce are different facts about who did what
 * and where, and a reader must not have to infer which from the values. So the wording is passed in
 * and everything else — the grouping, the diff, the struck-through old value — is shared.
 */
function addressRow(labels: {
  both: () => string;
  billing: () => string;
  shipping: () => string;
  unknown: () => string;
}): (props: TimelineRowProps) => JSX.Element {
  return (props: TimelineRowProps): JSX.Element => {
    const p = props.event.payload as { addresses?: Record<string, AddressChange> } | null;

    const addresses = (): Record<string, AddressChange> =>
      p?.addresses && 'object' === typeof p.addresses ? p.addresses : {};
    const groups = (): AddressDiffGroup[] => groupAddressDiffs(addresses());

    /**
     * Which addresses moved is the label's job, because it is the first thing a reader wants and
     * the only thing distinguishing two otherwise identical entries on one order.
     */
    const label = (): string => {
      const types = Object.keys(addresses());
      if (types.length > 1) return labels.both();
      if ('billing' === types[0]) return labels.billing();
      if ('shipping' === types[0]) return labels.shipping();

      return labels.unknown();
    };

    return (
      <RowShell
        event={props.event}
        tone="decision"
        icon={<PencilIcon class="h-3.5 w-3.5" />}
        label={label()}
        detail={
          <For each={groups()}>
            {(group) => (
              <div class="mt-0.5">
                {/* Named only when the entry covers more than one diff — with a single group the
                    label above has already said which addresses this is about. */}
                <Show when={groups().length > 1}>
                  <div class="text-2xs font-medium text-text-muted">
                    {group.types.map(addressTypeLabel).join(' · ')}
                  </div>
                </Show>
                <ul class="space-y-0.5">
                  <For each={group.fields}>
                    {(f) => (
                      <li class="flex flex-wrap items-baseline gap-1.5">
                        <span class="text-2xs text-text-muted">
                          {(ADDRESS_FIELD_LABEL[f.field] ?? ((): string => f.field))()}
                        </span>
                        {/* Struck-through old beside plain new, rather than the new value alone:
                            the question a reader opens this entry with is what it *used* to say —
                            usually because a parcel went to the old one. */}
                        <span class="text-gray-500 line-through">{f.before || '—'}</span>
                        <span class="text-text-muted">→</span>
                        <span class="text-gray-800">{f.after || '—'}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            )}
          </For>
        }
      />
    );
  };
}

const AddressCorrectedRow = addressRow({
  both: () => __('Addresses corrected'),
  billing: () => __('Billing address corrected'),
  shipping: () => __('Shipping address corrected'),
  unknown: () => __('Address corrected'),
});

/**
 * An address written by something other than InvFlux — WooCommerce's own order screen, its REST
 * API, another plugin. The projection notices when the party the host implies stops matching the
 * one the order points at, and says so rather than repointing in silence.
 */
const AddressChangedExternallyRow = addressRow({
  both: () => __('Addresses changed in WooCommerce'),
  billing: () => __('Billing address changed in WooCommerce'),
  shipping: () => __('Shipping address changed in WooCommerce'),
  unknown: () => __('Address changed in WooCommerce'),
});

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
    p?.final === true
      ? __('Final shipment sent')
      : p?.final === false
        ? __('Partial shipment sent')
        : __('Shipment sent');
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
  const p = props.event.payload as {
    type_name?: string;
    type_code?: string;
    qty?: number;
    items?: string[];
  } | null;
  return (
    <RowShell
      event={props.event}
      tone="lifecycle"
      icon={<>!</>}
      label={__('Correction created')}
      detail={
        <Show when={p}>
          {/* Reads as a phrase — `1 × 'PACK-TRAIL-18' Cancelled by customer` — rather than three
              facts joined by dots. What was corrected comes before why, because on a dispatch
              screen the item is what an operator is scanning for. */}
          <span>
            <Show when={typeof p?.qty === 'number'}>{`${p!.qty!} × `}</Show>
            <ItemList items={p?.items} separator="" />
            {/* The type's name is snapshotted on newer entries; older ones carry only its code,
                which is still more use than a dash. */}
            <Show when={(p?.items?.length ?? 0) > 0 || typeof p?.qty === 'number'}> </Show>
            {p?.type_name ?? p?.type_code ?? '—'}
          </span>
        </Show>
      }
    />
  );
}

function CorrectionDeletedRow(props: TimelineRowProps): JSX.Element {
  const p = props.event.payload as {
    type_name?: string;
    type_code?: string;
    qty?: number;
    items?: string[];
  } | null;
  return (
    <RowShell
      event={props.event}
      tone="lifecycle"
      icon={<>✕</>}
      label={__('Correction withdrawn')}
      detail={
        <Show when={p}>
          {/* Same shape as the created row, deliberately: the two are read as a pair, and a
              withdrawal described differently from the thing it withdraws makes the reader
              re-derive the match. */}
          <span>
            <Show when={typeof p?.qty === 'number'}>{`${p!.qty!} \u00d7 `}</Show>
            <ItemList items={p?.items} separator="" />
            <Show when={(p?.items?.length ?? 0) > 0 || typeof p?.qty === 'number'}> </Show>
            {p?.type_name ?? p?.type_code ?? '\u2014'}
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
      label={__('Correction edited')}
      detail={
        <Show when={fields}>
          <span>{fields}</span>
        </Show>
      }
    />
  );
}

function CorrectionUnprocessedRow(props: TimelineRowProps): JSX.Element {
  return (
    <RowShell
      event={props.event}
      tone="lifecycle"
      icon={<>↺</>}
      label={__('Correction unprocessed')}
    />
  );
}

function CorrectionsProcessedRow(props: TimelineRowProps): JSX.Element {
  const p = props.event.payload as { count?: number; items?: string[] } | null;
  return (
    <RowShell
      event={props.event}
      tone="decision"
      icon={<>✓</>}
      label={__('Corrections processed')}
      detail={
        <Show when={typeof p?.count === 'number'}>
          <span>
            {sprintf(
              _n(
                '%d correction committed in a single batch',
                '%d corrections committed in a single batch',
                p!.count!,
              ),
              p!.count!,
            )}
            <ItemList items={p?.items} />
          </span>
        </Show>
      }
    />
  );
}

// ---- lpsc.* -----------------------------------------------------

/** What the late-payment check decided, keyed by the `resolution` the backend records. */
const LPSC_RESOLUTION_LABEL: Record<string, () => string> = {
  cancel_fully: () => _x('the whole order is cancelled', 'late-payment check outcome'),
  accept_partial: () =>
    _x('what is in stock ships, the rest is refunded', 'late-payment check outcome'),
};

function LpscResolvedRow(props: TimelineRowProps): JSX.Element {
  const p = props.event.payload as { resolution?: string } | null;
  const outcome = (): string | undefined => LPSC_RESOLUTION_LABEL[p?.resolution ?? '']?.();
  return (
    <RowShell
      event={props.event}
      tone="decision"
      icon={<>?</>}
      label={__('LPSC resolved')}
      detail={
        <Show when={outcome()}>
          <span>{outcome()}</span>
        </Show>
      }
    />
  );
}

// ---- refund.* ---------------------------------------------------

interface MonetaryPayload {
  amount?: string;
  currency?: string;
}

function RefundScheduledRow(props: TimelineRowProps): JSX.Element {
  const p = props.event.payload as { total?: string; mode?: string; currency?: string } | null;
  return (
    <RowShell
      event={props.event}
      tone="decision"
      icon={<>⏱</>}
      label={__('Refund scheduled')}
      detail={
        <Show when={p?.total}>
          <span>
            <Money value={p?.total} currency={p?.currency} />
            {p?.mode ? ` · ${p.mode}` : ''}
          </span>
        </Show>
      }
    />
  );
}

function RefundConfirmedRow(props: TimelineRowProps): JSX.Element {
  const p = props.event.payload as {
    refund_total?: string;
    refund_mode?: string;
    currency?: string;
  } | null;
  return (
    <RowShell
      event={props.event}
      tone="lifecycle"
      icon={<>$</>}
      label={__('Refund confirmed')}
      detail={
        <Show when={p?.refund_total}>
          <span>
            <Money value={p?.refund_total} currency={p?.currency} />
            {p?.refund_mode ? ` · ${p.refund_mode}` : ''}
          </span>
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
      label={__('Refund in WooCommerce')}
      detail={
        <Show when={p?.refund_total}>
          <span>
            <Money value={p?.refund_total} currency={p?.currency} />
            {' · '}
            {__('outside Dispatch')}
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
      label={__('Refund failed')}
      detail={
        <Show when={p?.amount}>
          <span class="text-red-700">
            <Money value={p?.amount} currency={p?.currency} />
          </span>
        </Show>
      }
    />
  );
}

function RefundCancelledRow(props: TimelineRowProps): JSX.Element {
  return (
    <RowShell event={props.event} tone="execution" icon={<>⊘</>} label={__('Refund cancelled')} />
  );
}

// ---- payment.* --------------------------------------------------

/**
 * Monetary: `amount` / `currency` are what the payment brought in, in the order's currency. The
 * payment's own figure, how it came to be recorded and any difference accepted with it ride in
 * `extras`.
 */
interface PaymentRecordedPayload extends MonetaryPayload {
  extras?: {
    source?: string;
    payment_amount?: string;
    payment_currency?: string;
    difference_reason?: string | null;
  };
}

function PaymentRecordedRow(props: TimelineRowProps): JSX.Element {
  const p = props.event.payload as PaymentRecordedPayload | null;
  const x = (): PaymentRecordedPayload['extras'] => p?.extras;
  return (
    <RowShell
      event={props.event}
      tone="lifecycle"
      icon={<>$</>}
      label={__('Payment recorded')}
      detail={
        <Show when={p?.amount}>
          <span>
            <Money value={p?.amount} currency={p?.currency} />
            <Show when={x()?.payment_currency && x()?.payment_currency !== p?.currency}>
              {' ('}
              <Money value={x()?.payment_amount} currency={x()?.payment_currency} />
              {')'}
            </Show>
            <Show when={x()?.source}>
              {(source) => <>{` · ${paymentSourceLabel(source())}`}</>}
            </Show>
            <Show when={x()?.difference_reason}>
              {(reason) => <>{` · ${differenceReasonLabel(reason())}`}</>}
            </Show>
          </span>
        </Show>
      }
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
  ['order.source_deleted', 'dispatch.order.source_deleted', OrderSourceDeletedRow],
  ['order.address_corrected', 'dispatch.order.address_corrected', AddressCorrectedRow],
  [
    'order.address_changed_externally',
    'dispatch.order.address_changed_externally',
    AddressChangedExternallyRow,
  ],
  ['shipment.sent', 'dispatch.shipment.sent', ShipmentSentRow],
  ['correction.created', 'dispatch.correction.created', CorrectionCreatedRow],
  ['correction.edited', 'dispatch.correction.edited', CorrectionEditedRow],
  ['correction.deleted', 'dispatch.correction.deleted', CorrectionDeletedRow],
  ['correction.unprocessed', 'dispatch.correction.unprocessed', CorrectionUnprocessedRow],
  ['corrections.processed', 'dispatch.corrections.processed', CorrectionsProcessedRow],
  ['lpsc.resolved', 'dispatch.lpsc.resolved', LpscResolvedRow],
  ['refund.scheduled', 'dispatch.refund.scheduled', RefundScheduledRow],
  ['correction.refund_confirmed', 'dispatch.refund.confirmed', RefundConfirmedRow],
  ['refund.external', 'dispatch.refund.external', RefundExternalRow],
  ['refund.failed', 'dispatch.refund.failed', RefundFailedRow],
  ['refund.cancelled', 'dispatch.refund.cancelled', RefundCancelledRow],
  ['payment.recorded', 'dispatch.payment.recorded', PaymentRecordedRow],
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

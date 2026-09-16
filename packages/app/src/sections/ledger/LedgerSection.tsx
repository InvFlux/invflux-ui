import { ErrorBanner } from '@invflux/ui';
import { __, _x, sprintf } from '@invflux/i18n';
import { A, useParams } from '@solidjs/router';
import { createQuery } from '@tanstack/solid-query';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { useApp } from '../../context';
import { createApi } from '../../lib/api';
import { slotParts, stockCard, type StockCardCell } from './stockCard';

/** One resolved reference document: PO (goods receipt), order (reservation/booking/correction),
 *  shipment, or stock adjustment. `label` is the human id (PO number / WC order id) — or, for an
 *  adjustment, its reason; `sequence` is set for shipments, `discoveryContext`/`note` for
 *  adjustments. */
interface RefDocument {
  type: string;
  label: string;
  url: string | null;
  sequence?: number;
  discoveryContext?: string | null;
  note?: string | null;
}

interface LedgerRow {
  id: string;
  recordedAt: string;
  movementLabel: string;
  movementCode: string;
  fromSlot: string | null;
  toSlot: string | null;
  quantity: number;
  initialFrom: number | null;
  initialTo: number | null;
  actor: { typeCode: string | null; ref: string | null; name: string | null } | null;
  surface: { typeCode: string | null; ref: string | null; name: string | null } | null;
  refType: string | null;
  refId: number | null;
  refDocument: RefDocument | null;
  cost: { unitCost: string } | null;
}

/** One variation in the family, for the segmented switcher: its subject id + attribute label. */
interface LedgerSibling {
  subjectId: number;
  label: string;
}

interface LedgerResponse {
  subject: {
    subjectId: number;
    postId: number;
    postTitle: string;
    postType: string;
    sku: string;
    familyTitle: string;
  };
  cost: { weightedAvgCost: string | null; seedCost: string | null; currency: string | null } | null;
  rows: LedgerRow[];
  /** The variable-product family (empty for a simple product) — drives the variation switcher. */
  siblings: LedgerSibling[];
  capabilities: { viewCosts: boolean };
}

/** `from → to` with the moved quantity. */
function transition(row: LedgerRow): JSX.Element {
  if (0 === row.quantity) return <></>;

  const fromSlot = row.fromSlot ?? '∅';
  const finalQty = (initial: number | null, delta: number): JSX.Element =>
    initial === null ? (
      <></>
    ) : (
      <span class="text-xs text-text-muted">
        {initial} → {initial + delta}
      </span>
    );
  const toSlot = row.toSlot ?? '∅';
  const slot = (slot: string, init: number | null, delta: number): JSX.Element => (
    <span class="inline-flex flex-col items-center bg-surface-raised p-1 rounded-md">
      <span>{slot}</span>
      {finalQty(init, delta)}
    </span>
  );

  return (
    <div class="flex items-center gap-2">
      {slot(fromSlot, row.initialFrom, -row.quantity)}
      <span class="flex flex-col items-center">
        {row.quantity}
        <span>{'→'}</span>
      </span>
      {slot(toSlot, row.initialTo, row.quantity)}
    </div>
  );
}

/** The two ways to read the ledger: each movement as one transition, or each slot as one column. */
type LedgerView = 'transitions' | 'stock-card';

const LEDGER_VIEW_KEY = 'invflux:app:ledger:view';

/** The view this browser last chose; transitions when it chose none or storage is unavailable. */
function storedLedgerView(): LedgerView {
  try {
    return 'stock-card' === localStorage.getItem(LEDGER_VIEW_KEY) ? 'stock-card' : 'transitions';
  } catch {
    return 'transitions';
  }
}

/** What a state code means for the stock in it. Read at render time, so the active locale applies. */
function stateGloss(state: string): string | null {
  switch (state) {
    case 'atp':
      return _x(
        'available to promise — can be sold now',
        'stock slot state atp, explained in a tooltip',
      );
    case 'res':
      return _x(
        'reserved — held by a cart or checkout, released if it expires',
        'stock slot state res, explained in a tooltip',
      );
    case 'ctd':
      return _x(
        'committed — promised to a confirmed order',
        'stock slot state ctd, explained in a tooltip',
      );
    case 'pnd':
      return _x(
        'pending — on its way in, not yet available to promise',
        'stock slot state pnd, explained in a tooltip',
      );
    case 'qi':
      return _x(
        'quality inspection — on the premises, awaiting pass or fail',
        'stock slot state qi, explained in a tooltip',
      );
    case 'bkd':
      return _x(
        'blocked — on the premises, withheld pending a decision',
        'stock slot state bkd, explained in a tooltip',
      );
    default:
      return null;
  }
}

/** What a location means; a leaf (`oh/main`) is explained by its root. */
function locationGloss(location: string): string | null {
  const root = (prefix: string): boolean =>
    location === prefix || location.startsWith(`${prefix}/`);
  if (root('trs/inb'))
    return _x(
      'inbound transit — on its way to you',
      'stock slot location trs/inb, explained in a tooltip',
    );
  if (root('trs/dsp'))
    return _x(
      'dispatched — on its way to the customer',
      'stock slot location trs/dsp, explained in a tooltip',
    );
  if (root('trs/rto'))
    return _x(
      'returning — on its way back to you',
      'stock slot location trs/rto, explained in a tooltip',
    );
  if (root('oh'))
    return _x('on hand — in your stock', 'stock slot location oh, explained in a tooltip');
  if (root('sup'))
    return _x(
      'supplier side — not yet in your hands',
      'stock slot location sup, explained in a tooltip',
    );
  return null;
}

/**
 * A slot column's tooltip: the key, then one line per component in the order the key writes them —
 * its state and its location, each with what it means. A code this list does not know (an add-on's)
 * shows as the bare code rather than a guess.
 */
function slotTooltip(slot: string): string {
  const { location, state } = slotParts(slot);
  const stateMeaning = stateGloss(state);
  const locationMeaning = locationGloss(location);
  const stateLine =
    '' === state
      ? null
      : null === stateMeaning
        ? sprintf(
            /* translators: %s: a stock state code with no known meaning, e.g. one an add-on registered */
            _x('State %s', 'ledger slot tooltip: names the state part of a slot key'),
            state,
          )
        : sprintf(
            /* translators: 1: a stock state code such as "atp", 2: what that state means */
            _x('State %1$s: %2$s', 'ledger slot tooltip: a state code, then what it means'),
            state,
            stateMeaning,
          );
  const locationLine =
    null === locationMeaning
      ? sprintf(
          /* translators: %s: a stock location code with no known meaning, e.g. one an add-on registered */
          _x('Location %s', 'ledger slot tooltip: names the location part of a slot key'),
          location,
        )
      : sprintf(
          /* translators: 1: a stock location code such as "oh", 2: what that location means */
          _x('Location %1$s: %2$s', 'ledger slot tooltip: a location code, then what it means'),
          location,
          locationMeaning,
        );
  const stateFirst = '' !== state && slot.startsWith(`${state}.`);
  const lines: Array<string | null> = stateFirst
    ? [stateLine, locationLine]
    : [locationLine, stateLine];
  return [slot, ...lines.filter((l): l is string => null !== l)].join('\n');
}

/** A change with its sign, using a true minus so the column's digits line up. */
function signed(change: number): string {
  if (change > 0) return `+${change}`;
  return change < 0 ? `−${-change}` : '0';
}

/** One slot on one row of the stock card: the change this movement made and the balance after it,
 *  or — for a slot the row did not touch — the balance it carried, muted. A balance that disagrees
 *  with the previous row's is marked, with both values in its tooltip. */
function StockCardCellView(props: { cell: StockCardCell | undefined }): JSX.Element {
  const cell = (): StockCardCell => props.cell ?? { balance: null, change: null };
  const gapTitle = (): string | undefined => {
    const { balance, change, expectedBefore } = cell();
    if (undefined === expectedBefore || null === balance || null === change) return undefined;
    return sprintf(
      /* translators: 1: slot balance recorded before this movement, 2: balance the previous movement left */
      __(
        'The balance before this movement is recorded as %1$d, but the movement before it left %2$d.',
      ),
      balance - change,
      expectedBefore,
    );
  };
  return (
    <td
      class="px-3 py-2 whitespace-nowrap text-right font-mono text-xs tabular-nums"
      classList={{ 'bg-amber-50': undefined !== gapTitle() }}
      title={gapTitle()}
      data-gap={undefined !== gapTitle() ? '' : undefined}
    >
      <Show
        when={null !== cell().change}
        fallback={<span class="text-text-muted">{cell().balance ?? ''}</span>}
      >
        <div
          classList={{
            'text-emerald-700': (cell().change ?? 0) > 0,
            'text-red-700': (cell().change ?? 0) < 0,
          }}
        >
          {signed(cell().change ?? 0)}
        </div>
        <div class="font-semibold text-text">{cell().balance ?? '?'}</div>
      </Show>
    </td>
  );
}

/** The raw `{type}:{ref}` pair — the actor as the ledger stores it. */
function actorKey(row: LedgerRow): string {
  if (!row.actor) return '—';
  const parts = [row.actor.typeCode, row.actor.ref].filter(Boolean);
  return parts.length > 0 ? parts.join(':') : '—';
}

/** Actor cell — the named principal, over the raw key it resolves from (a system/plugin actor has no
 *  name, so its key carries the whole cell rather than being repeated under a placeholder). */
function ActorCell(props: { row: LedgerRow }): JSX.Element {
  const name = (): string | null => props.row.actor?.name ?? null;
  return (
    <Show when={name()} fallback={<span>{actorKey(props.row)}</span>}>
      {(resolved) => (
        <>
          <span>{resolved()}</span>
          <br />
          <span class="font-mono text-xs text-text-muted">{actorKey(props.row)}</span>
        </>
      )}
    </Show>
  );
}

function surfaceLabel(row: LedgerRow): string {
  if (!row.surface) return '—';
  const parts = [row.surface.typeCode, row.surface.name ?? row.surface.ref].filter(Boolean);
  return parts.length > 0 ? parts.join(':') : '—';
}

/** A human prefix before the linked id, by resolved-document type. Raw ids come from PHP; the
 *  "Order"/"#" decoration is UI-side. Order/shipment → "Order #2325"; PO → "PO-68" (self-labelling). */
function refPrefix(type: string): string {
  return type === 'order' || type === 'shipment' ? `${__('Order')} ` : '';
}

/** The linked text for a resolved document — orders/shipments get a `#` before the sequential id. */
function refLinkText(doc: RefDocument): string {
  return doc.type === 'order' || doc.type === 'shipment' ? `#${doc.label}` : doc.label;
}

/** Trailing detail after the linked id — a shipment appends its per-order number, e.g. " - shipment #2". */
function refSuffix(doc: RefDocument): string {
  return doc.type === 'shipment' && doc.sequence != null
    ? ` - ${__('shipment')} #${doc.sequence}`
    : '';
}

/** A stock adjustment references no document — it *is* the movement. So the cell reads as what the
 *  operator asserted: what the change reflects (the disposition), how it was noticed (the discovery
 *  context, on the same line — the two are one sentence), and their note under both. */
function AdjustmentRef(props: { doc: RefDocument }): JSX.Element {
  return (
    <>
      <span>{props.doc.label}</span>
      <Show when={props.doc.discoveryContext}>
        {(context) => <span class="text-xs text-text-muted"> · {context()}</span>}
      </Show>
      <Show when={props.doc.note}>
        {(note) => <div class="text-xs text-slate-500 italic">{note()}</div>}
      </Show>
    </>
  );
}

/** Reference cell — a labelled, linked named document when resolved, else the raw `{type} #{id}`. */
function ReferenceCell(props: { row: LedgerRow }): JSX.Element {
  const doc = (): RefDocument | null => props.row.refDocument;
  const fallback = (): string => {
    const { refType, refId } = props.row;
    if (!refType) return '—';
    return refId === null ? refType : `${refType} #${refId}`;
  };
  return (
    <Show when={doc()} fallback={<span class="text-slate-500">{fallback()}</span>}>
      {(d) => (
        <Show when={d().type !== 'stock_adjustment'} fallback={<AdjustmentRef doc={d()} />}>
          <span>
            {refPrefix(d().type)}
            <Show when={d().url} fallback={<span>{refLinkText(d())}</span>}>
              {(url) => (
                <A href={url()} class="text-primary hover:underline">
                  {refLinkText(d())}
                </A>
              )}
            </Show>
            {refSuffix(d())}
          </span>
        </Show>
      )}
    </Show>
  );
}

/**
 * Per-product inventory-ledger inspector. Deep-linked from any domain surface
 * (`#/ledger/{subjectId}`); reads `GET invflux/v1/subjects/{subjectId}/ledger`, which resolves
 * references to named, linked documents (goods receipt → purchase order) and — for users with
 * `invflux_view_costs` — includes WAC/seed cost and a per-row acquisition-cost column (blank for
 * non-valued movements).
 */
export default function LedgerSection(): JSX.Element {
  const app = useApp();
  const api = createApi(app);
  const params = useParams<{ subjectId: string }>();

  const query = createQuery(() => ({
    queryKey: ['ledger', params.subjectId],
    queryFn: () => api.get<LedgerResponse>(`/subjects/${params.subjectId}/ledger`),
  }));

  const showCosts = (): boolean => query.data?.capabilities.viewCosts ?? false;

  const [view, setView] = createSignal<LedgerView>(storedLedgerView());
  const chooseView = (next: LedgerView): void => {
    setView(next);
    try {
      localStorage.setItem(LEDGER_VIEW_KEY, next);
    } catch {
      // Not remembered across visits; the choice still holds for this one.
    }
  };
  const card = createMemo(() => stockCard(query.data?.rows ?? []));
  const viewOptions = (): Array<{ id: LedgerView; label: string }> => [
    {
      id: 'transitions',
      label: _x(
        'Transitions',
        'ledger view toggle: one column showing each movement from slot to slot',
      ),
    },
    {
      id: 'stock-card',
      label: _x(
        'Stock card',
        'ledger view toggle: one column per stock slot, with its balance on every row',
      ),
    },
  ];

  // Variation switcher state. A variable-product family exposes one segment per variation; the current
  // subject is either one of them (a variation — show its ledger) or the variable parent (not among
  // the siblings — show the control with nothing selected + a prompt, i.e. blank until a variation is
  // picked). Clicking a segment navigates same-tab to that variation's ledger.
  const currentId = (): number => Number(params.subjectId);
  const siblings = (): LedgerSibling[] => query.data?.siblings ?? [];
  const selected = (): LedgerSibling | undefined =>
    siblings().find((s) => s.subjectId === currentId());
  const isParentView = (): boolean => siblings().length > 0 && selected() === undefined;

  const money = (value: string | null, currency: string | null): string =>
    value === null ? '—' : `${value}${currency ? ` ${currency}` : ''}`;

  return (
    <div class="p-4 bg-ground">
      <Show
        when={query.data}
        fallback={
          <Show
            when={query.isError}
            fallback={<p class="text-sm text-slate-500">{__('Loading ledger…')}</p>}
          >
            <ErrorBanner class="text-sm">
              {query.error instanceof Error && query.error.message.includes('404')
                ? __('This product is not synced to an InvFlux subject.')
                : __('Could not load the ledger.')}
            </ErrorBanner>
          </Show>
        }
      >
        {(data) => (
          <>
            {/* Header: subject identity + (cost-gated) valuation. For a variable product the title is
                the family (parent) name; the segmented control below switches between variations. */}
            <header class="mb-4">
              <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 class="text-lg font-semibold text-slate-900">
                  {data().subject.familyTitle ||
                    data().subject.postTitle ||
                    `#${data().subject.postId}`}
                </h1>
                <Show when={siblings().length > 0}>
                  <div
                    class="inline-flex flex-wrap gap-0.5 rounded-md bg-slate-100 p-0.5"
                    role="tablist"
                  >
                    <For each={siblings()}>
                      {(s) => (
                        <A
                          href={`/ledger/${s.subjectId}`}
                          role="tab"
                          aria-selected={s.subjectId === currentId()}
                          class="rounded px-2.5 py-1 text-sm font-medium no-underline transition-colors"
                          classList={{
                            'bg-surface text-slate-900 shadow-sm': s.subjectId === currentId(),
                            'text-slate-600 hover:text-slate-900': s.subjectId !== currentId(),
                          }}
                        >
                          {s.label}
                        </A>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
              <dl class="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
                <div>
                  <dt class="inline text-text-muted">{__('SKU')}: </dt>
                  <dd class="inline font-mono">{data().subject.sku || '—'}</dd>
                </div>
                <div>
                  <dt class="inline text-text-muted">{__('Woo post')}: </dt>
                  <dd class="inline font-mono">{data().subject.postId}</dd>
                </div>
                <div>
                  <dt class="inline text-text-muted">{__('Subject')}: </dt>
                  <dd class="inline font-mono">{data().subject.subjectId}</dd>
                </div>
                <Show when={data().cost}>
                  {(cost) => (
                    <>
                      <div>
                        <dt class="inline text-text-muted">{__('WAC')}: </dt>
                        <dd class="inline font-mono">
                          {money(cost().weightedAvgCost, cost().currency)}
                        </dd>
                      </div>
                      <div>
                        <dt class="inline text-text-muted">{__('Unit cost')}: </dt>
                        <dd class="inline font-mono">{money(cost().seedCost, cost().currency)}</dd>
                      </div>
                    </>
                  )}
                </Show>
              </dl>
            </header>

            <Show
              when={!isParentView()}
              fallback={
                <p class="text-sm text-slate-500">
                  {__('Select a variation above to view its stock ledger.')}
                </p>
              }
            >
              <Show
                when={data().rows.length > 0}
                fallback={
                  <p class="text-sm text-slate-500">{__('No stock movements recorded.')}</p>
                }
              >
                <div class="mb-2 flex justify-end">
                  <div
                    class="inline-flex gap-0.5 rounded-md bg-slate-100 p-0.5"
                    role="radiogroup"
                    aria-label={__('Ledger view')}
                    data-testid="ledger-view-toggle"
                  >
                    <For each={viewOptions()}>
                      {(option) => (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={view() === option.id}
                          data-view={option.id}
                          class="rounded px-2.5 py-1 text-xs font-medium transition-colors"
                          classList={{
                            'bg-surface text-slate-900 shadow-sm': view() === option.id,
                            'text-slate-600 hover:text-slate-900': view() !== option.id,
                          }}
                          onClick={() => chooseView(option.id)}
                        >
                          {option.label}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
                <div class="overflow-x-auto rounded border border-slate-200">
                  <table
                    class="w-full min-w-[720px] text-left text-sm"
                    data-testid="ledger-table"
                    data-view={view()}
                  >
                    <thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th class="px-3 py-2">{__('Timestamp')}</th>
                        <th class="px-3 py-2">{__('Movement')}</th>
                        <Show
                          when={'stock-card' === view()}
                          fallback={<th class="px-3 py-2">{__('Transition')}</th>}
                        >
                          <For each={card().slots}>
                            {(slot) => (
                              <th
                                class="cursor-help px-3 py-2 text-right font-mono normal-case"
                                title={slotTooltip(slot)}
                              >
                                {slot}
                              </th>
                            )}
                          </For>
                        </Show>
                        <th class="px-3 py-2">{__('Actor')}</th>
                        <th class="px-3 py-2">{__('Surface')}</th>
                        <th class="px-3 py-2">{__('Reference')}</th>
                        <Show when={showCosts()}>
                          <th class="px-3 py-2 text-right">{__('Unit cost')}</th>
                        </Show>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                      <For each={data().rows}>
                        {(row, index) => (
                          <tr class="hover:bg-slate-50">
                            <td class="px-3 py-2 whitespace-nowrap font-mono text-xs text-slate-500">
                              {row.recordedAt}
                            </td>
                            <td class="px-3 py-2">
                              <span>{row.movementLabel}</span>
                              <br />
                              <span class="font-mono text-xs text-text-muted">
                                {row.movementCode}
                              </span>
                            </td>
                            <Show
                              when={'stock-card' === view()}
                              fallback={
                                <td class="px-3 py-2 whitespace-nowrap font-mono text-xs">
                                  {transition(row)}
                                </td>
                              }
                            >
                              <For each={card().slots}>
                                {(_slot, col) => (
                                  <StockCardCellView cell={card().cells[index()]?.[col()]} />
                                )}
                              </For>
                            </Show>
                            <td class="px-3 py-2 text-slate-600">
                              <ActorCell row={row} />
                            </td>
                            <td class="px-3 py-2 text-slate-600">{surfaceLabel(row)}</td>
                            <td class="px-3 py-2">
                              <ReferenceCell row={row} />
                            </td>
                            <Show when={showCosts()}>
                              <td class="px-3 py-2 text-right font-mono">
                                {row.cost ? row.cost.unitCost : '—'}
                              </td>
                            </Show>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
                <p class="mt-2 text-xs text-text-muted">
                  {sprintf(
                    /* translators: %d: number of ledger rows shown */
                    __('Showing the %d most recent movements.'),
                    data().rows.length,
                  )}
                </p>
              </Show>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

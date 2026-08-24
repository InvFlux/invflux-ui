import { __, sprintf } from '@invflux/i18n';
import { A, useParams } from '@solidjs/router';
import { createQuery } from '@tanstack/solid-query';
import { For, type JSX, Show } from 'solid-js';
import { useApp } from '../../context';
import { createApi } from '../../lib/api';

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
  subject: { subjectId: number; postId: number; postTitle: string; postType: string; sku: string; familyTitle: string };
  cost: { weightedAvgCost: string | null; seedCost: string | null; currency: string | null } | null;
  rows: LedgerRow[];
  /** The variable-product family (empty for a simple product) — drives the variation switcher. */
  siblings: LedgerSibling[];
  capabilities: { viewCosts: boolean };
}

/** `from → to` with the moved quantity. */
function transition(row: LedgerRow): JSX.Element {
  if (0 === row.quantity)
    return <></>;

  const fromSlot = row.fromSlot ?? '∅';
  const finalQty = (initial: number | null, delta: number): JSX.Element => (initial === null
    ? <></>
    : <span class='text-xs text-text-muted'>{initial} → {initial + delta}</span>
  );
  const toSlot = row.toSlot ?? '∅';
  const slot = (slot: string, init: number | null, delta: number): JSX.Element => (
    <span class='inline-flex flex-col items-center bg-gray-100 p-1 rounded-md'>
      <span>{slot}</span>
      {finalQty(init, delta)}
    </span>
  );


  return <div class='flex items-center gap-2'>
    {slot(fromSlot, row.initialFrom, -row.quantity)}
    <span class='flex flex-col items-center'>
      {row.quantity}
      <span>{'→'}</span>
    </span>
    {slot(toSlot, row.initialTo, row.quantity)}
  </div>
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
          <span>{resolved()}</span><br/>
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

  // Variation switcher state. A variable-product family exposes one segment per variation; the current
  // subject is either one of them (a variation — show its ledger) or the variable parent (not among
  // the siblings — show the control with nothing selected + a prompt, i.e. blank until a variation is
  // picked). Clicking a segment navigates same-tab to that variation's ledger.
  const currentId = (): number => Number(params.subjectId);
  const siblings = (): LedgerSibling[] => query.data?.siblings ?? [];
  const selected = (): LedgerSibling | undefined => siblings().find((s) => s.subjectId === currentId());
  const isParentView = (): boolean => siblings().length > 0 && selected() === undefined;

  const money = (value: string | null, currency: string | null): string =>
    value === null ? '—' : `${value}${currency ? ` ${currency}` : ''}`;

  return (
    <div class="p-4">
      <Show
        when={query.data}
        fallback={
          <Show
            when={query.isError}
            fallback={<p class="text-sm text-slate-500">{__('Loading ledger…')}</p>}
          >
            <p class="text-sm text-red-700">
              {query.error instanceof Error && query.error.message.includes('404')
                ? __('This product is not synced to an InvFlux subject.')
                : __('Could not load the ledger.')}
            </p>
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
                  {data().subject.familyTitle || data().subject.postTitle || `#${data().subject.postId}`}
                </h1>
                <Show when={siblings().length > 0}>
                  <div class="inline-flex flex-wrap gap-0.5 rounded-md bg-slate-100 p-0.5" role="tablist">
                  <For each={siblings()}>
                    {(s) => (
                      <A
                        href={`/ledger/${s.subjectId}`}
                        role="tab"
                        aria-selected={s.subjectId === currentId()}
                        class="rounded px-2.5 py-1 text-sm font-medium no-underline transition-colors"
                        classList={{
                          'bg-white text-slate-900 shadow-sm': s.subjectId === currentId(),
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
                        <dd class="inline font-mono">{money(cost().weightedAvgCost, cost().currency)}</dd>
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
                fallback={<p class="text-sm text-slate-500">{__('No stock movements recorded.')}</p>}
              >
              <div class="overflow-x-auto rounded border border-slate-200">
                <table class="w-full min-w-[720px] text-left text-sm">
                  <thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th class="px-3 py-2">{__('Timestamp')}</th>
                      <th class="px-3 py-2">{__('Movement')}</th>
                      <th class="px-3 py-2">{__('Transition')}</th>
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
                      {(row) => (
                        <tr class="hover:bg-slate-50">
                          <td class="px-3 py-2 whitespace-nowrap font-mono text-xs text-slate-500">{row.recordedAt}</td>
                          <td class="px-3 py-2">
                            <span>{row.movementLabel}</span><br/>
                            <span class="font-mono text-xs text-text-muted">{row.movementCode}</span>
                          </td>
                          <td class="px-3 py-2 whitespace-nowrap font-mono text-xs">{transition(row)}</td>
                          <td class="px-3 py-2 text-slate-600"><ActorCell row={row} /></td>
                          <td class="px-3 py-2 text-slate-600">{surfaceLabel(row)}</td>
                          <td class="px-3 py-2">
                            <ReferenceCell row={row} />
                          </td>
                          <Show when={showCosts()}>
                            <td class="px-3 py-2 text-right font-mono">{row.cost ? row.cost.unitCost : '—'}</td>
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

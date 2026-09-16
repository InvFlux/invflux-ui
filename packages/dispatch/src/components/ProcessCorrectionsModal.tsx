import { For, Index, Show, createMemo, createSignal } from 'solid-js';
import { __, _n, _x, formatDateTime, sprintf } from '@invflux/i18n';
import {
  Button,
  ErrorBanner,
  IconButton,
  Modal,
  menuItemClass,
  type TimelineEvent,
  ModalFooter,
  ModalHeader,
  ModalPanel,
} from '@invflux/ui';
import { hasDiscount } from '../lineRefund';
import { useOrderEventsQuery, useProcessCorrectionsMutation } from '../queries';
import type {
  CorrectionRefundConfirmedPayload,
  DispatchCorrection,
  DispatchOrderLine,
  DispatchOrderSummary,
} from '../types';

/** One operator-entered manual adjustment row (§9.3). `amount` is a magnitude
 * string; the sign comes from `kind`. Rows are addressed by position
 * (rendered via <Index>), so no stable id is needed. */
type AdjustmentRow = {
  kind: 'reduce' | 'increase';
  description: string;
  amount: string;
};

/**
 * Batch correction-processing modal. Opens when the operator clicks
 * "Process N corrections" on the panel.
 *
 * Layout:
 *
 *   - §9.1 Table of pending corrections (type, item, qty, unit price, total).
 *   - §9.2 Optional shipping row.
 *   - §9.3 Manual adjustment rows (+ Reduce / + Increase, described, net-clamped).
 *   - §9.4 Batch total row.
 *   - §9.5 Previously-corrected fold (prior `correction.refund_confirmed` events).
 *   - §9.6 Remaining-revenue formula with per-term tooltips.
 *   - Footer: customer/order context + attestation + Cancel / Refund & process.
 */
export function ProcessCorrectionsModal(props: {
  orderHexId: string;
  order: DispatchOrderSummary;
  corrections: DispatchCorrection[];
  lines: DispatchOrderLine[];
  onClose: () => void;
}) {
  const processMutation = useProcessCorrectionsMutation(() => props.orderHexId);

  const pending = createMemo<DispatchCorrection[]>(() =>
    props.corrections.filter((c) => c.processedAt === null),
  );

  const linesById = createMemo(() => {
    const map = new Map<string, DispatchOrderLine>();
    for (const line of props.lines) map.set(line.id, line);
    return map;
  });

  // Batch-level state
  const [refundShipping, setRefundShipping] = createSignal(false);
  const [manualConfirmed, setManualConfirmed] = createSignal(false);
  const [foldOpen, setFoldOpen] = createSignal(false);
  const [adjustments, setAdjustments] = createSignal<AdjustmentRow[]>([]);

  // Prior refund events (§9.5) — drive the "previously corrected" fold.
  const eventsQuery = useOrderEventsQuery(
    () => props.orderHexId,
    () => true,
  );
  const priorEvents = createMemo(() =>
    (eventsQuery.data?.events ?? []).filter((e) => e.type === 'correction.refund_confirmed'),
  );
  const priorRefunds = createMemo<CorrectionRefundConfirmedPayload[]>(() =>
    priorEvents()
      .map((e) => e.payload as CorrectionRefundConfirmedPayload)
      .filter((p): p is CorrectionRefundConfirmedPayload => !!p && Array.isArray(p.line_items)),
  );
  const priorCount = createMemo(() => priorRefunds().reduce((n, p) => n + p.line_items.length, 0));
  const priorRefundedTotal = createMemo(() =>
    priorRefunds().reduce((sum, p) => sum + parseAmount(p.refund_total), 0),
  );

  // The first two are the host's own gateway naming; the last is ours, and is read aloud in the
  // attestation sentence, so it needs a translation like any other word we write.
  const gatewayLabel = createMemo(
    () => props.order.paymentMethodTitle ?? props.order.paymentMethod ?? __('the payment gateway'),
  );

  const supportsRefunds = () => props.order.paymentSupportsRefunds === true;

  const shippingTotal = createMemo(() => parseAmount(props.order.shippingTotal));
  const orderTotal = createMemo(() => parseAmount(props.order.orderTotal));
  const pastRefunds = createMemo(() => parseAmount(props.order.pastRefundsTotal));

  const showShippingRow = createMemo(
    () => shippingTotal() > 0 && props.order.shippingAlreadyRefunded !== true,
  );

  const correctionTotal = createMemo(() =>
    pending().reduce((sum, c) => sum + parseAmount(c.refundAmount), 0),
  );

  const shippingAmount = createMemo(() =>
    refundShipping() && showShippingRow() ? shippingTotal() : 0,
  );

  // Signed contribution of one adjustment row.
  const signedOf = (a: AdjustmentRow) => (a.kind === 'reduce' ? -1 : 1) * parseAmount(a.amount);

  const netAdjustment = createMemo(() => adjustments().reduce((sum, a) => sum + signedOf(a), 0));

  // Order is already fully refunded → block (§9.3 edge case).
  const alreadyFullyRefunded = createMemo(
    () => orderTotal() > 0 && pastRefunds() >= orderTotal() - 0.005,
  );

  const newRefundTotal = createMemo(() =>
    Math.max(0, correctionTotal() + shippingAmount() + netAdjustment()),
  );

  const remainingRevenue = createMemo(() => orderTotal() - pastRefunds() - newRefundTotal());

  // Net-clamp bounds: net adjustment keeps the batch total in [0, order_total − past_refunds].
  const corrShip = createMemo(() => correctionTotal() + shippingAmount());
  const floorNet = createMemo(() => -corrShip());
  const ceilNet = createMemo(() => orderTotal() - pastRefunds() - corrShip());

  function addAdjustment(kind: 'reduce' | 'increase') {
    setAdjustments((prev) => [...prev, { kind, description: '', amount: '0.00' }]);
  }
  function removeAdjustment(index: number) {
    setAdjustments((prev) => prev.filter((_, i) => i !== index));
  }
  function patchDescription(index: number, description: string) {
    setAdjustments((prev) => prev.map((a, i) => (i === index ? { ...a, description } : a)));
  }
  // Clamp the magnitude so the running net stays within bounds (§9.3).
  function patchAmount(index: number, raw: string) {
    setAdjustments((prev) => {
      const row = prev[index];
      if (!row) return prev;
      const otherNet = prev.reduce((s, a, i) => (i === index ? s : s + signedOf(a)), 0);
      const mag = Math.max(0, parseAmount(raw));
      const cap =
        row.kind === 'reduce'
          ? Math.max(0, otherNet - floorNet()) // room to go down
          : Math.max(0, ceilNet() - otherNet); // room to go up
      const clamped = Math.min(mag, cap);
      // Preserve the raw text while it's a valid in-range partial (so typing
      // "1" before "12" isn't fought); otherwise snap to the clamped value.
      const next = mag === clamped ? raw : clamped.toFixed(2);
      return prev.map((a, i) => (i === index ? { ...a, amount: next } : a));
    });
  }

  const needsAttestation = createMemo(() => !supportsRefunds() && newRefundTotal() > 0);
  const canProcess = createMemo(
    () => !alreadyFullyRefunded() && (!needsAttestation() || manualConfirmed()),
  );

  function handleProcess() {
    processMutation.mutate(
      {
        refundShipping: refundShipping(),
        adjustments: adjustments()
          .filter((a) => parseAmount(a.amount) > 0)
          .map((a) => ({ description: a.description, amount: signedOf(a).toFixed(2) })),
        manualConfirmed: manualConfirmed(),
      },
      { onSuccess: () => props.onClose() },
    );
  }

  const fmt = (n: number) => n.toFixed(2);

  /** The attestation sentence, split on its `%s` so the gateway name can be re-emphasised. */
  const attestationParts = createMemo(() =>
    __(
      'I understand that %s requires a manual refund to be issued outside WooCommerce (e.g. via bank transfer). I confirm this will be handled.',
    ).split('%s'),
  );
  const unitPriceOf = (c: DispatchCorrection) =>
    c.qty > 0 ? parseAmount(c.refundAmount) / c.qty : parseAmount(c.refundAmount);

  const processLabel = createMemo(() => {
    const n = pending().length;
    if (processMutation.isPending) return __('Processing…');
    // Built as two whole sentences rather than a stem plus an appended noun: pluralising by
    // concatenating an "s" has no meaning outside English, and it leaves a translator with a
    // fragment they cannot inflect or reorder.
    return newRefundTotal() > 0
      ? sprintf(
          _n('Refund %1$s & process %2$d correction', 'Refund %1$s & process %2$d corrections', n),
          fmt(newRefundTotal()),
          n,
        )
      : sprintf(
          _n('Process %d correction (no refund)', 'Process %d corrections (no refund)', n),
          n,
        );
  });

  return (
    <Modal onClose={props.onClose} label={__('Process corrections')}>
      <ModalPanel size="2xl">
        <ModalHeader
          title={sprintf(
            _n('Process %d correction', 'Process %d corrections', pending().length),
            pending().length,
          )}
          actions={
            <>
              <Show when={props.order.wcOrderEditUrl}>
                {(url) => (
                  <a
                    href={url()}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-xs text-blue-600 hover:underline"
                  >
                    {sprintf(__('WC order #%s'), props.order.externalId)} ↗
                  </a>
                )}
              </Show>
              <Show
                when={!supportsRefunds() && pending().some((c) => parseAmount(c.refundAmount) > 0)}
              >
                <span class="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                  {/* The gateway's own name is host data, so it is interpolated rather than
                      concatenated — a translation may need it somewhere other than the front. */}
                  {sprintf(__('%s — manual refund required'), gatewayLabel())}
                </span>
              </Show>
            </>
          }
        />

        {/* Body */}
        <div class="flex-1 overflow-y-auto">
          <Show when={pending().length === 0}>
            <div class="px-4 py-8 text-sm text-gray-500 text-center">
              {__('No pending corrections — already processed.')}
            </div>
          </Show>

          <Show when={alreadyFullyRefunded()}>
            <div class="px-4 py-2 text-sm bg-amber-50 text-amber-800 border-b border-amber-100">
              {__('This order is already fully refunded — no further refund can be issued.')}
            </div>
          </Show>

          <Show when={pending().length > 0}>
            {/* §9.1 Corrections table */}
            <table class="w-full text-sm border-b border-gray-100">
              <thead>
                <tr class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th class="px-4 py-2 text-left font-medium">
                    {_x('Type', 'refund table column')}
                  </th>
                  <th class="px-4 py-2 text-left font-medium">
                    {_x('Item', 'refund table column')}
                  </th>
                  <th class="px-4 py-2 text-right font-medium w-12">
                    {_x('Qty', 'refund table column')}
                  </th>
                  <th class="px-4 py-2 text-right font-medium w-24">{__('Unit price')}</th>
                  <th class="px-4 py-2 text-right font-medium w-28">
                    {_x('Total', 'refund table column')}
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                <For each={pending()}>
                  {(c) => {
                    const line = linesById().get(c.lineId);
                    const hasRefund = parseAmount(c.refundAmount) > 0;
                    return (
                      <tr class="hover:bg-gray-50">
                        <td class="px-4 py-2 text-gray-700">{c.typeName}</td>
                        <td class="px-4 py-2 text-gray-600 truncate max-w-[16ch]">
                          {line ? line.name : c.lineId.slice(0, 8) + '…'}
                        </td>
                        <td class="px-4 py-2 text-right tabular-nums text-gray-700">{c.qty}</td>
                        <td class="px-4 py-2 text-right tabular-nums text-gray-600">
                          <Show
                            when={hasRefund}
                            fallback={<span class="text-text-muted text-xs">—</span>}
                          >
                            {/* The price paid is what is refunded; a discounted line keeps its
                                list price beside it, struck, so the row still reads against the
                                host order. */}
                            <Show when={line && hasDiscount(line)}>
                              <s
                                class="mr-1 text-xs text-text-muted"
                                title={__('Price before discount')}
                              >
                                {fmt(parseAmount(line?.unitPrice ?? '0'))}
                              </s>
                            </Show>
                            {fmt(unitPriceOf(c))}
                          </Show>
                        </td>
                        <td class="px-4 py-2 text-right tabular-nums">
                          <Show
                            when={hasRefund}
                            fallback={<span class="text-text-muted text-xs">—</span>}
                          >
                            <span class="text-gray-900">{fmt(parseAmount(c.refundAmount))}</span>
                          </Show>
                        </td>
                      </tr>
                    );
                  }}
                </For>

                {/* §9.2 Shipping row */}
                <Show when={showShippingRow()}>
                  <tr class={`hover:bg-gray-50 ${!refundShipping() ? 'opacity-50' : ''}`}>
                    <td class="px-4 py-2 text-gray-700">
                      {_x('Shipping', 'refund table row: the shipping charge on the order')}
                    </td>
                    <td class="px-4 py-2 text-text-muted text-xs italic" colSpan={3}>
                      {__('included in order')}
                    </td>
                    <td class="px-4 py-2 text-right tabular-nums">
                      <label class="flex items-center justify-end gap-2 cursor-pointer">
                        <span class={`text-gray-900 ${!refundShipping() ? 'line-through' : ''}`}>
                          {fmt(shippingTotal())}
                        </span>
                        <input
                          type="checkbox"
                          checked={refundShipping()}
                          onChange={(e) =>
                            setRefundShipping((e.currentTarget as HTMLInputElement).checked)
                          }
                          title={__('Include shipping in refund')}
                        />
                      </label>
                    </td>
                  </tr>
                </Show>

                {/* §9.3 Manual adjustment rows — Index (not For) so editing a
                    row's value doesn't recreate its <input> DOM node mid-keystroke. */}
                <Index each={adjustments()}>
                  {(a, i) => (
                    <tr class="bg-amber-50/40">
                      <td class="px-4 py-1.5 text-gray-600 text-xs whitespace-nowrap">
                        {__('Manual refund adjustment')}
                      </td>
                      <td class="px-2 py-1.5" colSpan={3}>
                        <input
                          type="text"
                          class="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                          placeholder={__('Description (e.g. goodwill, return-shipping split)')}
                          value={a().description}
                          onInput={(e) =>
                            patchDescription(i, (e.currentTarget as HTMLInputElement).value)
                          }
                        />
                      </td>
                      <td class="px-2 py-1.5">
                        <div class="flex items-center justify-end gap-1">
                          <span
                            class={`text-sm tabular-nums ${a().kind === 'reduce' ? 'text-red-600' : 'text-emerald-700'}`}
                          >
                            {a().kind === 'reduce' ? '−' : '+'}
                          </span>
                          <input
                            aria-label={__('Amount')}
                            type="text"
                            inputmode="decimal"
                            class="border border-gray-300 rounded px-2 py-1 text-sm w-20 text-right tabular-nums"
                            value={a().amount}
                            onInput={(e) =>
                              patchAmount(i, (e.currentTarget as HTMLInputElement).value)
                            }
                          />
                          <IconButton
                            size="xs"
                            danger
                            label={__('Remove adjustment')}
                            onClick={() => removeAdjustment(i)}
                          >
                            ✕
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  )}
                </Index>

                {/* Add-adjustment buttons */}
                <tr>
                  <td class="px-4 py-1.5" colSpan={5}>
                    <div class="flex gap-2">
                      <Button variant="secondary" size="sm" onClick={() => addAdjustment('reduce')}>
                        {__('+ Reduce refund')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => addAdjustment('increase')}
                      >
                        {__('+ Increase refund')}
                      </Button>
                    </div>
                  </td>
                </tr>

                {/* §9.4 Batch total */}
                <tr class="font-medium border-t border-gray-200">
                  <td class="px-4 py-2 text-gray-700" colSpan={4}>
                    {__('Total refund')}
                  </td>
                  <td class="px-4 py-2 text-right tabular-nums text-gray-900">
                    {fmt(newRefundTotal())}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* §9.5 Previously corrected — folded section */}
            <Show when={priorRefunds().length > 0}>
              <div class="border-b border-gray-100">
                <button
                  type="button"
                  class={menuItemClass(false, false, 'justify-between px-4 py-2')}
                  onClick={() => setFoldOpen((v) => !v)}
                >
                  <span>
                    <span class="text-text-muted mr-1">{foldOpen() ? '▾' : '▸'}</span>
                    {sprintf(
                      _n(
                        '%d correction previously processed',
                        '%d corrections previously processed',
                        priorCount(),
                      ),
                      priorCount(),
                    )}
                    {' · '}
                    <span class="tabular-nums">
                      {sprintf(__('%s refunded'), fmt(priorRefundedTotal()))}
                    </span>
                  </span>
                </button>
                <Show when={foldOpen()}>
                  <div class="px-4 pb-3 space-y-3">
                    <For each={priorEvents()}>
                      {(event) => {
                        const payload = event.payload as CorrectionRefundConfirmedPayload;
                        return (
                          <div class="border border-gray-100 rounded">
                            <div class="px-3 py-1.5 bg-gray-50 text-xs text-gray-500 flex items-center justify-between">
                              <span>
                                {formatDate(event.occurredAt)}
                                {' · '}by {operatorName(payload, event)}
                                <Show when={payload.refund_mode === 'manual_confirmed'}>
                                  <span class="ml-2 text-amber-700">manual</span>
                                </Show>
                              </span>
                              <span class="tabular-nums font-medium text-gray-700">
                                {fmt(parseAmount(payload.refund_total))} refunded
                              </span>
                            </div>
                            <table class="w-full text-xs">
                              <tbody class="divide-y divide-gray-50">
                                <For each={payload.line_items}>
                                  {(li) => (
                                    <tr>
                                      <td class="px-3 py-1 text-gray-700">{li.type}</td>
                                      <td class="px-3 py-1 text-gray-500 truncate max-w-[16ch]">
                                        {li.description ?? li.sku ?? '—'}
                                      </td>
                                      <td class="px-3 py-1 text-right tabular-nums text-gray-600">
                                        {li.qty}
                                      </td>
                                      <td class="px-3 py-1 text-right tabular-nums text-gray-600">
                                        {li.unit_price}
                                      </td>
                                      <td class="px-3 py-1 text-right tabular-nums text-gray-900">
                                        {li.total}
                                      </td>
                                    </tr>
                                  )}
                                </For>
                                <Show when={payload.shipping_included}>
                                  <tr class="text-text-muted">
                                    <td class="px-3 py-1" colSpan={5}>
                                      {__('shipping included')}
                                    </td>
                                  </tr>
                                </Show>
                              </tbody>
                            </table>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>

            {/* §9.6 Remaining revenue — explicit formula with per-term tooltips */}
            <Show when={orderTotal() > 0}>
              <div class="px-4 py-2 flex items-center justify-between text-sm border-b border-gray-100">
                <span class="text-gray-500">{__('Remaining revenue after this refund')}</span>
                <span class="tabular-nums">
                  <span class="text-gray-700" title={__('Order grand total (WooCommerce)')}>
                    {fmt(orderTotal())}
                  </span>
                  <Show when={pastRefunds() > 0}>
                    <span class="text-text-muted"> − </span>
                    <span
                      class="text-gray-700"
                      title={__('Sum of refunds already issued on this order')}
                    >
                      {fmt(pastRefunds())}
                    </span>
                  </Show>
                  <span class="text-text-muted"> − </span>
                  <span class="text-gray-700" title={__('The refund this batch will issue')}>
                    {fmt(newRefundTotal())}
                  </span>
                  <span class="text-text-muted"> = </span>
                  <span
                    class={`font-medium ${remainingRevenue() < 0 ? 'text-red-600' : 'text-gray-900'}`}
                    title={__('Revenue retained on this order after the refund')}
                  >
                    {fmt(remainingRevenue())}
                  </span>
                </span>
              </div>
            </Show>
          </Show>
        </div>

        {/* Error banner */}
        <Show when={processMutation.isError}>
          <ErrorBanner as="div" class="px-4 py-2 text-sm bg-red-50">
            {processMutation.error?.message ?? __('Processing failed.')}
          </ErrorBanner>
        </Show>

        {/* Footer */}
        <ModalFooter layout="column">
          {/* Manual attestation */}
          <Show when={needsAttestation()}>
            <label class="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                class="mt-0.5 shrink-0"
                checked={manualConfirmed()}
                onChange={(e) => setManualConfirmed((e.currentTarget as HTMLInputElement).checked)}
              />
              <span>
                {/* One msgid for the whole sentence, split on its own placeholder to put the
                    gateway name back in bold. Handing a translator three fragments around a
                    <strong> would leave them unable to move the name, which several languages
                    need to do; and the emphasis is worth keeping, since the gateway is the thing
                    the operator is attesting about. A translation that loses the placeholder
                    falls back to the plain sentence rather than rendering half of it. */}
                <Show when={attestationParts().length === 2} fallback={attestationParts()[0]}>
                  {attestationParts()[0]}
                  <strong>{gatewayLabel()}</strong>
                  {attestationParts()[1]}
                </Show>
              </span>
            </label>
          </Show>

          <div class="flex items-center justify-between gap-3">
            {/* §C2 — restate who/what is being refunded */}
            <div class="text-xs text-gray-500 truncate">
              <span class="font-medium text-gray-700">{props.order.customerName}</span>
              {' · '}
              {sprintf(__('Order #%s'), props.order.externalId)}
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <Button
                variant="secondary"
                disabled={processMutation.isPending}
                onClick={props.onClose}
              >
                {__('Cancel')}
              </Button>
              <Button
                variant="success"
                disabled={!canProcess() || processMutation.isPending || pending().length === 0}
                onClick={handleProcess}
              >
                {processLabel()}
              </Button>
            </div>
          </div>
        </ModalFooter>
      </ModalPanel>
    </Modal>
  );
}

function parseAmount(s: string | null | undefined): number {
  if (s === undefined || s === null) return 0;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : formatDateTime(d);
}

/** Operator label for the fold: resolved display name, falling back to user id. */
function operatorName(payload: CorrectionRefundConfirmedPayload, event: TimelineEvent): string {
  if (payload.actor_user_name) return payload.actor_user_name;
  if (typeof payload.actor_user_id === 'number') return `user #${payload.actor_user_id}`;
  return event.actor.ref ? `user #${event.actor.ref}` : 'unknown';
}

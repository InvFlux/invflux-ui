import { Show, createMemo, createSignal } from 'solid-js';
import { __ } from '@invflux/i18n';
import { Button, Modal, type TimelineEvent } from '@invflux/ui';
import { useOrderEventsQuery, useSettleManualRefundMutation } from '../queries';
import type { DispatchOrderSummary } from '../types';

/**
 * Settle the order's pending manual refunds (non-refundable gateway). Shows the
 * outstanding amount (summed from the unsettled `refund.scheduled(mode=manual)`
 * events) + an attestation the operator must check, then issues the WC refund
 * record via the settle endpoint. Mirrors the Essentials manual-gateway attestation.
 */
export function SettleManualRefundModal(props: {
  orderHexId: string;
  order: DispatchOrderSummary;
  onClose: () => void;
}) {
  const settleMutation = useSettleManualRefundMutation(() => props.orderHexId);
  const [confirmed, setConfirmed] = createSignal(false);

  const eventsQuery = useOrderEventsQuery(() => props.orderHexId, () => true);

  // Sum the unsettled manual schedules: every refund.scheduled(mode=manual) with
  // no terminal sibling sharing its id.
  const pendingTotal = createMemo(() => {
    const events: TimelineEvent[] = eventsQuery.data?.events ?? [];
    const settled = new Set<string>();
    for (const e of events) {
      if (e.type !== 'correction.refund_confirmed' && e.type !== 'refund.cancelled') continue;
      const p = e.payload as { scheduled_event_id?: string; extras?: { scheduled_event_id?: string } } | null;
      const sid = p?.scheduled_event_id ?? p?.extras?.scheduled_event_id;
      if (sid) settled.add(sid);
    }
    let total = 0;
    for (const e of events) {
      if (e.type !== 'refund.scheduled') continue;
      const p = e.payload as { mode?: string; total?: string } | null;
      if (p?.mode !== 'manual') continue;
      if (e.id && settled.has(e.id)) continue;
      total += Number.parseFloat(p?.total ?? '0') || 0;
    }
    return total;
  });

  const gatewayLabel = createMemo(
    () => props.order.paymentMethodTitle ?? props.order.paymentMethod ?? 'gateway',
  );

  function handleSettle() {
    settleMutation.mutate(undefined, { onSuccess: () => props.onClose() });
  }

  return (
    <Modal onClose={props.onClose} label="Settle manual refund" backdropClass="bg-black/30 flex items-center justify-center p-6">
      <div class="bg-white rounded-md shadow-lg w-full max-w-md flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header class="px-5 py-3 border-b border-gray-200">
          <h2 class="text-base font-semibold text-gray-900">{__('Settle manual refund')}</h2>
        </header>

        <div class="px-5 py-4 space-y-3 text-sm">
          <div class="flex items-center justify-between">
            <span class="text-gray-500">{__('Pending refund')}</span>
            <span class="tabular-nums font-medium text-gray-900">{pendingTotal().toFixed(2)}</span>
          </div>
          <div class="text-xs text-gray-500">
            <span class="font-medium text-gray-700">{props.order.customerName}</span>
            {' · '}Order #{props.order.externalId}
            {' · '}{gatewayLabel()}
          </div>

          <label class="flex items-start gap-2 text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              class="mt-0.5 shrink-0"
              checked={confirmed()}
              onChange={(e) => setConfirmed((e.currentTarget as HTMLInputElement).checked)}
            />
            <span>
              I understand that <strong>{gatewayLabel()}</strong> requires the refund to be issued
              outside WooCommerce (e.g. via bank transfer). I confirm this has been / will be handled.
            </span>
          </label>

          <Show when={settleMutation.isError}>
            <div class="px-3 py-2 text-sm bg-red-50 text-red-700 rounded">
              {settleMutation.error?.message ?? 'Settle failed.'}
            </div>
          </Show>
        </div>

        <footer class="px-5 py-3 border-t border-gray-200 flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            disabled={settleMutation.isPending}
            onClick={props.onClose}
          >
            {__('Cancel')}
          </Button>
          <Button
            variant="success"
            disabled={!confirmed() || settleMutation.isPending}
            onClick={handleSettle}
          >
            {settleMutation.isPending ? 'Settling…' : `Settle refund (${pendingTotal().toFixed(2)})`}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}

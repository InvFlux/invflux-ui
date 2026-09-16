import { Show, createMemo, createSignal } from 'solid-js';
import { __, _x, sprintf } from '@invflux/i18n';
import {
  Button,
  ErrorBanner,
  Modal,
  type TimelineEvent,
  ModalFooter,
  ModalHeader,
  ModalPanel,
} from '@invflux/ui';
import { formatMoney, toCents } from '../money';
import { useOrderEventsQuery, useSettleManualRefundMutation } from '../queries';
import type { DispatchOrderSummary } from '../types';

/**
 * Settle the order's pending manual refunds (non-refundable gateway). Shows the
 * outstanding amount (summed from the unsettled `refund.scheduled(mode=manual)`
 * events) + an attestation the operator must check, then issues the WC refund
 * record via the settle endpoint. Mirrors the Essentials manual-gateway attestation.
 *
 * On an order WooCommerce no longer has there is no refund record to create: the dialog says so,
 * and the operator's attestation that they paid the customer is the record.
 */
export function SettleManualRefundModal(props: {
  orderHexId: string;
  order: DispatchOrderSummary;
  /** The WooCommerce order was deleted outright; see `DispatchOrderDetail.hostOrderMissing`. */
  hostOrderMissing?: boolean;
  onClose: () => void;
}) {
  const settleMutation = useSettleManualRefundMutation(() => props.orderHexId);
  const [confirmed, setConfirmed] = createSignal(false);

  const eventsQuery = useOrderEventsQuery(
    () => props.orderHexId,
    () => true,
  );

  // Sum the unsettled manual schedules: every refund.scheduled(mode=manual) with no terminal
  // sibling sharing its id. In cents, since a float sum drifts, and in the currency the refunds
  // were owed in — which a schedule records, and which the order summary cannot give once
  // WooCommerce no longer has the order.
  const pending = createMemo((): { cents: number; currency: string | null } => {
    const events: TimelineEvent[] = eventsQuery.data?.events ?? [];
    const settled = new Set<string>();
    for (const e of events) {
      if (e.type !== 'correction.refund_confirmed' && e.type !== 'refund.cancelled') continue;
      const p = e.payload as {
        scheduled_event_id?: string;
        extras?: { scheduled_event_id?: string };
      } | null;
      const sid = p?.scheduled_event_id ?? p?.extras?.scheduled_event_id;
      if (sid) settled.add(sid);
    }
    let cents = 0;
    let currency: string | null = null;
    for (const e of events) {
      if (e.type !== 'refund.scheduled') continue;
      const p = e.payload as { mode?: string; total?: string; currency?: string } | null;
      if (p?.mode !== 'manual') continue;
      if (e.id && settled.has(e.id)) continue;
      cents += toCents(p?.total ?? '0') ?? 0;
      currency ??= p?.currency ?? null;
    }
    return { cents, currency: currency ?? props.order.currency ?? null };
  });
  const pendingLabel = (): string => formatMoney(pending().cents, pending().currency);

  const gatewayLabel = createMemo(
    () =>
      props.order.paymentMethodTitle ??
      props.order.paymentMethod ??
      _x('gateway', 'an unnamed payment gateway, named inside a sentence'),
  );

  // One sentence for translators, split around the gateway's name so the name can stay bold.
  const confirmParts = (): [string, string] => {
    const [head = '', tail = ''] = __(
      /* translators: %s: the payment gateway's name, shown in bold. */
      'I understand that %s requires the refund to be issued outside WooCommerce (e.g. via bank transfer). I confirm this has been / will be handled.',
    ).split('%s');
    return [head, tail];
  };

  function handleSettle() {
    settleMutation.mutate(undefined, { onSuccess: () => props.onClose() });
  }

  return (
    <Modal onClose={props.onClose} label={__('Settle manual refund')}>
      <ModalPanel size="md">
        <ModalHeader title={__('Settle manual refund')} />

        <div class="px-4 py-4 space-y-3 text-sm">
          <div class="flex items-center justify-between">
            <span class="text-gray-500">{__('Pending refund')}</span>
            <span
              class="tabular-nums font-medium text-gray-900"
              data-testid="settle-refund-total"
              data-cents={pending().cents}
            >
              {pendingLabel()}
            </span>
          </div>
          <div class="text-xs text-gray-500">
            <span class="font-medium text-gray-700">{props.order.customerName}</span>
            {' · '}
            {sprintf(__('Order #%s'), props.order.externalId)}
            {' · '}
            {gatewayLabel()}
          </div>

          <Show when={props.hostOrderMissing}>
            <p
              class="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              data-testid="settle-refund-host-missing"
            >
              {__(
                'This order no longer exists in WooCommerce, so no WooCommerce refund can be created. Settling records that you paid the customer yourself.',
              )}
            </p>
          </Show>

          <label class="flex items-start gap-2 text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              class="mt-0.5 shrink-0"
              checked={confirmed()}
              onChange={(e) => setConfirmed((e.currentTarget as HTMLInputElement).checked)}
            />
            <Show
              when={!props.hostOrderMissing}
              fallback={
                <span>
                  {__(
                    'I confirm this refund has been / will be paid to the customer outside WooCommerce.',
                  )}
                </span>
              }
            >
              <span>
                {confirmParts()[0]}
                <strong>{gatewayLabel()}</strong>
                {confirmParts()[1]}
              </span>
            </Show>
          </label>

          <Show when={settleMutation.isError}>
            <ErrorBanner as="div" class="px-3 py-2 text-sm bg-red-50 rounded">
              {settleMutation.error?.message ?? __('Settle failed.')}
            </ErrorBanner>
          </Show>
        </div>

        <ModalFooter>
          <Button variant="secondary" disabled={settleMutation.isPending} onClick={props.onClose}>
            {__('Cancel')}
          </Button>
          <Button
            variant="success"
            disabled={!confirmed() || settleMutation.isPending}
            onClick={handleSettle}
          >
            {settleMutation.isPending
              ? __('Settling…')
              : sprintf(
                  /* translators: %s: the amount to refund, with its currency. */
                  __('Settle refund (%s)'),
                  pendingLabel(),
                )}
          </Button>
        </ModalFooter>
      </ModalPanel>
    </Modal>
  );
}

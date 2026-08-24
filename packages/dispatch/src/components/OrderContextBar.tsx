import { Show, createMemo, type JSX } from 'solid-js';
import { __ } from '@invflux/i18n';
import { Button, ContextCardBar, type ContextCardDescriptor } from '@invflux/ui';
import type { DispatchOrderSummary, OrderDetailCardSlotProps } from '../types';

/**
 * OrderDetail header — a row of four collapsible context cards
 * (Customer / Shipping / Payment / Timestamps). Cards are
 * descriptors handed to the shared
 * `<ContextCardBar>` primitive from `@invflux/ui` so procurement's
 * future `<PoContextBar>` can mirror the layout without
 * re-implementing single-open / outside-click / responsive
 * stacking.
 *
 * Slot keys land under `order.detail.card.<id>.detail`;
 * each card carries the same
 * {@link OrderDetailCardSlotProps} context so plug-ins know the
 * shape regardless of which card they target.
 */
export function OrderContextBar(props: {
  orderHexId: string;
  order: DispatchOrderSummary;
  /** True when the order is a manual-gateway order awaiting payment (capture control applies). */
  awaitingPayment?: boolean;
  /** Open the capture-payment modal — wired by OrderDetail; rendered inside the Payment card. */
  onRecordPayment?: () => void;
  /** Open the settle-manual-refund modal — rendered in the Payment card when refunds are pending. */
  onSettleRefund?: () => void;
}): JSX.Element {
  const ctx = (): OrderDetailCardSlotProps => ({
    orderHexId: props.orderHexId,
    order: props.order,
  });

  const cards = createMemo<ContextCardDescriptor<OrderDetailCardSlotProps>[]>(() => {
    const o = props.order;
    return [
      {
        id: 'customer',
        label: 'Customer',
        slotKey: 'order.detail.card.customer.detail',
        slotContext: ctx(),
        summary: () => (
          <>
            <div class="font-medium truncate">{o.customerName || '—'}</div>
            <div class="text-xs text-gray-500 truncate">{o.customerEmail || '—'}</div>
          </>
        ),
        detail: () => (
          <dl class="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
            <dt class="text-gray-500">Name</dt>
            <dd class="text-gray-800">{o.customerName || '—'}</dd>
            <dt class="text-gray-500">{__('Email')}</dt>
            <dd class="text-gray-800">
              <Show when={o.customerEmail} fallback="—">
                <a href={`mailto:${o.customerEmail}`} class="text-primary hover:underline">
                  {o.customerEmail}
                </a>
              </Show>
            </dd>
            <dt class="text-gray-500">{__('Phone')}</dt>
            <dd class="text-gray-800">
              <Show when={o.billingPhone} fallback={<span class="text-text-muted">—</span>}>
                <a href={`tel:${o.billingPhone}`} class="text-primary hover:underline">
                  {o.billingPhone}
                </a>
              </Show>
            </dd>
            <dt class="text-gray-500">{__('Customer ID')}</dt>
            <dd class="text-gray-800 tabular-nums">
              {o.customerId ?? <span class="text-text-muted">guest</span>}
            </dd>
          </dl>
        ),
      },
      {
        id: 'shipping',
        label: 'Shipping',
        slotKey: 'order.detail.card.shipping.detail',
        slotContext: ctx(),
        summary: () => {
          const a = o.shippingAddress;
          if (!a) return <span class="text-text-muted">—</span>;
          const cityCountry = [a.city, a.country].filter(Boolean).join(', ');
          return <span class="truncate">{cityCountry || '—'}</span>;
        },
        detail: () => {
          const a = o.shippingAddress;
          if (!a) {
            return (
              <div class="text-gray-500 italic">{__('No shipping address captured.')}</div>
            );
          }
          const lines = [a.line1, a.line2].filter(Boolean);
          const cityState = [a.city, a.state].filter(Boolean).join(', ');
          const postcodeCountry = [a.postcode, a.country].filter(Boolean).join(' · ');
          return (
            <address class="not-italic space-y-0.5 text-sm">
              {lines.length === 0 ? (
                <div class="text-text-muted">{__('No street address')}</div>
              ) : (
                lines.map((line) => <div class="text-gray-800">{line}</div>)
              )}
              <Show when={cityState}><div class="text-gray-800">{cityState}</div></Show>
              <Show when={postcodeCountry}><div class="text-gray-600 text-xs">{postcodeCountry}</div></Show>
            </address>
          );
        },
      },
      {
        id: 'payment',
        label: 'Payment',
        slotKey: 'order.detail.card.payment.detail',
        slotContext: ctx(),
        summary: () => (
          <div class="flex items-center justify-between gap-2">
            <span class="truncate">
              {o.paymentMethodTitle || o.paymentMethod || <span class="text-text-muted">—</span>}
            </span>
            <span class="shrink-0 inline-flex items-center gap-2">
              <Show when={props.awaitingPayment && props.onRecordPayment}>
                <span class="inline-flex items-center gap-1.5">
                  <span class="px-1.5 py-0.5 rounded text-2xs font-medium bg-sky-100 text-sky-800">
                    {__('Awaiting payment')}
                  </span>
                  <Button
                    size="xs"
                    onClick={(e) => {
                      // Don't let the click bubble to the card header (which toggles expand).
                      e.stopPropagation();
                      props.onRecordPayment?.();
                    }}
                  >
                    {__('Record payment')}
                  </Button>
                </span>
              </Show>
              <Show when={o.pendingManualRefunds > 0 && props.onSettleRefund}>
                <span class="inline-flex items-center gap-1.5">
                  <span class="px-1.5 py-0.5 rounded text-2xs font-medium bg-amber-100 text-amber-800">
                    {o.pendingManualRefunds} pending refund{o.pendingManualRefunds === 1 ? '' : 's'}
                  </span>
                  <Button
                    variant="warning"
                    size="xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onSettleRefund?.();
                    }}
                  >
                    {__('Settle')}
                  </Button>
                </span>
              </Show>
            </span>
          </div>
        ),
        detail: () => (
          <dl class="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
            <Show when={props.awaitingPayment}>
              <dd class="col-span-2 mb-1 px-2 py-1.5 rounded bg-sky-50 border border-sky-200 text-xs text-sky-800">
                Manual-payment order awaiting payment. Recording it marks the order paid and
                commits its reserved stock — after a stock check.
              </dd>
            </Show>
            <Show when={o.pendingManualRefunds > 0}>
              <dd class="col-span-2 mb-1 px-2 py-1.5 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800">
                {o.pendingManualRefunds} manual refund{o.pendingManualRefunds === 1 ? '' : 's'} pending — this
                gateway can't auto-refund. Settle once you've refunded the customer out-of-band.
              </dd>
            </Show>
            <dt class="text-gray-500">{__('Gateway')}</dt>
            <dd class="text-gray-800">
              {o.paymentMethodTitle || <span class="text-text-muted">—</span>}
            </dd>
            <dt class="text-gray-500">ID</dt>
            <dd class="font-mono text-xs text-gray-600">
              {o.paymentMethod || <span class="text-text-muted">—</span>}
            </dd>
            <dt class="text-gray-500">{__('Transaction')}</dt>
            <dd class="font-mono text-xs text-gray-600">
              {o.transactionId || <span class="text-text-muted">—</span>}
            </dd>
          </dl>
        ),
      },
      {
        id: 'timestamps',
        label: 'Timeline',
        slotKey: 'order.detail.card.timestamps.detail',
        slotContext: ctx(),
        summary: () => (
          <span class="truncate">
            {fmtRelative(o.createdAt)} · EDT{' '}
            <span classList={{ 'text-red-600 font-medium': edtLate(o.estDispatch).isLate }}>
              {fmtRelative(o.estDispatch)}
            </span>
          </span>
        ),
        detail: () => (
          <dl class="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
            <dt class="text-gray-500">{__('Created')}</dt>
            <dd class="text-gray-800 tabular-nums">{fmtAbsolute(o.createdAt)}</dd>
            <dt class="text-gray-500">EDT</dt>
            <dd
              class="tabular-nums"
              classList={{
                'text-red-600 font-medium': edtLate(o.estDispatch).isLate,
                'text-gray-800': !edtLate(o.estDispatch).isLate,
              }}
            >
              {fmtAbsolute(o.estDispatch)}
            </dd>
            <Show when={edtLate(o.estDispatch).days > 0}>
              <dt class="text-gray-500">{__('Late by')}</dt>
              <dd class="text-red-600 font-medium tabular-nums">
                {edtLate(o.estDispatch).days} day{edtLate(o.estDispatch).days === 1 ? '' : 's'}
              </dd>
            </Show>
            <dt class="text-gray-500">{__('Updated')}</dt>
            <dd class="text-gray-800 tabular-nums">{fmtAbsolute(o.updatedAt)}</dd>
          </dl>
        ),
      },
    ];
  });

  return <ContextCardBar cards={cards} />;
}

function fmtAbsolute(iso: string | null): JSX.Element {
  if (!iso) return <span class="text-text-muted">—</span>;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return <span class="text-text-muted">—</span>;
  return <>{d.toISOString().slice(0, 16).replace('T', ' ')} UTC</>;
}

/**
 * Whether EDT is in the past, and by how many whole days. Derived client-side
 * from `estDispatch`.
 */
function edtLate(iso: string | null): { isLate: boolean; days: number } {
  if (!iso) return { isLate: false, days: 0 };
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return { isLate: false, days: 0 };
  const diffMs = Date.now() - ts;
  if (diffMs <= 0) return { isLate: false, days: 0 };
  return { isLate: true, days: Math.floor(diffMs / 86_400_000) };
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '—';
  const days = Math.round((ts - Date.now()) / 86_400_000);
  if (days === 0) return 'today';
  return days > 0 ? `in ${days}d` : `${Math.abs(days)}d ago`;
}

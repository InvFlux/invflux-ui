import { For, Show, createMemo, type JSX } from 'solid-js';
import { __, _n, sprintf, _x, formatDate } from '@invflux/i18n';
import {
  Button,
  ContextCardBar,
  type ContextCardDescriptor,
  EventTime,
  HourglassIcon,
  Pill,
  formatEventTime,
} from '@invflux/ui';
import type {
  DispatchOrderPayment,
  DispatchOrderSummary,
  OrderAddress,
  OrderDetailCardSlotProps,
} from '../types';
import { hasAddress, sameAddress } from '../addressAgreement';
import { useDispatch } from '../context';
import { useDispatchOrderDetailQuery } from '../queries';
import { formatMoney, toCents } from '../money';
import { differenceReasonLabel, paymentSourceLabel } from '../paymentLabels';

/**
 * OrderDetail header — a row of four collapsible context cards
 * (Customer / Addresses / Payment / Timestamps). Cards are
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

/** One labelled address, or a note that the host captured none. */
function AddressBlock(props: {
  label: string;
  address: OrderAddress | null;
  empty: string;
  /** Absent when the operator may not correct addresses — the affordance is then not rendered. */
  onEdit?: () => void;
}): JSX.Element {
  const lines = (): string[] => {
    const a = props.address;
    if (a === null) return [];
    const recipient = [a.firstName, a.lastName].filter(Boolean).join(' ');

    return [recipient, a.company, a.line1, a.line2].filter((l): l is string => Boolean(l));
  };
  const cityState = (): string =>
    [props.address?.city, props.address?.state].filter(Boolean).join(', ');
  const postcodeCountry = (): string =>
    [props.address?.postcode, props.address?.country].filter(Boolean).join(' · ');

  return (
    // `min-w-0` so the flex row wraps first and only then lets a block shrink; `overflow-x-auto`
    // because the lines below do not wrap — an address longer than its column would otherwise be
    // clipped with no ellipsis and no scrollbar, silently, on the one screen whose job is checking
    // an address before a label is printed. The card's panel is scrollable too and widens to its
    // content, so this is now the last resort rather than the usual one.
    <div class="min-w-0 overflow-x-auto">
      {/* The affordance sits beside its label rather than pushed to the far edge: the blocks are
          now content-width columns, so `justify-between` would strand the link a variable distance
          from the heading it belongs to, and a different distance in each column. */}
      <div class="flex items-baseline gap-3">
        <span class="text-2xs font-semibold uppercase tracking-wide text-text-muted">
          {props.label}
        </span>
        <Show when={props.onEdit}>
          <button
            type="button"
            class="text-xs text-primary hover:text-primary-hover hover:underline"
            onClick={(e) => {
              // The card is a disclosure; a click inside it would otherwise collapse the panel
              // the operator is about to edit from.
              e.stopPropagation();
              props.onEdit!();
            }}
          >
            {__('Edit')}
          </button>
        </Show>
      </div>
      <Show
        when={hasAddress(props.address)}
        fallback={<div class="text-sm text-gray-500 italic">{props.empty}</div>}
      >
        {/* Lines do not wrap. Two addresses read as two columns only while their line breaks are
            the ones the address has — a street re-wrapped mid-name misaligns the block beside it
            and turns a glance into a comparison. */}
        <address class="not-italic space-y-0.5 whitespace-nowrap text-sm">
          {lines().length === 0 ? (
            <div class="text-text-muted">{__('No street address')}</div>
          ) : (
            lines().map((line) => <div class="text-gray-800">{line}</div>)
          )}
          <Show when={cityState()}>
            <div class="text-gray-800">{cityState()}</div>
          </Show>
          <Show when={postcodeCountry()}>
            <div class="text-gray-600 text-xs">{postcodeCountry()}</div>
          </Show>
        </address>
      </Show>
    </div>
  );
}

/** How a payment came to be on record, and by whom — one short line. */
function paymentOrigin(p: DispatchOrderPayment): string {
  if ('manual' === p.source && p.recordedByName) {
    return sprintf(
      /* translators: %s: the name of the person who recorded the payment */
      _x('Recorded by %s', 'order payment: who recorded the payment'),
      p.recordedByName,
    );
  }
  return paymentSourceLabel(p.source);
}

/** One payment in the Payment card: amount, method, day, reference, how it got there. */
function PaymentRow(props: {
  payment: DispatchOrderPayment;
  orderCurrency: string | null;
  methodLabel: string;
}): JSX.Element {
  const p = (): DispatchOrderPayment => props.payment;
  const voided = (): boolean => p().voidedAt !== null;
  const orderMoney = (amount: string): string =>
    formatMoney(toCents(amount) ?? 0, props.orderCurrency);

  return (
    <li
      data-testid="order-payment-row"
      data-source={p().source}
      data-voided={voided() ? 'true' : undefined}
      class="text-xs"
      classList={{ 'opacity-60': voided() }}
    >
      <div class="flex flex-wrap items-baseline gap-x-2">
        <span
          class="font-medium text-gray-800 tabular-nums"
          classList={{ 'line-through': voided() }}
        >
          {formatMoney(toCents(p().amount) ?? 0, p().currency)}
        </span>
        <Show when={p().fxRate}>
          {(rate) => (
            <span class="text-gray-500 tabular-nums">
              {sprintf(
                /* translators: 1: the payment converted into the order's currency, 2: the exchange rate */
                _x('= %1$s at %2$s', 'order payment: a payment in another currency, converted'),
                orderMoney(p().amountOrderCcy),
                rate(),
              )}
            </span>
          )}
        </Show>
        <span class="text-gray-600">{props.methodLabel}</span>
        <span class="text-gray-500">{formatDate(p().receivedAt)}</span>
        <Show when={p().reference}>
          {(ref) => <span class="font-mono text-gray-600">{ref()}</span>}
        </Show>
      </div>
      <Show when={p().difference}>
        {(difference) => (
          <div class="text-gray-500">
            {sprintf(
              (toCents(difference()) ?? 0) > 0
                ? /* translators: 1: the amount by which the payment fell short, 2: why that was accepted */
                  _x(
                    '%1$s short, accepted — %2$s',
                    'order payment: a payment difference accepted as settled',
                  )
                : /* translators: 1: the amount by which the payment exceeded what was owed, 2: why that was accepted */
                  _x(
                    '%1$s over, accepted — %2$s',
                    'order payment: a payment difference accepted as settled',
                  ),
              orderMoney(difference().replace('-', '')),
              differenceReasonLabel(p().differenceReason ?? ''),
            )}
          </div>
        )}
      </Show>
      <div class="text-gray-400">{paymentOrigin(p())}</div>
      <Show when={voided()}>
        <div class="text-gray-500">
          {sprintf(
            /* translators: 1: who voided the payment, 2: why */
            _x('Voided by %1$s: %2$s', 'order payment: a payment that no longer counts'),
            p().voidedByName ?? '—',
            p().voidReason ?? '',
          )}
        </div>
      </Show>
    </li>
  );
}

export function OrderContextBar(props: {
  orderHexId: string;
  order: DispatchOrderSummary;
  /** True when the order is a manual-gateway order awaiting payment (capture control applies). */
  awaitingPayment?: boolean;
  /** Open the capture-payment modal — wired by OrderDetail; rendered inside the Payment card. */
  onRecordPayment?: () => void;
  /** Open the settle-manual-refund modal — rendered in the Payment card when refunds are pending. */
  onSettleRefund?: () => void;
  /**
   * Open the correction form. Absent when the operator may not correct addresses.
   *
   * `merged` rides along because it is the card that knows it — whether the two addresses agree is
   * what the card just decided in order to render one block or two, and re-deriving it in the form
   * would be a second answer to one question. It is also what decides which scopes the form may
   * offer: only a merged block has both addresses' values on screen.
   */
  onEditAddress?: (openedFrom: 'billing' | 'shipping', merged: boolean) => void;
}): JSX.Element {
  const ctx = (): OrderDetailCardSlotProps => ({
    orderHexId: props.orderHexId,
    order: props.order,
  });
  const dispatch = useDispatch();
  // The detail this bar is rendered from, already cached — so the payments cost no request.
  const detail = useDispatchOrderDetailQuery(() => props.orderHexId);
  const payments = () => detail.data?.payments ?? null;
  const methodLabel = (method: string): string =>
    method === 'other'
      ? _x('Other', 'record payment: a payment method not in the list, option')
      : (dispatch.paymentMethods.options.find((o) => o.value === method)?.label ?? method);

  const cards = createMemo<ContextCardDescriptor<OrderDetailCardSlotProps>[]>(() => {
    const o = props.order;
    return [
      {
        id: 'customer',
        label: __('Customer'),
        slotKey: 'order.detail.card.customer.detail',
        slotContext: ctx(),
        // Name and address on ONE line, in the form every mail client writes them —
        // `Pat Walker <pat@example.com>`. Stacked, this card was two lines tall where the other
        // three are one, and since the row equalises its cells that made every card as tall as its
        // most talkative neighbour. The convention also says which is which without a label.
        summary: () => (
          <>
            <span class="font-medium">
              {o.customerName || <span class="text-text-muted italic">{__('No name')}</span>}
            </span>
            <Show when={o.customerEmail}>
              <span class="text-xs text-gray-500"> &lt;{o.customerEmail}&gt;</span>
            </Show>
          </>
        ),
        detail: () => (
          <dl class="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
            <dt class="text-gray-500">{__('Name')}</dt>
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
        id: 'addresses',
        // Holds both of the order's addresses, so the label is the plural one. The summary stays
        // the shipping city, because that is what a glance at a dispatch screen is asking.
        label: __('Addresses'),
        slotKey: 'order.detail.card.addresses.detail',
        slotContext: ctx(),
        // A dash says "nothing here" and leaves the operator to work out what "here" was. On the
        // one card that decides whether a parcel can be sent, the absence is the fact — and it is
        // `hasAddress`, not a null check, that knows it: the read hands back a struct of nulls
        // whenever the query selected the columns, so a collect-in-store order has an object with
        // nothing in it.
        summary: () => {
          const a = o.shippingAddress;
          const cityCountry = (): string => [a?.city, a?.country].filter(Boolean).join(', ');

          return (
            <Show
              when={hasAddress(a)}
              fallback={
                <span class="text-text-muted italic">{__('No shipping address captured.')}</span>
              }
            >
              <Show
                when={cityCountry()}
                fallback={<span class="text-text-muted italic">{__('No city or country')}</span>}
              >
                <span class="truncate">{cityCountry()}</span>
              </Show>
            </Show>
          );
        },
        detail: () => {
          // Decided once for both blocks: it chooses what the second one prints *and* what each
          // affordance offers, and two evaluations could disagree only by being wrong.
          const same = (): boolean => sameAddress(o.shippingAddress, o.billingAddress);
          // Read here rather than inside the closure: this callback is the tracked scope, so the
          // handler is picked up on every render of the card and the closures below carry a plain
          // local. An operator who gains the capability mid-session gets the affordance on the next
          // render either way.
          const open = props.onEditAddress;
          const edit = (
            openedFrom: 'billing' | 'shipping',
            merged: boolean,
          ): (() => void) | undefined => (open ? () => open(openedFrom, merged) : undefined);

          return (
            // Side by side, because comparing two addresses is a horizontal task — stacked, the
            // eye has to carry each line down past the other block's. They are content-width, so
            // a card too narrow for both (the bar is `lg:grid-cols-4`, so this is a quarter of the
            // page) wraps back to stacked rather than squeezing two unreadable columns.
            <div class="flex flex-wrap gap-x-8 gap-y-3">
              {/* One address serving both roles is one block with both names on it. Printing it
                  twice reads as two addresses that happen to match, and a block whose whole content
                  is "same as the other one" is a heading earning its keep by saying it is
                  redundant. The compound label says the true thing in less room. */}
              <Show
                when={!same()}
                fallback={
                  <AddressBlock
                    label={__('Ship to / Bill to')}
                    address={o.shippingAddress}
                    empty={__('No address captured.')}
                    onEdit={edit('shipping', true)}
                  />
                }
              >
                <AddressBlock
                  label={__('Ship to')}
                  address={o.shippingAddress}
                  empty={__('No shipping address captured.')}
                  onEdit={edit('shipping', false)}
                />
                <AddressBlock
                  label={__('Bill to')}
                  address={o.billingAddress}
                  empty={__('No billing address captured.')}
                  onEdit={edit('billing', false)}
                />
              </Show>
            </div>
          );
        },
      },
      {
        id: 'payment',
        label: __('Payment'),
        slotKey: 'order.detail.card.payment.detail',
        slotContext: ctx(),
        summary: () => (
          <div class="flex items-center justify-between gap-2">
            {/* `min-w-0` is what makes `truncate` actually truncate here. A flex item's minimum
                width is its content by default, so without it the gateway name refuses to shrink,
                overflows the card, and the pill beside it — not the name — is what gets cut off. */}
            <span class="min-w-0 truncate">
              {o.paymentMethodTitle || o.paymentMethod || <span class="text-text-muted">—</span>}
            </span>
            <span class="shrink-0 inline-flex items-center gap-2">
              <Show when={o.pendingManualRefunds > 0 && props.onSettleRefund}>
                <span class="inline-flex items-center gap-1.5">
                  {/* Same treatment, and now translated: the plural was assembled by appending
                      an "s", which no translator can reach and which is wrong in most locales. */}
                  <Pill
                    tone="warning"
                    size="xs"
                    class="tabular-nums"
                    title={__('This gateway cannot refund through the API — settle it out of band')}
                  >
                    {sprintf(
                      _n('%d pending refund', '%d pending refunds', o.pendingManualRefunds),
                      o.pendingManualRefunds,
                    )}
                    <HourglassIcon class="h-3 w-3 shrink-0" />
                  </Pill>
                </span>
              </Show>
            </span>
          </div>
        ),
        // The pill above says a job is outstanding; these do it. They sit in `actions` rather than
        // in the summary so the gateway name is what yields when the bar narrows — the control an
        // operator needs is not the part that should be truncated away.
        actions: () => (
          <>
            {/* No "Awaiting payment" pill beside this: a labelled button that says *record the
                payment* already carries both halves of what the pill said, and the card is not wide
                enough to show the gateway, a pill and a button without one of them being cut. The
                pill's amber is what would have been lost, so the button takes it — same "a person
                still owes an action" tone as the queue's pending-action chips, now on the control
                that discharges it. The refund pill stays, because a COUNT is not on its button. */}
            <Show when={props.awaitingPayment && props.onRecordPayment}>
              <Button
                data-testid="record-payment-open"
                variant="warning"
                size="xs"
                title={__('Nobody has recorded this payment yet')}
                onClick={() => props.onRecordPayment?.()}
              >
                {__('Record payment')}
              </Button>
            </Show>
            <Show when={o.pendingManualRefunds > 0 && props.onSettleRefund}>
              <Button variant="warning" size="xs" onClick={() => props.onSettleRefund?.()}>
                {_x(
                  'Settle',
                  'button: record that a manual refund has been paid out to the customer',
                )}
              </Button>
            </Show>
          </>
        ),
        detail: () => (
          <>
            <dl class="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
              <Show when={props.awaitingPayment}>
                <dd class="col-span-2 mb-1 px-2 py-1.5 rounded bg-sky-50 border border-sky-200 text-xs text-sky-800 max-w-md">
                  {__(
                    'Manual-payment order awaiting payment. Recording it marks the order paid and commits its reserved stock — after a stock check.',
                  )}
                </dd>
              </Show>
              <Show when={o.pendingManualRefunds > 0}>
                <dd class="col-span-2 mb-1 px-2 py-1.5 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  {sprintf(
                    _n(
                      "%d manual refund pending — this gateway can't refund through its API. Settle it once you have refunded the customer outside WooCommerce.",
                      "%d manual refunds pending — this gateway can't refund through its API. Settle them once you have refunded the customer outside WooCommerce.",
                      o.pendingManualRefunds,
                    ),
                    o.pendingManualRefunds,
                  )}
                </dd>
              </Show>
              <dt class="text-gray-500">
                {_x('Gateway', 'order payment detail: the payment gateway that took the payment')}
              </dt>
              <dd class="text-gray-800">
                {o.paymentMethodTitle || <span class="text-text-muted">—</span>}
              </dd>
              <dt class="text-gray-500">
                {_x('ID', "order payment detail: the payment gateway's internal identifier")}
              </dt>
              <dd class="font-mono text-xs text-gray-600">
                {o.paymentMethod || <span class="text-text-muted">—</span>}
              </dd>
              <dt class="text-gray-500">
                {_x('Transaction', 'order payment detail: the gateway transaction ID')}
              </dt>
              <dd class="font-mono text-xs text-gray-600">
                {o.transactionId || <span class="text-text-muted">—</span>}
              </dd>
            </dl>

            {/* The order's own payment records — what WooCommerce keeps only as one paid date. */}
            <Show when={payments()}>
              {(p) => (
                <div
                  data-testid="order-payments"
                  data-total={o.orderTotal ?? undefined}
                  data-paid={p().paid}
                  data-outstanding={p().outstanding}
                  class="mt-3 border-t border-border pt-2 text-sm"
                >
                  <div class="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
                    <span class="font-medium text-gray-700">
                      {_x(
                        'Payments',
                        'order payment detail: heading of the list of payments received',
                      )}
                    </span>
                    <span class="text-xs text-gray-500 tabular-nums">
                      {sprintf(
                        /* translators: 1: the order total, 2: the money received, 3: what the order still owes */
                        _x(
                          'Total %1$s · Paid %2$s · Outstanding %3$s',
                          'order payment detail: totals',
                        ),
                        // What the order was for, beside what came in: an overpayment or a settled
                        // shortfall is otherwise a subtraction the operator does in their head.
                        formatMoney(toCents(o.orderTotal) ?? 0, o.currency),
                        formatMoney(toCents(p().paid) ?? 0, o.currency),
                        formatMoney(toCents(p().outstanding) ?? 0, o.currency),
                      )}
                    </span>
                  </div>
                  <Show
                    when={p().items.length > 0}
                    fallback={
                      <p class="text-xs text-text-muted italic">{__('No payment recorded yet.')}</p>
                    }
                  >
                    <ul class="space-y-1.5">
                      <For each={p().items}>
                        {(payment) => (
                          <PaymentRow
                            payment={payment}
                            orderCurrency={o.currency}
                            methodLabel={methodLabel(payment.method)}
                          />
                        )}
                      </For>
                    </ul>
                  </Show>
                </div>
              )}
            </Show>
          </>
        ),
      },
      {
        // `dispatch`, not the timestamps it happens to show today: getting the order out of the door
        // on time is the domain, and more of it belongs here (warehouse allocation, for one).
        id: 'dispatch',
        label: __('Timeline'),
        slotKey: 'order.detail.card.dispatch.detail',
        slotContext: ctx(),
        // The card's own timestamps are the timeline's, so they read like the timeline's: elapsed
        // by default, wall-clock on a click, and one preference across the page rather than a mode
        // per panel. The summary follows that preference but does not offer to change it — it is
        // rendered inside the card's trigger button, and a button inside a button is invalid markup
        // whose inner click the outer one swallows anyway. The detail below is where it is offered.
        summary: () => (
          <span class="truncate">
            {formatEventTime(o.createdAt)} ·{' '}
            {_x('Ship by', 'order: the date it should ship by (a deadline)')}{' '}
            <span classList={{ 'text-red-600 font-medium': edtLate(o.estDispatch).isLate }}>
              {formatEventTime(o.estDispatch)}
            </span>
          </span>
        ),
        detail: () => (
          <dl class="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
            <dt class="text-gray-500">
              {_x('Created', 'order detail: the date the order was created, row label')}
            </dt>
            <dd>
              <EventTime at={o.createdAt} class="text-sm text-gray-800" />
            </dd>
            <dt class="text-gray-500">
              {_x('Ship by', 'order: the date it should ship by (a deadline)')}
            </dt>
            <dd>
              <EventTime
                at={o.estDispatch}
                class={
                  edtLate(o.estDispatch).isLate
                    ? 'text-sm font-medium text-red-600'
                    : 'text-sm text-gray-800'
                }
              />
            </dd>
            <Show when={edtLate(o.estDispatch).days > 0}>
              <dt class="text-gray-500">{__('Late by')}</dt>
              <dd class="text-red-600 font-medium tabular-nums">
                {sprintf(
                  _n('%d day', '%d days', edtLate(o.estDispatch).days),
                  edtLate(o.estDispatch).days,
                )}
              </dd>
            </Show>
            <dt class="text-gray-500">
              {_x('Updated', 'order detail: the date the order was last changed, row label')}
            </dt>
            <dd>
              <EventTime at={o.updatedAt} class="text-sm text-gray-800" />
            </dd>
          </dl>
        ),
      },
    ];
  });

  return <ContextCardBar cards={cards} />;
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

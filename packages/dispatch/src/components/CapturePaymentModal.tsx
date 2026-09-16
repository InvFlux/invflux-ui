import { For, Show, createMemo, createSignal } from 'solid-js';
import { __, _n, _x, sprintf } from '@invflux/i18n';
import {
  Button,
  ErrorBanner,
  Input,
  Modal,
  ModalFooter,
  ModalHeader,
  ModalPanel,
  Select,
} from '@invflux/ui';
import { useDispatch } from '../context';
import { useCapturePaymentMutation, useDispatchOrderDetailQuery } from '../queries';
import type { CaptureResolution, ManualPaymentInput } from '../api';
import type { DispatchOrderSummary } from '../types';
import { centsToDecimal, convertCents, formatMoney, parseRate, toCents } from '../money';
import { differenceReasonOptions, type DifferenceSide } from '../paymentLabels';

/** Where the payment stands against what the order owes, as entered so far. */
type PaymentCheck =
  | { kind: 'incomplete' }
  /** The order's payments could not be read: the server is the only judge. */
  | { kind: 'unchecked' }
  | { kind: 'exact' }
  /** Less than is owed, by more than the tolerance: a part payment. */
  | { kind: 'short'; receivedCents: number; remainingCents: number }
  /** Less than is owed, within the tolerance: accepted as settled, or kept owed. */
  | { kind: 'shortWithin'; differenceCents: number }
  /** More than is owed: always accepted — the money arrived — with its reason. */
  | { kind: 'over'; differenceCents: number };

/** Today as `YYYY-MM-DD`, in the operator's own calendar. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The order's currency first, then every other the browser knows. */
function currencyCodes(orderCurrency: string): string[] {
  const known =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : [];
  return [orderCurrency, ...known.filter((c) => c !== orderCurrency)].filter(Boolean);
}

/**
 * Record a manual payment for a manual-gateway order (BACS/cheque/COD) and capture stock —
 * the consult-before-capture control. The operator enters what arrived: how much, in what
 * currency (and at what rate, when it is not the order's), by what method, on what day, on what
 * reference. The form says what the payment does before it is sent; the server checks again:
 * less than the order owes is a part payment — recorded, and the order stays unpaid; within the
 * merchant's payment-difference tolerance a difference may instead be accepted as settled, with its
 * reason; more than the order owes only within the tolerance.
 *
 * Then, for a payment that settles the order, stock: a clean capture marks the order paid
 * (`payment_complete`). A shortfall is never silently oversold — the merchant chooses: capture the
 * available units and refund the shortfall, capture them and let the customer decide, leave the
 * order on hold, or cancel it. Every choice but leaving it on hold records the payment.
 */
export function CapturePaymentModal(props: {
  orderHexId: string;
  order: DispatchOrderSummary;
  onClose: () => void;
}) {
  const ctx = useDispatch();
  const mutation = useCapturePaymentMutation(() => props.orderHexId);
  // Already in the cache — the order page is open behind this modal — so this costs no request.
  const detail = useDispatchOrderDetailQuery(() => props.orderHexId);
  const payments = () => detail.data?.payments ?? null;

  const [shortfall, setShortfall] = createSignal<number | null>(null);
  const [done, setDone] = createSignal<'captured_partial' | 'choice_offered' | null>(null);

  const orderCurrency = (): string => props.order.currency ?? '';
  // The fields are seeded once, from the order as the modal opens; after that they are the
  // operator's, and a background refetch must not overwrite what they typed.
  // eslint-disable-next-line solid/reactivity -- a one-time seed, see above
  const [amount, setAmount] = createSignal(payments()?.outstanding ?? props.order.orderTotal ?? '');
  const [currency, setCurrency] = createSignal(orderCurrency());
  const [fxRate, setFxRate] = createSignal('');
  // eslint-disable-next-line solid/reactivity -- a one-time seed, see above
  const [method, setMethod] = createSignal(props.order.paymentMethod || 'other');
  const [receivedOn, setReceivedOn] = createSignal(today());
  const [reference, setReference] = createSignal('');
  const [differenceReason, setDifferenceReason] = createSignal('');
  // Within the tolerance a shortfall is accepted as settled by default; the operator can keep it owed.
  const [acceptDifference, setAcceptDifference] = createSignal(true);

  // The gateway label, or '' when the order carries no payment method (e.g. an
  // order hand-created in WC admin without picking a gateway). Empty → the copy
  // drops the "via …" clause rather than printing a meaningless placeholder.
  const gatewayLabel = createMemo(() => {
    const title = props.order.paymentMethodTitle?.trim();
    const m = props.order.paymentMethod?.trim();
    return title || m || '';
  });

  // The methods an operator records by hand — the store's manual gateways, the order's own first
  // when it is not among them — and "Other" for money that came some other way.
  const methodOptions = createMemo(() => {
    const manual = new Set(ctx.paymentMethods.manualIds ?? []);
    const options = ctx.paymentMethods.options
      .filter((o) => manual.has(o.value))
      .map((o) => ({ value: o.value, label: o.label }));
    const own = props.order.paymentMethod;
    if (own && !options.some((o) => o.value === own)) {
      options.unshift({ value: own, label: gatewayLabel() || own });
    }
    options.push({
      value: 'other',
      label: _x('Other', 'record payment: a payment method not in the list, option'),
    });
    return options;
  });

  const foreign = (): boolean => currency() !== orderCurrency();
  const owedCents = (): number => toCents(payments()?.outstanding) ?? 0;
  const toleranceCents = (): number => toCents(payments()?.tolerance) ?? 0;
  const amountCents = (): number | null => {
    const cents = toCents(amount());
    return cents !== null && cents > 0 ? cents : null;
  };
  const rate = (): string | null => (foreign() ? parseRate(fxRate()) : null);
  /** What the payment comes to in the order's currency — the figure every check reads. */
  const receivedCents = (): number | null => {
    const cents = amountCents();
    if (cents === null) return null;
    if (!foreign()) return cents;
    const r = rate();
    return r === null ? null : convertCents(cents, r);
  };

  const check = createMemo<PaymentCheck>(() => {
    const received = receivedCents();
    if (received === null) return { kind: 'incomplete' };
    if (payments() === null) return { kind: 'unchecked' };
    const difference = owedCents() - received;
    const within = Math.abs(difference) <= toleranceCents();
    if (difference === 0) return { kind: 'exact' };
    if (difference > 0) {
      return within
        ? { kind: 'shortWithin', differenceCents: difference }
        : { kind: 'short', receivedCents: received, remainingCents: difference };
    }
    // The tolerance bounds shortfalls only: money that arrived beyond what was owed is never refused.
    return { kind: 'over', differenceCents: -difference };
  });

  /** Whether the server will be asked to accept a difference as settled — which needs its reason. */
  const acceptsDifference = (): boolean => {
    const c = check();
    return c.kind === 'over' || (c.kind === 'shortWithin' && acceptDifference());
  };
  /** The side a difference falls on, which decides the reasons that can explain it. */
  const side = (): DifferenceSide => (check().kind === 'over' ? 'excess' : 'shortfall');
  /** A reason chosen for one side is no answer for the other: the amount may have been retyped since. */
  const reasonFits = (): boolean =>
    differenceReasonOptions(side()).some((o) => o.value === differenceReason());
  /** A payment that leaves part of the order owed: recorded, and nothing else happens. */
  const partPayment = (): boolean => {
    const c = check();
    return c.kind === 'short' || (c.kind === 'shortWithin' && !acceptDifference());
  };

  const nothingOwed = (): boolean => payments() !== null && owedCents() === 0;
  const locked = (): boolean => shortfall() !== null || done() !== null || mutation.isPending;
  const canRecord = (): boolean => {
    const kind = check().kind;
    const recordable = kind !== 'incomplete' && (!acceptsDifference() || reasonFits());
    return recordable && method() !== '' && receivedOn() !== '' && !nothingOwed();
  };

  const money = (cents: number): string => formatMoney(cents, orderCurrency());

  function payload(): ManualPaymentInput {
    return {
      amount: centsToDecimal(amountCents() ?? 0),
      currency: currency(),
      fxRate: foreign() ? rate() : null,
      method: method(),
      receivedOn: receivedOn(),
      reference: reference().trim(),
      differenceReason: acceptsDifference() ? differenceReason() : null,
    };
  }

  const reasonSelect = () => (
    <Select
      aria-label={_x(
        'Why the difference is accepted',
        'record payment form: the reason for a payment difference, field label',
      )}
      data-testid="record-payment-difference-reason"
      value={reasonFits() ? differenceReason() : ''}
      disabled={locked()}
      onChange={(e) => setDifferenceReason(e.currentTarget.value)}
    >
      <option value="">{_x('Choose a reason…', 'select placeholder: nothing chosen yet')}</option>
      <For each={differenceReasonOptions(side())}>
        {(o) => <option value={o.value}>{o.label}</option>}
      </For>
    </Select>
  );

  function run(resolution?: CaptureResolution): void {
    mutation.mutate(
      { payment: payload(), resolution },
      {
        onSuccess: (result) => {
          if (result.status === 'shortfall') {
            setShortfall(result.shortfall);
            return;
          }
          if (result.status === 'captured_partial' || result.status === 'choice_offered') {
            setDone(result.status); // show a confirmation; the merchant closes
            return;
          }
          props.onClose();
        },
      },
    );
  }

  const shortUnits = () => shortfall() ?? 0;
  const labelClass = 'text-gray-600';

  return (
    <Modal onClose={props.onClose} label={__('Record payment')}>
      <ModalPanel size="md">
        <ModalHeader title={__('Record payment received')} />

        <div class="px-4 py-4 space-y-3 text-sm">
          <div class="text-xs text-gray-500">
            <span class="font-medium text-gray-700">{props.order.customerName}</span>
            {' · '}
            {sprintf(__('Order #%s'), props.order.externalId)}
            <Show when={gatewayLabel()}>
              {' · '}
              {gatewayLabel()}
            </Show>
          </div>

          <Show when={done()}>
            <div
              data-testid="record-payment-done-message"
              class="px-3 py-2 rounded bg-emerald-50 border border-emerald-300 text-emerald-800"
            >
              <Show
                when={done() === 'captured_partial'}
                fallback={sprintf(
                  _n(
                    'Payment recorded and the in-stock units captured. The customer has been emailed to choose how to handle the %d short unit.',
                    'Payment recorded and the in-stock units captured. The customer has been emailed to choose how to handle the %d short units.',
                    shortUnits(),
                  ),
                  shortUnits(),
                )}
              >
                {sprintf(
                  _n(
                    'Payment recorded, the in-stock units captured and a refund queued for the %d short unit. The order is now processing.',
                    'Payment recorded, the in-stock units captured and a refund queued for the %d short units. The order is now processing.',
                    shortUnits(),
                  ),
                  shortUnits(),
                )}
              </Show>
            </div>
          </Show>

          <Show when={!done()}>
            <Show when={nothingOwed()}>
              <div
                data-testid="record-payment-nothing-owed"
                class="px-3 py-2 rounded bg-sky-50 border border-sky-200 text-sky-800"
              >
                {__('This order owes nothing: its payments already settle it.')}
              </div>
            </Show>

            {/* `data-check` states what the payment does as entered, for tests to read. */}
            <div
              data-testid="record-payment-form"
              data-check={check().kind}
              class="grid grid-cols-[8.5rem_1fr] items-center gap-x-3 gap-y-2"
            >
              <label for="rp-amount" class={labelClass}>
                {_x('Amount received', 'record payment form: field label')}
              </label>
              <div class="flex items-center gap-2">
                <Input
                  id="rp-amount"
                  data-testid="record-payment-amount"
                  inputmode="decimal"
                  autocomplete="off"
                  class="w-32 text-right tabular-nums"
                  value={amount()}
                  disabled={locked()}
                  invalid={amount() !== '' && amountCents() === null}
                  onInput={(e) => setAmount(e.currentTarget.value)}
                />
                <Select
                  aria-label={_x(
                    'Currency',
                    'record payment form: the currency the money arrived in, field label',
                  )}
                  data-testid="record-payment-currency"
                  class="w-24"
                  value={currency()}
                  disabled={locked()}
                  onChange={(e) => setCurrency(e.currentTarget.value)}
                >
                  <For each={currencyCodes(orderCurrency())}>
                    {(code) => <option value={code}>{code}</option>}
                  </For>
                </Select>
              </div>

              <Show when={foreign()}>
                <label for="rp-fx-rate" class={labelClass}>
                  {sprintf(__('FX rate (%1$s → %2$s)'), currency(), orderCurrency())}
                </label>
                <div class="flex items-center gap-2">
                  <Input
                    id="rp-fx-rate"
                    data-testid="record-payment-fx-rate"
                    inputmode="decimal"
                    autocomplete="off"
                    class="w-32 text-right tabular-nums"
                    value={fxRate()}
                    placeholder={`${orderCurrency()} / ${currency()}`}
                    disabled={locked()}
                    invalid={fxRate() !== '' && rate() === null}
                    onInput={(e) => setFxRate(e.currentTarget.value)}
                  />
                  <Show when={receivedCents()}>
                    {(received) => (
                      <span
                        data-testid="record-payment-fx-preview"
                        class="text-gray-500 tabular-nums"
                      >
                        {sprintf(
                          /* translators: %s: the amount received, converted into the order's currency */
                          _x(
                            '= %s',
                            "record payment: the amount received converted into the order's currency",
                          ),
                          money(received()),
                        )}
                      </span>
                    )}
                  </Show>
                </div>
              </Show>

              <label for="rp-method" class={labelClass}>
                {_x('Method', 'record payment form: how the payment was made, field label')}
              </label>
              <Select
                id="rp-method"
                data-testid="record-payment-method"
                value={method()}
                disabled={locked()}
                onChange={(e) => setMethod(e.currentTarget.value)}
              >
                <For each={methodOptions()}>
                  {(o) => <option value={o.value}>{o.label}</option>}
                </For>
              </Select>

              <label for="rp-received-on" class={labelClass}>
                {_x('Received on', 'record payment form: the day the money arrived, field label')}
              </label>
              <Input
                id="rp-received-on"
                data-testid="record-payment-received-on"
                type="date"
                class="w-40"
                max={today()}
                value={receivedOn()}
                disabled={locked()}
                onInput={(e) => setReceivedOn(e.currentTarget.value)}
              />

              <label for="rp-reference" class={labelClass}>
                {_x(
                  'Reference',
                  'record payment form: the transfer or cheque reference, field label',
                )}
              </label>
              <Input
                id="rp-reference"
                data-testid="record-payment-reference"
                autocomplete="off"
                maxlength={191}
                value={reference()}
                placeholder={_x('Optional', 'form field placeholder: the field may be left empty')}
                disabled={locked()}
                onInput={(e) => setReference(e.currentTarget.value)}
              />
            </div>

            {/* The check, stated beside the fields it reads, before anything is sent. */}
            <Show when={check().kind === 'short' && check()} keyed>
              {(c) =>
                c.kind === 'short' && (
                  <div
                    data-testid="record-payment-part"
                    class="px-3 py-2 rounded bg-sky-50 border border-sky-200 text-sky-800"
                  >
                    {sprintf(
                      /* translators: 1: what the payment comes to, 2: what the order owes, 3: what will still be owed */
                      __(
                        'A part payment: %1$s of the %2$s the order owes. The remaining %3$s stays owed, and the order stays unpaid — its stock does not move — until it is settled.',
                      ),
                      money(c.receivedCents),
                      money(owedCents()),
                      money(c.remainingCents),
                    )}
                  </div>
                )
              }
            </Show>
            <Show when={check().kind === 'shortWithin' && check()} keyed>
              {(c) =>
                c.kind === 'shortWithin' && (
                  <div
                    data-testid="record-payment-short-within"
                    class="px-3 py-2 rounded bg-amber-50 border border-amber-300 text-amber-800 space-y-2"
                  >
                    <p>
                      {sprintf(
                        /* translators: 1: the difference, 2: what the order owes */
                        __(
                          '%1$s less than the order owes (%2$s) — within your payment-difference tolerance.',
                        ),
                        money(c.differenceCents),
                        money(owedCents()),
                      )}
                    </p>
                    <label class="flex items-center gap-2">
                      <input
                        type="radio"
                        name="rp-difference"
                        data-testid="record-payment-accept-difference"
                        checked={acceptDifference()}
                        disabled={locked()}
                        onChange={() => setAcceptDifference(true)}
                      />
                      {_x(
                        'Accept the difference as settled',
                        'record payment: option, the order counts as paid in full',
                      )}
                    </label>
                    <Show when={acceptDifference()}>
                      <div class="pl-6">{reasonSelect()}</div>
                    </Show>
                    <label class="flex items-center gap-2">
                      <input
                        type="radio"
                        name="rp-difference"
                        data-testid="record-payment-keep-difference"
                        checked={!acceptDifference()}
                        disabled={locked()}
                        onChange={() => setAcceptDifference(false)}
                      />
                      {sprintf(
                        /* translators: %s: the difference that will stay owed */
                        _x(
                          'Keep %s owed',
                          'record payment: option, the difference is still to be paid',
                        ),
                        money(c.differenceCents),
                      )}
                    </label>
                  </div>
                )
              }
            </Show>
            <Show when={check().kind === 'over' && check()} keyed>
              {(c) =>
                c.kind === 'over' && (
                  <div
                    data-testid="record-payment-over"
                    class="px-3 py-2 rounded bg-amber-50 border border-amber-300 text-amber-800 space-y-2"
                  >
                    <p>
                      {sprintf(
                        /* translators: 1: the excess, 2: what the order owes */
                        __(
                          '%1$s more than the order owes (%2$s). The excess is recorded with the payment and stays the customer’s until it is refunded or kept. Why did it arrive?',
                        ),
                        money(c.differenceCents),
                        money(owedCents()),
                      )}
                    </p>
                    {reasonSelect()}
                  </div>
                )
              }
            </Show>

            <Show
              when={shortfall() !== null}
              fallback={
                <Show when={!partPayment()}>
                  <p class="text-xs text-gray-500">
                    {__(
                      'Recording the payment marks the order paid and commits its reserved stock — after a stock check.',
                    )}
                  </p>
                </Show>
              }
            >
              <div
                data-testid="record-payment-shortfall"
                class="px-3 py-2 rounded bg-amber-50 border border-amber-300 text-amber-800"
              >
                {sprintf(
                  _n(
                    'Not enough stock to fully capture this order — %d unit short. The payment is recorded with whichever you choose, except leaving the order on hold:',
                    'Not enough stock to fully capture this order — %d units short. The payment is recorded with whichever you choose, except leaving the order on hold:',
                    shortUnits(),
                  ),
                  shortUnits(),
                )}
              </div>

              {/* Primary shortfall actions: capture what's available, resolve the rest. */}
              <div class="flex flex-col gap-2 pt-1">
                <Button
                  variant="success"
                  disabled={mutation.isPending}
                  data-testid="record-payment-capture-refund"
                  onClick={() => run('capture_refund')}
                >
                  {__('Capture available & refund the shortfall')}
                </Button>
                <Button
                  variant="primary"
                  weight="outline"
                  disabled={mutation.isPending}
                  data-testid="record-payment-capture-choice"
                  onClick={() => run('capture_choice')}
                >
                  {__('Capture available & ask the customer')}
                </Button>
              </div>
            </Show>
          </Show>

          <Show when={mutation.isError}>
            <ErrorBanner as="div" class="px-3 py-2 text-sm bg-red-50 rounded">
              {mutation.error?.message ?? __('Capture failed.')}
            </ErrorBanner>
          </Show>
        </div>

        <ModalFooter>
          <Show
            when={done()}
            fallback={
              <>
                <Button
                  data-testid="record-payment-close"
                  variant="secondary"
                  disabled={mutation.isPending}
                  onClick={props.onClose}
                >
                  {/*
                    In the shortfall state, dismissing IS "leave on hold": the order is already
                    on hold and nothing was captured, so a no-op server call adds nothing.
                  */}
                  {shortfall() !== null
                    ? _x(
                        'Leave on hold',
                        'record payment: button, close without resolving the stock shortfall',
                      )
                    : __('Close')}
                </Button>

                <Show
                  when={shortfall() !== null}
                  fallback={
                    <Button
                      variant="success"
                      data-testid="record-payment-submit"
                      disabled={!canRecord() || mutation.isPending}
                      onClick={() => run(undefined)}
                    >
                      {mutation.isPending
                        ? _x(
                            'Recording…',
                            'record payment: button while the payment is being recorded',
                          )
                        : partPayment()
                          ? _x(
                              'Record part payment',
                              'record payment: button, records a payment for less than the order owes',
                            )
                          : __('Record payment & capture')}
                    </Button>
                  }
                >
                  <Button
                    variant="danger"
                    disabled={mutation.isPending}
                    data-testid="record-payment-cancel-order"
                    onClick={() => run('cancel')}
                  >
                    {__('Cancel order')}
                  </Button>
                </Show>
              </>
            }
          >
            <Button data-testid="record-payment-done" onClick={props.onClose}>
              {__('Done')}
            </Button>
          </Show>
        </ModalFooter>
      </ModalPanel>
    </Modal>
  );
}

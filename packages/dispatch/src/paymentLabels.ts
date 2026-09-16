import { _x } from '@invflux/i18n';

/** Which side of what the order owes a payment falls: less arrived, or more. */
export type DifferenceSide = 'shortfall' | 'excess';

interface DifferenceReason {
  value: string;
  label: string;
  shortfall: boolean;
  excess: boolean;
}

/**
 * Why a payment that differs from what the order owes may still settle it — the codes core registers
 * (`PaymentDifferenceReason`), with their labels and the side of what is owed each can explain: a
 * bank's fee only ever makes a payment short, and a customer paying more only ever makes it over.
 * Built on call, never at module load, so the labels are read in the locale that is active by then.
 */
function differenceReasons(): DifferenceReason[] {
  return [
    {
      value: 'bank_fee',
      label: _x(
        'Bank fee',
        'record payment: why the amount received differs from what the order owes, option',
      ),
      shortfall: true,
      excess: false,
    },
    {
      value: 'overpaid',
      label: _x(
        'Customer paid more',
        'record payment: why the amount received differs from what the order owes, option',
      ),
      shortfall: false,
      excess: true,
    },
    {
      value: 'fx',
      label: _x(
        'Exchange rate',
        'record payment: why the amount received differs from what the order owes, option',
      ),
      shortfall: true,
      excess: true,
    },
    {
      value: 'rounding',
      label: _x(
        'Rounding',
        'record payment: why the amount received differs from what the order owes, option',
      ),
      shortfall: true,
      excess: true,
    },
    {
      value: 'other',
      label: _x(
        'Other',
        'record payment: why the amount received differs from what the order owes, option',
      ),
      shortfall: true,
      excess: true,
    },
  ];
}

/** The reasons that can explain a difference on `side`. */
export function differenceReasonOptions(side: DifferenceSide): { value: string; label: string }[] {
  return differenceReasons()
    .filter((r) => r[side])
    .map(({ value, label }) => ({ value, label }));
}

/**
 * How a payment came to be on record, from its source: confirmed by a gateway, inferred from the
 * order reaching a status its payment method's policy says means paid (Processing for a bank
 * transfer, Completed for cash on delivery), or recorded by hand. The source itself for one this
 * build does not know — an add-on's own.
 */
export function paymentSourceLabel(source: string): string {
  switch (source) {
    case 'gateway':
      return _x('Confirmed by the gateway', 'order payment: how the payment came to be recorded');
    case 'host_status':
      return _x(
        'Inferred from the order status',
        'order payment: how the payment came to be recorded',
      );
    case 'manual':
      return _x('Recorded by hand', 'order payment: how the payment came to be recorded');
    default:
      return source;
  }
}

/** The label of a difference reason; the code itself for one this build does not know. */
export function differenceReasonLabel(code: string): string {
  return differenceReasons().find((r) => r.value === code)?.label ?? code;
}

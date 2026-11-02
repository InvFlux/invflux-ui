import { __ } from '@invflux/i18n';
import { Button } from '@invflux/ui';
import type { DispatchOrderPayments, UnrecordedPaymentAnswer } from '../types';

/** Whether the order detail shows no payment; not known counts as no, and the server still checks. */
export function noPaymentRecorded(payments: DispatchOrderPayments | null | undefined): boolean {
  return !!payments && !(Number.parseFloat(payments.paid) > 0);
}

/**
 * Asked before a refund on an order with no payment on record, ahead of any button that says
 * "refund": a record may simply be missing, so the operator decides. The server refuses the refund
 * until they have, which brings this up on a screen that did not know.
 */
export function NoRecordedPaymentQuestion(props: {
  disabled: boolean;
  onAnswer: (answer: UnrecordedPaymentAnswer) => void;
}) {
  return (
    <div
      class="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 space-y-2"
      data-testid="no-payment-question"
    >
      <p class="font-medium">{__('No payment is recorded on this order. Did the customer pay?')}</p>
      <p class="text-xs">
        {__(
          'If they paid, the refund goes ahead. If they never did, there is nothing to refund and no money moves.',
        )}
      </p>
      <div class="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          data-testid="no-payment-refund-anyway"
          disabled={props.disabled}
          onClick={() => props.onAnswer('refund')}
        >
          {__('They paid: refund')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          data-testid="no-payment-nothing-to-refund"
          disabled={props.disabled}
          onClick={() => props.onAnswer('nothing_to_refund')}
        >
          {__('They never paid: nothing to refund')}
        </Button>
      </div>
    </div>
  );
}

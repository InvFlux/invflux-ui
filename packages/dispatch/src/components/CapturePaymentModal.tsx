import { Show, createMemo, createSignal } from 'solid-js';
import { __ } from '@invflux/i18n';
import { Button, Modal } from '@invflux/ui';
import { useCapturePaymentMutation } from '../queries';
import type { CaptureResolution } from '../api';
import type { DispatchOrderSummary } from '../types';

/**
 * Record a manual payment for a manual-gateway order (BACS/cheque/COD) and capture stock —
 * the consult-before-capture control. Checks stock first: a clean capture marks the order
 * paid (`payment_complete`). A shortfall is never silently oversold — the merchant chooses:
 * capture the available units and refund the shortfall, capture them and let the customer
 * decide, leave the order on hold, or cancel it.
 */
export function CapturePaymentModal(props: {
  orderHexId: string;
  order: DispatchOrderSummary;
  onClose: () => void;
}) {
  const mutation = useCapturePaymentMutation(() => props.orderHexId);
  const [shortfall, setShortfall] = createSignal<number | null>(null);
  const [done, setDone] = createSignal<'captured_partial' | 'choice_offered' | null>(null);

  // The gateway label, or '' when the order carries no payment method (e.g. an
  // order hand-created in WC admin without picking a gateway). Empty → the copy
  // drops the "via …" clause rather than printing a meaningless placeholder.
  const gatewayLabel = createMemo(() => {
    const title = props.order.paymentMethodTitle?.trim();
    const method = props.order.paymentMethod?.trim();
    return title || method || '';
  });

  function run(resolution?: CaptureResolution): void {
    mutation.mutate(resolution, {
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
    });
  }

  const shortUnits = () => shortfall() ?? 0;
  const plural = () => (shortUnits() === 1 ? '' : 's');

  return (
    <Modal onClose={props.onClose} label="Record payment" backdropClass="bg-black/30 flex items-center justify-center p-6">
      <div class="bg-white rounded-md shadow-lg w-full max-w-md flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header class="px-5 py-3 border-b border-gray-200">
          <h2 class="text-base font-semibold text-gray-900">{__('Record payment received')}</h2>
        </header>

        <div class="px-5 py-4 space-y-3 text-sm">
          <div class="text-xs text-gray-500">
            <span class="font-medium text-gray-700">{props.order.customerName}</span>
            {' · '}Order #{props.order.externalId}
            <Show when={gatewayLabel()}>{' · '}{gatewayLabel()}</Show>
          </div>

          <Show when={done()}>
            <div class="px-3 py-2 rounded bg-emerald-50 border border-emerald-300 text-emerald-800">
              <Show
                when={done() === 'captured_partial'}
                fallback={
                  <>
                    Captured the in-stock units. The customer has been emailed to choose how to
                    handle the {shortUnits()} short unit{plural()}.
                  </>
                }
              >
                Captured the in-stock units and queued a refund for the {shortUnits()} short
                unit{plural()}. The order is now processing.
              </Show>
            </div>
          </Show>

          <Show when={!done()}>
            <Show
              when={shortfall() !== null}
              fallback={
                <p class="text-gray-700">
                  Confirm the customer's payment has been received
                  <Show when={gatewayLabel()}> via <strong>{gatewayLabel()}</strong></Show>. InvFlux
                  will mark the order paid and commit its reserved stock.
                </p>
              }
            >
              <div class="px-3 py-2 rounded bg-amber-50 border border-amber-300 text-amber-800">
                Not enough stock to fully capture this order — <strong>{shortUnits()}</strong> unit
                {plural()} short. Choose how to proceed:
              </div>

              {/* Primary shortfall actions: capture what's available, resolve the rest. */}
              <div class="flex flex-col gap-2 pt-1">
                <Button
                  variant="success"
                  disabled={mutation.isPending}
                  onClick={() => run('capture_refund')}
                >
                  {__('Capture available & refund the shortfall')}
                </Button>
                <Button
                  variant="primary"
                  weight="outline"
                  disabled={mutation.isPending}
                  onClick={() => run('capture_choice')}
                >
                  {__('Capture available & ask the customer')}
                </Button>
              </div>
            </Show>
          </Show>

          <Show when={mutation.isError}>
            <div class="px-3 py-2 text-sm bg-red-50 text-red-700 rounded">
              {mutation.error?.message ?? 'Capture failed.'}
            </div>
          </Show>
        </div>

        <footer class="px-5 py-3 border-t border-gray-200 flex items-center justify-end gap-2">
          <Show
            when={done()}
            fallback={
              <>
                <Button
                  variant="secondary"
                  disabled={mutation.isPending}
                  onClick={props.onClose}
                >
                  {/*
                    In the shortfall state, dismissing IS "leave on hold": the order is already
                    on hold and nothing was captured, so a no-op server call adds nothing.
                  */}
                  {shortfall() !== null ? 'Leave on hold' : 'Close'}
                </Button>

                <Show
                  when={shortfall() !== null}
                  fallback={
                    <Button
                      variant="success"
                      disabled={mutation.isPending}
                      onClick={() => run(undefined)}
                    >
                      {mutation.isPending ? 'Capturing…' : 'Record payment & capture'}
                    </Button>
                  }
                >
                  <Button
                    variant="danger"
                    disabled={mutation.isPending}
                    onClick={() => run('cancel')}
                  >
                    {__('Cancel order')}
                  </Button>
                </Show>
              </>
            }
          >
            <Button
              onClick={props.onClose}
            >
              {__('Done')}
            </Button>
          </Show>
        </footer>
      </div>
    </Modal>
  );
}

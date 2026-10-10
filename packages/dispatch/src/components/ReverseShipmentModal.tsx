import { Show, createSignal } from 'solid-js';
import { __, _x } from '@invflux/i18n';
import { Button, ErrorBanner, Modal, ModalFooter, ModalHeader, ModalPanel } from '@invflux/ui';
import { useOrderCorrectionsQuery, useReverseShipmentMutation } from '../queries';

/**
 * Confirm undoing a shipment whose Ship was confirmed by mistake — the goods never left.
 *
 * Says what it is not as plainly as what it is: a reversal is not a return. When the goods did leave
 * and came back, reversing would claim a parcel never went that a courier is holding. Where the
 * returns go depends on what this install offers: a return correction when an after-shipping
 * correction type is registered, otherwise a refund in WooCommerce, which InvFlux records as the
 * return (restocking the units when "Restock refunded items" is ticked). The reason is optional and
 * lands on the order's timeline.
 */
export function ReverseShipmentModal(props: {
  orderHexId: string;
  shipmentHexId: string;
  onClose: () => void;
}) {
  const [reason, setReason] = createSignal('');
  const mutation = useReverseShipmentMutation(() => props.orderHexId);
  // Already loaded by the order page, so this reads the cache. Asked of the types themselves rather
  // than the license: whichever plugin registers a return type is what makes one recordable here.
  const corrections = useOrderCorrectionsQuery(() => props.orderHexId);
  const canRecordReturn = (): boolean =>
    (corrections.data?.types ?? []).some((type) => !type.preDispatch);
  const confirm = (): void => {
    mutation.mutate(
      { shipmentHexId: props.shipmentHexId, reason: reason() },
      { onSuccess: () => props.onClose() },
    );
  };

  return (
    <Modal
      onClose={props.onClose}
      closeOnBackdrop={!mutation.isPending}
      closeOnEsc={!mutation.isPending}
      label={__('Reverse shipment')}
    >
      <ModalPanel size="md">
        <ModalHeader title={__('Reverse this shipment?')} />
        <div class="p-4 text-sm text-gray-700" data-testid="reverse-shipment-modal">
          <p class="mb-3">
            {__(
              'Use this only when the shipment was confirmed by mistake and nothing left the building. The units go back to being held for this order, and the order returns to the queue.',
            )}
          </p>
          <Show when={corrections.data}>
            <p class="mb-3 text-gray-600" data-testid="reverse-shipment-return-hint">
              {canRecordReturn()
                ? __(
                    'If the goods did leave and came back, record a return with a correction instead.',
                  )
                : __(
                    'If the goods did leave and came back, do not reverse: refund the order in WooCommerce instead, ticking “Restock refunded items” if they are back in stock. InvFlux records the return from the refund.',
                  )}
            </p>
          </Show>
          <label for="reverse-reason" class="mb-1 block text-xs text-gray-700">
            {_x('Reason (optional)', 'reverse shipment form: field label')}
          </label>
          <textarea
            id="reverse-reason"
            data-testid="reverse-shipment-reason"
            class="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            rows={2}
            maxLength={500}
            value={reason()}
            disabled={mutation.isPending}
            onInput={(e) => setReason(e.currentTarget.value)}
          />
          <Show when={mutation.isError}>
            <ErrorBanner as="div" class="mt-3 text-xs">
              {mutation.error?.message ?? __('Unknown error')}
            </ErrorBanner>
          </Show>
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={props.onClose} disabled={mutation.isPending}>
            {__('Cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={confirm}
            disabled={mutation.isPending}
            data-testid="reverse-shipment-confirm"
          >
            <Show when={mutation.isPending} fallback={<>{__('Reverse shipment')}</>}>
              {_x('Reversing…', 'button while busy: the shipment is being reversed')}
            </Show>
          </Button>
        </ModalFooter>
      </ModalPanel>
    </Modal>
  );
}

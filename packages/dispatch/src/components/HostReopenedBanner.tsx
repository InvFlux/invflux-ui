import { For, Show, createSignal } from 'solid-js';
import { __, sprintf } from '@invflux/i18n';
import { Button } from '@invflux/ui';
import { useDispatch } from '../context';
import { useRestoreCompletedMutation } from '../queries';
import { ReverseShipmentModal } from './ReverseShipmentModal';

/**
 * A shipped order WooCommerce has moved back to an unfinished status — usually a mis-clicked
 * Complete, undone the only way WooCommerce allows. InvFlux did not follow, and the order left the
 * queue when it shipped, so this is where the merchant decides which side is right:
 *
 * - **Restore Completed** — moving it back was the mistake. WooCommerce goes back to Completed, without
 *   sending the customer the "order completed" email a second time; nothing moves in InvFlux.
 * - **Reverse the shipment** — follow WooCommerce: the goods never left, so the units are held for
 *   the order again and it returns to the queue. One button per processed shipment, since an order
 *   shipped in parts has several and WooCommerce's move names none of them; shown only to someone who
 *   may reverse shipments.
 */
export function HostReopenedBanner(props: {
  orderHexId: string;
  statusLabel: string;
  shipments: string[];
}) {
  const ctx = useDispatch();
  const restore = useRestoreCompletedMutation(() => props.orderHexId);
  const [reversing, setReversing] = createSignal<string | null>(null);
  const canReverse = (): boolean => ctx.capabilities.reverseShipments === true;

  return (
    <div
      role="status"
      data-testid="host-reopened-banner"
      class="px-4 py-3 bg-amber-50 border-b border-amber-200 text-sm text-amber-900 flex flex-wrap items-center gap-3"
    >
      <span class="flex-1 min-w-[16rem]">
        {sprintf(
          /* translators: %s = the WooCommerce order status the shipped order was moved back to */
          __('This order shipped, but WooCommerce has it back in “%s”.'),
          props.statusLabel,
        )}{' '}
        {__('InvFlux did not change its records. Which is right?')}
      </span>
      <Button
        variant="primary"
        size="sm"
        data-testid="host-reopened-restore"
        disabled={restore.isPending}
        onClick={() => restore.mutate()}
      >
        {__('Restore Completed')}
      </Button>
      <Show when={canReverse()}>
        <For each={props.shipments}>
          {(shipmentHexId, index) => (
            <Button
              variant="secondary"
              size="sm"
              data-testid="host-reopened-reverse"
              onClick={() => setReversing(shipmentHexId)}
            >
              {props.shipments.length > 1
                ? sprintf(
                    /* translators: %d = which of the order's shipments, counting from 1 */
                    __('Reverse shipment %d…'),
                    index() + 1,
                  )
                : __('Reverse the shipment…')}
            </Button>
          )}
        </For>
      </Show>
      <Show when={restore.isError}>
        <span class="w-full text-red-700">
          {restore.error?.message ?? __('The order could not be restored.')}
        </span>
      </Show>
      <Show when={reversing()}>
        {(shipmentHexId) => (
          <ReverseShipmentModal
            orderHexId={props.orderHexId}
            shipmentHexId={shipmentHexId()}
            onClose={() => setReversing(null)}
          />
        )}
      </Show>
    </div>
  );
}

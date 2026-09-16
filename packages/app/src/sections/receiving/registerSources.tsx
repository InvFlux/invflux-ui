import { __ } from '@invflux/i18n';
import { slotRegistry } from '@invflux/ui';
import { type JSX, Show } from 'solid-js';
import { hasCapability } from '../../capabilities';
import { PoPicker } from './PoPicker';
import { PoReception } from './PoReception';
import { ReceiveStockForm } from './ReceiveStockForm';
import { RECEIVING_SOURCE_SLOT, type ReceivingSource } from './sources';

/**
 * The sources the base install offers, registered through the same seam an add-on uses — there is no
 * privileged core path into the chooser.
 *
 * Two ship today: a delivery answering a purchase order, and stock arriving against no document at
 * all. An advance shipping notice arrives with an add-on registering into this same slot.
 */
export function registerReceivingSources(): void {
  const purchaseOrder: ReceivingSource = {
    id: 'purchase-order',
    order: 10,
    label: () => __('A purchase order'),
    description: () => __('A delivery answering an order somebody here raised with a supplier.'),
    // Offered whenever this install has purchase orders at all — deliberately *not* gated on being
    // allowed to manage them. The whole point of receiving being its own surface is that the person
    // counting the pallet need not be the person who ordered it, and everything below this point is
    // served by receiving's own routes under the inventory capability.
    enabled: () => hasCapability('manageInventory'),
    // `rest` is the order id once one is chosen, so the source owns both steps: picking the document,
    // then counting it. No separate top-level route, and the back-link works from either.
    component: (props): JSX.Element => (
      <Show when={'' !== props.rest && !Number.isNaN(Number(props.rest))} fallback={<PoPicker />}>
        <PoReception poId={Number(props.rest)} />
      </Show>
    ),
  };

  const manual: ReceivingSource = {
    id: 'manual',
    order: 30,
    label: () => __('No document'),
    description: () =>
      __('An opening balance, a delivery nobody ordered, stock found on a shelf, goods made here.'),
    // The form takes no props: a source-less intake has no document to be told about.
    component: (): JSX.Element => <ReceiveStockForm />,
  };

  slotRegistry.register(RECEIVING_SOURCE_SLOT, purchaseOrder);
  slotRegistry.register(RECEIVING_SOURCE_SLOT, manual);
}

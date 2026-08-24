import type { JSX } from 'solid-js';
import { DISPATCH_STATUS_COLOR, Pill, STATUS_FALLBACK_COLOR } from '@invflux/ui';
import type { OrderStatus } from '../types';

/** Human label per InvFlux order status. */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  Untouched: 'Untouched',
  Started: 'Started',
  Staged: 'Staged',
  Shipped: 'Shipped',
  Cancelled: 'Cancelled',
};

/**
 * The order-status pill, shared by the queue rows and the order-detail header.
 *
 * Colour comes from the shared status palette, not a local class map: this pill renders directly
 * beside the *host's* order-status pill in the queue, so the two vocabularies have to be coloured
 * as one set rather than each picking its own blue.
 */
export function OrderStatusChip(props: { status: OrderStatus }): JSX.Element {
  return (
    <Pill
      colorId={DISPATCH_STATUS_COLOR[props.status] ?? STATUS_FALLBACK_COLOR}
      class={'Staged' === props.status ? 'font-medium' : undefined}
    >
      {STATUS_LABEL[props.status]}
    </Pill>
  );
}

import type { JSX } from 'solid-js';
import { _x } from '@invflux/i18n';
import { DISPATCH_STATUS_COLOR, Pill, STATUS_FALLBACK_COLOR } from '@invflux/ui';
import type { OrderStatus } from '../types';

/**
 * Human label per InvFlux order status.
 *
 * **Getters, not strings** — this module is evaluated at chunk load, before the locale is
 * installed, so a `__()` at the top level would freeze English into the bundle.
 *
 * **`_x` with a context, not `__`.** Every one of these five is a bare English participle that
 * means something else elsewhere in this catalogue — `Shipped` already exists as a saved-view
 * label meaning *provisioned with the plugin*, translated "Intégré". Without a context a
 * translator sees one word and has to guess which sense, and the two collapse into one entry the
 * moment they collide.
 */
export const STATUS_LABEL: Record<OrderStatus, () => string> = {
  Untouched: () => _x('Untouched', 'dispatch readiness'),
  Started: () => _x('Started', 'dispatch readiness'),
  Staged: () => _x('Staged', 'dispatch readiness'),
  Shipped: () => _x('Shipped', 'dispatch readiness'),
  Cancelled: () => _x('Cancelled', 'dispatch readiness'),
};

/**
 * What each status says, for the pill's tooltip. It sits beside the WooCommerce status pill, so it
 * names whose status it is before saying what it means.
 */
export const STATUS_EXPLANATION: Record<OrderStatus, () => string> = {
  Untouched: () => _x('Dispatch: nothing has been packed yet.', 'dispatch readiness meaning'),
  Started: () =>
    _x(
      'Dispatch: packing has begun, but the order is not ready to ship as a whole.',
      'dispatch readiness meaning',
    ),
  Staged: () =>
    _x(
      'Dispatch: everything left to send is packed, so the order is ready to ship.',
      'dispatch readiness meaning',
    ),
  Shipped: () =>
    _x(
      'Dispatch: nothing is left to send. Every line has shipped or was cleared by a correction.',
      'dispatch readiness meaning',
    ),
  Cancelled: () =>
    _x('Dispatch: the order was cancelled before it shipped.', 'dispatch readiness meaning'),
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
      title={STATUS_EXPLANATION[props.status]()}
      data-testid="dispatch-status-pill"
      data-status={props.status}
    >
      {STATUS_LABEL[props.status]()}
    </Pill>
  );
}

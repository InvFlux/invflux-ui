import { _x, sprintf } from '@invflux/i18n';
import { WC_ORDER_STATUS_COLOR, WC_ORDER_STATUS_FALLBACK_COLOR } from '@invflux/ui';
import type { NativeStatusContext } from './types';

type NativeStatusOptions = NativeStatusContext['options'];

/**
 * The palette entry InvFlux *ships* for a host status, keyed on the unprefixed slug as it lands on
 * the URL. Chosen alongside the InvFlux dispatch status this pill renders next to.
 *
 * Only the fallback: {@link nativeStatusColor} puts the merchant's own choice ahead of it. On its
 * own it returns grey for any status InvFlux has never heard of, which is exactly why the configured
 * colour has to come first: a merchant running three custom statuses would otherwise read three
 * identical pills on a scan-first surface.
 */
export function shippedNativeStatusColor(slug: string): number {
  return WC_ORDER_STATUS_COLOR[slug] ?? WC_ORDER_STATUS_FALLBACK_COLOR;
}

/**
 * Configured colour → shipped default → grey. Compared against `null`/`undefined` rather than by
 * truthiness, since colour 0 is Light grey: a real, deliberate choice.
 */
export function nativeStatusColor(options: NativeStatusOptions, slug: string): number {
  const colorId = options.find((o) => o.value === slug)?.colorId;

  return null !== colorId && undefined !== colorId ? colorId : shippedNativeStatusColor(slug);
}

/**
 * WooCommerce's own order states that are not in its status list, so the install never names them.
 * `trash` is where an order moved to the bin sits until it is restored or deleted.
 */
const UNLISTED_CORE_STATUS_LABEL: Record<string, () => string> = {
  trash: () => _x('Trash', 'WooCommerce order status: moved to the bin'),
};

/** The merchant-facing name of a host status, or its slug when neither the install nor WooCommerce names it. */
export function nativeStatusLabel(options: NativeStatusOptions, slug: string): string {
  return (
    options.find((o) => o.value === slug)?.label ?? UNLISTED_CORE_STATUS_LABEL[slug]?.() ?? slug
  );
}

/**
 * What WooCommerce's own statuses mean, for the pill's tooltip. Getters: this module loads before
 * the locale is installed.
 */
const CORE_STATUS_MEANING: Record<string, () => string> = {
  pending: () => _x('WooCommerce: awaiting payment.', 'WooCommerce order status meaning'),
  'on-hold': () =>
    _x(
      'WooCommerce: on hold, usually until the payment is confirmed.',
      'WooCommerce order status meaning',
    ),
  processing: () =>
    _x('WooCommerce: paid, waiting to be sent.', 'WooCommerce order status meaning'),
  completed: () =>
    _x('WooCommerce: fulfilled, nothing left to do.', 'WooCommerce order status meaning'),
  cancelled: () =>
    _x('WooCommerce: cancelled by the store or the customer.', 'WooCommerce order status meaning'),
  refunded: () => _x('WooCommerce: refunded in full.', 'WooCommerce order status meaning'),
  failed: () =>
    _x('WooCommerce: the payment failed or was declined.', 'WooCommerce order status meaning'),
  'checkout-draft': () =>
    _x(
      'WooCommerce: the customer has not finished checking out.',
      'WooCommerce order status meaning',
    ),
  trash: () =>
    _x(
      'WooCommerce: moved to the bin. It can still be restored, or deleted for good.',
      'WooCommerce order status meaning',
    ),
};

/**
 * The tooltip of the WooCommerce status pill: what the status means, for WooCommerce's own
 * statuses, and where it comes from for one a plugin added.
 */
export function nativeStatusExplanation(options: NativeStatusOptions, slug: string): string {
  const meaning = CORE_STATUS_MEANING[slug];
  if (meaning) return meaning();

  return sprintf(
    /* translators: %s: the name of an order status that another plugin added to WooCommerce */
    _x('WooCommerce: “%s”, a status another plugin added.', 'WooCommerce order status meaning'),
    nativeStatusLabel(options, slug),
  );
}

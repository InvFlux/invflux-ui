import { __, sprintf } from '@invflux/i18n';
import { type JSX, Show } from 'solid-js';
import type { VarianceStatus } from '../sections/purchase-orders/types';

/**
 * Stage-neutral PO-line variance badge — the Essentials "flag short/over, don't block" signal
 * The classification comes from the shared client mirror of core
 * `VarianceStatus` (lib/variance.ts); this only paints it.
 *
 * Two `kind`s, never shown at once for one line (confirmation lives pre-reception, delivery
 * during/after):
 * - `delivery`     → received vs the chosen lens baseline. Over +N (amber) · Short −N (red) ·
 *                    Exact (quiet green) · open renders nothing (still filling; the Open column says it).
 * - `confirmation` → supplier-confirmed (OA/ASN) vs ordered. Confirmed +N (amber) / −N (red), or a
 *                    plain green "Confirmed" when the OA matches the order exactly. The caller only
 *                    renders this kind once an OA/ASN is actually recorded (an unconfirmed line shows
 *                    nothing), so a match here means a real, agreeing confirmation — worth the pill.
 *
 * The magnitude is the signed variance from the same mirror, so the badge never re-derives a baseline.
 */
const TONE: Record<Exclude<VarianceStatus, 'open'>, string> = {
  over: 'bg-amber-100 text-amber-800',
  short: 'bg-red-100 text-red-700',
  match: 'bg-green-100 text-green-700',
};

export function VarianceBadge(props: { status: VarianceStatus; varianceQty: number; kind: 'delivery' | 'confirmation' }): JSX.Element {
  const magnitude = (): number => Math.abs(props.varianceQty);
  // Only `open` (still-filling delivery) is silent; both a delivery match ("Exact") and a confirmation
  // match ("Confirmed") render as positive reconciliation.
  const visible = (): boolean => 'open' !== props.status;

  const text = (): string => {
    if ('confirmation' === props.kind) {
      switch (props.status) {
        case 'over':
          // translators: %d = units the supplier confirmed above the ordered quantity.
          return sprintf(__('Confirmed +%d'), magnitude());
        case 'short':
          // translators: %d = units the supplier confirmed below the ordered quantity.
          return sprintf(__('Confirmed −%d'), magnitude());
        default:
          return __('Confirmed');
      }
    }
    switch (props.status) {
      case 'over':
        // translators: %d = units received over the baseline quantity.
        return sprintf(__('Over +%d'), magnitude());
      case 'short':
        return magnitude() > 0
          // translators: %d = units received short of the baseline quantity.
          ? sprintf(__('Short −%d'), magnitude())
          : __('Short');
      default:
        return __('Exact');
    }
  };

  const tone = (): string => TONE[props.status as Exclude<VarianceStatus, 'open'>] ?? '';

  return (
    <Show when={visible()}>
      <span class={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${tone()}`}>{text()}</span>
    </Show>
  );
}

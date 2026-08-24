import { __ } from '@invflux/i18n';
import type { JSX } from 'solid-js';
import { PROCUREMENT_STATUS_COLOR, Pill, STATUS_FALLBACK_COLOR } from '@invflux/ui';

/**
 * Small status pill — procurement-local. `StagePill` from `@invflux/ui` is dispatch-specific
 * (its `StageCode` enum + fixed labels don't fit supplier/PO status), so we render a tiny
 * Tailwind pill here (arch-ui-principles §6); promote to a shared `StatusPill` later if both
 * surfaces converge on a variant vocabulary.
 */
/**
 * Palette entry for a status/stage — shared so a drill-down pill matches its list badge. Defaults
 * live in `@invflux/ui`'s status palette, chosen alongside the other three status vocabularies
 * rather than in isolation here.
 */
export function stageColor(status: string): number {
  return PROCUREMENT_STATUS_COLOR[status] ?? STATUS_FALLBACK_COLOR;
}

function label(status: string): string {
  switch (status) {
    case 'active':
      return __('Active');
    case 'inactive':
      return __('Inactive');
    case 'in_prep':
      return __('Draft');
    case 'submitted':
      return __('Submitted');
    case 'in_transit':
      return __('In transit');
    case 'in_reception':
      return __('Receiving');
    case 'partially_received':
      return __('Partially received');
    case 'received':
      return __('Received');
    case 'cancelled':
      return __('Cancelled');
    case 'archived':
      return __('Archived');
    default:
      return status;
  }
}

export function StatusPill(props: { status: string }): JSX.Element {
  return (
    <Pill colorId={stageColor(props.status)} class="font-medium">
      {label(props.status)}
    </Pill>
  );
}

import { __ } from '@invflux/i18n';
import { slotRegistry } from '@invflux/ui';
import { lazy } from 'solid-js';
import { hasCapability } from '../../capabilities';
import { surfaceEnabled } from '../../surfaces';

/**
 * Register the Receiving section. A `lazy()` chunk loaded on first visit to `/receiving`.
 *
 * `order: 13` puts it between Procurement (12) and Dispatch (15) — goods in, then goods out.
 *
 * Gated on `manageInventory`, **not** on managing purchase orders: recording an arrival is a stock
 * movement, and the person who does it all day is often not the person who raises the orders. That
 * is also why it is a surface of its own rather than a tab inside Procurement — an install that
 * builds in-house rather than buying can disable Procurement entirely and still receive.
 */
export function registerReceivingSection(): void {
  slotRegistry.register<Record<string, never>>('nav.section', {
    id: 'receiving',
    order: 13,
    label: () => __('Receiving'),
    enabled: () => hasCapability('manageInventory') && surfaceEnabled('receiving'),
    component: lazy(() => import('./ReceivingSection')),
  });
}

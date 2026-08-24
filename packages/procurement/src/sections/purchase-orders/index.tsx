import { slotRegistry } from '@invflux/ui';
import { PROCUREMENT_NAV_SLOT } from '../../navSlot';
import { __ } from '@invflux/i18n';
import { PoSection } from './PoSection';

/**
 * Register the core Purchase Orders section (arch-ui-principles §3.1). Mounts at
 * `/purchase-orders/*`; `order: 10` makes it the first top tab **and** the `/` landing — ops
 * (the daily PO surface) before admin/setup (Suppliers).
 */
export function registerPurchaseOrdersSection(): void {
  slotRegistry.register<Record<string, never>>(PROCUREMENT_NAV_SLOT, {
    id: 'purchase-orders',
    order: 10,
    label: () => __('Purchase Orders'),
    component: PoSection,
  });
}

import { slotRegistry } from '@invflux/ui';
import { PROCUREMENT_NAV_SLOT } from '../../navSlot';
import { __ } from '@invflux/i18n';
import { SuppliersSection } from './SuppliersSection';

/**
 * Register the core Suppliers section through the same Procurement section seam add-ons use
 * (arch-ui-principles §3.1 — no privileged core path). The section mounts at `/suppliers/*`
 * (App.tsx) and routes list ↔ detail internally (SuppliersSection).
 */
export function registerSuppliersSection(): void {
  slotRegistry.register<Record<string, never>>(PROCUREMENT_NAV_SLOT, {
    id: 'suppliers',
    order: 20,
    label: () => __('Suppliers'),
    component: SuppliersSection,
  });
}

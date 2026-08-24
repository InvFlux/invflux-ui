import { __ } from '@invflux/i18n';
import { slotRegistry } from '@invflux/ui';
import { lazy } from 'solid-js';
import { hasCapability } from '../../capabilities';
import { surfaceEnabled } from '../../surfaces';

/**
 * Register the Procurement section (stage c). A `lazy()` chunk loaded on first visit to
 * `/procurement`. `order: 12` places it between Workbench (10) and Dispatch (15). Procurement is a
 * **routed surface** (owns internal Purchase-Orders/Suppliers navigation) — see `ROUTED_SURFACES` in
 * `surfaceRouter.ts`, which the shell uses to give it a MemoryHistory + hash bridge. `label` is a
 * getter (rendered at request time) so the tab caption is translated — matching the WP sidebar —
 * instead of the untranslated `humanize()` fallback.
 */
export function registerProcurementSection(): void {
  slotRegistry.register<Record<string, never>>('nav.section', {
    id: 'procurement',
    order: 12,
    label: () => __('Procurement'),
    enabled: () => hasCapability('managePurchaseOrders') && surfaceEnabled('procurement'),
    component: lazy(() => import('./ProcurementSection')),
  });
}

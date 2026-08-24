import { __ } from '@invflux/i18n';
import { slotRegistry } from '@invflux/ui';
import { lazy } from 'solid-js';
import { hasCapability } from '../../capabilities';
import { surfaceEnabled } from '../../surfaces';

/**
 * Register the Dispatch section (stage c). A `lazy()` chunk loaded on first visit to `/dispatch`.
 * `order: 15` places it after Workbench (10). Dispatch is a **routed surface** (owns internal
 * list/detail navigation) — see `ROUTED_SURFACES` in `surfaceRouter.ts`, which the shell uses to give
 * it a MemoryHistory + hash bridge. `label` is a getter (rendered at request time) so the tab caption
 * is translated — matching the WP sidebar — instead of the untranslated `humanize()` fallback.
 */
export function registerDispatchSection(): void {
  slotRegistry.register<Record<string, never>>('nav.section', {
    id: 'dispatch',
    order: 15,
    label: () => __('Dispatch'),
    enabled: () => hasCapability('dispatchOrders') && surfaceEnabled('dispatch'),
    component: lazy(() => import('./DispatchSection')),
  });
}

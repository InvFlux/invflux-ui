import { __ } from '@invflux/i18n';
import { slotRegistry } from '@invflux/ui';
import { lazy } from 'solid-js';
import { hasCapability } from '../../capabilities';
import { surfaceEnabled } from '../../surfaces';

/**
 * Register the Workbench section. The component is a
 * `lazy()` import, so the whole workbench view + its deps land in a separate hashed chunk loaded
 * only when `/workbench` is first visited. `order: 10` makes it the app's landing route.
 *
 * `label` is a getter (called at render, never at registration) so the caption is translated —
 * "Workbench" / fr "Établi" — instead of the untranslated `humanize('workbench')` fallback.
 */
export function registerWorkbenchSection(): void {
  slotRegistry.register<Record<string, never>>('nav.section', {
    id: 'workbench',
    order: 10,
    label: () => __('Workbench'),
    enabled: () => hasCapability('viewStock') && surfaceEnabled('workbench'),
    component: lazy(() => import('./WorkbenchSection')),
  });
}

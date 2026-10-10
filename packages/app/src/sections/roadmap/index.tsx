import { __ } from '@invflux/i18n';
import { slotRegistry } from '@invflux/ui';
import { lazy } from 'solid-js';
import { surfaceEnabled } from '../../surfaces';

/**
 * Register the Roadmap section — what is being built, and what this shop wants next.
 *
 * `order: 80` puts it after the operational surfaces: a merchant opens Workbench or Dispatch to do
 * today's work and the roadmap to think about next quarter, so it sits with the things you visit on
 * purpose rather than by routine.
 *
 * **Gated on no capability.** Every other surface here is gated on what the visitor may *cause*,
 * and reading a public roadmap causes nothing — the route behind it reaches an anonymous document.
 * The one privileged act, voting, is gated where it happens: the proxy route requires the settings
 * capability, and the server requires the activation token. A capability gate here would hide the
 * page from a shop manager who is perfectly entitled to read it.
 */
export function registerRoadmapSection(): void {
  slotRegistry.register<Record<string, never>>('nav.section', {
    id: 'roadmap',
    order: 80,
    label: () => __('Roadmap'),
    enabled: () => surfaceEnabled('roadmap'),
    component: lazy(() => import('./RoadmapSection')),
  });
}

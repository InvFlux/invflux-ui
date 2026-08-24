import { __ } from '@invflux/i18n';
import { slotRegistry } from '@invflux/ui';
import { lazy } from 'solid-js';
import { ESSENTIALS_WELCOME, WELCOME_SLOT, type WelcomeProps } from '../../welcomeCatalog';

/**
 * Register the base install's own welcome screen — through the same `onboarding.welcome` seam an
 * add-on uses, so the core screen is not a special case the shell has to know about.
 *
 * `order: 0` puts it first when more than one welcome is outstanding: a merchant installing the base
 * and an add-on together should meet the "hand your catalogue over" step before anything built on top
 * of it. The component is a `lazy()` import, so a store that never sees a first run never loads it.
 *
 * `label` is a getter (called at render, never at registration) so the tab caption resolves under the
 * active locale — and so it re-resolves after a locale change instead of staying in whichever locale
 * the tab was first opened in.
 */
export function registerEssentialsWelcome(): void {
  slotRegistry.register<WelcomeProps>(WELCOME_SLOT, {
    id: ESSENTIALS_WELCOME,
    order: 0,
    label: () => __('Welcome to Essentials'),
    component: lazy(() => import('./WelcomeSection')),
  });
}

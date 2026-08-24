import { slotRegistry } from '@invflux/ui';
import type { JSX } from 'solid-js';
import { humanize } from './surfaceCatalog';

/**
 * The **welcome catalog**: the first-run screens installed on this site, one per InvFlux-family
 * plugin. Like the surface catalog, add-ons *push* into it through a shared slot rather than the core
 * maintaining a list of screens it does not own — a plugin that is not installed is simply absent.
 *
 * Each page owns a route of its own, `#/welcome-to-<slug>`, so a plugin activated long after the base
 * still has somewhere of its own to land and neither screen can stand in for the other. The PHP half
 * (which slugs exist, and which are still outstanding) is the `WelcomeRegistry`; this half is the UI
 * the slug resolves to.
 */
export const WELCOME_SLOT = 'onboarding.welcome';

/** Slug of the base install's own welcome page — the counterpart of PHP's `WelcomeRegistry`. */
export const ESSENTIALS_WELCOME = 'essentials';

/** Context props the shell passes into a welcome screen. */
export interface WelcomeProps {
  /** The screen's own slug — the `<slug>` of the `#/welcome-to-<slug>` route it is mounted at. */
  slug: string;
  /**
   * Mark this plugin's welcome as settled — the merchant completed it, declined it, or it had nothing
   * to offer. Releases the landing diversion immediately, without waiting for a page load; the
   * server-side flag the screen also clears stays the authority.
   */
  settle: () => void;
}

export interface WelcomePage {
  slug: string;
  /** Resolved caption, used as the tab title. */
  label: string;
  component: (props: WelcomeProps) => JSX.Element;
}

/** Installed welcome pages, registry order (ascending `order`). */
export const welcomeCatalog = (): WelcomePage[] =>
  slotRegistry.get<WelcomeProps>(WELCOME_SLOT).map((c) => ({
    slug: c.id,
    label: c.label?.() ?? humanize(c.id),
    component: c.component,
  }));

/** The page registered for a slug, or undefined — an add-on's slug with the add-on's bundle absent. */
export const welcomePage = (slug: string): WelcomePage | undefined =>
  welcomeCatalog().find((w) => w.slug === slug);

/** Route for a welcome page. One place builds it, so PHP's redirect target and this cannot drift. */
export const welcomePath = (slug: string): string => `/welcome-to-${slug}`;

/**
 * Whether a tab restored from the persisted workspace still has a route behind it.
 *
 * Welcome tabs are the one kind that can lose one: their route comes from a registry another plugin
 * owns, so deactivating that plugin leaves a tab in the strip that opens nothing — it survives in the
 * snapshot indefinitely, because a tab is only removed by being closed. Every other tab is a fixed
 * route and passes straight through.
 */
export const tabStillRoutes = (path: string): boolean => {
  const welcome = /^\/welcome(?:-to-([a-z0-9-]+))?$/.exec(path);

  return null === welcome || (undefined !== welcome[1] && undefined !== welcomePage(welcome[1]));
};

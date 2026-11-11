import { createContext, useContext } from 'solid-js';

/**
 * How the SPAs build links to *other* InvFlux destinations.
 *
 * The SPA packages are host-neutral: they know InvFlux's own route space (`/workbench`,
 * `/ledger/32`, `/procurement/suppliers/1/products`) but nothing about how a given host exposes it.
 * A WordPress plugin serves each surface from its own admin page; the unified app serves them all as
 * hash routes in one page; another platform will do something else again. Injecting this port keeps
 * that knowledge at the edge instead of hard-coding admin URLs across the component tree.
 *
 * Every implementation of the host binding lives in `./host/*` — one file per platform.
 */
export interface HostNav {
  /**
   * Href for an InvFlux app route, optionally with a query string (no leading `?`).
   * `route` is always app-relative and host-agnostic: `/workbench`, `/ledger/32`.
   */
  routeHref(route: string, query?: string): string;

  /**
   * Href for an InvFlux admin page that is NOT an SPA route — upgrade prompts and similar
   * host-rendered pages. Returns null when the host has no such page.
   */
  pageHref(page: string): string | null;

  /**
   * True when `routeHref` targets leave the current document (separate host pages), so callers
   * should open a new tab; false when they navigate within a single-page host.
   */
  opensNewTab: boolean;

  /**
   * Href for the host's own page that edits a taxonomy's terms (a product attribute's values, the
   * categories), or null when the host has none. Optional: a binding that links to no such page
   * leaves it out.
   */
  termsHref?(taxonomy: string): string | null;

  /**
   * Whether the current user can open `route` on this host. False where the route belongs to a
   * surface this user may not open, so a caller shows the text without a link to a page that would
   * refuse them. Optional: a binding that cannot tell leaves it out, and callers link as before.
   */
  canOpen?(route: string): boolean;
}

/** Whether `route` may be linked on `nav`: a host that cannot tell is trusted to serve it. */
export const linksTo = (nav: HostNav | undefined, route: string): nav is HostNav =>
  undefined !== nav && false !== nav.canOpen?.(route);

/**
 * Deliberately has **no default**. A default binding would make a missing provider invisible: every
 * link would still render, and be wrong only in ways nobody notices until they are clicked on the
 * wrong host — silently degrading to full-page loads under a single-page host, or to another
 * platform's URL shapes entirely. An entrypoint that mounts InvFlux UI must say which host it is.
 */
export const HostNavCtx = createContext<HostNav>();

export const useHostNav = (): HostNav => {
  const nav = useContext(HostNavCtx);
  if (undefined === nav) {
    throw new Error(
      'No HostNav in context: wrap the mount in <HostNavCtx.Provider> for this host.',
    );
  }
  return nav;
};

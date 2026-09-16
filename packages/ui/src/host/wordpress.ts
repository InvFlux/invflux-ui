import type { HostNav } from '../hostNav';

/**
 * The **WordPress binding** — the single place in the UI packages that knows wp-admin URL shapes.
 *
 * Everything platform-specific about linking lives here: that surfaces are served from
 * `admin.php?page=<slug>`, that the SPA route rides in the fragment, and what each surface's page
 * slug is. The rest of the UI speaks only InvFlux routes (`/workbench`, `/ledger/32`).
 *
 * Keeping it in one labelled file is deliberate: a second platform adds a sibling here rather than
 * editing components, and if the WordPress binding is ever moved into the WordPress adapter itself
 * it is a file move, not a refactor.
 */

/** InvFlux route's first segment → the wp-admin page slug that serves that surface standalone. */
const PAGE_BY_SURFACE: Record<string, string> = {
  workbench: 'invflux',
  procurement: 'invflux-procurement',
  dispatch: 'invflux-dispatch',
  settings: 'invflux-settings',
  // Per-product ledger has no standalone page; it is a route of the unified app.
  ledger: 'invflux-app',
};

/** wp-admin base for the current document, e.g. `https://site/wp-admin` (no trailing slash). */
function adminBase(): string {
  return `${window.location.pathname.split('/wp-admin/')[0]}/wp-admin`;
}

export const wordpressHostNav: HostNav = {
  routeHref(route, query) {
    const path = route.startsWith('/') ? route.slice(1) : route;
    const [surface, ...rest] = path.split('/');
    const page = PAGE_BY_SURFACE[surface ?? ''] ?? 'invflux-app';
    // The surface's own page serves it at the route remainder; the unified app keeps the full route.
    const fragment =
      'invflux-app' === page ? `#/${path}` : rest.length > 0 ? `#/${rest.join('/')}` : '';
    const q = query ? `&${query}` : '';
    return `admin.php?page=${page}${q}${fragment}`;
  },

  pageHref(page) {
    return `${adminBase()}/admin.php?page=${page}`;
  },

  // Each surface is its own admin page, so cross-surface links leave the current document.
  opensNewTab: true,
};

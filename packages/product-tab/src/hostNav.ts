import { type HostNav, wordpressHostNav } from '@invflux/ui';

/**
 * The product-tab's host binding. The tab is embedded in WooCommerce's own product-edit page — a
 * *different* wp-admin page from the unified InvFlux app — so a link to an InvFlux surface is an
 * absolute cross-page URL into the unified app (`admin.php?page=invflux-app`), carrying the app route
 * *and its query* in the fragment the SPA router reads (`#/workbench?post_ids=…`). The query must sit
 * inside the hash, not as a document query param: the SPA seeds its filters from `location.hash`, so
 * `?page=invflux-app&post_ids=…#/workbench` would strand the scope.
 *
 * Contrast the two siblings: {@link wordpressHostNav} routes each surface to its own standalone admin
 * page (dead since the unified-app move — `page=invflux` no longer serves the workbench), and the
 * unified app's own binding emits a *relative* in-page hash (it is already on `invflux-app`). This one
 * is the cross-page case: from WC's product screen into the unified app.
 *
 * `opensNewTab` is true — a merchant is mid-edit on the product screen, so jumping to a full InvFlux
 * surface opens a new tab and keeps their unsaved edit context intact.
 */
export const productTabHostNav: HostNav = {
  routeHref: (route, query) => {
    const path = route.startsWith('/') ? route : `/${route}`;
    return `admin.php?page=invflux-app#${path}${query ? `?${query}` : ''}`;
  },
  pageHref: (page) => wordpressHostNav.pageHref(page),
  opensNewTab: true,
};

import { type HostNav, wordpressHostNav } from '@invflux/ui';

/**
 * The unified app's host binding: every InvFlux surface is a hash route in THIS page, so a
 * cross-surface link is an in-app navigation rather than a trip to another admin page. Provided once
 * at the shell, so every embedded surface (Workbench, Procurement, Dispatch) and every shared
 * component (the grid's ledger link, supplier pills, FeatureGate) links in-app automatically.
 *
 * Non-SPA pages (upgrade prompts) are still host-rendered pages, so those delegate to the WordPress
 * binding — this app runs inside wp-admin.
 */
export const unifiedHostNav: HostNav = {
  routeHref: (route, query) => {
    const path = route.startsWith('/') ? route : `/${route}`;
    return `#${path}${query ? `?${query}` : ''}`;
  },
  pageHref: (page) => wordpressHostNav.pageHref(page),
  // Surfaces live in this document — links navigate in place and keep the tab set alive.
  opensNewTab: false,
};

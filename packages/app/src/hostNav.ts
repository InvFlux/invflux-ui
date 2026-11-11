import { type HostNav, wordpressHostNav } from '@invflux/ui';
import { allSurfaceIds, surfaceCatalog } from './surfaceCatalog';

/**
 * The unified app's host binding: every InvFlux surface is a hash route in THIS page, so a
 * cross-surface link is an in-app navigation rather than a trip to another admin page. Provided once
 * at the shell, so every embedded surface (Workbench, Procurement, Dispatch) and every shared
 * component (the grid's ledger link, supplier pills, FeatureGate) links in-app automatically.
 *
 * Non-SPA pages are still host-rendered pages, so those delegate to the WordPress binding — this app
 * runs inside wp-admin.
 */
export const unifiedHostNav: HostNav = {
  routeHref: (route, query) => {
    const path = route.startsWith('/') ? route : `/${route}`;
    return `#${path}${query ? `?${query}` : ''}`;
  },
  pageHref: (page) => wordpressHostNav.pageHref(page),
  termsHref: (taxonomy) => wordpressHostNav.termsHref?.(taxonomy) ?? null,
  // Surfaces live in this document — links navigate in place and keep the tab set alive.
  opensNewTab: false,
  // A route under a surface opens only where that surface is available to this user — the same
  // test that decides which tabs they see. A route outside every surface (the ledger, settings) is
  // not this binding's to refuse.
  canOpen: (route) => {
    const surface = route.replace(/^\/+/, '').split('/')[0] ?? '';
    return !allSurfaceIds().includes(surface) || surfaceCatalog().some((s) => s.id === surface);
  },
};

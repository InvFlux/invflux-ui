import {
  keepVisibleDuringModals,
  keepWordPressAnnouncementsAudible,
  registerCssPropertyRules,
  registerThemeRoot,
} from '@invflux/ui';
import { render } from 'solid-js/web';
import * as solidRuntimeCore from 'solid-js';
import * as solidRuntimeStore from 'solid-js/store';
import * as solidRuntimeWeb from 'solid-js/web';
import { setLocale, setTextDomain } from '@invflux/i18n';
import { App } from './App';
import { setCapabilities } from './capabilities';
import { setOnboarding } from './onboarding';
import { setSurfaceModes, surfaceMode } from './surfaces';
import { surfaceCatalog } from './surfaceCatalog';
import { registerDispatchSection } from './sections/dispatch';
import { registerProcurementSection } from './sections/procurement';
import { registerReceivingSection } from './sections/receiving';
import { registerEssentialsWelcome } from './sections/welcome';
import { registerWorkbenchSection } from './sections/workbench';
import { installPluginApi as installDispatchPluginSurface } from '@invflux/dispatch/src/plugin-api';
import { installPluginApi as installProcurementPluginSurface } from '@invflux/procurement/src/plugin-api';
import { installPluginApi as installWorkbenchPluginSurface } from '@invflux/workbench/src/plugin-api';
import type { AppContext } from './types';
import { hasSeenSurface, markSeen, pinTab, restoreTabs } from './openTabs';
import { restoreSurfaceLocations } from './surfaceRouter';
import { tabStillRoutes } from './welcomeCatalog';
import { readBootSnapshot, seedRouteFor } from './workspacePersistence';
import { startWpMenuSync } from './wpMenuSync';
import { appStyleSheet } from './styles/sheet';

// WordPress binding: bind the text domain the plugin registered via
// wp_set_script_translations(), so the SPA packages never name it themselves.
setTextDomain('invflux-for-woocommerce');

declare global {
  interface Window {
    invfluxApp?: AppContext;
  }
}

/**
 * Core sections register through the same `nav.section` seam add-ons use, before mount. Each
 * registers a `lazy()` component, so only the shell + router load up front; a section's chunk loads
 * on first visit.
 */
registerWorkbenchSection();
registerProcurementSection();
registerReceivingSection();
registerDispatchSection();

// The base install's own first-run screen, registered through the `onboarding.welcome` seam an add-on
// uses for its own — so `#/welcome-to-essentials` is one entry in a catalog, not a hard-coded route.
registerEssentialsWelcome();

/**
 * Install each hosted SPA's **plug-in surface** — `window.invflux.<spa>`, the registry `register*`
 * methods merged with that SPA's runtime bridge — at boot, before mount. The standalone SPA bundles
 * install their own surface in their own `main.tsx`; the unified app is the single host for all of
 * them on `page=invflux-app`, so it installs them here instead. `installPluginApi` is idempotent, so
 * a standalone bundle additionally present on the page can't clobber a registration.
 *
 * This is the contract an add-on relies on: an add-on module enqueued with `['invflux-app']` as a
 * script-module dependency (see {@see \Nandan108\InvFlux\Woo\Admin\Pages\UnifiedAppPage::MODULE_ID})
 * evaluates after this file, so `window.invflux.dispatch.registerEntityAction(...)` etc. are present
 * when it runs. Resolution is context-reactive (SplitActionButton resolves inside a memo, so
 * labels/order/availability track ctx), but the registry *membership* is a plain Map, not a reactive
 * source — so a registration only needs to be in place before a scope's title bar first resolves. That
 * first resolve is at render: a navigation-rendered scope (e.g. `dispatch.order.detail`, on opening an
 * order) resolves well after this boot-time install.
 */
installWorkbenchPluginSurface();
installDispatchPluginSurface();
installProcurementPluginSurface();

/**
 * Shared **Solid runtime** for component-rendering add-ons. Expose the app's single bundled Solid
 * on `window.invflux.runtime` so an add-on that
 * authors its own JSX can alias `solid-js` / `solid-js/web` / `solid-js/store` to *this* instance
 * (through `@invflux/build`'s runtime shim) instead of bundling a second copy. Two Solid runtimes are
 * two independent reactive graphs — an add-on's signals would never drive the host's effects, and the
 * failure is silent (renders once, never updates). A namespace re-export (`* as`) hands over the whole
 * surface the JSX compiler emits into (`template`/`insert`/`createComponent`/`effect`/…).
 *
 * Set at boot, before mount and before any add-on module evaluates — the same ordering that backs the
 * surface installs above. `window.invflux.runtime` is API; keep its keys stable.
 */
(window.invflux ??= {}).runtime = {
  'solid-js': solidRuntimeCore,
  'solid-js/web': solidRuntimeWeb,
  'solid-js/store': solidRuntimeStore,
};

/**
 * Fallback context for the **standalone harness** — opening the dev server's own URL directly
 * (`http://localhost:5173/`, serving index.html) with no WordPress around it. Shell-only: the nonce
 * is fake and there is no login cookie, so every REST call 403s. Useful for pure component work, not
 * for anything that loads data.
 *
 * This is NOT how the dev server is normally used. Under `bin/vite-dev` you keep browsing wp-admin,
 * which loads its modules from the dev server and supplies the real context via window.invfluxApp —
 * real auth, real nonce, real capabilities, plus HMR.
 */
const DEV_CONTEXT: AppContext = {
  apiRoot: 'http://localhost:8888/wp-json',
  nonce: 'dev-nonce',
  currentUser: { id: 1, name: 'Dev User' },
  // All surface caps so `vite dev` shows every surface (real caps come from PHP in wp-admin).
  capabilities: {
    manageSettings: true,
    viewStock: true,
    managePurchaseOrders: true,
    manageInventory: true,
    dispatchOrders: true,
  },
  hasPro: true,
};

const context = window.invfluxApp ?? DEV_CONTEXT;
// Bind WordPress's locale beside the text domain, and for the same reason: both are the host's to
// decide. Without it every date and number falls back to the *browser's* locale, so a French admin
// reads translated labels next to US-ordered dates.
setLocale(context.locale);
// Seed the capability + surface-enablement stores before mount so the nav.section `enabled`
// predicates (which gate surfaces on permission AND per-install enablement) resolve on first render.
setCapabilities(context.capabilities);
setSurfaceModes(context.surfaceModes);
// First-run offer state, seeded before mount so the landing route resolves correctly on first render.
setOnboarding(context.onboarding);

function mount(): void {
  const host = document.getElementById('invflux-app');
  if (!host) return;

  // Shadow root + adopted stylesheet — styles scoped to the host, zero bleed to wp-admin.
  // Reuse an existing root rather than attaching a second one: `attachShadow` throws outright on an
  // already-shadowed host, which would turn any future path that re-runs mount() into a hard error
  // instead of a re-render.
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  shadow.adoptedStyleSheets = [appStyleSheet()];
  // Hoist the sheet's `@property` rules to the document. Custom-property registration is
  // document-scoped, so a sheet only ever adopted by a shadow root registers none of them — and
  // Tailwind v4's `border` resolves its style through one, so every border silently paints nothing.
  registerCssPropertyRules(appStyleSheet());

  // Portal root for overlays that must escape the app's shadow tree — modals and Kobalte-portalled
  // listboxes. It is a **shadow root of its own**, not a light-DOM div: the two trees then have the
  // same containment, so a portalled modal is styled by exactly what its in-tree twin is styled by,
  // and wp-admin's stylesheets reach neither. That symmetry is what retires the whole light-DOM
  // compensation layer — unlayered utilities, the mirrored `<style>`, the portal-only preflight
  // block, and the give-wp-admin-back-its-class-names sheet.
  // what breaks below it) · §4.5 (the cascade reasoning, and the test that catches a regression)
  const portalHost = document.createElement('div');
  portalHost.id = 'invflux-app-portal-root';
  // An open menu or dialog must not hide its own overlay tree (or, through it, `<body>`) from
  // screen readers, nor silence WordPress's announcements. See `keepVisibleDuringModals()`.
  keepVisibleDuringModals(portalHost);
  keepWordPressAnnouncementsAudible();
  document.body.appendChild(portalHost);
  const portalShadow = portalHost.shadowRoot ?? portalHost.attachShadow({ mode: 'open' });
  // The same adopted sheet object the app root uses, so a hot CSS update reaches both.
  portalShadow.adoptedStyleSheets = [appStyleSheet()];
  // Mount into an element inside the shadow root rather than into the root itself: Solid's `Portal`
  // and Kobalte both want an Element, and a wrapper gives the theme stamp somewhere to land that
  // `:host` selectors can still see.
  const portalRoot = document.createElement('div');
  portalShadow.appendChild(portalRoot);

  // Stamp the stored appearance on BOTH hosts. Not optional for the portal: Kobalte's
  // Select/Combobox and every mounted Modal render inside it, and a root that never gets stamped
  // resolves its tokens from the `prefers-color-scheme` fallback instead of the stored choice.
  registerThemeRoot(host);
  registerThemeRoot(portalHost);

  // Two jobs, in one capture-phase listener that runs before the HashRouter's own document listener:
  //
  //  1. Menu hijack: a WP menu link (sidebar / top bar) to THIS app page — `page=invflux-app`,
  //     bare or `#/<route>` — is turned into an in-app hash navigation, so switching surfaces (or
  //     clicking the "InvFlux" parent / "Central Workbench") never full-reloads while the app is open.
  //     The fragmentless parent/Central-Workbench link would otherwise reload (a no-fragment nav is a
  //     full load even to the same page), so it's routed to the default surface. This code only runs on
  //     the app page, so the same links clicked from ELSEWHERE still full-load into the app, as intended.
  //  2. Otherwise block: the HashRouter rewrites any same-origin <a> click into a hash nav, which would
  //     HIJACK WP's own <a> links (Diagnostics, License, the rest of wp-admin). We stop the event so the
  //     router never sees it — but ONLY for anchor clicks (the router only hijacks anchors), so WP's
  //     non-link UI on the page keeps working (notice dismiss buttons, Screen Options, etc.). We never
  //     preventDefault for those anchors, so their native navigation still happens. Portaled overlays
  //     (dropdowns/modals) live in portalRoot and are whitelisted.
  window.addEventListener(
    'click',
    (e) => {
      const path = e.composedPath();
      if (path.includes(host) || path.includes(portalRoot)) return; // in-app click → leave to the app

      const anchor = path.find((el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement);
      if (!anchor) return; // not a link → nothing for the router to hijack; leave WP's own handlers alone

      const href = anchor.getAttribute('href') ?? '';
      const plainClick = 0 === e.button && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
      // App-*surface* link only: `page=invflux-app` bare or with a `#/route`. A link that carries extra
      // query params after it (`page=invflux-app&…`) is a server action on this page — e.g. the dev
      // log-watch "Mark as seen" (`&invflux_logwatch_ack=1&_wpnonce=…`) — and must full-navigate, not be
      // rewritten to a hash nav; hence `(?:#|$)`, which does NOT match a trailing `&`.
      if (plainClick && !e.defaultPrevented && /[?&]page=invflux-app(?:#|$)/.test(href)) {
        e.preventDefault();
        const frag = href.includes('#') ? href.slice(href.indexOf('#')) : '';
        const target = '' !== frag && '#' !== frag ? frag : '#/workbench';
        if (window.location.hash !== target) window.location.hash = target;
      }
      // Stop the HashRouter from hijacking this same-origin anchor. We don't preventDefault (except the
      // surface-link case above), so a WP link's native navigation proceeds normally.
      e.stopImmediatePropagation();
    },
    { capture: true },
  );

  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);

  // §12.4 workspace persistence: restore the open-tab set + per-surface locations BEFORE render (so
  // the shell's URL bridge still seeds the active surface from the hash). On a brand-new browser tab
  // that landed on the default, seed the hash to where the last session was — before the router boots,
  // so there's no redirect race. F5 keeps its own hash (sessionStorage is authoritative).
  const boot = readBootSnapshot();
  // Dropping tabs whose route has gone is done here rather than in the snapshot reader, because
  // "which routes exist" is only knowable after the registrations above have run.
  const stillRoutes = (t: unknown): boolean =>
    null !== t &&
    'string' === typeof (t as { path?: unknown }).path &&
    tabStillRoutes((t as { path: string }).path);
  restoreTabs(
    (boot?.snapshot.pinned ?? []).filter(stillRoutes),
    (boot?.snapshot.open ?? []).filter(stillRoutes),
    boot?.snapshot.seenSurfaces ?? [],
  );
  restoreSurfaceLocations(boot?.snapshot.surfaces ?? {});

  // First-run default per browser: pin each enabled `always` surface this browser hasn't seen yet.
  // A newly-installed add-on surface pins on first sight; a surface the user deliberately closed stays
  // closed (it's already 'seen'). on_demand / disabled surfaces are left for the launcher dropdown.
  // This is the ONLY place surfaceMode drives placement — thereafter the per-browser pin state wins.
  for (const s of surfaceCatalog()) {
    if (hasSeenSurface(s.id)) continue;
    if ('always' === surfaceMode(s.id)) pinTab({ path: `/${s.id}`, title: s.label });
    markSeen(s.id);
  }

  if (null !== boot) {
    const seedRoute = seedRouteFor(boot.snapshot, boot.fromSession, window.location.hash);
    if (null !== seedRoute) window.location.hash = `#${seedRoute}`;
  }

  render(() => <App context={context} portalRoot={portalRoot} />, mountPoint);

  // Keep the WP sidebar's InvFlux highlight in step with the SPA's active surface (the migrated
  // items share one page, so WP's server-rendered highlight can't follow a same-page hash change).
  startWpMenuSync();

  // ── This entry deliberately does NOT self-accept. Do not add `import.meta.hot.accept()` here. ──
  //
  // It looks like an improvement: without it, an edit to a module that has no HMR boundary of its
  // own (a helper, a catalog, a store) propagates to this entry and Vite falls back to a full page
  // reload. Accepting here turns that reload into a re-mount.
  //
  // It is a bad trade, because Vite treats a self-accepting module as an update boundary for its
  // *dependencies* too — and this entry transitively imports everything. So every non-trivial edit,
  // including every component edit that solid-refresh had already swapped in place, additionally
  // re-ran mount(): the app was torn down and rebuilt, losing exactly the state HMR exists to keep,
  // and re-running startWpMenuSync() made the WordPress sidebar visibly flicker — which reads as a
  // page reload even though the document never navigated. Measured on Vite 6.4: with the accept in
  // place, a one-attribute JSX edit produced updates for both the component and this entry; without
  // it, only the component.
  //
  // The trade we take instead: component edits (the common case, in this package and in
  // @invflux/ui) hot-swap with state intact and no re-mount; the rarer edit to a boundary-less
  // module reloads the page, which is Vite's normal behaviour and honest about what it does.
  // Stylesheet edits are kept hot by ./styles/sheet.ts, which owns that boundary itself.
}

mount();

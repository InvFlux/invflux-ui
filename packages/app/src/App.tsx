import { __ } from '@invflux/i18n';
import { createDragReorder, HostNavCtx, IconButton, PortalCtx, SurfaceCtx, ToastRegion, usePortalRootOptional } from '@invflux/ui';
import { NavTab } from '@invflux/ui/nav';
import { HashRouter, Navigate, Route, useLocation, useNavigate } from '@solidjs/router';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createEffect, createMemo, createSignal, ErrorBoundary, For, type JSX, lazy, onCleanup, Show } from 'solid-js';
import { Dynamic, Portal } from 'solid-js/web';
import { LockupLauncher } from './chrome/LockupLauncher';
import { GearMenu } from './chrome/GearMenu';
import { AppCtx } from './context';
import { unifiedHostNav } from './hostNav';
import {
  closeTab,
  ensureTab,
  isPinned,
  moveOpen,
  movePinned,
  openTabs,
  pinnedTabs,
  pinTab,
  seenSurfaces,
  type TabRef,
  unpinTab,
} from './openTabs';
import { markWelcomeSettled, nextWelcome } from './onboarding';
import { welcomeCatalog, welcomePage, welcomePath } from './welcomeCatalog';
import { isSectionDirty } from './sectionStatus';
import { allSurfaceIds, surfaceCatalog } from './surfaceCatalog';
import { bridgeSurfaceHistory, ROUTED_SURFACES, snapshotSurfaceLocations, surfaceHistory, surfaceHref } from './surfaceRouter';
import type { AppContext } from './types';
import { writeWorkspace } from './workspacePersistence';

/**
 * One QueryClient for the whole persistent app — its cache survives route changes, so navigating
 * (e.g. Procurement → Workbench) can render already-fetched data with no refetch.
 */
const queryClient = new QueryClient({
  // `refetchOnWindowFocus` stays ON, deliberately, despite the cost: after "load all pages" a focus
  // event refetches every loaded page of the workbench's infinite query, serially.
  //
  // It is load-bearing anyway, and bluntly so: there is no stock-specific refresh path. A focus
  // event reloads the *whole* products query — every loaded page — and current stock arrives as a
  // side effect of that. The delta poller that was meant to carry stock on its own is disabled (its
  // route and envelope never matched the server; see the note in workbench/views/WorkbenchGrid.tsx),
  // so switching focus-refetch off leaves an idle tab showing stale stock indefinitely. That is a
  // correctness problem, where the reload cost is only a performance one.
  //
  // The real fix is not this flag: it is that stock-moving mutations should invalidate the grid
  // directly (see the invalidation groups in `queryKeys`), and that the delta poller should be
  // finished. Both make focus-refetch a backstop rather than the mechanism.
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

/** Every *available* top-level surface (mode ≠ disabled) — the keep-alive render + route source. */
const navSections = surfaceCatalog;

/**
 * The surface id a tab's path represents, if its path is a top-level surface root (`/dispatch`), else
 * null (a Ledger/Settings/Licenses detail tab). Matches against ALL registered surface ids (including
 * disabled) so a stale persisted tab is still recognised as a surface tab. A surface tab links to its
 * *resume* location (surfaceHref) and prefix-matches active at deep routes; a detail tab keeps its
 * exact path.
 */
const surfaceIdOfTabPath = (path: string): string | null => {
  const seg = path.replace(/^\/+/, '').split('/')[0] ?? '';
  return '' !== seg && `/${seg}` === path && allSurfaceIds().includes(seg) ? seg : null;
};

/** A tab's live caption — a surface re-derives its (translated) label from the registry; a detail tab
 *  keeps the title it was opened with. */
const tabLabel = (tab: TabRef): string => {
  const sid = surfaceIdOfTabPath(tab.path);
  if (null === sid) return tab.title;
  return surfaceCatalog().find((s) => s.id === sid)?.label ?? tab.title;
};

/** A tab's link — a surface resumes where it left off (surfaceHref); a detail tab is its exact path. */
const tabHref = (tab: TabRef): string => {
  const sid = surfaceIdOfTabPath(tab.path);
  return null === sid ? tab.path : surfaceHref(sid);
};

/**
 * The trailing half of wp-admin's own document title — `‹ {site name} — WordPress` — captured once
 * from the server-rendered title, before anything replaces it.
 *
 * Reusing WordPress's own suffix is what keeps our tabs reading like every other admin screen, and
 * it means the SPA never has to be told the site's name or the locale's separator. Empty when the
 * host page doesn't follow the convention, in which case the section name stands alone.
 */
const TITLE_SUFFIX: string = ((): string => {
  const at = document.title.indexOf('‹');

  return -1 === at ? '' : document.title.slice(at);
})();

/**
 * Router root layout: a top tab bar built from the `nav.section` registry (the SPA is embedded in
 * wp-admin's own left rail, so tabs, not a second left rail), the active route, and the toasts.
 */
function Shell(props: { children?: JSX.Element }): JSX.Element {
  const location = useLocation();
  /** First path segment = the active top-level section id (empty for `/`, `ledger` for a detail). */
  const activeId = (): string => location.pathname.replace(/^\/+/, '').split('/')[0] ?? '';

  // Gear popover open state, lifted here so a surface can open it (e.g. a DataGrid's Ctrl+, via the
  // SurfaceCtx.openSettings the sections provide below).
  const [gearOpen, setGearOpen] = createSignal(false);
  const openGear = (): void => {
    setGearOpen(true);
  };

  // Browser-tab-style drag reorder — one independent instance per row (so you can't drag a pinned tab
  // into the open row or vice versa; each instance ignores the other's drag). Keyed by tab path.
  const pinReorder = createDragReorder(movePinned);
  const openReorder = createDragReorder(moveOpen);

  // Right-click tab menu — one shared, positioned instance (like the DataGrid's). `onContextMenu` on a
  // tab sets it; a document click / Escape dismisses it (added deferred, so the opening right-click
  // doesn't immediately close it). Portalled out of the shadow tree so it isn't clipped by the nav.
  const portalRoot = usePortalRootOptional();
  const [tabMenu, setTabMenu] = createSignal<{ x: number; y: number; tab: TabRef; pinned: boolean } | null>(null);
  const openTabMenu = (e: MouseEvent, tab: TabRef): void => {
    e.preventDefault();
    // Stop this right-click reaching the document-level `contextmenu` dismiss below — otherwise the
    // very click that opens the menu would immediately close it. A right-click *elsewhere* still
    // reaches that dismiss (closing the menu), and a right-click on another tab re-opens it here.
    e.stopPropagation();
    setTabMenu({ x: e.clientX, y: e.clientY, tab, pinned: isPinned(tab.path) });
  };
  createEffect(() => {
    if (null === tabMenu()) return;
    const dismiss = (): void => {
      setTabMenu(null);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if ('Escape' === ev.key) dismiss();
    };
    document.addEventListener('click', dismiss);
    document.addEventListener('contextmenu', dismiss);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.removeEventListener('click', dismiss);
      document.removeEventListener('contextmenu', dismiss);
      document.removeEventListener('keydown', onKey);
    });
  });

  // Keep-alive (Option B): mount each nav.section on first visit and
  // KEEP it mounted, toggling only visibility by the active route. A section's in-progress state —
  // notably the workbench's dirty cells — then survives switching tabs, instead of being destroyed
  // on route unmount. `display: contents` when active means the wrapper adds no box (the section
  // lays out in <main> exactly as before); `none` when inactive. Sections are mounted lazily (only
  // once their route is first visited), so their chunk still loads on demand.
  const [visited, setVisited] = createSignal<Record<string, true>>({});
  createEffect(() => {
    const id = activeId();
    if ('' !== id && navSections().some((s) => s.id === id) && !visited()[id]) {
      setVisited((prev) => ({ ...prev, [id]: true }));
    }
  });

  const navigate = useNavigate();

  // Routed surfaces (Dispatch, later Procurement) own an internal router; bridge each one's
  // shell-owned MemoryHistory ↔ the browser hash so `#/dispatch/<order>?<filter>` is one shareable,
  // reload-restorable deep-link, while inactive surfaces keep their frozen location (keep-alive).
  // See surfaceRouter.ts (§12.3). Set up once, in the app-router owner.
  for (const id of ROUTED_SURFACES) {
    bridgeSurfaceHistory({
      id,
      history: surfaceHistory(id),
      activeId,
      pathname: () => location.pathname,
      search: () => location.search,
      navigate,
    });
  }

  // Every navigated route gets a tab. `ensureTab` adds it to the OPEN row unless it's already pinned
  // (so navigating to a pinned surface never duplicates it), keyed by root path so a surface's inner
  // navigation (`/dispatch/AF3B`) keeps the one tab. Driven by navigation — deep-link, grid click,
  // launcher, or reload — so a tab always reflects the current URL. A surface's caption re-derives at
  // render, so the title stored here is only the detail-tab fallback.
  createEffect(() => {
    const p = location.pathname;
    const ledger = p.match(/^\/ledger\/([^/?#]+)/);
    if (ledger) {
      ensureTab({ path: `/ledger/${ledger[1]}`, title: `${__('Ledger')} #${ledger[1]}` });
      return;
    }
    if ('/settings' === p || p.startsWith('/settings/')) {
      ensureTab({ path: '/settings', title: __('Settings') });
      return;
    }
    if ('/licenses' === p || p.startsWith('/licenses/')) {
      ensureTab({ path: '/licenses', title: __('Licenses & Add-ons') });
      return;
    }
    if ('/costing/base-currency' === p) {
      ensureTab({ path: '/costing/base-currency', title: __('Base currency') });
      return;
    }
    // A plugin's first-run screen — a closeable tab, so nothing traps the merchant. The title comes
    // from the page's own registration, so an add-on names its own tab.
    const welcome = p.match(/^\/welcome-to-([a-z0-9-]+)$/);
    if (welcome) {
      const page = welcomePage(welcome[1] as string);
      if (page) ensureTab({ path: p, title: page.label });
      return;
    }
    // A top-level surface, keyed by its root path.
    const activeSurface = navSections().find((s) => s.id === activeId());
    if (activeSurface) ensureTab({ path: `/${activeSurface.id}`, title: activeSurface.label });
  });

  /**
   * The browser tab's own title, following the route.
   *
   * wp-admin titles a page once, server-side, from the menu entry that registered it — and every
   * surface here lives under that one entry, so the tab read "Workbench" whichever section was open.
   * A merchant working with several admin tabs (a workbench next to a PO next to the licences page)
   * could not tell them apart, which is precisely what a tab title is for.
   *
   * The name comes from whatever already names the surface — the `nav.section` registry, or the open
   * tab's own title for a detail route. Nothing new is invented here, so an add-on's surface titles
   * the browser tab with the same string it titles its own tab with.
   */
  const routeTitle = (): string => {
    const surface = navSections().find((s) => s.id === activeId());
    if (surface) return surface.label;

    const path = location.pathname;
    const tab = [...pinnedTabs(), ...openTabs()].find((t) => path === t.path || path.startsWith(`${t.path}/`));

    return tab?.title ?? '';
  };

  createEffect(() => {
    const name = routeTitle();
    if ('' === name) return; // nothing better to say than what the server already rendered

    document.title = '' === TITLE_SUFFIX ? name : `${name} ${TITLE_SUFFIX}`;
  });

  // §12.4 workspace persistence: on any workspace change — active route, open-tab set, or a surface's
  // remembered location — write the live snapshot to sessionStorage (authoritative for THIS browser
  // tab) and localStorage (rolling last-session default for the next new tab). Reading the three
  // sources here tracks them, so the effect re-runs exactly when the layout changes.
  createEffect(() => {
    writeWorkspace({
      active: location.pathname + location.search,
      pinned: pinnedTabs(),
      open: openTabs(),
      seenSurfaces: seenSurfaces(),
      surfaces: snapshotSurfaceLocations(),
    });
  });

  // Where to go after closing the active tab: the first pinned surface, else the first available
  // surface (which then opens as its own tab). A pinned detail tab (a pinned Ledger) is skipped as a
  // landing target — landing prefers a surface.
  const landingHref = (): string => {
    const pinnedSurface = pinnedTabs().find((t) => null !== surfaceIdOfTabPath(t.path));
    const sid = (pinnedSurface ? surfaceIdOfTabPath(pinnedSurface.path) : null) ?? navSections()[0]?.id;
    return `/${sid ?? ''}`;
  };

  // Close a tab (dirty → confirm first, for future editable tabs). If it was active, land elsewhere.
  const closeTabRef = (tab: TabRef): void => {
    if (tab.dirty && !window.confirm(__('Discard unsaved changes and close this tab?'))) return;
    const wasActive = location.pathname === tab.path || location.pathname.startsWith(`${tab.path}/`);
    closeTab(tab.path);
    if (wasActive) navigate(landingHref());
  };
  const handleCloseTab = (tab: TabRef, e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    closeTabRef(tab);
  };

  /**
   * One tab in either row. Pinned and open tabs share everything but two things: an open tab carries a
   * close (✕), and each row drags within itself (`reorder` is that row's independent instance, so a
   * drag never crosses rows). A surface tab re-derives its label + resume-href; a detail tab keeps its
   * own. Right-click opens the shared pin/close menu.
   */
  const tabNode = (tab: TabRef, reorder: ReturnType<typeof createDragReorder>, closeable: boolean): JSX.Element => {
    const sid = surfaceIdOfTabPath(tab.path);
    return (
      <>
        {/* Vertical insertion marker before the drop-target tab. */}
        <Show when={reorder.isDropTarget(tab.path)}>
          <span class="mx-0.5 h-6 w-0.5 shrink-0 rounded bg-primary" aria-hidden="true" />
        </Show>
        {/* `display:contents` wrapper carries the right-click menu — `onContextMenu` doesn't forward
            reliably through NavTab → the router's <A>, and it adds no box to the flex row. */}
        <span class="contents" onContextMenu={(e) => openTabMenu(e, tab)}>
          <NavTab
            href={tabHref(tab)}
            end={null === sid ? undefined : false}
            class="flex items-center gap-1.5"
            // Unsaved-work signal for a surface tab (e.g. a dirty Workbench); dim while being dragged.
            dirty={null !== sid && isSectionDirty(sid)}
            classList={{ 'opacity-50': reorder.isDragging(tab.path) }}
            {...reorder.itemProps(tab.path)}
          >
            <span>{tabLabel(tab)}</span>
            <Show when={closeable}>
              <IconButton size="xs" label={__('Close tab')} titled={false} onClick={(e) => handleCloseTab(tab, e)}>
                ✕
              </IconButton>
            </Show>
          </NavTab>
        </span>
      </>
    );
  };

  return (
    <div class="flex min-h-screen flex-col bg-white text-slate-900">
      <nav class="flex items-center gap-1 border-b border-slate-200 px-2">
        {/* Left zone — the InvFlux lockup is the launcher (opens the surface catalog + Settings). */}
        <LockupLauncher />
        <span class="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />
        {/* Scrollable tab zone: persistent section tabs + closeable detail tabs. `min-w-0 flex-1` lets
            it shrink and scroll horizontally when many tabs are open, instead of overflowing the nav
            (the lockup on the left and the gear on the right stay fixed). */}
        {/* `pt-1` is the gap a filled active tab needs above it. It belongs to the row, not to the
            tab: put on the active tab instead, it drops that one label below its neighbours. */}
        <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pt-1">
        {/* Pinned tabs (left), reorderable among themselves — browser-style. Unpin/close via
            right-click or the launcher. */}
        <For each={pinnedTabs()}>{(t) => tabNode(t, pinReorder, false)}</For>
        {/* A divider, then the open (unpinned) tabs (right), also reorderable among themselves. */}
        <Show when={pinnedTabs().length > 0 && openTabs().length > 0}>
          <span class="mx-2 h-5 w-px bg-slate-200" aria-hidden="true" />
        </Show>
        <For each={openTabs()}>{(t) => tabNode(t, openReorder, true)}</For>
        </div>
        {/* Right zone — contextual gear (current-surface settings + "All Settings"), far-right. */}
        <div class="shrink-0 pl-2">
          <GearMenu activeId={activeId} open={gearOpen} onOpenChange={setGearOpen} />
        </div>
      </nav>
      <main class="flex-1">
        {/* NO <Suspense> here on purpose: a boundary around the live section would capture the
            migrated sections' TanStack-query suspensions (they read query.data), blanking the whole
            pane to a fallback on every filter change — the standalone SPAs run with no boundary and
            let the grid show its own in-place `isPending` loading. (Regression fixed 2026-07-10.) */}
        <ErrorBoundary
          fallback={(err: unknown) => (
            <div class="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">
              <strong>Section failed to load.</strong>
              <pre class="mt-2 whitespace-pre-wrap font-mono text-xs">
                {err instanceof Error ? `${err.name}: ${err.message}` : String(err)}
              </pre>
            </div>
          )}
        >
          {/* Kept-alive top-level sections: rendered once visited, shown only when active. */}
          <For each={navSections()}>
            {(s) => (
              <Show when={visited()[s.id]}>
                <div style={{ display: activeId() === s.id ? 'contents' : 'none' }}>
                  {/* Tell the section (and any DataGrid within it) which surface it is + how to open the
                      gear, so grid display settings land in this surface's gear popover. */}
                  <SurfaceCtx.Provider value={{ surfaceId: s.id, openSettings: openGear }}>
                    <Dynamic component={s.component} />
                  </SurfaceCtx.Provider>
                </div>
              </Show>
            )}
          </For>
          {/* Non-section routes (e.g. the /ledger/:postId detail view) render here via the router. */}
          {props.children}
        </ErrorBoundary>
      </main>
      <ToastRegion />
      {/* Shared right-click tab menu — pin/unpin + close. Portalled out of the shadow tree so the nav's
          overflow can't clip it; positioned at the cursor. */}
      <Show when={tabMenu()}>
        {(m) => (
          <Portal mount={portalRoot ?? undefined}>
            <div
              class="fixed z-menu min-w-36 rounded-md border border-slate-200 bg-white py-1 text-sm text-slate-700 shadow-lg"
              style={{ left: `${m().x}px`, top: `${m().y}px` }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                class="block w-full px-3 py-1.5 text-left hover:bg-slate-100"
                onClick={() => {
                  const { tab, pinned } = m();
                  if (pinned) unpinTab(tab.path);
                  else pinTab(tab);
                  setTabMenu(null);
                }}
              >
                {m().pinned ? __('Unpin tab') : __('Pin tab')}
              </button>
              <button
                type="button"
                class="block w-full px-3 py-1.5 text-left hover:bg-slate-100"
                onClick={() => {
                  closeTabRef(m().tab);
                  setTabMenu(null);
                }}
              >
                {__('Close tab')}
              </button>
            </div>
          </Portal>
        )}
      </Show>
    </div>
  );
}

/**
 * The unified admin SPA shell. Hash-routed, registry-first: each `nav.section` mounts at `/<id>/*`
 * (its `component` is a `lazy()` chunk, so the section's code + deps load on first visit); `/`
 * redirects to the first registered section.
 */
export function App(props: { context: AppContext; portalRoot: HTMLElement }): JSX.Element {
  // Landing/redirect target: the first pinned surface, else the first available surface (which then
  // opens as its own tab). A pinned detail tab (a pinned Ledger) isn't a landing target.
  const firstId = createMemo(() => {
    const pinnedSurface = pinnedTabs().find((t) => null !== surfaceIdOfTabPath(t.path));
    return (pinnedSurface ? surfaceIdOfTabPath(pinnedSurface.path) : null) ?? navSections()[0]?.id;
  });

  /**
   * Where a bare `#/` lands. While a welcome screen is outstanding it is that screen — a merchant
   * opening InvFlux for the first time should meet the "here is how to hand your catalogue over"
   * step, not a workbench governing nothing, and a merchant who has just activated an add-on should
   * meet whatever that add-on's first step is. Once each is settled (or on any later visit) it is the
   * ordinary first surface. Reactive, so settling one releases the landing route immediately rather
   * than at the next page load — and hands it straight to the next outstanding screen if there is one.
   *
   * Only the landing path redirects — every other route, including a deep link, is untouched.
   */
  const landing = (): JSX.Element => (
    <Show when={nextWelcome()} fallback={<Show when={firstId()}>{(id) => <Navigate href={`/${id()}`} />}</Show>}>
      {(slug) => <Navigate href={welcomePath(slug())} />}
    </Show>
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AppCtx.Provider value={props.context}>
        <HostNavCtx.Provider value={unifiedHostNav}>
        <PortalCtx.Provider value={props.portalRoot}>
          <HashRouter root={Shell}>
            {/* nav.section routes render nothing — the section UI lives in the keep-alive layer in
                Shell (mounted once, shown when active). The route still exists so the router tracks
                the active path (tab highlighting) and matches nested `/<id>/*` param URLs. */}
            {/* eslint-disable-next-line solid/prefer-for -- slotRegistry is a plain Map read at module load; this array is not reactive, so <For>'s keyed reconciliation would cost without buying anything. */}
            {navSections().map((s) => (
              <Route path={`/${s.id}/*`} component={() => null} />
            ))}
            {/* Per-product Ledger inspector — a deep-link detail view (from the workbench grid), not a
                top-level nav tab, so it is a direct route rather than a nav.section registration. */}
            <Route path="/ledger/:subjectId" component={lazy(() => import('./sections/ledger/LedgerSection'))} />
            {/* System-wide Settings — a direct route (launcher / gear "All Settings"), not a
                nav.section, so it opens as a closeable tab rather than a center tab (§11). */}
            <Route path="/settings" component={lazy(() => import('./sections/settings/SettingsSection'))} />
            {/* Customer licence lifecycle (Licenses & Add-ons) — a direct route opened from the
                launcher, a closeable tab, not a nav.section center tab (config, not a workflow). */}
            <Route path="/licenses" component={lazy(() => import('./sections/licenses/LicensesSection'))} />
            {/* Base-currency conversion — a direct route reached from the drift notice, not a
                nav.section: a one-shot migration a store runs once in its life, if ever. */}
            <Route path="/costing/base-currency" component={lazy(() => import('./sections/costing/BaseCurrencySection'))} />
            {/* One first-run route per installed welcome screen — direct routes like Settings, reached
                from the post-activation redirect, the post-install notice, or the landing diversion
                just below. Registry-driven so an add-on's screen needs no shell change; a slug with no
                registered page therefore matches nothing and falls through to the catch-all, which is
                the wanted behaviour for a deactivated add-on's stale link. Read once, like the section
                routes above — registrations happen at module load, before mount. */}
            {/* eslint-disable-next-line solid/prefer-for -- as above: registration happens at module load, before mount. */}
            {welcomeCatalog().map((w) => (
              <Route
                path={welcomePath(w.slug)}
                component={() => (
                  <Dynamic component={w.component} slug={w.slug} settle={() => markWelcomeSettled(w.slug)} />
                )}
              />
            ))}
            <Route path="/" component={landing} />
            {/* Catch-all: a hash pointing at a surface that isn't available (permission-gated or
                disabled for this install — e.g. a persisted `#/workbench` after Workbench was turned
                off) matches no section route and would render blank. Redirect it to the first
                available surface instead of stranding the user. Lowest route rank, so the explicit
                routes above always win. */}
            <Route
              path="*"
              component={landing}
            />
          </HashRouter>
        </PortalCtx.Provider>
        </HostNavCtx.Provider>
      </AppCtx.Provider>
    </QueryClientProvider>
  );
}

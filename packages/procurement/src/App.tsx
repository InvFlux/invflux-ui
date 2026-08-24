import { slotRegistry, ToastRegion } from '@invflux/ui';
import { NavTab } from '@invflux/ui/nav';
import { HashRouter, MemoryRouter, type MemoryHistory, Navigate, Route } from '@solidjs/router';
import { QueryClient, type QueryClient as QueryClientType, QueryClientProvider } from '@tanstack/solid-query';
import { createMemo, For, type JSX, Show } from 'solid-js';
import { ProcurementCtx } from './context';
import { PROCUREMENT_NAV_SLOT } from './navSlot';
import { PortalCtx } from './portal';
import type { ProcurementContext } from './types';

/** Standalone QueryClient — used only when the host doesn't inject a shared one (embedded does). */
const standaloneQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

/** Slug → nav label (until sections carry richer label/icon metadata). */
const humanize = (id: string): string => id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Enabled top-level sections, registry-first. Reads Procurement's OWN namespaced slot, never the
 * shell's `nav.section` — see {@link PROCUREMENT_NAV_SLOT}.
 */
const navSections = (): Array<{ id: string; label: () => string; component: () => JSX.Element }> =>
  slotRegistry
    .get<Record<string, never>>(PROCUREMENT_NAV_SLOT)
    .filter((s) => s.enabled?.() ?? true)
    .map((s) => ({
      id: s.id,
      // A registered translated label wins; otherwise humanize the slug (English-only fallback).
      label: s.label ?? (() => humanize(s.id)),
      component: s.component as () => JSX.Element,
    }));

/**
 * The router root layout: a **top tab bar** built from the section registry, the active route below
 * it, and the toast region. Top tabs (not a left rail) — the SPA sits inside wp-admin's own left
 * rail, Essentials has few sections, and the width is better spent on the tables. {@link NavTab}
 * carries the look and toggles active/inactive itself.
 *
 * `embedded`: hosted by the unified shell, which already renders a ToastRegion — a second one would
 * render every toast twice, so it is suppressed.
 */
function Shell(props: { children?: JSX.Element; embedded?: boolean }): JSX.Element {
  return (
    <div class="flex min-h-screen flex-col bg-white text-slate-900">
      {/* `section`: this row renders directly under the shell's surface tabs when procurement is
          the active surface, so it is styled to read as subordinate to them rather than as a
          second row of the same thing. */}
      {/* `pt-2` (deeper than the shell's `pt-1`): this row has the surface tabs immediately above
          it, so its filled tab needs the clearance to read as a separate row. */}
      <nav class="flex items-center gap-1 border-b border-slate-200 px-4 pt-2">
        <For each={navSections()}>
          {(s) => (
            <NavTab href={`/${s.id}`} variant="section">
              {s.label()}
            </NavTab>
          )}
        </For>
      </nav>
      <main class="flex-1 p-6">{props.children}</main>
      <Show when={!props.embedded}>
        <ToastRegion />
      </Show>
    </div>
  );
}

interface AppProps {
  context: ProcurementContext;
  portalRoot: HTMLElement;
  /**
   * Embedded mode (unified app): given a shell-owned `MemoryHistory`, the internal section router
   * runs on it instead of a `HashRouter`, so it no longer contends with the shell's hash router. The
   * shell bridges this history to the browser hash for the *active* surface (deep-link + share), and
   * keep-alive falls out because the history outlives tab switches. Standalone (absent) is unchanged.
   *
   * (`Route` defs must be inline children of each router — solid-router only reads `Route` elements,
   * not a wrapper component — hence the duplication across the two branches.)
   */
  history?: MemoryHistory;
  /** Shared QueryClient from the host (embedded); cache then survives leaving/returning the surface. */
  queryClient?: QueryClientType;
}

/**
 * The Procurement SPA shell. Registry-first: each section mounts at `/<id>/*` and owns its
 * sub-routes; `/` redirects to the first registered section (Essentials landing).
 */
export function App(props: AppProps): JSX.Element {
  const firstId = createMemo(() => navSections()[0]?.id);
  const root = (p: { children?: JSX.Element }): JSX.Element => (
    <Shell embedded={undefined !== props.history}>{p.children}</Shell>
  );
  const landing = (): JSX.Element => <Show when={firstId()}>{(id) => <Navigate href={`/${id()}`} />}</Show>;

  return (
    <QueryClientProvider client={props.queryClient ?? standaloneQueryClient}>
      <ProcurementCtx.Provider value={props.context}>
        <PortalCtx.Provider value={props.portalRoot}>
          <Show
            when={props.history}
            fallback={
              <HashRouter root={root}>
                {/* Route table is config (static at mount) → plain map, not reactive <For>. */}
                {/* eslint-disable-next-line solid/prefer-for -- route table is config, static at mount (see comment above). */}
                {navSections().map((s) => (
                  <Route path={`/${s.id}/*`} component={s.component} />
                ))}
                <Route path="/" component={landing} />
              </HashRouter>
            }
          >
            {(history) => (
              <MemoryRouter history={history()} root={root}>
                {/* eslint-disable-next-line solid/prefer-for -- route table is config, static at mount (see comment above). */}
                {navSections().map((s) => (
                  <Route path={`/${s.id}/*`} component={s.component} />
                ))}
                <Route path="/" component={landing} />
              </MemoryRouter>
            )}
          </Show>
        </PortalCtx.Provider>
      </ProcurementCtx.Provider>
    </QueryClientProvider>
  );
}

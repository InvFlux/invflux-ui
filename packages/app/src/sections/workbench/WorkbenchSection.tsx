import { PortalCtx } from '@invflux/ui';
// Reuse the existing Central Workbench SPA wholesale (strangler-fig): the unified app imports the
// @invflux/workbench `App` and renders it as a lazy route, so the legacy workbench page keeps
// working untouched and there is zero duplication of its ~1.9k-line grid view. Deep-import into the
// package's src (it has no `exports` map) — a temporary coupling to its internal path, fine while it
// is still an app package.
import { App as WorkbenchApp } from '@invflux/workbench/src/App';
import type { WorkbenchContext } from '@invflux/workbench/src/types';
import type { UrlParamsPort } from '@invflux/workbench/src/urlPort';
import { useLocation, useNavigate } from '@solidjs/router';
import { useQueryClient } from '@tanstack/solid-query';
import { createEffect, type JSX, onCleanup, useContext } from 'solid-js';
import { useApp } from '../../context';
import { setSectionDirty } from '../../sectionStatus';
import { setSurfaceLocation } from '../../surfaceRouter';

/**
 * Workbench section — the first real migrated surface. Adapts the unified `AppContext` to the
 * `WorkbenchContext` the workbench app expects, hands it the app's shared portal root + QueryClient,
 * and publishes the grid's dirty state to the shell.
 *
 * Unsaved-work handling (Option B — keep-alive): this section is kept
 * mounted across tab switches (see the keep-alive layer in App.tsx), so dirty edits SURVIVE
 * navigating away — there is nothing to lose, hence no in-app leave-confirm. Dirty state is still
 * published for the amber tab badge, and the grid's own `beforeunload` guard covers real page
 * unloads (reload / close), where edits genuinely would be lost.
 */
export default function WorkbenchSection(): JSX.Element {
  const app = useApp();
  const portalRoot = useContext(PortalCtx);
  // The app's shared QueryClient (lives above the router, never unmounts) — so the workbench's query
  // cache survives leaving/returning, and is reused across sections.
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();

  /**
   * Workbench filter state must live INSIDE the hash here — the real query string is WordPress's
   * (`?page=invflux-app`) and is shared by every surface. Bound to the shell router, so a filtered
   * Workbench view is a shareable, reload-restorable `#/workbench?…` deep-link like every other
   * surface. Writes are inert unless Workbench is the active surface, so a kept-alive (hidden)
   * Workbench can never scribble over another surface's URL.
   */
  const isActive = (): boolean =>
    'workbench' === location.pathname.replace(/^\/+/, '').split('/')[0];
  const urlPort: UrlParamsPort = {
    read: () => new URLSearchParams(location.search),
    replace: (params) => {
      if (!isActive()) return;
      const qs = params.toString();
      navigate(`/workbench${qs ? `?${qs}` : ''}`, { replace: true });
    },
    // Normalised to match what `replace` records, so our own echo is distinguishable from an
    // external change (e.g. Procurement's "See products in workbench" deep-link).
    watch: () => (isActive() ? new URLSearchParams(location.search).toString() : undefined),
  };

  // Publish the live filter so the Workbench tab / launcher link resumes it (surfaceHref). Without
  // this the tab points at bare `/workbench`, and clicking it would read as "empty filter" and clear
  // the grid. Updated only while active; when inactive the last value is frozen — the remembered
  createEffect(() => {
    if (isActive()) setSurfaceLocation('workbench', location.search || '/');
  });

  // Clear the shell's dirty badge if this section is ever torn down (app teardown).
  onCleanup(() => setSectionDirty('workbench', false));

  const context: WorkbenchContext = {
    apiRoot: app.apiRoot,
    nonce: app.nonce,
    currentUser: app.currentUser,
    capabilities: {
      viewStock: app.capabilities.viewStock ?? false,
      onhandCorrect: app.capabilities.onhandCorrect ?? false,
      editProducts: app.capabilities.editProducts ?? false,
      // Renaming a column changes what the whole store reads, so it answers to the settings
      // capability rather than the workbench's own — see WorkbenchColumnLabels server-side.
      manageSettings: app.capabilities.manageSettings ?? false,
    },
    entitlements: {
      exportStructured: app.entitlements?.exportStructured ?? false,
    },
    applyConcurrency: app.workbench?.applyConcurrency,
  };

  return (
    <WorkbenchApp
      context={context}
      portalRoot={portalRoot as HTMLElement}
      onDirtyChange={(d) => setSectionDirty('workbench', d)}
      queryClient={queryClient}
      urlPort={urlPort}
    />
  );
}

import { __ } from '@invflux/i18n';
import { PortalCtx } from '@invflux/ui';
// Reuse the standalone Dispatch SPA wholesale (strangler-fig, like Workbench/Settings): deep-import
// its App and render it embedded. In embedded mode we hand it a shell-owned MemoryHistory (so its
// internal list/detail router doesn't contend with the app's hash router — §12.3) and the shared
// QueryClient. Deep-import into src (no `exports` map) is a temporary coupling, fine while it is an
// app package.
import { App as DispatchApp } from '@invflux/dispatch/src/App';
import type { DispatchContext } from '@invflux/dispatch/src/types';
import { createQuery, useQueryClient } from '@tanstack/solid-query';
import { type JSX, onCleanup, onMount, Show, useContext } from 'solid-js';
import { useApp } from '../../context';
import { interceptSurfaceLinks, surfaceHistory } from '../../surfaceRouter';

/**
 * Dispatch section (stage c, §12.5 reference implementation). Unlike Workbench/Settings, Dispatch
 * owns an internal list/detail router AND needs a rich bootstrap (statuses / gateways / settings /
 * entitlements) the lean page bootstrap doesn't carry — so this wrapper lazily fetches that context
 * from `GET /invflux/v1/dispatch/bootstrap` (§6: per-surface data loads on first mount), then renders
 * the embedded Dispatch App on the shell-owned MemoryHistory + shared QueryClient.
 */
export default function DispatchSection(): JSX.Element {
  const app = useApp();
  const queryClient = useQueryClient();
  const portalRoot = useContext(PortalCtx);
  const history = surfaceHistory('dispatch');

  // Capture intra-surface link clicks before the shell HashRouter can hijack them (§12.3).
  let container: HTMLDivElement | undefined;
  onMount(() => {
    if (container) onCleanup(interceptSurfaceLinks(container, history));
  });

  const bootstrap = createQuery(() => ({
    queryKey: ['dispatch', 'bootstrap'],
    queryFn: async (): Promise<DispatchContext> => {
      const url = `${app.apiRoot.replace(/\/$/, '')}/invflux/v1/dispatch/bootstrap`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'X-WP-Nonce': app.nonce },
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`Dispatch bootstrap failed (${res.status})`);
      return res.json() as Promise<DispatchContext>;
    },
    // Statuses/gateways/settings are stable for the session — one fetch, cached in the shared client.
    staleTime: Number.POSITIVE_INFINITY,
  }));

  return (
    <div ref={container} style={{ display: 'contents' }}>
      <Show
        when={bootstrap.data}
        fallback={
          <Show
            when={!bootstrap.isError}
            fallback={
              <div class="m-6 rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">
                {__('Could not load the dispatch workbench.')}
              </div>
            }
          >
            <div class="m-6 text-sm text-slate-500">{__('Loading dispatch…')}</div>
          </Show>
        }
      >
        {(data) => (
          <DispatchApp
            context={{
              ...data(),
              // Live from the shell — never a cached nonce / root / user from the bootstrap body.
              apiRoot: app.apiRoot,
              nonce: app.nonce,
              currentUser: app.currentUser,
            } satisfies DispatchContext}
            portalRoot={portalRoot as HTMLElement}
            history={history}
            queryClient={queryClient}
          />
        )}
      </Show>
    </div>
  );
}

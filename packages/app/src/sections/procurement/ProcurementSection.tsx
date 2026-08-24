import { __ } from '@invflux/i18n';
import { PortalCtx } from '@invflux/ui';
// Reuse the standalone Procurement SPA wholesale (strangler-fig, like Workbench/Settings/Dispatch):
// deep-import its App and render it embedded on a shell-owned MemoryHistory + the shared
// QueryClient. Deep-import into src (no `exports` map) is a temporary coupling, fine while it is an
// app package.
import { App as ProcurementApp } from '@invflux/procurement/src/App';
import type { ProcurementContext } from '@invflux/procurement/src/types';
// Procurement's own sub-sections (Purchase Orders, Suppliers) normally register in its main.tsx,
// which never runs when embedded — so register them here, at chunk load. They target Procurement's
// NAMESPACED slot, so they don't leak into the shell's own `nav.section` surface catalogue.
import { registerPurchaseOrdersSection } from '@invflux/procurement/src/sections/purchase-orders';
import { registerSuppliersSection } from '@invflux/procurement/src/sections/suppliers';
import { createQuery, useQueryClient } from '@tanstack/solid-query';
import { type JSX, onCleanup, onMount, Show, useContext } from 'solid-js';
import { useApp } from '../../context';
import { interceptSurfaceLinks, surfaceHistory } from '../../surfaceRouter';

registerPurchaseOrdersSection();
registerSuppliersSection();

/**
 * Procurement section. Like Dispatch it is a **routed surface** (its own internal section router),
 * and it needs a rich bootstrap — here dominated by WC's ~42KB geo reference data, which is exactly
 * why the shell fetches it lazily on first mount instead of inlining it into every page load.
 *
 * Procurement stays ONE top-level surface; Purchase Orders / Suppliers remain its internal tabs.
 */
export default function ProcurementSection(): JSX.Element {
  const app = useApp();
  const queryClient = useQueryClient();
  const portalRoot = useContext(PortalCtx);
  const history = surfaceHistory('procurement');

  // Capture intra-surface link clicks before the shell HashRouter can hijack them.
  let container: HTMLDivElement | undefined;
  onMount(() => {
    if (container) onCleanup(interceptSurfaceLinks(container, history));
  });

  const bootstrap = createQuery(() => ({
    queryKey: ['procurement', 'bootstrap'],
    queryFn: async (): Promise<ProcurementContext> => {
      const url = `${app.apiRoot.replace(/\/$/, '')}/invflux/v1/procurement/bootstrap`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'X-WP-Nonce': app.nonce },
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`Procurement bootstrap failed (${res.status})`);
      return res.json() as Promise<ProcurementContext>;
    },
    // Capabilities / tier / geo are stable for the session — one fetch, cached in the shared client.
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
                {__('Could not load procurement.')}
              </div>
            }
          >
            <div class="m-6 text-sm text-slate-500">{__('Loading procurement…')}</div>
          </Show>
        }
      >
        {(data) => (
          <ProcurementApp
            context={{
              ...data(),
              // Live from the shell — never a cached nonce / root / user from the bootstrap body.
              apiRoot: app.apiRoot,
              nonce: app.nonce,
              currentUser: app.currentUser,
            } satisfies ProcurementContext}
            portalRoot={portalRoot as HTMLElement}
            history={history}
            queryClient={queryClient}
          />
        )}
      </Show>
    </div>
  );
}

import { __ } from '@invflux/i18n';
import { PortalCtx } from '@invflux/ui';
// Deep-import into the dispatch package's src, matching DispatchSection: the order view is the same
// component the surface routes to, mounted here without the surface around it.
import { DispatchCtx } from '@invflux/dispatch/src/context';
import { createListStore, ListStoreCtx } from '@invflux/dispatch/src/listStore';
import { OrderViewCtx, standaloneOrderPath } from '@invflux/dispatch/src/orderView';
import { OrderDetail } from '@invflux/dispatch/src/routes/OrderDetail';
import type { DispatchContext, DispatchOrderDetail } from '@invflux/dispatch/src/types';
import { qk } from '@invflux/ui/api';
import { createQuery } from '@tanstack/solid-query';
import { createEffect, onCleanup, type JSX, Show, useContext } from 'solid-js';
import { useLocation } from '@solidjs/router';
import { useApp } from '../../context';
import { closeTab, retitleTab } from '../../openTabs';
import { setSectionDirty } from '../../sectionStatus';

/**
 * One order, promoted out of the dispatch queue into a tab of its own.
 *
 * A **direct shell route**, like the Ledger inspector — deliberately not a `nav.section`, so it is
 * closeable and does not join the keep-alive layer. The consequence is that switching away unmounts
 * it and switching back refetches: fine for reading an order, and the reason the queue itself is
 * kept alive while this is not. The cost is that in-progress input (an unsaved note draft) does not
 * survive a tab switch, which is the one thing to fix before this grows editing weight.
 *
 * Reuses the surface's bootstrap query, which is `staleTime: Infinity` in the shared QueryClient —
 * so a promoted tab opened from a queue that has already loaded costs no extra request.
 */
export default function OrderSection(props: { hexId: string }): JSX.Element {
  const app = useApp();
  const portalRoot = useContext(PortalCtx);
  // The id arrives as a prop, not from `useParams`: kept-alive panes render outside the router's
  // matched route (the route itself renders nothing), so there are no params to read here.
  const params = {
    get hexId(): string {
      return props.hexId;
    },
  };

  // Its own store, and deliberately empty: prev/next mean "the orders either side of this one in
  // the queue", and a promoted tab is not in a queue. `OrderViewCtx` hides the controls; this makes
  // sure there is nothing behind them to reach even if that changes.
  const listStore = createListStore();

  /**
   * `#/order/195719` — addressed by the host's order number rather than the InvFlux id.
   *
   * The order view resolves it and replaces the URL with the hex one, which is what anybody
   * sharing a link would rather have anyway. What it cannot do is tidy up after itself: navigation
   * already created a tab for the number, and leaving it behind would strand an alias tab beside
   * the real one. So the alias closes its own tab once the URL has moved on — after, never before,
   * or the pane doing the resolving would be unmounted mid-flight.
   */
  const location = useLocation();
  createEffect(() => {
    if (!/^\d+$/.test(props.hexId)) return;
    const alias = standaloneOrderPath(props.hexId);
    if (location.pathname !== alias) closeTab(alias);
  });

  // A pane that goes away is not holding anything. Without this the tab would stay tinted after
  // an eviction or a close, claiming work that no longer exists.
  onCleanup(() => setSectionDirty(standaloneOrderPath(props.hexId), false));

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
    staleTime: Number.POSITIVE_INFINITY,
  }));

  /**
   * Read the order the view below is already fetching, without fetching it again.
   *
   * `enabled: false` makes this a cache subscription rather than a request: it never calls the
   * query function, but it does re-render when the real query resolves — which a
   * `getQueryData()` read inside an effect would not, since that is not reactive.
   */
  const detail = createQuery(() => ({
    queryKey: qk.dispatch.orderDetail(params.hexId),
    queryFn: (): Promise<DispatchOrderDetail> => {
      throw new Error('cache-only: the order view owns this query');
    },
    enabled: false,
  }));

  // Name the tab with the order number rather than the hex id it was opened by. The shell cannot
  // derive it — the route carries only the hex — so the view that loads the order supplies it once
  // it knows, and the workspace snapshot keeps it across reloads.
  createEffect(() => {
    const externalId = detail.data?.order.externalId;
    if (externalId !== undefined && externalId !== '') {
      retitleTab(standaloneOrderPath(params.hexId), `${__('Order')} #${externalId}`);
    }
  });

  return (
    <div style={{ display: 'contents' }}>
      <Show
        when={bootstrap.data}
        fallback={
          <Show
            when={!bootstrap.isError}
            fallback={
              <div class="m-6 rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">
                {__('Could not load this order.')}
              </div>
            }
          >
            <div class="m-6 text-sm text-slate-500">{__('Loading order…')}</div>
          </Show>
        }
      >
        {(data) => (
          <DispatchCtx.Provider
            value={
              {
                ...data(),
                // Live from the shell — never a cached nonce / root / user from the bootstrap body.
                apiRoot: app.apiRoot,
                nonce: app.nonce,
                currentUser: app.currentUser,
              } satisfies DispatchContext
            }
          >
            <ListStoreCtx.Provider value={listStore}>
              <PortalCtx.Provider value={portalRoot}>
                <OrderViewCtx.Provider
                  value={{
                    standalone: true,
                    orderPath: standaloneOrderPath,
                    // This pane outlives its route — it stays mounted behind other tabs — so the
                    // order id comes from here rather than from whatever route is matched now.
                    hexId: () => props.hexId,
                    // Published under this tab's path, which is what the tab strip reads to tint
                    // itself and what the close handler checks before discarding the draft.
                    onDirtyChange: (dirty) =>
                      setSectionDirty(standaloneOrderPath(props.hexId), dirty),
                  }}
                >
                  <OrderDetail />
                </OrderViewCtx.Provider>
              </PortalCtx.Provider>
            </ListStoreCtx.Provider>
          </DispatchCtx.Provider>
        )}
      </Show>
    </div>
  );
}

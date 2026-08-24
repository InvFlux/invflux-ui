import { __ } from '@invflux/i18n';
import { surfaceSettingsRegistry, useSurface } from '@invflux/ui';
import { HashRouter, MemoryRouter, type MemoryHistory, Route, useSearchParams } from '@solidjs/router';
import { QueryClient, type QueryClient as QueryClientType, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, onCleanup, type ParentProps, Show } from 'solid-js';
import { DEFAULT_PER_PAGE, DispatchSettingsPanel, parsePerPage } from './components/DispatchSettings';
import { TagManagerModal } from './components/OrderTags';
import { DispatchCtx } from './context';
import { ListStoreCtx, createListStore } from './listStore';
import { PortalCtx } from './portal';
import { OrderList } from './routes/OrderList';
import { OrderDetail } from './routes/OrderDetail';
import type { DispatchContext } from './types';

/**
 * Router root — wraps every dispatch route, and inside the unified app shell contributes this
 * surface's settings panel to the shell's contextual gear (§11.4).
 *
 * It registers *here*, not in the queue view, because the gear belongs to the **surface**: were the
 * panel tied to the list, opening an order would unmount it and leave the Dispatch gear claiming it
 * has no settings. Everything the panel touches (`per_page`, the tag manager) is surface-wide, and
 * lives under this router either way.
 *
 * Standalone there is no shell and no gear, so nothing registers and the queue's own header +
 * settings modal serve instead — the same {@link DispatchSettingsPanel}, in a local container.
 */
function DispatchSurface(props: ParentProps) {
  const surface = useSurface();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tagManagerOpen, setTagManagerOpen] = createSignal(false);

  if (surface) {
    onCleanup(
      surfaceSettingsRegistry.register({
        surfaceId: surface.surfaceId,
        id: 'settings',
        order: 10,
        label: () => __('Settings'),
        component: (panelProps) => (
          <DispatchSettingsPanel
            perPage={parsePerPage(typeof searchParams.per_page === 'string' ? searchParams.per_page : undefined)}
            onPerPage={(n) => setSearchParams({ per_page: n === DEFAULT_PER_PAGE ? undefined : String(n) })}
            onManageTags={() => {
              panelProps.onRequestClose();
              setTagManagerOpen(true);
            }}
          />
        ),
      }),
    );
  }

  return (
    <>
      {props.children}
      <Show when={tagManagerOpen()}>
        <TagManagerModal onClose={() => setTagManagerOpen(false)} />
      </Show>
    </>
  );
}

/** Standalone QueryClient — used only when the host doesn't inject a shared one (embedded mode does). */
const standaloneQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

interface AppProps {
  context: DispatchContext;
  portalRoot: HTMLElement;
  /**
   * Embedded mode (unified app): when the host passes a
   * `MemoryHistory`, the internal list/detail router runs on it instead of a `HashRouter`, so it no
   * longer contends with the shell's own hash router. The shell owns this history and bridges its
   * location to the browser hash for the *active* surface (deep-link + share); keep-alive falls out
   * because the history object persists across tab switches. Standalone (absent) keeps the HashRouter.
   *
   * (`Route` defs must be inline children of each router — solid-router only reads `Route` elements,
   * not a wrapper component — hence the duplication across the two branches.)
   */
  history?: MemoryHistory;
  /** Shared QueryClient from the host (embedded); cache then survives leaving/returning the surface. */
  queryClient?: QueryClientType;
}

export function App(props: AppProps) {
  const listStore = createListStore();

  return (
    <QueryClientProvider client={props.queryClient ?? standaloneQueryClient}>
      <DispatchCtx.Provider value={props.context}>
        <ListStoreCtx.Provider value={listStore}>
          <PortalCtx.Provider value={props.portalRoot}>
            <Show
              when={props.history}
              fallback={
                <HashRouter root={DispatchSurface}>
                  <Route path="/" component={OrderList} />
                  <Route path="/:hexId" component={OrderDetail} />
                </HashRouter>
              }
            >
              {(history) => (
                <MemoryRouter history={history()} root={DispatchSurface}>
                  <Route path="/" component={OrderList} />
                  <Route path="/:hexId" component={OrderDetail} />
                </MemoryRouter>
              )}
            </Show>
          </PortalCtx.Provider>
        </ListStoreCtx.Provider>
      </DispatchCtx.Provider>
    </QueryClientProvider>
  );
}

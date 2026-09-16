import { __ } from '@invflux/i18n';
import { surfaceSettingsRegistry, useSurface } from '@invflux/ui';
import { MemoryRouter, type MemoryHistory, Route, useSearchParams } from '@solidjs/router';
import {
  QueryClient,
  type QueryClient as QueryClientType,
  QueryClientProvider,
} from '@tanstack/solid-query';
import { createSignal, onCleanup, type ParentProps, Show } from 'solid-js';
import {
  DEFAULT_PER_PAGE,
  DispatchSettingsPanel,
  parsePerPage,
} from './components/DispatchSettings';
import { TagManagerModal } from './components/OrderTags';
import { DispatchCtx } from './context';
import { ListStoreCtx, createListStore } from './listStore';
import { PortalCtx } from './portal';
import { WorkingSetProvider } from './useWorkingSet';
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
 * The shell is always there: `DispatchSection` is the only mount of this app and it always supplies
 * the history, so `useSurface()` never comes back empty here.
 */
function DispatchSurface(props: ParentProps) {
  const surface = useSurface();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tagManagerOpen, setTagManagerOpen] = createSignal(false);

  // Guarded rather than asserted: the context is optional by type, and a surface mounted outside a
  // shell would otherwise register a panel under an id no gear reads.
  if (surface) {
    onCleanup(
      surfaceSettingsRegistry.register({
        surfaceId: surface.surfaceId,
        id: 'settings',
        order: 10,
        label: () => __('Settings'),
        component: (panelProps) => (
          <DispatchSettingsPanel
            perPage={parsePerPage(
              typeof searchParams.per_page === 'string' ? searchParams.per_page : undefined,
            )}
            onPerPage={(n) =>
              setSearchParams({ per_page: n === DEFAULT_PER_PAGE ? undefined : String(n) })
            }
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
   * The internal list/detail history, owned by the app shell — **required**.
   *
   * Running on the shell's `MemoryHistory` rather than a router of its own is what keeps this
   * surface from contending with the shell's hash router; the shell bridges that location to the
   * browser hash for the *active* surface (deep-link + share), and keep-alive falls out because the
   * history object survives a tab switch.
   */
  history: MemoryHistory;
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
            {/*
              Above the router on purpose: the replicated set has to outlive the queue route, or
              opening an order throws it away and coming back rebuilds it from scratch.
            */}
            <WorkingSetProvider>
              <MemoryRouter history={props.history} root={DispatchSurface}>
                <Route path="/" component={OrderList} />
                <Route path="/:hexId" component={OrderDetail} />
              </MemoryRouter>
            </WorkingSetProvider>
          </PortalCtx.Provider>
        </ListStoreCtx.Provider>
      </DispatchCtx.Provider>
    </QueryClientProvider>
  );
}

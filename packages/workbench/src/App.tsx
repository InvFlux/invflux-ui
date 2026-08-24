import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { WorkbenchCtx } from './context';
import { PortalCtx } from './portal';
import { WorkbenchGrid } from './views/WorkbenchGrid';
import type { WorkbenchContext } from './types';
import type { UrlParamsPort } from './urlPort';

// Standalone client — used when the workbench runs as its own SPA. When embedded (unified app), the
// host passes its own client so the query cache is shared and survives navigation between sections.
const standaloneQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

interface AppProps {
  context: WorkbenchContext;
  portalRoot: HTMLElement;
  /** Optional dirty-state signal for an embedder (e.g. the unified app's nav guard + tab badge). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Optional shared QueryClient (embedded use); defaults to the standalone client. */
  queryClient?: QueryClient;
  /**
   * Optional address-bar port for filter state. Defaults to the page's real query string; the
   * unified app passes one bound to its hash search (the real query string is WordPress's).
   */
  urlPort?: UrlParamsPort;
}

export function App(props: AppProps) {
  return (
    <QueryClientProvider client={props.queryClient ?? standaloneQueryClient}>
      <WorkbenchCtx.Provider value={props.context}>
        <PortalCtx.Provider value={props.portalRoot}>
          <WorkbenchGrid onDirtyChange={props.onDirtyChange} urlPort={props.urlPort} />
        </PortalCtx.Provider>
      </WorkbenchCtx.Provider>
    </QueryClientProvider>
  );
}

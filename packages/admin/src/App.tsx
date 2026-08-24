import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { PortalCtx } from '@invflux/ui';
import { SettingsView } from './views/SettingsView';
import type { AdminContext } from './types';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

interface AppProps {
  context: AdminContext;
  portalRoot: HTMLElement;
}

/**
 * The consolidated admin shell. Settings is route #1; Licenses /
 * Diagnostics are reserved as sibling routes (today they remain separate admin pages, so the shell
 * renders Settings directly — the router lands when those surfaces move in).
 */
export function App(props: AppProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <PortalCtx.Provider value={props.portalRoot}>
        <SettingsView context={props.context} />
      </PortalCtx.Provider>
    </QueryClientProvider>
  );
}

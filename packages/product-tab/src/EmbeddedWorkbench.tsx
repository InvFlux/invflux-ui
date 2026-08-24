import type { JSX } from 'solid-js';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { PortalCtx, WorkbenchGrid } from '@invflux/ui';
import type { WorkbenchGridCapabilities, WorkbenchHandles } from '@invflux/ui';
import type { ProductTabContext } from './types';

/**
 * EmbeddedWorkbench — mounts the reusable `WorkbenchGrid` inside the WooCommerce product inventory
 * tab, scoped to a single product family. It supplies the pieces the grid assumes from its host:
 *
 *  - a **QueryClient** (the grid owns an infinite query over `/workbench/products`);
 *  - a **PortalCtx** pointing at the document-body portal root, so the grid's overlays (comboboxes +
 *    its correction / bulk-edit modals, which read this ctx for their `mount`) escape the tab's
 *    shadow root + WC's transformed ancestors, which otherwise break `position: fixed`;
 *  - the **preset scope** `post_ids=<productId>&bring_children=1` so a variable parent pulls its
 *    variations inline (and a simple product is just its one row).
 *
 * The host App owns the {@link ToastRegion} (a singleton store), so this shell doesn't mount one —
 * the grid's toasts surface through the App's region. Capabilities are passed in (the caller derives
 * them from the tab's inventory settings), keeping this a pure wiring shell.
 */
export interface EmbeddedWorkbenchProps {
  context: ProductTabContext;
  productId: number;
  capabilities: WorkbenchGridCapabilities;
  /** Document-body root where overlays + toasts render (escapes the tab's shadow + transforms). */
  portalRoot: HTMLElement;
  /** Live-stock poll cadence (ms) from the plugin-level setting; omit to disable live updates. */
  pollIntervalMs?: number;
  /** Fired after the grid persists an edit — the host form refetches so its hidden WC inputs + save
   *  payload reflect grid-owned sku/gtin/threshold changes (which would otherwise be reverted by
   *  WC autosave posting stale page-load values). */
  onApplied?: () => void;
  /** Toolbar content rendered after the grid's layout toggle — the "manage variations" link. */
  toolbarExtra?: JSX.Element;
  /** Hands the grid's imperative handles to the host. The form calls `refreshLiveUpdates()` after a
   *  stock-tracking toggle so the grid re-reads the subject and the Total cell's read-only state
   *  (which follows `stockManaged`) updates immediately. */
  apiRef?: (api: WorkbenchHandles) => void;
}

export function EmbeddedWorkbench(props: EmbeddedWorkbenchProps) {
  // One QueryClient per mount — the tab is a short-lived surface; no cross-tab cache sharing wanted.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  });

  const ctx = {
    apiRoot: props.context.apiRoot,
    nonce: props.context.nonce,
    capabilities: props.capabilities,
  };

  return (
    <QueryClientProvider client={queryClient}>
      <PortalCtx.Provider value={props.portalRoot}>
        <WorkbenchGrid
          ctx={ctx}
          storageKeyPrefix="product-tab"
          presetParams={{ post_ids: String(props.productId), bring_children: '1' }}
          showRowSelection={false}
          defaultVisibleColumnIds={['name', 'sku', 'gtin', 'backorders', 'reorder_threshold', 'atp', 'res', 'ctd', 'total']}
          defaultGridSettings={{ density: 'compact', wrap: 'no-wrap', textSize: 'small' }}
          compactVariationNames
          liveUpdates={props.pollIntervalMs !== undefined ? { intervalMs: props.pollIntervalMs } : undefined}
          onApplied={props.onApplied}
          toolbarExtra={props.toolbarExtra}
          apiRef={props.apiRef}
          // We're already on WooCommerce's product-edit page, so an "Edit in WooCommerce"
          // (catalog-edit) link in the name-cell menu would only point back here.
          suppressProductLinkKinds={['catalog-edit']}
        />
      </PortalCtx.Provider>
    </QueryClientProvider>
  );
}

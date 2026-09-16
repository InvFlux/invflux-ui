import type { ProcurementContext } from '@invflux/procurement/src/types';
import type { AppContext } from '../../types';

/**
 * The Procurement bootstrap as query options: capabilities, tier and WooCommerce's geo reference data
 * (~42KB, which is why it is fetched on demand rather than inlined into every page load). One fetch per
 * session into the shared client — by the Procurement surface on its first visit, or by a procurement
 * dialog opened from elsewhere, whichever comes first.
 */
export function procurementBootstrapQuery(app: Pick<AppContext, 'apiRoot' | 'nonce'>) {
  return {
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
    // Capabilities / tier / geo are stable for the session.
    staleTime: Number.POSITIVE_INFINITY,
  };
}

import { __, sprintf } from '@invflux/i18n';
import { createQuery } from '@tanstack/solid-query';
import { useProcurement } from '../../context';
import { createApi } from '../../lib/api';
import type { TermsSetSummary } from './types';

/** Query key for everything about purchase terms; invalidating it refreshes every screen that shows them. */
export const TERMS_QUERY_KEY = ['procurement', 'terms'] as const;

/**
 * What choosing no set of one's own means, named: the store's default set — or none at all, when the
 * store has not chosen one either.
 */
export function storeTermsLabel(sets: TermsSetSummary[] | undefined): string {
  const store = sets?.find((s) => s.isStoreDefault)?.name;

  /* translators: %s: the name of the store's default set of purchase terms */
  return undefined === store ? __('None') : sprintf(__('The store’s default terms (“%s”)'), store);
}

/**
 * The sets of purchase terms on file — for the Terms page, and for the pickers on a supplier and a
 * draft order, which share this cache so a set saved on one screen is offered on the next.
 *
 * Only fetched for a viewer who may manage purchase orders: the route refuses anyone else, and the
 * screens that pick terms are theirs alone.
 */
export function useTermsSets() {
  const ctx = useProcurement();
  const api = createApi(ctx);

  return createQuery(() => ({
    queryKey: [...TERMS_QUERY_KEY],
    queryFn: () => api.get<{ sets: TermsSetSummary[] }>('/procurement/terms'),
    enabled: ctx.capabilities.managePurchaseOrders,
  }));
}

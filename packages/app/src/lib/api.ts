import { createInvFluxApi, ns, type InvFluxApi } from '@invflux/ui/api';
import type { AppContext } from '../types';

/**
 * The shell's REST client — now a thin binding over the shared `createInvFluxApi`, which owns the
 * transport (both `apiRoot` forms, abort, timeout, retry, the parse-before-`ok` error handling).
 *
 * This wrapper survives only to keep the namespace-relative call style the sections already use
 * (`api.get('/ledger/entries')`), so a section does not repeat `invflux/v1` at every call site.
 */
export interface AppApi {
  get<T>(route: string, params?: Record<string, string | number>): Promise<T>;
  post<T>(route: string, body: unknown): Promise<T>;
  put<T>(route: string, body: unknown): Promise<T>;
  del<T>(route: string, body?: unknown): Promise<T>;
}

export function createApi(context: Pick<AppContext, 'apiRoot' | 'nonce'>): AppApi {
  const api: InvFluxApi = createInvFluxApi(context);
  return {
    get: (route, params) => api.get(ns(route), { params }),
    post: (route, body) => api.post(ns(route), body),
    put: (route, body) => api.put(ns(route), body),
    del: (route, body) => api.del(ns(route), body),
  };
}

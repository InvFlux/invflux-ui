import { createInvFluxApi, ns } from '@invflux/ui/api';
import type { ProcurementContext } from '../types';

/** Minimal nonce-authenticated REST client over the InvFlux `invflux/v1` namespace. */
export interface ProcurementApi {
  /** Array values serialize as repeated `key[]=v` (registry filter convention); scalars as `key=v`. */
  get<T>(path: string, params?: Record<string, string | number | string[]>): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  /** PUT for fire-and-forget writes that answer 204 (no body) — e.g. autosaving WIP. */
  put(path: string, body: unknown): Promise<void>;
  del<T>(path: string): Promise<T>;
  /** Fetch a binary endpoint (nonce-auth) and trigger a browser download as `filename`. */
  download(path: string, filename: string): Promise<void>;
}

/**
 * Build a client bound to the boot context's REST root + nonce. `apiRoot` is the WP REST root
 * (rest_route form, e.g. `…/index.php?rest_route=/`), so paths append after the namespace —
 * matching the workbench's URL construction.
 */
export function createApi(context: Pick<ProcurementContext, 'apiRoot' | 'nonce'>): ProcurementApi {
  const api = createInvFluxApi(context);

  /**
   * Procurement spells multi-value filters as `key[]=a&key[]=b` but its callers pass a bare `key`,
   * so the `[]` is appended here. The shared client deliberately does not do this — the workbench
   * passes `subject_kind[]` already suffixed, and a client that "helpfully" appended a second pair
   * would break it. Two conventions exist in this codebase; each wrapper keeps its own, and the
   * transport stays literal about the key it is given.
   */
  const withArraySuffix = (
    params?: Record<string, string | number | string[]>,
  ): Record<string, string | number | string[]> | undefined => {
    if (!params) return undefined;
    const out: Record<string, string | number | string[]> = {};
    for (const [k, v] of Object.entries(params)) out[Array.isArray(v) ? `${k}[]` : k] = v;
    return out;
  };

  return {
    get: <T,>(route: string, params?: Record<string, string | number | string[]>): Promise<T> =>
      api.get<T>(ns(route), { params: withArraySuffix(params) }),
    post: <T,>(route: string, body: unknown): Promise<T> => api.post<T>(ns(route), body),
    patch: <T,>(route: string, body: unknown): Promise<T> => api.patch<T>(ns(route), body),
    // 204, no body — the shared client resolves an empty body as `undefined` rather than throwing
    // a SyntaxError, which is what made this a bespoke method in the first place.
    put: async (route: string, body: unknown): Promise<void> => {
      await api.put<undefined>(ns(route), body);
    },
    del: <T,>(route: string): Promise<T> => api.del<T>(ns(route)),
    download: (route: string, filename: string): Promise<void> => api.download(ns(route), filename),
  };
}

import { createInvFluxApi, ns } from '@invflux/ui/api';
import type { ProcurementContext } from '../types';

/** Minimal nonce-authenticated REST client over the InvFlux `invflux/v1` namespace. */
export interface ProcurementApi {
  /** Array values serialize as repeated `key[]=v` (registry filter convention); scalars as `key=v`. */
  get<T>(path: string, params?: Record<string, string | number | string[]>): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  /**
   * PUT. Most writes here answer 204 with no body, which is what the default `undefined` describes —
   * a caller whose route answers 200 names the shape it expects instead.
   */
  put<T = undefined>(path: string, body: unknown): Promise<T>;
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
    get: <T>(route: string, params?: Record<string, string | number | string[]>): Promise<T> =>
      api.get<T>(ns(route), { params: withArraySuffix(params) }),
    post: <T>(route: string, body: unknown): Promise<T> => api.post<T>(ns(route), body),
    patch: <T>(route: string, body: unknown): Promise<T> => api.patch<T>(ns(route), body),
    // Bespoke because most PUTs here answer 204: the shared client resolves an empty body as
    // `undefined` rather than throwing a SyntaxError. `T` defaults to that empty case, so a caller
    // that wants the response — one whose route answers 200 with a body — names the shape and the
    // rest are unchanged.
    put: <T = undefined>(route: string, body: unknown): Promise<T> => api.put<T>(ns(route), body),
    del: <T>(route: string): Promise<T> => api.del<T>(ns(route)),
    download: (route: string, filename: string): Promise<void> => api.download(ns(route), filename),
  };
}

import { ApiError, isRetryable } from './errors';

/**
 * The one REST client for the admin app.
 *
 * It replaces seven hand-written clients plus a handful of inline `fetch` calls. It is deliberately
 * a **superset** of what they did, not an average of it — each of them got something right that the
 * others did not, and consolidating on the median would have been a regression:
 *
 * - **The body is parsed before the status is checked** (from the licences client). An error body
 *   carries the machine-readable slug; checking `ok` first and throwing means the slug is gone
 *   before anyone can read it.
 * - **Reads and writes fail identically.** Four clients parsed the server's message on writes and
 *   discarded it on reads, so a failed GET surfaced "Failed to load settings (500)" while the server
 *   had said exactly what was wrong.
 * - **Both URL forms are handled** (from the admin client). The adapter localizes the
 *   `?rest_route=/` form; a dev context can serve `/wp-json/`.
 * - **Path segments are encoded by construction.** Because `apiRoot` is normally the query-string
 *   form, the route lives *inside a query parameter* — so an unencoded `&` in a segment escapes the
 *   parameter and silently rewrites the request. Every interpolated value today is a numeric or hex
 *   id, so this is latent rather than live, but it is the kind of latent that becomes a bug the day
 *   someone routes by SKU. {@link path} makes the safe form the only form.
 *
 * And three things none of them had: an `AbortSignal` on every method (wired to TanStack's `queryFn`
 * signal), a default timeout, and retry that fires only on a network error or a 5xx — never on a 4xx,
 * which is terminal by definition.
 */

/** The two values every call needs, as the host surfaces localize them. */
export interface ApiContext {
  apiRoot: string;
  nonce: string;
}

export interface RequestOptions {
  /**
   * Query parameters, appended with the right separator for whichever `apiRoot` form is in play —
   * the `?rest_route=` form has already opened the query string, so a naive `?` would produce a
   * second one and the parameters would be silently dropped.
   *
   * An array value repeats the key, which is what WordPress's REST layer expects for a multi-value
   * filter (`subject_kind[]=simple&subject_kind[]=variable`); pass the `[]` in the key yourself, as
   * the routes already spell it. `undefined` and `null` values are omitted rather than sent as the
   * strings "undefined"/"null" — an absent filter must not become a filter *for* the word.
   */
  params?: Record<string, string | number | boolean | null | undefined | Array<string | number>>;
  /** Caller's abort signal — TanStack hands one to every `queryFn`; pass it straight through. */
  signal?: AbortSignal;
  /** Overrides the default timeout for this call. `0` disables it (for a deliberately long export). */
  timeoutMs?: number;
  /** Retries on network errors / 5xx only. Default 0 for writes, 2 for reads. */
  retries?: number;
  /** Extra headers, merged after the defaults so a caller can override `Accept`. */
  headers?: Record<string, string>;
}

/** Anything that can be interpolated into a path segment. */
type Segment = string | number;

/**
 * Build a path with every interpolated segment percent-encoded.
 *
 * ```ts
 * api.get(path`/procurement/suppliers/${id}/contacts`)
 * ```
 *
 * The static text is trusted (it is written here, in source); only the `${}` holes are encoded. That
 * split is the point — encoding the whole string would destroy the `/` separators.
 */
export function path(strings: TemplateStringsArray, ...values: Segment[]): string {
  return strings.reduce(
    (out, chunk, i) =>
      out + chunk + (i < values.length ? encodeURIComponent(String(values[i])) : ''),
    '',
  );
}

const DEFAULT_TIMEOUT_MS = 30_000;
const NAMESPACE = 'invflux/v1';

function buildUrl(apiRoot: string, route: string, params?: RequestOptions['params']): string {
  const clean = route.startsWith('/') ? route.slice(1) : route;
  // `?rest_route=/` form: the route appends verbatim. Otherwise the `/wp-json/` form.
  const url = apiRoot.includes('rest_route=')
    ? apiRoot + clean
    : `${apiRoot.replace(/\/$/, '')}/${clean}`;
  if (!params) return url;

  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) for (const v of value) sp.append(key, String(v));
    else sp.append(key, String(value));
  }
  const qs = sp.toString();
  if (qs === '') return url;
  // `&` when the apiRoot has already opened the query string, `?` otherwise.
  return `${url}${url.includes('?') ? '&' : '?'}${qs}`;
}

/** A write whose server answer is "some of it worked" — preserved from the admin settings client. */
export interface PartialResult<TApplied = string, TError = string> {
  ok: boolean;
  status: number;
  applied: TApplied[];
  errors: Record<string, TError>;
}

export interface InvFluxApi {
  get: <T>(route: string, options?: RequestOptions) => Promise<T>;
  post: <T>(route: string, body?: unknown, options?: RequestOptions) => Promise<T>;
  put: <T>(route: string, body?: unknown, options?: RequestOptions) => Promise<T>;
  patch: <T>(route: string, body?: unknown, options?: RequestOptions) => Promise<T>;
  del: <T>(route: string, body?: unknown, options?: RequestOptions) => Promise<T>;
  /**
   * A write that reports per-item outcomes instead of throwing. Use only where the server genuinely
   * answers "3 of 5 applied" — a blanket throw there loses which three.
   */
  partial: <TApplied = string, TError = string>(
    method: 'POST' | 'PUT' | 'PATCH',
    route: string,
    body?: unknown,
    options?: RequestOptions,
  ) => Promise<PartialResult<TApplied, TError>>;
  /** A binary endpoint (an export, a PDF), nonce-authenticated like everything else. */
  blob: (route: string, options?: RequestOptions) => Promise<Blob>;
  /** Fetch a binary endpoint and hand the browser a download named `filename`. */
  download: (route: string, filename: string, options?: RequestOptions) => Promise<void>;
  /** The absolute URL for a route — for a form action or an `<a href>` the browser must follow. */
  url: (route: string) => string;
}

export function createInvFluxApi(context: ApiContext): InvFluxApi {
  async function raw(
    method: string,
    route: string,
    body: unknown,
    options: RequestOptions,
  ): Promise<{ status: number; payload: unknown; ok: boolean }> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-WP-Nonce': context.nonce,
      ...options.headers,
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] ??= 'application/json';
      init.body = JSON.stringify(body);
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // The caller's signal and our timeout both have to be able to abort this. `AbortSignal.any`
    // composes them without either one owning the other, so a caller-side abort is not mistaken for
    // a timeout and a timeout does not leak past the caller's own lifetime.
    const timeout = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
    const signals = [options.signal, timeout].filter((s): s is AbortSignal => s !== undefined);
    if (signals.length > 0) init.signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);

    let res: Response;
    try {
      res = await fetch(buildUrl(context.apiRoot, route, options.params), init);
    } catch (cause) {
      // Never reached the server. Status 0 is what `isNetworkFailure` keys on; the caller's own abort is
      // re-thrown untouched so a cancelled query is not reported to the user as a failure.
      if (options.signal?.aborted === true) throw cause;
      throw new ApiError(0, null, cause instanceof Error ? cause.message : 'Network request failed');
    }

    // Parse regardless of status: an error body carries the slug and message worth showing.
    // 204 and an empty body are `undefined`, not a SyntaxError.
    const text = await res.text();
    let payload: unknown = undefined;
    if (text !== '') {
      try {
        payload = JSON.parse(text);
      } catch {
        // A non-JSON body is still evidence (a PHP fatal renders HTML). Keep it as the message.
        payload = res.ok ? undefined : { message: text.slice(0, 500) };
      }
    }
    return { status: res.status, payload, ok: res.ok };
  }

  async function request<T>(
    method: string,
    route: string,
    body: unknown,
    options: RequestOptions,
    defaultRetries: number,
  ): Promise<T> {
    const attempts = (options.retries ?? defaultRetries) + 1;
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const { status, payload, ok } = await raw(method, route, body, options);
        if (!ok) throw new ApiError(status, payload);
        return payload as T;
      } catch (error) {
        last = error;
        // A terminal 4xx, a caller abort, or the final attempt: stop.
        if (i === attempts - 1 || !isRetryable(error)) throw error;
      }
    }
    throw last;
  }

  return {
    // Reads retry by default: a read is idempotent, so a dropped connection is worth one more try.
    get: (route, options = {}) => request('GET', route, undefined, options, 2),
    // Writes do not: the request may well have been applied before the connection dropped, and
    // replaying it would double the effect. Callers that know their route is idempotent opt in.
    post: (route, body, options = {}) => request('POST', route, body, options, 0),
    put: (route, body, options = {}) => request('PUT', route, body, options, 0),
    patch: (route, body, options = {}) => request('PATCH', route, body, options, 0),
    del: (route, body, options = {}) => request('DELETE', route, body, options, 0),

    partial: async (method, route, body, options = {}) => {
      const { status, payload, ok } = await raw(method, route, body, options);
      const data = (payload ?? {}) as { applied?: unknown[]; errors?: Record<string, unknown> };
      return {
        ok,
        status,
        applied: (data.applied ?? []) as never[],
        errors: (data.errors ?? {}) as Record<string, never>,
      };
    },

    blob: async (route, options = {}) => {
      // Deliberately not through `raw`, which reads the body as text to parse it — that would
      // decode a binary export as UTF-8 and corrupt it. An *error* still comes back as JSON, so the
      // failure path re-uses the same contract.
      const res = await fetch(buildUrl(context.apiRoot, route, options.params), {
        method: 'GET',
        headers: { 'X-WP-Nonce': context.nonce, ...options.headers },
        signal: options.signal,
      });
      if (!res.ok) {
        const payload: unknown = await res.json().catch(() => null);
        throw new ApiError(res.status, payload);
      }
      return res.blob();
    },

    download: async (route, filename, options = {}) => {
      const blob = await createInvFluxApi(context).blob(route, options);
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = filename;
      // Appended so the click bubbles: the host's click interceptor stops the router hijacking it,
      // while the `<a download>` default action still fires.
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on a later task, never synchronously after `click()`. The click only *schedules* the
      // download; revoking in the same tick can pull the object URL out from under it, and the
      // failure is browser- and size-dependent, so it reads as a flaky export rather than a bug.
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
    },

    url: (route) => buildUrl(context.apiRoot, route),
  };
}

/** Prefix a namespace-relative route (`/workbench/products`) with the plugin's REST namespace. */
export function ns(route: string): string {
  return `${NAMESPACE}${route.startsWith('/') ? route : `/${route}`}`;
}

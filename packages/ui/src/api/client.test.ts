import { describe, it, expect, vi, afterEach } from 'vitest';
import { createInvFluxApi, path, ns } from './client';
import { ApiError, isRetryable } from './errors';

/**
 * These pin the behaviours the consolidated client had to *preserve* from the seven it replaced —
 * each of those got something right the others did not, so every one of them is a regression test
 * against consolidating on the median. The divergences, not the duplication, were the actual cost.
 */

const CTX = { apiRoot: 'https://shop.test/index.php?rest_route=/', nonce: 'abc123' };
const WPJSON = { apiRoot: 'https://shop.test/wp-json/', nonce: 'abc123' };

function mockFetch(...responses: Array<Response | Error>): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) fn.mockImplementationOnce(() => Promise.reject(r));
    else fn.mockImplementationOnce(() => Promise.resolve(r));
  }
  vi.stubGlobal('fetch', fn);
  return fn;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('URL construction', () => {
  it('appends the route verbatim to the rest_route query-string form', async () => {
    const fetchMock = mockFetch(json({ ok: true }));
    await createInvFluxApi(CTX).get(ns('/workbench/products'));
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://shop.test/index.php?rest_route=/invflux/v1/workbench/products',
    );
  });

  it('also handles the /wp-json/ form — only one of the old clients did', async () => {
    const fetchMock = mockFetch(json({ ok: true }));
    await createInvFluxApi(WPJSON).get(ns('/workbench/products'));
    expect(fetchMock.mock.calls[0][0]).toBe('https://shop.test/wp-json/invflux/v1/workbench/products');
  });

  it('sends the nonce on every request', async () => {
    const fetchMock = mockFetch(json({}));
    await createInvFluxApi(CTX).get('/x');
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['X-WP-Nonce']).toBe('abc123');
  });
});

describe('path`` encodes interpolated segments', () => {
  it('encodes a value that would otherwise escape the rest_route query parameter', () => {
    // The whole reason this exists: with the query-string apiRoot the route lives *inside* a query
    // parameter, so a bare `&` starts a new parameter and silently rewrites the request.
    expect(path`/suppliers/${'a&b=c'}/contacts`).toBe('/suppliers/a%26b%3Dc/contacts');
  });

  it('leaves the static separators alone', () => {
    expect(path`/orders/${42}/lines`).toBe('/orders/42/lines');
  });
});

describe('error handling', () => {
  it('parses the body BEFORE checking ok, so the slug survives', async () => {
    mockFetch(json({ code: 'invflux_order_not_shippable', message: 'Order must be Started.' }, 409));
    const err = await createInvFluxApi(CTX)
      .post('/x')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('invflux_order_not_shippable');
    expect((err as ApiError).message).toBe('Order must be Started.');
    expect((err as ApiError).status).toBe(409);
  });

  it('fails identically on a read — four old clients discarded the message on GET only', async () => {
    mockFetch(json({ code: 'oops', message: 'Server said why.' }, 500));
    const err = await createInvFluxApi(CTX)
      .get('/x', { retries: 0 })
      .catch((e: unknown) => e);
    expect((err as ApiError).message).toBe('Server said why.');
    expect((err as ApiError).code).toBe('oops');
  });

  it('never guesses `error` as the slug — the key is ambiguous across our own wire', async () => {
    // The licence proxy sends `{ error: "<slug>" }`; the annotation routes send `{ error: "<prose>" }`.
    // The transport reads only `code`, and each surface normalizes its own contract at its boundary.
    mockFetch(json({ error: 'Add note failed' }, 422));
    const err = await createInvFluxApi(CTX)
      .post('/x')
      .catch((e: unknown) => e);
    expect((err as ApiError).code).toBeUndefined();
    expect((err as ApiError).body).toEqual({ error: 'Add note failed' });
  });

  it('marks a transport failure isNetworkFailure (status 0), distinct from a 5xx', async () => {
    mockFetch(new TypeError('Failed to fetch'));
    const err = await createInvFluxApi(CTX)
      .post('/x')
      .catch((e: unknown) => e);
    expect((err as ApiError).isNetworkFailure).toBe(true);
    expect((err as ApiError).status).toBe(0);
  });

  it('recognises an expired nonce specifically, not as a generic 403', async () => {
    mockFetch(json({ code: 'rest_cookie_invalid_nonce', message: 'Cookie check failed' }, 403));
    const err = await createInvFluxApi(CTX)
      .get('/x', { retries: 0 })
      .catch((e: unknown) => e);
    expect((err as ApiError).isAuthExpired).toBe(true);
  });

  it('does not mistake a real permissions 403 for an expired session', async () => {
    mockFetch(json({ code: 'invflux_forbidden', message: 'Nope' }, 403));
    const err = await createInvFluxApi(CTX)
      .get('/x', { retries: 0 })
      .catch((e: unknown) => e);
    expect((err as ApiError).isAuthExpired).toBe(false);
  });

  it('keeps a non-JSON error body (a PHP fatal renders HTML) as the message', async () => {
    mockFetch(new Response('<b>Fatal error</b>: boom', { status: 500 }));
    const err = await createInvFluxApi(CTX)
      .get('/x', { retries: 0 })
      .catch((e: unknown) => e);
    expect((err as ApiError).message).toContain('Fatal error');
  });

  it('survives instanceof through a subclass, so typed call sites keep narrowing', () => {
    class ShipOrderError extends ApiError {}
    const e = new ShipOrderError(409, { code: 'x' });
    expect(e).toBeInstanceOf(ShipOrderError);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.name).toBe('ShipOrderError');
  });
});

describe('empty bodies', () => {
  it('returns undefined for 204 rather than throwing a SyntaxError', async () => {
    mockFetch(new Response(null, { status: 204 }));
    await expect(createInvFluxApi(CTX).del('/x')).resolves.toBeUndefined();
  });
});

describe('retry policy', () => {
  it('retries a read on a network error and succeeds', async () => {
    const fetchMock = mockFetch(new TypeError('Failed to fetch'), json({ ok: 1 }));
    await expect(createInvFluxApi(CTX).get('/x')).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never retries a 4xx — it is terminal, and replaying just repeats the refusal', async () => {
    const fetchMock = mockFetch(json({ code: 'nope' }, 422), json({ ok: 1 }));
    await expect(createInvFluxApi(CTX).get('/x')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry writes by default — the write may already have landed', async () => {
    const fetchMock = mockFetch(new TypeError('Failed to fetch'), json({ ok: 1 }));
    await expect(createInvFluxApi(CTX).post('/x', {})).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('classifies retryability by status', () => {
    expect(isRetryable(new ApiError(0, null))).toBe(true);
    expect(isRetryable(new ApiError(503, null))).toBe(true);
    expect(isRetryable(new ApiError(429, null))).toBe(true);
    expect(isRetryable(new ApiError(404, null))).toBe(false);
    expect(isRetryable(new Error('not ours'))).toBe(false);
  });
});

describe('abort', () => {
  it('re-throws the caller’s abort untouched, so a cancelled query is not a failure', async () => {
    const controller = new AbortController();
    mockFetch(new DOMException('Aborted', 'AbortError'));
    controller.abort();
    const err = await createInvFluxApi(CTX)
      .get('/x', { signal: controller.signal })
      .catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ApiError);
    expect((err as Error).name).toBe('AbortError');
  });
});

describe('partial results', () => {
  it('reports per-item outcomes instead of throwing, so a partial write is not lost', async () => {
    mockFetch(json({ applied: ['a', 'b'], errors: { c: 'too low' } }, 207));
    const result = await createInvFluxApi(CTX).partial('PUT', '/settings', { changes: [] });
    expect(result.applied).toEqual(['a', 'b']);
    expect(result.errors).toEqual({ c: 'too low' });
    // `ok` mirrors HTTP, and 207 Multi-Status is a 2xx: the request was accepted and acted on.
    // Whether *everything* applied is what `errors` answers — conflating the two is how a caller
    // ends up reporting a blanket failure over a write that mostly succeeded.
    expect(result.ok).toBe(true);
  });

  it('reports ok:false when the write was rejected outright', async () => {
    mockFetch(json({ applied: [], errors: { a: 'unknown setting' } }, 400));
    const result = await createInvFluxApi(CTX).partial('PUT', '/settings', { changes: [] });
    expect(result.ok).toBe(false);
    expect(result.applied).toEqual([]);
  });
});

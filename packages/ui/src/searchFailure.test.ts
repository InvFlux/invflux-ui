import { describe, expect, it } from 'vitest';
import { ApiError } from './api/errors';
import { classifyFailure, failureLine, failureToast } from './searchFailure';

/**
 * What an async filter tells the operator when its search fails.
 *
 * The rule these pin is that a failed search must never be indistinguishable from an empty one: the
 * two are opposite answers, and "No matches" on a broken endpoint teaches the operator that a SKU
 * they are holding in their hand does not exist.
 *
 * The status is quoted because it outlives the toast and is what they can read back when reporting
 * the problem — but only where there *is* one.
 */
describe('search failure messages', () => {
  it('quotes the status the server answered with', () => {
    const failure = classifyFailure(new ApiError(500, { code: 'boom' }));

    expect(failure).toEqual({ status: 500, authExpired: false });
    expect(failureLine(failure)).toContain('500');
    expect(failureToast(failure)).toContain('500');
  });

  it('calls a lost request a network error rather than quoting "HTTP 0"', () => {
    // ApiError uses 0 for "never reached WordPress" — offline, DNS, a tab torn down mid-flight.
    // Printing "HTTP 0" would invent a status, and point at a server that may be perfectly healthy.
    const failure = classifyFailure(new ApiError(0, null));

    expect(failure.status).toBe(0);
    for (const message of [failureLine(failure), failureToast(failure)]) {
      expect(message).toMatch(/network/i);
      expect(message).not.toMatch(/HTTP/);
      expect(message).not.toContain('0');
    }
  });

  it('gives an expired session its own remedy instead of "try again"', () => {
    // The shell is designed to stay mounted for days while a nonce lives 12-24h, so a long-running
    // tab reaches this in normal use. Retrying cannot succeed until the page is reloaded.
    const failure = classifyFailure(new ApiError(403, { code: 'rest_cookie_invalid_nonce' }));

    expect(failure.authExpired).toBe(true);
    expect(failureToast(failure)).toMatch(/reload/i);
    // The point is that it is not the generic message — which says to retry, and retrying is the
    // one thing that cannot work here.
    expect(failureToast(failure)).not.toBe(failureToast({ status: null, authExpired: false }));
    expect(failureToast(failure)).not.toBe(failureToast({ status: 403, authExpired: false }));
    expect(failureLine(failure)).not.toContain('403');
  });

  it('a plain 403 is not an expired session', () => {
    // Only WordPress's nonce slug means "expired". A genuine permissions refusal must not send the
    // operator reloading the page to fix something a reload cannot fix.
    const failure = classifyFailure(new ApiError(403, { code: 'invflux_forbidden' }));

    expect(failure.authExpired).toBe(false);
    expect(failureLine(failure)).toContain('403');
  });

  it('falls back to a status-free message when the rejection is not an ApiError', () => {
    // `loadOptions` is supplied by the consumer, so it may reject with anything at all.
    for (const thrown of [new Error('kaboom'), 'a string', undefined, { status: 500 }]) {
      const failure = classifyFailure(thrown);

      expect(failure).toEqual({ status: null, authExpired: false });
      expect(failureLine(failure)).not.toMatch(/\d/);
      expect(failureToast(failure)).not.toMatch(/\d/);
    }
  });

  it('says something in every case', () => {
    // An empty line would render as a blank dropdown, which is the silence this whole path exists
    // to remove.
    for (const failure of [
      { status: 500, authExpired: false },
      { status: 0, authExpired: false },
      { status: null, authExpired: false },
      { status: 403, authExpired: true },
    ] as const) {
      expect(failureLine(failure).trim().length).toBeGreaterThan(0);
      expect(failureToast(failure).trim().length).toBeGreaterThan(0);
    }
  });
});

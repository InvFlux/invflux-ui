/**
 * One error type for every REST call in the admin app.
 *
 * Before this there were five contracts — typed classes carrying `code` + `status` (dispatch),
 * `ApiError` with a body and a `.code` getter (licenses), `ApiError` with only a message (the app
 * shell), a result union (admin writes), and a bare `Error` everywhere else. A caller that wanted
 * the server's machine-readable slug therefore had to know which package it was talking to, and
 * four of the clients threw the slug away on reads while keeping it on writes.
 *
 * `ApiError` carries everything any of them carried. Surface-specific errors subclass it rather
 * than replacing it, so a call site can keep narrowing with `instanceof ShipOrderError` while
 * generic handling (`isAuthExpired`, `unreachable`) still works one level up.
 */

/** WordPress's slug for a nonce that has aged out. */
const WP_INVALID_NONCE = 'rest_cookie_invalid_nonce';

/** The shape WordPress's REST layer uses for an error body. */
interface WpErrorBody {
  code?: unknown;
  message?: unknown;
  data?: { status?: unknown } | null;
}

/**
 * Only `code` — WordPress's own key, and the one every InvFlux route follows.
 *
 * Deliberately **not** `error` as a fallback, even though the licence proxy answers with
 * `{ error: "not_activated" }`. Our own annotation routes use the same key for the opposite thing —
 * `{ error: "Add note failed" }`, a human message — so a client that guesses would turn a sentence
 * into a machine-readable slug on one surface or a slug into prose on the other. The key is
 * genuinely ambiguous across our wire, so the transport refuses to guess and the surface that knows
 * its own contract normalizes at its boundary (see the licences client).
 */
function readSlug(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const b = body as WpErrorBody;
  return typeof b.code === 'string' && b.code !== '' ? b.code : undefined;
}

function readMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const m = (body as WpErrorBody).message;
  return typeof m === 'string' && m !== '' ? m : undefined;
}

export class ApiError extends Error {
  /** HTTP status, or 0 when the request never produced a response (offline, DNS, CORS, abort). */
  readonly status: number;
  /** The server's machine-readable slug, when it sent one. Never invent one — absent means absent. */
  readonly code: string | undefined;
  /** The parsed response body, whatever it was. Kept so a caller can read fields we don't model. */
  readonly body: unknown;

  constructor(status: number, body: unknown, fallbackMessage?: string) {
    super(readMessage(body) ?? fallbackMessage ?? `Request failed (${String(status)})`);
    this.name = new.target.name;
    this.status = status;
    this.code = readSlug(body);
    this.body = body;
    // Subclassing a builtin across the TS downlevel boundary breaks `instanceof` without this.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * The request never reached WordPress — offline, DNS failure, the tab torn down mid-flight.
   * Distinct from a 5xx, which *did* reach it: only this one is safe to retry blindly, and only this
   * one should be phrased to the user as a connection problem rather than a server problem.
   *
   * Deliberately **not** called `unreachable`. The licences client already owns that word for a
   * different fact — "WordPress answered fine, but *it* could not reach the licensing service",
   * which arrives as a 502 carrying `service_unavailable`. Both are real and they are not the same
   * failure: one means the merchant's browser is offline, the other means our vendor is. Sharing a
   * name across that boundary would make a licence-server outage read as a local network problem.
   */
  get isNetworkFailure(): boolean {
    return this.status === 0;
  }

  /**
   * The WordPress nonce has aged out. Worth its own predicate because the admin shell is explicitly
   * designed to stay mounted, while a nonce lives 12–24h — so a long-running tab reaches this in
   * normal use, and "your session expired, reload the page" is the only useful thing to say. A
   * generic 403 sends the user hunting for a permissions problem they do not have.
   */
  get isAuthExpired(): boolean {
    return this.status === 403 && this.code === WP_INVALID_NONCE;
  }
}

/** True for a status worth retrying: the server never answered, or answered that it was overloaded. */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  // Never a 4xx: those are terminal by definition, and retrying a 409/422 just repeats the refusal.
  return error.isNetworkFailure || error.status === 429 || error.status >= 500;
}

import { ApiError as BaseApiError, createInvFluxApi, ns } from '@invflux/ui/api';
import type { AppContext } from '../../types';
import type {
  AccountClaimResponse,
  AddonsResponse,
  AccountPayload,
  CatalogResponse,
  CheckoutResponse,
  RegistrationResponse,
  SiteSeatsResponse,
  SiteStatus,
  WithdrawalResponse,
} from './types';

/**
 * The licences section's error type — the shared {@link BaseApiError} plus one predicate of its own.
 *
 * `instanceof ApiError` still narrows here, and generic handling (`isAuthExpired`, `status`, `code`)
 * comes from the base. What stays local is `unreachable`, because in this section the word means
 * something the base cannot know: **WordPress answered us perfectly well, and could not itself reach
 * the licensing service.** That arrives as a normal HTTP response carrying `service_unavailable` —
 * the opposite end of the wire from the base's `isNetworkFailure`, which means our own request never
 * landed. One says the merchant is offline; this one says our vendor is, and only this one earns
 * "come back later" rather than an error the merchant might try to act on.
 */
export class ApiError extends BaseApiError {
  /**
   * The account proxy answers `{ error: "<slug>" }` where WordPress sends `{ code: "<slug>" }`, so
   * the slug is lifted into `code` here — in the constructor rather than at the call that catches,
   * so every construction path normalizes, including the ones tests build directly.
   *
   * The shared transport deliberately does not do this: our annotation routes use the same `error`
   * key for a human message, so the key means opposite things on different surfaces and only the
   * surface knows which. See the note on `readSlug` in the transport's errors module.
   */
  constructor(status: number, body: unknown) {
    super(status, ApiError.normalize(body));
  }

  private static normalize(body: unknown): unknown {
    if (typeof body !== 'object' || body === null) return body;
    const b = body as { error?: unknown; code?: unknown };
    return typeof b.error === 'string' && typeof b.code !== 'string' ? { ...b, code: b.error } : b;
  }

  /**
   * Registration's failure is deliberately *not* in here: the adapter cannot tell a refusal from a
   * timeout on that route, and claiming reachability knowledge it does not have would be worse than
   * the vaguer message it gives instead.
   */
  get unreachable(): boolean {
    return this.code === 'service_unavailable';
  }
}

/** Outcome of an add-on write (the adapter's `AddonController` responses). */
export interface AddonWriteResult {
  slug: string;
  installed?: boolean;
  active?: boolean;
}

/** Nonce-authenticated client for the account proxy (`invflux/v1/account/*`). GET + POST. */
export interface LicensesApi {
  getAccount(): Promise<AccountPayload>;
  /**
   * The product estate — every SKU, its availability and its price in the shop's band, under one
   * version number. Supersedes a separate pricing read: the catalogue quotes the same numbers and
   * also carries the SKUs nobody can buy yet, which is most of the page.
   */
  getCatalog(): Promise<CatalogResponse>;
  checkout(body: { plan: string; quantity?: number }): Promise<CheckoutResponse>;
  cancelSubscription(licenseId: string): Promise<void>;
  deactivateSeat(activationId: string): Promise<void>;
  getAddons(): Promise<AddonsResponse>;
  /**
   * Run one action a row declared, by POSTing the path it came with. There is deliberately no
   * per-verb method here: the section is not supposed to be able to name the actions it offers,
   * only to run the ones the server said were possible.
   */
  runAddonAction(path: string): Promise<AddonWriteResult>;
  /** Claim the free Essentials licence for this site against `email`. Opt-in; see `RegisterCard`. */
  registerFree(email: string): Promise<RegistrationResponse>;
  /**
   * Ask whether the emailed confirmation has been opened yet, and collect the account token if so.
   *
   * Resolves rather than rejects on "not yet" — the merchant pressed a button that asks a question,
   * and that is one of its ordinary answers.
   */
  claimAccountLink(): Promise<AccountClaimResponse>;
  /**
   * Un-register this site: release its seat, forget the account, stop the daily check-in.
   *
   * Rejects with a `paid_entitlement_held` {@link ApiError} when the install is using a paid
   * licence — that check-in is how a paid entitlement stays verified, so the two cannot both be had.
   */
  withdrawRegistration(): Promise<WithdrawalResponse>;
  /** This install's own facts — registration state, its activation, when it next checks in. */
  getSiteStatus(): Promise<SiteStatus>;
  /**
   * Every live claim against this site, across accounts. Administrator-only (`manage_options`), so
   * a 403 here is an ordinary answer for a shop manager, not a fault.
   */
  getSiteSeats(): Promise<SiteSeatsResponse>;
  /**
   * Reject one claim against this site. The server scopes the target to this site's own URL.
   *
   * For a seat belonging to **another** account. This install's own seat goes through
   * {@link deactivateThisSite} instead, which also clears what this install holds locally — see the
   * comment on the release mutation.
   */
  releaseSiteSeat(activationId: string): Promise<void>;
  /**
   * Give up this install's own seat: frees it server-side *and* forgets the blob and tokens here.
   *
   * Distinct from {@link withdrawRegistration}, which does this and additionally stops the daily
   * check-in for good. This one leaves the site willing to register or activate again.
   */
  deactivateThisSite(): Promise<void>;
}

/**
 * Build the account client bound to the boot context's REST root + nonce. `apiRoot` is the WP REST
 * root in `rest_route` form (`…/index.php?rest_route=/`), so a `?` may already be present — the same
 * URL construction as the shell's `lib/api`.
 */
export function createLicensesApi(context: Pick<AppContext, 'apiRoot' | 'nonce'>): LicensesApi {
  const api = createInvFluxApi(context);

  // The shared client throws the base ApiError; re-wrap as this section's subclass so `unreachable`
  // is available at every call site without each one re-deriving it from the slug.
  async function request<T>(method: 'GET' | 'POST', route: string, body?: unknown): Promise<T> {
    try {
      return method === 'GET' ? await api.get<T>(ns(route)) : await api.post<T>(ns(route), body);
    } catch (error) {
      if (error instanceof BaseApiError && !(error instanceof ApiError)) {
        throw new ApiError(error.status, error.body);
      }
      throw error;
    }
  }

  return {
    getAccount: () => request<AccountPayload>('GET', '/account'),
    getCatalog: () => request<CatalogResponse>('GET', '/account/catalog'),
    checkout: (body) => request<CheckoutResponse>('POST', '/account/checkout', body),
    // Country + site_url are injected by the proxy server-side, so the body carries only the plan.
    cancelSubscription: (licenseId) =>
      request<void>('POST', '/account/subscription/cancel', { license_id: licenseId }),
    deactivateSeat: (activationId) =>
      request<void>('POST', `/account/seats/${encodeURIComponent(activationId)}/deactivate`),
    getAddons: () => request<AddonsResponse>('GET', '/account/addons'),
    // The path comes from the payload the adapter just served, so it is server-authored — the
    // client never composes one, and a route the install has no capability for is simply never
    // named. Anything the action needs beyond its identity (a version to pin, a token) is resolved
    // server-side; nothing sensitive travels through here.
    runAddonAction: (path) => request<AddonWriteResult>('POST', path),
    // Not under /account/* — there is no account yet, which is the whole point of the call. The
    // site URL and plugin version travel with it, added adapter-side.
    registerFree: (email) => request<RegistrationResponse>('POST', '/license/register', { email }),
    // Also unauthenticated against the account API, for the same reason: this is how an install
    // *earns* the account credential it does not yet hold.
    claimAccountLink: () => request<AccountClaimResponse>('POST', '/license/account-token'),
    // The inverse of registerFree, and beside it for the same reason: an opt-in nobody can leave is
    // not an opt-in. No body — the site being un-registered is the one making the call.
    withdrawRegistration: () => request<WithdrawalResponse>('POST', '/license/withdraw'),
    // Local read — the adapter answers from its own options and calls nothing. It therefore works
    // when the licensing service does not, which is the point: a site's own state is not something
    // the page should be unable to state during an outage.
    getSiteStatus: () => request<SiteStatus>('GET', '/license/site'),
    getSiteSeats: () => request<SiteSeatsResponse>('GET', '/license/site-seats'),
    releaseSiteSeat: (activationId) =>
      request<void>('POST', `/license/site-seats/${encodeURIComponent(activationId)}/release`),
    deactivateThisSite: () => request<void>('POST', '/license/deactivate'),
  };
}

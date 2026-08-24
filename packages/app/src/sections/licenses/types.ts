/**
 * Wire shapes for the Licenses & Add-ons section — the account-scoped surface behind the
 * same-origin proxy (`invflux/v1/account/*`, adapter `AccountProxyController`). The SPA never talks
 * to the license server directly; the adapter attaches the account bearer server-side.
 *
 * Mirrors the license server's `AccountController` / `PricingController` payloads.
 */

/** A licence state as reported by the server's LicenseStateMachine. */
export type LicenseState = 'active' | 'lapsed' | 'cancelled' | 'revoked' | (string & {});

/** One live seat (a non-deactivated activation) of an owned licence. */
export interface Seat {
  activation_id: string;
  site_url: string;
  env_class: string | null;
  last_seen_at: string | null;
}

/** One owned licence — a base (`kind: 'base'`) or an add-on (`kind: 'addon'`, `addon_key` set). */
export interface OwnedLicense {
  /** Opaque row id. What every action on this licence is addressed to. */
  id: string;
  /** Display only — the server masks all but the last four. Never a working credential. */
  key: string;
  kind: 'base' | 'addon';
  addon_key: string | null;
  quantity: number | null;
  sku: string;
  /** Display name from the catalogue — never derive one from the sku. */
  name: string;
  state: LicenseState;
  cadence: string | null;
  is_founder: boolean;
  /** ISO-8601; paid features are retained until this instant even after a cancel. */
  paid_through: string | null;
  grace_until: string | null;
  /** Only a MoR-backed subscription can be cancelled (free/manual licences: false). */
  cancellable: boolean;
  /**
   * A subscription exists and its first payment has not confirmed yet.
   *
   * Not a licence state — entitlement is running, deliberately, because a merchant of record can
   * take ~48-51h to confirm a first charge and under-granting someone who paid is the worse error.
   * This is the billing answer shown beside the entitlement one, so a merchant is not left
   * wondering for two days whether their payment worked.
   */
  awaiting_first_payment?: boolean;
  seats: Seat[];
}

/** `GET invflux/v1/account` — the authenticated account with its licences + live seats. */
export interface AccountPayload {
  account: { email: string; name: string | null };
  licenses: OwnedLicense[];
  /**
   * Set by the adapter when the licensing service could not be reached and it served the last
   * payload it had. The page still renders — it just says so, and stops claiming the state is
   * current. Absent on every live read.
   */
  stale?: boolean;
}

/**
 * Whether a SKU can be bought right now. Server-owned and deliberately not a client constant:
 * launch day flips one field and every install starts offering it, with no plugin update.
 */
export type Availability = 'coming_soon' | 'available' | 'retired' | (string & {});

/** Which side of the Pro boundary a SKU sits on — grouping only; it gates nothing. */
export type CatalogSide = 'base-tier' | 'bridge' | 'pro-addon' | (string & {});

/**
 * One SKU of the product estate — everything that exists, not only what is for sale.
 *
 * The two prerequisite edges are the load-bearing pair. `requires` is structural: every SKU listed
 * must be entitled for this one to run at all. `subsumed_by` is commercial: holding any SKU listed
 * already grants this one, which is why a Pro holder is shown "included in your plan" instead of a
 * price. Neither can be derived from the other, and a single "depends on" field could express only
 * the first.
 */
export interface CatalogSku {
  sku: string;
  name: string;
  tagline: string | null;
  features: string[] | null;
  side: CatalogSide;
  requires: string[];
  subsumed_by: string[];
  availability: Availability;
  cadence: string | null;
  /** The price on offer is a founding one — held for as long as the subscription runs. */
  founder: boolean;
  cta_label: string | null;
  price_minor: number | null;
  currency: string;
  /** Server-formatted price for display (band + cadence aware), e.g. `$49 / mo`. */
  price_label: string;
  /** The artifact delivering this SKU on this platform, or null when nothing is published yet. */
  slug: string | null;
  version: string | null;
  min_platform_version: number | null;
}

/**
 * `GET invflux/v1/account/catalog` — the whole product estate in one document, priced in the shop's
 * band. Fetched anonymously (the adapter attaches no token): it is a product list, and nothing
 * about the site travels with the request.
 */
export interface CatalogResponse {
  /** Monotonic; the region-free half of the document's cache token. */
  catalog_version: number;
  catalog_etag: string;
  country: string;
  band: string;
  skus: CatalogSku[];
  /** Last-known-good catalogue, served because the licensing service was unreachable. */
  stale?: boolean;
}

/**
 * Where this install stands with the merchant's *account*, as opposed to its licence.
 *
 * The two are separable: entitlement arrives with the signed blob, while reaching the account needs
 * a credential the licensing service only hands to an address that has proved it owns itself. So an
 * install can be fully licensed and still be waiting here.
 */
export type AccountStatus = 'linked' | 'verification_required' | 'unlinked';

/**
 * `POST invflux/v1/license/register` — claim the free Essentials licence for this site.
 *
 * `registered: true` does not mean linked. Registering an address that already has an account gets
 * the licence but not the account: the service mails that address instead, and `pending_email`
 * names where it went.
 */
export interface RegistrationResponse {
  registered: boolean;
  account_status: AccountStatus;
  pending_email?: string;
}

/** `POST invflux/v1/license/account-token` — collect the token once the address has confirmed. */
export interface AccountClaimResponse {
  account_status: AccountStatus;
}

/**
 * What became of a withdrawal.
 *
 * `withdrawn_seat_not_released` is still a success: the site has stopped contacting the licensing
 * service, which is the part the merchant asked for and the only part this install controls. The
 * seat is the service's to reclaim, and with no heartbeat renewing it, it will be.
 */
export type WithdrawalStatus = 'withdrawn' | 'withdrawn_seat_not_released';

/**
 * One live claim against this site, from `GET invflux/v1/license/site-seats`.
 *
 * The converse of {@link Seat}, which lists where *a licence* is activated. This lists what is
 * activated *here* — across accounts, so `email` may well be someone else's. A site administrator
 * has the right to know who registered their site; see the disclosure note on the server controller.
 */
export interface SiteSeat {
  activation_id: string;
  /** This install's own seat, decided server-side so the client never matches on a URL. */
  is_current: boolean;
  /** Masked — never a working credential. */
  license_key: string;
  sku: string;
  /** Display name from the catalogue, server-resolved. Falls back to the SKU, never to blank. */
  name: string;
  kind: 'base' | 'addon';
  state: string;
  email: string;
  /** Whether releasing this costs something bought, rather than a click to redo. */
  paid: boolean;
  env_class: string | null;
  activated_at: string | null;
  last_seen_at: string | null;
}

/** `GET invflux/v1/license/site-seats` — every live claim against this site. */
export interface SiteSeatsResponse {
  site_url: string;
  seats: SiteSeat[];
}

/** `POST invflux/v1/license/withdraw` — un-register this site and stop the daily check-in. */
export interface WithdrawalResponse {
  withdrawn: boolean;
  status: WithdrawalStatus;
}

/**
 * `GET invflux/v1/license/site` — what is true of *this install*, as opposed to the account.
 *
 * Everything else the page reads belongs to the account and exists whether or not this site does.
 * This is the one payload about the install itself, and `activation_id` is what lets a seat in a
 * licence's list be recognised as this one — a `site_url` comparison would put that identity behind
 * an un-canonicalised string match.
 */
export interface SiteStatus {
  site_url: string;
  /** Null when this install has never activated, or has withdrawn. */
  activation_id: string | null;
  registered: boolean;
  withdrawn: boolean;
  /** What this site *reports*; the authoritative class is the server's, on the matching seat. */
  environment: string;
  /** ISO-8601 of the next licence check, or null when nothing is scheduled. */
  next_check_at: string | null;
  /**
   * SKUs beyond the platform that this install holds — what withdrawing would cost.
   *
   * Non-empty means the server will refuse a withdrawal (`409 paid_entitlement_held`), because the
   * daily check-in is how a paid entitlement stays verified. Read from the same method the refusal
   * tests, so the control and the answer cannot disagree.
   */
  paid_skus: string[];
}

/** `POST invflux/v1/account/checkout` — the hosted-checkout hand-off. */
export interface CheckoutResponse {
  checkout_url: string;
  provider: string;
  band: string;
  sku: string;
  price_minor: number;
  currency: string;
}

/**
 * The install lifecycle of one entitled downloadable plugin (adapter `AddonStateResolver`):
 * entitled × installed → one state. `pro` appears here as a slug like any add-on
 * (a Pro base licence entitles the `pro` plugin).
 */
export type AddonInstallState = 'not_installed' | 'installed_inactive' | 'active' | (string & {});

/**
 * One action a row offers, declared by whoever can perform it. The section POSTs `path` and
 * refetches — it does not know, and must not need to know, what any given action does. Fetching a
 * plugin from our servers is a capability some installs simply don't have, and on those the
 * corresponding action is absent rather than broken.
 *
 * `label` and `pending_label` arrive translated and already carrying any version number, because
 * composing "Update to 1.4.0" here would mean knowing which actions exist.
 */
export interface AddonAction {
  id: string;
  label: string;
  pending_label: string;
  /** REST path relative to `invflux/v1`; always POSTed. */
  path: string;
  group: 'primary' | 'secondary' | 'destructive' | (string & {});
  order: number;
}

/** One entitled slug's merged install state, plus what can be done about it. */
export interface AddonState {
  slug: string;
  /** The SKU this plugin delivers — the key the catalogue is listed under, and the join between them. */
  sku: string;
  name: string;
  /** The entitling licence's state (`active`/`lapsed`/…) — a lapsed licence still runs, but downloads/updates are refused. */
  license_state: LicenseState;
  installed: boolean;
  active: boolean;
  installed_version: string | null;
  state: AddonInstallState;
  actions: AddonAction[];
}

/** `GET invflux/v1/account/addons` — the install-state list, one row per entitled slug. */
export interface AddonsResponse {
  addons: AddonState[];
}

/**
 * One catalogue SKU joined to the licence that covers it and the plugin that delivers it here —
 * the row the Licenses & Add-ons page actually renders. Built by `mergeCatalog`.
 */
export interface CatalogRow {
  sku: CatalogSku;
  /** The install-state row, when the account is entitled to this SKU; null otherwise. */
  addon: AddonState | null;
  /** This plugin itself — always present, never purchasable, and the anchor of the list. */
  platform: boolean;
  installed: boolean;
  entitled: boolean;
  /**
   * The display name of the SKU that grants this one through `subsumed_by`, when one is held, else
   * null. The name rather than a flag, because "included in your plan" leaves a merchant holding
   * two products to work out which plan that was.
   */
  includedIn: string | null;
}

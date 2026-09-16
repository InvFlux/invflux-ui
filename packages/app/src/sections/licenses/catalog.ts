import { ApiError } from './api';
import type { AddonState, CatalogRow, CatalogSku, OwnedLicense } from './types';

/**
 * The SKU of the plugin rendering the Licenses & Add-ons page.
 *
 * Not an availability constant of the kind the server-side catalogue exists to avoid — this is
 * identity, not policy: whatever the catalogue says about the platform SKU, it is on this site,
 * because it is the thing drawing the page.
 */
export const PLATFORM_SKU = 'essentials';

/**
 * The catalogue, joined to what the account owns and what this site has installed.
 *
 * The join is on the **SKU**, never the plugin slug. The catalogue lists what can be bought, and a
 * SKU is delivered by a differently-named artifact per platform (`pro` ships here as `woo-pro`), so
 * a slug match would miss exactly the row a merchant most wants to see. Rows the install cannot act
 * on are still rows: the gap between owned and running is the reason this page exists.
 */
export function mergeCatalog(
  skus: CatalogSku[],
  licenses: OwnedLicense[],
  addons: AddonState[],
): CatalogRow[] {
  const held = new Set(licenses.map((l) => l.sku));
  const bySku = new Map(addons.map((a) => [a.sku, a]));
  const names = displayNames(skus, licenses, addons);

  const rows = skus.map((sku): CatalogRow => {
    const addon = bySku.get(sku.sku) ?? null;
    const platform = sku.sku === PLATFORM_SKU;
    // Granted by something already held rather than bought on its own. Named, not hedged: a
    // merchant who owns two things should not have to work out which one covers this.
    const subsumer = sku.subsumed_by.find((s) => held.has(s));

    return {
      sku,
      addon,
      platform,
      installed: platform || (addon?.installed ?? false),
      entitled: platform || addon !== null || held.has(sku.sku),
      // Display only — the adapter declares install actions per *licence*, so a subsumed plugin
      // reads as included without a button until the fetching capability follows the edge too.
      includedIn: !platform && addon === null && undefined !== subsumer ? names(subsumer) : null,
    };
  });

  // Anything the account is entitled to that the catalogue did not mention. The catalogue is a
  // public document and withholds what has not been announced, so an entitlement can legitimately
  // outrun it — and a plugin sitting on this site is not something to leave off the page because a
  // marketing decision hid its SKU.
  const listed = new Set(skus.map((s) => s.sku));
  for (const addon of addons) {
    if (!listed.has(addon.sku)) rows.push(unlistedRow(addon));
  }

  return (
    rows
      // A retired SKU stays visible to whoever holds it, and disappears for everyone else.
      .filter((row) => row.entitled || row.sku.availability !== 'retired')
      .sort((a, b) => rank(a) - rank(b))
  );
}

/** Availability of a SKU the catalogue never described — not a state the server can send. */
const UNLISTED = '';

/**
 * A row for an entitled plugin with no catalogue entry: everything the catalogue would have said is
 * simply absent, rather than guessed. It still carries its install state and its actions, which is
 * the half the merchant can act on.
 */
function unlistedRow(addon: AddonState): CatalogRow {
  return {
    sku: {
      sku: addon.sku,
      name: addon.name,
      tagline: null,
      features: null,
      side: '',
      requires: [],
      subsumed_by: [],
      availability: UNLISTED,
      cadence: null,
      founder: false,
      cta_label: null,
      price_minor: null,
      currency: '',
      price_label: '',
      slug: addon.slug,
      version: null,
      min_platform_version: null,
    },
    addon,
    platform: false,
    installed: addon.installed,
    entitled: true,
    includedIn: null,
  };
}

/**
 * SKU → the name to show for it, from whichever source knows one: the catalogue, the licence, or
 * the installed plugin's own header. Falls back to the key, which is never pretty but is at least
 * never wrong — and beats title-casing an identifier into something that looks like a product name.
 */
function displayNames(
  skus: CatalogSku[],
  licenses: OwnedLicense[],
  addons: AddonState[],
): (sku: string) => string {
  const names = new Map<string, string>();
  for (const source of [addons, licenses, skus]) {
    for (const item of source) {
      const key = 'sku' in item ? item.sku : '';
      if (key !== '' && item.name !== '') names.set(key, item.name);
    }
  }

  return (sku) => names.get(sku) ?? sku;
}

/**
 * Display order: what is on this site, then what is owned, then what is for sale, then the rest.
 *
 * Ordering by possession rather than by price is what keeps the page from reading as an advert — a
 * merchant opening it sees their own install first and the roadmap last. The server's own `sort`
 * survives inside each band, because the sort is stable.
 */
export function rank(row: CatalogRow): number {
  if (row.installed) return 0;
  if (row.entitled || null !== row.includedIn) return 1;

  return row.sku.availability === 'available' ? 2 : 3;
}

/**
 * Whether the "Your licenses" section has anything to say that the rest of the page does not.
 *
 * The page reads on three axes — this site, this account, the product estate — which pays for
 * itself the moment an estate is more than one thing. For the merchant who registered once and
 * bought nothing it does not: the free base licence is already announced as this install's seat in
 * the "This site" panel, and again in the catalogue as Essentials/active. A third card carrying no
 * key worth reading, no renewal date and no action is repetition dressed as structure.
 *
 * So it hides in exactly that case. Each of the conditions below brings it back, because each is a
 * fact that lives nowhere else on the page.
 *
 * @param currentActivationId this install's activation, or null when unknown — in which case a
 *                            seat cannot be shown to be elsewhere, and the section stays hidden
 *                            rather than appearing on a maybe.
 */
export function shouldShowOwnedLicenses(
  licenses: OwnedLicense[],
  currentActivationId: string | null,
): boolean {
  if (licenses.length !== 1) return licenses.length > 0;

  const only = licenses[0];
  // Bought, and its own thing.
  if (only.kind === 'addon') return true;
  // Money and dates — nothing else on the page carries them.
  if (only.cancellable || only.paid_through !== null || only.grace_until !== null) return true;

  // A seat that is not the one this install is using — another site, or this one under a different
  // activation (which happens the moment a site activates a key belonging to another account, and
  // is worth surfacing either way: the account holds a seat its own install is not on).
  //
  // Compared on activation id, the identity the whole panel is keyed on — never on the site URL,
  // which neither side canonicalises.
  //
  // With no id there is nothing to compare against, so every seat would read as "elsewhere" and the
  // section would appear on every install whose site read had not landed yet, then vanish. Not
  // knowing is not evidence.
  if (currentActivationId === null) return false;

  return only.seats.some((seat) => seat.activation_id !== currentActivationId);
}

/**
 * What the account read concluded, once it has concluded anything: linked, never linked, waiting on
 * an emailed confirmation, the service is down, or something else went wrong. Five cases, because
 * the page answers each of them differently — an unlinked site gets an invitation, not an error.
 *
 * `awaiting_confirmation` is *not* a flavour of `not_linked`, however alike they look from here.
 * Both mean "no account token", but one site has never registered and the other is one click from
 * done — and showing the second one a registration form sends it round a loop whose every lap mails
 * another confirmation link.
 */
export type AccountOutcome =
  'ok' | 'not_linked' | 'awaiting_confirmation' | 'withdrawn' | 'unreachable' | 'failed';

export function classify(error: unknown): AccountOutcome {
  if (!error) return 'ok';
  if (error instanceof ApiError) {
    if (error.code === 'not_activated') return 'not_linked';
    if (error.code === 'verification_required') return 'awaiting_confirmation';
    // Also account-less, and deliberately not folded into `not_linked`: this merchant answered the
    // invitation by leaving, and putting it straight back in front of them is the nag they left to
    // avoid. The way back stays one click away; it just stops being the page's opening line.
    if (error.code === 'withdrawn') return 'withdrawn';
    if (error.unreachable) return 'unreachable';
  }

  return 'failed';
}

/**
 * The address a confirmation link was sent to, when the failure is that one — otherwise null.
 *
 * Worth surfacing rather than saying "check your email": the address can only be one that already
 * had an account, so a mistyped one reached a stranger, and the merchant would otherwise be waiting
 * on a mail that was never going to arrive.
 */
export function pendingEmail(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const body: unknown = error.body;
  if (body === null || typeof body !== 'object' || !('pending_email' in body)) return null;
  const email = (body as { pending_email: unknown }).pending_email;

  return typeof email === 'string' && email !== '' ? email : null;
}

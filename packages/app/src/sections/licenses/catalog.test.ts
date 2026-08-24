import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { classify, mergeCatalog, pendingEmail, PLATFORM_SKU, shouldShowOwnedLicenses } from './catalog';
import type { AddonState, CatalogSku, OwnedLicense } from './types';

const sku = (over: Partial<CatalogSku> & { sku: string }): CatalogSku => ({
  name: over.sku,
  tagline: null,
  features: null,
  side: 'pro-addon',
  requires: [],
  subsumed_by: [],
  availability: 'coming_soon',
  cadence: 'monthly',
  founder: false,
  cta_label: null,
  price_minor: null,
  currency: 'USD',
  price_label: 'Contact us',
  slug: null,
  version: null,
  min_platform_version: null,
  ...over,
});

const license = (skuKey: string): OwnedLicense => ({
  id: `lic-${skuKey}`,
  key: `IFX-${skuKey}-••••4F2A`,
  kind: skuKey === PLATFORM_SKU ? 'base' : 'addon',
  addon_key: skuKey === PLATFORM_SKU ? null : skuKey,
  quantity: null,
  sku: skuKey,
  name: skuKey,
  state: 'active',
  cadence: null,
  is_founder: false,
  paid_through: null,
  grace_until: null,
  cancellable: false,
  seats: [],
});

const addon = (over: Partial<AddonState> & { sku: string; slug: string }): AddonState => ({
  name: over.slug,
  license_state: 'active',
  installed: false,
  active: false,
  installed_version: null,
  state: 'not_installed',
  actions: [],
  ...over,
});

describe('mergeCatalog', () => {
  it('joins on the SKU, not the slug — `pro` is delivered here as `woo-pro`', () => {
    const rows = mergeCatalog(
      [sku({ sku: 'pro' })],
      [license('pro')],
      [
        addon({
          sku: 'pro',
          slug: 'woo-pro',
          installed: true,
          active: true,
          state: 'active',
          installed_version: '0.4.0',
        }),
      ],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].addon?.slug).toBe('woo-pro');
    expect(rows[0].installed).toBe(true);
    expect(rows[0].entitled).toBe(true);
  });

  it('treats the platform as installed and owned even before the site is registered', () => {
    // No account, so no licences at all — but the plugin drawing the page is undeniably here.
    const [row] = mergeCatalog([sku({ sku: PLATFORM_SKU, availability: 'available' })], [], []);

    expect(row.platform).toBe(true);
    expect(row.installed).toBe(true);
    expect(row.entitled).toBe(true);
    expect(row.includedIn).toBeNull();
  });

  it('names the plan a `subsumed_by` edge is included in, rather than saying "your plan"', () => {
    const [row] = mergeCatalog(
      [sku({ sku: 'bridge-pdj', subsumed_by: ['pro'] }), sku({ sku: 'pro', name: 'InvFlux Pro' })],
      [license('pro')],
      [],
    );

    expect(row.includedIn).toBe('InvFlux Pro');
    // Included is not entitled: no licence names this SKU, so nothing here declares an action for
    // it. The distinction is what keeps the card from offering a button that could only 402.
    expect(row.entitled).toBe(false);
  });

  it('falls back to the SKU key when nothing in the payload knows a name for it', () => {
    const [row] = mergeCatalog([sku({ sku: 'bridge-pdj', subsumed_by: ['pro'] })], [license('pro')], []);

    expect(row.includedIn).toBe('pro');
  });

  it('does not call a SKU included when the subsuming licence is absent', () => {
    const [row] = mergeCatalog(
      [sku({ sku: 'bridge-pdj', subsumed_by: ['pro'] })],
      [license(PLATFORM_SKU)],
      [],
    );

    expect(row.includedIn).toBeNull();
  });

  it('keeps an entitled plugin the catalogue never mentioned', () => {
    // Production withholds unannounced SKUs, so an entitlement can outrun the public document —
    // and a plugin sitting on this site must not vanish from the page because of that.
    const rows = mergeCatalog(
      [sku({ sku: PLATFORM_SKU, availability: 'available' })],
      [license('addon-jit')],
      [
        addon({
          sku: 'addon-jit',
          slug: 'addon-jit',
          name: 'JIT / Flash-Sale',
          installed: true,
          state: 'installed_inactive',
        }),
      ],
    );

    const jit = rows.find((r) => r.sku.sku === 'addon-jit');
    expect(jit?.entitled).toBe(true);
    expect(jit?.installed).toBe(true);
    expect(jit?.sku.name).toBe('JIT / Flash-Sale');
    // Nothing is invented on its behalf: no price, and no availability to render a CTA from.
    expect(jit?.sku.price_label).toBe('');
    expect(jit?.sku.availability).toBe('');
  });

  it('orders installed, then owned, then buyable, then the rest — server order surviving within each', () => {
    const rows = mergeCatalog(
      [
        sku({ sku: 'addon-jit' }), // coming soon, unowned
        sku({ sku: 'channel-sync' }), // coming soon, unowned — after addon-jit, as served
        sku({ sku: 'addon-costing', availability: 'available' }), // buyable
        sku({ sku: 'addon-supplier-hub' }), // owned, not installed
        sku({ sku: 'pro' }), // installed
      ],
      [license('pro'), license('addon-supplier-hub')],
      [
        addon({
          sku: 'pro',
          slug: 'woo-pro',
          installed: true,
          active: true,
          state: 'active',
        }),
        addon({ sku: 'addon-supplier-hub', slug: 'addon-supplier-hub' }),
      ],
    );

    expect(rows.map((r) => r.sku.sku)).toEqual([
      'pro',
      'addon-supplier-hub',
      'addon-costing',
      'addon-jit',
      'channel-sync',
    ]);
  });

  it('hides a retired SKU from everyone except its holders', () => {
    const skus = [sku({ sku: 'addon-legacy', availability: 'retired' })];

    expect(mergeCatalog(skus, [], [])).toHaveLength(0);
    expect(mergeCatalog(skus, [license('addon-legacy')], [])).toHaveLength(1);
  });

  it('leaves the query payload untouched', () => {
    const skus = [sku({ sku: 'b' }), sku({ sku: 'a', availability: 'available' })];
    mergeCatalog(skus, [], []);

    // The sort is on a derived array: re-ordering the cached response in place would make the
    // next render depend on the last one.
    expect(skus.map((s) => s.sku)).toEqual(['b', 'a']);
  });
});

describe('classify', () => {
  it('separates the four failures the page can answer', () => {
    expect(classify(null)).toBe('ok');
    expect(classify(new ApiError(409, { error: 'not_activated' }))).toBe('not_linked');
    expect(classify(new ApiError(502, { error: 'service_unavailable' }))).toBe('unreachable');
    expect(classify(new ApiError(500, { error: 'boom' }))).toBe('failed');
    expect(classify(new TypeError('network'))).toBe('failed');
  });

  it('keeps a site awaiting confirmation apart from one that never registered', () => {
    // Both are 409s meaning "no account token", and conflating them shows an already-registered
    // site the registration form — whose only effect is to mail a second confirmation link.
    expect(classify(new ApiError(409, { error: 'verification_required' }))).toBe('awaiting_confirmation');
  });

  it('keeps a site that withdrew apart from one that never registered', () => {
    // The third 409 with no account token. Conflating this one puts the registration invitation
    // back in front of the merchant who deliberately dismissed it — the nag they un-registered to
    // stop, re-offered on every visit.
    expect(classify(new ApiError(409, { error: 'withdrawn' }))).toBe('withdrawn');
  });
});

describe('pendingEmail', () => {
  it('reads the address the confirmation went to', () => {
    const err = new ApiError(409, { error: 'verification_required', pending_email: 'owner@example.com' });

    expect(pendingEmail(err)).toBe('owner@example.com');
  });

  it('is null for anything that does not carry one', () => {
    expect(pendingEmail(new ApiError(409, { error: 'not_activated' }))).toBeNull();
    expect(pendingEmail(new ApiError(409, { error: 'verification_required', pending_email: '' }))).toBeNull();
    expect(pendingEmail(new ApiError(409, { error: 'verification_required', pending_email: 42 }))).toBeNull();
    expect(pendingEmail(new TypeError('network'))).toBeNull();
    expect(pendingEmail(null)).toBeNull();
  });
});

describe('shouldShowOwnedLicenses', () => {
  const HERE = 'act-here';
  const base = (over: Partial<OwnedLicense> = {}): OwnedLicense => ({
    id: 'lic-1',
    key: 'IFX-ESSENTIALS-••••ASUK',
    kind: 'base',
    addon_key: null,
    quantity: null,
    sku: 'essentials',
    name: 'InvFlux Essentials',
    state: 'active',
    cadence: 'free',
    is_founder: false,
    paid_through: null,
    grace_until: null,
    cancellable: false,
    seats: [{ activation_id: HERE, site_url: 'https://shop.test', env_class: null, last_seen_at: null }],
    ...over,
  });

  it('hides a lone free base deployed only here', () => {
    // The degenerate case the suppression exists for: the panel above already names this seat and
    // the catalogue already reports Essentials active, so a third card restates both.
    expect(shouldShowOwnedLicenses([base()], HERE)).toBe(false);
  });

  it('hides nothing when there is nothing', () => {
    expect(shouldShowOwnedLicenses([], HERE)).toBe(false);
  });

  it('shows as soon as there is more than one licence', () => {
    expect(shouldShowOwnedLicenses([base(), base({ id: 'lic-2' })], HERE)).toBe(true);
  });

  it('shows an add-on, which is bought and its own thing', () => {
    expect(shouldShowOwnedLicenses([base({ kind: 'addon', addon_key: 'pro', sku: 'pro' })], HERE)).toBe(true);
  });

  it.each([
    ['a subscription to cancel', { cancellable: true }],
    ['a renewal date', { paid_through: '2027-01-01T00:00:00Z' }],
    ['a grace date', { grace_until: '2027-01-01T00:00:00Z' }],
  ])('shows a licence carrying %s', (_label, over) => {
    // Money and dates live nowhere else on the page, so hiding them would lose them.
    expect(shouldShowOwnedLicenses([base(over)], HERE)).toBe(true);
  });

  it('shows a licence deployed on another site too', () => {
    // "Where else is this running" is the section's whole reason to exist.
    expect(
      shouldShowOwnedLicenses(
        [base({ seats: [
          { activation_id: HERE, site_url: 'https://shop.test', env_class: null, last_seen_at: null },
          { activation_id: 'act-other', site_url: 'https://other.test', env_class: null, last_seen_at: null },
        ] })],
        HERE,
      ),
    ).toBe(true);
  });

  it('stays hidden when this install is unknown, rather than appearing on a maybe', () => {
    // A null activation cannot prove a seat is elsewhere. Guessing "elsewhere" would flash the
    // section on every install whose site read has not landed yet.
    expect(shouldShowOwnedLicenses([base()], null)).toBe(false);
  });
});

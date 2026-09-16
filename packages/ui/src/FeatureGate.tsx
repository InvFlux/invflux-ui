import { Component, createResource, JSX, Show } from 'solid-js';
import { __ } from '@invflux/i18n';
import { useHostNav } from './hostNav';

/**
 * Tier-generic UI gating component for SolidJS surfaces.
 *
 * Mirrors the PHP-side `Nandan108\InvFlux\Woo\License\FeatureGate::wrap()` helper.
 *
 * The actual gating decision is made by the PHP `LicenseGate::allows()` via the
 * `/invflux/v1/license/feature-allowed` REST endpoint. The `upgradeTo` prop is
 * purely display-level (it picks the tooltip + CTA copy when access is denied).
 *
 * ## Caching
 *
 * Each FeatureGate instance hits the REST endpoint individually at v0. A shared
 * cache + batched fetch is a follow-up — small concern today (LPSC is the only
 * planned consumer in v1.0 and is still PHP-side), more important when multiple
 * gates render on a single SPA surface.
 */
export interface FeatureGateProps {
  /** Kebab-case namespaced feature key (e.g. "lpsc.hold-for-merchant-review"). */
  feature: string;

  /**
   * Upgrade target shown in tooltip + CTA when denied. Default (and only) 'pro':
   * capabilities beyond the paid tier are orthogonal add-ons, each licensed on its
   * own, so "upgrade to X" is not how a merchant reaches one. An add-on's upsell
   * belongs on the catalogue surface, which knows its name and price.
   */
  upgradeTo?: 'pro';

  /** Custom tooltip override; default copy used if omitted. */
  tooltip?: string;

  /** REST context for the fetch. */
  apiRoot: string;
  nonce: string;

  children: JSX.Element;
}

// Translatable copy resolved lazily so the i18n adapter has time to bind to the
// WordPress runtime by the time gates render. Using function form (rather than
// const-at-module-load) avoids capturing the source-English string before
// `wp.i18n` has had a chance to inject the catalog.
/**
 * Where an upgrade prompt sends the merchant: the Licenses & Add-ons screen, an app route — the one
 * place that knows which licence is active and how to buy or activate another.
 */
export const UPGRADE_ROUTE = '/licenses';

function tooltipDefault(): string {
  return __('Available in Pro — upgrade to use this feature.');
}

function ctaLabel(): string {
  return __('Upgrade to Pro');
}

async function checkAllowed(apiRoot: string, nonce: string, featureKey: string): Promise<boolean> {
  const url = new URL(`${apiRoot.replace(/\/$/, '')}/invflux/v1/license/feature-allowed`);
  url.searchParams.set('keys', featureKey);
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'X-WP-Nonce': nonce },
    credentials: 'same-origin',
  });
  if (!res.ok) {
    // Fail closed on error — same semantics as the PHP LicenseGate contract.
    // A network blip rendering a Pro feature as available would be a worse
    // failure mode than rendering it as denied.
    return false;
  }
  const data = (await res.json()) as { allowed: Record<string, boolean> };
  return data.allowed[featureKey] ?? false;
}

export const FeatureGate: Component<FeatureGateProps> = (props) => {
  const hostNav = useHostNav();
  const upgradeTo = (): 'pro' => props.upgradeTo ?? 'pro';

  const [allowed] = createResource(
    () => [props.apiRoot, props.nonce, props.feature] as const,
    ([apiRoot, nonce, feature]) => checkAllowed(apiRoot, nonce, feature),
  );

  return (
    <Show
      // `=== true`, never `!== false`: a resource reads `undefined` until it settles, so the loose
      // form treats "still loading" as allowed and renders the gated feature to everyone for the
      // length of the round-trip before snapping it away. Deny until the answer actually says yes.
      when={true === allowed()}
      fallback={
        <div
          class="invflux-feature-gate invflux-feature-gate--denied"
          data-upgrade-to={upgradeTo()}
          data-feature-key={props.feature}
          aria-disabled="true"
          title={props.tooltip ?? tooltipDefault()}
        >
          <div class="invflux-feature-gate__content">{props.children}</div>
          <a
            class="invflux-feature-gate__upgrade"
            href={hostNav.routeHref(UPGRADE_ROUTE)}
            rel="noopener"
          >
            {ctaLabel()}
          </a>
        </div>
      }
    >
      {props.children}
    </Show>
  );
};

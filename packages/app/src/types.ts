/**
 * Bootstrap context injected by UnifiedAppPage.php as `window.invfluxApp`. Deliberately lean —
 * per-route data loads lazily via REST (TanStack Query), not as one giant inline blob.
 */
export interface AppContext {
  /** REST root, e.g. `https://site/index.php?rest_route=/`. */
  apiRoot: string;
  /** `wp_rest` nonce for authenticated REST calls. */
  nonce: string;
  /**
   * WordPress's resolved locale as a BCP-47 tag (`fr-FR`), for every date and number the SPA
   * formats. Absent on an older bootstrap — fall back to the browser's locale then, never instead.
   *
   * It follows `determine_locale()`, the same resolution behind this app's translated strings, so a
   * per-user language choice moves the labels and the dates together.
   */
  locale?: string;
  /**
   * Current WP user. `email` is the reader's own address, used to prefill the registration field —
   * a default, never a decision: nothing is sent until they press the button, and the field stays
   * editable for whoever is registering on someone else's behalf.
   */
  currentUser: { id: number; name: string; email?: string };
  /** Capability map (client route-guard hints; REST permission_callbacks are the real gate). */
  capabilities: Record<string, boolean>;
  /** Feature-entitlement map (tier/licence-derived, e.g. `exportStructured`). */
  entitlements?: Record<string, boolean>;
  /**
   * Per-install surface placement mode (surface id → `always` | `on_demand` | `disabled`), for the
   * three operational surfaces (workbench / procurement / dispatch). `always` = permanent tab,
   * `on_demand` = launcher + closeable tab (like Settings), `disabled` = hidden. Absent/omitted id →
   * treated as `always` (add-on surfaces stay permanent).
   */
  surfaceModes?: Record<string, string>;
  /**
   * First-run state: the slugs of the family plugins whose welcome screen is still outstanding, in
   * the order to offer them. Only the slugs ride the bootstrap — a landing visit is diverted to the
   * first of them (`/welcome-to-<slug>`), and that screen fetches whatever it needs over REST.
   */
  onboarding?: { pending: string[] };
  /** Whether the install holds the Pro SKU — display affordances only, never gating. */
  hasPro: boolean;
}

/**
 * Procurement's context — REST root + nonce, current user, resolved capability flags. This package
 * has no bundle of its own: the unified app renders it as a lazy section and passes this down from
 * the app's own boot context, so nothing reads a global here.
 */
/** WC reference data (localized) for address + currency pickers. */
export interface GeoData {
  /** ISO-2 code → country name. */
  countries: Record<string, string>;
  /** country code → (state code → state name); absent/empty for countries without a state list. */
  states: Record<string, Record<string, string>>;
  /** currency code → name (with symbol). */
  currencies: Record<string, string>;
  /** Store base country (ISO-2) — default for a new supplier's address. */
  baseCountry: string;
  /** Store base currency code — default for a new supplier / PO. */
  baseCurrency: string;
}

export interface ProcurementContext {
  apiRoot: string;
  nonce: string;
  currentUser: { id: number; name: string };
  capabilities: {
    viewStock: boolean;
    managePurchaseOrders: boolean;
    /** May close a reception short without reviewing every line (governance cap; default off). */
    closeShortLax: boolean;
    /**
     * May finish an order on less than was ordered (governance cap, asked exactly). Mirrors the
     * server's check so the order page shows the action disabled rather than offering a 403.
     */
    closeShort: boolean;
    /**
     * May say what goods cost — the capability the invoice-recording route checks at the point of
     * effect. Authority over an order and authority over money are routinely held by different
     * people, so this is asked separately from {@link managePurchaseOrders} rather than implied by it.
     */
    stateCost: boolean;
  };
  /**
   * Whether the install holds the Pro SKU — drives which affordances the UI offers.
   *
   * Presentation only. What a merchant may *do* is decided server-side per feature
   * key, because a grandfathered install can be entitled to something whose SKU it
   * does not hold.
   */
  hasPro: boolean;
  geo: GeoData;
  /**
   * Languages a purchase order can be written in **on this site** — locale → its endonym (the
   * language's own name for itself). Install-dependent, not a fixed list: it is what we ship
   * purchase-order wording for, intersected with the WordPress language packs installed here,
   * because WordPress cannot switch into a locale whose pack is missing.
   */
  documentLocales: Record<string, string>;
  /**
   * Languages we carry purchase-order wording for that WordPress has no translation for here, so
   * the merchant could unlock them. **Empty unless this user could actually do it** — the server
   * sends nothing when `install_languages` is absent or the host forbids file modifications, so an
   * empty map is the honest "not offered" rather than "nothing to add".
   */
  installableLocales: Record<string, string>;
}

// `nav.section` contributions take no props — they read the boot context via `useProcurement()`
// and route via `@solidjs/router`. (arch-ui-principles §3.1/§3.4.)

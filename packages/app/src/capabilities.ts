/**
 * The current user's capabilities, seeded once from the app context at boot (before mount) so the
 * nav.section `enabled` predicates can gate on permission. Static for the page's lifetime (caps come
 * from PHP per request), so a plain store is enough — no reactivity needed.
 *
 * This is the SPA half of the permission gate: the WP admin menu already caps each surface
 * (AdminMenuCatalog), but the in-app tab strip would otherwise show every registered surface
 * regardless of permission. A surface (core or add-on) declares the capability it needs via its
 * section's `enabled: () => hasCapability(<cap>)`.
 */
let capabilities: Record<string, boolean> = {};

export function setCapabilities(caps: Record<string, boolean>): void {
  capabilities = caps;
}

/** Whether the current user holds `name` (camelCase key from the app context, e.g. "viewStock"). */
export function hasCapability(name: string): boolean {
  return capabilities[name] ?? false;
}

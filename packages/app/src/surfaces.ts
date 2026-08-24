/**
 * Per-install surface **placement mode**, seeded once from the app context at boot (before mount).
 * The companion to {@link ./capabilities.ts}: capabilities answer "may this user see the surface?",
 * mode answers "how has this install placed the surface?".
 *
 *  - `always`    — a permanent centre tab (the default; add-on surfaces and any id absent from the
 *                  map fall here).
 *  - `on_demand` — not a permanent tab; listed in the launcher and opened as a closeable tab (like
 *                  Settings).
 *  - `disabled`  — hidden everywhere.
 *
 * A surface is *available* iff `hasCapability(cap) && surfaceEnabled(id)` (mode ≠ disabled); the mode
 * then decides where an available surface is placed. Install-wide, not per-user (that granularity is
 * the future Pro roles/capability surface). Static for the page's lifetime (comes from PHP per
 * request), so a plain map is enough — a mode change takes effect on the next page load.
 */
export type SurfaceMode = 'always' | 'on_demand' | 'disabled';

let surfaceModes: Record<string, string> = {};

export function setSurfaceModes(map: Record<string, string> | undefined): void {
  surfaceModes = map ?? {};
}

/** The placement mode of surface `id` (default `always` for any id not in the map). */
export function surfaceMode(id: string): SurfaceMode {
  const m = surfaceModes[id];
  return 'on_demand' === m || 'disabled' === m ? m : 'always';
}

/** Whether surface `id` is available at all (any mode other than `disabled`). */
export function surfaceEnabled(id: string): boolean {
  return 'disabled' !== surfaceMode(id);
}

/** Whether surface `id` is launcher-opened (on demand) rather than a permanent tab. */
export function surfaceOnDemand(id: string): boolean {
  return 'on_demand' === surfaceMode(id);
}

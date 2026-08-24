/**
 * Where the Workbench keeps its filter state in the address bar.
 *
 * Standalone, that's the page's real query string (`?page=invflux&search=…`). Embedded in the
 * unified app it CANNOT be: the real query string belongs to WordPress (`?page=invflux-app`
 * identifies the admin page) and is shared by every surface, so per-surface filters must live inside
 * the hash instead (`#/workbench?search=…`). Injecting the port keeps that decision with the host and
 * leaves the grid's own logic identical in both.
 */
export interface UrlParamsPort {
  /**
   * The params the grid should treat as its own. Standalone this includes host-owned keys (`page`),
   * which the grid preserves — it only deletes/sets the filter keys it manages.
   */
  read(): URLSearchParams;
  /** Persist params WITHOUT adding a history entry (filter changes are not navigations). */
  replace(params: URLSearchParams): void;
  /**
   * Optional reactive view of the params, for hosts where they can change from the OUTSIDE while the
   * grid stays mounted — e.g. a cross-surface deep-link into an already-open Workbench tab. Reading
   * it inside an effect re-runs on change. Absent (standalone) means "URL only changes via us";
   * `undefined` means "not addressable right now" (e.g. the surface isn't the active one).
   */
  watch?(): string | undefined;
}

/**
 * Default port: the browser's real query string, rewritten in place. Preserves any non-filter params
 * (notably WordPress's `page`) because the caller hands back the same param set it read.
 */
export const windowUrlPort: UrlParamsPort = {
  read: () => new URLSearchParams(window.location.search),
  replace: (params) => {
    const current = new URL(window.location.href);
    current.search = params.toString();
    history.replaceState(null, '', current.toString());
  },
};

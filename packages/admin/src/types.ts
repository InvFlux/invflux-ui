/**
 * Settings context. This package has no bundle of its own: the unified app imports its `App` as a
 * lazy section and passes this down from the app's own boot context, so nothing reads a global here.
 */
export interface AdminContext {
  /** REST root — either `…/index.php?rest_route=/` or `…/wp-json`. */
  apiRoot: string;
  nonce: string;
  capabilities: {
    manageSettings: boolean;
  };
  /**
   * Open with the "needs a decision" filter already applied — set by the host when the page was
   * reached from a link that promised exactly those settings (the first-run screen's count).
   *
   * The host owns this because the host owns the URL: this package has no router, and teaching it
   * to read query params would couple it to a scheme it does not otherwise know about.
   */
  startOnDecisions?: boolean;
}

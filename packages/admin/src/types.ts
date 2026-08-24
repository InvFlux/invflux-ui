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
}

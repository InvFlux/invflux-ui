import { createInvFluxViteConfig } from '@invflux/build';

/**
 * Unified admin SPA — the one **ESM** surface (every other package is an IIFE `lib` build).
 *
 * The whole point of this package is client-side lazy routes, and IIFE/UMD cannot code-split, so it
 * builds as a Vite backend integration: a manifest PHP reads for the hashed entry, and one chunk per
 * `import()`. See @invflux/build for the shape itself.
 *
 * `@wordpress/i18n` is aliased to a local shim (src/wp-i18n-shim.ts) rather than externalised the way
 * the IIFE builds do it: an ESM `external` would leave a bare specifier the browser cannot resolve.
 * The shim reads `window.wp.i18n` at call time, so `wp_set_script_translations` still applies.
 */
export default createInvFluxViteConfig({
  surface: 'app',
  format: 'esm',
  configUrl: import.meta.url,
  alias: { '@wordpress/i18n': new URL('./src/wp-i18n-shim.ts', import.meta.url).pathname },
});

/**
 * `@wordpress/i18n` shim for the ESM app build.
 *
 * The IIFE SPAs externalize `@wordpress/i18n` to the `wp.i18n` global. An ESM `external` would
 * leave a bare `import … from '@wordpress/i18n'` the browser can't resolve, so this package
 * aliases `@wordpress/i18n` to this file (see vite.config.ts). Each function reads
 * `window.wp.i18n` **at call time** — so WordPress's `wp_set_script_translations()` (which loads
 * locale data into that same global at request time) still governs the strings. `wp-i18n` must be
 * present on the page (UnifiedAppPage enqueues it), which it is: classic scripts run before
 * deferred module scripts.
 *
 * Falls back to identity/format behaviour if `wp.i18n` is somehow absent (e.g. Storybook), so the
 * UI never throws on a translation call.
 */
type WpI18n = {
  __(text: string, domain?: string): string;
  _x(text: string, context: string, domain?: string): string;
  _n(single: string, plural: string, n: number, domain?: string): string;
  _nx(single: string, plural: string, n: number, context: string, domain?: string): string;
  sprintf(format: string, ...args: (string | number)[]): string;
  isRTL(): boolean;
  setLocaleData(data: Record<string, unknown>, domain?: string): void;
};

const wp = (): WpI18n | undefined => (globalThis as { wp?: { i18n?: WpI18n } }).wp?.i18n;

// Minimal sprintf fallback covering %s / %d used across the SPAs.
const fallbackSprintf = (format: string, ...args: (string | number)[]): string => {
  let i = 0;
  return format.replace(/%[sd]/g, () => String(args[i++] ?? ''));
};

export const __ = (text: string, domain?: string): string => wp()?.__(text, domain) ?? text;

export const _x = (text: string, context: string, domain?: string): string =>
  wp()?._x(text, context, domain) ?? text;

export const _n = (single: string, plural: string, n: number, domain?: string): string =>
  wp()?._n(single, plural, n, domain) ?? (n === 1 ? single : plural);

export const _nx = (
  single: string,
  plural: string,
  n: number,
  context: string,
  domain?: string,
): string => wp()?._nx(single, plural, n, context, domain) ?? (n === 1 ? single : plural);

export const sprintf = (format: string, ...args: (string | number)[]): string =>
  wp()?.sprintf(format, ...args) ?? fallbackSprintf(format, ...args);

// Unused, and kept on purpose: this file's job is to mirror the `wp.i18n` global's surface so the
// ESM build can resolve `@wordpress/i18n`. A shim that omits the members nobody happens to call yet
// is a *partial* shim — a trap for whoever next reaches for a function the real API has. Fidelity
// to the mirrored interface, not a claim that anything uses this.
export const isRTL = (): boolean => wp()?.isRTL() ?? false;

export const setLocaleData = (data: Record<string, unknown>, domain?: string): void =>
  wp()?.setLocaleData(data, domain);

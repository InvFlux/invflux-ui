/**
 * `@invflux/i18n` — InvFlux's translation adapter for the SolidJS SPAs.
 *
 * A thin wrapper over `@wordpress/i18n` that **owns the text domain**, so call sites never name it.
 * The indirection is intentional and load-bearing:
 *
 * 1. **Future-proofs the SPAs against the i18n backend changing.** If we later
 *    swap to a different translator (e.g., for a non-WordPress headless deployment
 *    of the dispatch SPA, or to wire compile-time string elision), only this
 *    package changes — every consumer keeps `import { __ } from '@invflux/i18n'`
 *    untouched.
 *
 * 2. **Keeps WordPress coupling at the package boundary.** Consumer packages
 *    (`@invflux/workbench`, `@invflux/product-tab`, future Pro SPAs) never import
 *    from `@wordpress/i18n` directly. This matches the same "wrap WordPress at the
 *    edge" principle that the PHP-side InvFlux core uses.
 *
 * 3. **Makes `wp i18n make-pot` extraction work without configuration.** Because
 *    the function names are preserved verbatim (`__`, `_n`, `_x`, etc.), make-pot
 *    sees standard WP gettext calls in the source — no need for a custom extractor
 *    or a Vite alias. The "three extraction options" question
 *    (configure tool / compile-time alias / companion script) is sidestepped at v0
 *    by keeping the API surface identical.
 *
 * ## Usage
 *
 *     import { __, _n, sprintf } from '@invflux/i18n';
 *
 *     const label = __('Stock level');
 *     const status = sprintf(_n('%d unit available', '%d units available', count), count);
 *
 * **No domain argument.** The host sets it once at bootstrap via {@link setTextDomain}; the SPA
 * packages stay free of any platform's domain name (invflux-ui is a public, platform-neutral repo —
 * a WooCommerce domain baked into 1000+ call sites is exactly the coupling it must not carry).
 */

import {
  __ as wpTranslate,
  _n as wpTranslatePlural,
  _nx as wpTranslatePluralWithContext,
  _x as wpTranslateWithContext,
} from '@wordpress/i18n';

/**
 * The text domain every call below resolves against. `default` until the host binds one, which is
 * also the sane fallback: an unbound host still renders readable (untranslated) English.
 */
let textDomain = 'default';

/**
 * Bind the host's text domain. Called once, at bootstrap, by the host entry point — for the
 * WordPress plugin that is the domain its `wp_set_script_translations()` registered.
 *
 * **Ordering constraint.** ES modules evaluate imports before the importing module's body, so a
 * translated string built at MODULE SCOPE (`const LABEL = __('…')` at the top level of an imported
 * file) resolves before this binding runs, and is stuck untranslated for the page's lifetime. Build
 * label-bearing structures inside a function/component instead — the same lazy-labels discipline the
 * PHP side follows for WordPress 6.7's just-in-time-textdomain notice. Audited clean at the time of
 * the domain extraction; keep it that way.
 */
export function setTextDomain(domain: string): void {
  textDomain = domain;
}

/**
 * The wrappers preserve `@wordpress/i18n`'s **literal-string generics**. That is load-bearing, not
 * cosmetic: `sprintf` infers its argument arity from the format string's literal type, so widening a
 * return to plain `string` silently turns every sprintf over a translated format string into a type error.
 */

/** Translate. */
export const __ = <Text extends string>(text: Text): ReturnType<typeof wpTranslate<Text>> =>
  wpTranslate(text, textDomain);

/** Translate with a disambiguating context (same English word, different meanings). */
export const _x = <Text extends string>(text: Text, context: string): ReturnType<typeof wpTranslateWithContext<Text>> =>
  wpTranslateWithContext(text, context, textDomain);

/** Translate with plural forms. */
export const _n = <Single extends string, Plural extends string>(
  single: Single,
  plural: Plural,
  number: number,
): ReturnType<typeof wpTranslatePlural<Single, Plural>> => wpTranslatePlural(single, plural, number, textDomain);

/** Translate with plural forms and a disambiguating context. */
export const _nx = <Single extends string, Plural extends string>(
  single: Single,
  plural: Plural,
  number: number,
  context: string,
): ReturnType<typeof wpTranslatePluralWithContext<Single, Plural>> =>
  wpTranslatePluralWithContext(single, plural, number, context, textDomain);

// Domain-free helpers pass straight through.
/**
 * The locale every date and number below is formatted through — `undefined` until the host binds
 * one, which falls back to the browser's own locale.
 *
 * That fallback is the bug this exists to fix, not an acceptable default: WordPress resolves a site
 * (and per-user) language that has nothing to do with the browser's, so an unbound SPA renders
 * translated French labels beside US-ordered dates. `8/19` versus `19/8` is not a cosmetic
 * disagreement — it is two different days for half the year.
 */
let locale: string | undefined;

/**
 * Bind the host's locale as a BCP-47 tag (`fr-FR`). Called once at bootstrap, beside
 * {@link setTextDomain} and from the same resolution (`determine_locale()` on the WordPress side),
 * so a per-user language choice moves the strings and the dates together rather than one of them.
 */
export function setLocale(tag: string | undefined): void {
  locale = tag !== undefined && tag !== '' ? tag : undefined;
}

/** The bound locale, or `undefined` for the platform default. Pass straight to `Intl`. */
export function getLocale(): string | undefined {
  return locale;
}

/**
 * A date in the host's locale, short form. `null`/unparseable → the fallback, never `Invalid Date`.
 *
 * Prefer this to `toLocaleDateString()` at a call site: the point is that the locale comes from one
 * place, and a bare call silently reintroduces the browser's.
 */
export function formatDate(
  value: string | number | Date | null | undefined,
  fallback = '\u2014',
  opts?: Intl.DateTimeFormatOptions,
): string {
  const d = toDate(value);
  return d === null ? fallback : d.toLocaleDateString(locale, opts);
}

/** A date **and** time in the host's locale. Same contract as {@link formatDate}. */
export function formatDateTime(
  value: string | number | Date | null | undefined,
  fallback = '\u2014',
  opts?: Intl.DateTimeFormatOptions,
): string {
  const d = toDate(value);
  return d === null ? fallback : d.toLocaleString(locale, opts);
}

/** A number in the host's locale — grouping and decimal separator both follow it. */
export function formatNumber(value: number, opts?: Intl.NumberFormatOptions): string {
  return Number.isFinite(value) ? new Intl.NumberFormat(locale, opts).format(value) : '';
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export { isRTL, setLocaleData, sprintf } from '@wordpress/i18n';

export type { LocaleData } from '@wordpress/i18n';

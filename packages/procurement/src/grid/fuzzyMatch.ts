/**
 * Fuzzy subsequence matcher for the quick-filter. A needle matches
 * a field when its characters appear in order (not necessarily contiguous) — so "wgt" matches "Widget"
 * and a full scanned EAN is trivially a subsequence of itself. Normalization lower-cases and strips
 * whitespace; numeric needles also match with leading zeros stripped on both sides, so a scanned
 * barcode resolves regardless of zero-padding (the design's `replace(/^0+/, '')` rule).
 *
 * Eventual home is `@invflux/ui` once Dispatch converges onto the same scaffold; procurement-local for now.
 */

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, '');

/** True if every char of `needle` appears in `haystack`, in order. */
function isSubsequence(needle: string, haystack: string): boolean {
  if ('' === needle) return true;
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
}

const stripLeadingZeros = (s: string): string => s.replace(/^0+/, '');
const isNumeric = (s: string): boolean => '' !== s && /^[0-9]+$/.test(s);

/** Does the (already-normalized) needle fuzzy-match a single field value? */
function matchesField(needle: string, field: string): boolean {
  const f = norm(field);
  if (isSubsequence(needle, f)) return true;
  // Barcode tolerance: a numeric needle matches with leading zeros dropped on both sides.
  if (isNumeric(needle) && isNumeric(f)) {
    return isSubsequence(stripLeadingZeros(needle), stripLeadingZeros(f));
  }
  return false;
}

/**
 * True if the needle fuzzy-matches ANY of the row's match fields. An empty/whitespace needle matches
 * everything (no filter). Nullish fields are skipped. The caller supplies `fields` (tier-gated: e.g.
 * `[name, sku]` at Essentials, `+ gtin` at Pro).
 */
export function fuzzyMatches(needle: string, fields: Array<string | null | undefined>): boolean {
  const n = norm(needle);
  if ('' === n) return true;
  for (const field of fields) {
    if (null !== field && undefined !== field && '' !== field && matchesField(n, field)) {
      return true;
    }
  }
  return false;
}

// Scored fuzzy matching + highlighting (the quick-add picker) now lives in `@invflux/ui` (`fuzzyScore`
// / `HighlightMatch`) since it's reused by the shared SearchSelect `fuzzy` mode.

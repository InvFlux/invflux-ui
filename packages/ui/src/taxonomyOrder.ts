import { getLocale } from '@invflux/i18n';
import type { TaxonomySpaceTaxonomy, TaxonomySpaceValue } from './types';

/**
 * A taxonomy's term values in display order: alphabetical within each level, parents before their
 * children (depth-first).
 *
 * `taxonomy.values` arrives keyed by term id, and `Object.values` on an integer-keyed object
 * iterates in ascending numeric order — that is term-id (creation) order, not alphabetical — so a
 * picker built straight off it lists brands and categories by id. This re-derives the order a
 * picker wants, and covers a flat taxonomy (one alphabetical level) and a hierarchical one alike.
 *
 * A term whose parent is not in the set is treated as a root, and any term a broken parent chain
 * would strand is still appended (alphabetically) rather than dropped.
 */
export function orderTaxonomyValues(taxonomy: TaxonomySpaceTaxonomy): TaxonomySpaceValue[] {
  const all = Object.values(taxonomy.values);
  const byId = new Map<number, TaxonomySpaceValue>(all.map((v) => [v.id, v]));

  const childrenOf = new Map<number | null, TaxonomySpaceValue[]>();
  for (const v of all) {
    const parent = v.parentId !== null && byId.has(v.parentId) ? v.parentId : null;
    const bucket = childrenOf.get(parent);
    if (bucket) bucket.push(v);
    else childrenOf.set(parent, [v]);
  }

  // The host's locale, so names sort the way the store's language does (accents, ß, ç).
  const collator = new Intl.Collator(getLocale(), { sensitivity: 'base', numeric: true });
  for (const bucket of childrenOf.values()) bucket.sort((a, b) => collator.compare(a.name, b.name));

  const ordered: TaxonomySpaceValue[] = [];
  const seen = new Set<number>();
  const walk = (parent: number | null): void => {
    for (const v of childrenOf.get(parent) ?? []) {
      if (seen.has(v.id)) continue; // defensive against a malformed (cyclic) hierarchy
      seen.add(v.id);
      ordered.push(v);
      walk(v.id);
    }
  };
  walk(null);

  if (ordered.length < all.length) {
    for (const v of [...all].sort((a, b) => collator.compare(a.name, b.name))) {
      if (!seen.has(v.id)) {
        seen.add(v.id);
        ordered.push(v);
      }
    }
  }

  return ordered;
}

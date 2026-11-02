import type { RoadmapItem } from './types';

/** A heading tag this board renders. The section's own title is the page's only `h1`. */
export type ProductHeading = 'h2' | 'h3' | 'h4';

/**
 * The heading tag for a row that is a product, or null for a row that is a feature.
 *
 * A product is what carries a `sku`: Essentials, Pro, a bundle, an add-on. Its level comes from how
 * many products contain it, not from its depth in the tree, so a grouping row between two products
 * does not skip a level.
 */
export function productHeading(item: Pick<RoadmapItem, 'sku'>, productsAbove: number): ProductHeading | null {
  if (item.sku === null) return null;
  if (productsAbove === 0) return 'h2';
  return productsAbove === 1 ? 'h3' : 'h4';
}

import type { CatalogSku } from '../licenses/types';
import type { RoadmapItem } from './types';

/**
 * Is this node a bridge: a bundle the licensing service sells on its own to an Essentials install,
 * and that Pro also includes?
 *
 * The service names those products `bridge-…`, and it gives a bundle a `sku` only when it maps to a
 * product, so the prefix is the whole test. It is read from the data rather than hard-coded by slug,
 * so a bridge added to the roadmap tomorrow is flagged without a release.
 */
export function isBridge(item: Pick<RoadmapItem, 'sku'>): boolean {
  return item.sku?.startsWith('bridge-') ?? false;
}

/**
 * The SKUs a merchant can buy right now, read from the product catalog.
 *
 * Whether something is for sale is the licensing service's fact, not the roadmap's: a node can be
 * marked shipped before its product exists in the catalog, and a pill built on the node's status
 * would then offer something nobody can buy. An unread catalog sells nothing.
 */
export function skusOnSale(catalog: Pick<CatalogSku, 'sku' | 'availability'>[] | undefined): ReadonlySet<string> {
  return new Set((catalog ?? []).filter((sku) => sku.availability === 'available').map((sku) => sku.sku));
}

/**
 * Which buying routes to name on a bridge's pill — only those a merchant can actually take today.
 *
 * Pro includes every bridge, and a bridge is also sold on its own, but either route exists only while
 * the catalog offers it: a pill saying "also available on its own" over a product not on sale would be
 * an offer nobody can accept. Neither on sale: no pill.
 */
export function bridgeRoutes(
  item: Pick<RoadmapItem, 'sku'>,
  onSale: ReadonlySet<string>,
): 'both' | 'pro' | 'own' | null {
  if (!isBridge(item) || item.sku === null) return null;
  const pro = onSale.has('pro');
  const own = onSale.has(item.sku);
  if (pro && own) return 'both';
  if (pro) return 'pro';
  if (own) return 'own';
  return null;
}

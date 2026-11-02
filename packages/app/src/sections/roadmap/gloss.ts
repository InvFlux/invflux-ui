import type { RoadmapItem } from './types';

/**
 * Split a product heading into its name and the translation that follows it in brackets.
 *
 * A product name is never translated, so a localized heading reads "Cost Layers (Couches de coût)":
 * the name first, then a gloss for readers of that language, which the page shows muted. Only a node
 * that maps to a product (it has a `sku`) is split, so an ordinary title that happens to end in
 * brackets is left whole.
 */
export function splitGloss(item: Pick<RoadmapItem, 'sku' | 'title'>): { name: string; gloss: string | null } {
  const match = item.sku ? /^(.*\S)\s+\(([^()]+)\)$/.exec(item.title) : null;
  return match ? { name: match[1], gloss: match[2] } : { name: item.title, gloss: null };
}

import type { RoadmapItem } from './types';

/** Lower-case and strip accents, so "reception" finds "Réception". */
const fold = (text: string): string =>
  text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * The board narrowed to what matches a search term.
 *
 * A node stays when its own title or description contains the term, or when any node below it does:
 * a matching feature keeps the headings above it, so it is never shown without its context. Within
 * a kept heading only the matching branches remain. An empty term returns the board untouched.
 */
export function filterTree(items: RoadmapItem[], term: string): RoadmapItem[] {
  const needle = fold(term.trim());
  if ('' === needle) return items;

  const prune = (nodes: RoadmapItem[]): RoadmapItem[] =>
    nodes.flatMap((node) => {
      const children = prune(node.children);
      const own = fold(`${node.title} ${node.body ?? ''}`).includes(needle);
      return own || children.length > 0 ? [{ ...node, children }] : [];
    });

  return prune(items);
}

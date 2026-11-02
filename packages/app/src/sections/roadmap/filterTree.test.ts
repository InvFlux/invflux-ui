import { describe, expect, it } from 'vitest';
import { filterTree } from './filterTree';
import type { RoadmapItem } from './types';

const node = (slug: string, title: string, children: RoadmapItem[] = [], body: string | null = null): RoadmapItem => ({
  id: slug.length,
  slug,
  status: 'planned',
  sku: null,
  title,
  body,
  voted: false,
  children,
});

const board = [
  node('pro', 'Pro', [
    node('replenishment', 'Reorder suggestions', [], 'A reorder point from how fast it sells'),
    node('team-permissions', 'Decide who on your team can do what'),
  ]),
  node('essentials', 'Essentials', [node('receipts', 'Réception des marchandises')]),
];

const slugs = (items: RoadmapItem[]): string[] =>
  items.flatMap((item) => [item.slug, ...slugs(item.children)]);

describe('filterTree', () => {
  it('returns the board untouched for an empty or blank term', () => {
    expect(filterTree(board, '')).toBe(board);
    expect(filterTree(board, '   ')).toBe(board);
  });

  it('keeps a matching feature together with the headings above it, and drops its non-matching siblings', () => {
    expect(slugs(filterTree(board, 'team'))).toEqual(['pro', 'team-permissions']);
  });

  it('matches the description as well as the title', () => {
    expect(slugs(filterTree(board, 'how fast'))).toEqual(['pro', 'replenishment']);
  });

  it('keeps a matching heading even when none of its children match', () => {
    expect(slugs(filterTree(board, 'essentials'))).toEqual(['essentials']);
  });

  it('ignores case and accents', () => {
    expect(slugs(filterTree(board, 'RECEPTION'))).toEqual(['essentials', 'receipts']);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterTree(board, 'zzz')).toEqual([]);
  });
});

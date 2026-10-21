import type { SortingState } from '@tanstack/solid-table';

/**
 * A grid's sort as an ordered list of levels — the first deciding, each later one breaking the ties
 * left by those before it. The same shape TanStack Table keeps (`{ id, desc }[]`), so the grid's own
 * state, the host's URL and the request all carry one representation.
 */
export type SortLevels = SortingState;

/** The sort a grid starts with, and falls back to when every level is removed. */
export const DEFAULT_SORT: SortLevels = [{ id: 'name', desc: false }];

/**
 * The sort as the two request parameters the server reads: comma-separated lists paired by position
 * (`sort_by=total,name`, `sort_dir=desc,asc`). A single sort is the one-item case.
 */
export function sortToParams(levels: SortLevels): { sort_by: string; sort_dir: string } {
  const effective = levels.length > 0 ? levels : DEFAULT_SORT;

  return {
    sort_by: effective.map((level) => level.id).join(','),
    sort_dir: effective.map((level) => (level.desc ? 'desc' : 'asc')).join(','),
  };
}

/**
 * Read the two parameters back. A repeated column keeps its first level, a missing or unknown
 * direction is ascending, and nothing usable yields {@link DEFAULT_SORT}. Which columns are sortable
 * is the server's to decide; it drops any it does not accept.
 */
export function sortFromParams(sortBy: string | null, sortDir: string | null): SortLevels {
  if (sortBy === null || sortBy.trim() === '') return DEFAULT_SORT;
  const dirs = (sortDir ?? '').split(',').map((dir) => dir.trim().toLowerCase());
  const levels: SortLevels = [];
  const seen = new Set<string>();
  sortBy.split(',').forEach((raw, i) => {
    const id = raw.trim();
    if (id === '' || seen.has(id)) return;
    seen.add(id);
    levels.push({ id, desc: dirs[i] === 'desc' });
  });

  return levels.length > 0 ? levels : DEFAULT_SORT;
}

/** Whether the sort is the default one, which a URL leaves unwritten. */
export function isDefaultSort(levels: SortLevels): boolean {
  return (
    levels.length === 1 &&
    levels[0].id === DEFAULT_SORT[0].id &&
    levels[0].desc === DEFAULT_SORT[0].desc
  );
}

// ── Editing a list of levels (the column manager's Sort tab) ────────────────────────────────────
// Pure, so the rules are testable without a table: a column appears at most once, and the list is
// never left empty (removing the last level returns to the default sort).

/** Append `id` as the last level, in `desc` order; a column already sorting stays where it is. */
export function addSortLevel(levels: SortLevels, id: string, desc: boolean): SortLevels {
  return levels.some((level) => level.id === id) ? levels : [...levels, { id, desc }];
}

/** Drop the level for `id`; dropping the only level returns to {@link DEFAULT_SORT}. */
export function removeSortLevel(levels: SortLevels, id: string): SortLevels {
  const next = levels.filter((level) => level.id !== id);
  return next.length > 0 ? next : DEFAULT_SORT;
}

/** Move the level for `fromId` into the slot of `toId` (a drag drop), shifting the rest. */
export function moveSortLevel(levels: SortLevels, fromId: string, toId: string): SortLevels {
  const from = levels.findIndex((level) => level.id === fromId);
  const to = levels.findIndex((level) => level.id === toId);
  if (from < 0 || to < 0 || from === to) return levels;
  const next = [...levels];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Point the level for `id` at another column, keeping its place and direction. Refused (unchanged)
 * when `toId` already has a level, since a column sorts at most once.
 */
export function replaceSortColumn(levels: SortLevels, id: string, toId: string): SortLevels {
  if (id === toId || levels.some((level) => level.id === toId)) return levels;
  return levels.map((level) => (level.id === id ? { ...level, id: toId } : level));
}

/** Set the direction of the level for `id`. */
export function setSortDirection(levels: SortLevels, id: string, desc: boolean): SortLevels {
  return levels.map((level) => (level.id === id ? { ...level, desc } : level));
}

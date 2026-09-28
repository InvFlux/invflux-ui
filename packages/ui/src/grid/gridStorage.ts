import { type Accessor, createEffect, createSignal } from 'solid-js';
import type { ColumnOrderState, VisibilityState } from '@tanstack/solid-table';

/**
 * Where a grid keeps the layout the merchant arranged.
 *
 * The grid owns this, not its consumers. Every surface used to declare its own signals and its own
 * key per piece, which read like configuration and behaved like a trap: each new layout feature had
 * to be wired into every existing surface by hand, and a surface that missed one simply did not have
 * that feature — silently, with nothing to notice. Column pinning shipped that way and existed on
 * exactly one of six grids until someone opened the others.
 *
 * So a consumer passes a `scope` and gets the whole set. Anything it genuinely needs to control it
 * can still pass explicitly; see {@link DataGridProps}.
 */

/** One piece of per-surface layout state. The suffix in the key, and the whole vocabulary. */
export type GridStatePiece = 'cols' | 'col_order' | 'col_sizing' | 'col_sections' | 'col_pinned';

/**
 * The key a piece is stored under.
 *
 * One scheme for every grid — a surface is identified by its slug and nothing else. Exported
 * because a host may need to read a layout it did not write (the Workbench shell builds its export
 * column set from one), and a documented key is better than each caller re-deriving the format.
 */
export function gridStorageKey(scope: string, piece: GridStatePiece): string {
  return `invflux:grid:${scope}:${piece}`;
}

/**
 * A signal backed by `localStorage`, validated on read.
 *
 * The validation is the point: a stored value of the wrong shape is not a theoretical concern but
 * the ordinary result of renaming a piece or downgrading, and layout state read back as the wrong
 * type renders an empty grid rather than throwing. A value that fails its guard is discarded for the
 * fallback. Storage being unavailable (private mode, quota, a browser blocking site data) leaves the
 * signal working in memory, because a grid that cannot save a column width must still show columns.
 */
export function persistedGridSignal<T>(
  scope: string,
  piece: GridStatePiece,
  fallback: T,
  isValid: (v: unknown) => v is T,
): [Accessor<T>, (updater: (prev: T) => T) => void] {
  const key = gridStorageKey(scope, piece);

  let initial = fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (isValid(parsed)) initial = parsed;
    }
  } catch {
    /* unreadable or malformed — the fallback is already correct */
  }

  const [get, set] = createSignal<T>(initial);

  createEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(get()));
    } catch {
      /* quota / private mode — in-memory only, which is still a working grid */
    }
  });

  return [get, (updater) => set((prev) => updater(prev))];
}

export const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

export const isNumberRecord = (v: unknown): v is Record<string, number> =>
  typeof v === 'object' && v !== null && Object.values(v).every((n) => typeof n === 'number');

export const isVisibility = (v: unknown): v is VisibilityState =>
  typeof v === 'object' && v !== null && Object.values(v).every((b) => typeof b === 'boolean');

export const isColumnOrder = (v: unknown): v is ColumnOrderState => isStringArray(v);

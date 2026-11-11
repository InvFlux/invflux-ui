import type { JSX } from 'solid-js';
import type { HeaderLook } from './GridHeaderCell';

/**
 * Grid display settings — density, text wrapping, text size, and how many lines a column name may
 * take. Persisted per `settingsKey` (the grid's `scope`), and shared by every table that has a
 * header: the spreadsheet grid and the read-only table read the same settings, with the same classes.
 */
export type GridDensity = 'compact' | 'normal' | 'large';
export type GridWrap = 'wrap' | 'no-wrap';
export type GridTextSize = 'small' | 'normal' | 'large';
export interface GridSettings {
  density: GridDensity;
  wrap: GridWrap;
  textSize: GridTextSize;
  /** How many lines a column name may occupy, 1–{@link MAX_HEADER_LINES}. `1` is the single-line
   *  default; above that the name wraps and is clamped to that many lines, so a long name in a
   *  narrow column costs a bounded amount of height instead of however much it happens to need. */
  headerLines: number;
  /** Per-column override of {@link GridSettings.wrap}; a column absent here follows the grid-wide
   *  setting. One long free-text column among twenty numeric ones is the case this exists for —
   *  flipping the whole grid to wrap to read that one column costs height on every other. */
  columnWrap: Record<string, GridWrap>;
}

export const DEFAULT_GRID_SETTINGS: GridSettings = {
  density: 'normal',
  wrap: 'no-wrap',
  textSize: 'normal',
  headerLines: 1,
  columnWrap: {},
};
/** The ceiling on {@link GridSettings.headerLines}. Past three the header stops being a label and
 *  starts being a paragraph, and the height it costs is charged to every screen of rows. */
export const MAX_HEADER_LINES = 3;
export const DENSITY_PADDING: Record<GridDensity, string> = {
  compact: 'py-1',
  normal: 'py-2',
  large: 'py-3',
};
export const TEXT_SIZE_CLASS: Record<GridTextSize, string> = {
  small: 'text-xs',
  normal: 'text-sm',
  large: 'text-base',
};
// One step down from the cell size, for a wrapped header. A column name is read once and then
// recognized by shape; the rows under it are read continuously — so the two lines a wrapped name
// costs should be cheaper than two lines of data, not the same price.
export const TEXT_SIZE_CLASS_SMALLER: Record<GridTextSize, string> = {
  small: 'text-2xs',
  normal: 'text-xs',
  large: 'text-sm',
};
// Approximate single-line row height (px) per density × text size, for the virtualizer estimate
// (1px border + vertical padding + content/line). Wrapped rows are taller — accepted as today (the
// fixed-estimate virtualizer is "good enough" for wrap; overscan absorbs the slack).
export const DENSITY_BASE_PX: Record<GridDensity, number> = { compact: 38, normal: 49, large: 60 };
export const TEXT_SIZE_BUMP_PX: Record<GridTextSize, number> = { small: -2, normal: 0, large: 4 };

export function loadGridSettings(key: string, defaults?: Partial<GridSettings>): GridSettings {
  const base: GridSettings = { ...DEFAULT_GRID_SETTINGS, ...defaults };
  try {
    const raw = localStorage.getItem(`invflux:grid-settings:${key}`);
    // Stored user preference wins over the surface default, which wins over the global default.
    if (raw !== null) {
      const stored = JSON.parse(raw) as Partial<GridSettings>;
      const merged = { ...base, ...stored };
      // A blob written before per-column wrapping existed carries no map, and a hand-edited one may
      // carry anything; both must still yield an indexable object.
      if (merged.columnWrap === null || typeof merged.columnWrap !== 'object')
        merged.columnWrap = {};
      // Same for the line count: it reaches CSS and a row height, so clamp rather than trust it.
      merged.headerLines = Number.isFinite(merged.headerLines)
        ? Math.min(MAX_HEADER_LINES, Math.max(1, Math.round(merged.headerLines)))
        : 1;

      return merged;
    }
  } catch {
    /* ignore unavailable / malformed storage */
  }
  return base;
}

export function saveGridSettings(key: string, settings: GridSettings): void {
  try {
    localStorage.setItem(`invflux:grid-settings:${key}`, JSON.stringify(settings));
  } catch {
    /* ignore quota / private-mode failures */
  }
}

/** Density drives vertical padding, text size the font. */
export function cellDensityTextFor(settings: GridSettings): string {
  return `${DENSITY_PADDING[settings.density]} ${TEXT_SIZE_CLASS[settings.textSize]}`;
}

/** The wrap mode in force for one column: its own override, else the grid-wide setting. */
export function wrapForColumn(settings: GridSettings, columnId: string): GridWrap {
  return settings.columnWrap[columnId] ?? settings.wrap;
}

// No-wrap truncates the cell's direct children (block content like the product name/sub-lines) — a
// `text-ellipsis` on the <td> can't reach nested blocks, so target the children instead.
export function cellWrapClassFor(settings: GridSettings, columnId: string): string {
  return wrapForColumn(settings, columnId) === 'no-wrap' ? ' whitespace-nowrap [&>*]:truncate' : '';
}

// Header classes. The size step is chosen here rather than appended to `cellDensityText()`: two
// font-size utilities on one element are resolved by stylesheet order, not by the order they were
// concatenated in, so "append a smaller one to win" is a coin flip that happens to land right.
export function headerLookFor(settings: GridSettings): HeaderLook {
  const lines = settings.headerLines;
  const densityText = `${DENSITY_PADDING[settings.density]} ${
    lines > 1 ? TEXT_SIZE_CLASS_SMALLER[settings.textSize] : TEXT_SIZE_CLASS[settings.textSize]
  }`;

  // Centered when wrapping, matching the single-line case (a table cell's default) and the sort
  // affordance, so a one-line name beside a two-line one reads as one row of labels rather than as
  // text at two different heights. `hyphens-auto` first and `break-words` only as the fallback: a
  // column narrower than its own one-word name is common here ("Disponible", "Réservé"), and a
  // hyphenated break reads as language while a bare mid-word split reads as damage. Hyphenation
  // follows the document language, which the host sets.
  const wrapClass =
    lines > 1
      ? 'whitespace-normal hyphens-auto break-words align-middle leading-tight'
      : 'whitespace-nowrap';

  /**
   * Bound the header content to the allowed number of lines; the rest is clipped.
   *
   * A height cap on a block wrapper, not `-webkit-line-clamp`. The clamp is the obvious tool and it
   * is wrong here twice: `max-height` does not apply to a `table-cell` so it needs a wrapper either
   * way, and a clamp box is *inline-level*, so it shares a line box with the header's own strut and
   * the sort arrows — which reserves close to an extra line (measured: 61px of cell for two 15px
   * lines of text, i.e. a visible third line's worth of empty space). A block box is laid out from
   * its own content and has no such interaction.
   *
   * `em` rather than `px` so one expression covers all three text sizes, and 1.25 to match the
   * `leading-tight` the wrapping header sets. Inline style because the count is runtime state —
   * Tailwind only emits classes it can read in the source.
   */
  const boundStyle: JSX.CSSProperties | undefined =
    lines > 1 ? { 'max-height': `calc(${lines} * 1.25em)` } : undefined;

  return { lines, wrapClass, densityText, boundStyle };
}

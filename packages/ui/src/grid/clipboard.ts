import type { SelectionState } from './cellSelection';
import { isSelected } from './cellSelection';

/** Union bounding box of all selection ranges, or null when nothing is selected. */
export function selectionBounds(
  state: SelectionState,
): { r1: number; c1: number; r2: number; c2: number } | null {
  if (state.ranges.length === 0) return null;
  let r1 = Infinity;
  let c1 = Infinity;
  let r2 = -Infinity;
  let c2 = -Infinity;
  for (const rect of state.ranges) {
    r1 = Math.min(r1, rect.r1);
    c1 = Math.min(c1, rect.c1);
    r2 = Math.max(r2, rect.r2);
    c2 = Math.max(c2, rect.c2);
  }
  return { r1, c1, r2, c2 };
}

/**
 * The value a cell copies: its staged edit when it carries one, otherwise the persisted value.
 *
 * The rule is **copy mirrors the screen**, and it exists because the grid has two sources of truth
 * for one cell — the host's persisted row and its dirty model — and the renderer reads the second.
 * A copy path reading the first hands back a value the grid is not showing anywhere, which is
 * invisible until it is pasted somewhere else. `cutCell` makes it destructive rather than merely
 * wrong: it copies and then clears the staging, so reading the persisted value there puts the stale
 * text on the clipboard AND discards the edit, under a success toast.
 *
 * `pending` (submitted, awaiting the server's reconcile) is deliberately not consulted: such a cell
 * still displays its staged value — faded, with a spinner — so that is still what it copies.
 */
export function cellCopyValue(
  staged: { staged: boolean; value: unknown },
  persisted: unknown,
): unknown {
  return staged.staged ? staged.value : persisted;
}

/**
 * Build the clipboard payload for the current selection. Walks the bounding box row-by-row,
 * column-by-column, calling `formatCell` for selected cells (unselected cells inside the box —
 * possible with multi-range — become empty, preserving TSV shape). Returns the `text/plain`
 * TSV plus the raw 2-D grid (for the JSON round-trip clipboard variant).
 *
 * Copy-direction TSV uses naive `\t`/`\n` joining; quoting multi-line/tab cells is a v1.1
 * concern (paste already tolerates Excel's quoted TSV — see parseSpreadsheetTsv in @invflux/ui, 6b.3).
 */
export function buildClipboard(
  state: SelectionState,
  formatCell: (row: number, col: number) => string,
): { tsv: string; grid: string[][] } {
  const bounds = selectionBounds(state);
  if (bounds === null) return { tsv: '', grid: [] };

  const grid: string[][] = [];
  for (let row = bounds.r1; row <= bounds.r2; row++) {
    const line: string[] = [];
    for (let col = bounds.c1; col <= bounds.c2; col++) {
      line.push(isSelected(state, row, col) ? formatCell(row, col) : '');
    }
    grid.push(line);
  }

  return { tsv: grid.map((line) => line.join('\t')).join('\n'), grid };
}

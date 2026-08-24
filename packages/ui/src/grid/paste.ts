import type { SelectionRect } from './cellSelection';

export interface PasteTarget {
  row: number;
  col: number;
  text: string;
}

/**
 * Compute which (row, col) cells a clipboard grid lands on, given the paste anchor (the selection's
 * top-left) and the current selection (§11.5 step 2):
 *  - clipboard 1×1 + a multi-cell selection → fill the selection rectangle with that value;
 *  - otherwise → place the clipboard with its top-left at the anchor, expanding down/right.
 * Targets outside the grid bounds are clipped. Overflowing a smaller selection is gated by a
 * confirmation at the call site (LibreOffice Calc behaviour), so by the time we get here the overflow
 * is intended.
 */
export function pasteTargets(
  clip: string[][],
  anchor: { row: number; col: number },
  selection: SelectionRect | null,
  rowCount: number,
  colCount: number,
): PasteTarget[] {
  if (clip.length === 0) return [];

  const targets: PasteTarget[] = [];
  const isSingle = clip.length === 1 && clip[0].length === 1;
  const isRange =
    selection !== null && (selection.r1 !== selection.r2 || selection.c1 !== selection.c2);

  if (isSingle && isRange && selection !== null) {
    const value = clip[0][0];
    for (let row = selection.r1; row <= selection.r2 && row < rowCount; row++) {
      for (let col = selection.c1; col <= selection.c2 && col < colCount; col++) {
        targets.push({ row, col, text: value });
      }
    }
    return targets;
  }

  for (let r = 0; r < clip.length; r++) {
    for (let c = 0; c < clip[r].length; c++) {
      const row = anchor.row + r;
      const col = anchor.col + c;
      if (row < rowCount && col < colCount) targets.push({ row, col, text: clip[r][c] });
    }
  }

  return targets;
}

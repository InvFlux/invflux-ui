import type { SelectionRect } from './cellSelection';

export interface PasteTarget {
  row: number;
  col: number;
  text: string;
}

/** What one pasted cell resolves to, before any of it is applied. */
export type PastedCell =
  | { kind: 'stage'; value: unknown }
  /** No codec for this datatype — leave the cell alone rather than guess at its value. */
  | { kind: 'skip' }
  | { kind: 'reject'; reason: 'not-clearable' | 'invalid' };

/**
 * Decide what a single pasted string means for one cell.
 *
 * **Empty text is a clear, and that is a question about the column, not about the type.** Every
 * codec but `text` returns null for empty input, and null is `parse`'s "invalid" sentinel — so
 * asking the codec conflated "this column has no blank value" with "this text is malformed", and a
 * blank cell inside an otherwise valid block aborted the entire paste. Nothing could be emptied by
 * pasting over it either, which broke the round trip at exactly one value: copy an empty cell, paste
 * it back, and the paste is refused by the format that produced it.
 *
 * So the caller supplies the *cleared value* it already computes for Del and Cut, and empty text is
 * resolved against that. Two things follow for free: the per-type blank stays whatever that column
 * says it is (`null`, `""`, `[]`, `false` — they are not interchangeable), and because the caller's
 * resolution is row-aware, an inheritable cell on a variation returns to "same as parent" instead of
 * being emptied outright.
 *
 * Whitespace-only counts as empty: a spreadsheet round-trip through a lone space is not an attempt
 * to store one.
 *
 * @param parse The column codec's parse bound to its context, or null when no codec is registered.
 */
export function resolvePastedCell(
  text: string,
  cleared: { ok: boolean; value: unknown },
  parse: ((text: string) => unknown) | null,
): PastedCell {
  if (text.trim() === '') {
    return cleared.ok
      ? { kind: 'stage', value: cleared.value }
      : { kind: 'reject', reason: 'not-clearable' };
  }
  if (parse === null) return { kind: 'skip' };
  const value = parse(text);

  return value === null ? { kind: 'reject', reason: 'invalid' } : { kind: 'stage', value };
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

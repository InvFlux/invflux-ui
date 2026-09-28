import type { DraftLinePatch } from './PoDraftGrid';
import type { PoLine } from './types';

/**
 * The value a patch field would replace, read the way the cell displays it — so "does this change
 * anything" is asked against what the merchant is actually looking at.
 *
 * The cost cell shows the *list* price where a discount is in play and the plain unit cost
 * otherwise, which is the same basis the optimistic patch builder writes back on.
 */
export const currentValue = (line: PoLine, field: keyof DraftLinePatch): unknown => {
  if ('qty_requested' === field) return line.qtyRequested;
  if ('note' === field) return line.note;
  if ('discount_pct' === field) return line.discountPct;

  return line.listUnitCost ?? line.unitCost;
};

/**
 * Drop the fields a patch would not actually change; return `null` when none are left.
 *
 * **Clearing a selected column is what this exists for.** On a large draft most of those cells are
 * already empty, so without it a single Del writes null over null for hundreds of lines — work the
 * server does, the network carries and the merchant waits for, to change nothing. On the draft that
 * prompted it, 1359 of 1760 lines were already inheriting.
 *
 * Money is compared numerically because the server returns scaled decimals: `"4.0000"` and `"4"` are
 * one price, and a string comparison would call that an edit every time the cell was touched.
 *
 * **Conservative by construction** — a field is dropped only when both sides are comparable and
 * equal. A redundant write costs a little bandwidth; a dropped one silently loses what the merchant
 * typed, so the two errors are not worth trading against each other.
 */
export const prunePatch = (line: PoLine, patch: DraftLinePatch): DraftLinePatch | null => {
  const out: DraftLinePatch = {};
  let changed = false;

  for (const field of Object.keys(patch) as Array<keyof DraftLinePatch>) {
    const next = patch[field] ?? null;
    const current = currentValue(line, field) ?? null;

    // Numeric comparison is for the numeric fields only. A note is text: '007' and '7' are
    // different notes, and `Number()` calls them equal — which would drop the edit and lose what
    // the merchant typed.
    const numericField = 'note' !== field;
    const comparable =
      numericField &&
      null !== next &&
      null !== current &&
      '' !== next &&
      '' !== current &&
      !isNaN(Number(next)) &&
      !isNaN(Number(current));
    const same = comparable ? Number(next) === Number(current) : next === current;

    if (!same) {
      (out as Record<string, unknown>)[field] = patch[field];
      changed = true;
    }
  }

  return changed ? out : null;
};

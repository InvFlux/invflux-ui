import type { WorkbenchRow } from '../workbenchGridTypes';

/**
 * The workbench's footer total for one summed column, counting each unit once.
 *
 * A variable product's parent row is not a stock unit: what it shows for the stock quantities is the
 * family's (the Workbench sums its loaded variations into it), while the server reports nothing of
 * its own for it. Adding the parent and its variations would count the family twice. So a parent
 * whose variations are displayed adds nothing, and they are counted; a folded family, whose
 * variations are not displayed, is counted through its parent row. A variation shown without its
 * parent counts like any other row.
 *
 * The rule is the same in every column. A parent carries no cost of its own, so its valuations are
 * blank and a folded family adds no value to the total, the same as before folding was summed.
 */
export function workbenchFooterSum(
  rows: readonly WorkbenchRow[],
  _columnId: string,
  numberOf: (row: WorkbenchRow) => number,
): number {
  const familiesShowingVariations = new Set<number>();
  for (const row of rows) {
    if (row.role === 'variation') familiesShowingVariations.add(row.wcProductId);
  }

  let sum = 0;
  for (const row of rows) {
    if (row.role === 'parent' && familiesShowingVariations.has(row.wcProductId)) continue;
    const n = numberOf(row);
    if (Number.isFinite(n)) sum += n;
  }

  return sum;
}

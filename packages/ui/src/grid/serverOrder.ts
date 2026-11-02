import type { WorkbenchRow } from '../workbenchGridTypes';
import { sortToParams, type SortLevels } from './sortLevels';

/**
 * Re-sorting rows the grid already holds, in the order the server gives for them.
 *
 * Once every page of a result set is loaded, a new sort does not need the rows again — only their
 * order, which the server answers as a list of subject ids (`GET …/products/order`). Ordering by
 * that list keeps the server the single author of every sort rule (collation, value-less rows last,
 * the tie-break, category tree order), so a re-sort shows exactly what a reload would.
 */

/** Whether two sorts are the same request: same columns, same directions, same precedence. */
export function sameSort(a: SortLevels, b: SortLevels): boolean {
  const pa = sortToParams(a);
  const pb = sortToParams(b);
  return pa.sort_by === pb.sort_by && pa.sort_dir === pb.sort_dir;
}

/** Each subject id's position in the server's order. */
export function orderIndex(subjectIds: readonly number[]): Map<number, number> {
  return new Map(subjectIds.map((id, i) => [id, i]));
}

/**
 * The rows in the server's order. The order lists the matched set only: matched rows it does not
 * know (a row that changed since the order was taken) follow the ones it places, and the
 * brought-with context rows are then slotted by family, as the server slots them on a page — see
 * {@link placeContextRows}.
 */
export function orderRows(
  rows: readonly WorkbenchRow[],
  index: ReadonlyMap<number, number>,
): WorkbenchRow[] {
  const placed: WorkbenchRow[] = [];
  const unplaced: WorkbenchRow[] = [];
  const context: WorkbenchRow[] = [];
  for (const row of rows) {
    if (row.matched === false) context.push(row);
    else if (index.has(row.subjectId)) placed.push(row);
    else unplaced.push(row);
  }
  placed.sort((a, b) => (index.get(a.subjectId) ?? 0) - (index.get(b.subjectId) ?? 0));
  return placeContextRows([...placed, ...unplaced], context);
}

/**
 * Slot brought-with context rows among the matched ones so each family stays together whatever the
 * sort: a brought-in parent goes immediately before its first variation, a brought-in variation
 * immediately after the last row of its family (the parent, or a sibling). A context row with no
 * family member to anchor on goes last. The server places a page's context rows by the same rule
 * (FetchWorkbench::positionBroughtWithParents), so a re-ordered set reads as a fresh load would.
 */
export function placeContextRows(
  matched: readonly WorkbenchRow[],
  context: readonly WorkbenchRow[],
): WorkbenchRow[] {
  const parentsOf = new Map<number, WorkbenchRow[]>();
  const childrenOf = new Map<number, WorkbenchRow[]>();
  for (const row of context) {
    const into = row.wcVariationId === null ? parentsOf : childrenOf;
    into.set(row.wcProductId, [...(into.get(row.wcProductId) ?? []), row]);
  }

  // Parents first, so a brought-in variation can anchor on a brought-in parent too.
  const withParents: WorkbenchRow[] = [];
  for (const row of matched) {
    const parents = row.wcVariationId !== null ? parentsOf.get(row.wcProductId) : undefined;
    if (parents !== undefined) {
      withParents.push(...parents);
      parentsOf.delete(row.wcProductId);
    }
    withParents.push(row);
  }
  for (const parents of parentsOf.values()) withParents.push(...parents);

  const lastOfFamily = new Map<number, number>();
  withParents.forEach((row, i) => lastOfFamily.set(row.wcProductId, i));
  const out: WorkbenchRow[] = [];
  withParents.forEach((row, i) => {
    out.push(row);
    const children = childrenOf.get(row.wcProductId);
    if (children !== undefined && lastOfFamily.get(row.wcProductId) === i) {
      out.push(...children);
      childrenOf.delete(row.wcProductId);
    }
  });
  for (const children of childrenOf.values()) out.push(...children);
  return out;
}

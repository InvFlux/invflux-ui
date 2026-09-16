/**
 * After a save: which loaded rows to read back, and how to put them back.
 *
 * A save changes the rows it wrote and no others, with one exception: a variation shows some fields
 * inherited from its variable parent (rendered faded), so saving a parent changes what its variations
 * display. The rows to re-read are therefore the saved rows plus the variations of any saved parent —
 * and only among the rows the grid holds, which is the set its live-updates subscription tracks. A row
 * the grid has not loaded is read fresh whenever it is loaded, so reading it now would buy nothing.
 */
import type { WorkbenchRow } from '../workbenchGridTypes';

/** The part of a row that decides whether it needs re-reading. */
export type RefreshableRow = Pick<
  WorkbenchRow,
  'subjectId' | 'role' | 'productType' | 'wcProductId' | 'wcVariationId'
>;

/** A variable parent. `role` is authoritative when the server sends it; older rows fall back to type. */
function isParent(row: RefreshableRow): boolean {
  return undefined !== row.role ? 'parent' === row.role : 'variable' === row.productType;
}

function isVariation(row: RefreshableRow): boolean {
  return undefined !== row.role ? 'variation' === row.role : null !== row.wcVariationId;
}

/**
 * The subject ids to re-read after saving `saved`: each saved row the grid has loaded, plus every
 * loaded variation of a saved parent (a variation's `wcProductId` is its parent's product). In the
 * grid's row order, each id once. A saved id the grid has not loaded is left out.
 */
export function rowsToRefresh(
  saved: Iterable<number>,
  loaded: readonly RefreshableRow[],
): number[] {
  const savedIds = new Set(saved);
  const savedParents = new Set<number>();
  for (const row of loaded) {
    if (savedIds.has(row.subjectId) && isParent(row)) savedParents.add(row.wcProductId);
  }

  const out: number[] = [];
  const seen = new Set<number>();
  for (const row of loaded) {
    const wanted =
      savedIds.has(row.subjectId) || (isVariation(row) && savedParents.has(row.wcProductId));
    if (wanted && !seen.has(row.subjectId)) {
      seen.add(row.subjectId);
      out.push(row.subjectId);
    }
  }
  return out;
}

/**
 * Replace each re-read row in place in the loaded pages.
 *
 * The row keeps its `matched` flag from the page it was loaded into: whether a row matched the
 * filter or came along as context (a parent brought in for its variations) is a fact about that page,
 * not about the row, and it decides how the row is grouped and whether it is shown at all. A row read
 * back by id always comes back "matched", so taking its flag would change the page's shape.
 *
 * Pages and rows that were not re-read are returned as the same objects, so nothing else re-renders.
 */
export function mergeRefreshedRows<
  R extends { subjectId: number; matched?: boolean },
  P extends { products: R[] },
>(pages: readonly P[], fresh: ReadonlyMap<number, R>): P[] {
  return pages.map((page) => {
    let changed = false;
    const products = page.products.map((row) => {
      const next = fresh.get(row.subjectId);
      if (undefined === next) return row;
      changed = true;
      const merged = { ...next };
      if (undefined === row.matched) delete merged.matched;
      else merged.matched = row.matched;
      return merged;
    });
    return changed ? { ...page, products } : page;
  });
}

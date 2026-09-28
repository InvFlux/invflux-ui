/**
 * Which columns are stuck to the left edge while the grid scrolls sideways.
 *
 * A wide grid loses the row's identity the moment it scrolls: forty columns in, nothing on screen
 * says which product a row is. Pinning is the merchant's answer — keep the anchor columns in place
 * and scroll the rest past them. It is presentation state, per merchant and per surface, and lives
 * beside visibility, order and width rather than in the server's column contract.
 *
 * This module is the pure core: the rules for what is pinned, in what order, and what a consumer may
 * lock. No DOM, no table instance, so the rules are testable without a browser.
 */

/**
 * The checkbox column, which travels with the pinned group whenever anything is pinned.
 *
 * Pinning without it is worse than not pinning: the merchant scrolls right to reach a column, and
 * the checkboxes they were selecting with slide away. It is deliberately NOT part of the stored
 * list — a merchant never pins or unpins it, so storing it would invite a state where it is absent.
 */
const SELECT_COLUMN = 'select';

/**
 * Reconcile the stored pin list with what this surface locks.
 *
 * **The stored list is never filtered against the available columns.** Server columns arrive
 * asynchronously and the available set is rebuilt across ticks, so an id that has not loaded yet is
 * not an id that has gone away — dropping it would lose the pin and, worse, lose it silently. An id
 * that really has been removed is harmless: nothing renders for it. This mirrors `mergeColumnOrder`,
 * which learned the same lesson as a column-order-doesn't-persist bug.
 *
 * A locked id missing from the stored list joins at the **front**: it is structural, put there by
 * the surface rather than chosen by the merchant, so it anchors the group the merchant then extends.
 */
export function mergePinnedColumns(
  saved: readonly string[],
  lockedIds: readonly string[] = [],
): string[] {
  const stored: string[] = [];
  const seen = new Set<string>();
  for (const id of saved) {
    if (id === SELECT_COLUMN || seen.has(id)) continue;
    seen.add(id);
    stored.push(id);
  }
  const missingLocked = lockedIds.filter((id) => id !== SELECT_COLUMN && !seen.has(id));

  return [...missingLocked, ...stored];
}

/**
 * The pinned ids as the table wants them, with the checkbox column in front.
 *
 * Empty in, empty out: with nothing pinned the grid should have no sticky column at all, so the
 * checkbox stays as unremarkable as it is today.
 */
export function pinnedLeafOrder(pinned: readonly string[]): string[] {
  return pinned.length === 0 ? [] : [SELECT_COLUMN, ...pinned];
}

/** Whether this column is pinned (the checkbox counts as pinned whenever anything else is). */
export function isPinned(pinned: readonly string[], columnId: string): boolean {
  return columnId === SELECT_COLUMN ? pinned.length > 0 : pinned.includes(columnId);
}

/** Whether the surface forbids unpinning this column. */
export function isPinLocked(lockedIds: readonly string[], columnId: string): boolean {
  return lockedIds.includes(columnId);
}

/**
 * Pin a column, at the end of the pinned group.
 *
 * The end, not the front: the merchant is adding an anchor to the ones they already chose, and
 * inserting it ahead of those would reorder a group they had arranged. Re-pinning an already-pinned
 * column is a no-op rather than a move, so a double-click cannot quietly shuffle the group.
 */
export function pinColumn(pinned: readonly string[], columnId: string): string[] {
  if (columnId === SELECT_COLUMN || pinned.includes(columnId)) return [...pinned];

  return [...pinned, columnId];
}

/**
 * Unpin a column, unless the surface locked it or it is the checkbox.
 *
 * Returns the list unchanged rather than throwing: the callers are a button and a drag, and both
 * have already been rendered as refusing — a throw here would turn a disabled affordance that was
 * somehow reached into a broken grid.
 */
export function unpinColumn(
  pinned: readonly string[],
  columnId: string,
  lockedIds: readonly string[] = [],
): string[] {
  if (columnId === SELECT_COLUMN || isPinLocked(lockedIds, columnId)) return [...pinned];

  return pinned.filter((id) => id !== columnId);
}

/**
 * Move a pinned column to a new position within the pinned group.
 *
 * Position is clamped rather than validated: the callers are drag-and-drop, where an index past the
 * end means "last" and is the ordinary outcome of dropping below the final row.
 */
export function movePinnedColumn(
  pinned: readonly string[],
  columnId: string,
  toIndex: number,
): string[] {
  const from = pinned.indexOf(columnId);
  if (from === -1) return [...pinned];

  const without = pinned.filter((id) => id !== columnId);
  const at = Math.max(0, Math.min(toIndex, without.length));

  return [...without.slice(0, at), columnId, ...without.slice(at)];
}

/** What a drop in the column-reorder list means, decided by which zone each end sits in. */
export type PinDrop =
  | { kind: 'reorder-pinned'; columnId: string; toIndex: number }
  | { kind: 'pin'; columnId: string; atIndex: number }
  | { kind: 'unpin'; columnId: string }
  | { kind: 'reorder-free'; columnId: string; targetId: string };

/**
 * Read a drop in the reorder list as an action.
 *
 * The divider between the two zones is a control, not a separator: dragging a row across it pins or
 * unpins, because a drag that visibly moved a row into the pinned group and then snapped back reads
 * as a bug rather than as a refusal. Within a zone it is an ordinary reorder — but of *which* list
 * depends on the zone, since the pinned group has its own order and moving a pinned column through
 * `columnOrder` would leave the list and the grid disagreeing.
 *
 * Pure and separate from the component because it is four branches over two booleans, which is
 * exactly the shape that gets one branch wrong and is never noticed.
 */
export function pinDropAction(
  pinned: readonly string[],
  sourceId: string,
  targetId: string,
): PinDrop {
  const sourcePinned = pinned.includes(sourceId);
  const targetPinned = pinned.includes(targetId);

  if (sourcePinned && targetPinned) {
    return { kind: 'reorder-pinned', columnId: sourceId, toIndex: pinned.indexOf(targetId) };
  }
  if (targetPinned) return { kind: 'pin', columnId: sourceId, atIndex: pinned.indexOf(targetId) };
  if (sourcePinned) return { kind: 'unpin', columnId: sourceId };

  return { kind: 'reorder-free', columnId: sourceId, targetId };
}

/**
 * Whether pinning one more column would leave too little room to scroll.
 *
 * Nothing about sticky positioning stops a merchant pinning everything, and a grid pinned edge to
 * edge has no scrollable region left — it looks frozen rather than pinned, with no hint why. So the
 * affordance refuses past a share of the viewport and says so, which is information the merchant
 * cannot otherwise get.
 *
 * Measured against the widths actually in force (a resized column is what the merchant sees), and
 * unknown widths fall back to the grid's own default rather than zero, so an unmeasured column
 * cannot slip the budget.
 */
export function pinnedWidthExceeded(
  pinned: readonly string[],
  widths: Readonly<Record<string, number>>,
  viewportWidth: number,
  defaultWidth: number,
  maxShare = 0.5,
): boolean {
  if (viewportWidth <= 0) return false;

  const used = pinned.reduce((total, id) => total + (widths[id] ?? defaultWidth), 0);

  return used > viewportWidth * maxShare;
}

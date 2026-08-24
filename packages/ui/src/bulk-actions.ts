/**
 * Bulk-action registry.
 * A grid's selection-bar actions are registered, not hard-coded — the core registers its own
 * (e.g. add-to-worksheet) through the same seam an add-on uses (e.g. Procurement's "Create PO"),
 * with no privileged core path. SPA-agnostic (lives in @invflux/ui); DOM-free, so node-testable.
 *
 * An action's availability is a function of the current selection + active filters, so a feature's
 * applicability (and tier) is just `isEnabled` — no branching in the shell.
 */

/** Context the shell passes to a bulk action's `isEnabled` / `run`. */
export interface BulkActionContext {
  /** Subject ids of the currently selected rows. */
  selectedSubjectIds: number[];
  /** The currently-applied filter values, keyed by filter id (shape is host-defined). */
  activeFilters: Record<string, unknown>;
}

export interface BulkAction {
  /** Stable id — also the option value; re-registering the same id overrides. */
  id: string;
  /** Menu label. */
  label: string;
  /** Ascending sort key in the menu (default 100). */
  order?: number;
  /**
   * Whether the action should even APPEAR right now. Omitted ⇒ always listed. Use this only for
   * actions that are meaningless out of context (e.g. Export with zero rows); for actions with a
   * clear precondition the operator can satisfy, prefer {@link disabledReason} so the item stays
   * visible-but-disabled with a hint. (The shell additionally disables the whole menu when empty.)
   */
  isEnabled?: (ctx: BulkActionContext) => boolean;
  /**
   * When set and it returns a non-empty string, the action is shown **disabled** with that string as
   * a tooltip explaining the unmet precondition (e.g. "Select one or more products first"). Returns
   * `undefined` when enabled. Preferred over hiding via {@link isEnabled} for discoverability — the
   * operator sees the action exists and learns how to unlock it.
   */
  disabledReason?: (ctx: BulkActionContext) => string | undefined;
  /** Perform the action (open a modal, POST to an endpoint, …). Fire-and-forget. */
  run: (ctx: BulkActionContext) => void;
}

export interface BulkActionRegistry {
  /** Register (or override, by id) a bulk action. */
  register(action: BulkAction): void;
  /** All actions, ascending by `order` then registration order. */
  list(): BulkAction[];
  /** Look one up by id (for dispatching a selection). */
  get(id: string): BulkAction | undefined;
}

export function createBulkActionRegistry(): BulkActionRegistry {
  const byId = new Map<string, BulkAction>();
  let seq = 0;
  const order = new Map<string, number>(); // registration order, for stable sort

  return {
    register(action) {
      if (!order.has(action.id)) order.set(action.id, seq++);
      byId.set(action.id, action);
    },
    list() {
      return [...byId.values()].sort(
        (a, b) => (a.order ?? 100) - (b.order ?? 100) || order.get(a.id)! - order.get(b.id)!,
      );
    },
    get(id) {
      return byId.get(id);
    },
  };
}

/** The app-wide bulk-action registry. Shared across SPAs. */
export const bulkActionRegistry: BulkActionRegistry = createBulkActionRegistry();

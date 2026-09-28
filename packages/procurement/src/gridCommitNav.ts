import type { EditMove } from '@invflux/ui';

/**
 * Where focus goes after a grid cell is committed — the seam a contributed capability fills.
 *
 * The base moves focus the way the editor asked (`down` on Enter, `right` on Tab) and offers no
 * opinion beyond that. A capability that wants a different move — closing a filter/edit cycle so an
 * operator never reaches for the keyboard between entries — contributes a rule here and composes it
 * from the operations {@link CommitNavContext} exposes, each of which the surface already performs
 * on its own behalf.
 *
 * Shaped after the dispatch queue's `QueueSortRule`, and for the same reasons: a rule is plain data
 * plus pure functions, so a contributing bundle needs neither JSX nor the host's Solid runtime.
 */

/** What the grid tells a rule about the commit that just happened, and what it may do about it. */
export interface CommitNavContext {
  /** The grid asking. Stable, host-owned: `po.receive` is the goods-reception line grid. */
  gridId: string;
  /** Column whose cell was just committed. */
  columnId: string;
  /** Row whose cell was just committed, by the grid's own row id. */
  rowId: string;
  /** The move the editor asked for — `down` on Enter, `right` on Tab. */
  move: EditMove;
  /** The quick-filter query narrowing the grid right now; `''` when it is unfiltered. */
  filterText: string;
  /** Data rows the filter currently leaves visible. */
  visibleCount: number;
  /** Set the quick-filter's query — the same setter its own input calls on every keystroke. */
  setFilterText: (text: string) => void;
  /** Select a cell by row id without taking focus — the grid's ordinary selection move. */
  selectCellByRowId: (rowId: string, columnId: string) => void;
  /** Put keyboard focus in the quick-filter — what Escape and `/` already do. */
  focusFilter: () => void;
}

/** One contributed rule. Returning `true` claims the navigation and the grid skips its own move. */
export interface CommitNavRule {
  /** Identifier for override — re-registering the name replaces the rule in place. */
  name: string;
  /** Ascending position; ties break on registration order. */
  order?: number;
  /**
   * Whether the rule applies right now, evaluated **at commit time** rather than at registration.
   *
   * A contributing bundle loads whenever its plugin is active, which is a different question from
   * whether its licence currently allows the capability. Read the entitlement here, via
   * {@link commitNavEntitlements}, so a lapsed install stops behaving as though it were paid
   * without needing anything deactivated.
   */
  enabled?: () => boolean;
  /** True when the rule took the navigation. */
  handle: (ctx: CommitNavContext) => boolean;
}

/**
 * The install's current procurement entitlements, for a rule's {@link CommitNavRule.enabled}.
 *
 * A plain string→boolean map, deliberately: the base publishes whatever the host handed it and
 * names none of the keys, so no paid-capability key appears in this package.
 */
let entitlementSource: () => Record<string, boolean> = () => ({});

/** Host-only. Called once the procurement context is available. */
export function publishCommitNavEntitlements(source: () => Record<string, boolean>): void {
  entitlementSource = source;
}

export function commitNavEntitlements(): Record<string, boolean> {
  return entitlementSource();
}

/**
 * What may redirect focus after a commit.
 *
 * **The base registers nothing.** Unlike the queue's sort — where the base contributes its own
 * rules through the same `register()` an add-on uses — there is no base commit-navigation
 * behaviour to contribute: an unextended grid moves the way the editor asked. An empty registry is
 * the whole of the base's answer.
 *
 * Membership is read at commit time, not captured, so a rule registered by a bundle that evaluates
 * after the grid mounts still takes effect.
 */
class CommitNavRegistry {
  private readonly byName = new Map<string, CommitNavRule>();
  private readonly registeredAt = new Map<string, number>();
  private sequence = 0;

  /** Register a rule, or override one by re-registering its name (keeping its original position). */
  register(rule: CommitNavRule): void {
    const key = rule.name.toLowerCase();
    if (!this.registeredAt.has(key)) this.registeredAt.set(key, this.sequence++);
    this.byName.set(key, rule);
  }

  /** Every rule, ascending by `order` then registration order. */
  all(): CommitNavRule[] {
    return [...this.byName.values()].sort(
      (a, b) =>
        (a.order ?? 100) - (b.order ?? 100) ||
        (this.registeredAt.get(a.name.toLowerCase()) ?? 0) -
          (this.registeredAt.get(b.name.toLowerCase()) ?? 0),
    );
  }
}

export const commitNavRegistry = new CommitNavRegistry();

/**
 * Ask the registered rules where focus should go. `false` — including the no-rules case — leaves
 * the grid's own move alone.
 *
 * The first enabled rule that claims the commit wins; later rules are not consulted, so two
 * capabilities contributing to one grid cannot both move focus.
 */
export function resolveCommitNav(ctx: CommitNavContext): boolean {
  for (const rule of commitNavRegistry.all()) {
    if (rule.enabled && !rule.enabled()) continue;
    if (rule.handle(ctx)) return true;
  }
  return false;
}

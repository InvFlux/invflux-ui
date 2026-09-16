/**
 * Entity-action registry — the page/detail-level sibling of {@link bulkActionRegistry}.
 *
 * A detail page's title-bar actions are registered per **scope** (e.g. `po.detail`, `order.detail`,
 * `product.row`), not hard-coded, so core and add-ons contribute through one seam with no privileged
 * core path. DOM-free (node-testable); the {@link resolveEntityActions} resolver is a pure function of
 * `(registered actions, context)`.
 *
 * The shell renders the resolved shape as a split button: one contextual **primary** (headline) +
 * an overflow menu (secondary, then a divided destructive group). The headline is *resolved per
 * context* — actions bid for it via {@link EntityAction.promoteWhen} — not assigned by registration
 * order. Availability, labels, and ordering may all be context-derived, so an action self-adjusts
 * without any actor rewriting another's action (no list-transformer seam by design).
 */

import type { IconComponent } from './icons';

/** Static menu bucket. `primary`/`destructive` are core-owned (add-on contributions are demoted). */
export type ActionGroup = 'primary' | 'secondary' | 'destructive';

/** Baseline headline weight a core `group: "primary"` candidate claims when it has no `promoteWhen`. */
export const DEFAULT_PRIMARY_WEIGHT = 500;

/** Base context every scope provides; a scope extends this with its own fields (entityId, stage, …). */
export interface EntityActionContext {
  /**
   * Whether the install holds the Pro SKU — coarse *display* gating until a per-user
   * capability map exists. Not an entitlement decision: what may actually run is
   * settled server-side per feature key.
   */
  hasPro?: boolean;
  /** Per-user capability flags. */
  caps?: Record<string, boolean>;
}

export interface EntityAction<Ctx extends EntityActionContext = EntityActionContext> {
  /** Stable id — re-registering the same id in the same scope overrides in place. */
  id: string;
  /** Menu label; may be context-derived so the owner can restyle itself. */
  label: string | ((ctx: Ctx) => string);
  /**
   * Optional leading icon, as an {@link IconComponent} — never a rendered element (see its doc).
   *
   * Static, unlike every other field here: an icon component *is* a function, so a `(ctx) => Icon`
   * form would be indistinguishable from the icon itself, and the resolver would call the icon with
   * the context as its props. An action that must change its mark by state does it inside its own
   * component instead.
   */
  icon?: IconComponent;
  /** Static bucket (default `secondary`). `primary`/`destructive` from a non-core owner are demoted. */
  group?: ActionGroup;
  /** Ascending sort within the group; may be context-derived. Default 100. */
  order?: number | ((ctx: Ctx) => number);
  /** Provenance. Only `core` may use `primary`/`destructive` or `locked`. Default `addon`. */
  owner?: 'core' | 'addon';
  /** A locked (core) headline candidate wins the primary slot unconditionally — no weight beats it. */
  locked?: boolean;
  /** HIDE the action entirely when it is meaningless in this context / not entitled. */
  isAvailable?: (ctx: Ctx) => boolean;
  /** Non-empty ⇒ show the action DISABLED with this string as the reason tooltip; undefined ⇒ enabled. */
  disabledReason?: (ctx: Ctx) => string | undefined;
  /**
   * Tooltip for the action while it is ENABLED — what pressing it will actually do. For labels
   * that a reasonable operator could over-read; a label needing a paragraph belongs in a modal.
   * `disabledReason` wins when both apply: why you can't act beats what the act would do.
   */
  hint?: string | ((ctx: Ctx) => string);
  /** Bid for the headline slot in this context: a weight, or `false` to decline. See §4.1. */
  promoteWhen?: (ctx: Ctx) => number | false;
  /** Perform the action (open a modal, POST, navigate). Fire-and-forget. */
  run: (ctx: Ctx) => void;
}

/** An action with its context-derived fields resolved, ready to render. */
export interface ResolvedAction {
  id: string;
  label: string;
  icon?: IconComponent;
  group: ActionGroup;
  /** Non-undefined ⇒ render disabled with this tooltip. */
  disabledReason?: string;
  /** Tooltip while enabled; `disabledReason` takes precedence when the action is disabled. */
  hint?: string;
  run: () => void;
}

/** The resolved title-bar shape for one scope + context. */
export interface ResolvedActions {
  /** The headline action, or null when nothing bids for it. Never a destructive action. */
  primary: ResolvedAction | null;
  /** Overflow, non-destructive, ascending. Excludes whatever became `primary`. */
  secondary: ResolvedAction[];
  /** Overflow destructive group (rendered below a divider, danger-styled), ascending. */
  destructive: ResolvedAction[];
}

export interface EntityActionRegistry {
  /** Register (or override, by id) an action in a scope. */
  register<Ctx extends EntityActionContext>(scope: string, action: EntityAction<Ctx>): void;
  /** Raw registered actions for a scope (registration order); mostly for tests/introspection. */
  list(scope: string): EntityAction[];
  /** Resolve the title-bar shape for a scope against a context. */
  resolve<Ctx extends EntityActionContext>(scope: string, ctx: Ctx): ResolvedActions;
}

const call = <Ctx, T>(v: T | ((ctx: Ctx) => T), ctx: Ctx): T =>
  typeof v === 'function' ? (v as (ctx: Ctx) => T)(ctx) : v;

/** Normalise a contribution: a non-core owner can't claim `primary`/`destructive` or `locked`. */
function govern(action: EntityAction): EntityAction {
  const owner = action.owner ?? 'addon';
  if (owner === 'core') return action;
  const wantsReserved =
    action.group === 'primary' || action.group === 'destructive' || action.locked;
  if (!wantsReserved) return action;
  if (typeof console !== 'undefined') {
    console.warn(
      `[invflux] entity-action "${action.id}" from an add-on requested group="${action.group}"` +
        `${action.locked ? '/locked' : ''}; demoted to "secondary" (core owns primary/destructive).`,
    );
  }
  return { ...action, group: 'secondary', locked: false };
}

/** Headline weight an action bids in this context, or null if it isn't a candidate. */
function headlineWeight(a: EntityAction, ctx: EntityActionContext): number | null {
  if (a.group === 'destructive') return null; // never the headline
  if (a.promoteWhen) {
    const w = a.promoteWhen(ctx);
    return false === w ? null : w;
  }
  return a.group === 'primary' ? DEFAULT_PRIMARY_WEIGHT : null;
}

export function createEntityActionRegistry(): EntityActionRegistry {
  const scopes = new Map<string, Map<string, EntityAction>>();
  const seq = new Map<string, Map<string, number>>();
  const counters = new Map<string, number>();

  const scopeMap = (scope: string): Map<string, EntityAction> => {
    let m = scopes.get(scope);
    if (!m) {
      m = new Map();
      scopes.set(scope, m);
      seq.set(scope, new Map());
      counters.set(scope, 0);
    }
    return m;
  };

  return {
    register(scope, action) {
      const m = scopeMap(scope);
      const s = seq.get(scope)!;
      if (!s.has(action.id)) {
        s.set(action.id, counters.get(scope)!);
        counters.set(scope, counters.get(scope)! + 1);
      }
      m.set(action.id, govern(action as EntityAction));
    },

    list(scope) {
      return [...(scopes.get(scope)?.values() ?? [])];
    },

    resolve(scope, ctx) {
      const s = seq.get(scope) ?? new Map<string, number>();
      const regOrder = (a: EntityAction): number => s.get(a.id) ?? 0;

      // Available actions only (isAvailable === false ⇒ hidden entirely).
      const available = this.list(scope).filter((a) => a.isAvailable?.(ctx) !== false);

      // Headline arbitration: a locked core candidate wins unconditionally; else highest weight.
      let primaryAction: EntityAction | null = null;
      let bestWeight = -Infinity;
      for (const a of available) {
        const w = headlineWeight(a, ctx);
        if (null === w) continue;
        if (a.locked) {
          primaryAction = a;
          break;
        }
        if (w > bestWeight) {
          bestWeight = w;
          primaryAction = a;
        }
      }

      const resolve1 = (a: EntityAction): ResolvedAction => ({
        id: a.id,
        label: call(a.label, ctx),
        // Passed through, never `call`ed: the icon is itself a component (see EntityAction.icon).
        icon: a.icon,
        group: a.group ?? 'secondary',
        disabledReason: a.disabledReason?.(ctx) || undefined,
        hint: a.hint === undefined ? undefined : call(a.hint, ctx),
        run: () => a.run(ctx),
      });

      const byOrder = (a: EntityAction, b: EntityAction): number =>
        (call(a.order ?? 100, ctx) as number) - (call(b.order ?? 100, ctx) as number) ||
        regOrder(a) - regOrder(b);

      const rest = available.filter((a) => a !== primaryAction);
      const secondary = rest
        .filter((a) => (a.group ?? 'secondary') !== 'destructive')
        .sort(byOrder)
        .map(resolve1);
      const destructive = rest
        .filter((a) => a.group === 'destructive')
        .sort(byOrder)
        .map(resolve1);

      return { primary: primaryAction ? resolve1(primaryAction) : null, secondary, destructive };
    },
  };
}

/** The app-wide entity-action registry. Shared across SPAs. */
export const entityActionRegistry: EntityActionRegistry = createEntityActionRegistry();

import type { JSX } from 'solid-js';

/**
 * UI slot registry — the extension mechanism for surfaces *richer
 * than a grid*. Where grids are extended through the typed column / filter / bulk-action +
 * datatype-component registries, detail views, dashboards, and multi-section shells expose named
 * **slots** that contributions target by key, e.g.:
 *
 *   nav.section                  top-level sections
 *   <entity>.detail.tab          tabs on a detail view
 *   <entity>.detail.panel        panels within a detail view
 *   <entity>.detail.action       stage/context-scoped action-bar actions
 *   dashboard.widget             dashboard cards
 *
 * Slot keys are stable, namespaced strings owned by the host SPA. The shell renders the
 * registered contributions for a key in declared order, each gated by its optional `enabled`
 * predicate (license / active state) — so a feature's *tier* is just a registration gate, with
 * no tier branching in the shell (§3.1).
 *
 * This registry is SPA-agnostic and shared (one instance in @invflux/ui), so the core and any
 * add-on contribute through the exact same seam.
 */

/** A single contribution to a slot. `P` is the slot's context-props shape, passed by the shell. */
export interface SlotContribution<P = Record<string, unknown>> {
  /** Stable id within the slot — lets a later registration override an earlier one. */
  id: string;
  /** Renders the contribution; receives the slot's context props from the shell. */
  component: (props: P) => JSX.Element;
  /** Ascending sort key within the slot (default 100). Ties keep registration order. */
  order?: number;
  /** Reactive enablement gate (license / active state). Absent ⇒ always shown. */
  enabled?: () => boolean;
  /**
   * Human-readable, translated label (e.g. the top-tab caption for `nav.section`). A getter so
   * the `__()` call resolves at render time under the active locale. Absent ⇒ the shell falls
   * back to humanizing the `id`.
   */
  label?: () => string;
  /**
   * Reachable but not listed: a navigation slot still routes to the contribution, and leaves it out
   * of the tabs. For a seldom-visited page reached by links from where its choices are made, which a
   * permanent tab would advertise to everyone who never needs it. Absent ⇒ listed.
   */
  hidden?: boolean;
}

export interface SlotRegistry {
  /** Register (or override, by id) a contribution under a slot key. */
  register<P = Record<string, unknown>>(slotKey: string, contribution: SlotContribution<P>): void;
  /** Contributions for a slot, ascending by `order` then registration order. Empty if none. */
  get<P = Record<string, unknown>>(slotKey: string): Array<SlotContribution<P>>;
  /** Every slot key with at least one contribution — for diagnostics / a slot inspector. */
  slotKeys(): string[];
}

export function createSlotRegistry(): SlotRegistry {
  // Insertion order is preserved by the array; we stable-sort by `order` on read.
  const bySlot = new Map<string, SlotContribution<unknown>[]>();

  return {
    register<P = Record<string, unknown>>(
      slotKey: string,
      contribution: SlotContribution<P>,
    ): void {
      const stored = contribution as unknown as SlotContribution<unknown>;
      const list = bySlot.get(slotKey) ?? [];
      const existing = list.findIndex((c) => c.id === stored.id);
      if (existing >= 0) list[existing] = stored;
      else list.push(stored);
      bySlot.set(slotKey, list);
    },

    get<P = Record<string, unknown>>(slotKey: string): Array<SlotContribution<P>> {
      const list = bySlot.get(slotKey);
      if (list === undefined) return [];
      // Stable sort: decorate with index so equal `order` keeps registration order.
      return list
        .map((c, i) => ({ c, i }))
        .sort((a, b) => (a.c.order ?? 100) - (b.c.order ?? 100) || a.i - b.i)
        .map((e) => e.c as unknown as SlotContribution<P>);
    },

    slotKeys(): string[] {
      return [...bySlot.keys()];
    },
  };
}

/** The app-wide slot registry. Shared across SPAs. */
export const slotRegistry: SlotRegistry = createSlotRegistry();

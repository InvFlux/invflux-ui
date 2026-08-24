import { slotRegistry } from '@invflux/ui';
import type { JSX } from 'solid-js';

/**
 * The **surface catalog**: the set of top-level surfaces the app can open. Add-ons *push* into it
 * through the shared `nav.section` slot — the core never maintains a master list of surfaces it does
 * not own; a not-installed add-on is simply absent. The launcher (lockup dropdown) renders this
 * list; the center tab strip renders the same set as singleton tabs.
 *
 * One source of truth so App.tsx, the launcher, and the gear all agree on labels + ordering.
 */
export interface Surface {
  id: string;
  /** Resolved caption (section `label()` getter, else humanized id). */
  label: string;
  component: () => JSX.Element;
}

/** Slug → title-cased label, the fallback when a section carries no explicit `label`. */
export const humanize = (id: string): string =>
  id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Enabled top-level surfaces, registry-first, ascending by `order`. Reactive: reads the slot list on
 * each call, so a late add-on registration shows up.
 */
export const surfaceCatalog = (): Surface[] =>
  slotRegistry
    .get<Record<string, never>>('nav.section')
    .filter((s) => s.enabled?.() ?? true)
    .map((s) => ({
      id: s.id,
      label: s.label?.() ?? humanize(s.id),
      component: s.component as () => JSX.Element,
    }));

/**
 * Every registered top-level surface id, **including disabled ones** (no `enabled` filter). Used to
 * recognise a surface's tab path even when its mode currently hides it — so a stale persisted tab for
 * a now-disabled/permanent surface can be told apart from a plain Ledger/Settings detail tab.
 */
export const allSurfaceIds = (): string[] =>
  slotRegistry.get<Record<string, never>>('nav.section').map((s) => s.id);

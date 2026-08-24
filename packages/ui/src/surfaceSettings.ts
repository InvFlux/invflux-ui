import { createSignal, type JSX } from 'solid-js';

/**
 * Props the app shell's contextual gear passes to a surface-settings **panel** when it mounts it in
 * the gear popover. `onRequestClose` lets a panel dismiss the popover itself (e.g. after its Save).
 */
export interface SurfaceSettingsPanelProps {
  /** Ask the shell to close the gear popover (e.g. the panel just saved + applied its changes). */
  onRequestClose: () => void;
}

/**
 * Per-surface **settings panels** — the seam that lets the app shell's contextual gear (top-right,
 * beside the surface tabs) render a *surface's own* settings **inline**, as an anchored popover under
 * the gear, without the shell knowing anything about that surface. A surface (core or add-on)
 * registers a panel scoped to its `surfaceId`; the gear mounts the panels whose `surfaceId` matches
 * the active surface, stacked, inside a single scrollable popover (each panel renders its own foldable
 * {@link SettingsSection} groups, so many add-on/third-party sections stay manageable).
 *
 * A panel is a **component the shell mounts** (not an imperative action) — the gear *is* the settings
 * surface, rather than a menu pointing at a modal. Registration is reactive (a revision signal) so a
 * panel that registers when its surface mounts (its component closes over live surface state) appears
 * in an already-rendered gear.
 */
export interface SurfaceSettingsPanel {
  /** Stable id within the surface — a later registration with the same (surfaceId, id) overrides. */
  id: string;
  /** Which surface (nav.section id) this panel belongs to; the gear shows it only when active. */
  surfaceId: string;
  /** Translated caption (for the empty-state hint / a11y). A getter so `__()` resolves under the locale. */
  label: () => string;
  /** The panel content the gear mounts. Renders its own foldable sections; may close the popover. */
  component: (props: SurfaceSettingsPanelProps) => JSX.Element;
  /** Ascending sort key within the surface (default 100). Ties keep registration order. */
  order?: number;
  /** Reactive enablement gate (license / active state). Absent ⇒ always shown. */
  enabled?: () => boolean;
}

export interface SurfaceSettingsRegistry {
  /** Register (or override, by (surfaceId, id)) a settings panel. Returns a disposer that unregisters it. */
  register(panel: SurfaceSettingsPanel): () => void;
  /** Remove a panel by its (surfaceId, id) key. No-op if absent. */
  unregister(surfaceId: string, id: string): void;
  /** Panels for a surface, ascending by `order` then registration order. Empty if none. Reactive. */
  for(surfaceId: string): SurfaceSettingsPanel[];
}

export function createSurfaceSettingsRegistry(): SurfaceSettingsRegistry {
  const bySurface = new Map<string, SurfaceSettingsPanel[]>();
  // Revision signal: bumped on every mutation so `for()` re-runs in any tracking scope that read it.
  const [rev, bumpRev] = createSignal(0);

  return {
    register(panel: SurfaceSettingsPanel): () => void {
      const list = bySurface.get(panel.surfaceId) ?? [];
      const existing = list.findIndex((p) => p.id === panel.id);
      if (existing >= 0) list[existing] = panel;
      else list.push(panel);
      bySurface.set(panel.surfaceId, list);
      bumpRev((v) => v + 1);
      return () => this.unregister(panel.surfaceId, panel.id);
    },

    unregister(surfaceId: string, id: string): void {
      const list = bySurface.get(surfaceId);
      if (list === undefined) return;
      const next = list.filter((p) => p.id !== id);
      if (next.length > 0) bySurface.set(surfaceId, next);
      else bySurface.delete(surfaceId);
      bumpRev((v) => v + 1);
    },

    for(surfaceId: string): SurfaceSettingsPanel[] {
      rev(); // subscribe: any register/unregister re-runs this read
      const list = bySurface.get(surfaceId);
      if (list === undefined) return [];
      return list
        .map((p, i) => ({ p, i }))
        .sort((x, y) => (x.p.order ?? 100) - (y.p.order ?? 100) || x.i - y.i)
        .map((e) => e.p);
    },
  };
}

/** The app-wide surface-settings registry. Shared across SPAs (one instance in @invflux/ui). */
export const surfaceSettingsRegistry: SurfaceSettingsRegistry = createSurfaceSettingsRegistry();

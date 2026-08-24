import { createSignal } from 'solid-js';

/**
 * Per-section dirty state — published by sections, read by the shell nav so a tab handle can signal
 * unsaved work (yellow) even while another section is active. Keeps the shell decoupled from any
 * section's internals: a section pushes a boolean, the nav reads it reactively.
 *
 * This is also the bridge toward the keep-alive/persist follow-up: once dirty state lives above the
 * router, the tab badge and the leave-guard both read it.
 */
const [dirtyMap, setDirtyMap] = createSignal<Record<string, boolean>>({});

/** Publish a section's dirty state (no-op if unchanged, to avoid needless nav re-renders). */
export function setSectionDirty(id: string, dirty: boolean): void {
  setDirtyMap((prev) => (prev[id] === dirty ? prev : { ...prev, [id]: dirty }));
}

/** Reactive read: is this section holding unsaved work? */
export function isSectionDirty(id: string): boolean {
  return dirtyMap()[id] ?? false;
}

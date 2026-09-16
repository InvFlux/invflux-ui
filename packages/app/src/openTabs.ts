import { createSignal } from 'solid-js';

/**
 * A tab in the shell's tab bar — a top-level surface (`/workbench`) or a detail view (`/ledger/15`,
 * `/settings`). Identified by its **route**; `title` is the caption a detail tab carries (a surface
 * tab re-derives its label from the `nav.section` registry at render, so a surface tab's stored title
 * is only a fallback).
 */
export interface TabRef {
  path: string;
  title: string;
  /** Reserved: an editable detail tab sets this true to drive the close-confirm. */
  dirty?: boolean;
}

/** Back-compat alias — the workspace snapshot type still names it this. */
export type OpenTab = TabRef;

/**
 * **Browser-style tabs, per browser.** Two ordered rows, and a tab is in at most one:
 *  - **pinned** — compact tabs on the left; kept across sessions; reorderable; unpin/close via
 *    right-click or the launcher.
 *  - **open** — regular closeable tabs on the right.
 *
 * A path in neither row is *closed* — available to re-open from the launcher dropdown. There is no
 * install-wide "always there for everybody"; the per-install `surfaceMode` only seeds each browser's
 * FIRST-run pin state (see `main.tsx`), after which this per-browser state is authoritative.
 */
const [pinnedSig, setPinned] = createSignal<TabRef[]>([]);
const [openSig, setOpen] = createSignal<TabRef[]>([]);
/** Surfaces this browser has already seen — so a newly-installed `always` surface pins on first
 *  sight without re-pinning one the user deliberately closed. */
const [seenSig, setSeen] = createSignal<string[]>([]);

export const pinnedTabs = pinnedSig;
export const openTabs = openSig;
export const seenSurfaces = seenSig;

const has = (list: readonly TabRef[], path: string): boolean => list.some((t) => t.path === path);

export function isPinned(path: string): boolean {
  return has(pinnedSig(), path);
}
export function isOpen(path: string): boolean {
  return has(openSig(), path);
}

/**
 * Ensure a tab exists, added to the **open** row unless it is already pinned. Idempotent — the
 * navigation effect calls this for the active route, so a deep-link / grid click / reload always has
 * a tab, and a pinned surface is never duplicated into the open row.
 */
export function ensureTab(tab: TabRef): void {
  if (isPinned(tab.path)) return;
  setOpen((prev) => (has(prev, tab.path) ? prev : [...prev, tab]));
}

/**
 * Rename an existing tab, in whichever row holds it. No-op when the path has no tab, and when the
 * title is unchanged — so an effect may call it on every render without churning the signal.
 *
 * For detail tabs whose name is not derivable from their route: a promoted order is addressed by
 * its hex id, but an operator knows it by its order number, which only the loaded order carries.
 * The tab is created first (by navigation) and named a moment later, once that arrives.
 */
export function retitleTab(path: string, title: string): void {
  const rename = (list: TabRef[]): TabRef[] => {
    const at = list.findIndex((t) => t.path === path);
    if (at < 0 || list[at]?.title === title) return list;
    const next = [...list];
    next[at] = { ...(next[at] as TabRef), title };
    return next;
  };
  setPinned(rename);
  setOpen(rename);
}

/** Pin a tab (open → pinned, or add if closed), appended to the pinned row. */
export function pinTab(tab: TabRef): void {
  setOpen((prev) => prev.filter((t) => t.path !== tab.path));
  setPinned((prev) => (has(prev, tab.path) ? prev : [...prev, { ...tab }]));
}

/** Unpin a tab → it becomes a normal **open** tab (browser-style; closing it then frees it). */
export function unpinTab(path: string): void {
  const t = pinnedSig().find((x) => x.path === path);
  if (!t) return;
  setPinned((prev) => prev.filter((x) => x.path !== path));
  setOpen((prev) => (has(prev, path) ? prev : [...prev, t]));
}

/** Close a tab (remove from both rows → back to the launcher dropdown). */
export function closeTab(path: string): void {
  setPinned((prev) => prev.filter((t) => t.path !== path));
  setOpen((prev) => prev.filter((t) => t.path !== path));
}

/** Reorder within the pinned row (drag). */
export function movePinned(fromPath: string, toPath: string): void {
  setPinned((prev) => reorder(prev, fromPath, toPath));
}
/** Reorder within the open row (drag). */
export function moveOpen(fromPath: string, toPath: string): void {
  setOpen((prev) => reorder(prev, fromPath, toPath));
}

function reorder(list: TabRef[], fromPath: string, toPath: string): TabRef[] {
  const from = list.findIndex((t) => t.path === fromPath);
  const to = list.findIndex((t) => t.path === toPath);
  if (from < 0 || to < 0 || from === to) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as TabRef);
  return next;
}

/** Whether this browser has already applied a surface's first-run default (see `markSeen`). */
export function hasSeenSurface(id: string): boolean {
  return seenSig().includes(id);
}
/** Record that a surface's first-run default has been applied for this browser. */
export function markSeen(id: string): void {
  setSeen((prev) => (prev.includes(id) ? prev : [...prev, id]));
}

/**
 * Restore both rows + the seen-surface set at boot (§12.4). Keeps only well-formed entries, and a
 * path can't sit in both rows (a collision loses from the open row).
 */
export function restoreTabs(
  pinned: readonly unknown[],
  open: readonly unknown[],
  seen: readonly unknown[],
): void {
  const valid = (t: unknown): t is TabRef =>
    null !== t &&
    'object' === typeof t &&
    'string' === typeof (t as TabRef).path &&
    'string' === typeof (t as TabRef).title;

  const pinnedTabsRestored = (pinned ?? []).filter(valid);
  const pinnedPaths = new Set(pinnedTabsRestored.map((t) => t.path));
  setPinned(pinnedTabsRestored);
  setOpen((open ?? []).filter((t): t is TabRef => valid(t) && !pinnedPaths.has(t.path)));
  setSeen((seen ?? []).filter((s): s is string => 'string' === typeof s));
}

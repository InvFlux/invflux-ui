import type { TabRef } from './openTabs';

/**
 * §12.4 workspace persistence — restore the app layout across reloads without cross-browser-tab
 * interference.
 *
 * Two web-storage roles, each used for what it's designed for:
 *  - **sessionStorage** (per browser tab, survives reload, dies on close) = the *live workspace* of
 *    THIS tab; restored EXACTLY on F5.
 *  - **localStorage** (shared across browser tabs) = a rolling "last session" default, seeded into a
 *    BRAND-NEW browser tab only, never applied to a running one (no `storage`-event listeners) — so
 *    two windows never perturb each other.
 *
 * The "workspace" is the layout, not data: the open detail-tab set, the active route, and each
 * surface's remembered location (filter / sub-route). Data still refetches on focus via TanStack.
 *
 * This module is deliberately **pure storage + decision** (no `openTabs` / `surfaceRouter` imports, so
 * it stays unit-testable under the node vitest env): `main.tsx` reads the boot snapshot here and
 * applies it (restore the tabs + surface locations, seed the hash).
 */

const SESSION_KEY = 'invflux:app:workspace';
const LOCAL_KEY = 'invflux:app:workspace:last';
// v2: the tab model became browser-style pinned + open rows (was `tabs` + `permanentOrder`). A v1
// snapshot is simply ignored — the shell then re-seeds each browser's default pins from surfaceMode.
const VERSION = 2;

export interface WorkspaceSnapshot {
  version: number;
  /** Active route = `pathname + search`, e.g. `/workbench?search=x` (drives the new-tab seed). */
  active: string;
  /** Pinned tabs (left row), in user order. */
  pinned: TabRef[];
  /** Open (unpinned) tabs (right row), in user order. */
  open: TabRef[];
  /** Surfaces this browser has seen — so a new `always` surface pins once, without re-pinning a
   *  user-closed one. */
  seenSurfaces: string[];
  /** Per-surface remembered location suffix, e.g. `{ dispatch: '/AF3?queue=x' }`. */
  surfaces: Record<string, string>;
}

function parse(raw: string | null): WorkspaceSnapshot | null {
  if (null === raw) return null;
  try {
    const snap = JSON.parse(raw) as WorkspaceSnapshot;
    if (null === snap || VERSION !== snap.version || !Array.isArray(snap.pinned) || !Array.isArray(snap.open)) {
      return null;
    }
    return snap;
  } catch {
    return null;
  }
}

function read(storage: 'session' | 'local'): WorkspaceSnapshot | null {
  try {
    const s = 'session' === storage ? sessionStorage : localStorage;
    return parse(s.getItem('session' === storage ? SESSION_KEY : LOCAL_KEY));
  } catch {
    return null; // storage disabled / private mode → treat as absent
  }
}

/**
 * Persist the current workspace: sessionStorage (authoritative live) AND localStorage (last-good
 * default for the next new tab). Storage failures (quota / disabled / private mode) are swallowed —
 * persistence is a nicety, never load-bearing.
 */
export function writeWorkspace(snapshot: Omit<WorkspaceSnapshot, 'version'>): void {
  const raw = JSON.stringify({ version: VERSION, ...snapshot });
  try {
    sessionStorage.setItem(SESSION_KEY, raw);
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(LOCAL_KEY, raw);
  } catch {
    /* ignore */
  }
}

/**
 * The boot snapshot to restore: **sessionStorage first** (this tab's live workspace → F5 restores it
 * exactly), else **localStorage** (a brand-new tab seeds from the last session). `fromSession` tells
 * the caller which it was — only a non-session boot seeds the active route.
 */
export function readBootSnapshot(): { snapshot: WorkspaceSnapshot; fromSession: boolean } | null {
  const session = read('session');
  if (null !== session) return { snapshot: session, fromSession: true };
  const local = read('local');
  if (null !== local) return { snapshot: local, fromSession: false };
  return null;
}

/**
 * The route a brand-new tab should be seeded to ("resume where you last were"), or `null` to keep the
 * hash the tab was opened with. Only a **non-session** boot that **landed on the default** (empty /
 * `#` / `#/` hash) seeds; an F5 keeps its own hash, a deep-linked new tab keeps its deep-link.
 */
export function seedRouteFor(
  snapshot: WorkspaceSnapshot,
  fromSession: boolean,
  initialHash: string,
): string | null {
  const defaultLanding = '' === initialHash || '#' === initialHash || '#/' === initialHash;
  const active = snapshot.active;
  if (!fromSession && defaultLanding && 'string' === typeof active && '' !== active && '/' !== active) {
    return active;
  }
  return null;
}

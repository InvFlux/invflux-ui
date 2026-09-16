import { createMemoryHistory, type MemoryHistory } from '@solidjs/router';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

/**
 * Surfaces that own an INTERNAL router (a list/detail sub-navigation) rather than being a single
 * view. These can't run their own `HashRouter` embedded in the shell (two hash routers would contend
 * for `location.hash`), so the shell hands each a **MemoryRouter driven by a shell-owned
 * `MemoryHistory`** and bridges the *active* surface's memory location ↔ the browser hash.
 * Single-view surfaces (Workbench, Settings) are absent — they need no router and keep-alive alone
 * suffices.
 */
export const ROUTED_SURFACES = new Set<string>(['dispatch', 'procurement']);

/** One MemoryHistory per routed surface, created lazily and kept for the app's lifetime. */
const histories = new Map<string, MemoryHistory>();

/**
 * A reactive mirror of each routed surface's current sub-location (`/`, `/AF3B?queue=x`), updated by
 * the bridge on every internal navigation — even while the surface is inactive. It lets a surface's
 * tab / launcher link point at *where the surface currently is* (keep-alive resume), instead of the
 * shell rewriting the URL after the fact (which fought the browser's Back/Forward).
 */
const locSignals = new Map<string, [Accessor<string>, (v: string) => void]>();

function locSignal(id: string): [Accessor<string>, (v: string) => void] {
  let s = locSignals.get(id);
  if (!s) {
    const [get, set] = createSignal('/');
    s = [get, set];
    locSignals.set(id, s);
  }
  return s;
}

/**
 * Publish a surface's current location suffix (the part after `/id`), so its tab / launcher link can
 * resume it. Routed surfaces publish a sub-path (`/AF3B?queue=x`); filterable single-view surfaces
 * (the Workbench) publish just their query (`?search=x`). `'/'` (the default) means "no suffix".
 */
export function setSurfaceLocation(id: string, loc: string): void {
  locSignal(id)[1](loc);
}

/**
 * Snapshot every surface's remembered location suffix (the `locSignals` mirror) for §12.4 workspace
 * persistence — `{ workbench: '?search=x', dispatch: '/AF3?queue=x' }`. Skips surfaces still at the
 * `'/'` default (nothing worth persisting). Reactive: reading each signal tracks it, so a writer
 * effect re-runs when any surface navigates.
 */
export function snapshotSurfaceLocations(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, sig] of locSignals) {
    const loc = sig[0]();
    if ('' !== loc && '/' !== loc) out[id] = loc;
  }
  return out;
}

/**
 * Restore persisted surface locations at boot (§12.4), BEFORE the shell's URL bridge runs — so the
 * bridge's cold-load seed still overrides the *active* surface from the hash, while inactive surfaces
 * keep their restored location (their tab link resumes it; a routed surface's memory router mounts
 * there). A malformed value is skipped.
 */
export function restoreSurfaceLocations(map: Record<string, string>): void {
  if (null === map || 'object' !== typeof map) return;
  for (const [id, loc] of Object.entries(map)) {
    if ('string' !== typeof loc || '' === loc) continue;
    setSurfaceLocation(id, loc);
    if (ROUTED_SURFACES.has(id)) surfaceHistory(id).set({ value: loc, replace: true });
  }
}

/**
 * The href a surface's tab / launcher entry should point at: `/id` plus whatever suffix the surface
 * last published (so opening it *resumes* where you left off — keep-alive; §12). `'/'` or empty →
 * plain `/id`. Reactive — reads the surface's location signal. Crucially, this is why clicking the
 * tab of a filtered surface does NOT clear its filter: the link already carries it, so the nav is a
 * no-op rather than a bare `/id` that the surface would read as "empty filter".
 */
export function surfaceHref(id: string): string {
  const loc = locSignal(id)[0]();
  return `/${id}${'/' === loc || '' === loc ? '' : loc}`;
}

/**
 * The shell-owned `MemoryHistory` for a routed surface (created once). Because it persists across tab
 * switches, the surface's sub-location (which order, which filter) survives leaving and returning —
 * keep-alive of the router state, for free. Both the section wrapper (passes it to the surface's App)
 * and the shell bridge read the same instance.
 */
export function surfaceHistory(id: string): MemoryHistory {
  let h = histories.get(id);
  if (!h) {
    h = createMemoryHistory();
    histories.set(id, h);
  }
  return h;
}

/**
 * The sub-path a surface's memory router should hold for a given app-router location, or `null` if
 * the app location is not under this surface. `/dispatch` → `/`; `/dispatch/AF3B?queue=x` →
 * `/AF3B?queue=x`. Keeps the surface's internal routes prefix-free (it only ever sees `/`, `/:id`).
 */
export function surfaceSubPath(id: string, pathname: string, search: string): string | null {
  const base = `/${id}`;
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return null;
  const sub = pathname.slice(base.length) || '/';
  return sub + (search ?? '');
}

/**
 * Stop the shell's HashRouter from hijacking a routed surface's internal links.
 *
 * Both the shell HashRouter and the surface's MemoryRouter install a **bubble-phase** document click
 * listener (solid-router `setupNativeEvents`). The shell's is registered first (it mounts first) and
 * its `basePath` is `/` (permissive), so it matches the surface's root-relative links (`/019eeb…`),
 * `preventDefault`s, and navigates the *app* to `#/019eeb…` before the MemoryRouter ever sees the
 * click. We pre-empt it with a **capture-phase** listener on the surface container: for an
 * intra-surface link we drive the surface's own history and `stopImmediatePropagation` so neither
 * document listener runs. Returns a cleanup fn.
 */
export function interceptSurfaceLinks(container: HTMLElement, history: MemoryHistory): () => void {
  const onClick = (e: MouseEvent): void => {
    if (e.defaultPrevented || 0 !== e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    const a = e
      .composedPath()
      .find((el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement);
    if (!a) return;
    const href = a.getAttribute('href');
    // Intra-surface (memory-router) links are single root-relative paths ('/…', never '//host' or a
    // hash link). Anything else (external, download, new-tab target) is left to normal handling.
    if (!href || !href.startsWith('/') || href.startsWith('//') || a.target) return;
    if (
      a.hasAttribute('download') ||
      (a.getAttribute('rel') ?? '').split(/\s+/).includes('external')
    )
      return;
    e.preventDefault();
    e.stopImmediatePropagation();
    history.set({ value: href, replace: a.hasAttribute('replace') });
  };
  container.addEventListener('click', onClick, { capture: true });
  return () => container.removeEventListener('click', onClick, { capture: true });
}

/**
 * Wire the two-way bridge between a routed surface's shell-owned history and the browser hash. Call
 * once per routed surface from the shell (inside the app Router's owner, so `createEffect`/`onCleanup`
 * are scoped). Only the *active* surface syncs, so inactive surfaces keep their frozen location
 * (keep-alive); the equality guards prevent feedback loops.
 */
export function bridgeSurfaceHistory(opts: {
  id: string;
  history: MemoryHistory;
  activeId: () => string;
  pathname: () => string;
  search: () => string;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}): void {
  const { id, history, activeId, pathname, search, navigate } = opts;
  const setLoc = locSignal(id)[1];

  // Seed from the current URL once (cold load / deep link), before the surface first mounts.
  const seed = surfaceSubPath(id, pathname(), search());
  if (null !== seed && history.get() !== seed) history.set({ value: seed, replace: true });
  setLoc(history.get());

  // surface → hash: the active surface's internal navigation mirrors into the browser hash so the URL
  // is a shareable, reload-restorable deep-link (§12.1). The location signal is updated ALWAYS (even
  // inactive) so the surface's tab / launcher link can resume where it left off (surfaceHref).
  const unlisten = history.listen((sub) => {
    setLoc(sub);
    if (activeId() !== id) return;
    const target = `/${id}${'/' === sub ? '' : sub}`;
    if (pathname() + search() !== target) navigate(target);
  });
  onCleanup(unlisten);

  // hash → surface: mirror the URL (deep-link, paste, browser Back/Forward, tab click) into the
  // surface's history. NO "restore the remembered location" heuristic here — the browser history
  // stack IS the nav stack, so Back to `/dispatch` must show the queue, not bounce to the last order
  // (resume is instead carried by surfaceHref on the tab/launcher link). `replace` so the memory
  // history only tracks the current location and never pushes entries that fight Back/Forward.
  createEffect(() => {
    if (activeId() !== id) return;
    const sub = surfaceSubPath(id, pathname(), search());
    if (null !== sub && history.get() !== sub) history.set({ value: sub, replace: true });
  });
}

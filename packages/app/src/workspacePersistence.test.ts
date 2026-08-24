import { describe, it, expect, beforeEach } from 'vitest';
import { readBootSnapshot, seedRouteFor, writeWorkspace } from './workspacePersistence';

/** Minimal in-memory Storage stand-in (node vitest has no Web Storage). */
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

const g = globalThis as unknown as { sessionStorage: MemStorage; localStorage: MemStorage };

const SNAP = {
  active: '/workbench?search=VEH',
  pinned: [{ path: '/workbench', title: 'Workbench' }],
  open: [{ path: '/ledger/611', title: 'Journal #611' }],
  seenSurfaces: ['workbench', 'dispatch', 'procurement'],
  surfaces: { dispatch: '/AF3?queue=x' },
};

beforeEach(() => {
  g.sessionStorage = new MemStorage();
  g.localStorage = new MemStorage();
});

describe('readBootSnapshot (§12.4 storage priority)', () => {
  it('prefers sessionStorage (F5 = this tab\'s live workspace)', () => {
    writeWorkspace(SNAP); // writes BOTH stores
    const boot = readBootSnapshot();
    expect(boot?.fromSession).toBe(true);
    expect(boot?.snapshot.pinned.map((t) => t.path)).toEqual(['/workbench']);
    expect(boot?.snapshot.open.map((t) => t.path)).toEqual(['/ledger/611']);
  });

  it('falls back to localStorage when sessionStorage is empty (a brand-new tab)', () => {
    writeWorkspace(SNAP);
    g.sessionStorage = new MemStorage(); // new browser tab: empty sessionStorage, local persists
    const boot = readBootSnapshot();
    expect(boot?.fromSession).toBe(false);
    expect(boot?.snapshot.active).toBe('/workbench?search=VEH');
  });

  it('ignores a snapshot from an older schema version', () => {
    g.localStorage.setItem('invflux:app:workspace:last', JSON.stringify({ version: 0, ...SNAP }));
    expect(readBootSnapshot()).toBeNull();
  });

  it('returns null when nothing is stored', () => {
    expect(readBootSnapshot()).toBeNull();
  });
});

describe('seedRouteFor (§12.4 new-tab active seed)', () => {
  const snap = { version: 2, ...SNAP };

  it('seeds the last-active route for a new tab that landed on the default hash', () => {
    expect(seedRouteFor(snap, false, '#/')).toBe('/workbench?search=VEH');
    expect(seedRouteFor(snap, false, '')).toBe('/workbench?search=VEH');
    expect(seedRouteFor(snap, false, '#')).toBe('/workbench?search=VEH');
  });

  it('does NOT seed an F5 (session boot keeps its own hash)', () => {
    expect(seedRouteFor(snap, true, '#/')).toBeNull();
  });

  it('does NOT seed a deep-linked new tab (keep the hash it was opened with)', () => {
    expect(seedRouteFor(snap, false, '#/ledger/22')).toBeNull();
  });

  it('does not seed when the last-active route is itself the default', () => {
    expect(seedRouteFor({ ...snap, active: '/' }, false, '#/')).toBeNull();
    expect(seedRouteFor({ ...snap, active: '' }, false, '#/')).toBeNull();
  });
});

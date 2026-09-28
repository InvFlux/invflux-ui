import { describe, expect, it } from 'vitest';
import {
  commitNavEntitlements,
  commitNavRegistry,
  publishCommitNavEntitlements,
  resolveCommitNav,
  type CommitNavContext,
} from './gridCommitNav';

/** A commit context with harmless defaults; each test overrides only what it is about. */
const ctx = (over: Partial<CommitNavContext> = {}): CommitNavContext => ({
  gridId: 'po.receive',
  columnId: 'received',
  rowId: '7',
  move: 'down',
  filterText: '085805210465',
  visibleCount: 1,
  setFilterText: () => {},
  selectCellByRowId: () => {},
  focusFilter: () => {},
  ...over,
});

describe('commit-navigation registry', () => {
  it('leaves the grid alone when nothing is registered — the base install', () => {
    expect(resolveCommitNav(ctx())).toBe(false);
  });

  it('lets a rule claim the move, and reports that it did', () => {
    const seen: string[] = [];
    commitNavRegistry.register({
      name: 'claims',
      handle: (c) => {
        seen.push(c.gridId);
        return true;
      },
    });

    expect(resolveCommitNav(ctx())).toBe(true);
    expect(seen).toEqual(['po.receive']);

    // Neutralise for the rest of the file — the registry is a module singleton.
    commitNavRegistry.register({ name: 'claims', handle: () => false });
  });

  it('skips a rule whose entitlement is off, and asks again once it is on', () => {
    let licensed = false;
    publishCommitNavEntitlements(() => ({ scannerOps: licensed }));
    commitNavRegistry.register({
      name: 'gated',
      enabled: () => true === commitNavEntitlements().scannerOps,
      handle: () => true,
    });

    expect(resolveCommitNav(ctx())).toBe(false);

    // The same rule object, re-asked: `enabled` is evaluated per commit, not captured at
    // registration — which is what lets a lapsed licence stop behaving as though it were paid.
    licensed = true;
    expect(resolveCommitNav(ctx())).toBe(true);

    commitNavRegistry.register({ name: 'gated', handle: () => false });
    publishCommitNavEntitlements(() => ({}));
  });

  it('consults rules in `order`, and stops at the first that claims the commit', () => {
    const ran: string[] = [];
    commitNavRegistry.register({
      name: 'late',
      order: 20,
      handle: () => {
        ran.push('late');
        return true;
      },
    });
    commitNavRegistry.register({
      name: 'early',
      order: 10,
      handle: () => {
        ran.push('early');
        return true;
      },
    });

    expect(resolveCommitNav(ctx())).toBe(true);
    expect(ran).toEqual(['early']);

    commitNavRegistry.register({ name: 'early', handle: () => false });
    commitNavRegistry.register({ name: 'late', handle: () => false });
  });

  it('re-registering a name replaces the rule rather than adding a second', () => {
    let calls = 0;
    commitNavRegistry.register({
      name: 'once',
      handle: () => {
        calls++;
        return false;
      },
    });
    commitNavRegistry.register({
      name: 'once',
      handle: () => {
        calls++;
        return false;
      },
    });

    resolveCommitNav(ctx());
    expect(calls).toBe(1);
  });
});

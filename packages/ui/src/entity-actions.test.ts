import { describe, expect, it, vi } from 'vitest';
import {
  createEntityActionRegistry,
  DEFAULT_PRIMARY_WEIGHT,
  type EntityAction,
  type EntityActionContext,
  type ResolvedAction,
} from './entity-actions';

interface PoCtx extends EntityActionContext {
  stage: string;
}
const ctx = (over: Partial<PoCtx> = {}): PoCtx => ({ stage: 'in_transit', ...over });

const base = (over: Partial<EntityAction<PoCtx>> & { id: string }): EntityAction<PoCtx> => ({
  label: over.id,
  run: () => {},
  ...over,
});

describe('entity-action registry', () => {
  it('scopes are independent; re-registering an id overrides in place', () => {
    const r = createEntityActionRegistry();
    r.register<PoCtx>('po.detail', base({ id: 'x', label: 'old' }));
    r.register<PoCtx>('po.detail', base({ id: 'x', label: 'new' }));
    r.register<PoCtx>('order.detail', base({ id: 'x', label: 'other-scope' }));
    expect(r.list('po.detail')).toHaveLength(1);
    expect(r.list('po.detail')[0].label).toBe('new');
    expect(r.list('order.detail')).toHaveLength(1);
  });

  it('hides isAvailable=false; disables with a reason otherwise', () => {
    const r = createEntityActionRegistry();
    r.register<PoCtx>('po.detail', base({ id: 'hidden', isAvailable: () => false }));
    r.register<PoCtx>('po.detail', base({ id: 'print' }));
    r.register<PoCtx>('po.detail', base({ id: 'recv', disabledReason: () => 'Count every line first' }));
    const res = r.resolve<PoCtx>('po.detail', ctx());
    const ids = res.secondary.map((a) => a.id);
    expect(ids).toEqual(['print', 'recv']);
    expect(res.secondary.find((a) => a.id === 'recv')?.disabledReason).toBe('Count every line first');
    expect(res.secondary.find((a) => a.id === 'print')?.disabledReason).toBeUndefined();
  });

  it('resolves hint, static or context-derived, independently of disabledReason', () => {
    const r = createEntityActionRegistry();
    r.register<PoCtx>('po.detail', base({ id: 'plain' }));
    r.register<PoCtx>('po.detail', base({ id: 'static', hint: 'Only records that you sent it' }));
    r.register<PoCtx>('po.detail', base({ id: 'derived', hint: (c) => `sends nothing at ${c.stage}` }));
    // A hint and a reason coexist on the resolved action; the renderer, not the resolver, picks.
    r.register<PoCtx>('po.detail', base({ id: 'both', hint: 'what it does', disabledReason: () => "why you can't" }));
    const res = r.resolve<PoCtx>('po.detail', ctx({ stage: 'in_prep' }));
    const byId = (id: string): ResolvedAction | undefined => res.secondary.find((a) => a.id === id);
    expect(byId('plain')?.hint).toBeUndefined();
    expect(byId('static')?.hint).toBe('Only records that you sent it');
    expect(byId('derived')?.hint).toBe('sends nothing at in_prep');
    expect(byId('both')?.hint).toBe('what it does');
    expect(byId('both')?.disabledReason).toBe("why you can't");
  });

  it('resolves context-derived label/icon/order and sorts by (order, registration)', () => {
    const r = createEntityActionRegistry();
    r.register<PoCtx>('po.detail', base({ id: 'b', order: 100 }));
    r.register<PoCtx>('po.detail', base({ id: 'a', order: () => 50, label: (c) => `A-${c.stage}` }));
    r.register<PoCtx>('po.detail', base({ id: 'c', order: 100 })); // ties b → registration order
    const res = r.resolve<PoCtx>('po.detail', ctx({ stage: 'received' }));
    expect(res.secondary.map((a) => a.id)).toEqual(['a', 'b', 'c']);
    expect(res.secondary[0].label).toBe('A-received');
  });

  it('destructive actions render last, never as the headline', () => {
    const r = createEntityActionRegistry();
    r.register<PoCtx>('po.detail', base({ id: 'cancel', group: 'destructive', owner: 'core', promoteWhen: () => 9999 }));
    r.register<PoCtx>('po.detail', base({ id: 'print' }));
    const res = r.resolve<PoCtx>('po.detail', ctx());
    expect(res.primary).toBeNull(); // destructive can't headline even with a huge weight
    expect(res.destructive.map((a) => a.id)).toEqual(['cancel']);
    expect(res.secondary.map((a) => a.id)).toEqual(['print']);
  });

  it('group:primary (core) headlines by default weight; excluded from overflow', () => {
    const r = createEntityActionRegistry();
    r.register<PoCtx>('po.detail', base({ id: 'receive', group: 'primary', owner: 'core' }));
    r.register<PoCtx>('po.detail', base({ id: 'print' }));
    const res = r.resolve<PoCtx>('po.detail', ctx());
    expect(res.primary?.id).toBe('receive');
    expect(res.secondary.map((a) => a.id)).toEqual(['print']);
  });

  it('promoteWhen contests the headline: highest weight wins, false declines', () => {
    const r = createEntityActionRegistry();
    r.register<PoCtx>('po.detail', base({ id: 'receive', group: 'primary', owner: 'core' })); // weight 500
    r.register<PoCtx>(
      'po.detail',
      base({ id: 'replenish', promoteWhen: (c) => (c.stage === 'in_reception' ? 550 : false) }),
    );
    // No single-supplier context → replenish declines, core primary headlines.
    expect(r.resolve<PoCtx>('po.detail', ctx({ stage: 'received' })).primary?.id).toBe('receive');
    // Contesting context → replenish (550) out-weighs the baseline (500).
    const won = r.resolve<PoCtx>('po.detail', ctx({ stage: 'in_reception' }));
    expect(won.primary?.id).toBe('replenish');
    expect(won.secondary.map((a) => a.id)).toContain('receive');
  });

  it('a locked core headline is uncontestable by any weight', () => {
    const r = createEntityActionRegistry();
    r.register<PoCtx>('po.detail', base({ id: 'receive', group: 'primary', owner: 'core', locked: true }));
    r.register<PoCtx>('po.detail', base({ id: 'greedy', promoteWhen: () => 100000 }));
    expect(r.resolve<PoCtx>('po.detail', ctx()).primary?.id).toBe('receive');
  });

  it('demotes add-on primary/destructive/locked to secondary with a warning', () => {
    const r = createEntityActionRegistry();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    r.register<PoCtx>('po.detail', base({ id: 'sneaky', group: 'primary', locked: true })); // owner defaults addon
    const res = r.resolve<PoCtx>('po.detail', ctx());
    expect(res.primary).toBeNull(); // demoted → not a headline candidate
    expect(res.secondary.map((a) => a.id)).toEqual(['sneaky']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('exposes the default primary weight', () => {
    expect(DEFAULT_PRIMARY_WEIGHT).toBe(500);
  });
});

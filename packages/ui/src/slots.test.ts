import { describe, expect, it } from 'vitest';
import { createSlotRegistry } from './slots';

const noop = () => null;

describe('slot registry', () => {
  it('returns [] for an unknown slot', () => {
    const reg = createSlotRegistry();
    expect(reg.get('nav.section')).toEqual([]);
  });

  it('orders contributions by `order`, ties keep registration order', () => {
    const reg = createSlotRegistry();
    reg.register('nav.section', { id: 'b', component: noop, order: 100 });
    reg.register('nav.section', { id: 'a', component: noop, order: 50 });
    reg.register('nav.section', { id: 'c', component: noop, order: 100 }); // tie with b → after b
    reg.register('nav.section', { id: 'd', component: noop }); // default order 100 → after c

    expect(reg.get('nav.section').map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('re-registering the same id overrides in place (no duplicate)', () => {
    const reg = createSlotRegistry();
    const first = () => null;
    const second = () => null;
    reg.register('dashboard.widget', { id: 'x', component: first });
    reg.register('dashboard.widget', { id: 'x', component: second, order: 10 });

    const list = reg.get('dashboard.widget');
    expect(list).toHaveLength(1);
    expect(list[0].component).toBe(second);
  });

  it('lists every slot key with a contribution', () => {
    const reg = createSlotRegistry();
    reg.register('nav.section', { id: 'a', component: noop });
    reg.register('po.detail.tab', { id: 'b', component: noop });
    expect(reg.slotKeys().sort()).toEqual(['nav.section', 'po.detail.tab']);
  });

  it('preserves an `enabled` gate on the contribution for the shell to apply', () => {
    const reg = createSlotRegistry();
    reg.register('nav.section', { id: 'gated', component: noop, enabled: () => false });
    expect(reg.get('nav.section')[0].enabled?.()).toBe(false);
  });
});

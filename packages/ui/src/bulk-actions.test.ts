import { describe, expect, it } from 'vitest';
import { createBulkActionRegistry, type BulkActionContext } from './bulk-actions';

const ctx = (over: Partial<BulkActionContext> = {}): BulkActionContext => ({
  selectedSubjectIds: [],
  activeFilters: {},
  ...over,
});

describe('bulk-action registry', () => {
  it('lists actions ordered by `order` then registration', () => {
    const reg = createBulkActionRegistry();
    reg.register({ id: 'b', label: 'B', order: 100, run: () => {} });
    reg.register({ id: 'a', label: 'A', order: 50, run: () => {} });
    reg.register({ id: 'c', label: 'C', order: 100, run: () => {} }); // tie with b → after b
    expect(reg.list().map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('re-registering an id overrides in place', () => {
    const reg = createBulkActionRegistry();
    reg.register({ id: 'x', label: 'old', run: () => {} });
    reg.register({ id: 'x', label: 'new', run: () => {} });
    expect(reg.list()).toHaveLength(1);
    expect(reg.get('x')?.label).toBe('new');
  });

  it('run receives the selection + active filters', () => {
    const reg = createBulkActionRegistry();
    let seen: BulkActionContext | null = null;
    reg.register({ id: 'go', label: 'Go', run: (c) => (seen = c) });
    reg.get('go')!.run(ctx({ selectedSubjectIds: [1, 2] }));
    expect(seen!.selectedSubjectIds).toEqual([1, 2]);
  });

  it('isEnabled gates availability against the context', () => {
    const reg = createBulkActionRegistry();
    reg.register({
      id: 'single-supplier',
      label: 'Create PO',
      isEnabled: (c) => Array.isArray(c.activeFilters.suppliers) && c.activeFilters.suppliers.length === 1,
      run: () => {},
    });
    const action = reg.get('single-supplier')!;
    expect(action.isEnabled!(ctx({ activeFilters: { suppliers: ['acme'] } }))).toBe(true);
    expect(action.isEnabled!(ctx({ activeFilters: { suppliers: ['a', 'b'] } }))).toBe(false);
    expect(action.isEnabled!(ctx())).toBe(false);
  });
});

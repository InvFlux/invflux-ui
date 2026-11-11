import { describe, expect, it, vi } from 'vitest';

// The shared package's entry needs a DOM; the binding only reaches for the WordPress page links.
vi.mock('@invflux/ui', () => ({ wordpressHostNav: { pageHref: () => null } }));
// One surface this user may open, one registered that they may not.
vi.mock('./surfaceCatalog', () => ({
  allSurfaceIds: () => ['workbench', 'procurement'],
  surfaceCatalog: () => [{ id: 'workbench', label: 'Workbench', component: () => null }],
}));

const { unifiedHostNav } = await import('./hostNav');

describe('unifiedHostNav.canOpen', () => {
  it('opens a route under a surface this user can see', () => {
    expect(unifiedHostNav.canOpen?.('/workbench')).toBe(true);
    expect(unifiedHostNav.canOpen?.('workbench/view/3')).toBe(true);
  });

  it('refuses a route under a surface this user cannot see', () => {
    expect(unifiedHostNav.canOpen?.('/procurement/purchase-orders/117')).toBe(false);
  });

  it('leaves a route outside every surface alone', () => {
    expect(unifiedHostNav.canOpen?.('/ledger/32')).toBe(true);
  });
});

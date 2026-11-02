import { describe, expect, it } from 'vitest';
import { bridgeRoutes, isBridge, skusOnSale } from './bridge';

describe('roadmap bridge detection', () => {
  it('flags a bundle sold as a bridge', () => {
    expect(isBridge({ sku: 'bridge-oms-lite' })).toBe(true);
  });

  it('does not flag the base, Pro or an add-on, which are not "included in Pro"', () => {
    expect(isBridge({ sku: 'essentials' })).toBe(false);
    expect(isBridge({ sku: 'pro' })).toBe(false);
    expect(isBridge({ sku: 'addon-costing' })).toBe(false);
  });

  it('does not flag a feature, which has no product of its own', () => {
    expect(isBridge({ sku: null })).toBe(false);
  });
});

describe('roadmap bridge pill routes', () => {
  const bridge = { sku: 'bridge-scanner-ops' };
  const sale = (...skus: string[]) => new Set(skus);

  it('names no route while neither Pro nor the bridge is on sale', () => {
    expect(bridgeRoutes(bridge, sale())).toBeNull();
  });

  it('names only Pro while the bridge is not sold on its own yet', () => {
    expect(bridgeRoutes(bridge, sale('pro'))).toBe('pro');
  });

  it('names only the bridge while Pro is not on sale', () => {
    expect(bridgeRoutes(bridge, sale('bridge-scanner-ops'))).toBe('own');
  });

  it('names both once both are on sale', () => {
    expect(bridgeRoutes(bridge, sale('pro', 'bridge-scanner-ops'))).toBe('both');
  });

  it('never gives a pill to what is not a bridge', () => {
    expect(bridgeRoutes({ sku: 'addon-costing' }, sale('pro', 'addon-costing'))).toBeNull();
  });
});

describe('what the catalog has on sale', () => {
  it('counts only what is available now', () => {
    const onSale = skusOnSale([
      { sku: 'pro', availability: 'available' },
      { sku: 'bridge-pdj', availability: 'coming_soon' },
      { sku: 'bridge-kos', availability: 'retired' },
    ]);
    expect([...onSale]).toEqual(['pro']);
  });

  it('never offers a bridge on its own when the catalog does not list it', () => {
    const onSale = skusOnSale([{ sku: 'pro', availability: 'available' }]);
    expect(bridgeRoutes({ sku: 'bridge-oms-lite' }, onSale)).toBe('pro');
  });

  it('sells nothing while the catalog is unread', () => {
    expect(skusOnSale(undefined).size).toBe(0);
  });
});

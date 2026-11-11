import { describe, expect, it } from 'vitest';
import { type HostNav, linksTo } from './hostNav';

const nav = (canOpen?: (route: string) => boolean): HostNav => ({
  routeHref: (route) => `#${route}`,
  pageHref: () => null,
  opensNewTab: false,
  ...(canOpen ? { canOpen } : {}),
});

describe('linksTo', () => {
  it('links where the host says the route opens', () => {
    expect(
      linksTo(
        nav(() => true),
        '/procurement/purchase-orders/1',
      ),
    ).toBe(true);
  });

  it('does not link where the host refuses the route', () => {
    expect(
      linksTo(
        nav(() => false),
        '/procurement/purchase-orders/1',
      ),
    ).toBe(false);
  });

  it('links on a host that cannot tell', () => {
    expect(linksTo(nav(), '/procurement/purchase-orders/1')).toBe(true);
  });

  it('does not link without a host', () => {
    expect(linksTo(undefined, '/procurement/purchase-orders/1')).toBe(false);
  });
});

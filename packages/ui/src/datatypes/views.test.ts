import { describe, it, expect } from 'vitest';
import { productTypeKind, computeLinkModel, type LinkHostNav } from './views';

const nav: LinkHostNav = {
  routeHref: (route, query) => `#${route}${query ? `?${query}` : ''}`,
  pageHref: (page) => `admin.php?page=${page}`,
  opensNewTab: false,
};

describe('computeLinkModel (link datatype)', () => {
  const ORDERS = { route: '/dispatch', query: 'subject_ids={orders_subject_ids}&workflow_state=Active', hideWhen: 'zero' as const };
  const LEDGER = { route: '/ledger/{subjectId}', label: 'View', hideForRole: 'parent' };

  it("builds an in-app orders link, filling {orders_subject_ids} from the row's extra bag", () => {
    const m = computeLinkModel(ORDERS, 3, { extra: { orders_subject_ids: '12' } }, nav);
    expect(m).toEqual({ href: '#/dispatch?subject_ids=12&workflow_state=Active', label: '3', external: false });
  });

  it('hides (em-dash) when hideWhen:zero and the count is 0', () => {
    expect(computeLinkModel(ORDERS, 0, { extra: {} }, nav)).toBe('hide');
  });

  it('renders the value UNLINKED when a query token resolves empty (aggregate parent, no subject list)', () => {
    const m = computeLinkModel(ORDERS, 5, { extra: {} }, nav);
    expect(m).toEqual({ href: null, label: '5', external: false });
  });

  it('builds a ledger link with a static label and a path-templated subjectId', () => {
    expect(computeLinkModel(LEDGER, undefined, { subjectId: 32, role: 'variation' }, nav)).toEqual({
      href: '#/ledger/32',
      label: 'View',
      external: false,
    });
  });

  it('hides when a PATH token resolves empty (no subject → no ledger target)', () => {
    expect(computeLinkModel(LEDGER, undefined, { subjectId: undefined, role: 'simple' }, nav)).toBe('hide');
  });

  it('hides for a row whose role is in hideForRole (a variable parent has no ledger)', () => {
    expect(computeLinkModel(LEDGER, undefined, { subjectId: 32, role: 'parent' }, nav)).toBe('hide');
  });

  it('supports a host admin-page provenance, appending the query with the right separator', () => {
    const m = computeLinkModel({ page: 'my-addon', query: 'x=1' }, 'Open', {}, nav);
    expect(m).toEqual({ href: 'admin.php?page=my-addon&x=1', label: 'Open', external: false });
  });

  it('treats an absolute http(s) url as external (new tab) by default', () => {
    const m = computeLinkModel({ url: 'https://ex.com/{sku}' }, 1, { sku: 'AB' }, nav);
    expect(m).toEqual({ href: 'https://ex.com/AB', label: '1', external: true });
  });
});

describe('productTypeKind (Type column)', () => {
  it("uses role over the slug: a variation carries its parent's 'variable' slug but is a variation", () => {
    expect(productTypeKind('variable', { role: 'variation', productType: 'variable' })).toBe('variation');
  });

  it("maps a variable parent to 'variable'", () => {
    expect(productTypeKind('variable', { role: 'parent', productType: 'variable' })).toBe('variable');
  });

  it('falls back to the productType slug for non-hierarchical roles', () => {
    expect(productTypeKind('grouped', { role: 'simple', productType: 'grouped' })).toBe('grouped');
    expect(productTypeKind('external', { role: 'simple', productType: 'external' })).toBe('external');
  });

  it("defaults to 'simple' when nothing resolves", () => {
    expect(productTypeKind('', {})).toBe('simple');
    expect(productTypeKind(null, { role: 'simple' })).toBe('simple');
  });
});

import { describe, expect, it } from 'vitest';
import { workbenchValueFor, applyRowPatch } from './workbenchValueFor';
import type { WorkbenchRow } from '../workbenchGridTypes';

function row(overrides: Partial<WorkbenchRow> = {}): WorkbenchRow {
  return {
    subjectId: 1,
    wcProductId: 100,
    wcVariationId: null,
    productType: 'simple',
    name: 'Widget',
    sku: 'W-1',
    gtin: null,
    imageUrl: null,
    price: '9.99',
    salePrice: null,
    taxStatus: 'taxable',
    taxClass: '',
    shippingClass: null,
    weight: null,
    soldIndividually: false,
    backorders: 'no',
    catalogVisibility: 'visible',
    featured: false,
    postStatus: 'publish',
    reorderThreshold: null,
    reorderStatus: 'none',
    atp: 10,
    res: 2,
    ctd: 3,
    total: 15,
    ...overrides,
  };
}

describe('workbenchValueFor', () => {
  it('maps a core column id to its camelCase field', () => {
    expect(workbenchValueFor(row(), 'sale_price')).toBeNull();
    expect(workbenchValueFor(row({ salePrice: '5.00' }), 'sale_price')).toBe('5.00');
    expect(workbenchValueFor(row(), 'atp')).toBe(10);
  });

  it('reads taxonomy.{name} from the taxonomy bag ([] when absent)', () => {
    expect(workbenchValueFor(row(), 'taxonomy.brand')).toEqual([]);
    expect(workbenchValueFor(row({ taxonomy: { brand: [7, 8] } }), 'taxonomy.brand')).toEqual([
      7, 8,
    ]);
  });

  it('falls back to the extra bag for unknown column ids', () => {
    expect(workbenchValueFor(row({ extra: { lead_time: 14 } }), 'lead_time')).toBe(14);
    expect(workbenchValueFor(row(), 'lead_time')).toBeUndefined();
  });

  it('resolves product_type to the role-aware kind (so copy matches the icon view)', () => {
    // A variation carries its parent's "variable" slug, but its Type is "variation".
    expect(
      workbenchValueFor(row({ role: 'variation', productType: 'variable' }), 'product_type'),
    ).toBe('variation');
    expect(
      workbenchValueFor(row({ role: 'parent', productType: 'variable' }), 'product_type'),
    ).toBe('variable');
    expect(workbenchValueFor(row({ role: 'simple', productType: 'grouped' }), 'product_type')).toBe(
      'grouped',
    );
  });
});

describe('applyRowPatch (live-update merge, inverse of workbenchValueFor)', () => {
  it('patches core fields, routing column id → camelCase field', () => {
    const patched = applyRowPatch(row(), { atp: 4, total: 9, sale_price: '5.00' });
    expect(patched.atp).toBe(4);
    expect(patched.total).toBe(9);
    expect(patched.salePrice).toBe('5.00');
  });

  it('routes taxonomy.{name} to the taxonomy bag and unknown ids to the extra bag', () => {
    const patched = applyRowPatch(row(), { 'taxonomy.brand': [1], lead_time: 21 });
    expect(patched.taxonomy).toEqual({ brand: [1] });
    expect(patched.extra).toEqual({ lead_time: 21 });
  });

  it('is immutable — returns a fresh row, leaving the original untouched', () => {
    const original = row({ atp: 10 });
    const patched = applyRowPatch(original, { atp: 99 });
    expect(patched).not.toBe(original);
    expect(original.atp).toBe(10);
    expect(patched.atp).toBe(99);
  });

  it('round-trips through workbenchValueFor', () => {
    const patched = applyRowPatch(row(), { atp: 42, 'taxonomy.brand': [3], lead_time: 7 });
    expect(workbenchValueFor(patched, 'atp')).toBe(42);
    expect(workbenchValueFor(patched, 'taxonomy.brand')).toEqual([3]);
    expect(workbenchValueFor(patched, 'lead_time')).toBe(7);
  });
});

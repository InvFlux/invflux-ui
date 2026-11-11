import { describe, expect, it } from 'vitest';
import { availablePoLineColumns } from './poLineColumns';

const ids = (preReception: boolean, invoiced?: boolean): string[] =>
  availablePoLineColumns(preReception, invoiced).map((c) => c.id);

describe('availablePoLineColumns', () => {
  it('withholds the delivery columns until something can have been received', () => {
    expect(ids(true)).not.toContain('received');
    expect(ids(false)).toContain('received');
  });

  it('offers what the supplier billed only once an invoice is recorded', () => {
    expect(ids(false)).not.toContain('invoiced');
    expect(ids(false)).not.toContain('invoiced_cost');
    expect(ids(false, true)).toEqual(expect.arrayContaining(['invoiced', 'invoiced_cost']));
    // An invoice can come before the goods: billed figures do not wait for reception.
    expect(ids(true, true)).toEqual(expect.arrayContaining(['invoiced', 'invoiced_cost']));
  });

  it('keeps render order: billed quantity after the open one, billed price after the unit cost', () => {
    const all = ids(false, true);
    expect(all.indexOf('invoiced')).toBe(all.indexOf('open') + 1);
    expect(all.indexOf('invoiced_cost')).toBe(all.indexOf('unit_cost') + 1);
  });
});

import { describe, expect, it } from 'vitest';
import type { DirtyEdit, WorkbenchRow } from '../workbenchGridTypes';
import {
  heldToPricePair,
  pricePairFollowUps,
  salePriceError,
  salePriceRejected,
} from './pricePair';
import type { CellPatch } from './useDirtyCells';

const row = (over: Partial<WorkbenchRow> = {}): WorkbenchRow =>
  ({
    subjectId: 1,
    name: 'Tent',
    sku: 'T-1',
    productType: 'simple',
    role: 'simple',
    price: '20.00',
    salePrice: '15.00',
    ...over,
  }) as WorkbenchRow;

const regular = (next: unknown, over: Partial<CellPatch> = {}): CellPatch => ({
  subjectId: 1,
  columnId: 'price',
  original: '20.00',
  next,
  name: 'Tent',
  sku: 'T-1',
  ...over,
});

const followUps = (
  patches: CellPatch[],
  r: WorkbenchRow = row(),
  staged: Record<string, DirtyEdit> = {},
): CellPatch[] =>
  pricePairFollowUps(
    patches,
    (id) => (id === r.subjectId ? r : undefined),
    (_id, columnId) => staged[columnId],
  );

describe('salePriceRejected — as WooCommerce judges the pair on save', () => {
  it.each([
    ['20', '20', true],
    ['20', '25', true],
    ['20', '19.99', false],
    ['', '5', true],
    [null, '5', true],
    ['20', '', false],
    ['', '', false],
  ])('regular %s, sale %s → %s', (r, sale, rejected) => {
    expect(salePriceRejected(r, sale)).toBe(rejected);
  });
});

describe('salePriceError', () => {
  it('names the missing regular price apart from a sale price that is too high', () => {
    expect(salePriceError(row(), '', '5')).toMatch(/needs a regular price/);
    expect(salePriceError(row(), '20', '20')).toMatch(/below the regular price/);
    expect(salePriceError(row(), '20', '10')).toBeUndefined();
  });

  it('leaves a variable or grouped parent alone', () => {
    expect(heldToPricePair(row({ role: 'parent', productType: 'variable' }))).toBe(false);
    expect(heldToPricePair(row({ productType: 'grouped' }))).toBe(false);
    expect(heldToPricePair(row({ role: 'variation', productType: 'variable' }))).toBe(true);
    expect(salePriceError(row({ productType: 'grouped' }), '20', '25')).toBeUndefined();
  });
});

describe('pricePairFollowUps', () => {
  it('a regular price at or below the sale price stages the sale price cleared, linked', () => {
    for (const next of ['15', '12', '']) {
      expect(followUps([regular(next)])).toEqual([
        {
          subjectId: 1,
          columnId: 'sale_price',
          original: '15.00',
          next: '',
          linkedTo: 'price',
          name: 'Tent',
          sku: 'T-1',
        },
      ]);
    }
  });

  it('a regular price still above the sale price, or a product with no sale price, stages nothing', () => {
    expect(followUps([regular('18')])).toEqual([]);
    expect(followUps([regular('5')], row({ salePrice: null }))).toEqual([]);
  });

  it('a regular price back above the sale price drops the linked clear', () => {
    const linked = { original: '15.00', new: '', linkedTo: 'price' };
    expect(followUps([regular('25')], row(), { sale_price: linked })).toEqual([
      expect.objectContaining({ columnId: 'sale_price', original: '15.00', next: '15.00' }),
    ]);
    // Still below: the linked clear stays as it is, and nothing is staged again.
    expect(followUps([regular('10')], row(), { sale_price: linked })).toEqual([]);
  });

  it("never touches the merchant's own sale price, staged before or in the same write", () => {
    const own = { original: '15.00', new: '' };
    expect(followUps([regular('10')], row(), { sale_price: own })).toEqual([]);
    expect(followUps([regular('25')], row(), { sale_price: own })).toEqual([]);
    const ownSale = regular('9', { columnId: 'sale_price', original: '15.00' });
    expect(followUps([ownSale, regular('10')])).toEqual([]);
  });

  it('a variable or grouped parent gets no linked clear', () => {
    expect(followUps([regular('10')], row({ role: 'parent', productType: 'variable' }))).toEqual(
      [],
    );
  });
});

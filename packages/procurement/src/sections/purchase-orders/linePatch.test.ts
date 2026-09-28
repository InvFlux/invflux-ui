import { describe, expect, it } from 'vitest';
import { prunePatch } from './linePatch';
import type { PoLine } from './types';

const line = (over: Partial<PoLine> = {}): PoLine =>
  ({
    id: 1,
    subjectId: 5,
    qtyRequested: null,
    suggestedQty: 12,
    unitCost: null,
    listUnitCost: null,
    discountPct: null,
    note: null,
    ...over,
  }) as PoLine;

describe('prunePatch', () => {
  it('drops a clear on a cell that is already inheriting', () => {
    // The case the whole filter exists for: Del over a column where most cells are already empty.
    expect(prunePatch(line({ qtyRequested: null }), { qty_requested: null })).toBeNull();
  });

  it('keeps a clear on a cell that carries a number', () => {
    expect(prunePatch(line({ qtyRequested: 25 }), { qty_requested: null })).toEqual({
      qty_requested: null,
    });
  });

  it('does not confuse a typed zero with an empty cell', () => {
    // 0 means "order none of this" and null means "inherit the suggestion" — writing one where the
    // other stands is a real edit, and dropping it would lose an instruction the merchant gave.
    expect(prunePatch(line({ qtyRequested: null }), { qty_requested: 0 })).toEqual({
      qty_requested: 0,
    });
    expect(prunePatch(line({ qtyRequested: 0 }), { qty_requested: null })).toEqual({
      qty_requested: null,
    });
  });

  it('treats a scaled decimal and its plain form as the same price', () => {
    // The server returns "4.0000"; the cell offers back "4". A string compare would call that an
    // edit every time the cell was touched, and re-save the line forever.
    expect(prunePatch(line({ unitCost: '4.0000' }), { unit_cost: '4' })).toBeNull();
    expect(prunePatch(line({ unitCost: '4.0000' }), { unit_cost: '4.5' })).toEqual({
      unit_cost: '4.5',
    });
  });

  it('compares a discounted cost against the list price the cell shows', () => {
    // unitCost is net of the discount; the cost cell displays the list price, so that is the
    // baseline. Comparing against the net would report an edit on every repaint.
    const discounted = line({ unitCost: '9.0000', listUnitCost: '10.0000', discountPct: '10' });
    expect(prunePatch(discounted, { unit_cost: '10' })).toBeNull();
    expect(prunePatch(discounted, { unit_cost: '9' })).toEqual({ unit_cost: '9' });
  });

  it('keeps only the fields that moved out of a multi-field patch', () => {
    expect(
      prunePatch(line({ qtyRequested: 5, note: 'same' }), { qty_requested: 5, note: 'new' }),
    ).toEqual({
      note: 'new',
    });
  });

  it('drops a patch whose every field is unchanged', () => {
    expect(
      prunePatch(line({ qtyRequested: 5, note: 'same' }), { qty_requested: 5, note: 'same' }),
    ).toBeNull();
  });

  it('never drops a note edit on the strength of it looking numeric', () => {
    // '007' and '7' are different notes even though Number() calls them equal; a note is text.
    expect(prunePatch(line({ note: '7' }), { note: '007' })).toEqual({ note: '007' });
  });
});

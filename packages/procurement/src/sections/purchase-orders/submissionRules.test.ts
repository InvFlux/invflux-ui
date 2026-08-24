import { describe, expect, it } from 'vitest';
import { effectiveCost, pruneReason, submittableLines } from './submissionRules';
import type { PoLine } from './types';

/** A draft line carrying only the fields the submission rule reads. */
const line = (over: Partial<PoLine> & { id: number }): PoLine =>
  ({ requestedQty: 1, unitCost: '10.00', catalogUnitCost: null, ...over }) as PoLine;

describe('effectiveCost', () => {
  it('prefers the line override, falls back to the catalogue price, else null', () => {
    expect(effectiveCost(line({ id: 1, unitCost: '4.50', catalogUnitCost: '9.99' }))).toBe(4.5);
    expect(effectiveCost(line({ id: 2, unitCost: null, catalogUnitCost: '9.99' }))).toBe(9.99);
    expect(effectiveCost(line({ id: 3, unitCost: null, catalogUnitCost: null }))).toBeNull();
  });

  it('reads an explicit zero override as zero, not as "inherit"', () => {
    // '0.00' is falsy-ish once numeric, so a `||` fallback here would silently price the line
    // from the catalogue against the operator's explicit intent.
    expect(effectiveCost(line({ id: 4, unitCost: '0.00', catalogUnitCost: '9.99' }))).toBe(0);
  });
});

describe('pruneReason', () => {
  it('survives only with both a positive quantity and a positive effective price', () => {
    expect(pruneReason(line({ id: 1, requestedQty: 3, unitCost: '2.00' }))).toBeNull();
    expect(pruneReason(line({ id: 2, requestedQty: 3, unitCost: null, catalogUnitCost: '2.00' }))).toBeNull();
  });

  it('reports a missing quantity before a missing price, matching the server', () => {
    expect(pruneReason(line({ id: 3, requestedQty: 0 }))).toBe('zero_qty');
    expect(pruneReason(line({ id: 4, requestedQty: -2 }))).toBe('zero_qty');
    // Lacking both: the server's `zeroQty ? 'zero_qty' : 'no_price'` reports the quantity.
    expect(pruneReason(line({ id: 5, requestedQty: 0, unitCost: null, catalogUnitCost: null }))).toBe('zero_qty');
  });

  it('prunes a priceless or non-positively-priced line', () => {
    expect(pruneReason(line({ id: 6, unitCost: null, catalogUnitCost: null }))).toBe('no_price');
    expect(pruneReason(line({ id: 7, unitCost: '0.00' }))).toBe('no_price');
    expect(pruneReason(line({ id: 8, unitCost: '-1.00' }))).toBe('no_price');
  });
});

describe('submittableLines', () => {
  it('keeps the orderable lines and drops the rest', () => {
    const lines = [
      line({ id: 1, requestedQty: 2, unitCost: '5.00' }),
      line({ id: 2, requestedQty: 0, unitCost: '5.00' }),
      line({ id: 3, requestedQty: 4, unitCost: null, catalogUnitCost: null }),
      line({ id: 4, requestedQty: 1, unitCost: null, catalogUnitCost: '7.25' }),
    ];
    expect(submittableLines(lines).map((l) => l.id)).toEqual([1, 4]);
  });

  it('is empty for a draft whose rows all fail — the case that must disable the headline action', () => {
    const lines = [
      line({ id: 1, requestedQty: 0, unitCost: '5.00' }),
      line({ id: 2, requestedQty: 3, unitCost: null, catalogUnitCost: null }),
    ];
    expect(submittableLines(lines)).toHaveLength(0);
  });

  it('is empty for a draft with no rows at all', () => {
    expect(submittableLines([])).toHaveLength(0);
  });
});

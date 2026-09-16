import { describe, expect, it } from 'vitest';
import {
  computeNumericOp,
  decimalsForValues,
  isDeltaOp,
  isMoneyDataType,
  isNumericDataType,
  isPercentOp,
  parseNumericValue,
  roundTo,
} from './numericBulkOps';

const money = { decimals: 2 };
const whole = { decimals: 0 };

describe('computeNumericOp', () => {
  it('sets, ignoring the current value', () => {
    expect(computeNumericOp('set', 31.9, 10, money).value).toBe(10);
    expect(computeNumericOp('set', null, 10, money).value).toBe(10); // an empty cell can still be set
  });

  it('adds and subtracts in the column’s own units', () => {
    expect(computeNumericOp('add', 31.9, 5, money).value).toBe(36.9);
    expect(computeNumericOp('subtract', 31.9, 5, money).value).toBe(26.9);
  });

  it('increases and decreases by a percentage', () => {
    expect(computeNumericOp('increase-pct', 100, 10, money).value).toBe(110);
    expect(computeNumericOp('decrease-pct', 100, 10, money).value).toBe(90);
    expect(computeNumericOp('increase-pct', 31.9, 10, money).value).toBe(35.09);
  });

  /** The reason the undo operators exist at all — see the module docblock. */
  it('undoes a percentage by dividing, which is NOT the opposite sign', () => {
    // A +10% then a −10% does not return you to where you started...
    expect(computeNumericOp('decrease-pct', 110, 10, money).value).toBe(99);
    // ...but the undo operator does.
    expect(computeNumericOp('undo-increase-pct', 110, 10, money).value).toBe(100);
    expect(computeNumericOp('undo-decrease-pct', 90, 10, money).value).toBe(100);
  });

  /**
   * To within the column's granularity — NOT exactly. The intermediate is stored rounded to the
   * cent, so the sub-cent part of the original is already gone when the undo runs: 31.90 less 5%
   * stores 30.30, and dividing 5% back out of that gives 31.89. One cent, inherent, not a bug.
   */
  it('round-trips a percentage change back to within one unit of granularity', () => {
    for (const start of [9.99, 31.9, 100, 1250.5]) {
      for (const pct of [5, 10, 33.3]) {
        const up = computeNumericOp('increase-pct', start, pct, money).value!;
        expect(
          Math.abs(computeNumericOp('undo-increase-pct', up, pct, money).value! - start),
        ).toBeLessThanOrEqual(0.01);
        const down = computeNumericOp('decrease-pct', start, pct, money).value!;
        expect(
          Math.abs(computeNumericOp('undo-decrease-pct', down, pct, money).value! - start),
        ).toBeLessThanOrEqual(0.01);
      }
    }
  });

  /** The documented worked example of that one-cent loss, pinned so nobody "fixes" it later. */
  it('loses at most the rounding, and the worked example holds', () => {
    // 31.9 × 0.95 is 30.304999999999996 as a product — below the decimal midpoint, so it rounds
    // down however you round it. The lost fraction of a cent is what the undo cannot recover.
    const down = computeNumericOp('decrease-pct', 31.9, 5, money).value;
    expect(down).toBe(30.3);
    expect(computeNumericOp('undo-decrease-pct', down, 5, money).value).toBe(31.89);
  });

  it('reports the one impossible undo rather than dividing by zero', () => {
    // A 100% decrease takes every value to zero; nothing can be divided back out of it.
    const out = computeNumericOp('undo-decrease-pct', 0, 100, money);
    expect(out.value).toBeNull();
    expect(out.skipped).toBe('undefined-result');
    // Its mirror is fine: undoing a 100% *increase* is a halving.
    expect(computeNumericOp('undo-increase-pct', 200, 100, money).value).toBe(100);
  });

  it('skips a row with no current value, since a delta has nothing to act on', () => {
    for (const op of ['add', 'increase-pct', 'undo-increase-pct'] as const) {
      const out = computeNumericOp(op, null, 10, money);
      expect(out.value).toBeNull();
      expect(out.skipped).toBe('no-value');
    }
  });

  it('rounds to the column’s granularity', () => {
    expect(computeNumericOp('increase-pct', 10, 15, whole).value).toBe(12); // 11.5 → 12 units
    expect(computeNumericOp('increase-pct', 19.99, 7.5, money).value).toBe(21.49);
  });

  it('clamps into declared bounds and says that it did', () => {
    const out = computeNumericOp('subtract', 5, 20, { decimals: 2, min: 0 });
    expect(out.value).toBe(0);
    expect(out.clamped).toBe(true);
    expect(computeNumericOp('subtract', 50, 20, { decimals: 2, min: 0 }).clamped).toBe(false);
  });
});

describe('roundTo', () => {
  it('carries a decimal midpoint up, where Number(v.toFixed(d)) carries it down', () => {
    // These three are why the scaled form was chosen; `toFixed` gives 2.67 / 1.04 / 30.30.
    expect(roundTo(2.675, 2)).toBe(2.68);
    expect(roundTo(1.045, 2)).toBe(1.05);
    expect(roundTo(30.305, 2)).toBe(30.31);
  });

  it('cannot rescue a value already stored below its midpoint', () => {
    // 1.005 is held as 1.00499999999999989, so both forms round it down. Honest limit, not a bug.
    expect(roundTo(1.005, 2)).toBe(1);
  });

  it('clears ordinary float noise', () => {
    expect(roundTo(0.1 + 0.2, 2)).toBe(0.3);
    expect(roundTo(1.1 * 3, 2)).toBe(3.3);
  });

  it('rounds negatives away from zero, symmetrically', () => {
    expect(roundTo(-2.675, 2)).toBe(-2.68);
    expect(roundTo(-1.5, 0)).toBe(-2);
  });
});

describe('decimalsForValues', () => {
  it('fixes money at 2, matching how the grid renders it', () => {
    expect(decimalsForValues(true, ['10', '9.5'])).toBe(2);
  });

  it('keeps a whole-number column whole', () => {
    expect(decimalsForValues(false, ['10', '25', '3'])).toBe(0);
  });

  it('otherwise keeps the granularity the data already has, capped', () => {
    expect(decimalsForValues(false, ['1.5', '2.25'])).toBe(2);
    expect(decimalsForValues(false, ['1.1234567890123'])).toBe(6);
  });
});

describe('operator predicates', () => {
  it('separates set from the deltas, and amounts from percentages', () => {
    expect(isDeltaOp('set')).toBe(false);
    expect(isDeltaOp('add')).toBe(true);
    expect(isPercentOp('add')).toBe(false);
    expect(isPercentOp('undo-decrease-pct')).toBe(true);
  });

  it('recognises the numeric column families', () => {
    expect(isNumericDataType('decimal:money')).toBe(true);
    expect(isNumericDataType('number')).toBe(true);
    expect(isNumericDataType('number:receipt')).toBe(true);
    expect(isNumericDataType('text')).toBe(false);
    expect(isMoneyDataType('decimal:money')).toBe(true);
    expect(isMoneyDataType('number')).toBe(false);
  });
});

describe('parseNumericValue', () => {
  it('tolerates the string form decimals arrive in', () => {
    expect(parseNumericValue('31.90')).toBe(31.9);
    expect(parseNumericValue(31.9)).toBe(31.9);
    expect(parseNumericValue('')).toBeNull();
    expect(parseNumericValue(null)).toBeNull();
    expect(parseNumericValue('banana')).toBeNull();
  });
});

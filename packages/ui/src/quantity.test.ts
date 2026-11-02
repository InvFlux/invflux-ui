import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@invflux/i18n';
import { formatQuantity, parseQuantity, stepQuantity } from './quantity';

afterEach(() => setLocale(undefined));

describe('parseQuantity', () => {
  it('moves the decimal point by the scale, as a string', () => {
    expect(parseQuantity('2,5', { scale: 1 })).toEqual({ kind: 'ok', scaled: 25 });
    expect(parseQuantity('2.5', { scale: 3 })).toEqual({ kind: 'ok', scaled: 2500 });
    expect(parseQuantity('12', { scale: 0 })).toEqual({ kind: 'ok', scaled: 12 });
    expect(parseQuantity('0.1', { scale: 2 })).toEqual({ kind: 'ok', scaled: 10 });
    expect(parseQuantity('1.005', { scale: 3 })).toEqual({ kind: 'ok', scaled: 1005 });
    expect(parseQuantity('007', { scale: 0 })).toEqual({ kind: 'ok', scaled: 7 });
  });

  it('never turns one number into another', () => {
    // type="number" hands these back as 25, 109690 and 12.
    expect(parseQuantity('2,5', { scale: 0 })).toEqual({ kind: 'too_many_decimals', scale: 0 });
    expect(parseQuantity('1 096,90', { scale: 2 })).toEqual({ kind: 'invalid' });
    expect(parseQuantity('12a', { scale: 0 })).toEqual({ kind: 'invalid' });
    expect(parseQuantity('2,55', { scale: 1 })).toEqual({ kind: 'too_many_decimals', scale: 1 });
  });

  it('tells empty from invalid, and refuses a minus unless asked', () => {
    expect(parseQuantity('  ', { scale: 0 })).toEqual({ kind: 'empty' });
    expect(parseQuantity('-1', { scale: 0 })).toEqual({ kind: 'invalid' });
    expect(parseQuantity('-1,5', { scale: 1, negative: true })).toEqual({
      kind: 'ok',
      scaled: -15,
    });
    expect(parseQuantity('-0', { scale: 0, negative: true })).toEqual({ kind: 'ok', scaled: 0 });
  });

  it('judges min and max in scaled integers, inclusively', () => {
    // 0 is out of range when the field's minimum is one unit.
    expect(parseQuantity('0', { scale: 0, min: 1 })).toEqual({ kind: 'out_of_range' });
    expect(parseQuantity('1', { scale: 0, min: 1 })).toEqual({ kind: 'ok', scaled: 1 });
    expect(parseQuantity('0,5', { scale: 1, min: 10 })).toEqual({ kind: 'out_of_range' });
    expect(parseQuantity('2,5', { scale: 1, max: 25 })).toEqual({ kind: 'ok', scaled: 25 });
    expect(parseQuantity('2,6', { scale: 1, max: 25 })).toEqual({ kind: 'out_of_range' });
  });

  it('refuses a figure it could not hold exactly', () => {
    expect(parseQuantity('9007199254740991', { scale: 0 })).toEqual({
      kind: 'ok',
      scaled: Number.MAX_SAFE_INTEGER,
    });
    expect(parseQuantity('9007199254740992', { scale: 0 })).toEqual({ kind: 'out_of_range' });
    expect(parseQuantity('9007199254740993', { scale: 0 })).toEqual({ kind: 'out_of_range' });
    // The scale spends integer range: 10^15 units at scale 3 is 10^18 scaled.
    expect(parseQuantity('1000000000000000', { scale: 3 })).toEqual({ kind: 'out_of_range' });
    expect(parseQuantity('9'.repeat(400), { scale: 0 })).toEqual({ kind: 'out_of_range' });
  });
});

describe('formatQuantity', () => {
  it('is the identity at scale 0', () => {
    expect(formatQuantity(12, 0)).toBe('12');
    expect(formatQuantity(0, 0)).toBe('0');
  });

  it('places the decimal point, in the minimal form', () => {
    expect(formatQuantity(25, 1)).toBe('2.5');
    expect(formatQuantity(20, 1)).toBe('2');
    expect(formatQuantity(5, 2)).toBe('0.05');
    expect(formatQuantity(1250, 3)).toBe('1.25');
    expect(formatQuantity(0, 3)).toBe('0');
  });

  it('keeps trailing zeros when asked, for aligned columns', () => {
    expect(formatQuantity(20, 1, { fixed: true })).toBe('2.0');
    expect(formatQuantity(1250, 3, { fixed: true })).toBe('1.250');
    expect(formatQuantity(0, 2, { fixed: true })).toBe('0.00');
  });

  it('takes a negative, for a variance or a delta', () => {
    expect(formatQuantity(-25, 1)).toBe('-2.5');
    expect(formatQuantity(-5, 2)).toBe('-0.05');
    expect(formatQuantity(-3, 0)).toBe('-3');
  });

  it('follows the UI locale for the separator, and groups only when asked', () => {
    setLocale('fr-FR');
    expect(formatQuantity(25, 1)).toBe('2,5');
    expect(formatQuantity(1234500, 2)).toBe('12345');
    setLocale('en-US');
    expect(formatQuantity(1234550, 2, { grouped: true })).toBe('12,345.5');
    setLocale('de-DE');
    expect(formatQuantity(1234550, 2, { grouped: true })).toBe('12.345,5');
    expect(formatQuantity(1234550, 2)).toBe('12345,5');
  });

  it('survives a locale tag it can not use', () => {
    setLocale('not a locale');
    expect(formatQuantity(25, 1)).toBe('2.5');
  });

  it('reads back through the parser', () => {
    for (const [scaled, scale] of [
      [25, 1],
      [1005, 3],
      [7, 0],
      [5, 2],
    ] as const) {
      expect(parseQuantity(formatQuantity(scaled, scale), { scale })).toEqual({
        kind: 'ok',
        scaled,
      });
    }
    setLocale('fr-FR');
    expect(parseQuantity(formatQuantity(25, 1), { scale: 1 })).toEqual({ kind: 'ok', scaled: 25 });
  });
});

describe('stepQuantity', () => {
  it('steps a whole unit, or the smallest tick when fine', () => {
    expect(stepQuantity(25, 1, 1, false)).toBe(35);
    expect(stepQuantity(25, 1, -1, false)).toBe(15);
    expect(stepQuantity(25, 1, 1, true)).toBe(26);
    expect(stepQuantity(25, 1, -1, true)).toBe(24);
  });

  it('is one step at scale 0 either way', () => {
    expect(stepQuantity(4, 0, 1, false)).toBe(5);
    expect(stepQuantity(4, 0, 1, true)).toBe(5);
  });

  it('floors at min (default 0) and caps at max', () => {
    expect(stepQuantity(5, 1, -1, false)).toBe(0);
    expect(stepQuantity(0, 0, -1, false)).toBe(0);
    expect(stepQuantity(1, 0, -1, false, { min: 1 })).toBe(1);
    expect(stepQuantity(10, 0, 1, false, { max: 10 })).toBe(10);
    expect(stepQuantity(24, 1, 1, false, { max: 25 })).toBe(25);
    expect(stepQuantity(30, 1, 1, true, { max: 25 })).toBe(25);
  });

  it('never leaves the safe integers', () => {
    expect(stepQuantity(Number.MAX_SAFE_INTEGER, 0, 1, false)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

import { describe, expect, it } from 'vitest';
import { decimalOrNull, parseDecimal } from './parseDecimal';

describe('parseDecimal', () => {
  it('reads a dot or a comma as the decimal separator, in canonical dot form', () => {
    expect(parseDecimal('500')).toEqual({ kind: 'ok', value: '500' });
    expect(parseDecimal('2,5')).toEqual({ kind: 'ok', value: '2.5' });
    expect(parseDecimal(' 1500.75 ')).toEqual({ kind: 'ok', value: '1500.75' });
  });

  it('tells empty from invalid', () => {
    expect(parseDecimal('   ')).toEqual({ kind: 'empty' });
    expect(parseDecimal('abc')).toEqual({ kind: 'invalid' });
  });

  it('refuses rather than repairs', () => {
    for (const bad of ['1 096,90', '1,096.90', '5.', '.5', '1e3', '+5', '--5']) {
      expect(parseDecimal(bad)).toEqual({ kind: 'invalid' });
    }
  });

  it('takes a minus only when asked to', () => {
    expect(parseDecimal('-5')).toEqual({ kind: 'invalid' });
    expect(parseDecimal('-5,25', { negative: true })).toEqual({ kind: 'ok', value: '-5.25' });
  });

  it('refuses more decimals than the scale, never rounding', () => {
    expect(parseDecimal('1.235', { scale: 2 })).toEqual({ kind: 'too_many_decimals', scale: 2 });
    expect(parseDecimal('1.23', { scale: 2 })).toEqual({ kind: 'ok', value: '1.23' });
    expect(parseDecimal('3.0', { scale: 0 })).toEqual({ kind: 'too_many_decimals', scale: 0 });
  });

  it('checks inclusive bounds', () => {
    expect(parseDecimal('101', { max: 100 })).toEqual({ kind: 'out_of_range' });
    expect(parseDecimal('100', { max: 100 })).toEqual({ kind: 'ok', value: '100' });
    expect(parseDecimal('-1', { negative: true, min: 0 })).toEqual({ kind: 'out_of_range' });
  });

  it('decimalOrNull: value, null for empty, undefined for unusable', () => {
    expect(decimalOrNull(parseDecimal('7'))).toBe('7');
    expect(decimalOrNull(parseDecimal(''))).toBeNull();
    expect(decimalOrNull(parseDecimal('x'))).toBeUndefined();
  });
});

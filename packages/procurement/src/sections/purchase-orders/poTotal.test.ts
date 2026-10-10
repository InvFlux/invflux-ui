import { setLocale } from '@invflux/i18n';
import { beforeAll, describe, expect, it } from 'vitest';
import { formatPoTotal } from './poTotal';

/** The shared formatter separates the code with a non-breaking space. */
const plain = (s: string): string => s.replace(/[\u00a0\u202f]/g, ' ');

beforeAll(() => setLocale('en-US'));

describe('formatPoTotal', () => {
  it('shows the order total at the supplier’s cost decimals, never the stored four', () => {
    // The column stores four decimals; showing them reads as a bug on every order.
    expect(plain(formatPoTotal('2004.0000', 'USD', 2))).toBe('USD 2,004.00');
    expect(plain(formatPoTotal('2742.5000', 'EUR', 2))).toBe('EUR 2,742.50');
  });

  it('follows the supplier’s own precision, including none at all', () => {
    expect(plain(formatPoTotal('435000.0000', 'JPY', 0))).toBe('JPY 435,000');
    expect(plain(formatPoTotal('12.3400', 'EUR', 3))).toBe('EUR 12.340');
  });

  it('keeps the “no value” dash for an order without a total', () => {
    expect(plain(formatPoTotal(null, 'EUR', 2))).toBe('—');
  });

  it('shows a total it cannot read as a number as it is, rather than as “NaN” or nothing', () => {
    expect(plain(formatPoTotal('n/a', 'EUR', 2))).toBe('EUR n/a');
  });
});

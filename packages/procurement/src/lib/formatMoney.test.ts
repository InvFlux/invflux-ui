import { formatMoney, setLocale } from '@invflux/i18n';
import { afterEach, describe, expect, it } from 'vitest';

/** The formatter separates with non-breaking spaces (and, in French, a narrow one for grouping). */
const plain = (s: string): string => s.replace(/[\u00a0\u202f]/g, ' ');

afterEach(() => setLocale('en-US'));

describe('formatMoney', () => {
  it('puts the code where the locale puts it: before in English, after in French and German', () => {
    setLocale('en-US');
    expect(plain(formatMoney(435000, 'JPY', 0))).toBe('JPY 435,000');
    expect(plain(formatMoney(2004, 'USD', 2))).toBe('USD 2,004.00');

    setLocale('fr-FR');
    expect(plain(formatMoney(435000, 'JPY', 0))).toBe('435 000 JPY');
    expect(plain(formatMoney(2742.5, 'EUR', 2))).toBe('2 742,50 EUR');

    setLocale('de-DE');
    expect(plain(formatMoney(2742.5, 'EUR', 2))).toBe('2.742,50 EUR');
  });

  it('shows the code, never a symbol, so yen and yuan (and the dollars) stay distinguishable', () => {
    setLocale('en-US');
    for (const code of ['JPY', 'CNY', 'USD', 'CAD', 'AUD']) {
      expect(formatMoney(1, code, 2)).toContain(code);
    }
    expect(formatMoney(1, 'USD', 2)).not.toContain('$');
    expect(formatMoney(1, 'JPY', 0)).not.toContain('¥');
  });

  it('fixes the fraction digits to what the caller says, and to the currency’s own when it says nothing', () => {
    setLocale('en-US');
    expect(plain(formatMoney(12.34, 'EUR', 3))).toBe('EUR 12.340');
    expect(plain(formatMoney(12.3456, 'EUR', 0))).toBe('EUR 12');
    expect(plain(formatMoney(12.5, 'EUR'))).toBe('EUR 12.50'); // euro: two
    expect(plain(formatMoney(435001, 'JPY'))).toBe('JPY 435,001'); // yen: none
  });

  it('shows a plain number, with whatever currency text was given, when there is no ISO code to ground it', () => {
    setLocale('en-US');
    expect(formatMoney(1234.5, null)).toBe('1,234.50');
    expect(formatMoney(1234.5, '')).toBe('1,234.50');
    expect(formatMoney(1234.5, 'euros', 1)).toBe('1,234.5 euros');
    expect(() => formatMoney(1, 'not-a-code', 2)).not.toThrow(); // Intl would throw a RangeError on it
  });

  it('renders nothing for an amount that is not a number, rather than "NaN"', () => {
    expect(formatMoney(Number.NaN, 'EUR', 2)).toBe('');
    expect(formatMoney(Number.POSITIVE_INFINITY, 'EUR', 2)).toBe('');
  });
});

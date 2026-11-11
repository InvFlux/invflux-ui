import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@invflux/i18n';
import { compareSortKeys } from './tableSort';

afterEach(() => setLocale(undefined));

describe('compareSortKeys', () => {
  it('orders numbers numerically, not as text', () => {
    expect(compareSortKeys(9, 10)).toBeLessThan(0);
    expect(compareSortKeys(10, 9)).toBeGreaterThan(0);
    expect(compareSortKeys(2.5, 2.5)).toBe(0);
  });

  it('reads digit runs in text as numbers', () => {
    expect(compareSortKeys('A2', 'A10')).toBeLessThan(0);
  });

  it('follows the UI locale for accents and case', () => {
    setLocale('fr-FR');
    expect(compareSortKeys('école', 'zèbre')).toBeLessThan(0);
    expect(compareSortKeys('Alpha', 'alpha')).toBe(0);
  });
});

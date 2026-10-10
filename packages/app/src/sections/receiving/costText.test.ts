import { describe, expect, it } from 'vitest';
import { costText, currencyDecimals, derivedCostText } from './costText';

describe('costText', () => {
  it('pads to the store precision', () => {
    expect(costText(0, 2)).toBe('0.00');
    expect(costText('44.0000', 2)).toBe('44.00');
  });

  it('keeps digits the store precision would round away', () => {
    expect(costText('47.5650', 2)).toBe('47.565');
    expect(costText('1.23456', 2)).toBe('1.2346');
  });

  it('follows a store that shows no decimals, or more', () => {
    expect(costText('1200', 0)).toBe('1200');
    expect(costText('3.5', 3)).toBe('3.500');
  });
});

describe('derivedCostText', () => {
  it('rounds a worked-out figure to the currency precision by default', () => {
    expect(derivedCostText('189.3429', 2, false)).toBe('189.34');
    expect(derivedCostText('1200.4', 0, false)).toBe('1200');
  });

  it('keeps three significant digits for a small figure', () => {
    expect(derivedCostText('0.00345', 2, false)).toBe('0.00345');
    expect(derivedCostText('0.123456', 2, false)).toBe('0.123');
    expect(derivedCostText('0', 2, false)).toBe('0.00');
  });

  it('shows it as stored on request', () => {
    expect(derivedCostText('189.3429', 2, true)).toBe('189.3429');
    expect(derivedCostText('178.7200', 2, true)).toBe('178.72');
  });
});

describe('currencyDecimals', () => {
  it('reads the currency’s own precision', () => {
    expect(currencyDecimals('JPY', 2)).toBe(0);
    expect(currencyDecimals('EUR', 2)).toBe(2);
    expect(currencyDecimals('KWD', 2)).toBe(3);
  });

  it('falls back for a code it does not know', () => {
    expect(currencyDecimals('not-a-code', 2)).toBe(2);
  });
});

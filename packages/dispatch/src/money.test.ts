import { describe, expect, it } from 'vitest';
import { centsToDecimal, convertCents, parseRate, toCents } from './money';

describe('toCents', () => {
  it.each([
    ['120.00', 12000],
    ['95.5', 9550],
    ['95,50', 9550],
    [' 7 ', 700],
    ['0.10', 10],
    ['-0.30', -30],
  ])('reads %s as %i cents', (text, cents) => {
    expect(toCents(text)).toBe(cents);
  });

  it.each(['', 'abc', '1.234', '1.2.3', '1e3', null, undefined])('refuses %s', (text) => {
    expect(toCents(text)).toBeNull();
  });

  it('never goes through a float', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; three amounts read as cents add up exactly.
    expect((toCents('0.1') ?? 0) + (toCents('0.2') ?? 0)).toBe(toCents('0.3'));
  });
});

describe('centsToDecimal', () => {
  it.each([
    [12000, '120.00'],
    [9550, '95.50'],
    [5, '0.05'],
    [-30, '-0.30'],
  ])('writes %i cents as %s', (cents, text) => {
    expect(centsToDecimal(cents)).toBe(text);
  });
});

describe('parseRate', () => {
  it.each([
    ['1.2', '1.2'],
    ['0,93512345', '0.93512345'],
    ['2', '2'],
  ])('reads %s as %s', (text, rate) => {
    expect(parseRate(text)).toBe(rate);
  });

  it.each(['0', '0.0', '-1', '1.123456789', 'x', ''])('refuses %s', (text) => {
    expect(parseRate(text)).toBeNull();
  });
});

describe('convertCents', () => {
  it('rounds as the server rounds a converted payment', () => {
    // OrderPayment::convertedAmount(): 100.00 EUR at 0.93512345 → 93.51.
    expect(convertCents(10000, '0.93512345')).toBe(9351);
    expect(convertCents(10000, '1.2')).toBe(12000);
  });
});

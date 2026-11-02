import { describe, expect, it } from 'vitest';
import { adjustmentCents, adjustmentProblem, signedAdjustmentCents } from './refundAdjustments';

describe('adjustmentCents', () => {
  it.each([
    ['12,50', 1250],
    ['12.50', 1250],
    ['12,5', 1250],
    ['12', 1200],
    ['0.00', 0],
    ['', 0],
    ['  ', 0],
  ])('reads %j as %i cents', (text, cents) => {
    expect(adjustmentCents(text)).toBe(cents);
  });

  // parseFloat would read each of these as a different amount, or as nothing.
  it.each(['1 096,90', '12abc', 'abc', '12,505', '1.2.3', '-5', '-0'])('refuses %j', (text) => {
    expect(adjustmentCents(text)).toBeNull();
  });
});

describe('signedAdjustmentCents', () => {
  it('takes the sign from the kind', () => {
    expect(signedAdjustmentCents({ kind: 'reduce', amount: '5' })).toBe(-500);
    expect(signedAdjustmentCents({ kind: 'increase', amount: '5' })).toBe(500);
  });

  it('counts text that is not an amount as nothing', () => {
    expect(signedAdjustmentCents({ kind: 'increase', amount: 'abc' })).toBe(0);
  });
});

describe('adjustmentProblem', () => {
  const FLOOR = -1000;
  const CEIL = 500;

  it('accepts a row exactly at its limit', () => {
    expect(adjustmentProblem([{ kind: 'reduce', amount: '10' }], 0, FLOOR, CEIL)).toBeNull();
    expect(adjustmentProblem([{ kind: 'increase', amount: '5' }], 0, FLOOR, CEIL)).toBeNull();
  });

  it('marks a row one cent over, and keeps what was typed for the operator to fix', () => {
    expect(adjustmentProblem([{ kind: 'reduce', amount: '10,01' }], 0, FLOOR, CEIL)).toEqual({
      kind: 'over',
      roomCents: 1000,
    });
    expect(adjustmentProblem([{ kind: 'increase', amount: '5.01' }], 0, FLOOR, CEIL)).toEqual({
      kind: 'over',
      roomCents: 500,
    });
  });

  it('marks text that is not an amount as invalid, not over', () => {
    expect(adjustmentProblem([{ kind: 'reduce', amount: '12abc' }], 0, FLOOR, CEIL)).toEqual({
      kind: 'invalid',
    });
  });

  it('gives a row the room the other rows leave', () => {
    const rows = [
      { kind: 'increase', amount: '3' },
      { kind: 'increase', amount: '3' },
      { kind: 'reduce', amount: '2' },
    ] as const;
    // Others net 1.00 of the 5.00 ceiling for the first row, so its 3.00 fits.
    expect(adjustmentProblem(rows, 0, FLOOR, CEIL)).toBeNull();
    const crowded = [
      { kind: 'increase', amount: '4' },
      { kind: 'increase', amount: '2' },
    ] as const;
    expect(adjustmentProblem(crowded, 1, FLOOR, CEIL)).toEqual({ kind: 'over', roomCents: 100 });
  });

  it('ignores an unreadable row when working out the others', () => {
    const rows = [
      { kind: 'increase', amount: 'abc' },
      { kind: 'increase', amount: '5' },
    ] as const;
    expect(adjustmentProblem(rows, 1, FLOOR, CEIL)).toBeNull();
  });

  it('has no room when the order leaves none', () => {
    expect(adjustmentProblem([{ kind: 'increase', amount: '1' }], 0, FLOOR, 0)).toEqual({
      kind: 'over',
      roomCents: 0,
    });
  });
});

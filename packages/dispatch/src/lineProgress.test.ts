import { describe, expect, it } from 'vitest';
import { remainingProgress } from './lineProgress';

describe('remainingProgress', () => {
  it('leaves settled lines out of both numbers', () => {
    // Five lines, two corrected away, the other three staged: 3 of 3, not 5 of 5.
    expect(remainingProgress(5, 5, 2)).toEqual({ done: 3, remaining: 3 });
  });

  it('counts a partly staged order over the lines still to ship', () => {
    expect(remainingProgress(3, 5, 2)).toEqual({ done: 1, remaining: 3 });
  });

  it('reports nothing remaining when every line is settled', () => {
    expect(remainingProgress(4, 4, 4)).toEqual({ done: 0, remaining: 0 });
  });

  it('is the plain count when nothing is settled', () => {
    expect(remainingProgress(2, 5, 0)).toEqual({ done: 2, remaining: 5 });
  });
});

import { describe, expect, it } from 'vitest';
import { pointsOn } from './types';

describe('pointsOn', () => {
  it('reads an item\'s points from the map the service sends', () => {
    expect(pointsOn({ '7': 2, '9': 1 }, 7)).toBe(2);
  });

  it('treats an item the account holds nothing on as zero', () => {
    expect(pointsOn({ '7': 2 }, 8)).toBe(0);
  });

  it('reads an empty allocation, which PHP sends as a list, as zero', () => {
    expect(pointsOn([], 7)).toBe(0);
  });

  it('reads a missing allocation, from a service that predates points, as zero', () => {
    expect(pointsOn(undefined, 7)).toBe(0);
  });
});

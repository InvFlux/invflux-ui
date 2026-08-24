import { describe, expect, it } from 'vitest';
import { pasteTargets } from './paste';

describe('pasteTargets', () => {
  it('places a multi-cell clipboard from the active cell, expanding down/right', () => {
    const clip = [
      ['a', 'b'],
      ['c', 'd'],
    ];
    expect(pasteTargets(clip, { row: 1, col: 2 }, null, 10, 10)).toEqual([
      { row: 1, col: 2, text: 'a' },
      { row: 1, col: 3, text: 'b' },
      { row: 2, col: 2, text: 'c' },
      { row: 2, col: 3, text: 'd' },
    ]);
  });

  it('fills a multi-cell selection with a 1×1 clipboard', () => {
    const targets = pasteTargets([['x']], { row: 0, col: 0 }, { r1: 0, c1: 0, r2: 1, c2: 1 }, 10, 10);
    expect(targets).toEqual([
      { row: 0, col: 0, text: 'x' },
      { row: 0, col: 1, text: 'x' },
      { row: 1, col: 0, text: 'x' },
      { row: 1, col: 1, text: 'x' },
    ]);
  });

  it('1×1 clipboard into a 1×1 selection pastes a single cell', () => {
    expect(pasteTargets([['x']], { row: 2, col: 3 }, { r1: 2, c1: 3, r2: 2, c2: 3 }, 10, 10)).toEqual([
      { row: 2, col: 3, text: 'x' },
    ]);
  });

  it('clips targets that fall outside the grid bounds', () => {
    const clip = [
      ['a', 'b'],
      ['c', 'd'],
    ];
    // active near the bottom-right corner of a 2×2-addressable grid (rows 0-1, cols 0-1).
    expect(pasteTargets(clip, { row: 1, col: 1 }, null, 2, 2)).toEqual([{ row: 1, col: 1, text: 'a' }]);
  });

  it('returns nothing for an empty clipboard', () => {
    expect(pasteTargets([], { row: 0, col: 0 }, null, 5, 5)).toEqual([]);
  });
});

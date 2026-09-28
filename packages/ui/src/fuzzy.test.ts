import { describe, expect, it } from 'vitest';
import { fuzzyScore } from './fuzzy';

/**
 * Subsequence matching, and the one property the highlighter depends on.
 *
 * `indices` address the ORIGINAL label, not a folded copy of it — so every accent-folding
 * assertion here is really two claims: that the match is found, and that it can still be pointed at.
 */
describe('fuzzyScore', () => {
  it('matches across an accent the typist did not type', () => {
    // The reported case: « Expédition partielle » matched on "exp" and then vanished on "exped",
    // because the subsequence died on the `é`. Losing a match by typing *more* of the right name
    // is the worst possible moment to lose it.
    expect(fuzzyScore('exp', 'Expédition partielle')).not.toBeNull();
    expect(fuzzyScore('exped', 'Expédition partielle')).not.toBeNull();
    expect(fuzzyScore('expedition', 'Expédition partielle')).not.toBeNull();
  });

  it('matches an accented query against an unaccented label, both directions', () => {
    expect(fuzzyScore('expéd', 'Expedition partielle')).not.toBeNull();
    expect(fuzzyScore('ceden', 'Cédéen')).not.toBeNull();
  });

  it('keeps indices addressing the original string, so highlighting stays aligned', () => {
    // `é` is one character in the label; a fold that decomposed it would return 2 here and every
    // later index would be off by one — the highlight would drift right by one letter per accent.
    const label = 'Expédition partielle';
    const hit = fuzzyScore('exped', label);
    expect(hit).not.toBeNull();
    expect(hit!.indices).toEqual([0, 1, 2, 3, 4]);
    // Reconstructing from the indices gives back the real characters, accent included.
    expect(hit!.indices.map((i) => label[i]).join('')).toBe('Expéd');
  });

  it('still refuses a needle whose characters are not all present in order', () => {
    expect(fuzzyScore('zzz', 'Expédition partielle')).toBeNull();
    // Right letters, wrong order — a subsequence match must stay ordered.
    expect(fuzzyScore('dpxe', 'Expédition')).toBeNull();
  });

  it('leaves a non-decomposing script alone rather than mangling its length', () => {
    // Nothing here folds to ASCII; the guarantee is that it does not throw and does not shift
    // indices, not that it matches.
    const label = 'Шкаф 12';
    const hit = fuzzyScore('12', label);
    expect(hit).not.toBeNull();
    expect(hit!.indices.map((i) => label[i]).join('')).toBe('12');
  });

  it('scores an empty needle as a neutral match', () => {
    expect(fuzzyScore('', 'anything')).toEqual({ score: 0, indices: [] });
  });
});

import { describe, expect, it } from 'vitest';
import { fuzzyScore, wordMatch, wordQueryNarrows } from './fuzzy';

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

/**
 * Word matching: the rule a server product search applies, and so the only one a picker showing
 * server results may highlight or narrow by.
 */
describe('wordMatch', () => {
  const jeans = "Men's 'Paint-Splatter' Skinny Jeans - 48";

  it('finds every word, in any order — the query a phrase match lost', () => {
    expect(wordMatch('paint 48', jeans)).not.toBeNull();
    expect(wordMatch('48 paint', jeans)).not.toBeNull();
  });

  it('refuses a label missing any one word, where a subsequence would still match', () => {
    // The disagreement this exists to remove: "pt 4" is a subsequence of the label, but neither
    // "pt" nor a server LIKE would find it as a word.
    expect(fuzzyScore('pt 4', jeans)).not.toBeNull();
    expect(wordMatch('pt 4', jeans)).toBeNull();
  });

  it('highlights every occurrence of each word, addressed in the original label', () => {
    const hit = wordMatch('48', 'Size 48 · JEANS-48')!;
    expect(hit).toEqual([5, 6, 16, 17]);
  });

  it('folds case and accents like the server collation does', () => {
    const label = 'Expédition partielle';
    const hit = wordMatch('EXPED', label)!;
    expect(hit.map((i) => label[i]).join('')).toBe('Expéd');
  });

  it('matches an empty needle with nothing to highlight', () => {
    expect(wordMatch('  ', 'anything')).toEqual([]);
  });
});

describe('wordQueryNarrows', () => {
  it('holds when typing on, adding a word or reordering', () => {
    expect(wordQueryNarrows('pai', 'paint')).toBe(true);
    expect(wordQueryNarrows('paint', 'paint 48')).toBe(true);
    expect(wordQueryNarrows('paint 4', '48 paint')).toBe(true);
    // Folded like the match itself: case and accents never decide it.
    expect(wordQueryNarrows('Pein', 'péint')).toBe(true);
    expect(wordQueryNarrows('PAINT', 'paint 48')).toBe(true);
  });

  it('fails once anything is deleted or replaced — those can widen the answer', () => {
    expect(wordQueryNarrows('paint 48', 'paint')).toBe(false);
    expect(wordQueryNarrows('paint', 'pain')).toBe(false);
    expect(wordQueryNarrows('paint', 'jeans')).toBe(false);
  });

  it('holds for every narrowed query whose matches it then filters', () => {
    // The property the picker relies on: a label matching the narrower query matches the wider one.
    const label = "Men's 'Paint-Splatter' Skinny Jeans - 48";
    expect(wordQueryNarrows('pain', 'paint 48')).toBe(true);
    expect(wordMatch('paint 48', label)).not.toBeNull();
    expect(wordMatch('pain', label)).not.toBeNull();
  });
});

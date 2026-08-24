import { describe, expect, it } from 'vitest';
import { bestMatch, foldKey, matchScore, scoreColor } from './fuzzy-match';

describe('foldKey', () => {
  it('strips accents, case, and punctuation/spacing', () => {
    expect(foldKey('Confirmé')).toBe('confirme');
    expect(foldKey('Prévu')).toBe('prevu');
    expect(foldKey('Unit Cost / Price')).toBe('unitcostprice');
    expect(foldKey('Qté')).toBe('qte');
  });
});

describe('matchScore', () => {
  it('is 1 for identical (after folding) and 0 for empty', () => {
    expect(matchScore('Confirmé', 'confirme')).toBe(1);
    expect(matchScore('qty', 'qty')).toBe(1);
    expect(matchScore('', 'qty')).toBe(0);
  });

  it('is symmetric', () => {
    expect(matchScore('Qty', 'Confirmed qty')).toBeCloseTo(matchScore('Confirmed qty', 'Qty'), 10);
  });

  it('scores a short generic header LOW against a long specific alias (the directionality trap)', () => {
    // "Qty" (3) vs "confirmed qty" (12): must be well below threshold, not a false 100%.
    expect(matchScore('Qty', 'confirmed qty')).toBeLessThan(0.5);
  });

  it('scores a specific header HIGH against its exact specific alias', () => {
    expect(matchScore('Confirmed qty', 'confirmed qty')).toBe(1);
  });

  it('rewards containment / qualifier variants moderately', () => {
    // "Expected qty" vs "expected" — partial but meaningful.
    expect(matchScore('Expected qty', 'expected')).toBeGreaterThan(0.5);
  });

  it('rewards word-order variants via the token term', () => {
    expect(matchScore('Unit Price', 'Price Unit')).toBeGreaterThan(0.7);
  });

  it('scores unrelated strings near zero', () => {
    expect(matchScore('Unit price', 'Barcode')).toBeLessThan(0.3);
  });

  it('reads a one-character difference as a near-identical name', () => {
    // The token term matches by edit distance, not equality: a plural shares no *token* with its
    // singular, so an exact-set intersection scored these 0.43 — below any usable threshold, and
    // indistinguishable from unrelated words. They are the near-duplicates a "did you mean?" hint
    // exists to catch.
    expect(matchScore('Cadeau', 'Cadeaux')).toBeGreaterThan(0.8);
    expect(matchScore('Litige', 'Litiges')).toBeGreaterThan(0.8);
    expect(matchScore('Retour client', 'Retours clients')).toBeGreaterThan(0.8);
  });

  it('keeps unrelated single words well below the near-duplicate band', () => {
    // The separation that makes the above thresholdable: near-duplicates land ≥ 0.77, everything
    // else ≤ 0.5, and nothing sits between.
    expect(matchScore('Retour', 'Rupture')).toBeLessThanOrEqual(0.5);
    expect(matchScore('Fragile', 'Urgent')).toBeLessThanOrEqual(0.5);
    expect(matchScore('Parked', 'Urgent')).toBeLessThanOrEqual(0.5);
  });
});

describe('bestMatch', () => {
  it('returns the highest-scoring candidate and its score', () => {
    const r = bestMatch('Confirmed', ['expected', 'confirmed', 'qty']);
    expect(r.matched).toBe('confirmed');
    expect(r.score).toBe(1);
  });

  it('lets a specific header beat a generic alias in the same set', () => {
    // Against a field carrying both, "Confirmed qty" matches its own alias fully...
    expect(bestMatch('Confirmed qty', ['qty', 'confirmed qty']).score).toBe(1);
    // ...while a bare "Qty" only reaches the generic one (still 1 via 'qty'), but scores LOW on the
    // specific one — so a field WITHOUT the generic alias won't be claimed by "Qty".
    expect(bestMatch('Qty', ['confirmed qty', 'expected']).score).toBeLessThan(0.5);
  });
});

describe('scoreColor', () => {
  it('returns a gradient from pink (0) through amber (0.5) to green (1)', () => {
    expect(scoreColor(0)).toBe('rgb(255, 204, 221)');
    expect(scoreColor(0.5)).toBe('rgb(255, 238, 204)');
    expect(scoreColor(1)).toBe('rgb(205, 237, 226)');
  });
});

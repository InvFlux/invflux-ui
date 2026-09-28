import { describe, it, expect } from 'vitest';
import { mergeColumnOrder } from './columnOrder';

describe('mergeColumnOrder', () => {
  it('returns a settled order unchanged', () => {
    expect(mergeColumnOrder(['select', 'a', 'b'], ['select', 'a', 'b'])).toEqual([
      'select',
      'a',
      'b',
    ]);
  });

  it('keeps the arrangement the merchant made, not the canonical one', () => {
    expect(mergeColumnOrder(['select', 'c', 'a', 'b'], ['select', 'a', 'b', 'c'])).toEqual([
      'select',
      'c',
      'a',
      'b',
    ]);
  });

  it('inserts a new middle column beside its canonical neighbour, not at the end', () => {
    // The whole point. Appended, a column shipped into the middle of the order arrives at the far
    // right for every existing merchant, detached from the columns it belongs with.
    expect(mergeColumnOrder(['select', 'a', 'c'], ['select', 'a', 'b', 'c'])).toEqual([
      'select',
      'a',
      'b',
      'c',
    ]);
  });

  it('places a new column after its nearest present predecessor when others are missing', () => {
    expect(mergeColumnOrder(['select', 'a'], ['select', 'a', 'b', 'c', 'd'])).toEqual([
      'select',
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('follows the MERCHANT-moved predecessor, so the new column lands where they can see it', () => {
    // `b` is canonically after `a`; the merchant dragged `a` to the end, so `b` follows it there
    // rather than appearing at the original position they moved away from.
    expect(mergeColumnOrder(['select', 'c', 'a'], ['select', 'a', 'b', 'c'])).toEqual([
      'select',
      'c',
      'a',
      'b',
    ]);
  });

  it('appends only when no predecessor is present', () => {
    expect(mergeColumnOrder(['select', 'z'], ['select', 'a'])).toEqual(['select', 'z', 'a']);
  });

  it('keeps a saved id the canonical list has not caught up with', () => {
    // Server columns arrive across ticks: "absent" and "absent so far" are indistinguishable, and
    // guessing wrong silently discards the merchant's arrangement.
    expect(mergeColumnOrder(['select', 'a', 'not_loaded_yet'], ['select', 'a'])).toEqual([
      'select',
      'a',
      'not_loaded_yet',
    ]);
  });

  it('adds the checkbox when canonical has it and the saved order does not', () => {
    expect(mergeColumnOrder(['a'], ['select', 'a'])).toEqual(['select', 'a']);
  });

  it('keeps the checkbox first even if it was stored elsewhere', () => {
    expect(mergeColumnOrder(['a', 'select'], ['select', 'a'])).toEqual(['select', 'a']);
  });

  it('omits the checkbox entirely when neither side has one', () => {
    expect(mergeColumnOrder(['a'], ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('builds the whole order from canonical when nothing is saved', () => {
    expect(mergeColumnOrder([], ['select', 'a', 'b'])).toEqual(['select', 'a', 'b']);
  });
});

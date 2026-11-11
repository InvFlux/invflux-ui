import { describe, expect, it } from 'vitest';
import { enumMultiText, enumMultiValues, parseEnumMulti } from './enumMulti';

const config = {
  options: [
    { value: 'navy', label: 'Navy blue' },
    { value: 'red', label: 'Red' },
  ],
};

describe('enum-multi', () => {
  it('reads a list, and a single stored value as a list of one', () => {
    expect(enumMultiValues(['navy', 'red'])).toEqual(['navy', 'red']);
    expect(enumMultiValues('navy')).toEqual(['navy']);
    expect(enumMultiValues(null)).toEqual([]);
    expect(enumMultiValues('')).toEqual([]);
  });

  it('shows labels, and a value no longer among the options as stored', () => {
    expect(enumMultiText(['red', 'navy'], config)).toBe('Red, Navy blue');
    expect(enumMultiText(['teal'], config)).toBe('teal');
  });

  it('pastes values or labels, case blind, and refuses the cell for any other', () => {
    expect(parseEnumMulti('navy blue, RED', config)).toEqual(['navy', 'red']);
    expect(parseEnumMulti('red, red', config)).toEqual(['red']);
    expect(parseEnumMulti('  ', config)).toEqual([]);
    expect(parseEnumMulti('red, teal', config)).toBeNull();
  });
});

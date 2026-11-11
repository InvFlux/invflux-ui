import { describe, expect, it } from 'vitest';
import { cellKey, codeCompareForm, heldCodeMessage, stagedDuplicates } from './codeCollisions';

describe('duplicate product codes', () => {
  it('compares each space as its owner compares it', () => {
    expect(codeCompareForm('sku', 'AB-12  ')).toBe('ab-12');
    expect(codeCompareForm('sku', ' AB-12'), 'a leading space is part of a SKU').toBe(' ab-12');
    expect(codeCompareForm('gtin', ' 4006-381 333931 x')).toBe('4006-381333931x');
    expect(codeCompareForm('scannable', '000123')).toBe('123');
    expect(codeCompareForm('scannable', ' Ab-1 ')).toBe('ab-1');
    expect(codeCompareForm('sku', ''), 'empty is never checked').toBeNull();
    expect(codeCompareForm('sku', '0'), 'nor is 0, empty to WooCommerce').toBeNull();
    expect(codeCompareForm('gtin', 'abc'), 'nothing left once stripped').toBeNull();
  });

  it('marks both products when one code is staged for two', () => {
    const found = stagedDuplicates([
      { subjectId: 1, columnId: 'sku', space: 'sku', value: 'AB-12' },
      { subjectId: 2, columnId: 'sku', space: 'sku', value: 'ab-12 ' },
      { subjectId: 3, columnId: 'sku', space: 'sku', value: 'CD-34' },
      // The same code in another column competes in another space.
      { subjectId: 3, columnId: 'gtin', space: 'gtin', value: 'AB-12' },
      { subjectId: 4, columnId: 'sku', space: 'sku', value: '' },
      { subjectId: 5, columnId: 'sku', space: 'sku', value: '' },
    ]);
    expect([...found]).toEqual([
      [cellKey(1, 'sku'), 2],
      [cellKey(2, 'sku'), 1],
    ]);
  });

  it('names the holder, and says when its own change is pending', () => {
    expect(heldCodeMessage('AB-12', 'Sneakers', false)).toBe(
      'AB-12 is already used by “Sneakers”.',
    );
    expect(heldCodeMessage('AB-12', 'Sneakers', true)).toBe(
      'AB-12 is used by “Sneakers” until its change is saved.',
    );
    expect(heldCodeMessage('AB-12', '', false)).toBe('AB-12 is already used by another product.');
  });
});

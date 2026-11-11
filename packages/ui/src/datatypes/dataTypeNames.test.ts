import { describe, expect, it } from 'vitest';
import { canonicalDataType, isWholeNumberDataType } from './dataTypeNames';

describe('canonicalDataType', () => {
  it('reads an earlier name as today’s', () => {
    expect(canonicalDataType('number')).toBe('integer');
    expect(canonicalDataType('number:stock')).toBe('quantity:stock');
    expect(canonicalDataType('number:on-order')).toBe('quantity:on-order');
    expect(canonicalDataType('number:receipt')).toBe('quantity:receipt');
    expect(canonicalDataType('number:weight')).toBe('integer:weight');
  });

  it('keeps every other name', () => {
    expect(canonicalDataType('quantity:stock')).toBe('quantity:stock');
    expect(canonicalDataType('decimal:money')).toBe('decimal:money');
    expect(canonicalDataType('numbered')).toBe('numbered');
  });
});

describe('isWholeNumberDataType', () => {
  it('holds for integers and quantities, under either name', () => {
    for (const dt of ['integer', 'quantity', 'quantity:stock', 'number', 'number:receipt']) {
      expect(isWholeNumberDataType(dt)).toBe(true);
    }
    for (const dt of ['decimal', 'decimal:money', 'text', 'link:count', 'numbered']) {
      expect(isWholeNumberDataType(dt)).toBe(false);
    }
  });
});

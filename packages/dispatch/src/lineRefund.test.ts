import { describe, expect, it } from 'vitest';
import { hasDiscount, netUnitPrice, refundFor } from './lineRefund';

const line = (unitPrice: string, lineDiscount: string, qtyOrdered: number, qtyCorrected = 0) => ({
  unitPrice,
  lineDiscount,
  qtyOrdered,
  qtyCorrected,
});

describe('lineRefund — mirrors core OrderLine::refundFor()', () => {
  it('refunds the price paid, not the list price', () => {
    // The order that bounced off WooCommerce: 129.00 listed, 19.35 off, 109.65 charged.
    const discounted = line('129.00', '19.35', 1);

    expect(hasDiscount(discounted)).toBe(true);
    expect(netUnitPrice(discounted)).toBe('109.65');
    expect(refundFor(discounted, 1)).toBe('109.65');
  });

  it('leaves an undiscounted line at its list price', () => {
    const plain = line('17.00', '0.00', 2);

    expect(hasDiscount(plain)).toBe(false);
    expect(refundFor(plain, 2)).toBe('34.00');
  });

  it('adds up to the line a unit at a time, never a cent more', () => {
    // 100.01 over three units: rounding each one refunds 33.34 × 3 = 100.02.
    const pieces = [0, 1, 2].map((corrected) => refundFor(line('40.00', '19.99', 3, corrected), 1));

    expect(pieces).toEqual(['33.34', '33.33', '33.34']);
    expect(refundFor(line('40.00', '19.99', 3), 3)).toBe('100.01');
  });

  it('treats a read without the discount as undiscounted', () => {
    expect(refundFor({ unitPrice: '10.00', qtyOrdered: 1, qtyCorrected: 0 }, 1)).toBe('10.00');
  });
});

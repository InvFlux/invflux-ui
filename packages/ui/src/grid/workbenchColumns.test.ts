import { describe, expect, it } from 'vitest';
import { stockSlotOf } from './stockSlot';
import type { GridColumnMeta } from '../types';

/** Minimal column meta — stockSlotOf only inspects `id` (and, in future, `dataType`). */
function meta(id: string, dataType = 'number'): GridColumnMeta {
  return { id, dataType } as GridColumnMeta;
}

describe('stockSlotOf (stock-`kind` seam)', () => {
  it('recognises the bare aggregate slot ids', () => {
    expect(stockSlotOf(meta('atp'))).toBe('atp');
    expect(stockSlotOf(meta('res'))).toBe('res');
    expect(stockSlotOf(meta('ctd'))).toBe('ctd');
    expect(stockSlotOf(meta('total'))).toBe('total');
  });

  it('resolves faceted ids to their base slot (per-location @, per-channel ·)', () => {
    expect(stockSlotOf(meta('atp@wh1'))).toBe('atp');
    expect(stockSlotOf(meta('atp@oh/main'))).toBe('atp');
    expect(stockSlotOf(meta('res·web'))).toBe('res');
    expect(stockSlotOf(meta('total@wh2'))).toBe('total');
  });

  it('returns null for non-stock columns', () => {
    expect(stockSlotOf(meta('name'))).toBeNull();
    expect(stockSlotOf(meta('price'))).toBeNull();
    expect(stockSlotOf(meta('reorder_threshold'))).toBeNull();
    // A column whose id merely starts with the letters of a slot but isn't one.
    expect(stockSlotOf(meta('atprice'))).toBeNull();
    expect(stockSlotOf(meta('taxonomy.brand'))).toBeNull();
  });
});

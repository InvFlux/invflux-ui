import { describe, expect, it } from 'vitest';
import type { DispatchOrderLine } from '../types';
import { filterLines, lineMatches } from './lineFilter';

function line(over: Partial<DispatchOrderLine>): DispatchOrderLine {
  return { lineId: 1, name: 'TrailPack 18L', sku: 'PACK-TRAIL-18', gtin: null, codes: [], ...over } as DispatchOrderLine;
}

const scan = { mode: 'scan' } as const;
const typed = { mode: 'typed' } as const;

describe('the order page line filter', () => {
  it('keeps every line for an empty or blank query', () => {
    const lines = [line({ lineId: 1 }), line({ lineId: 2, name: 'Other' })];
    expect(filterLines(lines, '', typed)).toBe(lines);
    expect(filterLines(lines, '   ', scan)).toBe(lines);
  });

  describe('a scan', () => {
    it('matches a code exactly, whatever zero padding either side carries', () => {
      const l = line({ gtin: '0012345678905', codes: ['04006381333931'] });
      expect(lineMatches(l, '12345678905', scan)).toBe(true); // the GTIN, padding dropped
      expect(lineMatches(l, '012345678905', scan)).toBe(true); // as a UPC-A
      expect(lineMatches(l, '4006381333931', scan)).toBe(true); // the extra code, as EAN-13
      expect(lineMatches(l, '400638133393', scan)).toBe(false); // part of a code is another code
    });

    it('matches the whole SKU, ignoring case, and never part of it', () => {
      expect(lineMatches(line({}), 'pack-trail-18', scan)).toBe(true);
      expect(lineMatches(line({ sku: 'SKU-12345' }), '1234', scan)).toBe(false);
      expect(lineMatches(line({}), 'PACK-TRAIL', scan)).toBe(false);
    });

    it('reads a digits-only SKU like a code, since many stores keep the barcode there', () => {
      expect(lineMatches(line({ sku: '0012345678905' }), '12345678905', scan)).toBe(true);
    });

    it('never matches the name', () => {
      expect(lineMatches(line({}), 'TrailPack 18L', scan)).toBe(false);
    });

    it('is what a query without options is', () => {
      expect(lineMatches(line({ sku: 'SKU-12345' }), '1234')).toBe(false);
      expect(lineMatches(line({}), 'PACK-TRAIL-18')).toBe(true);
    });
  });

  describe('a typed query', () => {
    it('matches name and SKU by the fuzzy picker rule', () => {
      expect(lineMatches(line({}), 'trlpk', typed)).toBe(true); // name, as a subsequence
      expect(lineMatches(line({}), 'pt18', typed)).toBe(true); // SKU, likewise
      expect(lineMatches(line({}), 'daypack', typed)).toBe(false);
    });

    it('searches only the fields it is given', () => {
      expect(lineMatches(line({}), 'trailpack', { mode: 'typed', fields: ['sku'] })).toBe(false);
      expect(lineMatches(line({}), 'trail-18', { mode: 'typed', fields: ['name'] })).toBe(false);
    });

    it('matches a code keyed in full exactly, and only with codes among its fields', () => {
      const l = line({ codes: ['SUP-ABC-1', '04006381333931'] });
      expect(lineMatches(l, 'sup-abc-1', typed)).toBe(true);
      expect(lineMatches(l, '4006381333931', typed)).toBe(true);
      expect(lineMatches(l, '40063813', typed)).toBe(false);
      expect(lineMatches(l, '4006381333931', { mode: 'typed', fields: ['name', 'sku'] })).toBe(
        false,
      );
    });
  });

  it('keeps the lines in their order rather than ranking them', () => {
    const lines = [
      line({ lineId: 1, name: 'Trail bottle' }),
      line({ lineId: 2, name: 'Trail' }),
      line({ lineId: 3, name: 'Other', sku: 'OTHER-1' }),
    ];
    expect(filterLines(lines, 'trail', typed).map((l) => l.lineId)).toEqual([1, 2]);
  });

  it('never matches every code against a query of zeros', () => {
    expect(lineMatches(line({ codes: ['0'] }), '000', scan)).toBe(true);
    expect(lineMatches(line({ codes: ['5'] }), '000', scan)).toBe(false);
  });
});

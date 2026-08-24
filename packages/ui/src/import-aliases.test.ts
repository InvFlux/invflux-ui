import { describe, expect, it } from 'vitest';
import { normalizeAlias, parseAliasCsv, serializeAliases } from './import-aliases';
import { foldKey } from './fuzzy-match';

describe('normalizeAlias', () => {
  it('lowercases, strips diacritics, and keeps word boundaries', () => {
    expect(normalizeAlias('Confirmé Qté')).toBe('confirme qte');
    expect(normalizeAlias('  Confirmed   Qty  ')).toBe('confirmed qty');
  });

  it('keeps digits (incl. 0), dot, dash, underscore', () => {
    expect(normalizeAlias('Code_ABC-100.5')).toBe('code_abc-100.5');
  });

  it('strips CSV delimiters and other noise, so an alias can never contain one', () => {
    expect(normalizeAlias('a, b; c')).toBe('a b c');
    expect(normalizeAlias('qty (units)')).toBe('qty units');
  });

  it('preserves the word boundary the fuzzy matcher tokenises on', () => {
    // foldKey collapses to the compare key, but the stored form still has the space for tokenising.
    expect(normalizeAlias('confirmed qty')).toBe('confirmed qty');
    expect(foldKey(normalizeAlias('confirmed qty'))).toBe('confirmedqty');
  });
});

describe('parseAliasCsv', () => {
  it('splits on comma and semicolon, normalizes, and de-dupes', () => {
    expect(parseAliasCsv('Confirmed, confirmed ; OA Qty,, ')).toEqual(['confirmed', 'oa qty']);
  });

  it('returns empty for blank input', () => {
    expect(parseAliasCsv('  ,  ; ')).toEqual([]);
  });
});

describe('serializeAliases', () => {
  it('normalizes, de-dupes, and joins with ", "', () => {
    expect(serializeAliases(['Confirmed', 'confirmed', 'OA qty'])).toBe('confirmed, oa qty');
  });

  it('round-trips with parseAliasCsv', () => {
    const csv = serializeAliases(['Menge', 'cantidad', 'menge']);
    expect(csv).toBe('menge, cantidad');
    expect(parseAliasCsv(csv)).toEqual(['menge', 'cantidad']);
  });
});

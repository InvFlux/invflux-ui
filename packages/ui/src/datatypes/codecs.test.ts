import { describe, expect, it } from 'vitest';
import { codecRegistry, type CodecContext } from './registry';
import './codecs';

const ctx = (
  config: Record<string, unknown> = {},
  taxonomySpace?: CodecContext['taxonomySpace'],
): CodecContext => ({
  config,
  taxonomySpace,
});

const codec = (dataType: string) => {
  const c = codecRegistry.resolve(dataType);
  if (!c) throw new Error(`no codec for ${dataType}`);
  return c;
};

describe('built-in codecs', () => {
  it('number: parses integers, rejects non-integers, honors min/max', () => {
    const c = codec('number');
    expect(c.parse('12', ctx())).toBe(12);
    expect(c.parse(' 7 ', ctx())).toBe(7);
    expect(c.parse('1.5', ctx())).toBeNull();
    expect(c.parse('abc', ctx())).toBeNull();
    expect(c.parse('', ctx())).toBeNull();
    expect(c.parse('-1', ctx({ min: 0 }))).toBeNull();
    expect(c.parse('99', ctx({ max: 10 }))).toBeNull();
    expect(c.format(12, ctx())).toBe('12');
    expect(c.format(null, ctx())).toBe('');
    expect(c.parse(c.format(8, ctx()), ctx())).toBe(8); // round-trip
  });

  it('text: trims surrounding whitespace (a stray space in a SKU/name is never intended)', () => {
    const c = codec('text');
    expect(c.parse('  ABC-123  ', ctx())).toBe('ABC-123');
    expect(c.parse('plain', ctx())).toBe('plain');
    expect(c.parse('   ', ctx())).toBe('');
    expect(c.format('hi', ctx())).toBe('hi');
  });

  it('decimal (and decimal:money via chain): preserves string form', () => {
    const c = codec('decimal:money');
    expect(c.parse('9.99', ctx())).toBe('9.99');
    expect(c.parse('10', ctx())).toBe('10');
    expect(c.parse('n/a', ctx())).toBeNull();
    expect(c.format('9.99', ctx())).toBe('9.99');
    expect(c.parse(c.format('9.99', ctx()), ctx())).toBe('9.99');
  });

  /**
   * The bounds live in `editorConfig` and the cell editor has always enforced them; paste did not,
   * because only the integer codec read `ctx`. The live case is `wac` — the unit cost — which
   * declares `min: 0` and so refused a negative through the keyboard while accepting one through
   * the clipboard.
   */
  it('decimal / money: honour the column min and max, as the editor does', () => {
    const d = codec('decimal');
    const m = codec('decimal:money');

    expect(d.parse('-5', ctx({ min: 0 }))).toBeNull();
    expect(m.parse('-5', ctx({ min: 0 }))).toBeNull();
    // ...including once the currency furniture is stripped, which is how it actually arrives.
    expect(m.parse('-5,00 €', ctx({ min: 0 }))).toBeNull();
    expect(m.parse('12.50', ctx({ min: 0 }))).toBe('12.50');
    expect(d.parse('101', ctx({ max: 100 }))).toBeNull();
    expect(d.parse('100', ctx({ max: 100 }))).toBe('100');
    // Bounds are compared numerically while the value stays a decimal STRING — "007" is in range
    // and is not silently turned into a float on the way through.
    expect(d.parse('007', ctx({ min: 0, max: 10 }))).toBe('007');
    // A column that declares neither is unbounded, negatives included (a stock delta, say).
    expect(d.parse('-5', ctx())).toBe('-5');
  });

  it('decimal: normalizes locale separators + grouping whitespace', () => {
    const c = codec('decimal');
    expect(c.parse('12,50', ctx())).toBe('12.50'); // comma decimal (LibreOffice fr)
    expect(c.parse('1.234,56', ctx())).toBe('1234.56'); // EU: dot grouping, comma decimal
    expect(c.parse('1,234.56', ctx())).toBe('1234.56'); // US: comma grouping, dot decimal
    expect(c.parse('1 096,90', ctx())).toBe('1096.90'); // space grouping (fr)
    expect(c.parse('1 096,90', ctx())).toBe('1096.90'); // NBSP grouping
    expect(c.parse('1 096,90', ctx())).toBe('1096.90'); // NBSP grouping (explicit)
    expect(c.parse('1 096,90', ctx())).toBe('1096.90'); // narrow NBSP grouping (explicit)
    expect(c.parse('-3,5', ctx())).toBe('-3.5');
    expect(c.parse('abc', ctx())).toBeNull();
    expect(c.parse('', ctx())).toBeNull();
  });

  it('money: strips currency symbols + codes around the number', () => {
    const c = codec('decimal:money');
    expect(c.parse('1 096,90 €', ctx())).toBe('1096.90'); // NBSP grouping + comma + euro (fr)
    expect(c.parse('$12.50', ctx())).toBe('12.50');
    expect(c.parse('£1,234.00', ctx())).toBe('1234.00');
    expect(c.parse('€ 99,00', ctx())).toBe('99.00');
    expect(c.parse('nope', ctx())).toBeNull();
  });

  it('bool: parses tokens, formats Yes/No', () => {
    const c = codec('bool');
    expect(c.parse('yes', ctx())).toBe(true);
    expect(c.parse('N', ctx())).toBe(false);
    expect(c.parse('maybe', ctx())).toBeNull();
    expect(c.format(true, ctx())).toBe('Yes');
    expect(c.format(false, ctx())).toBe('No');
    expect(c.parse(c.format(true, ctx()), ctx())).toBe(true);
  });

  it('enum: restricts to configured options when present', () => {
    const c = codec('enum');
    expect(c.parse('taxable', ctx({ options: ['taxable', 'none'] }))).toBe('taxable');
    expect(c.parse('bogus', ctx({ options: ['taxable', 'none'] }))).toBeNull();
    expect(c.parse('anything', ctx())).toBe('anything'); // no options → lenient
  });

  it('image:url: validates URLs', () => {
    const c = codec('image:url');
    expect(c.parse('https://x.test/a.png', ctx())).toBe('https://x.test/a.png');
    expect(c.parse('not a url', ctx())).toBeNull();
  });

  it('term-picker: maps term names ⇄ ids via the taxonomy space', () => {
    const space = {
      product_cat: {
        code: 'product_cat',
        name: 'Categories',
        hierarchical: true,
        enabled: true,
        values: {
          '3': { id: 3, code: 'shoes', name: 'Shoes', parentId: null, depth: 0 },
          '7': { id: 7, code: 'boots', name: 'Boots', parentId: null, depth: 0 },
        },
      },
    };
    const c = codec('term-picker:wc-taxonomy');
    const cfg = ctx({ taxonomy: 'product_cat' }, space);

    expect(c.format([3, 7], cfg)).toBe('Shoes, Boots');
    expect(c.parse('Shoes, Boots', cfg)).toEqual([3, 7]);
    expect(c.parse('shoes', cfg)).toEqual([3]); // case-insensitive
    expect(c.parse('', cfg)).toEqual([]); // clears
    expect(c.parse('Shoes, Nope', cfg)).toBeNull(); // any unresolved → reject
  });
});

import { describe, expect, it } from 'vitest';
import { parseSpreadsheetTsv } from './excel-tsv-parser';

describe('parseSpreadsheetTsv', () => {
  it('parses a plain grid', () => {
    expect(parseSpreadsheetTsv('a\tb\nc\td').rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('returns [] for empty input', () => {
    expect(parseSpreadsheetTsv('').rows).toEqual([]);
  });

  it("drops a single trailing newline's empty row", () => {
    expect(parseSpreadsheetTsv('a\tb\n').rows).toEqual([['a', 'b']]);
  });

  it('handles \\r\\n (Windows Excel) line endings', () => {
    expect(parseSpreadsheetTsv('a\tb\r\nc\td').rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('keeps tabs embedded in a quoted cell', () => {
    expect(parseSpreadsheetTsv('"a\tb"\tc').rows).toEqual([['a\tb', 'c']]);
  });

  it('keeps newlines embedded in a quoted cell', () => {
    expect(parseSpreadsheetTsv('"line1\nline2"\tx').rows).toEqual([['line1\nline2', 'x']]);
  });

  it('unescapes doubled quotes inside a quoted cell', () => {
    expect(parseSpreadsheetTsv('"She said ""hi"""\ty').rows).toEqual([['She said "hi"', 'y']]);
  });

  it('treats stray quotes in an unquoted field as literal', () => {
    expect(parseSpreadsheetTsv('a"b\tc').rows).toEqual([['a"b', 'c']]);
  });

  it('reports an unterminated quote but still returns the partial grid', () => {
    const { rows, errors } = parseSpreadsheetTsv('"oops\tnext');
    expect(errors).toHaveLength(1);
    expect(rows).toEqual([['oops\tnext']]);
  });

  it('preserves empty cells', () => {
    expect(parseSpreadsheetTsv('a\t\tc').rows).toEqual([['a', '', 'c']]);
  });
});

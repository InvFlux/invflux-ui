import { describe, expect, it } from 'vitest';
import { pasteTargets, resolvePastedCell } from './paste';

/**
 * The reported bug and its two siblings. All three came from one sentinel doing double duty: `parse`
 * returns null both for "this text is malformed" and for "this text is empty", so a blank cell in an
 * otherwise valid block aborted the whole paste with "invalid value", and nothing could be emptied
 * by pasting over it. Note that the round-trip invariant the codecs document —
 * `parse(format(x)) === x` — HOLDS numerically at `x = null` while meaning the opposite, which is
 * why no existing test caught any of it.
 */
describe('resolvePastedCell', () => {
  const clearable = (value: unknown): { ok: boolean; value: unknown } => ({ ok: true, value });
  const notClearable = { ok: false, value: null };
  const parseInt10 = (t: string): unknown => (/^-?\d+$/.test(t) ? Number(t) : null);

  it('stages the value when the text parses', () => {
    expect(resolvePastedCell('42', clearable(null), parseInt10)).toEqual({
      kind: 'stage',
      value: 42,
    });
  });

  it('rejects unparseable text as invalid, naming that reason and not the other', () => {
    expect(resolvePastedCell('abc', clearable(null), parseInt10)).toEqual({
      kind: 'reject',
      reason: 'invalid',
    });
  });

  it('clears on empty text instead of asking the codec — the reported bug', () => {
    // Every numeric codec answers null to '', which the caller reads as "invalid". Copying three
    // cells whose middle one was blank and pasting them straight back therefore failed with
    // `Cannot paste "" into Reorder threshold`, mutating nothing.
    expect(resolvePastedCell('', clearable(null), parseInt10)).toEqual({
      kind: 'stage',
      value: null,
    });
  });

  it("keeps each column's OWN blank, which are not interchangeable", () => {
    // number clears to null, decimal/money to '', a term picker to [], a bool to false. Staging a
    // blanket null would write the wrong empty into three of those four.
    expect(resolvePastedCell('', clearable(''), parseInt10)).toEqual({ kind: 'stage', value: '' });
    expect(resolvePastedCell('', clearable([]), parseInt10)).toEqual({ kind: 'stage', value: [] });
    expect(resolvePastedCell('', clearable(false), parseInt10)).toEqual({
      kind: 'stage',
      value: false,
    });
  });

  it('honours a row-aware blank, so an inheritable variation cell returns to its parent', () => {
    // The caller resolves the cleared value per ROW, so on a variation this is `inheritValue` rather
    // than an empty — pasting a blank restores "same as parent" instead of severing the inheritance.
    expect(resolvePastedCell('', clearable('__inherit__'), parseInt10)).toEqual({
      kind: 'stage',
      value: '__inherit__',
    });
  });

  it('treats whitespace-only as empty', () => {
    // A spreadsheet round-trip through a lone space is not an attempt to store one.
    expect(resolvePastedCell('   ', clearable(null), parseInt10)).toEqual({
      kind: 'stage',
      value: null,
    });
  });

  it('rejects an empty paste into a column that has no blank, and says so specifically', () => {
    // Distinct from 'invalid': the text is fine, the column simply cannot be empty. Reporting this
    // as "invalid value" over a blank cell sends the reader hunting a malformed number.
    expect(resolvePastedCell('', notClearable, parseInt10)).toEqual({
      kind: 'reject',
      reason: 'not-clearable',
    });
    expect(resolvePastedCell('  ', notClearable, parseInt10)).toEqual({
      kind: 'reject',
      reason: 'not-clearable',
    });
  });

  it('skips a column with no registered codec rather than guessing', () => {
    expect(resolvePastedCell('42', clearable(null), null)).toEqual({ kind: 'skip' });
  });

  it('clears an unclearable-codec column on empty even with no codec registered', () => {
    // Clearing never consults the codec, so a missing one is irrelevant to it.
    expect(resolvePastedCell('', clearable(null), null)).toEqual({ kind: 'stage', value: null });
  });
});

describe('pasteTargets', () => {
  it('places a multi-cell clipboard from the active cell, expanding down/right', () => {
    const clip = [
      ['a', 'b'],
      ['c', 'd'],
    ];
    expect(pasteTargets(clip, { row: 1, col: 2 }, null, 10, 10)).toEqual([
      { row: 1, col: 2, text: 'a' },
      { row: 1, col: 3, text: 'b' },
      { row: 2, col: 2, text: 'c' },
      { row: 2, col: 3, text: 'd' },
    ]);
  });

  it('fills a multi-cell selection with a 1×1 clipboard', () => {
    const targets = pasteTargets(
      [['x']],
      { row: 0, col: 0 },
      { r1: 0, c1: 0, r2: 1, c2: 1 },
      10,
      10,
    );
    expect(targets).toEqual([
      { row: 0, col: 0, text: 'x' },
      { row: 0, col: 1, text: 'x' },
      { row: 1, col: 0, text: 'x' },
      { row: 1, col: 1, text: 'x' },
    ]);
  });

  it('1×1 clipboard into a 1×1 selection pastes a single cell', () => {
    expect(
      pasteTargets([['x']], { row: 2, col: 3 }, { r1: 2, c1: 3, r2: 2, c2: 3 }, 10, 10),
    ).toEqual([{ row: 2, col: 3, text: 'x' }]);
  });

  it('clips targets that fall outside the grid bounds', () => {
    const clip = [
      ['a', 'b'],
      ['c', 'd'],
    ];
    // active near the bottom-right corner of a 2×2-addressable grid (rows 0-1, cols 0-1).
    expect(pasteTargets(clip, { row: 1, col: 1 }, null, 2, 2)).toEqual([
      { row: 1, col: 1, text: 'a' },
    ]);
  });

  it('returns nothing for an empty clipboard', () => {
    expect(pasteTargets([], { row: 0, col: 0 }, null, 5, 5)).toEqual([]);
  });
});

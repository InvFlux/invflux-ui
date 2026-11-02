import { describe, expect, it } from 'vitest';
import {
  blurField,
  initialField,
  isMarkedInvalid,
  nudgeField,
  syncValue,
  typeInto,
} from './quantityField';

const NO_LIMITS = {};

describe('quantity field: typing and the parent', () => {
  it('starts from the value, formatted', () => {
    expect(initialField(25, 1).text).toBe('2.5');
    expect(initialField(null, 1).text).toBe('');
  });

  it('tells the parent every kind of result, not only the last valid number', () => {
    let s = initialField(null, 1);
    const heard: string[] = [];
    for (const text of ['2', '2,', '2,5', '2,55', '']) {
      const next = typeInto(s, text, NO_LIMITS);
      s = next.state;
      heard.push(next.parsed.kind);
    }
    expect(heard).toEqual(['ok', 'invalid', 'ok', 'too_many_decimals', 'empty']);
  });

  it('does not echo the parent back over what is being typed', () => {
    // At scale 1, "2,0" commits 20. The parent hands 20 back; the text must stay "2,0".
    let s = initialField(null, 1);
    s = typeInto(s, '2', NO_LIMITS).state;
    s = typeInto(s, '2,', NO_LIMITS).state;
    s = typeInto(s, '2,0', NO_LIMITS).state;
    expect(s.emitted).toBe(20);
    expect(syncValue(s, 20, 1).text).toBe('2,0');
    expect(syncValue(s, 20, 1)).toBe(s);
  });

  it('keeps the typed text when the parent derives null from an invalid result', () => {
    let s = initialField(25, 1);
    s = typeInto(s, '2,55', NO_LIMITS).state;
    expect(syncValue(s, null, 1).text).toBe('2,55');
  });

  it('lets a real external change overwrite the text, invalid text included', () => {
    let s = initialField(25, 1);
    s = typeInto(s, '2,55', NO_LIMITS).state;
    expect(syncValue(s, 40, 1).text).toBe('4');
    // ...and valid text too: the parent reset the line to its new maximum.
    let t = typeInto(initialField(null, 0), '3', NO_LIMITS).state;
    expect(syncValue(t, 9, 0).text).toBe('9');
    t = syncValue(t, 9, 0);
    expect(t.emitted).toBe(9);
  });

  it('rewrites the text when the scale changes under the same value', () => {
    const s = typeInto(initialField(null, 0), '5', NO_LIMITS).state;
    expect(syncValue(s, 5, 1).text).toBe('0.5');
    expect(syncValue(s, 5, 1).scale).toBe(1);
  });

  it('judges min and max as the parent set them', () => {
    const limits = { min: 1, max: 9 };
    expect(typeInto(initialField(null, 0), '0', limits).parsed.kind).toBe('out_of_range');
    expect(typeInto(initialField(null, 0), '10', limits).parsed.kind).toBe('out_of_range');
    expect(typeInto(initialField(null, 0), '5', limits).parsed).toEqual({ kind: 'ok', scaled: 5 });
  });
});

describe('quantity field: blur', () => {
  it('tidies a valid entry and leaves anything else as typed', () => {
    const typed = typeInto(initialField(null, 1), '2,0', NO_LIMITS).state;
    expect(blurField(typed, NO_LIMITS).text).toBe('2');
    const bad = typeInto(initialField(null, 1), '2,55', NO_LIMITS).state;
    expect(blurField(bad, NO_LIMITS).text).toBe('2,55');
    const empty = typeInto(initialField(null, 1), '', NO_LIMITS).state;
    expect(blurField(empty, NO_LIMITS).text).toBe('');
  });
});

describe('quantity field: nudging', () => {
  it('steps a whole unit, or the last decimal with the fine key', () => {
    const s = initialField(25, 1);
    expect(nudgeField(s, 1, false, NO_LIMITS)?.parsed).toEqual({ kind: 'ok', scaled: 35 });
    expect(nudgeField(s, 1, true, NO_LIMITS)?.state.text).toBe('2.6');
    expect(nudgeField(s, -1, true, NO_LIMITS)?.state.text).toBe('2.4');
  });

  it('floors at min and stops at max', () => {
    expect(nudgeField(initialField(1, 0), -1, false, { min: 1 })?.parsed).toEqual({
      kind: 'ok',
      scaled: 1,
    });
    expect(nudgeField(initialField(0, 0), -1, false, NO_LIMITS)?.parsed).toEqual({
      kind: 'ok',
      scaled: 0,
    });
    expect(nudgeField(initialField(9, 0), 1, false, { max: 9 })?.parsed).toEqual({
      kind: 'ok',
      scaled: 9,
    });
  });

  it('starts an empty field from zero', () => {
    expect(nudgeField(initialField(null, 0), 1, false, NO_LIMITS)?.parsed).toEqual({
      kind: 'ok',
      scaled: 1,
    });
    expect(nudgeField(initialField(null, 0), -1, false, { min: 1 })?.parsed).toEqual({
      kind: 'ok',
      scaled: 1,
    });
  });

  it('brings a value typed over the maximum back with a minus, and marks it until then', () => {
    const limits = { max: 9 };
    const over = typeInto(initialField(null, 0), '12', limits).state;
    expect(isMarkedInvalid(over, limits)).toBe(true);
    const back = nudgeField(over, -1, false, limits);
    expect(back?.parsed).toEqual({ kind: 'ok', scaled: 9 });
    expect(back && isMarkedInvalid(back.state, limits)).toBe(false);
  });

  it('leaves text that is not a number alone', () => {
    const s = typeInto(initialField(null, 1), '2,55', NO_LIMITS).state;
    expect(nudgeField(s, 1, false, NO_LIMITS)).toBeNull();
  });

  it('tells the parent the nudged value, and does not echo it back', () => {
    const next = nudgeField(initialField(25, 1), 1, false, NO_LIMITS);
    expect(next && syncValue(next.state, 35, 1)).toBe(next?.state);
  });
});

describe('quantity field: the live mark', () => {
  const mark = (text: string, scale: number, limits = NO_LIMITS) =>
    isMarkedInvalid(typeInto(initialField(null, scale), text, limits).state, limits);

  it('marks a value that can not be used, as it is typed', () => {
    expect(mark('abc', 0)).toBe(true);
    expect(mark('2,55', 1)).toBe(true);
    expect(mark('2,5', 0)).toBe(true);
    expect(mark('1 096', 0)).toBe(true);
    expect(mark('12', 0, { max: 9 })).toBe(true);
  });

  it('does not mark a good value or a missing one', () => {
    expect(mark('2,5', 1)).toBe(false);
    expect(mark('', 1)).toBe(false);
    expect(mark('  ', 0)).toBe(false);
  });

  it('waits out a separator typed on the way to the decimals', () => {
    expect(mark('2,', 1)).toBe(false);
    expect(mark('2.', 3)).toBe(false);
    // ...but a whole-unit field never takes one.
    expect(mark('2,', 0)).toBe(true);
  });
});

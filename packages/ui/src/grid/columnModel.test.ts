import { describe, expect, it } from 'vitest';
import { arrangeColumns, isColumnVisible, moveBeside, moveInOrder } from './columnModel';

const cols = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (columns: { id: string }[]) => columns.map((c) => c.id);

describe('isColumnVisible', () => {
  it('shows by default, hides a default-hidden column until it is chosen', () => {
    expect(isColumnVisible({ id: 'a' }, {})).toBe(true);
    expect(isColumnVisible({ id: 'a', defaultHidden: true }, {})).toBe(false);
    expect(isColumnVisible({ id: 'a', defaultHidden: true }, { a: true })).toBe(true);
    expect(isColumnVisible({ id: 'a' }, { a: false })).toBe(false);
  });

  it('never hides a required column, whatever was stored', () => {
    expect(isColumnVisible({ id: 'a', required: true }, { a: false })).toBe(true);
  });
});

describe('arrangeColumns', () => {
  it('follows the saved order', () => {
    expect(ids(arrangeColumns(cols('a', 'b', 'c'), ['c', 'a', 'b']))).toEqual(['c', 'a', 'b']);
  });

  it('puts a column the operator has never seen beside its default neighbor, not at the end', () => {
    expect(ids(arrangeColumns(cols('a', 'x', 'b', 'c'), ['c', 'a', 'b']))).toEqual([
      'c',
      'a',
      'x',
      'b',
    ]);
  });

  it('keeps the saved slot of a column that is unavailable for now', () => {
    // `b` is absent today; the saved order still has it between `a` and `c`.
    expect(ids(arrangeColumns(cols('a', 'c'), ['a', 'b', 'c']))).toEqual(['a', 'c']);
    // ...and it comes back where it was.
    expect(ids(arrangeColumns(cols('a', 'b', 'c'), ['a', 'b', 'c']))).toEqual(['a', 'b', 'c']);
  });
});

describe('moveInOrder', () => {
  it('moves the source into the target slot, in either direction', () => {
    expect(moveInOrder([], ['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveInOrder([], ['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves among the available columns without dropping the saved order of absent ones', () => {
    // saved a,b,c with b unavailable: moving c before a leaves b in the saved list.
    expect(moveInOrder(['a', 'b', 'c'], ['a', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
  });

  it('ignores an unknown id', () => {
    expect(moveInOrder([], ['a', 'b'], 'a', 'zz')).toEqual(['a', 'b']);
  });
});

describe('moveBeside', () => {
  it('lands in front of the target, or after it from its far half', () => {
    expect(moveBeside([], ['a', 'b', 'c', 'd'], 'd', 'b', false)).toEqual(['a', 'd', 'b', 'c']);
    expect(moveBeside([], ['a', 'b', 'c', 'd'], 'd', 'b', true)).toEqual(['a', 'b', 'd', 'c']);
    expect(moveBeside([], ['a', 'b', 'c', 'd'], 'a', 'c', true)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('leaves the order alone for a drop on itself or an unknown id', () => {
    expect(moveBeside([], ['a', 'b'], 'a', 'a', true)).toEqual(['a', 'b']);
    expect(moveBeside([], ['a', 'b'], 'a', 'zz', false)).toEqual(['a', 'b']);
  });
});

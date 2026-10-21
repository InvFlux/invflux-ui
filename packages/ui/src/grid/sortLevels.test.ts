import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SORT,
  addSortLevel,
  isDefaultSort,
  moveSortLevel,
  removeSortLevel,
  replaceSortColumn,
  setSortDirection,
  sortFromParams,
  sortToParams,
} from './sortLevels';

describe('sortToParams', () => {
  it('pairs columns and directions by position', () => {
    expect(
      sortToParams([
        { id: 'total', desc: true },
        { id: 'sku', desc: false },
      ]),
    ).toEqual({ sort_by: 'total,sku', sort_dir: 'desc,asc' });
  });

  it('sends the default sort for an empty list', () => {
    expect(sortToParams([])).toEqual({ sort_by: 'name', sort_dir: 'asc' });
  });
});

describe('sortFromParams', () => {
  it('reads the lists back in order', () => {
    expect(sortFromParams('total,sku', 'desc,asc')).toEqual([
      { id: 'total', desc: true },
      { id: 'sku', desc: false },
    ]);
  });

  it('reads a single sort as one level', () => {
    expect(sortFromParams('price', 'desc')).toEqual([{ id: 'price', desc: true }]);
  });

  it('keeps the first level of a repeated column and defaults a missing direction to ascending', () => {
    expect(sortFromParams('atp,atp,sku', 'desc')).toEqual([
      { id: 'atp', desc: true },
      { id: 'sku', desc: false },
    ]);
  });

  it('falls back to the default sort when nothing is usable', () => {
    expect(sortFromParams(null, null)).toEqual(DEFAULT_SORT);
    expect(sortFromParams(' , ', 'desc')).toEqual(DEFAULT_SORT);
  });

  it('round-trips through the parameters', () => {
    const levels = [
      { id: 'stock_value', desc: true },
      { id: 'name', desc: false },
    ];
    const params = sortToParams(levels);
    expect(sortFromParams(params.sort_by, params.sort_dir)).toEqual(levels);
  });
});

describe('isDefaultSort', () => {
  it('is true only for a single ascending name sort', () => {
    expect(isDefaultSort([{ id: 'name', desc: false }])).toBe(true);
    expect(isDefaultSort([{ id: 'name', desc: true }])).toBe(false);
    expect(
      isDefaultSort([
        { id: 'name', desc: false },
        { id: 'sku', desc: false },
      ]),
    ).toBe(false);
  });
});

describe('editing levels', () => {
  const two = [
    { id: 'total', desc: true },
    { id: 'sku', desc: false },
  ];

  it('adds a level at the end, once', () => {
    expect(addSortLevel(two, 'price', true)).toEqual([...two, { id: 'price', desc: true }]);
    expect(addSortLevel(two, 'sku', true)).toBe(two);
  });

  it('removes a level, and the last one returns to the default sort', () => {
    expect(removeSortLevel(two, 'total')).toEqual([{ id: 'sku', desc: false }]);
    expect(removeSortLevel([{ id: 'sku', desc: false }], 'sku')).toEqual(DEFAULT_SORT);
  });

  it('moves a level into another level’s slot', () => {
    const three = [...two, { id: 'price', desc: false }];
    expect(moveSortLevel(three, 'price', 'total').map((l) => l.id)).toEqual([
      'price',
      'total',
      'sku',
    ]);
    expect(moveSortLevel(three, 'total', 'price').map((l) => l.id)).toEqual([
      'sku',
      'price',
      'total',
    ]);
    expect(moveSortLevel(three, 'nope', 'total')).toBe(three);
  });

  it('points a level at another column, refusing one that already sorts', () => {
    expect(replaceSortColumn(two, 'sku', 'price')).toEqual([
      { id: 'total', desc: true },
      { id: 'price', desc: false },
    ]);
    expect(replaceSortColumn(two, 'sku', 'total')).toBe(two);
  });

  it('sets a level’s direction', () => {
    expect(setSortDirection(two, 'sku', true)[1]).toEqual({ id: 'sku', desc: true });
  });
});

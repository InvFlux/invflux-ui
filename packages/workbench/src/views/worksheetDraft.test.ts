import { describe, expect, it } from 'vitest';
import type { WorkbenchWorksheet } from '../types';
import {
  afterRefused,
  afterSaved,
  canAddColumn,
  columnKindLabel,
  columnName,
  columnNameError,
  draftFrom,
  hasErrors,
  isUnchanged,
  MAX_COLUMNS,
  newColumn,
  newColumnNameError,
  saveRequests,
  valuesRemoved,
  type WorksheetDraft,
} from './worksheetDraft';

const worksheet: WorkbenchWorksheet = {
  id: 4,
  name: 'Sale backup',
  description: 'Taken 29 Oct',
  visibility: 'site',
  itemCount: 12,
  columns: [
    {
      key: 'c1',
      columnId: 'worksheet.4.c1',
      name: 'Price',
      type: 'decimal:money',
      like: null,
      likeLabel: null,
      values: 10,
    },
    {
      key: 'c2',
      columnId: 'worksheet.4.c2',
      name: 'Status',
      type: null,
      like: 'post_status',
      likeLabel: 'Post status',
      values: 3,
    },
  ],
};

const withColumns = (
  d: WorksheetDraft,
  fn: (c: WorksheetDraft['columns'][number]) => WorksheetDraft['columns'][number],
): WorksheetDraft => ({
  ...d,
  columns: d.columns.map(fn),
});

describe('worksheet draft', () => {
  it('starts unchanged, and Save is enabled by any change', () => {
    const d = draftFrom(worksheet);
    expect(isUnchanged(d)).toBe(true);
    expect(isUnchanged({ ...d, description: 'Taken 30 Oct' })).toBe(false);
    expect(
      isUnchanged({ ...d, name: ' Sale backup ' }),
      'spaces around the name are no change',
    ).toBe(true);
    expect(isUnchanged(withColumns(d, (c) => (c.key === 'c1' ? { ...c, removed: true } : c)))).toBe(
      false,
    );
    expect(
      isUnchanged({ ...d, columns: [...d.columns, newColumn('Note', 'type:text', null)] }),
    ).toBe(false);
  });

  it('sends the worksheet, then removals, renames and additions, so a freed name can be reused', () => {
    let d = draftFrom(worksheet);
    d = { ...d, name: 'Sale backup, Oct', description: '  ' };
    d = withColumns(d, (c) =>
      c.key === 'c1' ? { ...c, removed: true } : { ...c, name: 'Status before sale' },
    );
    d = {
      ...d,
      columns: [
        ...d.columns,
        newColumn(' Price ', 'type:decimal:money', null),
        newColumn('Category', 'like:product_cat', 'Category'),
      ],
    };

    expect(
      saveRequests(d).map((r) => ({ kind: r.kind, ...('body' in r ? { body: r.body } : {}) })),
    ).toEqual([
      { kind: 'worksheet', body: { name: 'Sale backup, Oct', description: null } },
      { kind: 'remove' },
      { kind: 'rename', body: { name: 'Status before sale' } },
      { kind: 'add', body: { name: 'Price', type: 'decimal:money' } },
      { kind: 'add', body: { name: 'Category', like: 'product_cat' } },
    ]);
  });

  it('checks names against the columns kept, in any case', () => {
    let d = draftFrom(worksheet);
    expect(newColumnNameError(d, 'price')).not.toBeNull();
    expect(newColumnNameError(d, '  ')).not.toBeNull();
    expect(newColumnNameError(d, 'x'.repeat(101))).not.toBeNull();
    expect(newColumnNameError(d, 'Note')).toBeNull();

    d = withColumns(d, (c) => (c.key === 'c1' ? { ...c, removed: true } : c));
    expect(newColumnNameError(d, 'price'), 'a removed column frees its name').toBeNull();

    d = withColumns(draftFrom(worksheet), (c) => (c.key === 'c2' ? { ...c, name: 'PRICE' } : c));
    expect(columnNameError(d, d.columns[1])).not.toBeNull();
    expect(hasErrors(d)).toBe(true);
    expect(hasErrors({ ...draftFrom(worksheet), name: ' ' })).toBe(true);
  });

  it('counts only the values of saved columns being removed', () => {
    let d = draftFrom(worksheet);
    d = withColumns(d, (c) => ({ ...c, removed: true }));
    expect(valuesRemoved(d)).toBe(13);
    expect(saveRequests(d).filter((r) => r.kind === 'remove')).toHaveLength(2);
  });

  it('stops offering Add at the most columns a worksheet may hold', () => {
    const d = draftFrom(worksheet);
    const full = {
      ...d,
      columns: [
        ...d.columns,
        ...Array.from({ length: MAX_COLUMNS - 2 }, (_, i) => newColumn(`C${i}`, 'type:text', null)),
      ],
    };
    expect(canAddColumn(d)).toBe(true);
    expect(canAddColumn(full)).toBe(false);
    expect(
      canAddColumn(withColumns(full, (c) => (c.key === 'c1' ? { ...c, removed: true } : c))),
    ).toBe(true);
  });

  it('records what landed, and keeps what did not, with its error', () => {
    let d = draftFrom(worksheet);
    const added = newColumn('Note', 'type:text', null);
    d = { ...d, columns: [...d.columns, added] };
    const [add] = saveRequests(d);
    d = afterSaved(d, add, {
      key: 'c3',
      columnId: 'worksheet.4.c3',
      name: 'Note',
      type: 'text',
      like: null,
      likeLabel: null,
      values: 0,
    });
    expect(d.columns[2]).toMatchObject({
      key: 'c3',
      columnId: 'worksheet.4.c3',
      savedName: 'Note',
    });
    expect(isUnchanged(d)).toBe(true);

    d = withColumns(d, (c) => (c.key === 'c2' ? { ...c, name: 'Note' } : c));
    const [rename] = saveRequests(d);
    d = afterRefused(d, rename, 'This worksheet already has a column with that name.');
    expect(d.columns[1].serverError).toBe('This worksheet already has a column with that name.');
    expect(saveRequests(d)).toHaveLength(1);
  });

  it('says what a column holds', () => {
    expect(columnKindLabel({ type: 'decimal:money', like: null, likeLabel: null })).toBe('Money');
    expect(columnKindLabel({ type: null, like: 'post_status', likeLabel: 'Post status' })).toBe(
      'Like Post status',
    );
    expect(columnKindLabel({ type: null, like: 'meta.gone', likeLabel: null })).toBe(
      'Like a column that is no longer available',
    );
  });

  it('names a column made like another after it when no name is typed', () => {
    const d = draftFrom(worksheet);
    const color = newColumn('  ', 'like:attribute.pa_color', 'Color');
    expect(columnName(color)).toBe('Color');
    expect(columnName(newColumn('', 'type:text', null)), 'a plain column has no namesake').toBe('');
    const withColor = { ...d, columns: [...d.columns, color] };
    expect(columnNameError(withColor, color)).toBeNull();
    expect(saveRequests(withColor).at(-1)).toMatchObject({
      kind: 'add',
      body: { name: 'Color', like: 'attribute.pa_color' },
    });
    expect(
      newColumnNameError(withColor, '', 'like:attribute.pa_color', 'Color'),
      'a second column like Color needs a name of its own',
    ).not.toBeNull();

    // A saved column named after its source reads as inheriting, and is unchanged.
    const saved = draftFrom({
      ...worksheet,
      columns: [
        {
          key: 'c9',
          columnId: 'worksheet.4.c9',
          name: 'Color',
          type: null,
          like: 'attribute.pa_color',
          likeLabel: 'Color',
          values: 0,
        },
      ],
    });
    expect(saved.columns[0].name).toBe('');
    expect(isUnchanged(saved)).toBe(true);
  });

  it('keeps where a mirrored column takes its values from, from the list or the pick', () => {
    const listed = draftFrom({
      ...worksheet,
      columns: [
        {
          key: 'c9',
          columnId: 'worksheet.4.c9',
          name: 'Color',
          type: null,
          like: 'attr.color',
          likeLabel: 'Color',
          likeOrigin: 'Custom attribute',
          values: 0,
        },
      ],
    });
    expect(listed.columns[0].likeOrigin).toBe('Custom attribute');
    expect(draftFrom(worksheet).columns[1].likeOrigin, 'absent from an older server').toBeNull();
    expect(newColumn('', 'like:attr.pa_size', 'Size', 'Global attribute').likeOrigin).toBe(
      'Global attribute',
    );
  });
});

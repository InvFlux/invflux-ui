import { type ColumnModel, DataTable, type DataTableColumn } from '@invflux/ui';
import type { JSX } from 'solid-js';

/**
 * One column of a {@link ReadLinesTable}: a {@link DataTableColumn}, with the width written as the
 * class (`w-28`) this table has always taken.
 */
export type ReadColumn<Row> = Omit<DataTableColumn<Row>, 'widthClass'> & {
  /** Width class (`w-28`); omitted, the column takes what is left. */
  width?: string;
};

/**
 * The read-only lines of a procurement document — a purchase order's once it has been sent, a goods
 * receipt's once it has been posted — in one look: a rounded, filled box with a raised header and
 * hoverable rows, scrolling inside itself rather than pushing the page sideways.
 *
 * Declarative on purpose: a caller hands over the columns it shows (already filtered by whatever
 * visibility it keeps) and the rows, and gets the same table every other document shows. The
 * table itself is the shared {@link DataTable}, so a column that declares a `sortValue` sorts from
 * its header, and the operator can resize any column.
 */
export function ReadLinesTable<Row>(props: {
  columns: ReadColumn<Row>[];
  rows: Row[];
  /** Shown in place of the rows when there are none. */
  empty: string;
  /** Label for the total row's first cell. The row appears when a column defines `total`. */
  totalLabel?: string;
  /**
   * Fill the box down to the viewport bottom, less this gutter (a CSS length), so a long document
   * scrolls inside it and whatever sits below stays on screen. Omitted, the box grows with its rows.
   */
  fillGutter?: string;
  testId?: string;
  /** Where the table keeps its display settings (row height, wrapping, text size). Omitted, they last for the session. */
  scope?: string;
  /** The operator's column choices, where the caller keeps them in the shared model. */
  model?: ColumnModel;
}): JSX.Element {
  return (
    <DataTable
      columns={props.columns.map(({ width, ...column }) => ({ ...column, widthClass: width }))}
      rows={props.rows}
      empty={props.empty}
      totalLabel={props.totalLabel}
      fillGutter={props.fillGutter}
      testId={props.testId}
      model={props.model}
      scope={props.scope}
    />
  );
}

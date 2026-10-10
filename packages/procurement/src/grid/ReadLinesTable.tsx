import { createViewportFill } from '@invflux/ui';
import { For, type JSX, Show } from 'solid-js';

/** One column of a {@link ReadLinesTable}. */
export interface ReadColumn<Row> {
  id: string;
  /** Header text, or nothing for a column that needs no heading (a thumbnail). */
  header?: JSX.Element;
  /** Tooltip on the header: what the column means, when its name alone could be over-read. */
  title?: string;
  /**
   * How the cell reads. `text` (left) for names, `code` (left, monospaced) for machine-readable
   * identifiers so their digits align, `num` (right, tabular) for quantities and money, `center`
   * for a badge.
   */
  kind?: 'text' | 'code' | 'num' | 'center';
  /** Width class (`w-28`); omitted, the column takes what is left. */
  width?: string;
  cell: (row: Row) => JSX.Element;
  /** The column's cell in the total row, if the table has one. */
  total?: () => JSX.Element;
}

const TH: Record<NonNullable<ReadColumn<unknown>['kind']>, string> = {
  text: 'text-left',
  code: 'text-left',
  num: 'text-right',
  center: 'text-center',
};
const TD: Record<NonNullable<ReadColumn<unknown>['kind']>, string> = {
  text: '',
  code: 'font-mono text-xs text-slate-500',
  num: 'text-right tabular-nums',
  center: 'text-center',
};

/**
 * The read-only lines of a procurement document — a purchase order's once it has been sent, a goods
 * receipt's once it has been posted — in one look: a rounded, filled box with a raised header and
 * hoverable rows, scrolling inside itself rather than pushing the page sideways.
 *
 * Declarative on purpose: a caller hands over the columns it shows (already filtered by whatever
 * visibility it keeps) and the rows, and gets the same table every other document shows. It is the
 * one place to swap for a shared read-only grid with sortable, resizable columns.
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
}): JSX.Element {
  let box: HTMLDivElement | undefined;
  const height = createViewportFill(() => box);
  const hasTotal = (): boolean => props.columns.some((c) => undefined !== c.total);
  const kind = (c: ReadColumn<Row>): NonNullable<ReadColumn<Row>['kind']> => c.kind ?? 'text';

  return (
    <div
      ref={(el) => (box = el)}
      class="box-border overflow-auto rounded border border-border bg-surface"
      style={
        undefined === props.fillGutter
          ? undefined
          : { height: `calc(${height()} - ${props.fillGutter})` }
      }
    >
      {/* `min-w-full`, not `w-full`: the latter pins the table to the box and makes the columns
          compress instead, so the scroll container it sits in would never have anything to scroll. */}
      <table class="min-w-full border-collapse text-sm" data-testid={props.testId}>
        <thead class="bg-surface-raised">
          <tr>
            <For each={props.columns}>
              {(c) => (
                <th
                  class={`border-b border-slate-200 px-3 py-2 font-semibold text-slate-600 ${TH[kind(c)]} ${c.width ?? ''}`}
                  title={c.title}
                >
                  {c.header}
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {(row) => (
              <tr class="hover:bg-slate-50">
                <For each={props.columns}>
                  {(c) => (
                    <td class={`border-b border-slate-100 px-3 py-1.5 ${TD[kind(c)]}`}>
                      {c.cell(row)}
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
          <Show when={0 === props.rows.length}>
            <tr>
              <td colspan={props.columns.length} class="px-3 py-3 text-slate-500">
                {props.empty}
              </td>
            </tr>
          </Show>
        </tbody>
        <Show when={hasTotal() && props.rows.length > 0}>
          <tfoot>
            <tr class="bg-surface-raised font-semibold">
              <For each={props.columns}>
                {(c, i) => (
                  <td class={`px-3 py-2 ${TD[kind(c)]}`}>
                    {undefined !== c.total ? c.total() : 0 === i() ? props.totalLabel : null}
                  </td>
                )}
              </For>
            </tr>
          </tfoot>
        </Show>
      </table>
    </div>
  );
}

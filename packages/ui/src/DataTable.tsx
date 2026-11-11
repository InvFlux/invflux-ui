import {
  type ColumnDef,
  createSolidTable,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
} from '@tanstack/solid-table';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';
import { ColumnPicker, type PickableColumn } from './ColumnPicker';
import {
  arrangeColumns,
  type ColumnModel,
  type ColumnSpec,
  createColumnModel,
  isColumnVisible,
  moveBeside,
  moveInOrder,
} from './grid/columnModel';
import { GridHeaderCell } from './grid/GridHeaderCell';
import { createHeaderDnd } from './grid/headerDnd';
import { sortFromHeader, sortKeyFn, sortNilLast } from './grid/tableSort';
import {
  ContextMenu,
  type ContextMenuItem,
  type DataGridMenuItem,
  toContextMenuItem,
} from './grid/ContextMenu';
import { GridSettingsModal } from './grid/GridDisplaySettings';
import {
  cellDensityTextFor,
  cellWrapClassFor,
  headerLookFor,
  wrapForColumn,
} from './grid/gridSettings';
import { createVirtualizer } from '@tanstack/solid-virtual';
import { __, _x } from '@invflux/i18n';
import { createViewportFill } from './viewportFill';

/** How a cell reads. `code` is for machine-readable identifiers, `num` for quantities and money. */
export type DataTableKind = 'text' | 'code' | 'num' | 'center';

/** The widths a column may collapse below; Tailwind's own, applied to the table's box. */
export type DataTableBreakpoint = 'sm' | 'md' | 'lg';

const BREAKPOINT_PX: Record<DataTableBreakpoint, number> = { sm: 640, md: 768, lg: 1024 };

/** The `border-spacing-y` of the `separated` look, in pixels: a row's footprint is its height plus this. */
const SEPARATED_GAP = 3;
/** How near the end of the loaded rows the last drawn row must be for `onNearEnd` to fire. */
const NEAR_END = 20;
const DEFAULT_OVERSCAN = 8;

/**
 * Draw only the rows in (and just around) the box's viewport, so a table of thousands of rows stays
 * as cheap as one of fifty. See {@link DataTableProps.virtual}.
 */
export interface DataTableVirtual {
  /** A row's height in pixels before it is drawn; drawn rows are measured, so this only has to be near. */
  estimateSize: number;
  /** Rows drawn beyond each edge of the viewport. Default 8. */
  overscan?: number;
  /**
   * Called when the last drawn row comes within 20 rows of the end of the loaded rows: the caller's
   * cue to fetch the next page. It fires once per length of the list, so a slow fetch is not asked
   * twice, and fires again when the reader scrolls away and back.
   */
  onNearEnd?: () => void;
}

/** What a cell can learn about the table it sits in. */
export interface DataTableCellContext {
  /** True while the column is hidden for want of width (`collapseBelow`), so another cell can carry its value. */
  collapsed: (columnId: string) => boolean;
}

export interface DataTableColumn<Row> extends ColumnSpec {
  /** Header content; nothing for a column that needs no heading (a thumbnail). */
  header?: JSX.Element;
  /** The column's name where text is needed — the picker, the sort button. Defaults to a string header, then the id. */
  label?: () => string;
  /** Tooltip on the header: what the column means, when its name alone could be over-read. */
  title?: string;
  kind?: DataTableKind;
  /** A width class (`w-28`) for the natural layout; once the operator resizes, pixel widths take over. */
  widthClass?: string;
  /**
   * A cell is a render function, not a value and a formatter: it may be a link, a badge, a struck-through figure.
   * The second argument says what the table has done to its columns (see {@link DataTableCellContext}).
   */
  cell?: (row: Row, context: DataTableCellContext) => JSX.Element;
  /**
   * The same, for a cell that holds state of its own (an open popover, a focused control). It is built
   * once for the row and reads the row through the accessor, so a refetch that hands back new row data
   * updates it in place instead of rebuilding it. Takes precedence over `cell`.
   */
  cellOf?: (row: Accessor<Row>, context: DataTableCellContext) => JSX.Element;
  /**
   * Hide this column while the table's box is narrower than the breakpoint (`sm` 640 px, `md` 768,
   * `lg` 1024). The width is the table's own box, not the window: a table beside a side menu is
   * narrower than the screen. The column stays ticked in the picker, marked as hidden on narrow
   * screens; a column the operator has hidden stays hidden and is never reported as collapsed. The
   * cell that carries the value instead reads `context.collapsed(id)`.
   */
  collapseBelow?: DataTableBreakpoint;
  /**
   * What the column sorts by; the column is sortable exactly when this is set. A real number for a
   * quantity (never the scaled integer: rows of different scales would sort wrong against each other).
   */
  sortValue?: (row: Row) => string | number | null | undefined;
  /** This column's cell in the total row, if the table has one. Moves with the column. */
  total?: () => JSX.Element;
  /** Default true; a column that cannot usefully be resized turns it off. */
  resizable?: boolean;
  /**
   * A width in pixels that holds in every layout, natural or fixed, whatever sizing was stored (a
   * thumbnail column is exactly its thumbnail). The column is not resizable.
   */
  size?: number;
  /**
   * Where a column starts, in pixels, when it may still be resized (a thumbnail that begins at its
   * image's width). It is the width in the natural layout and the seed's starting point; unlike a
   * plain column it never takes a share of spare width in the fixed layout, so it stays where the
   * operator left it. Ignored when `size` is set.
   */
  defaultSize?: number;
}

export interface DataTableProps<Row> {
  /** The columns available *now*. Which are shown, and in what order, is the operator's (see `model`). */
  columns: DataTableColumn<Row>[];
  rows: readonly Row[];
  /** Shown in place of the rows when there are none. */
  empty: JSX.Element;
  /**
   * The operator's choices: order, visibility, widths, and the picker. Omit it and the table keeps
   * none of them; reordering and the picker are then off. Create it with {@link createColumnModel}
   * so the caller can put the picker's trigger wherever it belongs.
   */
  model?: ColumnModel;
  /** Header sort. Default true; false leaves the caller's row order alone. */
  sortable?: boolean;
  /** Controlled sorting, for a table whose order is the server's. Rows are then shown as given. */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  /**
   * What the table's right-click header menu adds for one column: a filter, a column's own actions.
   * Above the table's own sort / hide / columns / display items. Whatever the item does is the
   * caller's: the table filters nothing itself.
   */
  headerMenuExtras?: (context: { columnId: string }) => DataGridMenuItem[];
  /** Where the table keeps its display settings when it has no `model`. Omitted, they last for the session. */
  scope?: string;
  /** Column resize. Default true. */
  resizable?: boolean;
  /** Drag a header to reorder. Default: on when a `model` is given. */
  reorderable?: boolean;
  /**
   * A stable identity per row. Rows are matched by it across a refetch, so a row keeps its element
   * (and whatever state its cells hold) when the data under it is replaced, and a reorder moves the
   * element instead of rebuilding it. Default: the row's position.
   */
  rowKey?: (row: Row) => string;
  /** Per-row class and attributes, re-evaluated when the row changes (a staged tint, `data-armed`). */
  rowProps?: (row: Row) => DataTableRowProps;
  /** A click that reaches a row's own area (a control inside a cell handles its own). */
  onRowClick?: (row: Row, event: MouseEvent) => void;
  onRowContextMenu?: (row: Row, event: MouseEvent) => void;
  /**
   * `plain`: ruled rows in one box. `separated`: each row is a surface of its own, with a gap between
   * them; the fill and the rounded ends are on the cells, so a row tint is written `[&>td]:bg-…`.
   */
  look?: 'plain' | 'separated';
  /** Label for the total row's first cell. The row appears when a column defines `total`. */
  totalLabel?: JSX.Element;
  /**
   * Fill the box down to the viewport bottom, less this gutter (a CSS length), so a long document
   * scrolls inside it and whatever sits below stays on screen. Omitted, the box grows with its rows.
   */
  fillGutter?: string;
  /**
   * Draw only the rows the box shows. Off by default, so a table that does not pass it is unchanged.
   * It is chosen when the table is built, like `model`. The box must have a height of its own to
   * scroll in (`fillGutter`, or a caller that bounds it); in a box that grows with its rows every row
   * is in view and every row is drawn. The sorted rows are what is sliced, so sort and filtering keep
   * working; the rows above and below the drawn ones are spacer rows, sized from the measured heights.
   */
  virtual?: DataTableVirtual;
  /**
   * The row (by `rowKey`) the caller treats as current, kept in view when it changes: the queue's
   * ↑/↓. Only changes of this value scroll — new rows arriving never pull the reader back to it.
   * Needs `virtual`; a table that draws every row leaves scrolling to the caller.
   */
  activeRow?: string;
  /** The row the pointer is on, or `null` when it leaves the table. */
  onRowHover?: (row: Row | null) => void;
  testId?: string;
}

/** What a caller may say about one row. */
export interface DataTableRowProps {
  class?: string;
  /** Extra attributes, typically `data-*`. An `undefined` value leaves the attribute off. */
  attrs?: Record<string, string | number | boolean | undefined>;
}

const TD: Record<DataTableKind, string> = {
  text: '',
  code: 'font-mono text-xs text-slate-500',
  num: 'text-right tabular-nums',
  center: 'text-center',
};

/**
 * A read-only table with a grid's column handling: header sort, drag to reorder, resize, and a
 * column picker, over rows that are plain rows — no cell selection, no editing.
 *
 * The header is {@link GridHeaderCell}, the one the spreadsheet grid uses, so the two read and
 * behave alike. The table owns no data and no paging: it shows the rows it is given. A long list opts
 * into `virtual`, which draws only the rows in view; the table already owns the scrolling box and the
 * sticky header the windowing is measured against.
 *
 * Widths are natural until the operator first drags a grip; that moment measures every column and
 * switches the table to fixed pixel widths, so nothing jumps. Double-clicking a grip gives the
 * natural layout back.
 */
export function DataTable<Row>(props: DataTableProps<Row>): JSX.Element {
  // The model is chosen once, as the table is built: swapping it for another would orphan its signals.
  const model =
    untrack(() => props.model) ?? createColumnModel({ scope: untrack(() => props.scope) });
  const [ownSorting, setOwnSorting] = createSignal<SortingState>([]);
  const controlled = (): boolean => undefined !== props.onSortingChange;
  const sorting = (): SortingState => props.sorting ?? ownSorting();
  const reorderable = (): boolean => props.reorderable ?? undefined !== props.model;

  const arranged = createMemo(() => arrangeColumns(props.columns, model.order()));
  // The box's width, 0 until it is first measured (a table is not collapsed on a guess).
  const [boxWidth, setBoxWidth] = createSignal(0);
  // Columns the operator wants but the width cannot hold. Compared by content so a window drag that
  // changes no column's fate does not rebuild the table.
  const collapsedIds = createMemo<string[]>(
    () =>
      arranged()
        .filter(
          (column) =>
            undefined !== column.collapseBelow &&
            isColumnVisible(column, model.visibility()) &&
            0 !== boxWidth() &&
            boxWidth() < BREAKPOINT_PX[column.collapseBelow],
        )
        .map((column) => column.id),
    [],
    { equals: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]) },
  );
  const cellContext: DataTableCellContext = {
    collapsed: (columnId) => collapsedIds().includes(columnId),
  };
  const shown = createMemo(() =>
    arranged().filter(
      (column) =>
        isColumnVisible(column, model.visibility()) && !collapsedIds().includes(column.id),
    ),
  );
  const specById = createMemo(() => new Map(shown().map((column) => [column.id, column])));

  const defs = createMemo<ColumnDef<Row, unknown>[]>(() =>
    shown().map((column) => ({
      id: column.id,
      accessorFn: (row: Row) => column.sortValue?.(row),
      header: () => column.header ?? '',
      enableSorting: false !== props.sortable && undefined !== column.sortValue,
      enableResizing:
        false !== props.resizable && false !== column.resizable && undefined === column.size,
      // Equal bounds make TanStack's own clamp hold the width against any stored sizing.
      ...(undefined === column.size
        ? {}
        : { size: column.size, minSize: column.size, maxSize: column.size }),
      ...(undefined !== column.size || undefined === column.defaultSize
        ? {}
        : { size: column.defaultSize }),
      sortingFn: sortKeyFn,
      sortUndefined: sortNilLast,
    })),
  );

  const table = createSolidTable<Row>({
    get data() {
      return props.rows as Row[];
    },
    get columns() {
      return defs();
    },
    state: {
      get sorting() {
        return sorting();
      },
      get columnSizing() {
        return model.sizing();
      },
    },
    get manualSorting() {
      return controlled();
    },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting()) : updater;
      if (undefined !== props.onSortingChange) props.onSortingChange(next);
      else setOwnSorting(next);
    },
    getRowId: (row, index) => props.rowKey?.(row) ?? String(index),
    onColumnSizingChange: (updater) =>
      model.setSizing((prev) => (typeof updater === 'function' ? updater(prev) : updater)),
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const dnd = createHeaderDnd({
    drop: (sourceId, targetId, after) =>
      model.setOrder((saved) =>
        moveBeside(
          saved,
          props.columns.map((column) => column.id),
          sourceId,
          targetId,
          after,
        ),
      ),
  });

  // Natural widths until the first grip press: measure every column, then switch to fixed pixels.
  const fixedLayout = (): boolean => Object.keys(model.sizing()).length > 0;
  let head: HTMLTableSectionElement | undefined;
  // The column whose grip is held. While it is held, spare width goes only to the free columns to its
  // right (see `fixedWidths`), so the columns up to the grip keep their stored widths and the grip
  // stays under the pointer.
  const [gripColumn, setGripColumn] = createSignal<string | null>(null);
  const seedSizing = (event: Event): void => {
    if (undefined === head) return;
    const grip = (event.target as HTMLElement).closest('[role="separator"]');
    if (null === grip) return;
    const natural = !fixedLayout();
    if (natural) {
      const measured: Record<string, number> = {};
      head.querySelectorAll<HTMLElement>('th[data-col-id]').forEach((th) => {
        measured[th.dataset.colId ?? ''] = Math.round(th.getBoundingClientRect().width);
      });
      model.setSizing(() => measured);
    } else {
      // Stored widths are not what is on screen while there is spare width: bake what is shown in,
      // so the drag starts from it and nothing moves when the grip is taken.
      model.setSizing(() => fixedWidths());
    }
    setGripColumn(grip.closest<HTMLElement>('th')?.dataset.colId ?? null);
    // A press that never becomes a drag (a double-click, a click that landed on the grip) leaves the
    // table as it was: the measure only exists so that a drag starts from the real widths.
    const touch = 'touchstart' === event.type;
    const point = (e: Event): number =>
      touch ? ((e as TouchEvent).touches[0]?.clientX ?? 0) : (e as MouseEvent).clientX;
    const startX = point(event);
    let dragged = false;
    const onMove = (e: Event): void => {
      if (Math.abs(point(e) - startX) > 2) dragged = true;
    };
    const moveEvent = touch ? 'touchmove' : 'mousemove';
    const endEvent = touch ? 'touchend' : 'mouseup';
    window.addEventListener(moveEvent, onMove, true);
    window.addEventListener(
      endEvent,
      () => {
        window.removeEventListener(moveEvent, onMove, true);
        if (dragged) {
          // Let go: the widths on screen become the stored ones, so releasing the grip moves nothing.
          model.setSizing(() => fixedWidths());
        } else if (natural) {
          model.setSizing(() => ({}));
        }
        setGripColumn(null);
      },
      { once: true },
    );
  };

  // A no-wrap cell clips at its own edge. `cellWrapClassFor` truncates the cell's element children, but
  // text placed directly in the cell, or an inline run, is not one — and in the fixed layout nothing
  // else stops it painting over the next cell.
  const clipClassFor = (columnId: string): string =>
    'no-wrap' === wrapForColumn(model.settings(), columnId) ? ' overflow-hidden text-ellipsis' : '';

  // Natural layout: an exact column is pinned between equal bounds, a column with a starting width
  // only starts there.
  const fixedWidthStyle = (
    spec: DataTableColumn<Row> | undefined,
  ): JSX.CSSProperties | undefined => {
    if (undefined !== spec?.size) {
      return {
        width: `${spec.size}px`,
        'min-width': `${spec.size}px`,
        'max-width': `${spec.size}px`,
      };
    }

    return undefined === spec?.defaultSize ? undefined : { width: `${spec.defaultSize}px` };
  };

  const nameOf = (column: DataTableColumn<Row>): string =>
    column.label?.() ?? ('string' === typeof column.header ? column.header : column.id);
  const pickable = (): PickableColumn[] =>
    arranged().map((column) => ({
      id: column.id,
      label: () => nameOf(column),
      required: column.required,
      note: () => (collapsedIds().includes(column.id) ? __('Hidden on narrow screens') : undefined),
    }));
  const hiddenIds = (): string[] =>
    arranged()
      .filter((column) => !isColumnVisible(column, model.visibility()))
      .map((column) => column.id);

  const separated = (): boolean => 'separated' === props.look;
  // Rows are listed by id, a string, so a refetch that returns new row objects under the same ids
  // keeps every row element; the row itself is read through `rowById`.
  const rowById = createMemo(() => new Map(table.getRowModel().rows.map((r) => [r.id, r])));
  const rowIds = createMemo<string[]>(() => table.getRowModel().rows.map((r) => r.id), [], {
    equals: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]),
  });
  const indexById = createMemo(() => new Map(rowIds().map((id, index) => [id, index])));

  // ── Virtual rows ─────────────────────────────────────────────────────────────────────────────
  // Built only when the table is built with `virtual`; a table without it never creates one.
  // The scrolling box; the virtualizer asks for it as soon as it is built, so it is declared first.
  let box: HTMLDivElement | undefined;
  const [headHeight, setHeadHeight] = createSignal(0);
  const rowElements = new Set<HTMLTableRowElement>();
  // What each row measured, by id. The virtualizer forgets its own measurements whenever the list
  // changes (the Solid adapter re-measures on every option change), so a page of new rows would send
  // every row above back to the estimate and shift what the reader is looking at; the estimate it
  // asks for is the row's last measured height instead.
  const measuredHeights = new Map<string, number>();
  // In the separated look every row, the spacers included, is followed by a gap of this size.
  const spacerGap = (): number => (separated() ? SEPARATED_GAP : 0);
  // Where the list begins in the box: under the header, and in the separated look under the gaps
  // above and below the header row as well.
  const listStart = (): number => headHeight() + 2 * spacerGap();
  const virtualizer =
    undefined === untrack(() => props.virtual)
      ? undefined
      : createVirtualizer<HTMLDivElement, HTMLTableRowElement>({
          get count() {
            return rowIds().length;
          },
          getScrollElement: () => box ?? null,
          estimateSize: (index) =>
            measuredHeights.get(rowIds()[index] ?? '') ?? props.virtual?.estimateSize ?? 0,
          get overscan() {
            return props.virtual?.overscan ?? DEFAULT_OVERSCAN;
          },
          // Sizes follow a row, not a position, so a refetch that reorders the rows keeps what was measured.
          getItemKey: (index) => rowIds()[index] ?? index,
          // The sticky header sits inside the scrolling box: the list starts below it, and a row scrolled
          // to must not stop beneath it.
          get scrollMargin() {
            return listStart();
          },
          get scrollPaddingStart() {
            return headHeight();
          },
          // A row's footprint in the separated look includes the gap that follows it.
          measureElement: (element) => {
            const height =
              element.getBoundingClientRect().height + (separated() ? SEPARATED_GAP : 0);
            const id = rowIds()[Number(element.dataset.index)];
            if (undefined !== id) measuredHeights.set(id, height);

            return height;
          },
        });
  // The rows in the window, by id, so scrolling keeps the elements of the rows that stay in view.
  const windowIds = createMemo<string[]>(
    () => {
      if (undefined === virtualizer) return rowIds();
      const ids = rowIds();

      return virtualizer
        .getVirtualItems()
        .map((item) => ids[item.index])
        .filter((id): id is string => undefined !== id);
    },
    [],
    { equals: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]) },
  );
  // The spacers stand in for the rows above and below the window. In the separated look each row,
  // spacers included, is followed by a gap that the row's measured footprint already counts, so a
  // spacer is that much shorter than the run of rows it stands for.
  const spacerBefore = (): number => {
    const first = virtualizer?.getVirtualItems()[0];

    return undefined === first ? 0 : Math.max(0, first.start - listStart() - spacerGap());
  };
  const spacerAfter = (): number => {
    const items = virtualizer?.getVirtualItems() ?? [];
    const last = items[items.length - 1];

    return undefined === virtualizer || undefined === last
      ? 0
      : Math.max(0, virtualizer.getTotalSize() - (last.end - listStart()) - spacerGap());
  };
  // Measurements are reset whenever the list changes, and a drawn row is only measured as it is
  // created or resized, so measure the drawn rows again after the window or the length moves.
  createEffect(
    on([windowIds, () => rowIds().length], () => {
      if (undefined === virtualizer) return;
      queueMicrotask(() => rowElements.forEach((element) => virtualizer.measureElement(element)));
    }),
  );
  createEffect(() => {
    const key = props.activeRow;
    if (undefined === virtualizer || undefined === key) return;
    // Only a change of the active row scrolls: the index is read untracked, so a page of new rows
    // does not pull the reader back to it.
    const index = untrack(() => indexById().get(key));
    if (undefined !== index) untrack(() => virtualizer.scrollToIndex(index, { align: 'auto' }));
  });
  let nearEndFiredFor = -1;
  createEffect(() => {
    if (undefined === virtualizer) return;
    const items = virtualizer.getVirtualItems();
    const count = rowIds().length;
    const last = items[items.length - 1]?.index ?? -1;
    if (0 === count || last < count - NEAR_END) {
      nearEndFiredFor = -1;

      return;
    }
    if (count === nearEndFiredFor) return;
    nearEndFiredFor = count;
    untrack(() => props.virtual?.onNearEnd?.());
  });

  const cellContent = (spec: DataTableColumn<Row> | undefined, row: Accessor<Row>): JSX.Element => {
    if (undefined === spec) return null;
    if (undefined !== spec.cellOf) return untrack(() => spec.cellOf?.(row, cellContext));

    return spec.cell?.(row(), cellContext);
  };

  // ── Header menu ──────────────────────────────────────────────────────────────────────────────
  const [headerMenu, setHeaderMenu] = createSignal<{
    x: number;
    y: number;
    columnId: string;
  } | null>(null);
  const headerMenuItems = (columnId: string): ContextMenuItem[] => {
    const column = table.getColumn(columnId);
    const spec = specById().get(columnId);
    if (undefined === column || undefined === spec) return [];
    const items: ContextMenuItem[] = [];

    if (column.getCanSort()) {
      const sorted = column.getIsSorted();
      items.push({
        key: 'sort-asc',
        label: __('Sort ascending'),
        shortcut: 'asc' === sorted ? '✓' : undefined,
        run: () => column.toggleSorting(false),
      });
      items.push({
        key: 'sort-desc',
        label: __('Sort descending'),
        shortcut: 'desc' === sorted ? '✓' : undefined,
        run: () => column.toggleSorting(true),
      });
      if (false !== sorted) {
        items.push({
          key: 'sort-clear',
          label: __('Clear sort'),
          run: () => column.clearSorting(),
        });
      }
    }

    // Per-column wrapping as a three-way choice, as the grid offers it: the mark shows what is stored.
    const pinned = model.settings().columnWrap[columnId];
    const setWrap = (wrap: 'wrap' | 'no-wrap' | null): void => {
      const columnWrap = { ...model.settings().columnWrap };
      if (null === wrap) delete columnWrap[columnId];
      else columnWrap[columnId] = wrap;
      model.setSettings({ ...model.settings(), columnWrap });
    };
    items.push({
      key: 'wrap-column',
      label: __('Wrap column contents'),
      children: [
        {
          key: 'wrap-yes',
          label: __('Yes'),
          shortcut: 'wrap' === pinned ? '✓' : undefined,
          run: () => setWrap('wrap'),
        },
        {
          key: 'wrap-no',
          label: __('No'),
          shortcut: 'no-wrap' === pinned ? '✓' : undefined,
          run: () => setWrap('no-wrap'),
        },
        {
          key: 'wrap-inherit',
          label: __('Follow grid'),
          shortcut: undefined === pinned ? '✓' : undefined,
          run: () => setWrap(null),
        },
      ],
    });

    for (const extra of props.headerMenuExtras?.({ columnId }) ?? []) {
      items.push(toContextMenuItem(extra));
    }

    if (undefined !== props.model) {
      if (true !== spec.required) {
        items.push({
          key: 'hide',
          label: __('Hide column'),
          run: () => model.setVisibility((prev) => ({ ...prev, [columnId]: false })),
        });
      }
      items.push({ key: 'columns', label: __('Columns…'), run: model.openPicker });
    }
    items.push({
      key: 'display',
      label: _x('Display settings…', 'column header menu: open the table display settings'),
      run: model.openSettings,
    });

    return items;
  };
  const openHeaderMenu = (event: MouseEvent, columnId: string): void => {
    const count = headerMenuItems(columnId).length;
    if (0 === count) return;
    event.preventDefault();
    const x = Math.min(event.clientX, window.innerWidth - 204);
    const y = Math.min(event.clientY, window.innerHeight - (8 + count * 32) - 4);
    setHeaderMenu({ x: Math.max(4, x), y: Math.max(4, y), columnId });
  };

  // In the fixed layout a table wider than its columns spreads the surplus over every <col>, which
  // would stretch a column that declared an exact `size` or a `defaultSize`. So the surplus is handed
  // out here, to the columns that did not: each keeps its stored width plus its share, and the
  // others keep theirs.
  const fixedWidths = createMemo<Record<string, number>>(() => {
    const columns = table.getVisibleLeafColumns();
    // A column with an exact or a starting width keeps its own; the rest share what is spare.
    const exact = (id: string): boolean => {
      const spec = specById().get(id);

      return undefined !== spec?.size || undefined !== spec?.defaultSize;
    };
    // While a grip is held, only the columns to its right share the spare width. Spread over the
    // column being dragged as well, each pixel of pointer travel would be partly handed back and the
    // grip would trail (or outrun) the pointer; with none to its right the table simply ends sooner
    // until the grip is let go.
    const held = columns.findIndex((c) => c.id === gripColumn());
    const sizes = columns.map((c) => c.getSize());
    const shares = columns.map((c, i) => !exact(c.id) && i > held);
    const free = sizes.reduce((sum, size, i) => sum + (shares[i] ? size : 0), 0);
    const total = sizes.reduce((sum, size) => sum + size, 0);
    const surplus = 0 === free ? 0 : Math.max(0, boxWidth() - total);

    return Object.fromEntries(
      columns.map((c, i) => [c.id, shares[i] ? sizes[i] + (surplus * sizes[i]) / free : sizes[i]]),
    );
  });
  const fixedTotal = (): number =>
    Object.values(fixedWidths()).reduce((sum, width) => sum + width, 0);
  // A menu belongs to the header it was opened on: scrolling the table under it dismisses it.
  createEffect(() => {
    if (null === headerMenu() || undefined === box) return;
    const el = box;
    const close = (): void => {
      setHeaderMenu(null);
    };
    el.addEventListener('scroll', close, { passive: true });
    onCleanup(() => el.removeEventListener('scroll', close));
  });
  const height = createViewportFill(() => box);
  const hasTotal = (): boolean => shown().some((column) => undefined !== column.total);
  const labelColumnId = (): string | undefined =>
    shown().find((column) => undefined === column.total)?.id;

  return (
    <>
      <div
        ref={(el) => {
          box = el;
          const watch = new ResizeObserver(() => setBoxWidth(el.clientWidth));
          watch.observe(el);
          onCleanup(() => watch.disconnect());
        }}
        class="box-border overflow-auto rounded border border-border bg-surface"
        onMouseLeave={() => props.onRowHover?.(null)}
        style={
          undefined === props.fillGutter
            ? undefined
            : { height: `calc(${height()} - ${props.fillGutter})` }
        }
      >
        {/* `min-w-full`, not `w-full`: the latter pins the table to the box and makes the columns
            compress instead, so the scroll container it sits in would never have anything to scroll. */}
        <table
          class="text-sm"
          classList={{
            // Held back while a grip is held: the browser would spread a gap over the columns.
            'min-w-full': null === gripColumn(),
            'table-fixed': fixedLayout(),
            'border-collapse': !separated(),
            'border-separate border-spacing-y-[3px]': separated(),
          }}
          style={fixedLayout() ? { width: `${fixedTotal()}px` } : undefined}
          data-testid={props.testId}
        >
          <Show when={fixedLayout()}>
            <colgroup>
              <For each={table.getVisibleLeafColumns()}>
                {(column) => (
                  <col style={{ width: `${fixedWidths()[column.id] ?? column.getSize()}px` }} />
                )}
              </For>
            </colgroup>
          </Show>
          <thead
            ref={(el) => {
              head = el;
              if (undefined !== virtualizer) {
                const watchHead = new ResizeObserver(() => setHeadHeight(el.offsetHeight));
                watchHead.observe(el);
                onCleanup(() => watchHead.disconnect());
              }
              el.addEventListener('mousedown', seedSizing, true);
              el.addEventListener('touchstart', seedSizing, { capture: true, passive: true });
            }}
            class="sticky top-0 z-10 bg-surface-raised font-semibold text-text-muted"
            classList={{
              '[&_th:first-child]:rounded-s-md [&_th:last-child]:rounded-e-md': separated(),
            }}
          >
            <For each={table.getHeaderGroups()}>
              {(group) => (
                <tr class="border-b border-border">
                  <For each={group.headers}>
                    {(header) => (
                      <GridHeaderCell
                        header={header}
                        table={table}
                        dnd={dnd}
                        look={() => headerLookFor(model.settings())}
                        onContextMenu={openHeaderMenu}
                        label={specById().get(header.column.id)?.label?.()}
                        description={specById().get(header.column.id)?.title}
                        extraClass={specById().get(header.column.id)?.widthClass}
                        style={fixedWidthStyle(specById().get(header.column.id))}
                        reorderable={reorderable()}
                        onSort={(column, event) => sortFromHeader(table, column, event, false)}
                        onResetSize={() => model.setSizing(() => ({}))}
                      />
                    )}
                  </For>
                </tr>
              )}
            </For>
          </thead>
          <tbody>
            <Show when={spacerBefore() > 0}>
              <tr aria-hidden="true">
                <td
                  colspan={shown().length}
                  class="p-0"
                  style={{ height: `${spacerBefore()}px` }}
                />
              </tr>
            </Show>
            <For each={windowIds()}>
              {(id) => {
                // The last row seen under this id: a row that is going away is read once more on the
                // way out, after its entry has left the map.
                let last: Row;
                const row = (): Row => {
                  const current = rowById().get(id);
                  if (undefined !== current) last = current.original;

                  return last;
                };
                const extra = (): DataTableRowProps => props.rowProps?.(row()) ?? {};

                return (
                  <tr
                    {...extra().attrs}
                    ref={(el) => {
                      if (undefined === virtualizer) return;
                      rowElements.add(el);
                      onCleanup(() => {
                        rowElements.delete(el);
                        queueMicrotask(() => virtualizer.measureElement(null));
                      });
                      queueMicrotask(() => virtualizer.measureElement(el));
                    }}
                    data-index={undefined === virtualizer ? undefined : indexById().get(id)}
                    class={`${separated() ? '' : 'hover:bg-surface-hover'} ${extra().class ?? ''}`}
                    onMouseEnter={() => props.onRowHover?.(row())}
                    onClick={(event) => props.onRowClick?.(row(), event)}
                    onContextMenu={(event) => props.onRowContextMenu?.(row(), event)}
                  >
                    <For each={table.getVisibleLeafColumns()}>
                      {(column) => {
                        const spec = (): DataTableColumn<Row> | undefined =>
                          specById().get(column.id);

                        return (
                          <td
                            class={`px-2 ${cellDensityTextFor(model.settings())}${cellWrapClassFor(model.settings(), column.id)}${clipClassFor(column.id)} ${separated() ? 'bg-surface first:rounded-s-md last:rounded-e-md' : 'border-b border-border'} ${TD[spec()?.kind ?? 'text']}`}
                          >
                            {cellContent(spec(), row)}
                          </td>
                        );
                      }}
                    </For>
                  </tr>
                );
              }}
            </For>
            <Show when={spacerAfter() > 0}>
              <tr aria-hidden="true">
                <td colspan={shown().length} class="p-0" style={{ height: `${spacerAfter()}px` }} />
              </tr>
            </Show>
            <Show when={0 === props.rows.length}>
              <tr>
                <td colspan={shown().length} class="px-3 py-3 text-text-muted">
                  {props.empty}
                </td>
              </tr>
            </Show>
          </tbody>
          <Show when={hasTotal() && props.rows.length > 0}>
            <tfoot>
              <tr class="bg-surface-raised font-semibold">
                <For each={shown()}>
                  {(column) => (
                    <td
                      class={`px-2 ${cellDensityTextFor(model.settings())} ${TD[column.kind ?? 'text']}`}
                    >
                      {undefined !== column.total
                        ? column.total()
                        : column.id === labelColumnId()
                          ? props.totalLabel
                          : null}
                    </td>
                  )}
                </For>
              </tr>
            </tfoot>
          </Show>
        </table>
      </div>
      <Show when={headerMenu()}>
        {(menu) => (
          <ContextMenu
            x={menu().x}
            y={menu().y}
            items={headerMenuItems(menu().columnId)}
            onClose={() => setHeaderMenu(null)}
          />
        )}
      </Show>
      <Show when={model.settingsOpen()}>
        <GridSettingsModal
          settings={model.settings()}
          onChange={model.setSettings}
          onClose={model.closeSettings}
        />
      </Show>
      <Show when={model.pickerOpen()}>
        <ColumnPicker
          columns={pickable()}
          hidden={hiddenIds()}
          onToggle={(id) =>
            model.setVisibility((prev) => {
              const column = arranged().find((c) => c.id === id);

              return column ? { ...prev, [id]: !isColumnVisible(column, prev) } : prev;
            })
          }
          onMove={
            reorderable()
              ? (sourceId, targetId) =>
                  model.setOrder((saved) =>
                    moveInOrder(
                      saved,
                      props.columns.map((column) => column.id),
                      sourceId,
                      targetId,
                    ),
                  )
              : undefined
          }
          onReset={model.reset}
          onClose={model.closePicker}
        />
      </Show>
    </>
  );
}

import { flexRender, type Header, type Table } from '@tanstack/solid-table';
import { Show, untrack, type JSX } from 'solid-js';
import { __, sprintf } from '@invflux/i18n';
import type { HeaderDnd } from './headerDnd';

/** The header's look, decided by the grid's display settings (density, text size, header lines). */
export interface HeaderLook {
  /** How many lines a name may wrap to; 1 is the nowrap look. */
  lines: number;
  wrapClass: string;
  densityText: string;
  boundStyle: JSX.CSSProperties | undefined;
}

/**
 * One column header of a grid or table: the name, the sort affordance, the drag-to-reorder handle
 * and the resize grip, with the accessibility they owe (`aria-sort`, a keyboard-reachable sort
 * button, a separator role on the grip).
 *
 * It owns no column state. The table it sits in supplies what a click, a drop or a double-click
 * does (`onSort`, `dnd`, `onResetSize`), so the same header serves a spreadsheet grid and a
 * read-only table.
 */
export interface GridHeaderCellProps<TRow> {
  header: Header<TRow, unknown>;
  table: Table<TRow>;
  dnd: HeaderDnd;
  look: () => HeaderLook;
  /** The column's display name, for the sort button's label; defaults to a string header, then the id. */
  label?: string;
  /** Tooltip: what the column means, when its name alone could be over-read. */
  description?: string;
  /** Extra classes for the cell, e.g. a width class. */
  extraClass?: string;
  /** Whether the header can be dragged to reorder. Default true; a table with a fixed order turns it off. */
  reorderable?: boolean;
  /** A structural column (the select-all checkbox): never dragged, no context menu; a click runs `onActivate`. */
  fixed?: boolean;
  onActivate?: () => void;
  onSort: (column: Header<TRow, unknown>['column'], event: MouseEvent) => void;
  onContextMenu?: (event: MouseEvent, columnId: string) => void;
  /** Double-click on the grip: give the column back its default width. */
  onResetSize?: (columnId: string) => void;
  /** Sticky-pinned: gets an opaque ground of its own, because it slides over its neighbours. */
  pinned?: boolean;
  style?: JSX.CSSProperties;
}

export function GridHeaderCell<TRow>(props: GridHeaderCellProps<TRow>): JSX.Element {
  // A cell is built for one header of one table, so these are read once, as the grid's own loop did.
  const header = untrack(() => props.header);
  const dnd = untrack(() => props.dnd);
  const canSort = header.column.getCanSort();
  // No `isRightAlignedCol` here: that answers for the column's *data*, and
  // the header no longer follows it — names align to the reading start, and
  // the sort affordance is pinned to the logical end regardless.
  const isSelectCol = untrack(() => props.fixed === true);

  const onClick = isSelectCol
    ? () => props.onActivate?.()
    : canSort
      ? (event: MouseEvent) => {
          // The affordance is a real button now, for the keyboard.
          // Clicking it would otherwise toggle twice — once on the
          // button, once here as it bubbles — landing back where it
          // started, so the control would look broken to a mouse.
          if ((event.target as HTMLElement).closest('button, a')) return;
          props.onSort(header.column, event);
        }
      : undefined;

  return (
    <th
      data-col-id={header.column.id}
      scope="col"
      // The sort state, spoken. Without it a screen reader announces the
      // column name and nothing about which column the table is ordered by
      // — the one thing the arrows convey visually. `none` on the other
      // sortable columns is what makes them announce as sortable at all.
      aria-sort={
        !canSort
          ? undefined
          : 'asc' === header.column.getIsSorted()
            ? 'ascending'
            : 'desc' === header.column.getIsSorted()
              ? 'descending'
              : 'none'
      }
      title={props.description}
      class={[
        `relative select-none overflow-hidden ${props.look().wrapClass} ${props.look().densityText}`,
        'border-r border-border last:border-r-0',
        'px-2', // same as the data cells, so a label sits over its column's values
        // Header names align to the reading start regardless of the column's
        // own alignment: a numeric column right-aligns its *figures* so
        // digits line up, which is a property of the data, not of its label.
        // Logical (`text-start`, not `text-left`) so an RTL locale flips it.
        'text-start',
        props.extraClass ?? '',
        canSort || isSelectCol ? ' cursor-pointer hover:bg-surface-hover' : '',
        // NAMED, not a bare `group`: `group-hover:` answers to ANY ancestor
        // carrying `group`, and this component's outer wrapper is one — so
        // a plain variant on the sort arrows lights up every header's
        // arrows whenever the pointer is anywhere in the grid.
        canSort ? 'group/sort' : '',
        // A pinned header needs an opaque background of its own: it now
        // slides over other headers, and `thead`'s tint paints behind the
        // row rather than the cell.
        props.pinned === true ? 'bg-surface-raised' : '',
      ].join(' ')}
      style={props.style}
      // Not draggable while a resize is in progress — flipped off
      // synchronously on grip-press so a leftward narrowing drag can't be
      // hijacked into a native header drag before it starts.
      draggable={props.reorderable !== false && !isSelectCol && !dnd.resizing()}
      onDragStart={(event) => {
        if (dnd.resizing() || header.column.getIsResizing()) {
          event.preventDefault();
          return;
        }
        dnd.dragStart(header.column.id, event);
      }}
      onDragOver={(event) => {
        if (isSelectCol) return;
        dnd.dragOver(header.column.id, event);
      }}
      onDragLeave={() => dnd.dragLeave(header.column.id)}
      onDrop={(event) => dnd.drop(header.column.id, event)}
      onDragEnd={() => dnd.dragEnd()}
      onClick={onClick}
      onContextMenu={
        isSelectCol ? undefined : (e: MouseEvent) => props.onContextMenu?.(e, header.column.id)
      }
    >
      {/* Drop-insertion cursor: the column lands before the one under the
        pointer, or after it from its far half, and the bar sits on that edge. */}
      <Show when={dnd.dropTarget() === header.column.id}>
        <div
          data-drop-target
          data-drop-side={dnd.dropAfter() ? 'after' : 'before'}
          class="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-blue-500"
          classList={{ 'left-0': !dnd.dropAfter(), 'right-0': dnd.dropAfter() }}
        />
      </Show>
      {/* A wrapped header pins its sort affordance to the cell corner and
        reserves a strip for it; only the NAME is height-capped.
        Both alternatives are worse, and both were measured: leaving the
        arrows inline inside the capped box clips them away entirely on a name
        that overruns its budget (a sortable column with no sort indicator —
        "Disponible (ATP)" at two lines), while making them a flex sibling
        charges their width to EVERY line of the name, not just the last, which
        is enough to shred a narrow column into "DIS-/PO-". Out of flow, the
        affordance costs one fixed strip and the name keeps the rest.
        At one line none of this applies and the markup is as it always was. */}
      {/* No padding reserved for the sort affordance. Reserving a strip on
        every sortable header charges the columns that can least afford it —
        it turned "ATP (Disponible)" into "ATP (DIS" and "Réservé" into
        "Réser". The affordance overlays instead, on its own opaque ground, so
        a name that fits is untouched and only one that overruns is occluded,
        at the very edge, where it is already being clipped by the cell. */}
      <div>
        <span
          class={props.look().lines > 1 ? 'block overflow-hidden' : undefined}
          style={props.look().boundStyle}
        >
          {flexRender(header.column.columnDef.header, header.getContext())}
        </span>
        {/* Sort indicator — the WooCommerce/WP Products-table look: a stacked
        up/down triangle pair. The active direction is solid; the idle pair is
        faint and brightens on header hover (so a sortable-but-unsorted column
        still hints it's clickable). asc = up, desc = down. */}
        <Show when={canSort}>
          <button
            type="button"
            // The keyboard's way in. The `<th>` click sorts for a mouse, but
            // a table header takes no focus and fires no key event, so
            // without this the whole sort feature was pointer-only. It is
            // this element rather than a wrapper around the name because the
            // cell is `draggable` for column reorder, and the name is where
            // people grab to drag.
            aria-label={sprintf(
              /* translators: %s is a column name. */
              __('Sort by %s'),
              // Same fallback chain the column manager uses. Server meta
              // carries the merchant's own name where there is one, but it
              // does not cover every column, and dropping straight to the id
              // announces "Sort by name" for a column headed "Produit".
              props.label ??
                ('string' === typeof header.column.columnDef.header
                  ? header.column.columnDef.header
                  : header.column.id),
            )}
            onClick={(event) => props.onSort(header.column, event)}
            // Always at the cell's right edge, out of flow, at every line
            // count. Inline, it is the first thing a narrow column clips —
            // which is how a sortable column ends up showing no sort
            // indicator at all. The end padding below clears the resize grip's 6px:
            // the grip sits over the cell's last 6px, so glyphs there would take
            // a press meant for the arrows as the start of a resize.
            //
            // Anchored to the `<th>`, never to the name wrapper: the
            // wrapper's box follows the name and can run past the cap, so
            // anchoring there would drag the arrows out of the cell with it.
            // The th is the nearest positioned ancestor (it carries
            // `relative`) and the wrapper sets no `position`, so this holds
            // — but it holds *by omission*, so do not add positioning to
            // that div without moving this.
            //
            // `bottom-0` + the cell's own vertical padding rather than a
            // fixed offset: that lands the arrows on the text's last line
            // instead of the cell floor, and keeps them there when the
            // density setting changes the padding under them.
            // `bg-surface-raised` is the occlusion: the same ground the header row
            // paints, so an overrunning name reads as running underneath the
            // affordance rather than colliding with it.
            //
            // Anchored to the cell edge, NOT inset. An inset leaves a gutter
            // beyond the occluder that the clipped name shows through, so the
            // name appears to resume after the arrows ("ATP (D⇅SI"). The
            // ground has to reach the edge; `px-1` is what keeps the glyphs
            // off it and off the name. Logical `end-0`, so it stays where the
            // name runs out rather than sitting over its start under RTL.
            //
            // `inset-y-0` + `justify-center` rather than a centered glyph:
            // the occluder has to span the FULL cell height or a two- and
            // three-line name shows above and below a band-shaped ground.
            // Spanning it also centers the glyphs for free, at every
            // density, with no offset to keep in step with the padding.
            // Not <Button>/<IconButton>: this sits on the header's own ground
            // and inherits its color, where every Button variant commits to
            // one. It still owes the suite's rules, so the pointer and the
            class="absolute inset-y-0 end-0 inline-flex shrink-0 cursor-pointer flex-col items-center justify-center bg-surface-raised ps-0.5 leading-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            classList={{
              'pe-1': !header.column.getCanResize(),
              'pe-[calc(0.25rem+6px)]': header.column.getCanResize(),
            }}
          >
            <svg
              viewBox="0 0 8 5"
              class="h-1 w-2 fill-current transition-opacity"
              classList={{
                'opacity-90': header.column.getIsSorted() === 'asc',
                'opacity-20 group-hover/sort:opacity-60': header.column.getIsSorted() !== 'asc',
              }}
            >
              <path d="M4 0 8 5 0 5Z" />
            </svg>
            <svg
              viewBox="0 0 8 5"
              class="mt-[2px] h-1 w-2 fill-current transition-opacity"
              classList={{
                'opacity-90': header.column.getIsSorted() === 'desc',
                'opacity-20 group-hover/sort:opacity-60': header.column.getIsSorted() !== 'desc',
              }}
            >
              <path d="M0 0 8 0 4 5Z" />
            </svg>
            {/* The level number, once there is more than one level: which
                  sort decides first is the one thing the arrows cannot say. */}
            <Show
              when={props.table.getState().sorting.length > 1 && header.column.getSortIndex() >= 0}
            >
              <span
                class="mt-[2px] text-[9px] font-semibold leading-none tabular-nums"
                data-testid={`sort-level-${header.column.id}`}
              >
                {header.column.getSortIndex() + 1}
              </span>
            </Show>
          </button>
        </Show>
      </div>
      {/* Resize grip: drag to size; double-click to reset to the default. */}
      <Show when={header.column.getCanResize()}>
        <div
          role="separator"
          aria-orientation="vertical"
          class={`absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-blue-400/60${
            header.column.getIsResizing() ? ' bg-blue-500' : ''
          }`}
          onMouseDown={(event) => {
            event.stopPropagation();
            // Block header drag for this whole gesture (any direction), reset on release.
            dnd.setResizing(true);
            window.addEventListener('mouseup', () => dnd.setResizing(false), { once: true });
            header.getResizeHandler()(event);
          }}
          onTouchStart={(event) => {
            event.stopPropagation();
            dnd.setResizing(true);
            window.addEventListener('touchend', () => dnd.setResizing(false), { once: true });
            header.getResizeHandler()(event);
          }}
          onClick={(event) => event.stopPropagation()}
          onDblClick={(event) => {
            event.stopPropagation();
            props.onResetSize?.(header.column.id);
          }}
        />
      </Show>
    </th>
  );
}

import { __ } from '@invflux/i18n';
import { For, type JSX, Show } from 'solid-js';
import { Button } from './Button';
import { createDragReorder } from './dragReorder';
import { Modal, ModalFooter, ModalHeader, ModalPanel } from './Modal';

/** One entry in a {@link ColumnPicker}: what to call it, and whether it may be turned off. */
export interface PickableColumn<Id extends string = string> {
  id: Id;
  /** A getter, not a string — a picker's module is imported at chunk load, before the locale is. */
  label: () => string;
  /** Cannot be hidden. Rendered checked-and-disabled rather than omitted. */
  required?: boolean;
}

/**
 * Which columns a table shows, and — when the host asks for it — in what order.
 *
 * **For the flat case.** One list of columns, each on or off. The Workbench's manager separates
 * selection from reordering because it also folds columns into named sections, renames them and
 * drives a TanStack `Table`; a table with a dozen columns and no sections has none of that, and
 * splitting a dozen rows across two tabs costs a click to answer "where is GTIN" without buying
 * anything back. Reach for this one until a table grows those needs.
 *
 * **A required column is shown, not omitted** — checked and disabled. The set on screen then matches
 * the table's headers, so nobody hunts for a column that was never offered. It still reorders: being
 * unhideable says nothing about where it belongs.
 *
 * **Reordering is opt-in, and it is the presence of `onMove` that turns it on.** A table whose
 * columns render from a hard-coded template cannot honour an order, so offering drag handles there
 * would be a control that silently does nothing. Omit the callback and the handles, the hint and the
 * drag wiring all go with it.
 *
 * Where reordering is on it is drag-and-drop, with **Alt+↑/↓ on a row's checkbox** as the keyboard
 * equivalent — the checkbox is already the row's focus stop, so the alternative costs no extra tab
 * stops. A drag-only control would put column order out of reach of a keyboard entirely.
 */
export function ColumnPicker<Id extends string = string>(props: {
  /** Every column, in the operator's current order — the list this modal both renders and edits. */
  columns: PickableColumn<Id>[];
  hidden: Id[];
  onToggle: (id: Id) => void;
  /** Move `sourceId` into `targetId`'s slot. **Omit to disable reordering entirely.** */
  onMove?: (sourceId: Id, targetId: Id) => void;
  /** Omit to leave out the reset affordance — a table with no stored default has nothing to reset to. */
  onReset?: () => void;
  onClose: () => void;
  /** Heading and accessible name. Defaults to "Columns". */
  title?: string;
  /**
   * Render-time label override for one column, where the shipped word is not the one this install
   * uses — a host status column named by the store, say. Falls back to the column's own label.
   */
  labelFor?: (column: PickableColumn<Id>) => string | undefined;
}): JSX.Element {
  const title = (): string => props.title ?? __('Columns');
  const reorderable = (): boolean => undefined !== props.onMove;
  const isHidden = (id: Id): boolean => props.hidden.includes(id);
  const labelOf = (column: PickableColumn<Id>): string =>
    props.labelFor?.(column) ?? column.label();

  const reorder = createDragReorder((sourceId, targetId) =>
    props.onMove?.(sourceId as Id, targetId as Id),
  );
  let listEl: HTMLUListElement | undefined;

  /**
   * Alt+↑/↓ — move this column past its neighbour.
   *
   * Expressed as a swap with the neighbour rather than as an index write, so it goes through the
   * same `onMove` the drag does and there is only one definition of what a move means.
   *
   * **The re-focus is not a nicety.** Reordering re-inserts the row, and re-inserting a focused
   * element blurs it — so without this the *second* Alt+arrow reaches nothing, and moving a column
   * three places costs three round trips through the Tab order. Keyed off the id rather than a
   * captured element for the same reason: the element the operator was holding may not be the one
   * standing in that slot afterwards.
   */
  const nudge = (id: Id, delta: -1 | 1): void => {
    const at = props.columns.findIndex((c) => c.id === id);
    const neighbour = props.columns[at + delta];
    if (undefined === neighbour) return;
    props.onMove?.(id, neighbour.id);
    queueMicrotask(() =>
      listEl?.querySelector<HTMLInputElement>(`input[data-column-id="${id}"]`)?.focus(),
    );
  };

  return (
    <Modal onClose={props.onClose} label={title()}>
      <ModalPanel size="xs">
        <ModalHeader
          title={title()}
          actions={
            <Button variant="quiet" size="xs" aria-label={__('Close')} onClick={props.onClose}>
              ×
            </Button>
          }
        />
        <div class="p-4">
          <Show when={reorderable()}>
            <p class="mb-3 text-2xs text-text-muted">
              {__('Drag to reorder, or hold Alt and press the arrow keys.')}
            </p>
          </Show>

          <ul class="flex flex-col gap-0.5" ref={listEl}>
            <For each={props.columns}>
              {(col) => (
                <>
                  {/* The drop marker is a list item of its own rather than a border on the row it
                    precedes: a border would shift the row it lands on by a pixel, and a list that
                    twitches under the cursor is hard to aim at. */}
                  <Show when={reorderable() && reorder.isDropTarget(col.id)}>
                    <li class="h-0.5 rounded bg-primary" aria-hidden="true" />
                  </Show>
                  <li
                    class="flex items-center gap-2 rounded px-1.5 py-1 text-sm text-text hover:bg-muted"
                    classList={{ 'opacity-50': reorderable() && reorder.isDragging(col.id) }}
                    {...(reorderable() ? reorder.itemProps(col.id) : {})}
                  >
                    <Show when={reorderable()}>
                      <span
                        class="w-3 shrink-0 cursor-move select-none text-text-muted"
                        aria-hidden="true"
                      >
                        ⋮⋮
                      </span>
                    </Show>
                    <label
                      class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 select-none"
                      classList={{ 'cursor-not-allowed opacity-60': true === col.required }}
                    >
                      <input
                        type="checkbox"
                        class="cursor-pointer"
                        data-column-id={col.id}
                        checked={!isHidden(col.id)}
                        disabled={true === col.required}
                        onChange={() => props.onToggle(col.id)}
                        onKeyDown={(e) => {
                          if (!reorderable() || !e.altKey) return;
                          if ('ArrowUp' !== e.key && 'ArrowDown' !== e.key) return;
                          // The browser would otherwise scroll the modal under the cursor.
                          e.preventDefault();
                          nudge(col.id, 'ArrowUp' === e.key ? -1 : 1);
                        }}
                      />
                      <span class="truncate">{labelOf(col)}</span>
                    </label>
                  </li>
                </>
              )}
            </For>
          </ul>
        </div>
        <Show when={props.onReset}>
          {(reset) => (
            <ModalFooter>
              <Button variant="quiet" size="xs" onClick={() => reset()()}>
                {__('Reset to default')}
              </Button>
            </ModalFooter>
          )}
        </Show>
      </ModalPanel>
    </Modal>
  );
}

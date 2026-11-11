import { createSignal, type Accessor } from 'solid-js';

/**
 * The state a column header's drag-to-reorder and resize share, so the two gestures do not fight and
 * the drop marker knows where it is.
 *
 * - **resizing** is true from a resize grip's press to its release; a header is not draggable while
 *   it is, or a leftward narrowing drag would be hijacked into a native header drag.
 * - **dragging / dropTarget / dropAfter** are the column being dragged, the one under the cursor, and
 *   whether the cursor is on that column's far half (the column then lands after it, not before).
 *
 * The owner supplies the two decisions that differ per table: which drops are refused (a pinned
 * column leaving its group) and what a drop does. {@link GridHeaderCell} draws the rest.
 */
export interface HeaderDndOptions {
  /** Whether dropping `sourceId` on `targetId` would be refused: no marker, the browser's no-drop cursor. */
  refused?: (sourceId: string, targetId: string) => boolean;
  /** Apply a drop: move `sourceId` in front of `targetId`, or after it when `after`. */
  drop: (sourceId: string, targetId: string, after: boolean) => void;
  /** A header drag started / ended (any outcome). For effects that follow the pointer, such as edge scroll. */
  onDragStart?: () => void;
  onDragStop?: () => void;
}

export interface HeaderDnd {
  resizing: Accessor<boolean>;
  setResizing: (active: boolean) => void;
  dragging: Accessor<string | null>;
  setDragging: (id: string | null) => void;
  dropTarget: Accessor<string | null>;
  setDropTarget: (id: string | null) => void;
  dropAfter: Accessor<boolean>;
  dragStart: (columnId: string, event: DragEvent) => void;
  dragOver: (columnId: string, event: DragEvent & { currentTarget: HTMLElement }) => void;
  dragLeave: (columnId: string) => void;
  drop: (columnId: string, event: DragEvent) => void;
  dragEnd: () => void;
}

const DRAG_MIME = 'text/x-invflux-col';

export function createHeaderDnd(options: HeaderDndOptions): HeaderDnd {
  const [resizing, setResizing] = createSignal(false);
  const [dragging, setDragging] = createSignal<string | null>(null);
  const [dropTarget, setDropTarget] = createSignal<string | null>(null);
  const [dropAfter, setDropAfter] = createSignal(false);

  const clear = (): void => {
    options.onDragStop?.();
    setDragging(null);
    setDropTarget(null);
  };

  return {
    resizing,
    setResizing,
    dragging,
    setDragging,
    dropTarget,
    setDropTarget,
    dropAfter,
    dragStart(columnId, event) {
      setDragging(columnId);
      event.dataTransfer?.setData(DRAG_MIME, columnId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      options.onDragStart?.();
    },
    dragOver(columnId, event) {
      const source = dragging();
      if (source === null || source === columnId) return;
      // A refused drop (past the pin budget, a locked pin leaving the group) keeps the no-drop
      // cursor and draws no marker.
      if (options.refused?.(source, columnId)) {
        if (dropTarget() === columnId) setDropTarget(null);
        return;
      }
      event.preventDefault(); // allow drop
      const box = event.currentTarget.getBoundingClientRect();
      setDropAfter(event.clientX > box.left + box.width / 2);
      setDropTarget(columnId);
    },
    dragLeave(columnId) {
      if (dropTarget() === columnId) setDropTarget(null);
    },
    drop(columnId, event) {
      event.preventDefault();
      const source = dragging() ?? event.dataTransfer?.getData(DRAG_MIME) ?? '';
      if (source && source !== columnId) options.drop(source, columnId, dropAfter());
      clear();
    },
    dragEnd: clear,
  };
}

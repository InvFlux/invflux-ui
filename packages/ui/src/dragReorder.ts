import { createSignal, type JSX } from 'solid-js';

/**
 * Handlers to spread onto one draggable item element, plus the reactive drag state a caller needs to
 * style it (dim the dragged item, draw an insertion marker at the drop target).
 */
export interface DragReorder {
  /** Spread onto each draggable item element (which must carry the same `id` you pass here). */
  itemProps: (
    id: string,
  ) => Pick<
    JSX.HTMLAttributes<HTMLElement>,
    'draggable' | 'onDragStart' | 'onDragOver' | 'onDrop' | 'onDragEnd'
  >;
  /** The item currently being dragged from THIS list (for e.g. `opacity-50`). */
  isDragging: (id: string) => boolean;
  /** `id` is the live drop target and not the dragged item (for the insertion marker before it). */
  isDropTarget: (id: string) => boolean;
  /** The dragged item id while a drag from this list is in progress, else null. */
  dragging: () => string | null;
}

/**
 * Native-HTML5 drag-to-reorder for a **single** list of identified items — the shared primitive behind
 * the DataGrid column reorder and the unified-app tab strips.
 *
 * One instance per independent list. A drag started in one instance is **undroppable** in another: the
 * over/drop handlers no-op unless *this* instance's own drag is active, so sibling lists never
 * cross-contaminate (e.g. the permanent vs closeable tab groups, or two grids on one page). The caller
 * owns the markup and the ordering; it just supplies `onReorder(fromId, toId)`, which should move
 * `fromId` to `toId`'s slot.
 */
export function createDragReorder(onReorder: (fromId: string, toId: string) => void): DragReorder {
  const [dragging, setDragging] = createSignal<string | null>(null);
  const [dropTarget, setDropTarget] = createSignal<string | null>(null);
  const clear = (): void => {
    setDragging(null);
    setDropTarget(null);
  };

  const itemProps = (id: string): ReturnType<DragReorder['itemProps']> => ({
    draggable: true,
    onDragStart: (event) => {
      setDragging(id);
      event.dataTransfer?.setData('text/plain', id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    },
    onDragOver: (event) => {
      // A drag from another list (this instance never started one) is not droppable here: skip the
      // preventDefault so the browser shows "no drop" and no marker appears.
      if (null === dragging()) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      setDropTarget(id);
    },
    onDrop: (event) => {
      if (null === dragging()) return;
      event.preventDefault();
      const source = dragging() ?? event.dataTransfer?.getData('text/plain') ?? '';
      if ('' !== source && source !== id) onReorder(source, id);
      clear();
    },
    onDragEnd: clear,
  });

  return {
    itemProps,
    isDragging: (id) => dragging() === id,
    isDropTarget: (id) => dropTarget() === id && dragging() !== id,
    dragging,
  };
}

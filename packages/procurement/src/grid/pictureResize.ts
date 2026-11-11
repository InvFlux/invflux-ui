/**
 * The geometry of a picture that hangs from its top-center and is resized by its edges.
 *
 * It keeps its proportions, so its whole size is one number, its width. Its top-center never moves,
 * which is what makes a side handle move both sides at once: dragging the right edge out by 10 px
 * widens the picture by 20.
 */

/** An edge or corner the picture is dragged by. The top is its anchor and is never dragged. */
export type PictureHandle = 'left' | 'right' | 'bottom' | 'bottom-left' | 'bottom-right';

/** Narrower than this and the picture stops being worth showing. */
export const MIN_PICTURE_WIDTH = 120;

/**
 * The width a drag asks for, from the size at the start of the drag and how far the pointer moved.
 *
 * A side handle sets the width (twice the pointer's horizontal travel, since both sides move), the
 * bottom handle sets the height, and a corner follows whichever of the two the pointer moved further,
 * so a mostly-horizontal drag on a corner resizes like a side and a mostly-vertical one like the
 * bottom.
 */
export function draggedWidth(
  handle: PictureHandle,
  start: { width: number; height: number },
  dx: number,
  dy: number,
): number {
  const aspect = start.width / start.height;
  const bySide = handle.endsWith('left')
    ? start.width - 2 * dx
    : handle.endsWith('right')
      ? start.width + 2 * dx
      : start.width;
  const byBottom = handle.startsWith('bottom') ? (start.height + dy) * aspect : start.width;

  return Math.abs(bySide - start.width) >= Math.abs(byBottom - start.width) ? bySide : byBottom;
}

/**
 * The width actually drawn: the one asked for, within what fits. Never below
 * {@link MIN_PICTURE_WIDTH}, even where less would fit, since a picture too small to read is no
 * picture at all.
 */
export function fittedWidth(wanted: number, maxWidth: number): number {
  return Math.round(Math.max(MIN_PICTURE_WIDTH, Math.min(wanted, maxWidth)));
}

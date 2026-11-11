import { CloseIcon } from '@invflux/ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { draggedWidth, fittedWidth, type PictureHandle } from './pictureResize';

export interface PicturePopoverProps {
  src: string;
  /** Every size of the same picture (an HTML `srcset`), so a larger one loads as it is enlarged. */
  srcset?: string | null;
  alt?: string;
  /** The width the operator last left it at, in CSS px. */
  width: number;
  /** The widest it may be drawn here: the space it hangs in. */
  maxWidth: number;
  /** A drag ended at this width. */
  onResize: (width: number) => void;
  onClose: () => void;
  /** Accessible name of the close button. */
  closeLabel: string;
  testId?: string;
}

/** Where each handle sits on the frame, and the cursor it shows. */
const HANDLES: { handle: PictureHandle; class: string }[] = [
  { handle: 'left', class: 'left-0 top-6 bottom-3 w-2 -translate-x-1/2 cursor-ew-resize' },
  { handle: 'right', class: 'right-0 top-6 bottom-3 w-2 translate-x-1/2 cursor-ew-resize' },
  { handle: 'bottom', class: 'bottom-0 left-3 right-3 h-2 translate-y-1/2 cursor-ns-resize' },
  {
    handle: 'bottom-left',
    class: 'bottom-0 left-0 h-3 w-3 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize',
  },
  {
    handle: 'bottom-right',
    class: 'bottom-0 right-0 h-3 w-3 translate-x-1/2 translate-y-1/2 cursor-nwse-resize',
  },
];

/**
 * A product's picture, hanging from the top-center of the element it is placed in (which must be
 * positioned), resized by dragging its sides, bottom or bottom corners, and closed by its ×.
 *
 * It does not move: its anchor is the point under the thing it illustrates. It keeps its proportions,
 * so a side handle moves both sides together ({@link draggedWidth}). It is drawn in the page rather
 * than portalled above it, so a dialog opened over the page still covers it, and it scrolls with what
 * it hangs from.
 *
 * With a `srcset`, the browser loads the size it is drawn at, and a larger one as it is enlarged; it
 * never loads one larger than drawn. Without one, the single picture is scaled.
 */
export function PicturePopover(props: PicturePopoverProps): JSX.Element {
  const [aspect, setAspect] = createSignal(1);
  // While a drag is under way the width follows the pointer here, and is handed back once, at the end.
  const [dragging, setDragging] = createSignal<number | null>(null);
  // No taller than most of the window: a picture whose bottom is out of reach cannot be resized back.
  const maxWidth = (): number => Math.min(props.maxWidth, window.innerHeight * 0.85 * aspect());
  const width = (): number => fittedWidth(dragging() ?? props.width, maxWidth());
  const height = (): number => Math.round(width() / aspect());

  const startDrag = (handle: PictureHandle, e: PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const grip = e.currentTarget as HTMLElement;
    // Pointer capture on the grip: every move reaches it wherever the pointer goes, which document
    // listeners do not reliably do across the app's shadow root.
    grip.setPointerCapture(e.pointerId);
    const start = { width: width(), height: height() };
    const x0 = e.clientX;
    const y0 = e.clientY;
    const move = (m: PointerEvent): void => {
      setDragging(
        fittedWidth(draggedWidth(handle, start, m.clientX - x0, m.clientY - y0), maxWidth()),
      );
    };
    const end = (): void => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
      const final = dragging();
      setDragging(null);
      if (null !== final) props.onResize(final);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  };

  return (
    <div class="absolute left-1/2 top-full z-40 -translate-x-1/2 pt-1" data-testid={props.testId}>
      <div class="relative rounded-lg border border-border bg-surface p-1 shadow-2xl">
        <img
          src={props.src}
          srcset={props.srcset ?? undefined}
          sizes={props.srcset ? `${width()}px` : undefined}
          alt={props.alt ?? ''}
          draggable={false}
          class="block rounded select-none"
          style={{ width: `${width()}px`, height: `${height()}px`, 'object-fit': 'contain' }}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              setAspect(img.naturalWidth / img.naturalHeight);
            }
          }}
        />
        <button
          type="button"
          class="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-surface/90 text-slate-600 shadow ring-1 ring-black/10 hover:bg-surface hover:text-slate-900"
          aria-label={props.closeLabel}
          title={props.closeLabel}
          data-testid={props.testId ? `${props.testId}-close` : undefined}
          onClick={() => props.onClose()}
        >
          <CloseIcon class="h-4 w-4" />
        </button>
        <For each={HANDLES}>
          {(h) => (
            <div
              class={`absolute touch-none ${h.class}`}
              data-handle={h.handle}
              onPointerDown={(e) => startDrag(h.handle, e)}
            />
          )}
        </For>
        <Show when={null !== dragging()}>
          <div class="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white tabular-nums">
            {width()} × {height()}
          </div>
        </Show>
      </div>
    </div>
  );
}

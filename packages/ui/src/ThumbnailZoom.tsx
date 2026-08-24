import { Show, createSignal, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { usePortalRootOptional } from './portal';

export interface ThumbnailZoomProps {
  /** Image URL; when null, a neutral placeholder box of the same size renders. */
  src: string | null;
  alt?: string;
  /** Thumbnail edge in px (square). Default 36. */
  size?: number;
  /** Zoom-preview max edge in px. Default 240. */
  zoom?: number;
}

/**
 * A small square thumbnail that, on hover, shows a portalled zoom preview
 * anchored beside it. Platform-agnostic — just takes an image URL. The preview
 * is portalled to the SPA's portal root (so it escapes any `overflow` clipping
 * of a table/scroll container while staying inside the shadow-DOM style scope)
 * and positioned with `fixed` from the thumbnail's viewport rect.
 */
export function ThumbnailZoom(props: ThumbnailZoomProps): JSX.Element {
  const [rect, setRect] = createSignal<DOMRect | null>(null);
  const mount = usePortalRootOptional();
  const size = (): number => props.size ?? 36;
  const zoom = (): number => props.zoom ?? 240;

  return (
    <Show
      when={props.src}
      fallback={
        <div
          class="rounded bg-gray-100 shrink-0"
          style={{ width: `${size()}px`, height: `${size()}px` }}
          aria-hidden="true"
        />
      }
    >
      <img
        src={props.src!}
        alt={props.alt ?? ''}
        class="rounded object-cover bg-gray-100 shrink-0 cursor-zoom-in ring-1 ring-black/5"
        style={{ width: `${size()}px`, height: `${size()}px` }}
        onMouseEnter={(e) => setRect(e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => setRect(null)}
      />
      <Show when={rect()}>
        {(r) => (
          <Portal mount={mount}>
            <div
              class="pointer-events-none fixed z-preview rounded-lg border border-border bg-surface p-1 shadow-2xl"
              style={{
                // Anchored below the thumbnail (left-aligned to it), so the zoom
                // never covers the product name to its right. Clamped to the
                // viewport on both axes.
                left: `${Math.max(8, Math.min(r().right + 8, window.innerWidth - zoom() - 16))}px`,
                top: `${Math.max(8, Math.min(r().bottom - 8, window.innerHeight - zoom() - 16))}px`,
              }}
            >
              <img
                src={props.src!}
                alt=""
                class="rounded"
                style={{ width: `${zoom()}px`, height: `${zoom()}px`, 'object-fit': 'contain' }}
              />
            </div>
          </Portal>
        )}
      </Show>
    </Show>
  );
}

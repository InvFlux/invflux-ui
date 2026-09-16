import { createEffect, createSignal, on, onCleanup, onMount, type Accessor } from 'solid-js';
import { usePaneActive } from './paneActive';

/**
 * A height that fills from wherever an element starts down to the viewport bottom, as a CSS length.
 *
 * For a surface that has to fit the screen rather than the page — a grid whose own bottom edge and
 * horizontal scrollbar must stay visible. `100vh` is wrong for anything below chrome: it is measured
 * from the top of the page, so a surface that starts under the admin bar, the shell's tab strip or
 * an admin notice overhangs the viewport by exactly that much, and the page scrolls. The offset is
 * whatever `top` the element lands at, so it is measured rather than guessed.
 *
 * Taken in document coordinates (`top + scrollY`), so a page that happens to be scrolled when a
 * measurement runs does not stretch the surface by the scroll distance. Re-measured on window resize
 * and whenever the light-DOM body resizes: chrome above (an admin notice, a wrapped admin bar or tab
 * strip) moves the top without a window resize, and it always changes the body's box.
 *
 * Re-measured, too, whenever the element comes back into view — its pane becoming the active one in
 * the app shell ({@link usePaneActive}), or the browser tab becoming visible — and never measured
 * while it is out of it. The shell keeps inactive panes mounted under `display: none`, where a box
 * reads as sitting at the very top of the page, so a window resized while the pane is away would
 * otherwise leave it a height too tall by everything above it, and nothing would correct it on its
 * return. Skipping the hidden measurement keeps the last good height; the return brings it up to
 * date in the same update that shows the pane, before it is painted.
 *
 * A bottom gutter belongs in the element's own padding — border-box puts it inside this height — so
 * the number stays the one honest answer to "how far to the viewport bottom".
 *
 * @param minPx floor, so a very short window leaves the surface usable instead of collapsing it
 */
export function createViewportFill(
  el: () => HTMLElement | undefined,
  minPx = 200,
): Accessor<string> {
  // The first paint, before the element exists: close, since it subtracts WordPress's own bar.
  const [height, setHeight] = createSignal('calc(100vh - var(--wp-admin--admin-bar--height, 0px))');

  const measure = (): void => {
    const node = el();
    // Not rendered (inside a hidden pane): its box would read as the page's top. Keep the last value.
    if (node === undefined || node.getClientRects().length === 0) return;
    const top = node.getBoundingClientRect().top + window.scrollY;
    setHeight(`${Math.max(minPx, Math.round(window.innerHeight - top))}px`);
  };

  // Outside the app shell this is always true and never changes, so the effect never runs.
  const paneActive = usePaneActive();
  createEffect(on(paneActive, (active) => active && measure(), { defer: true }));
  const onVisibility = (): void => {
    if ('visible' === document.visibilityState) measure();
  };

  onMount(() => {
    measure();
    // After layout settles: fonts and the shell's tab strip can move the top after mount.
    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    document.addEventListener('visibilitychange', onVisibility);
    onCleanup(() => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    });
  });

  return height;
}

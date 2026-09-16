import { createContext, useContext } from 'solid-js';

/**
 * Shared portal root for overlays that must escape the SPA's own shadow boundary — modals and the
 * Kobalte-backed combobox listboxes. It is a **second shadow root**, not a light-DOM node: it adopts
 * the same stylesheet, so a portalled overlay is styled by exactly what its in-tree twin is, and
 * wp-admin's stylesheets reach neither tree (arch-ui-principles §4.7). Each SPA creates it in
 * `main.tsx` — whitelisted by the click-interceptor, which sees the host in `composedPath()` — and
 * provides the mount element via `PortalCtx.Provider`.
 *
 * The escape is still needed: a `position: fixed` backdrop must be viewport-relative, and the
 * surfaces embedding us put transforms and containment on ancestors.
 *
 * Single context object lives here so `@invflux/ui` components (SearchSelect / SearchMultiSelect /
 * the Combobox shim) can default their portal `mount` to it — each SPA re-exports this from
 * its local `./portal` so existing `usePortalRoot()` call sites keep working unchanged.
 */
export const PortalCtx = createContext<HTMLElement | undefined>(undefined);

/** The provided portal root. Throws when no `PortalCtx.Provider` is in scope (an SPA wiring bug). */
export function usePortalRoot(): HTMLElement {
  const root = useContext(PortalCtx);
  if (!root) throw new Error('PortalCtx not provided');
  return root;
}

/** The provided portal root, or undefined when none is in scope. For library defaults that must not
 *  throw (e.g. a Kobalte wrap falling back to Kobalte's own default mount). */
export function usePortalRootOptional(): HTMLElement | undefined {
  return useContext(PortalCtx);
}

/**
 * Keep an element visible to assistive technology while a modal Kobalte layer (a menu, a dialog) is
 * open.
 *
 * An open modal layer hides the rest of the page from screen readers by walking `document.body` and
 * asking each element whether it `contains()` the layer. `contains()` cannot see into shadow roots,
 * and our overlays live in one, so `<body>` itself answered "no" and was hidden, open menu included.
 * Kobalte always leaves elements marked `data-live-announcer="true"` visible, so marking the portal
 * host makes the walk step over `<body>` and hide the page behind the overlay instead, which is the
 * intended behaviour. The value must be exactly `"true"`.
 *
 * This works around a gap in `@kobalte/core` 0.13.14 (`ariaHideOutside` does not look through shadow
 * boundaries). Remove it, and {@link keepWordPressAnnouncementsAudible}, once a `@kobalte/core`
 * release fixes that; the Dispatch partial-ship E2E specs fail again if the gap returns.
 */
export function keepVisibleDuringModals(el: HTMLElement): void {
  el.dataset.liveAnnouncer = 'true';
}

/**
 * Keep WordPress's own screen-reader announcements (`wp.a11y.speak`) audible while a modal layer is
 * open: its two live regions are children of `<body>`, so the same walk would hide them.
 *
 * WordPress creates them on DOM ready, which an app's module script can run before, so they are
 * marked now if they exist and otherwise as they appear. The watch ends once both are marked, or at
 * `load` on a page that never creates them.
 */
export function keepWordPressAnnouncementsAudible(): void {
  const ids = ['a11y-speak-polite', 'a11y-speak-assertive'];
  const markAll = (): boolean => {
    let all = true;
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) keepVisibleDuringModals(el);
      else all = false;
    }
    return all;
  };
  if (markAll()) return;

  const observer = new MutationObserver(() => {
    if (markAll()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true });
  window.addEventListener('load', () => observer.disconnect(), { once: true });
}

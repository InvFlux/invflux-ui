/**
 * Focus helpers that survive the Shadow DOM — the two operations every dialog and overlay in the
 * SPA needs, in one place because both have a wrong-looking-but-plausible version.
 *
 * The SPAs mount inside a shadow root, which is what makes these non-obvious: `document.
 * activeElement` reports the shadow *host*, not the focused control, so the naive read tells you
 * "the app" is focused no matter where the caret is.
 */

/**
 * The element that actually holds focus, descending through nested shadow roots.
 *
 * `document.activeElement` retargets to the host of the outermost shadow root, so it is never the
 * control the user is in. Each root reports its own `activeElement`, so the answer is reached by
 * walking down while a shadow root claims one.
 */
export function deepActiveElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  let el = document.activeElement as HTMLElement | null;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement as HTMLElement;

  return el;
}

/** Whether `node` is inside `container`, crossing shadow boundaries on the way up. */
export function containsAcrossShadow(container: Node, node: Node | null): boolean {
  let current: Node | null = node;
  while (current) {
    if (current === container) return true;
    const parent: Node | null = current.parentNode;
    // A shadow root's parentNode is null; step to its host to keep climbing.
    current = parent ?? (current as ShadowRoot).host ?? null;
  }

  return false;
}

export const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Whether a focusable is actually reachable — rendered, and not hidden by CSS.
 *
 * `offsetParent !== null` is the familiar test and is **wrong here**: per spec `offsetParent` is
 * null for any `position: fixed` element, so that test drops exactly the controls a dialog is most
 * likely to position that way. `checkVisibility` answers the real question where it exists;
 * `getClientRects()` is the fallback that, unlike `offsetParent`, does not single out fixed
 * positioning.
 */
export function isVisibleFocusable(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility({
      checkVisibilityCSS: true,
      contentVisibilityAuto: true,
      opacityProperty: false,
    });
  }

  return el.getClientRects().length > 0;
}

/** The reachable focusables inside `container`, in DOM order. */
export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    isVisibleFocusable,
  );
}

/**
 * Return focus to `target` once the DOM has settled.
 *
 * Deferred deliberately. Closing an overlay removes the node that held focus, and that removal
 * blurs to `<body>` *after* a synchronous restore would have run — so restoring immediately looks
 * right, then loses the focus a frame later. The symptom is a grid that stops answering arrow keys
 * for no visible reason.
 */
export function restoreFocusTo(target: HTMLElement | null | undefined): void {
  if (!target) return;
  queueMicrotask(() => {
    if (target.isConnected) target.focus({ preventScroll: true });
  });
}

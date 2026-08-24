import { onCleanup, onMount, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';

export interface ModalProps {
  /** Called on backdrop click (when enabled) and on Escape (when enabled). */
  onClose: () => void;
  /** Close when the backdrop (area outside the panel) is clicked. Default true. */
  closeOnBackdrop?: boolean;
  /**
   * Close on the Escape key. Default true.
   *
   * A nested affordance can claim Escape for itself — an inline edit that should cancel rather than
   * discard the whole dialog — by putting {@link ESC_LOCAL_ATTR} on its element. See the constant.
   */
  closeOnEsc?: boolean;
  /** Extra classes on the full-screen backdrop (e.g. "bg-black/30 flex items-center justify-center p-6"). */
  backdropClass?: string;
  /** Accessible label for the dialog. */
  label?: string;
  /**
   * Portal the modal to this light-DOM root so its `position: fixed` backdrop is viewport-relative.
   * Needed when the SPA mounts in a shadow root under WC's transformed ancestors (the product
   * inventory tab), where `fixed` would otherwise resolve against a transformed ancestor and the
   * modal would render inline. Omit to render in place (default) — unchanged for full-page SPAs.
   */
  mount?: HTMLElement;
  /** The panel(s). Panels should `stopPropagation` on click if closeOnBackdrop is enabled. */
  children: JSX.Element;
}

/**
 * Marks an element that handles Escape itself, so the enclosing modal leaves the key alone.
 *
 * Needed because this modal listens on `document` in the **capture** phase: its handler runs before
 * anything inside the panel, so a nested `onKeyDown` calling `stopPropagation()` is already too
 * late — the dialog has closed. Rather than reverse the phase (which would cost Escape-from-
 * anywhere, including the backdrop), an inner affordance declares ownership and this listener
 * stands aside.
 *
 * The reported case: cancelling a tag rename with Escape closed the whole tag manager, losing the
 * list, the filter and the half-typed name along with the edit the user meant to abandon.
 */
export const ESC_LOCAL_ATTR = 'data-esc-local';

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === container,
  );
}

/**
 * Lightweight modal shell: a full-screen backdrop that renders its children (the panel)
 * and adds the behaviours the inline workbench modals lacked — Escape to close, click
 * outside to close, and a Tab focus-trap. It renders in place (inside the current root,
 * shadow DOM included) rather than portaling, so existing styling and selectors are
 * unchanged; a portal `mount` can be layered on later for drill-down modals.
 *
 * The panel positions itself (centered, popover, …) via its own classes and should call
 * `stopPropagation` on click when `closeOnBackdrop` is enabled.
 */
export function Modal(props: ModalProps): JSX.Element {
  let containerRef: HTMLDivElement | undefined;

  const handleKeyDown = (event: KeyboardEvent): void => {
    if ((props.closeOnEsc ?? true) && event.key === 'Escape') {
      // Walk the composed path, not `event.target`: the SPAs mount in a shadow root, which
      // retargets `target` to the host before a document-level listener sees it.
      for (const node of event.composedPath()) {
        if (node instanceof HTMLElement && node.hasAttribute(ESC_LOCAL_ATTR)) return;
      }
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
      return;
    }

    if (event.key === 'Tab' && containerRef) {
      const items = focusableWithin(containerRef);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const root = containerRef.getRootNode() as Document | ShadowRoot;
      const active = root.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown, true);
  });
  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown, true);
  });

  const backdrop = (
    <div
      ref={containerRef}
      class={`fixed inset-0 z-modal ${props.backdropClass ?? ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={props.label}
      onClick={(event) => {
        // Only a direct click on the backdrop itself closes — NOT a click that merely bubbled up
        // from a descendant or, crucially, from a Kobalte listbox portaled OUT of the panel (its
        // option clicks would otherwise dismiss the modal instead of selecting). The panel still
        // stopPropagation()s as a second guard.
        if ((props.closeOnBackdrop ?? true) && event.target === event.currentTarget) props.onClose();
      }}
    >
      {props.children}
    </div>
  );

  return <>{props.mount ? <Portal mount={props.mount}>{backdrop}</Portal> : backdrop}</>;
}

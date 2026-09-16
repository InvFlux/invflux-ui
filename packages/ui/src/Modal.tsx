import {
  createContext,
  onCleanup,
  onMount,
  Show,
  splitProps,
  useContext,
  type JSX,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  containsAcrossShadow,
  deepActiveElement,
  focusableWithin,
  restoreFocusTo,
} from './focusUtils';
import { usePortalRootOptional } from './portal';

/** Where a modal's panel sits in the viewport. */
export type ModalAlign = 'center' | 'top';

/** The scrim and gutter every dialog shares; only the cross-axis alignment differs. */
const BACKDROP_BASE = 'flex justify-center bg-black/30 p-6';
const BACKDROP_ALIGN: Record<ModalAlign, string> = {
  center: 'items-center',
  top: 'items-start',
};

/**
 * How long a dialog's fades take, and their curve: the fade-in on open, and the fade while its
 * panel is dragged. The drag fade runs alongside the panel's `transition-colors duration-200`
 * (Tailwind's default easing), so these must match it for background and content to move as one.
 */
const FADE_MS = 200;
const FADE_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

/** Timing for a dialog fade; instant for a user who asks for reduced motion. */
function fadeTiming(): KeyframeAnimationOptions {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return { duration: reduce ? 0 : FADE_MS, easing: FADE_EASING };
}

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
  /**
   * Where the panel sits. Drives the backdrop's own classes, so a caller passing this does not
   * repeat the scrim/padding string. `top` suits a panel whose height grows as the user works
   * (a wizard, a picker) — centering re-centres on every step, so the panel appears to jump.
   */
  align?: ModalAlign;
  /**
   * Extra classes on the full-screen backdrop.
   *
   * The escape hatch, and it wins over {@link align}: a handful of dialogs want an offset the
   * two alignments do not express (`pt-16` under a toolbar). Prefer `align` — it is the same
   * string every other dialog would otherwise spell out by hand.
   */
  backdropClass?: string;
  /** Accessible label for the dialog. */
  label?: string;
  /**
   * Move focus into the dialog on open. Default true.
   *
   * A floor, not an override: it only acts when nothing inside has already taken focus, so a panel
   * that focuses its own first field keeps doing so. Set false for a dialog that must not steal
   * focus at all — one that opens beside an input the user is still typing in.
   */
  autoFocus?: boolean;
  /**
   * Return focus to whatever was focused when the dialog opened. Default true.
   *
   * Set false when the host re-engages something more specific than the opener — the workbench
   * grid restores *cell navigation*, not the button that opened the dialog, and two restores
   * racing leaves focus wherever the later microtask happened to land.
   */
  restoreFocus?: boolean;
  /**
   * Portal the modal to this root so its `position: fixed` backdrop is viewport-relative.
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

/**
 * Take the page behind an open dialog out of the tab order and out of the accessibility tree, and
 * return a function that puts it back exactly as it was.
 *
 * Walks from the dialog to the document root marking each level's *siblings* `inert`, which is the
 * whole background and nothing on the path to the dialog itself.
 *
 * **The portal root is skipped, and that exclusion is load-bearing.** Modals and Kobalte's
 * listboxes/menus mount into the *same* shared portal root, so a portaled `<Combobox.Portal>` is
 * a sibling of this backdrop rather than a descendant of it. Inerting siblings blindly would make
 * every select, combobox and dropdown inside every dialog unclickable — a worse regression than the
 * one this fixes, and one that only shows up when someone opens a dropdown in a modal.
 *
 * `inert` alone, not `inert` + `aria-hidden`: it already removes the subtree from the accessibility
 * tree *and* from focus, so the pair would be redundant, and `aria-hidden` over focusable content is
 * itself a violation wherever `inert` is unsupported. A browser without `inert` degrades to the
 * previous behaviour, where the focus trap is still doing its job.
 */
function makeBackgroundInert(
  container: HTMLElement,
  portalRoots: (HTMLElement | undefined)[],
): () => void {
  const marked: HTMLElement[] = [];
  const isPortalRoot = (el: HTMLElement): boolean =>
    portalRoots.some((root) => root !== undefined && (el === root || el.contains(root)));

  // `parentNode` + an explicit hop from a ShadowRoot to its host, NOT `parentElement`.
  //
  // `parentElement` does not cross a shadow boundary, and every SPA surface here mounts inside one
  // (`div#invflux-app`). Walking it climbs to the top of the shadow tree and stops, so the dialog's
  // own subtree gets inerted and the entire WordPress page behind it — admin bar, sidebar, the rest
  // of the screen — stays fully reachable to a pointer and a screen reader. That is the whole
  // background this exists to remove, and the walk was terminating just short of it.
  let node: Node = container;
  for (;;) {
    const parent: ParentNode | null = node.parentNode;
    if (parent === null || parent instanceof Document) break;

    for (const sibling of Array.from(parent.children)) {
      if (sibling === node || !(sibling instanceof HTMLElement)) continue;
      if (isPortalRoot(sibling)) continue;
      // Already inert for its own reasons (an outer dialog, a host widget) — leave it, and leave it
      // alone on the way out. Recording only what we changed is what makes nesting restore right.
      if (sibling.inert) continue;
      sibling.inert = true;
      marked.push(sibling);
    }

    // A ShadowRoot's next level up is the element hosting it; everything else walks normally.
    node = parent instanceof ShadowRoot ? parent.host : parent;
  }

  return () => {
    for (const el of marked) el.inert = false;
  };
}

/**
 * Lightweight modal shell: a full-screen backdrop that renders its children (the panel)
 * and adds the behaviours the inline workbench modals lacked — Escape to close, click
 * outside to close, a Tab focus-trap, and an inert background. It renders in place (inside the
 * current root, shadow DOM included) rather than portaling, so existing styling and selectors are
 * unchanged; a portal `mount` can be layered on later for drill-down modals.
 *
 * The panel positions itself (centered, popover, …) via its own classes and should call
 * `stopPropagation` on click when `closeOnBackdrop` is enabled.
 *
 * It fades in over {@link FADE_MS}. It closes at once: the caller's `<Show>` unmounts it, and a
 * fade-out would have to outlive that.
 */
export function Modal(props: ModalProps): JSX.Element {
  let containerRef: HTMLDivElement | undefined;
  const contextPortalRoot = usePortalRootOptional();

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
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = deepActiveElement();

      // Pull focus in when it is still OUTSIDE the dialog. Without this the trap is inert: its two
      // edge cases only fire once focus is already on the first or last item, so a dialog nobody
      // has clicked into lets Tab walk the page behind it — which is where focus starts unless the
      // initial focus below ran.
      if (!containsAcrossShadow(containerRef, active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });

        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }
  };

  // Captured at render — before any child effect moves focus — so this is the control the user was
  // on when the dialog opened, and where focus belongs when it closes.
  const opener = deepActiveElement();

  let releaseBackground: (() => void) | undefined;

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown, true);

    // The focus trap already stops Tab reaching the page behind; this is the other half — a screen
    // reader's own navigation, and a pointer, both of which ignore the trap entirely.
    if (containerRef) {
      releaseBackground = makeBackgroundInert(containerRef, [props.mount, contextPortalRoot]);
    }

    // Fade in rather than appear — scrim and panel together, since both live on the backdrop.
    // `backwards` holds the transparent start until the animation begins and lets it go once done,
    // so nothing lingers on the element. Guarded for environments without Web Animations (jsdom).
    if (containerRef && typeof containerRef.animate === 'function') {
      containerRef.animate({ opacity: [0, 1] }, { ...fadeTiming(), fill: 'backwards' });
    }

    // Deferred, and conditional: several dialogs focus a specific control of their own (the bulk
    // editor's first field, the correction review's Apply). Running in a microtask lets those win
    // regardless of effect ordering, and this only steps in when nothing inside has claimed focus —
    // so it is a floor, not an override.
    if (props.autoFocus ?? true) {
      queueMicrotask(() => {
        if (!containerRef?.isConnected) return;
        if (containsAcrossShadow(containerRef, deepActiveElement())) return;
        focusableWithin(containerRef)[0]?.focus({ preventScroll: true });
      });
    }
  });
  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown, true);
    releaseBackground?.();
    // Hosts that re-engage something more specific than the opener (the grid restoring cell
    // navigation) opt out and do it themselves.
    if (props.restoreFocus ?? true) restoreFocusTo(opener);
  });

  const backdrop = (
    <div
      ref={containerRef}
      class={`fixed inset-0 z-modal ${
        props.backdropClass ?? `${BACKDROP_BASE} ${BACKDROP_ALIGN[props.align ?? 'center']}`
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={props.label}
      onClick={(event) => {
        // Only a direct click on the backdrop itself closes — NOT a click that merely bubbled up
        // from a descendant or, crucially, from a Kobalte listbox portaled OUT of the panel (its
        // option clicks would otherwise dismiss the modal instead of selecting). The panel still
        // stopPropagation()s as a second guard.
        if ((props.closeOnBackdrop ?? true) && event.target === event.currentTarget)
          props.onClose();
      }}
    >
      {props.children}
    </div>
  );

  return <>{props.mount ? <Portal mount={props.mount}>{backdrop}</Portal> : backdrop}</>;
}

/** Panel widths, named for the sizes the dialogs actually use. */
export type ModalPanelSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | 'full' | 'none';

const PANEL_MAX_WIDTH: Record<ModalPanelSize, string> = {
  xs: 'max-w-xs',
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  full: 'max-w-full',
  none: '',
};

/**
 * What a {@link ModalHeader} needs from the panel around it in order to move it: the element, and
 * where the user last left it. The offset lives with the panel, not the header, so a header that
 * re-renders (one inside a `<Show>`) does not snap the dialog back to where it opened.
 */
interface PanelDrag {
  el: () => HTMLDivElement | undefined;
  offset: { x: number; y: number };
}

const PanelDragContext = createContext<PanelDrag>();

export interface ModalPanelProps extends Omit<
  JSX.HTMLAttributes<HTMLDivElement>,
  'class' | 'onClick' | 'children'
> {
  /**
   * Panel width. Default `md`. `none` applies no cap, for a dialog whose width is data (a column's
   * own setting) and arrives as a `max-w-*` in {@link class} — two caps on one element are decided
   * by stylesheet order, not by which was written last, so the caller's cannot simply be added.
   */
  size?: ModalPanelSize;
  /** Appended to the panel's own classes, for the rare dialog that needs one more thing. */
  class?: string;
  children: JSX.Element;
}

/**
 * The box a dialog's content sits in: the chrome every panel shares, and the two behaviours a
 * panel is otherwise expected to remember.
 *
 * **It stops click propagation.** {@link Modal}'s backdrop closes on a click that lands on the
 * backdrop itself, and a click inside the panel bubbles up to exactly there. Every hand-written
 * panel therefore carries `onClick={(e) => e.stopPropagation()}`; forgetting it makes the dialog
 * close when the user clicks its own body, which reads as a random dismissal rather than a bug.
 *
 * Any other attribute — a `ref`, a Ctrl+Enter `onKeyDown`, `aria-busy` — lands on the panel
 * element. `onClick` alone is withheld, since overriding it would undo the first point.
 *
 * **It caps its height at 80vh and scrolls past it.** A `fixed` layer has no page to scroll, so a
 * taller panel would run off the bottom with its lower half — usually the buttons — unreachable.
 * A dialog with its own scrolling body (`flex-1 overflow-y-auto`) keeps scrolling there, since a
 * scroll container's minimum flex size is zero; anything else scrolls as a whole under its header.
 * It scrolls rather than clips on purpose: clipping hides the overflow and offers no way to reach
 * it. A panel shorter than the cap is unaffected either way.
 *
 * It is what a {@link ModalHeader} inside it moves when dragged, and its background fades with the
 * rest of the body while that drag is in progress.
 */
export function ModalPanel(props: ModalPanelProps): JSX.Element {
  const [local, rest] = splitProps(props, ['size', 'class', 'children', 'ref']);
  let el: HTMLDivElement | undefined;
  const drag: PanelDrag = { el: () => el, offset: { x: 0, y: 0 } };
  return (
    <PanelDragContext.Provider value={drag}>
      <div
        {...rest}
        ref={(node) => {
          el = node;
          // A caller's `ref` reaches a component as a function whether it wrote a variable or a
          // callback; Solid's compiler wraps the variable form.
          if (typeof local.ref === 'function') local.ref(node);
        }}
        class={`flex max-h-[80vh] w-full ${
          PANEL_MAX_WIDTH[local.size ?? 'md']
        } flex-col overflow-y-auto rounded border border-border bg-surface shadow-xl transition-colors duration-200 motion-reduce:transition-none data-[dragging]:bg-surface/15 ${
          local.class ?? ''
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {local.children}
      </div>
    </PanelDragContext.Provider>
  );
}

export interface ModalHeaderProps {
  /** The dialog's name. Rendered as the `h2` that {@link ModalProps.label} names for a reader. */
  title: JSX.Element;
  /**
   * Context under the title — a count, a scope, what the action will apply to. Rendered in a
   * block, not a `<p>`, so it may carry paragraphs of its own without nesting one inside another.
   */
  subtitle?: JSX.Element;
  /** Trailing controls: a close button, a step indicator. Pushed to the far end of the row. */
  actions?: JSX.Element;
  /**
   * Let the user move the dialog by dragging this bar. Default true. Controls in `actions` still
   * click as usual; a press anywhere else on the bar starts the drag. Has no effect outside a
   * {@link ModalPanel}, which is the thing that moves.
   */
  movable?: boolean;
}

/** How much of a dragged panel's width stays inside the viewport, so it can always be grabbed back. */
const DRAG_KEEP_VISIBLE_PX = 64;
/** Pointer travel before a press on the bar counts as a drag — below it, a click changes nothing. */
const DRAG_THRESHOLD_PX = 3;
/** Opacity of everything in the panel except the bar while it is dragged. */
const DRAG_DIM_OPACITY = '0.15';
/** A press on one of these inside the bar belongs to that control, not to the drag. */
const DRAG_EXEMPT = 'button, a, input, select, textarea, label, [role="button"], [contenteditable]';

/**
 * Track one drag of `panel` by `header`, from the press `down` until the pointer is released.
 *
 * The move is a CSS `translate`, not `transform`, so it composes with any transform the dialog sets
 * for its own reasons, and it is clamped so the bar never leaves the viewport vertically and at
 * least {@link DRAG_KEEP_VISIBLE_PX} of the panel — plus the width of the bar's `actions` — stays on
 * screen horizontally. A dialog dropped half off the edge must still be reachable, and the actions
 * sit at the bar's far end: a strip of them alone would leave nothing to press but buttons.
 *
 * While the drag lasts, everything in the panel except the bar fades, so the page underneath can be
 * read. The fade is applied to the bar's *siblings at each level* between the bar and the panel,
 * not to the panel's children, because opacity cannot be undone by a descendant: a dialog that
 * nests its header inside its `<form>` would otherwise fade its own title with it. The fade is a
 * Web Animation rather than an inline style, one out on the drag and one back on release: it never
 * overwrites a dialog's own opacity, and is cancelled — leaving nothing behind — once it has faded
 * back in. Both take {@link FADE_MS}, in step with the panel's background.
 *
 * Returns a function that ends the drag early (the dialog closing mid-drag).
 */
function trackDrag(
  header: HTMLElement,
  panel: HTMLDivElement,
  offset: { x: number; y: number },
  down: PointerEvent,
  onEnd: () => void,
): () => void {
  const origin = { x: down.clientX, y: down.clientY, ox: offset.x, oy: offset.y };
  const panelBox = panel.getBoundingClientRect();
  const headerBox = header.getBoundingClientRect();
  const actions = header.querySelector<HTMLElement>('[data-modal-actions]');
  const keep = Math.min(DRAG_KEEP_VISIBLE_PX + (actions?.offsetWidth ?? 0), panelBox.width);
  const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

  const faded: [HTMLElement, Animation][] = [];
  let dragging = false;
  let ended = false;

  const begin = (): void => {
    dragging = true;
    const timing: KeyframeAnimationOptions = { ...fadeTiming(), fill: 'both' };
    let node: HTMLElement = header;
    while (node !== panel && node.parentElement) {
      for (const sibling of Array.from(node.parentElement.children)) {
        if (sibling === node || !(sibling instanceof HTMLElement)) continue;
        faded.push([sibling, sibling.animate({ opacity: DRAG_DIM_OPACITY }, timing)]);
      }
      node = node.parentElement;
    }
    panel.toggleAttribute('data-dragging', true);
    header.toggleAttribute('data-dragging', true);
  };

  const move = (e: PointerEvent): void => {
    const dx = e.clientX - origin.x;
    const dy = e.clientY - origin.y;
    if (!dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      begin();
    }
    offset.x =
      origin.ox + clamp(dx, keep - panelBox.right, window.innerWidth - keep - panelBox.left);
    offset.y = origin.oy + clamp(dy, -headerBox.top, window.innerHeight - headerBox.bottom);
    panel.style.translate = `${offset.x}px ${offset.y}px`;
  };

  const end = (): void => {
    if (ended) return;
    ended = true;
    header.removeEventListener('pointermove', move);
    header.removeEventListener('pointerup', end);
    header.removeEventListener('pointercancel', end);
    header.removeEventListener('lostpointercapture', end);
    if (header.hasPointerCapture(down.pointerId)) header.releasePointerCapture(down.pointerId);
    // Back out with a fresh forward animation from wherever the fade-in had got to, not `reverse()`:
    // a reversed animation also runs its easing backwards, while the background's CSS transition
    // eases forwards again, so the two would part company on the way out.
    const timing: KeyframeAnimationOptions = { ...fadeTiming(), fill: 'both' };
    for (const [el, fadeIn] of faded) {
      const from = getComputedStyle(el).opacity;
      fadeIn.cancel();
      const fadeOut = el.animate({ opacity: [from, getComputedStyle(el).opacity] }, timing);
      fadeOut.onfinish = () => fadeOut.cancel();
    }
    panel.removeAttribute('data-dragging');
    header.removeAttribute('data-dragging');
    onEnd();
  };

  // Captured, so the drag keeps tracking when the pointer outruns the bar — and so the release
  // lands on the bar rather than the backdrop, whose click would close the dialog.
  header.setPointerCapture(down.pointerId);
  header.addEventListener('pointermove', move);
  header.addEventListener('pointerup', end);
  header.addEventListener('pointercancel', end);
  header.addEventListener('lostpointercapture', end);
  return end;
}

/**
 * The tint every dialog bar shares — the title bar, the footer, and any bar a dialog builds for
 * itself (the grid's column picker heads its panel with a tab strip) — so a dialog reads as a
 * raised band above and below its body.
 *
 * The second half is the one adjustment that tint forces on whatever sits inside it. Buttons and
 * icon buttons hover to `surface-raised` (see `primitives`), which is the bar's own colour, so their
 * hover would vanish into it. The bar re-points `--color-surface-raised` at `surface-hover` for its
 * children — every `*-surface-raised` utility reads that variable — so anything inside hovers one
 * rung lighter than the bar instead, without a control having to know where it sits. The bar's own
 * background is unaffected: the override is set on its children, not on the bar.
 */
export const MODAL_BAR_TINT =
  'bg-surface-raised *:[--color-surface-raised:var(--color-surface-hover)]';

export interface ModalDragHandleProps {
  /** The bar's own classes — layout, border, tint. The drag cursor is added on top. */
  class: string;
  /** Let the user move the dialog by dragging this bar. Default true. */
  movable?: boolean;
  children: JSX.Element;
}

/**
 * A bar that moves its dialog when dragged: {@link ModalHeader}'s behaviour without its layout, for
 * a dialog whose top bar is not a title (the grid's column picker, whose bar is its tab strip).
 *
 * Controls inside it — tabs, buttons, anything in {@link DRAG_EXEMPT} — click as usual; a press on
 * the bar's own surface starts the drag, which is described at `trackDrag`. Has no effect outside a
 * {@link ModalPanel}, which is the thing that moves. A dialog reopens where it first appears; the
 * position is not remembered across openings.
 */
export function ModalDragHandle(props: ModalDragHandleProps): JSX.Element {
  const drag = useContext(PanelDragContext);
  const movable = (): boolean => drag !== undefined && (props.movable ?? true);
  let endDrag: (() => void) | undefined;
  onCleanup(() => endDrag?.());

  const onPointerDown = (e: PointerEvent & { currentTarget: HTMLElement }): void => {
    const panel = drag?.el();
    if (!drag || !panel || !movable() || e.button !== 0 || endDrag) return;
    const hit = e.target instanceof Element ? e.target.closest(DRAG_EXEMPT) : null;
    if (hit && e.currentTarget.contains(hit)) return;
    // No text selection, and no focus change, from a press that is about to become a drag.
    e.preventDefault();
    endDrag = trackDrag(e.currentTarget, panel, drag.offset, e, () => {
      endDrag = undefined;
    });
  };

  return (
    <header
      class={props.class}
      classList={{ 'cursor-grab touch-none data-[dragging]:cursor-grabbing': movable() }}
      onPointerDown={onPointerDown}
    >
      {props.children}
    </header>
  );
}

/**
 * A dialog's title bar, and the handle the dialog is moved by ({@link ModalDragHandle}).
 *
 * It carries its own background, {@link MODAL_BAR_TINT}, rather than inheriting the panel's, so it
 * stays opaque whatever the panel's background is doing. Two things rely on that: it is `sticky`, so
 * a dialog that scrolls as a whole keeps its title in view without the scrolled content showing
 * through; and while the dialog is dragged the panel's background fades, leaving the bar solid.
 *
 * `subtitle` and `actions` are read through `<Show>`, never tested and then rendered. A JSX prop is
 * a getter that builds its element on every read, so `props.x ? <div>{props.x}</div> : null` builds
 * it twice and leaves one copy orphaned; `<Show>` evaluates it once and hands the result down.
 */
export function ModalHeader(props: ModalHeaderProps): JSX.Element {
  return (
    <ModalDragHandle
      class={`sticky top-0 border-b border-border px-4 py-3 ${MODAL_BAR_TINT}`}
      movable={props.movable}
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-base font-semibold text-text">{props.title}</h2>
          <Show when={props.subtitle}>
            {(subtitle) => <div class="text-xs text-text-muted">{subtitle()}</div>}
          </Show>
        </div>
        <Show when={props.actions}>
          {(actions) => (
            <div data-modal-actions class="flex shrink-0 items-center gap-2">
              {actions()}
            </div>
          )}
        </Show>
      </div>
    </ModalDragHandle>
  );
}

/** How a {@link ModalFooter} arranges its children. */
export type ModalFooterLayout = 'end' | 'between' | 'column';

const FOOTER_LAYOUT: Record<ModalFooterLayout, string> = {
  end: 'items-center justify-end',
  between: 'items-center justify-between',
  column: 'flex-col items-stretch',
};

export interface ModalFooterProps {
  /**
   * Default `end`: the actions, pushed to the right. `between`: something that goes with the actions
   * without being one — a scope control, a destructive alternative — on the left, the actions on the
   * right. `column`: stacked rows, for an action that needs an attestation above it.
   */
  layout?: ModalFooterLayout;
  children: JSX.Element;
}

/**
 * A dialog's action bar: the counterpart of {@link ModalHeader} at the foot of the panel, in the
 * same {@link MODAL_BAR_TINT} and padding.
 *
 * It is `sticky` to the bottom, so a dialog that scrolls as a whole keeps its buttons in reach
 * instead of below the fold. It belongs inside a dialog's `<form>` when there is one, as its last
 * child, so a submit button in it still submits — which is why a form carries its padding on an
 * inner wrapper rather than on itself: the bar has to reach the panel's edges.
 */
export function ModalFooter(props: ModalFooterProps): JSX.Element {
  return (
    <footer
      class={`sticky bottom-0 flex gap-2 border-t border-border px-4 py-3 ${
        FOOTER_LAYOUT[props.layout ?? 'end']
      } ${MODAL_BAR_TINT}`}
    >
      {props.children}
    </footer>
  );
}

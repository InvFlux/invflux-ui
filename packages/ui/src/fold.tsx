import { createSignal, createUniqueId, type JSX } from 'solid-js';

export interface FoldOptions {
  /** Initial state when uncontrolled. */
  defaultOpen?: boolean;
  /** Controlled state. Return `undefined` to stay uncontrolled — pass `() => props.open`. */
  open?: () => boolean | undefined;
  /** Called on every toggle, controlled or not. */
  onOpenChange?: (open: boolean) => void;
  /** When this returns false the section is permanently open and `toggle` is inert. */
  collapsible?: () => boolean;
}

export interface Fold {
  /** Whether the body should render. */
  open: () => boolean;
  /** Flip it. A no-op while not collapsible. */
  toggle: () => void;
  /** Put on the body element; the trigger points at it with `aria-controls`. */
  bodyId: string;
}

/**
 * The fold behaviour shared by every collapsible section: the open signal (controlled *or*
 * uncontrolled), and the generated id that ties a trigger's `aria-controls` to its body.
 *
 * It is a hook rather than a component because the two folds in this package — {@link
 * FoldingSection} for page panels, `SettingsSection` for the settings popover — genuinely differ in
 * *structure*, not just in colour: one puts its trailing slot inside the toggle button and the
 * other outside it, one makes the button the whole row and the other a segment of it. A single
 * component with a `variant` prop would express that as `<Show>` branches in its render, which is a
 * component made of conditionals wearing a variant's clothes. Sharing the twelve lines they
 * actually have in common, and letting each own its markup, keeps both honest — and gives one home
 * for whatever the fold grows later (animation, remembered state).
 *
 * (If the popover's look is ever *designed* to match a page panel, that changes the answer and the
 * two collapse into one component trivially. That is a design decision, not a refactor.)
 */
export function createFold(opts: FoldOptions = {}): Fold {
  const [uncontrolled, setUncontrolled] = createSignal(opts.defaultOpen ?? false);
  const collapsible = (): boolean => opts.collapsible?.() ?? true;
  const open = (): boolean => !collapsible() || (opts.open?.() ?? uncontrolled());

  return {
    open,
    bodyId: createUniqueId(),
    toggle: (): void => {
      if (!collapsible()) return;
      const next = !open();
      if (undefined === opts.open?.()) setUncontrolled(next);
      opts.onOpenChange?.(next);
    },
  };
}

/**
 * The disclosure triangle, rotating a quarter turn when open. Decorative — the trigger's
 * `aria-expanded` is what conveys the state, so this is `aria-hidden`.
 */
export function FoldChevron(props: { open: boolean; class?: string }): JSX.Element {
  return (
    <span
      class={`inline-block w-3 text-xs text-text-muted transition-transform ${props.class ?? ''}`}
      classList={{ 'rotate-90': props.open }}
      aria-hidden="true"
    >
      ▶
    </span>
  );
}

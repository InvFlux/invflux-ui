import { Show, splitProps, type JSX } from 'solid-js';
import { buttonClass, type ButtonSize, type ButtonVariant, type ButtonWeight } from './primitives';
import { Spinner } from './Spinner';

export type { ButtonSize, ButtonVariant, ButtonWeight };

export interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Tone. Default `primary`. */
  variant?: ButtonVariant;
  /** Padding + text scale. Default `md`. */
  size?: ButtonSize;
  /**
   * How much ink the tone spends — `solid` (default) or `outline`. Only meaningful on the coloured
   * tones; `secondary`/`ghost`/`link` already name a weight, so it is ignored there.
   */
  weight?: ButtonWeight;
  /** Disable + mark busy (`disabled` is implied while true), and prefix a spinner. */
  loading?: boolean;
  /**
   * Show the focus ring on plain `:focus`, not just `:focus-visible`. Set it on a button the app
   * focuses **programmatically** (a dialog's dismiss button on open): `:focus-visible` does not
   * match a scripted focus following a mouse click, so the ring would otherwise never appear.
   */
  eagerFocusRing?: boolean;
}

/**
 * The shared button primitive — the single place clickable affordances get their look **and**
 * `cursor-pointer`, so no surface hand-rolls a `<button>` (and forgets the cursor). Wraps a native
 * `<button>` and forwards every native prop (`type`, `onClick`, `aria-*`, …); `class` is appended
 * rather than replaced, so a caller adds layout (`w-full`, `ml-auto`) without losing the variant.
 * Exposed on the plug-in bridge (`window.invflux.<spa>.ui.Button`) so add-ons share it — and because
 * a bridge component renders with the host's stylesheet, an add-on gets it pre-styled.
 *
 * `type` defaults to `button`, not the HTML default `submit`: most of our buttons live inside a
 * `<form>`-less panel or a modal where an accidental submit is a bug. Pass `type="submit"` where a
 * real form submission is intended.
 */
export function Button(props: ButtonProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    'variant',
    'size',
    'weight',
    'loading',
    'class',
    'disabled',
    'children',
    'ref',
    'eagerFocusRing',
  ]);

  return (
    <button
      type="button"
      {...rest}
      // Forwarded explicitly rather than left to the spread: callers that manage focus (a confirm
      // dialog focusing Cancel, a form focusing its submit) depend on it, and a ref that silently
      // fails to attach breaks focus with no error to notice.
      ref={local.ref as ((el: HTMLButtonElement) => void) | undefined}
      class={buttonClass(
        local.variant ?? 'primary',
        local.size ?? 'md',
        local.class,
        local.eagerFocusRing,
        local.weight ?? 'solid',
      )}
      disabled={local.disabled || local.loading || undefined}
      aria-busy={local.loading || undefined}
    >
      <Show when={local.loading}>
        <Spinner size={local.size === 'md' ? 'sm' : 'xs'} />
      </Show>
      {local.children}
    </button>
  );
}

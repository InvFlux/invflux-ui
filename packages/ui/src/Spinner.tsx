import { splitProps, type JSX } from 'solid-js';
import { spinnerClass, type SpinnerSize } from './primitives';

export type { SpinnerSize };

export interface SpinnerProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  /** Diameter. Default `sm`. */
  size?: SpinnerSize;
  /**
   * Accessible label. Omit inside an already-labelled busy control (a `Button` with `loading`
   * carries `aria-busy`, so its spinner is decorative and stays `aria-hidden`).
   */
  label?: string;
}

/**
 * The busy indicator — a `currentColor` ring, so it inherits whatever colour it sits in rather
 * than carrying its own. Decorative by default (`aria-hidden`); pass `label` when the spinner is
 * the *only* signal that something is in flight, which makes it a `role="status"` live region.
 */
export function Spinner(props: SpinnerProps): JSX.Element {
  const [local, rest] = splitProps(props, ['size', 'label', 'class']);

  return (
    <span
      {...rest}
      class={spinnerClass(local.size ?? 'sm', local.class)}
      role={local.label ? 'status' : undefined}
      aria-label={local.label}
      aria-hidden={local.label ? undefined : 'true'}
    />
  );
}

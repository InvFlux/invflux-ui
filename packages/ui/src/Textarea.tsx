import { splitProps, type JSX } from 'solid-js';
import { textareaClass, type FieldSize } from './primitives';

export interface TextareaProps extends JSX.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Padding + text scale. Default `sm`. */
  size?: FieldSize;
  /** Render the error border/ring. */
  invalid?: boolean;
  /** Drop the resize grabber (for auto-growing or fixed-height composers). */
  noResize?: boolean;
}

/**
 * Multi-line field. Sized by `rows` (native) rather than a height class, so `size` here controls
 * padding and text scale only — a fixed height would fight `rows`.
 */
export function Textarea(props: TextareaProps): JSX.Element {
  const [local, rest] = splitProps(props, ['size', 'invalid', 'noResize', 'class']);

  return (
    <textarea
      {...rest}
      class={textareaClass(
        local.size ?? 'sm',
        local.invalid ?? false,
        local.noResize ? `resize-none ${local.class ?? ''}`.trim() : local.class,
      )}
      aria-invalid={local.invalid || undefined}
    />
  );
}

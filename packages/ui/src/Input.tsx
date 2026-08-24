import { splitProps, type JSX } from 'solid-js';
import { inputClass, type FieldSize } from './primitives';

export type { FieldSize };

export interface InputProps extends JSX.InputHTMLAttributes<HTMLInputElement> {
  /** Height + padding scale. Default `sm`. */
  size?: FieldSize;
  /** Render the error border/ring. The *message* is the caller's — a field primitive owns no copy. */
  invalid?: boolean;
}

/**
 * Text-like input (`text`, `number`, `search`, `date`, …). Forwards every native prop, so
 * `type`, `value`, `onInput`, `placeholder`, `ref` and the rest behave exactly as on a bare
 * `<input>`; only the look is ours.
 *
 * `size` shadows the native `size` attribute (character width), which we do not use anywhere —
 * reach for a width class (`class="w-24"`) instead, which is what the surfaces already do.
 *
 * For `type="checkbox"` / `type="radio"` use {@link Checkbox}: a box is not a field, and the two
 * share none of the height/padding vocabulary.
 */
export function Input(props: InputProps): JSX.Element {
  const [local, rest] = splitProps(props, ['size', 'invalid', 'class']);

  return (
    <input
      {...rest}
      class={inputClass(local.size ?? 'sm', local.invalid ?? false, local.class)}
      aria-invalid={local.invalid || undefined}
    />
  );
}

import { splitProps, type JSX } from 'solid-js';
import { selectClass, type FieldSize } from './primitives';

export interface SelectProps extends JSX.SelectHTMLAttributes<HTMLSelectElement> {
  /** Height + padding scale. Default `sm`. */
  size?: FieldSize;
  /** Render the error border/ring. */
  invalid?: boolean;
}

/**
 * Native `<select>` in the house field look — with `cursor-pointer`, which a bare `<select>`
 * does not get. `<option>`s are the caller's children, so their labels stay in the caller's
 * i18n catalogue.
 *
 * This is the *native* control, deliberately: for a short, static option list it beats a custom
 * listbox on keyboard support, mobile behaviour and screen-reader fidelity for free. When the list
 * needs search, async loading or multi-select, reach for `Combobox` / `SearchSelect` instead.
 */
export function Select(props: SelectProps): JSX.Element {
  const [local, rest] = splitProps(props, ['size', 'invalid', 'class']);

  return (
    <select
      {...rest}
      class={selectClass(local.size ?? 'sm', local.invalid ?? false, local.class)}
      aria-invalid={local.invalid || undefined}
    />
  );
}

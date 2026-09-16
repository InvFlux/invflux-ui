import { splitProps, type JSX } from 'solid-js';
import { checkboxClass } from './primitives';

export interface CheckboxProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Render as a radio instead of a checkbox (same box metrics, native single-choice semantics). */
  radio?: boolean;
  /**
   * Visible label rendered beside the box, wrapped in a `<label>` so clicking the text toggles.
   * Pass a translated string, or omit and label the input yourself (`aria-label` / an outer
   * `<label>`) when the caller needs richer markup than a plain string.
   */
  label?: JSX.Element;
  /** Extra classes for the wrapping `<label>` when `label` is set (layout: `gap-2`, `w-full`, …). */
  wrapperClass?: string;
}

/**
 * Native checkbox / radio in the house look — `accent-primary` so the checked fill follows the
 * brand token, plus the `cursor-pointer` a bare box does not get.
 *
 * Use this for yes/no data (a flag on a row, an option in a list). For a binary that *switches a
 * mode* — flipping whole blocks of UI or an inventory contract — use `Switch`, whose pill metaphor
 * reads as "on/off" rather than "agree".
 */
export function Checkbox(props: CheckboxProps): JSX.Element {
  const [local, rest] = splitProps(props, ['radio', 'label', 'wrapperClass', 'class']);

  const box = (): JSX.Element => (
    <input {...rest} type={local.radio ? 'radio' : 'checkbox'} class={checkboxClass(local.class)} />
  );

  return (
    <>
      {local.label === undefined ? (
        box()
      ) : (
        <label
          class={`inline-flex cursor-pointer items-center gap-2 text-sm text-text ${local.wrapperClass ?? ''}`.trim()}
        >
          {box()}
          {local.label}
        </label>
      )}
    </>
  );
}

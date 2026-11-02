import { createEffect, createSignal, on, splitProps, untrack, type JSX } from 'solid-js';
import { Input, type InputProps } from './Input';
import type { ParsedQuantity } from './quantity';
import {
  blurField,
  initialField,
  isMarkedInvalid,
  nudgeField,
  syncValue,
  typeInto,
  type QuantityLimits,
} from './quantityField';

export interface QuantityInputProps extends Omit<
  InputProps,
  'value' | 'onInput' | 'onChange' | 'onBlur' | 'onKeyDown' | 'type' | 'inputmode' | 'min' | 'max'
> {
  /** The committed quantity as the wire integer at `scale`; null for none. */
  value: number | null;
  /** The decimals of the subject this quantity is of, read from its row: one document mixes scales. */
  scale: number;
  /**
   * Called on every change with what the text means, **every kind**: the parent keeps the whole
   * result, blocks its submit on anything but `ok`, and words `empty` / `invalid` /
   * `too_many_decimals` / `out_of_range` as it sees fit. A value alone could not tell them apart,
   * and would leave the last valid number in the parent while the field shows another.
   */
  onChange: (parsed: ParsedQuantity) => void;
  /** Inclusive bounds as scaled integers. `min` also floors the nudge keys (default 0). */
  min?: number;
  max?: number;
  /** The caller's mark, e.g. a required field after the first submit. A value that is invalid marks itself. */
  invalid?: boolean;
  onBlur?: (event: FocusEvent) => void;
}

/**
 * A quantity a person types, at its subject's scale.
 *
 * `type="text"` with an `inputmode` (`decimal` only when the scale has a fractional part): the native
 * number input would turn `2,5` into `25` without a sign. One separator, `.` or `,`; nothing is
 * rounded or repaired. `+` / ArrowUp and `-` / ArrowDown step one whole unit, and with Ctrl/Cmd held
 * the smallest tick; those keys are handled, not typed, so a negative can not be entered. There is no
 * wheel and no spinner.
 *
 * The field keeps its own text while the person types and rewrites it only when `value` or `scale`
 * change to something it did not itself emit. An external reset to the very value the parent already
 * held is therefore invisible to it: remount the field (a keyed `<Show>`) to force one.
 */
export function QuantityInput(props: QuantityInputProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    'value',
    'scale',
    'onChange',
    'min',
    'max',
    'invalid',
    'onBlur',
  ]);
  // Seeded once; the effect below carries later changes (an initial read is not a subscription).
  const [state, setState] = createSignal(untrack(() => initialField(local.value, local.scale)));
  const limits = (): QuantityLimits => ({ min: local.min, max: local.max });

  createEffect(
    on(
      () => [local.value, local.scale] as const,
      ([value, scale]) => setState((prev) => syncValue(prev, value, scale)),
      { defer: true },
    ),
  );

  const onInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (event) => {
    const next = typeInto(state(), event.currentTarget.value, limits());
    setState(next.state);
    local.onChange(next.parsed);
  };

  const onKeyDown: JSX.EventHandler<HTMLInputElement, KeyboardEvent> = (event) => {
    if (event.isComposing || event.altKey) return;
    // Shift+Arrow extends a selection; Shift is also how `+` is typed, so only the arrows care.
    const arrow = 'ArrowUp' === event.key || 'ArrowDown' === event.key;
    if (arrow && event.shiftKey) return;

    let direction: 1 | -1;
    if ('+' === event.key || 'ArrowUp' === event.key) direction = 1;
    else if ('-' === event.key || 'ArrowDown' === event.key) direction = -1;
    else return;

    // Handled, never inserted. With Ctrl/Cmd this also keeps the browser's zoom shortcut out of a quantity field.
    event.preventDefault();
    const next = nudgeField(state(), direction, event.ctrlKey || event.metaKey, limits());
    if (null === next) return;
    setState(next.state);
    local.onChange(next.parsed);
  };

  return (
    <Input
      {...rest}
      type="text"
      inputmode={local.scale > 0 ? 'decimal' : 'numeric'}
      autocomplete="off"
      spellcheck={false}
      value={state().text}
      invalid={true === local.invalid || isMarkedInvalid(state(), limits())}
      onInput={onInput}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        setState((prev) => blurField(prev, limits()));
        local.onBlur?.(event);
      }}
    />
  );
}

import { formatQuantity, parseQuantity, stepQuantity, type ParsedQuantity } from './quantity';

/**
 * The state machine behind `QuantityInput`, kept free of the DOM so its rules are tested as plain
 * functions. The field owns the typed *text*; the parent owns the *value*.
 *
 * - Typing never echoes: at scale 1, `2,0` commits 20, and showing `2` back mid-keystroke would eat
 *   the zero the person is still typing.
 * - A real external change does overwrite the text, invalid text included: it is any `value` that
 *   differs from what the field last emitted.
 */
export interface QuantityFieldState {
  text: string;
  scale: number;
  /** The value the field last put out: the scaled integer, or null for anything that is not a value yet. */
  emitted: number | null;
}

export interface QuantityLimits {
  min?: number;
  max?: number;
}

export function initialField(value: number | null, scale: number): QuantityFieldState {
  return { text: null === value ? '' : formatQuantity(value, scale), scale, emitted: value };
}

/** The person typed. `parsed` is what the parent hears, every kind, so it can tell empty from invalid. */
export function typeInto(
  state: QuantityFieldState,
  text: string,
  limits: QuantityLimits,
): { state: QuantityFieldState; parsed: ParsedQuantity } {
  const parsed = parseQuantity(text, { scale: state.scale, ...limits });

  return {
    state: { ...state, text, emitted: 'ok' === parsed.kind ? parsed.scaled : null },
    parsed,
  };
}

/** The parent's `value` or `scale` changed. Only a difference from what the field emitted rewrites the text. */
export function syncValue(
  state: QuantityFieldState,
  value: number | null,
  scale: number,
): QuantityFieldState {
  if (scale === state.scale && value === state.emitted) return state;

  return initialField(value, scale);
}

/** Leaving the field tidies a valid entry (`2,0` → `2`); anything else stays as typed. */
export function blurField(state: QuantityFieldState, limits: QuantityLimits): QuantityFieldState {
  const parsed = parseQuantity(state.text, { scale: state.scale, ...limits });

  return 'ok' === parsed.kind
    ? { ...state, text: formatQuantity(parsed.scaled, state.scale) }
    : state;
}

/**
 * A nudge key. Steps from the typed value (an empty field counts as 0, an over-limit one is read
 * without its limits so a `-` brings it back); text that is not a number is left alone.
 */
export function nudgeField(
  state: QuantityFieldState,
  direction: 1 | -1,
  fine: boolean,
  limits: QuantityLimits,
): { state: QuantityFieldState; parsed: ParsedQuantity } | null {
  const read = parseQuantity(state.text, { scale: state.scale });
  if ('ok' !== read.kind && 'empty' !== read.kind) return null;

  const scaled = stepQuantity(
    'ok' === read.kind ? read.scaled : 0,
    state.scale,
    direction,
    fine,
    limits,
  );

  return {
    state: { text: formatQuantity(scaled, state.scale), scale: state.scale, emitted: scaled },
    parsed: { kind: 'ok', scaled },
  };
}

/**
 * Whether the field shows the pink mark while the person types (§7.2 R5): any value that is not
 * valid, except a missing one (the caller marks that from the first submit) and a separator typed
 * last (`2,` on the way to `2,5`).
 */
export function isMarkedInvalid(state: QuantityFieldState, limits: QuantityLimits): boolean {
  const parsed = parseQuantity(state.text, { scale: state.scale, ...limits });
  if ('ok' === parsed.kind || 'empty' === parsed.kind) return false;

  return !(state.scale > 0 && /^\d+[.,]$/.test(state.text.trim()));
}

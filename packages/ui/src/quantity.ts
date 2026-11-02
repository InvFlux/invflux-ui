import { getLocale } from '@invflux/i18n';
import { parseDecimal } from './parseDecimal';

/**
 * Typed quantities and their display, over the integer the wire carries.
 *
 * A quantity travels as the integer stored at its subject's scale (`1.250 kg` at scale 3 is `1250`) and
 * only display divides by `10^scale`. Everything here moves the decimal point **by string**, never
 * through a float, so `0.1 + 0.2` can not happen to a quantity and nothing is rounded.
 */

/** What a person's text means. `scaled` is the wire integer at the field's scale. */
export type ParsedQuantity =
  | { kind: 'ok'; scaled: number }
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'too_many_decimals'; scale: number }
  | { kind: 'out_of_range' };

export interface ParseQuantityOptions {
  /** Decimals the subject carries. More typed than this is `too_many_decimals`, never rounded. */
  scale: number;
  /** Inclusive bounds, as scaled integers (the unit the wire speaks), not as typed decimals. */
  min?: number;
  max?: number;
  /** Accept a leading minus. Default false: a quantity typed into a form is a count. */
  negative?: boolean;
}

/**
 * Read a quantity someone typed, at `options.scale`. The text is judged by {@link parseDecimal} (the
 * one typed-decimal parser: one separator, `.` or `,`, nothing repaired), then shifted by `scale`
 * digits as a string. A result past `Number.isSafeInteger` is `out_of_range`, so a long run of digits
 * can not silently lose precision.
 */
export function parseQuantity(text: string, options: ParseQuantityOptions): ParsedQuantity {
  const parsed = parseDecimal(text, { scale: options.scale, negative: options.negative });
  if ('ok' !== parsed.kind) return parsed;

  const scaled = shiftToScaled(parsed.value, options.scale);
  if (
    null === scaled ||
    (undefined !== options.min && scaled < options.min) ||
    (undefined !== options.max && scaled > options.max)
  ) {
    return { kind: 'out_of_range' };
  }

  return { kind: 'ok', scaled };
}

/** `"-2.5"` at scale 2 → -250; null when the integer is not exactly representable. */
function shiftToScaled(value: string, scale: number): number | null {
  const negative = value.startsWith('-');
  const [whole = '', fraction = ''] = value.replace('-', '').split('.');
  // Past 2^53 the conversion rounds to an unsafe integer (or Infinity), so the check below is exact.
  const n = Number(whole + fraction.padEnd(scale, '0'));
  if (!Number.isSafeInteger(n)) return null;

  return negative && 0 !== n ? -n : n;
}

export interface FormatQuantityOptions {
  /**
   * Keep trailing zeros (`2.0` at scale 1), for figures aligned in a column. Default false: the
   * minimal form, `2` and `2.5`, which is also what an input shows once edited.
   */
  fixed?: boolean;
  /** Group the whole part by the locale's thousands separator. Default false: an input being edited has none. */
  grouped?: boolean;
}

interface LocaleParts {
  locale: string | undefined;
  decimal: string;
  /** Null when the locale tag is unusable: the whole part is then shown ungrouped. */
  whole: Intl.NumberFormat | null;
}

let localeParts: LocaleParts | null = null;

/** The separator and grouper of the UI locale (`getLocale()`: the user's language, with strings and dates). */
function partsForLocale(): LocaleParts {
  const locale = getLocale();
  if (null !== localeParts && localeParts.locale === locale) return localeParts;

  let decimal = '.';
  let whole: Intl.NumberFormat | null = null;
  try {
    whole = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 });
    decimal =
      new Intl.NumberFormat(getLocale()).formatToParts(1.1).find((p) => 'decimal' === p.type)
        ?.value ?? '.';
  } catch {
    // An unusable tag falls back to a dot and no grouping rather than breaking a screen.
  }
  localeParts = { locale, decimal, whole };

  return localeParts;
}

/**
 * The wire integer as text: `25` at scale 1 is `2.5` (`2,5` under a comma locale), `20` is `2`, and a
 * negative (a variance, a delta) keeps its ASCII `-`, which {@link parseQuantity} reads back. At scale
 * 0 this is the identity. The one place a quantity's decimal point is placed; screens never divide.
 */
export function formatQuantity(
  scaled: number,
  scale: number,
  options: FormatQuantityOptions = {},
): string {
  if (!Number.isSafeInteger(scaled) || !Number.isInteger(scale) || scale < 0) return String(scaled);

  const parts = partsForLocale();
  const digits = String(Math.abs(scaled)).padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  let fraction = digits.slice(digits.length - scale);
  if (true !== options.fixed) fraction = fraction.replace(/0+$/, '');

  const shown =
    true === options.grouped && null !== parts.whole ? parts.whole.format(Number(whole)) : whole;

  return `${scaled < 0 ? '-' : ''}${shown}${'' === fraction ? '' : parts.decimal + fraction}`;
}

export interface StepBounds {
  /** Lowest value a step may reach, as a scaled integer. Default 0. */
  min?: number;
  max?: number;
}

/**
 * One nudge. A whole unit (`10^scale`), or with `fine` the smallest tick (1, the last decimal); at
 * scale 0 they are the same. Floored at `min` (default 0) and capped at `max`.
 */
export function stepQuantity(
  from: number,
  scale: number,
  direction: 1 | -1,
  fine: boolean,
  bounds: StepBounds = {},
): number {
  const unit = fine ? 1 : 10 ** scale;
  let next = Math.min(Math.max(from + direction * unit, bounds.min ?? 0), Number.MAX_SAFE_INTEGER);
  if (undefined !== bounds.max) next = Math.min(next, bounds.max);

  return next;
}

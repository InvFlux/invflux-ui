/**
 * Read a number a person typed, strictly — the one parser for typed decimals (amounts, rates,
 * quantities at a scale). It returns a result rather than a number, so a screen can tell *empty* from
 * *invalid*, keep what was typed, and say why.
 *
 * - Digits, with at most one decimal separator, `.` or `,`; an optional leading `-` only when
 *   `negative` is allowed. No grouping separators, spaces inside, exponents or a bare `5.` / `.5`.
 * - **Never a repair.** `2,5` is 2.5; `1 096,90` is `invalid`, where a `type="number"` field would
 *   quietly hand back 109690.
 *
 * Not the grid's paste reader. `normalizeNumeric` in `datatypes/codecs.ts` (the `decimal` /
 * `decimal:money` codecs) reads a figure pasted from any spreadsheet locale, so it *guesses*: it
 * strips grouping spaces and takes the last `,` or `.` as the decimal point, which reads a lone
 * `1,234` as 1.234. A guess is right for a paste and wrong for a field someone is typing into, where
 * the answer to an ambiguous figure is to ask, not to pick one — so the two stay apart.
 * - More decimals than `scale` is `too_many_decimals`, never rounded.
 * - The value stays a **decimal string** in canonical dot form, so nothing round-trips through a
 *   float on its way to the server.
 */
export type ParsedDecimal =
  | { kind: 'ok'; value: string }
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'too_many_decimals'; scale: number }
  | { kind: 'out_of_range' };

export interface ParseDecimalOptions {
  /** Most decimals accepted. Absent: any number. */
  scale?: number;
  /** Accept a leading minus. Default false — most typed figures here are amounts or counts. */
  negative?: boolean;
  /** Inclusive bounds, compared numerically. */
  min?: number;
  max?: number;
}

export function parseDecimal(text: string, options: ParseDecimalOptions = {}): ParsedDecimal {
  const t = text.trim();
  if ('' === t) return { kind: 'empty' };
  const match = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(t);
  if (null === match || ('-' === match[1] && true !== options.negative)) return { kind: 'invalid' };
  const fraction = match[3] ?? '';
  if (undefined !== options.scale && fraction.length > options.scale) {
    return { kind: 'too_many_decimals', scale: options.scale };
  }
  const value = `${match[1]}${match[2]}${'' === fraction ? '' : `.${fraction}`}`;
  const n = Number(value);
  if (
    (undefined !== options.min && n < options.min) ||
    (undefined !== options.max && n > options.max)
  ) {
    return { kind: 'out_of_range' };
  }
  return { kind: 'ok', value };
}

/** The value of an `ok` or `empty` result — null for empty — or undefined when the text is unusable. */
export function decimalOrNull(parsed: ParsedDecimal): string | null | undefined {
  if ('ok' === parsed.kind) return parsed.value;
  return 'empty' === parsed.kind ? null : undefined;
}

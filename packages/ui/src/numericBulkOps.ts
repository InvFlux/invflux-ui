/**
 * The arithmetic behind the bulk-edit modal's numeric operators — setting a value across a
 * selection, or moving every row by a delta.
 *
 * A delta is what a bulk edit over *differing* rows actually needs. "Set to" flattens a column: the
 * 497 prices that differed all become one number, and the information that they differed is gone.
 * "Increase by 10%" is the operation a merchant means when a supplier raises a range, and it is
 * expressible in no other way here.
 *
 * **Undoing a percentage is a division, not the opposite sign** — the one piece of this worth
 * stating twice. Raising 100 by 10% gives 110; lowering 110 by 10% gives 99, not 100. The inverse
 * of `× 1.1` is `÷ 1.1` (≈ −9.09%), which is why `undo-increase-pct` / `undo-decrease-pct` exist
 * rather than leaving the merchant to work out that a seasonal +10% is undone by −9.0909…%.
 *
 * **The undo restores the original to within the column's granularity, not exactly**, and no
 * implementation here could do better: the intermediate was *stored* rounded to the cent, so the
 * sub-cent part of the original is gone by the time the undo runs. 31.90 less 5% stores 30.30, and
 * dividing that back out gives 31.89. Rows can therefore come back a cent off — which is why the
 * modal previews the computed value instead of promising a restoration.
 */

/** What a numeric bulk edit does to each row's current value. */
export type NumericOp =
  | 'set'
  | 'add'
  | 'subtract'
  | 'increase-pct'
  | 'decrease-pct'
  | 'undo-increase-pct'
  | 'undo-decrease-pct';

/** Whether an operator reads each row's current value (a delta) rather than replacing it. */
export function isDeltaOp(op: NumericOp): boolean {
  return op !== 'set';
}

/** Whether the operand is a percentage rather than an amount in the column's own units. */
export function isPercentOp(op: NumericOp): boolean {
  return op !== 'set' && op !== 'add' && op !== 'subtract';
}

/** Why a row produced no value. Callers surface these as counts, never as a silent skip. */
export type SkipReason = 'no-value' | 'undefined-result';

export interface ComputeOutcome {
  /** The computed value, rounded and clamped; null when the row was skipped. */
  value: number | null;
  skipped: SkipReason | null;
  /** True when `value` was pulled up/down to `min`/`max` rather than being the raw result. */
  clamped: boolean;
}

export interface ComputeOptions {
  /** Decimal places to round to. Money is 2 (matching how the grid renders it). */
  decimals: number;
  /** Column bounds from `editorConfig`, when declared. */
  min?: number;
  max?: number;
}

/**
 * Apply `op` with `operand` to one row's `current` value.
 *
 * `undo-decrease-pct` at 100 is the one arithmetically impossible case: a 100% decrease takes every
 * value to zero, so there is nothing to divide back out. It reports `undefined-result` rather than
 * dividing by zero — the caller counts those and tells the merchant, which is where an edge case
 * belongs.
 */
export function computeNumericOp(
  op: NumericOp,
  current: number | null,
  operand: number,
  opts: ComputeOptions,
): ComputeOutcome {
  const skip = (reason: SkipReason): ComputeOutcome => ({
    value: null,
    skipped: reason,
    clamped: false,
  });

  if (op === 'set') return finish(operand, opts);
  // A delta needs something to act on. An empty cell is not zero — "add 5" to a price nobody has
  // set would invent a price, so the row is skipped and counted.
  if (current === null || !Number.isFinite(current)) return skip('no-value');

  let raw: number;
  switch (op) {
    case 'add':
      raw = current + operand;
      break;
    case 'subtract':
      raw = current - operand;
      break;
    case 'increase-pct':
      raw = current * (1 + operand / 100);
      break;
    case 'decrease-pct':
      raw = current * (1 - operand / 100);
      break;
    case 'undo-increase-pct': {
      const factor = 1 + operand / 100;
      if (factor === 0) return skip('undefined-result');
      raw = current / factor;
      break;
    }
    case 'undo-decrease-pct': {
      const factor = 1 - operand / 100;
      if (factor === 0) return skip('undefined-result');
      raw = current / factor;
      break;
    }
  }
  if (!Number.isFinite(raw)) return skip('undefined-result');

  return finish(raw, opts);
}

/** Round to the column's granularity, then hold it inside any declared bounds. */
function finish(raw: number, opts: ComputeOptions): ComputeOutcome {
  // Round before clamping: rounding a clamped value can push it back outside the bound.
  const rounded = roundTo(raw, opts.decimals);
  let value = rounded;
  if (opts.min !== undefined && value < opts.min) value = opts.min;
  if (opts.max !== undefined && value > opts.max) value = opts.max;

  return { value, skipped: null, clamped: value !== rounded };
}

/**
 * Round to `decimals` places, half away from zero on the *decimal* midpoint a merchant sees.
 *
 * Scaling by a power of ten before rounding, rather than `Number(v.toFixed(d))`. Measured over
 * 200 000 random doubles the two never disagree. They part company on a *typed* decimal midpoint,
 * which is stored a hair below itself: `toFixed` rounds that stored double, giving 2.675 → 2.67 and
 * 30.305 → 30.30, where scaling carries it up to 2.68 and 30.31 — what "round half up" means to
 * whoever set the price.
 *
 * Neither form is exact, and scaling does not rescue every case: a value the arithmetic *computes*
 * onto a midpoint usually lands below it (31.9 × 0.95 is 30.304999999999996), so both forms round
 * it down. The choice buys the typed-literal case and nothing more, which is enough to prefer it.
 */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  const places = Math.max(0, Math.min(decimals, 10));
  const scale = 10 ** places;
  const scaled = value * scale;
  if (!Number.isFinite(scaled)) return value;

  return (value < 0 ? -Math.round(-scaled) : Math.round(scaled)) / scale;
}

/**
 * The decimal places a column's computed values carry.
 *
 * Money is fixed at 2 — the same granularity the grid already renders, so a computed price never
 * appears at a precision the column cannot show. Everything else keeps the granularity its own data
 * already has (a column of whole numbers stays whole), capped so float noise never reaches a cell.
 */
export function decimalsForValues(isMoney: boolean, values: readonly string[]): number {
  if (isMoney) return 2;

  let seen = 0;
  for (const raw of values) {
    const dot = raw.indexOf('.');
    if (dot >= 0) seen = Math.max(seen, raw.length - dot - 1);
  }

  return Math.min(seen, 6);
}

/** Numeric columns the operators apply to: money and the `number*` family. */
export function isNumericDataType(dataType: string): boolean {
  return (
    dataType === 'decimal:money' || dataType.startsWith('decimal:') || dataType.startsWith('number')
  );
}

/** Money is emitted as a fixed-decimal string; other numerics as numbers (WC stores decimals as strings). */
export function isMoneyDataType(dataType: string): boolean {
  return dataType.startsWith('decimal:');
}

/** Parse a cell's current value, tolerating the string form decimals arrive in. Null when absent. */
export function parseNumericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);

  return Number.isFinite(parsed) ? parsed : null;
}

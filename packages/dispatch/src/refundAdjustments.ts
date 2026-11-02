import { toCents } from './money';

/** One manual refund adjustment as typed: `amount` is a magnitude, and `kind` gives the sign. */
export interface TypedAdjustment {
  kind: 'reduce' | 'increase';
  amount: string;
}

/** Why an adjustment cannot be sent. `roomCents` is the most this row can hold. */
export type AdjustmentProblem = { kind: 'invalid' } | { kind: 'over'; roomCents: number };

/** A row's magnitude in cents: an empty field is zero, and `null` is text that is not an amount. */
export function adjustmentCents(text: string): number | null {
  const typed = text.trim();
  if ('' === typed) return 0;
  // The row's kind carries the sign, so a typed minus is not a magnitude.
  return typed.startsWith('-') ? null : toCents(typed);
}

/** A row's contribution to the refund. Text that is not an amount contributes nothing. */
export function signedAdjustmentCents(row: TypedAdjustment): number {
  const cents = adjustmentCents(row.amount) ?? 0;
  return 'reduce' === row.kind ? -cents : cents;
}

/**
 * What is wrong with one row, or null. The rows together must keep the net adjustment within
 * `[floorCents, ceilCents]`, so a row's room depends on what the others already take.
 */
export function adjustmentProblem(
  rows: readonly TypedAdjustment[],
  index: number,
  floorCents: number,
  ceilCents: number,
): AdjustmentProblem | null {
  const row = rows[index];
  if (undefined === row) return null;
  const cents = adjustmentCents(row.amount);
  if (null === cents) return { kind: 'invalid' };
  const others = rows.reduce(
    (sum, r, i) => (i === index ? sum : sum + signedAdjustmentCents(r)),
    0,
  );
  const roomCents = Math.max(0, 'reduce' === row.kind ? others - floorCents : ceilCents - others);
  return cents > roomCents ? { kind: 'over', roomCents } : null;
}

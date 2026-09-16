/**
 * Which draft lines survive submission — mirrored from the server's submit handler so the headline
 * action, the confirmation modal and the server all agree on what an empty purchase order is.
 *
 * A line is ordered only with BOTH a positive quantity and a positive effective price, where the
 * price is the line's own override or the catalogue price it inherits. The server prunes the rest,
 * and refuses a PO that keeps no line at all — so a draft can show rows and still be empty in
 * substance. Reason precedence matches the server: a missing quantity is reported before a missing
 * price, so a line lacking both reads as `zero_qty`.
 */
import type { PoLine } from './types';

/** Why the server would drop a line at submission. */
export type PruneReason = 'zero_qty' | 'no_price';

/** The effective per-unit cost of a line: its own override, or the inherited catalogue price. */
export function effectiveCost(line: PoLine): number | null {
  const c = line.unitCost ?? line.catalogUnitCost;
  return null === c ? null : Number(c);
}

/** Why this line would be pruned at submission, or null when it survives. */
export function pruneReason(line: PoLine): PruneReason | null {
  if (line.qtyRequested <= 0) return 'zero_qty';
  const c = effectiveCost(line);
  return null === c || c <= 0 ? 'no_price' : null;
}

/** The lines that would actually be ordered — what the PO amounts to in substance. */
export function submittableLines(lines: PoLine[]): PoLine[] {
  return lines.filter((line) => null === pruneReason(line));
}

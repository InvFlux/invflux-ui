/**
 * Supplier order-quantity rules (MOQ + case-pack), mirrored from the server's
 * `SuggestReplenishment::minimumOrderQty` / `suggestedQty` rounding so the draft grid's inline
 * validation and the submit modal's "Fix" buttons agree with what the server would compute.
 *
 * Both a MOQ and a case-pack are optional; `null`/`0`/negative means "no rule on that axis".
 */

/** True when a positive qty falls below the supplier's minimum order quantity. */
export function belowMoq(qty: number, moq: number | null): boolean {
  return null !== moq && moq > 0 && qty > 0 && qty < moq;
}

/** True when a positive qty is not a whole multiple of the supplier's case pack. */
export function offCasePack(qty: number, casePack: number | null): boolean {
  return null !== casePack && casePack > 0 && qty > 0 && qty % casePack !== 0;
}

/** True when a positive qty violates either the MOQ or the case-pack rule. */
export function qtyIsInvalid(qty: number, moq: number | null, casePack: number | null): boolean {
  return belowMoq(qty, moq) || offCasePack(qty, casePack);
}

/**
 * The smallest valid quantity ≥ `qty`: floor at the MOQ first, then round up to a whole case pack —
 * the same order as the server (a MOQ that isn't a whole number of cases still rounds up to one, e.g.
 * MOQ 10 / case-pack 6 → 12). A 0 qty stays 0 (nothing ordered is not a violation); with no rules the
 * qty is returned unchanged.
 */
export function nextValidQty(qty: number, moq: number | null, casePack: number | null): number {
  if (qty <= 0) return qty;
  let need = qty;
  if (null !== moq && moq > 0 && need < moq) need = moq;
  if (null !== casePack && casePack > 0) need = Math.ceil(need / casePack) * casePack;
  return need;
}

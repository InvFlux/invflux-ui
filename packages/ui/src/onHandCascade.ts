/**
 * Client-side mirror of the PHP `OnHandCascade`.
 * Allocates a **total on-hand** delta across the commercial slots so a UI can preview, live,
 * exactly what a save will commit — the optimistic baseline is the current atp/res/ctd, and the
 * positive `ctd` fill is capped at the cached `deficitQty` (= soldQty − ctd), so preview ≡ commit.
 *
 * - **Negative** (loss): drain `atp → res → ctd`, least- to most-committed, floored at 0 per slot.
 * - **Positive** (found / recount-up): fill the `ctd` deficit first (up to `deficitQty`), then overflow
 *   to `atp`. `res` is never grown — it carries no tracked deficit (reservations are cart-owned, §5).
 *
 * Keep in lockstep with the PHP version; the unit test pins the shared worked examples.
 */
export interface SlotDeltas {
  atp: number;
  res: number;
  ctd: number;
}

export function cascadeAllocate(
  delta: number,
  atp: number,
  res: number,
  ctd: number,
  deficitQty: number,
): SlotDeltas {
  if (delta < 0) {
    let amount = -delta;
    const takeAtp = Math.min(amount, Math.max(0, atp));
    amount -= takeAtp;
    const takeRes = Math.min(amount, Math.max(0, res));
    amount -= takeRes;
    const takeCtd = Math.min(amount, Math.max(0, ctd));
    // Negate, normalising -0 → 0 (JS distinguishes them; PHP ints don't).
    const neg = (x: number): number => (x === 0 ? 0 : -x);
    return { atp: neg(takeAtp), res: neg(takeRes), ctd: neg(takeCtd) };
  }
  if (delta > 0) {
    let amount = delta;
    const toCtd = Math.min(amount, Math.max(0, deficitQty));
    amount -= toCtd;
    return { atp: amount, res: 0, ctd: toCtd };
  }
  return { atp: 0, res: 0, ctd: 0 };
}

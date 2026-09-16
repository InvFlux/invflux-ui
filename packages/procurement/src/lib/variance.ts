import type { PoLine, VarianceStatus } from '../sections/purchase-orders/types';

/**
 * Client mirror of core `VarianceStatus` / `PurchaseOrderLine` variance logic (invflux-core,
 * Domain/Procurement). Kept in TS so the read-view badge, the confirmation badge, and the *live*
 * receive grid (whose session quantities aren't yet committed, so the server can't classify them)
 * all share one logic and one lens. Parity with core is covered by VarianceStatusTest there;
 * keep the two in step.
 */

/** The delivery-variance baseline lens — see core VarianceLens. */
export type VarianceLens = 'ordered' | 'expected';

/** Pure classifier — mirror of core VarianceStatus::classify(). */
export function classifyVariance(
  baseline: number,
  actual: number,
  finalized: boolean,
): VarianceStatus {
  if (actual > baseline) return 'over';
  if (actual < baseline) return finalized ? 'short' : 'open';
  return 'match';
}

/** The fields any variance helper needs off a line — a structural subset of {@link PoLine}. */
export type VarianceLineInput = Pick<
  PoLine,
  'qtyRequested' | 'qtyExpected' | 'qtyReceived' | 'qtyOpen'
>;

/** Baseline quantity for a lens: Ordered = requested, Expected = confirmed (falls back to ordered). */
export function baselineQty(line: VarianceLineInput, lens: VarianceLens): number {
  return 'ordered' === lens ? line.qtyRequested : (line.qtyExpected ?? line.qtyRequested);
}

/** Signed delivery variance (received − baseline) under a lens. */
export function deliveryVarianceQty(line: VarianceLineInput, lens: VarianceLens): number {
  return line.qtyReceived - baselineQty(line, lens);
}

/** Delivery status (received vs lens baseline); progressive, so finalized = nothing left open. */
export function deliveryStatus(line: VarianceLineInput, lens: VarianceLens): VarianceStatus {
  return classifyVariance(baselineQty(line, lens), line.qtyReceived, 0 === line.qtyOpen);
}

/** Signed confirmation variance: supplier-confirmed (expected) − ordered. 0 until an OA/ASN is recorded. */
export function confirmationVarianceQty(line: VarianceLineInput): number {
  return (line.qtyExpected ?? line.qtyRequested) - line.qtyRequested;
}

/** Confirmation status (confirmed vs ordered); non-progressive, so always finalized (never Open). */
export function confirmationStatus(line: VarianceLineInput): VarianceStatus {
  return classifyVariance(line.qtyRequested, line.qtyExpected ?? line.qtyRequested, true);
}

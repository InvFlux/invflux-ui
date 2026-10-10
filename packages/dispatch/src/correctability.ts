import type { CorrectionType, DispatchOrderLine, DispatchOrderSummary } from './types';

/** Which side of shipment a correction is on. */
export type CorrectionSide = 'pre' | 'post';

/**
 * Which sides of shipment this order can be corrected on at all, before looking at its lines.
 *
 * - **Before shipment** only while the order is still open. A Closed order — canceled, refunded,
 *   failed, or completed in the host — has nothing left to cancel or write off, whatever its lines
 *   still say.
 * - **After shipment** only where this install registers an after-shipping correction type (a
 *   return). The base install registers none; there, goods that came back are recorded by refunding
 *   in WooCommerce. Asked of the types, never the license: whichever plugin registers a return type is
 *   what makes one recordable.
 */
export function correctionSides(
  order: Pick<DispatchOrderSummary, 'workflowState'>,
  types: readonly CorrectionType[],
): Record<CorrectionSide, boolean> {
  return {
    pre: order.workflowState !== 'Closed',
    post: types.some((type) => !type.preDispatch),
  };
}

/**
 * Units still to ship on a line — what a before-shipment correction can take. Canceled, not
 * corrected: a returned unit was delivered, so it is already in `qtyShipped`.
 */
export function unshippedQty(line: DispatchOrderLine): number {
  return Math.max(0, line.qtyOrdered - line.qtyCanceled - line.qtyShipped);
}

/** Shipped units not yet taken back — what an after-shipment correction can take. */
export function returnableQty(line: DispatchOrderLine): number {
  return Math.max(0, line.qtyShipped - line.qtyReturned);
}

/** What can be corrected on this line on one side, or 0 when that side is closed to this order. */
export function correctableQty(
  line: DispatchOrderLine,
  side: CorrectionSide,
  sides: Record<CorrectionSide, boolean>,
): number {
  if (!sides[side]) return 0;

  return side === 'pre' ? unshippedQty(line) : returnableQty(line);
}

/** Whether anything on this line can be corrected, on either side. */
export function lineCorrectable(
  line: DispatchOrderLine,
  sides: Record<CorrectionSide, boolean>,
): boolean {
  return correctableQty(line, 'pre', sides) > 0 || correctableQty(line, 'post', sides) > 0;
}

/** Whether anything on the order can be corrected — what decides if "Add correction" is offered. */
export function orderCorrectable(
  lines: readonly DispatchOrderLine[],
  sides: Record<CorrectionSide, boolean>,
): boolean {
  return lines.some((line) => lineCorrectable(line, sides));
}

import { describe, expect, it } from 'vitest';
import { correctableQty, correctionSides, orderCorrectable } from './correctability';
import type { CorrectionType, DispatchOrderLine } from './types';

const line = (over: Partial<DispatchOrderLine>): DispatchOrderLine =>
  ({
    lineId: 1,
    qtyOrdered: 2,
    qtyCorrected: 0,
    qtyCanceled: 0,
    qtyReturned: 0,
    qtyShipped: 0,
    ...over,
  }) as DispatchOrderLine;

const preOnly = [{ code: 'cancel_customer', preDispatch: true }] as CorrectionType[];
const withReturns = [
  ...preOnly,
  { code: 'return_resaleable', preDispatch: false },
] as CorrectionType[];

describe('correctability', () => {
  it('offers before-shipment corrections on an open order with units still to ship', () => {
    const sides = correctionSides({ workflowState: 'Active' }, preOnly);

    expect(orderCorrectable([line({ qtyShipped: 1 })], sides)).toBe(true);
    expect(correctableQty(line({ qtyShipped: 1 }), 'pre', sides)).toBe(1);
  });

  it('offers nothing once every unit has shipped and no return type exists', () => {
    const sides = correctionSides({ workflowState: 'Closed' }, preOnly);

    expect(orderCorrectable([line({ qtyShipped: 2 })], sides)).toBe(false);
  });

  it('offers a return on shipped units where an after-shipping type is registered', () => {
    const sides = correctionSides({ workflowState: 'Closed' }, withReturns);

    expect(orderCorrectable([line({ qtyShipped: 2 })], sides)).toBe(true);
    expect(correctableQty(line({ qtyShipped: 2 }), 'post', sides)).toBe(2);
  });

  /** A returned unit was delivered: it neither reopens the unshipped side nor can be returned twice. */
  it('counts a return against the shipped units, never against what is still owed', () => {
    const sides = correctionSides({ workflowState: 'Active' }, withReturns);
    const partlyReturned = line({ qtyOrdered: 3, qtyShipped: 2, qtyReturned: 1, qtyCorrected: 1 });

    expect(correctableQty(partlyReturned, 'pre', sides)).toBe(1);
    expect(correctableQty(partlyReturned, 'post', sides)).toBe(1);
  });

  it('offers nothing on a fully corrected line', () => {
    const sides = correctionSides({ workflowState: 'Active' }, withReturns);

    expect(orderCorrectable([line({ qtyCorrected: 2, qtyCanceled: 2 })], sides)).toBe(false);
  });

  /** Canceled, refunded, failed or completed in the host: unshipped units on paper, nothing to cancel. */
  it('closes the before-shipment side on a closed order whatever its lines say', () => {
    const sides = correctionSides({ workflowState: 'Closed' }, withReturns);

    expect(correctableQty(line({}), 'pre', sides)).toBe(0);
    expect(orderCorrectable([line({})], sides)).toBe(false);
  });
});

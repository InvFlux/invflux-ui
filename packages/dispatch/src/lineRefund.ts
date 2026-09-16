import type { DispatchOrderLine } from './types';

/**
 * What a line's units were paid at, and what correcting some of them refunds — the client twin of
 * core's `OrderLine::netUnitPrice()` / `refundFor()`, down to the rounding.
 *
 * The server owns the refund figure: it derives it when the correction is created and ignores any
 * client amount. This exists so the correction modal can show that same figure before submitting,
 * rather than a list-price estimate the server would then contradict.
 */
type PricedLine = Pick<
  DispatchOrderLine,
  'unitPrice' | 'lineDiscount' | 'qtyOrdered' | 'qtyCorrected'
>;

const toCents = (amount: string | undefined): number =>
  Math.round((parseFloat(amount ?? '') || 0) * 100);

const fromCents = (cents: number): string => (cents / 100).toFixed(2);

/** The whole line at the price paid, in cents; never negative. */
const netTotalCents = (line: PricedLine): number =>
  Math.max(0, toCents(line.unitPrice) * line.qtyOrdered - toCents(line.lineDiscount));

/** True when the host took something off this line. */
export function hasDiscount(line: Pick<DispatchOrderLine, 'lineDiscount'>): boolean {
  return toCents(line.lineDiscount) > 0;
}

/** One unit at the price paid: the list price less its share of the line's discount. */
export function netUnitPrice(line: PricedLine): string {
  if (line.qtyOrdered <= 0) return fromCents(toCents(line.unitPrice));

  return fromCents(Math.round(netTotalCents(line) / line.qtyOrdered));
}

/**
 * The refund owed for correcting `qty` more units, given the line's `qtyCorrected` — prorated
 * cumulatively, so a line corrected a unit at a time refunds exactly what it does all at once, and
 * never a cent more than it charged.
 */
export function refundFor(line: PricedLine, qty: number): string {
  const ordered = line.qtyOrdered;
  if (ordered <= 0 || qty <= 0) return '0.00';

  const before = Math.min(Math.max(0, line.qtyCorrected), ordered);
  const after = Math.min(before + qty, ordered);
  const net = netTotalCents(line);
  const share = (units: number): number => Math.round((net * units) / ordered);

  return fromCents(share(after) - share(before));
}

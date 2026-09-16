import type { CorrectionReason, CorrectionType, DispatchOrderLine } from './types';

/**
 * The correction modal asks what an operator knows — when, whose fault, why, and where the stock
 * goes — and the correction type follows from those answers. This module is that mapping, kept out
 * of the component so it can be read and tested as a table.
 *
 * The type still decides what the engine does (stock movement, refund); the reason still records
 * whose fault it was. Neither is asked for directly: the type's names mix the two ("cancelled by
 * customer"), and an operator asked to pick one had to translate their answer into it.
 *
 * Before shipment a correction does one of two things. A **cancellation** lowers the order's demand
 * and gives back whatever committed stock the product's other orders do not need. A **write-off**
 * says the units held for the order are defective or not there and that nothing can replace them,
 * so it gives the demand up and destroys those units. The reason alone says which, and each write-off
 * reason has to be coherent with the product's stock (the server's `writeOffAllowed`, per reason).
 */

/** Which side of shipment the corrected units are on. */
export type Timing = 'pre' | 'post';

/** Whose fault the correction is — the reason's cause. */
export type ResponsibleParty = CorrectionReason['cause'];

/** Where the corrected units go. */
export type StockFate = 'shelf' | 'writeOff';

export interface CorrectionChoice {
  timing: Timing;
  party: ResponsibleParty;
  stock: StockFate;
  reasonCode: string;
}

/** What the reasons on offer depend on besides timing and party: the line being corrected. */
export interface LineStock {
  /** The product carries the deficit flag (cached). */
  deficit: boolean;
  /** Units the product is short, from live stock; absent means not known, and the flag stands in. */
  shortfall?: number;
  /** Per write-off reason code, whether units may be written off for it; absent means the server decides. */
  writeOffAllowed?: Readonly<Record<string, boolean>>;
}

/** Who can be responsible on this side of shipment: the carrier only once the parcel has left. */
export function partiesFor(timing: Timing): ResponsibleParty[] {
  return timing === 'post' ? ['customer', 'merchant', 'logistics'] : ['customer', 'merchant'];
}

/**
 * Where the units can go. Never written off on the customer's account: a write-off says the goods
 * failed or are not there, which is the merchant's side by definition.
 */
export function stockFatesFor(party: ResponsibleParty): StockFate[] {
  return party === 'customer' ? ['shelf'] : ['shelf', 'writeOff'];
}

/** The reasons that fit this side of shipment and this party, in registry order. */
export function reasonsFor(
  reasons: readonly CorrectionReason[],
  timing: Timing,
  party: ResponsibleParty,
): CorrectionReason[] {
  return reasons.filter((r) => r.cause === party && (r.timing === 'any' || r.timing === timing));
}

/**
 * Can this reason explain a correction of this line before shipment? "Out of stock" only while the
 * product is short; a reason that writes off only where the server's rule for that reason allows it.
 * After shipment every reason that fits the side and party applies.
 */
/** Is the product short? The server's live figure where there is one, else the cached flag. */
export function isShort(line: LineStock): boolean {
  return line.shortfall !== undefined ? line.shortfall > 0 : line.deficit;
}

export function reasonApplies(reason: CorrectionReason, timing: Timing, line: LineStock): boolean {
  if (timing === 'post') return true;
  if (reason.code === 'out_of_stock') return isShort(line);
  if (reason.writeOff) return line.writeOffAllowed?.[reason.code] !== false;

  return true;
}

/**
 * The reason to pre-select, or `''` for none. Only where the circumstance makes one likeliest: a
 * customer who changed their mind, or a line short of stock. Anything else is the operator's to say.
 */
export function defaultReasonFor(
  reasons: readonly CorrectionReason[],
  timing: Timing,
  party: ResponsibleParty,
  line: LineStock,
): string {
  const likeliest =
    party === 'customer'
      ? 'change_mind'
      : party === 'merchant' && isShort(line)
        ? 'out_of_stock'
        : null;
  const candidate = reasonsFor(reasons, timing, party).find((r) => r.code === likeliest);

  return candidate !== undefined && reasonApplies(candidate, timing, line) ? candidate.code : '';
}

/**
 * Where the units go: the reason's answer, if the party allows it. Before shipment this is the
 * answer, not a default — the operator cannot change it.
 */
export function stockFor(
  reasons: readonly CorrectionReason[],
  reasonCode: string,
  party: ResponsibleParty,
): StockFate {
  if (!stockFatesFor(party).includes('writeOff')) return 'shelf';

  return reasons.find((r) => r.code === reasonCode)?.writeOff === true ? 'writeOff' : 'shelf';
}

/**
 * How many of `qty` cancelled units go back on the shelf before shipment. The product's other orders
 * come first: while it is short, a cancellation gives back only what they do not need, or nothing.
 * The server's own rule, on the page's cached figures — so it can trail by one refresh. A product
 * whose figures are not known is assumed to give everything back.
 */
export function shelvedQty(
  line: Pick<DispatchOrderLine, 'stockAtpQty' | 'stockResQty' | 'stockCtdQty' | 'stockDemandQty'>,
  qty: number,
): number {
  const ctd = line.stockCtdQty ?? 0;
  const demand = line.stockDemandQty ?? 0;
  if ((line.stockAtpQty ?? 0) > 0 || (line.stockResQty ?? 0) > 0 || (ctd === 0 && demand === 0))
    return qty;

  return Math.max(0, Math.min(qty, ctd - (demand - qty)));
}

/**
 * The most units "out of stock" can cancel on this line: the product's shortfall. Stock is pooled per
 * product, so cancelling more would put the rest back on sale — units that exist, which "out of stock"
 * cannot explain. Capped this way, the reason never puts anything back. The server's figure on the
 * read, else the cached deficit; the server checks the live one. Neither known → the line's own
 * limit, and the server decides.
 */
export function outOfStockCap(
  line: Pick<DispatchOrderLine, 'shortfallQty' | 'stockDeficitQty'>,
  correctable: number,
): number {
  const shortfall = line.shortfallQty ?? line.stockDeficitQty;
  return shortfall === undefined ? correctable : Math.min(correctable, Math.max(0, shortfall));
}

/** What a pre-shipment correction does to the stock, stated rather than asked — the reason decides it. */
export type StockReadout =
  | { kind: 'writtenOff'; qty: number }
  | { kind: 'backOnSale'; shelved: number; qty: number }
  | { kind: 'nothingBack'; neverInStock: boolean };

export function stockReadout(
  line: Pick<DispatchOrderLine, 'stockAtpQty' | 'stockResQty' | 'stockCtdQty' | 'stockDemandQty'>,
  stock: StockFate,
  reasonCode: string,
  qty: number,
): StockReadout {
  if (stock === 'writeOff') return { kind: 'writtenOff', qty };
  const shelved = shelvedQty(line, qty);
  if (shelved > 0) return { kind: 'backOnSale', shelved, qty };

  return { kind: 'nothingBack', neverInStock: reasonCode === 'out_of_stock' };
}

/**
 * The correction type these answers amount to, among the types this user may create — or `null` when
 * none fits.
 *
 * Before shipment the answer is a table over the built-in types. After shipment it is whichever
 * creatable type moves the stock the way asked: the server decides which of those exist, so this
 * module never needs to know which install offers them.
 */
export function deriveType(
  types: readonly CorrectionType[],
  choice: CorrectionChoice,
): CorrectionType | null {
  const creatable = (code: string): CorrectionType | null =>
    types.find((t) => t.code === code) ?? null;

  if (choice.timing === 'pre') {
    if (choice.stock === 'shelf') {
      return creatable(choice.party === 'customer' ? 'cancel_customer' : 'cancel_merchant');
    }
    if (choice.party === 'customer') return null;

    return creatable(choice.reasonCode === 'defective' ? 'writeoff_defective' : 'writeoff_missing');
  }

  return types.find((t) => !t.preDispatch && t.restock === (choice.stock === 'shelf')) ?? null;
}

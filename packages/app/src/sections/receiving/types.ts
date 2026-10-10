/**
 * Wire types for the receiving surface (`invflux/v1/receiving/*`).
 */

/**
 * What the chosen reason obliges the operator to say about cost — the server's projection of the
 * domain's reason → cost-source table, never a copy of it made here.
 *
 * - `required` — someone paid something and only they know what.
 * - `optional` — the product's standing valuation stands in, but a better figure is welcome.
 * - `none` — zero is the fact (a sample, a donation), not a missing value.
 * - `unsupported` — the figure lives somewhere this build cannot read, so the receipt is refused.
 */
export type ReceiptCostEntry = 'required' | 'optional' | 'none' | 'unsupported';

export interface ReceiptReasonOption {
  value: string;
  label: string;
  /** One line telling the near neighbors apart, and why the cost field behaves as it does. */
  hint: string;
  /** The domain's own vocabulary (`entered` / `derived` / `seed_fallback` / `free`). */
  costSource: string;
  costEntry: ReceiptCostEntry;
}

/**
 * The receiving screen's bootstrap: what may be recorded here, in what currency, by this user.
 *
 * `canStateCost` rides here rather than in the app-wide capability map because it governs one field
 * on one screen, and it mirrors the server's own check — a form that hid a field the API would
 * accept, or offered one it refuses, would be wrong in whichever direction it disagreed.
 */
export interface ReceivingContextResponse {
  reasons: ReceiptReasonOption[];
  /** The store's operating base currency — every cost on this form is denominated in it. */
  baseCurrency: string;
  /** Whether this user may say what the goods cost ({@link ReceiptCostEntry}). */
  canStateCost: boolean;
  /** How many decimals the store shows prices with (WooCommerce's setting). Display only. */
  costDecimals: number;
  /** Active suppliers stock bought without a purchase order can be recorded as coming from. */
  suppliers: SupplierOption[];
}

export interface SupplierOption {
  id: number;
  name: string;
  /** The currency its catalog prices in; null when it has none set (the store's is assumed). */
  currency: string | null;
}

/** A product stock can be received against: governed, and holding stock of its own. */
export interface ReceivableProduct {
  subjectId: number;
  name: string;
  sku: string;
  /** On hand right now — the count this receipt is about to change. */
  onHand: number;
}

export interface ReceivableProductsResponse {
  products: ReceivableProduct[];
  /** Everything the query matches, not a page of it — what lets a picker narrow it without asking. */
  complete: boolean;
}

export interface RecordedReceipt {
  receipt: { id: number; reason: string; receivedAt: string | null; lineCount: number };
}

/** What a session or receipt answers, when it answers a document at all. */
export interface ReceivingSource {
  /** `purchase_order`, or `other` for a document type contributed by an add-on this build cannot name. */
  type: string;
  id: number;
  /** The document's own number. Empty for an unnumbered draft, or an unknown source type. */
  label: string;
  /**
   * The document's own state — a PO stage slug. Null for a source type this build cannot read,
   * where claiming either "finished" or "open" would be an invention.
   */
  stage: string | null;
  /** Whether another delivery can still be counted against it: open for inbound, and not filed away. */
  receivable: boolean;
}

/** A reception being counted right now. Every open session is a row; there is no status column. */
export interface OpenReceivingSession {
  id: number;
  source: ReceivingSource | null;
  /** What a count answering no document carries in place of one. Null on a count against a document. */
  reason: string | null;
  reasonLabel: string | null;
  /** Lines this count has touched so far. */
  lineCount: number;
  /** Lines the document has in total, or null where this build cannot read the source. */
  documentLineCount: number | null;
  participants: unknown[];
  note: string | null;
  startedAt: string | null;
  lastActivityAt: string | null;
}

export interface OpenSessionsResponse {
  sessions: OpenReceivingSession[];
}

/**
 * One receipt in the history.
 *
 * The history is receipts, not sessions: a reception in progress is expected to be discarded, so what
 * persists as "what arrived here" is the receipts and the ledger movements they caused.
 */
export interface ReceiptSummary {
  id: number;
  receivedAt: string | null;
  source: ReceivingSource | null;
  /** Null on a receipt answering a document — the reason is what stands in for one, never both. */
  reason: string | null;
  reasonLabel: string | null;
  lineCount: number;
  qty: number;
  damagedQty: number;
  note: string | null;
}

export interface ReceiptHistoryResponse {
  receipts: ReceiptSummary[];
}

/**
 * A purchase order a delivery can be counted against, as the picker lists it.
 *
 * Carries no money at all — the picker is reached under the inventory capability, and someone
 * choosing which pallet they are holding does not need the order's value to recognize it. What
 * identifies it is the number, the supplier and the date it was expected.
 */
export interface ReceivablePurchaseOrder {
  id: number;
  /** The document number; null while the order is still an unnumbered draft. */
  number: string | null;
  supplierId: number;
  /** The supplier's display name — what a delivery note actually says. Null if unresolved. */
  supplier: string | null;
  /** The lifecycle stage as a slug (`submitted`, `in_transit`, `partially_received`, …). */
  stage: string;
  expectedAt: string | null;
  lineCount: number;
  /** Whether a count is already running against it. Decides whether the action joins or starts. */
  sessionOpen: boolean;
  /** How many people are on that count right now — shown before the click, never after. */
  counters: number;
}

export interface ReceivablePurchaseOrdersResponse {
  purchaseOrders: ReceivablePurchaseOrder[];
}

/** One line to count, as the receiving surface sees it. Product identity and quantities, no cost. */
export interface PoReceptionLine {
  /** The line's name within its order — there is no separate line id. */
  subjectId: number;
  name: string;
  sku: string | null;
  /** The supplier's own code — the one printed on the carton, so the one a receiver matches. */
  supplierSku: string | null;
  gtin: string | null;
  imageUrl: string | null;
  /** Whether the host still has the product. A line whose product was deleted is shown, not hidden. */
  exists: boolean;
  /** Host post id, for the deep-link into the stock workbench. */
  postId: number | null;
  qtyRequested: number;
  qtyExpected: number | null;
  qtyReceived: number;
  qtyDamagedSoFar: number;
  qtyClosedShort: number;
  qtyOpen: number;
  /** What this count has staged but not committed — null while the line is uncounted. */
  staged: { received: number; damaged: number } | null;
}

/** `GET /receiving/purchase-orders/{id}` — what to count, and what has been counted so far. */
export interface PoReceptionResponse {
  purchaseOrder: {
    id: number;
    number: string | null;
    status: number;
    supplier: { id: number; name: string } | null;
    /** Whether the order is in reception right now. */
    receiving: boolean;
    /** Whether a count can start here: in reception already, or waiting for goods. */
    receivable: boolean;
    /** Not yet marked as shipped — the one case the count asks to be unlocked. */
    awaitingDispatch: boolean;
    expectedAt: string | null;
  };
  lines: PoReceptionLine[];
  sessionOpen: boolean;
  note: string;
  participants: { name: string; lastSeen: number }[];
}

/** One staged row of a count that answers no document, with its product named. */
export interface StandaloneLine {
  subjectId: number;
  name: string;
  sku: string;
  onHand: number;
  /** Units that arrived, damaged ones included. */
  received: number;
  /** Of `received`, how many arrived damaged. */
  damaged: number;
  /** Unit cost in the store base currency, resolved (`"9.5000"`); null where nothing gives one. */
  unitCost: string | null;
  /** The cost is inherited — from the catalog, or derived through the rate — not stated here. */
  unitCostInherited: boolean;
  /** Unit price in the supplier's currency, when that differs from the store's; else null. */
  supplierPrice: string | null;
  /** The supplier price is the catalog's, not stated here. */
  supplierPriceInherited: boolean;
}

/**
 * A count answering no document (`GET /receiving/sessions/{id}`). Its reason was chosen when it was
 * opened and does not change — it decides `costEntry`, so the columns of the count follow from it.
 */
export interface StandaloneSessionView {
  id: number;
  reason: string;
  reasonLabel: string;
  reasonHint: string;
  costEntry: ReceiptReasonOption['costEntry'];
  lines: StandaloneLine[];
  /** Who sold it — stock bought without a purchase order may name one. */
  supplier: { id: number; name: string; currency: string | null } | null;
  baseCurrency: string;
  /** The supplier prices in another currency: lines carry both prices, the base one derived. */
  crossCurrency: boolean;
  /** Base units per one supplier-currency unit; null until entered, or when costs are hidden. */
  costFxRate: string | null;
  /** False for someone who may neither see nor state costs: every price is then null. */
  showsCosts: boolean;
  note: string | null;
  participants: Array<{ name: string; lastSeen: number }>;
  startedAt: string | null;
}

export interface StandaloneSessionResponse {
  session: StandaloneSessionView;
}

/** One line of a posted receipt (`GET /receiving/receipts/{id}`). */
export interface ReceiptDetailLine {
  lineId: number;
  subjectId: number;
  name: string;
  sku: string;
  /** Good units, into stock. */
  qty: number;
  /** Damaged units, recorded beside the good ones. */
  damaged: number;
  /** As recorded, in the receipt's line currency. Null without a cost, or for a viewer who may not see costs. */
  unitCost: string | null;
  /** The same in the store base, through the receipt's rate. */
  unitCostBase: string | null;
  /** Good units × base unit cost. */
  valueBase: string | null;
  /**
   * The product's on-hand just before and just after this receipt. Null on a receipt posted before
   * these were recorded — never reconstructed.
   */
  onHandBefore: number | null;
  onHandAfter: number | null;
  /** The product's average cost (store base) before and after this receipt. Null without costs. */
  costBefore: string | null;
  costAfter: string | null;
  /** The line as it stands after every correction; the posted figures when there is none. */
  current: { qty: number; damaged: number; unitCost: string | null };
}

/** One line a correction changed, before → after. Costs null for a viewer who may not see them. */
export interface ReceiptCorrectionLine {
  lineId: number;
  subjectId: number;
  qtyBefore: number;
  qtyAfter: number;
  damagedBefore: number;
  damagedAfter: number;
  unitCostBefore: string | null;
  unitCostAfter: string | null;
  costBefore: string | null;
  costAfter: string | null;
}

/** A correction recorded against a posted receipt. */
export interface ReceiptCorrection {
  id: number;
  correctedAt: string | null;
  correctedBy: string | null;
  note: string | null;
  lines: ReceiptCorrectionLine[];
  /** Value the stock could not absorb, in the store base; null when none or not visible. */
  variance: string | null;
}

/** A posted receipt, read-only. */
export interface ReceiptDetail {
  id: number;
  receivedAt: string | null;
  source: ReceivingSource | null;
  reason: string | null;
  reasonLabel: string | null;
  supplier: { id: number; name: string } | null;
  receivedBy: string | null;
  note: string | null;
  /** False for a viewer who may not see costs: every cost field is then null. */
  showsCosts: boolean;
  baseCurrency: string;
  /** The currency line costs were recorded in — the supplier's, when the receipt carries a rate. */
  lineCurrency: string;
  /** How many decimals the supplier quotes costs with; null when no supplier is known. */
  lineCostDecimals: number | null;
  fxRate: string | null;
  lines: ReceiptDetailLine[];
  /** Corrections recorded since posting, oldest first. */
  corrections: ReceiptCorrection[];
  /** Null when any line carries no cost: a partial total would read as the whole. */
  valueBase: string | null;
}

/** What a correction would do to one product (`POST …/corrections/preview`). */
export interface CorrectionPreviewProduct {
  subjectId: number;
  onHandBefore: number;
  onHandAfter: number;
  /** Units moved: negative takes them out, positive brings them in. */
  delta: number;
  /** Where removed units come from, in the order they are taken. */
  fromAvailable: number;
  fromHeld: number;
  fromCommitted: number;
  costBefore: string | null;
  costAfter: string | null;
  /** Set when the stock cannot absorb the change: the average stays and this is recorded. */
  variance: string | null;
  absorbed: boolean;
}

export interface CorrectionPreview {
  reverses: boolean;
  products: CorrectionPreviewProduct[];
}

/** A refused correction: the code, and for `not_on_hand` the counts. */
export interface CorrectionRefusal {
  error: string;
  code?: string;
  subjectId?: number;
  requested?: number;
  available?: number;
}

export interface ReceiptDetailResponse {
  receipt: ReceiptDetail;
}

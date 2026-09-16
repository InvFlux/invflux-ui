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
  /** One line telling the near neighbours apart, and why the cost field behaves as it does. */
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
}

/** One row of the form. `key` is client-only, so a row keeps its identity while its product changes. */
export interface ReceiveLineDraft {
  key: number;
  product: ReceivableProduct | null;
  /** Total that arrived, damaged included — null while the row is uncounted. */
  qty: number | null;
  /** Of which damaged. Recorded beside the good units, never added to them. */
  damaged: number | null;
  /** As typed. Kept a string so "0" and "" stay distinguishable and nothing is rounded on the way. */
  unitCost: string;
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
 * choosing which pallet they are holding does not need the order's value to recognise it. What
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
  poLineId: number;
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

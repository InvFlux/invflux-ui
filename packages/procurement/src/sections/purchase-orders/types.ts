import type { GridFilterMeta } from '@invflux/ui';

/** Stage-neutral variance classification of a PO line — mirrors core `VarianceStatus`.
 *  Describes both confirmation (ordered vs confirmed) and delivery
 *  (received vs baseline) variance. */
export type VarianceStatus = 'match' | 'open' | 'over' | 'short';

/** A staged receiving-session row (persisted as WIP on the PO while a reception session is open). */
export interface ReceivingSessionRow {
  poLineId: number;
  /** Total units received this session. */
  received: number;
  /** Of which damaged/unfit for sale (good = received − damaged moves to stock). */
  damaged: number;
}

/** A worker currently present in an open receiving session (seen within the presence TTL). */
export interface ReceivingParticipant {
  name: string;
  /** Unix seconds of last heartbeat. */
  lastSeen: number;
}

/** Purchase order DTO — shape returned by `PurchaseOrderController::present()`. */
export interface PurchaseOrder {
  id: number;
  /** The document number — null until it is assigned, just before the order goes to the supplier. */
  number: string | null;
  /** Derived server-side (`number !== null`): gates which send-side action is offered. */
  numbered: boolean;
  supplierId: number;
  supplierName: string | null;
  supplierDisplay: string | null;
  stage: string;
  lineCount: number;
  currency: string;
  /** Store base currency — the receive form shows an FX-rate field only when {@link currency} differs
   *  (the rate is captured per delivery at GR-confirm, not on the PO). */
  baseCurrency: string;
  expectedAt: string | null;
  receivedAt: string | null;
  /** Incoterms 2020 code agreed for this order (e.g. `FCA`); null when none is stated. */
  incoterm: string | null;
  /** The named place the {@link incoterm} applies at — the term is meaningless without it. */
  incotermPlace: string | null;
  /** How the goods travel (carrier or service) — deliberately not the same thing as {@link incoterm}. */
  shippingMethod: string | null;
  /** Per-order terms override; null inherits {@link supplierTerms}, and failing that the store default. */
  termsConditions: string | null;
  /** The supplier's standing terms — what applies when {@link termsConditions} is null. */
  supplierTerms: string | null;
  total: string | null;
  costDecimals: number;
  exceptionFlag: boolean;
  /** Per-PO delivery-discrepancy rollup for the list badge (over/finalized-short line counts,
   *  Ordered lens); null when the PO has no discrepancy or on detail responses. */
  discrepancy: { over: number; short: number } | null;
  createdAt: string | null;
  /** Staged receiving-session WIP — rehydrates the open receive form after a reload; [] when none. */
  receivingSession: ReceivingSessionRow[];
  /** Staged receipt note (free text, e.g. "wrong item", mis-pick) — rehydrates with the session. */
  receivingNote: string;
  /** Workers present in the open session; more than one ⇒ the UI background-polls to stay in sync. */
  receivingParticipants: ReceivingParticipant[];
}

/** `GET /procurement/purchase-orders` response envelope. */
export interface PurchaseOrdersResponse {
  purchaseOrders: PurchaseOrder[];
  /** Server-declared filter metadata (supplier / ETA / …) for the shared FilterBar. */
  filters: GridFilterMeta[];
}

/** A PO line — shape returned by `PurchaseOrderController::presentLine()`. */
export interface PoLine {
  id: number;
  subjectId: number;
  /** WC post id for the product/variation, for the "see in workbench" deep-link (null if unresolved). */
  postId: number | null;
  productLabel: string;
  sku: string | null;
  /** Supplier's own code for this product, scoped to the PO's supplier (null if none recorded). */
  supplierSku: string | null;
  /** Product GTIN/EAN/UPC barcode (WC global_unique_id), null if none. Helps match physical goods at GR. */
  gtin: string | null;
  imageUrl: string | null;
  exists: boolean;
  requestedQty: number;
  /** What the supplier confirmed they'd ship (ASN/email) — the GR-variance baseline; null if unknown. */
  expectedQty: number | null;
  qtyReceived: number;
  /** Cumulative damaged units received on earlier deliveries (rollup of receipt_lines.damaged_qty) —
   *  shown beside received-so-far. Never part of {@link qtyReceived}, which is good (saleable) only. */
  damagedSoFar: number;
  /** Remainder written off by a close-short finalize (recorded, not silently dropped). */
  qtyClosedShort: number;
  qtyOpen: number;
  /** The line's own unit cost; null = inherit the catalogue price ({@link catalogUnitCost}). */
  unitCost: string | null;
  /** Draft-only: the catalogue unit price a null (inherited) cost displays faded + uses for its line
   *  total. Server-provided so the grid needs no separate catalogue lookup; null when uncatalogued. */
  catalogUnitCost: string | null;
  lineTotal: string | null;
  /** Draft-only: signed available (atp − deficit; negative = deficit). null on non-draft / no data. */
  available: number | null;
  /** Draft-only: open qty already inbound on other (submitted+) POs — stock that's coming. */
  onOrder: number | null;
  /** Draft-only: the subject's reorder threshold (null when unset). */
  reorderThreshold: number | null;
  /** Draft-only: MOQ-floored replenishment suggestion the "." key fills into the Qty cell (null when
   *  the subject isn't in the supplier's catalogue / no data). */
  suggestedQty: number | null;
  /** Optional free-text line note → shown on the PO document; surfaced via the opt-in Notes column. */
  note: string | null;
}

/** `GET /procurement/purchase-orders/{id}` response envelope. */
export interface PurchaseOrderDetail {
  purchaseOrder: PurchaseOrder;
  lines: PoLine[];
}

/** One PO activity event — shape returned by `PurchaseOrderController::presentEvent()`. */
export interface PoTimelineEvent {
  id: number;
  /** Raw event_type (e.g. `po.reception_started`, `receipt.logged`, `po.short_closed`). */
  type: string;
  actorId: number | null;
  /** Resolved actor display name (falls back to "User #id" / "System"). */
  actorName: string;
  /** ISO-8601 timestamp (recorded_at), or null. */
  at: string | null;
  /** Human, past-tense summary rendered server-side. For a lifecycle transition this is a `%s`
   *  template — the client splits on `%s` and inserts the {@link stage} status pill. */
  description: string;
  /** Target lifecycle stage slug for a transition event (renders a status pill in place of `%s`); null
   *  for non-transition events (receipt logged, close-short). */
  stage: string | null;
  /** A raw date the client formats into the description's `%s` (e.g. a revised ETA); null when the `%s`
   *  is a status pill or there is no placeholder. */
  date?: string | null;
  /** A literal to emphasise in place of `%s`, rendered verbatim (e.g. an assigned document number —
   *  it means exactly its characters, so it is never formatted). Null when `%s` is something else. */
  emphasis?: string | null;
  note: string | null;
}

/** `GET /procurement/purchase-orders/{id}/events` response envelope. */
export interface PoEventsResponse {
  events: PoTimelineEvent[];
}

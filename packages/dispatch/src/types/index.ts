import type {
  InboundCover,
  StageCode,
  StockConcerns,
  DispatchUser,
  OrderViewer,
} from '@invflux/ui';

export type { StageCode, StockConcerns, DispatchUser, OrderViewer, InboundCover };

// ---------------------------------------------------------------------------
// Backend contract types — mirror. JSON shapes
// are camelCase; IDs are 32-char lowercase hex (UUIDv7); datetimes are ISO
// 8601 with ms precision and Z suffix.
// ---------------------------------------------------------------------------

/**
 * OrderStatus PHP enum case names.
 *
 * - `Untouched` — fresh in the queue, no work done
 * - `Started`   — partial progress OR correction-blocked
 * - `Staged`    — ready to ship
 * - `Shipped`   — terminal positive
 * - `Cancelled` — terminal negative
 */
export type OrderStatus = 'Untouched' | 'Started' | 'Staged' | 'Shipped' | 'Cancelled';

/**
 * The *derived* headline over an order's workflow dimensions — never a stored
 * value; see the `holdReason` / `closedAt` fields below for the dimensions it
 * summarises (precedence Closed › OnHold › Active).
 *
 * Deliberately an **open** string type, not a union. The set of states an
 * install offers is decided server-side — an add-on registers its own, over
 * axes the base install has no column for — and arrives on
 * {@link WorkflowStateContext}. Closing the union here would make this package
 * the arbiter of which states exist, so a state would need an SPA rebuild to
 * appear and, worse, the SPA would be deciding what an install may show.
 *
 * The three the adapter always registers are `Active`, `OnHold` and `Closed`;
 * code may compare against those by name, but must treat any other value as
 * legitimate rather than unknown.
 */
export type OrderWorkflowState = string;

/** HoldReason PHP enum case names — why an order is system-held out of the queue. */
export type HoldReason = 'PaymentPending' | 'CaptureUnresolved' | 'FraudReview' | 'MerchantReview';

/**
 * One row in the dispatch queue. Mirrors the backend `OrderSummary` shape
 * exactly — used both at the queue level (`GET /orders`) and nested inside
 * the detail (`GET /orders/{id}`).
 */
/** A tag attached to an order (the chip shape) — also the tag-definition shape. */
/**
 * GovernanceFlag PHP enum case names — Pro tag behaviours (a shared namespace;
 */
export type GovernanceFlag =
  | 'RequireNoteOnAdd'
  | 'RequireNoteOnRemove'
  | 'SuppressActive'
  | 'PromotedAffordance'
  | 'HidePicker'
  | 'LockRemoval';

/**
 * ManageAuthority PHP enum case names — the access tier deciding who may
 * apply/remove the tag. `Anyone` is the Essentials default; `Managed` gates both
 * directions behind the govern capability; `System` bars all hand apply/remove
 */
export type ManageAuthority = 'Anyone' | 'Managed' | 'System';

export interface TagSummary {
  id: number;
  slug: string;
  name: string;
  /** Index (0..23) into the fixed Gmail-modeled palette (`@invflux/ui` TAG_PALETTE). */
  colorId: number;
  /**
   * Pro governance behaviours this tag carries (empty for a plain Essentials tag).
   * `SuppressActive` drops the order out of the active queue; `RequireNoteOnAdd`
   * demands a note on assign; `PromotedAffordance` earns a dedicated toggle;
   * `HidePicker` keeps it out of the generic tag menu; `LockRemoval` needs the
   * govern capability to take off.
   */
  governanceFlags: GovernanceFlag[];
  /** Signed queue sort-weight: + promotes (Urgent floats up), − demotes, 0 neutral. */
  priority: number;
  /** Access tier — who may apply/remove. Defaults to `Anyone` for a plain tag. */
  manageAuthority: ManageAuthority;
  /**
   * Archived: kept for the orders already carrying it, but out of the pickers and no longer acting
   * on the queue (neither suppressing nor sorting). Chips render it drained and hatched — see `tagArchivedFill` / `tagHatch`.
   */
  archived?: boolean;
  /** Orders carrying this tag — present on the tag-definition list (GET /tags), not on order chips. */
  orderCount?: number;
}

/**
 * An archived tag as it travels on the tag *list* — identity only.
 *
 * Deliberately not a {@link TagSummary}: the list carries these so the manager can answer "is this
 * name taken?" and "is this nearly one you already have?" as the merchant types, and neither
 * question needs a colour, a flag or a count. The full records arrive when the archived section is
 * actually opened.
 */
export interface ArchivedTagName {
  id: number;
  name: string;
  slug: string;
}

export interface TagListResult {
  tags: TagSummary[];
  archivedNames: ArchivedTagName[];
}

/** One note as the queue carries it — enough to read it, not enough to edit it. */
export interface OrderNotePreview {
  threadId: string;
  body: string | null;
  authorName: string | null;
  occurredAt: string | null;
}

/**
 * One of the two addresses a host order carries.
 *
 * `company` is not decoration: a parcel addressed to a person at a building that does not know
 * them is a parcel that comes back, and on a B2B order the company line is the entity being
 * invoiced.
 */
export interface OrderAddress {
  /**
   * The recipient, which is not always the customer: a gift, a workplace delivery, or a B2B order
   * billed to head office and shipped to a branch each name someone else.
   */
  firstName: string | null;
  lastName: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  company: string | null;
}

export interface DispatchOrderSummary {
  id: string; // 32-char lowercase hex (UUIDv7)
  externalId: string;
  sourceSystem: string;
  status: OrderStatus;
  /** Derived headline over the raw workflow dimensions below. */
  workflowState: OrderWorkflowState;
  /** Why the order is system-held, or null when not held. */
  holdReason?: HoldReason | null;
  /** Terminal timestamp (order left the queue, ISO 8601 Z), or null while open. */
  closedAt?: string | null;
  stockState: StockConcerns;
  /** True when the order has ≥1 line whose subject isn't InvFlux-governed — drives the queue's
   *  amber ⚠ rollup so a mixed-governance order is flagged before it's opened. */
  hasUnmanagedLine?: boolean;
  /**
   * The distinct shipping classes across the order's lines, `none` first when any line carries
   * none — a set, because an order is not obliged to be uniform.
   *
   * `['none', 'fragile']` and `['fragile']` describe different orders: the first has lines that are
   * not fragile, the second does not. Rendering the first as `fragile` would tell a packer
   * something false about the rest of the parcel.
   *
   * Display only. The filter keys on the lines server-side, so never match against this list.
   */
  shippingClasses?: string[];
  /**
   * How the order ships: the first shipping package's method id (`flat_rate:3`, the configured
   * instance included) and what the customer was shown. Null when the order carries no shipping.
   * WooCommerce ships an order as one package per shipping item, so `shippingCount` says whether
   * the first is the whole story.
   */
  shippingMethod?: string | null;
  shippingMethodTitle?: string | null;
  shippingCount?: number;
  /** Every distinct method id across the order's packages — what filtering and counting key on. */
  shippingMethods?: string[];
  lineCount: number;
  stagedCount: number;
  shippedCount: number;
  /**
   * Lines with nothing left to do — fully corrected, or fully shipped. They are not work, so the
   * progress readout leaves them out of both numbers (`remainingProgress()`); `stagedCount` still
   * counts them, because readiness asks whether all *remaining* work is staged.
   */
  settledCount?: number;
  /** The order's lines' `stockShortQty`, summed: positive means the order cannot ship as it stands. */
  stockShortQty?: number;
  /** When the order last shipped (its latest shipment); null while nothing has gone out. */
  shippedAt?: string | null;
  unprocessedCorrections: number;
  /** Unsettled manual refunds (non-refundable gateway) awaiting operator settlement. */
  pendingManualRefunds: number;
  /**
   * Live notes written on this order — **all of them**, not the length of `recentNotes`.
   *
   * That distinction is the whole point of sending it: knowing the total before any fetch is what
   * lets the preview say how many are still coming. Rendering the eager ones and going quiet is
   * indistinguishable from "that is all there is".
   *
   * Counts only threads carrying text; a tag change is an annotation too, but an order whose only
   * annotation is a tag change has already said so with its chips.
   */
  noteCount: number;
  /**
   * The newest few notes, carried with the row — present only where notes exist, which is what
   * makes it affordable: sparse, not N × every row. A typical annotated order opens its preview
   * with no fetch at all; anything beyond these is the lazy tail.
   */
  recentNotes?: OrderNotePreview[];
  /**
   * Expected dispatch time (EDT). The merchant-side accountability date the
   * order is measured against. "Late" is derived from this client-side
   * (`estDispatch < now`) — there is no separate lateDays field. Null when no
   * baseline / override has been written (legacy rows, manual unset).
   */
  estDispatch: string | null;
  customerId: number | null;
  customerName: string;
  customerEmail: string;
  shippingAddressHash: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Canonical (unprefixed) WC order status joined in at read time from
   * `wp_wc_orders` (HPOS) or `wp_posts.post_status` (CPT). Null for
   * orphan projections whose WC counterpart was hard-deleted.
   */
  wcStatus: string | null;
  /**
   * WC payment-method id (`bacs`, `stripe`, `cod`, …). Stable
   * machine slug — useful for tooltips, `data-` attributes, and a
   * future gateway-icon lookup.
   */
  paymentMethod: string | null;
  /**
   * Merchant-configured display title at the time of payment
   * (e.g. "Bank Transfer", "PayPal"). Falls back to
   * `paymentMethod` server-side when empty so the queue column
   * always renders something readable.
   */
  paymentMethodTitle: string | null;
  /**
   * Gateway-issued transaction id. Populated by OrderDetail
   * reads only — `null` on queue rows. The Payment card's
   * expanded view surfaces it as the audit anchor.
   */
  transactionId: string | null;
  /**
   * Billing-side phone number captured at checkout. Populated by
   * OrderDetail reads only; `null` on queue rows.
   */
  billingPhone: string | null;
  /**
   * Where the parcel goes. The host's **live** address, not the snapshot the order interned when
   * it arrived — an address corrected in WooCommerce afterwards moves this and not the snapshot.
   * Populated by OrderDetail reads only; `null` on queue rows. Field names mirror the WC
   * address-table shape minus the `address_` prefix (`line1` / `line2`).
   */
  shippingAddress: OrderAddress | null;
  /**
   * Who the order is billed to — same shape, same read path, same liveness as
   * {@link shippingAddress}. On most orders it is identical to it, and the screen says so rather
   * than printing the same lines twice.
   */
  billingAddress: OrderAddress | null;
  /**
   * Whether the order's WC payment gateway reports
   * `supports('refunds')` — populated by the OrderDetail read path
   * only (null on queue rows). Drives the
   * `<ProcessCorrectionsModal>` choice between the
   * "Refund via gateway" checkbox (capable) and the "Confirm
   * refunded" attestation (not capable). See
   * §3.1.
   */
  paymentSupportsRefunds: boolean | null;
  /**
   * WC order shipping total (decimal string, e.g. `"8.90"`).
   * Null on queue rows. Modal shows an optional shipping-refund
   * row when this is non-zero and `shippingAlreadyRefunded` is false.
   */
  shippingTotal: string | null;
  /**
   * Whether the full shipping total has already been refunded via WC.
   * Null on queue rows. When true the shipping row is hidden.
   */
  shippingAlreadyRefunded: boolean | null;
  /**
   * WC order grand total (decimal string). Null on queue rows.
   * Used for the modal's "Remaining Revenue" strip.
   */
  orderTotal: string | null;
  /** ISO 4217 code the order is denominated in. Null when the host order is unavailable. */
  currency: string | null;
  /**
   * Sum of all WC refunds already applied (decimal string). Null on
   * queue rows. Used for adjustment bounds and "Remaining Revenue".
   */
  pastRefundsTotal: string | null;
  /**
   * URL of the WC native order edit page. Null on queue rows.
   * Rendered as a link in the modal header.
   */
  wcOrderEditUrl: string | null;
  /** Tags attached to this order. Present on both queue rows and detail reads. */
  tags?: TagSummary[];
}

/**
 * Request body for `POST /orders/{id}/corrections/process`.
 *
 * Batch model: all pending corrections are
 * processed together. The refund amount per correction comes from the
 * server-stored `refund_amount` (set at creation); the operator may
 * add a signed `adjustment` decimal to account for rounding, shipping
 * overages, or other edge cases.
 */
export interface RefundAdjustmentInput {
  /** Operator's reason for the adjustment (free text). */
  description: string;
  /** Signed decimal-as-string, e.g. `"-3.50"` (reduce) or `"5.00"` (increase). */
  amount: string;
}

export interface ProcessCorrectionsPayload {
  /** Include the order's shipping total in the WC refund. */
  refundShipping: boolean;
  /**
   * Signed manual adjustment lines (§9.3) applied on top of corrections +
   * shipping. The server sums them to a net; bounds keep the batch total in
   * `[0, order_total − past_refunds]`. Empty when no adjustment is needed.
   */
  adjustments: RefundAdjustmentInput[];
  /**
   * `true` when the operator has explicitly confirmed that the refund
   * will be handled outside WooCommerce. Required when
   * `paymentSupportsRefunds` is false.
   */
  manualConfirmed: boolean;
}

/**
 * Payload of a `correction.refund_confirmed` timeline event (batch model).
 * Mirrors the PHP `ProcessOrderCorrections::emitRefundConfirmedEvent()`
 * payload. Read by the modal's "previously corrected" fold (§9.5).
 */
export interface CorrectionRefundConfirmedPayload {
  refund_mode: 'auto' | 'manual_confirmed';
  refund_total: string;
  wc_refund_id: number | null;
  shipping_included: boolean;
  /** Net manual adjustment (signed decimal); null if zero. */
  adjustment: string | null;
  line_items: Array<{
    type: string;
    sku: string | null;
    qty: number;
    unit_price: string;
    total: string;
    /** Operator reason on `Manual refund adjustment` rows; null on correction rows. */
    description: string | null;
  }>;
  correction_ids: string[];
  actor_user_id: number;
  /** Resolved operator display name at emit time (§C3); falls back to id when absent. */
  actor_user_name?: string;
}

/** `GET /invflux/v1/dispatch/orders` response shape. */
export interface DispatchQueueResponse {
  orders: DispatchOrderSummary[];
  total: number;
  page: number;
  perPage: number;
  /**
   * The **database's** clock when this page was read, which a polling client sends back as
   * `updatedSince`. Never the browser's: `updated_at` is written by `CURRENT_TIMESTAMP(6)`, so a
   * client resuming from its own clock would silently skip whatever was written inside the drift.
   */
  serverTime: string;
}

/** Queue filter / URL state. Encoded into URL query params on every change.
 *
 * Multi-value filters use sorted arrays so the TanStack Query cache key is
 * stable across reorderings (`['A','B']` and `['B','A']` are the same query).
 * The api layer serializes them comma-separated for the URL contract.
 *
 * Distinction between `undefined` and `[]`:
 * - `undefined` → param omitted → backend applies its default
 *   (`workflowState` defaults to `[Active]`; the others to "show all")
 * - `[]` → empty filter → backend treats as no-filter (overrides default)
 */
export interface DispatchQueueFilters {
  status?: OrderStatus[];
  workflowState?: OrderWorkflowState[];
  /** Unprefixed WC status slugs (e.g. `processing`, `on-hold`). */
  wcStatus?: string[];
  /** Worksheet ids (as decimal strings) — OR-matches across the line subjects. */
  worksheetIds?: string[];
  /** SKU codes — OR-matches via `invflux_subject_identifiers` so renames stay searchable. */
  skus?: string[];
  /** InvFlux subject ids (as decimal strings) — OR-matches order lines by the domain key. Set by the
   *  workbench "Orders" link (a leaf's own id; a variable parent's whole variation set). */
  subjectIds?: string[];
  /** Payment-gateway ids — OR-matches against the order's WC payment method. */
  paymentMethods?: string[];
  /**
   * Shipping-class slugs, OR-matched against the order's lines. `'none'` is a real member meaning
   * *a line with no class* — it is how an operator asks "what still needs classifying".
   */
  shippingClasses?: string[];
  /**
   * Shipping-method ids (`flat_rate:3`), OR-matched against every shipping package on the order —
   * keyed on the id, never the title, which the merchant can rename and two services can share.
   */
  shippingMethods?: string[];
  /** Order-tag ids (as decimal strings). Match mode set by `tagMatch`. */
  tagIds?: string[];
  /** Tag match mode: `any` (OR, default) or `all` (AND — order carries every selected tag). */
  tagMatch?: 'any' | 'all';
  /**
   * Order-tag ids the order must **not** carry — the exclude set, independent of {@link tagIds}.
   *
   * Always AND-NOT, in both match modes, because that is the only coherent reading and the one
   * the query is spoken in: *"anything Express or B2B, but never Escalated."* {@link tagMatch}
   * governs the include set alone; letting it also mean something here would make one control
   * answer two questions.
   *
   * A separate list rather than a third `tagMatch` value: a match *mode* applies to the whole
   * selection, so it can express "carries none of these" but never "carries X and not Y" — and
   * the second is the one an operator asks, because tag vocabularies split into attributes
   * (Express, B2B, VIP) and problem markers (Escalated, Awaiting customer, Chargeback).
   */
  tagIdsNot?: string[];
  /**
   * Whether the order carries any tag at all — `['yes']`, `['no']`, or absent for "don't care".
   *
   * A presence dimension rather than a boolean, so it faceted counts like any other: the operator
   * sees how many orders are marked *and* how many are not before choosing. Distinct from
   * {@link tagIdsNot}, which is about a *specific* tag — "unmarked" and "not this one" are
   * different questions.
   */
  hasTags?: string[];
  /** Whether the order carries any note. Same shape and reasoning as {@link hasTags}. */
  hasNotes?: string[];
  /**
   * Kinds of *waiting work* to restrict the queue to (`manual_refund`, `corrections`, …). The
   * values union: an order matches when it is waiting on any of them, because an order can be
   * waiting on several at once. Which names exist is an install-level question — see
   * {@link PendingActionContext}.
   */
  pendingActions?: string[];
  search?: string;
  page?: number;
  perPage?: number;
  updatedSince?: string;
  /**
   * Replication scope: `working` for every un-closed order — the set the SPA holds and filters
   * locally. Deliberately not a filter: filters say what is on screen and change constantly, the
   * scope says what this client holds and changes almost never.
   */
  scope?: 'working' | 'all';
}

// ---------------------------------------------------------------------------
// Order detail (`GET /orders/{id}`)
// ---------------------------------------------------------------------------

/**
 * A product link surfaced on an order line, built platform-side (the adapter)
 * so the SPA stays platform-agnostic. `kind` is a generic hint the UI maps to an
 * icon — a WooCommerce adapter emits `catalog-edit`/`storefront`/`ledger`/
 * `workbench`; another platform's adapter can emit its own.
 */
export interface ProductLink {
  label: string;
  url: string;
  kind: string;
}

export interface DispatchOrderLine {
  id: string; // 32-char lowercase hex (UUIDv7)
  externalLineRef: string;
  subjectId: number;
  name: string;
  sku: string;
  gtin: string | null;
  /**
   * How this line has to travel — the host's shipping class. `null` when the line carries none,
   * which on an order where other lines do is a fact rather than a gap.
   */
  shippingClass?: string | null;
  imageUrl: string | null;
  /**
   * Unit price snapshot taken at order time, in the order's currency, as a decimal string (e.g.
   * `"12.50"`) — the price **before** discount. What a unit was paid at is `lineRefund.netUnitPrice`.
   */
  unitPrice: string;
  /**
   * The discount off the whole line, decimal string; `"0.00"` when none. Whole-line because that is
   * how the host applies one. Absent from a read that does not select it.
   */
  lineDiscount?: string;
  qtyOrdered: number;
  qtyCorrected: number;
  qtyShipped: number;
  stagedQty: number;
  stagedBy: number | null;
  stagedAt: string | null;
  stagedSource: 'scanner' | 'click' | 'resend' | 'system' | null;
  stockState: StockConcerns;
  /** True when this line's subject isn't InvFlux-governed (WooCommerce/another plugin manages its
   *  stock) — renders the amber ⚠ "unmanaged" marker, distinct from a red deficit. */
  unmanaged?: boolean;
  /** The shortfall's size, so the inbound figure beside it has a scale. Absent without a deficit. */
  stockDeficitQty?: number;
  /**
   * The deficit's operands, cached with it: committed demand across every open paid order, and the
   * stock set aside for them. Store-wide — a fully corrected line still carries its product's
   * figures. `0` in both means not known, and no equation is shown.
   */
  stockDemandQty?: number;
  stockCtdQty?: number;
  /**
   * Units this line cannot get from committed stock once units staged for other orders are set
   * aside — the stage-2 case: positive means it cannot ship as it stands, and staging it is refused.
   * `0` with a deficit means only the store is short. Against the cached balance, so it can trail the
   * server's guard by one refresh.
   */
  stockShortQty?: number;
  /** The product's live stock for sale, and reserved. Absent from a line read that does not load them. */
  stockAtpQty?: number | null;
  stockResQty?: number | null;
  /**
   * Per write-off reason code, whether this line's units may be written off before shipment for it.
   * Absent or null where not known; the server decides at creation and at processing either way.
   */
  writeOffAllowed?: Record<string, boolean> | null;
  /** Committed units the shelf should still hold for other orders. */
  shelfForOthersQty?: number | null;
  /**
   * Units the product is short — what "out of stock" may cancel. None while anything is for sale or
   * reserved. Absent or null where not known; the server checks it live either way.
   */
  shortfallQty?: number | null;
  /**
   * Who staged the line, by name — the last-packing snapshot, kept after shipping, so it answers
   * "who packed it". Null when nobody has, or the user no longer exists.
   */
  stagedByName?: string | null;
  /** What is on the way for a line that is short — quantity always, the per-PO breakdown only when
   *  the add-on that computes it is present and licensed. Absent on lines with no deficit. */
  inbound?: InboundCover;
  poId: number | null;
  /** Platform-agnostic product links (editor, storefront, ledger, workbench). */
  links: ProductLink[];
}

export interface DispatchOrderDetail {
  order: DispatchOrderSummary;
  lines: DispatchOrderLine[];
  viewers: OrderViewer[];
  /**
   * How many events the order's timeline holds — a count, not the events.
   *
   * The timeline is fetched only when its section is opened, so its heading had nothing to state
   * until then and a shut section could not say whether it was worth opening. **Order events only:**
   * the rendered timeline also interleaves note threads, which the client already holds and adds
   * itself, rather than the server answering for a merge it does not perform.
   */
  eventCount: number;
  /**
   * The order names a WooCommerce order that no longer exists (deleted outright): what only
   * WooCommerce could answer — the order's total, a refund record on it — cannot be had.
   */
  hostOrderMissing?: boolean;
  /**
   * The order's payment records and what it still owes, in the order's currency. `null` when the
   * host order could not be read for its total.
   */
  payments: DispatchOrderPayments | null;
}

/** One payment received against the order, voided ones included. Amounts are decimal strings. */
export interface DispatchOrderPayment {
  id: string;
  /** What arrived, in `currency`. */
  amount: string;
  currency: string;
  /** Units of the order's currency per unit of `currency`; `null` when the two match. */
  fxRate: string | null;
  /** `amount` in the order's currency. */
  amountOrderCcy: string;
  /** The gateway's id, or `other`. */
  method: string;
  /** Where the record came from: `gateway`, `manual`, `host_status`, or an add-on's own code. */
  source: string;
  /** The gateway's transaction id, or the transfer / cheque reference. */
  reference: string | null;
  receivedAt: string | null;
  /** Accepted as settled beyond what arrived, in the order's currency: positive when less arrived. */
  difference: string | null;
  /** `bank_fee` | `rounding` | `fx` | `other` when there is a difference. */
  differenceReason: string | null;
  recordedByName: string | null;
  recordedAt: string | null;
  voidedAt: string | null;
  voidedByName: string | null;
  voidReason: string | null;
}

/** An order's payments, and what they leave owing. Amounts are decimal strings in the order's currency. */
export interface DispatchOrderPayments {
  items: DispatchOrderPayment[];
  /** The money received, voided payments left out. */
  paid: string;
  /** The order total less what the payments settle; never negative. */
  outstanding: string;
  /** The largest difference a payment for `outstanding` may carry; `"0.00"` when it must be exact. */
  tolerance: string;
}

// ---------------------------------------------------------------------------
// Corrections (`GET / POST /orders/{id}/corrections`, `DELETE /corrections/{id}`)
// ---------------------------------------------------------------------------

/**
 * The four `typeCode` values the Essentials POST endpoint accepts (§4.0). LPSC
 * codes (`cancel_system` / `shortfall_*`) are seeded server-side but only
 * created internally — not part of this set.
 */
export type EssentialsCorrectionTypeCode =
  'cancel_customer' | 'cancel_merchant' | 'writeoff_defective' | 'writeoff_missing';

export interface DispatchCorrection {
  id: string; // 32-char lowercase hex
  lineId: string;
  typeCode: string; // includes LPSC codes when reading
  typeName: string;
  reasonCode: string | null;
  qty: number;
  refundAmount: string; // decimal string
  note: string | null;
  createdBy: number;
  createdAt: string | null;
  processedAt: string | null;
  correlationId: string | null;
}

/**
 * One creatable correction-type, as published by the GET corrections
 * endpoint. Drives the modal's type-flag cascade (D2 in
 * ) — `preDispatch / restock / refund` are
 * rendered declaratively rather than branched per `code`.
 */
export interface CorrectionType {
  code: EssentialsCorrectionTypeCode;
  name: string;
  /** Stock moves out of `oh.ctd` rather than `oh.atp` (post-shipment returns are `false`). */
  preDispatch: boolean;
  /** Stock returns to a saleable slot (vs. write-off / destroy). */
  restock: boolean;
  /** A refund is owed by default. */
  refund: boolean;
  /** The reason the modal pre-selects — a default the operator can change; null when the type has none. */
  defaultReason?: string | null;
}

/**
 * Why a correction happened. The `cause` is whose fault it was — the only place fault is recorded,
 * since one type can be either party's doing — and it decides whether a correction that completes
 * the order refunds the order's charges (`merchant` and `logistics` count as merchant-side).
 */
export interface CorrectionReason {
  code: string;
  name: string;
  cause: 'customer' | 'merchant' | 'logistics';
  /** When the reason can apply relative to shipment. */
  timing: 'pre' | 'post' | 'any';
  /** Before shipment, its units are written off rather than put back on the shelf — the reason decides. */
  writeOff: boolean;
}

export interface DispatchCorrectionsResponse {
  corrections: DispatchCorrection[];
  /**
   * The creatable correction-type set for *this user at this order*. At
   * Essentials this is always the 4-element Essentials set; at Pro it grows with the
   * post-shipment return codes. Drives the modal's cascade.
   */
  types: CorrectionType[];
  /** Every reason a correction can record, for the modal's picker. */
  reasons?: CorrectionReason[];
}

/**
 * Request body for `POST /orders/{id}/corrections`. No refund amount: the server derives it from the
 * line — the price paid for those units — and never takes one from the client.
 */
export interface CreateCorrectionRequest {
  lineId: string;
  typeCode: EssentialsCorrectionTypeCode;
  qty: number;
  note?: string | null;
  /** The reason code; omitted or null takes the type's default reason. */
  reasonCode?: string | null;
}

/** Response body for `POST /orders/{id}/corrections`. */
export interface CreateCorrectionResponse {
  correction: DispatchCorrection;
  order: {
    id: string;
    status: OrderStatus;
    lineCount: number;
    stagedCount: number;
    shippedCount: number;
    unprocessedCorrections: number;
    updatedAt: string | null;
  };
}

// ---------------------------------------------------------------------------
// SPA bootstrap contract — what the WP entrypoint passes via window
// ---------------------------------------------------------------------------

export interface DispatchCapabilities {
  viewOrders: boolean;
  dispatchOrders: boolean;
  /**
   * Raising a correction against an order, and withdrawing an unprocessed one
   * (`invflux_create_corrections`). Floor staff hold this.
   */
  createCorrections: boolean;
  /**
   * Resolving corrections and the order money actions that go with them
   * (`invflux_process_corrections`): processing a batch issues the WC refund, and
   * settle-manual-refund moves money directly. Customer service — deliberately
   * withheld from floor staff. A UX convenience only; the server gates the same
   * routes on the same capability.
   */
  processCorrections: boolean;
  /**
   * Recording that an order was paid — "Record payment" (`invflux_record_payments`).
   * A UX convenience only; the server gates the capture-payment route on it.
   */
  recordPayments: boolean;
  /**
   * Authority over restricted governance tags (`invflux_govern_tags`). Gates
   * applying a `Managed` tag and removing a `Managed` / `LockRemoval` tag. A UX
   * convenience only — the server enforces the same rules regardless.
   */
  governTags: boolean;
  /**
   * May correct an order's stated address (`invflux_edit_order_address` **and** WooCommerce's own
   * `edit_shop_order`).
   *
   * Reports the conjunction rather than either half: the write lands in WooCommerce's document, so
   * holding only InvFlux's capability would open a form whose save the API refuses. A UX
   * convenience — the server enforces both regardless.
   */
  editOrderAddress: boolean;
}

export interface DispatchEntitlements {
  /** True when the active license allows `dispatch:full` (partial ship + Pro dispatch actions). */
  dispatchFull: boolean;
  /**
   * True when the active license allows `dispatch.governance-tags` — unlocks the
   * tag manager's governance controls (flags / priority / access). Essentials shows them
   * locked behind a Pro upsell.
   */
  governanceTags: boolean;
}

export interface DispatchSettings {
  /** Store-level default for the Pro-tier auto-validation checkbox. */
  autoValidationDefault: boolean;
}

/**
 * Metadata for the "native status" surface — the filter + column that
 * mirror the upstream order-management system's status taxonomy.
 *
 * Adapter-provided so the dispatch SPA stays decoupled from any specific
 * source system: the WC adapter sends `"WC Order Status"` + WC's own
 * status registry; a future Shopify adapter would send `"Shopify Status"`
 * + Shopify's set; etc.
 */
export interface NativeStatusContext {
  /** Label shown above the multi-select filter. */
  filterLabel: string;
  /** Column header on the queue table. */
  columnLabel: string;
  /**
   * The full list of status values the source system recognises, in
   * display order. Values are the unprefixed slugs sent on the URL
   * (`processing`, `on-hold`, …); labels are merchant-facing.
   */
  options: {
    value: string;
    label: string;
    /**
     * The merchant's chosen pill colour for this status, or `null`/absent where they have chosen
     * none — in which case the SPA falls back to its own shipped default and then to grey.
     *
     * Null is not "the default's index": only a null follows a later change to the shipped
     * defaults, which is why the server passes it through instead of resolving it.
     */
    colorId?: number | null;
  }[];
  /**
   * Values applied when the URL doesn't carry a `wc_status` param.
   * Mirrors the `workflow_state` filter's "absent applies default"
   * rule. The user can still override by explicitly clearing the
   * Combobox (which sends `?wc_status=` — empty, no filter).
   */
  defaultSelected: string[];
}

/**
 * The `workflow_state` filter's option list, as the install declares it.
 *
 * Sibling of {@link NativeStatusContext}, but varying on a different axis: the
 * native-status set varies by *source system*, this one by *which plugins are
 * installed*. Both exist so the SPA renders a list it was handed instead of one
 * it holds an opinion about.
 *
 * The SPA must not add to, subtract from, or reorder `options` — an option is
 * present exactly when some plugin registered the state behind it, so filtering
 * this list client-side would hide a state the backend will still answer for
 * (and would put the SPA in the business of deciding who may see what).
 */
export interface WorkflowStateContext {
  /** Label shown above the multi-select filter. */
  filterLabel: string;
  /**
   * Every state this install offers, in presentation order. `value` is the
   * token sent on the URL (`workflow_state=Active`); `label` is translated
   * merchant-facing text.
   *
   * `includesSuppressed` marks a state whose rows are ones a queue-suppressing
   * governance tag took out of circulation. It exists so selecting such a tag
   * as a filter doesn't come back empty against a workflow filter that excludes
   * exactly those orders — see `OrderList`. Absent on installs with no add-on
   * contributing such a state.
   */
  options: { value: string; label: string; includesSuppressed?: boolean }[];
  /**
   * Applied when the URL carries no `workflow_state` param — the same default
   * the queue endpoint applies, so the chip shows the cut actually rendered.
   * Clearing every value sends the explicit no-filter sentinel instead.
   */
  defaultSelected: string[];
}

export interface DispatchContext {
  /** WP REST API root, e.g. "https://example.com/wp-json". */
  apiRoot: string;
  /** WP nonce for authenticating REST requests. */
  nonce: string;
  currentUser: DispatchUser;
  capabilities: DispatchCapabilities;
  entitlements: DispatchEntitlements;
  settings: DispatchSettings;
  nativeStatus: NativeStatusContext;
  workflowState: WorkflowStateContext;
  pendingAction: PendingActionContext;
  paymentMethods: PaymentMethodsContext;
}

/**
 * The `pending_action` filter's option list, as the install declares it.
 *
 * Sibling of {@link WorkflowStateContext} and varying on the same axis — which plugins are
 * installed — because a workflow brings its own queue: an add-on that introduces goods receipt
 * introduces "receipts to book" along with it. The SPA renders what it is handed.
 *
 * There is no `defaultSelected`: the queue's default cut is a workflow-state floor, and defaulting
 * to "orders needing work" would hide the rest behind a filter nobody chose.
 */
/**
 * Filter-facet counts for one dimension (`GET /orders/facets`).
 *
 * Keyed by the option value as it travels on the URL. **Sparse by design for column-backed
 * dimensions** — the client holds the option list and reads an absent key as zero — while
 * predicate-backed ones (workflow state, pending action) answer for every registered value,
 * zeros included, since only the server knows that set.
 */
export interface DispatchFacetsResponse {
  dimension: string;
  counts: Record<string, number>;
}

export interface PendingActionContext {
  /** Label shown above the multi-select filter. */
  filterLabel: string;
  /**
   * Every kind of waiting work this install can filter to, in presentation order. `value` is the
   * token sent on the URL (`pending_action=manual_refund`); `label` is translated merchant-facing
   * text.
   */
  options: { value: string; label: string }[];
}

/**
 * Payment-gateway filter options, source-system-neutral like
 * {@link NativeStatusContext}. The adapter sends WC's registered gateways
 * (id → title); the SPA renders a gateway filter without baking WC slugs in.
 */
export interface PaymentMethodsContext {
  /**
   * Gateways that cannot refund through the API — the ones whose money an operator moves by hand.
   *
   * The `payment_entry` pending action is "somebody still has to record this payment", which is a
   * question about the gateway as much as the status. The client holds the working set and
   * evaluates that locally, so it is told rather than left to guess.
   */
  manualIds?: string[];
  /** Label shown above the multi-select filter. */
  filterLabel: string;
  /** Gateway options — `value` is the gateway id stored on the order, `label` its title. */
  options: {
    value: string;
    label: string;
    /**
     * The merchant's chosen pill colour for this status, or `null`/absent where they have chosen
     * none — in which case the SPA falls back to its own shipped default and then to grey.
     *
     * Null is not "the default's index": only a null follows a later change to the shipped
     * defaults, which is why the server passes it through instead of resolving it.
     */
    colorId?: number | null;
  }[];
}

// ---------------------------------------------------------------------------
// Slot context props
//
// The dispatch shell renders contributions registered via
// `window.invflux.dispatch.registerSlot(<key>, { id, component, order?,
// enabled? })`. Each slot key below documents the context the shell
// hands to the contribution's component.
// ---------------------------------------------------------------------------

/**
 * Context for `dispatch.toolbar` — header area of the queue page,
 * rendered after the core navigation chips. Add-ons can inject
 * actions (bulk-export, custom filters) — they always run, the
 * registration is gated by their own `enabled?` predicate.
 */
export interface DispatchToolbarSlotProps {
  // Reserved — no per-row selection in the queue yet. Kept as an
  // empty-shape contract so future fields land without rippling
  // through every contribution.
  _reserved?: never;
}

/**
 * Context for `order.detail.toolbar` — header chrome of the order
 * detail page, rendered next to the Prev/Next nav arrows. Pro
 * contributions (Park / Assign / Tag-edit) target this slot.
 */
export interface OrderDetailToolbarSlotProps {
  orderHexId: string;
  order: DispatchOrderSummary;
}

/**
 * Context for `order.detail.panel` — additional panels rendered below
 * the corrections panel and above the ShipBar. Core panels (lines,
 * corrections, ShipBar) stay rendered directly by the shell; this
 * slot is for add-on injection (customer history, supplier comms,
 * batch panel, …).
 */
export interface OrderDetailPanelSlotProps {
  orderHexId: string;
  order: DispatchOrderSummary;
  lines: DispatchOrderLine[];
}

/**
 * Context for `order.detail.action` — the ShipBar's right side.
 * Pro can inject Park / Force-partial / Reverse-shipment buttons
 * alongside the core Ship button.
 */
export interface OrderDetailActionSlotProps {
  orderHexId: string;
  order: DispatchOrderSummary;
}

/**
 * Shared context for every `order.detail.card.<id>.detail` slot —
 * the order summary the bar is rendering. Per-card payloads are
 * always the same: contributions decide which card they target by
 * registering against the matching slot key (`order.detail.card.
 * customer.detail`, `order.detail.card.addresses.detail`, etc.).
 */
export interface OrderDetailCardSlotProps {
  orderHexId: string;
  order: DispatchOrderSummary;
}

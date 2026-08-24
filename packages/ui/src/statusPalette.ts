/**
 * Default palette entries for every status vocabulary InvFlux renders as a pill.
 *
 * One file for four vocabularies that had four uncoordinated colour maps, none aware of the others
 * — and two of which (the host's order status and InvFlux's dispatch status) render **side by side**
 * in the dispatch queue, where two independently-chosen blues meant two different things a metre
 * apart. Whatever the colours are, they have to be chosen together.
 *
 * They are `colorId`s into `TAG_PALETTE`, not Tailwind classes, for the reason that runs through the
 * whole design surface: every entry is an AA-verified `(background, foreground)` pair, so a status
 * cannot be given an unreadable colour, and a dark-mode variant is given to the pairs **once**
 * rather than needing 28 `dark:` overrides. The hand-written classes these replace were four short
 * of that floor — `bg-slate-100 text-slate-500` and `bg-gray-100 text-gray-500` measure 4.35 and
 * 4.39 against a 4.50 floor, and they were on exactly the "done / inactive" states a merchant reads
 * least carefully.
 */

/**
 * WooCommerce order statuses, drawn to agree with **WooCommerce's own admin**.
 *
 * A merchant reads these colours in WC's order list every day, so a deliberate default here means
 * matching the model they already have before it means being pretty. Taken from the shipped
 * `woocommerce/assets/css/admin.css`, nearest palette entry each:
 *
 *   processing  #c6e1c6 pale green      → Light green
 *   completed   #c8d7e1 pale blue-grey  → Light blue
 *   on-hold     #f8dda7 pale amber      → Light orange
 *
 * Two of those invert what InvFlux used to draw — it had processing blue and completed green, which
 * contradicted the host on the same screen.
 *
 * **`failed` is the one deliberate divergence: grey, not WooCommerce's `#eba3a3` red.** Red on a
 * queue means "this needs you", and a failed order does not: the payment was declined, the customer
 * holds the retry link, and the merchant has nothing to do. Colouring it red spends the operator's
 * attention on a row they cannot act on — the most expensive thing a scan-first surface can do.
 *
 * That is the rule underneath "agree with the host", stated properly: **colour encodes what the
 * merchant must do.** Matching WooCommerce is the default because the host's colours usually track
 * that already; where they do not, actionability wins. A darker grey than `cancelled`'s so the two
 * non-actionable outcomes stay tellable apart.
 *
 * `pending`, `cancelled` and `refunded` carry **no** rule of their own in WooCommerce; they fall
 * through to its neutral `#e5e5e5`. Copying that faithfully would render three different outcomes
 * identically, so they keep distinct entries here. Agreeing with the host is the default, not an
 * instruction to reproduce a shortcoming.
 */
export const WC_ORDER_STATUS_COLOR: Readonly<Record<string, number>> = {
  pending: 15, // Cream — waiting, warm, distinct from on-hold's stronger amber
  'on-hold': 13, // Light orange
  processing: 16, // Light green
  completed: 1, // Light blue
  cancelled: 0, // Light grey — WooCommerce's own neutral
  refunded: 3, // Light purple
  failed: 6, // Grey — see the divergence note above; deliberately NOT WooCommerce's red
};

/**
 * The fallback for a status InvFlux has never heard of — a subscription, a booking, a POS status.
 *
 * It is grey, and that is the open defect this file does not close: a merchant running three custom
 * statuses sees three identical grey pills in a scan-first queue. The fix is a merchant-set
 * `color_id` on the order-status policy row, which is what makes a status nobody hard-coded legible
 * at all; until then, do not paper over it by deriving a colour from the status string, which would
 * produce stable nonsense and make the gap harder to see.
 */
export const WC_ORDER_STATUS_FALLBACK_COLOR = 0;

/** InvFlux dispatch status. Staged is the actionable one, so it takes the palette's ready-green. */
export const DISPATCH_STATUS_COLOR: Readonly<Record<string, number>> = {
  Untouched: 0, // Light grey — nothing has happened yet
  Started: 1, // Light blue — in flight
  Staged: 16, // Light green — ready to ship, the queue's actionable state
  Shipped: 2, // Light teal — done and cool, adjacent to Started without reading as it
  Cancelled: 5, // Light coral
};

/** Dispatch stage codes, as drawn on an order line. */
export const STAGE_COLOR: Readonly<Record<string, number>> = {
  '': 0, // Pending — Light grey
  M: 16, // In box — Light green
  W: 13, // Put aside — Light orange
  E: 5, // Error — Light coral
};

/**
 * Supplier status and purchase-order lifecycle. One map because one component draws both, and they
 * do appear together on a supplier's PO list.
 *
 * `received` and `partially_received` are deliberately the same hue at different saturations: a
 * partial receipt is the same event, incomplete, and reading it as a *duller* green says that
 * better than an unrelated colour would.
 */
export const PROCUREMENT_STATUS_COLOR: Readonly<Record<string, number>> = {
  // supplier status
  active: 16, // Light green
  inactive: 0, // Light grey
  // PO lifecycle stage
  in_prep: 15, // Draft — Cream
  submitted: 1, // Light blue
  in_transit: 2, // Light teal
  in_reception: 3, // Light purple
  partially_received: 17, // Sage — received, duller
  received: 16, // Light green
  cancelled: 5, // Light coral
  archived: 21, // Dusty rose — put away, muted, but distinct from `inactive`
};

/** Neutral entry for any status not named above. */
export const STATUS_FALLBACK_COLOR = 0;

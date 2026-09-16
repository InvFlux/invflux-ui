import { hasCapability } from '../../capabilities';
import { surfaceEnabled } from '../../surfaces';

/**
 * Whether this viewer can be sent into Procurement at all — the capability that mounts the surface,
 * and the install's own choice to have it.
 *
 * Receiving deliberately runs under the inventory capability alone, so a dock worker reaches these
 * screens without any access to purchasing. Every link *out* of them has to ask first, and both
 * halves matter: a surface can be turned off install-wide as well as unheld. Where it answers false
 * the name is still shown, as plain text — it is what is being counted, and a link that refuses is
 * worse than a word.
 */
export function procurementReachable(): boolean {
  return hasCapability('managePurchaseOrders') && surfaceEnabled('procurement');
}

/** Where a purchase order lives in Procurement, or null when this viewer cannot open it. */
export function purchaseOrderHref(id: number): string | null {
  return procurementReachable() ? `/procurement/purchase-orders/${id}` : null;
}

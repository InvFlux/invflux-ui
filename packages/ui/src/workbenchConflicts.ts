import { __, _n, sprintf } from '@invflux/i18n';
import type { WorkbenchApplyConflict } from './workbenchGridTypes';

/**
 * Turning the server's refusal codes into something an operator can act on.
 *
 * A save that partly fails answers with a `reason` per refused edit, and they are not all the same
 * kind of no. Only `stale_original` means "someone else changed this, look again and retry" — the
 * rest are *refusals*, which retrying reproduces exactly. Describing them all as staleness sends the
 * operator round a loop with no exit and hides the one action that would clear it, which is how a
 * blocked cost edit reads as a bug rather than as a currency that needs converting.
 *
 * Lives outside the grid component so it can be tested directly: this is the layer where a wrong
 * string is invisible in review and expensive in the field.
 */

/**
 * One refused edit in the operator's terms, or `null` when this build does not recognise the code —
 * the only case that earns the generic "review and retry" count.
 *
 * Each message ends on what to do next, because a refusal the operator cannot act on is
 * indistinguishable from a bug. Where the answer lives on another screen it is *named* rather than
 * linked: this grid is embedded in several hosts and has no router of its own, and the admin notice
 * carrying the real links is on every admin page anyway.
 *
 * @param reason the server's refusal code
 * @param column the column's display label, already resolved
 */
export function explainConflict(reason: string, column: string): string | null {
  switch (reason) {
    case 'base_currency_drift':
      return sprintf(
        /* translators: %s = column label, e.g. "Unit cost (WAC)" */
        __('%s: cost changes are paused while your store currency and your stored costs disagree. Convert your stored costs (InvFlux → Base currency), or set the store currency back.'),
        column,
      );
    case 'cost_locked':
      return sprintf(
        /* translators: %s = column label */
        __('%s: this product already has a weighted average cost, which only a goods receipt can move. The starting cost can no longer be edited.'),
        column,
      );
    case 'negative_stock':
      return sprintf(__('%s: that change would take stock below zero.'), column);
    case 'stale_original':
      return sprintf(__('%s: changed on the server since you loaded it — review the new value and retry.'), column);
    case 'stock_management_locked':
      return sprintf(__('%s: this product is busy in a stock workflow and cannot be un-governed yet.'), column);
    case 'forbidden':
      return sprintf(__('%s: you do not have permission to change this.'), column);
    case 'subject_not_resolvable':
    case 'product_not_found':
      return sprintf(__('%s: this product no longer exists in WooCommerce.'), column);
    case 'term_write_failed':
      return sprintf(__('%s: WooCommerce refused the change.'), column);
    case 'invalid_value':
    case 'invalid_cost':
    case 'invalid_threshold':
    case 'invalid_terms':
    case 'invalid_stock_management':
      return sprintf(__('%s: invalid value.'), column);
    default:
      return null;
  }
}

/**
 * Codes whose `actual` carries a server-authored explanation: WooCommerce's own write error, and the
 * name of the workflow currently holding a product's stock. Both say it better than a fixed string
 * could, so they are surfaced verbatim under the column label — falling back to {@see explainConflict}
 * when the server sent nothing usable.
 */
const CARRIES_SERVER_MESSAGE = ['write_rejected', 'stock_management_locked'];

/**
 * A precise, human summary of a save's conflicts.
 *
 * @param conflicts the refused edits, as returned by the apply endpoint
 * @param labelOf   resolves a column id to its display label
 */
export function describeConflicts(
  conflicts: WorkbenchApplyConflict[],
  labelOf: (columnId: string) => string,
): string {
  const parts: string[] = [];
  let generic = 0;

  for (const c of conflicts) {
    const column = labelOf(c.column_id);

    if (CARRIES_SERVER_MESSAGE.includes(c.reason) && 'string' === typeof c.actual && '' !== c.actual.trim()) {
      parts.push(`${column}: ${c.actual.trim()}`);
      continue;
    }

    const explained = explainConflict(c.reason, column);
    if (null !== explained) parts.push(explained);
    else generic += 1;
  }

  if (generic > 0) {
    parts.push(
      sprintf(
        /* translators: %d = number of edits that couldn't be saved for an unrecognised reason. */
        _n(
          "%d change couldn't be saved — the value changed on the server; review and retry.",
          "%d changes couldn't be saved — the values changed on the server; review and retry.",
          generic,
        ),
        generic,
      ),
    );
  }

  return parts.length > 0 ? parts.join(' ') : __("Some changes couldn't be saved — review and retry.");
}

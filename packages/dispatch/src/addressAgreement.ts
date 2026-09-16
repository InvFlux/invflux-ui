import type { OrderAddress } from './types';

/**
 * Whether an order's two stated addresses say the same thing.
 *
 * **This question is answered twice, and the two answers must agree.** The card asks it to decide
 * what to render and what to offer; `CorrectOrderAddress::addressesAgree()` asks it again, from
 * WooCommerce's live order, before honouring a mirrored correction. The server's answer is the one
 * that binds — it is reading the current document, where the card is reading a page that may be
 * minutes old — so a client that answered more loosely would offer a mirror the server always
 * declines, and one that answered more strictly would hide an affordance that would have worked.
 *
 * Kept in its own module because the components that use it pull the Solid + Kobalte graph, which
 * does not load under the node test environment.
 */

/**
 * The fields that decide it: exactly the ones rendered, and exactly the ones correctable.
 *
 * Those two sets coinciding is what makes the comparison honest. The question being answered is
 * "would printing the second block tell me anything the first did not", so a field not shown cannot
 * change the answer — and a field not correctable could make two addresses disagree in a way no
 * operator could ever resolve.
 *
 * Deliberately excludes the contact block. WooCommerce holds an email on the billing address alone
 * and the two phone numbers are routinely a switchboard and a mobile; letting either decide would
 * answer "different" for the ordinary order that states one address.
 */
export const ADDRESS_FIELDS: (keyof OrderAddress)[] = [
  'firstName',
  'lastName',
  'line1',
  'line2',
  'city',
  'state',
  'postcode',
  'country',
  'company',
];

/**
 * Whether the host has anything to show for this address.
 *
 * The read returns a struct of nulls rather than `null` whenever the detail query selected the
 * columns, so "the object exists" does not mean "an address was captured" — a virtual or
 * collect-in-store order has every field empty. Without this the card would answer "No street
 * address", which sounds like one line is missing rather than all of them.
 */
export function hasAddress(a: OrderAddress | null): boolean {
  return a !== null && ADDRESS_FIELDS.some((f) => (a[f] ?? '').trim() !== '');
}

/**
 * Blank and absent are the same thing here. A checkout that stored `""` for a line the customer
 * left empty must not read as a different address from one that stored nothing.
 *
 * Two empty addresses do not agree: a virtual order captures neither, and treating that as a match
 * would offer to mirror a correction across two blocks that state nothing.
 *
 * Deliberately **not** a comparison of the two `*_party_id` hashes. Those never coincide even for
 * one postal address — a billing party states the order's email and a shipping one states no email
 * at all — so a hash comparison would answer "different" for every order there is.
 */
export function sameAddress(a: OrderAddress | null, b: OrderAddress | null): boolean {
  if (!hasAddress(a) || !hasAddress(b)) return false;

  return ADDRESS_FIELDS.every((f) => (a![f] ?? '').trim() === (b![f] ?? '').trim());
}

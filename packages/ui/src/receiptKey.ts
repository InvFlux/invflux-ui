/**
 * A client-minted token identifying **one operator intent to submit a goods receipt**.
 *
 * The server keys its idempotency claim on this, and the choice of what it identifies is the whole
 * design. It is deliberately *not* derived from the payload: two genuinely separate partial
 * deliveries against one purchase order can be byte-identical — same lines, same quantities, same
 * note, same rate — and multi-delivery receiving is base-tier behaviour, so collapsing the second
 * into a replay of the first would lose stock that physically arrived. That failure is worse than
 * the double-count it would be preventing, and far quieter.
 *
 * So the token is minted per confirm action and **held across retries of that same action**: a
 * timeout the operator responds to by clicking again reuses it and replays, while starting a fresh
 * receipt mints a new one and records a real second delivery.
 */

/**
 * A UUID for one submission. Prefers `crypto.randomUUID()`; the fallback exists because an insecure
 * origin (plain http on a dev or intranet host) leaves `crypto` without it. That fallback is
 * `Math.random`-based and so is *not* collision-safe the way a real UUIDv4 is — acceptable here
 * because the value only has to be unique among one operator's own recent submissions, never
 * globally.
 *
 * A near-identical helper lives in `@invflux/ui`'s WorkbenchGrid for subscription ids; extracting
 * one shared version is owed, and was skipped here only to avoid editing a heavily co-edited file
 * for a fix that is about stock correctness.
 */
export function mintReceiptKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* insecure origin / unavailable — fall through */
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

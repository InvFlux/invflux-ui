import { createSignal, type Accessor } from 'solid-js';
import { __, sprintf } from '@invflux/i18n';
import { ApiError } from './api/errors';
import { toast } from './toast';

/**
 * What an async filter tells the operator when its search fails, as pure functions.
 *
 * Separate from the control that calls them so they can be tested: importing the control pulls in
 * the whole Solid + Kobalte component graph, which does not load under this package's node test
 * environment — which is why every test here is a `.ts` one. Message choice is the part with rules
 * worth pinning (never quote a status that does not exist; an expired session gets its own remedy),
 * so it lives where those rules can be asserted.
 */

/**
 * Why a search failed, reduced to what the operator can be told.
 *
 * `status` is the HTTP status when the server answered, `0` when the request never produced a
 * response, and `null` when the rejection was not an {@link ApiError} at all — `loadOptions` is
 * supplied by the consumer, so it may reject with anything.
 */
export interface SearchFailure {
  status: number | null;
  authExpired: boolean;
}

export function classifyFailure(error: unknown): SearchFailure {
  return error instanceof ApiError
    ? { status: error.status, authExpired: error.isAuthExpired }
    : { status: null, authExpired: false };
}

/**
 * The line shown where the options would be.
 *
 * Carries the status because it outlives the toast: the toast is gone in seconds, while this stays
 * for as long as the dropdown is open — so it is what the operator can still read back when they
 * come to report the problem.
 */
export function failureLine(failure: SearchFailure): string {
  if (failure.authExpired) return __('Session expired');
  // Same shape as the HTTP case — the parenthetical is the cause either way, so the two read as one
  // family rather than as two unrelated messages.
  if (failure.status === 0) return __('Search failed (network error)');
  if (failure.status === null) return __('Search failed');

  return sprintf(
    /* translators: %d: HTTP status code returned by the failed search request */
    __('Search failed (HTTP %d)'),
    failure.status,
  );
}

/** The one-off toast. Says what to *do*, where the line above only says what happened. */
export function failureToast(failure: SearchFailure): string {
  // An aged-out nonce is the one failure with a specific remedy, and the admin shell is designed to
  // stay mounted for days — so a long-lived tab reaches this in normal use. A generic "try again"
  // would send the operator retyping a search that cannot succeed until the page is reloaded.
  if (failure.authExpired) return __('Your session has expired. Reload the page and try again.');
  // Never "HTTP 0". `ApiError` uses status 0 for "the request never produced a response" — offline,
  // DNS, a tab torn down mid-flight — so there is no status to quote, and quoting one would blame a
  // server that may be perfectly healthy. It is a network error, and says so.
  if (failure.status === 0)
    return __('The search could not be completed (network error). Please try again.');
  if (failure.status === null) return __('The search could not be completed. Please try again.');

  return sprintf(
    /* translators: %d: HTTP status code returned by the failed search request */
    __('The search could not be completed (HTTP %d). Please try again.'),
    failure.status,
  );
}

/** What a search-driven control needs to report its own failures. */
export interface SearchFailureTracker {
  /** The current failure, or `null` when the last search worked (or none has run). */
  failure: Accessor<SearchFailure | null>;
  /**
   * The line to render **in place of the options**, or `null` when nothing failed — in which case
   * the caller's own empty-state wording stands.
   */
  line: Accessor<string | null>;
  /** Record a rejection: sets the line, and toasts once per run of failures. */
  record: (error: unknown) => void;
  /** A search succeeded, or none is in play any more: clear the line and re-arm the toast. */
  clear: () => void;
}

/**
 * Track a search control's failures so it stops reporting them as "no results".
 *
 * Shared because three controls each owned a copy of this and all three got it wrong in the same
 * way — a rejection fell through to an empty option list, and the operator read "No matches". That
 * is not silence, it is the opposite answer: on a broken endpoint it teaches them that a SKU they
 * are holding does not exist.
 *
 * The toast fires **once per run of failures**, not once per rejection. A search runs on every
 * keystroke, so an endpoint that is down would otherwise stack one toast per character typed; the
 * latch re-arms on the next success, so a later outage is announced again rather than swallowed.
 */
export function createSearchFailure(): SearchFailureTracker {
  const [failure, setFailure] = createSignal<SearchFailure | null>(null);
  let toasted = false;

  return {
    failure,
    line: (): string | null => {
      const current = failure();

      return null === current ? null : failureLine(current);
    },
    record: (error: unknown): void => {
      const classified = classifyFailure(error);
      setFailure(classified);
      if (toasted) return;
      toasted = true;
      // Toasted as well as shown in the list: after an empty dropdown the operator's next move is
      // to close it and filter another way, which carries the failure out of sight and leaves them
      // acting on a result that was never returned.
      toast.error(failureToast(classified));
    },
    clear: (): void => {
      setFailure(null);
      toasted = false;
    },
  };
}

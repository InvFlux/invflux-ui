import { __, _n, sprintf } from '@invflux/i18n';
import { ApiError } from '@invflux/ui/api';

/**
 * The body of a refused terms request, whatever it carried — `{}` for anything else.
 *
 * The terms routes answer a refusal as `{ error, reason, … }`: a sentence for the merchant, a slug to
 * branch on, and whatever the refusal needs to say (the numbering breaks, where a set is chosen).
 */
export function refusalBody(e: unknown): Record<string, unknown> {
  return e instanceof ApiError && 'object' === typeof e.body && null !== e.body
    ? (e.body as Record<string, unknown>)
    : {};
}

/** The server's sentence for a refusal, else `fallback`. */
export function refusalMessage(e: unknown, fallback: string): string {
  const error = refusalBody(e).error;

  return 'string' === typeof error && '' !== error ? error : fallback;
}

/** How many suppliers a refusal names before counting the rest: it says where to look, not who all. */
const NAMED_SUPPLIERS = 3;

/**
 * For a set that could not be removed because it is still in use: a sentence saying for whom — the
 * suppliers by name, and the store as its default — so the merchant knows what to change first. Null
 * for any other refusal.
 */
export function stillChosenMessage(e: unknown): string | null {
  const body = refusalBody(e);
  if (
    'still_selected' !== body.reason ||
    'object' !== typeof body.selectedBy ||
    null === body.selectedBy
  ) {
    return null;
  }
  const where = body.selectedBy as { suppliers?: unknown; store?: unknown };
  const names = Array.isArray(where.suppliers)
    ? where.suppliers
        .map((s) => String((s as { name?: unknown }).name ?? ''))
        .filter((n) => '' !== n)
    : [];

  const suppliers = names.slice(0, NAMED_SUPPLIERS);
  const more = names.length - NAMED_SUPPLIERS;
  if (more > 0) {
    /* translators: %d: number of further suppliers, beyond the ones named */
    suppliers.push(sprintf(_n('%d more supplier', '%d more suppliers', more), more));
  }
  const store = true === where.store;

  if (0 === suppliers.length) {
    return store
      ? __('These are the store’s default terms. Choose other default terms in the settings first.')
      : null;
  }

  return store
    ? sprintf(
        /* translators: %s: the suppliers the terms are set for, e.g. "Corvara, Halcyone" */
        __(
          'These are the store’s default terms, and still set for %s. Choose other terms there first.',
        ),
        suppliers.join(', '),
      )
    : sprintf(
        /* translators: %s: the suppliers the terms are set for, e.g. "Corvara, Halcyone" */
        __('These terms are still set for %s. Choose other terms there first.'),
        suppliers.join(', '),
      );
}

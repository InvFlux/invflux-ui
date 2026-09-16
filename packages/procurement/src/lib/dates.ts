/**
 * Date-only helpers. The PO ETA (`expected_at`) is a **calendar day**, sent over the wire as
 * `YYYY-MM-DD` (no time, no tz). `@invflux/i18n`'s `parseDateOnly` reads it as a *local* calendar
 * date, so it renders as the same day for every reader; this module adds what procurement needs
 * on top of it.
 */
import { parseDateOnly } from '@invflux/i18n';

const MS_PER_DAY = 86_400_000;

/** Whole days from local *today* to a date-only value (signed; negative = in the past); null if absent. */
export function daysUntilDate(value: string | null | undefined): number | null {
  const d = parseDateOnly(value);
  if (null === d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / MS_PER_DAY);
}

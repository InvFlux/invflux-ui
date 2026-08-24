/**
 * Date-only helpers. The PO ETA (`expected_at`) is a **calendar day**, sent over the wire as
 * `YYYY-MM-DD` (no time, no tz). Parsing that through `new Date('2026-10-01')` treats it as UTC
 * midnight, which shifts a day for viewers in a negative-UTC offset — so date-only values must be
 * parsed as a *local* calendar date instead. These helpers do that (and tolerate a full ISO string
 * by taking its date part, so a not-yet-migrated datetime value still reads correctly).
 */

const MS_PER_DAY = 86_400_000;

/** Parse a `YYYY-MM-DD` (or the date part of any ISO string) as a LOCAL calendar date; null if unparseable. */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (null === m) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Locale date string for a date-only value; `fallback` (default "—") when absent/unparseable. */
export function fmtDateOnly(value: string | null | undefined, fallback = '—', opts?: Intl.DateTimeFormatOptions): string {
  const d = parseDateOnly(value);
  return null === d ? fallback : d.toLocaleDateString(undefined, opts);
}

/** Whole days from local *today* to a date-only value (signed; negative = in the past); null if absent. */
export function daysUntilDate(value: string | null | undefined): number | null {
  const d = parseDateOnly(value);
  if (null === d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / MS_PER_DAY);
}

/**
 * Parsing for the `date` datatype's tolerant value shapes. The canonical wire forms are a
 * `YYYY-MM-DD` day or an ISO/MySQL datetime, but the datatype also serves values surfaced from
 * data we don't control (e.g. other plugins' post meta), where epoch timestamps are common — so
 * the parser accepts all of them and reports whether a time-of-day is actually present.
 *
 * Date-only values parse as a LOCAL calendar date — `new Date('2026-10-01')` would read it as UTC
 * midnight and shift a day for viewers in a negative-UTC offset. A datetime whose time is exactly
 * midnight is treated as date-only (the usual "day stored in a datetime column" case).
 */

import { formatDate, formatTime } from '@invflux/i18n';

/** Parsed date plus whether the source value carried a (non-midnight) time-of-day. */
export interface ParsedDateValue {
  date: Date;
  hasTime: boolean;
}

export function parseDateValue(value: unknown): ParsedDateValue | null {
  // Epoch seconds (9-11 digits ≈ 1973…5138) or milliseconds (12-13 digits), number or digit string.
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{9,13}$/.test(value.trim()))) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = String(Math.trunc(n)).length >= 12 ? n : n * 1000;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return null;
    return { date, hasTime: !isLocalMidnight(date) };
  }
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (s === '') return null;

  // `YYYY-MM-DD`, optionally followed by ` HH:MM[:SS]` / `THH:MM[:SS]` (MySQL / ISO, read as local).
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m !== null) {
    const [, y, mo, d, h, mi, se] = m;
    const date = new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h ?? 0),
      Number(mi ?? 0),
      Number(se ?? 0),
    );
    if (Number.isNaN(date.getTime())) return null;
    return {
      date,
      hasTime: h !== undefined && !(h === '00' && mi === '00' && (se ?? '00') === '00'),
    };
  }

  // Last resort: whatever the runtime can read (e.g. RFC 2822 strings).
  const date = new Date(s);
  if (Number.isNaN(date.getTime())) return null;
  return { date, hasTime: !isLocalMidnight(date) };
}

function isLocalMidnight(d: Date): boolean {
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
}

/** Locale display string: date, plus a short time when the value carries one. */
export function formatDateValue(parsed: ParsedDateValue): string {
  return parsed.hasTime
    ? `${formatDate(parsed.date)} ${formatTime(parsed.date, '', { hour: '2-digit', minute: '2-digit' })}`
    : formatDate(parsed.date);
}

/** Canonical clipboard/export string: `YYYY-MM-DD`, plus ` HH:MM` when a time is present. */
export function isoDateValue(parsed: ParsedDateValue): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const d = parsed.date;
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return parsed.hasTime ? `${day} ${p(d.getHours())}:${p(d.getMinutes())}` : day;
}

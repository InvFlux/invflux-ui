import { formatNumber } from '@invflux/i18n';

/**
 * Money on the dispatch surfaces, in integer minor units (cents) — the unit the server's own sums use.
 *
 * An amount is read into cents from its text, never through a float, so a payment can never be a
 * binary fraction off. A float appears only where a rate multiplies an amount, and there the rounding
 * is the server's own, so what the form previews is what gets recorded.
 */

/**
 * Cents from a decimal amount — as typed (`95.5`, `95,50`) or as the server sends it (`-0.30`);
 * `null` when the text is not one. At most two decimals.
 */
export function toCents(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const m = /^\s*(-)?(\d+)(?:[.,](\d{1,2}))?\s*$/.exec(value);
  if (m === null) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return m[1] ? -cents : cents;
}

/** Cents as the decimal text the server reads: `9550` → `"95.50"`. */
export function centsToDecimal(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * A positive exchange rate as typed (`1.2`, `0,93512345`), returned as the decimal text the server
 * reads; `null` when it is not one. At most eight decimals.
 */
export function parseRate(value: string): string | null {
  const m = /^\s*(\d+)(?:[.,](\d{1,8}))?\s*$/.exec(value);
  if (m === null) return null;
  const text = m[2] ? `${m[1]}.${m[2]}` : (m[1] ?? '');
  return Number(text) > 0 ? text : null;
}

/** `cents` converted at `rate`, rounded as the server rounds a payment's converted amount. */
export function convertCents(cents: number, rate: string): number {
  return Math.round(cents * Number(rate));
}

/** An amount for display — the host's locale, and the currency's own symbol and decimals. */
export function formatMoney(cents: number, currency: string | null | undefined): string {
  const value = cents / 100;
  return currency && /^[A-Z]{3}$/.test(currency)
    ? formatNumber(value, { style: 'currency', currency })
    : formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

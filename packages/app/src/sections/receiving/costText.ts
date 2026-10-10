import { getLocale } from '@invflux/i18n';
import { createSignal } from 'solid-js';

/**
 * A cost someone **stated** — a unit cost, a supplier's price — at the currency's own precision, but
 * never rounded away: a figure carried more precisely (costs are kept to four places) shows its extra
 * digits rather than a rounding of itself.
 */
export function costText(value: string | number, storeDecimals: number): string {
  const n = Number(value);
  const stated = Number(n.toFixed(4)).toString().split('.')[1]?.length ?? 0;
  return n.toFixed(Math.max(storeDecimals, Math.min(stated, 4)));
}

/**
 * A cost the system **worked out** — an average, a value, a conversion into the store's currency, a
 * variance. Rounded to the currency's precision by default, because its extra digits are arithmetic
 * rather than anything anyone said; shown as stored when the reader asks for full precision.
 */
export function derivedCostText(value: string | number, decimals: number, full: boolean): string {
  if (full) return costText(value, decimals);
  // Never fewer than three significant digits: 0.00345 rounded to two places would read as nothing.
  const n = Math.abs(Number(value));
  const significant = n > 0 && n < 1 ? Math.min(-Math.floor(Math.log10(n)) + 2, 8) : 0;
  return Number(value).toFixed(Math.max(decimals, significant));
}

/**
 * How many decimals a currency is written with (JPY 0, EUR 2, KWD 3), from the platform's currency
 * data. `fallback` answers for a code the platform does not know, and is what the store's own
 * currency should pass: the shop's price setting, which the merchant chose, outranks the standard.
 */
export function currencyDecimals(code: string, fallback: number): number {
  try {
    return (
      new Intl.NumberFormat(getLocale(), { style: 'currency', currency: code }).resolvedOptions()
        .maximumFractionDigits ?? fallback
    );
  } catch {
    return fallback;
  }
}

const FULL_PRECISION_KEY = 'invflux.receiving.fullPrecisionCosts';
const readFull = (): boolean => {
  try {
    return 'true' === localStorage.getItem(FULL_PRECISION_KEY);
  } catch {
    return false;
  }
};
const [fullPrecision, setFullPrecisionSignal] = createSignal(readFull());

/** Whether this reader sees worked-out costs as stored rather than rounded. A per-browser choice. */
export { fullPrecision };

export function setFullPrecision(on: boolean): void {
  setFullPrecisionSignal(on);
  try {
    localStorage.setItem(FULL_PRECISION_KEY, on ? 'true' : 'false');
  } catch {
    // Not remembered across visits; the choice still holds for this one.
  }
}

import { _x, sprintf } from '@invflux/i18n';

/** Decimal places of a per-unit price (`DECIMAL(10,4)` on the server). */
const PRICE_SCALE = 4;
/** Decimal places of a discount (`DECIMAL(5,2)` on the server). */
const PCT_SCALE = 2;
/** A discount at or above the whole price gives the goods away; the server refuses it too. */
const WHOLE = 100 * 10 ** PCT_SCALE;

/** A non-negative decimal as integer units of `10^-scale`, half-up past the scale; null if not one. */
function scaled(value: string | number, scale: number): number | null {
  const m = /^(\d*)(?:\.(\d*))?$/.exec(String(value).trim());
  if (null === m || '' === (m[1] ?? '') + (m[2] ?? '')) return null;
  const fraction = m[2] ?? '';
  let units = Number((m[1] || '0') + fraction.slice(0, scale).padEnd(scale, '0'));
  if (fraction.length > scale && Number(fraction[scale]) >= 5) units += 1;
  return units;
}

/**
 * The net unit price a supplier discount leaves — the client's mirror of core `LinePrice::netOf()`,
 * for figures shown before the server answers.
 *
 * Integer arithmetic, rounded half-up per unit to the decimals the supplier prices in (at most
 * four), so the figure previewed is the figure saved. Null when either input is not a number in range.
 */
export function netOfDiscount(
  price: string | number,
  discountPct: string | number,
  decimals: number,
): string | null {
  const priceUnits = scaled(price, PRICE_SCALE);
  const pctUnits = scaled(discountPct, PCT_SCALE);
  if (null === priceUnits || null === pctUnits || pctUnits >= WHOLE) return null;

  const step = 10 ** (PRICE_SCALE - Math.max(0, Math.min(PRICE_SCALE, Math.trunc(decimals))));
  const units =
    Math.floor((priceUnits * (WHOLE - pctUnits) + (WHOLE * step) / 2) / (WHOLE * step)) * step;
  const divisor = 10 ** PRICE_SCALE;
  return `${Math.floor(units / divisor)}.${String(units % divisor).padStart(PRICE_SCALE, '0')}`;
}

/**
 * A stored price as the supplier would write it, for a cell to edit: `10.5000` at 2 decimals is
 * `10.50`. Digits past the supplier's precision stay only when they are not zeros, so a price that
 * really carries them (`10.1850` → `10.185`) is never rounded by opening its cell.
 */
export function atSupplierPrecision(price: string | null, decimals: number): string | null {
  if (null === price || '' === price || Number.isNaN(Number(price))) return price;
  const value = Number(price);
  const quoted = value.toFixed(Math.max(0, Math.min(PRICE_SCALE, Math.trunc(decimals))));

  return Number(quoted) === Number(value.toFixed(PRICE_SCALE))
    ? quoted
    : String(Number(value.toFixed(PRICE_SCALE)));
}

/** A discount as a reader writes it — `10%`, `12.5%` — or empty when there is none. */
export function formatDiscount(discountPct: string | null): string {
  if (null === discountPct || '' === discountPct) return '';
  /* translators: %s is a discount percentage as a number, e.g. "10" or "12.5". */
  return sprintf(
    _x('%s%%', 'purchase order line: a discount percentage'),
    String(Number(discountPct)),
  );
}

import { formatMoney } from '@invflux/i18n';

/**
 * An order's total as the list shows it: the shared money format (the currency code placed by the
 * host's locale) at the supplier's own cost decimals, the precision the detail page's total uses.
 *
 * The stored value carries four decimals whatever the supplier's precision, so printing it raw
 * puts `2004.0000` (and `435000.0000` yen, which has no minor unit) in front of the buyer. A total
 * that cannot be read as a number is shown as it came rather than as `NaN` or nothing, since
 * hiding a figure is worse than showing an odd one.
 */
export function formatPoTotal(total: string | null, currency: string, decimals: number): string {
  if (null === total) return '—';
  const amount = Number(total);
  if (!Number.isFinite(amount)) return `${currency} ${total}`;

  return formatMoney(amount, currency, decimals);
}

import { __, sprintf } from '@invflux/i18n';
import { decimalOrNull, parseDecimal } from '@invflux/ui';

/** The scale a supplier's order thresholds are stored at. */
const THRESHOLD_SCALE = 4;

/**
 * A typed order threshold as the API takes it: a decimal string, null for none (an empty field —
 * "no minimum", never zero), or undefined when the text is not an amount.
 */
export function thresholdValue(text: string): string | null | undefined {
  return decimalOrNull(parseDecimal(text, { scale: THRESHOLD_SCALE }));
}

/** Why a typed threshold cannot be saved, or null when it can. The typed text is kept either way. */
export function thresholdError(text: string): string | null {
  const parsed = parseDecimal(text, { scale: THRESHOLD_SCALE });
  if ('too_many_decimals' === parsed.kind) {
    /* translators: %d is the most decimals an amount may have. */
    return sprintf(__('Use at most %d decimals.'), parsed.scale);
  }
  return 'invalid' === parsed.kind || 'out_of_range' === parsed.kind
    ? __('Enter an amount, such as 500 or 500.00.')
    : null;
}

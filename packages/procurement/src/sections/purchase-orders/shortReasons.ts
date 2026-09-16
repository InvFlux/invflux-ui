import { __ } from '@invflux/i18n';

/**
 * Reasons an order is finished on less than was ordered — the vocabulary the server records on the
 * close-short event. Shared by the count's finish prompt and the order page's, so the same decision
 * reads the same way wherever it is taken.
 */
export const SHORT_REASONS = (): { value: string; label: string }[] => [
  { value: 'supplier_oos', label: __('The supplier ran out') },
  { value: 'damaged', label: __('Damaged in transit') },
  { value: 'never_shipped', label: __('Never shipped') },
  { value: 'other', label: __('Other') },
];

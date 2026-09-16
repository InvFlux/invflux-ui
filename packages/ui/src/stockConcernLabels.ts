import { __ } from '@invflux/i18n';
import { StockConcernBits } from './types';

/**
 * The one wording of each stock-concern bit, shared by the badge that shows the concerns and the
 * codec that copies them, so what a merchant reads and what they paste cannot say different things.
 *
 * Getters, not strings: this table is built at module load, before the host locale is bound.
 */
export const STOCK_CONCERN_LABEL: Readonly<Record<number, () => string>> = {
  [StockConcernBits.STOCK_DEFICIT]: () => __('Deficit'),
  [StockConcernBits.SUBJECT_INACTIVE]: () => __('Inactive product'),
  [StockConcernBits.QUALITY_HOLD]: () => __('Quality hold'),
  [StockConcernBits.BATCH_EXPIRED]: () => __('Expired batch'),
  [StockConcernBits.BATCH_EXPIRY_RISK]: () => __('Expiry risk'),
  [StockConcernBits.LOC_AT_RISK]: () => __('Warehouse short'),
};

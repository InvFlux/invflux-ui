import type { InputSource } from '../scanner/state';
import type { StageCode } from './cycle';

export type StageGuardResult = 'ok' | 'ean-noscan' | 'no-shippable-qty';

/**
 * Check whether a stage change is permitted before attempting it.
 *
 * EAN enforcement: non-admin operators must scan products that carry an EAN.
 * Direct click or keyboard Enter is rejected so the physical scan step
 * cannot be bypassed. This is the client-side UX guard; the server enforces
 * the same rule independently.
 */
export function checkStageGuard(opts: {
  shippableQty: number;
  hasEan: boolean;
  isAdmin: boolean;
  inputSource: InputSource;
}): StageGuardResult {
  if (opts.shippableQty <= 0) return 'no-shippable-qty';
  if (opts.hasEan && !opts.isAdmin && opts.inputSource !== 'scanner') return 'ean-noscan';
  return 'ok';
}

/**
 * Whether all conditions are met to fire the auto-advance modal
 * ("Order N is ready to ship! Save & Print Label?").
 *
 * All four conditions must be true simultaneously:
 * - At least one line is in 'M' state (something to ship)
 * - No unprocessed corrections (must be resolved before shipping)
 * - No lines in 'W' state (put-aside = stuck exception, needs operator attention)
 * - No unshipped lines remain outside the current staged set
 */
export function isReadyForAutoAdvance(opts: {
  stagedLines: StageCode[];
  unprocessedCorrections: number;
  unshippedLineCount: number;
}): boolean {
  const mCount = opts.stagedLines.filter((s) => s === 'M').length;
  const wCount = opts.stagedLines.filter((s) => s === 'W').length;
  return (
    mCount > 0 && opts.unprocessedCorrections === 0 && wCount === 0 && opts.unshippedLineCount === 0
  );
}

import { SCANNER_THRESHOLD_MS } from './state';
import type { InputSource, ScannerState } from './state';

// ---------------------------------------------------------------------------
// Enter-key intent
// ---------------------------------------------------------------------------

export type EnterIntent =
  | { kind: 'stage'; source: InputSource; multiConfirmed: boolean }
  | { kind: 'hold-on' }
  | { kind: 'unconvinced'; reason: 'multi-qty-unconfirmed' | 'ambiguous-match' };

/**
 * Decide what an Enter keypress means given the current scanner state.
 *
 * Rules:
 * - 0 matches → hold-on (EAN not found)
 * - >1 matches → unconvinced (ambiguous; user must narrow the filter)
 * - 1 match, scanner Enter, qty > 1, not dot-armed → unconvinced (multi-qty guard)
 * - 1 match, scanner Enter, qty > 1, dot-armed → stage (dot barcode confirmed)
 * - 1 match, keyboard Enter → stage regardless of qty (operator explicit override)
 */
export function deriveEnterIntent(
  state: ScannerState,
  opts: { enterAt: number; matchCount: number; shippableQty: number },
): EnterIntent {
  if (opts.matchCount === 0) return { kind: 'hold-on' };
  if (opts.matchCount > 1) return { kind: 'unconvinced', reason: 'ambiguous-match' };

  const gap = state.lastCharAt > 0 ? opts.enterAt - state.lastCharAt : Infinity;
  const enterSource: InputSource = gap < SCANNER_THRESHOLD_MS ? 'scanner' : 'keyboard';

  if (enterSource === 'scanner' && opts.shippableQty > 1 && !state.multiQtyArmed) {
    return { kind: 'unconvinced', reason: 'multi-qty-unconfirmed' };
  }

  return { kind: 'stage', source: enterSource, multiConfirmed: state.multiQtyArmed };
}

// ---------------------------------------------------------------------------
// Filter-change auto-stage intent
// ---------------------------------------------------------------------------

export type AutoStageIntent =
  | 'stage'       // auto-stage immediately (qty=1, scanner, autoValidation on)
  | 'zoom-multi'  // zoom the qty cell and wait for dot-barcode confirmation
  | 'hold-on'     // 0 scanner matches → play hold-on sound + show overlay
  | null;         // no automatic action

/**
 * Decide whether a filter value change should trigger an automatic action.
 *
 * Only fires on scanner input — keyboard typing produces partial queries where
 * 0 matches is normal and should not trigger any sound or staging.
 */
export function deriveAutoStageIntent(
  state: ScannerState,
  opts: { matchCount: number; shippableQty: number; autoValidation: boolean },
): AutoStageIntent {
  if (state.inputSource !== 'scanner') return null;
  if (opts.matchCount === 0) return 'hold-on';
  if (opts.matchCount > 1) return null;

  if (!opts.autoValidation) return null;
  return opts.shippableQty > 1 ? 'zoom-multi' : 'stage';
}

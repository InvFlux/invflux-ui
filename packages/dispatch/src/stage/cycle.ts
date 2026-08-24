import type { StageCode } from '@invflux/ui';

export type { StageCode };

/** Primary = click or scan. Alternate = Ctrl+click (put-aside path). */
export type StageAction = 'primary' | 'alternate';

/**
 * Compute the next stage for a product line.
 *
 * Primary cycle:   '' → M → ''   (stage / unstage)
 *                  W  → M        (recover from put-aside)
 *
 * Alternate cycle: '' → W        (put aside — short pick, damage, query)
 *                  W  → M        (resolve put-aside to staged)
 *                  M  → W        (move back to put-aside)
 *
 * 'E' is an error/exception marker that can be set externally but is not part
 * of the normal cycle — primary action unstages it ('E' → '').
 */
export function nextStage(current: StageCode, action: StageAction): StageCode {
  if (action === 'primary') {
    if (current === '') return 'M';
    if (current === 'M') return '';
    if (current === 'W') return 'M';
    if (current === 'E') return '';
  } else {
    if (current === '') return 'W';
    if (current === 'W') return 'M';
    if (current === 'M') return 'W';
  }
  return current;
}

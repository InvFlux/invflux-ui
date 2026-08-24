import type { JSX } from 'solid-js';
import { __ } from '@invflux/i18n';

/**
 * Inline "required field" marker — a red asterisk with a "Required" tooltip, rendered next to a field
 * label. Decorative (`aria-hidden`): the required state itself should be conveyed to assistive tech via
 * `aria-required` / `required` on the control. The shared seed of a form/required-field design language
 * across the SPAs (arch-ui-principles) — use this rather than a per-surface asterisk.
 */
export function RequiredMark(): JSX.Element {
  return (
    <span class="text-red-600" title={__('Required')} aria-hidden="true">
      {' *'}
    </span>
  );
}

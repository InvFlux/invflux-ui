import type { JSX } from 'solid-js';

/**
 * A muted "ⓘ" affordance carrying a native-title tooltip — for short, inline field
 * explanations next to a label. Uses the same native-`title` pattern as the rest of the
 * SPA (constraint cells, FeatureGate) rather than a custom popover.
 */
export function Hint(props: { text: string }): JSX.Element {
  return (
    <span class="cursor-help select-none text-text-muted" title={props.text} aria-label={props.text}>
      ⓘ
    </span>
  );
}

import type { JSX } from 'solid-js';
import * as Kobalte from '@kobalte/core/switch';

export interface SwitchProps {
  /** Current checked state. */
  checked: boolean;
  /** Change handler — called with the new boolean value. */
  onChange: (checked: boolean) => void;
  /** Accessible label for screen readers (sr-only unless the caller renders its own visible label). */
  ariaLabel?: string;
  /** Disable the control (no interaction; greyed out). */
  disabled?: boolean;
}

/**
 * Pill-shaped on/off switch built on `@kobalte/core/switch` — Kobalte handles ARIA
 * (role=switch, aria-checked), keyboard nav (Space toggles), focus management, and
 * the switch state machine. We bring our Tailwind tokens for the visual.
 *
 * Preferred over native `<input type="checkbox">` for binary state that controls a
 * substantial side-effect (e.g. "Track stock quantity" — a flip that toggles whole
 * blocks of UI on/off and changes the inventory contract). The pill metaphor reads
 * as "on/off mode" rather than "yes/no agreement", which checkboxes connote.
 */
export function Switch(props: SwitchProps): JSX.Element {
  return (
    <Kobalte.Root
      checked={props.checked}
      onChange={props.onChange}
      disabled={props.disabled}
      aria-label={props.ariaLabel}
      class="inline-flex items-center"
    >
      <Kobalte.Input class="sr-only" />
      <Kobalte.Control
        class={
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center ' +
          'rounded-full border border-border bg-surface-raised ' +
          'transition-colors duration-150 ' +
          'data-[checked]:border-primary data-[checked]:bg-primary ' +
          'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 ' +
          'focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-1'
        }
      >
        <Kobalte.Thumb
          class={
            'pointer-events-none ml-0.5 inline-block h-3.5 w-3.5 transform rounded-full ' +
            'bg-white shadow ' +
            'transition-transform duration-150 ' +
            'data-[checked]:translate-x-4'
          }
        />
      </Kobalte.Control>
    </Kobalte.Root>
  );
}

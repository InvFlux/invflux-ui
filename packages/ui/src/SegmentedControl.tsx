import { For, type JSX } from 'solid-js';
import * as Kobalte from '@kobalte/core/segmented-control';

export interface SegmentedControlOption<TValue extends string = string> {
  value: TValue;
  label: string;
  /** Disabled options stay visible but are unselectable (e.g. sign-incompatible disposition). */
  disabled?: boolean;
  /** Native tooltip, for a segment whose short label needs explaining ("Advance shipping notice"). */
  title?: string;
}

/** Text + padding scale. `sm` for a dense row — a filter popover's modifier, a grid toolbar. */
export type SegmentedControlSize = 'sm' | 'md';

export interface SegmentedControlProps<TValue extends string = string> {
  /** Accessible label for the control (sr-only unless `visibleLabel` is also set by the caller). */
  ariaLabel: string;
  /** Buttons rendered in document order. */
  options: ReadonlyArray<SegmentedControlOption<TValue>>;
  /** Current selection; null = none picked yet. */
  value: TValue | null;
  /** Change handler — called with the option's value (never null; the user always picks one). */
  onChange: (value: TValue) => void;
  /** Disable the whole group (e.g. while a save is in flight). */
  disabled?: boolean;
  /** Extra classes on the container — override the default white background when needed. */
  class?: string;
  /** Default `md`. */
  size?: SegmentedControlSize;
}

const SEGMENT_SIZE: Record<SegmentedControlSize, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-3 py-1 text-sm',
};

/**
 * Single-select button group built on `@kobalte/core/segmented-control` — Kobalte handles ARIA
 * (role=radiogroup + role=radio), keyboard nav (arrow keys, Home/End), focus management, and
 * the radio-group state machine. We bring our Tailwind tokens for the visual.
 *
 * **Reach for this over a row of `aria-pressed` buttons.** Several surfaces had hand-rolled the
 * latter, which looks the same and is not: a toggle button says "this control is on", so a row of
 * them tells a screen-reader user about N independent switches rather than one choice among N, and
 * arrow-key navigation — what a radio group is expected to answer to — does nothing. `aria-pressed`
 * is right only when the options really are independent, i.e. a *multi*-select
 * ({@link FilterScopePicker} is the honest case).
 *
 * For sign-aware on-hand-correction dispositions: pass the appropriate option subset (negative
 * or positive) and let the surrounding code key the modal off the delta sign.
 *
 * Consumers should NOT reach for `@kobalte/core` directly — wrap any additional Kobalte
 * primitive here in `@invflux/ui` first.
 */
export function SegmentedControl<TValue extends string = string>(
  props: SegmentedControlProps<TValue>,
): JSX.Element {
  // Kobalte's Root takes the current value + change handler; null is not in its API,
  // so we feed empty-string when unset and translate back on change.
  return (
    <Kobalte.Root
      value={props.value ?? ''}
      onChange={(v: string) => props.onChange(v as TValue)}
      aria-label={props.ariaLabel}
      class={`inline-flex items-stretch rounded border border-border bg-surface p-0.5 shadow-sm ${props.class ?? ''}`}
    >
      <For each={props.options}>
        {(opt) => (
          <Kobalte.Item
            value={opt.value}
            disabled={props.disabled || opt.disabled}
            class="group relative cursor-pointer select-none"
          >
            <Kobalte.ItemInput class="sr-only" />
            <Kobalte.ItemLabel
              title={opt.title}
              class={
                // Each segment is a click target painted with our tokens. Aria-checked styling
                // is the load-bearing visual cue.
                'flex items-center justify-center rounded font-medium text-text-muted ' +
                `${SEGMENT_SIZE[props.size ?? 'md']} ` +
                'transition-colors hover:text-text ' +
                'group-data-[checked]:bg-primary group-data-[checked]:text-white ' +
                'group-data-[disabled]:cursor-not-allowed group-data-[disabled]:opacity-50'
              }
            >
              {opt.label}
            </Kobalte.ItemLabel>
          </Kobalte.Item>
        )}
      </For>
    </Kobalte.Root>
  );
}

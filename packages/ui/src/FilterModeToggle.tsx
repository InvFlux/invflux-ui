import { __ } from '@invflux/i18n';
import type { ComboboxOption } from './Combobox';
import { SegmentedControl } from './SegmentedControl';

export interface FilterModeToggleProps {
  /** The available match-logic modes (e.g. Any / All / None). */
  modes: ComboboxOption[];
  /** Reactive accessor for the currently-selected mode value. */
  value: () => string;
  onChange: (value: string) => void;
  /** Accessible name for the group. Defaults to "Match logic". */
  ariaLabel?: string;
}

/**
 * A small segmented control for a filter chip's set-operation modifier (supplier any/all/none,
 * worksheet in/not-in, …). Rendered right-aligned on the popover's title row via a filter
 * descriptor's `extra` slot, so it stays visible above the control's dropdown. Surface-neutral:
 * any grid filter — registry-driven (via {@link gridFiltersToDescriptors}) or hand-built — can use it.
 *
 * Thin wrapper over {@link SegmentedControl}: it exists for the filter-side shape (a
 * `ComboboxOption[]` and a reactive accessor), not for a look of its own.
 */
export function FilterModeToggle(props: FilterModeToggleProps) {
  return (
    <SegmentedControl
      ariaLabel={props.ariaLabel ?? __('Match logic')}
      size="sm"
      options={props.modes.map((m) => ({ value: m.value, label: m.label }))}
      value={props.value()}
      onChange={props.onChange}
    />
  );
}

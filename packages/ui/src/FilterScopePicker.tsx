import { For } from 'solid-js';
import type { ComboboxOption } from './Combobox';

export interface FilterScopePickerProps {
  /** The measurable scopes (e.g. Available / Reserved / Committed). */
  scopes: ComboboxOption[];
  /** Reactive accessor for the currently-selected scope values. */
  value: () => string[];
  onChange: (value: string[]) => void;
}

/**
 * A small multi-select for a filter chip's "what does this measure?" modifier.
 *
 * Where {@link FilterModeToggle} picks one match logic, this picks any number of scopes: a stock
 * level asks for a quantity band *and* which slots to count, and the useful questions combine them
 * ("available plus committed"). Selected scopes are summed server-side, so the control reads as one
 * quantity built from parts rather than as alternatives — which is why it's a checkbox row and not
 * a segmented toggle.
 *
 * Unchecking the last scope is a no-op rather than an empty selection: "measure nothing" has no
 * meaning, and the server would read it as "measure everything".
 *
 * Deliberately **not** a {@link SegmentedControl}, despite looking like its twin: that is a
 * radiogroup, and these options are independent. `aria-pressed` toggle buttons are the correct
 * ARIA for a multi-select, and swapping in a radiogroup would tell a screen-reader user that
 * picking one scope unpicks the rest.
 */
export function FilterScopePicker(props: FilterScopePickerProps) {
  const selected = (value: string): boolean => props.value().includes(value);

  const toggle = (value: string): void => {
    const next = selected(value)
      ? props.value().filter((v) => v !== value)
      : [...props.value(), value];
    if (next.length > 0) props.onChange(next);
  };

  return (
    <div class="inline-flex overflow-hidden rounded border border-border text-xs">
      <For each={props.scopes}>
        {(scope, index) => (
          <button
            type="button"
            aria-pressed={selected(scope.value)}
            class="cursor-pointer px-2 py-1 font-medium"
            classList={{
              'border-l border-border': index() > 0,
              'bg-primary text-white': selected(scope.value),
              'bg-surface text-text-muted hover:bg-gray-100': !selected(scope.value),
            }}
            onClick={() => toggle(scope.value)}
          >
            {scope.label}
          </button>
        )}
      </For>
    </div>
  );
}

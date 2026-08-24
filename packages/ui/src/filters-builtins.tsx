import { createSignal, onCleanup, onMount } from 'solid-js';
import { Combobox, type ComboboxOption } from './Combobox';
import { Input } from './Input';
import { Textarea } from './Textarea';
import {
  FILTER_CONTROL_DATERANGE,
  FILTER_CONTROL_MULTISELECT,
  FILTER_CONTROL_MULTISELECT_ASYNC,
  FILTER_CONTROL_NUMERIC_IDS,
  FILTER_CONTROL_RANGE,
  FILTER_CONTROL_SELECT,
  filterControlRegistry,
  type FilterControl,
} from './filters';

/**
 * Built-in filter controls, registered into {@link filterControlRegistry} on import (side
 * effect). Both wrap the shared {@link Combobox}:
 * `multiselect` keeps the dropdown open across picks, `select` is single-choice.
 */

// `showSelectedTags={false}` is the FilterBar-specific convention:
// the outer chip's `summary` + the dropdown's selected-row styling
// already convey what's picked, so the inline tag row inside the
// input would just compete for the same horizontal space.

const MultiSelectControl: FilterControl = (props) => (
  <Combobox
    options={props.options}
    selected={props.value}
    placeholder={props.placeholder}
    maxVisible={20}
    autoFocus={props.autoFocus}
    onChange={props.onChange}
    showSelectedTags={false}
  />
);

const SelectControl: FilterControl = (props) => (
  <Combobox
    options={props.options}
    selected={props.value}
    placeholder={props.placeholder}
    multiple={false}
    autoFocus={props.autoFocus}
    onChange={props.onChange}
    showSelectedTags={false}
  />
);

/**
 * `multiselect:async` — owns the typed-text→debounced-server-fetch
 * pipeline so a chip just declares `loadOptions` and the control
 * handles the rest.
 *
 * Phases:
 *   - Below `minQueryLength` → empty options, `emptyMessage` hints the operator.
 *   - At/above threshold → debounced `loadOptions(query)`; `loading` spinner shows
 *     while the promise is in flight.
 *   - Race-safe: each new query bumps a generation counter and stale resolutions are dropped.
 */
const MultiSelectAsyncControl: FilterControl = (props) => {
  const minLen = (): number => props.minQueryLength ?? 3;
  const debounceMs = (): number => props.debounceMs ?? 300;

  const [options, setOptions] = createSignal<ComboboxOption[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [query, setQuery] = createSignal('');

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  function cancelPending(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  onCleanup(cancelPending);

  function handleSearchTextChange(text: string): void {
    setQuery(text);
    cancelPending();
    if (text.length < minLen()) {
      setOptions([]);
      setLoading(false);
      return;
    }
    if (!props.loadOptions) {
      setOptions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const mine = ++generation;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      props.loadOptions!(text)
        .then((next) => {
          // Drop if a newer query started while we were in flight.
          if (mine !== generation) return;
          setOptions(next);
          setLoading(false);
        })
        .catch(() => {
          if (mine !== generation) return;
          setOptions([]);
          setLoading(false);
        });
    }, debounceMs());
  }

  const emptyMessage = (): string => {
    if (loading()) return 'Searching…';
    if (query().length < minLen()) {
      return `Type at least ${minLen()} character${minLen() === 1 ? '' : 's'} to search`;
    }
    return 'No matches';
  };

  return (
    <Combobox
      options={options()}
      selected={props.value}
      selectedOptions={props.selectedOptions}
      placeholder={props.placeholder}
      maxVisible={20}
      autoFocus={props.autoFocus}
      onChange={props.onChange}
      onSearchTextChange={handleSearchTextChange}
      loading={loading()}
      emptyMessage={emptyMessage()}
      showSelectedTags={false}
    />
  );
};

/**
 * `range` — two numeric inputs (min / max). Emits the positional `[min, max]` value, collapsing an
 * all-empty range to `[]` so the chip reads as inactive. Ignores `options`.
 */
const RangeControl: FilterControl = (props) => {
  const minVal = (): string => props.value[0] ?? '';
  const maxVal = (): string => props.value[1] ?? '';

  const emit = (min: string, max: string): void => {
    props.onChange(min === '' && max === '' ? [] : [min, max]);
  };

  // The HTML `autofocus` attribute only fires on initial page load, not for a dynamically-mounted
  // popover — focus the min input programmatically (mirrors the combobox controls' autoFocus).
  let minRef: HTMLInputElement | undefined;
  onMount(() => {
    if (props.autoFocus) minRef?.focus();
  });

  return (
    <div class="flex items-center gap-2 p-1">
      <Input
        ref={minRef}
        type="number"
        inputmode="decimal"
        class="w-24"
        placeholder={props.placeholder ?? 'Min'}
        value={minVal()}
        onInput={(e) => emit(e.currentTarget.value.trim(), maxVal())}
      />
      <span class="text-text-muted">–</span>
      <Input
        type="number"
        inputmode="decimal"
        class="w-24"
        placeholder="Max"
        value={maxVal()}
        onInput={(e) => emit(minVal(), e.currentTarget.value.trim())}
      />
    </div>
  );
};

/**
 * `daterange` — two `<input type=date>` bounds (from / to). Emits the positional `[from, to]` value
 * (ISO `YYYY-MM-DD`), collapsing an all-empty window to `[]` so the chip reads as inactive. Ignores
 * `options`. The to-bound can't precede the from-bound (and vice-versa) via native min/max.
 */
const DateRangeControl: FilterControl = (props) => {
  const fromVal = (): string => props.value[0] ?? '';
  const toVal = (): string => props.value[1] ?? '';

  const emit = (from: string, to: string): void => {
    props.onChange(from === '' && to === '' ? [] : [from, to]);
  };

  let fromRef: HTMLInputElement | undefined;
  onMount(() => {
    if (props.autoFocus) fromRef?.focus();
  });

  return (
    <div class="flex items-center gap-2 p-1">
      <Input
        ref={fromRef}
        type="date"
        max={toVal() === '' ? undefined : toVal()}
        value={fromVal()}
        aria-label="From"
        onInput={(e) => emit(e.currentTarget.value, toVal())}
      />
      <span class="text-text-muted">–</span>
      <Input
        type="date"
        min={fromVal() === '' ? undefined : fromVal()}
        value={toVal()}
        aria-label="To"
        onInput={(e) => emit(fromVal(), e.currentTarget.value)}
      />
    </div>
  );
};

/**
 * `numeric_ids` — paste-friendly list of digit-only IDs. The textarea accepts arbitrary input
 * (comma/space/semicolon/newline-delimited, labels, stray whitespace) and we extract every
 * digit-run on each keystroke, dropping the rest. Empty list collapses to `[]` (inactive).
 * Ignores `options`. The host serializes the value as dash-joined in the URL (see filterBridge).
 *
 * Visible value mirrors the canonical list (joined with `, `) so the operator sees exactly what
 * the server will receive — no hidden "as-typed" buffer that could drift from `value`.
 */
const NumericIdsControl: FilterControl = (props) => {
  // The textarea stays controlled-by-text-not-by-id-list: the operator types freely (including
  // characters that don't end up in the value yet), and we re-derive the canonical id list on each
  // input. We sync back to the visible text only when `value` changes from outside (clear / chip
  // close-and-reopen) so the operator's in-progress typing isn't clobbered mid-key.
  const [text, setText] = createSignal(props.value.join(', '));
  let lastValue = props.value.join(', ');
  const externalValueText = (): string => props.value.join(', ');

  let ref: HTMLTextAreaElement | undefined;
  onMount(() => {
    if (props.autoFocus) ref?.focus();
  });

  const handleInput = (raw: string): void => {
    setText(raw);
    const ids = raw.match(/\d+/g) ?? [];
    const next = Array.from(new Set(ids));
    // Skip the round-trip when the canonical list hasn't changed (operator typed a separator,
    // a non-digit character, or nothing meaningful).
    if (next.join(',') === props.value.join(',')) return;
    lastValue = next.join(', ');
    props.onChange(next);
  };

  // If `value` shifts from outside (clear button, host reset, chip-popover reopened with a
  // different selection), refresh the visible text — but only when it actually diverges, so
  // the operator's intra-word edits stay untouched.
  const syncFromOutside = (): void => {
    const target = externalValueText();
    if (target !== lastValue) {
      lastValue = target;
      setText(target);
    }
  };

  // Plain Enter inserts a newline (operators paste multi-line lists), so we use Ctrl/Cmd+Enter
  // as the "I'm done" shortcut — closes the popover via the host-supplied onClose.
  const handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      props.onClose?.();
    }
  };

  return (
    <div class="p-1">
      <Textarea
        ref={ref}
        rows={3}
        class="w-64 resize-y font-mono"
        placeholder={props.placeholder ?? 'Paste IDs (any separators) — Ctrl+Enter to apply'}
        value={(syncFromOutside(), text())}
        onInput={(e) => handleInput(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
};

filterControlRegistry.register(FILTER_CONTROL_MULTISELECT, 'core.multiselect', MultiSelectControl, {
  default: true,
});
filterControlRegistry.register(FILTER_CONTROL_DATERANGE, 'core.daterange', DateRangeControl, {
  default: true,
});
filterControlRegistry.register(FILTER_CONTROL_RANGE, 'core.range', RangeControl, { default: true });
filterControlRegistry.register(FILTER_CONTROL_SELECT, 'core.select', SelectControl, { default: true });
filterControlRegistry.register(
  FILTER_CONTROL_MULTISELECT_ASYNC,
  'core.multiselect-async',
  MultiSelectAsyncControl,
  { default: true },
);
filterControlRegistry.register(FILTER_CONTROL_NUMERIC_IDS, 'core.numeric-ids', NumericIdsControl, {
  default: true,
});

import { createMemo, createSignal, type JSX, onMount, Show } from 'solid-js';
import * as Combobox from '@kobalte/core/combobox';
import { fuzzyScore, HighlightMatch } from './fuzzy';
import { KobalteComboboxFirstFocus } from './KobalteComboboxFirstFocus';
import { usePortalRootOptional } from './portal';

export interface SearchSelectOption {
  value: string;
  label: string;
  /** Hierarchy depth — indents the option row (hierarchical taxonomy term lists). */
  depth?: number;
  disabled?: boolean;
}

export interface SearchSelectProps {
  options: SearchSelectOption[];
  /** Selected value, or null when nothing is chosen. */
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Accessible label for the control. */
  ariaLabel?: string;
  /** Extra classes on the control (the select-like box). */
  class?: string;
  /** Replace the control box styling entirely (e.g. a borderless variant when embedded in a grid
   *  cell). When omitted, the default select-like control is used. */
  controlClass?: string;
  /** Focus the input on mount (e.g. when revealed inside a filter popover). */
  autoFocus?: boolean;
  /**
   * Opt-in client-side **fuzzy** mode: filters + ranks the options against the typed text best-first,
   * highlights the matched characters, and auto-highlights the top result so Enter accepts it without
   * pressing Down. Off by default — Kobalte's built-in substring filter is used and nothing changes for
   * existing consumers.
   */
  fuzzy?: boolean;
  /** Seed the search text on mount (fuzzy mode) — e.g. the character that opened a grid cell editor;
   *  the option list filters to it and the next keystrokes append. */
  initialQuery?: string;
  /** Message shown when no option matches (enables opening on an empty collection). */
  emptyMessage?: string;
  /**
   * Portal target for the listbox. In the shadow-DOM SPA, pass the light-DOM `portalRoot`
   * (which carries the SPA stylesheet AND is whitelisted by the host click-interceptor); without
   * it Kobalte portals to `document.body`, where options render unstyled and their clicks are
   * swallowed by the interceptor. See arch-ui-principles §3.9.8.
   */
  mount?: HTMLElement;
}

const CONTROL =
  'flex h-9 w-full items-center gap-1 rounded border border-border bg-surface px-2 text-sm shadow-sm ' +
  'focus-within:ring-2 focus-within:ring-primary/40 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60';

// `group` so the match highlight (HighlightMatch) can flip styling on the highlighted row.
const ITEM =
  'group flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm text-text ' +
  'data-[highlighted]:bg-primary data-[highlighted]:text-white ' +
  'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60';

/**
 * Single-select, searchable dropdown built on `@kobalte/core/combobox`. Reads like a native
 * `<select>` when unfocused — the chosen value fills the input, **no chip** — filters on type,
 * and Kobalte owns click/keyboard/ARIA/dismiss. Opt into {@link SearchSelectProps.fuzzy} for
 * ranked fuzzy matching + highlighting + first-option auto-select.
 *
 * Wrap-don't-reach: per arch-ui-principles §4.2, SPAs use this, never `@kobalte/core` directly.
 */
export function SearchSelect(props: SearchSelectProps): JSX.Element {
  const selected = (): SearchSelectOption | null => props.options.find((o) => o.value === props.value) ?? null;
  const ctxMount = usePortalRootOptional();
  let inputRef: HTMLInputElement | undefined;

  // Fuzzy mode owns the input text so it can rank + highlight; otherwise Kobalte filters internally.
  const [query, setQuery] = createSignal(props.initialQuery ?? '');
  const displayedOptions = createMemo<SearchSelectOption[]>(() => {
    if (!props.fuzzy) return props.options;
    const scored: Array<{ option: SearchSelectOption; score: number }> = [];
    for (const option of props.options) {
      const m = fuzzyScore(query(), option.label);
      if (null !== m) scored.push({ option, score: m.score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.option);
  });
  const firstKey = (): string | undefined => (props.fuzzy ? displayedOptions()[0]?.value : undefined);

  onMount(() => {
    if (props.autoFocus && !props.disabled) inputRef?.focus();
    // Seed the input text (Kobalte tracks the input via its `input` event, so set the value and
    // dispatch one — updates the combobox's own state and fires onInputChange → our query).
    if (props.fuzzy && undefined !== props.initialQuery && '' !== props.initialQuery && inputRef) {
      inputRef.value = props.initialQuery;
      inputRef.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  return (
    <Combobox.Root
      options={displayedOptions()}
      value={selected()}
      onChange={(opt: SearchSelectOption | null) => props.onChange(opt ? opt.value : null)}
      onInputChange={props.fuzzy ? (value: string) => setQuery(value) : undefined}
      // Fuzzy mode pre-filters the options itself, so disable Kobalte's own filter.
      defaultFilter={props.fuzzy ? () => true : undefined}
      allowsEmptyCollection={undefined !== props.emptyMessage}
      optionValue="value"
      optionTextValue="label"
      optionLabel="label"
      optionDisabled="disabled"
      placeholder={props.placeholder}
      disabled={props.disabled}
      triggerMode="focus"
      itemComponent={(itemProps) => (
        <Combobox.Item
          item={itemProps.item}
          class={ITEM}
          style={{ 'padding-left': `${12 + (itemProps.item.rawValue.depth ?? 0) * 16}px` }}
        >
          <Combobox.ItemLabel class="truncate">
            <Show when={props.fuzzy} fallback={itemProps.item.rawValue.label}>
              <HighlightMatch text={itemProps.item.rawValue.label} query={query()} />
            </Show>
          </Combobox.ItemLabel>
          <Combobox.ItemIndicator>✓</Combobox.ItemIndicator>
        </Combobox.Item>
      )}
    >
      <Show when={props.fuzzy}>
        <KobalteComboboxFirstFocus firstKey={firstKey} />
      </Show>
      <Combobox.Control aria-label={props.ariaLabel} class={`${props.controlClass ?? CONTROL} ${props.class ?? ''}`}>
        <Combobox.Input ref={inputRef} aria-label={props.ariaLabel} class="h-7 min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-text-muted focus:ring-0" />
        <Combobox.Trigger aria-label={props.ariaLabel} class="shrink-0 text-text-muted">
          <Combobox.Icon>▾</Combobox.Icon>
        </Combobox.Trigger>
      </Combobox.Control>
      <Combobox.Portal mount={props.mount ?? ctxMount}>
        <Combobox.Content class="z-popover min-w-[var(--kb-popper-anchor-width)] rounded border border-border bg-surface py-1 text-sm shadow-xl">
          {/* max-height + scroll on the Listbox so Kobalte scrolls the active option into view. */}
          <Combobox.Listbox class="max-h-[210px] overflow-y-auto focus:outline-none" />
          <Show when={undefined !== props.emptyMessage && 0 === displayedOptions().length}>
            <div class="px-3 py-2 text-sm text-text-muted">{props.emptyMessage}</div>
          </Show>
        </Combobox.Content>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

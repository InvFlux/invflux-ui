import { __ } from '@invflux/i18n';
import { createSignal, type JSX, onMount, Show } from 'solid-js';
import * as Combobox from '@kobalte/core/combobox';
import { HighlightMatch } from './fuzzy';
import { KobalteComboboxFirstFocus } from './KobalteComboboxFirstFocus';
import type { SearchSelectOption } from './SearchSelect';
import { usePortalRootOptional } from './portal';

export interface SearchSelectAsyncProps {
  /** The current (already server-filtered) result set. */
  options: SearchSelectOption[];
  /**
   * The selected option — host-tracked, so it keeps displaying even after the result set changes
   * (async results don't contain previously-picked items). Null = nothing chosen.
   */
  value: SearchSelectOption | null;
  onChange: (option: SearchSelectOption | null) => void;
  /** Input text changed — the host debounces + fetches and updates `options`. */
  onSearch: (text: string) => void;
  loading?: boolean;
  placeholder?: string;
  /** Message when there are no results (e.g. "Type to search" vs "No matches"). */
  emptyMessage?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  class?: string;
  /** Highlight the typed text within each result label (client-only — the server still owns matching
   *  + ranking; this just emphasises why each row matched). Off by default. */
  highlight?: boolean;
  /** Auto-highlight the first (top-ranked) result so Enter accepts it without pressing Down. The
   *  server's order is preserved — this never re-ranks. Off by default. */
  autoFocusFirst?: boolean;
  /** Seed the input text on mount (e.g. the character that opened a grid cell editor) — fires
   *  `onSearch` so the first fetch runs, and the user's next keystrokes append. */
  initialQuery?: string;
  /** Portal target for the listbox (the SPA's shared portalRoot — see SearchSelect). */
  mount?: HTMLElement;
}

const CONTROL =
  'flex h-9 w-full items-center gap-1 rounded border border-border bg-surface px-2 text-sm shadow-sm ' +
  'focus-within:ring-2 focus-within:ring-primary/40';

// `group` so HighlightMatch can flip its emphasis on the highlighted (active) row.
const ITEM =
  'group flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm text-text ' +
  'data-[highlighted]:bg-primary data-[highlighted]:text-white';

/**
 * An **async** searchable single-select on `@kobalte/core/combobox`: the host owns option
 * resolution (`onSearch` → debounced fetch → `options`), so client-side filtering is disabled
 * (`defaultFilter` always true). Same look + shadow-DOM portal handling as {@see SearchSelect};
 * Kobalte handles click/keyboard/ARIA (no chip, clicks work). Use for "search all products to add"
 * style pickers; use SearchSelect for a fixed option list.
 *
 * Wrap-don't-reach: per arch-ui-principles §4.2, SPAs use this, never `@kobalte/core` directly.
 */
export function SearchSelectAsync(props: SearchSelectAsyncProps): JSX.Element {
  let inputRef: HTMLInputElement | undefined;
  const ctxMount = usePortalRootOptional();
  // Track the typed text locally so the result rows can highlight it (the host still does the fetch).
  const [query, setQuery] = createSignal('');
  onMount(() => {
    if (props.autoFocus) inputRef?.focus();
    // Seed the input text (Kobalte tracks the input via its `input` event, so set the value and
    // dispatch one — fires onInputChange → our query + the host's onSearch).
    if (undefined !== props.initialQuery && '' !== props.initialQuery && inputRef) {
      inputRef.value = props.initialQuery;
      inputRef.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  return (
    <Combobox.Root
      options={props.options}
      value={props.value}
      onChange={(opt: SearchSelectOption | null) => props.onChange(opt)}
      onInputChange={(text: string) => {
        setQuery(text);
        props.onSearch(text);
      }}
      defaultFilter={() => true}
      // Open the listbox even with no options yet, so async results (and the "Searching…" state)
      // render after they arrive — Kobalte otherwise refuses to open an empty collection.
      allowsEmptyCollection
      optionValue="value"
      optionTextValue="label"
      optionLabel="label"
      placeholder={props.placeholder}
      triggerMode="focus"
      itemComponent={(itemProps) => (
        <Combobox.Item item={itemProps.item} class={ITEM}>
          <Combobox.ItemLabel class="truncate">
            <Show when={props.highlight} fallback={itemProps.item.rawValue.label}>
              <HighlightMatch text={itemProps.item.rawValue.label} query={query()} />
            </Show>
          </Combobox.ItemLabel>
          <Combobox.ItemIndicator>✓</Combobox.ItemIndicator>
        </Combobox.Item>
      )}
    >
      <Show when={props.autoFocusFirst}>
        <KobalteComboboxFirstFocus firstKey={() => props.options[0]?.value} />
      </Show>
      <Combobox.Control aria-label={props.ariaLabel} class={`${CONTROL} ${props.class ?? ''}`}>
        <Combobox.Input
          ref={inputRef}
          aria-label={props.ariaLabel}
          class="h-7 min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-text-muted focus:ring-0"
        />
        <Combobox.Trigger aria-label={props.ariaLabel} class="shrink-0 text-text-muted">
          <Combobox.Icon>▾</Combobox.Icon>
        </Combobox.Trigger>
      </Combobox.Control>
      <Combobox.Portal mount={props.mount ?? ctxMount}>
        <Combobox.Content class="z-popover min-w-[var(--kb-popper-anchor-width)] rounded border border-border bg-surface py-1 text-sm shadow-xl">
          <Show when={props.loading}>
            <div class="flex items-center gap-2 px-3 py-2 text-text-muted">
              <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              <span>{__('Searching…')}</span>
            </div>
          </Show>
          {/* max-height + scroll on the Listbox so Kobalte scrolls the active option into view. */}
          <Combobox.Listbox class="max-h-[210px] overflow-y-auto focus:outline-none" />
          <Show when={!props.loading && 0 === props.options.length}>
            <div class="px-3 py-2 text-text-muted">{props.emptyMessage ?? __('No matches')}</div>
          </Show>
        </Combobox.Content>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

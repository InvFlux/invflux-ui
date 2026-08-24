import { For, type JSX, onMount, Show } from 'solid-js';
import * as Combobox from '@kobalte/core/combobox';
import { usePortalRootOptional } from './portal';

export interface SearchMultiSelectOption {
  value: string;
  label: string;
  /** Hierarchy depth — indents the option row (taxonomy term trees). */
  depth?: number;
  disabled?: boolean;
}

export interface SearchMultiSelectProps {
  options: SearchMultiSelectOption[];
  /** Selected option values. */
  value: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Accessible label for the control. */
  ariaLabel?: string;
  /** Extra classes on the control box. */
  class?: string;
  /** Open + focus the input on mount (e.g. revealed inside a filter popover). */
  autoFocus?: boolean;
  /**
   * Render selected values as removable inline tags in the control. Default true. Pass false when
   * the host shows the selection elsewhere (e.g. a FilterBar chip's summary) so the tags don't
   * compete for space.
   */
  showSelectedTags?: boolean;
  /**
   * Portal target for the listbox. In the shadow-DOM SPA pass the light-DOM portal root (carries the
   * stylesheet AND is whitelisted by the host click-interceptor); without it Kobalte portals to
   * `document.body`, where options render unstyled and clicks are swallowed. See arch-ui-principles §3.9.8.
   */
  mount?: HTMLElement;

  // ── Async mode ────────────────────────────────────────────────
  // When `onSearch` is set the host owns option resolution (debounced fetch → `options`): client-side
  // filtering is disabled, and already-selected options are merged in front of the results so they
  // stay visible/removable even when absent from the current query's `options`.

  /** Input text changed — host debounces + fetches and updates `options`. Enables async mode. */
  onSearch?: (text: string) => void;
  /** Show a "Searching…" row while the host fetch is in flight. */
  loading?: boolean;
  /** Empty-state text (e.g. "Type 3 characters to search" vs "No matches"). */
  emptyMessage?: string;
  /**
   * Labels for currently-selected values, kept by the host across `options` changes so selected
   * items render with rich labels even after the async result set moves on (async mode).
   */
  selectedOptions?: SearchMultiSelectOption[];
}

const CONTROL =
  'flex min-h-9 w-full flex-wrap items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-sm shadow-sm ' +
  'focus-within:ring-2 focus-within:ring-primary/40 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60';

const ITEM =
  'flex cursor-pointer items-center justify-between gap-2 py-1.5 pr-3 text-sm text-text ' +
  'data-[highlighted]:bg-primary data-[highlighted]:text-white ' +
  'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60';

/**
 * Multi-select, searchable dropdown on `@kobalte/core/combobox` (the multi sibling of
 * {@see SearchSelect}). Kobalte owns click / keyboard / ARIA / dismiss / portal; selected values
 * render as removable inline tags (unless `showSelectedTags={false}`). Options may carry a `depth`
 * for hierarchical indentation (taxonomy term trees).
 *
 * Wrap-don't-reach: per arch-ui-principles §4.2, SPAs use this, never `@kobalte/core` directly.
 */
export function SearchMultiSelect(props: SearchMultiSelectProps): JSX.Element {
  let inputRef: HTMLInputElement | undefined;
  // Default the listbox portal to the SPA's shadow-escaping root unless the caller overrides it.
  const ctxMount = usePortalRootOptional();
  const mount = (): HTMLElement | undefined => props.mount ?? ctxMount;
  onMount(() => {
    if (props.autoFocus && !props.disabled) inputRef?.focus();
  });

  const isAsync = (): boolean => props.onSearch !== undefined;

  // Resolve a value to its richest known option: current options → host-provided selectedOptions →
  // bare {value,label:value} fallback. Keeps selected tags labelled across async result churn.
  const resolve = (value: string): SearchMultiSelectOption => {
    const byValue = new Map<string, SearchMultiSelectOption>();
    for (const o of props.options) byValue.set(o.value, o);
    for (const o of props.selectedOptions ?? []) if (!byValue.has(o.value)) byValue.set(o.value, o);
    return byValue.get(value) ?? { value, label: value };
  };

  // Selected options in the host's order (stable tag order).
  const selectedOptions = (): SearchMultiSelectOption[] => props.value.map(resolve);

  // The option set Kobalte renders. In async mode, pin selected options in front of the results
  // (deduped) so they stay visible/removable even when the current query doesn't return them.
  const renderOptions = (): SearchMultiSelectOption[] => {
    if (!isAsync()) return props.options;
    const seen = new Set<string>();
    const merged: SearchMultiSelectOption[] = [];
    for (const o of [...selectedOptions(), ...props.options]) {
      if (seen.has(o.value)) continue;
      seen.add(o.value);
      merged.push(o);
    }
    return merged;
  };

  return (
    <Combobox.Root<SearchMultiSelectOption>
      multiple
      // Keep the dropdown open across picks (a multi-select is meant for choosing several at once) —
      // selecting/deselecting by mouse or keyboard must not dismiss it.
      closeOnSelection={false}
      options={renderOptions()}
      value={selectedOptions()}
      onChange={(opts) => props.onChange(opts.map((o) => o.value))}
      onInputChange={isAsync() ? (text: string) => props.onSearch?.(text) : undefined}
      defaultFilter={isAsync() ? () => true : undefined}
      // Open even with no options so the empty-state message shows (async "Searching…"/"No matches"
      // and the sync "Nothing to remove" case used by the bulk-edit term picker).
      allowsEmptyCollection
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
          // Keep the dropdown open across picks: the listbox is portaled to the light DOM while the
          // input lives in the SPA's shadow root, so a mouse-pick blurs the input with a null
          // relatedTarget (shadow boundary) and Kobalte closes on blur. Preventing the option's
          // mousedown default stops the input from losing focus; the click still selects.
          onMouseDown={(e) => e.preventDefault()}
        >
          <Combobox.ItemLabel class="truncate">{itemProps.item.rawValue.label}</Combobox.ItemLabel>
          <Combobox.ItemIndicator>✓</Combobox.ItemIndicator>
        </Combobox.Item>
      )}
    >
      <Combobox.Control<SearchMultiSelectOption> aria-label={props.ariaLabel} class={`${CONTROL} ${props.class ?? ''}`}>
        {(state) => (
          <>
            <Show when={props.showSelectedTags ?? true}>
              <For each={state.selectedOptions()}>
                {(option) => (
                  <span class="inline-flex max-w-44 items-center gap-1 rounded bg-blue-100 px-2 py-0.5 text-blue-800">
                    <span class="truncate">{option.label}</span>
                    <button
                      type="button"
                      class="cursor-pointer rounded px-0.5 leading-none hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-primary"
                      aria-label={`Remove ${option.label}`}
                      disabled={props.disabled}
                      onClick={() => state.remove(option)}
                    >
                      ×
                    </button>
                  </span>
                )}
              </For>
            </Show>
            <Combobox.Input
              ref={inputRef}
              aria-label={props.ariaLabel}
              class="h-7 min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-text-muted focus:ring-0"
            />
            <Combobox.Trigger aria-label={props.ariaLabel} class="shrink-0 text-text-muted">
              <Combobox.Icon>▾</Combobox.Icon>
            </Combobox.Trigger>
          </>
        )}
      </Combobox.Control>
      <Combobox.Portal mount={mount()}>
        <Combobox.Content class="z-popover min-w-[var(--kb-popper-anchor-width)] rounded border border-border bg-surface py-1 text-sm shadow-xl">
          <Show when={props.loading}>
            <div class="flex items-center gap-2 px-3 py-2 text-text-muted">
              <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              <span>Searching…</span>
            </div>
          </Show>
          {/* max-height + scroll live on the Listbox (not Content) so Kobalte's scroll-the-active-
              option-into-view on ArrowUp/Down works — it adjusts the listbox element's scrollTop. */}
          <Combobox.Listbox class="max-h-[210px] overflow-y-auto focus:outline-none" />
          <Show when={!props.loading && 0 === renderOptions().length}>
            <div class="px-3 py-2 text-text-muted">{props.emptyMessage ?? 'No matches'}</div>
          </Show>
        </Combobox.Content>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

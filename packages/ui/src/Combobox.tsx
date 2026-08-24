import { Show, type JSX } from 'solid-js';
import { SearchSelect } from './SearchSelect';
import { SearchMultiSelect } from './SearchMultiSelect';

export interface ComboboxOption {
  value: string;
  label: string;
  depth?: number;
  disabled?: boolean;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  multiple?: boolean;
  placeholder?: string;
  disabled?: boolean;
  /** @deprecated No longer honoured by the Kobalte implementation (the listbox scrolls). */
  maxVisible?: number;
  /** @deprecated Form-submit hidden inputs are no longer emitted. */
  name?: string;
  /** @deprecated Not wired through the Kobalte implementation. */
  labelId?: string;
  /** @deprecated Not wired through the Kobalte implementation. */
  inputClass?: string;
  /** Focus the input and open the dropdown on mount (e.g. when revealed in a popover). */
  autoFocus?: boolean;

  // ── Async-search hooks ────────────────────────────────────────
  /** Emit the input text up to the host (enables async mode: host owns option resolution). */
  onSearchTextChange?: (text: string) => void;
  /** Show a spinner in the listbox (host fetch in flight). */
  loading?: boolean;
  /** Replace the default "No matches" empty state. */
  emptyMessage?: JSX.Element | string;
  /** Host-preserved labels for already-selected values (async mode). */
  selectedOptions?: ComboboxOption[];
  /**
   * Render selected values as removable inline tags. Default true. Pass false when the host shows
   * the selection elsewhere (e.g. a FilterBar chip summary).
   */
  showSelectedTags?: boolean;

  /** Portal target for the listbox; defaults to the shared PortalCtx (shadow-DOM escape). */
  mount?: HTMLElement;
}

/**
 * Searchable combobox — now a thin shim over the Kobalte-based wraps: single-select delegates to
 * {@link SearchSelect}, multi-select (default) to {@link SearchMultiSelect}. Kept as a stable
 * facade so existing call sites + the plug-in API surface are unchanged while Kobalte owns
 * click / keyboard / ARIA / dismiss / portal. The listbox portals to the shared PortalCtx by
 * default (override via `mount`). A handful of legacy props (`maxVisible`/`name`/`labelId`/
 * `inputClass`) are accepted for source compatibility but no longer wired — see the JSDoc above.
 */
export function Combobox(props: ComboboxProps): JSX.Element {
  const multiple = (): boolean => props.multiple ?? true;
  const emptyMessage = (): string | undefined =>
    typeof props.emptyMessage === 'string' ? props.emptyMessage : undefined;

  return (
    <Show
      when={multiple()}
      fallback={
        <SearchSelect
          options={props.options}
          value={props.selected[0] ?? null}
          onChange={(v) => props.onChange(v === null ? [] : [v])}
          placeholder={props.placeholder}
          disabled={props.disabled}
          autoFocus={props.autoFocus}
          mount={props.mount}
        />
      }
    >
      <SearchMultiSelect
        options={props.options}
        value={props.selected}
        onChange={props.onChange}
        placeholder={props.placeholder}
        disabled={props.disabled}
        autoFocus={props.autoFocus}
        showSelectedTags={props.showSelectedTags}
        onSearch={props.onSearchTextChange}
        loading={props.loading}
        emptyMessage={emptyMessage()}
        selectedOptions={props.selectedOptions}
        mount={props.mount}
      />
    </Show>
  );
}

import { __ } from '@invflux/i18n';
import { Input } from '@invflux/ui';
import { type JSX, onMount } from 'solid-js';

/**
 * Whether focus is in an editable field — resolved through nested Shadow DOMs (the SPA mounts in one,
 * so document.activeElement is only the host). Lets a global `/` shortcut type normally while editing.
 */
export function isTypingInField(): boolean {
  if ('undefined' === typeof document) return false;
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  if (null === el) return false;
  return (
    'INPUT' === el.tagName ||
    'TEXTAREA' === el.tagName ||
    'SELECT' === el.tagName ||
    (el as HTMLElement).isContentEditable
  );
}

/**
 * The scanner-first quick-filter input that sits above a grid. Auto-
 * focuses on mount, selects-all on focus (so a scan/typed query replaces cleanly), and on Enter/Esc
 * hands focus to the grid via `onLeave`. The host filters its rows by the value and refocuses this
 * input (the `/`-from-anywhere and Esc-from-grid moves) through the `ref` handle.
 */
export function QuickFilter(props: {
  value: () => string;
  onInput: (next: string) => void;
  /** Enter/Esc in the input → leave for the grid. Enter (with a single match) jumps to the qty cell;
   *  Esc just drops into cell-nav. The host decides from the key. */
  onLeave: (key: 'Enter' | 'Escape') => void;
  placeholder?: string;
  /** Receives a focus()+select() handle the host calls to refocus the filter. */
  ref?: (focus: () => void) => void;
}): JSX.Element {
  let input!: HTMLInputElement;

  onMount(() => {
    input.focus();
    props.ref?.(() => {
      input.focus();
      input.select();
    });
  });

  const onKeyDown = (e: KeyboardEvent): void => {
    if ('Enter' === e.key || 'Escape' === e.key) {
      e.preventDefault();
      props.onLeave('Enter' === e.key ? 'Enter' : 'Escape');
    }
  };

  return (
    <Input
      ref={input}
      type="text"
      autocomplete="off"
      spellcheck={false}
      class="w-full"
      value={props.value()}
      placeholder={props.placeholder ?? __('Filter — name or SKU…')}
      onInput={(e) => props.onInput(e.currentTarget.value)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={onKeyDown}
    />
  );
}

import { createEffect, type JSX } from 'solid-js';
import * as Combobox from '@kobalte/core/combobox';

/**
 * Auto-highlight the first option of a Kobalte combobox so Enter accepts it without pressing Down.
 * Kobalte clears the focused key on every input/collection change, so this re-applies it (and marks
 * the collection focused, which is what makes the key render as highlighted rather than just stored)
 * whenever the first key changes.
 *
 * **Which list is "first" depends on who filters.** A host that pre-filters and ranks its own
 * options (fuzzy mode) knows the answer and passes `firstKey` — an accessor reading its reactive
 * option list, so this re-runs on each keystroke even when the top option's key happens to be
 * unchanged. A host that lets Kobalte filter internally passes nothing, and the first key is read
 * from the combobox's own collection instead. Reading the host's array in that case would highlight
 * a row Kobalte has already filtered out of view: the array still holds every option, matching or
 * not, so `[0]` is the first option that *exists*, not the first one *shown*.
 *
 * Either way the key must name a row the operator can actually act on, so the collection walk skips
 * disabled entries and section headers — the same walk Kobalte's own keyboard delegate does to find
 * where Down lands from the top.
 *
 * Kobalte-bound (unlike the framework-agnostic `fuzzyScore` / `HighlightMatch`): it reads the combobox
 * context, so it must be rendered **inside** `<Combobox.Root>`. Renders nothing. Shared by
 * {@link SearchSelect} and any other Kobalte-combobox wrap (e.g. SearchSelectAsync) that wants the
 * same "first result pre-selected" UX.
 */
export function KobalteComboboxFirstFocus(props: {
  /** The first key, when the host owns filtering. Omit to read the combobox's own collection. */
  firstKey?: () => string | undefined;
}): JSX.Element {
  const ctx = Combobox.useComboboxContext();

  // Reading the collection inside the effect is also what subscribes us to Kobalte's own filtering,
  // so the highlight follows the operator's typing without the host having to report it.
  const collectionFirstKey = (): string | undefined => {
    const collection = ctx.listState().collection();
    let key = collection.getFirstKey();
    while (undefined !== key) {
      const item = collection.getItem(key);
      if (item && 'item' === item.type && true !== item.disabled) return key;
      key = collection.getKeyAfter(key);
    }
    return undefined;
  };

  createEffect(() => {
    const key = props.firstKey ? props.firstKey() : collectionFirstKey();
    if (!ctx.isOpen() || undefined === key) return;
    // Defer so it lands AFTER Kobalte's own focus reset (fired on the same input/collection change).
    queueMicrotask(() => {
      const sm = ctx.listState().selectionManager();
      sm.setFocused(true);
      sm.setFocusedKey(key);
    });
  });
  return null as unknown as JSX.Element;
}

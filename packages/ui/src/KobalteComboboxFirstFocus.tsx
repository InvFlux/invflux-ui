import { createEffect, type JSX } from 'solid-js';
import * as Combobox from '@kobalte/core/combobox';

/**
 * Auto-highlight the first option of a Kobalte combobox so Enter accepts it without pressing Down.
 * Kobalte clears the focused key on every input/collection change, so this re-applies it (and marks
 * the collection focused, which is what makes the key render as highlighted rather than just stored)
 * whenever `firstKey` changes — pass an accessor that reads your reactive option list, so it re-runs
 * on each filter even when the top option's key happens to be unchanged.
 *
 * Kobalte-bound (unlike the framework-agnostic `fuzzyScore` / `HighlightMatch`): it reads the combobox
 * context, so it must be rendered **inside** `<Combobox.Root>`. Renders nothing. Shared by
 * {@link SearchSelect}'s fuzzy mode and any other Kobalte-combobox wrap (e.g. SearchSelectAsync) that
 * wants the same "first result pre-selected" UX.
 */
export function KobalteComboboxFirstFocus(props: { firstKey: () => string | undefined }): JSX.Element {
  const ctx = Combobox.useComboboxContext();
  createEffect(() => {
    const key = props.firstKey(); // reactive: re-runs whenever the option set changes
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

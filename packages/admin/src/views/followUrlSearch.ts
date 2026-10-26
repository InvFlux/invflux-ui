import { createEffect, untrack, type Accessor } from 'solid-js';

/**
 * Apply the host's URL search term to the local one, without fighting the person typing.
 *
 * The term is mirrored both ways — the box writes to the URL so a filtered view can be shared, and
 * the URL writes to the box so a link arrives filtered. Two-way means the loop has to be cut
 * somewhere, and this is where: **the local term is read untracked, so this reacts to the URL and
 * only to the URL.**
 *
 * Read it tracked instead and the effect depends on the signal it writes, which turns typing into a
 * fight the typist loses. Each keystroke re-runs this, the URL has not caught up — a mirror is
 * debounced, because Safari rate-limits `replaceState` — so the stale URL value is reapplied and the
 * box is wiped mid-word. The next keystroke then starts from empty, so the URL ends up holding the
 * single last character typed. That was shipped once; the test beside this file is why it will not
 * ship twice.
 *
 * `undefined` means the host has no URL to mirror into (the standalone page), and the box is simply
 * left alone. An empty string is a value, not an absence: it means the term was cleared.
 */
export function followUrlSearch(
  incoming: Accessor<string | undefined>,
  current: Accessor<string>,
  set: (term: string) => void,
): void {
  createEffect(() => {
    const term = incoming();
    if (undefined === term) {
      return;
    }
    if (term !== untrack(current)) {
      set(term);
    }
  });
}

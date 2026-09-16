/**
 * Tell a person's keystroke from a machine's.
 *
 * Bare-letter shortcuts are the right ergonomics for a floor surface — `c` to raise a correction,
 * `u` to go back — and they are exactly what a **barcode scanner** breaks. A scanner is a keyboard:
 * it types its payload into whatever has focus, and when nothing is focused it types into the page.
 * A barcode containing `u` then navigates the operator away mid-scan, and the only evidence is that
 * they are suddenly somewhere else.
 *
 * The tell is speed. A scanner emits characters about 5–20 ms apart; sustained human typing sits
 * above 60 ms, and 30 ms would already be 400 words per minute. So a shortcut waits for the typing
 * to *stop* before it acts: press `u` alone and it fires a frame later, imperceptibly; arrive as
 * character three of a barcode and the next character cancels it before anything happens.
 *
 * **Deferring is what makes this work, and it cannot be avoided.** A guard that only looked
 * backwards — "was the previous key long ago?" — is fooled by the *first* character of a scan,
 * which always follows a long quiet gap. By then the shortcut has already fired, and navigation
 * cannot be un-fired.
 *
 * Non-printable keys need none of this: no scanner emits Escape, and gating it would put a delay on
 * the one key an operator presses when they want out *now*.
 *
 * **Mechanically this is a trailing-edge debounce, and it is worth knowing that it is not the usual
 * one.** An ordinary debounce *coalesces* a burst into its last call — which here would be the
 * worst possible behaviour, since a barcode ending in a shortcut letter would fire the shortcut
 * once, at the end, looking deliberate. This one is armed by a single signal (the shortcut key) and
 * cancelled by a broader one (any keystroke at all), so a burst does not collapse to one action —
 * it produces none. "Fire only if nothing else happened" rather than "fire the last of what did".
 *
 * The same shape appears a layer down in the queue's request hygiene: wait for quiet before
 * spending something expensive, and never delay the state itself. There it is a real debounce,
 * because coalescing is exactly what a burst of filter edits wants.
 */

/** Longer than a scanner's inter-character gap, shorter than a person notices. */
const QUIET_MS = 45;

let pending: ReturnType<typeof setTimeout> | null = null;
let listening = false;

/**
 * Report a keystroke, cancelling any shortcut still waiting for the typing to stop.
 *
 * Exported rather than purely internal so the mechanism can be exercised without a DOM — and so a
 * surface that reads keys through its own pipeline (a scanner session that swallows events before
 * they reach the document) can keep this honest.
 */
export function noteKeystroke(): void {
  if (pending === null) return;
  clearTimeout(pending);
  pending = null;
}

/**
 * Run `action` unless another keystroke follows within the quiet window.
 *
 * Call from a `keydown` handler that has already decided the shortcut applies. Any subsequent key —
 * the rest of a barcode — cancels it. A second shortcut inside the window cancels the first: two
 * letters in quick succession is typing, not two shortcuts.
 */
export function runWhenTypingStops(action: () => void, quietMs: number = QUIET_MS): void {
  if (!listening && typeof document !== 'undefined') {
    // Capture phase, so the cancellation is seen before any handler that might schedule another
    // action for the same key.
    document.addEventListener('keydown', noteKeystroke, true);
    listening = true;
  }

  noteKeystroke();
  pending = setTimeout(() => {
    pending = null;
    action();
  }, quietMs);
}

/** Drop a scheduled shortcut — for a surface unmounting out from under one. */
export function cancelPendingShortcut(): void {
  noteKeystroke();
}

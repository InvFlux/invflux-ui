/**
 * Keyboard helpers for global (document/window-level) shortcut handlers.
 */

/**
 * Whether a keystroke originated in something the user is *typing into* — an input, textarea,
 * select, or contenteditable — anywhere in its composed path.
 *
 * **Every global single-key shortcut must consult this**, or a letter typed into a field somewhere
 * on the page fires the shortcut instead of landing in the field.
 *
 * The composed path is the load-bearing part, and the reason this is shared rather than re-derived
 * per handler. The SPAs mount inside a **shadow root**, and shadow-DOM retargeting rewrites
 * `event.target` to the shadow *host* before a listener outside that root ever sees the event — so
 * the obvious `e.target.tagName === 'INPUT'` check is not merely fragile here, it is always false,
 * and the guard silently does nothing. `composedPath()` still contains the real element, so it
 * answers correctly whether the listener sits inside or outside the shadow boundary.
 *
 * The failure it prevents is not subtle once seen: typing a word containing the shortcut letter into
 * any field runs the shortcut mid-word. (Reported: typing "archived" into the tag manager opened the
 * correction modal on the "c".)
 */
export function isTypingTarget(event: Event): boolean {
  for (const node of event.composedPath()) {
    if (
      node instanceof HTMLInputElement ||
      node instanceof HTMLTextAreaElement ||
      node instanceof HTMLSelectElement
    ) {
      return true;
    }
    if (node instanceof HTMLElement && node.isContentEditable) {
      return true;
    }
  }
  return false;
}

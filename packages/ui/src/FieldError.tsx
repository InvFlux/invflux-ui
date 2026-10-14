import { type JSX, Show } from 'solid-js';

/**
 * The message under a field whose value is missing or wrong — the one way a form says what to fix.
 *
 * The convention it belongs to: a submit button stays enabled while the input is incomplete. Pressing
 * it marks each offending field (`invalid` on the field primitives: red border and pink fill), puts
 * this message under it, and moves focus to the first one ({@link focusFirstInvalid}). A required
 * field is marked only from the first attempt on; a malformed one may be marked as it is typed.
 *
 * A button is disabled only when there is nothing to do, never to stand in for a message: a save in
 * flight, or an existing record with no change yet. A record being created keeps its button enabled
 * from the start — pressing it is how the operator learns what is still missing.
 *
 * Two cases keep a disabled button, because the page already says why in words:
 * - an "I confirm…" box above the button, which the button waits for;
 * - a refusal known before the press (a permission the user lacks, a live server preview refusing),
 *   provided the reason is on the page beside the form, not only in a tooltip.
 * A refusal that traces to one field's value (a number over a limit) marks that field instead.
 *
 * Renders nothing without a message, so a caller passes the error (or null) straight through.
 */
export function FieldError(props: {
  message: string | null | undefined | false;
  testId?: string;
}): JSX.Element {
  return (
    <Show when={props.message}>
      {(message) => (
        <span class="mt-1 block text-xs text-red-700" data-testid={props.testId}>
          {message()}
        </span>
      )}
    </Show>
  );
}

/**
 * Focus the first field marked invalid inside `root` — called after a refused submit, so the
 * operator lands on what to fix. Deferred a frame: the marks are reactive and land after the
 * attempt that raised them.
 */
export function focusFirstInvalid(root: ParentNode | undefined): void {
  requestAnimationFrame(() => {
    root?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
}

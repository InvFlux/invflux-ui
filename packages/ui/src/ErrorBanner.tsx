import { Dynamic } from 'solid-js/web';
import type { JSX } from 'solid-js';

export interface ErrorBannerProps {
  /** The failure to report. Already localized — this renders it, it does not phrase it. */
  children: JSX.Element;
  /** Layout and size classes only. The colour belongs to the component; see below. */
  class?: string;
  /**
   * The element to render. `p` (default) for a message; `span` for one sitting beside a control;
   * `div` when the banner carries block content of its own — a `<p>` may not contain a `<div>`, so
   * a banner with structure inside has to say so. Purely presentational: every variant announces.
   */
  as?: 'p' | 'span' | 'div';
  /**
   * DOM id, so a field can point at this message with `aria-describedby`.
   *
   * `role="alert"` announces the message once, when it appears. That is the wrong half of the
   * problem for a field-level error: someone tabbing back to fix the value hears the field's name
   * and nothing about what was wrong with it. The id is what makes the message reachable again.
   */
  id?: string;
}

/**
 * A failure the user needs to be told about, announced rather than merely coloured.
 *
 * `role="alert"` is the whole point. An error surface appears *in response to something* — a save
 * that failed, a query that came back empty-handed — by which time the eye has usually moved on,
 * and inside a modal there is often no other feedback channel at all. Red text reports the failure
 * to whoever happens to be looking at that part of the screen; this reports it to everyone.
 *
 * **The colour is owned here and is not overridable.** Two colour utilities on one element resolve
 * by stylesheet order rather than by the order they were written, so letting callers pass their own
 * `text-red-*` alongside the default is a coin flip that happens to land right. Owning it also ends
 * the 600/700 drift the surfaces had accumulated between them: one error colour, everywhere.
 *
 * Callers keep their own spacing and type size via `class`, because where an error sits and how
 * loud it is are properties of the surface, not of the fact that it is an error.
 */
export function ErrorBanner(props: ErrorBannerProps): JSX.Element {
  return (
    <Dynamic
      component={props.as ?? 'p'}
      id={props.id}
      role="alert"
      class={`text-red-700 ${props.class ?? ''}`}
    >
      {props.children}
    </Dynamic>
  );
}

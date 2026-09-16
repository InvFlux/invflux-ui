import { __ } from '@invflux/i18n';
import { A } from '@solidjs/router';
import { For, type JSX, Show } from 'solid-js';

/**
 * One step of the trail. A crumb with no `href` is plain text — either the page you are already on,
 * or a name this viewer holds no capability to open. Both render the same way on purpose: a link
 * that refuses is worse than a word, and the operator still gets told what they are counting.
 */
export interface Crumb {
  label: string;
  href?: string;
}

/**
 * The heading on every screen below `/receiving`, written as a trail rather than a plain title.
 *
 * **The trail is the navigation, so these screens carry no back-link.** A single "up" link would
 * spend a line saying what the heading can say for free, and it would be wrong as often as right:
 * a counting screen is reached from the landing list, from the source chooser, and from a buyer's
 * own purchase order, so there is no one place to go back to. Each step of the trail is a
 * destination instead — the landing page, the order in Procurement, the supplier.
 *
 * **The first crumb is muted, the rest are not.** Where you are is the heading; where you came from
 * is context. Links are underlined on hover rather than coloured, because a heading tinted primary
 * across half its width reads as a call to action rather than a title.
 *
 * Carries no bottom margin: some of these screens follow the heading with a subtitle and some go
 * straight into a form, so the gap belongs to the page that knows what comes next.
 */
export function ReceivingCrumbs(props: { trail: Crumb[] }): JSX.Element {
  return (
    <h1 class="flex flex-wrap items-baseline gap-x-2 text-xl font-semibold">
      <A href="/receiving" class="text-text-muted hover:text-text hover:underline">
        {__('Receiving')}
      </A>
      <For each={props.trail}>
        {(crumb) => (
          <>
            {/* Decoration: the trail is already one heading to a screen reader, so a spoken slash
                between each step is noise. */}
            <span class="font-normal text-slate-300" aria-hidden="true">
              /
            </span>
            <Show when={crumb.href} fallback={<span>{crumb.label}</span>}>
              {(href) => (
                <A href={href()} class="hover:underline">
                  {crumb.label}
                </A>
              )}
            </Show>
          </>
        )}
      </For>
    </h1>
  );
}

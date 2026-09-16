import { __ } from '@invflux/i18n';
import { A } from '@solidjs/router';
import { For, type JSX, Show } from 'solid-js';
import { ReceivingCrumbs } from './ReceivingCrumbs';
import { receivingSources } from './sources';

/**
 * Starting a reception: where are these goods coming from?
 *
 * The question is asked first because the answer decides everything after it — what the session
 * points at, which lines it starts with, and whether the operator will be asked for a cost at all
 * (a receipt answering a document takes its cost from that document; only a source-less intake
 * carries a reason). Sources come from the registry, so an add-on's source appears here without the
 * chooser knowing it exists.
 */
export function NewReception(): JSX.Element {
  const sources = receivingSources;

  return (
    <div class="p-4">
      <header class="mb-5">
        <ReceivingCrumbs trail={[{ label: __('Start a reception') }]} />
        <p class="mt-1 text-sm text-text-muted">{__('Where are these goods coming from?')}</p>
      </header>

      <Show
        when={sources().length > 0}
        fallback={
          <p class="text-sm text-text-muted">
            {__('No way of receiving stock is available to you on this site.')}
          </p>
        }
      >
        <div class="grid max-w-3xl gap-3 sm:grid-cols-2">
          <For each={sources()}>
            {(source) => (
              <A
                href={`/receiving/new/${source.id}`}
                class="rounded border border-border bg-surface p-4 text-left hover:border-primary hover:shadow-sm"
              >
                <span class="block font-medium">{source.label?.() ?? source.id}</span>
                <Show when={source.description?.()}>
                  {(text) => <span class="mt-1 block text-sm text-text-muted">{text()}</span>}
                </Show>
              </A>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

import { __, sprintf } from '@invflux/i18n';
import { ErrorBanner } from '@invflux/ui';
import { For, type JSX } from 'solid-js';
import type { NumberingBreak } from './types';

/** Where clause numbers stop running on — what a save refuses — named line by line. */
export function NumberingBreaks(props: { breaks: NumberingBreak[]; class?: string }): JSX.Element {
  return (
    <ErrorBanner class={props.class}>
      <p>
        {__(
          'Some clause numbers skip or repeat. Correct them so each follows the one before, then save.',
        )}
      </p>
      <ul class="mt-1 list-disc pl-5">
        <For each={props.breaks}>
          {(b) => (
            <li>
              {sprintf(
                /* translators: 1: line number, 2: the number expected there, 3: the number found */
                __('Line %1$d: numbered %3$d where %2$d comes next.'),
                b.line,
                b.expected,
                b.found,
              )}
            </li>
          )}
        </For>
      </ul>
    </ErrorBanner>
  );
}

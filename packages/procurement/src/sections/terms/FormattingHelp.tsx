import { __ } from '@invflux/i18n';
import { For, type JSX } from 'solid-js';

/** The one sentence beside a terms box: plain text works, and three line starts give it structure. */
export function TermsHint(): JSX.Element {
  return (
    <span class="text-xs text-text-muted">
      {__(
        'Plain text prints as you type it. For structure, start a line with # for a heading, - for a bullet or 1. for a numbered clause.',
      )}
    </span>
  );
}

/**
 * What the merchant types beside what prints, for the few structures terms use.
 *
 * Shown rather than named: the format is Markdown, but what a merchant needs is what a line starting
 * with `#` does, not what the convention is called. The printed column is written out here rather than
 * asked of the server, so it opens instantly; it uses the same elements, styled as the preview styles
 * them.
 */
export function FormattingHelp(props: { typography: string }): JSX.Element {
  const rows = (): { what: string; source: string; printed: JSX.Element }[] => [
    { what: __('Heading'), source: `# ${__('Delivery')}`, printed: <h1>{__('Delivery')}</h1> },
    {
      what: __('Bold'),
      source: `**${__('at our risk')}**`,
      printed: (
        <p>
          <strong>{__('at our risk')}</strong>
        </p>
      ),
    },
    {
      what: __('Italic'),
      source: `*${__('unless agreed otherwise')}*`,
      printed: (
        <p>
          <em>{__('unless agreed otherwise')}</em>
        </p>
      ),
    },
    {
      what: __('Bulleted list'),
      source: `- ${__('by road')}\n- ${__('by sea')}`,
      printed: (
        <ul>
          <li>{__('by road')}</li>
          <li>{__('by sea')}</li>
        </ul>
      ),
    },
    {
      what: __('Numbered clauses'),
      source: `1. ${__('Delivery')}\n2. ${__('Payment')}`,
      printed: (
        <ol>
          <li>{__('Delivery')}</li>
          <li>{__('Payment')}</li>
        </ol>
      ),
    },
    {
      what: __('Link'),
      source: `[${__('our website')}](https://example.com)`,
      printed: (
        <p>
          <a href="https://example.com" target="_blank" rel="noopener noreferrer">
            {__('our website')}
          </a>
        </p>
      ),
    },
    {
      what: __('New paragraph'),
      source: `${__('First paragraph.')}\n\n${__('Second paragraph.')}`,
      printed: (
        <>
          <p>{__('First paragraph.')}</p>
          <p>{__('Second paragraph.')}</p>
        </>
      ),
    },
  ];

  return (
    <details class="mt-1 text-xs text-slate-700">
      <summary class="cursor-pointer text-primary">{__('How to format')}</summary>
      <table class="mt-2 w-full max-w-2xl border-collapse">
        <thead>
          <tr class="text-left text-text-muted">
            <th class="py-1 pr-3 font-medium" />
            <th class="py-1 pr-3 font-medium">{__('You type')}</th>
            <th class="py-1 font-medium">{__('It prints')}</th>
          </tr>
        </thead>
        <tbody>
          <For each={rows()}>
            {(row) => (
              <tr class="border-t border-slate-200 align-top">
                <td class="py-2 pr-3 text-text-muted">{row.what}</td>
                <td class="py-2 pr-3">
                  <pre class="whitespace-pre-wrap font-mono">{row.source}</pre>
                </td>
                <td class={`py-2 text-sm [&>*:first-child]:mt-0 ${props.typography}`}>
                  {row.printed}
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <p class="mt-2 text-text-muted">
        {__(
          'A new line prints as a new line. Number clauses yourself, in order — the preview checks the numbers before you save.',
        )}
      </p>
    </details>
  );
}

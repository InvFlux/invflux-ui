import { __ } from '@invflux/i18n';
import { Button, toast } from '@invflux/ui';
import { createMutation } from '@tanstack/solid-query';
import { createSignal, createUniqueId, type JSX, Show } from 'solid-js';
import { useProcurement } from '../../context';
import { createApi } from '../../lib/api';
import { refusalMessage } from './errors';
import { FormattingHelp, TermsHint } from './FormattingHelp';
import { NumberingBreaks } from './NumberingBreaks';
import { RenderedTerms } from './RenderedTerms';
import { TermsTextarea } from './TermsTextarea';
import { RENDERED, TERMS_TYPOGRAPHY } from './typography';
import type { NumberingBreak, TermsPreview } from './types';

/**
 * Terms written in place — an order's own, which are never saved as a set — with the same help, line
 * numbers and preview as the terms page, because the supplier reads them the same way and the save
 * checks them the same way.
 *
 * Preview swaps the box for the text as it will print, and the box then holds the text as it will be
 * stored, so a line a numbering check names is the line on screen. Lines are marked in the gutter
 * whether the preview named them or the caller's save was refused for them (`refused`).
 */
export function TermsComposer(props: {
  label: string;
  value: string;
  onInput: (value: string) => void;
  minRows?: number;
  placeholder?: string;
  /** Breaks a save was refused for, handed back by the caller. */
  refused?: NumberingBreak[];
}): JSX.Element {
  const api = createApi(useProcurement());
  const id = createUniqueId();
  const [preview, setPreview] = createSignal<TermsPreview | null>(null);
  const [previewBreaks, setPreviewBreaks] = createSignal<NumberingBreak[]>([]);
  const refused = (): NumberingBreak[] => props.refused ?? [];
  const flagged = (): ReadonlySet<number> =>
    new Set([...previewBreaks(), ...refused()].map((b) => b.line));

  const runPreview = createMutation(() => ({
    mutationFn: () =>
      api.post<TermsPreview>('/procurement/terms/preview', { body: props.value, lineageId: null }),
    onSuccess: (data) => {
      props.onInput(data.source);
      setPreviewBreaks(data.numberingBreaks);
      setPreview(data);
    },
    onError: (e: unknown) => toast.error(refusalMessage(e, __('Could not preview these terms.'))),
  }));

  return (
    <div class="text-sm text-slate-700">
      <Show
        when={null === preview()}
        fallback={
          <>
            <p class="mb-1">{__('As it will print')}</p>
            {/* The server's rendering, rebuilt from an allowlist as DOM nodes — never a raw string. */}
            <RenderedTerms class={RENDERED} html={preview()?.html ?? ''} />
            <Show when={previewBreaks().length > 0}>
              <NumberingBreaks class="mt-2" breaks={previewBreaks()} />
            </Show>
            <div class="mt-2">
              <Button variant="secondary" size="sm" onClick={() => setPreview(null)}>
                {__('← Continue to edit')}
              </Button>
            </div>
          </>
        }
      >
        <label for={id}>{props.label}</label> <TermsHint />
        <FormattingHelp typography={TERMS_TYPOGRAPHY} />
        <TermsTextarea
          id={id}
          minRows={props.minRows ?? 6}
          value={props.value}
          onInput={props.onInput}
          flagged={flagged()}
          placeholder={props.placeholder}
        />
        <Show when={refused().length > 0}>
          <NumberingBreaks class="mt-2" breaks={refused()} />
        </Show>
        <div class="mt-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={'' === props.value.trim() || runPreview.isPending}
            onClick={() => runPreview.mutate()}
          >
            {__('Preview')}
          </Button>
        </div>
      </Show>
    </div>
  );
}
